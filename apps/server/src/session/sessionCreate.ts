import { randomUUID } from "node:crypto";
import type {
  AgentSession,
  AssetStyle,
  GameStyle,
  CreateSessionInput,
  DesignSystem,
  GuestOs,
  LinkedRepo,
  LocusConfig,
  SessionPersona,
} from "@locus/shared";
import {
  attachLinkedCheckouts,
  assignSessionCloneDests,
  BOARD_CHAT_TOOLS,
  BOARD_PLAYBOOK,
  composeReviewPlaybook,
  DEFAULT_DESIGN_PALETTE,
  DESIGN_DOCKER_IMAGE,
  DESIGN_PLAYBOOK,
  DESIGN_TOOLS,
  GAME_PLAYBOOK,
  GAME_TOOLS,
  ASSET_PLAYBOOK,
  ASSET_TOOLS,
  isAgentRole,
  isAutonomyTier,
  isClaudeCodeProvider,
  isCodexCliProvider,
  isKiroCliProvider,
  isCursorCliProvider,
  isCursorProvider,
  isWindows,
  normalizeCodexCliModel,
  parseAgentPlacement,
  parseDesignPalette,
  resolveAssetBuild,
  parseDockerImage,
  parseSessionPersona,
  parseSessionPull,
  parseSessionSlack,
  parseAssetRefIds,
  parseToolAllowlist,
  placementAllowsRuntime,
  PROJECT_CHAT_TOOLS,
  PROJECT_PLAYBOOK,
  resolveDesignSystem,
  resolveGameKit,
  resolveAssetKit,
  resolveAssetStyle,
  resolveGameStyle,
  REVIEW_TOOLS,
  sessionKind,
  sessionRepoState,
  sessionRuntime,
  titleFromCreateInput,
} from "@locus/shared";
import { workspacePath } from "../core/guests.js";

export function persistSessionKind(kind: ReturnType<typeof sessionKind>): AgentSession["kind"] {
  return kind === "agent" ? undefined : kind;
}

export type PreparedCreate = {
  input: CreateSessionInput;
  kind: ReturnType<typeof sessionKind>;
  runtime: ReturnType<typeof sessionRuntime>;
  placement: ReturnType<typeof parseAgentPlacement>;
  backendId: string;
  cursorCloud: boolean;
  cursorCli: boolean;
  claudeCode: boolean;
  codexCli: boolean;
  kiroCli: boolean;
};

