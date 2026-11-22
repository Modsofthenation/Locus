import { WorkerCliDisconnectError } from "./workerCliConnection.js";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { AgentSession, ChatMessage, LocusConfig, PatchSessionInput } from "@locus/shared";
import {
  composePersonaInstructions,
  formatCursorOpsRoutingCard,
  foldCodingVerifyFlags,
  integrationsWithTokens,
  isAssetSession,
  isCanvasSession,
  isClaudeCodeProvider,
  isCodingLoopSession,
  isCodexCliProvider,
  isKiroCliProvider,
  isGenericCliProvider,
  isCursorCliProvider,
  isDesignSession,
  isGameSession,
  isReviewSession,
  isWindows,
  lastUserMessage,
  LINUX_WORKSPACE,
  WINDOWS_WORKSPACE,
  normalizeCodexCliModel,
  sessionRuntime,
  sessionWebSearch,
} from "@locus/shared";
import type { WorkerClient } from "@locus/worker";
import {
  frozenCursorCliExcludeTools,
  streamClaudeCode,
  streamCodexCli,
  streamCursorCli,
  streamKiroCli,
  streamGenericCli,
  formatProviderError,
  type ClaudeCodeSpawner,
  type CodexCliSpawner,
  type KiroCliSpawner,
  type GenericCliSpawner,
  type CodexMcpKind,
  type CursorCliSpawner,
  type CursorCliSpawnHandle,
  type CursorCliSpawnRequest,
  type CursorCloudEvent,
} from "@locus/providers";
import { workspaceReadinessNote } from "../core/hooks.js";
import { codexMcpPrompt, kiroMcpPrompt } from "../integrations/cliGitMcp.js";
import {
  controlPlaneMcpSessionUrl,
  controlPlaneMcpUrl,
  mergeClaudeMcpJson,
  mergeGeminiSettingsJson,
  mergeKiroMcpJson,
  mergeLocusMcpJson,
  writeLocusClaudeMcpConfig,
  writeLocusGeminiMcpConfig,
  writeLocusKiroMcpConfig,
  writeLocusCursorMcpConfig,
} from "../integrations/cursorCliMcp.js";
import { spawnCliOverSsh, type SshCliHandle, type SshTarget } from "@locus/guest-agent";
import {
  formatLocusCursorRule,
  LOCUS_CURSOR_RULE_REL,
  writeLocusCursorRule,
} from "../integrations/cursorCliRules.js";
import {
  calledFakeAssetPlaytest,
  calledHudOnlyGamePlaytest,
  calledPlaywright,
  wroteLiveCanvas,
} from "./agentTurn.js";
import { type CliTurnContinueInput, type CliTurnContinueResult } from "./cliTurnContinue.js";
import { llmResponseDetail, withWorkspaceReadiness } from "./sessionTurnHelpers.js";
import type { SessionTraceLog } from "./traces.js";
import { resolveCliSandbox, type CliSandbox, type CliSandboxPolicy } from "./cliSandbox.js";
import type { CliMcpGrant } from "../http/cliMcpGateway.js";

/** `generic` is a Custom CLI agent (provider kind `cli-agent`). */
export type HostCliKind = "cursor" | "claude" | "codex" | "kiro" | "generic";

export type HostCliTurnInput = {
  sessionId: string;
  userText: string;
  abort: AbortController;
  turnId: string;
  planTurn: boolean;
  stop: () => boolean;
  kind: HostCliKind;
};

