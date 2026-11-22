/**
 * Parallel agents: one task on 2–8 Host **Agents** (one git worktree and branch each) or up
 * to four Docker agents (one container each), and the group's Board, Compare diffs, Verify,
 * Merge, Discard, and Rank, plus the New agent fan-out that creates the base agent first.
 * Creating, setting up, and removing a single agent's worktree stays with the agent
 * lifecycle in `SessionService`.
 */
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AgentSession,
  ChatMessage,
  CreateSessionInput,
  GoldenImage,
  PatchSessionInput,
  RepoCheckout,
  WorkerAttempt,
  WorkerBoardRow,
  WorkerRanking,
} from "@locus/shared";
import {
  composePersonaInstructions,
  diffFilePaths,
  diffStatFromPatch,
  estimateUsd,
  isCanvasSession,
  isReviewSession,
  lastCheckRuns,
  lastUserPrompt,
  latestWorkerVerdict,
  outOfScopeFiles,
  parseWorkerCount,
  parseWorktreeAgents,
  redactText,
  resolveUsageRates,
  sessionRuntime,
  WORKER_COUNT_DEFAULT,
  WORKER_COUNT_MIN,
  WORKER_GROUP_MAX,
  workerBranchName,
  workerPlaybook,
  worktreeWorkerPlaybook,
} from "@locus/shared";
import type { DockerEngine } from "@locus/hypervisor";
import type { ToolRequest, ToolResult } from "@locus/guest-agent";
import type { JsonStore } from "../core/store.js";
import { configSecretValues } from "../core/redact.js";
import { loadWorkspaceVerifyPlan, runWorkspaceVerify } from "../core/verify.js";
import { brainDistillerProvider } from "../brain/distiller.js";
import {
  commitAll,
  gitToplevel,
  mergeBranchInto,
  worktreeDiff,
  worktreeStatus,
} from "../workspace/gitWorktree.js";
import { rankWorkerAttempts, type WorkerRankComplete } from "./workerRank.js";

function now(): string {
  return new Date().toISOString();
}

/** What parallel agents need from `SessionService`. */
export type ParallelWorkerPorts = {
  require: (sessionId: string) => Promise<AgentSession>;
  get: (sessionId: string) => Promise<AgentSession | undefined>;
  isWorkerSession: (session: { placement?: AgentSession["placement"] }) => boolean;
  sessionCheckoutHostRoot: (session: AgentSession, checkout?: RepoCheckout) => string | undefined;
  create: (
    input: CreateSessionInput,
    opts?: { waitUntilStarted?: boolean },
  ) => Promise<AgentSession>;
  remove: (sessionId: string, opts?: { discardBranch?: boolean }) => Promise<void>;
  patchMeta: (id: string, patch: PatchSessionInput) => Promise<AgentSession>;
  appendMessage: (sessionId: string, message: ChatMessage) => Promise<AgentSession>;
  sendChat: (sessionId: string, content: string) => Promise<unknown>;
  abortChat: (sessionId: string) => Promise<void>;
  executeTool: (
    sessionId: string,
    req: ToolRequest,
    opts?: { ignoreAllowlist?: boolean },
  ) => Promise<ToolResult>;
  captureImage: (sessionId: string, name: string) => Promise<GoldenImage>;
  startVm: (sessionId: string) => Promise<unknown>;
  stopVm: (sessionId: string) => Promise<void>;
  docker: Pick<DockerEngine, "get" | "restoreWorkspace">;
  store: Pick<JsonStore, "dataDir" | "loadConfig" | "loadSessions">;
  chatEngine: WorkerRankComplete;
};

/** Spawn, Board, Compare, Verify, Merge, Discard, and Rank for a parallel agents group. */
export class ParallelWorkers {
  /** Attempts whose worktree checks are running; turns, merges, and deletes wait. */
  private verifyingAttempts = new Set<string>();

  constructor(private readonly ports: ParallelWorkerPorts) {}

