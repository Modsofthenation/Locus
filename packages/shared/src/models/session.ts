import type { SessionCompare } from "./compare.js";
import type { SessionPreview } from "./preview.js";
import type { DesignPalette } from "./designPalette.js";
import type { DesignComment } from "./designComment.js";
import type { DesignTune } from "./designTune.js";
import type { AssetBuild } from "./assetBuild.js";
import type { AssetPackSummary, SessionAssetRef } from "./assetPack.js";
import type { RepoCheckout } from "./git.js";
import { isPullCheckRollup, isPullState, type PullCheckRollup, type PullState } from "./repo.js";
import type { SessionPlan } from "./plan.js";
import type { TaskItem } from "./workingState.js";
import type { PromptQueueItem } from "./queue.js";
import type { AgentRole } from "./roles.js";
import type { AutonomyTier } from "./autonomy.js";
import type { AgentPlacement } from "./placement.js";
import type { SessionSlack } from "./slack.js";
import type { SessionSubscription } from "./subscribe.js";
import type { AgentRuntime, GuestOs, HardwareOverride, NetworkJail, VmHardware } from "./vm.js";
import { sessionRuntime } from "./vm.js";
import { overlayFromTool, type BrowserArtifactKind, type ToolOverlay } from "./tools.js";
import { isHiddenChatMessage } from "../selfCorrect.js";
import type { ContextBreakdown } from "../contextWindow.js";
import type { SubagentKind } from "./subagentKind.js";
import type { SessionPersona } from "./persona.js";
import type { CodexReasoningEffort } from "./provider.js";

export interface CursorCloudState {
  agentId: string;
  runId?: string;
  url?: string;
}

export interface CursorCliState {
  sessionId: string;
  /** Frozen `--exclude-tools` for this CLI thread. Empty means no exclude flag. */
  excludeTools?: string;
}

export function parseCursorCloudState(raw: unknown): CursorCloudState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const agentId = typeof value.agentId === "string" ? value.agentId.trim() : "";
  if (!agentId) return undefined;
  return {
    agentId,
    runId: typeof value.runId === "string" && value.runId.trim() ? value.runId.trim() : undefined,
    url: typeof value.url === "string" && value.url.trim() ? value.url.trim() : undefined,
  };
}

export function parseCursorCliState(raw: unknown): CursorCliState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const sessionId = typeof value.sessionId === "string" ? value.sessionId.trim() : "";
  if (!sessionId) return undefined;
  return {
    sessionId,
    ...(typeof value.excludeTools === "string" ? { excludeTools: value.excludeTools } : {}),
  };
}

export type SessionStatus = "draft" | "provisioning" | "idle" | "running" | "error" | "stopped";

/** Chat notes posted while Docker/QEMU is coming up. Keep in sync with `bootNote`. */
export const DOCKER_BOOT_NOTE = "Starting the container.";
export const DOCKER_READY_NOTE = "Container is ready.";
export const VM_BOOT_NOTE = "Booting the guest and waiting for SSH.";
export const VM_READY_NOTE = "Guest is ready.";
export const VM_INSTALL_NOTE = "Installing the guest OS onto disk. First boot can take a while.";

export function isSessionWorking(status?: string): boolean {
  return status === "running" || status === "provisioning";
}

export function isGuestStartNote(content: string): boolean {
  const text = content.trim();
  return (
    text === DOCKER_BOOT_NOTE ||
    text === VM_BOOT_NOTE ||
    text === VM_INSTALL_NOTE ||
    text.endsWith(` ${DOCKER_BOOT_NOTE}`)
  );
}

export function isGuestReadyNote(content: string): boolean {
  const text = content.trim();
  return text === DOCKER_READY_NOTE || text === VM_READY_NOTE;
}

/** Consecutive boot/ready system notes; keep the latest in each run. */
export function supersededGuestLifecycleIds(
  messages: Array<{ id: string; role: string; content: string }>,
): Set<string> {
  const hide = new Set<string>();
  let run: string[] = [];
  const flush = () => {
    if (run.length > 1) {
      for (const id of run.slice(0, -1)) hide.add(id);
    }
    run = [];
  };
  for (const message of messages) {
    if (
      message.role === "system" &&
      (isGuestStartNote(message.content) || isGuestReadyNote(message.content))
    ) {
      run.push(message.id);
    } else {
      flush();
    }
  }
  flush();
  return hide;
}

/** User already prompted; the thread is still on a guest-start note with no real reply. */
export function isWaitingOnGuestStart(
  messages: Array<{ role: string; content: string; toolCalls?: unknown[] }>,
): boolean {
  let lastUser = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === "user") lastUser = i;
  }
  if (lastUser < 0) return false;
  const after = messages.slice(lastUser + 1);
  for (const message of after) {
    if (message.role === "tool" || (message.toolCalls?.length ?? 0) > 0) return false;
    if (message.role === "system" && isGuestReadyNote(message.content)) return false;
    if (
      message.role === "assistant" &&
      message.content.trim() &&
      !/still starting|not ready yet|did not become ready|container is not ready|guest is not ready/i.test(
        message.content,
      )
    ) {
      return false;
    }
  }
  return after.some((message) => message.role === "system" && isGuestStartNote(message.content));
}