/** Kind, repo, placement, and provider invariants for a new Agent. */
export function prepareCreateInput(
  raw: CreateSessionInput,
  ctx: {
    config: LocusConfig;
    repos: LinkedRepo[];
    designSystems: DesignSystem[];
    assetStyles?: AssetStyle[];
    gameStyles?: GameStyle[];
  },
): PreparedCreate {
  let input = raw;
  const createProvider = ctx.config.providers.find((p) => p.id === input.providerId) ?? {};
  const cursorCloud = isCursorProvider(createProvider);
  const cursorCli = isCursorCliProvider(createProvider);
  const claudeCode = isClaudeCodeProvider(createProvider);
  const codexCli = isCodexCliProvider(createProvider);
  const kiroCli = isKiroCliProvider(createProvider);
  if (codexCli && input.model) {
    input = { ...input, model: normalizeCodexCliModel(input.model) };
  }
  const kind = sessionKind(input);
  if (kind === "design" || kind === "game" || kind === "assets") {
    const label = kind === "game" ? "Game" : kind === "assets" ? "Assets" : "Design";
    if (input.runtime === "vm") throw new Error(`${label} sessions run on Host or Docker`);
    if (isWindows(input.os)) throw new Error(`${label} sessions are Linux-only`);
    const canvasRuntime = input.runtime === "host" ? "host" : "docker";
    const requestedSystemId = input.designSystemId?.trim() || ctx.config.defaultDesignSystemId;
    const system =
      kind === "design" ? resolveDesignSystem(requestedSystemId, ctx.designSystems) : undefined;
    const gameKit = kind === "game" ? resolveGameKit(input.designSystemId) : undefined;
    const assetKit = kind === "assets" ? resolveAssetKit(input.designSystemId) : undefined;
    const requestedStyleId = input.assetStyleId?.trim() || ctx.config.defaultAssetStyleId;
    const assetStyle =
      kind === "assets" ? resolveAssetStyle(requestedStyleId, ctx.assetStyles ?? []) : undefined;
    const requestedGameStyleId = input.gameStyleId?.trim() || ctx.config.defaultGameStyleId;
    const gameStyle =
      kind === "game" ? resolveGameStyle(requestedGameStyleId, ctx.gameStyles ?? []) : undefined;
    const assetIds = kind === "game" ? parseAssetRefIds(input.assetIds) : [];
    input = {
      ...input,
      kind,
      runtime: canvasRuntime,
      dockerImage:
        canvasRuntime === "docker"
          ? parseDockerImage(input.dockerImage ?? "") || DESIGN_DOCKER_IMAGE
          : undefined,
      startVm: canvasRuntime === "host" ? Boolean(input.placement === "worker") : input.startVm,
      vision: input.vision ?? "off",
      playbook:
        input.playbook?.trim() ||
        (kind === "game" ? GAME_PLAYBOOK : kind === "assets" ? ASSET_PLAYBOOK : DESIGN_PLAYBOOK),
      allowedTools: (input.allowedTools?.length
        ? input.allowedTools
        : kind === "game"
          ? GAME_TOOLS
          : kind === "assets"
            ? ASSET_TOOLS
            : DESIGN_TOOLS
      ).filter((name) => canvasRuntime !== "host" || name !== "record_screen"),
      palette:
        parseDesignPalette(input.palette) ??
        system?.palette ??
        assetStyle?.palette ??
        gameStyle?.palette ??
        DEFAULT_DESIGN_PALETTE,
      designSystemId: kind === "design" ? system?.id : kind === "game" ? gameKit?.id : assetKit?.id,
      assetStyleId: kind === "assets" ? assetStyle?.id : undefined,
      gameStyleId: kind === "game" ? gameStyle?.id : undefined,
      assetBuild: kind === "assets" ? resolveAssetBuild(input.assetBuild) : undefined,
      assetIds: assetIds.length ? assetIds : undefined,
    };
  }
  if (kind === "review") {
    if (input.runtime === "host") throw new Error("PR reviews run in a VM or Docker container.");
    if (isWindows(input.os)) throw new Error("Review sessions are Linux-only");
    input = {
      ...input,
      kind: "review",
      runtime: input.runtime === "vm" ? "vm" : "docker",
      dockerImage:
        input.runtime === "vm"
          ? undefined
          : parseDockerImage(input.dockerImage ?? "") || "locus/node",
      allowedTools: input.allowedTools?.length ? input.allowedTools : REVIEW_TOOLS,
    };
  }
  if (kind === "ide") {
    input = {
      ...input,
      kind: "ide",
      runtime: "host",
      vision: "off",
      startVm: false,
    };
  }
  if (kind === "board") {
    input = {
      ...input,
      kind: "board",
      runtime: "host",
      vision: "off",
      startVm: false,
      playbook: input.playbook?.trim() || BOARD_PLAYBOOK,
      allowedTools: input.allowedTools?.length ? input.allowedTools : BOARD_CHAT_TOOLS,
      webSearch: input.webSearch !== false,
    };
  }
  if (kind === "project") {
    input = {
      ...input,
      kind: "project",
      runtime: "host",
      vision: "off",
      startVm: false,
      playbook: input.playbook?.trim() || PROJECT_PLAYBOOK,
      allowedTools: input.allowedTools?.length ? input.allowedTools : PROJECT_CHAT_TOOLS,
      webSearch: input.webSearch !== false,
    };
  }
  const attached = attachLinkedCheckouts(ctx.repos, {
    repo: input.repo,
    repoId: input.repoId,
    extraRepos: input.extraRepos,
    extraRepoIds: input.extraRepoIds,
  });
  if (kind === "design" || kind === "game" || kind === "assets") {
    input = {
      ...input,
      repo: attached.repo,
      repoId: attached.repoId,
      extraRepos: undefined,
      extraRepoIds: undefined,
    };
  } else {
    const destRuntime = sessionRuntime(input);
    input = {
      ...input,
      ...assignSessionCloneDests(
        attached,
        workspacePath(input.os, destRuntime).replace(/\\/g, "/"),
      ),
    };
  }
  if (kind === "review" && attached.repoId) {
    const linked = ctx.repos.find((row) => row.id === attached.repoId);
    input = {
      ...input,
      playbook: composeReviewPlaybook(input.playbook, linked?.reviewPrompt),
    };
  }
  const runtime = sessionRuntime(input);
  const placement = parseAgentPlacement(input.placement);
  const backendId =
    placement === "worker" && typeof input.backendId === "string" ? input.backendId.trim() : "";
  if ((cursorCli || claudeCode || codexCli || kiroCli) && runtime === "vm") {
    throw new Error(
      cursorCli
        ? "Cursor CLI needs Docker or Host so it can see the workspace folder."
        : claudeCode
          ? "Claude Code needs Docker or Host so it can see the workspace folder."
          : kiroCli
            ? "Kiro CLI needs Docker or Host so it can see the workspace folder."
            : "Codex CLI needs Docker or Host so it can see the workspace folder.",
    );
  }
  if (placement === "worker") {
    if (!placementAllowsRuntime(placement, runtime)) {
      throw new Error("Workers run Docker or Host");
    }
    const worker = (ctx.config.workers ?? []).find((row) => row.id === backendId);
    if (!worker) throw new Error("Pick a worker in Settings → Workers");
    if (!worker.token?.trim()) throw new Error("Add a worker token in Settings → Workers");
  }
  return {
    input,
    kind,
    runtime,
    placement,
    backendId,
    cursorCloud,
    cursorCli,
    claudeCode,
    codexCli,
    kiroCli,
  };
}