  async spawnWorkers(
    sessionId: string,
    input: { count?: unknown; prompt?: string; models?: unknown; agents?: unknown } = {},
  ): Promise<AgentSession[]> {
    const session = await this.ports.require(sessionId);
    if (sessionRuntime(session) === "host" && !this.ports.isWorkerSession(session)) {
      return this.spawnWorktreeWorkers(session, input);
    }
    if (sessionRuntime(session) !== "docker") {
      throw new Error(
        "Parallel workers need a Host agent on a git checkout (one worktree each) or a Docker agent.",
      );
    }
    if (isCanvasSession(session))
      throw new Error("Workers are for coding agents, not Design or Games");
    if (isReviewSession(session)) throw new Error("Workers are for coding agents, not reviews");
    if (session.compare) throw new Error("Finish the current compare or workers first");
    const agents = parseWorktreeAgents(input.agents);
    const count = agents.length
      ? parseWorkerCount(agents.length)
      : parseWorkerCount(input.count ?? WORKER_COUNT_DEFAULT);
    if (!count) throw new Error("Spawn 2, 3, or 4 Docker workers");
    const prompt = input.prompt?.trim() || lastUserPrompt(session.messages);
    if (!prompt) throw new Error("Send a prompt first");
    const models = Array.isArray(input.models)
      ? input.models
          .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
          .map((item) => item.trim())
      : [];
    let imageId = session.imageId;
    if (session.vmId) {
      const image = await this.ports.captureImage(sessionId, `${session.title} workers`);
      imageId = image.id;
    }
    if (!imageId) throw new Error("Start the container before spawning workers");
    const hardware = session.hardware
      ? {
          cpuCores: session.hardware.cpuCores,
          memoryMb: session.hardware.memoryMb,
          diskSizeGb: session.hardware.diskSizeGb,
        }
      : undefined;
    const created: AgentSession[] = [];
    for (let i = 1; i <= count; i += 1) {
      const role = String(i);
      const branch = workerBranchName(role);
      created.push(
        await this.ports.create({
          title: `${session.title} · ${i}`,
          os: session.os,
          templateId: session.templateId,
          runtime: "docker",
          dockerImage: session.dockerImage,
          providerId: agents[i - 1]?.providerId || session.providerId,
          model: agents[i - 1]?.model || models[i - 1] || session.model,
          reasoningEffort: agents[i - 1]?.reasoningEffort ?? session.reasoningEffort,
          repo: session.repo,
          repoId: session.repoId,
          extraRepos: session.extraRepos,
          extraRepoIds: session.extraRepoIds,
          hardware,
          imageId,
          instructions: composePersonaInstructions(session.instructions, session.persona, {
            surface: session.surface,
          }),
          playbook: [session.playbook, workerPlaybook(role, count)].filter(Boolean).join("\n"),
          allowedTools: session.allowedTools,
          network: session.network,
          vision: session.vision,
          webSearch: session.webSearch,
          startVm: true,
        }),
      );
      await this.ports
        .executeTool(
          created[i - 1]!.id,
          { name: "git_branch", args: { name: branch } },
          { ignoreAllowlist: true },
        )
        .catch(() => undefined);
    }
    const groupId = randomUUID();
    const memberIds = created.map((row) => row.id);
    const linked: AgentSession[] = [];
    for (const [index, child] of created.entries()) {
      const role = String(index + 1);
      linked.push(
        await this.ports.patchMeta(child.id, {
          compare: {
            groupId,
            kind: "workers",
            role,
            memberIds,
            parentId: sessionId,
            branch: workerBranchName(role),
          },
        }),
      );
    }
    await this.ports.patchMeta(sessionId, {
      compare: {
        groupId,
        kind: "workers",
        role: "parent",
        memberIds,
      },
    });
    await Promise.allSettled(linked.map((child) => this.ports.sendChat(child.id, prompt)));
    return Promise.all(linked.map((child) => this.ports.require(child.id)));
  }