export const SESSION_KINDS = [
  "agent",
  "design",
  "game",
  "assets",
  "review",
  "setup",
  "ide",
  "board",
  "project",
] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export function isSessionKind(value: unknown): value is SessionKind {
  return (
    value === "agent" ||
    value === "design" ||
    value === "game" ||
    value === "assets" ||
    value === "review" ||
    value === "setup" ||
    value === "ide" ||
    value === "board" ||
    value === "project"
  );
}

export function sessionKind(session: { kind?: SessionKind }): SessionKind {
  if (session.kind === "design") return "design";
  if (session.kind === "game") return "game";
  if (session.kind === "assets") return "assets";
  if (session.kind === "review") return "review";
  if (session.kind === "setup") return "setup";
  if (session.kind === "ide") return "ide";
  if (session.kind === "board") return "board";
  if (session.kind === "project") return "project";
  return "agent";
}

export function isDesignSession(session: { kind?: SessionKind }): boolean {
  return sessionKind(session) === "design";
}

export function isGameSession(session: { kind?: SessionKind }): boolean {
  return sessionKind(session) === "game";
}

export function isAssetSession(session: { kind?: SessionKind }): boolean {
  return sessionKind(session) === "assets";
}

/** Design prototypes, Games, and Assets share the live `/workspace/index.html` canvas. */
export function isCanvasSession(session: { kind?: SessionKind }): boolean {
  return isDesignSession(session) || isGameSession(session) || isAssetSession(session);
}

export function isReviewSession(session: { kind?: SessionKind }): boolean {
  return sessionKind(session) === "review";
}

export function isSetupSession(session: { kind?: SessionKind }): boolean {
  return sessionKind(session) === "setup";
}

export function isIdeSession(session: { kind?: SessionKind }): boolean {
  return sessionKind(session) === "ide";
}

export function isBoardSession(session: { kind?: SessionKind }): boolean {
  return sessionKind(session) === "board";
}

export function isProjectSession(session: { kind?: SessionKind }): boolean {
  return sessionKind(session) === "project";
}

/** Coding / ops / IDE / setup turns — not canvas, review, board, or project. */
export function isCodingLoopSession(session: { kind?: SessionKind }): boolean {
  return (
    !isCanvasSession(session) &&
    !isReviewSession(session) &&
    !isBoardSession(session) &&
    !isProjectSession(session)
  );
}

export const VISION_MODES = ["off", "latest"] as const;
export type VisionMode = (typeof VISION_MODES)[number];

export function isVisionMode(value: unknown): value is VisionMode {
  return value === "off" || value === "latest";
}

export function sessionVision(session: {
  vision?: VisionMode;
  runtime?: AgentRuntime;
}): VisionMode {
  if (sessionRuntime(session) === "host") return "off";
  if (isVisionMode(session.vision)) return session.vision;
  return sessionRuntime(session) === "docker" ? "off" : "latest";
}

export function formatVision(mode: VisionMode, frames = 1): string {
  if (mode === "off") return "Off";
  return frames > 1 ? `Last ${frames} screenshots` : "Latest screenshot";
}

export function sessionWebSearch(session: { webSearch?: boolean }): boolean {
  return session.webSearch === true;
}

export function formatWebSearch(on: boolean): string {
  return on ? "On" : "Off";
}

export type MessageRole = "user" | "assistant" | "system" | "tool";

export type ToolApproval = "needed" | "approved" | "denied";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  error?: string;
  approval?: ToolApproval;
  startedAt: string;
  finishedAt?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export interface UsageRates {
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
}

/** Raw attachment data sent by clients before the server stores it. */
export interface IncomingAttachmentData {
  name: string;
  mime?: string;
  contentBase64: string;
}

export interface ChatAttachment {
  name: string;
  mime: string;
  bytes: number;
  storedName: string;
}

export interface DesignVariant {
  id: string;
  name: string;
}

/** Teammate attribution for Swarm team-thread multi-speaker turns. */
export interface TeamSpeaker {
  sessionId: string;
  displayName: string;
  avatarId?: string;
  avatarPose?: string;
  avatarAccessory?: string;
  avatarAccent?: string;
}

/** Structured team-thread events (not a full mirror of member tool traces). */
export const TEAM_EVENT_KINDS = [
  "spawn",
  "join",
  "handoff",
  "blocked",
  "done",
  "needs_you",
  "address",
] as const;
export type TeamEventKind = (typeof TEAM_EVENT_KINDS)[number];

export function isTeamEventKind(value: unknown): value is TeamEventKind {
  return typeof value === "string" && (TEAM_EVENT_KINDS as readonly string[]).includes(value);
}

export type ChatImage = {
  mime: string;
  name?: string;
  base64?: string;
};