export type HostCliTurnPorts = {
  require: (sessionId: string) => Promise<AgentSession>;
  loadConfig: () => Promise<LocusConfig>;
  dataDir: string;
  appendMessage: (sessionId: string, message: ChatMessage) => Promise<unknown>;
  patch: (sessionId: string, patch: Partial<AgentSession>) => Promise<unknown>;
  patchMeta: (sessionId: string, patch: PatchSessionInput) => Promise<AgentSession>;
  isWorkerSession: (session: AgentSession) => boolean;
  workspaceRoot: (session: AgentSession) => string | undefined;
  writeWorkspace: (sessionId: string, rel: string, body: string) => Promise<unknown>;
  cursorCliSpawner: () => CursorCliSpawner;
  claudeCodeSpawner: () => ClaudeCodeSpawner;
  codexCliSpawner: () => CodexCliSpawner;
  kiroCliSpawner: () => KiroCliSpawner;
  genericCliSpawner: () => GenericCliSpawner;
  requireWorker: (session: AgentSession) => Promise<WorkerClient>;
  spawnOnWorker: (
    client: WorkerClient,
    vmId: string,
    sessionId: string,
    req: CursorCliSpawnRequest,
  ) => CursorCliSpawnHandle;
  guestSsh?: (session: AgentSession) => Promise<SshTarget | undefined>;
  spawnOverSsh?: (
    target: SshTarget,
    req: CursorCliSpawnRequest,
    extra?: {
      reverseForwards?: { listenPort: number; hostPort: number }[];
      shell?: "posix" | "powershell";
    },
  ) => SshCliHandle;
  primeGameTurn: (sessionId: string, userText: string) => Promise<string>;
  snapshotStudioBaseline: (sessionId: string) => Promise<unknown>;
  primeAssetTurn: (sessionId: string, userText: string) => Promise<string>;
  primeDesignTurn: (sessionId: string) => Promise<string>;
  cursorCliAttachmentNote: (
    sessionId: string,
    workspace: string,
    user: ReturnType<typeof lastUserMessage>,
    promptText: string,
    worker: boolean,
  ) => Promise<string>;
  recordCursorCliContext: (sessionId: string, promptText: string) => Promise<void>;
  spawnAborts: Map<string, AbortController>;
  cliGitTurns: Map<string, AbortSignal>;
  traces: Pick<SessionTraceLog, "write">;
  appendThinking: (sessionId: string, messageId: string, text: string) => Promise<void>;
  clearThinking: (sessionId: string) => void;
  appendDelta: (sessionId: string, messageId: string, delta: string) => Promise<void>;
  applyCursorCliUsage: (
    sessionId: string,
    messageId: string,
    ev: {
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens?: number;
      cacheWriteTokens?: number;
      window?: number;
      contextTokens?: number;
    },
  ) => Promise<void>;
  upsertCursorToolCall: (
    sessionId: string,
    replyId: string,
    ev: Extract<CursorCloudEvent, { type: "tool_call" }>,
    turnId: string,
    round: number,
  ) => Promise<void>;
  applyCursorRunResult: (
    sessionId: string,
    replyId: string,
    ev: Extract<CursorCloudEvent, { type: "result" }>,
    sawText: boolean,
  ) => Promise<void>;
  hasSteerAfter: (sessionId: string, replyId: string) => Promise<boolean>;
  continueAfterCliRound: (input: CliTurnContinueInput) => Promise<CliTurnContinueResult>;
  now: () => string;
  /**
   * Filesystem sandbox for a CLI spawned on this machine for a Docker session.
   * `undefined` means the operator opted out (`LOCUS_CLI_SANDBOX=off`). Defaults to
   * bubblewrap / sandbox-exec via {@link resolveCliSandbox}.
   */
  cliSandbox?: (policy: CliSandboxPolicy) => CliSandbox | undefined;
  /**
   * A token-gated, session-scoped MCP URL on the CLI MCP gateway. A sandboxed CLI gets this
   * instead of the control-plane URL, because the sandbox only forwards the gateway port.
   */
  cliMcpGrant?: (sessionId: string) => Promise<CliMcpGrant>;
};

const LABELS: Record<
  HostCliKind,
  { missing: string; vm: string; workspace: string; worker: string }
> = {
  cursor: {
    missing: "Cursor CLI provider is not configured. Enable it in Settings → Providers.",
    vm: "Cursor CLI on a VM needs a running guest with SSH.",
    workspace: "Cursor CLI needs a workspace folder on this machine.",
    worker:
      "Cursor CLI on a worker needs a running Docker, Host, or Linux VM guest. Start it first.",
  },
  claude: {
    missing: "Claude Code provider is not configured. Enable it in Settings → Providers.",
    vm: "Claude Code on a VM needs a running guest with SSH.",
    workspace: "Claude Code needs a workspace folder on this machine.",
    worker:
      "Claude Code on a worker needs a running Docker, Host, or Linux VM guest. Start it first.",
  },
  kiro: {
    missing: "Kiro CLI provider is not configured. Enable it in Settings → Providers.",
    vm: "Kiro CLI on a VM needs a running guest with SSH.",
    workspace: "Kiro CLI needs a workspace folder on this machine.",
    worker: "Kiro CLI on a worker needs a running Docker, Host, or Linux VM guest. Start it first.",
  },
  codex: {
    missing: "Codex CLI provider is not configured. Enable it in Settings → Providers.",
    vm: "Codex CLI on a VM needs a running guest with SSH.",
    workspace: "Codex CLI needs a workspace folder on this machine.",
    worker:
      "Codex CLI on a worker needs a running Docker, Host, or Linux VM guest. Start it first.",
  },
  generic: {
    missing: "Custom CLI agent provider is not configured. Enable it in Settings → Providers.",
    vm: "Custom CLI agent on a VM needs a running guest with SSH.",
    workspace: "Custom CLI agent needs a workspace folder on this machine.",
    worker:
      "Custom CLI agent on a worker needs a running Docker, Host, or Linux VM guest. Start it first.",
  },
};