  async workerDiffs(
    sessionId: string,
  ): Promise<Array<{ id: string; role: string; branch?: string; diff: string }>> {
    const session = await this.ports.require(sessionId);
    const members =
      session.compare?.kind === "workers"
        ? (session.compare.memberIds ?? [sessionId])
        : session.compare?.peerId
          ? [sessionId, session.compare.peerId]
          : [sessionId];
    const sessions = await this.ports.store.loadSessions();
    const rows = members
      .map((id) => sessions.find((row) => row.id === id))
      .filter((row): row is AgentSession => Boolean(row));
    const out: Array<{ id: string; role: string; branch?: string; diff: string }> = [];
    for (const member of rows) {
      let diff = "";
      try {
        if (member.worktree) {
          diff = await worktreeDiff(member.worktree, 20_000);
        } else {
          const result = await this.ports.executeTool(
            member.id,
            { name: "git_diff", args: {} },
            { ignoreAllowlist: true },
          );
          diff = result.output.slice(0, 20_000);
        }
      } catch (err) {
        diff = err instanceof Error ? err.message : "diff failed";
      }
      out.push({
        id: member.id,
        role: member.compare?.role ?? "?",
        branch: member.compare?.branch,
        diff,
      });
    }
    return out;
  }

  async mergeWorker(sessionId: string, workerId: string): Promise<AgentSession> {
    this.assertAttemptNotVerifying(workerId);
    const worker = await this.ports.require(workerId);
    const parentId = worker.compare?.parentId || sessionId;
    if (parentId === workerId) throw new Error("Pick a worker to merge into the parent");
    const parent = await this.ports.require(parentId);
    if (worker.worktree) return this.mergeWorktreeWorker(parent, worker);
    if (sessionRuntime(parent) !== "docker" || sessionRuntime(worker) !== "docker") {
      throw new Error("Worker merge is Docker-only");
    }
    const src = worker.vmId
      ? this.ports.docker.get(worker.vmId)?.diskPath
      : join(this.ports.store.dataDir, "docker-workspaces", worker.id);
    const destVm = parent.vmId ? this.ports.docker.get(parent.vmId) : undefined;
    if (!src || !destVm) throw new Error("Start both containers before merging");
    const restart = destVm.status === "running" || destVm.status === "ready";
    if (restart) await this.ports.stopVm(parent.id).catch(() => undefined);
    await this.ports.docker.restoreWorkspace?.(destVm.id, src);
    if (restart) await this.ports.startVm(parent.id).catch(() => undefined);
    await this.ports.appendMessage(parent.id, {
      id: randomUUID(),
      role: "system",
      content: `Merged worker ${worker.compare?.role ?? worker.title} (${worker.compare?.branch ?? "branch"}) into this workspace.`,
      createdAt: now(),
    });
    return this.ports.require(parent.id);
  }