export function chatMessageImages(
  message: Pick<ChatMessage, "screenshotBase64" | "screenshotMime" | "screenshotName" | "images">,
): ChatImage[] {
  const out: ChatImage[] = [];
  const seen = new Set<string>();
  const push = (img: ChatImage) => {
    const key = img.base64 || img.name || "";
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(img);
  };
  if (message.screenshotBase64) {
    push({
      base64: message.screenshotBase64,
      mime: message.screenshotMime ?? "image/png",
      name: message.screenshotName,
    });
  }
  for (const img of message.images ?? []) {
    if (img?.base64 || img?.name) push({ ...img, mime: img.mime || "image/png" });
  }
  return out.slice(0, 8);
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  screenshotBase64?: string;
  screenshotMime?: string;
  screenshotName?: string;
  /** Extra images on this turn (linked asset previews). screenshotBase64 remains the first. */
  images?: ChatImage[];
  recordingName?: string;
  artifactName?: string;
  artifactKind?: BrowserArtifactKind;
  attachments?: ChatAttachment[];
  usage?: TokenUsage;
  /** Injected into a running turn instead of queued as a fresh turn. */
  steer?: boolean;
  /** Keep in the model transcript, but do not render in the operator chat. */
  hidden?: boolean;
  /** Operator-visible compact boundary. Filtered out of the model prompt. */
  compact?: CompactNotice;
  /** Model reasoning for the operator chat. Not sent back to the model. */
  thinking?: string;
  /** When set, render as this teammate in Swarm team threads. */
  speaker?: TeamSpeaker;
  /** Structured team handoff / notable update in the coordinator transcript. */
  teamEvent?: TeamEventKind;
  createdAt: string;
}

export const SESSION_SURFACES = ["developer", "swarm"] as const;
export type SessionSurface = (typeof SESSION_SURFACES)[number];

export function isSessionSurface(value: unknown): value is SessionSurface {
  return typeof value === "string" && (SESSION_SURFACES as readonly string[]).includes(value);
}

/** Missing surface → developer (legacy sessions stay in Developer). */
export function parseSessionSurface(raw: unknown): SessionSurface {
  return raw === "swarm" ? "swarm" : "developer";
}

/** Map product mode to the surface stamped on newly created sessions. */
export function surfaceForProductMode(mode: "developer" | "swarm"): SessionSurface {
  return mode === "swarm" ? "swarm" : "developer";
}

/** True when a session/project belongs in the active product mode list. */
export function sessionMatchesSurface(
  row: { surface?: SessionSurface | null },
  mode: "developer" | "swarm",
): boolean {
  return parseSessionSurface(row.surface) === mode;
}

export type CompactNotice = {
  dropped: number;
  beforeTokens?: number;
  afterTokens?: number;
  source?: "llm" | "heuristic";
};

export function isCompactChatMessage(message: { compact?: CompactNotice }): boolean {
  return Boolean(message.compact);
}

export function formatCompactNotice(notice: CompactNotice): string {
  const tokens =
    notice.beforeTokens != null && notice.afterTokens != null
      ? ` · ${notice.beforeTokens} → ${notice.afterTokens} tokens`
      : "";
  const source =
    notice.source === "llm"
      ? " (model summary)"
      : notice.source === "heuristic"
        ? " (heuristic)"
        : "";
  const n = notice.dropped;
  return `Compacted ${n} message${n === 1 ? "" : "s"}${tokens}${source}`;
}

export interface BackgroundProcess {
  pid: number;
  command: string;
  startedAt: string;
}

export function parseStartProcessPid(output: string): number | undefined {
  const match = output.trim().match(/^(\d+)\s*$/m) ?? output.trim().match(/\b(\d+)\s*$/);
  if (!match?.[1]) return undefined;
  const pid = Number(match[1]);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

export function backgroundPollCommand(pid: number): string {
  return `if kill -0 ${pid} 2>/dev/null; then echo LOCUS_BG_RUNNING; else echo LOCUS_BG_EXITED; tail -c 4000 /tmp/locus-proc.${pid}.log 2>/dev/null; fi`;
}

/** Stop a start_process pid. Never pkill -f — only this numeric pid. */
export function backgroundKillCommand(pid: number): string {
  const n = Math.floor(pid);
  if (!Number.isInteger(n) || n <= 1) return "echo LOCUS_BG_KILLED";
  return `kill ${n} 2>/dev/null; sleep 0.15; kill -0 ${n} 2>/dev/null && kill -9 ${n} 2>/dev/null; echo LOCUS_BG_KILLED`;
}

export function parseBackgroundPoll(output: string): { running: boolean; tail: string } {
  const text = output.trim();
  if (/\bLOCUS_BG_EXITED\b/.test(text)) {
    const tail = text.replace(/^[\s\S]*?\bLOCUS_BG_EXITED\s*/, "").trim();
    return { running: false, tail };
  }
  // Missing marker (refused exec, empty output) keeps the pid; do not treat as exit.
  return { running: true, tail: "" };
}

export interface SessionCheckpoint {
  id: string;
  messageCount: number;
  diskPath?: string;
  createdAt: string;
  gitRef?: string;
  scratchpad?: string;
  taskList?: TaskItem[];
  plan?: SessionPlan;
}

export type SubagentLiveStatus = "running" | "done" | "error";

export interface SubagentLive {
  id: string;
  task: string;
  status: SubagentLiveStatus;
  lastLine?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Parent spawn_agent tool call, when this row was created from the loop. */
  toolCallId?: string;
  /** explore | implement | review. Missing means the spawn-time default. */
  kind?: SubagentKind;
  /** Operator transcript. Not fed back to the parent model. */
  messages?: ChatMessage[];
}

const SPAWN_AGENT_NAME = "spawn_agent";

export function matchSubagent(
  agents: SubagentLive[] | undefined,
  call: { id: string; name: string; arguments?: Record<string, unknown> },
): SubagentLive | undefined {
  if (!agents?.length || call.name !== SPAWN_AGENT_NAME) return undefined;
  const byCall = agents.find((row) => row.toolCallId === call.id || row.id === call.id);
  if (byCall) return byCall;
  const task = typeof call.arguments?.task === "string" ? call.arguments.task.trim() : "";
  if (!task) return undefined;
  const matches = agents.filter((row) => row.task === task);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Attach a nested view to the live row even when the card was keyed by toolCallId. */
export function findLiveSubagent(
  agents: SubagentLive[] | undefined,
  open: Pick<SubagentLive, "id" | "toolCallId">,
): SubagentLive | undefined {
  if (!agents?.length) return undefined;
  return agents.find(
    (row) =>
      row.id === open.id ||
      (open.toolCallId != null &&
        (row.toolCallId === open.toolCallId || row.id === open.toolCallId)) ||
      row.toolCallId === open.id,
  );
}

export function keepSubagentsForMessages(
  agents: SubagentLive[] | undefined,
  messages: ChatMessage[],
): SubagentLive[] | undefined {
  if (!agents?.length) return undefined;
  const callIds = new Set<string>();
  const tasks = new Set<string>();
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) {
      if (call.name !== SPAWN_AGENT_NAME) continue;
      callIds.add(call.id);
      const task = typeof call.arguments.task === "string" ? call.arguments.task.trim() : "";
      if (task) tasks.add(task);
    }
  }
  const kept = agents.filter((row) =>
    row.toolCallId ? callIds.has(row.toolCallId) : tasks.has(row.task),
  );
  return kept.length ? kept : undefined;
}