export function sessionCreateBase(
  input: CreateSessionInput,
  opts: {
    id?: string;
    now: string;
    os: GuestOs;
    templateId: string;
    kind: ReturnType<typeof sessionKind>;
    runtime?: AgentSession["runtime"];
    placement?: AgentSession["placement"];
    backendId?: string;
    allowedTools?: AgentSession["allowedTools"];
    vision?: AgentSession["vision"];
    status: AgentSession["status"];
    titleRuntime?: AgentSession["runtime"];
    dockerImage?: string;
    instanceSize?: AgentSession["instanceSize"];
    network?: AgentSession["network"];
    imageId?: AgentSession["imageId"];
    palette?: AgentSession["palette"];
    designSystemId?: AgentSession["designSystemId"];
    assetStyleId?: AgentSession["assetStyleId"];
    gameStyleId?: AgentSession["gameStyleId"];
    parentSessionId?: AgentSession["parentSessionId"];
    assetBuild?: AgentSession["assetBuild"];
    assetAppliedBuild?: AgentSession["assetAppliedBuild"];
    hostDir?: AgentSession["hostDir"];
    hardware?: AgentSession["hardware"];
    guestEnv?: AgentSession["guestEnv"];
    boardId?: AgentSession["boardId"];
    projectId?: AgentSession["projectId"];
    surface?: AgentSession["surface"];
    persona?: SessionPersona;
    reasoningEffort?: AgentSession["reasoningEffort"];
  },
) {
  const titleInput = {
    ...input,
    os: opts.os,
    ...(opts.titleRuntime ? { runtime: opts.titleRuntime } : {}),
    ...(opts.dockerImage ? { dockerImage: opts.dockerImage } : {}),
  };
  const persona = opts.persona ?? parseSessionPersona(input.persona);
  return {
    id: opts.id ?? randomUUID(),
    title: titleFromCreateInput(titleInput),
    os: opts.os,
    templateId: opts.templateId,
    kind: persistSessionKind(opts.kind),
    runtime: opts.runtime,
    placement: opts.placement,
    backendId: opts.backendId,
    dockerImage: opts.dockerImage,
    instanceSize: opts.instanceSize,
    providerId: input.providerId,
    model: input.model,
    reasoningEffort: opts.reasoningEffort ?? input.reasoningEffort,
    ...sessionRepoState(input),
    sourceDesignId: input.sourceDesignId,
    promotedAgentId: input.promotedAgentId,
    pull: parseSessionPull(input.pull),
    hardware: opts.hardware,
    imageId: opts.imageId,
    instructions: input.instructions,
    playbook: input.playbook?.trim() || undefined,
    allowedTools: opts.allowedTools,
    branchLock: input.branchLock === true ? true : undefined,
    network: opts.network,
    vision: opts.vision,
    webSearch: input.webSearch === true ? true : undefined,
    liveChrome: input.liveChrome === true ? true : undefined,
    palette: opts.palette,
    designSystemId: opts.designSystemId,
    assetStyleId: opts.assetStyleId,
    gameStyleId: opts.gameStyleId,
    parentSessionId: opts.parentSessionId ?? input.parentSessionId,
    assetBuild: opts.assetBuild,
    assetAppliedBuild: opts.assetAppliedBuild ?? opts.assetBuild,
    role: isAgentRole(input.role) ? input.role : undefined,
    guestEnv: opts.guestEnv ?? input.guestEnv,
    maxUsd: input.maxUsd,
    maxMs: input.maxMs,
    autonomy: isAutonomyTier(input.autonomy) ? input.autonomy : undefined,
    hostDir: opts.hostDir,
    status: opts.status,
    messages: [] as AgentSession["messages"],
    automationId: input.automationId,
    automationRunId: input.automationRunId,
    persistMemory: input.persistMemory === true ? true : undefined,
    allowedMcpTools: input.automationId ? (input.allowedMcpTools ?? []) : input.allowedMcpTools,
    allowHosts: input.allowHosts,
    slack: parseSessionSlack(input.slack),
    boardId: opts.boardId ?? input.boardId,
    projectId: opts.projectId ?? input.projectId,
    surface: opts.surface,
    persona,
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}

export function hostCreateAllowlist(
  os: GuestOs,
  allowedTools: string[] | undefined,
): AgentSession["allowedTools"] {
  return allowedTools?.length ? parseToolAllowlist(os, allowedTools, "host") : undefined;
}

export function dockerCreateAllowlist(
  os: GuestOs,
  allowedTools: string[] | undefined,
): AgentSession["allowedTools"] {
  return allowedTools?.length ? parseToolAllowlist(os, allowedTools, "docker") : undefined;
}
