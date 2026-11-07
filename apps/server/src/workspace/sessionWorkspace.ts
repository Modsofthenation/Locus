import { join } from "node:path";
import type { AgentSession, ComputerUseToolName, GitForgeAccount, VmInstance } from "@locus/shared";
import {
  branchLockRefusal,
  cleanGitHeadName,
  extractSymbolLocations,
  gitWorkspaceDests,
  isCursorCliProvider,
  isCursorProvider,
  isClaudeCodeProvider,
  isKiroCliProvider,
  isGuestReady,
  matchGitDest,
  matchLinkedRepo,
  matchWorkspaceCheckout,
  normalizeRepoPath,
  relInGitDest,
  resolveGitWorkspaceDest,
  sessionRuntime,
  workspaceChangesFromMessages,
} from "@locus/shared";
import {
  formatProviderError,
  hasUsableKey,
  type ChatEvent,
  type CompleteRequest,
} from "@locus/providers";
import type { WorkerClient } from "@locus/worker";
import type { Hub } from "../core/hub.js";
import type { JsonStore } from "../core/store.js";
import { workspacePath, type GuestHub } from "../core/guests.js";
import type { ForgeClient } from "../git/forge.js";
import type { ToolResult } from "@locus/guest-agent";
import {
  listWorkspace,
  parseWorkspaceListDepth,
  readWorkspaceFile,
  readWorkspaceBytes,
  writeWorkspaceFile,
  writeWorkspaceBytes,
  mkdirWorkspace,
  deleteWorkspacePath,
  renameWorkspacePath as moveWorkspacePath,
  grepWorkspace,
  sanitizeWorkspaceRel,
  type WorkspaceGrepOptions,
} from "./workspaceFiles.js";
import {
  completeWorkspaceFile,
  inspectWorkspaceFile,
  formatWorkspaceFile,
  organizeWorkspaceImports,
  renameWorkspaceSymbol,
  referencesWorkspaceFile,
  navigateWorkspaceSymbols,
  fixWorkspaceFile,
  problemsWorkspaceFiles,
} from "./workspaceComplete.js";
import {
  INLINE_EDIT_NO_COMPLETIONS,
  INLINE_EDIT_TIMEOUT_MS,
  runWorkspaceInlineEdit,
} from "./workspaceInlineEdit.js";
import {
  debugCommand,
  debugState,
  setDebugBreakpoints,
  startWorkspaceDebug,
  stopWorkspaceDebug,
  toggleDebugBreakpoint,
} from "./workspaceDebug.js";
import { indentFromEditorConfig } from "./workspaceEditorConfig.js";
import { readPythonLibraryFile } from "./workspacePython.js";
import {
  workspaceGitBlame,
  workspaceGitBlameFile,
  workspaceGitBranches,
  workspaceGitCheckout,
  workspaceGitCheckoutConflict,
  workspaceGitCommit,
  workspaceGitDiscard,
  workspaceGitFetch,
  workspaceGitHunks,
  workspaceGitMerge,
  workspaceGitMergeContinue,
  workspaceGitPull,
  workspaceGitRebase,
  workspaceGitRebaseContinue,
  workspaceGitRebasePreview,
  workspaceGitStage,
  workspaceGitStageHunk,
  workspaceGitStash,
  workspaceGitStashList,
  workspaceGitStatus,
  workspaceGitUnstage,
} from "./workspaceGit.js";
import {
  listGuestWorkspaceEntries,
  listWorkspaceAccess,
  readGuestWorkspaceFile,
  readWorkspaceAccess,
  readWorkspaceRawAccess,
  WORKSPACE_UNSUPPORTED,
  canLaunchWorkspaceDebug,
  workspaceAccessKind,
  workspaceDebugLaunchNote,
  writeGuestWorkspaceFile,
  writeWorkspaceAccess,
  writeWorkspaceBytesAccess,
  mkdirGuestWorkspace,
  mkdirWorkspaceAccess,
  deleteGuestWorkspacePath,
  deleteWorkspaceAccess,
  type GuestWorkspaceExec,
} from "./workspaceAccess.js";
import {
  buildWorkspaceIndex,
  indexCacheDir,
  peekWorkspaceIndex,
  searchWorkspaceIndex,
  updateIndexPaths,
} from "./repoIndex.js";
import {
  gitWorkspaceBaseline,
  gitWorkspaceChanges,
  invalidateGitWorkspaceChanges,
} from "./gitWorkspaceChanges.js";
import { revealWorkspaceFolder } from "./revealWorkspace.js";