export function subagentViewMessages(agent: SubagentLive): ChatMessage[] {
  if (agent.messages?.length) return agent.messages.filter((row) => !row.hidden);
  const createdAt = "1970-01-01T00:00:00.000Z";
  const rows: ChatMessage[] = [
    { id: `${agent.id}-task`, role: "user", content: agent.task, createdAt },
  ];
  if (agent.lastLine?.trim()) {
    rows.push({
      id: `${agent.id}-summary`,
      role: "assistant",
      content: agent.lastLine,
      createdAt,
    });
  }
  return rows;
}

export function subagentStatusLabel(status: SubagentLiveStatus): string {
  if (status === "running") return "Running";
  if (status === "error") return "Failed";
  return "Done";
}

export type SessionControl = "agent" | "human";

export interface FileUndoEntry {
  path: string;
  previous: string;
}

export interface SessionPull {
  number: number;
  url: string;
  title: string;
  state?: PullState;
  headRef?: string;
  baseRef?: string;
  checkState?: PullCheckRollup;
}

export function parseGithubPullUrl(url: string): SessionPull | undefined {
  const match = url
    .trim()
    .match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/pull\/(\d+)(?:\/.*)?$/i);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const number = Number(match[3]);
  if (!Number.isInteger(number) || number <= 0) return undefined;
  const repo = match[2].replace(/\.git$/i, "");
  return {
    number,
    url: `https://github.com/${match[1]}/${repo}/pull/${number}`,
    title: `${match[1]}/${repo}#${number}`,
  };
}

export function parseSessionPull(raw: unknown): SessionPull | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const number = typeof value.number === "number" ? value.number : Number(value.number);
  if (!Number.isInteger(number) || number <= 0) return undefined;
  const url = typeof value.url === "string" && value.url.trim() ? value.url.trim() : "";
  if (!url) return undefined;
  const title =
    typeof value.title === "string" && value.title.trim() ? value.title.trim() : `#${number}`;
  return {
    number,
    url,
    title,
    state: isPullState(value.state) ? value.state : undefined,
    headRef:
      typeof value.headRef === "string" && value.headRef.trim() ? value.headRef.trim() : undefined,
    baseRef:
      typeof value.baseRef === "string" && value.baseRef.trim() ? value.baseRef.trim() : undefined,
    checkState: isPullCheckRollup(value.checkState) ? value.checkState : undefined,
  };
}