  /** Host fan-out: one git worktree + branch per agent, each on its own provider / model / CLI. */
  private async spawnWorktreeWorkers(
    parent: AgentSession,
    input: { count?: unknown; prompt?: string; models?: unknown; agents?: unknown },
  ): Promise<AgentSession[]> {
    if (isCanvasSession(parent))
      throw new Error("Workers are for coding agents, not Design or Games");
    if (isReviewSession(parent)) throw new Error("Workers are for coding agents, not reviews");
    if (parent.compare) throw new Error("Finish the current compare or workers first");
    const config = await this.ports.store.loadConfig();
    let agents = parseWorktreeAgents(input.agents);
    if (!agents.length) {
      const count = parseWorkerCount(input.count ?? WORKER_COUNT_DEFAULT);
      if (!count) throw new Error("Spawn 2, 3, or 4 workers");
      const models = Array.isArray(input.models)
        ? input.models.filter((m): m is string => typeof m === "string" && Boolean(m.trim()))
        : [];
      agents = Array.from({ length: count }, (_, i) => ({
        providerId: parent.providerId,
        model: models[i]?.trim() || parent.model,
        ...(parent.reasoningEffort ? { reasoningEffort: parent.reasoningEffort } : {}),
      }));
    }
    if (agents.length < WORKER_COUNT_MIN || agents.length > WORKER_GROUP_MAX) {
      throw new Error(`Pick ${WORKER_COUNT_MIN}–${WORKER_GROUP_MAX} agents`);
    }
    for (const agent of agents) {
      const provider = config.providers.find((row) => row.id === agent.providerId);
      if (!provider) throw new Error(`Unknown provider ${agent.providerId}`);
    }
    const prompt = input.prompt?.trim() || lastUserPrompt(parent.messages);
    if (!prompt) throw new Error("Send a prompt first");
    const root = this.ports.sessionCheckoutHostRoot(parent, parent.repo);
    if (!root || !(await gitToplevel(root))) {
      throw new Error(
        "Parallel Host agents need a git checkout. Open a git folder or link a repo, then try again.",
      );
    }
    const created: AgentSession[] = [];
    try {
      for (const [index, agent] of agents.entries()) {
        const provider = config.providers.find((row) => row.id === agent.providerId)!;
        const role = String(index + 1);
        created.push(
          await this.ports.create({
            title: `${parent.title} · ${role} ${provider.name}`,
            os: parent.os,
            templateId: parent.templateId,
            runtime: "host",
            worktreeFrom: parent.id,
            providerId: agent.providerId,
            model: agent.model,
            reasoningEffort: agent.reasoningEffort,
            repo: parent.repo,
            repoId: parent.repoId,
            instructions: composePersonaInstructions(parent.instructions, parent.persona, {
              surface: parent.surface,
            }),
            playbook: parent.playbook,
            allowedTools: parent.allowedTools,
            network: parent.network,
            webSearch: parent.webSearch,
            autonomy: parent.autonomy,
            maxUsd: parent.maxUsd,
            maxMs: parent.maxMs,
            surface: parent.surface,
            startVm: false,
          }),
        );
      }
    } catch (err) {
      for (const row of created)
        await this.ports.remove(row.id, { discardBranch: true }).catch(() => undefined);
      throw err;
    }
    const groupId = randomUUID();
    const memberIds = created.map((row) => row.id);
    const linked: AgentSession[] = [];
    for (const [index, child] of created.entries()) {
      const role = String(index + 1);
      const branch = child.worktree?.branch;
      linked.push(
        await this.ports.patchMeta(child.id, {
          playbook: [
            parent.playbook,
            branch ? worktreeWorkerPlaybook(branch, role, created.length) : "",
          ]
            .filter(Boolean)
            .join("\n"),
          compare: {
            groupId,
            kind: "workers",
            role,
            memberIds,
            parentId: parent.id,
            ...(branch ? { branch } : {}),
          },
        }),
      );
    }
    await this.ports.patchMeta(parent.id, {
      compare: { groupId, kind: "workers", role: "parent", memberIds },
    });
    await Promise.allSettled(linked.map((child) => this.ports.sendChat(child.id, prompt)));
    return Promise.all(linked.map((child) => this.ports.require(child.id)));
  }

  /** Commit the worker's worktree, then `git merge --no-ff` its branch into the parent checkout. */
  private async mergeWorktreeWorker(
    parent: AgentSession,
    worker: AgentSession,
  ): Promise<AgentSession> {
    const wt = worker.worktree!;
    if (worker.status === "running")
      throw new Error("Stop this agent or let it finish before merging");
    const target =
      sessionRuntime(parent) === "host" && !this.ports.isWorkerSession(parent)
        ? await gitToplevel(this.ports.sessionCheckoutHostRoot(parent, parent.repo) ?? "")
        : undefined;
    if (!target)
      throw new Error("The parent agent has no git checkout on this machine to merge into");
    const committed = await commitAll(wt.path, `Locus: ${worker.title}`);
    const result = await mergeBranchInto(target, wt.branch, `Merge ${wt.branch} (${worker.title})`);
    if (!result.ok) throw new Error(result.message);
    await this.ports.appendMessage(parent.id, {
      id: randomUUID(),
      role: "system",
      content: `Merged ${wt.branch} from ${worker.title} into ${target}${committed ? " (committed its pending changes first)" : ""}. ${result.summary}`,
      createdAt: now(),
    });
    return this.ports.require(parent.id);
  }