/** Gemini CLI presets read Locus MCP from `.gemini/settings.json`; other CLI agents skip it. */
function wantsGeminiMcp(provider: { cli?: { preset?: string } }): boolean {
  return provider.cli?.preset === "gemini" || provider.cli?.preset === "gemini-acp";
}

/** One Host CLI Turn stream loop. Cursor / Claude / Codex / Kiro are adapters. */
export async function runHostCliTurn(
  ports: HostCliTurnPorts,
  input: HostCliTurnInput,
): Promise<string> {
  const cleanup: (() => void)[] = [];
  try {
    return await hostCliTurn(ports, input, cleanup);
  } finally {
    for (const done of cleanup) done();
  }
}

async function hostCliTurn(
  ports: HostCliTurnPorts,
  input: HostCliTurnInput,
  cleanup: (() => void)[],
): Promise<string> {
  let session = await ports.require(input.sessionId);
  const config = await ports.loadConfig();
  const provider = config.providers.find((p) => p.id === session.providerId);
  const kind = input.kind;
  const isProvider =
    kind === "cursor"
      ? Boolean(provider && isCursorCliProvider(provider))
      : kind === "claude"
        ? Boolean(provider && isClaudeCodeProvider(provider))
        : kind === "kiro"
          ? Boolean(provider && isKiroCliProvider(provider))
          : kind === "generic"
            ? Boolean(provider && isGenericCliProvider(provider))
            : Boolean(provider && isCodexCliProvider(provider));
  const labels = LABELS[kind];
  if (!provider || !isProvider) {
    await ports.appendMessage(input.sessionId, {
      id: randomUUID(),
      role: "system",
      content: labels.missing,
      createdAt: ports.now(),
    });
    return "";
  }
  if (kind === "codex") {
    const canonicalModel = normalizeCodexCliModel(session.model);
    if (canonicalModel && canonicalModel !== session.model) {
      session = await ports.patchMeta(input.sessionId, { model: canonicalModel });
    }
  }
  const worker = ports.isWorkerSession(session);
  const localVm = sessionRuntime(session) === "vm" && !worker;
  const ssh = localVm ? await ports.guestSsh?.(session) : undefined;
  if (localVm && !ssh) {
    await ports.appendMessage(input.sessionId, {
      id: randomUUID(),
      role: "system",
      content: labels.vm,
      createdAt: ports.now(),
    });
    return "";
  }
  const workspace = worker
    ? "/workspace"
    : localVm
      ? isWindows(session.os)
        ? WINDOWS_WORKSPACE
        : LINUX_WORKSPACE
      : ports.workspaceRoot(session);
  if (!workspace) {
    await ports.appendMessage(input.sessionId, {
      id: randomUUID(),
      role: "system",
      content: labels.workspace,
      createdAt: ports.now(),
    });
    return "";
  }
  const cursorRule =
    kind === "cursor"
      ? {
          review: isReviewSession(session),
          design: isCanvasSession(session) && !isGameSession(session) && !isAssetSession(session),
          game: isGameSession(session),
          assets: isAssetSession(session),
          coding: !input.planTurn && isCodingLoopSession(session),
          instructions: composePersonaInstructions(session.instructions, session.persona, {
            surface: session.surface,
          }),
          playbook: session.playbook,
        }
      : undefined;
  // A Docker session's CLI runs on this machine, but the operator chose a container. Its
  // own shell tool must not see <LOCUS_HOME> (config, other sessions, attachments, traces)
  // or reach the control plane, which trusts loopback clients as the operator. It gets a
  // session-scoped MCP URL on the gateway, the one host loopback port the sandbox forwards.
  // Host-runtime sessions are host access by design and stay unsandboxed.
  let sandbox: CliSandbox | undefined;
  let mcpSessionUrl = controlPlaneMcpSessionUrl(session.id, config.advanced.bindPort);
  if (!worker && !localVm && sessionRuntime(session) === "docker") {
    const grant = await ports.cliMcpGrant?.(session.id);
    if (grant) cleanup.push(grant.revoke);
    sandbox = (ports.cliSandbox ?? resolveCliSandbox)({
      locusHome: ports.dataDir,
      workspace,
      loopbackPorts: grant ? [grant.port] : [],
    });
    if (sandbox && !sandbox.ok) {
      await ports.appendMessage(input.sessionId, {
        id: randomUUID(),
        role: "system",
        content: sandbox.reason,
        createdAt: ports.now(),
      });
      return "";
    }
    if (sandbox && grant) mcpSessionUrl = grant.url;
  }
  // A local VM's CLI runs in the guest, and its SSH connection reverse-forwards a guest
  // loopback port back to this machine. ssh connects from 127.0.0.1, so forwarding to the
  // control plane would make the guest the local operator (`/api/*`, other sessions'
  // transcripts). Forward to the gateway instead, with a per-turn token. The guest keeps
  // listening on <bindPort> so its URL keeps the same shape.
  let vmForwards: { listenPort: number; hostPort: number }[] = [];
  if (localVm) {
    const grant = await ports.cliMcpGrant?.(session.id);
    if (grant) {
      cleanup.push(grant.revoke);
      const guestPort = config.advanced.bindPort || 7420;
      const guestUrl = new URL(grant.url);
      guestUrl.hostname = "127.0.0.1";
      guestUrl.port = String(guestPort);
      mcpSessionUrl = guestUrl.toString();
      vmForwards = [{ listenPort: guestPort, hostPort: grant.port }];
    }
  }
  if (localVm) {
    await writeGuestCliMcp(
      ports,
      input.sessionId,
      kind === "generic" && !wantsGeminiMcp(provider) ? undefined : kind,
      mcpSessionUrl,
    );
    if (kind === "cursor" && cursorRule) {
      const body = formatLocusCursorRule(cursorRule);
      if (body) await ports.writeWorkspace(input.sessionId, LOCUS_CURSOR_RULE_REL, body);
    }
  } else if (!worker) {
    await mkdir(workspace, { recursive: true });
    if (kind === "cursor" && cursorRule) {
      await writeLocusCursorMcpConfig({
        dataDir: ports.dataDir,
        workspace,
        url: controlPlaneMcpUrl(config.advanced.bindPort),
        workspaceUrl: mcpSessionUrl,
      });
      await writeLocusCursorRule({ workspace, ...cursorRule });
    }
    if (kind === "claude") {
      await writeLocusClaudeMcpConfig({
        workspace,
        url: mcpSessionUrl,
      });
    }
    if (kind === "kiro") {
      await writeLocusKiroMcpConfig({
        workspace,
        url: mcpSessionUrl,
      });
    }
    if (kind === "generic" && wantsGeminiMcp(provider)) {
      await writeLocusGeminiMcpConfig({ workspace, url: mcpSessionUrl });
    }
  } else if (cursorRule) {
    const body = formatLocusCursorRule(cursorRule);
    if (body) {
      await ports.writeWorkspace(input.sessionId, LOCUS_CURSOR_RULE_REL, body);
    }
  }
  const readiness =
    worker || kind === "cursor" ? undefined : await workspaceReadinessNote(workspace);
  let spawnFn: ReturnType<
    | HostCliTurnPorts["cursorCliSpawner"]
    | HostCliTurnPorts["claudeCodeSpawner"]
    | HostCliTurnPorts["kiroCliSpawner"]
    | HostCliTurnPorts["codexCliSpawner"]
    | HostCliTurnPorts["genericCliSpawner"]
  >;
  if (worker) {
    if (!session.vmId) {
      await ports.appendMessage(input.sessionId, {
        id: randomUUID(),
        role: "system",
        content: labels.worker,
        createdAt: ports.now(),
      });
      return "";
    }
    const client = await ports.requireWorker(session);
    const vmId = session.vmId;
    spawnFn = (req) => ports.spawnOnWorker(client, vmId, session.id, req);
  } else if (localVm && ssh) {
    const overSsh = ports.spawnOverSsh ?? spawnCliOverSsh;
    spawnFn = (req) =>
      overSsh(
        ssh,
        { ...req, cwd: isWindows(session.os) ? WINDOWS_WORKSPACE : LINUX_WORKSPACE },
        {
          // Never the control-plane port. Without a gateway grant, nothing is forwarded.
          reverseForwards: vmForwards,
          shell: isWindows(session.os) ? "powershell" : "posix",
        },
      );
  } else {
    spawnFn =
      kind === "cursor"
        ? ports.cursorCliSpawner()
        : kind === "claude"
          ? ports.claudeCodeSpawner()
          : kind === "kiro"
            ? ports.kiroCliSpawner()
            : kind === "generic"
              ? ports.genericCliSpawner()
              : ports.codexCliSpawner();
    if (sandbox?.ok) spawnFn = sandbox.wrap(spawnFn);
  }
  const reviewing = isReviewSession(session);
  const mcpKind: CodexMcpKind = reviewing ? "review" : isCanvasSession(session) ? "canvas" : "git";
  const gitMcpUrl =
    (kind === "codex" || kind === "kiro") && !input.planTurn ? mcpSessionUrl : undefined;
  let promptText =
    kind === "cursor" ? input.userText : withWorkspaceReadiness(input.userText, readiness);
  const first =
    kind === "cursor"
      ? !session.cursorCli?.sessionId
      : kind === "claude"
        ? !session.claudeCode?.sessionId
        : kind === "kiro"
          ? !session.kiroCli?.sessionId
          : kind === "generic"
            ? !session.genericCli?.sessionId
            : !session.codexCli?.sessionId;
  const designing = isCanvasSession(session);
  const excludeTools =
    kind === "cursor"
      ? frozenCursorCliExcludeTools({
          frozen: session.cursorCli?.excludeTools,
          webSearch: sessionWebSearch(session) && !input.planTurn,
          review: reviewing,
        })
      : undefined;
  if (kind === "cursor" && first) {
    const card = formatCursorOpsRoutingCard({
      prompt: input.userText,
      connected: integrationsWithTokens(config.integrations).map((row) => row.kind),
      hostToolsViaMcp: true,
    });
    if (card) promptText = `${card}\n\n${promptText}`;
  }
  const plainPromptKind =
    kind === "claude" || kind === "codex" || kind === "kiro" || kind === "generic";
  if (plainPromptKind && first && session.instructions?.trim()) {
    promptText = `${session.instructions.trim()}\n\n${promptText}`;
  }
  if (plainPromptKind && first && session.playbook?.trim()) {
    promptText = `${promptText}\n\nPlaybook:\n${session.playbook.trim()}`;
  }
  if (!input.planTurn && isGameSession(session)) {
    promptText = `${await ports.primeGameTurn(input.sessionId, input.userText)}\n\n${promptText}`;
  } else if (!input.planTurn && isAssetSession(session)) {
    await ports.snapshotStudioBaseline(input.sessionId);
    promptText = `${await ports.primeAssetTurn(input.sessionId, input.userText)}\n\n${promptText}`;
  } else if (!input.planTurn && isDesignSession(session)) {
    promptText = `${await ports.primeDesignTurn(input.sessionId)}\n\n${promptText}`;
  }
  let lastReplyId = "";
  let reviewVerdictNudges = 0;
  let canvasNudges = 0;
  let canvasIncompleteNudges = 0;
  let gameWipeNudges = 0;
  let gameUnplayableNudges = 0;
  let gamePlaywrightNudges = 0;
  let designMutateNudges = 0;
  let unusedLinkedAssetNudges = 0;
  let searchWanderNudges = 0;
  let verifyNudges = 0;
  let opsRoutingNudges = 0;
  let reviewRoutingNudges = 0;
  let selfCorrects = 0;
  let mutatedThisTurn = false;
  let verifiedThisTurn = false;
  let designQualityNudges = 0;
  let gameJuiceNudges = 0;
  let assetSculptNudges = 0;
  let adherenceNudges = 0;
  let wroteCanvasThisTurn = false;
  let calledPlaywrightThisTurn = false;
  for (let round = 0; round < 32; round++) {
    if (input.abort.signal.aborted) break;
    const replyId = randomUUID();
    lastReplyId = replyId;
    await ports.appendMessage(input.sessionId, {
      id: replyId,
      role: "assistant",
      content: "",
      createdAt: ports.now(),
    });
    const current = await ports.require(input.sessionId);
    const user = lastUserMessage(current.messages);
    promptText = `${promptText}${await ports.cursorCliAttachmentNote(
      input.sessionId,
      workspace,
      user,
      promptText,
      worker,
    )}`;
    const priorThread =
      kind === "codex" ? current.codexCli : kind === "kiro" ? current.kiroCli : undefined;
    // A resumed thread already holds these instructions; resending them every turn and every
    // nudge round only adds input tokens.
    const sendMcpPrompt =
      (kind === "codex" || kind === "kiro") &&
      Boolean(gitMcpUrl) &&
      !(priorThread?.sessionId && priorThread.mcpPrompt === mcpKind);
    const cliPrompt =
      sendMcpPrompt && kind === "codex"
        ? `${codexMcpPrompt(mcpKind)}\n\n${promptText}`
        : sendMcpPrompt && kind === "kiro"
          ? `${kiroMcpPrompt(mcpKind)}\n\n${promptText}`
          : promptText;
    await ports.recordCursorCliContext(input.sessionId, cliPrompt);
    let sawText = false;
    let sawUsage = false;
    const spawnAbort = new AbortController();
    ports.spawnAborts.set(input.sessionId, spawnAbort);
    const onTurnAbort = () => spawnAbort.abort();
    input.abort.signal.addEventListener("abort", onTurnAbort);
    if ((kind === "codex" || kind === "kiro") && gitMcpUrl && mcpKind !== "review") {
      ports.cliGitTurns.set(input.sessionId, spawnAbort.signal);
    }
    const resume =
      kind === "cursor"
        ? current.cursorCli?.sessionId
        : kind === "claude"
          ? current.claudeCode?.sessionId
          : kind === "kiro"
            ? current.kiroCli?.sessionId
            : kind === "generic"
              ? current.genericCli?.sessionId
              : current.codexCli?.sessionId;
    const streamDefault =
      kind === "cursor"
        ? "cursor-cli"
        : kind === "claude"
          ? "claude-code"
          : kind === "kiro"
            ? "kiro-cli"
            : kind === "generic"
              ? "cli-agent"
              : "codex-cli";
    try {
      await ports.traces.write({
        t: ports.now(),
        kind: "llm.request",
        sessionId: input.sessionId,
        turnId: input.turnId,
        round,
        name: current.model,
        detail: resume || streamDefault,
        ...(kind === "cursor"
          ? {}
          : {
              args: {
                mode: input.planTurn ? "plan" : "agent",
                reasoningEffort: current.reasoningEffort ?? "default",
                resumed: Boolean(resume),
                locusGit: Boolean(gitMcpUrl),
              },
            }),
      });
      const stream =
        kind === "cursor"
          ? streamCursorCli({
              provider,
              prompt: promptText,
              workspace,
              model: current.model,
              resume,
              mode: input.planTurn ? "plan" : "agent",
              webSearch: sessionWebSearch(current) && !input.planTurn,
              review: reviewing,
              excludeTools,
              signal: spawnAbort.signal,
              spawnFn,
            })
          : kind === "claude"
            ? streamClaudeCode({
                provider,
                prompt: promptText,
                workspace,
                model: current.model,
                resume,
                mode: input.planTurn ? "plan" : "agent",
                webSearch: sessionWebSearch(current) && !input.planTurn,
                review: reviewing,
                signal: spawnAbort.signal,
                spawnFn,
              })
            : kind === "kiro"
              ? streamKiroCli({
                  provider,
                  prompt: cliPrompt,
                  workspace,
                  model: current.model,
                  resume,
                  mode: input.planTurn ? "plan" : "agent",
                  webSearch: sessionWebSearch(current) && !input.planTurn,
                  review: reviewing,
                  gitMcpUrl,
                  signal: spawnAbort.signal,
                  spawnFn,
                })
              : kind === "generic"
                ? streamGenericCli({
                    provider,
                    prompt: promptText,
                    workspace,
                    model: current.model,
                    resume,
                    // ACP agents get the session MCP URL on session/new. On a worker,
                    // 127.0.0.1 is the worker host, so the URL is withheld there.
                    mcpUrl: worker ? undefined : mcpSessionUrl,
                    signal: spawnAbort.signal,
                    spawnFn,
                  })
                : streamCodexCli({
                    provider,
                    prompt: cliPrompt,
                    workspace,
                    model: current.model,
                    reasoningEffort: current.reasoningEffort,
                    resume,
                    mode: input.planTurn ? "plan" : "agent",
                    webSearch: sessionWebSearch(current) && !input.planTurn,
                    review: reviewing,
                    gitMcpUrl,
                    mcpKind,
                    signal: spawnAbort.signal,
                    spawnFn,
                  });
      for await (const ev of stream) {
        if (input.abort.signal.aborted) break;
        if (ev.type === "session" && ev.sessionId) {
          if (kind === "cursor") {
            await ports.patch(input.sessionId, {
              cursorCli: { sessionId: ev.sessionId, excludeTools },
            });
          } else if (kind === "claude") {
            await ports.patch(input.sessionId, { claudeCode: { sessionId: ev.sessionId } });
          } else if (kind === "kiro") {
            await ports.patch(input.sessionId, {
              kiroCli: cliThreadState(ev.sessionId, priorThread, sendMcpPrompt, mcpKind),
            });
          } else if (kind === "generic") {
            await ports.patch(input.sessionId, { genericCli: { sessionId: ev.sessionId } });
          } else {
            await ports.patch(input.sessionId, {
              codexCli: cliThreadState(ev.sessionId, priorThread, sendMcpPrompt, mcpKind),
            });
          }
        }
        if (ev.type === "reasoning" && "text" in ev && ev.text) {
          await ports.appendThinking(input.sessionId, replyId, ev.text);
        }
        if (ev.type === "text" && "text" in ev && ev.text) {
          sawText = true;
          ports.clearThinking(input.sessionId);
          await ports.appendDelta(input.sessionId, replyId, ev.text);
        }
        if (ev.type === "usage") {
          sawUsage = true;
          await ports.applyCursorCliUsage(input.sessionId, replyId, ev);
        }
        if (ev.type === "tool_call") {
          await ports.upsertCursorToolCall(input.sessionId, replyId, ev, input.turnId, round);
        }
        if (ev.type === "error" && "message" in ev) {
          await ports.appendDelta(input.sessionId, replyId, `\n\n${ev.message}`);
        }
        if (ev.type === "result") {
          if ("usage" in ev && ev.usage && !sawUsage) {
            sawUsage = true;
            await ports.applyCursorCliUsage(input.sessionId, replyId, ev.usage);
          }
          await ports.applyCursorRunResult(input.sessionId, replyId, ev, sawText);
        }
      }
    } catch (err) {
      if (err instanceof WorkerCliDisconnectError) throw err;
      const steered = await ports.hasSteerAfter(input.sessionId, replyId);
      if (!input.abort.signal.aborted && !steered && !spawnAbort.signal.aborted) {
        await ports.appendDelta(input.sessionId, replyId, `\n\n${formatProviderError(err)}`);
      }
    } finally {
      if (
        (kind === "codex" || kind === "kiro") &&
        ports.cliGitTurns.get(input.sessionId) === spawnAbort.signal
      ) {
        ports.cliGitTurns.delete(input.sessionId);
      }
      if (kind === "codex") spawnAbort.abort();
      input.abort.signal.removeEventListener("abort", onTurnAbort);
      if (ports.spawnAborts.get(input.sessionId) === spawnAbort) {
        ports.spawnAborts.delete(input.sessionId);
      }
      ports.clearThinking(input.sessionId);
    }
    const afterCli = await ports.require(input.sessionId);
    const reply = afterCli.messages.find((m) => m.id === replyId);
    const spawnCalls = reply?.toolCalls ?? [];
    ({ mutated: mutatedThisTurn, verified: verifiedThisTurn } = foldCodingVerifyFlags(spawnCalls, {
      mutated: mutatedThisTurn,
      verified: verifiedThisTurn,
    }));
    if (wroteLiveCanvas(spawnCalls)) wroteCanvasThisTurn = true;
    if (
      calledPlaywright(spawnCalls) &&
      !(isAssetSession(afterCli) && calledFakeAssetPlaytest(spawnCalls)) &&
      !(isGameSession(afterCli) && calledHudOnlyGamePlaytest(spawnCalls))
    ) {
      calledPlaywrightThisTurn = true;
    }
    await ports.traces.write({
      t: ports.now(),
      kind: "llm.response",
      sessionId: input.sessionId,
      turnId: input.turnId,
      round,
      name: current.model,
      detail: llmResponseDetail(reply, reply?.toolCalls),
      ...(kind === "cursor"
        ? {}
        : {
            inputTokens: reply?.usage?.inputTokens,
            outputTokens: reply?.usage?.outputTokens,
            args: {
              reasoningEffort: current.reasoningEffort ?? "default",
              cachedInputTokens: reply?.usage?.cachedInputTokens,
            },
          }),
    });
    const cont = await ports.continueAfterCliRound({
      sessionId: input.sessionId,
      replyId,
      abort: input.abort,
      turnId: input.turnId,
      round,
      planTurn: input.planTurn,
      designing,
      reviewing,
      canvasNudges,
      canvasIncompleteNudges,
      reviewVerdictNudges,
      gameWipeNudges,
      gameUnplayableNudges,
      gamePlaywrightNudges,
      designMutateNudges,
      unusedLinkedAssetNudges,
      searchWanderNudges,
      verifyNudges,
      opsRoutingNudges,
      reviewRoutingNudges,
      selfCorrects,
      mutatedThisTurn,
      verifiedThisTurn,
      designQualityNudges,
      gameJuiceNudges,
      assetSculptNudges,
      adherenceNudges,
      wroteCanvasThisTurn,
      calledPlaywrightThisTurn,
      messages: afterCli.messages,
      traceNudges: kind === "cursor" || kind === "kiro",
    });
    if (cont.stop) break;
    promptText = cont.prompt;
    canvasNudges = cont.canvasNudges;
    canvasIncompleteNudges = cont.canvasIncompleteNudges;
    reviewVerdictNudges = cont.reviewVerdictNudges;
    gameWipeNudges = cont.gameWipeNudges;
    gameUnplayableNudges = cont.gameUnplayableNudges;
    gamePlaywrightNudges = cont.gamePlaywrightNudges;
    designMutateNudges = cont.designMutateNudges;
    unusedLinkedAssetNudges = cont.unusedLinkedAssetNudges;
    searchWanderNudges = cont.searchWanderNudges;
    verifyNudges = cont.verifyNudges;
    opsRoutingNudges = cont.opsRoutingNudges;
    reviewRoutingNudges = cont.reviewRoutingNudges;
    selfCorrects = cont.selfCorrects;
    designQualityNudges = cont.designQualityNudges;
    gameJuiceNudges = cont.gameJuiceNudges;
    assetSculptNudges = cont.assetSculptNudges;
    adherenceNudges = cont.adherenceNudges;
    wroteCanvasThisTurn = cont.wroteCanvasThisTurn;
  }
  return lastReplyId;
}