export type { WorkspaceGrepOptions };

export type WorkspaceChatEngine = (req: CompleteRequest) => AsyncGenerator<ChatEvent>;

export type SessionWorkspacePorts = {
  require: (sessionId: string) => Promise<AgentSession>;
  isWorker: (session: { placement?: AgentSession["placement"] }) => boolean;
  hostRoot: (session: AgentSession) => string;
  dockerWorkspaceRoot: (session: AgentSession) => string;
  workspaceRoot: (session: AgentSession) => string | undefined;
  getMachine: (id: string) => VmInstance | undefined;
  requireWorker: (session: AgentSession) => Promise<WorkerClient>;
  guests: GuestHub;
  hub: Hub;
  store: JsonStore;
  forge: ForgeClient;
  requireForge: (
    session: AgentSession,
    args?: Record<string, unknown>,
  ) => Promise<{ account: GitForgeAccount; owner: string; repo: string } | ToolResult>;
  chatEngine: WorkspaceChatEngine;
  invalidateRepoMap: (sessionId: string) => void;
};

/** Operator Files / Git / LSP / debug surface for a Session. */
export class SessionWorkspace {
  constructor(private readonly ports: SessionWorkspacePorts) {}

  async listWorkspace(sessionId: string, rel?: string, depthRaw?: string) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    const vm = session.vmId ? this.ports.getMachine(session.vmId) : undefined;
    const maxDepth = parseWorkspaceListDepth(depthRaw);
    return listWorkspaceAccess({
      kind,
      hasVm: Boolean(session.vmId),
      messageChanges: workspaceChangesFromMessages(session.messages),
      skipGit: maxDepth != null,
      listWorker: async () => {
        const client = await this.ports.requireWorker(session);
        return client.listWorkspace(session.vmId!, rel);
      },
      listGuest: () => this.listGuestWorkspace(vm, rel),
      listHost: () => listWorkspace(root, rel, maxDepth),
      gitChanges: async () => {
        const dests = gitWorkspaceDests(
          session,
          workspacePath(session.os, sessionRuntime(session)).replace(/\\/g, "/"),
        );
        if (dests.length <= 1) return gitWorkspaceChanges(root);
        const rows: import("@locus/shared").WorkspaceFileChange[] = [];
        const seen = new Set<string>();
        for (const dest of dests) {
          const gitRoot = dest.dest ? join(root, ...dest.dest.split("/")) : root;
          for (const row of await gitWorkspaceChanges(gitRoot)) {
            const path = dest.dest ? `${dest.dest}/${row.path}` : row.path;
            if (seen.has(path)) continue;
            seen.add(path);
            rows.push({ ...row, path });
          }
        }
        return rows.sort((a, b) => a.path.localeCompare(b.path));
      },
    });
  }

  async readWorkspace(sessionId: string, rel: string) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    const vm = session.vmId ? this.ports.getMachine(session.vmId) : undefined;
    return readWorkspaceAccess({
      kind,
      hasVm: Boolean(session.vmId),
      readWorker: async () => {
        const client = await this.ports.requireWorker(session);
        return client.readWorkspace(session.vmId!, rel);
      },
      readGuest: () => this.readGuestWorkspace(vm, rel),
      readHost: async () =>
        (await readWorkspaceFile(root, rel)) ?? readPythonLibraryFile(root, rel),
      gitBaseline: () => {
        const dests = gitWorkspaceDests(
          session,
          workspacePath(session.os, sessionRuntime(session)).replace(/\\/g, "/"),
        );
        const hit = matchGitDest(rel, dests);
        const gitRoot = hit?.dest ? join(root, ...hit.dest.split("/")) : root;
        const gitRel = hit ? relInGitDest(rel, hit.dest) : rel;
        return gitWorkspaceBaseline(gitRoot, gitRel);
      },
    });
  }

  async readWorkspaceRaw(sessionId: string, rel: string) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    return readWorkspaceRawAccess({
      kind,
      hasVm: Boolean(session.vmId),
      readWorker: async () => {
        const client = await this.ports.requireWorker(session);
        return client.readWorkspaceRaw(session.vmId!, rel);
      },
      readHost: () => readWorkspaceBytes(root, rel),
    });
  }

  async writeWorkspace(sessionId: string, rel: string, content: string) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    const vm = session.vmId ? this.ports.getMachine(session.vmId) : undefined;
    const saved = await writeWorkspaceAccess({
      kind,
      hasVm: Boolean(session.vmId),
      rel,
      writeWorker: async () => {
        const client = await this.ports.requireWorker(session);
        return client.writeWorkspace(session.vmId!, rel, content);
      },
      writeGuest: () => this.writeGuestWorkspace(vm, rel, content),
      writeHost: () => writeWorkspaceFile(root, rel, content),
    });
    await this.touchWorkspaceIndex(session, [saved.path]);
    invalidateGitWorkspaceChanges();
    this.ports.hub.broadcast({ type: "workspace.changed", sessionId, paths: [saved.path] });
    return saved;
  }

  async writeWorkspaceBytes(sessionId: string, rel: string, bytes: Buffer) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    const saved = await writeWorkspaceBytesAccess({
      kind,
      hasVm: Boolean(session.vmId),
      rel,
      writeWorker: async () => {
        const client = await this.ports.requireWorker(session);
        return client.writeWorkspace(session.vmId!, rel, bytes.toString("base64"), "base64");
      },
      writeHost: () => writeWorkspaceBytes(root, rel, bytes),
    });
    await this.touchWorkspaceIndex(session, [saved.path]);
    invalidateGitWorkspaceChanges();
    this.ports.hub.broadcast({ type: "workspace.changed", sessionId, paths: [saved.path] });
    return saved;
  }

  async mkdirWorkspace(sessionId: string, rel: string) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    const vm = session.vmId ? this.ports.getMachine(session.vmId) : undefined;
    return mkdirWorkspaceAccess({
      kind,
      hasVm: Boolean(session.vmId),
      rel,
      mkdirWorker: async () => {
        const client = await this.ports.requireWorker(session);
        return client.mkdirWorkspace(session.vmId!, rel);
      },
      mkdirGuest: () =>
        mkdirGuestWorkspace(
          this.guestExecute(vm),
          rel,
          Boolean(vm && this.guestWorkspaceReady(vm)),
        ),
      mkdirHost: () => mkdirWorkspace(root, rel),
    });
  }

  async revealWorkspace(sessionId: string, rel: string) {
    const session = await this.ports.require(sessionId);
    const root = this.ports.workspaceRoot(session);
    if (!root) throw new Error("No workspace folder to reveal");
    return revealWorkspaceFolder(root, rel);
  }

  async renameWorkspacePath(sessionId: string, fromRel: string, toRel: string) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    const renamed = await moveWorkspacePath(root, fromRel, toRel);
    await this.touchWorkspaceIndex(session, [renamed.from, renamed.path]);
    this.ports.hub.broadcast({
      type: "workspace.changed",
      sessionId,
      paths: [renamed.from, renamed.path],
    });
    return renamed;
  }

  async completeWorkspace(
    sessionId: string,
    rel: string,
    content: string,
    line: number,
    character: number,
  ) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    return completeWorkspaceFile({ root, rel, content, line, character });
  }

  async inlineEditWorkspace(
    sessionId: string,
    input: {
      path: string;
      content: string;
      instruction: string;
      start: number;
      end: number;
    },
  ) {
    const session = await this.ports.require(sessionId);
    const config = await this.ports.store.loadConfig();
    const provider = config.providers.find((p) => p.id === session.providerId);
    if (!provider || !hasUsableKey(provider.apiKey, provider.baseUrl, provider.kind)) {
      throw new Error("Provider API key is not set");
    }
    if (
      isCursorProvider(provider) ||
      isCursorCliProvider(provider) ||
      isClaudeCodeProvider(provider) ||
      isKiroCliProvider(provider)
    ) {
      throw new Error(INLINE_EDIT_NO_COMPLETIONS);
    }
    try {
      return await runWorkspaceInlineEdit({
        provider,
        model: session.model,
        path: input.path,
        content: input.content,
        instruction: input.instruction,
        start: input.start,
        end: input.end,
        complete: (req) => this.ports.chatEngine(req),
        signal: AbortSignal.timeout(INLINE_EDIT_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(formatProviderError(err));
    }
  }

  async searchWorkspace(sessionId: string, query: string, limit?: number) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    return searchWorkspaceIndex(root, {
      query,
      cacheDir: indexCacheDir(this.ports.store.dataDir, session.id),
      limit,
    });
  }

  async grepWorkspace(
    sessionId: string,
    query: string,
    limit?: number,
    opts: WorkspaceGrepOptions = {},
  ) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    const result = await grepWorkspace(root, query, limit, opts);
    if (result.replaced) {
      this.ports.hub.broadcast({
        type: "workspace.changed",
        sessionId,
        paths: [...new Set(result.items.map((row) => row.path))],
      });
    }
    return result;
  }

  async inspectWorkspace(
    sessionId: string,
    rel: string,
    content: string,
    line: number,
    character: number,
  ) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    return inspectWorkspaceFile({ root, rel, content, line, character });
  }

  async symbolsWorkspace(sessionId: string, query: string, limit?: number) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    return navigateWorkspaceSymbols({ root, query, limit });
  }

  async referencesWorkspace(
    sessionId: string,
    rel: string,
    content: string,
    line: number,
    character: number,
  ) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    return referencesWorkspaceFile({ root, rel, content, line, character });
  }

  async formatWorkspace(sessionId: string, rel: string, content: string) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    return formatWorkspaceFile({ root, rel, content });
  }

  async organizeWorkspace(sessionId: string, rel: string, content: string) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    return organizeWorkspaceImports({ root, rel, content });
  }

  async renameWorkspace(
    sessionId: string,
    rel: string,
    content: string,
    line: number,
    character: number,
    newName: string,
  ) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    const renamed = await renameWorkspaceSymbol({ root, rel, content, line, character, newName });
    for (const file of renamed.files) {
      if (file.path === sanitizeWorkspaceRel(rel)) continue;
      await this.writeWorkspace(sessionId, file.path, file.content);
    }
    return renamed;
  }

  async outlineWorkspace(sessionId: string, rel: string, content?: string) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const path = sanitizeWorkspaceRel(rel);
    const text =
      content ??
      (await this.readWorkspace(sessionId, path)
        .then((file) => file.content)
        .catch(() => ""));
    return { items: extractSymbolLocations(path, text, { limit: 200 }) };
  }

  private async gitWorkspaceCtx(sessionId: string, dest?: string, rel?: string) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const workspaceRoot =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    const guestRoot = workspacePath(session.os, sessionRuntime(session)).replace(/\\/g, "/");
    const dests = gitWorkspaceDests(session, guestRoot);
    const fromPath = rel ? matchGitDest(rel, dests) : undefined;
    const selected = resolveGitWorkspaceDest(session, dest ?? fromPath?.dest, guestRoot);
    const checkout = matchWorkspaceCheckout(session, {
      dest: selected ? `${guestRoot}/${selected}` : undefined,
      path: selected ? `${guestRoot}/${selected}` : undefined,
    });
    const root = selected ? join(workspaceRoot, ...selected.split("/")) : workspaceRoot;
    return { session, workspaceRoot, root, dest: selected, dests, checkout };
  }

  private decorateGitStatus(
    ctx: { dest: string; dests: ReturnType<typeof gitWorkspaceDests> },
    status: import("../workspace/workspaceGit.js").WorkspaceGitStatus,
  ): import("../workspace/workspaceGit.js").WorkspaceGitStatus {
    const dest = ctx.dest || undefined;
    if (ctx.dests.length > 1) return { ...status, dest, dests: ctx.dests };
    return dest ? { ...status, dest } : status;
  }

  async gitWorkspace(sessionId: string, dest?: string) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest);
    return this.decorateGitStatus(ctx, await workspaceGitStatus(ctx.root));
  }

  async gitWorkspaceStage(sessionId: string, paths: string[], unstage = false, dest?: string) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest, paths[0]);
    const rels = paths.map((path) => relInGitDest(path, ctx.dest));
    const status = unstage
      ? await workspaceGitUnstage(ctx.root, rels)
      : await workspaceGitStage(ctx.root, rels);
    this.ports.hub.broadcast({ type: "workspace.changed", sessionId, paths });
    return this.decorateGitStatus(ctx, status);
  }

  async gitWorkspaceCommit(sessionId: string, message: string, dest?: string) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest);
    const status = await workspaceGitCommit(ctx.root, message);
    this.ports.hub.broadcast({ type: "workspace.changed", sessionId });
    return this.decorateGitStatus(ctx, status);
  }

  async gitWorkspaceBlame(sessionId: string, rel: string, line: number, dest?: string) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest, rel);
    return workspaceGitBlame(ctx.root, relInGitDest(rel, ctx.dest), line);
  }

  async gitWorkspaceBlameFile(sessionId: string, rel: string, dest?: string) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest, rel);
    return workspaceGitBlameFile(ctx.root, relInGitDest(rel, ctx.dest));
  }

  async gitWorkspaceMerge(sessionId: string, branch: string, dest?: string) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest);
    const status = await workspaceGitMerge(ctx.root, branch);
    this.ports.hub.broadcast({ type: "workspace.changed", sessionId });
    return this.decorateGitStatus(ctx, status);
  }

  async gitWorkspaceMergeContinue(sessionId: string, action: "continue" | "abort", dest?: string) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest);
    const status = await workspaceGitMergeContinue(ctx.root, action);
    this.ports.hub.broadcast({ type: "workspace.changed", sessionId });
    return this.decorateGitStatus(ctx, status);
  }

  async gitWorkspaceConflict(
    sessionId: string,
    rel: string,
    side: "ours" | "theirs",
    dest?: string,
  ) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest, rel);
    const status = await workspaceGitCheckoutConflict(ctx.root, relInGitDest(rel, ctx.dest), side);
    this.ports.hub.broadcast({ type: "workspace.changed", sessionId, paths: [rel] });
    return this.decorateGitStatus(ctx, status);
  }

  async gitWorkspaceBranches(sessionId: string, dest?: string) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest);
    return workspaceGitBranches(ctx.root);
  }

  async gitWorkspaceCheckout(sessionId: string, branch: string, create = false, dest?: string) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest);
    const refused = branchLockRefusal(ctx.session, branch);
    if (refused) throw new Error(refused);
    const status = await workspaceGitCheckout(ctx.root, branch, create);
    if (ctx.session.branchLock) {
      const head = cleanGitHeadName(branch);
      if (head && !cleanGitHeadName(ctx.session.repo?.ref ?? "") && !ctx.session.gitBranch) {
        const updated = await this.ports.store.mutateSession(sessionId, (current) => {
          current.gitBranch = head;
        });
        if (updated) this.ports.hub.broadcast({ type: "session.updated", session: updated });
      }
    }
    this.ports.hub.broadcast({ type: "workspace.changed", sessionId });
    return this.decorateGitStatus(ctx, status);
  }

  async gitWorkspacePull(sessionId: string, dest?: string) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest);
    const status = await workspaceGitPull(ctx.root);
    this.ports.hub.broadcast({ type: "workspace.changed", sessionId });
    return this.decorateGitStatus(ctx, status);
  }

  async gitWorkspaceFetch(sessionId: string, dest?: string) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest);
    const status = await workspaceGitFetch(ctx.root);
    this.ports.hub.broadcast({ type: "workspace.changed", sessionId });
    return this.decorateGitStatus(ctx, status);
  }

  async gitWorkspaceDiscard(sessionId: string, paths: string[], dest?: string) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest, paths[0]);
    const rels = paths.map((path) => relInGitDest(path, ctx.dest));
    const status = await workspaceGitDiscard(ctx.root, rels);
    this.ports.hub.broadcast({ type: "workspace.changed", sessionId, paths });
    return this.decorateGitStatus(ctx, status);
  }

  async gitWorkspaceStashList(sessionId: string, dest?: string) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest);
    return workspaceGitStashList(ctx.root);
  }

  async gitWorkspaceStash(
    sessionId: string,
    action: "push" | "pop" | "apply" | "drop",
    message?: string,
    index?: number,
    dest?: string,
  ) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest);
    const status = await workspaceGitStash(ctx.root, action, message, index);
    this.ports.hub.broadcast({ type: "workspace.changed", sessionId });
    return this.decorateGitStatus(ctx, status);
  }

  async gitWorkspaceHunks(sessionId: string, rel?: string, dest?: string) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest, rel);
    return workspaceGitHunks(ctx.root, rel ? relInGitDest(rel, ctx.dest) : undefined);
  }

  async gitWorkspaceStageHunk(sessionId: string, patch: string, unstage = false, dest?: string) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest);
    const status = await workspaceGitStageHunk(ctx.root, patch, unstage);
    this.ports.hub.broadcast({ type: "workspace.changed", sessionId });
    return this.decorateGitStatus(ctx, status);
  }

  async gitWorkspaceRebasePreview(sessionId: string, dest?: string) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest);
    return workspaceGitRebasePreview(ctx.root);
  }

  async gitWorkspaceRebase(
    sessionId: string,
    input: {
      onto?: string;
      todos: import("../workspace/workspaceGit.js").WorkspaceGitRebaseTodo[];
    },
    dest?: string,
  ) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest);
    const status = await workspaceGitRebase(ctx.root, input);
    this.ports.hub.broadcast({ type: "workspace.changed", sessionId });
    return this.decorateGitStatus(ctx, status);
  }

  async gitWorkspaceRebaseContinue(
    sessionId: string,
    action: "continue" | "abort" | "skip",
    dest?: string,
  ) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest);
    const status = await workspaceGitRebaseContinue(ctx.root, action);
    this.ports.hub.broadcast({ type: "workspace.changed", sessionId });
    return this.decorateGitStatus(ctx, status);
  }

  async gitWorkspacePullInfo(sessionId: string, dest?: string) {
    const ctx = await this.gitWorkspaceCtx(sessionId, dest);
    const ready = await this.ports.requireForge(ctx.session, {
      path: ctx.checkout?.dest,
      url: ctx.checkout?.url,
    });
    if ("output" in ready) {
      return { pull: null, error: ready.output, repoId: ctx.session.repoId };
    }
    const status = await workspaceGitStatus(ctx.root);
    const rows = await this.ports.forge.listPulls(ready.account, ready.owner, ready.repo, "open");
    const pull =
      rows.find(
        (row) => row.headRef === status.branch || row.headRef.endsWith(`/${status.branch}`),
      ) ?? null;
    const repos = await this.ports.store.loadRepos();
    const match = ctx.checkout?.url ? matchLinkedRepo(repos, ctx.checkout.url) : undefined;
    return {
      pull: pull
        ? { number: pull.number, title: pull.title, url: pull.url, headRef: pull.headRef }
        : null,
      repoId: match?.id ?? ctx.session.repoId ?? null,
      branch: status.branch,
    };
  }

  async fixWorkspace(
    sessionId: string,
    rel: string,
    content: string,
    line: number,
    character: number,
  ) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    return { items: fixWorkspaceFile({ root, rel, content, line, character }) };
  }

  async problemsWorkspace(sessionId: string, files: Array<{ path: string; content: string }>) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    return problemsWorkspaceFiles({
      root,
      files: files.map((file) => ({ rel: file.path, content: file.content })),
    });
  }

  async indentWorkspace(sessionId: string, rel: string) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    return indentFromEditorConfig(root, rel);
  }

  async debugWorkspace(sessionId: string) {
    await this.ports.require(sessionId);
    return debugState(sessionId);
  }

  async debugWorkspaceBreakpoints(
    sessionId: string,
    input: { path?: string; line?: number; breakpoints?: Array<{ path: string; line: number }> },
  ) {
    await this.ports.require(sessionId);
    if (input.breakpoints) return setDebugBreakpoints(sessionId, input.breakpoints);
    return toggleDebugBreakpoint(sessionId, input.path ?? "", input.line ?? 0);
  }

  async debugWorkspaceStart(sessionId: string, program: string) {
    const session = await this.ports.require(sessionId);
    const runtime = sessionRuntime(session);
    const kind = workspaceAccessKind(runtime, this.ports.isWorker(session));
    const root = this.ports.workspaceRoot(session);
    if (!root) throw new Error(WORKSPACE_UNSUPPORTED);
    if (kind === "unsupported" || !canLaunchWorkspaceDebug(kind)) {
      throw new Error(WORKSPACE_UNSUPPORTED);
    }
    const state = await startWorkspaceDebug({ sessionId, root, program });
    const note = workspaceDebugLaunchNote(kind, runtime);
    if (note && !state.error) return { ...state, error: note };
    return state;
  }

  async debugWorkspaceCommand(
    sessionId: string,
    action: "continue" | "stepOver" | "stepInto" | "stepOut" | "stop",
  ) {
    await this.ports.require(sessionId);
    return debugCommand(sessionId, action);
  }

  async debugWorkspaceStop(sessionId: string) {
    await this.ports.require(sessionId);
    return stopWorkspaceDebug(sessionId);
  }

  async ensureWorkspaceIndex(sessionId: string, force = false) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    const built = await buildWorkspaceIndex(root, {
      cacheDir: indexCacheDir(this.ports.store.dataDir, session.id),
      force,
    });
    this.ports.invalidateRepoMap(session.id);
    return {
      status: "ready" as const,
      fileCount: built.meta.fileCount,
      scanned: built.meta.fileCount,
      builtAt: built.meta.builtAt,
      truncated: built.meta.truncated,
      reused: built.stats.reused,
      read: built.stats.read,
    };
  }

  async peekWorkspaceIndex(sessionId: string) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    return (
      (await peekWorkspaceIndex(indexCacheDir(this.ports.store.dataDir, session.id))) ?? {
        status: "idle" as const,
        fileCount: 0,
        scanned: 0,
      }
    );
  }

  private async touchWorkspaceIndex(session: AgentSession, paths: string[]): Promise<void> {
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") return;
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    const rels = paths.map((path) => normalizeRepoPath(path)).filter(Boolean);
    if (!rels.length) return;
    try {
      await updateIndexPaths(root, indexCacheDir(this.ports.store.dataDir, session.id), rels);
      this.ports.invalidateRepoMap(session.id);
    } catch {
      /* index is best-effort */
    }
  }

  async deleteWorkspace(sessionId: string, rel: string) {
    const session = await this.ports.require(sessionId);
    const kind = workspaceAccessKind(sessionRuntime(session), this.ports.isWorker(session));
    if (kind === "unsupported") throw new Error(WORKSPACE_UNSUPPORTED);
    const root =
      kind === "host" ? this.ports.hostRoot(session) : this.ports.dockerWorkspaceRoot(session);
    const vm = session.vmId ? this.ports.getMachine(session.vmId) : undefined;
    const removed = await deleteWorkspaceAccess({
      kind,
      hasVm: Boolean(session.vmId),
      rel,
      deleteWorker: async () => {
        const client = await this.ports.requireWorker(session);
        return client.deleteWorkspace(session.vmId!, rel);
      },
      deleteGuest: () =>
        deleteGuestWorkspacePath(
          this.guestExecute(vm),
          rel,
          Boolean(vm && this.guestWorkspaceReady(vm)),
        ),
      deleteHost: () => deleteWorkspacePath(root, rel),
    });
    await this.touchWorkspaceIndex(session, [removed.path]);
    return removed;
  }

  private guestWorkspaceReady(vm: VmInstance): boolean {
    if (!isGuestReady(vm.status)) return false;
    if (vm.backendId) return true;
    if (!this.ports.guests.forVm(vm).liveGuest) return false;
    if (vm.runtime === "docker") return Boolean(vm.containerId);
    return true;
  }

  private guestExecute(vm: VmInstance | undefined): GuestWorkspaceExec | undefined {
    if (!vm) return undefined;
    const guest = this.ports.guests.forVm(vm);
    return (req) => guest.execute({ name: req.name as ComputerUseToolName, args: req.args });
  }

  private async listGuestWorkspace(vm: VmInstance | undefined, rel?: string) {
    return listGuestWorkspaceEntries(
      this.guestExecute(vm),
      rel,
      Boolean(vm && this.guestWorkspaceReady(vm)),
    );
  }

  private async readGuestWorkspace(vm: VmInstance | undefined, rel: string) {
    return readGuestWorkspaceFile(
      this.guestExecute(vm),
      rel,
      Boolean(vm && this.guestWorkspaceReady(vm)),
    );
  }

  private async writeGuestWorkspace(vm: VmInstance | undefined, rel: string, content: string) {
    await writeGuestWorkspaceFile(
      this.guestExecute(vm),
      rel,
      content,
      Boolean(vm && this.guestWorkspaceReady(vm)),
    );
  }
}