export interface AgentSession {
  id: string;
  title: string;
  os: GuestOs;
  templateId: string;
  kind?: SessionKind;
  runtime?: AgentRuntime;
  /** Where the guest runs. Missing means this machine. */
  placement?: AgentPlacement;
  /** Settings → Workers id when placement is worker. */
  backendId?: string;
  dockerImage?: string;
  /** Absolute host folder mapped to `/workspace` for host agents. */
  hostDir?: string;
  vmId?: string;
  providerId: string;
  model: string;
  /** Codex CLI reasoning effort override; undefined uses the CLI model default. */
  reasoningEffort?: CodexReasoningEffort;
  repo?: RepoCheckout;
  repoId?: string;
  /** Additional checkouts cloned next to `repo` under `/workspace/<name>`. */
  extraRepos?: RepoCheckout[];
  extraRepoIds?: string[];
  /** Live workspace git branch when known (git_branch / Cloud Agent result). */
  gitBranch?: string;
  /** When true, reject checkout / git_branch away from the create ref (or first observed head). */
  branchLock?: boolean;
  /** Design canvas this coding agent was promoted from. */
  sourceDesignId?: string;
  /** Coding agent this design canvas promoted into. */
  promotedAgentId?: string;
  /** Latest PR opened or reviewed on this bound work item. */
  pull?: SessionPull;
  hardware?: VmHardware;
  imageId?: string;
  instructions?: string;
  allowedTools?: string[];
  network?: NetworkJail;
  vision?: VisionMode;
  visionFrames?: number;
  webSearch?: boolean;
  /** Host-only: drive the operator's real Chrome via the Locus extension. */
  liveChrome?: boolean;
  playbook?: string;
  palette?: DesignPalette;
  /** Named design system applied to this canvas (colors, type, radius, spacing). */
  designSystemId?: string;
  /** Saved asset art-direction applied to this Assets studio. */
  assetStyleId?: string;
  /** Saved game look (tile, HUD, juice) applied to this Games canvas. */
  gameStyleId?: string;
  /** Unguessable token for GET /play/:token/ (Games play link). */
  playToken?: string;
  /** Operator generation knobs for an Assets studio (topology, resolution, pose, printability). */
  assetBuild?: AssetBuild;
  /** Saved pack on an Assets session (slug, kind, exported files). */
  assetPack?: AssetPackSummary;
  /** Game/Design sessions: asset chats copied into vendor/assets. */
  assetRefs?: SessionAssetRef[];
  /** Last Build snapshot sent to Generate. Differs from `assetBuild` when the picker is dirty. */
  assetAppliedBuild?: AssetBuild;
  designPins?: DesignComment[];
  designVariants?: DesignVariant[];
  activeVariantId?: string;
  /** Operator canvas knobs (radius / space / type) that restyle without a model turn. */
  designTune?: DesignTune;
  role?: AgentRole;
  fileUndo?: FileUndoEntry[];
  guestEnv?: Record<string, string>;
  maxUsd?: number;
  maxMs?: number;
  /** Accrued live-guest milliseconds on a worker, excluding the open interval. */
  computeMs?: number;
  /** ISO time the current live-guest interval started. */
  computeStartedAt?: string;
  /** Fargate quote locked at provision (`quotedUsdPerHour × live-guest ms`). */
  quotedUsdPerHour?: number;
  /** Compute handle id (Fargate task ARN). */
  remoteGuestId?: string;
  /** Fargate size id from the worker allowlist. */
  instanceSize?: string;
  autonomy?: AutonomyTier;
  scratchpad?: string;
  taskList?: TaskItem[];
  parentSessionId?: string;
  plan?: SessionPlan;
  queue?: PromptQueueItem[];
  queuePaused?: boolean;
  compare?: SessionCompare;
  preview?: SessionPreview;
  /** Durable HTML canvases this coding or review chat built beside the thread. */
  agentCanvases?: import("./agentCanvas.js").AgentCanvasRef[];
  pinned?: boolean;
  archived?: boolean;
  status: SessionStatus;
  error?: string;
  messages: ChatMessage[];
  usage?: TokenUsage;
  /** Calibrated characters per token for this session's model. */
  charsPerToken?: number;
  /** Last assembled prompt breakdown for the composer context meter. */
  context?: ContextBreakdown;
  /** Nested spawn_agent rows (live + finished transcripts for the operator). */
  subagents?: SubagentLive[];
  /** Default spawn_agent kind. Operator chat can override this turn. */
  defaultSubagent?: SubagentKind;
  /** Session-sticky autoAllow entries from Needs you → Always allow. */
  autoAllow?: string[];
  /** Last compact boundary for the context meter. */
  lastCompact?: CompactNotice;
  /** Guest processes started with start_process, polled until they exit. */
  backgroundProcesses?: BackgroundProcess[];
  /**
   * Workspace paths already read or patched. Survives later compact folds so the
   * deny-reread list is not lost when those tool messages are gone.
   */
  inspectedFiles?: string[];
  /** Durable Cursor Cloud Agent bound to this chat (provider kind `cursor`). */
  cursorCloud?: CursorCloudState;
  /** Cursor Agent CLI chat id for `--resume` (provider kind `cursor-cli`). */
  cursorCli?: CursorCliState;
  /** Codex CLI chat id for `--resume` (provider kind `codex-cli`). */
  codexCli?: CursorCliState;
  /** Claude Code CLI chat id for `--resume` (provider kind `claude-code`). */
  claudeCode?: CursorCliState;
  /** Kiro CLI chat id for `--resume-id` (provider kind `kiro-cli`). */
  kiroCli?: CursorCliState;
  checkpoint?: SessionCheckpoint;
  checkpoints?: SessionCheckpoint[];
  control?: SessionControl;
  /** Docker Chromium lock. Unset means the agent drives CDP Input. Does not abort chat. */
  browserControl?: SessionControl;
  automationId?: string;
  automationRunId?: string;
  /** Copied from the automation so later runs can offer `remember`. */
  persistMemory?: boolean;
  allowedMcpTools?: string[];
  allowHosts?: string[];
  /** Slack thread this agent is bound to (user-identity client). */
  slack?: SessionSlack;
  /** Planning board this host chat is bound to (`kind: "board"`). */
  boardId?: string;
  /** Project this coordinator or member belongs to. */
  projectId?: string;
  /**
   * Product surface that owns this chat. Developer and Swarm list separately.
   * Missing on disk means developer (legacy).
   */
  surface?: SessionSurface;
  /** Swarm-facing name, avatar, and role (Locus Swarm). */
  persona?: SessionPersona;
  /** Why this session is waiting on a person. Cleared on the next user turn. */
  needsHuman?: string;
  /** Slack / pull / timer subscriptions that wake this chat. */
  subscriptions?: SessionSubscription[];
  /**
   * True when this payload was slimmed for `GET /api/sessions`.
   * The full transcript is `GET /api/sessions/:id`. Not persisted.
   */
  listView?: boolean;
  createdAt: string;
  updatedAt: string;
}

