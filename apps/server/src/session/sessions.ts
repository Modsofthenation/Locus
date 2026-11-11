import { mkdir, rm, readFile, cp, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AgentSession,
  ApprovalPolicy,
  ChatAttachment,
  ChatImage,
  ChatMessage,
  ComputerUseToolName,
  CreateSessionInput,
  GoldenImage,
  LocusConfig,
  PatchSessionInput,
  IncomingAttachmentData,
  SessionCheckpoint,
  TaskItem,
  TeamEventKind,
  ToolCall,
  VisionMode,
  VmInstance,
  WorkerBackend,
} from "@locus/shared";
import {
  isCanvasSession,
  isCodingLoopSession,
  isDesignSession,
  isGameSession,
  isAssetSession,
  resolveGameKit,
  resolveAssetKit,
  isReviewSession,
  isProjectToolName,
  isProjectSession,
  isGuestReady,
  isHumanDriving,
  isMutatingBrowserTool,
  isOperatorDrivingBrowser,
  OPERATOR_HAS_BROWSER,
  LOCUS_CHROME_PROFILE_DIR,
  isLocusAgentImage,
  isWindows,
  lastUserPrompt,
  compareSessionsForList,
  lastUserMessage,
  turnUserPrompt,
  isCursorProvider,
  isCursorCliProvider,
  isClaudeCodeProvider,
  isCodexCliProvider,
  isKiroCliProvider,
  isCodexReasoningEffort,
  normalizeCodexCliModel,
  cursorGithubRepoUrl,
  parseGithubPullUrl,
  parseDockerImage,
  parseOwnerRepo,
  parseRepoUrl,
  parseToolAllowlist,
  parseSessionCompare,
  parseWorkerCount,
  parseSessionPreview,
  parseDesignPalette,
  parseDesignTune,
  resolveAssetBuild,
  applyDesignTune,
  designTokenCssVars,
  enforceDesignAdherence,
  formatAdherenceNudge,
  DESIGN_ADHERENCE_NEEDS_HUMAN,
  resolveDesignPalette,
  redactText,
  parseGitCloneProgress,
  gitCloneAuthFailureHint,
  sameCloneProgressDetail,
  cloneStartProgress,
  cloneDoneProgress,
  type CloneProgress,
  imageBuildStartNote,
  imageBuildDoneNote,
  sameImageBuildProgress,
  type ImageBuildProgress,
  stripSensitiveListing,
  wrapHostileToolOutput,
  canonicalToolCall,
  toolResultForCall,
  INTERRUPTED_TURN_NOTE,
  CANCELLED_TURN_NOTE,
  resolveVmHardware,
  sessionKind,
  sessionRuntime,
  isWorkflowToolName,
  isIdeSession,
  applyPromptTitle,
  sessionPlacement,
  hostChromeProfileDir,
  sessionLiveChrome,
  workerDestroyOnStop,
  workerIdleTtlMs,
  workerMaxConcurrent,
  workerComputeUsd,
  sessionComputeMs,
  workerImageAllowed,
  workerProvisionsCompute,
  workerPickSize,
  runtimeNeedsGuest,
  toolsForRuntime,
  configuredToolsForRuntime,
  validateHardwareOverride,
  addUsage,
  overlayFromTool,
  toolNeedsApproval,
  execArgCommands,
  installCommandsNeedApproval,
  toolNeedsGuest,
  defaultNetworkJail,
  isNetworkJail,
  jailNetworking,
  forgeProviderAllowlist,
  compactMessages,
  foldOldTurns,
  appendThinkingText,
  formatThinkingSnippet,
  messageChars,
  formatLlmCompactNote,
  buildLlmCompactUserPrompt,
  shouldAttemptLlmCompact,
  LLM_COMPACT_SYSTEM,
  slimToolContent,
  stubLargeWriteArgs,
  repoMapPromptQuery,
  fileMentions,
  patchFilesFromTool,
  normalizeRepoPath,
  sessionVision,
  sessionWebSearch,
  isVisionMode,
  imageRuntime,
  rewindTargets,
  applyCheckpointWorkingState,
  canClearChat,
  clearSessionConversation,
  agentRoundLimit,
  DEFAULT_CHARS_PER_TOKEN,
  modelContextWindow,
  reservedOutputTokens,
  contextBudget,
  estimateTokensFromChars,
  occupancyFromCursorCliUsage,
  buildContextBreakdown,
  calibrateCharsPerToken,
  collectPromptContextParts,
  toolCatalogChars,
  isMcpToolName,
  isMcpMetaToolName,
  MCP_LIST_TOOLS_NAME,
  MCP_GET_TOOL_INFO_NAME,
  MCP_CALL_NAME,
  MCP_CODE_NAME,
  parseMcpCallArguments,
  isAskUserToolName,
  guestToolResultPath,
  shouldOffloadToolResult,
  formatOffloadedResult,
  OFFLOAD_RESULT_CHARS,
  planFromAssistant,
  planFromTurnTasks,
  planFromCursorToolCalls,
  planFromCursorCreatePlan,
  shouldFinishCursorPlanTurn,
  isCursorCreatePlanTool,
  tasksTrackedThisTurn,
  advancePlanOnTool,
  isPlanStepStatus,
  isPlanReadTool,
  hooksForTool,
  formatCompactNotice,
  stickyAllowEntry,
  alwaysAskMinusSticky,
  policyRejectsCreate,
  policyForcedJail,
  policyAllowsAutonomous,
  policyAllowsLiveChrome,
  providerAllowedByPolicy,
  parseStartProcessPid,
  backgroundPollCommand,
  backgroundKillCommand,
  parseBackgroundPoll,
  PROCESS_DONE_NUDGE,
  chatInputError,
  normalizePromptQueue,
  dropLandedQueueItems,
  pendingPromptQueue,
  guestBootTimeoutMs,
  approvalTimeoutMs,
  promptQueueLimit,
  MAX_CHECKPOINTS,
  DESIGN_CANVAS_PATH,
  DESIGN_REPO_CONTEXT_DIR,
  DESIGN_REPO_CONTEXT_PATH,
  PROJECT_MEMBER_TOOLS,
  DEFAULT_DESIGN_PALETTE,
  DOCKER_WORKSPACE,
  guessListenPorts,
  pickPreviewPort,
  sanitizePreviewPath,
  DEFAULT_DOCKER_IMAGE,
  WORKER_COUNT_DEFAULT,
  workerBranchName,
  workerPlaybook,
  isWorkerLockPath,
  parseApprovalPolicy,
  resolveUsageRates,
  parseGitStatusBranch,
  cleanGitHeadName,
  nextAgentRole,
  rolePlaybook,
  isAgentRole,
  composePersonaInstructions,
  isCoordinatorHubRole,
  sessionDisplayName,
  parseSessionSurface,
  parseProductMode,
  surfaceForProductMode,
  isSwarmTeamToolName,
  shouldWakeGroupChatRequester,
  parseSkillCommand,
  formatSkillPrompt,
  formatSkillCatalog,
  mergeSkills,
  enabledSkills,
  skillSlashName,
  BUILTIN_SLASH_NAMES,
  environmentInstallCommand,
  gitCredentialInstallCommand,
  LOCUS_CODE_SERVER_PORT,
  matchLinkedRepo,
  sessionRepoCheckouts,
  destRelativeToWorkspace,
  matchWorkspaceCheckout,
  isGitPathToolName,
  isCheckoutDirAlias,
  cursorCloudReposFromSession,
  resolveForgeAccount,
  boundPeerIds,
  findBoundAgent,
  isIntegrationToolName,
  automationAllowsIntegration,
  automationAllowsMcpTool,
  automationAllowsPlugin,
  applyPluginManageAction,
  formatPluginCatalog,
  pluginExtraTools,
  pluginReadToolNames,
  MANAGE_INTEGRATION_PLUGIN_TOOL,
  applySlackPostApprovalText,
  applyBrainBriefApprovalBody,
  canvasHtmlFromToolCall,
  canvasHtmlIncomplete,
  canvasLooksWiped,
  canvasHtmlUnchanged,
  isCompleteHtmlDocument,
  gameFollowUpMissingFromCanvas,
  gameFollowUpNeedsHuman,
  gameIterateUnchangedNeedsHuman,
  assetIterateUnchangedNeedsHuman,
  designIterateUnchangedNeedsHuman,
  formatGameCanvasSnapshot,
  formatAssetCanvasSnapshot,
  formatDesignCanvasSnapshot,
  ASSET_RASTER_READ,
  isAssetRasterPath,
  GAME_LAST_RUN_PATH,
  GAME_STUDIO_PATH,
  parseGameStudio,
  gameCanvasBrokenPrompt,
  assetCanvasBrokenPrompt,
  looksPlayableGame,
  looksDryGame,
  looksUnwiredAsset,
  looksPlaceholderAsset,
  canLinkAssetSessions,
  isHostSessionsToolName,
  isDockerSwarmToolName,
  sessionOffersHostSessions,
  isAssetPackKind,
  parseAssetMentions,
  parseAssetRefIds,
  parseLinkedAssetPrompt,
  parseSessionAssetRefs,
  resolveAssetMention,
  formatLinkedAssetsPrompt,
  LINKED_ASSETS_INDEX,
  looksLikeUnusedLinkedAssets,
  unusedLinkedAssetsNudge,
  chatMessageImages,
  parseGameLastRun,
  canvasFilesPreviewUrl,
  fileReadPaths,
  countPlaywrightCallsThisTurn,
  playwrightRepeatNote,
  playwrightReportFailed,
  isDesignCanvasPath,
  resolveDesignSystem,
  resolveAssetStyle,
  resolveGameStyle,
  tuneFromFeel,
  GAME_FEEL_PRESETS,
  type ExtraToolDef,
  type PromptQueueItem,
  type SessionPreviewStatus,
  type AgentSkill,
  type SubagentLive,
  keepSubagentsForMessages,
  resolveSubagentKind,
  isSubagentKind,
  type SessionPull,
} from "@locus/shared";
import type { DockerEngine, Hypervisor } from "@locus/hypervisor";
import { parseWorkerCliMcpLine, WorkerClient } from "@locus/worker";
import { MockComputeBackend, type ComputeBackend } from "@locus/compute";
import {
  dockerWorkspaceDir,
  hostWorkspaceDir,
  sessionHostWorkspace,
  MockDockerEngine,
  validateTemplate,
} from "@locus/hypervisor";
import {
  captureTurnCheckpoint,
  checkpointNeedsFullSnapshot,
  deleteCheckpointRef,
  diffCheckpointRefs,
  diffTurnCheckpoints,
  dropCheckpointArtifacts,
  fsRemoveCheckpointPath,
  restoreCheckpointRef,
  restoreMachineCheckpoint,
  restoreWorkspaceCheckpoint,
  snapshotMachineCheckpoint,
  writeCheckpointRef,
} from "./checkpoint.js";
import { attachmentWorkspaceRoot, repoWorkspaceClonePending } from "./sessionWorkspacePrep.js";
import { mockAssistantReply, EMPTY_MODEL_REPLY, mockChunks } from "./sessionMockLlm.js";
import { annotateCanvasChangedOnDisk, cursorCliToolCallOk } from "./cursorCliToolStatus.js";
import {
  bootNote,
  cloneStartNote,
  isStartPromptResumeTail,
  lastUserMessageIndex,
  startPromptLooksIgnored,
  studioLoopNudge,
  compactLoopWallNotes,
} from "./sessionBootNotes.js";
import {
  applyRequestedDefaultSubagent,
  llmResponseDetail,
  parkedStatus,
  reviewTurnEndArgs,
  sessionRulesChars,
} from "./sessionTurnHelpers.js";
import {
  buildSystemPromptParts,
  completeChat,
  formatProviderError,
  hasUsableKey,
  runChatTurn,
  startCursorCloudRun,
  streamCursorRun,
  cancelCursorRun,
  spawnCursorCli,
  spawnClaudeCode,
  spawnCodexCli,
  spawnKiroCli,
  isCursorImageMime,
  type ChatEvent,
  type CompleteRequest,
  type CursorCloudEvent,
  type CursorCliSpawner,
  type CursorCliSpawnHandle,
  type CursorCliSpawnRequest,
  type ClaudeCodeSpawner,
  type CodexCliSpawner,
  type KiroCliSpawner,
  type CursorRunHandle,
} from "@locus/providers";
import {
  type ToolRequest,
  type ToolResult,
  runSsh,
  scpGetArgv,
  listenGuestLoopbackTunnel,
  type GuestLoopbackTunnel,
} from "@locus/guest-agent";
import { configSecretValues, redactTool, redactVm } from "../core/redact.js";
import { GuestHub, workspacePath } from "../core/guests.js";
import { BrowserStreams } from "../runtime/browserStream.js";
import { ChromeExtensionHub } from "../runtime/chromeExtensionHub.js";
import { syncHostShareToWindows } from "../media/winshare.js";
import type { JsonStore } from "../core/store.js";
import type { Hub } from "../core/hub.js";
import { ForgeClient } from "../git/forge.js";
import {
  executeEarlyControlPlaneTool,
  executeLateControlPlaneTool,
  type ControlPlaneToolPorts,
} from "./controlPlaneTools.js";
import { executeSessionForgeTool } from "./sessionForgeTools.js";
import { GuestBoot } from "./guestBoot.js";
import { SessionPreview } from "./sessionPreview.js";
import { continueAfterCliRound, type CliTurnContinuePorts } from "./cliTurnContinue.js";
import { runHostCliTurn, type HostCliTurnPorts } from "./hostCliTurn.js";
import { executeSwarmTeamTool, swarmSpeakerFrom } from "./swarmTeamTools.js";
import type { ControlPlane } from "../core/controlPlane.js";
import { BRAIN_DISTILL_IDLE_MS } from "../brain/distiller.js";
import { draftBrainIssueBrief, postBrainIssueBrief } from "../brain/issueBrief.js";
import { withFreshForgeToken } from "../git/forgeOauth.js";
import { recordingDest, writeMockRecording } from "../media/recordings.js";
import { screenshotDest, writeScreenshot } from "../media/screenshots.js";
import { startAllowlistProxy, type AllowlistProxy } from "../runtime/netjail.js";
import { McpHub } from "../integrations/mcp.js";
import { cliGitMcpTools, isCliGitTool } from "../integrations/cliGitMcp.js";
import { dispatchControlPlaneMcp } from "../http/mcpRoutes.js";
import { resolveOptionalHostDir } from "../workspace/hostWorkspace.js";
import { SessionWorkspace } from "../workspace/sessionWorkspace.js";
import { DockerInventory } from "../runtime/dockerInventory.js";
import {
  dockerCreateAllowlist,
  hostCreateAllowlist,
  prepareCreateInput,
  sessionCreateBase,
} from "./sessionCreate.js";
import { executeHostSessions, hostSessionMentionNote } from "./hostSessionsExec.js";
import {
  loadRepoSkills,
  loadWorkspaceEnvironment,
  loadWorkspaceMemories,
  loadWorkspaceMemoryRows,
  loadWorkspaceRules,
  saveWorkspaceMemories,
} from "../workspace/workspaceMeta.js";
import { DesignCanvas, EMPTY_CANVAS_NOTE } from "../design/designCanvas.js";
import { AgentCanvases, runAgentCanvasTool } from "./agentCanvases.js";
import { launchCdpCanvasBrowser, runDesignPlaywright } from "../design/designPlaywright.js";
import { writeWorkspaceFile, writeWorkspaceBytes } from "../workspace/workspaceFiles.js";
import {
  unpackWorkerMirror,
  vmTreeDir,
  VM_TREE_FIND,
  workerMirrorDir,
  writeGuestFiles,
} from "../workspace/guestTreeMirror.js";
import { gitCheckoutReady } from "../workspace/workspaceGit.js";
import { type PreviewTarget } from "../runtime/preview.js";
import { writeArtifactBytes } from "../media/artifacts.js";
import {
  applyAttachmentPromptNote,
  firstImageBase64,
  landAssetSourceImage,
  materializeStoredAttachments,
  type WorkspaceAttachmentWriter,
  persistChatAttachments,
  parseIncomingAttachments,
  storedImageBase64,
  type IncomingAttachment,
} from "../media/attachments.js";
import { persistIntegrationAccount } from "../integrations/googleOauth.js";
import { runMcpCode } from "../integrations/mcpCode.js";
import { IntegrationsClient } from "../integrations/integrations.js";
import { SessionTraceLog, saveFailedEval } from "./traces.js";
import { indexCacheDir, indexWorkspace, updateIndexPaths } from "../workspace/repoIndex.js";
import { grepIndexedWorkspace, grepContextLines } from "../workspace/grepIndex.js";
import { runIsolatedSubagent, subagentTimeoutMs } from "./subagent.js";
import { gateToolRequest, type ToolGateDecision } from "./toolGates.js";
import { sessionWorkflowCatalog } from "../workflows/catalog.js";
import type { WorkflowCompletion } from "../workflows/run.js";
import {
  approvalToolOutcome,
  decideAfterModelRound,
  decideAfterToolRound,
  hideHarvestedCanvasChat,
  impliedToolCallsFromReply,
  freezePromptTools,
  cachedTurnAllowedTools,
  parentExtraTools,
  stablePromptExtraTools,
  parentModelToolChoice,
  canonicalToolName,
  parentToolKind,
  planToolRefusal,
  runParentToolCalls,
  calledPlaywright,
  calledFakeGamePlaytest,
  calledFakeAssetPlaytest,
  calledHudOnlyGamePlaytest,
  wroteLiveCanvas,
  refundLastRoundSlot,
} from "./agentTurn.js";
import {
  formatNpmTestGateFailure,
  lintOutputLooksLikeMissingDeps,
  loadRepoHooks,
  runRepoHook,
  runWorkspaceNpmScript,
  workspaceGitState,
  type WorkspaceScriptResult,
} from "../core/hooks.js";
import {
  assemblePrompt,
  checkBudget,
  providerRoundTimeoutMs,
  taskSpendNow,
  formatProgressReport,
  formatWorkingState,
  sessionWorkingState,
  applyScratchpad,
  applyRemember,
  applySubscribe,
  applyUnsubscribe,
  applyTaskList,
  isSubscribeToolName,
  normalizeSubscriptions,
  formatSubscriptionsPrompt,
  formatAutomationMemoryPrompt,
  mergeMemoryPrompts,
  sessionOffersRemember,
  sessionOffersBrain,
  isBrainToolName,
  looksLikeRememberedSecret,
  WORKSPACE_REMEMBER_HINT,
  BRAIN_REMEMBER_HINT,
  sessionDistillTail,
  taskListFromPlan,
  lastAssistantText,
  isSpawnAgentToolName,
  toolCallsRunInParallel,
  mergeApprovalPolicy,
  approvalPolicyForTier,
  HOST_GUIDED_ALWAYS_ASK,
  sessionAutonomy,
  resolveSpendCapUsd,
  isAutonomyTier,
  looksLikeFixableFailure,
  selfCorrectNudge,
  EMPTY_CANVAS_NUDGE,
  DESIGN_MUTATE_NUDGE,
  canvasQualityNudge,
  looksHostFallbackCanvas,
  GAME_JUICE_NUDGE,
  ASSET_SCULPT_NUDGE,
  looksGenericDesign,
  SEARCH_WANDER_NUDGE,
  VERIFY_NUDGE,
  foldCodingVerifyFlags,
  wroteAgentCanvas,
  codingTurnNeedsHuman,
  MAX_CANVAS_NUDGES,
  INCOMPLETE_CANVAS_NUDGE,
  GAME_CANVAS_RESTORE_NOTE,
  GAME_CANVAS_IFRAME_NUDGE,
  ASSET_CANVAS_IFRAME_NUDGE,
  PROVIDER_TURN_RECOVERY,
  OPS_ROUTING_NUDGE,
  looksLikeOpsPrompt,
  isOpsProgressTool,
  isWorkspaceSearchTool,
  formatCursorOpsRoutingCard,
  REVIEW_VERDICT_NUDGE,
  REVIEW_ROUTING_NUDGE,
  parseReviewSessionVerdict,
  isCleanPass,
  formatVerdictFailure,
  reviewPassNeedsInspect,
  REVIEW_PASS_NEEDS_INSPECT,
  shouldApplyReviewVerdict,
  generationQualityNeedsHuman,
  isReviewProgressTool,
  forgeToolNameFromCall,
  integrationsWithTokens,
  redactedTraceArgs,
  clipTraceDetail,
} from "@locus/shared";

export type ChatEngine = (req: CompleteRequest) => AsyncGenerator<ChatEvent>;

function now(): string {
  return new Date().toISOString();
}

export class SessionService {
  private aborts = new Map<string, AbortController>();
  private cloned = new Set<string>();
  private cloneInflight = new Map<string, Promise<void>>();
  private cloneProgressAt = new Map<
    string,
    {
      t: number;
      percent: number;
      phase: string;
      received?: number;
      rate?: string;
      phasePercent?: number;
      size?: string;
      total?: number;
    }
  >();
  private cloneOutputBuf = new Map<string, string>();
  private imageBuildNoted = new Set<string>();
  private imageBuildFinished = new Set<string>();
  private imageBuildAt = new Map<string, { t: number } & ImageBuildProgress>();
  private imageBuildChain = new Map<string, Promise<void>>();
  private envApplied = new Set<string>();
  private turnEpoch = new Map<string, number>();
  private approvals = new Map<
    string,
    (decision: "approved" | "denied" | "cancelled", answer?: string) => void
  >();
  private proxies = new Map<string, AllowlistProxy>();
  private ideTunnels = new Map<string, GuestLoopbackTunnel>();
  private hypervisor: Hypervisor;
  private docker: DockerEngine;
  readonly dockerInventory: DockerInventory;
  readonly plane: ControlPlane;
  private get boards() {
    return this.plane.boards;
  }
  private get projects() {
    return this.plane.projects;
  }
  private get brain() {
    return this.plane.brain;
  }
  private get workflows() {
    return this.plane.workflows;
  }
  private brainDistillTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private bound = new WeakSet<object>();
  private mcp = new McpHub();
  private readonly integrations = new IntegrationsClient(
    (input, init) => this.fetchFn(input, init),
    (id, patch) => persistIntegrationAccount(this.store)(id, patch),
  );
  private draining = new Set<string>();
  private pendingTurnPrompt = new Map<string, string>();
  /** Peer session id → requester to wake when the peer turn finishes / needs_you / fails. */
  private peerHandoffs = new Map<
    string,
    { requesterId: string; task: string; wakeRequester?: boolean }
  >();
  private readonly guestBoot: GuestBoot;
  private readonly sessionPreview: SessionPreview;
  private startPromptResumed = new Set<string>();
  /** Create-time Games `assetIds` to copy after a worker guest exists. */
  private pendingCreateAssetIds = new Map<string, string[]>();
  private canvasAdherence = new Map<string, string>();
  private thinkingBuf = new Map<string, string>();
  private thinkingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly traces: SessionTraceLog;
  private repoMapCache = new Map<string, { text: string; at: number; query?: string }>();
  private promptStats = new Map<
    string,
    {
      chars: number;
      parts: { id: string; label: string; chars: number }[];
      window: number;
      reserved: number;
    }
  >();
  private turnSubagents = new Map<string, number>();
  private turnStartedAt = new Map<string, number>();
  private inSubagent = new Set<string>();
  private publishTestCache = new Map<string, WorkspaceScriptResult>();
  fetchFn: typeof fetch = fetch;
  cursorCliSpawner: CursorCliSpawner = spawnCursorCli;
  claudeCodeSpawner: ClaudeCodeSpawner = spawnClaudeCode;
  codexCliSpawner: CodexCliSpawner = spawnCodexCli;
  kiroCliSpawner: KiroCliSpawner = spawnKiroCli;
  private cliGitTurns = new Map<string, AbortSignal>();

  private workers = new Map<string, WorkerClient>();
  private cursorCliSpawnAborts = new Map<string, AbortController>();
  /** Last good complete index.html — used to detect snippet wipes and restore. */
  private gameCanvasBaseline = new Map<string, string>();
  /** index.html at the start of this Design/Games/Assets turn — not updated after writes. */
  private studioTurnStart = new Map<string, string>();
  private llmStreamAborts = new Map<string, AbortController>();
  private workerReaper?: ReturnType<typeof setInterval>;
  private readonly forge = new ForgeClient((input, init) => this.fetchFn(input, init));
  private readonly compute: ComputeBackend;
  private readonly browsers: BrowserStreams;
  readonly chromeExtension: ChromeExtensionHub;
  readonly workspace: SessionWorkspace;
  readonly design: DesignCanvas;
  readonly agentCanvases: AgentCanvases;

  constructor(
    private readonly store: JsonStore,
    hypervisor: Hypervisor,
    private readonly hub: Hub,
    private readonly chatEngine: ChatEngine = (req) => completeChat(req),
    private readonly guests: GuestHub = new GuestHub(),
    docker?: DockerEngine,
    compute?: ComputeBackend,
    plane: ControlPlane = {},
  ) {
    this.plane = plane;
    this.agentCanvases = new AgentCanvases(store.dataDir);
    this.hypervisor = hypervisor;
    this.docker = docker ?? new MockDockerEngine(store.dataDir);
    this.compute = compute ?? new MockComputeBackend();
    this.traces = new SessionTraceLog(store.dataDir);
    this.chromeExtension = new ChromeExtensionHub();
    this.guests.setLiveBrowser((sessionId) => this.chromeExtension.driverFor(sessionId));
    this.guests.setLiveDocker(Boolean(this.docker.liveEngine));
    void this.store.loadConfig().then((config) => {
      this.chromeExtension.setToken(
        config.chromeExtension?.enabled ? config.chromeExtension.token : undefined,
      );
    });
    this.bindHypervisor(hypervisor);
    this.bindDocker(this.docker);
    this.dockerInventory = new DockerInventory({
      docker: this.docker,
      listSessions: () => this.list(),
      startAgentMachine: async (sessionId) => {
        await this.startVm(sessionId);
      },
      stopAgentMachine: async (sessionId) => {
        await this.stopVm(sessionId);
      },
    });
    this.workspace = new SessionWorkspace({
      require: (id) => this.require(id),
      isWorker: (session) => this.isWorkerSession(session),
      hostRoot: (session) => this.hostRoot(session),
      dockerWorkspaceRoot: (session) => this.dockerWorkspaceRoot(session),
      workspaceRoot: (session) => this.workspaceRoot(session),
      getMachine: (id) => this.getMachine(id),
      requireWorker: (session) => this.requireWorker(session),
      guests: this.guests,
      hub: this.hub,
      store: this.store,
      forge: this.forge,
      requireForge: (session, args) => this.requireForge(session, args),
      chatEngine: (req) => this.chatEngine(req),
      invalidateRepoMap: (sessionId) => {
        this.repoMapCache.delete(sessionId);
      },
    });
    this.guestBoot = new GuestBoot({
      require: (id) => this.require(id),
      get: (id) => this.get(id),
      sessionNeedsGuest: (session) => this.sessionNeedsGuest(session),
      isWorkerHost: (session) => this.isWorkerHost(session),
      isWorkerSession: (session) => this.isWorkerSession(session),
      runStartVm: (id) => this.runStartVm(id),
      ensureDocker: (id) => this.ensureDocker(id),
      ensureWorkerHost: (id) => this.ensureWorkerHost(id),
      getMachine: (id) => this.getMachine(id),
      workerClient: (backendId) => this.workers.get(backendId),
      onVmStatus: (id, status, error) => this.onVmStatus(id, status, error),
      resumeIgnoredStartPrompt: (id) => this.resumeIgnoredStartPrompt(id),
      bootTimeoutMs: async () => {
        const config = await this.store.loadConfig();
        return guestBootTimeoutMs(config.advanced.guestBootTimeoutMs);
      },
      store: this.store,
      hub: this.hub,
    });
    this.sessionPreview = new SessionPreview({
      require: (id) => this.require(id),
      getMachine: (id) => this.getMachine(id),
      isWorker: (session) => this.isWorkerSession(session),
      requireWorker: (session) => this.requireWorker(session),
      docker: {
        listListeningPorts: (id) => this.docker.listListeningPorts?.(id) ?? Promise.resolve([]),
        inspectAddress: (id) => this.docker.inspectAddress?.(id) ?? Promise.resolve(undefined),
        noteListeningPorts: (id, ports) => this.docker.noteListeningPorts?.(id, ports),
      },
      store: this.store,
      hub: this.hub,
    });
    this.design = new DesignCanvas({
      require: (id) => this.require(id),
      get: (id) => this.get(id),
      patch: (id, body) => this.patch(id, body),
      appendMessage: (id, message) => this.appendMessage(id, message),
      sendChat: (id, content) => this.sendChat(id, content),
      workspace: this.workspace,
      hub: this.hub,
      store: this.store,
      isWorker: (session) => this.isWorkerSession(session),
      hostRoot: (session) => this.hostRoot(session),
      dataDir: this.store.dataDir,
      create: (input) => this.create(input),
      captureImage: (sessionId, name) => this.captureImage(sessionId, name),
    });
    this.browsers = new BrowserStreams(
      this.guests,
      async (sessionId) => {
        const session = await this.get(sessionId);
        if (!session) return undefined;
        if (sessionRuntime(session) === "host" && !this.isWorkerSession(session)) {
          this.chromeExtension.setLiveChrome(session.id, sessionLiveChrome(session));
          return {
            session,
            hostRoot: this.hostRoot(session),
            chromeProfileDir: hostChromeProfileDir(this.store.dataDir, session.id),
          };
        }
        if (!session.vmId) return undefined;
        const vm = this.getMachine(session.vmId);
        if (!vm) return undefined;
        return { session, vm };
      },
      {
        takeover: (sessionId) => this.takeoverBrowser(sessionId),
        handback: (sessionId) => this.handbackBrowser(sessionId),
        allowHosts: async (session) => {
          const config = await this.store.loadConfig();
          return forgeProviderAllowlist({ ...config, extraHosts: session.allowHosts });
        },
        saveDownload: (sessionId, result) => this.persistArtifact(sessionId, result),
      },
    );
  }

  attachBrowserSocket(sessionId: string, ws: import("ws").WebSocket): void {
    this.browsers.attach(sessionId, ws);
  }

  async recoverInterruptedTurns(): Promise<number> {
    const sessions = await this.store.loadSessions();
    let recovered = 0;
    for (const session of sessions) {
      if (session.status !== "running") continue;
      await this.store.mutateSession(session.id, (current) => {
        if (current.status !== "running") return;
        current.status = parkedStatus(current);
        current.messages.push({
          id: randomUUID(),
          role: "system",
          content: INTERRUPTED_TURN_NOTE,
          createdAt: now(),
        });
      });
      recovered += 1;
    }
    return recovered;
  }

  setHypervisor(next: Hypervisor): void {
    this.hypervisor = next;
    this.guests.setLiveQemu(Boolean(next.liveEngine));
    this.bindHypervisor(next);
  }

  private scheduleBrainDistill(sessionId: string, session: AgentSession): void {
    if (!this.brain || !sessionOffersBrain(session)) return;
    const existing = this.brainDistillTimers.get(sessionId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.brainDistillTimers.delete(sessionId);
      void this.runBrainDistill(sessionId).catch((err) => {
        console.warn(
          "brain distill failed",
          sessionId,
          err instanceof Error ? err.message : String(err),
        );
      });
    }, BRAIN_DISTILL_IDLE_MS);
    this.brainDistillTimers.set(sessionId, timer);
  }

  private async runBrainDistill(sessionId: string): Promise<void> {
    if (!this.brain) return;
    const session = await this.get(sessionId);
    if (!session || !sessionOffersBrain(session)) return;
    const blob = sessionDistillTail(session.messages);
    if (!blob.trim()) return;
    await this.brain.distillText(blob, {
      repo: session.repo?.url,
      sessionId,
      actor: "distiller",
    });
  }

  async refreshMcp(): Promise<void> {
    const config = await this.store.loadConfig();
    await this.mcp.setServers(config.mcpServers ?? []);
  }

  listMachines(): VmInstance[] {
    return [
      ...this.hypervisor.list(),
      ...this.docker.list(),
      ...[...this.workers.values()].flatMap((client) => client.list()),
    ];
  }

  getMachine(id: string): VmInstance | undefined {
    return this.hypervisor.get(id) ?? this.docker.get(id) ?? this.workerVm(id);
  }

  dockerKind(): DockerEngine["kind"] {
    return this.docker.kind;
  }

  private dockerReadyCache: { at: number; ready: Promise<boolean> } | null = null;

  /** Whether the container daemon answers (`docker info`), cached for a few seconds. */
  dockerReady(): Promise<boolean> {
    if (this.docker.kind !== "docker") return Promise.resolve(false);
    const now = Date.now();
    if (!this.dockerReadyCache || now - this.dockerReadyCache.at > 10_000) {
      this.dockerReadyCache = {
        at: now,
        ready: this.docker.available().catch(() => false),
      };
    }
    return this.dockerReadyCache.ready;
  }

  async resetAll(): Promise<void> {
    const sessions = await this.list();
    await Promise.all(sessions.map((session) => this.abortChat(session.id).catch(() => undefined)));
    for (const session of sessions) {
      await this.remove(session.id).catch(() => undefined);
    }
    for (const vm of this.listMachines()) {
      this.guests.drop(vm.id);
      await this.hypervisor.destroy(vm.id).catch(() => undefined);
      await this.docker.destroy(vm.id).catch(() => undefined);
    }
    for (const client of this.workers.values()) {
      for (const vm of client.list()) {
        this.guests.drop(vm.id);
        await client.destroy(vm.id).catch(() => undefined);
      }
    }
    this.workers.clear();
    for (const sessionId of [...this.proxies.keys()]) this.closeProxy(sessionId);
    for (const sessionId of [...this.ideTunnels.keys()]) this.closeIdeTunnel(sessionId);
    for (const decide of this.approvals.values()) decide("cancelled");
    this.aborts.clear();
    this.cloned.clear();
    this.cloneInflight.clear();
    this.cloneProgressAt.clear();
    this.cloneOutputBuf.clear();
    this.imageBuildNoted.clear();
    this.imageBuildFinished.clear();
    this.imageBuildAt.clear();
    this.imageBuildChain.clear();
    this.envApplied.clear();
    this.turnEpoch.clear();
    this.approvals.clear();
    this.draining.clear();
    this.pendingTurnPrompt.clear();
    this.guestBoot.clear();
    this.startPromptResumed.clear();
    this.pendingCreateAssetIds.clear();
    this.design.reset();
    await this.mcp.setServers([]);
  }

  private bindHypervisor(hypervisor: Hypervisor): void {
    if (this.bound.has(hypervisor)) return;
    this.bound.add(hypervisor);
    hypervisor.onStatus((id, status, error) => {
      void this.onVmStatus(id, status, error);
    });
  }

  private bindDocker(docker: DockerEngine): void {
    if (this.bound.has(docker)) return;
    this.bound.add(docker);
    docker.onStatus((id, status, error) => {
      void this.onVmStatus(id, status, error);
    });
    docker.onBuild((id, progress) => this.queueImageBuild(id, progress));
  }

  private engine(session: AgentSession): Hypervisor | DockerEngine {
    return sessionRuntime(session) === "docker" ? this.docker : this.hypervisor;
  }

  private isWorkerSession(session: { placement?: AgentSession["placement"] }): boolean {
    return sessionPlacement(session) === "worker";
  }

  private isWorkerHost(session: AgentSession): boolean {
    return this.isWorkerSession(session) && sessionRuntime(session) === "host";
  }

  private sessionNeedsGuest(session: AgentSession): boolean {
    return runtimeNeedsGuest(sessionRuntime(session)) || this.isWorkerHost(session);
  }

  private workerVm(id: string): VmInstance | undefined {
    for (const client of this.workers.values()) {
      const vm = client.get(id);
      if (vm) return vm;
    }
    return undefined;
  }

  private async requireWorker(session: AgentSession): Promise<WorkerClient> {
    if (!this.isWorkerSession(session) || !session.backendId) {
      throw new Error("Pick a worker in Settings → Workers");
    }
    const config = await this.store.loadConfig();
    const backend = (config.workers ?? []).find((row) => row.id === session.backendId);
    if (!backend) throw new Error("Worker was removed from Settings → Workers");
    if (workerProvisionsCompute(backend)) {
      const handle = session.remoteGuestId ? this.compute.get(session.remoteGuestId) : undefined;
      if (!handle?.url) throw new Error("Compute worker is not provisioned");
      const row = {
        ...backend,
        url: handle.url,
        token: handle.token,
        fingerprint: handle.fingerprint,
      };
      const cacheKey = `${backend.id}:${handle.id}`;
      const existing = this.workers.get(cacheKey);
      if (
        existing &&
        existing.backend.url === row.url &&
        existing.backend.token === row.token &&
        existing.backend.fingerprint === row.fingerprint
      ) {
        return this.withPlane(existing, config.workerPlaneId);
      }
      const client = new WorkerClient(
        row,
        this.fetchFn === fetch ? undefined : (input, init) => this.fetchFn(input, init),
      );
      this.workers.set(cacheKey, client);
      return this.withPlane(client, config.workerPlaneId);
    }
    if (!backend.token?.trim()) throw new Error("Add a worker token in Settings → Workers");
    if (backend.url.startsWith("https:") && !backend.fingerprint) {
      throw new Error("Test connection in Settings → Workers to pin this worker's TLS fingerprint");
    }
    const existing = this.workers.get(backend.id);
    if (
      existing &&
      existing.backend.url === backend.url &&
      existing.backend.token === backend.token &&
      existing.backend.fingerprint === backend.fingerprint
    ) {
      return this.withPlane(existing, config.workerPlaneId);
    }
    const client = new WorkerClient(
      backend,
      this.fetchFn === fetch ? undefined : (input, init) => this.fetchFn(input, init),
    );
    this.workers.set(backend.id, client);
    return this.withPlane(client, config.workerPlaneId);
  }

  private withPlane(client: WorkerClient, planeId?: string): WorkerClient {
    client.planeId = planeId;
    return client;
  }

  pipeWorkerDisplay(vmId: string, ws: import("ws").WebSocket): boolean {
    const client = [...this.workers.values()].find((row) => row.get(vmId));
    if (!client) return false;
    void this.store
      .loadConfig()
      .then((config) => {
        this.withPlane(client, config.workerPlaneId);
        return client.openDisplaySocket(vmId, (raw) => {
          if (ws.readyState === 1) ws.send(raw);
        });
      })
      .then((remote) => {
        ws.on("message", (data) => {
          if (remote.readyState === 1) remote.send(data);
        });
        const close = () => {
          try {
            remote.close();
          } catch {
            /* already closed */
          }
        };
        ws.on("close", close);
        ws.on("error", close);
        remote.on("close", () => {
          if (ws.readyState === 1) ws.close();
        });
        remote.on("error", () => {
          if (ws.readyState === 1) ws.close(1011, "display unreachable");
        });
      })
      .catch(() => {
        if (ws.readyState === 1) ws.close(1011, "no display");
      });
    return true;
  }

  startWorkerReaper(intervalMs = 30_000): void {
    if (this.workerReaper) return;
    this.workerReaper = setInterval(() => {
      void this.reapIdleWorkerGuests();
    }, intervalMs);
    this.workerReaper.unref?.();
  }

  async reapIdleWorkerGuests(now = Date.now()): Promise<number> {
    const config = await this.store.loadConfig();
    const sessions = await this.list();
    let reaped = 0;
    for (const session of sessions) {
      if (!this.isWorkerSession(session) || !session.vmId) continue;
      if (session.status === "running") continue;
      const backend = (config.workers ?? []).find((row) => row.id === session.backendId);
      if (!backend) continue;
      const ttl = workerIdleTtlMs(backend);
      if (!ttl) continue;
      const last = Date.parse(session.updatedAt);
      if (!Number.isFinite(last) || now - last < ttl) continue;
      try {
        await this.destroyWorkerGuest(session);
        reaped += 1;
      } catch {
        /* retry on the next tick */
      }
    }
    return reaped;
  }

  async reapOrphanCompute(): Promise<number> {
    const live = new Set(
      (await this.list())
        .map((session) => session.remoteGuestId)
        .filter((id): id is string => !!id),
    );
    const orphans = await this.compute.listOrphans(live);
    if (!orphans.length) return 0;
    const config = await this.store.loadConfig();
    for (const orphan of orphans) {
      const backend = (config.workers ?? []).find((row) => row.id === orphan.backendId);
      await this.compute.destroy(orphan.id, backend).catch(() => undefined);
    }
    return orphans.length;
  }

  private async destroyWorkerGuest(session: AgentSession): Promise<void> {
    this.closeProxy(session.id);
    this.closeIdeTunnel(session.id);
    const remoteId = session.remoteGuestId;
    if (session.vmId) {
      const vmId = session.vmId;
      this.guests.drop(vmId);
      const client = await this.requireWorker(session).catch(() => undefined);
      try {
        await client?.destroy(vmId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/not found/i.test(msg) && !/404/.test(msg)) throw err;
      }
      await this.store.deleteVm(vmId).catch(() => undefined);
    }
    if (remoteId) {
      const config = await this.store.loadConfig();
      const backend = (config.workers ?? []).find((row) => row.id === session.backendId);
      await this.compute.destroy(remoteId, backend).catch(() => undefined);
    }
    await this.patch(session.id, {
      vmId: undefined,
      status: "stopped",
      computeMs: sessionComputeMs(session),
      computeStartedAt: undefined,
      remoteGuestId: undefined,
    });
  }

  private attachWorkerGuest(session: AgentSession, client: WorkerClient, vm: VmInstance): void {
    this.guests.setRemote(vm.id, client.guestRuntime(vm.id, session.os));
  }

  async list(): Promise<AgentSession[]> {
    const sessions = await this.store.loadSessions();
    return sessions.sort(compareSessionsForList);
  }

  async get(id: string): Promise<AgentSession | undefined> {
    return this.store.getSession(id);
  }

  async workspaceShellRoot(sessionId: string): Promise<string | undefined> {
    const session = await this.get(sessionId);
    if (!session || sessionRuntime(session) !== "host") return undefined;
    return this.hostRoot(session);
  }

  async promoteIdeToDocker(sessionId: string, runtime: "docker" | "host" = "docker") {
    const session = await this.require(sessionId);
    if (!isIdeSession(session)) throw new Error("Not an IDE workspace");
    const created = await this.create({
      title: session.title,
      os: session.os,
      templateId: session.templateId,
      runtime,
      dockerImage: runtime === "docker" ? DEFAULT_DOCKER_IMAGE : undefined,
      providerId: session.providerId,
      model: session.model,
      repo: session.repo,
      repoId: session.repoId,
      extraRepos: session.extraRepos,
      extraRepoIds: session.extraRepoIds,
      startVm: true,
    });
    const src = this.hostRoot(session);
    const dest = this.dockerWorkspaceRoot(created);
    await mkdir(dest, { recursive: true });
    try {
      await cp(src, dest, { recursive: true, force: true });
    } catch (err) {
      await this.remove(created.id).catch(() => undefined);
      throw err;
    }
    return this.require(created.id);
  }

  async ideUrl(sessionId: string): Promise<{ url: string | null }> {
    const session = await this.require(sessionId);
    if (sessionRuntime(session) !== "docker" || this.isWorkerSession(session)) return { url: null };
    const vm = session.vmId ? this.docker.get(session.vmId) : undefined;
    const image = vm?.dockerImage ?? session.dockerImage ?? "";
    if (!vm?.containerId || !isGuestReady(vm.status) || !isLocusAgentImage(image))
      return { url: null };
    const existing = this.ideTunnels.get(sessionId);
    if (existing?.host === "127.0.0.1") return { url: `http://127.0.0.1:${existing.port}/` };
    if (existing) this.closeIdeTunnel(sessionId);
    const tunnel = await listenGuestLoopbackTunnel(vm.containerId, LOCUS_CODE_SERVER_PORT);
    if (tunnel.host !== "127.0.0.1") {
      tunnel.close();
      throw new Error("IDE tunnel must bind loopback");
    }
    this.ideTunnels.set(sessionId, tunnel);
    return { url: `http://127.0.0.1:${tunnel.port}/` };
  }

  /** Named Swarm teammates join the project roster. Coordinators stay off memberIds. */
  private async enrollSwarmTeammate(session: AgentSession): Promise<void> {
    if (!this.projects || session.surface !== "swarm" || !session.projectId) return;
    if (isProjectSession(session)) return;
    await this.projects.attachSwarmMember({
      sessionId: session.id,
      projectId: session.projectId,
      role: session.persona?.hubRole,
    });
  }

  /** Bind a live session to a project, or clear `projectId` when leaving a team. */
  async assignProject(id: string, projectId: string | undefined): Promise<AgentSession> {
    const next = projectId?.trim() || undefined;
    const session = await this.store.mutateSession(id, (current) => {
      if (next) current.projectId = next;
      else delete current.projectId;
    });
    if (!session) throw new Error(`Session not found: ${id}`);
    this.hub.broadcast({ type: "session.updated", session });
    return session;
  }

  async create(
    input: CreateSessionInput,
    opts?: { waitUntilStarted?: boolean },
  ): Promise<AgentSession> {
    const config = await this.store.loadConfig();
    const surface =
      input.surface === "swarm" || input.surface === "developer"
        ? input.surface
        : surfaceForProductMode(parseProductMode(config.productMode));
    const prep = prepareCreateInput(input, {
      config,
      repos: await this.store.loadRepos(),
      designSystems: await this.store.loadDesignSystems(),
      assetStyles: await this.store.loadAssetStyles(),
      gameStyles: await this.store.loadGameStyles(),
    });
    input = prep.input;
    const { kind, runtime, placement, backendId, cursorCloud } = prep;
    const policyErr = policyRejectsCreate({
      runtime,
      autonomy: input.autonomy,
      network: input.network,
      liveChrome: input.liveChrome,
      status: config.managedPolicy,
    });
    if (policyErr) throw new Error(policyErr);
    const forcedJail = policyForcedJail(config.managedPolicy);
    if (forcedJail) input.network = forcedJail;
    const provider = config.providers.find((row) => row.id === input.providerId);
    if (
      provider &&
      config.managedPolicy?.active &&
      !providerAllowedByPolicy(provider, config.managedPolicy.policy)
    ) {
      throw new Error("Managed policy does not allow that provider");
    }
    if (runtime === "host") {
      const os = isWindows(input.os) ? "ubuntu" : input.os;
      const template =
        config.templates.find((t) => t.id === input.templateId && !isWindows(t.os)) ??
        config.templates.find((t) => t.os === os && !isWindows(t.os)) ??
        config.templates.find((t) => t.os === "ubuntu") ??
        config.templates.find((t) => !isWindows(t.os));
      const workerHost = placement === "worker";
      const session: AgentSession = sessionCreateBase(input, {
        now: now(),
        os,
        templateId: template?.id ?? (input.templateId || "host"),
        kind,
        runtime: "host",
        placement: workerHost ? "worker" : undefined,
        backendId: workerHost ? backendId : undefined,
        allowedTools: hostCreateAllowlist(os, input.allowedTools),
        vision: "off",
        status: workerHost && input.startVm && !cursorCloud ? "provisioning" : "idle",
        titleRuntime: "host",
        hostDir: workerHost
          ? input.hostDir?.trim() || undefined
          : await resolveOptionalHostDir(input.hostDir, this.store.dataDir),
        palette: isCanvasSession({ kind })
          ? (parseDesignPalette(input.palette) ?? DEFAULT_DESIGN_PALETTE)
          : parseDesignPalette(input.palette),
        designSystemId: isDesignSession({ kind })
          ? input.designSystemId
          : isGameSession({ kind })
            ? resolveGameKit(input.designSystemId)?.id
            : isAssetSession({ kind })
              ? resolveAssetKit(input.designSystemId)?.id
              : undefined,
        assetStyleId: isAssetSession({ kind }) ? input.assetStyleId : undefined,
        gameStyleId: isGameSession({ kind }) ? input.gameStyleId : undefined,
        parentSessionId: input.parentSessionId,
        assetBuild: isAssetSession({ kind }) ? resolveAssetBuild(input.assetBuild) : undefined,
        boardId: input.boardId,
        projectId: input.projectId,
        surface,
        reasoningEffort: input.reasoningEffort,
      });
      if (!session.hostDir && !workerHost) {
        await mkdir(hostWorkspaceDir(this.store.dataDir, session.id), { recursive: true });
      }
      await this.store.replaceSession(session);
      this.hub.broadcast({ type: "session.updated", session });
      await this.enrollSwarmTeammate(session);
      if (!workerHost) {
        if (isDesignSession(session) && !session.repo?.url) {
          await this.design.landKit(session.id, session.designSystemId);
        }
        if (isGameSession(session)) {
          await this.design.landGameKit(session.id, session.designSystemId);
          await this.linkCreateAssets(session.id, input.assetIds);
          if (session.gameStyleId) {
            await this.design.applyGameStyleBrief(session.id, session.gameStyleId);
          }
        }
        if (isAssetSession(session)) {
          await this.design.landAssetKit(session.id, session.designSystemId);
          if (session.assetStyleId) {
            await this.design.applyAssetStyleBrief(session.id, session.assetStyleId);
          }
          if (session.assetBuild) {
            await this.design.applyAssetBuildBrief(session.id, session.assetBuild);
          }
        }
      } else {
        this.rememberCreateAssetIds(session.id, input.assetIds);
      }
      if (!cursorCloud) {
        if (workerHost) {
          if (input.startVm) await this.bootGuest(session.id, opts?.waitUntilStarted !== false);
        } else {
          await this.cloneRepoIfNeeded(session.id);
        }
      }
      await this.startFirstPrompt(
        session.id,
        input.prompt,
        await this.storedCreateAttachments(session, input.attachments),
        input.assetIds,
      );
      return this.require(session.id);
    }
    if (runtime === "docker") {
      if (isWindows(input.os)) throw new Error("Docker agents are Linux-only");
      const dockerImage = parseDockerImage(input.dockerImage ?? "");
      if (!dockerImage) throw new Error("Enter a Docker image such as ubuntu:24.04");
      const template =
        config.templates.find((t) => t.id === input.templateId && !isWindows(t.os)) ??
        config.templates.find((t) => t.os === input.os && !isWindows(t.os)) ??
        config.templates.find((t) => t.os === "ubuntu");
      if (!template) throw new Error("Unknown template");
      if (isWindows(template.os)) throw new Error("Docker agents need a Linux template");
      const session: AgentSession = sessionCreateBase(input, {
        now: now(),
        os: input.os,
        templateId: template.id,
        kind,
        runtime: "docker",
        placement: placement === "worker" ? "worker" : undefined,
        backendId: placement === "worker" ? backendId : undefined,
        allowedTools: dockerCreateAllowlist(input.os, input.allowedTools),
        vision: input.vision ?? "off",
        status: cursorCloud ? "idle" : input.startVm ? "provisioning" : "draft",
        titleRuntime: "docker",
        dockerImage,
        instanceSize: input.instanceSize,
        network: input.network ?? defaultNetworkJail(input.imageId),
        imageId: input.imageId,
        palette: isCanvasSession({ kind })
          ? (parseDesignPalette(input.palette) ?? DEFAULT_DESIGN_PALETTE)
          : parseDesignPalette(input.palette),
        designSystemId: isDesignSession({ kind })
          ? input.designSystemId
          : isGameSession({ kind })
            ? resolveGameKit(input.designSystemId)?.id
            : isAssetSession({ kind })
              ? resolveAssetKit(input.designSystemId)?.id
              : undefined,
        assetStyleId: isAssetSession({ kind }) ? input.assetStyleId : undefined,
        gameStyleId: isGameSession({ kind }) ? input.gameStyleId : undefined,
        parentSessionId: input.parentSessionId,
        assetBuild: isAssetSession({ kind }) ? resolveAssetBuild(input.assetBuild) : undefined,
        guestEnv: input.guestEnv,
        projectId: input.projectId,
        surface,
        reasoningEffort: input.reasoningEffort,
      });
      await this.store.replaceSession(session);
      this.hub.broadcast({ type: "session.updated", session });
      await this.enrollSwarmTeammate(session);
      if (placement !== "worker") {
        if (!session.repo?.url) await this.design.landKit(session.id, session.designSystemId);
        if (isGameSession(session)) {
          await this.design.landGameKit(session.id, session.designSystemId);
          await this.linkCreateAssets(session.id, input.assetIds);
          if (session.gameStyleId) {
            await this.design.applyGameStyleBrief(session.id, session.gameStyleId);
          }
        }
        if (isAssetSession(session)) {
          await this.design.landAssetKit(session.id, session.designSystemId);
          if (session.assetStyleId) {
            await this.design.applyAssetStyleBrief(session.id, session.assetStyleId);
          }
          if (session.assetBuild) {
            await this.design.applyAssetBuildBrief(session.id, session.assetBuild);
          }
        }
      } else {
        this.rememberCreateAssetIds(session.id, input.assetIds);
      }
      if (input.startVm && !cursorCloud)
        await this.bootGuest(session.id, opts?.waitUntilStarted !== false);
      const saved = await this.require(session.id);
      this.hub.broadcast({ type: "session.updated", session: saved });
      await this.startFirstPrompt(
        saved.id,
        input.prompt,
        await this.storedCreateAttachments(saved, input.attachments),
        input.assetIds,
      );
      return this.require(session.id);
    }

    const template = config.templates.find((t) => t.id === input.templateId);
    if (!template) throw new Error(`Unknown template: ${input.templateId}`);
    if (template.os !== input.os) throw new Error("Template OS does not match session OS");
    const overrideError = input.hardware ? validateHardwareOverride(input.hardware) : undefined;
    if (overrideError) throw new Error(overrideError);
    const hardware = resolveVmHardware(template.hardware, {
      os: input.os,
      profiles: config.hardwareProfiles,
      repoUrl: input.repo?.url,
      override: input.hardware,
    });
    const templateErrors = validateTemplate({ ...template, hardware });
    if (templateErrors.length) throw new Error(templateErrors.join("; "));

    const session: AgentSession = sessionCreateBase(input, {
      now: now(),
      os: input.os,
      templateId: input.templateId,
      kind,
      runtime: "vm",
      placement: placement === "worker" ? "worker" : undefined,
      backendId: placement === "worker" ? backendId : undefined,
      allowedTools: input.allowedTools,
      vision: input.vision ?? "latest",
      status: cursorCloud ? "idle" : input.startVm ? "provisioning" : "draft",
      network: input.network ?? defaultNetworkJail(input.imageId),
      imageId: input.imageId,
      hardware,
      guestEnv: input.guestEnv,
      projectId: input.projectId,
      surface,
      reasoningEffort: input.reasoningEffort,
    });

    await this.store.replaceSession(session);
    this.hub.broadcast({ type: "session.updated", session });
    await this.enrollSwarmTeammate(session);

    if (input.startVm && !cursorCloud)
      await this.bootGuest(session.id, opts?.waitUntilStarted !== false);

    const saved = await this.require(session.id);
    this.hub.broadcast({ type: "session.updated", session: saved });
    await this.startFirstPrompt(
      saved.id,
      input.prompt,
      await this.storedCreateAttachments(saved, input.attachments),
      input.assetIds,
    );
    return this.require(session.id);
  }

  private async startFirstPrompt(
    sessionId: string,
    prompt?: string,
    attachments?: ChatAttachment[],
    extraAssetIds?: string[],
  ): Promise<void> {
    const text = prompt?.trim();
    if (!text && !attachments?.length) {
      await this.seedSwarmWelcome(sessionId).catch(() => undefined);
      return;
    }
    try {
      await this.sendChat(sessionId, text || "", {
        attachments,
        assetRefs: extraAssetIds?.length ? extraAssetIds : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not start the first turn";
      await this.appendMessage(sessionId, {
        id: randomUUID(),
        role: "system",
        content: message,
        createdAt: now(),
      }).catch(() => undefined);
    }
  }

  /** First message for a new Swarm teammate — ask what their role on the team is. */
  private async seedSwarmWelcome(sessionId: string): Promise<void> {
    const session = await this.require(sessionId);
    if (parseSessionSurface(session.surface) !== "swarm") return;
    if (isProjectSession(session) || isCanvasSession(session) || sessionKind(session) === "board")
      return;
    if (session.messages.some((row) => row.role === "user" || row.role === "assistant")) return;
    const name = sessionDisplayName(session);
    const role = session.persona?.hubRole?.trim();
    const content = role
      ? `Hi — I'm ${name}, set up as ${role}. What should I focus on for the team, or would you like to refine my role?`
      : `Hi — I'm ${name}. What should my role on the team be, and what should I focus on first?`;
    await this.appendMessage(sessionId, {
      id: randomUUID(),
      role: "assistant",
      content,
      createdAt: now(),
    });
  }

  /**
   * Persist attachments sent with the create-session payload so the first
   * prompt can reference them. Failures surface as a system message instead of
   * failing the whole session create.
   */
  private async storedCreateAttachments(
    session: AgentSession,
    input?: IncomingAttachmentData[],
  ): Promise<ChatAttachment[] | undefined> {
    try {
      const incoming = parseIncomingAttachments(input);
      if (!incoming.length) return undefined;
      return await persistChatAttachments(
        this.store.dataDir,
        session.id,
        incoming,
        this.attachmentWorkspaceRoot(session),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not store the attachment";
      await this.appendMessage(session.id, {
        id: randomUUID(),
        role: "system",
        content: message,
        createdAt: now(),
      }).catch(() => undefined);
      return undefined;
    }
  }

  private async resumeIgnoredStartPrompt(sessionId: string): Promise<void> {
    if (this.aborts.has(sessionId) || this.startPromptResumed.has(sessionId)) return;
    this.startPromptResumed.add(sessionId);
    try {
      const session = await this.get(sessionId);
      if (!session || !this.sessionNeedsGuest(session)) {
        this.startPromptResumed.delete(sessionId);
        return;
      }
      const prompt = lastUserPrompt(session.messages);
      if (!prompt || !startPromptLooksIgnored(session)) {
        this.startPromptResumed.delete(sessionId);
        return;
      }
      if (isCanvasSession(session) && !(await this.design.isEmpty(sessionId))) {
        this.startPromptResumed.delete(sessionId);
        return;
      }
      await this.dropIgnoredStartTail(sessionId);
      await this.continueExistingTurn(sessionId, prompt);
    } catch (err) {
      this.startPromptResumed.delete(sessionId);
      throw err;
    }
  }

  private async dropIgnoredStartTail(sessionId: string): Promise<void> {
    await this.store.mutateSession(sessionId, (current) => {
      const lastUser = lastUserMessageIndex(current.messages);
      if (lastUser < 0) return;
      current.messages = current.messages.filter((message, index) => {
        if (index <= lastUser) return true;
        return !isStartPromptResumeTail(message);
      });
    });
    const session = await this.get(sessionId);
    if (session) this.hub.broadcast({ type: "session.updated", session });
  }

  private async continueExistingTurn(sessionId: string, userText: string): Promise<void> {
    if (this.aborts.has(sessionId)) return;
    const epoch = (this.turnEpoch.get(sessionId) ?? 0) + 1;
    this.turnEpoch.set(sessionId, epoch);
    const abort = new AbortController();
    this.aborts.set(sessionId, abort);
    try {
      await this.snapshotTurn(sessionId);
      await this.patch(sessionId, { status: "running" });
      void this.runAgentLoop(sessionId, userText, abort, epoch, false);
    } catch (err) {
      if (this.aborts.get(sessionId) === abort) this.aborts.delete(sessionId);
      throw err;
    }
  }

  private async dropAssistantMessage(sessionId: string, replyId: string): Promise<void> {
    await this.store.mutateSession(sessionId, (current) => {
      current.messages = current.messages.filter((message) => message.id !== replyId);
    });
    this.hub.broadcast({ type: "session.updated", session: await this.require(sessionId) });
  }

  async startVm(sessionId: string): Promise<VmInstance> {
    return this.guestBoot.startVm(sessionId);
  }

  private async runStartVm(sessionId: string): Promise<VmInstance> {
    const session = await this.require(sessionId);
    if (this.isWorkerHost(session)) return this.startWorkerHost(sessionId);
    if (!runtimeNeedsGuest(sessionRuntime(session))) {
      throw new Error("Host agents do not have a VM or container.");
    }
    if (sessionRuntime(session) === "docker") return this.startDocker(sessionId);
    if (this.isWorkerSession(session)) return this.startWorkerVm(sessionId);
    return this.startQemuVm(sessionId);
  }

  private async bootGuest(sessionId: string, waitUntilStarted: boolean): Promise<void> {
    return this.guestBoot.bootGuest(sessionId, waitUntilStarted);
  }

  private async startGuestIfNeeded(sessionId: string): Promise<void> {
    return this.guestBoot.startGuestIfNeeded(sessionId);
  }

  private async waitForGuestIfStarting(sessionId: string, abort: AbortController): Promise<void> {
    return this.guestBoot.waitForGuestIfStarting(sessionId, abort);
  }

  /** Land Design/Games/Assets kits after a worker guest exists (`writeWorkspace` needs `vmId`). */
  private async landStudioWorkspace(sessionId: string, extraAssetIds?: string[]): Promise<void> {
    const live = await this.require(sessionId);
    if (isDesignSession(live)) await this.design.landKit(sessionId, live.designSystemId);
    if (isGameSession(live)) {
      await this.design.landGameKit(sessionId, live.designSystemId);
      const pending = extraAssetIds ?? this.pendingCreateAssetIds.get(sessionId);
      this.pendingCreateAssetIds.delete(sessionId);
      await this.linkCreateAssets(sessionId, pending);
      if (live.gameStyleId) {
        await this.design.applyGameStyleBrief(sessionId, live.gameStyleId);
      }
    }
    if (isAssetSession(live)) {
      await this.design.landAssetKit(sessionId, live.designSystemId);
      if (live.assetStyleId) {
        await this.design.applyAssetStyleBrief(sessionId, live.assetStyleId);
      }
      if (live.assetBuild) {
        await this.design.applyAssetBuildBrief(sessionId, live.assetBuild);
      }
    }
  }

  private async ensureWorkerDocker(sessionId: string): Promise<VmInstance> {
    let session = await this.require(sessionId);
    const dockerImage = parseDockerImage(session.dockerImage ?? "");
    if (!dockerImage) throw new Error("Enter a Docker image such as ubuntu:24.04");
    const jail = session.network ?? defaultNetworkJail(session.imageId);
    const config = await this.store.loadConfig();
    const backend = (config.workers ?? []).find((row) => row.id === session.backendId);
    if (!backend) throw new Error("Worker was removed from Settings → Workers");
    const fargate = workerProvisionsCompute(backend);
    if (!session.vmId) {
      if (!workerImageAllowed(backend, dockerImage)) {
        throw new Error(`Worker ${backend.name} does not allow image ${dockerImage}`);
      }
      if (fargate) {
        const cap = workerMaxConcurrent(backend);
        if (cap != null) {
          const live = (await this.list()).filter(
            (row) =>
              row.id !== session.id &&
              row.backendId === backend.id &&
              Boolean(row.remoteGuestId || (row.vmId && row.status !== "stopped")),
          ).length;
          if (live >= cap) {
            throw new Error(
              `Worker ${backend.name} already has ${cap} live guest${cap === 1 ? "" : "s"} (maxConcurrent)`,
            );
          }
        }
      }
    }
    if (fargate) {
      session = await this.ensureFargateHandle(session, backend);
    }
    const client = await this.requireWorker(session);
    let vm = session.vmId ? client.get(session.vmId) : undefined;
    if (!vm && session.vmId) vm = await client.refresh(session.vmId);
    if (!vm) {
      const cap = workerMaxConcurrent(backend);
      if (!fargate && cap != null) {
        const live = (await client.listGuests()).filter(
          (guest) => guest.status !== "stopped" && guest.status !== "error",
        ).length;
        if (live >= cap) {
          throw new Error(
            `Worker ${backend.name} already has ${cap} live guest${cap === 1 ? "" : "s"} (maxConcurrent)`,
          );
        }
      }
      const seed = session.imageId
        ? (await this.store.loadImages()).find((i) => i.id === session.imageId)
        : undefined;
      if (session.imageId && !seed) throw new Error("Golden image not found");
      if (seed && imageRuntime(seed) !== "docker") {
        throw new Error("That golden image is a VM disk, not a container workspace");
      }
      const share = config.advanced.hostSharePath?.trim();
      if (share) await mkdirShare(share);
      const seedEnv = await loadWorkspaceEnvironment(seed?.path);
      const forge = this.sessionForge(config, session);
      const guestEnv: Record<string, string> = {
        ...(seedEnv?.env ?? {}),
        ...(session.guestEnv ?? {}),
      };
      const freshForge = forge
        ? await withFreshForgeToken(this.store, forge, this.fetchFn)
        : undefined;
      if (
        freshForge?.token &&
        !guestEnv.GIT_TOKEN &&
        !guestEnv.GITHUB_TOKEN &&
        !guestEnv.GITLAB_TOKEN &&
        !guestEnv.BITBUCKET_TOKEN
      ) {
        guestEnv.GIT_TOKEN = freshForge.token;
      }
      try {
        vm = await client.create({
          sessionId,
          name: session.title,
          image: dockerImage,
          os: session.os,
          templateId: session.templateId,
          network: jail,
          hostShare: Boolean(share),
          allowHosts:
            jail === "restricted"
              ? forgeProviderAllowlist({ ...config, extraHosts: session.allowHosts })
              : undefined,
          env: Object.keys(guestEnv).length ? guestEnv : undefined,
          planeId: config.workerPlaneId,
        });
        if (seed?.path) await client.uploadTree(vm.id, "workspace-seed", seed.path);
        if (share) await client.uploadTree(vm.id, "host-share", share);
      } catch (err) {
        if (vm) await client.destroy(vm.id).catch(() => undefined);
        if (fargate && session.remoteGuestId) {
          await this.compute.destroy(session.remoteGuestId, backend).catch(() => undefined);
          await this.patch(session.id, { remoteGuestId: undefined });
        }
        throw err;
      }
    }
    this.attachWorkerGuest(session, client, vm);
    await this.patch(sessionId, {
      vmId: vm.id,
      status: vm.status === "running" ? "idle" : "provisioning",
      error: undefined,
      ...(session.computeStartedAt ? {} : { computeStartedAt: now() }),
    });
    await this.persistVm(vm);
    this.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    this.hub.broadcast({ type: "session.updated", session: await this.require(sessionId) });
    await this.landStudioWorkspace(sessionId);

    return client.get(vm.id) ?? vm;
  }

  private async ensureWorkerHost(sessionId: string): Promise<VmInstance> {
    let session = await this.require(sessionId);
    const config = await this.store.loadConfig();
    const backend = (config.workers ?? []).find((row) => row.id === session.backendId);
    if (!backend) throw new Error("Worker was removed from Settings → Workers");
    if (workerProvisionsCompute(backend)) {
      session = await this.ensureFargateHandle(session, backend);
    }
    const client = await this.requireWorker(session);
    let vm = session.vmId ? client.get(session.vmId) : undefined;
    if (!vm && session.vmId) vm = await client.refresh(session.vmId);
    if (!vm) {
      vm = await client.create({
        sessionId,
        name: session.title,
        image: "host",
        os: session.os,
        templateId: session.templateId,
        runtime: "host",
        hostDir: session.hostDir?.trim() || undefined,
      });
    }
    this.attachWorkerGuest(session, client, vm);
    await this.patch(sessionId, {
      vmId: vm.id,
      status: isGuestReady(vm.status) ? "idle" : "provisioning",
      error: undefined,
      ...(session.computeStartedAt ? {} : { computeStartedAt: now() }),
    });
    await this.persistVm(vm);
    this.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    this.hub.broadcast({ type: "session.updated", session: await this.require(sessionId) });
    await this.landStudioWorkspace(sessionId);
    return client.get(vm.id) ?? vm;
  }

  private async startWorkerHost(sessionId: string): Promise<VmInstance> {
    let vm = await this.ensureWorkerHost(sessionId);
    const session = await this.require(sessionId);
    const client = await this.requireWorker(session);
    this.attachWorkerGuest(session, client, vm);
    if (isGuestReady(vm.status)) {
      await this.installGuestGitAuth(vm);
      await this.onVmStatus(vm.id, vm.status, vm.error);
      return vm;
    }
    vm = await client.start(vm.id);
    this.attachWorkerGuest(session, client, vm);
    await this.installGuestGitAuth(vm);
    await this.patch(sessionId, { vmId: vm.id, status: "provisioning", error: undefined });
    await this.persistVm(vm);
    this.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    await this.onVmStatus(vm.id, vm.status, vm.error);
    return vm;
  }

  private async ensureFargateHandle(
    session: AgentSession,
    backend: WorkerBackend,
  ): Promise<AgentSession> {
    if (session.remoteGuestId) {
      if (this.compute.get(session.remoteGuestId)) return session;
      await this.compute.destroy(session.remoteGuestId, backend).catch(() => undefined);
      session = await this.patch(session.id, { remoteGuestId: undefined });
    }
    const size = workerPickSize(backend, session.instanceSize);
    const quote = this.compute.quote(backend, size);
    const handle = await this.compute.provision({ backend, sessionId: session.id, size });
    try {
      const probe = new WorkerClient(
        {
          ...backend,
          url: handle.url,
          token: handle.token,
          fingerprint: handle.fingerprint ?? backend.fingerprint,
        },
        this.fetchFn === fetch ? undefined : (input, init) => this.fetchFn(input, init),
      );
      const health = await probe.health();
      if (health.fingerprint) handle.fingerprint = health.fingerprint;
      this.workers.set(`${backend.id}:${handle.id}`, probe);
    } catch {
      /* in-process mock workers still answer through fetchFn */
    }
    return this.patch(session.id, {
      remoteGuestId: handle.id,
      quotedUsdPerHour: quote.usdPerHour,
      instanceSize: size,
    });
  }

  private async startWorkerVm(sessionId: string): Promise<VmInstance> {
    let vm = await this.ensureWorkerVm(sessionId);
    const session = await this.require(sessionId);
    const client = await this.requireWorker(session);
    this.attachWorkerGuest(session, client, vm);
    if (isGuestReady(vm.status)) {
      await this.installGuestGitAuth(vm);
      return vm;
    }
    vm = await client.start(vm.id);
    this.attachWorkerGuest(session, client, vm);
    await this.keepGuestOrDestroy(sessionId, vm.id, client);
    await this.installGuestGitAuth(vm);
    await this.patch(sessionId, { vmId: vm.id, status: "provisioning", error: undefined });
    await this.persistVm(vm);
    this.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    await this.onVmStatus(vm.id, vm.status, vm.error);
    return vm;
  }

  private async ensureWorkerVm(sessionId: string): Promise<VmInstance> {
    let session = await this.require(sessionId);
    const config = await this.store.loadConfig();
    const backend = (config.workers ?? []).find((row) => row.id === session.backendId);
    if (!backend) throw new Error("Worker was removed from Settings → Workers");
    const template = config.templates.find((row) => row.id === session.templateId);
    if (!template) throw new Error("Template missing");
    if (workerProvisionsCompute(backend)) {
      session = await this.ensureFargateHandle(session, backend);
    }
    const client = await this.requireWorker(session);
    let vm = session.vmId ? client.get(session.vmId) : undefined;
    if (!vm && session.vmId) vm = await client.refresh(session.vmId);
    if (!vm) {
      const cap = workerMaxConcurrent(backend);
      if (cap != null) {
        const live = (await client.listGuests()).filter(
          (guest) => guest.status !== "stopped" && guest.status !== "error",
        ).length;
        if (live >= cap) {
          throw new Error(
            `Worker ${backend.name} already has ${cap} live guest${cap === 1 ? "" : "s"} (maxConcurrent)`,
          );
        }
      }
      const hardware = session.hardware ?? template.hardware;
      const seed = session.imageId
        ? (await this.store.loadImages()).find((i) => i.id === session.imageId)
        : undefined;
      if (session.imageId && !seed) throw new Error("Golden image not found");
      if (seed && imageRuntime(seed) !== "vm") {
        throw new Error("That golden image is a container workspace, not a VM disk");
      }
      let imagePath = seed?.path;
      if (seed?.path && session.imageId) {
        const remote = await client.hasGoldenDisk(session.imageId);
        if (remote?.path) imagePath = remote.path;
        else {
          const uploaded = await client.uploadGoldenDisk(session.imageId, seed.path);
          imagePath = uploaded.path;
        }
      }
      vm = await client.create({
        sessionId,
        name: session.title,
        image: "vm",
        os: session.os,
        templateId: session.templateId,
        runtime: "vm",
        template: { ...template, hardware },
        network: session.network ?? defaultNetworkJail(session.imageId),
        imagePath,
        planeId: config.workerPlaneId,
      });
    }
    this.attachWorkerGuest(session, client, vm);
    await this.patch(sessionId, {
      vmId: vm.id,
      status: isGuestReady(vm.status) ? "idle" : "provisioning",
      error: undefined,
      ...(session.computeStartedAt ? {} : { computeStartedAt: now() }),
    });
    await this.persistVm(vm);
    this.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    this.hub.broadcast({ type: "session.updated", session: await this.require(sessionId) });
    await this.landStudioWorkspace(sessionId);
    return client.get(vm.id) ?? vm;
  }

  private async startWorkerDocker(sessionId: string): Promise<VmInstance> {
    let vm = await this.ensureWorkerDocker(sessionId);
    const session = await this.require(sessionId);
    const client = await this.requireWorker(session);
    this.attachWorkerGuest(session, client, vm);
    if (isGuestReady(vm.status)) {
      await this.installGuestGitAuth(vm);
      return vm;
    }
    vm = await client.start(vm.id);
    this.attachWorkerGuest(session, client, vm);
    await this.keepGuestOrDestroy(sessionId, vm.id, client);
    await this.installGuestGitAuth(vm);
    await this.patch(sessionId, { vmId: vm.id, status: "provisioning", error: undefined });
    await this.persistVm(vm);
    this.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    await this.onVmStatus(vm.id, vm.status, vm.error);
    return vm;
  }

  private async ensureDocker(sessionId: string): Promise<VmInstance> {
    const session = await this.require(sessionId);
    if (sessionRuntime(session) !== "docker") {
      throw new Error(
        sessionRuntime(session) === "host"
          ? "Host agents do not have a VM or container."
          : "This agent is not a Docker session.",
      );
    }
    if (this.isWorkerSession(session)) return this.ensureWorkerDocker(sessionId);
    const dockerImage = parseDockerImage(session.dockerImage ?? "");
    if (!dockerImage) throw new Error("Enter a Docker image such as ubuntu:24.04");
    const config = await this.store.loadConfig();
    const share = config.advanced.hostSharePath?.trim();
    if (share) await mkdirShare(share);

    const seed = session.imageId
      ? (await this.store.loadImages()).find((i) => i.id === session.imageId)
      : undefined;
    if (session.imageId && !seed) throw new Error("Golden image not found");
    if (seed && imageRuntime(seed) !== "docker") {
      throw new Error("That golden image is a VM disk, not a container workspace");
    }

    let vm = session.vmId ? this.docker.get(session.vmId) : undefined;
    if (!vm && session.vmId && this.docker.adopt) {
      const persisted = (await this.store.loadVms()).find((v) => v.id === session.vmId);
      if (persisted) vm = this.docker.adopt(persisted);
    }
    if (!vm) {
      const seedEnv = await loadWorkspaceEnvironment(seed?.path);
      const forge = this.sessionForge(config, session);
      const guestEnv: Record<string, string> = {
        ...(seedEnv?.env ?? {}),
        ...(session.guestEnv ?? {}),
      };
      const freshForge = forge
        ? await withFreshForgeToken(this.store, forge, this.fetchFn)
        : undefined;
      if (
        freshForge?.token &&
        !guestEnv.GIT_TOKEN &&
        !guestEnv.GITHUB_TOKEN &&
        !guestEnv.GITLAB_TOKEN &&
        !guestEnv.BITBUCKET_TOKEN
      ) {
        guestEnv.GIT_TOKEN = freshForge.token;
      }
      vm = await this.docker.create({
        sessionId,
        name: session.title,
        image: dockerImage,
        os: session.os,
        templateId: session.templateId,
        hostSharePath: share || undefined,
        workspaceSeed: seed?.path,
        network: session.network ?? defaultNetworkJail(session.imageId),
        env: Object.keys(guestEnv).length ? guestEnv : undefined,
      });
    }
    const jail = session.network ?? defaultNetworkJail(session.imageId);
    if (jail === "restricted") {
      const proxy = await this.ensureProxy(sessionId);
      this.docker.configureNetwork?.(vm.id, jail, proxy.port);
    } else {
      this.closeProxy(sessionId);
      this.docker.configureNetwork?.(vm.id, jail);
    }
    await this.patch(sessionId, {
      vmId: vm.id,
      status: vm.status === "running" ? "idle" : "provisioning",
      error: undefined,
    });
    await this.persistVm(vm);
    this.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    this.hub.broadcast({ type: "session.updated", session: await this.require(sessionId) });
    return this.docker.get(vm.id) ?? vm;
  }

  private async startDocker(sessionId: string): Promise<VmInstance> {
    const current = await this.require(sessionId);
    if (this.isWorkerHost(current)) return this.startWorkerHost(sessionId);
    if (this.isWorkerSession(current)) return this.startWorkerDocker(sessionId);
    let vm = await this.ensureDocker(sessionId);
    if (vm.status === "running" || vm.status === "ready" || vm.status === "booting") {
      await this.installGuestGitAuth(vm);
      return vm;
    }
    vm = await this.docker.start(vm.id);
    await this.keepGuestOrDestroy(sessionId, vm.id, this.docker);
    await this.installGuestGitAuth(vm);
    const session = await this.require(sessionId);
    if (!isCanvasSession(session) && (!session.repo?.url || this.cloned.has(sessionId))) {
      await this.applyWorkspaceEnvironment(sessionId, vm);
    }
    await this.patch(sessionId, { vmId: vm.id, status: "provisioning", error: undefined });
    await this.persistVm(vm);
    this.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    return vm;
  }

  private async startQemuVm(sessionId: string): Promise<VmInstance> {
    const session = await this.require(sessionId);
    const config = await this.store.loadConfig();
    const template = config.templates.find((t) => t.id === session.templateId);
    if (!template) throw new Error("Template missing");
    const hardware = session.hardware ?? template.hardware;
    const isoError = this.hypervisor.isoError?.(template, { imageId: session.imageId });
    if (isoError) throw new Error(isoError);

    const existing = this.hypervisor
      .list()
      .filter((v) => (v.status === "running" || v.status === "booting") && v.id !== session.vmId);
    if (existing.length >= config.advanced.maxConcurrentVms) {
      throw new Error(`Max concurrent VMs reached (${config.advanced.maxConcurrentVms})`);
    }

    const share = config.advanced.hostSharePath?.trim();
    if (share) await mkdirShare(share);
    const image = session.imageId
      ? (await this.store.loadImages()).find((i) => i.id === session.imageId)
      : undefined;
    if (session.imageId && !image) throw new Error("Golden image not found");

    let vm = session.vmId ? this.hypervisor.get(session.vmId) : undefined;
    if (!vm && session.vmId && this.hypervisor.adopt) {
      const persisted = (await this.store.loadVms()).find((v) => v.id === session.vmId);
      if (persisted) {
        vm = this.hypervisor.adopt(
          persisted,
          { ...template, hardware },
          {
            imagePath: image?.path,
            hostSharePath: share || undefined,
          },
        );
      }
    }
    if (!vm) {
      vm = await this.hypervisor.create({
        sessionId,
        name: session.title,
        template: { ...template, hardware },
        slot: this.hypervisor.nextSlot(),
        imagePath: image?.path,
        hostSharePath: share || undefined,
      });
    }
    if (!vm) throw new Error("VM not found");
    if (session.imageId) vm.imageId = session.imageId;
    const jail = session.network ?? defaultNetworkJail(session.imageId);
    let proxyPort: number | undefined;
    if (jail === "restricted") proxyPort = (await this.ensureProxy(sessionId)).port;
    else this.closeProxy(sessionId);
    this.hypervisor.configureNetwork?.(vm.id, jailNetworking(jail, proxyPort));
    if (
      vm &&
      (vm.status === "running" ||
        vm.status === "ready" ||
        vm.status === "booting" ||
        vm.status === "installing")
    ) {
      await this.patch(sessionId, {
        vmId: vm.id,
        status: vm.status === "running" ? "idle" : "provisioning",
      });
      await this.persistVm(vm);
      this.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
      return vm;
    }
    vm = await this.hypervisor.start(vm.id);
    await this.patch(sessionId, { vmId: vm.id, status: "provisioning", error: undefined });
    await this.persistVm(vm);
    this.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    return vm;
  }

  async stopVm(sessionId: string): Promise<void> {
    const session = await this.require(sessionId);
    if (this.isWorkerSession(session)) {
      const client = await this.requireWorker(session);
      const config = await this.store.loadConfig();
      const backend =
        (config.workers ?? []).find((row) => row.id === session.backendId) ?? client.backend;
      if (workerDestroyOnStop(backend)) {
        await this.destroyWorkerGuest(session);
        return;
      }
      if (!session.vmId) return;
      const vm = await client.stop(session.vmId);
      this.closeProxy(sessionId);
      this.closeIdeTunnel(sessionId);
      await this.patch(sessionId, {
        status: "stopped",
        computeMs: sessionComputeMs(session),
        computeStartedAt: undefined,
      });
      await this.persistVm(vm);
      this.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
      await this.onVmStatus(vm.id, vm.status, vm.error);
      return;
    }
    if (!session.vmId) return;
    const vm = await this.engine(session).stop(session.vmId);
    this.closeProxy(sessionId);
    this.closeIdeTunnel(sessionId);
    await this.patch(sessionId, { status: "stopped" });
    await this.persistVm(vm);
    this.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
  }

  async pauseVm(sessionId: string): Promise<VmInstance> {
    const session = await this.require(sessionId);
    if (this.isWorkerSession(session)) throw new Error("Pause is not available on a worker guest");
    if (!session.vmId) throw new Error("Start the machine before pausing");
    const engine = this.engine(session);
    const vm = await engine.pause(session.vmId);
    await this.persistVm(vm);
    this.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    return vm;
  }

  async resumeVm(sessionId: string): Promise<VmInstance> {
    const session = await this.require(sessionId);
    if (this.isWorkerSession(session)) throw new Error("Resume is not available on a worker guest");
    if (!session.vmId) throw new Error("Start the machine before resuming");
    const engine = this.engine(session);
    const resume = engine.resume?.bind(engine);
    if (!resume) throw new Error("This runtime cannot resume");
    const vm = await resume(session.vmId);
    await this.persistVm(vm);
    this.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    return vm;
  }

  async vmLogs(sessionId: string): Promise<string> {
    const session = await this.require(sessionId);
    if (!session.vmId) return "";
    if (this.isWorkerSession(session)) {
      return (await this.requireWorker(session)).logs(session.vmId);
    }
    return this.engine(session).logs(session.vmId);
  }

  logsForMachine(vmId: string): string {
    if (this.hypervisor.get(vmId)) return this.hypervisor.logs(vmId);
    if (this.docker.get(vmId)) return this.docker.logs(vmId);
    return "";
  }

  async remove(sessionId: string): Promise<void> {
    const session = await this.require(sessionId);
    await this.killBackgroundProcesses(session).catch(() => undefined);
    this.guestBoot.dropExpected(sessionId);
    this.closeProxy(sessionId);
    this.closeIdeTunnel(sessionId);
    if (session.vmId) {
      this.guests.drop(session.vmId);
      if (this.isWorkerSession(session)) {
        await (
          await this.requireWorker(session).catch(() => undefined)
        )
          ?.destroy(session.vmId)
          .catch(() => undefined);
      } else {
        if (sessionRuntime(session) === "docker" && !this.docker.get(session.vmId)) {
          const persisted = (await this.store.loadVms()).find((row) => row.id === session.vmId);
          if (persisted) this.docker.adopt?.(persisted);
        }
        await this.engine(session)
          .destroy(session.vmId)
          .catch(() => undefined);
      }
      await this.store.deleteVm(session.vmId).catch(() => undefined);
    }
    this.guests.drop(`host:${sessionId}`);
    if (sessionRuntime(session) === "host") {
      await rm(hostWorkspaceDir(this.store.dataDir, sessionId), {
        recursive: true,
        force: true,
      }).catch(() => undefined);
    }
    await rm(join(this.store.dataDir, "checkpoints", sessionId), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
    await rm(join(this.store.dataDir, "traces", `${sessionId}.jsonl`), { force: true }).catch(
      () => undefined,
    );
    this.clearThinking(sessionId);
    this.repoMapCache.delete(sessionId);
    await rm(indexCacheDir(this.store.dataDir, sessionId), { recursive: true, force: true }).catch(
      () => undefined,
    );
    await rm(workerMirrorDir(this.store.dataDir, sessionId), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
    await rm(vmTreeDir(this.store.dataDir, sessionId), { recursive: true, force: true }).catch(
      () => undefined,
    );
    await rm(hostChromeProfileDir(this.store.dataDir, sessionId), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
    await rm(hostChromeProfileDir(this.store.dataDir, `${sessionId}-pw`), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
    await rm(join(dockerWorkspaceDir(this.store.dataDir, sessionId), LOCUS_CHROME_PROFILE_DIR), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
    await this.agentCanvases.remove(sessionId);
    await this.store.deleteSession(sessionId);
    this.hub.broadcast({ type: "session.deleted", id: sessionId });
  }

  async appendMessage(sessionId: string, message: ChatMessage): Promise<AgentSession> {
    if (message.screenshotBase64) {
      const name = `${message.id}.png`;
      try {
        await writeScreenshot(this.store.dataDir, sessionId, name, message.screenshotBase64);
        message.screenshotName = name;
      } catch {
        /* keep the in-memory screenshot for this process */
      }
    }
    if (message.images?.length) {
      const images: ChatImage[] = [];
      for (let i = 0; i < message.images.length; i += 1) {
        const img = message.images[i]!;
        if (!img.base64) {
          images.push(img);
          continue;
        }
        const name = img.name && /\.png$/i.test(img.name) ? img.name : `${message.id}-img-${i}.png`;
        try {
          await writeScreenshot(this.store.dataDir, sessionId, name, img.base64);
          images.push({ mime: img.mime || "image/png", name, base64: img.base64 });
        } catch {
          images.push(img);
        }
      }
      message.images = images;
    }
    const session = await this.store.mutateSession(sessionId, (current) => {
      current.messages.push(message);
    });
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    this.hub.broadcast({ type: "chat.message", sessionId, message });
    this.hub.broadcast({ type: "session.updated", session });
    return session;
  }

  async sendChat(
    sessionId: string,
    content: string,
    opts?: {
      plan?: boolean;
      skill?: string;
      steer?: boolean;
      /** Abort a running turn and start this prompt as a new turn instead of queueing. */
      interrupt?: boolean;
      attachments?: IncomingAttachment[] | ChatAttachment[];
      /** Open editor path; ranks that file first in the repo map. */
      focusPath?: string;
      /** Asset session ids to copy into vendor/assets (Game/Design). */
      assetRefs?: string[];
      /** When this peer turn ends / needs_you / fails, wake this session asynchronously. */
      notifySessionId?: string;
      /**
       * When false with notifySessionId, post the peer reply on the shared
       * transcript without a coordinator LLM turn for ordinary `done`.
       */
      wakeRequester?: boolean;
    },
  ): Promise<void> {
    const session = await this.require(sessionId);
    const incoming = (opts?.attachments ?? []).filter((row): row is IncomingAttachment =>
      Boolean(
        row &&
        typeof row === "object" &&
        "contentBase64" in row &&
        typeof (row as IncomingAttachment).contentBase64 === "string",
      ),
    );
    const storedOnly = (opts?.attachments ?? []).filter((row): row is ChatAttachment =>
      Boolean(row && typeof row === "object" && "storedName" in row && !("contentBase64" in row)),
    );
    const capError = chatInputError(content, incoming.length + storedOnly.length);
    if (capError) throw new Error(capError);
    const attachments = incoming.length
      ? await persistChatAttachments(
          this.store.dataDir,
          sessionId,
          incoming,
          this.attachmentWorkspaceRoot(session),
        )
      : storedOnly;
    if (attachments.length && !this.repoWorkspaceClonePending(session)) {
      await this.syncChatAttachments(sessionId);
    }
    let body = applyAttachmentPromptNote(content, attachments);
    if (!body) throw new Error("Empty message");
    const notifySessionId = opts?.notifySessionId?.trim();
    const turning = session.status === "running" || this.aborts.has(sessionId);
    if (!opts?.skill && !opts?.plan) {
      const config = await this.store.loadConfig();
      const skills = mergeSkills(config.skills, await this.repoSkills(session));
      const hit = parseSkillCommand(body, skills, BUILTIN_SLASH_NAMES);
      if (hit) body = formatSkillPrompt(hit.skill, hit.rest);
    }
    if (turning) {
      if (opts?.interrupt) {
        this.haltTurn(sessionId);
        await this.resetRunningPlanSteps(sessionId);
        void this.cancelCursorCloudRun(sessionId);
      } else if (opts?.steer) {
        await this.appendSteer(sessionId, body, attachments, incoming);
        this.cursorCliSpawnAborts.get(sessionId)?.abort();
        this.llmStreamAborts.get(sessionId)?.abort();
        return;
      } else {
        const last = lastUserMessage(session.messages);
        if (
          !attachments.length &&
          (last?.content.trim() === body || this.pendingTurnPrompt.get(sessionId) === body)
        ) {
          return;
        }
        await this.enqueuePrompt(sessionId, content.trim(), { ...opts, attachments });
        return;
      }
    }
    const epoch = (this.turnEpoch.get(sessionId) ?? 0) + 1;
    this.turnEpoch.set(sessionId, epoch);
    this.aborts.get(sessionId)?.abort();
    const abort = new AbortController();
    this.aborts.set(sessionId, abort);
    this.pendingTurnPrompt.set(sessionId, body);
    try {
      await this.store.mutateSession(sessionId, (current) => {
        current.control = undefined;
        current.needsHuman = undefined;
        applyRequestedDefaultSubagent(current, content.trim());
        applyPromptTitle(current, content);
      });
      // Publish the user turn before snapshotTurn (disk/workspace copy) so the
      // composer does not sit empty while rewind state is captured.
      const rewindAt = (await this.require(sessionId)).messages.length;
      let image = firstImageBase64(incoming);
      let imageMime = image
        ? incoming.find((item) => item.mime.startsWith("image/"))?.mime
        : undefined;
      if (!image && attachments.length) {
        const stored = await storedImageBase64(this.store.dataDir, sessionId, attachments);
        image = stored?.base64;
        imageMime = stored?.mime;
      }
      const linked = await this.linkTurnAssets(sessionId, body, opts?.assetRefs);
      if (linked.note) body = `${body}\n\n${linked.note}`;
      const peerNote = await hostSessionMentionNote(session, body, {
        loadSessions: () => this.store.loadSessions(),
        workspaceRoot: (row) => this.workspaceRoot(row),
      });
      if (peerNote) body = `${body}\n\n${peerNote}`;
      const images = image
        ? [
            { base64: image, mime: imageMime ?? "image/png" },
            ...linked.images.filter((img) => img.base64 !== image),
          ]
        : linked.images;
      const first = images[0];
      const user: ChatMessage = {
        id: randomUUID(),
        role: "user",
        content: body,
        attachments: attachments.length ? attachments : undefined,
        screenshotBase64: first?.base64 ?? image,
        screenshotMime: first?.mime ?? (image ? imageMime : undefined),
        images: images.length ? images : undefined,
        createdAt: now(),
      };
      await this.appendMessage(sessionId, user);
      await this.dropDuplicateQueuedPrompt(sessionId, body, attachments.length > 0);
      this.pendingTurnPrompt.delete(sessionId);
      if (notifySessionId && notifySessionId !== sessionId) {
        this.peerHandoffs.set(sessionId, {
          requesterId: notifySessionId,
          task: body.slice(0, 500),
          wakeRequester: opts?.wakeRequester !== false,
        });
      }
      await this.patch(sessionId, { status: "running" });
      await this.snapshotTurn(sessionId, rewindAt);
      void this.runAgentLoop(sessionId, body, abort, epoch, Boolean(opts?.plan), opts?.focusPath);
    } catch (err) {
      this.pendingTurnPrompt.delete(sessionId);
      if (this.aborts.get(sessionId) === abort) this.aborts.delete(sessionId);
      throw err;
    }
  }

  private rememberCreateAssetIds(sessionId: string, extraIds?: string[]): void {
    const ids = parseAssetRefIds(extraIds);
    if (ids.length) this.pendingCreateAssetIds.set(sessionId, ids);
  }

  private async linkCreateAssets(sessionId: string, extraIds?: string[]): Promise<void> {
    const session = await this.require(sessionId);
    if (!canLinkAssetSessions(session.kind)) return;
    const wanted = [
      ...(session.assetRefs ?? []).map((row) => ({ sessionId: row.sessionId, slug: row.slug })),
      ...parseAssetRefIds(extraIds).map((id) => ({ sessionId: id })),
    ];
    if (!wanted.length) return;
    await this.design.linkAssetPacks(sessionId, wanted).catch(() => undefined);
  }

  private async linkTurnAssets(
    sessionId: string,
    content: string,
    extraIds?: string[],
  ): Promise<{ note: string; images: ChatImage[] }> {
    const session = await this.require(sessionId);
    if (!canLinkAssetSessions(session.kind)) return { note: "", images: [] };
    const sessions = await this.store.loadSessions();
    const mentioned = parseAssetMentions(content);
    const ids = [...parseAssetRefIds(extraIds)];
    for (const slug of mentioned) {
      const hit = resolveAssetMention(slug, sessions);
      if (hit && !ids.includes(hit.id)) ids.push(hit.id);
    }
    const wanted = [
      ...(session.assetRefs ?? []).map((row) => ({ sessionId: row.sessionId, slug: row.slug })),
      ...ids.map((id) => ({ sessionId: id })),
    ];
    if (!wanted.length) return { note: "", images: [] };
    const linked = await this.design.linkAssetPacks(sessionId, wanted).catch(() => null);
    if (!linked?.prompts.length) return { note: "", images: [] };
    const mentionedSlugs = new Set(mentioned.map((slug) => slug.toLowerCase()));
    const newly = linked.prompts.filter(
      (row) =>
        mentionedSlugs.has(row.slug.toLowerCase()) ||
        ids.includes(
          sessions.find((item) => item.assetPack?.slug === row.slug)?.id ??
            linked.refs.find((ref) => ref.slug === row.slug)?.sessionId ??
            "",
        ),
    );
    const images = newly.length ? linked.images.filter((img) => img.base64) : [];
    const note = newly.length
      ? `Linked ${newly.map((row) => `@asset:${row.slug}`).join(", ")} into /workspace/vendor/assets/. Load those files; do not redraw them.`
      : "";
    return { note, images };
  }

  private async linkedAssetsPrompt(session: AgentSession): Promise<string> {
    if (!canLinkAssetSessions(session.kind) || !session.assetRefs?.length) return "";
    try {
      const file = await this.workspace.readWorkspace(session.id, LINKED_ASSETS_INDEX);
      const parsed = JSON.parse(file.content) as { assets?: unknown };
      const assets = Array.isArray(parsed.assets) ? parsed.assets : [];
      const prompts = assets
        .map(parseLinkedAssetPrompt)
        .filter((row): row is NonNullable<typeof row> => Boolean(row));
      if (prompts.length) return formatLinkedAssetsPrompt(prompts);
    } catch {
      /* fall through to session refs */
    }
    return formatLinkedAssetsPrompt(
      session.assetRefs.map((row) => ({
        slug: row.slug,
        title: row.title || row.slug,
        kind: isAssetPackKind(row.kind) ? row.kind : "sprite",
        dir: `vendor/assets/${row.slug}`,
        files: [],
        clips: [],
      })),
    );
  }

  private async runAgentLoop(
    sessionId: string,
    userText: string,
    abort: AbortController,
    epoch: number,
    planTurn = false,
    focusPath?: string,
  ): Promise<void> {
    let lastReplyId = "";
    let usedAllRounds = false;
    let emptyRetries = 0;
    let canvasNudges = 0;
    let canvasIncompleteNudges = 0;
    let gameUnplayableNudges = 0;
    let gamePlaywrightNudges = 0;
    let gameWipeNudges = 0;
    let unusedLinkedAssetNudges = 0;
    let designMutateNudges = 0;
    let designQualityNudges = 0;
    let gameJuiceNudges = 0;
    let assetSculptNudges = 0;
    let adherenceNudges = 0;
    let canvasMutatedThisTurn = false;
    let selfCorrects = 0;
    let approvals = 0;
    let searchRounds = 0;
    let calledOps = false;
    let opsRoutingNudges = 0;
    let mutatedThisTurn = false;
    let verifiedThisTurn = false;
    let searchWanderNudges = 0;
    let verifyNudges = 0;
    let calledPlaywrightThisTurn = false;
    let calledReview = false;
    let reviewRoutingNudges = 0;
    let reviewVerdictNudges = 0;
    const namedOps = looksLikeOpsPrompt(userText);
    const startedAtMs = Date.now();
    const turnId = `${epoch}`;
    this.turnSubagents.set(sessionId, 0);
    this.turnStartedAt.set(sessionId, startedAtMs);
    const stale = () => this.turnEpoch.get(sessionId) !== epoch;
    const stop = () => stale() || abort.signal.aborted;
    try {
      const bootConfig = await this.store.loadConfig();
      const session0 = await this.require(sessionId);
      const taskListAtPlanStart = (session0.taskList ?? []).map((row) => ({ ...row }));
      const cursorProvider = bootConfig.providers.find((p) => p.id === session0.providerId);
      const cursorCloud = Boolean(cursorProvider && isCursorProvider(cursorProvider));
      const cursorCli = Boolean(cursorProvider && isCursorCliProvider(cursorProvider));
      const claudeCode = Boolean(cursorProvider && isClaudeCodeProvider(cursorProvider));
      const codexCli = Boolean(cursorProvider && isCodexCliProvider(cursorProvider));
      const kiroCli = Boolean(cursorProvider && isKiroCliProvider(cursorProvider));
      if (!planTurn && !cursorCloud) {
        await this.startGuestIfNeeded(sessionId);
        await this.waitForGuestIfStarting(sessionId, abort);
        await this.cloneRepoIfNeeded(sessionId);
        await this.syncChatAttachments(sessionId);
      }
      if (stop()) return;
      await this.traces.write({
        t: now(),
        kind: "turn.start",
        sessionId,
        turnId,
        detail: userText.slice(0, 500),
      });
      if (cursorCloud) {
        lastReplyId = await this.runCursorCloudTurn({
          sessionId,
          userText,
          abort,
          turnId,
          planTurn,
          stop,
        });
        if (!stop()) {
          await this.finishPlanTurnIfNeeded(sessionId, lastReplyId, planTurn, taskListAtPlanStart);
        }
        if (!stop() && !planTurn) await this.design.finishTurn(sessionId);
        return;
      }
      if (cursorCli || claudeCode || codexCli || kiroCli) {
        lastReplyId = await this.runHostCliTurn({
          sessionId,
          userText,
          abort,
          turnId,
          planTurn,
          stop,
          kind: cursorCli ? "cursor" : claudeCode ? "claude" : kiroCli ? "kiro" : "codex",
        });
        if (!stop()) {
          await this.finishPlanTurnIfNeeded(sessionId, lastReplyId, planTurn, taskListAtPlanStart);
        }
        if (!stop() && !planTurn) await this.design.finishTurn(sessionId);
        return;
      }
      if (!planTurn && !stop()) {
        const booted = await this.require(sessionId);
        const docker = sessionRuntime(booted) === "docker";
        const machine = booted.vmId ? this.getMachine(booted.vmId) : undefined;
        const expectedGuest =
          docker || Boolean(booted.vmId) || this.guestBoot.hasInflight(sessionId);
        if (expectedGuest && !isGuestReady(machine?.status)) {
          const detail = booted.error || machine?.error;
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: docker
              ? `The container did not become ready, so this turn did not run.${detail ? ` ${detail}` : ""}`
              : `The VM did not become ready, so this turn did not run.${detail ? ` ${detail}` : " Start it from the toolbar and send the prompt again."}`,
            createdAt: now(),
          });
          return;
        }
      }
      if (!planTurn && isGameSession(await this.require(sessionId))) {
        const prefix = await this.primeGameTurn(sessionId, userText);
        await this.appendMessage(sessionId, {
          id: randomUUID(),
          role: "system",
          content: prefix,
          hidden: true,
          createdAt: now(),
        });
      } else if (!planTurn && isAssetSession(await this.require(sessionId))) {
        await this.snapshotStudioBaseline(sessionId);
        const prefix = await this.primeAssetTurn(sessionId, userText);
        await this.appendMessage(sessionId, {
          id: randomUUID(),
          role: "system",
          content: prefix,
          hidden: true,
          createdAt: now(),
        });
      } else if (!planTurn && isDesignSession(await this.require(sessionId))) {
        const prefix = await this.primeDesignTurn(sessionId);
        await this.appendMessage(sessionId, {
          id: randomUUID(),
          role: "system",
          content: prefix,
          hidden: true,
          createdAt: now(),
        });
      }
      const opened = await this.store.loadConfig();
      const MAX_ROUNDS = agentRoundLimit(opened.advanced.maxAgentRounds);
      const mentionFocus = fileMentions(userText)[0];
      const repoFocus = mentionFocus || focusPath;
      let advertisedPromptTools: Array<{ name: string; description: string }> | undefined;
      let advertisedExtraTools: ExtraToolDef[] | undefined;
      for (let round = 0; MAX_ROUNDS == null || round < MAX_ROUNDS; round++) {
        if (stop()) break;
        if (!planTurn) await this.pollBackgroundProcesses(sessionId);
        const session = await this.require(sessionId);
        const vm = session.vmId ? this.getMachine(session.vmId) : undefined;
        const config = await this.store.loadConfig();
        const provider = config.providers.find((p) => p.id === session.providerId);
        const guestReady = isGuestReady(vm?.status);
        const runtime = sessionRuntime(session);
        const toolsReady = runtime === "host" || guestReady;
        const allTools = configuredToolsForRuntime(session.os, runtime, config.integrations).filter(
          (t) => {
            if (session.allowedTools?.length && !session.allowedTools.includes(t.name))
              return false;
            if (isIntegrationToolName(t.name) && !automationAllowsIntegration(session, t.name))
              return false;
            if (isProjectToolName(t.name)) {
              if (isProjectSession(session)) return true;
              if (!session.projectId) return false;
              return (PROJECT_MEMBER_TOOLS as readonly string[]).includes(t.name);
            }
            if (isSwarmTeamToolName(t.name)) {
              if (parseSessionSurface(session.surface) !== "swarm") return false;
              if (t.name === "team_add_teammate") {
                return isCoordinatorHubRole(session.persona?.hubRole) || isProjectSession(session);
              }
              return true;
            }
            return true;
          },
        );
        const tools = allTools.filter((t) => {
          if (planTurn && !isPlanReadTool(t.name) && t.name !== "exec" && t.name !== "powershell")
            return false;
          if (!toolsReady && toolNeedsGuest(t.name)) return false;
          return true;
        });
        const policy = this.policyFor(session, config);
        const tier = sessionAutonomy(session.autonomy, config.advanced.autonomy);
        const cap = resolveSpendCapUsd(tier, session.maxUsd, config.advanced.maxUsdPerTurn);
        const timeCap = session.maxMs ?? config.advanced.maxMsPerTurn;
        const spend = taskSpendNow({
          startedAtMs,
          round: round + 1,
          usage: session.usage,
          rates: resolveUsageRates(provider, session.model),
          subagents: this.turnSubagents.get(sessionId) ?? 0,
          computeUsd: workerComputeUsd(
            session,
            (config.workers ?? []).find((row) => row.id === session.backendId),
          ),
        });
        const verdict = checkBudget(spend, { maxUsd: cap, maxMs: timeCap, maxRounds: MAX_ROUNDS });
        if (!verdict.ok) {
          await this.reportBudgetStop(sessionId, turnId, round, session, verdict.message);
          break;
        }
        const skills = mergeSkills(config.skills, await this.repoSkills(session));
        const allowAskUser = !session.automationId && !this.inSubagent.has(sessionId);
        const mcpPromptTools = this.mcp.promptTools(sessionId).filter((t) => {
          if (session.automationId) {
            if (isMcpMetaToolName(t.name)) return (session.allowedMcpTools ?? []).length > 0;
            return (session.allowedMcpTools ?? []).includes(t.name);
          }
          if (session.allowedTools?.length && !session.allowedTools.includes(t.name)) {
            if (
              isMcpMetaToolName(t.name) &&
              session.allowedTools.some((name) => isMcpToolName(name))
            )
              return true;
            return false;
          }
          return true;
        });
        const extraInput = {
          planTurn,
          isDesign: isCanvasSession(session),
          isProject: isProjectSession(session),
          isHost: sessionOffersHostSessions(session),
          inSubagent: this.inSubagent.has(sessionId),
          webSearch: sessionWebSearch(session),
          hasSkills: skills.length > 0,
          allowAskUser,
          persistMemory: sessionOffersRemember(session),
          offerBrain: sessionOffersBrain(session),
          mcpTools: mcpPromptTools,
          pluginTools: this.pluginPromptTools(session, config),
        };
        const extraFrozen = freezePromptTools(advertisedExtraTools, parentExtraTools(extraInput));
        advertisedExtraTools = extraFrozen.advertised;
        const extraTools = extraFrozen.tools;
        const memories = await this.sessionMemoryPrompt(session);
        const rules = await loadWorkspaceRules(this.repoContextRoot(session));
        const pins = (session.designPins ?? [])
          .map((pin) => `- ${pin.selector}${pin.text ? `: ${pin.text}` : ""} (${pin.viewport})`)
          .join("\n");
        const designSystem = isDesignSession(session)
          ? resolveDesignSystem(session.designSystemId, await this.store.loadDesignSystems())
          : undefined;
        const assetStyle = isAssetSession(session)
          ? resolveAssetStyle(session.assetStyleId, await this.store.loadAssetStyles())
          : undefined;
        const gameStyle = isGameSession(session)
          ? resolveGameStyle(session.gameStyleId, await this.store.loadGameStyles())
          : undefined;
        const assetBuild = isAssetSession(session)
          ? resolveAssetBuild(session.assetBuild)
          : undefined;
        let kitSkill = "";
        if (designSystem?.kit?.skillName) {
          const hit = (await this.repoSkills(session)).find(
            (row) => row.name === designSystem.kit?.skillName,
          );
          if (hit) kitSkill = formatSkillPrompt(hit).slice(0, 12_000);
        }
        const promptToolsRaw = [
          ...allTools,
          ...stablePromptExtraTools(extraInput),
          ...mcpPromptTools,
        ];
        const frozen = freezePromptTools(advertisedPromptTools, promptToolsRaw);
        advertisedPromptTools = frozen.advertised;
        const promptParts = buildSystemPromptParts({
          os: session.os,
          runtime,
          kind: sessionKind(session),
          dockerImage: session.dockerImage,
          vmStatus: vm?.status,
          repoUrl: session.repo?.url,
          repoRef: session.repo?.ref,
          repos: sessionRepoCheckouts(session),
          tools: frozen.tools,
          instructions: composePersonaInstructions(session.instructions, session.persona, {
            surface: session.surface,
          }),
          rules,
          playbook: session.playbook,
          palette: session.palette,
          designSystem,
          assetStyle,
          gameStyle,
          assetBuild,
          kitSkill,
          skillCatalog: formatSkillCatalog(skills),
          pluginCatalog: formatPluginCatalog(config.integrationPlugins),
          mcpCatalog: this.mcp.connectorCards(sessionId),
          vision: sessionVision(session),
          webSearch: sessionWebSearch(session),
          liveChrome: sessionLiveChrome(session),
          plan: planTurn,
          memories,
          persistMemory: sessionOffersRemember(session),
          brainHint: sessionOffersBrain(session),
          designPins: pins,
          automation: Boolean(session.automationId),
          mcpAutoAllow: Boolean(session.automationId && session.allowedMcpTools?.length),
          model: session.model,
          autonomy: sessionAutonomy(session.autonomy, config.advanced.autonomy),
          defaultSubagent: session.defaultSubagent,
          linkedAssets: await this.linkedAssetsPrompt(session),
        });
        const system = promptParts.stable;

        const replyId = randomUUID();
        lastReplyId = replyId;
        if (stop()) break;
        await this.appendMessage(sessionId, {
          id: replyId,
          role: "assistant",
          content: "",
          createdAt: now(),
        });

        const compacted = compactMessages(
          await this.hydrateScreenshots(
            sessionId,
            (await this.require(sessionId)).messages.filter((m) => m.id !== replyId && !m.compact),
            sessionVision(session),
          ),
          {
            vision: sessionVision(session),
            maxShots: session.visionFrames ?? 1,
          },
        );
        const workingState = sessionWorkingState(session);
        let projectContext = "";
        if (session.projectId && this.projects) {
          try {
            projectContext = await this.projects.contextPrompt(session.projectId);
          } catch {
            /* deleted or unreadable project */
          }
        }
        const workingText = [
          formatWorkingState(workingState),
          formatSubscriptionsPrompt(session.subscriptions),
          projectContext,
        ]
          .filter(Boolean)
          .join("\n\n");
        const repoMap = isProjectSession(session)
          ? undefined
          : await this.repoMapPrefix(session, userText, repoFocus);
        const charsPerToken = session.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
        const { window, reserved, budget } = this.contextBudgetFor(session, provider);
        const prefixTokens = estimateTokensFromChars(
          system.length + (repoMap?.length ?? 0),
          charsPerToken,
        );
        const folded = foldOldTurns(compacted, budget, {
          workingState,
          charsPerToken,
          prefixTokens,
          measuredInputTokens: session.context?.measured ? session.context.used : undefined,
          inspectedFiles: session.inspectedFiles,
        });
        if (
          folded.inspectedFiles &&
          folded.inspectedFiles.join("\0") !== (session.inspectedFiles ?? []).join("\0")
        ) {
          await this.patch(sessionId, { inspectedFiles: folded.inspectedFiles });
        }
        let compactBody = folded.note;
        let compactSource: "llm" | "heuristic" | undefined;
        if (folded.note) {
          compactSource = "heuristic";
          if (
            folded.dropped &&
            shouldAttemptLlmCompact(folded.dropped) &&
            provider &&
            hasUsableKey(provider.apiKey, provider.baseUrl, provider.kind) &&
            !stop()
          ) {
            const llmNote = await this.tryLlmCompact({
              session,
              provider,
              dropped: folded.dropped,
              workingState,
              inspectedFiles: folded.inspectedFiles,
              abort,
            });
            if (llmNote) {
              compactBody = llmNote;
              compactSource = "llm";
            }
          }
          await this.traces.write({
            t: now(),
            kind: "compact",
            sessionId,
            turnId,
            round,
            inputTokens: folded.beforeTokens,
            outputTokens: folded.afterTokens,
            detail: compactBody,
            args: {
              beforeTokens: folded.beforeTokens,
              afterTokens: folded.afterTokens,
              source: compactSource,
            },
          });
          const notice = {
            dropped: folded.dropped?.length ?? 0,
            beforeTokens: folded.beforeTokens,
            afterTokens: folded.afterTokens,
            source: compactSource,
          };
          await this.patch(sessionId, { lastCompact: notice });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: formatCompactNotice(notice),
            compact: notice,
            createdAt: now(),
          });
        }
        const compactNote = [
          promptParts.volatile,
          compactBody,
          verdict.warn && verdict.message ? verdict.message : "",
          compactLoopWallNotes({
            canvasSnapshot:
              !planTurn && isCanvasSession(session) ? await this.liveCanvasSnapshot(session) : "",
            canvasNudges,
            canvasIncompleteNudges,
            designMutateNudges,
            gamePlaywrightNudges,
            gameUnplayableNudges,
            designQualityNudges,
            hostFallback:
              !planTurn && isCanvasSession(session)
                ? looksHostFallbackCanvas(
                    (await this.design.readCanvas(sessionId).catch(() => ({ html: null }))).html,
                  )
                : false,
            unusedLinkedAssetNudges,
            unusedAssetSlugs: (session.assetRefs ?? []).map((row) => row.slug),
            gameJuiceNudges,
            assetSculptNudges,
            adherenceNote: adherenceNudges ? (this.canvasAdherence.get(sessionId) ?? "") : "",
            gameWipeNudges,
            searchWanderNudges,
            verifyNudges,
            reviewVerdictNudges,
            reviewRoutingNudges,
            opsRoutingNudges,
            isAsset: isAssetSession(session),
            isDesignOnly:
              isDesignSession(session) && !isGameSession(session) && !isAssetSession(session),
          }),
        ]
          .filter(Boolean)
          .join("\n\n");
        const assembled = assemblePrompt({
          system,
          repoMap,
          workingState: workingText,
          compactNote,
          brain:
            sessionOffersBrain(session) && this.brain
              ? await this.brain.orient(session.repo?.url).catch(() => "")
              : undefined,
          messages: folded.messages,
        });
        const promptContext = await this.recordPromptContext(sessionId, assembled, {
          window,
          reserved,
          charsPerToken,
          tools: [...tools, ...extraTools],
          rulesChars: sessionRulesChars({
            instructions: composePersonaInstructions(session.instructions, session.persona, {
              surface: session.surface,
            }),
            playbook: session.playbook,
            memories,
            pins,
            rules,
          }),
          skillsChars: kitSkill.length,
          conversationChars:
            workingText.length +
            compactNote.length +
            assembled.messages.reduce((n, message) => n + messageChars(message), 0),
        });
        await this.traces.write({
          t: now(),
          kind: "llm.request",
          sessionId,
          turnId,
          round,
          name: session.model,
          detail: assembled.system.slice(0, 200),
        });
        const canvasHtml =
          isCanvasSession(session) && guestReady
            ? (await this.design.readCanvas(sessionId).catch(() => ({ html: null }))).html
            : null;
        const canvasEmpty = isCanvasSession(session) && guestReady && !canvasHtml?.trim();
        const canvasIncomplete =
          isCanvasSession(session) && guestReady && canvasHtmlIncomplete(canvasHtml);
        const remainingMs =
          timeCap != null && timeCap > 0
            ? providerRoundTimeoutMs(timeCap, Date.now() - startedAtMs)
            : undefined;
        const streamAbort = new AbortController();
        this.llmStreamAborts.set(sessionId, streamAbort);
        const onTurnAbort = () => streamAbort.abort();
        abort.signal.addEventListener("abort", onTurnAbort);
        if (abort.signal.aborted) streamAbort.abort();
        const stream =
          provider && hasUsableKey(provider.apiKey, provider.baseUrl, provider.kind)
            ? runChatTurn(
                (req) => this.chatEngine(req),
                {
                  provider,
                  model: session.model,
                  system: assembled.system,
                  cacheBlocks: assembled.cacheBlocks,
                  volatilePrefix: assembled.volatilePrefix,
                  messages: assembled.messages,
                  guestOs: session.os,
                  runtime,
                  allowedTools: cachedTurnAllowedTools({
                    planTurn,
                    planToolNames: [...tools.map((t) => t.name), ...extraTools.map((t) => t.name)],
                    sessionAllowedTools: session.allowedTools,
                  }),
                  extraTools,
                  signal: streamAbort.signal,
                  ...(parentModelToolChoice({
                    canvasEmpty,
                    canvasIncomplete,
                    canvasNudges,
                    canvasIncompleteNudges,
                    designMutateNudges,
                    isDesign: isCanvasSession(session),
                    guestReady,
                    planTurn,
                    canvasMutatedThisTurn,
                    calledPlaywrightThisTurn,
                    gamePlaywrightNudges,
                    isCoding: isCodingLoopSession(session),
                    mutatedThisTurn,
                    verifiedThisTurn,
                    verifyNudges,
                    searchWanderNudges,
                    genericDesign:
                      isDesignSession(session) &&
                      !isGameSession(session) &&
                      !isAssetSession(session) &&
                      looksGenericDesign(canvasHtml),
                    hostFallback: isCanvasSession(session) && looksHostFallbackCanvas(canvasHtml),
                    designQualityNudges,
                    isGame: isGameSession(session),
                    isAsset: isAssetSession(session),
                    dryGame: isGameSession(session) && looksDryGame(canvasHtml),
                    gameJuiceNudges,
                    placeholderAsset: isAssetSession(session) && looksPlaceholderAsset(canvasHtml),
                    assetSculptNudges,
                    adherenceIssues: this.canvasAdherence.has(sessionId),
                    adherenceNudges,
                    unusedLinkedAssets:
                      isGameSession(session) &&
                      looksLikeUnusedLinkedAssets(
                        canvasHtml,
                        (session.assetRefs ?? []).map((row) => row.slug),
                      ),
                    unusedLinkedAssetNudges,
                    gameUnplayable: isGameSession(session) && !looksPlayableGame(canvasHtml),
                    assetUnwired: isAssetSession(session) && looksUnwiredAsset(canvasHtml),
                    gameUnplayableNudges,
                    isReview: isReviewSession(session),
                    calledReview,
                    reviewRoutingNudges,
                  })
                    ? { toolChoice: "required" as const }
                    : {}),
                },
                {
                  ...(remainingMs != null ? { timeoutMs: remainingMs } : {}),
                  promptTokens: promptContext.used,
                  contextWindow: promptContext.window,
                  hasImages: assembled.messages.some((message) =>
                    Boolean(message.screenshotBase64),
                  ),
                  onRetry: ({ attempt, delayMs, error }) => {
                    void this.traces.write({
                      t: now(),
                      kind: "llm.retry",
                      sessionId,
                      turnId,
                      round,
                      detail: `${attempt} ${delayMs}ms ${error instanceof Error ? error.message : "retry"}`,
                    });
                  },
                },
              )
            : mockChunks(mockAssistantReply(userText, session, vm?.status, planTurn));

        const toolCalls: ToolCall[] = [];
        try {
          for await (const ev of stream) {
            if (stop()) break;
            if (ev.type === "reasoning" && ev.text) {
              await this.appendThinking(sessionId, replyId, ev.text);
            }
            if (ev.type === "text" && ev.text) {
              this.clearThinking(sessionId);
              await this.appendDelta(sessionId, replyId, ev.text);
            }
            if (ev.type === "usage") await this.applyUsage(sessionId, replyId, ev);
            if (ev.type === "tool_call_delta") {
              this.design.paintStreaming(sessionId, canonicalToolName(ev.name), ev.argumentsRaw);
              continue;
            }
            if (ev.type === "tool_call") {
              const mapped = canonicalToolCall(ev.name, ev.arguments ?? {});
              toolCalls.push({
                id: ev.id,
                name: mapped.name,
                arguments: mapped.arguments,
                startedAt: now(),
              });
            }
          }
        } catch (err) {
          if (stop()) break;
          if (await this.hasSteerAfter(sessionId, replyId)) {
            emptyRetries = 0;
            continue;
          }
          const message = formatProviderError(err);
          await this.traces.write({
            t: now(),
            kind: "error",
            level: "error",
            sessionId,
            turnId,
            round,
            detail: message,
          });
          await this.appendDelta(
            sessionId,
            replyId,
            `\n\n${message}${await this.turnRecoveryFooter(sessionId)}`,
          );
          break;
        } finally {
          abort.signal.removeEventListener("abort", onTurnAbort);
          if (this.llmStreamAborts.get(sessionId) === streamAbort) {
            this.llmStreamAborts.delete(sessionId);
          }
          this.clearThinking(sessionId);
          await this.store.flushSession(sessionId).catch(() => undefined);
        }

        await this.design.flushStreaming(sessionId);
        const replyUsage = (await this.require(sessionId)).messages.find(
          (m) => m.id === replyId,
        )?.usage;
        if (planTurn) {
          for (const call of toolCalls) {
            const refused = planToolRefusal(call.name, true);
            if (refused) call.error = refused;
          }
        }
        const liveAfterModel = await this.require(sessionId);
        let replyNow = liveAfterModel.messages.find((m) => m.id === replyId);
        const impliedCalls = impliedToolCallsFromReply({
          planTurn,
          hasToolCalls: toolCalls.length > 0,
          isDesign: isCanvasSession(session),
          guestReady,
          canvasEmpty,
          content: replyNow?.content,
        });
        for (const implied of impliedCalls) {
          toolCalls.push({
            id: randomUUID(),
            name: implied.name,
            arguments: implied.arguments,
            startedAt: now(),
          });
        }
        const harvestedChat =
          replyNow?.content != null
            ? hideHarvestedCanvasChat(replyNow.content, impliedCalls)
            : undefined;
        if (replyNow && harvestedChat != null && harvestedChat !== replyNow.content) {
          await this.store.mutateSession(sessionId, (current) => {
            const msg = current.messages.find((m) => m.id === replyId);
            if (msg) msg.content = harvestedChat;
          });
          replyNow = { ...replyNow, content: harvestedChat };
        }
        await this.traces.write({
          t: now(),
          kind: "llm.response",
          sessionId,
          turnId,
          round,
          name: session.model,
          inputTokens: replyUsage?.inputTokens,
          outputTokens: replyUsage?.outputTokens,
          detail: llmResponseDetail(replyNow, toolCalls),
        });
        const afterModel = decideAfterModelRound({
          toolCallCount: toolCalls.length,
          hasText: Boolean(replyNow?.content.trim()),
          planTurn,
          stopped: stop(),
          emptyRetries,
          isDesign: isCanvasSession(session),
          guestReady,
          canvasEmpty,
          canvasIncomplete,
          canvasNudges,
          canvasIncompleteNudges,
          canvasMutatedThisTurn,
          designMutateNudges,
          isGame: isGameSession(session),
          isAsset: isAssetSession(session),
          isReview: isReviewSession(session),
          hasReviewVerdict: Boolean(parseReviewSessionVerdict(liveAfterModel.messages)),
          applyReviewVerdict: shouldApplyReviewVerdict(liveAfterModel.messages),
          reviewVerdictNudges,
          calledReview,
          reviewRoutingNudges,
          isCoding: isCodingLoopSession(session),
          mutatedThisTurn,
          verifiedThisTurn,
          verifyNudges,
          namedOps,
          searchRounds,
          searchWanderNudges,
          calledPlaywrightThisTurn,
          gamePlaywrightNudges,
          genericDesign:
            isDesignSession(session) &&
            !isGameSession(session) &&
            !isAssetSession(session) &&
            looksGenericDesign(canvasHtml),
          hostFallback: isCanvasSession(session) && looksHostFallbackCanvas(canvasHtml),
          designQualityNudges,
          dryGame: isGameSession(session) && looksDryGame(canvasHtml),
          gameJuiceNudges,
          placeholderAsset: isAssetSession(session) && looksPlaceholderAsset(canvasHtml),
          assetSculptNudges,
          adherenceIssues: this.canvasAdherence.has(sessionId),
          adherenceNudges,
          unusedLinkedAssets:
            isGameSession(session) &&
            looksLikeUnusedLinkedAssets(
              canvasHtml,
              (session.assetRefs ?? []).map((row) => row.slug),
            ),
          unusedLinkedAssetNudges,
          gameUnplayable: isGameSession(session) && !looksPlayableGame(canvasHtml),
          assetUnwired: isAssetSession(session) && looksUnwiredAsset(canvasHtml),
          gameUnplayableNudges,
        });
        if (afterModel.kind === "retryEmpty") {
          emptyRetries += 1;
          if (!replyNow?.thinking?.trim()) await this.dropAssistantMessage(sessionId, replyId);
          await this.waitForGuestIfStarting(sessionId, abort);
          round -= 1;
          continue;
        }
        if (afterModel.kind === "canvasNudge") {
          canvasNudges += 1;
          if (afterModel.dropBlank && !replyNow?.thinking?.trim()) {
            await this.dropAssistantMessage(sessionId, replyId);
          }
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: EMPTY_CANVAS_NUDGE,
            hidden: true,
            createdAt: now(),
          });
          round -= 1;
          continue;
        }
        if (afterModel.kind === "canvasIncompleteNudge") {
          canvasIncompleteNudges += 1;
          if (afterModel.dropBlank && !replyNow?.thinking?.trim()) {
            await this.dropAssistantMessage(sessionId, replyId);
          }
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "incomplete_canvas",
            detail: INCOMPLETE_CANVAS_NUDGE,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: INCOMPLETE_CANVAS_NUDGE,
            hidden: true,
            createdAt: now(),
          });
          round -= 1;
          continue;
        }
        if (afterModel.kind === "designMutateNudge") {
          designMutateNudges += 1;
          if (afterModel.dropBlank && !replyNow?.thinking?.trim()) {
            await this.dropAssistantMessage(sessionId, replyId);
          }
          const mutate = studioLoopNudge(
            "designMutateNudge",
            isAssetSession(session),
            isDesignSession(session) && !isGameSession(session) && !isAssetSession(session),
          );
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: mutate.name,
            detail: mutate.prompt,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: mutate.prompt,
            hidden: true,
            createdAt: now(),
          });
          round -= 1;
          continue;
        }
        if (afterModel.kind === "designLookNudge") {
          gamePlaywrightNudges += 1;
          if (afterModel.dropBlank && !replyNow?.thinking?.trim()) {
            await this.dropAssistantMessage(sessionId, replyId);
          }
          const look = studioLoopNudge(
            "gamePlaywrightNudge",
            isAssetSession(session),
            isDesignSession(session) && !isGameSession(session) && !isAssetSession(session),
          );
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: look.name,
            detail: look.prompt,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: look.prompt,
            hidden: true,
            createdAt: now(),
          });
          round -= 1;
          continue;
        }
        if (afterModel.kind === "gameUnplayableNudge") {
          gameUnplayableNudges += 1;
          if (afterModel.dropBlank && !replyNow?.thinking?.trim()) {
            await this.dropAssistantMessage(sessionId, replyId);
          }
          const unplayable = studioLoopNudge("gameUnplayableNudge", isAssetSession(session));
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: unplayable.name,
            detail: unplayable.prompt,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: unplayable.prompt,
            hidden: true,
            createdAt: now(),
          });
          round -= 1;
          continue;
        }
        if (afterModel.kind === "designQualityNudge") {
          designQualityNudges += 1;
          if (afterModel.dropBlank && !replyNow?.thinking?.trim()) {
            await this.dropAssistantMessage(sessionId, replyId);
          }
          const quality = canvasQualityNudge(looksHostFallbackCanvas(canvasHtml));
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "design_quality",
            detail: quality,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: quality,
            hidden: true,
            createdAt: now(),
          });
          round -= 1;
          continue;
        }
        if (afterModel.kind === "unusedLinkedAssetsNudge") {
          unusedLinkedAssetNudges += 1;
          if (afterModel.dropBlank && !replyNow?.thinking?.trim()) {
            await this.dropAssistantMessage(sessionId, replyId);
          }
          const prompt = unusedLinkedAssetsNudge((session.assetRefs ?? []).map((row) => row.slug));
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "unused_linked_assets",
            detail: prompt,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: prompt,
            hidden: true,
            createdAt: now(),
          });
          round -= 1;
          continue;
        }
        if (afterModel.kind === "gameJuiceNudge") {
          gameJuiceNudges += 1;
          if (afterModel.dropBlank && !replyNow?.thinking?.trim()) {
            await this.dropAssistantMessage(sessionId, replyId);
          }
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "game_juice",
            detail: GAME_JUICE_NUDGE,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: GAME_JUICE_NUDGE,
            hidden: true,
            createdAt: now(),
          });
          round -= 1;
          continue;
        }
        if (afterModel.kind === "assetSculptNudge") {
          assetSculptNudges += 1;
          if (afterModel.dropBlank && !replyNow?.thinking?.trim()) {
            await this.dropAssistantMessage(sessionId, replyId);
          }
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "asset_sculpt",
            detail: ASSET_SCULPT_NUDGE,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: ASSET_SCULPT_NUDGE,
            hidden: true,
            createdAt: now(),
          });
          round -= 1;
          continue;
        }
        if (afterModel.kind === "adherenceNudge") {
          adherenceNudges += 1;
          if (afterModel.dropBlank && !replyNow?.thinking?.trim()) {
            await this.dropAssistantMessage(sessionId, replyId);
          }
          const detail = this.canvasAdherence.get(sessionId) ?? formatAdherenceNudge([]);
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "design_adherence",
            detail,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: detail,
            hidden: true,
            createdAt: now(),
          });
          round -= 1;
          continue;
        }
        if (afterModel.kind === "searchWander") {
          searchWanderNudges += 1;
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "search_wander",
            detail: SEARCH_WANDER_NUDGE,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: SEARCH_WANDER_NUDGE,
            hidden: true,
            createdAt: now(),
          });
          round -= 1;
          continue;
        }
        if (afterModel.kind === "verifyNudge") {
          verifyNudges += 1;
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "verify",
            detail: VERIFY_NUDGE,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: VERIFY_NUDGE,
            hidden: true,
            createdAt: now(),
          });
          round -= 1;
          continue;
        }
        if (afterModel.kind === "reviewRouting") {
          reviewRoutingNudges += 1;
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "review_routing",
            detail: REVIEW_ROUTING_NUDGE,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: REVIEW_ROUTING_NUDGE,
            hidden: true,
            createdAt: now(),
          });
          round -= 1;
          continue;
        }
        if (afterModel.kind === "reviewVerdictNudge") {
          reviewVerdictNudges += 1;
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "review_verdict",
            detail: REVIEW_VERDICT_NUDGE,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: REVIEW_VERDICT_NUDGE,
            hidden: true,
            createdAt: now(),
          });
          round -= 1;
          continue;
        }
        if (afterModel.kind === "fillEmpty") {
          await this.appendDelta(sessionId, replyId, EMPTY_MODEL_REPLY);
          break;
        }
        if (afterModel.kind === "stop") {
          if (
            !stop() &&
            !planTurn &&
            !toolCalls.length &&
            (await this.hasSteerAfter(sessionId, replyId))
          ) {
            continue;
          }
          break;
        }

        if (!stop() && !planTurn && (await this.hasSteerAfter(sessionId, replyId))) {
          continue;
        }

        await this.store.mutateSession(sessionId, (current) => {
          const msg = current.messages.find((m) => m.id === replyId);
          if (msg) msg.toolCalls = toolCalls;
        });
        this.hub.broadcast({ type: "session.updated", session: await this.require(sessionId) });

        await runParentToolCalls(toolCalls, {
          stop,
          stale,
          parallel:
            toolCallsRunInParallel(toolCalls) &&
            toolCalls.every((call) => !toolNeedsApproval(call.name, policy, call.arguments)),
          now,
          priorResult: async (callId) =>
            toolResultForCall((await this.require(sessionId)).messages, callId),
          execute: async (call) => {
            try {
              const name = canonicalToolName(call.name);
              const kind = parentToolKind(name, {
                planTurn,
                needsApproval:
                  isAskUserToolName(name) || toolNeedsApproval(name, policy, call.arguments),
                args: call.arguments,
              });
              if (kind === "planRefuse") {
                return { ok: false, output: planToolRefusal(name, true, call.arguments)! };
              }
              if (kind === "approval") {
                if (stop()) return undefined;
                if (name === "brain_brief") {
                  const prepared = await this.prepareBrainBrief(sessionId, call.arguments);
                  if (!prepared.ok) return { ok: false, output: prepared.output };
                  call.arguments = prepared.args;
                }
                approvals += 1;
                if (!isAskUserToolName(call.name)) {
                  try {
                    const preview = await this.executeTool(
                      sessionId,
                      { name: "git_diff", args: {} },
                      { ignoreAllowlist: true },
                    );
                    if (preview.ok && preview.output.trim()) {
                      call.result = preview.output.slice(0, 8000);
                    }
                  } catch {
                    /* preview is optional */
                  }
                }
                const pending = this.awaitApproval(sessionId, call.id, abort.signal);
                call.approval = "needed";
                await this.store.mutateSession(sessionId, (current) => {
                  const msg = current.messages.find((m) => m.id === replyId);
                  if (msg) msg.toolCalls = toolCalls;
                });
                this.hub.broadcast({
                  type: "session.updated",
                  session: await this.require(sessionId),
                });
                const { decision, answer } = await pending;
                if (stale()) return undefined;
                const outcome = approvalToolOutcome({
                  askUser: isAskUserToolName(call.name),
                  decision,
                  answer,
                });
                call.approval = outcome.approval;
                if (outcome.kind !== "run") return outcome.result;
                const slackArgs = applySlackPostApprovalText(name, call.arguments, answer);
                const nextArgs = applyBrainBriefApprovalBody(name, slackArgs, answer);
                if (nextArgs) call.arguments = nextArgs;
              }
              return this.executeTool(
                sessionId,
                {
                  name: name as ComputerUseToolName,
                  args: call.arguments,
                },
                { fence: false, toolCallId: call.id },
              );
            } catch (err) {
              return { ok: false, output: err instanceof Error ? err.message : "tool failed" };
            }
          },
          hooks: {
            start: async (call) => {
              const publicCall = {
                ...call,
                arguments: redactedTraceArgs(call.arguments ?? {}),
              };
              this.hub.broadcast({ type: "tool.updated", sessionId, toolCall: publicCall });
              await this.traces.write({
                t: now(),
                kind: "tool.call",
                sessionId,
                turnId,
                round,
                id: call.id,
                name: call.name,
                args: publicCall.arguments,
              });
            },
            finish: async (call, result) => {
              const sessionNow = await this.require(sessionId);
              const secrets = configSecretValues(await this.store.loadConfig());
              const offloaded = await this.offloadToolOutput(
                sessionNow,
                call.id,
                redactText(stripSensitiveListing(call.name, result.output ?? ""), secrets),
              );
              const output = wrapHostileToolOutput(call.name, offloaded);
              const hooked = { ...result, output };
              call.result = slimToolContent(hooked.output);
              call.error = hooked.ok ? undefined : hooked.output;
              call.finishedAt = now();
              this.hub.broadcast({ type: "tool.updated", sessionId, toolCall: call });
              await this.traces.write({
                t: now(),
                kind: "tool.result",
                sessionId,
                turnId,
                round,
                id: call.id,
                name: call.name,
                ok: hooked.ok,
                detail: hooked.output,
              });
              await this.appendMessage(sessionId, {
                id: randomUUID(),
                role: "tool",
                toolCallId: call.id,
                content: slimToolContent(hooked.output ?? ""),
                toolCalls: [{ ...call, arguments: redactedTraceArgs(call.arguments ?? {}) }],
                screenshotBase64: hooked.screenshotBase64,
                recordingName: hooked.recordingName,
                artifactName: hooked.artifactName,
                artifactKind: hooked.artifactKind,
                createdAt: now(),
              });
              if (!planTurn && hooked.ok) await this.advancePlan(sessionId, call.name);
            },
          },
        });

        if (stop()) break;
        await this.store.mutateSession(sessionId, (current) => {
          const msg = current.messages.find((m) => m.id === replyId);
          if (msg) msg.toolCalls = toolCalls;
        });
        this.hub.broadcast({ type: "session.updated", session: await this.require(sessionId) });
        const afterTools = await this.require(sessionId);
        const afterConfig = await this.store.loadConfig();
        const afterProvider = afterConfig.providers.find((p) => p.id === afterTools.providerId);
        const afterTier = sessionAutonomy(afterTools.autonomy, afterConfig.advanced.autonomy);
        const afterSpend = taskSpendNow({
          startedAtMs,
          round: round + 1,
          usage: afterTools.usage,
          rates: resolveUsageRates(afterProvider, afterTools.model),
          subagents: this.turnSubagents.get(sessionId) ?? 0,
          computeUsd: workerComputeUsd(
            afterTools,
            (afterConfig.workers ?? []).find((row) => row.id === afterTools.backendId),
          ),
        });
        const afterVerdict = checkBudget(afterSpend, {
          maxUsd: resolveSpendCapUsd(
            afterTier,
            afterTools.maxUsd,
            afterConfig.advanced.maxUsdPerTurn,
          ),
          maxMs: afterTools.maxMs ?? afterConfig.advanced.maxMsPerTurn,
          maxRounds: MAX_ROUNDS,
        });
        const failed = toolCalls.find(
          (call) => call.error && looksLikeFixableFailure(call.error, false),
        );
        if (toolCalls.some((call) => isOpsProgressTool(call.name))) calledOps = true;
        else if (
          toolCalls.length > 0 &&
          toolCalls.every((call) => isWorkspaceSearchTool(call.name, call.arguments))
        ) {
          searchRounds += 1;
        }
        if (wroteAgentCanvas(toolCalls)) searchRounds = 0;
        ({ mutated: mutatedThisTurn, verified: verifiedThisTurn } = foldCodingVerifyFlags(
          toolCalls,
          { mutated: mutatedThisTurn, verified: verifiedThisTurn },
        ));
        if (
          calledPlaywright(toolCalls) &&
          !(isAssetSession(session) && calledFakeAssetPlaytest(toolCalls)) &&
          !(isGameSession(session) && calledHudOnlyGamePlaytest(toolCalls))
        ) {
          calledPlaywrightThisTurn = true;
        }
        if (wroteLiveCanvas(toolCalls)) canvasMutatedThisTurn = true;
        if (
          toolCalls.some(
            (call) =>
              isReviewProgressTool(call.name) || isReviewProgressTool(forgeToolNameFromCall(call)),
          )
        ) {
          calledReview = true;
        }
        const afterCanvasHtml = isCanvasSession(session)
          ? (await this.design.readCanvas(sessionId).catch(() => ({ html: null }))).html
          : null;
        const isGame = isGameSession(session);
        const isAsset = isAssetSession(session);
        const afterTool = decideAfterToolRound({
          isDesign: isCanvasSession(session),
          isGame,
          isAsset,
          wroteCanvas: wroteLiveCanvas(toolCalls),
          canvasIncomplete: canvasHtmlIncomplete(afterCanvasHtml),
          canvasIncompleteNudges,
          gameUnplayable: isGame && !looksPlayableGame(afterCanvasHtml),
          gameUnplayableNudges,
          assetUnwired: isAsset && looksUnwiredAsset(afterCanvasHtml),
          calledPlaywright:
            calledPlaywright(toolCalls) &&
            !(isAsset && calledFakeAssetPlaytest(toolCalls)) &&
            !(isGame && calledHudOnlyGamePlaytest(toolCalls)),
          fakePlaytest:
            calledFakeGamePlaytest(toolCalls) ||
            (isAsset && calledFakeAssetPlaytest(toolCalls)) ||
            (isGame && calledHudOnlyGamePlaytest(toolCalls)),
          gamePlaywrightNudges,
          canvasWiped:
            (isGame || isAsset) &&
            canvasLooksWiped(this.gameCanvasBaseline.get(sessionId), afterCanvasHtml),
          canvasUnchanged:
            (isGame || isAsset) &&
            canvasHtmlUnchanged(this.gameCanvasBaseline.get(sessionId), afterCanvasHtml),
          followUpMissing: isGame && gameFollowUpMissingFromCanvas(userText, afterCanvasHtml),
          iterateUnchanged: this.studioIterateUnchanged(
            isGame,
            isAsset,
            isDesignSession(session) && !isGame && !isAsset,
            turnUserPrompt(afterTools.messages) ?? userText,
            afterCanvasHtml,
            sessionId,
          ),
          designMutateNudges,
          gameWipeNudges,
          hasToolError: toolCalls.some((call) => Boolean(call.error)),
          planTurn,
          stopped: stop(),
          budgetOk: afterVerdict.ok,
          budgetMessage: afterVerdict.message ?? "",
          selfCorrects,
          fixableFailure: failed?.error
            ? { name: failed.name, id: failed.id, error: failed.error }
            : undefined,
          lastRound: MAX_ROUNDS != null && round === MAX_ROUNDS - 1,
          namedOps,
          calledOps,
          searchRounds,
          opsRoutingNudges,
          adherenceIssues: this.canvasAdherence.has(sessionId),
          adherenceNudges,
          isReview: isReviewSession(session),
          calledReview,
          applyThisTurn: shouldApplyReviewVerdict(afterTools.messages),
          reviewRoutingNudges,
          unusedLinkedAssets:
            isGame &&
            looksLikeUnusedLinkedAssets(
              afterCanvasHtml,
              (afterTools.assetRefs ?? []).map((row) => row.slug),
            ),
          unusedLinkedAssetNudges,
          isCoding: isCodingLoopSession(session),
          mutatedThisTurn,
          verifiedThisTurn,
          verifyNudges,
          searchWanderNudges,
          genericDesign:
            isCanvasSession(session) && !isGame && !isAsset && looksGenericDesign(afterCanvasHtml),
          hostFallback: isCanvasSession(session) && looksHostFallbackCanvas(afterCanvasHtml),
          designQualityNudges,
          dryGame: isGame && looksDryGame(afterCanvasHtml),
          gameJuiceNudges,
          placeholderAsset: isAsset && looksPlaceholderAsset(afterCanvasHtml),
          assetSculptNudges,
        });
        if (
          (isGame || isAsset) &&
          afterCanvasHtml &&
          !canvasLooksWiped(this.gameCanvasBaseline.get(sessionId), afterCanvasHtml)
        ) {
          this.rememberGoodStudioCanvas(sessionId, afterCanvasHtml);
        }
        if (wroteLiveCanvas(toolCalls) && isCanvasSession(session)) {
          await this.design.syncExploredVariants(sessionId).catch(() => undefined);
        }
        if (afterTool.kind === "canvasDone") {
          canvasMutatedThisTurn = true;
          break;
        }
        if (afterTool.kind === "canvasIncompleteNudge") {
          canvasIncompleteNudges += 1;
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "incomplete_canvas",
            detail: INCOMPLETE_CANVAS_NUDGE,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: INCOMPLETE_CANVAS_NUDGE,
            hidden: true,
            createdAt: now(),
          });
          round = refundLastRoundSlot(round, MAX_ROUNDS);
          continue;
        }
        if (afterTool.kind === "gameUnplayableNudge") {
          gameUnplayableNudges += 1;
          const unplayable = studioLoopNudge("gameUnplayableNudge", isAssetSession(session));
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: unplayable.name,
            detail: unplayable.prompt,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: unplayable.prompt,
            hidden: true,
            createdAt: now(),
          });
          round = refundLastRoundSlot(round, MAX_ROUNDS);
          continue;
        }
        if (afterTool.kind === "unusedLinkedAssetsNudge") {
          unusedLinkedAssetNudges += 1;
          const slugs = (afterTools.assetRefs ?? []).map((row) => row.slug);
          const prompt = unusedLinkedAssetsNudge(slugs);
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "unused_linked_assets",
            detail: prompt,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: prompt,
            hidden: true,
            createdAt: now(),
          });
          round = refundLastRoundSlot(round, MAX_ROUNDS);
          continue;
        }
        if (afterTool.kind === "designQualityNudge") {
          designQualityNudges += 1;
          const quality = canvasQualityNudge(looksHostFallbackCanvas(afterCanvasHtml));
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "design_quality",
            detail: quality,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: quality,
            hidden: true,
            createdAt: now(),
          });
          round = refundLastRoundSlot(round, MAX_ROUNDS);
          continue;
        }
        if (afterTool.kind === "gameJuiceNudge") {
          gameJuiceNudges += 1;
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "game_juice",
            detail: GAME_JUICE_NUDGE,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: GAME_JUICE_NUDGE,
            hidden: true,
            createdAt: now(),
          });
          round = refundLastRoundSlot(round, MAX_ROUNDS);
          continue;
        }
        if (afterTool.kind === "assetSculptNudge") {
          assetSculptNudges += 1;
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "asset_sculpt",
            detail: ASSET_SCULPT_NUDGE,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: ASSET_SCULPT_NUDGE,
            hidden: true,
            createdAt: now(),
          });
          round = refundLastRoundSlot(round, MAX_ROUNDS);
          continue;
        }
        if (afterTool.kind === "gamePlaywrightNudge") {
          gamePlaywrightNudges += 1;
          const playtest = studioLoopNudge(
            "gamePlaywrightNudge",
            isAssetSession(session),
            isDesignSession(session),
          );
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: playtest.name,
            detail: playtest.prompt,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: playtest.prompt,
            hidden: true,
            createdAt: now(),
          });
          round = refundLastRoundSlot(round, MAX_ROUNDS);
          continue;
        }
        if (afterTool.kind === "gameWipeNudge") {
          gameWipeNudges += 1;
          const wipe = studioLoopNudge("gameWipeNudge", isAssetSession(session));
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: wipe.name,
            detail: wipe.prompt,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: wipe.prompt,
            hidden: true,
            createdAt: now(),
          });
          round = refundLastRoundSlot(round, MAX_ROUNDS);
          continue;
        }
        if (afterTool.kind === "gameWipeRestore") {
          await this.restoreWipedCanvas(sessionId);
          gameWipeNudges += 1;
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "game_restore",
            detail: GAME_CANVAS_RESTORE_NOTE,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: GAME_CANVAS_RESTORE_NOTE,
            hidden: true,
            createdAt: now(),
          });
          if (gameWipeNudges >= MAX_CANVAS_NUDGES) break;
          round = refundLastRoundSlot(round, MAX_ROUNDS);
          continue;
        }
        if (afterTool.kind === "designMutateNudge") {
          designMutateNudges += 1;
          const mutate = studioLoopNudge(
            "designMutateNudge",
            isAssetSession(session),
            isDesignSession(session) && !isGameSession(session) && !isAssetSession(session),
          );
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: mutate.name,
            detail: mutate.prompt,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: mutate.prompt,
            hidden: true,
            createdAt: now(),
          });
          round = refundLastRoundSlot(round, MAX_ROUNDS);
          continue;
        }
        if (afterTool.kind === "adherenceNudge") {
          adherenceNudges += 1;
          const detail = this.canvasAdherence.get(sessionId) ?? formatAdherenceNudge([]);
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "design_adherence",
            detail,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: detail,
            hidden: true,
            createdAt: now(),
          });
          round = refundLastRoundSlot(round, MAX_ROUNDS);
          continue;
        }
        if (afterTool.kind === "verifyNudge") {
          verifyNudges += 1;
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "verify",
            detail: VERIFY_NUDGE,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: VERIFY_NUDGE,
            hidden: true,
            createdAt: now(),
          });
          round = refundLastRoundSlot(round, MAX_ROUNDS);
          continue;
        }
        if (afterTool.kind === "budgetStop") {
          await this.reportBudgetStop(sessionId, turnId, round, afterTools, afterTool.message);
          break;
        }
        if (afterTool.kind === "continue" && afterTool.reviewRouting) {
          reviewRoutingNudges += 1;
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "review_routing",
            detail: REVIEW_ROUTING_NUDGE,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: REVIEW_ROUTING_NUDGE,
            hidden: true,
            createdAt: now(),
          });
        } else if (afterTool.kind === "continue" && afterTool.opsRouting) {
          opsRoutingNudges += 1;
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "ops_routing",
            detail: OPS_ROUTING_NUDGE,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: OPS_ROUTING_NUDGE,
            hidden: true,
            createdAt: now(),
          });
        } else if (afterTool.kind === "continue" && afterTool.searchWander) {
          searchWanderNudges += 1;
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: "search_wander",
            detail: SEARCH_WANDER_NUDGE,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: SEARCH_WANDER_NUDGE,
            hidden: true,
            createdAt: now(),
          });
        } else if (afterTool.kind === "continue" && afterTool.selfCorrect) {
          selfCorrects += 1;
          await this.traces.write({
            t: now(),
            kind: "selfCorrect",
            sessionId,
            turnId,
            round,
            name: afterTool.selfCorrect.name,
            id: afterTool.selfCorrect.id,
            detail: afterTool.selfCorrect.error,
          });
          await this.appendMessage(sessionId, {
            id: randomUUID(),
            role: "system",
            content: selfCorrectNudge(afterTool.selfCorrect.error),
            hidden: true,
            createdAt: now(),
          });
        }
        if (
          afterTool.kind === "continue" &&
          (afterTool.reviewRouting ||
            afterTool.opsRouting ||
            afterTool.searchWander ||
            afterTool.selfCorrect)
        ) {
          round = refundLastRoundSlot(round, MAX_ROUNDS);
          continue;
        }
        if (afterTool.kind === "continue" && afterTool.usedAllRounds) usedAllRounds = true;
      }
      if (!stop() && planTurn) await this.finishPlanTurn(sessionId, taskListAtPlanStart);
      if (!stop() && usedAllRounds && MAX_ROUNDS != null) {
        const current = await this.require(sessionId);
        await this.reportBudgetStop(
          sessionId,
          turnId,
          MAX_ROUNDS,
          current,
          `Stopped: round limit reached (${MAX_ROUNDS} / ${MAX_ROUNDS}). Reporting progress instead of continuing.`,
        ).catch(() => undefined);
      }
      if (!stop() && !planTurn) await this.design.finishTurn(sessionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Agent failed";
      if (!stale() && !abort.signal.aborted) {
        await this.appendMessage(sessionId, {
          id: randomUUID(),
          role: "system",
          content: message,
          createdAt: now(),
        }).catch(() => undefined);
      }
    } finally {
      await this.store.flushSession(sessionId).catch(() => undefined);
      if (this.aborts.get(sessionId)?.signal === abort.signal) this.aborts.delete(sessionId);
      if (!stale()) {
        this.clearThinking(sessionId);
        this.turnSubagents.delete(sessionId);
        this.turnStartedAt.delete(sessionId);
      }
      let turnSelfCorrects = selfCorrects;
      try {
        const events = await this.traces.read(sessionId);
        const counted = events.filter(
          (event) => event.turnId === turnId && event.kind === "selfCorrect",
        ).length;
        if (counted > turnSelfCorrects) turnSelfCorrects = counted;
      } catch {
        /* traces optional */
      }
      await this.traces
        .write({
          t: now(),
          kind: "turn.end",
          sessionId,
          turnId,
          ms: Date.now() - startedAtMs,
          args: {
            selfCorrects: turnSelfCorrects,
            canvasNudges:
              canvasNudges +
              canvasIncompleteNudges +
              gameWipeNudges +
              gamePlaywrightNudges +
              gameUnplayableNudges +
              designMutateNudges +
              unusedLinkedAssetNudges,
            approvals,
            ...reviewTurnEndArgs(await this.get(sessionId)),
          },
        })
        .catch(() => undefined);
      try {
        const events = await this.traces.read(sessionId);
        const turnEvents = events.filter((event) => event.turnId === turnId);
        await saveFailedEval(this.store.dataDir, sessionId, turnEvents);
      } catch {
        /* eval flywheel is optional */
      }
      if (!stale()) {
        try {
          const session = await this.get(sessionId);
          if (session) {
            if (!planTurn) await this.resetRunningPlanSteps(sessionId);
            if (!planTurn && !abort.signal.aborted) {
              await this.applyReviewVerdict(sessionId, session);
              await this.applyGenerationQuality(sessionId, (await this.get(sessionId)) ?? session);
              await this.applyDesignAdherence(sessionId, (await this.get(sessionId)) ?? session);
              await this.applyStudioFollowUp(sessionId, (await this.get(sessionId)) ?? session);
              await this.applyCodingVerify(sessionId, (await this.get(sessionId)) ?? session);
            }
            await this.runStopHooks(session);
            await this.patch(sessionId, { status: parkedStatus(session) });
            if (abort.signal.aborted && !stale()) {
              await this.appendMessage(sessionId, {
                id: randomUUID(),
                role: "system",
                content: CANCELLED_TURN_NOTE,
                createdAt: now(),
              }).catch(() => undefined);
            }
            if (!abort.signal.aborted && this.brain && sessionOffersBrain(session)) {
              this.scheduleBrainDistill(sessionId, session);
            }
            this.hub.broadcast({ type: "chat.done", sessionId, messageId: lastReplyId });
            const handoffKind = session.needsHuman
              ? ("needs_you" as const)
              : abort.signal.aborted
                ? ("blocked" as const)
                : ("done" as const);
            await this.deliverPeerHandoff(sessionId, session, {
              kind: handoffKind,
              detail: session.needsHuman,
            }).catch(() => undefined);
          }
        } catch {
          /* store may already be torn down in tests */
        }
        if (!abort.signal.aborted) await this.drainQueue(sessionId);
      }
    }
  }

  /** Merge this /plan turn's prose, Cursor createPlan todos, and new task_list rows. */
  private async finishPlanTurn(
    sessionId: string,
    taskListAtStart: ReadonlyArray<Pick<TaskItem, "id" | "text" | "status">>,
  ): Promise<void> {
    const current = await this.require(sessionId);
    let lastUser = -1;
    for (let i = current.messages.length - 1; i >= 0; i -= 1) {
      if (current.messages[i]?.role === "user") {
        lastUser = i;
        break;
      }
    }
    let plan: ReturnType<typeof planFromAssistant> = undefined;
    for (let i = current.messages.length - 1; i > lastUser; i -= 1) {
      const message = current.messages[i];
      if (message?.role !== "assistant") continue;
      const fromCursor = planFromCursorToolCalls(message.toolCalls, message.id);
      if (fromCursor?.items.length) {
        plan = fromCursor;
        break;
      }
    }
    if (!plan) {
      for (let i = current.messages.length - 1; i > lastUser; i -= 1) {
        const message = current.messages[i];
        if (message?.role !== "assistant" || !message.content.trim()) continue;
        plan = planFromAssistant(message.content, message.id);
        if (plan) break;
      }
    }
    const merged = planFromTurnTasks(plan, tasksTrackedThisTurn(taskListAtStart, current.taskList));
    if (!merged.items.length) return;
    await this.patch(sessionId, {
      plan: merged,
      taskList: taskListFromPlan(merged),
    });
  }

  private async finishPlanTurnIfNeeded(
    sessionId: string,
    lastReplyId: string,
    planTurn: boolean,
    taskListAtStart: ReadonlyArray<Pick<TaskItem, "id" | "text" | "status">>,
  ): Promise<void> {
    if (planTurn) {
      await this.finishPlanTurn(sessionId, taskListAtStart);
      return;
    }
    const current = await this.require(sessionId);
    const reply = current.messages.find((message) => message.id === lastReplyId);
    if (!shouldFinishCursorPlanTurn(false, reply)) return;
    await this.finishPlanTurn(sessionId, taskListAtStart);
  }

  private async runCursorCloudTurn(input: {
    sessionId: string;
    userText: string;
    abort: AbortController;
    turnId: string;
    planTurn: boolean;
    stop: () => boolean;
  }): Promise<string> {
    const session = await this.require(input.sessionId);
    const config = await this.store.loadConfig();
    const provider = config.providers.find((p) => p.id === session.providerId);
    if (!provider || !hasUsableKey(provider.apiKey, provider.baseUrl, provider.kind)) {
      await this.appendMessage(input.sessionId, {
        id: randomUUID(),
        role: "system",
        content:
          "Cursor Cloud API key is not set. Add a key from cursor.com/dashboard/api in Settings → Providers.",
        createdAt: now(),
      });
      return "";
    }
    const githubRepos = cursorCloudReposFromSession(session);
    if (session.repo?.url && !cursorGithubRepoUrl(session.repo.url)) {
      await this.appendMessage(input.sessionId, {
        id: randomUUID(),
        role: "system",
        content:
          "Cursor Cloud Agents only accept GitHub repositories. Link a github.com repo, or clear the repo to run a no-repo cloud agent.",
        createdAt: now(),
      });
      return "";
    }
    const github = githubRepos[0]?.url;
    let promptText = input.userText;
    const first = !session.cursorCloud?.agentId;
    if (first) {
      const card = formatCursorOpsRoutingCard({
        prompt: input.userText,
        connected: integrationsWithTokens(config.integrations).map((row) => row.kind),
      });
      if (card) promptText = `${card}\n\n${promptText}`;
    }
    if (first && session.instructions?.trim()) {
      promptText = `${session.instructions.trim()}\n\n${promptText}`;
    }
    if (first && session.playbook?.trim()) {
      promptText = `${promptText}\n\nPlaybook:\n${session.playbook.trim()}`;
    }
    let lastReplyId = "";
    for (let round = 0; round < 32; round++) {
      if (input.stop()) break;
      const replyId = randomUUID();
      lastReplyId = replyId;
      await this.appendMessage(input.sessionId, {
        id: replyId,
        role: "assistant",
        content: "",
        createdAt: now(),
      });
      const current = await this.require(input.sessionId);
      const user = lastUserMessage(current.messages);
      const images = await this.cursorPromptImages(input.sessionId, user);
      let handle: CursorRunHandle;
      try {
        handle = await startCursorCloudRun({
          provider,
          agentId: current.cursorCloud?.agentId,
          prompt: { text: promptText, images },
          model: current.model,
          name: current.title,
          repos: githubRepos.length ? githubRepos : undefined,
          mode: input.planTurn ? "plan" : "agent",
          autoCreatePr: Boolean(github),
          signal: input.abort.signal,
          fetchFn: this.fetchFn,
        });
      } catch (err) {
        if (input.stop()) break;
        await this.appendDelta(input.sessionId, replyId, `\n\n${formatProviderError(err)}`);
        break;
      }
      await this.patch(input.sessionId, {
        cursorCloud: {
          agentId: handle.agentId,
          runId: handle.runId,
          url: handle.url ?? current.cursorCloud?.url,
        },
      });
      await this.traces.write({
        t: now(),
        kind: "llm.request",
        sessionId: input.sessionId,
        turnId: input.turnId,
        round,
        name: current.model,
        detail: handle.agentId,
      });
      let sawText = false;
      try {
        for await (const ev of streamCursorRun(provider, handle, {
          signal: input.abort.signal,
          fetchFn: this.fetchFn,
        })) {
          if (input.stop()) break;
          if (ev.type === "reasoning" && ev.text) {
            await this.appendThinking(input.sessionId, replyId, ev.text);
          }
          if (ev.type === "text" && ev.text) {
            sawText = true;
            this.clearThinking(input.sessionId);
            await this.appendDelta(input.sessionId, replyId, ev.text);
          }
          if (ev.type === "tool_call") {
            await this.upsertCursorToolCall(input.sessionId, replyId, ev, input.turnId, round);
          }
          if (ev.type === "error") {
            await this.appendDelta(input.sessionId, replyId, `\n\n${ev.message}`);
          }
          if (ev.type === "result") {
            await this.applyCursorRunResult(input.sessionId, replyId, ev, sawText);
          }
        }
      } catch (err) {
        if (!input.stop()) {
          await this.appendDelta(input.sessionId, replyId, `\n\n${formatProviderError(err)}`);
        }
      } finally {
        this.clearThinking(input.sessionId);
      }
      const reply = (await this.require(input.sessionId)).messages.find((m) => m.id === replyId);
      await this.traces.write({
        t: now(),
        kind: "llm.response",
        sessionId: input.sessionId,
        turnId: input.turnId,
        round,
        name: current.model,
        detail: llmResponseDetail(reply, reply?.toolCalls),
      });
      if (input.stop() || !(await this.hasSteerAfter(input.sessionId, replyId))) break;
      const fresh = await this.require(input.sessionId);
      const index = fresh.messages.findIndex((message) => message.id === replyId);
      const steers = fresh.messages
        .slice(index + 1)
        .filter((message) => message.role === "user" && message.content.trim());
      const next = steers[steers.length - 1]?.content.trim();
      if (!next) break;
      promptText = next;
    }
    return lastReplyId;
  }

  private async snapshotStudioBaseline(sessionId: string): Promise<string> {
    const html = (await this.design.readCanvas(sessionId).catch(() => ({ html: null }))).html;
    this.gameCanvasBaseline.set(sessionId, html ?? "");
    this.studioTurnStart.set(sessionId, html ?? "");
    return html ?? "";
  }

  private studioIterateUnchanged(
    isGame: boolean,
    isAsset: boolean,
    isDesign: boolean,
    userText: string | undefined,
    html: string | null | undefined,
    sessionId: string,
  ): boolean {
    const turnStartHtml = this.studioTurnStart.get(sessionId);
    if (isGame) {
      return Boolean(gameIterateUnchangedNeedsHuman({ userText, html, turnStartHtml }));
    }
    if (isAsset) {
      return Boolean(assetIterateUnchangedNeedsHuman({ userText, html, turnStartHtml }));
    }
    if (isDesign) {
      return Boolean(designIterateUnchangedNeedsHuman({ userText, html, turnStartHtml }));
    }
    return false;
  }

  private rememberGoodStudioCanvas(sessionId: string, html: string): void {
    const next = html.trim();
    if (!next || !isCompleteHtmlDocument(next)) return;
    const prev = this.gameCanvasBaseline.get(sessionId) ?? "";
    if (canvasLooksWiped(prev, next)) return;
    this.gameCanvasBaseline.set(sessionId, html);
  }

  private async pinnedGameBuildHtml(sessionId: string): Promise<string> {
    try {
      const file = await this.workspace.readWorkspace(sessionId, GAME_STUDIO_PATH);
      if (!file?.content?.trim()) return "";
      const studio = parseGameStudio(JSON.parse(file.content));
      const id = studio.activeBuildId;
      if (!id) return "";
      const variant = await this.workspace.readWorkspace(sessionId, `.locus-variants/${id}.html`);
      return variant?.content ?? "";
    } catch {
      return "";
    }
  }

  private async restoreWipedCanvas(sessionId: string): Promise<boolean> {
    let before = this.gameCanvasBaseline.get(sessionId) ?? "";
    if (!before.trim() || before.trim().length < 800) {
      const pinned = await this.pinnedGameBuildHtml(sessionId);
      if (pinned.trim().length >= 800) before = pinned;
    }
    if (!before.trim() || before.trim().length < 800) return false;
    try {
      await this.workspace.writeWorkspace(sessionId, "index.html", before);
      this.hub.broadcast({ type: "canvas.updated", sessionId, html: before });
      return true;
    } catch {
      return false;
    }
  }

  private async primeGameTurn(sessionId: string, userText: string): Promise<string> {
    const html = await this.snapshotStudioBaseline(sessionId);
    let lastRun: ReturnType<typeof parseGameLastRun>;
    try {
      const file = await this.workspace.readWorkspace(sessionId, GAME_LAST_RUN_PATH);
      if (file?.content) lastRun = parseGameLastRun(JSON.parse(file.content));
    } catch {
      /* missing or not JSON */
    }
    const parts = [formatGameCanvasSnapshot({ html, lastRun })];
    if (gameCanvasBrokenPrompt(userText)) parts.push(GAME_CANVAS_IFRAME_NUDGE);
    return parts.join("\n\n");
  }

  private async primeAssetTurn(sessionId: string, userText: string): Promise<string> {
    const html = (await this.design.readCanvas(sessionId).catch(() => ({ html: null }))).html;
    const parts = [formatAssetCanvasSnapshot(html)];
    if (assetCanvasBrokenPrompt(userText)) parts.push(ASSET_CANVAS_IFRAME_NUDGE);
    return parts.join("\n\n");
  }

  private async primeDesignTurn(sessionId: string): Promise<string> {
    const html = await this.snapshotStudioBaseline(sessionId);
    return formatDesignCanvasSnapshot(html);
  }

  /** Live canvas facts for compact continue. Does not reset the turn-start mutate baseline. */
  private async liveCanvasSnapshot(session: AgentSession): Promise<string> {
    const html = (await this.design.readCanvas(session.id).catch(() => ({ html: null }))).html;
    if (isGameSession(session)) {
      let lastRun: ReturnType<typeof parseGameLastRun>;
      try {
        const file = await this.workspace.readWorkspace(session.id, GAME_LAST_RUN_PATH);
        if (file?.content) lastRun = parseGameLastRun(JSON.parse(file.content));
      } catch {
        /* missing or not JSON */
      }
      return formatGameCanvasSnapshot({ html, lastRun });
    }
    if (isAssetSession(session)) return formatAssetCanvasSnapshot(html);
    if (isDesignSession(session)) return formatDesignCanvasSnapshot(html);
    return "";
  }

  /** Prefix a CLI resume prompt with live canvas facts. Does not reset the turn-start mutate baseline. */
  private async prefixCliCanvasSnapshot(
    sessionId: string,
    prompt: string,
    planTurn: boolean,
  ): Promise<string> {
    if (planTurn || !prompt.trim()) return prompt;
    const session = await this.require(sessionId);
    if (!isCanvasSession(session)) return prompt;
    const snap = (await this.liveCanvasSnapshot(session)).trim();
    if (!snap) return prompt;
    if (
      prompt.startsWith("Game canvas snapshot") ||
      prompt.startsWith("Asset canvas snapshot") ||
      prompt.startsWith("Design canvas snapshot")
    ) {
      return prompt;
    }
    return `${snap}\n\n${prompt}`;
  }

  private cliTurnContinuePorts(): CliTurnContinuePorts {
    return {
      require: (id) => this.require(id),
      hasSteerAfter: (id, replyId) => this.hasSteerAfter(id, replyId),
      flushStreaming: (id) => this.design.flushStreaming(id),
      readCanvas: (id) => this.design.readCanvas(id),
      recoverCanvas: (id) => this.design.recover(id),
      restoreWipedCanvas: (id) => this.restoreWipedCanvas(id),
      rememberGoodStudioCanvas: (id, html) => this.rememberGoodStudioCanvas(id, html),
      leftoverAdherenceNudge: (session, html) => this.leftoverAdherenceNudge(session, html),
      studioIterateUnchanged: (input) =>
        this.studioIterateUnchanged(
          input.isGame,
          input.isAsset,
          input.isDesign,
          input.userText,
          input.html,
          input.sessionId,
        ),
      prefixPrompt: (id, prompt, planTurn) => this.prefixCliCanvasSnapshot(id, prompt, planTurn),
      appendMessage: (id, message) => this.appendMessage(id, message),
      gameCanvasBaseline: (id) => this.gameCanvasBaseline.get(id),
      traces: this.traces,
      now,
    };
  }

  private async continueAfterCliRound(
    input: Parameters<typeof continueAfterCliRound>[1],
  ): Promise<Awaited<ReturnType<typeof continueAfterCliRound>>> {
    return continueAfterCliRound(this.cliTurnContinuePorts(), input);
  }

  private hostCliTurnPorts(): HostCliTurnPorts {
    return {
      require: (id) => this.require(id),
      loadConfig: () => this.store.loadConfig(),
      dataDir: this.store.dataDir,
      appendMessage: (id, message) => this.appendMessage(id, message),
      patch: (id, body) => this.patch(id, body as never),
      patchMeta: (id, body) => this.patchMeta(id, body),
      isWorkerSession: (session) => this.isWorkerSession(session),
      workspaceRoot: (session) => this.workspaceRoot(session),
      writeWorkspace: (id, rel, body) => this.workspace.writeWorkspace(id, rel, body),
      cursorCliSpawner: () => this.cursorCliSpawner,
      claudeCodeSpawner: () => this.claudeCodeSpawner,
      codexCliSpawner: () => this.codexCliSpawner,
      kiroCliSpawner: () => this.kiroCliSpawner,
      requireWorker: (session) => this.requireWorker(session),
      spawnOnWorker: (client, vmId, sessionId, req) =>
        this.workerCursorCliHandle(client, vmId, sessionId, req),
      guestSsh: async (session) => {
        if (!session.vmId) return undefined;
        const vm = this.getMachine(session.vmId);
        if (!vm?.ssh) return undefined;
        return {
          host: vm.ssh.host,
          port: vm.ssh.port,
          username: vm.ssh.username,
          identityFile: vm.ssh.identityFile,
        };
      },
      primeGameTurn: (id, text) => this.primeGameTurn(id, text),
      snapshotStudioBaseline: (id) => this.snapshotStudioBaseline(id),
      primeAssetTurn: (id, text) => this.primeAssetTurn(id, text),
      primeDesignTurn: (id) => this.primeDesignTurn(id),
      cursorCliAttachmentNote: (id, workspace, user, promptText, worker) =>
        this.cursorCliAttachmentNote(id, workspace, user, promptText, worker),
      recordCursorCliContext: (id, prompt) => this.recordCursorCliContext(id, prompt),
      spawnAborts: this.cursorCliSpawnAborts,
      cliGitTurns: this.cliGitTurns,
      traces: this.traces,
      appendThinking: (id, messageId, text) => this.appendThinking(id, messageId, text),
      clearThinking: (id) => this.clearThinking(id),
      appendDelta: (id, messageId, delta) => this.appendDelta(id, messageId, delta),
      applyCursorCliUsage: (id, messageId, ev) => this.applyCursorCliUsage(id, messageId, ev),
      upsertCursorToolCall: (id, replyId, ev, turnId, round) =>
        this.upsertCursorToolCall(id, replyId, ev, turnId, round),
      applyCursorRunResult: (id, replyId, ev, sawText) =>
        this.applyCursorRunResult(id, replyId, ev, sawText),
      hasSteerAfter: (id, replyId) => this.hasSteerAfter(id, replyId),
      continueAfterCliRound: (input) => this.continueAfterCliRound(input),
      now,
    };
  }

  private async runHostCliTurn(input: {
    sessionId: string;
    userText: string;
    abort: AbortController;
    turnId: string;
    planTurn: boolean;
    stop: () => boolean;
    kind: "cursor" | "claude" | "codex" | "kiro";
  }): Promise<string> {
    return runHostCliTurn(this.hostCliTurnPorts(), input);
  }

  private workerCursorCliHandle(
    client: WorkerClient,
    vmId: string,
    sessionId: string,
    req: CursorCliSpawnRequest,
  ): CursorCliSpawnHandle {
    const abort = new AbortController();
    const onParent = () => abort.abort();
    if (req.signal) {
      if (req.signal.aborted) abort.abort();
      else req.signal.addEventListener("abort", onParent, { once: true });
    }
    const apiKey =
      req.env.CURSOR_API_KEY ||
      req.env.ANTHROPIC_API_KEY ||
      req.env.CLAUDE_API_KEY ||
      req.env.OPENAI_API_KEY ||
      req.env.KIRO_API_KEY;
    const answerMcp = (line: string) => {
      const mcp = parseWorkerCliMcpLine(line);
      if (!mcp) return false;
      void this.answerWorkerCliMcp(client, vmId, sessionId, mcp);
      return true;
    };
    const lines = (async function* () {
      const stream = await client.streamCursorCli(
        vmId,
        { command: req.command, args: req.args, apiKey },
        abort.signal,
      );
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split(/\r?\n/);
          buf = parts.pop() ?? "";
          for (const line of parts) {
            if (!answerMcp(line)) yield line;
          }
        }
        if (buf && !answerMcp(buf)) yield buf;
      } finally {
        req.signal?.removeEventListener("abort", onParent);
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
      }
    })();
    return {
      lines,
      wait: async () => ({ code: abort.signal.aborted ? 1 : 0, stderr: "" }),
      kill: () => abort.abort(),
    };
  }

  private async answerWorkerCliMcp(
    client: WorkerClient,
    vmId: string,
    sessionId: string,
    mcp: { id: string; path: string; body: unknown },
  ): Promise<void> {
    try {
      const scoped = mcp.path.startsWith("/mcp/sessions/");
      const result = await dispatchControlPlaneMcp({
        store: this.store,
        sessions: this,
        brain: this.brain,
        fetchFn: this.fetchFn,
        sessionId: scoped ? sessionId : undefined,
        raw: mcp.body,
      });
      await client.replyCursorCliMcp(vmId, {
        id: mcp.id,
        status: result.status,
        body: result.body,
      });
    } catch (err) {
      await client
        .replyCursorCliMcp(vmId, {
          id: mcp.id,
          status: 500,
          body: {
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32603,
              message: err instanceof Error ? err.message : "Control plane MCP failed",
            },
          },
        })
        .catch(() => undefined);
    }
  }

  private async cursorCliAttachmentNote(
    sessionId: string,
    workspace: string,
    user?: ReturnType<typeof lastUserMessage>,
    promptText = "",
    worker = false,
  ): Promise<string> {
    const files: string[] = [];
    if (user?.screenshotBase64 && isCursorImageMime(user.screenshotMime ?? "image/png")) {
      const name = user.screenshotName?.trim() || "screenshot.png";
      const rel = `.locus-attachments/${name}`;
      const bytes = Buffer.from(user.screenshotBase64, "base64");
      try {
        if (worker) {
          await this.workspace.writeWorkspaceBytes(sessionId, rel, bytes);
        } else {
          const dir = join(workspace, ".locus-attachments");
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, name), bytes);
        }
        files.push(rel);
      } catch {
        /* guest write is optional; stored attachments still land via syncChatAttachments */
      }
    }
    for (const att of user?.attachments ?? []) {
      const stored = att.storedName?.trim() || att.name?.trim();
      if (stored) files.push(`.locus-attachments/${stored}`);
    }
    const listed = files.filter((path) => !promptText.includes(path));
    if (!listed.length) return "";
    return `\n\nAttached files:\n${listed.map((path) => `- ${path}`).join("\n")}`;
  }

  private async cursorPromptImages(
    sessionId: string,
    user?: ReturnType<typeof lastUserMessage>,
  ): Promise<Array<{ data: string; mimeType: string }>> {
    const fromMessage = user
      ? chatMessageImages(user).filter(
          (img) => img.base64 && isCursorImageMime(img.mime ?? "image/png"),
        )
      : [];
    if (fromMessage.length) {
      return fromMessage.map((img) => ({
        data: img.base64!,
        mimeType: img.mime || "image/png",
      }));
    }
    if (user?.attachments?.length) {
      const stored = await storedImageBase64(this.store.dataDir, sessionId, user.attachments);
      if (stored && isCursorImageMime(stored.mime)) {
        return [{ data: stored.base64, mimeType: stored.mime }];
      }
    }
    return [];
  }

  private async upsertCursorToolCall(
    sessionId: string,
    replyId: string,
    ev: Extract<CursorCloudEvent, { type: "tool_call" }>,
    turnId: string,
    round: number,
  ): Promise<void> {
    const startedAt = now();
    const canonical = canonicalToolCall(ev.name, ev.arguments ?? {});
    const canvasHtml = canvasHtmlFromToolCall({
      name: canonical.name,
      arguments: canonical.arguments,
      result: ev.result,
    });
    if (canvasHtml) {
      this.design.paintStreaming(
        sessionId,
        "file_write",
        JSON.stringify({ path: DESIGN_CANVAS_PATH, content: canvasHtml }),
      );
    }
    const persistedArgs =
      ev.status === "completed"
        ? stubLargeWriteArgs(canonical.arguments, { keepKeys: ["patch"] })
        : canonical.arguments;
    const persistedResult =
      ev.result != null ? slimToolContent(annotateCanvasChangedOnDisk(ev.result)) : undefined;
    const failed =
      ev.status === "completed" && cursorCliToolCallOk(ev.status, persistedResult) === false;
    const call: ToolCall = {
      id: ev.id,
      name: canonical.name as ComputerUseToolName,
      arguments: persistedArgs,
      result: persistedResult,
      error: failed ? persistedResult : undefined,
      startedAt,
      finishedAt: ev.status === "completed" ? now() : undefined,
    };
    let inserted = false;
    await this.store.mutateSession(sessionId, (current) => {
      const msg = current.messages.find((message) => message.id === replyId);
      if (!msg) return;
      const existing = (msg.toolCalls ?? []).find((item) => item.id === ev.id);
      if (existing) {
        if (canonical.name !== "tool" || existing.name === "tool") {
          existing.name = canonical.name as ComputerUseToolName;
        }
        existing.arguments = { ...existing.arguments, ...persistedArgs };
        if (persistedResult != null) existing.result = persistedResult;
        if (ev.status === "completed") {
          existing.finishedAt = now();
          existing.error = failed ? persistedResult : undefined;
        }
      } else {
        inserted = true;
        msg.toolCalls = [...(msg.toolCalls ?? []), call];
      }
    });
    const session = await this.require(sessionId);
    const live = session.messages
      .find((message) => message.id === replyId)
      ?.toolCalls?.find((item) => item.id === ev.id);
    if (live) this.hub.broadcast({ type: "tool.updated", sessionId, toolCall: live });
    this.hub.broadcast({ type: "session.updated", session });
    if (inserted || ev.status === "completed") {
      await this.traces.write({
        t: now(),
        kind: ev.status === "completed" ? "tool.result" : "tool.call",
        sessionId,
        turnId,
        round,
        name: live?.name ?? canonical.name,
        detail: ev.status === "completed" && ev.result ? clipTraceDetail(ev.result) : ev.status,
        args: redactedTraceArgs(live?.arguments ?? canonical.arguments ?? {}),
        ok: cursorCliToolCallOk(ev.status, ev.result),
      });
    }
    if (ev.status === "completed" && isCursorCreatePlanTool(canonical.name)) {
      await this.applyCursorCreatePlan(sessionId, replyId, canonical.arguments);
    }
  }

  private async applyCursorCreatePlan(
    sessionId: string,
    replyId: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    const plan = planFromCursorCreatePlan(args, replyId);
    if (!plan?.items.length) return;
    await this.patch(sessionId, {
      plan,
      taskList: taskListFromPlan(plan),
    });
  }

  private async applyCursorRunResult(
    sessionId: string,
    replyId: string,
    ev: Extract<CursorCloudEvent, { type: "result" }>,
    sawText: boolean,
  ): Promise<void> {
    if (ev.text?.trim() && !sawText) {
      await this.appendDelta(sessionId, replyId, ev.text);
    }
    const pr = ev.git?.branches?.map((row) => row.prUrl).find((url) => url?.trim());
    const branch = ev.git?.branches?.find((row) => row.branch || row.prUrl);
    const head = cleanGitHeadName(branch?.branch ?? "");
    if (!pr && !head) return;
    const pull = pr ? parseGithubPullUrl(pr) : undefined;
    await this.store.mutateSession(sessionId, (current) => {
      const msg = current.messages.find((message) => message.id === replyId);
      if (msg && pr) {
        const already = (msg.toolCalls ?? []).some((call) => call.name === "git_pr");
        if (!already) {
          msg.toolCalls = [
            ...(msg.toolCalls ?? []),
            {
              id: randomUUID(),
              name: "git_pr",
              arguments: { url: pr },
              result: JSON.stringify({ html_url: pr }),
              startedAt: now(),
              finishedAt: now(),
            },
          ];
        }
      }
      if (pull) current.pull = { ...pull, headRef: pull.headRef ?? head };
      if (head) current.gitBranch = head;
    });
    this.hub.broadcast({ type: "session.updated", session: await this.require(sessionId) });
  }

  private async cancelCursorCloudRun(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    const agentId = session?.cursorCloud?.agentId;
    const runId = session?.cursorCloud?.runId;
    if (!session || !agentId || !runId) return;
    const config = await this.store.loadConfig();
    const provider = config.providers.find((p) => p.id === session.providerId);
    if (!provider || !hasUsableKey(provider.apiKey, provider.baseUrl, provider.kind)) return;
    await cancelCursorRun(provider, { agentId, runId }, { fetchFn: this.fetchFn }).catch(
      () => undefined,
    );
  }

  async abortChat(sessionId: string): Promise<void> {
    this.haltTurn(sessionId);
    await this.pauseQueue(sessionId);
    await this.resetRunningPlanSteps(sessionId);
    await this.cancelCursorCloudRun(sessionId);
  }

  /** Stop the in-flight turn without pausing the follow-up queue. */
  private haltTurn(sessionId: string): void {
    this.aborts.get(sessionId)?.abort();
    this.aborts.delete(sessionId);
    this.cursorCliSpawnAborts.get(sessionId)?.abort();
    this.cursorCliSpawnAborts.delete(sessionId);
    this.llmStreamAborts.get(sessionId)?.abort();
    this.llmStreamAborts.delete(sessionId);
    this.cancelApprovals(sessionId);
  }

  async sendQueuedNow(sessionId: string, itemId: string): Promise<AgentSession> {
    const current = await this.require(sessionId);
    if (!(current.queue ?? []).some((row) => row.id === itemId)) {
      throw new Error("Queued prompt not found");
    }
    // Abort before popping so a finishing turn cannot drainQueue the remaining
    // items while this prompt is still being persisted.
    this.haltTurn(sessionId);
    let popped: PromptQueueItem | undefined;
    const updated = await this.store.mutateSession(sessionId, (session) => {
      const queue = session.queue ?? [];
      const index = queue.findIndex((row) => row.id === itemId);
      if (index < 0) throw new Error("Queued prompt not found");
      popped = queue[index];
      const rest = queue.filter((row) => row.id !== itemId);
      session.queue = rest.length ? rest : undefined;
      if (!rest.length) session.queuePaused = undefined;
    });
    if (!updated || !popped) throw new Error(`Session not found: ${sessionId}`);
    this.hub.broadcast({ type: "session.updated", session: updated });
    try {
      await this.sendChat(sessionId, popped.text, {
        plan: popped.plan,
        skill: popped.skill,
        attachments: popped.attachments,
        interrupt: true,
        notifySessionId: popped.notifySessionId,
        wakeRequester: popped.wakeRequester,
      });
    } catch (err) {
      const restored = await this.store
        .mutateSession(sessionId, (current) => {
          current.queue = normalizePromptQueue([popped!, ...(current.queue ?? [])]);
        })
        .catch(() => undefined);
      if (restored) this.hub.broadcast({ type: "session.updated", session: restored });
      throw err;
    }
    return this.require(sessionId);
  }

  private async appendSteer(
    sessionId: string,
    body: string,
    attachments: ChatAttachment[],
    incoming: IncomingAttachment[],
  ): Promise<void> {
    await this.require(sessionId);
    let image = firstImageBase64(incoming);
    let imageMime = image
      ? incoming.find((item) => item.mime.startsWith("image/"))?.mime
      : undefined;
    if (!image && attachments.length) {
      const stored = await storedImageBase64(this.store.dataDir, sessionId, attachments);
      image = stored?.base64;
      imageMime = stored?.mime;
    }
    await this.store.mutateSession(sessionId, (current) => {
      applyRequestedDefaultSubagent(current, body);
    });
    await this.appendMessage(sessionId, {
      id: randomUUID(),
      role: "user",
      content: body,
      steer: true,
      attachments: attachments.length ? attachments : undefined,
      screenshotBase64: image,
      screenshotMime: image ? imageMime : undefined,
      createdAt: now(),
    });
  }

  private async hasSteerAfter(sessionId: string, replyId: string): Promise<boolean> {
    const session = await this.get(sessionId);
    if (!session) return false;
    const index = session.messages.findIndex((message) => message.id === replyId);
    if (index < 0) return false;
    return session.messages.slice(index + 1).some((message) => message.role === "user");
  }

  private async tryLlmCompact(input: {
    session: AgentSession;
    provider: LocusConfig["providers"][number];
    dropped: ChatMessage[];
    workingState: ReturnType<typeof sessionWorkingState>;
    inspectedFiles?: string[];
    abort: AbortController;
  }): Promise<string | undefined> {
    const droppedText = buildLlmCompactUserPrompt({
      dropped: input.dropped,
      workingState: input.workingState,
      inspectedFiles: input.inspectedFiles,
    });
    if (!droppedText.trim()) return undefined;
    let text = "";
    try {
      const stream = runChatTurn(
        (req) => this.chatEngine(req),
        {
          provider: input.provider,
          model: input.session.model,
          system: LLM_COMPACT_SYSTEM,
          messages: [
            {
              id: randomUUID(),
              role: "user",
              content: droppedText,
              createdAt: now(),
            },
          ],
          allowedTools: [],
          extraTools: [],
          maxTokens: 1024,
          signal: input.abort.signal,
        },
        { timeoutMs: 20_000, delaysMs: [200], idleMs: 15_000 },
      );
      for await (const ev of stream) {
        if (ev.type === "text") text += ev.text;
      }
    } catch {
      return undefined;
    }
    return formatLlmCompactNote(text, input.workingState, input.inspectedFiles);
  }

  private async patchSubagent(sessionId: string, live: SubagentLive): Promise<void> {
    const session = await this.store.mutateSession(sessionId, (current) => {
      const rows = [...(current.subagents ?? [])];
      const index = rows.findIndex((row) => row.id === live.id);
      const prev = index >= 0 ? rows[index] : undefined;
      const next: SubagentLive = {
        ...prev,
        ...live,
        lastLine: live.lastLine ?? prev?.lastLine,
        inputTokens: live.inputTokens ?? prev?.inputTokens,
        outputTokens: live.outputTokens ?? prev?.outputTokens,
        toolCallId: live.toolCallId ?? prev?.toolCallId,
        kind: live.kind ?? prev?.kind,
        messages: live.messages
          ? (structuredClone(live.messages) as SubagentLive["messages"])
          : prev?.messages,
      };
      if (index >= 0) rows[index] = next;
      else {
        rows.push(next);
        if (rows.length > 20) rows.splice(0, rows.length - 20);
      }
      current.subagents = rows;
    });
    if (session) this.hub.broadcast({ type: "session.updated", session });
  }

  async checkpointDiff(sessionId: string, checkpointId: string): Promise<string> {
    const session = await this.require(sessionId);
    return diffTurnCheckpoints(
      rewindTargets(session),
      checkpointId,
      this.workspaceRoot(session),
      diffCheckpointRefs,
    );
  }

  private async enqueuePrompt(
    sessionId: string,
    content: string,
    opts?: {
      plan?: boolean;
      skill?: string;
      attachments?: ChatAttachment[];
      notifySessionId?: string;
      wakeRequester?: boolean;
    },
  ): Promise<void> {
    const text = content.trim();
    if (!text && !opts?.attachments?.length) throw new Error("Empty message");
    const skill = opts?.skill?.trim().toLowerCase() || undefined;
    const notifySessionId = opts?.notifySessionId?.trim() || undefined;
    const item: PromptQueueItem = {
      id: randomUUID(),
      text,
      plan: opts?.plan ? true : undefined,
      skill,
      attachments: opts?.attachments?.length ? opts.attachments : undefined,
      notifySessionId,
      wakeRequester: opts?.wakeRequester === false ? false : undefined,
    };
    const limit = promptQueueLimit((await this.store.loadConfig()).advanced.maxPromptQueue);
    const updated = await this.store.mutateSession(sessionId, (current) => {
      if ((current.queue?.length ?? 0) >= limit) {
        throw new Error(`Queue is full (${limit} prompts)`);
      }
      current.queue = normalizePromptQueue([...(current.queue ?? []), item]);
    });
    if (!updated) throw new Error(`Session not found: ${sessionId}`);
    this.hub.broadcast({ type: "session.updated", session: updated });
  }

  private async pauseQueue(sessionId: string): Promise<void> {
    const updated = await this.store.mutateSession(sessionId, (current) => {
      if (current.queue?.length) current.queuePaused = true;
    });
    if (updated) this.hub.broadcast({ type: "session.updated", session: updated });
  }

  private async drainQueue(sessionId: string): Promise<void> {
    if (this.draining.has(sessionId) || this.aborts.has(sessionId)) return;
    this.draining.add(sessionId);
    let popped: PromptQueueItem | undefined;
    try {
      const session = await this.get(sessionId);
      if (
        !session ||
        session.queuePaused ||
        isHumanDriving(session) ||
        session.status === "running"
      )
        return;
      const landed = lastUserMessage(session.messages)?.content;
      const pending = pendingPromptQueue(session.queue, landed);
      if (pending.length !== (session.queue?.length ?? 0) && !pending.length) {
        const cleared = await this.store.mutateSession(sessionId, (current) => {
          current.queue = undefined;
          current.queuePaused = undefined;
        });
        if (cleared) this.hub.broadcast({ type: "session.updated", session: cleared });
        return;
      }
      const next = pending[0];
      if (!next) return;
      const rest = pending.slice(1);
      popped = next;
      await this.store.mutateSession(sessionId, (current) => {
        current.queue = rest.length ? rest : undefined;
        if (!rest.length) current.queuePaused = undefined;
      });
      await this.sendChat(sessionId, next.text, {
        plan: next.plan,
        skill: next.skill,
        attachments: next.attachments,
        notifySessionId: next.notifySessionId,
        wakeRequester: next.wakeRequester,
      });
    } catch {
      if (popped) {
        await this.store
          .mutateSession(sessionId, (current) => {
            current.queue = normalizePromptQueue([popped!, ...(current.queue ?? [])]);
          })
          .catch(() => undefined);
      }
    } finally {
      this.draining.delete(sessionId);
    }
  }

  private async dropDuplicateQueuedPrompt(
    sessionId: string,
    text: string,
    hadAttachments: boolean,
  ): Promise<void> {
    if (hadAttachments || !text.trim()) return;
    let changed = false;
    const updated = await this.store.mutateSession(sessionId, (current) => {
      const next = dropLandedQueueItems(current.queue, text);
      if (next === current.queue) return;
      current.queue = next;
      if (!next?.length) current.queuePaused = undefined;
      changed = true;
    });
    if (changed && updated) this.hub.broadcast({ type: "session.updated", session: updated });
  }

  async resolveApproval(
    sessionId: string,
    toolCallId: string,
    decision: "approved" | "denied",
    answer?: string,
    persist?: boolean,
  ): Promise<AgentSession> {
    const session = await this.require(sessionId);
    const waiter = this.approvals.get(`${sessionId}:${toolCallId}`);
    if (!waiter) throw new Error("Nothing waiting for approval");
    let entry: string | undefined;
    let extraInstall = false;
    if (decision === "approved" && persist) {
      for (const message of session.messages) {
        const call = message.toolCalls?.find((item) => item.id === toolCallId);
        if (call) {
          let args = call.arguments ?? {};
          if (
            (call.name === "git_push" ||
              call.name === "git_pr" ||
              call.name === "git_pr_merge" ||
              call.name === "git_pr_review" ||
              call.name === "git_pr_comment") &&
            typeof args.branch !== "string"
          ) {
            const head = await this.resolveGitHeadBranch(session, args);
            if (head) args = { ...args, branch: head };
          }
          entry = stickyAllowEntry(call.name, args);
          extraInstall =
            (call.name === "exec" || call.name === "powershell") &&
            installCommandsNeedApproval(execArgCommands(args));
          break;
        }
      }
    }
    await this.store.mutateSession(sessionId, (current) => {
      for (const message of current.messages) {
        const call = message.toolCalls?.find((item) => item.id === toolCallId);
        if (call) call.approval = decision;
      }
      if (entry) {
        const next = [...(current.autoAllow ?? [])];
        if (!next.includes(entry)) next.push(entry);
        if (extraInstall && !next.includes("install")) next.push("install");
        current.autoAllow = next;
      }
    });
    waiter(decision, answer);
    const saved = await this.require(sessionId);
    let toolName = "tool";
    for (const message of saved.messages) {
      const call = message.toolCalls?.find((item) => item.id === toolCallId);
      if (call) {
        toolName = call.name;
        break;
      }
    }
    void this.traces.write({
      t: now(),
      kind: "approval",
      sessionId,
      name: decision,
      id: toolCallId,
      args: { tool: toolName, by: "operator", persist: persist === true },
    });
    this.hub.broadcast({ type: "session.updated", session: saved });
    return saved;
  }

  private awaitApproval(
    sessionId: string,
    toolCallId: string,
    abort: AbortSignal,
  ): Promise<{ decision: "approved" | "denied" | "cancelled"; answer?: string }> {
    const key = `${sessionId}:${toolCallId}`;
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (decision: "approved" | "denied" | "cancelled", answer?: string) => {
        if (!this.approvals.has(key)) return;
        this.approvals.delete(key);
        abort.removeEventListener("abort", onAbort);
        if (timer) clearTimeout(timer);
        resolve({ decision, answer });
      };
      const onAbort = () => done("cancelled");
      if (abort.aborted) {
        resolve({ decision: "cancelled" });
        return;
      }
      abort.addEventListener("abort", onAbort);
      this.approvals.set(key, done);
      void this.require(sessionId)
        .then((session) => {
          let toolName = "";
          for (const message of session.messages) {
            const call = message.toolCalls?.find((item) => item.id === toolCallId);
            if (call) {
              toolName = call.name;
              break;
            }
          }
          this.plane.onSlackApproval?.(sessionId, toolName, toolCallId);
        })
        .catch(() => undefined);
      void this.store.loadConfig().then((config) => {
        if (!this.approvals.has(key)) return;
        const ms = approvalTimeoutMs(config.advanced.approvalTimeoutMs);
        timer = setTimeout(() => done("denied"), ms);
      });
    });
  }

  private cancelApprovals(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const [key, done] of this.approvals) {
      if (key.startsWith(prefix)) done("cancelled");
    }
  }

  async rewind(sessionId: string, checkpointId?: string): Promise<AgentSession> {
    await this.abortChat(sessionId);
    this.turnEpoch.set(sessionId, (this.turnEpoch.get(sessionId) ?? 0) + 1);
    const session = await this.require(sessionId);
    const targets = rewindTargets(session);
    const idx = checkpointId
      ? targets.findIndex((item) => item.id === checkpointId)
      : targets.length - 1;
    const checkpoint = idx >= 0 ? targets[idx] : undefined;
    if (!checkpoint) throw new Error("Nothing to undo");
    session.messages = session.messages.slice(0, checkpoint.messageCount);
    session.usage = session.messages.reduce(
      (acc, message) => addUsage(acc, message.usage),
      undefined as AgentSession["usage"],
    );
    applyCheckpointWorkingState(session, checkpoint);
    session.subagents = keepSubagentsForMessages(session.subagents, session.messages);
    const kept = targets.slice(0, idx);
    const dropped = targets.slice(idx);
    session.checkpoints = kept.length ? kept : undefined;
    session.checkpoint = kept[kept.length - 1];
    session.status = parkedStatus(session);
    session.error = undefined;
    session.queue = undefined;
    session.queuePaused = undefined;
    session.updatedAt = now();
    await this.replace(session);

    const docker = sessionRuntime(session) === "docker";
    const workspace = this.workspaceRoot(session);
    await restoreWorkspaceCheckpoint({
      checkpoint,
      vmId: session.vmId,
      workspace,
      restoreDisk: async (srcPath) => {
        const vm = session.vmId ? this.getMachine(session.vmId) : undefined;
        await restoreMachineCheckpoint({
          docker,
          running: Boolean(
            vm && vm.status !== "stopped" && vm.status !== "error" && vm.status !== "creating",
          ),
          vmId: session.vmId!,
          srcPath,
          dockerEngine: this.docker,
          hypervisor: this.hypervisor,
          stop: () => this.stopVm(sessionId),
          start: () => this.startVm(sessionId),
        });
      },
      restoreGit: restoreCheckpointRef,
      dropDropped: () => this.dropCheckpointArtifacts(workspace, dropped),
    });

    const saved = await this.require(sessionId);
    this.hub.broadcast({ type: "session.updated", session: saved });
    return saved;
  }

  async clearChat(sessionId: string): Promise<AgentSession> {
    await this.abortChat(sessionId);
    this.turnEpoch.set(sessionId, (this.turnEpoch.get(sessionId) ?? 0) + 1);
    const session = await this.require(sessionId);
    if (!canClearChat(session)) throw new Error("Nothing to clear");
    // Distill before wiping so Clear chat still feeds the brain.
    if (this.brain && sessionOffersBrain(session)) {
      const timer = this.brainDistillTimers.get(sessionId);
      if (timer) {
        clearTimeout(timer);
        this.brainDistillTimers.delete(sessionId);
      }
      await this.runBrainDistill(sessionId).catch(() => undefined);
    }
    const dropped = rewindTargets(session);
    clearSessionConversation(session);
    session.status = parkedStatus(session);
    session.updatedAt = now();
    await this.replace(session);
    await this.dropCheckpointArtifacts(this.workspaceRoot(session), dropped);
    const saved = await this.require(sessionId);
    this.hub.broadcast({ type: "session.updated", session: saved });
    return saved;
  }

  private async dropCheckpointArtifacts(
    workspace: string | undefined,
    dropped: SessionCheckpoint[],
  ): Promise<void> {
    await dropCheckpointArtifacts(workspace, dropped, {
      deleteGitRef: deleteCheckpointRef,
      removePath: fsRemoveCheckpointPath,
    });
  }

  async takeover(sessionId: string): Promise<AgentSession> {
    const session = await this.require(sessionId);
    if (!runtimeNeedsGuest(sessionRuntime(session))) {
      throw new Error("Host agents do not have a VM or container.");
    }
    await this.abortChat(sessionId);
    this.turnEpoch.set(sessionId, (this.turnEpoch.get(sessionId) ?? 0) + 1);
    const updated = await this.store.mutateSession(sessionId, (current) => {
      current.control = "human";
      if (current.status === "running") current.status = parkedStatus(current);
    });
    if (!updated) throw new Error(`Session not found: ${sessionId}`);
    this.hub.broadcast({ type: "session.updated", session: updated });
    return updated;
  }

  async handback(sessionId: string): Promise<AgentSession> {
    const updated = await this.store.mutateSession(sessionId, (current) => {
      current.control = undefined;
    });
    if (!updated) throw new Error(`Session not found: ${sessionId}`);
    this.hub.broadcast({ type: "session.updated", session: updated });
    await this.drainQueue(sessionId);
    return (await this.get(sessionId)) ?? updated;
  }

  async takeoverBrowser(sessionId: string): Promise<AgentSession> {
    const session = await this.require(sessionId);
    if (sessionRuntime(session) !== "docker") {
      throw new Error("Browser takeover is only for Docker agents.");
    }
    const updated = await this.store.mutateSession(sessionId, (current) => {
      current.browserControl = "human";
    });
    if (!updated) throw new Error(`Session not found: ${sessionId}`);
    this.browsers.notifyControl(sessionId, "operator");
    this.hub.broadcast({ type: "session.updated", session: updated });
    return updated;
  }

  async handbackBrowser(sessionId: string): Promise<AgentSession> {
    const updated = await this.store.mutateSession(sessionId, (current) => {
      current.browserControl = undefined;
    });
    if (!updated) throw new Error(`Session not found: ${sessionId}`);
    this.browsers.notifyControl(sessionId, "agent");
    this.hub.broadcast({ type: "session.updated", session: updated });
    return updated;
  }

  async fork(sessionId: string): Promise<AgentSession> {
    const session = await this.require(sessionId);
    const runtime = sessionRuntime(session);
    let imageId = session.imageId;
    if (runtime === "docker" || session.vmId) {
      try {
        const image = await this.captureImage(sessionId, `${session.title} fork`);
        imageId = image.id;
      } catch {
        /* draft sessions may have no workspace to snapshot yet */
      }
    }
    const hardware = session.hardware
      ? {
          cpuCores: session.hardware.cpuCores,
          memoryMb: session.hardware.memoryMb,
          diskSizeGb: session.hardware.diskSizeGb,
        }
      : undefined;
    const shareHostDir =
      runtime === "host" && Boolean(session.hostDir?.trim()) && !isCanvasSession(session);
    const forked = await this.create({
      title: `${session.title} fork`,
      os: session.os,
      templateId: session.templateId,
      kind: sessionKind(session),
      runtime,
      dockerImage: session.dockerImage,
      hostDir: shareHostDir ? session.hostDir : undefined,
      providerId: session.providerId,
      model: session.model,
      reasoningEffort: session.reasoningEffort,
      repo: session.repo,
      repoId: session.repoId,
      extraRepos: session.extraRepos,
      extraRepoIds: session.extraRepoIds,
      branchLock: session.branchLock,
      hardware,
      imageId,
      instructions: session.instructions,
      playbook: session.playbook,
      palette: session.palette,
      designSystemId: session.designSystemId,
      assetStyleId: session.assetStyleId,
      gameStyleId: session.gameStyleId,
      assetBuild: session.assetBuild,
      role: session.role,
      guestEnv: session.guestEnv,
      allowedTools: session.allowedTools,
      network: session.network,
      vision: session.vision,
      webSearch: session.webSearch,
      liveChrome: session.liveChrome,
      persistMemory: session.persistMemory,
      allowHosts: session.allowHosts,
      maxUsd: session.maxUsd,
      maxMs: session.maxMs,
      autonomy: session.autonomy,
      placement: session.placement,
      backendId: session.backendId,
      persona: session.persona,
      surface: session.surface,
      projectId: parseSessionSurface(session.surface) === "swarm" ? session.projectId : undefined,
      startVm: false,
    });
    await this.copyForkWorkspace(session, forked);
    if (session.agentCanvases?.length) {
      await this.agentCanvases.copy(session.id, forked.id);
    }
    const extras: Partial<
      Pick<
        AgentSession,
        | "assetAppliedBuild"
        | "plan"
        | "defaultSubagent"
        | "designTune"
        | "designVariants"
        | "activeVariantId"
        | "designPins"
        | "agentCanvases"
      >
    > = {};
    if (session.assetAppliedBuild) extras.assetAppliedBuild = session.assetAppliedBuild;
    if (session.plan) extras.plan = session.plan;
    if (isSubagentKind(session.defaultSubagent)) extras.defaultSubagent = session.defaultSubagent;
    if (session.designTune) extras.designTune = session.designTune;
    if (session.designVariants?.length) extras.designVariants = session.designVariants;
    if (session.activeVariantId) extras.activeVariantId = session.activeVariantId;
    if (session.designPins?.length) extras.designPins = session.designPins;
    if (session.agentCanvases?.length) extras.agentCanvases = session.agentCanvases;
    if (Object.keys(extras).length) return this.patch(forked.id, extras);
    return this.require(forked.id);
  }

  /** Overlay the source workspace after create so kit landing cannot wipe the copy. */
  private async copyForkWorkspace(src: AgentSession, dest: AgentSession): Promise<void> {
    const shareHostDir =
      sessionRuntime(src) === "host" && Boolean(src.hostDir?.trim()) && !isCanvasSession(src);
    if (shareHostDir) return;
    const from = this.workspaceRoot(src);
    const to = this.workspaceRoot(dest);
    if (!from || !to || from === to) return;
    try {
      await mkdir(to, { recursive: true });
      await cp(from, to, { recursive: true, force: true });
    } catch {
      /* source workspace may not exist yet */
    }
  }

  async spawnWorkers(
    sessionId: string,
    input: { count?: unknown; prompt?: string; models?: unknown } = {},
  ): Promise<AgentSession[]> {
    const session = await this.require(sessionId);
    if (sessionRuntime(session) !== "docker") {
      throw new Error(
        "Parallel workers are Docker-only. Fork the agent or switch to a Docker runtime.",
      );
    }
    if (isCanvasSession(session))
      throw new Error("Workers are for coding agents, not Design or Games");
    if (isReviewSession(session)) throw new Error("Workers are for coding agents, not reviews");
    if (session.compare) throw new Error("Finish the current compare or workers first");
    const count = parseWorkerCount(input.count ?? WORKER_COUNT_DEFAULT);
    if (!count) throw new Error("Spawn 2, 3, or 4 workers");
    const prompt = input.prompt?.trim() || lastUserPrompt(session.messages);
    if (!prompt) throw new Error("Send a prompt first");
    const models = Array.isArray(input.models)
      ? input.models
          .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
          .map((item) => item.trim())
      : [];
    let imageId = session.imageId;
    if (session.vmId) {
      const image = await this.captureImage(sessionId, `${session.title} workers`);
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
        await this.create({
          title: `${session.title} · ${i}`,
          os: session.os,
          templateId: session.templateId,
          runtime: "docker",
          dockerImage: session.dockerImage,
          providerId: session.providerId,
          model: models[i - 1] || session.model,
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
      await this.executeTool(
        created[i - 1]!.id,
        { name: "git_branch", args: { name: branch } },
        { ignoreAllowlist: true },
      ).catch(() => undefined);
    }
    const groupId = randomUUID();
    const memberIds = created.map((row) => row.id);
    const linked: AgentSession[] = [];
    for (const [index, child] of created.entries()) {
      const role = String(index + 1);
      linked.push(
        await this.patchMeta(child.id, {
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
    await this.patchMeta(sessionId, {
      compare: {
        groupId,
        kind: "workers",
        role: "parent",
        memberIds,
      },
    });
    await Promise.allSettled(linked.map((child) => this.sendChat(child.id, prompt)));
    return Promise.all(linked.map((child) => this.require(child.id)));
  }

  async workerDiffs(
    sessionId: string,
  ): Promise<Array<{ id: string; role: string; branch?: string; diff: string }>> {
    const session = await this.require(sessionId);
    const members =
      session.compare?.kind === "workers"
        ? (session.compare.memberIds ?? [sessionId])
        : session.compare?.peerId
          ? [sessionId, session.compare.peerId]
          : [sessionId];
    const sessions = await this.store.loadSessions();
    const rows = members
      .map((id) => sessions.find((row) => row.id === id))
      .filter((row): row is AgentSession => Boolean(row));
    const out: Array<{ id: string; role: string; branch?: string; diff: string }> = [];
    for (const member of rows) {
      let diff = "";
      try {
        const result = await this.executeTool(
          member.id,
          { name: "git_diff", args: {} },
          { ignoreAllowlist: true },
        );
        diff = result.output.slice(0, 20_000);
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
    const worker = await this.require(workerId);
    const parentId = worker.compare?.parentId || sessionId;
    if (parentId === workerId) throw new Error("Pick a worker to merge into the parent");
    const parent = await this.require(parentId);
    if (sessionRuntime(parent) !== "docker" || sessionRuntime(worker) !== "docker") {
      throw new Error("Worker merge is Docker-only");
    }
    const src = worker.vmId
      ? this.docker.get(worker.vmId)?.diskPath
      : join(this.store.dataDir, "docker-workspaces", worker.id);
    const destVm = parent.vmId ? this.docker.get(parent.vmId) : undefined;
    if (!src || !destVm) throw new Error("Start both containers before merging");
    const restart = destVm.status === "running" || destVm.status === "ready";
    if (restart) await this.stopVm(parent.id).catch(() => undefined);
    await this.docker.restoreWorkspace?.(destVm.id, src);
    if (restart) await this.startVm(parent.id).catch(() => undefined);
    await this.appendMessage(parent.id, {
      id: randomUUID(),
      role: "system",
      content: `Merged worker ${worker.compare?.role ?? worker.title} (${worker.compare?.branch ?? "branch"}) into this workspace.`,
      createdAt: now(),
    });
    return this.require(parent.id);
  }

  async undoFile(sessionId: string): Promise<AgentSession> {
    const session = await this.require(sessionId);
    const entry = session.fileUndo?.at(-1);
    if (!entry) throw new Error("No file to undo");
    await this.executeTool(
      sessionId,
      { name: "file_write", args: { path: entry.path, content: entry.previous } },
      { ignoreAllowlist: true },
    );
    await this.store.mutateSession(sessionId, (current) => {
      current.fileUndo = (current.fileUndo ?? []).slice(0, -1);
    });
    return this.require(sessionId);
  }

  async cycleRole(sessionId: string): Promise<AgentSession> {
    const session = await this.require(sessionId);
    const role = nextAgentRole(session.role);
    return this.patchMeta(sessionId, { role, playbook: rolePlaybook(role) });
  }

  async listSkills(sessionId: string): Promise<AgentSkill[]> {
    const session = await this.require(sessionId);
    const config = await this.store.loadConfig();
    return mergeSkills(config.skills, await this.repoSkills(session));
  }

  private hostRoot(session: AgentSession): string {
    return sessionHostWorkspace(this.store.dataDir, session);
  }

  private workspaceRoot(session: AgentSession): string | undefined {
    if (this.isWorkerSession(session)) return workerMirrorDir(this.store.dataDir, session.id);
    const runtime = sessionRuntime(session);
    if (runtime === "host") return this.hostRoot(session);
    if (runtime === "vm") return vmTreeDir(this.store.dataDir, session.id);
    if (runtime !== "docker") return undefined;
    return session.vmId
      ? this.docker.get(session.vmId)?.diskPath
      : join(this.store.dataDir, "docker-workspaces", session.id);
  }

  /** Design sessions with a linked repo keep the clone under _repo for read-only context. */
  private repoContextRoot(session: AgentSession): string | undefined {
    const root = this.workspaceRoot(session);
    if (!root) return undefined;
    if (isCanvasSession(session) && session.repo?.url) return join(root, DESIGN_REPO_CONTEXT_DIR);
    return this.sessionCheckoutHostRoot(session, session.repo);
  }

  private sessionCheckoutHostRoot(
    session: AgentSession,
    checkout?: import("@locus/shared").RepoCheckout,
  ): string | undefined {
    const root = this.workspaceRoot(session);
    if (!root) return undefined;
    const rel = destRelativeToWorkspace(
      checkout?.dest,
      workspacePath(session.os, sessionRuntime(session)).replace(/\\/g, "/"),
    );
    return rel ? join(root, ...rel.split("/")) : root;
  }

  /** Host bind-mounts and local Docker trees: skip clone when HEAD already exists. */
  private liveCheckoutReady(
    session: AgentSession,
    checkout?: import("@locus/shared").RepoCheckout,
  ): boolean {
    if (!checkout?.url || this.isWorkerSession(session)) return false;
    const runtime = sessionRuntime(session);
    if (runtime !== "host" && runtime !== "docker") return false;
    const root = isCanvasSession(session)
      ? this.repoContextRoot(session)
      : this.sessionCheckoutHostRoot(session, checkout);
    return Boolean(root && gitCheckoutReady(root));
  }

  /** Coding sessions clone into `/workspace`; keep that tree empty until git clone returns. */
  private repoWorkspaceClonePending(session: AgentSession): boolean {
    return repoWorkspaceClonePending(session, this.cloned, this.cloneInflight);
  }

  private attachmentWorkspaceRoot(session: AgentSession): string | undefined {
    return attachmentWorkspaceRoot(
      session,
      this.cloned,
      this.cloneInflight,
      this.store.dataDir,
      this.hostRoot(session),
    );
  }

  private hostGuest(session: AgentSession) {
    this.chromeExtension.setLiveChrome(session.id, sessionLiveChrome(session));
    return this.guests.forHost(
      session.id,
      session.os,
      this.hostRoot(session),
      hostChromeProfileDir(this.store.dataDir, session.id),
    );
  }

  private dockerWorkspaceRoot(session: AgentSession): string {
    return this.workspaceRoot(session) || dockerWorkspaceDir(this.store.dataDir, session.id);
  }

  private async syncGuestTree(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    if (!session?.vmId) return;
    try {
      if (this.isWorkerSession(session)) {
        const dest = workerMirrorDir(this.store.dataDir, session.id);
        await mkdir(dest, { recursive: true });
        const client = await this.requireWorker(session);
        const archive = await client.downloadWorkspace(session.vmId);
        await unpackWorkerMirror(dest, archive);
        return;
      }
      if (sessionRuntime(session) !== "vm") return;
      const vm = this.getMachine(session.vmId);
      if (!vm || !isGuestReady(vm.status)) return;
      const dest = vmTreeDir(this.store.dataDir, session.id);
      const listed = await this.guests.forVm(vm).execute({
        name: "exec",
        args: { command: VM_TREE_FIND },
      });
      if (!listed.ok) return;
      const paths = listed.output
        .split("\n")
        .map((row) => row.trim())
        .filter(Boolean)
        .slice(0, 400);
      const files: Array<{ path: string; content: string }> = [];
      for (const path of paths) {
        const read = await this.guests.forVm(vm).execute({
          name: "file_read",
          args: { path },
        });
        if (!read.ok) continue;
        files.push({ path, content: read.output });
      }
      await writeGuestFiles(dest, files);
    } catch {
      /* index stays empty until the next ready tick */
    }
  }

  /** Docker bind mounts are often root-owned after `npm install`; host vitest then cannot write `.vite-temp`. */
  private async prepareHostWorkspace(session: AgentSession): Promise<void> {
    if (sessionRuntime(session) !== "docker" || this.isWorkerSession(session)) return;
    const vm = session.vmId ? this.getMachine(session.vmId) : undefined;
    if (!vm) return;
    await this.guests.forVm(vm).prepareHostWorkspace();
  }

  private async runPublishTestGate(
    session: AgentSession,
    checkout?: import("@locus/shared").RepoCheckout,
  ): Promise<WorkspaceScriptResult> {
    const root = this.sessionCheckoutHostRoot(session, checkout);
    const state = await workspaceGitState(root);
    const key =
      state?.clean && root ? `${root}\u0000${state.head}\u0000${state.dependencyStamp}` : undefined;
    if (key) {
      const cached = this.publishTestCache.get(key);
      if (cached) return { ...cached, cached: true };
    }
    const result = await runWorkspaceNpmScript(root, "test");
    const retryable =
      result.failureKind === "missing-dependencies" || result.failureKind === "runner";
    const cacheable = result.ok || !retryable;
    const enriched = { ...result, retryable };
    if (key && cacheable) {
      this.publishTestCache.set(key, enriched);
    }
    return enriched;
  }

  private async syncChatAttachments(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) return;
    const runtime = sessionRuntime(session);
    if (runtime !== "docker" && runtime !== "host") return;
    try {
      if (this.isWorkerSession(session)) {
        const writeBytes: WorkspaceAttachmentWriter = async (rel, bytes) => {
          await this.workspace.writeWorkspaceBytes(sessionId, rel, bytes);
        };
        await materializeStoredAttachments(this.store.dataDir, sessionId, undefined, writeBytes);
        if (isAssetSession(session)) {
          await landAssetSourceImage(this.store.dataDir, sessionId, undefined, {
            enhance: resolveAssetBuild(session.assetBuild).enhance,
            writeBytes,
          });
        }
        return;
      }
      const hostDir = await materializeStoredAttachments(
        this.store.dataDir,
        sessionId,
        runtime === "host" ? this.hostRoot(session) : this.dockerWorkspaceRoot(session),
      );
      if (isAssetSession(session)) {
        await landAssetSourceImage(
          this.store.dataDir,
          sessionId,
          runtime === "host" ? this.hostRoot(session) : this.dockerWorkspaceRoot(session),
          { enhance: resolveAssetBuild(session.assetBuild).enhance },
        );
      }
      if (!hostDir || runtime === "host") return;
      const vm = session.vmId ? this.getMachine(session.vmId) : undefined;
      if (!vm) return;
      await this.guests
        .forVm(vm)
        .syncHostDirToGuest(hostDir, `${DOCKER_WORKSPACE}/.locus-attachments`);
    } catch {
      /* bind mount already shares the tree, or the guest is not running yet */
    }
  }

  private async repoSkills(session: AgentSession): Promise<AgentSkill[]> {
    return loadRepoSkills(this.repoContextRoot(session));
  }

  private async applyWorkspaceEnvironment(sessionId: string, vm: VmInstance): Promise<void> {
    if (this.envApplied.has(sessionId)) return;
    this.envApplied.add(sessionId);
    try {
      const session = await this.require(sessionId);
      const guestRoot = workspacePath(session.os, sessionRuntime(session)).replace(/\\/g, "/");
      const checkouts = sessionRepoCheckouts(session);
      const roots =
        checkouts.length > 1
          ? checkouts.map((row) => {
              const rel = destRelativeToWorkspace(row.dest, guestRoot);
              return rel ? join(vm.diskPath, ...rel.split("/")) : vm.diskPath;
            })
          : [vm.diskPath];
      for (const root of roots) {
        const env = await loadWorkspaceEnvironment(root);
        if (!env) continue;
        if (env.ports?.length) this.docker.noteListeningPorts?.(vm.id, env.ports);
        const install = environmentInstallCommand(env);
        const rel =
          root === vm.diskPath ? "" : root.slice(vm.diskPath.length + 1).replace(/\\/g, "/");
        const cwd = rel ? `${guestRoot}/${rel}` : undefined;
        if (install) {
          await this.guests
            .forVm(vm)
            .execute({
              name: "exec",
              args: { command: install, timeout_ms: 300_000, ...(cwd ? { cwd } : {}) },
            })
            .catch(() => undefined);
        }
        if (env.start) {
          await this.guests
            .forVm(vm)
            .execute({
              name: "start_process",
              args: { command: env.start, ...(cwd ? { cwd } : {}) },
            })
            .catch(() => undefined);
        }
        if (env.ports?.length && !(await this.require(sessionId)).preview) {
          const port = pickPreviewPort(env.ports) ?? env.ports[0]!;
          await this.store.mutateSession(sessionId, (current) => {
            current.preview = { port };
          });
        }
      }
    } finally {
      this.envApplied.delete(sessionId);
    }
  }

  private async installGuestGitAuth(vm: VmInstance): Promise<void> {
    if (isWindows(vm.os)) return;
    await this.guests
      .forVm(vm)
      .execute({ name: "exec", args: { command: gitCredentialInstallCommand() } })
      .catch(() => undefined);
  }

  private async snapshotTurn(sessionId: string, messageCount?: number): Promise<void> {
    const session = await this.require(sessionId);
    const vm = session.vmId ? this.getMachine(session.vmId) : undefined;
    const next = await captureTurnCheckpoint({
      session,
      messageCount,
      createdAt: now(),
      id: randomUUID(),
      dataDir: this.store.dataDir,
      vm: vm ? { id: vm.id, status: vm.status, diskPath: vm.diskPath } : undefined,
      docker: sessionRuntime(session) === "docker",
      canSnapshotWorkspace: Boolean(this.docker.snapshotWorkspace),
      canSnapshotDisk: Boolean(this.hypervisor.snapshotDisk),
      maxCheckpoints: MAX_CHECKPOINTS,
      ports: {
        writeGitRef: writeCheckpointRef,
        needsFullSnapshot: checkpointNeedsFullSnapshot,
        snapshotMachine: (opts) =>
          snapshotMachineCheckpoint({
            ...opts,
            dockerEngine: this.docker,
            hypervisor: this.hypervisor,
          }),
        deleteGitRef: deleteCheckpointRef,
        removePath: fsRemoveCheckpointPath,
      },
    });
    await this.store.mutateSession(sessionId, (current) => {
      current.checkpoints = next;
      current.checkpoint = next[next.length - 1];
    });
  }

  private async repoMapPrefix(
    session: AgentSession,
    userText?: string,
    focusPath?: string,
  ): Promise<string | undefined> {
    const root = this.repoContextRoot(session);
    if (!root) return undefined;
    const query = userText ? repoMapPromptQuery(userText) : undefined;
    const focus = normalizeRepoPath(focusPath ?? "");
    const cacheKey = `${query ?? ""}\0${focus}`;
    const hit = this.repoMapCache.get(session.id);
    if (hit && hit.query === cacheKey && Date.now() - hit.at < 30_000) return hit.text;
    try {
      const text = await indexWorkspace(root, {
        query,
        rank: Boolean(query) || Boolean(focus),
        cacheDir: indexCacheDir(this.store.dataDir, session.id),
        focus,
      });
      this.repoMapCache.set(session.id, { text, at: Date.now(), query: cacheKey });
      return text;
    } catch {
      return undefined;
    }
  }

  private async syncWorkspaceIndex(
    session: AgentSession,
    req: { name: string; args: Record<string, unknown> },
  ): Promise<void> {
    const root = this.workspaceRoot(session);
    if (!root) return;
    const cacheDir = indexCacheDir(this.store.dataDir, session.id);
    try {
      if (req.name === "git_clone" || req.name === "git_fetch") {
        await indexWorkspace(root, { cacheDir, force: true });
        this.repoMapCache.delete(session.id);
        return;
      }
      if (req.name !== "file_write" && req.name !== "apply_patch") return;
      const paths =
        req.name === "file_write" && typeof req.args.path === "string"
          ? [normalizeRepoPath(req.args.path)].filter(Boolean)
          : patchFilesFromTool("apply_patch", req.args)
              .map((file) => normalizeRepoPath(file.path))
              .filter(Boolean);
      if (!paths.length) return;
      await updateIndexPaths(root, cacheDir, paths);
      this.repoMapCache.delete(session.id);
    } catch {
      /* index is best-effort */
    }
  }

  private remainingTurnMs(sessionId: string, timeCap?: number): number | undefined {
    const started = this.turnStartedAt.get(sessionId);
    if (started == null || timeCap == null || timeCap <= 0) return undefined;
    return Math.max(0, timeCap - (Date.now() - started));
  }

  private async reportBudgetStop(
    sessionId: string,
    turnId: string,
    round: number,
    session: AgentSession,
    reason: string,
  ): Promise<void> {
    await this.appendMessage(sessionId, {
      id: randomUUID(),
      role: "system",
      content: formatProgressReport({
        reason,
        scratchpad: session.scratchpad,
        tasks: session.taskList,
        lastAssistant: lastAssistantText(session.messages),
      }),
      createdAt: now(),
    });
    await this.traces.write({
      t: now(),
      kind: "governor",
      level: "warn",
      sessionId,
      turnId,
      round,
      detail: reason,
    });
    if (this.isWorkerSession(session)) {
      const latest = await this.require(sessionId).catch(() => undefined);
      if (latest?.vmId || latest?.remoteGuestId) {
        await this.destroyWorkerGuest(latest).catch(() => undefined);
      }
    }
  }

  private async offloadToolOutput(
    session: AgentSession,
    callId: string,
    output: string,
  ): Promise<string> {
    if (!shouldOffloadToolResult(output)) return output;
    const root = this.workspaceRoot(session);
    if (!root) {
      return `${output.slice(0, OFFLOAD_RESULT_CHARS)}\n\n[truncated: ${output.length} chars; no workspace to offload. Narrow the query; do not re-fetch with exec or curl.]`;
    }
    const guestPath = guestToolResultPath(callId);
    const rel = guestPath.replace(/^\/workspace\//, "");
    await mkdir(join(root, dirname(rel)), { recursive: true });
    await writeFile(join(root, rel), output, "utf8");
    return formatOffloadedResult(guestPath, output);
  }

  private async executeReadSkill(
    session: AgentSession,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const raw = typeof args.name === "string" ? args.name : "";
    const name = skillSlashName(raw) ?? raw.trim().toLowerCase();
    const config = await this.store.loadConfig();
    const skills = mergeSkills(config.skills, await this.repoSkills(session));
    const skill = enabledSkills(skills).find((row) => skillSlashName(row.name) === name);
    if (!skill) {
      const available =
        enabledSkills(skills)
          .map((row) => row.name)
          .join(", ") || "(none)";
      return { ok: false, output: `Unknown skill "${raw || name}". Available: ${available}` };
    }
    return { ok: true, output: formatSkillPrompt(skill) };
  }

  private pluginPromptTools(session: AgentSession, config: LocusConfig): ExtraToolDef[] {
    const extras: ExtraToolDef[] = [];
    const allow = (name: string) => {
      if (!automationAllowsPlugin(session, name)) return false;
      if (session.allowedTools?.length && !session.allowedTools.includes(name)) return false;
      return true;
    };
    if (!this.inSubagent.has(session.id) && allow(MANAGE_INTEGRATION_PLUGIN_TOOL.name)) {
      extras.push(MANAGE_INTEGRATION_PLUGIN_TOOL);
    }
    for (const tool of pluginExtraTools(config.integrationPlugins)) {
      if (allow(tool.name)) extras.push(tool);
    }
    return extras;
  }

  private async executeManagePlugin(args: Record<string, unknown>): Promise<ToolResult> {
    const config = await this.store.loadConfig();
    const result = applyPluginManageAction(config.integrationPlugins ?? [], args, () =>
      randomUUID(),
    );
    if (result.ok) {
      await this.store.saveConfig({ ...config, integrationPlugins: result.plugins });
    }
    return { ok: result.ok, output: result.output };
  }

  private async executeMcpMeta(
    session: AgentSession,
    req: { name: string; args: Record<string, unknown> },
    fence = true,
  ): Promise<ToolResult> {
    const fenceHostile = (name: string, output: string) =>
      fence ? wrapHostileToolOutput(name, output) : output;
    const sessionId = session.id;
    if (req.name === MCP_LIST_TOOLS_NAME) {
      const server = typeof req.args.server === "string" ? req.args.server : undefined;
      return { ok: true, output: this.mcp.listCatalog(sessionId, server) };
    }
    if (req.name === MCP_GET_TOOL_INFO_NAME) {
      const server = typeof req.args.server === "string" ? req.args.server : "";
      const tool = typeof req.args.tool === "string" ? req.args.tool : "";
      if (!server || !tool) return { ok: false, output: "server and tool are required" };
      return { ok: true, output: this.mcp.getToolInfo(sessionId, server, tool) };
    }
    if (req.name === MCP_CALL_NAME) {
      const server = typeof req.args.server === "string" ? req.args.server : "";
      const tool = typeof req.args.tool === "string" ? req.args.tool : "";
      if (!server || !tool) return { ok: false, output: "server and tool are required" };
      const fn = this.mcp.resolveFunctionName(sessionId, server, tool);
      if (!automationAllowsMcpTool(session, fn)) {
        throw new Error(`Tool ${fn} is not allowed for this automation`);
      }
      const args = parseMcpCallArguments(req.args.args);
      const result = await this.mcp.callNative(sessionId, server, tool, args);
      return { ...result, output: fenceHostile(fn ?? req.name, result.output) };
    }
    if (req.name === MCP_CODE_NAME) {
      const code = typeof req.args.code === "string" ? req.args.code : "";
      const result = await runMcpCode({
        code,
        workspaceRoot: this.workspaceRoot(session),
        callTool: async (server, tool, args) => {
          const fn = this.mcp.resolveFunctionName(sessionId, server, tool);
          if (!automationAllowsMcpTool(session, fn)) {
            return { ok: false, output: `Tool ${fn} is not allowed for this automation` };
          }
          return this.mcp.callNative(sessionId, server, tool, args);
        },
      });
      return { ...result, output: fenceHostile(req.name, result.output) };
    }
    return { ok: false, output: `Unknown MCP meta tool: ${req.name}` };
  }

  private async sessionMemoryPrompt(session: AgentSession): Promise<string> {
    const workspace = await loadWorkspaceMemories(this.repoContextRoot(session), session.repo?.url);
    if (session.persistMemory && session.automationId) {
      const item = (await this.store.loadAutomations()).find(
        (row) => row.id === session.automationId,
      );
      if (item?.persistMemory) {
        return mergeMemoryPrompts(workspace, formatAutomationMemoryPrompt(item.memories ?? []));
      }
    }
    if (!sessionOffersRemember(session)) return workspace;
    const hint = this.brain ? BRAIN_REMEMBER_HINT : WORKSPACE_REMEMBER_HINT;
    return mergeMemoryPrompts(
      workspace,
      workspace ? hint : `No saved facts from this workspace yet.\n${hint}`,
    );
  }

  private async executeRemember(
    sessionId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const session = await this.require(sessionId);
    if (session.persistMemory && session.automationId) {
      let output = "";
      let enabled = false;
      const updated = await this.store.mutateAutomation(session.automationId, (item) => {
        if (!item.persistMemory) return;
        enabled = true;
        const next = applyRemember(item.memories ?? [], args, {
          id: randomUUID(),
          repo: session.repo?.url,
          createdAt: now(),
          runId: session.automationRunId,
        });
        item.memories = next.memories.length ? next.memories : undefined;
        output = next.output;
      });
      if (!updated) return { ok: false, output: "Automation not found." };
      if (!enabled) return { ok: false, output: "Memory is off for this automation." };
      this.hub.broadcast({ type: "automation.updated", automation: updated });
      this.funnelRememberToBrain(session, args);
      return { ok: true, output };
    }
    if (!sessionOffersRemember(session)) {
      return { ok: false, output: "Memory is off for this session." };
    }
    const action = typeof args.action === "string" ? args.action.trim().toLowerCase() : "list";
    const text = typeof args.text === "string" ? args.text : "";
    // Coding-loop remember adds go to the brain only. list/forget/clear still edit
    // the workspace override list (.locus/memories.json) via Settings/CLI.
    if (action === "add") {
      if (!this.brain) return { ok: false, output: "Brain is not available." };
      if (!text.trim()) return { ok: false, output: "text is required to remember." };
      const result = await this.brain.remember({
        text,
        repo: session.repo?.url,
        sessionId: session.id,
        actor: "session",
      });
      return { ok: result.ok, output: result.output };
    }
    const root = this.workspaceRoot(session);
    if (!root) return { ok: false, output: "No workspace to store facts in." };
    const next = applyRemember(await loadWorkspaceMemoryRows(root), args, {
      id: randomUUID(),
      repo: session.repo?.url,
      createdAt: now(),
    });
    await saveWorkspaceMemories(root, next.memories);
    return { ok: true, output: next.output };
  }

  private funnelRememberToBrain(session: AgentSession, args: Record<string, unknown>): void {
    if (!this.brain) return;
    const action = typeof args.action === "string" ? args.action.trim().toLowerCase() : "list";
    const text = typeof args.text === "string" ? args.text : "";
    if (action !== "add" || !text.trim() || looksLikeRememberedSecret(text)) return;
    void this.brain
      .remember({
        text,
        repo: session.repo?.url,
        sessionId: session.id,
        actor: "session",
      })
      .catch(() => undefined);
  }

  async workspaceMemories(sessionId: string): Promise<import("@locus/shared").RepoMemory[]> {
    const session = await this.require(sessionId);
    if (session.persistMemory && session.automationId) {
      const item = (await this.store.loadAutomations()).find(
        (row) => row.id === session.automationId,
      );
      return item?.memories ?? [];
    }
    const root = this.workspaceRoot(session);
    if (!root) return [];
    return loadWorkspaceMemoryRows(root);
  }

  async rememberFacts(
    sessionId: string,
    args: Record<string, unknown>,
  ): Promise<{ output: string; memories: import("@locus/shared").RepoMemory[] }> {
    const result = await this.executeRemember(sessionId, args);
    const memories = await this.workspaceMemories(sessionId);
    if (!result.ok) throw new Error(result.output);
    return { output: result.output, memories };
  }

  private async executeRuntimeTool(
    sessionId: string,
    req: { name: string; args: Record<string, unknown> },
    opts?: { toolCallId?: string },
  ): Promise<ToolResult> {
    if (isHostSessionsToolName(req.name)) {
      const session = await this.require(sessionId);
      return executeHostSessions(session, req.args, {
        loadSessions: () => this.store.loadSessions(),
        workspaceRoot: (row) => this.workspaceRoot(row),
      });
    }
    if (isDockerSwarmToolName(req.name)) {
      return this.dockerInventory.executeSwarmTool(req.args);
    }
    if (req.name === "scratchpad") {
      let output = "";
      await this.store.mutateSession(sessionId, (current) => {
        const next = applyScratchpad(current.scratchpad, req.args);
        current.scratchpad = next.text.trim() ? next.text : undefined;
        output = next.output;
      });
      return { ok: true, output };
    }
    if (req.name === "remember") {
      return this.executeRemember(sessionId, req.args);
    }
    if (isBrainToolName(req.name)) {
      return this.executeBrainTool(sessionId, req);
    }
    if (isSubscribeToolName(req.name)) {
      let output = "";
      const updated = await this.store.mutateSession(sessionId, (current) => {
        if (req.name === "unsubscribe") {
          const next = applyUnsubscribe(current.subscriptions, req.args);
          current.subscriptions = next.subscriptions.length ? next.subscriptions : undefined;
          output = next.output;
          return;
        }
        const next = applySubscribe(current.subscriptions, req.args, {
          id: `s${randomUUID().replace(/-/g, "").slice(0, 10)}`,
          createdAt: now(),
          now: new Date(),
          sessionPull: current.pull,
          sessionRepoUrl: current.repo?.url,
        });
        current.subscriptions = next.subscriptions.length ? next.subscriptions : undefined;
        output = next.output;
      });
      if (updated) this.hub.broadcast({ type: "session.updated", session: updated });
      return { ok: true, output };
    }
    if (req.name === "task_list") {
      let output = "";
      await this.store.mutateSession(sessionId, (current) => {
        const next = applyTaskList(current.taskList, req.args);
        current.taskList = next.tasks.length ? next.tasks : undefined;
        output = next.output;
      });
      return { ok: true, output };
    }
    if (req.name === "repo_map") {
      const session = await this.require(sessionId);
      const root = this.workspaceRoot(session);
      if (!root) {
        return {
          ok: true,
          output:
            "No host workspace to index. Use glob and grep in the guest instead of stuffing files into context.",
        };
      }
      const query = typeof req.args.query === "string" ? req.args.query : undefined;
      const path = typeof req.args.path === "string" ? req.args.path : undefined;
      const text = await indexWorkspace(root, {
        query,
        path,
        cacheDir: indexCacheDir(this.store.dataDir, session.id),
      });
      this.repoMapCache.set(sessionId, { text, at: Date.now(), query: query ?? "" });
      return { ok: true, output: text };
    }
    if (req.name === "spawn_agent") {
      if (this.inSubagent.has(sessionId)) {
        return { ok: false, output: "Nested sub-agents are not allowed." };
      }
      const session = await this.require(sessionId);
      const config = await this.store.loadConfig();
      const max = config.advanced.maxSubagentsPerTurn ?? 2;
      const used = this.turnSubagents.get(sessionId) ?? 0;
      if (used >= max) {
        return { ok: false, output: `Sub-agent cap ${max} reached.` };
      }
      const task = typeof req.args.task === "string" ? req.args.task.trim() : "";
      const focus = typeof req.args.focus === "string" ? req.args.focus : undefined;
      if (!task) return { ok: false, output: "task is required" };
      const kind = resolveSubagentKind({
        toolKind: req.args.kind,
        prompt: turnUserPrompt(session.messages),
        sessionDefault: session.defaultSubagent,
      });
      const remaining = this.remainingTurnMs(
        sessionId,
        session.maxMs ?? config.advanced.maxMsPerTurn,
      );
      if (remaining != null && remaining <= 0) {
        return { ok: false, output: "spawn_agent refused: no time remaining in this turn." };
      }
      const provider = config.providers.find((row) => row.id === session.providerId);
      if (!provider || !hasUsableKey(provider.apiKey, provider.baseUrl, provider.kind)) {
        return { ok: false, output: "A provider key is required to spawn a child agent." };
      }
      this.inSubagent.add(sessionId);
      const liveId = randomUUID();
      await this.patchSubagent(sessionId, {
        id: liveId,
        task,
        status: "running",
        lastLine: task,
        kind,
        toolCallId: opts?.toolCallId,
      });
      await this.traces.write({
        t: now(),
        kind: "subagent.start",
        sessionId,
        name: "spawn_agent",
        detail: task,
      });
      try {
        const summary = await runIsolatedSubagent(task, focus, {
          kind,
          chatEngine: (complete) => this.chatEngine(complete),
          complete: {
            provider,
            model: session.model,
            system: "",
            messages: [],
            guestOs: session.os,
            runtime: sessionRuntime(session),
            allowedTools: session.allowedTools,
            signal: this.aborts.get(sessionId)?.signal,
          },
          executeTool: (name, args) =>
            this.executeTool(sessionId, { name: name as ComputerUseToolName, args }),
          webSearch: sessionWebSearch(session),
          signal: this.aborts.get(sessionId)?.signal,
          timeoutMs: subagentTimeoutMs(kind, remaining ?? undefined),
          onUsage: (ev) => {
            void this.patchSubagent(sessionId, {
              id: liveId,
              task,
              status: "running",
              inputTokens: ev.inputTokens,
              outputTokens: ev.outputTokens,
            });
            return this.applyUsage(sessionId, undefined, ev);
          },
          onEvent: (kind, detail) =>
            this.patchSubagent(sessionId, {
              id: liveId,
              task,
              status: kind === "end" ? "done" : "running",
              lastLine: detail,
              toolCallId: opts?.toolCallId,
            }),
          onTranscript: (messages) =>
            this.patchSubagent(sessionId, {
              id: liveId,
              task,
              status: "running",
              messages,
              toolCallId: opts?.toolCallId,
            }),
        });
        this.turnSubagents.set(sessionId, used + 1);
        await this.patchSubagent(sessionId, {
          id: liveId,
          task,
          status: "done",
          lastLine: summary,
        });
        await this.traces.write({ t: now(), kind: "subagent.end", sessionId, detail: summary });
        return { ok: true, output: summary };
      } catch (err) {
        const message = err instanceof Error ? err.message : "sub-agent failed";
        await this.patchSubagent(sessionId, {
          id: liveId,
          task,
          status: "error",
          lastLine: message,
        });
        await this.traces.write({
          t: now(),
          kind: "error",
          sessionId,
          name: "spawn_agent",
          detail: message,
        });
        return { ok: false, output: message };
      } finally {
        this.inSubagent.delete(sessionId);
      }
    }
    return { ok: false, output: `Unknown runtime tool: ${req.name}` };
  }

  private async executeBrainTool(
    sessionId: string,
    req: { name: string; args: Record<string, unknown> },
  ): Promise<ToolResult> {
    if (!this.brain) return { ok: false, output: "Brain is not available." };
    const session = await this.require(sessionId);
    if (!sessionOffersBrain(session)) {
      return { ok: false, output: "Brain tools are not available in this session." };
    }
    if (req.name === "orient") {
      return { ok: true, output: await this.brain.orient(session.repo?.url) };
    }
    if (req.name === "find_entity") {
      return { ok: true, output: await this.brain.find(req.args) };
    }
    if (req.name === "get_entity") {
      const id = typeof req.args.id === "string" ? req.args.id : "";
      if (!id.trim()) return { ok: false, output: "id is required" };
      return { ok: true, output: await this.brain.entity(id) };
    }
    if (req.name === "search_knowledge") {
      const q =
        typeof req.args.q === "string"
          ? req.args.q
          : typeof req.args.query === "string"
            ? req.args.query
            : "";
      return { ok: true, output: await this.brain.search(q) };
    }
    if (req.name === "correct_graph") {
      const reason = typeof req.args.reason === "string" ? req.args.reason : "";
      const nodeId = typeof req.args.nodeId === "string" ? req.args.nodeId : undefined;
      const memoryId = typeof req.args.memoryId === "string" ? req.args.memoryId : undefined;
      const claim = typeof req.args.claim === "string" ? req.args.claim : undefined;
      return this.brain.correct({
        nodeId,
        memoryId,
        reason,
        claim,
        actor: `session:${sessionId}`,
      });
    }
    if (req.name === "brain_brief") {
      const prepared = await this.prepareBrainBrief(sessionId, req.args);
      if (!prepared.ok) return prepared;
      const config = await this.store.loadConfig();
      const posted = await postBrainIssueBrief(
        this.integrations,
        {
          ok: true,
          issue: String(prepared.args.issue ?? ""),
          target: prepared.args.target === "linear" ? "linear" : "jira",
          title: typeof prepared.args.title === "string" ? prepared.args.title : undefined,
          body: String(prepared.args.body ?? ""),
        },
        config.integrations,
      );
      return posted;
    }
    return { ok: false, output: `Unknown brain tool ${req.name}.` };
  }

  private async prepareBrainBrief(
    sessionId: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: true; args: Record<string, unknown> } | { ok: false; output: string }> {
    if (!this.brain) return { ok: false, output: "Brain is not available." };
    const config = await this.store.loadConfig();
    const session = await this.get(sessionId);
    const draft = await draftBrainIssueBrief({
      doc: await this.brain.get(),
      issue: typeof args.issue === "string" ? args.issue : "",
      target: typeof args.target === "string" ? args.target : undefined,
      title: typeof args.title === "string" ? args.title : undefined,
      summary: typeof args.summary === "string" ? args.summary : undefined,
      body: typeof args.body === "string" ? args.body : undefined,
      integrations: config.integrations,
      client: this.integrations,
    });
    if (!draft.ok) return draft;
    if (!sessionOffersBrain(session ?? { kind: "agent" })) {
      return { ok: false, output: "Brain tools are not available in this session." };
    }
    return {
      ok: true,
      args: {
        ...args,
        issue: draft.issue,
        target: draft.target,
        ...(draft.title ? { title: draft.title } : {}),
        body: draft.body,
      },
    };
  }

  private async injectForgeGitArgs(session: AgentSession, req: ToolRequest): Promise<ToolRequest> {
    if (
      req.name !== "git_push" &&
      req.name !== "git_pr" &&
      req.name !== "git_clone" &&
      req.name !== "git_fetch" &&
      !isGitPathToolName(req.name)
    ) {
      return req;
    }
    const checkout = matchWorkspaceCheckout(session, {
      path: typeof req.args.path === "string" ? req.args.path : undefined,
      url: typeof req.args.url === "string" ? req.args.url : undefined,
      dest: typeof req.args.dest === "string" ? req.args.dest : undefined,
    });
    const config = await this.store.loadConfig();
    const forge = await this.sessionForgeFresh(config, session, checkout);
    const next = { ...req.args };
    if (forge?.token && !next.token) next.token = forge.token;
    if (forge?.kind && !next.forge) next.forge = forge.kind;
    if (isGitPathToolName(req.name) && !next.path && checkout?.dest) next.path = checkout.dest;
    if (
      checkout?.dest &&
      typeof next.path === "string" &&
      isCheckoutDirAlias(next.path, checkout.dest)
    ) {
      next.path = checkout.dest;
    }
    if (req.name === "git_push" && checkout?.url && !next.url) next.url = checkout.url;
    if (req.name === "git_fetch" && checkout?.url && !next.url) next.url = checkout.url;
    if (
      (req.name === "git_clone" || req.name === "git_fetch") &&
      session.pull?.number &&
      next.pull == null &&
      next.pull_number == null &&
      (!checkout || checkout.url === session.repo?.url)
    ) {
      next.pull = session.pull.number;
    }
    if (req.name === "git_clone" && checkout?.dest && !next.dest) {
      const url = typeof next.url === "string" ? next.url : "";
      if (
        url &&
        url.replace(/\.git$/i, "").toLowerCase() ===
          checkout.url.replace(/\.git$/i, "").toLowerCase()
      ) {
        next.dest = checkout.dest;
      }
    }
    return { ...req, args: next };
  }

  private broadcastToolOverlay(sessionId: string, req: ToolRequest): void {
    const overlay = overlayFromTool(sessionId, req.name, req.args);
    if (overlay) this.hub.broadcast({ type: "tool.overlay", ...overlay });
  }

  private async snapshotFileUndo(
    session: AgentSession,
    guest: { execute: (req: ToolRequest) => Promise<ToolResult> },
    req: ToolRequest,
    opts?: { ignoreAllowlist?: boolean },
  ): Promise<void> {
    if (req.name !== "file_write" || typeof req.args.path !== "string" || opts?.ignoreAllowlist) {
      return;
    }
    try {
      const prior = await guest.execute({ name: "file_read", args: { path: req.args.path } });
      if (prior.ok) {
        await this.store.mutateSession(session.id, (current) => {
          current.fileUndo = [
            ...(current.fileUndo ?? []),
            { path: req.args.path as string, previous: prior.output.slice(0, 200_000) },
          ].slice(-8);
        });
      }
    } catch {
      /* undo log is optional */
    }
  }

  private async settleExecutedTool(
    session: AgentSession,
    req: ToolRequest,
    result: ToolResult,
    opts?: { ignoreAllowlist?: boolean },
  ): Promise<ToolResult> {
    const hooked = await this.appendLintFeedback(session, req, result, opts);
    const adhered = await this.appendDesignAdherence(session, req, hooked, opts);
    if (adhered.ok) await this.syncWorkspaceIndex(session, req);
    if (adhered.ok && (req.name === "file_write" || req.name === "apply_patch")) {
      await this.design.publish(session);
      if (isAssetSession(session)) {
        void this.design.buildAssetPack(session.id).catch(() => undefined);
      }
    }
    if (adhered.ok && (req.name === "git_clone" || req.name === "git_fetch")) {
      await this.syncChatAttachments(session.id);
    }
    if (adhered.ok && req.name === "git_clone") {
      await this.attachRepoAfterClone(session.id, req);
      const next = await this.get(session.id);
      const root = next ? this.workspaceRoot(next) : undefined;
      if (root && this.brain && (await this.brain.shouldAutoIndex())) {
        void this.brain
          .indexPath(root, { repo: next?.repo?.url, actor: "indexer:clone" })
          .catch(() => undefined);
      }
    }
    if (adhered.ok && req.name === "git_branch") {
      const name = typeof req.args.name === "string" ? req.args.name : "";
      await this.noteGitHead(session.id, name);
    }
    if (adhered.ok && req.name === "start_process") {
      await this.rememberBackgroundProcess(session.id, req, adhered);
    }
    return adhered;
  }

  private async publishToolResult(
    sessionId: string,
    req: ToolRequest,
    result: ToolResult,
  ): Promise<ToolResult> {
    const redacted = redactTool(req.name, req.args, result.output);
    const output = wrapHostileToolOutput(
      req.name,
      redactText(
        stripSensitiveListing(req.name, redacted.output),
        configSecretValues(await this.store.loadConfig()),
      ),
    );
    this.hub.broadcast({
      type: "tool.updated",
      sessionId,
      toolCall: {
        id: randomUUID(),
        name: redacted.name as import("@locus/shared").ComputerUseToolName,
        arguments: redacted.args,
        result: output,
        error: result.ok ? undefined : output,
        startedAt: now(),
        finishedAt: now(),
      },
    });
    return { ...result, output };
  }

  private async tryIndexedGrep(
    session: AgentSession,
    req: ToolRequest,
    config: LocusConfig,
    fenceHostile: (name: string, output: string) => string,
  ): Promise<ToolResult | undefined> {
    if (config.advanced.workspaceGrepIndex === false) return undefined;
    if (this.isWorkerSession(session)) return undefined;
    const runtime = sessionRuntime(session);
    if (runtime !== "docker" && runtime !== "host") return undefined;
    const root = this.workspaceRoot(session);
    if (!root) return undefined;
    const pattern = typeof req.args.pattern === "string" ? req.args.pattern : "";
    if (!pattern.trim()) return undefined;
    const glob = typeof req.args.glob === "string" ? req.args.glob : undefined;
    const path = typeof req.args.path === "string" ? req.args.path : undefined;
    const result = await grepIndexedWorkspace({
      root,
      pattern,
      path,
      glob,
      context: grepContextLines(req.args),
      regex: true,
      cacheDir: indexCacheDir(this.store.dataDir, session.id),
    });
    if (!result) return undefined;
    return { ok: true, output: fenceHostile("grep", result.output) };
  }

  private async executeHostTool(
    session: AgentSession,
    req: ToolRequest,
    opts?: { ignoreAllowlist?: boolean; onOutput?: (chunk: string) => void },
  ): Promise<ToolResult> {
    req = await this.injectForgeGitArgs(session, req);
    const guest = this.hostGuest(session);
    this.broadcastToolOverlay(session.id, req);
    await this.snapshotFileUndo(session, guest, req, opts);
    const result = await guest.execute(req, this.aborts.get(session.id)?.signal, opts?.onOutput);
    const hooked = await this.settleExecutedTool(session, req, result, opts);
    return await this.publishToolResult(session.id, req, hooked);
  }

  cliGitTools(sessionId: string) {
    const signal = this.cliGitTurns.get(sessionId);
    return signal && !signal.aborted ? cliGitMcpTools() : [];
  }

  async executeCliGitTool(
    sessionId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const signal = this.cliGitTurns.get(sessionId);
    if (!isCliGitTool(name) || !signal || signal.aborted) {
      return {
        ok: false,
        output: "Locus Git tools require an active CLI coding turn on this host.",
      };
    }
    const session = await this.require(sessionId);
    const config = await this.store.loadConfig();
    const policy = this.policyFor(session, config);
    if ((name === "git_push" || name === "git_pr") && typeof args.branch !== "string") {
      const branch = await this.resolveGitHeadBranch(session, args);
      if (branch) args = { ...args, branch };
    }
    const gate = gateToolRequest(name, args, {
      policy,
      allowedTools: session.allowedTools,
      branchLock: session.branchLock === true,
      repoRef: session.repo?.ref,
      gitBranch: session.gitBranch,
    });
    const blocked = await this.applyToolGate(sessionId, name, gate);
    if (blocked) return blocked;
    let approvalCallId: string | undefined;
    const finish = async (result: ToolResult): Promise<ToolResult> => {
      result = { ...result, output: redactText(result.output, configSecretValues(config)) };
      if (approvalCallId) {
        const updated = await this.store.mutateSession(sessionId, (current) => {
          const call = current.messages
            .flatMap((m) => m.toolCalls ?? [])
            .find((t) => t.id === approvalCallId);
          if (call) {
            call.finishedAt = now();
            call.result = result.output;
            if (!result.ok) call.error = result.output;
            if (call.approval === "needed") call.approval = "denied";
          }
        });
        if (updated) this.hub.broadcast({ type: "session.updated", session: updated });
      }
      return result;
    };
    if (toolNeedsApproval(name, policy, args)) {
      const call: ToolCall = {
        id: randomUUID(),
        name,
        arguments: args,
        approval: "needed",
        startedAt: now(),
      };
      const pending = this.awaitApproval(sessionId, call.id, signal);
      approvalCallId = call.id;
      await this.appendMessage(sessionId, {
        id: randomUUID(),
        role: "assistant",
        content: "",
        toolCalls: [call],
        createdAt: now(),
      });
      const { decision } = await pending;
      if (decision !== "approved")
        return finish({ ok: false, output: `Git operation ${decision}.` });
    }
    if (signal.aborted || this.cliGitTurns.get(sessionId) !== signal) {
      return finish({ ok: false, output: "CLI turn has ended." });
    }
    try {
      return await finish(await this.executeTool(sessionId, { name, args }));
    } catch (err) {
      return finish({ ok: false, output: err instanceof Error ? err.message : "Git tool failed" });
    }
  }

  /**
   * When a peer turn ends (or needs_you mid-turn), notify the requester without
   * holding their tool/HTTP call open. Clears the handoff so we notify once.
   */
  private async deliverPeerHandoff(
    peerId: string,
    peer: AgentSession,
    opts: { kind: TeamEventKind; detail?: string },
  ): Promise<void> {
    const handoff = this.peerHandoffs.get(peerId);
    if (!handoff) return;
    this.peerHandoffs.delete(peerId);
    const requester = await this.get(handoff.requesterId);
    if (!requester || handoff.requesterId === peerId) return;

    const summaryRaw =
      opts.detail?.trim() ||
      lastAssistantText(peer.messages) ||
      peer.needsHuman?.trim() ||
      "(no summary yet)";
    const summary = summaryRaw.length > 1500 ? `${summaryRaw.slice(0, 1499)}…` : summaryRaw;
    const name = sessionDisplayName(peer);
    const content = `${name}: ${summary}`;
    const speaker = swarmSpeakerFrom(peer);

    if (opts.kind === "needs_you" && peer.projectId) {
      await this.projects?.relayMemberNeedsHuman(peerId, summary).catch(() => undefined);
    }

    let threadId = handoff.requesterId;
    const requesterProject =
      requester.projectId && this.projects
        ? await this.projects.get(requester.projectId)
        : undefined;
    const requesterOwnsGroup =
      requesterProject?.groupChat && requesterProject.coordinatorSessionId === requester.id;
    if (!requesterOwnsGroup && peer.projectId && this.projects) {
      const project = await this.projects.get(peer.projectId);
      if (project?.coordinatorSessionId && project.coordinatorSessionId !== peerId) {
        threadId = project.coordinatorSessionId;
      }
    }
    if (this.projects) {
      await this.projects
        .appendTeamEvent(threadId, {
          content,
          speaker,
          teamEvent: opts.kind,
        })
        .catch(() => undefined);
    } else {
      await this.appendMessage(handoff.requesterId, {
        id: randomUUID(),
        role: "assistant",
        content,
        speaker,
        teamEvent: opts.kind,
        createdAt: now(),
      }).catch(() => undefined);
    }

    if (!shouldWakeGroupChatRequester(opts.kind, handoff.wakeRequester !== false)) return;

    const wake = `Peer update from ${name} (${opts.kind}):\n${summary}\n\nReport this to the user if helpful. You can dispatch more work with team_message.`;
    const live = await this.get(handoff.requesterId);
    if (!live) return;
    if (live.status === "running" || this.aborts.has(handoff.requesterId)) {
      await this.enqueuePrompt(handoff.requesterId, wake).catch(() => undefined);
      return;
    }
    void this.sendChat(handoff.requesterId, wake).catch(() => undefined);
  }

  private async executeSwarmTeamTool(
    session: AgentSession,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    return executeSwarmTeamTool(
      {
        list: () => this.list(),
        create: (input) => this.create(input),
        sendChat: (id, message, opts) => this.sendChat(id, message, opts),
        store: this.store,
        projects: this.projects,
      },
      session,
      name,
      args,
    );
  }

  private async executeAgentCanvasTool(
    session: AgentSession,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    return runAgentCanvasTool(this.agentCanvases, session, name, args, async (canvases) => {
      const updated = await this.store.mutateSession(session.id, (current) => {
        current.agentCanvases = canvases;
      });
      if (updated) this.hub.broadcast({ type: "session.updated", session: updated });
    });
  }

  workflowCatalog(session: AgentSession): string[] {
    return sessionWorkflowCatalog(
      session,
      this.mcp.listTools(session.id).map((tool) => tool.name),
    );
  }

  /** One provider turn for a workflow agent node. Undefined when no usable key is configured. */
  async completeForWorkflow(
    sessionId: string,
    input: { system: string; user: string; tools: string[] },
  ): Promise<WorkflowCompletion | undefined> {
    const session = await this.get(sessionId);
    if (!session) return undefined;
    const config = await this.store.loadConfig();
    const provider =
      config.providers.find((row) => row.id === session.providerId) ??
      config.providers.find((row) => row.enabled);
    if (!provider || !hasUsableKey(provider.apiKey, provider.baseUrl, provider.kind)) {
      return undefined;
    }
    const tools = input.tools.filter((name) => !isWorkflowToolName(name));
    let text = "";
    const toolCalls: WorkflowCompletion["toolCalls"] = [];
    for await (const event of runChatTurn((req) => this.chatEngine(req), {
      provider,
      model: session.model || provider.defaultModel,
      system: input.system,
      messages: [
        {
          id: "workflow",
          role: "user",
          content: input.user,
          createdAt: new Date().toISOString(),
        },
      ],
      extraTools: tools.map((name) => ({
        name,
        description: `Locus tool ${name}. Arguments follow that tool's usual schema.`,
        parameters: { type: "object", properties: {}, additionalProperties: true },
      })),
      allowedTools: tools,
      guestOs: session.os,
      runtime: sessionRuntime(session),
      stream: false,
      maxTokens: 2048,
      signal: this.aborts.get(sessionId)?.signal,
    })) {
      if (event.type === "text") text += event.text;
      if (event.type === "tool_call") {
        toolCalls.push({ name: event.name, arguments: event.arguments });
      }
    }
    return { text, toolCalls };
  }

  private controlPlanePorts(): ControlPlaneToolPorts {
    return {
      fetchFn: (input, init) => this.fetchFn(input, init),
      executeRuntimeTool: (id, req, opts) => this.executeRuntimeTool(id, req, opts),
      executeSwarmTeamTool: (session, name, args) => this.executeSwarmTeamTool(session, name, args),
      executeReadSkill: (session, args) => this.executeReadSkill(session, args),
      workflows: this.workflows
        ? {
            executeTool: (session, name, args) =>
              this.workflows!.executeAgentTool(session, name, args),
          }
        : undefined,
      executeManagePlugin: (args) => this.executeManagePlugin(args),
      executeMcpMeta: (session, req, fence) => this.executeMcpMeta(session, req, fence),
      boards: this.boards,
      projects: this.projects,
      executeAgentCanvas: (row, name, args) => this.executeAgentCanvasTool(row, name, args),
      mcp: this.mcp,
      integrations: {
        call: (name, args, rows) => this.integrations.call(name, args, rows),
        noteSlackPost: async (id, ts) => {
          await this.store.mutateSession(id, (current) => {
            if (!current.slack) return;
            current.slack = { ...current.slack, lastPostTs: ts };
          });
        },
      },
    };
  }

  async executeTool(
    sessionId: string,
    req: ToolRequest,
    opts?: {
      ignoreAllowlist?: boolean;
      fence?: boolean;
      onOutput?: (chunk: string) => void;
      toolCallId?: string;
    },
  ): Promise<ToolResult> {
    const result = await this.executeToolRaw(sessionId, req, opts);
    const config = await this.store.loadConfig();
    const output = redactText(
      stripSensitiveListing(req.name, result.output ?? ""),
      configSecretValues(config),
    );
    return { ...result, output };
  }

  private async executeToolRaw(
    sessionId: string,
    req: ToolRequest,
    opts?: {
      ignoreAllowlist?: boolean;
      fence?: boolean;
      onOutput?: (chunk: string) => void;
      toolCallId?: string;
    },
  ): Promise<ToolResult> {
    const mapped = canonicalToolCall(req.name, req.args ?? {});
    if (mapped.name !== req.name || mapped.arguments !== req.args) {
      req = { ...req, name: mapped.name as ToolRequest["name"], args: mapped.arguments };
    }
    const fenceHostile = (name: string, output: string) =>
      opts?.fence === false ? output : wrapHostileToolOutput(name, output);
    const session = await this.require(sessionId);
    if (isOperatorDrivingBrowser(session) && isMutatingBrowserTool(req.name, req.args)) {
      return { ok: false, output: OPERATOR_HAS_BROWSER };
    }
    const runtime = sessionRuntime(session);
    const config = await this.store.loadConfig();
    const policy = this.policyFor(session, config);
    if (req.name === "git_push" && typeof req.args.branch !== "string") {
      const head = await this.resolveGitHeadBranch(session, req.args);
      if (head) req = { ...req, args: { ...req.args, branch: head } };
    }
    const gateCtx = {
      policy,
      allowHosts: session.allowHosts,
      allowedTools: session.allowedTools,
      ignoreAllowlist: opts?.ignoreAllowlist,
      isDesign: isCanvasSession(session),
      branchLock: session.branchLock === true,
      repoRef: session.repo?.ref,
      gitBranch: session.gitBranch,
    };
    const policyGate = await this.applyToolGate(
      sessionId,
      req.name,
      gateToolRequest(req.name, req.args, { ...gateCtx, stage: "policy" }),
    );
    if (policyGate) return policyGate;
    if (req.name === "git_push" || req.name === "git_pr") {
      await this.prepareHostWorkspace(session);
    }
    if (!opts?.ignoreAllowlist) {
      const blocked = await this.runPreToolUseHooks(session, req.name);
      if (blocked) return blocked;
    }
    const controlPlane = this.controlPlanePorts();
    const early = await executeEarlyControlPlaneTool(
      controlPlane,
      session,
      req,
      opts,
      fenceHostile,
    );
    if (early) return early;
    if (req.name === "preview") {
      if (isCanvasSession(session)) return this.openDesignCanvasPreview(session);
      if (runtime === "host" && !this.isWorkerSession(session)) {
        return { ok: false, output: "preview is only available on Docker agents" };
      }
    }
    const accessGate = await this.applyToolGate(
      sessionId,
      req.name,
      gateToolRequest(req.name, req.args, { ...gateCtx, stage: "access" }),
    );
    if (accessGate) return accessGate;
    if (req.name === "file_read" && isAssetSession(session)) {
      const paths = fileReadPaths(req.args);
      if (paths.some((path) => isAssetRasterPath(path))) {
        return { ok: true, output: ASSET_RASTER_READ };
      }
    }
    if (req.name === "playwright") {
      return this.runPlaywrightTool(session, req.args);
    }
    if (req.name === "git_push" || req.name === "git_pr") {
      const checkout = matchWorkspaceCheckout(session, {
        path: typeof req.args.path === "string" ? req.args.path : undefined,
        url: typeof req.args.url === "string" ? req.args.url : undefined,
      });
      const tests = await this.runPublishTestGate(session, checkout);
      if (tests.ran && !tests.ok) {
        return {
          ok: false,
          status: "blocked",
          category: "test-gate",
          retryable: tests.retryable,
          details: {
            script: "test",
            failureKind: tests.failureKind ?? "script-failure",
            failedTests: tests.failedTests ?? [],
            ...(tests.cwd ? { cwd: tests.cwd } : {}),
            ...(tests.command ? { command: tests.command } : {}),
            ...(tests.exitCode !== undefined ? { exitCode: tests.exitCode } : {}),
            ...(tests.durationMs !== undefined ? { durationMs: tests.durationMs } : {}),
            ...(tests.cached ? { cached: true } : {}),
          },
          output: formatNpmTestGateFailure(req.name, tests),
        };
      }
    }
    if (
      session.compare?.kind === "workers" &&
      (req.name === "file_write" || req.name === "apply_patch")
    ) {
      const path = typeof req.args.path === "string" ? req.args.path : "";
      if (path && isWorkerLockPath(path))
        throw new Error(`Workers cannot rewrite lockfile ${path}`);
    }
    const late = await executeLateControlPlaneTool(
      controlPlane,
      session,
      req,
      opts,
      fenceHostile,
      config,
    );
    if (late) return late;
    const catalog = new Set(toolsForRuntime(session.os, runtime).map((t) => t.name));
    if (!catalog.has(req.name)) {
      throw new Error(`Tool ${req.name} is not available for this agent`);
    }
    if (req.name === "grep") {
      const indexed = await this.tryIndexedGrep(session, req, config, fenceHostile);
      if (indexed) return indexed;
    }
    const forge = await executeSessionForgeTool(
      {
        forge: this.forge,
        attachPull: (id, pull) => this.attachPull(id, pull),
        requireForge: (row, args) => this.requireForge(row, args),
        resolveGitHeadBranch: (row, args) => this.resolveGitHeadBranch(row, args),
        loadLoadPathNotes: (repoId, number) => this.store.loadLoadPathNotes(repoId, number),
      },
      session,
      req,
      fenceHostile,
    );
    if (forge) return forge;
    if (runtime === "host" && !this.isWorkerSession(session)) {
      return this.executeHostTool(session, req, opts);
    }
    const vm = session.vmId ? this.getMachine(session.vmId) : undefined;
    if (!vm) {
      throw new Error(
        runtime === "docker"
          ? "Start the container before using guest tools"
          : "Start the VM before using guest tools",
      );
    }
    if (toolNeedsGuest(req.name) && !isGuestReady(vm.status)) {
      throw new Error(
        `The guest isn't ready yet (${vm.status}). Wait until it finishes starting, then try again.`,
      );
    }
    if (req.name === "preview") {
      return this.openPreview(session, vm, req.args);
    }
    req = await this.injectForgeGitArgs(session, req);
    this.broadcastToolOverlay(sessionId, req);
    const guest = this.guests.forVm(vm);
    await this.snapshotFileUndo(session, guest, req, opts);
    let result = await guest.execute(req, this.aborts.get(sessionId)?.signal, opts?.onOutput);
    result = await this.settleExecutedTool(session, req, result, opts);
    if (req.name === "record_screen") {
      result = await this.persistRecording(sessionId, vm, result);
    }
    if (
      req.name === "browser_pdf" ||
      req.name === "browser_trace" ||
      req.name === "browser_download"
    ) {
      result = await this.persistArtifact(sessionId, result);
    }
    if (result.ok && (req.name === "exec" || req.name === "start_process")) {
      const command = execArgCommands(req.args).join("\n");
      const guessed = guessListenPorts(command);
      if (guessed.length) {
        this.docker.noteListeningPorts?.(vm.id, guessed);
        if (!session.preview) {
          const port = pickPreviewPort(guessed) ?? guessed[0]!;
          await this.store.mutateSession(sessionId, (current) => {
            current.preview = { port };
          });
          const updated = await this.get(sessionId);
          if (updated) this.hub.broadcast({ type: "session.updated", session: updated });
        }
      }
    }
    const gui = new Set([
      "screenshot",
      "mouse_move",
      "mouse_click",
      "mouse_drag",
      "mouse_scroll",
      "key",
      "type_text",
      "window_focus",
    ]);
    if (gui.has(req.name) && req.name !== "screenshot" && sessionVision(session) !== "off") {
      try {
        const shot = await guest.execute({ name: "screenshot", args: {} });
        if (shot.screenshotBase64) result.screenshotBase64 = shot.screenshotBase64;
      } catch {
        /* screenshot is optional */
      }
    }
    return await this.publishToolResult(sessionId, req, result);
  }

  private async persistRecording(
    sessionId: string,
    vm: VmInstance,
    result: ToolResult,
  ): Promise<ToolResult> {
    if (!result.ok || !result.recordingName) return result;
    const dest = recordingDest(this.store.dataDir, sessionId, result.recordingName);
    await mkdir(dirname(dest), { recursive: true });
    if (result.recordingGuestPath && vm.ssh) {
      const pulled = await runSsh(
        scpGetArgv(
          {
            host: vm.ssh.host,
            port: vm.ssh.port,
            username: vm.ssh.username,
            identityFile: vm.ssh.identityFile,
          },
          result.recordingGuestPath,
          dest,
        ),
      );
      if (pulled.code !== 0) {
        return {
          ...result,
          ok: false,
          output:
            pulled.stderr.trim() || pulled.stdout.trim() || "failed to copy recording from guest",
        };
      }
      return result;
    }
    if (result.recordingGuestPath && !vm.ssh) {
      return {
        ...result,
        output: `${result.output}\nrecording left on guest at ${result.recordingGuestPath}`,
      };
    }
    await writeMockRecording(this.store.dataDir, sessionId, result.recordingName);
    return result;
  }

  private async persistArtifact(sessionId: string, result: ToolResult): Promise<ToolResult> {
    if (!result.ok || !result.artifactName || !result.artifactKind) return result;
    if (!result.artifactBase64) return result;
    let bytes: Buffer;
    try {
      bytes = Buffer.from(result.artifactBase64, "base64");
    } catch {
      return { ...result, ok: false, output: "Invalid artifact data" };
    }
    if (!bytes.length) return { ...result, ok: false, output: "Artifact was empty" };
    await writeArtifactBytes(
      this.store.dataDir,
      sessionId,
      result.artifactName,
      result.artifactKind,
      bytes,
    );
    const { artifactBase64: _drop, ...rest } = result;
    return rest;
  }

  async captureImage(sessionId: string, name: string): Promise<GoldenImage> {
    const session = await this.require(sessionId);
    if (sessionRuntime(session) === "docker" && this.isWorkerSession(session)) {
      const id = randomUUID();
      const dest = join(this.store.dataDir, "images", id);
      await mkdir(dest, { recursive: true });
      let wroteCanvas = false;
      try {
        const listed = await this.workspace.listWorkspace(sessionId);
        for (const entry of listed.entries) {
          if (entry.type !== "file") continue;
          try {
            const file = await this.workspace.readWorkspace(sessionId, entry.path);
            await writeWorkspaceFile(dest, entry.path, file.content);
            if (entry.path === "index.html") wroteCanvas = true;
          } catch {
            try {
              const raw = await this.workspace.readWorkspaceRaw(sessionId, entry.path);
              await writeWorkspaceBytes(dest, entry.path, raw.bytes);
            } catch {
              /* skip unreadable bind-mount files */
            }
          }
        }
      } catch {
        /* canvas copy below still runs */
      }
      if (!wroteCanvas) {
        const canvas = await this.design.readCanvas(sessionId);
        await writeFile(join(dest, "index.html"), canvas.html?.trim() || "", "utf8");
      }
      const image: GoldenImage = {
        id,
        name: name.trim() || `${session.title} image`,
        os: session.os,
        path: dest,
        sourceVmId: session.vmId,
        runtime: "docker",
        dockerImage: session.dockerImage,
        createdAt: now(),
      };
      await this.store.replaceImage(image);
      return image;
    }
    if (sessionRuntime(session) === "docker") {
      const src = session.vmId
        ? this.docker.get(session.vmId)?.diskPath
        : join(this.store.dataDir, "docker-workspaces", sessionId);
      if (!src) throw new Error("Start the container before capturing a workspace image");
      const id = randomUUID();
      const dest = join(this.store.dataDir, "images", id);
      if (session.vmId && this.docker.snapshotWorkspace) {
        await this.docker.snapshotWorkspace(session.vmId, dest);
      } else {
        await cp(src, dest, { recursive: true });
      }
      const image: GoldenImage = {
        id,
        name: name.trim() || `${session.title} image`,
        os: session.os,
        path: dest,
        sourceVmId: session.vmId,
        runtime: "docker",
        dockerImage: session.dockerImage,
        createdAt: now(),
      };
      await this.store.replaceImage(image);
      return image;
    }
    if (!session.vmId) throw new Error("Start the VM before capturing a golden image");
    const vm = this.hypervisor.get(session.vmId);
    if (!vm) throw new Error("VM not found");
    if (!this.hypervisor.snapshotDisk) throw new Error("This hypervisor cannot snapshot disks");
    const id = randomUUID();
    const dest = join(this.store.dataDir, "images", `${id}.qcow2`);
    const running = vm.status === "running" || vm.status === "ready";
    const pauseGuest = Boolean(this.hypervisor.snapshotRequiresPause && running);
    if (pauseGuest) await this.hypervisor.pause(session.vmId).catch(() => undefined);
    try {
      await this.hypervisor.snapshotDisk(session.vmId, dest);
    } finally {
      if (pauseGuest && this.hypervisor.resume)
        await this.hypervisor.resume(session.vmId).catch(() => undefined);
    }
    const image: GoldenImage = {
      id,
      name: name.trim() || `${session.title} image`,
      os: session.os,
      path: dest,
      sourceVmId: vm.id,
      createdAt: now(),
    };
    await this.store.replaceImage(image);
    return image;
  }

  private contextBudgetFor(
    session: { model: string },
    provider?: { kind?: string; baseUrl?: string },
  ): { window: number; reserved: number; budget: number } {
    const window = modelContextWindow(session.model, provider?.kind);
    const reserved = reservedOutputTokens(session.model, provider);
    return { window, reserved, budget: contextBudget({ window, reservedOutput: reserved }) };
  }

  private async recordCursorCliContext(sessionId: string, promptText: string): Promise<void> {
    const session = await this.require(sessionId);
    const ctx = this.contextBudgetFor(session, { kind: "cursor-cli" });
    const conversationChars =
      session.messages.reduce((n, message) => n + messageChars(message), 0) + promptText.length;
    await this.recordPromptContext(
      sessionId,
      { system: "", cacheBlocks: [], messages: session.messages },
      {
        window: ctx.window,
        reserved: ctx.reserved,
        charsPerToken: session.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN,
        tools: [],
        rulesChars: 0,
        skillsChars: 0,
        conversationChars,
      },
    );
  }

  private async applyCursorCliUsage(
    sessionId: string,
    messageId: string,
    ev: {
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens?: number;
      cacheWriteTokens?: number;
      window?: number;
    },
  ): Promise<void> {
    const delta = {
      inputTokens: ev.inputTokens,
      outputTokens: ev.outputTokens,
      ...(ev.cachedInputTokens ? { cachedInputTokens: ev.cachedInputTokens } : {}),
    };
    const stats = this.promptStats.get(sessionId);
    const session = await this.store.mutateSession(sessionId, (current) => {
      const msg = current.messages.find((m) => m.id === messageId);
      if (msg) msg.usage = addUsage(msg.usage, delta);
      current.usage = addUsage(current.usage, delta);
      if (ev.inputTokens <= 0 && !ev.cachedInputTokens && !ev.cacheWriteTokens) return;
      if (stats && ev.inputTokens > 0) {
        current.charsPerToken = calibrateCharsPerToken(
          stats.chars,
          ev.inputTokens,
          current.charsPerToken,
        );
      }
      const window =
        typeof ev.window === "number" && Number.isFinite(ev.window) && ev.window > 0
          ? Math.round(ev.window)
          : (stats?.window ?? modelContextWindow(current.model, "cursor-cli"));
      const reserved = stats?.reserved ?? 0;
      const occupancy = occupancyFromCursorCliUsage({
        inputTokens: ev.inputTokens,
        cachedInputTokens: ev.cachedInputTokens,
        cacheWriteTokens: ev.cacheWriteTokens,
        window,
      });
      current.context = buildContextBreakdown({
        window,
        reserved,
        charsPerToken: current.charsPerToken,
        measuredUsed: occupancy.used,
        cachedInputTokens: occupancy.cachedInputTokens,
        parts: stats?.parts ?? [
          { id: "conversation", label: "Conversation", chars: occupancy.used * 4 },
        ],
      });
    });
    if (session) this.hub.broadcast({ type: "session.updated", session });
  }

  private async recordPromptContext(
    sessionId: string,
    assembled: {
      system: string;
      cacheBlocks: string[];
      volatilePrefix?: string;
      messages: ChatMessage[];
    },
    opts: {
      window: number;
      reserved: number;
      charsPerToken: number;
      tools: Array<{ name: string; description?: string }>;
      rulesChars: number;
      skillsChars: number;
      conversationChars: number;
    },
  ): Promise<NonNullable<AgentSession["context"]>> {
    const mcpTools = opts.tools.filter((tool) => isMcpToolName(tool.name));
    const subagentTools = opts.tools.filter((tool) => isSpawnAgentToolName(tool.name));
    const otherTools = opts.tools.filter(
      (tool) => !isMcpToolName(tool.name) && !isSpawnAgentToolName(tool.name),
    );
    const parts = collectPromptContextParts({
      systemChars: assembled.system.length,
      toolsChars: toolCatalogChars(otherTools),
      rulesChars: opts.rulesChars,
      skillsChars: opts.skillsChars,
      mcpChars: toolCatalogChars(mcpTools),
      subagentChars: toolCatalogChars(subagentTools),
      repoChars: assembled.cacheBlocks.reduce((n, block) => n + block.length, 0),
      conversationChars: opts.conversationChars,
    });
    const chars =
      assembled.system.length +
      assembled.cacheBlocks.reduce((n, block) => n + block.length, 0) +
      (assembled.volatilePrefix?.length ?? 0) +
      assembled.messages.reduce((n, message) => n + messageChars(message), 0);
    const context = buildContextBreakdown({
      window: opts.window,
      reserved: opts.reserved,
      charsPerToken: opts.charsPerToken,
      parts,
    });
    this.promptStats.set(sessionId, {
      chars,
      parts,
      window: opts.window,
      reserved: opts.reserved,
    });
    const session = await this.store.mutateSession(sessionId, (current) => {
      current.context = context;
    });
    if (session) this.hub.broadcast({ type: "session.updated", session });
    return context;
  }

  private async applyUsage(
    sessionId: string,
    messageId: string | undefined,
    ev: { inputTokens: number; outputTokens: number; cachedInputTokens?: number },
  ): Promise<void> {
    const delta = {
      inputTokens: ev.inputTokens,
      outputTokens: ev.outputTokens,
      ...(ev.cachedInputTokens ? { cachedInputTokens: ev.cachedInputTokens } : {}),
    };
    const stats = messageId ? this.promptStats.get(sessionId) : undefined;
    const session = await this.store.mutateSession(sessionId, (current) => {
      if (messageId) {
        const msg = current.messages.find((m) => m.id === messageId);
        if (msg) msg.usage = addUsage(msg.usage, delta);
        const input = msg?.usage?.inputTokens ?? 0;
        if (stats && input > 0) {
          current.charsPerToken = calibrateCharsPerToken(stats.chars, input, current.charsPerToken);
          current.context = buildContextBreakdown({
            window: stats.window,
            reserved: stats.reserved,
            charsPerToken: current.charsPerToken,
            measuredUsed: input,
            cachedInputTokens: msg?.usage?.cachedInputTokens ?? ev.cachedInputTokens,
            parts: stats.parts,
          });
        }
      }
      current.usage = addUsage(current.usage, delta);
    });
    if (session) this.hub.broadcast({ type: "session.updated", session });
  }

  private async appendDelta(sessionId: string, messageId: string, delta: string): Promise<void> {
    const session = await this.store.mutateSession(
      sessionId,
      (current) => {
        const msg = current.messages.find((m) => m.id === messageId);
        if (msg) msg.content += delta;
      },
      { persist: "later" },
    );
    if (!session) return;
    this.hub.broadcast({ type: "chat.delta", sessionId, messageId, delta });
  }

  private async appendThinking(sessionId: string, messageId: string, text: string): Promise<void> {
    if (!text) return;
    let applied = "";
    await this.store.mutateSession(
      sessionId,
      (current) => {
        const msg = current.messages.find((m) => m.id === messageId);
        if (!msg) return;
        const next = appendThinkingText(msg.thinking, text);
        applied = next.slice(msg.thinking?.length ?? 0);
        msg.thinking = next;
      },
      { persist: "later" },
    );
    if (applied) {
      this.hub.broadcast({
        type: "chat.thinkingDelta",
        sessionId,
        messageId,
        delta: applied,
      });
    }
    this.noteThinking(sessionId, text);
  }

  private noteThinking(sessionId: string, text: string): void {
    const first = !this.thinkingBuf.has(sessionId);
    const next = `${this.thinkingBuf.get(sessionId) ?? ""}${text}`.slice(-2_000);
    this.thinkingBuf.set(sessionId, next);
    const snippet = formatThinkingSnippet(next);
    if (first) {
      this.hub.broadcast({ type: "chat.thinking", sessionId, snippet });
      return;
    }
    if (this.thinkingTimers.has(sessionId)) return;
    const timer = setTimeout(() => {
      this.thinkingTimers.delete(sessionId);
      const buf = this.thinkingBuf.get(sessionId);
      if (!buf) return;
      this.hub.broadcast({
        type: "chat.thinking",
        sessionId,
        snippet: formatThinkingSnippet(buf),
      });
    }, 80);
    timer.unref?.();
    this.thinkingTimers.set(sessionId, timer);
  }

  private clearThinking(sessionId: string): void {
    const had = this.thinkingBuf.has(sessionId) || this.thinkingTimers.has(sessionId);
    this.thinkingBuf.delete(sessionId);
    const timer = this.thinkingTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.thinkingTimers.delete(sessionId);
    if (had) this.hub.broadcast({ type: "chat.thinking", sessionId, snippet: "" });
  }

  private async onVmStatus(id: string, status: string, error?: string): Promise<void> {
    const vm = this.getMachine(id);
    if (vm) {
      try {
        await this.persistVm(vm);
      } catch {
        /* store may already be torn down in tests */
      }
    }
    this.hub.broadcast({ type: "vm.status", id, status: status as VmInstance["status"], error });
    if (vm) this.hub.broadcast({ type: "vm.updated", vm: redactVm(vm) });
    try {
      const sessions = await this.store.loadSessions();
      const session = sessions.find((s) => s.vmId === id);
      if (!session) return;
      if (isGuestReady(status) || status === "error" || status === "stopped") {
        this.guestBoot.dropExpected(session.id);
      }
      if (status === "error" || status === "stopped") {
        this.imageBuildNoted.delete(session.id);
        this.imageBuildFinished.delete(session.id);
        this.clearImageProgress(session.id);
      }
      const chatting = this.aborts.has(session.id);
      const mapped =
        status === "running"
          ? chatting
            ? "running"
            : "idle"
          : status === "error"
            ? "error"
            : status === "stopped"
              ? "stopped"
              : chatting
                ? "running"
                : "provisioning";
      const updated = await this.store.mutateSession(session.id, (current) => {
        current.status = mapped;
        current.error = error;
      });
      if (updated) this.hub.broadcast({ type: "session.updated", session: updated });
      const note = bootNote(status, error, sessionRuntime(session));
      const skipReadyNote = chatting && isGuestReady(status);
      if (
        note &&
        !skipReadyNote &&
        !session.messages.some((m) => m.role === "system" && m.content === note)
      ) {
        await this.appendMessage(session.id, {
          id: randomUUID(),
          role: "system",
          content: note,
          createdAt: now(),
        });
      }
      if (status === "running") {
        await this.cloneRepoIfNeeded(session.id);
        await this.syncChatAttachments(session.id);
        await this.syncWindowsShare(session.id);
        await this.attachGuestMcp(session.id);
      }
      if (isGuestReady(status)) {
        await this.syncGuestTree(session.id);
        await this.resumeIgnoredStartPrompt(session.id);
      }
      if (status === "stopped" || status === "error") {
        this.closeIdeTunnel(session.id);
        this.mcp.detachGuest(session.id);
      }
    } catch {
      /* store may already be torn down in tests */
    }
  }

  private async syncWindowsShare(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    if (!session || !isWindows(session.os) || !session.vmId) return;
    const vm = this.hypervisor.get(session.vmId);
    if (!vm) return;
    const share = (await this.store.loadConfig()).advanced.hostSharePath?.trim();
    if (!share) return;
    try {
      await syncHostShareToWindows(vm, share);
    } catch {
      /* guest SSH may not be ready yet */
    }
  }

  private async cloneRepoIfNeeded(sessionId: string): Promise<void> {
    const inflight = this.cloneInflight.get(sessionId);
    if (inflight) return inflight;
    if (this.cloned.has(sessionId)) return;
    const work = this.runCloneRepo(sessionId).finally(() => {
      if (this.cloneInflight.get(sessionId) === work) this.cloneInflight.delete(sessionId);
    });
    this.cloneInflight.set(sessionId, work);
    return work;
  }

  private async runCloneRepo(sessionId: string): Promise<void> {
    if (this.cloned.has(sessionId)) return;
    const session = await this.get(sessionId);
    if (!session?.repo?.url) return;
    const runtime = sessionRuntime(session);
    if (runtime !== "host" && !session.vmId) return;
    this.cloned.add(sessionId);
    const config = await this.store.loadConfig();
    const checkouts = isCanvasSession(session) ? [session.repo] : sessionRepoCheckouts(session);
    const workspace = workspacePath(session.os, runtime).replace(/\\/g, "/");
    let anyOk = false;
    try {
      for (const [index, checkout] of checkouts.entries()) {
        const dest =
          isCanvasSession(session) && session.repo?.url
            ? DESIGN_REPO_CONTEXT_PATH
            : checkout.dest?.trim() || workspace;
        if (this.liveCheckoutReady(session, checkout)) {
          anyOk = true;
          continue;
        }
        const forge = await this.sessionForgeFresh(config, session, checkout);
        await this.appendMessage(sessionId, {
          id: randomUUID(),
          role: "system",
          content: cloneStartNote({
            url: checkout.url,
            dest,
            runtime,
            design: isCanvasSession(session),
          }),
          createdAt: now(),
        });
        this.broadcastCloneProgress(sessionId, cloneStartProgress(), true);
        const result = await this.executeTool(
          sessionId,
          {
            name: "git_clone",
            args: {
              url: checkout.url,
              dest,
              ref: checkout.ref ?? "",
              pull: index === 0 ? session.pull?.number : undefined,
              token: forge?.token ?? "",
              forge: checkout.forge ?? forge?.kind,
            },
          },
          {
            ignoreAllowlist: true,
            onOutput: (chunk) => {
              const acc = `${this.cloneOutputBuf.get(sessionId) ?? ""}${chunk}`;
              this.cloneOutputBuf.set(sessionId, acc.length > 8000 ? acc.slice(-4000) : acc);
              const parsed = parseGitCloneProgress(acc);
              if (parsed) this.broadcastCloneProgress(sessionId, parsed);
            },
          },
        );
        const output = redactText(result.output, forge?.token ? [forge.token] : []);
        const hint = result.ok ? undefined : gitCloneAuthFailureHint(output);
        this.broadcastCloneProgress(sessionId, cloneDoneProgress(), true);
        await this.appendMessage(sessionId, {
          id: randomUUID(),
          role: "system",
          content: result.ok
            ? isCanvasSession(session)
              ? `Cloned ${checkout.url} into ${dest} for canvas context (read-only reference)`
              : `Cloned ${checkout.url} into the ${runtime === "host" ? "host workspace" : "guest"} at ${dest}`
            : `Clone failed: ${output}${hint ? `\n${hint}` : ""}`,
          createdAt: now(),
        });
        if (result.ok) anyOk = true;
      }
      this.clearCloneProgress(sessionId);
      if (anyOk && !isCanvasSession(session) && session.vmId) {
        const live = this.getMachine(session.vmId);
        if (live) await this.applyWorkspaceEnvironment(sessionId, live).catch(() => undefined);
      }
      await this.landStudioWorkspace(session.id);
    } catch (err) {
      this.cloned.delete(sessionId);
      const message = err instanceof Error ? err.message : "clone failed";
      await this.appendMessage(sessionId, {
        id: randomUUID(),
        role: "system",
        content: `Clone skipped: ${message}`,
        createdAt: now(),
      });
      this.clearCloneProgress(sessionId);
    }
  }

  private broadcastCloneProgress(sessionId: string, progress: CloneProgress, force = false): void {
    const prev = this.cloneProgressAt.get(sessionId);
    const t = Date.now();
    const percent = !force && prev ? Math.max(prev.percent, progress.percent) : progress.percent;
    const sameBar = Boolean(prev && percent === prev.percent && progress.phase === prev.phase);
    const sameDetail = Boolean(prev && sameCloneProgressDetail(prev, progress));
    if (!force && prev && sameBar && sameDetail && t - prev.t < 200) return;
    if (!force && prev && sameBar && !sameDetail && t - prev.t < 80) return;
    this.cloneProgressAt.set(sessionId, {
      t,
      percent,
      phase: progress.phase,
      received: progress.received,
      rate: progress.rate,
      phasePercent: progress.phasePercent,
      size: progress.size,
      total: progress.total,
    });
    this.hub.broadcast({
      type: "clone.progress",
      sessionId,
      percent,
      phase: progress.phase,
      done: progress.done,
      phasePercent: progress.phasePercent,
      received: progress.received,
      total: progress.total,
      size: progress.size,
      rate: progress.rate,
    });
  }

  private clearCloneProgress(sessionId: string): void {
    this.cloneProgressAt.delete(sessionId);
    this.cloneOutputBuf.delete(sessionId);
    this.hub.broadcast({
      type: "clone.progress",
      sessionId,
      percent: 100,
      phase: "Done",
      done: true,
      clear: true,
    });
  }

  private queueImageBuild(vmId: string, progress: ImageBuildProgress): void {
    const vm = this.docker.get(vmId) ?? this.getMachine(vmId);
    const sessionId = vm?.sessionId;
    if (!sessionId) return;
    const next = (this.imageBuildChain.get(sessionId) ?? Promise.resolve()).then(
      () => this.applyImageBuild(sessionId, vm, progress),
      () => this.applyImageBuild(sessionId, vm, progress),
    );
    this.imageBuildChain.set(sessionId, next);
  }

  private async applyImageBuild(
    sessionId: string,
    vm: VmInstance,
    progress: ImageBuildProgress,
  ): Promise<void> {
    const image = vm.dockerImage ?? "locus/agent:0.1";
    if (!progress.done && !this.imageBuildNoted.has(sessionId)) {
      this.imageBuildNoted.add(sessionId);
      await this.appendMessage(sessionId, {
        id: randomUUID(),
        role: "system",
        content: imageBuildStartNote(image),
        createdAt: now(),
      });
      this.broadcastImageProgress(sessionId, progress, true);
      return;
    }
    this.broadcastImageProgress(sessionId, progress);
    if (!progress.done) return;
    if (this.imageBuildNoted.has(sessionId) && !this.imageBuildFinished.has(sessionId)) {
      this.imageBuildFinished.add(sessionId);
      await this.appendMessage(sessionId, {
        id: randomUUID(),
        role: "system",
        content: imageBuildDoneNote(image),
        createdAt: now(),
      });
    }
    this.clearImageProgress(sessionId);
  }

  private broadcastImageProgress(
    sessionId: string,
    progress: ImageBuildProgress,
    force = false,
  ): void {
    const prev = this.imageBuildAt.get(sessionId);
    const t = Date.now();
    const percent = !force && prev ? Math.max(prev.percent, progress.percent) : progress.percent;
    const next: ImageBuildProgress = { ...progress, percent };
    if (!force && prev && sameImageBuildProgress(prev, next) && t - prev.t < 200) return;
    this.imageBuildAt.set(sessionId, { t, ...next });
    this.hub.broadcast({
      type: "image.progress",
      sessionId,
      percent,
      phase: progress.phase,
      done: progress.done,
      step: progress.step,
      total: progress.total,
      cached: progress.cached,
      detail: progress.detail,
    });
  }

  private clearImageProgress(sessionId: string): void {
    this.imageBuildAt.delete(sessionId);
    this.hub.broadcast({
      type: "image.progress",
      sessionId,
      percent: 100,
      phase: "Done",
      done: true,
      clear: true,
    });
  }

  private async persistVm(vm: VmInstance): Promise<void> {
    await this.store.upsertVm(vm);
  }

  private async keepGuestOrDestroy(
    sessionId: string,
    vmId: string,
    engine: { get(id: string): unknown; destroy(id: string): Promise<void> },
  ): Promise<void> {
    if (engine.get(vmId) && (await this.get(sessionId))) return;
    await engine.destroy(vmId).catch(() => undefined);
    throw new Error("Session deleted");
  }

  private async attachGuestMcp(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    if (!session?.vmId || sessionRuntime(session) !== "docker") return;
    const vm = this.getMachine(session.vmId);
    if (!vm?.containerId || !this.guests.forVm(vm).liveGuest) return;
    const config = await this.store.loadConfig();
    await this.mcp.attachGuest(sessionId, vm.containerId, config.mcpServers ?? []);
  }

  async attachPull(sessionId: string, pull: SessionPull): Promise<void> {
    const sessions = await this.store.loadSessions();
    const session = sessions.find((row) => row.id === sessionId);
    if (!session) return;
    const ids = boundPeerIds(session, sessions);
    for (const id of ids) {
      const updated = await this.store.mutateSession(id, (current) => {
        current.pull = pull;
        if (session.repoId) current.repoId = current.repoId ?? session.repoId;
        if (session.repo) current.repo = current.repo ?? session.repo;
      });
      if (updated) this.hub.broadcast({ type: "session.updated", session: updated });
    }
  }

  findBoundAgent(
    sessions: AgentSession[],
    query: {
      repoId?: string;
      sourceDesignId?: string;
      promotedAgentId?: string;
      pullNumber?: number;
    },
  ): AgentSession | undefined {
    return findBoundAgent(sessions, query);
  }

  private sessionForge(
    config: { forges: import("@locus/shared").GitForgeAccount[] },
    session: AgentSession,
    checkout?: import("@locus/shared").RepoCheckout,
  ) {
    const target = checkout ?? session.repo;
    return resolveForgeAccount(config.forges, {
      accountId: target?.accountId,
      kind: target?.forge,
      url: target?.url,
    });
  }

  private async sessionForgeFresh(
    config: { forges: import("@locus/shared").GitForgeAccount[] },
    session: AgentSession,
    checkout?: import("@locus/shared").RepoCheckout,
  ) {
    const account = this.sessionForge(config, session, checkout) ?? config.forges[0];
    if (!account) return undefined;
    return withFreshForgeToken(this.store, account, this.fetchFn);
  }

  private async requireForge(
    session: AgentSession,
    args?: Record<string, unknown>,
  ): Promise<
    { account: import("@locus/shared").GitForgeAccount; owner: string; repo: string } | ToolResult
  > {
    const checkout = matchWorkspaceCheckout(session, {
      path: typeof args?.path === "string" ? args.path : undefined,
      url: typeof args?.url === "string" ? args.url : undefined,
    });
    const url = checkout?.url ?? session.repo?.url;
    const config = await this.store.loadConfig();
    if (!url) {
      return {
        ok: false,
        output:
          "No repository is attached to this agent. git_clone a GitHub, GitLab, or Bitbucket URL to check out the code (that attaches this session), or pick a linked repo when creating the agent. git_pr_list and git_issue_list will not work until then.",
      };
    }
    const account = this.sessionForge(config, session, checkout);
    if (!account) return { ok: false, output: "Sign in or add a forge token in Settings → Git" };
    const fresh = await withFreshForgeToken(this.store, account, this.fetchFn);
    if (!fresh.token)
      return { ok: false, output: "Sign in or add a forge token in Settings → Git" };
    const parsed = parseOwnerRepo(url);
    if (!parsed) return { ok: false, output: `Could not parse repo URL: ${url}` };
    return { account: fresh, owner: parsed.owner, repo: parsed.repo };
  }

  private async noteGitHead(sessionId: string, raw: string): Promise<void> {
    const head = cleanGitHeadName(raw);
    if (!head) return;
    const updated = await this.store.mutateSession(sessionId, (current) => {
      current.gitBranch = head;
    });
    if (updated) this.hub.broadcast({ type: "session.updated", session: updated });
  }

  /** After the agent clones into /workspace, persist it so forge tools and the next prompt see a repo. */
  private async attachRepoAfterClone(sessionId: string, req: ToolRequest): Promise<void> {
    const url = typeof req.args.url === "string" ? req.args.url : "";
    const parsed = parseRepoUrl(url);
    if (!parsed) return;
    const dest =
      typeof req.args.dest === "string" && req.args.dest.trim() ? req.args.dest.trim() : undefined;
    const session = await this.get(sessionId);
    const repos = await this.store.loadRepos();
    const match = matchLinkedRepo(repos, parsed.url);
    const ref =
      typeof req.args.ref === "string" && req.args.ref.trim() ? req.args.ref.trim() : undefined;
    const checkout = {
      forge: parsed.forge,
      url: parsed.url,
      ref,
      dest,
      accountId: match?.checkout.accountId,
    };
    if (session?.repo?.url) {
      const key = parsed.url;
      const already = sessionRepoCheckouts(session).some(
        (row) =>
          row.url.replace(/\.git$/i, "").toLowerCase() === key.replace(/\.git$/i, "").toLowerCase(),
      );
      if (already) return;
      const updated = await this.store.mutateSession(sessionId, (current) => {
        current.extraRepos = [...(current.extraRepos ?? []), checkout];
        if (match) {
          current.extraRepoIds = [...new Set([...(current.extraRepoIds ?? []), match.id])];
        }
      });
      if (updated) this.hub.broadcast({ type: "session.updated", session: updated });
      return;
    }
    const updated = await this.store.mutateSession(sessionId, (current) => {
      if (current.repo?.url) return;
      current.repo = checkout;
      if (match) current.repoId = current.repoId ?? match.id;
    });
    if (updated) this.hub.broadcast({ type: "session.updated", session: updated });
  }

  async flagNeedsHuman(id: string, message: string): Promise<AgentSession> {
    const detail = message.trim() || "Needs you";
    const updated = await this.store.mutateSession(id, (current) => {
      current.needsHuman = detail;
    });
    if (!updated) throw new Error("Session not found");
    this.hub.broadcast({ type: "session.updated", session: updated });
    if (updated.projectId) {
      await this.projects?.relayMemberNeedsHuman(id, detail).catch(() => undefined);
    }
    return updated;
  }

  async patchMeta(id: string, patch: PatchSessionInput): Promise<AgentSession> {
    const session = await this.require(id);
    let config: LocusConfig | undefined;
    const loadConfig = async () => (config ??= await this.store.loadConfig());
    const next: Partial<
      Pick<
        AgentSession,
        | "title"
        | "pinned"
        | "archived"
        | "providerId"
        | "model"
        | "reasoningEffort"
        | "instructions"
        | "allowedTools"
        | "network"
        | "vision"
        | "webSearch"
        | "liveChrome"
        | "playbook"
        | "palette"
        | "designSystemId"
        | "assetStyleId"
        | "gameStyleId"
        | "playToken"
        | "assetBuild"
        | "assetPack"
        | "assetRefs"
        | "assetAppliedBuild"
        | "designTune"
        | "plan"
        | "queue"
        | "queuePaused"
        | "compare"
        | "preview"
        | "role"
        | "maxUsd"
        | "maxMs"
        | "autonomy"
        | "defaultSubagent"
        | "subscriptions"
        | "needsHuman"
      >
    > = {};
    if (typeof patch.title === "string") {
      const title = patch.title.trim();
      if (!title) throw new Error("Title is required");
      next.title = title;
    }
    if (typeof patch.pinned === "boolean") next.pinned = patch.pinned;
    if (typeof patch.archived === "boolean") next.archived = patch.archived;
    if (typeof patch.providerId === "string") {
      const loaded = await loadConfig();
      if (!loaded.providers.some((p) => p.id === patch.providerId)) {
        throw new Error("Unknown provider");
      }
      next.providerId = patch.providerId;
    }
    if (typeof patch.model === "string") {
      const model = patch.model.trim();
      if (!model) throw new Error("Model is required");
      const providerId =
        typeof patch.providerId === "string" ? patch.providerId : session.providerId;
      const provider = (await loadConfig()).providers.find((row) => row.id === providerId);
      next.model = provider && isCodexCliProvider(provider) ? normalizeCodexCliModel(model) : model;
    }
    if (patch.providerId !== undefined || patch.model !== undefined) {
      const effectiveProvider = (await loadConfig()).providers.find(
        (row) => row.id === (next.providerId ?? session.providerId),
      );
      if (effectiveProvider && isCodexCliProvider(effectiveProvider)) {
        const effectiveModel = next.model ?? session.model;
        if (effectiveModel) next.model = normalizeCodexCliModel(effectiveModel);
      }
    }
    if (patch.reasoningEffort === null) next.reasoningEffort = undefined;
    else if (patch.reasoningEffort !== undefined) {
      if (!isCodexReasoningEffort(patch.reasoningEffort)) {
        throw new Error("Unknown Codex reasoning effort");
      }
      next.reasoningEffort = patch.reasoningEffort;
    }
    if (patch.instructions === null) next.instructions = undefined;
    else if (typeof patch.instructions === "string") {
      next.instructions = patch.instructions.trim() || undefined;
    }
    if (patch.allowedTools === null) next.allowedTools = undefined;
    else if (Array.isArray(patch.allowedTools)) {
      const names = parseToolAllowlist(session.os, patch.allowedTools, sessionRuntime(session));
      next.allowedTools = names.length ? names : undefined;
    }
    if (patch.network !== undefined) {
      if (!isNetworkJail(patch.network)) throw new Error("Unknown network jail");
      const config = await this.store.loadConfig();
      const forced = policyForcedJail(config.managedPolicy);
      if (forced && patch.network === "open") {
        throw new Error(`Managed policy requires the ${forced} network jail`);
      }
      next.network = patch.network;
    }
    if (patch.vision !== undefined) {
      if (!isVisionMode(patch.vision)) throw new Error("Unknown vision mode");
      next.vision = patch.vision;
    }
    if (typeof patch.webSearch === "boolean") next.webSearch = patch.webSearch;
    if (typeof patch.liveChrome === "boolean") {
      if (patch.liveChrome) {
        const config = await this.store.loadConfig();
        if (!policyAllowsLiveChrome(config.managedPolicy)) {
          throw new Error("Managed policy does not allow Use my Chrome");
        }
      }
      next.liveChrome = patch.liveChrome;
    }
    if (patch.playbook === null) next.playbook = undefined;
    else if (typeof patch.playbook === "string") {
      next.playbook = patch.playbook.trim() || undefined;
    }
    if (patch.palette === null) next.palette = undefined;
    else if (patch.palette !== undefined) {
      const parsed = parseDesignPalette(patch.palette);
      if (!parsed) throw new Error("Invalid color palette");
      next.palette = parsed;
    }
    if (patch.designSystemId === null) next.designSystemId = undefined;
    else if (typeof patch.designSystemId === "string") {
      const id = patch.designSystemId.trim();
      if (!id) next.designSystemId = undefined;
      else {
        const system = resolveDesignSystem(id, await this.store.loadDesignSystems());
        const kit = isGameSession(session)
          ? resolveGameKit(id)
          : isAssetSession(session)
            ? resolveAssetKit(id)
            : undefined;
        if (kit) next.designSystemId = kit.id;
        else if (!system) throw new Error("Design system not found");
        else {
          next.designSystemId = system.id;
          if (patch.palette === undefined) next.palette = system.palette;
        }
      }
    }
    if (patch.assetStyleId === null) next.assetStyleId = undefined;
    else if (typeof patch.assetStyleId === "string") {
      const id = patch.assetStyleId.trim();
      if (!id) next.assetStyleId = undefined;
      else {
        const style = resolveAssetStyle(id, await this.store.loadAssetStyles());
        if (!style) throw new Error("Asset style not found");
        next.assetStyleId = style.id;
        if (patch.palette === undefined && style.palette) next.palette = style.palette;
      }
    }
    if (patch.gameStyleId === null) next.gameStyleId = undefined;
    else if (typeof patch.gameStyleId === "string") {
      const id = patch.gameStyleId.trim();
      if (!id) next.gameStyleId = undefined;
      else {
        const style = resolveGameStyle(id, await this.store.loadGameStyles());
        if (!style) throw new Error("Game style not found");
        next.gameStyleId = style.id;
        if (patch.palette === undefined && style.palette) next.palette = style.palette;
        if (patch.designTune === undefined) {
          next.designTune = tuneFromFeel(GAME_FEEL_PRESETS[style.juice], session.designTune);
        }
      }
    }
    if (patch.playToken === null) next.playToken = undefined;
    else if (typeof patch.playToken === "string" && patch.playToken.trim()) {
      next.playToken = patch.playToken.trim();
    }
    if (patch.assetBuild === null) next.assetBuild = undefined;
    else if (patch.assetBuild !== undefined) {
      next.assetBuild = resolveAssetBuild(patch.assetBuild);
    }
    if (patch.assetPack === null) next.assetPack = undefined;
    else if (patch.assetPack !== undefined) next.assetPack = patch.assetPack;
    if (patch.assetRefs === null) next.assetRefs = undefined;
    else if (patch.assetRefs !== undefined) {
      next.assetRefs = parseSessionAssetRefs(patch.assetRefs) ?? [];
    }
    if (patch.assetAppliedBuild === null) next.assetAppliedBuild = undefined;
    else if (patch.assetAppliedBuild !== undefined) {
      next.assetAppliedBuild = resolveAssetBuild(patch.assetAppliedBuild);
    }
    if (patch.designTune === null) next.designTune = undefined;
    else if (patch.designTune !== undefined) {
      next.designTune = parseDesignTune(patch.designTune);
    }
    if (patch.plan === null) next.plan = undefined;
    else if (patch.plan && Array.isArray(patch.plan.items)) {
      const items = patch.plan.items
        .map((item, index) => ({
          id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : `p${index + 1}`,
          text: typeof item.text === "string" ? item.text.trim() : "",
          status: isPlanStepStatus(item.status) ? item.status : undefined,
          owner: item.owner === "operator" || item.owner === "model" ? item.owner : undefined,
        }))
        .filter((item) => item.text);
      next.plan = items.length
        ? {
            items,
            messageId: patch.plan.messageId,
            phase: patch.plan.phase === "proposed" ? "proposed" : "accepted",
          }
        : undefined;
    }
    if (patch.queue === null) {
      next.queue = undefined;
      next.queuePaused = undefined;
    } else if (patch.queue !== undefined) {
      const queue = normalizePromptQueue(patch.queue);
      next.queue = queue.length ? queue : undefined;
      if (!queue.length) next.queuePaused = undefined;
    }
    if (patch.queuePaused === false) next.queuePaused = undefined;
    else if (patch.queuePaused === true) next.queuePaused = true;
    if (patch.compare === null) next.compare = undefined;
    else if (patch.compare !== undefined) {
      const parsed = parseSessionCompare(patch.compare);
      if (!parsed) throw new Error("Invalid compare");
      next.compare = parsed;
    }
    if (patch.preview === null) next.preview = undefined;
    else if (patch.preview !== undefined) {
      const parsed = parseSessionPreview(patch.preview);
      if (!parsed) throw new Error("Invalid preview");
      next.preview = parsed;
    }
    if (patch.role === null) next.role = undefined;
    else if (patch.role !== undefined) {
      if (!isAgentRole(patch.role)) throw new Error("Unknown role");
      next.role = patch.role;
    }
    if (patch.maxUsd === null) next.maxUsd = undefined;
    else if (typeof patch.maxUsd === "number") {
      next.maxUsd = patch.maxUsd > 0 ? patch.maxUsd : undefined;
    }
    if (patch.maxMs === null) next.maxMs = undefined;
    else if (typeof patch.maxMs === "number") {
      next.maxMs = patch.maxMs > 0 ? Math.round(patch.maxMs) : undefined;
    }
    if (patch.autonomy === null) next.autonomy = undefined;
    else if (patch.autonomy !== undefined) {
      if (!isAutonomyTier(patch.autonomy)) throw new Error("Unknown autonomy tier");
      if (patch.autonomy === "autonomous") {
        const config = await this.store.loadConfig();
        if (!policyAllowsAutonomous(config.managedPolicy)) {
          throw new Error("Managed policy does not allow Autonomous mode");
        }
      }
      next.autonomy = patch.autonomy;
    }
    if (patch.defaultSubagent !== undefined) {
      if (!isSubagentKind(patch.defaultSubagent)) throw new Error("Unknown sub-agent kind");
      next.defaultSubagent = patch.defaultSubagent;
    }
    if (patch.subscriptions === null) next.subscriptions = undefined;
    else if (patch.subscriptions !== undefined) {
      const rows = normalizeSubscriptions(patch.subscriptions);
      next.subscriptions = rows.length ? rows : undefined;
    }
    if (patch.needsHuman === null) next.needsHuman = undefined;
    const saved = await this.patch(id, next);
    if (typeof next.designSystemId === "string") {
      if (isGameSession(session)) {
        await this.design.landGameKit(id, next.designSystemId);
      } else if (isAssetSession(session)) {
        await this.design.landAssetKit(id, next.designSystemId);
      } else {
        await this.design.landKit(id, next.designSystemId);
      }
    }
    if (typeof next.assetStyleId === "string" && isAssetSession(session)) {
      await this.design.applyAssetStyleBrief(id, next.assetStyleId);
    }
    if (typeof next.gameStyleId === "string" && isGameSession(session)) {
      await this.design.applyGameStyleBrief(id, next.gameStyleId);
    }
    if (next.assetBuild && isAssetSession(session)) {
      await this.design.applyAssetBuildBrief(id, next.assetBuild);
    }
    if (
      isCanvasSession(session) &&
      session.status !== "running" &&
      (next.palette !== undefined ||
        next.designSystemId !== undefined ||
        next.designTune !== undefined)
    ) {
      await this.design.paintLive(id);
    }
    if (patch.queuePaused === false) await this.drainQueue(id);
    return this.get(id).then((row) => row ?? saved);
  }

  async previewStatus(sessionId: string): Promise<SessionPreviewStatus> {
    return this.sessionPreview.status(sessionId);
  }

  async previewTarget(sessionId: string, rawPort: number): Promise<PreviewTarget> {
    return this.sessionPreview.target(sessionId, rawPort);
  }

  async proxyWorkerPreview(
    sessionId: string,
    rawPort: string,
    req: {
      path: string;
      url: string;
      method: string;
      headers: Headers;
      arrayBuffer: () => Promise<ArrayBuffer>;
    },
  ): Promise<Response> {
    return this.sessionPreview.proxyWorker(sessionId, rawPort, req);
  }

  private async openDesignCanvasPreview(session: AgentSession): Promise<ToolResult> {
    const url = canvasFilesPreviewUrl(session.id);
    return {
      ok: true,
      output: `Design canvas is served over HTTP at ${url} so relative scripts (./vendor/three.module.js) resolve. The live canvas switches to this origin automatically when the page vendors ES modules. Do not run npx serve.`,
    };
  }

  private async runPlaywrightTool(
    session: AgentSession,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const design = isCanvasSession(session);
    const config = await this.store.loadConfig();
    const fromEnv = Number(process.env.PORT);
    const port =
      Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : config.advanced.bindPort || 7420;
    const origin = `http://127.0.0.1:${port}`;
    const fromArgs = typeof args.url === "string" ? args.url.trim() : "";
    const previewPath = session.preview?.port
      ? sanitizePreviewPath(session.preview.path)
      : undefined;
    const url =
      fromArgs ||
      (design
        ? `${origin}${canvasFilesPreviewUrl(session.id)}`
        : session.preview?.port
          ? `${origin}/api/sessions/${encodeURIComponent(session.id)}/preview-http/${session.preview.port}${previewPath}`
          : "");
    const canvas = design ? await this.design.readCanvas(session.id) : undefined;
    const turn = countPlaywrightCallsThisTurn(session.messages);
    const nextArgs =
      isAssetSession(session) && turn.calls >= 1 && !playwrightReportFailed(turn.lastReport)
        ? { ...args, screenshot: false }
        : args;
    const result = await runDesignPlaywright({
      html: canvas?.html,
      url,
      args: nextArgs,
      requireHtml: design,
      assetStats: isAssetSession(session),
      gameDrive: isGameSession(session),
      launch: (viewport) =>
        launchCdpCanvasBrowser({
          profileDir: hostChromeProfileDir(this.store.dataDir, `${session.id}-pw`),
          viewport,
        }),
    });
    const repeat = isAssetSession(session)
      ? playwrightRepeatNote(turn.lastReport, result.output)
      : undefined;
    if (!repeat) return result;
    return { ...result, output: `${result.output}\n${repeat}` };
  }

  private async killBackgroundProcesses(session: AgentSession): Promise<void> {
    const live = session.backgroundProcesses ?? [];
    for (const proc of live) {
      await this.executeTool(
        session.id,
        { name: "exec", args: { command: backgroundKillCommand(proc.pid) } },
        { ignoreAllowlist: true, fence: false },
      ).catch(() => undefined);
    }
    if (live.length) {
      await this.patch(session.id, { backgroundProcesses: undefined }).catch(() => undefined);
    }
  }

  private async openPreview(
    session: AgentSession,
    vm: VmInstance,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    return this.sessionPreview.open(session, vm, args);
  }

  private async ensureProxy(sessionId: string): Promise<{ port: number }> {
    const existing = this.proxies.get(sessionId);
    if (existing) return { port: existing.port };
    const config = await this.store.loadConfig();
    const session = await this.get(sessionId);
    const proxy = await startAllowlistProxy(
      forgeProviderAllowlist({ ...config, extraHosts: session?.allowHosts }),
      0,
      (attempt) => {
        void this.traces.write({
          t: now(),
          kind: "egress",
          level: attempt.allowed ? "info" : "warn",
          sessionId,
          name: attempt.allowed ? "allow" : "deny",
          detail: `${attempt.host}:${attempt.port}`,
          args: {
            host: attempt.host,
            port: attempt.port,
            ...(attempt.bytesSent != null ? { bytesSent: attempt.bytesSent } : {}),
          },
        });
      },
      "127.0.0.1",
    );
    this.proxies.set(sessionId, proxy);
    return { port: proxy.port };
  }

  private async applyToolGate(
    sessionId: string,
    name: string,
    decision: ToolGateDecision,
  ): Promise<ToolResult | undefined> {
    if (decision.kind === "allow") return undefined;
    if (decision.kind === "block") return this.blockTool(sessionId, name, decision.output);
    if (decision.kind === "reject") throw new Error(decision.message);
    return { ok: false, output: decision.output };
  }

  private async blockTool(sessionId: string, name: string, message: string): Promise<ToolResult> {
    await this.traces.write({
      t: now(),
      kind: "blocked",
      level: "warn",
      sessionId,
      name,
      ok: false,
      detail: message,
    });
    const updated = await this.store.mutateSession(sessionId, (current) => {
      current.needsHuman = message;
    });
    if (updated) {
      this.hub.broadcast({ type: "session.updated", session: updated });
      if (this.peerHandoffs.has(sessionId)) {
        await this.deliverPeerHandoff(sessionId, updated, {
          kind: "needs_you",
          detail: message,
        }).catch(() => undefined);
      } else if (updated.projectId) {
        await this.projects?.relayMemberNeedsHuman(sessionId, message).catch(() => undefined);
      }
    }
    return { ok: false, output: message };
  }

  private async resolveGitHeadBranch(
    session: AgentSession,
    args?: Record<string, unknown>,
  ): Promise<string | undefined> {
    try {
      const runtime = sessionRuntime(session);
      let guest;
      if (runtime === "host") guest = this.hostGuest(session);
      else if (session.vmId) {
        const vm = this.getMachine(session.vmId);
        guest = vm ? this.guests.forVm(vm) : undefined;
      }
      if (!guest) return undefined;
      const checkout = matchWorkspaceCheckout(session, {
        path: typeof args?.path === "string" ? args.path : undefined,
        url: typeof args?.url === "string" ? args.url : undefined,
      });
      const result = await guest.execute({
        name: "git_status",
        args: checkout?.dest ? { path: checkout.dest } : {},
      });
      if (!result.ok) return undefined;
      return parseGitStatusBranch(result.output);
    } catch {
      return undefined;
    }
  }

  private async leftoverAdherenceNudge(
    session: AgentSession,
    html?: string | null,
  ): Promise<string | undefined> {
    if (!html?.trim() || !isCanvasSession(session)) return undefined;
    try {
      const systems = await this.store.loadDesignSystems();
      const system = resolveDesignSystem(session.designSystemId, systems);
      const issues = enforceDesignAdherence(html, {
        kit: Boolean(system?.kit),
        palette: resolveDesignPalette(session.palette ?? system?.palette),
        tokenCss: system ? designTokenCssVars(applyDesignTune(system, session.designTune)) : "",
        tokens: system?.tokens,
      }).issues;
      return issues.length ? formatAdherenceNudge(issues) : undefined;
    } catch {
      return undefined;
    }
  }

  private async appendDesignAdherence(
    session: AgentSession,
    req: ToolRequest,
    result: ToolResult,
    opts?: { ignoreAllowlist?: boolean },
  ): Promise<ToolResult> {
    if (opts?.ignoreAllowlist || !result.ok) return result;
    if (!isCanvasSession(session)) return result;
    if (req.name !== "file_write" && req.name !== "apply_patch") return result;
    const path =
      req.name === "file_write" && typeof req.args.path === "string" ? req.args.path : "";
    const isCanvas =
      isDesignCanvasPath(path) ||
      (req.name === "apply_patch" &&
        typeof req.args.patch === "string" &&
        /index\.html/i.test(req.args.patch));
    if (!isCanvas) return result;
    try {
      const canvas = await this.design.readCanvas(session.id);
      if (!canvas.html?.trim()) return result;
      const systems = await this.store.loadDesignSystems();
      const system = resolveDesignSystem(session.designSystemId, systems);
      const enforced = enforceDesignAdherence(canvas.html, {
        kit: Boolean(system?.kit),
        palette: resolveDesignPalette(session.palette ?? system?.palette),
        tokenCss: system ? designTokenCssVars(applyDesignTune(system, session.designTune)) : "",
        tokens: system?.tokens,
      });
      if (enforced.patched && enforced.html !== canvas.html) {
        await this.workspace.writeWorkspace(session.id, "index.html", enforced.html);
      }
      if (enforced.issues.length) {
        this.canvasAdherence.set(session.id, formatAdherenceNudge(enforced.issues));
        const extra = formatAdherenceNudge(enforced.issues);
        return { ...result, output: result.output ? `${result.output}\n\n${extra}` : extra };
      }
      this.canvasAdherence.delete(session.id);
    } catch {
      /* preview still restyles */
    }
    return result;
  }

  private async appendLintFeedback(
    session: AgentSession,
    req: ToolRequest,
    result: ToolResult,
    opts?: { ignoreAllowlist?: boolean },
  ): Promise<ToolResult> {
    if (opts?.ignoreAllowlist) return result;
    let next = result;
    if (result.ok && (req.name === "file_write" || req.name === "apply_patch")) {
      const lint = await runWorkspaceNpmScript(this.workspaceRoot(session), "lint");
      if (lint.ran && !lint.ok) {
        const extra = lintOutputLooksLikeMissingDeps(lint.output)
          ? "Lint skipped: workspace dependencies are not installed (`npm install`). The edit was kept."
          : `Lint (not reverted):\n${lint.output}`;
        next = { ...next, output: next.output ? `${next.output}\n\n${extra}` : extra };
      }
    }
    return this.appendPostToolUseHooks(session, req, next, opts);
  }

  private async runPreToolUseHooks(
    session: AgentSession,
    name: string,
  ): Promise<ToolResult | undefined> {
    const hooks = hooksForTool(
      await loadRepoHooks(this.workspaceRoot(session)),
      "PreToolUse",
      name,
    );
    for (const hook of hooks) {
      const ran = await runRepoHook(this.workspaceRoot(session), hook);
      if (ran.ran && !ran.ok) {
        return {
          ok: false,
          output: `Harness blocked ${name}: PreToolUse hook failed.\n${ran.output}`,
        };
      }
    }
    return undefined;
  }

  private async appendPostToolUseHooks(
    session: AgentSession,
    req: ToolRequest,
    result: ToolResult,
    opts?: { ignoreAllowlist?: boolean },
  ): Promise<ToolResult> {
    if (opts?.ignoreAllowlist || !result.ok) return result;
    const hooks = hooksForTool(
      await loadRepoHooks(this.workspaceRoot(session)),
      "PostToolUse",
      req.name,
    );
    let output = result.output;
    for (const hook of hooks) {
      const ran = await runRepoHook(this.workspaceRoot(session), hook);
      if (!ran.ran) continue;
      const extra = ran.ok
        ? `PostToolUse:\n${ran.output}`
        : `PostToolUse (not reverted):\n${ran.output}`;
      output = output ? `${output}\n\n${extra}` : extra;
    }
    return output === result.output ? result : { ...result, output };
  }

  private async runStopHooks(session: AgentSession): Promise<void> {
    const hooks = (await loadRepoHooks(this.workspaceRoot(session))).Stop;
    for (const hook of hooks) {
      const ran = await runRepoHook(this.workspaceRoot(session), hook);
      if (ran.ran && !ran.ok) {
        await this.traces.write({
          t: now(),
          kind: "blocked",
          level: "warn",
          sessionId: session.id,
          name: "Stop",
          ok: false,
          detail: ran.output.slice(0, 2000),
        });
      }
    }
  }

  private async rememberBackgroundProcess(
    sessionId: string,
    req: ToolRequest,
    result: ToolResult,
  ): Promise<void> {
    const pid = parseStartProcessPid(result.output);
    const command =
      typeof req.args.command === "string" ? req.args.command.trim().slice(0, 200) : "process";
    if (!pid) return;
    await this.store.mutateSession(sessionId, (current) => {
      current.backgroundProcesses = [
        ...(current.backgroundProcesses ?? []).filter((row) => row.pid !== pid),
        { pid, command, startedAt: now() },
      ].slice(-8);
    });
  }

  private async pollBackgroundProcesses(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    const live = session?.backgroundProcesses ?? [];
    if (!session || !live.length) return;
    const still: typeof live = [];
    for (const proc of live) {
      let output = "";
      try {
        const check = await this.executeTool(
          sessionId,
          { name: "exec", args: { command: backgroundPollCommand(proc.pid) } },
          { ignoreAllowlist: true, fence: false },
        );
        output = check.output;
      } catch {
        still.push(proc);
        continue;
      }
      const parsed = parseBackgroundPoll(output);
      if (parsed.running) {
        still.push(proc);
        continue;
      }
      const tail = parsed.tail.slice(0, 2000);
      await this.appendMessage(sessionId, {
        id: randomUUID(),
        role: "system",
        content: tail
          ? `${PROCESS_DONE_NUDGE}\n\n${proc.command} (pid ${proc.pid})\n${tail}`
          : `${PROCESS_DONE_NUDGE}\n\n${proc.command} (pid ${proc.pid})`,
        hidden: true,
        createdAt: now(),
      });
    }
    await this.patch(sessionId, {
      backgroundProcesses: still.length ? still : undefined,
    });
  }

  private async applyReviewVerdict(sessionId: string, session: AgentSession): Promise<void> {
    if (!isReviewSession(session) || session.needsHuman) return;
    if (!shouldApplyReviewVerdict(session.messages)) return;
    const verdict = parseReviewSessionVerdict(session.messages);
    const uninspectedPass = reviewPassNeedsInspect(session.messages);
    if (isCleanPass(verdict) && !uninspectedPass) return;
    const message = uninspectedPass ? REVIEW_PASS_NEEDS_INSPECT : formatVerdictFailure(verdict);
    await this.traces.write({
      t: now(),
      kind: "blocked",
      level: "warn",
      sessionId,
      name: verdict ? "review" : "verdict",
      ok: false,
      detail: message,
    });
    await this.store.mutateSession(sessionId, (current) => {
      current.needsHuman = message;
    });
    const updated = await this.get(sessionId);
    if (updated && this.peerHandoffs.has(sessionId)) {
      await this.deliverPeerHandoff(sessionId, updated, {
        kind: "needs_you",
        detail: message,
      }).catch(() => undefined);
    } else if (session.projectId) {
      await this.projects?.relayMemberNeedsHuman(sessionId, message).catch(() => undefined);
    }
  }

  private async applyGenerationQuality(sessionId: string, session: AgentSession): Promise<void> {
    if (!isCanvasSession(session) || session.needsHuman) return;
    const html = (await this.design.readCanvas(sessionId).catch(() => ({ html: null }))).html;
    const kind = isGameSession(session) ? "game" : isAssetSession(session) ? "asset" : "design";
    const message = generationQualityNeedsHuman({
      kind,
      html,
      assetSlugs: (session.assetRefs ?? []).map((row) => row.slug),
    });
    if (!message) return;
    await this.traces.write({
      t: now(),
      kind: "blocked",
      level: "warn",
      sessionId,
      name: "generation",
      ok: false,
      detail: message,
    });
    await this.store.mutateSession(sessionId, (current) => {
      current.needsHuman = message;
    });
    const updated = await this.get(sessionId);
    if (updated && this.peerHandoffs.has(sessionId)) {
      await this.deliverPeerHandoff(sessionId, updated, {
        kind: "needs_you",
        detail: message,
      }).catch(() => undefined);
    } else if (session.projectId) {
      await this.projects?.relayMemberNeedsHuman(sessionId, message).catch(() => undefined);
    }
  }

  private async applyDesignAdherence(sessionId: string, session: AgentSession): Promise<void> {
    if (!isDesignSession(session) || session.needsHuman) return;
    const html = (await this.design.readCanvas(sessionId).catch(() => ({ html: null }))).html;
    if (!(await this.leftoverAdherenceNudge(session, html))) return;
    const message = DESIGN_ADHERENCE_NEEDS_HUMAN;
    await this.traces.write({
      t: now(),
      kind: "blocked",
      level: "warn",
      sessionId,
      name: "adherence",
      ok: false,
      detail: message,
    });
    await this.store.mutateSession(sessionId, (current) => {
      current.needsHuman = message;
    });
    const updated = await this.get(sessionId);
    if (updated && this.peerHandoffs.has(sessionId)) {
      await this.deliverPeerHandoff(sessionId, updated, {
        kind: "needs_you",
        detail: message,
      }).catch(() => undefined);
    } else if (session.projectId) {
      await this.projects?.relayMemberNeedsHuman(sessionId, message).catch(() => undefined);
    }
  }

  private async applyStudioFollowUp(sessionId: string, session: AgentSession): Promise<void> {
    if (!isCanvasSession(session) || session.needsHuman) return;
    const html = (await this.design.readCanvas(sessionId).catch(() => ({ html: null }))).html;
    const userText = turnUserPrompt(session.messages);
    const turnStartHtml = this.studioTurnStart.get(sessionId);
    const message = isGameSession(session)
      ? (gameFollowUpNeedsHuman(userText, html) ??
        gameIterateUnchangedNeedsHuman({ userText, html, turnStartHtml }))
      : isAssetSession(session)
        ? assetIterateUnchangedNeedsHuman({ userText, html, turnStartHtml })
        : designIterateUnchangedNeedsHuman({ userText, html, turnStartHtml });
    if (!message) return;
    await this.traces.write({
      t: now(),
      kind: "blocked",
      level: "warn",
      sessionId,
      name: "follow_up",
      ok: false,
      detail: message,
    });
    await this.store.mutateSession(sessionId, (current) => {
      current.needsHuman = message;
    });
    const updated = await this.get(sessionId);
    if (updated && this.peerHandoffs.has(sessionId)) {
      await this.deliverPeerHandoff(sessionId, updated, {
        kind: "needs_you",
        detail: message,
      }).catch(() => undefined);
    } else if (session.projectId) {
      await this.projects?.relayMemberNeedsHuman(sessionId, message).catch(() => undefined);
    }
  }

  private async applyCodingVerify(sessionId: string, session: AgentSession): Promise<void> {
    if (!isCodingLoopSession(session) || session.needsHuman) return;
    const message = codingTurnNeedsHuman(session.messages);
    if (!message) return;
    await this.traces.write({
      t: now(),
      kind: "blocked",
      level: "warn",
      sessionId,
      name: "verify",
      ok: false,
      detail: message,
    });
    await this.store.mutateSession(sessionId, (current) => {
      current.needsHuman = message;
    });
    const updated = await this.get(sessionId);
    if (updated && this.peerHandoffs.has(sessionId)) {
      await this.deliverPeerHandoff(sessionId, updated, {
        kind: "needs_you",
        detail: message,
      }).catch(() => undefined);
    } else if (session.projectId) {
      await this.projects?.relayMemberNeedsHuman(sessionId, message).catch(() => undefined);
    }
  }

  private policyFor(session: AgentSession, config: LocusConfig): ApprovalPolicy {
    const tier = sessionAutonomy(session.autonomy, config.advanced.autonomy);
    const policy = mergeApprovalPolicy(
      approvalPolicyForTier(tier),
      parseApprovalPolicy(config.advanced.approvalPolicy),
    );
    const autoAllow = [
      ...(policy.autoAllow ?? []),
      ...(session.autoAllow ?? []),
      ...pluginReadToolNames(config.integrationPlugins),
    ];
    if (session.automationId && session.allowedMcpTools?.length) {
      autoAllow.push(...session.allowedMcpTools);
    }
    const alwaysAsk = [...(policy.alwaysAsk ?? [])];
    if (sessionRuntime(session) === "host" && tier === "guided") {
      for (const name of HOST_GUIDED_ALWAYS_ASK) {
        if (!alwaysAsk.includes(name) && !autoAllow.includes(name)) alwaysAsk.push(name);
      }
    }
    return {
      ...policy,
      autoAllow,
      alwaysAsk: alwaysAskMinusSticky(alwaysAsk, session.autoAllow),
    };
  }

  private closeProxy(sessionId: string): void {
    const proxy = this.proxies.get(sessionId);
    if (!proxy) return;
    this.proxies.delete(sessionId);
    proxy.close();
  }

  private closeIdeTunnel(sessionId: string): void {
    const tunnel = this.ideTunnels.get(sessionId);
    if (!tunnel) return;
    this.ideTunnels.delete(sessionId);
    tunnel.close();
  }

  private async hydrateScreenshots(
    sessionId: string,
    messages: ChatMessage[],
    vision: VisionMode,
  ): Promise<ChatMessage[]> {
    let next = messages;
    let copied = false;
    const ensure = () => {
      if (!copied) {
        next = messages.slice();
        copied = true;
      }
    };
    for (let i = 0; i < next.length; i += 1) {
      const message = next[i]!;
      if (message.role !== "user" || message.screenshotBase64 || !message.attachments?.length)
        continue;
      const stored = await storedImageBase64(this.store.dataDir, sessionId, message.attachments);
      if (!stored) continue;
      ensure();
      next[i] = {
        ...message,
        screenshotBase64: stored.base64,
        screenshotMime: stored.mime,
      };
    }
    for (let i = 0; i < next.length; i += 1) {
      const message = next[i]!;
      if (!message.images?.length) continue;
      let changed = false;
      const images: ChatImage[] = [];
      for (const img of message.images) {
        if (img.base64 || !img.name) {
          images.push(img);
          continue;
        }
        try {
          const dest = screenshotDest(this.store.dataDir, sessionId, img.name);
          const buf = await readFile(dest);
          changed = true;
          images.push({ ...img, base64: buf.toString("base64") });
        } catch {
          images.push(img);
        }
      }
      if (!changed) continue;
      ensure();
      const first = images.find((img) => img.base64);
      next[i] = {
        ...message,
        images,
        screenshotBase64: message.screenshotBase64 ?? first?.base64,
        screenshotMime: message.screenshotMime ?? first?.mime,
      };
    }
    if (vision === "off") return next;
    const maxShots = 8;
    const indexes: number[] = [];
    for (let i = next.length - 1; i >= 0 && indexes.length < maxShots; i -= 1) {
      if (next[i]?.screenshotBase64 || next[i]?.screenshotName) indexes.push(i);
    }
    if (!indexes.length) return next;
    ensure();
    for (const last of indexes) {
      const message = next[last]!;
      if (message.screenshotBase64 || !message.screenshotName) continue;
      try {
        const dest = screenshotDest(this.store.dataDir, sessionId, message.screenshotName);
        const buf = await readFile(dest);
        next[last] = { ...message, screenshotBase64: buf.toString("base64") };
      } catch {
        /* skip missing shot */
      }
    }
    return next;
  }

  private async turnRecoveryFooter(sessionId: string): Promise<string> {
    const session = await this.get(sessionId);
    const root = session ? this.workspaceRoot(session) : undefined;
    let stat = "";
    if (root) {
      try {
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const exec = promisify(execFile);
        const { stdout } = await exec("git", ["-C", root, "diff", "--stat", "HEAD"], {
          timeout: 4000,
          windowsHide: true,
        });
        stat = stdout.trim().slice(0, 1500);
      } catch {
        /* ignore */
      }
    }
    return `\n\n${PROVIDER_TURN_RECOVERY}${stat ? `\nCurrent diff:\n${stat}` : ""}`;
  }

  private async advancePlan(sessionId: string, toolName?: string): Promise<void> {
    const session = await this.get(sessionId);
    if (!session?.plan?.items.some((item) => item.status === "running")) return;
    await this.patch(sessionId, { plan: advancePlanOnTool(session.plan, toolName) });
  }

  private async resetRunningPlanSteps(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    if (!session?.plan?.items.some((item) => item.status === "running")) return;
    await this.patch(sessionId, {
      plan: {
        ...session.plan,
        items: session.plan.items.map((item) =>
          item.status === "running" ? { ...item, status: "pending" as const } : item,
        ),
      },
    });
  }

  private async patch(
    id: string,
    patch: Partial<
      Pick<
        AgentSession,
        | "status"
        | "vmId"
        | "error"
        | "title"
        | "pinned"
        | "archived"
        | "providerId"
        | "model"
        | "instructions"
        | "allowedTools"
        | "checkpoint"
        | "checkpoints"
        | "control"
        | "network"
        | "vision"
        | "webSearch"
        | "liveChrome"
        | "playbook"
        | "palette"
        | "designSystemId"
        | "assetStyleId"
        | "gameStyleId"
        | "playToken"
        | "assetBuild"
        | "assetPack"
        | "assetRefs"
        | "assetAppliedBuild"
        | "plan"
        | "queue"
        | "queuePaused"
        | "compare"
        | "designPins"
        | "agentCanvases"
        | "designVariants"
        | "activeVariantId"
        | "designTune"
        | "role"
        | "guestEnv"
        | "maxUsd"
        | "maxMs"
        | "computeMs"
        | "computeStartedAt"
        | "quotedUsdPerHour"
        | "remoteGuestId"
        | "instanceSize"
        | "autonomy"
        | "defaultSubagent"
        | "scratchpad"
        | "taskList"
        | "cursorCloud"
        | "cursorCli"
        | "claudeCode"
        | "codexCli"
        | "kiroCli"
        | "pull"
        | "inspectedFiles"
        | "subscriptions"
        | "lastCompact"
        | "backgroundProcesses"
        | "autoAllow"
        | "needsHuman"
      >
    >,
  ): Promise<AgentSession> {
    const session = await this.store.mutateSession(id, (current) => {
      Object.assign(current, patch);
    });
    if (!session) throw new Error(`Session not found: ${id}`);
    this.hub.broadcast({ type: "session.updated", session });
    return session;
  }

  private async replace(session: AgentSession): Promise<void> {
    await this.store.replaceSession(session);
  }

  private async require(id: string): Promise<AgentSession> {
    const session = await this.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    return session;
  }
}

export { mockAssistantReply, EMPTY_MODEL_REPLY } from "./sessionMockLlm.js";
export { cursorCliToolCallOk } from "./cursorCliToolStatus.js";
export { bootNote, cloneStartNote, isStartPromptResumeTail } from "./sessionBootNotes.js";
export {
  applyRequestedDefaultSubagent,
  llmResponseDetail,
  parkedStatus,
  reviewTurnEndArgs,
  sessionRulesChars,
  withWorkspaceReadiness,
} from "./sessionTurnHelpers.js";
export { EMPTY_CANVAS_NUDGE, DESIGN_MUTATE_NUDGE, INCOMPLETE_CANVAS_NUDGE };
export { EMPTY_CANVAS_NOTE };

async function mkdirShare(path: string): Promise<void> {
  await mkdir(path, { recursive: true }).catch(() => undefined);
}