  /** Stop a parallel agent, delete its worktree and branch, and drop the session. */
  async discardWorker(workerId: string): Promise<void> {
    const worker = await this.ports.require(workerId);
    if (!worker.compare || worker.compare.role === "parent") {
      throw new Error("Pick one of the parallel agents to discard");
    }
    await this.ports.abortChat(workerId).catch(() => undefined);
    await this.ports.remove(workerId, { discardBranch: true });
  }

  /** One row per parallel agent: status, branch, diffstat against its base, commits, dirty files. */
  async workerBoard(sessionId: string): Promise<WorkerBoardRow[]> {
    const session = await this.ports.require(sessionId);
    const ids =
      session.compare?.kind === "workers"
        ? (session.compare.memberIds ?? [])
        : session.compare?.peerId
          ? [sessionId, session.compare.peerId]
          : [];
    const [sessions, config] = await Promise.all([
      this.ports.store.loadSessions(),
      this.ports.store.loadConfig(),
    ]);
    const rows = ids
      .map((id) => sessions.find((row) => row.id === id))
      .filter((row): row is AgentSession => Boolean(row));
    return Promise.all(
      rows.map(async (member): Promise<WorkerBoardRow> => {
        const { tests, lint, typecheck } = lastCheckRuns(member.messages);
        const verdict = latestWorkerVerdict(member, sessions)?.verdict;
        const usd = member.usage
          ? estimateUsd(
              member.usage,
              resolveUsageRates(
                config.providers.find((row) => row.id === member.providerId),
                member.model,
              ),
            )
          : undefined;
        const base: WorkerBoardRow = {
          id: member.id,
          title: member.title,
          role: member.compare?.role ?? "?",
          status: member.status,
          providerId: member.providerId,
          model: member.model,
          branch: member.worktree?.branch ?? member.compare?.branch,
          worktreePath: member.worktree?.path,
          stat: { files: 0, insertions: 0, deletions: 0 },
          commits: 0,
          dirty: 0,
          ...(member.error ? { error: member.error } : {}),
          tests: tests.state,
          lint: lint.state,
          typecheck: typecheck.state,
          ...(verdict ? { verdict } : {}),
          ...(tests.command ? { testCommand: tests.command } : {}),
          ...(typeof usd === "number" ? { usd } : {}),
        };
        try {
          if (member.worktree) {
            const status = await worktreeStatus(member.worktree);
            return {
              ...base,
              stat: status.stat,
              commits: status.commits,
              dirty: status.dirty,
              files: status.paths,
            };
          }
          const result = await this.ports.executeTool(
            member.id,
            { name: "git_diff", args: {} },
            { ignoreAllowlist: true },
          );
          const stat = diffStatFromPatch(result.output);
          return { ...base, stat, dirty: stat.files, files: diffFilePaths(result.output) };
        } catch (err) {
          return {
            ...base,
            error: base.error ?? (err instanceof Error ? err.message : String(err)),
          };
        }
      }),
    );
  }

  assertAttemptNotVerifying(id: string): void {
    if (this.verifyingAttempts.has(id)) throw new Error("Wait for attempt verification to finish");
  }

  async verifyWorkers(sessionId: string): Promise<import("@locus/shared").WorkerVerification[]> {
    const session = await this.ports.require(sessionId);
    if (session.compare?.kind !== "workers") throw new Error("Open a parallel agent group");
    const members = await Promise.all(
      (session.compare.memberIds ?? []).map((id) => this.ports.get(id)),
    );
    const attempts = members.filter((member): member is AgentSession => Boolean(member));
    if (attempts.some((member) => member.status === "running")) {
      throw new Error("Wait for every attempt to finish before verifying");
    }
    const eligible = attempts.filter(
      (member) =>
        member.worktree && sessionRuntime(member) === "host" && !this.ports.isWorkerSession(member),
    );
    for (const member of eligible) this.assertAttemptNotVerifying(member.id);
    for (const member of eligible) this.verifyingAttempts.add(member.id);
    try {
      const source = eligible[0]?.worktree?.source;
      const plan = source ? await loadWorkspaceVerifyPlan(source) : undefined;
      const secrets = configSecretValues(await this.ports.store.loadConfig());
      const results: import("@locus/shared").WorkerVerification[] = [];
      for (const member of attempts) {
        const worktree = member.worktree;
        if (!eligible.includes(member) || !worktree || worktree.source !== source) {
          results.push({
            id: member.id,
            checks: [],
            reason: "Requires a Host worktree from the shared checkout",
          });
          continue;
        }
        const checks: import("@locus/shared").WorkerVerification["checks"] = [];
        for (const step of ["test", "lint", "typecheck"] as const) {
          const result = await runWorkspaceVerify(worktree.path, step, { full: true, plan });
          checks.push({
            step,
            status:
              !result.ran || result.failureKind === "missing-toolchain"
                ? "skipped"
                : result.ok
                  ? "passed"
                  : "failed",
            command: result.command,
            output: result.output ? redactText(result.output, secrets) : undefined,
            failedTests: result.failedTests?.map((test) => redactText(test, secrets)),
          });
        }
        results.push({ id: member.id, checks });
      }
      return results;
    } finally {
      for (const member of eligible) this.verifyingAttempts.delete(member.id);
    }
  }