export function rewindTargets(
  session: Pick<AgentSession, "checkpoint" | "checkpoints">,
): SessionCheckpoint[] {
  if (session.checkpoints?.length) return session.checkpoints;
  return session.checkpoint ? [session.checkpoint] : [];
}

export function canRewind(session: Pick<AgentSession, "checkpoint" | "checkpoints">): boolean {
  return rewindTargets(session).length > 0;
}

/** Operator confirm before wiping the transcript. Repos and the guest stay. */
export const CLEAR_CHAT_CONFIRM =
  "Clear this chat? Messages, notes, and model context go away. Linked repos and the guest stay.";

export function canClearChat(
  session: Pick<
    AgentSession,
    | "messages"
    | "scratchpad"
    | "taskList"
    | "plan"
    | "queue"
    | "lastCompact"
    | "context"
    | "usage"
    | "inspectedFiles"
    | "subagents"
    | "cursorCli"
    | "codexCli"
    | "claudeCode"
    | "cursorCloud"
    | "needsHuman"
    | "checkpoint"
    | "checkpoints"
    | "error"
    | "compare"
  >,
): boolean {
  return (
    session.messages.length > 0 ||
    Boolean(session.scratchpad?.trim()) ||
    Boolean(session.taskList?.length) ||
    session.plan != null ||
    Boolean(session.queue?.length) ||
    session.lastCompact != null ||
    session.context != null ||
    session.usage != null ||
    Boolean(session.inspectedFiles?.length) ||
    Boolean(session.subagents?.length) ||
    Boolean(session.cursorCli?.sessionId) ||
    Boolean(session.codexCli?.sessionId) ||
    Boolean(session.claudeCode?.sessionId) ||
    Boolean(session.cursorCloud?.agentId) ||
    Boolean(session.needsHuman?.trim()) ||
    Boolean(session.checkpoints?.length) ||
    session.checkpoint != null ||
    Boolean(session.error?.trim()) ||
    session.compare != null
  );
}

/** Wipe transcript and model context. Caller keeps repos, guest, and settings. */
export function clearSessionConversation(session: AgentSession): void {
  session.messages = [];
  session.usage = undefined;
  session.context = undefined;
  session.lastCompact = undefined;
  session.scratchpad = undefined;
  session.taskList = undefined;
  session.plan = undefined;
  session.queue = undefined;
  session.queuePaused = undefined;
  session.inspectedFiles = undefined;
  session.subagents = undefined;
  session.needsHuman = undefined;
  session.error = undefined;
  session.checkpoint = undefined;
  session.checkpoints = undefined;
  session.cursorCli = undefined;
  session.codexCli = undefined;
  session.claudeCode = undefined;
  session.cursorCloud = undefined;
  session.compare = undefined;
}

function cloneCheckpointPlan(plan: SessionPlan): SessionPlan {
  return {
    ...plan,
    items: plan.items.map((item) => ({ ...item })),
    files: plan.files ? [...plan.files] : plan.files,
    risks: plan.risks ? [...plan.risks] : plan.risks,
  };
}

/** Copy scratchpad / task list / plan onto a checkpoint. Nested rows are cloned. */
export function snapshotCheckpointWorkingState(
  session: Pick<AgentSession, "scratchpad" | "taskList" | "plan">,
): Pick<SessionCheckpoint, "scratchpad" | "taskList" | "plan"> {
  const next: Pick<SessionCheckpoint, "scratchpad" | "taskList" | "plan"> = {};
  if (session.scratchpad !== undefined) next.scratchpad = session.scratchpad;
  if (session.taskList !== undefined) next.taskList = session.taskList.map((item) => ({ ...item }));
  if (session.plan !== undefined) next.plan = cloneCheckpointPlan(session.plan);
  return next;
}

/** Restore working state from a checkpoint. Missing fields are cleared. */
export function applyCheckpointWorkingState(
  session: {
    scratchpad?: string;
    taskList?: TaskItem[];
    plan?: SessionPlan;
  },
  checkpoint: Pick<SessionCheckpoint, "scratchpad" | "taskList" | "plan">,
): void {
  session.scratchpad = checkpoint.scratchpad;
  session.taskList = checkpoint.taskList?.map((item) => ({ ...item }));
  session.plan = checkpoint.plan ? cloneCheckpointPlan(checkpoint.plan) : undefined;
}

export function lastUserMessage(messages: ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") return messages[i];
  }
  return undefined;
}

/** Recency for the chat list: last operator prompt, not the latest agent tick. */
export function sessionListStamp(
  session: Pick<AgentSession, "messages" | "createdAt" | "updatedAt">,
): string {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const message = session.messages[i];
    if (message?.role !== "user" || message.hidden) continue;
    if (message.createdAt) return message.createdAt;
    break;
  }
  return session.createdAt || session.updatedAt;
}