/** Record which MCP instructions a Codex / Kiro thread has seen, so resumes skip them. */
export function cliThreadState(
  sessionId: string,
  prior: { sessionId?: string; mcpPrompt?: string } | undefined,
  sentMcpPrompt: boolean,
  mcpKind: string,
): { sessionId: string; mcpPrompt?: string } {
  if (sentMcpPrompt) return { sessionId, mcpPrompt: mcpKind };
  // Same thread resumed: keep what it already saw. A new thread id means it saw nothing.
  if (prior?.sessionId === sessionId && prior.mcpPrompt) {
    return { sessionId, mcpPrompt: prior.mcpPrompt };
  }
  return { sessionId };
}

async function writeGuestCliMcp(
  ports: Pick<HostCliTurnPorts, "writeWorkspace">,
  sessionId: string,
  /** `generic` here means a Gemini preset; other Custom CLI agents pass undefined. */
  kind: HostCliKind | undefined,
  url: string,
): Promise<void> {
  const body = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  if (!kind) return;
  if (kind === "generic") {
    await ports.writeWorkspace(
      sessionId,
      ".gemini/settings.json",
      body(mergeGeminiSettingsJson({}, url)),
    );
    return;
  }
  if (kind === "cursor") {
    await ports.writeWorkspace(sessionId, ".cursor/mcp.json", body(mergeLocusMcpJson({}, url)));
    return;
  }
  if (kind === "claude") {
    await ports.writeWorkspace(sessionId, ".mcp.json", body(mergeClaudeMcpJson({}, url)));
    return;
  }
  if (kind === "kiro") {
    await ports.writeWorkspace(
      sessionId,
      ".kiro/settings/mcp.json",
      body(mergeKiroMcpJson({}, url)),
    );
  }
}