  /**
   * Order a parallel group's attempts best-first: evidence (tests, lint/typecheck, files
   * outside the task scope) first; the configured API model breaks ties and explains.
   */
  async rankWorkers(sessionId: string): Promise<WorkerRanking> {
    const [board, diffs, config, sessions] = await Promise.all([
      this.workerBoard(sessionId),
      this.workerDiffs(sessionId),
      this.ports.store.loadConfig(),
      this.ports.store.loadSessions(),
    ]);
    const diffById = new Map(diffs.map((row) => [row.id, row.diff]));
    const members = board
      .map((row) => sessions.find((s) => s.id === row.id))
      .filter((row): row is AgentSession => Boolean(row));
    const task =
      members
        .flatMap((row) => row.messages)
        .find((m) => m.role === "user" && !m.hidden && m.content.trim())
        ?.content.trim() ?? "";
    const attempts: WorkerAttempt[] = board.map((row) => ({
      id: row.id,
      role: row.role,
      model: row.model,
      status: row.status,
      stat: row.stat,
      tests: row.tests,
      lint: row.lint,
      typecheck: row.typecheck,
      outOfScope: outOfScopeFiles(row.files ?? [], task),
      usd: row.usd,
      error: row.error,
      diff: diffById.get(row.id) ?? "",
    }));
    return rankWorkerAttempts({
      task,
      attempts,
      picked: brainDistillerProvider(config),
      complete: (req) => this.ports.chatEngine(req),
    });
  }

  /**
   * New-agent fan-out: create a base agent (no prompt), then run `prompt` on each agent spec
   * in its own worktree (Host) or container (Docker).
   */
  async fanout(input: {
    create: CreateSessionInput;
    agents: unknown;
    prompt: string;
  }): Promise<{ parent: AgentSession; workers: AgentSession[] }> {
    const prompt = input.prompt?.trim();
    if (!prompt) throw new Error("Write a prompt to send to every agent");
    const agents = parseWorktreeAgents(input.agents);
    if (agents.length < WORKER_COUNT_MIN)
      throw new Error(`Pick at least ${WORKER_COUNT_MIN} agents`);
    const first = agents[0]!;
    const parent = await this.ports.create(
      {
        ...input.create,
        providerId: input.create.providerId || first.providerId,
        model: input.create.model || first.model,
        prompt: undefined,
        worktree: false,
        worktreeFrom: undefined,
      },
      { waitUntilStarted: true },
    );
    try {
      const runtime = sessionRuntime(parent);
      if (runtime !== "docker" && runtime !== "host") {
        throw new Error("Parallel agents run on Host (one git worktree each) or Docker");
      }
      const workers = await this.spawnWorkers(parent.id, { agents, prompt });
      return { parent: await this.ports.require(parent.id), workers };
    } catch (err) {
      await this.ports.appendMessage(parent.id, {
        id: randomUUID(),
        role: "system",
        content: `Parallel agents did not start: ${err instanceof Error ? err.message : String(err)}`,
        createdAt: now(),
      });
      throw err;
    }
  }
}