export function compareSessionsForList(
  a: Pick<AgentSession, "id" | "pinned" | "messages" | "createdAt" | "updatedAt">,
  b: Pick<AgentSession, "id" | "pinned" | "messages" | "createdAt" | "updatedAt">,
): number {
  if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
  const byStamp = sessionListStamp(b).localeCompare(sessionListStamp(a));
  if (byStamp !== 0) return byStamp;
  return a.id.localeCompare(b.id);
}

export function lastAssistantText(messages: ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const text = messages[i]?.role === "assistant" ? messages[i]?.content.trim() : "";
    if (text) return text;
  }
  return undefined;
}

export function isHumanDriving(session: Pick<AgentSession, "control">): boolean {
  return session.control === "human";
}

export interface ReplayFrame {
  id: string;
  at: string;
  who: string;
  content: string;
  screenshotBase64?: string;
  screenshotName?: string;
  overlay?: ToolOverlay;
}

export function replayFrames(sessionId: string, messages: ChatMessage[]): ReplayFrame[] {
  return messages
    .filter((message) => !isHiddenChatMessage(message))
    .map((message) => {
      const call = message.toolCalls?.[0];
      return {
        id: message.id,
        at: message.createdAt,
        who:
          message.role === "user"
            ? "You"
            : message.role === "assistant"
              ? "Agent"
              : message.role === "tool"
                ? `Tool · ${call?.name ?? "guest"}`
                : "Locus",
        content: message.content,
        screenshotBase64: message.screenshotBase64,
        screenshotName: message.screenshotName,
        overlay: call ? overlayFromTool(sessionId, call.name, call.arguments) : undefined,
      };
    });
}

export function canReplay(messages: ChatMessage[]): boolean {
  return messages.some(
    (message) =>
      Boolean(message.screenshotBase64) ||
      Boolean(message.screenshotName) ||
      Boolean(message.toolCalls?.length),
  );
}

export const MAX_TIMELINE_SHOTS = 24;

export interface TimelineStop {
  id: string;
  at: string;
  who: string;
  content: string;
  screenshotBase64?: string;
  screenshotName?: string;
  overlay?: ToolOverlay;
  checkpointId?: string;
  messageIndex: number;
  live?: boolean;
}

function checkpointAtOrBefore(
  checkpoints: SessionCheckpoint[],
  messageIndex: number,
): SessionCheckpoint | undefined {
  let found: SessionCheckpoint | undefined;
  for (const checkpoint of checkpoints) {
    if (checkpoint.messageCount <= messageIndex) found = checkpoint;
    else break;
  }
  return found;
}

export function timelineStops(
  session: Pick<AgentSession, "id" | "messages" | "checkpoint" | "checkpoints">,
): TimelineStop[] {
  const checkpoints = rewindTargets(session)
    .slice()
    .sort((a, b) => a.messageCount - b.messageCount || a.createdAt.localeCompare(b.createdAt));
  const used = new Set<string>();
  const shots: TimelineStop[] = [];

  session.messages.forEach((message, index) => {
    if (!message.screenshotBase64 && !message.screenshotName) return;
    const frame = replayFrames(session.id, [message])[0]!;
    const checkpoint = checkpointAtOrBefore(checkpoints, index);
    shots.push({
      ...frame,
      checkpointId: checkpoint?.id,
      messageIndex: index,
    });
  });

  const keptShots = shots.length > MAX_TIMELINE_SHOTS ? shots.slice(-MAX_TIMELINE_SHOTS) : shots;
  for (const shot of keptShots) {
    if (shot.checkpointId) used.add(shot.checkpointId);
  }

  const stops: TimelineStop[] = [...keptShots];
  for (const checkpoint of checkpoints) {
    if (used.has(checkpoint.id)) continue;
    stops.push({
      id: `checkpoint:${checkpoint.id}`,
      at: checkpoint.createdAt,
      who: "Checkpoint",
      content: "",
      checkpointId: checkpoint.id,
      messageIndex: checkpoint.messageCount,
    });
  }

  if (!stops.length) return [];

  stops.sort((a, b) => a.messageIndex - b.messageIndex || a.at.localeCompare(b.at));
  stops.push({
    id: "live",
    at: session.messages.at(-1)?.createdAt ?? stops[stops.length - 1]?.at ?? "",
    who: "Now",
    content: "",
    live: true,
    messageIndex: session.messages.length,
  });
  return stops;
}

export function canShowTimeline(
  session: Pick<AgentSession, "id" | "messages" | "checkpoint" | "checkpoints">,
): boolean {
  return timelineStops(session).some((stop) => !stop.live);
}

export function addUsage(a?: TokenUsage, b?: TokenUsage): TokenUsage | undefined {
  if (!a && !b) return undefined;
  const cached = (a?.cachedInputTokens ?? 0) + (b?.cachedInputTokens ?? 0);
  return {
    inputTokens: (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0),
    outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
    ...(cached > 0 ? { cachedInputTokens: cached } : {}),
  };
}

export function estimateUsd(usage: TokenUsage, rates?: UsageRates): number | undefined {
  const inputRate = finiteRate(rates?.inputUsdPerMillion);
  const outputRate = finiteRate(rates?.outputUsdPerMillion);
  if (inputRate == null && outputRate == null) return undefined;
  return (
    (usage.inputTokens / 1_000_000) * (inputRate ?? 0) +
    (usage.outputTokens / 1_000_000) * (outputRate ?? 0)
  );
}

export function formatUsd(amount: number): string {
  if (amount === 0) return "$0";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

export function formatUsageHint(
  usage?: TokenUsage,
  rates?: UsageRates,
  computeUsd?: number,
): string | undefined {
  const hasTokens = Boolean(usage && (usage.inputTokens > 0 || usage.outputTokens > 0));
  const tokens = hasTokens
    ? `${usage!.inputTokens.toLocaleString("en-US")} in · ${usage!.outputTokens.toLocaleString("en-US")} out`
    : undefined;
  const usd = hasTokens && usage ? estimateUsd(usage, rates) : undefined;
  const vmAmount = typeof computeUsd === "number" && computeUsd > 0 ? computeUsd : 0;
  const vm = vmAmount > 0 ? `${formatUsd(vmAmount)} VM` : undefined;
  if (usd != null && vmAmount > 0) {
    const total = `${formatUsd(usd + vmAmount)} total (${formatUsd(usd)} LLM · ${vm})`;
    return [tokens, total].filter(Boolean).join(" · ");
  }
  const parts = [tokens, usd != null ? formatUsd(usd) : undefined, vm].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

function finiteRate(value?: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export interface CreateSessionInput {
  title?: string;
  os: GuestOs;
  templateId: string;
  kind?: SessionKind;
  runtime?: AgentRuntime;
  placement?: AgentPlacement;
  backendId?: string;
  dockerImage?: string;
  /** Fargate size id; defaults to the worker's first allowed size. */
  instanceSize?: string;
  /** Existing absolute folder the host agent uses as `/workspace`. */
  hostDir?: string;
  providerId: string;
  model: string;
  reasoningEffort?: CodexReasoningEffort;
  repo?: RepoCheckout;
  repoId?: string;
  /** Additional checkouts cloned next to `repo` under `/workspace/<name>`. */
  extraRepos?: RepoCheckout[];
  extraRepoIds?: string[];
  /** Lock workspace branch after create (reject checkout / git_branch away from create ref). */
  branchLock?: boolean;
  sourceDesignId?: string;
  /** Assets session ids to copy into vendor/assets when creating a game. */
  assetIds?: string[];
  /** Saved game style for a new Games canvas. */
  gameStyleId?: string;
  /** Parent session this chat was spawned from (Games generate-and-link). */
  parentSessionId?: string;
  promotedAgentId?: string;
  pull?: SessionPull;
  hardware?: HardwareOverride;
  imageId?: string;
  instructions?: string;
  allowedTools?: string[];
  network?: NetworkJail;
  vision?: VisionMode;
  webSearch?: boolean;
  liveChrome?: boolean;
  playbook?: string;
  palette?: DesignPalette;
  designSystemId?: string;
  assetStyleId?: string;
  assetBuild?: AssetBuild;
  startVm: boolean;
  automationId?: string;
  automationRunId?: string;
  persistMemory?: boolean;
  allowedMcpTools?: string[];
  allowHosts?: string[];
  role?: AgentRole;
  guestEnv?: Record<string, string>;
  maxUsd?: number;
  maxMs?: number;
  autonomy?: AutonomyTier;
  /** First chat turn. The server holds it until the guest is ready. */
  prompt?: string;

  /** Files attached alongside `prompt`. Persisted before the first turn runs. */
  attachments?: IncomingAttachmentData[];
  slack?: SessionSlack;
  /** Planning board this host chat is bound to. */
  boardId?: string;
  /** Project this coordinator or member belongs to. */
  projectId?: string;
  /** Product surface for this chat (`developer` | `swarm`). */
  surface?: SessionSurface;
  /** Swarm-facing name, avatar, and role (Locus Swarm). */
  persona?: SessionPersona;
}

export interface PatchSessionInput {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
  providerId?: string;
  model?: string;
  reasoningEffort?: CodexReasoningEffort | null;
  instructions?: string | null;
  allowedTools?: string[] | null;
  network?: NetworkJail;
  vision?: VisionMode;
  webSearch?: boolean;
  liveChrome?: boolean;
  playbook?: string | null;
  palette?: DesignPalette | null;
  designSystemId?: string | null;
  assetStyleId?: string | null;
  gameStyleId?: string | null;
  playToken?: string | null;
  assetBuild?: AssetBuild | null;
  assetPack?: AssetPackSummary | null;
  assetRefs?: SessionAssetRef[] | null;
  assetAppliedBuild?: AssetBuild | null;
  plan?: SessionPlan | null;
  queue?: PromptQueueItem[] | null;
  queuePaused?: boolean;
  compare?: SessionCompare | null;
  preview?: SessionPreview | null;
  designPins?: DesignComment[] | null;
  designVariants?: DesignVariant[] | null;
  activeVariantId?: string | null;
  designTune?: DesignTune | null;
  role?: AgentRole | null;
  guestEnv?: Record<string, string> | null;
  maxUsd?: number | null;
  maxMs?: number | null;
  autonomy?: AutonomyTier | null;
  defaultSubagent?: SubagentKind;
  /** Pass `null` to clear hub persona. */
  persona?: SessionPersona | null;
  /** Pass `null` to dismiss a Needs you gate. Client strings are ignored. */
  needsHuman?: string | null;
  subscriptions?: SessionSubscription[] | null;
}
