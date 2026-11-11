import type {
  AgentCanvasRef,
  AgentSession,
  Automation,
  AutomationRun,
  BoardDocument,
  BoardRunTarget,
  BoardStarter,
  BoardSummary,
  BrainDocument,
  BrainSummary,
  CreateProjectInput,
  PatchProjectInput,
  ProjectContextEntry,
  ProjectDocument,
  ProjectSummary,
  CreateAutomationInput,
  CreateLinkedRepoInput,
  CreateSessionInput,
  DebugLogDetail,
  DebugLogKind,
  DebugLogSource,
  DesignSystem,
  AssetStyle,
  GameStyle,
  ForgeImportAccount,
  ForgeOauthStart,
  ForgeOauthStatus,
  GoldenImage,
  GuestOs,
  LinkedRepo,
  LocusConfig,
  NamedEnvironment,
  LoadPathReview,
  ArchitectureAnalysis,
  ArchScope,
  ChangeStack,
  ChangeStackRevision,
  RepoBranchList,
  SlackConversation,
  SlackGifSearch,
  SlackMessage,
  SlackRunInput,
  SlackStatus,
  SlackSearchHit,
  GrafanaAlert,
  GrafanaBriefing,
  GrafanaDashboardHit,
  GrafanaDashboardQueryResult,
  GrafanaDashboardView,
  GrafanaExplorerStatus,
  GrafanaLogHitLite,
  GrafanaPin,
  GrafanaRecentQuery,
  GrafanaRepoLink,
  GrafanaTraceHop,
  GrafanaTraceResult,
  SlackActivityItem,
  SlackPostAs,
  PatchAutomationInput,
  PatchLinkedRepoInput,
  PatchSessionInput,
  IssueDetail,
  IssueListState,
  IssueRef,
  PullRequestDetail,
  PullRequestRef,
  PullListState,
  SetupStatus,
  ToolSpec,
  TraceEvalCase,
  SessionEgressSummary,
  ApprovalExportRow,
  VmInstance,
  AgentSkill,
  DockerContainer,
  DockerDaemonStatus,
  DockerContainerStats,
  DockerBulkStopResult,
  DockerSwarmService,
  DockerSwarmServiceDetail,
  DockerSwarmSnapshot,
  SwarmNeedAction,
  SwarmTeamHandoff,
  SwarmTeamHandoffAction,
} from "@locus/shared";
import { CHAT_POST_TIMEOUT_MS, HttpError, WORKSPACE_FILE_TIMEOUT_MS } from "./net";
import {
  clearPullCaches,
  invalidatePullLists,
  peekPullDetail,
  peekPullList,
  rememberPullDetail,
  rememberPullList,
} from "./pullCache";
import {
  clearIssueCaches,
  invalidateIssueLists,
  peekIssueDetail,
  peekIssueList,
  rememberIssueDetail,
  rememberIssueList,
} from "./issueCache";
import { apiFetch, errorMessageFromResponse, json, withQuery } from "./apiHttp";
import type {
  HypervisorStatus,
  ShareFile,
  WorkspaceEntry,
  WorkspaceFileChange,
  WorkspaceIndexHit,
  WorkspaceIndexStatus,
  WorkspaceGrepHit,
  WorkspaceDiagnostic,
  WorkspaceDebugState,
  WorkspaceHover,
  WorkspaceLocation,
  WorkspaceHighlight,
  WorkspaceSignatureHelp,
  WorkspaceGitStatus,
  WorkspaceGitHunk,
  WorkspaceGitStash,
  WorkspaceGitRebaseTodo,
  WorkspaceGitRebaseStatus,
  WorkspaceBlameLine,
  WorkspaceOutlineItem,
  WorkspaceCompletionItem,
} from "./apiTypes";
export type {
  HypervisorStatus,
  ShareFile,
  WorkspaceEntry,
  WorkspaceFileChange,
  WorkspaceIndexHit,
  WorkspaceIndexStatus,
  WorkspaceGrepHit,
  WorkspaceDiagnostic,
  WorkspaceDebugState,
  WorkspaceHover,
  WorkspaceLocation,
  WorkspaceHighlight,
  WorkspaceSignatureHelp,
  WorkspaceGitFile,
  WorkspaceGitStatus,
  WorkspaceGitHunk,
  WorkspaceGitStash,
  WorkspaceGitRebaseTodo,
  WorkspaceGitRebaseStatus,
  WorkspaceBlameLine,
  WorkspaceOutlineItem,
  WorkspaceCompletionItem,
} from "./apiTypes";
export {
  browserWsUrl,
  connectEvents,
  displayWsUrl,
  eventsWsUrl,
  retryEvents,
  terminalWsUrl,
  workspaceTerminalWsUrl,
} from "./apiEvents";
export type { ConnectEventsOptions } from "./apiEvents";

const listInflight = new Map<string, Promise<PullRequestRef[]>>();
const detailInflight = new Map<string, Promise<PullRequestDetail>>();
const issueListInflight = new Map<string, Promise<IssueRef[]>>();
const issueDetailInflight = new Map<string, Promise<IssueDetail>>();

async function repoPullsCached(
  id: string,
  state: PullListState = "open",
  opts: { fresh?: boolean } = {},
): Promise<PullRequestRef[]> {
  const key = `${id}:${state}`;
  if (!opts.fresh) {
    const hit = peekPullList(id, state);
    if (hit?.fresh) return hit.rows;
    const pending = listInflight.get(key);
    if (pending) return pending;
  }
  const qs = `state=${state}${opts.fresh ? "&fresh=1" : ""}`;
  const pending = json<PullRequestRef[]>(`/api/repos/${id}/pulls?${qs}`).then((rows) => {
    if (listInflight.get(key) === pending) rememberPullList(id, state, rows);
    return rows;
  });
  listInflight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (listInflight.get(key) === pending) listInflight.delete(key);
  }
}

async function repoPullCached(
  id: string,
  number: number,
  opts: { fresh?: boolean } = {},
): Promise<PullRequestDetail> {
  const key = `${id}:${number}`;
  if (!opts.fresh) {
    const hit = peekPullDetail(id, number);
    if (hit?.fresh) return hit.pull;
    const pending = detailInflight.get(key);
    if (pending) return pending;
  }
  const qs = opts.fresh ? "?fresh=1" : "";
  const pending = json<PullRequestDetail>(`/api/repos/${id}/pulls/${number}${qs}`).then((pull) => {
    if (detailInflight.get(key) === pending) rememberPullDetail(id, number, pull);
    return pull;
  });
  detailInflight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (detailInflight.get(key) === pending) detailInflight.delete(key);
  }
}

async function rememberMutatedPull(
  id: string,
  number: number,
  pull: PullRequestDetail,
): Promise<PullRequestDetail> {
  rememberPullDetail(id, number, pull);
  invalidatePullLists(id);
  return pull;
}

async function repoIssuesCached(
  id: string,
  state: IssueListState = "open",
  opts: { fresh?: boolean } = {},
): Promise<IssueRef[]> {
  const key = `${id}:${state}`;
  if (!opts.fresh) {
    const hit = peekIssueList(id, state);
    if (hit?.fresh) return hit.rows;
    const pending = issueListInflight.get(key);
    if (pending) return pending;
  }
  const qs = `state=${state}${opts.fresh ? "&fresh=1" : ""}`;
  const pending = json<IssueRef[]>(`/api/repos/${id}/issues?${qs}`).then((rows) => {
    if (issueListInflight.get(key) === pending) rememberIssueList(id, state, rows);
    return rows;
  });
  issueListInflight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (issueListInflight.get(key) === pending) issueListInflight.delete(key);
  }
}

async function repoIssueCached(
  id: string,
  number: number,
  opts: { fresh?: boolean } = {},
): Promise<IssueDetail> {
  const key = `${id}:${number}`;
  if (!opts.fresh) {
    const hit = peekIssueDetail(id, number);
    if (hit?.fresh) return hit.issue;
    const pending = issueDetailInflight.get(key);
    if (pending) return pending;
  }
  const qs = opts.fresh ? "?fresh=1" : "";
  const pending = json<IssueDetail>(`/api/repos/${id}/issues/${number}${qs}`).then((issue) => {
    if (issueDetailInflight.get(key) === pending) rememberIssueDetail(id, number, issue);
    return issue;
  });
  issueDetailInflight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (issueDetailInflight.get(key) === pending) issueDetailInflight.delete(key);
  }
}

async function rememberMutatedIssue(
  id: string,
  number: number,
  issue: IssueDetail,
): Promise<IssueDetail> {
  rememberIssueDetail(id, number, issue);
  invalidateIssueLists(id);
  return issue;
}

export const api = {
  health: () => json<{ ok: boolean; hypervisor: string; docker?: string }>("/api/health"),
  hypervisor: () => json<HypervisorStatus>("/api/hypervisor"),
  setup: () => json<SetupStatus>("/api/setup"),
  installHypervisor: () =>
    json<{
      ok: boolean;
      qemuFound: boolean;
      restartRequired: boolean;
      log?: string;
      setup: SetupStatus;
    }>("/api/hypervisor/install", { method: "POST" }),
  config: () => json<LocusConfig>("/api/config"),
  saveConfig: (config: LocusConfig) =>
    json<LocusConfig>("/api/config", { method: "PUT", body: JSON.stringify(config) }),
  revokeAllIntegrations: () =>
    json<{ ok: true; config: LocusConfig }>("/api/integrations/revoke-all", {
      method: "POST",
      body: JSON.stringify({ confirm: "REVOKE" }),
    }),
  sessionEgress: (id: string) => json<SessionEgressSummary>(`/api/sessions/${id}/audit/egress`),
  sessionApprovals: (id: string) =>
    json<{ approvals: ApprovalExportRow[] }>(`/api/sessions/${id}/audit/approvals`),
  auditApprovals: () => json<{ approvals: ApprovalExportRow[] }>("/api/audit/approvals"),
  testWorker: (input: { url: string; token?: string; fingerprint?: string }) =>
    json<{
      ok: true;
      docker?: "mock" | "docker";
      hostname?: string;
      name?: string;
      fingerprint?: string;
    }>("/api/workers/test", { method: "POST", body: JSON.stringify(input) }),
  addWorker: (input: {
    blob?: string;
    url?: string;
    token?: string;
    fingerprint?: string;
    name?: string;
  }) =>
    json<{ worker: { id: string; name: string; url: string }; config: LocusConfig }>(
      "/api/workers",
      { method: "POST", body: JSON.stringify(input) },
    ),
  workersStatus: () =>
    json<
      Array<{
        id: string;
        live: boolean;
        skipped?: boolean;
        error?: string;
        hostname?: string;
        name?: string;
      }>
    >("/api/workers/status"),
  startForgeOauth: (
    id: string,
    input: {
      kind?: LocusConfig["forges"][number]["kind"];
      name?: string;
      apiBaseUrl?: string;
      oauthClientId?: string;
      oauthClientSecret?: string;
    } = {},
  ) =>
    json<ForgeOauthStart>(`/api/forges/${id}/oauth/start`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  forgeOauthStatus: (id: string) => json<ForgeOauthStatus>(`/api/forges/${id}/oauth/status`),
  cancelForgeOauth: (id: string) => json(`/api/forges/${id}/oauth/cancel`, { method: "POST" }),
  disconnectForgeOauth: (id: string) =>
    json<{ ok: true; config: LocusConfig }>(`/api/forges/${id}/oauth/disconnect`, {
      method: "POST",
    }),
  resetAll: () =>
    json<{
      ok: true;
      dataDir: string;
      config: LocusConfig;
      sessions: AgentSession[];
      vms: VmInstance[];
      automations: Automation[];
      runs: AutomationRun[];
      repos: LinkedRepo[];
      hypervisor: "mock" | "qemu";
      docker: "mock" | "docker";
      setup: SetupStatus;
    }>("/api/reset", { method: "POST", body: JSON.stringify({ confirm: "RESET" }) }),
  sessions: () => json<AgentSession[]>("/api/sessions"),
  session: (id: string, opts?: { timeoutMs?: number }) =>
    json<AgentSession>(
      `/api/sessions/${id}`,
      opts?.timeoutMs != null ? { timeoutMs: opts.timeoutMs } : undefined,
    ),
  browseHost: (path?: string) =>
    json<{
      path: string;
      parent: string | null;
      entries: { name: string; path: string; kind?: "dir" | "file" }[];
      blocked?: string;
    }>(`/api/host/browse${path?.trim() ? `?path=${encodeURIComponent(path.trim())}` : ""}`),
  browseDiskImages: (path?: string) =>
    json<{
      path: string;
      parent: string | null;
      entries: { name: string; path: string; kind?: "dir" | "file" }[];
    }>(`/api/host/browse-images${path?.trim() ? `?path=${encodeURIComponent(path.trim())}` : ""}`),
  saveHostFile: (input: { dir: string; filename: string; contentBase64: string }) =>
    json<{ path: string; bytes: number }>("/api/host/save-file", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  createSession: (input: CreateSessionInput) =>
    json<AgentSession>("/api/sessions", { method: "POST", body: JSON.stringify(input) }),
  patchSession: (id: string, patch: PatchSessionInput) =>
    json<AgentSession>(`/api/sessions/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteSession: (id: string) => json(`/api/sessions/${id}`, { method: "DELETE" }),
  chat: (
    id: string,
    content: string,
    opts?: {
      plan?: boolean;
      skill?: string;
      steer?: boolean;
      attachments?: Array<{ name: string; mime?: string; contentBase64: string }>;
      focusPath?: string;
      assetRefs?: string[];
    },
  ) =>
    json(`/api/sessions/${id}/chat`, {
      method: "POST",
      body: JSON.stringify({
        content,
        plan: opts?.plan,
        skill: opts?.skill,
        steer: opts?.steer,
        attachments: opts?.attachments,
        focusPath: opts?.focusPath,
        assetRefs: opts?.assetRefs,
      }),
      timeoutMs: CHAT_POST_TIMEOUT_MS,
    }),
  abortChat: (id: string) => json(`/api/sessions/${id}/chat/abort`, { method: "POST" }),
  sendQueueNow: (id: string, itemId: string) =>
    json<AgentSession>(`/api/sessions/${id}/queue/${encodeURIComponent(itemId)}/send`, {
      method: "POST",
    }),
  resolveApproval: (
    id: string,
    toolCallId: string,
    decision: "approved" | "denied",
    answer?: string,
    persist?: boolean,
  ) =>
    json<AgentSession>(`/api/sessions/${id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ toolCallId, decision, answer, persist: persist || undefined }),
    }),
  rewind: (id: string, checkpointId?: string) =>
    json<AgentSession>(`/api/sessions/${id}/rewind`, {
      method: "POST",
      body: JSON.stringify(checkpointId ? { checkpointId } : {}),
    }),
  clearChat: (id: string) => json<AgentSession>(`/api/sessions/${id}/clear`, { method: "POST" }),
  checkpointDiff: (id: string, checkpointId: string) =>
    json<{ diff: string }>(
      `/api/sessions/${id}/checkpoints/${encodeURIComponent(checkpointId)}/diff`,
    ),
  takeover: (id: string) => json<AgentSession>(`/api/sessions/${id}/takeover`, { method: "POST" }),
  handback: (id: string) => json<AgentSession>(`/api/sessions/${id}/handback`, { method: "POST" }),
  browserTakeover: (id: string) =>
    json<AgentSession>(`/api/sessions/${id}/browser/takeover`, { method: "POST" }),
  browserHandback: (id: string) =>
    json<AgentSession>(`/api/sessions/${id}/browser/handback`, { method: "POST" }),
  fork: (id: string) => json<AgentSession>(`/api/sessions/${id}/fork`, { method: "POST" }),
  spawnWorkers: (id: string, body: { count?: number; prompt?: string; models?: string[] } = {}) =>
    json<AgentSession[]>(`/api/sessions/${id}/workers`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  workerDiffs: (id: string) =>
    json<Array<{ id: string; role: string; branch?: string; diff: string }>>(
      `/api/sessions/${id}/workers/diff`,
    ),
  mergeWorker: (id: string, workerId: string) =>
    json<AgentSession>(`/api/sessions/${id}/workers/merge`, {
      method: "POST",
      body: JSON.stringify({ workerId }),
    }),
  undoFile: (id: string) => json<AgentSession>(`/api/sessions/${id}/undo-file`, { method: "POST" }),
  cycleRole: (id: string) => json<AgentSession>(`/api/sessions/${id}/roles`, { method: "POST" }),
  sessionSkills: (id: string) => json<AgentSkill[]>(`/api/sessions/${id}/skills`),
  promote: (
    id: string,
    body: {
      scaffold?:
        "vite-react" | "static" | "next" | "astro" | "canvas-vite" | "three-vite" | "phaser";
    } = {},
  ) =>
    json<{ agent: AgentSession; design: AgentSession }>(`/api/sessions/${id}/promote`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createDesignVariant: (id: string, name?: string, opts?: { id?: string; keepActive?: boolean }) =>
    json<AgentSession>(`/api/sessions/${id}/design/variants`, {
      method: "POST",
      body: JSON.stringify({ name, id: opts?.id, keepActive: opts?.keepActive }),
    }),
  exploreDesignDirections: (id: string) =>
    json<AgentSession>(`/api/sessions/${id}/design/explore`, { method: "POST" }),
  exportGameZip: (id: string) =>
    json<{ filename: string; zipBase64: string }>(`/api/sessions/${id}/game-export`),
  splitLiveGame: (id: string) =>
    json<AgentSession>(`/api/sessions/${id}/game/split`, { method: "POST" }),
  ingestAssetPack: (
    id: string,
    body: { format: string; mime?: string; filename?: string; contentBase64: string },
  ) => json(`/api/sessions/${id}/asset-pack`, { method: "POST", body: JSON.stringify(body) }),
  linkAssets: (id: string, assetIds: string[]) =>
    json(`/api/sessions/${id}/linked-assets`, {
      method: "POST",
      body: JSON.stringify({ assetIds }),
    }),
  editCanvasText: (id: string, body: { selector: string; text: string }) =>
    json<AgentSession>(`/api/sessions/${id}/design/edit`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  activateDesignVariant: (id: string, variantId: string) =>
    json<AgentSession>(
      `/api/sessions/${id}/design/variants/${encodeURIComponent(variantId)}/activate`,
      {
        method: "POST",
      },
    ),
  renameDesignVariant: (id: string, variantId: string, name: string) =>
    json<AgentSession>(`/api/sessions/${id}/design/variants/${encodeURIComponent(variantId)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  deleteDesignVariant: (id: string, variantId: string) =>
    json<AgentSession>(`/api/sessions/${id}/design/variants/${encodeURIComponent(variantId)}`, {
      method: "DELETE",
    }),
  designSystems: () =>
    json<{ systems: DesignSystem[]; builtins: DesignSystem[]; defaultId?: string }>(
      "/api/design-systems",
    ),
  createDesignSystem: (body: Record<string, unknown>) =>
    json<DesignSystem>("/api/design-systems", { method: "POST", body: JSON.stringify(body) }),
  importDesignSystem: async (input: {
    text?: string;
    filename?: string;
    zipBase64?: string;
    file?: File;
  }) => {
    if (input.file) {
      const form = new FormData();
      form.append("file", input.file, input.file.name);
      if (input.filename) form.append("filename", input.filename);
      const res = await apiFetch("/api/design-systems/import", { method: "POST", body: form });
      if (!res.ok) throw new HttpError(await errorMessageFromResponse(res), res.status);
      return (await res.json()) as DesignSystem;
    }
    return json<DesignSystem>("/api/design-systems/import", {
      method: "POST",
      body: JSON.stringify({
        text: input.text,
        filename: input.filename,
        zipBase64: input.zipBase64,
      }),
    });
  },
  patchDesignSystem: (id: string, body: Record<string, unknown>) =>
    json<DesignSystem>(`/api/design-systems/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteDesignSystem: (id: string) =>
    json<{ ok: true; systems: DesignSystem[]; builtins: DesignSystem[]; defaultId?: string }>(
      `/api/design-systems/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  setDefaultDesignSystem: (id: string) =>
    json<{ systems: DesignSystem[]; builtins: DesignSystem[]; defaultId?: string }>(
      `/api/design-systems/${encodeURIComponent(id)}/default`,
      { method: "POST" },
    ),
  assetStyles: () => json<{ styles: AssetStyle[]; defaultId?: string }>("/api/asset-styles"),
  createAssetStyle: (body: Record<string, unknown>) =>
    json<AssetStyle>("/api/asset-styles", { method: "POST", body: JSON.stringify(body) }),
  importAssetStyle: (input: { text?: string; filename?: string }) =>
    json<AssetStyle>("/api/asset-styles/import", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  patchAssetStyle: (id: string, body: Record<string, unknown>) =>
    json<AssetStyle>(`/api/asset-styles/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteAssetStyle: (id: string) =>
    json<{ ok: true; styles: AssetStyle[]; defaultId?: string }>(
      `/api/asset-styles/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  setDefaultAssetStyle: (id: string) =>
    json<{ styles: AssetStyle[]; defaultId?: string }>(
      `/api/asset-styles/${encodeURIComponent(id)}/default`,
      { method: "POST" },
    ),
  saveAssetStyleFromSession: (
    sessionId: string,
    body: { name?: string; summary?: string; guidelines?: string } = {},
  ) =>
    json<AssetStyle>(`/api/sessions/${encodeURIComponent(sessionId)}/asset-style`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  gameStyles: () => json<{ styles: GameStyle[]; defaultId?: string }>("/api/game-styles"),
  createGameStyle: (body: Record<string, unknown>) =>
    json<GameStyle>("/api/game-styles", { method: "POST", body: JSON.stringify(body) }),
  patchGameStyle: (id: string, body: Record<string, unknown>) =>
    json<GameStyle>(`/api/game-styles/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteGameStyle: (id: string) =>
    json<{ ok: true; styles: GameStyle[]; defaultId?: string }>(
      `/api/game-styles/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  setDefaultGameStyle: (id: string) =>
    json<{ styles: GameStyle[]; defaultId?: string }>(
      `/api/game-styles/${encodeURIComponent(id)}/default`,
      { method: "POST" },
    ),
  saveGameStyleFromSession: (
    sessionId: string,
    body: { name?: string; summary?: string; guidelines?: string } = {},
  ) =>
    json<GameStyle>(`/api/sessions/${encodeURIComponent(sessionId)}/game-style`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  playLink: (id: string) =>
    json<{ token: string; url: string; lanUrls: string[] }>(`/api/sessions/${id}/play-link`),
  generateGameAsset: (id: string, kind: string) =>
    json<{ game: AgentSession; asset?: AgentSession }>(`/api/sessions/${id}/generate-asset`, {
      method: "POST",
      body: JSON.stringify({ kind }),
    }),
  tailscale: () =>
    json<{
      installed: boolean;
      running: boolean;
      loggedIn: boolean;
      funnelEnabled: boolean;
      funnelUrl?: string;
      error?: string;
    }>("/api/tailscale"),
  setTailscaleFunnel: (enabled: boolean) =>
    json<{
      installed: boolean;
      running: boolean;
      loggedIn: boolean;
      funnelEnabled: boolean;
      funnelUrl?: string;
      error?: string;
      webhookBaseUrl?: string;
    }>("/api/tailscale/funnel", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),
  phone: () =>
    json<{
      enabled: boolean;
      token?: string;
      listenHost: string;
      port: number;
      urls: Array<{ address: string; http: string; app: string }>;
      fingerprint?: string;
      restartHint?: string;
    }>("/api/phone"),
  setPhone: (enabled: boolean) =>
    json<{
      enabled: boolean;
      token?: string;
      listenHost: string;
      port: number;
      urls: Array<{ address: string; http: string; app: string }>;
      fingerprint?: string;
      restartHint?: string;
    }>("/api/phone", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),
  rotatePhone: () =>
    json<{
      enabled: boolean;
      token?: string;
      listenHost: string;
      port: number;
      urls: Array<{ address: string; http: string; app: string }>;
      fingerprint?: string;
      restartHint?: string;
    }>("/api/phone/rotate", { method: "POST" }),
  chromeExtension: () =>
    json<{
      enabled: boolean;
      token?: string;
      formattedToken?: string;
      installDir: string;
      connected: boolean;
      tabs: Array<{ targetId: string; url: string; title?: string; active?: boolean }>;
    }>("/api/chrome-extension"),
  setChromeExtension: (enabled: boolean) =>
    json<{
      enabled: boolean;
      token?: string;
      formattedToken?: string;
      installDir: string;
      connected: boolean;
      tabs: Array<{ targetId: string; url: string; title?: string; active?: boolean }>;
    }>("/api/chrome-extension", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),
  rotateChromeExtension: () =>
    json<{
      enabled: boolean;
      token?: string;
      formattedToken?: string;
      installDir: string;
      connected: boolean;
      tabs: Array<{ targetId: string; url: string; title?: string; active?: boolean }>;
    }>("/api/chrome-extension/rotate", { method: "POST" }),
  images: () => json<GoldenImage[]>("/api/images"),
  deleteImage: (id: string) => json(`/api/images/${id}`, { method: "DELETE" }),
  captureImage: (sessionId: string, name: string) =>
    json<GoldenImage>(`/api/sessions/${sessionId}/images`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  saveEnvironment: (sessionId: string, name: string) =>
    json<{
      image: GoldenImage;
      environment: NamedEnvironment;
      config: LocusConfig;
      repo?: LinkedRepo;
    }>(`/api/sessions/${sessionId}/save-environment`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  fetchCloudImage: (os: GuestOs) =>
    json<{ path: string; url: string; name: string }>("/api/media/fetch", {
      method: "POST",
      body: JSON.stringify({ os }),
    }),
  fetchVirtioIso: () =>
    json<{ path: string; url: string; name: string }>("/api/media/fetch", {
      method: "POST",
      body: JSON.stringify({ media: "virtio" }),
    }),
  providerModels: (id: string, patch: { apiKey?: string; baseUrl?: string } = {}) =>
    json<{ models: string[] }>(`/api/providers/${id}/models`, {
      method: "POST",
      body: JSON.stringify(patch),
    }),
  refreshCursorCli: () =>
    json<{ changed: boolean; models: string[]; config: LocusConfig }>(
      "/api/providers/cursor-cli/refresh",
      { method: "POST" },
    ),
  checkUpdates: (current: string) =>
    json<{
      status: "available" | "up-to-date" | "unavailable";
      current: string;
      latest?: string;
      name?: string;
      notes?: string;
      htmlUrl?: string;
      asset?: { name: string; url: string };
      checksums?: { name: string; url: string };
      message?: string;
    }>(`/api/updates?current=${encodeURIComponent(current)}`),
  downloadUpdate: (
    asset: { name: string; url: string },
    checksums: { name: string; url: string },
  ) =>
    json<{ path: string; sha256: string; verified: true }>("/api/updates/download", {
      method: "POST",
      body: JSON.stringify({ asset, checksums }),
    }),
  openUpdate: (path: string) =>
    json<{ ok: true }>("/api/updates/open", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  testProvider: (id: string, patch: { apiKey?: string; baseUrl?: string } = {}) =>
    json<{
      ok: boolean;
      models: number;
      version?: string;
      authMode?: string;
      command?: string;
      scope?: "control-plane";
    }>(`/api/providers/${id}/test`, {
      method: "POST",
      body: JSON.stringify(patch),
    }),
  uploadShare: async (file: File, sessionId?: string) => {
    const form = new FormData();
    form.append("file", file);
    const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
    const res = await apiFetch(`/api/share/upload${qs}`, { method: "POST", body: form });
    if (!res.ok) throw new Error(await errorMessageFromResponse(res));
    return (await res.json()) as { path: string; guestPath: string };
  },
  shareFiles: (sessionId?: string) =>
    json<{ files: ShareFile[] }>(
      `/api/share${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`,
    ),
  shareFileUrl: (name: string) => `/api/share/files/${encodeURIComponent(name)}`,
  canvas: (id: string) =>
    json<{ html: string | null; path: string; mtime?: string }>(`/api/sessions/${id}/canvas`),
  agentCanvas: (id: string, canvasId: string) =>
    json<AgentCanvasRef & { html: string }>(
      `/api/sessions/${encodeURIComponent(id)}/agent-canvases/${encodeURIComponent(canvasId)}`,
    ),
  sessionPreview: (id: string) =>
    json<{ ports: number[]; active?: { port: number; path: string; url: string } }>(
      `/api/sessions/${id}/preview`,
    ),
  sessionIde: (id: string) =>
    json<{ url: string | null }>(`/api/sessions/${encodeURIComponent(id)}/ide`),
  previewHttpUrl: (id: string, port: number, path = "/") =>
    `/api/sessions/${encodeURIComponent(id)}/preview-http/${port}${path.startsWith("/") ? path : `/${path}`}`,
  workspaceTree: (id: string, path = "", depth?: number) => {
    const query = new URLSearchParams();
    if (path) query.set("path", path);
    if (depth != null) query.set("depth", String(depth));
    const qs = query.toString();
    return json<{ entries: WorkspaceEntry[]; changes?: WorkspaceFileChange[] }>(
      `/api/sessions/${encodeURIComponent(id)}/workspace${qs ? `?${qs}` : ""}`,
    );
  },
  workspaceFile: (id: string, path: string) =>
    json<{ path: string; content: string; mtime: string; baseline?: string }>(
      `/api/sessions/${encodeURIComponent(id)}/workspace/file?path=${encodeURIComponent(path)}`,
      { timeoutMs: WORKSPACE_FILE_TIMEOUT_MS },
    ),
  workspaceRawUrl: (id: string, path: string) =>
    `/api/sessions/${encodeURIComponent(id)}/workspace/raw?path=${encodeURIComponent(path)}`,
  saveWorkspaceFile: (id: string, path: string, content: string) =>
    json<{ path: string; mtime: string }>(
      `/api/sessions/${encodeURIComponent(id)}/workspace/file`,
      {
        method: "PUT",
        body: JSON.stringify({ path, content }),
      },
    ),
  workspaceComplete: (
    id: string,
    input: { path: string; content: string; line: number; character: number },
  ) =>
    json<{ items: WorkspaceCompletionItem[]; source: string }>(
      `/api/sessions/${encodeURIComponent(id)}/workspace/complete`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
  workspaceInlineEdit: (
    id: string,
    input: { path: string; content: string; instruction: string; start: number; end: number },
  ) =>
    json<{ text: string }>(`/api/sessions/${encodeURIComponent(id)}/workspace/inline-edit`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  workspaceSearch: (id: string, query: string, limit?: number) =>
    json<{
      items: WorkspaceIndexHit[];
      fileCount: number;
      builtAt: string;
      truncated?: boolean;
    }>(`/api/sessions/${encodeURIComponent(id)}/workspace/search`, {
      method: "POST",
      body: JSON.stringify({ query, limit }),
    }),
  workspaceGrep: (
    id: string,
    query: string,
    limit?: number,
    opts?: { glob?: string; exclude?: string; regex?: boolean; replace?: string },
  ) =>
    json<{
      items: WorkspaceGrepHit[];
      truncated?: boolean;
      replaced?: number;
      error?: string;
    }>(`/api/sessions/${encodeURIComponent(id)}/workspace/grep`, {
      method: "POST",
      body: JSON.stringify({ query, limit, ...opts }),
    }),
  workspaceInspect: (
    id: string,
    input: { path: string; content: string; line: number; character: number },
  ) =>
    json<{
      diagnostics: WorkspaceDiagnostic[];
      hover: WorkspaceHover | null;
      definition: WorkspaceLocation | null;
      signature?: WorkspaceSignatureHelp | null;
      typeDefinition?: WorkspaceLocation | null;
      implementation?: WorkspaceLocation | null;
      highlights?: WorkspaceHighlight[];
      pylsp?: boolean;
    }>(`/api/sessions/${encodeURIComponent(id)}/workspace/inspect`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  workspaceSymbols: (id: string, query: string, limit?: number) =>
    json<{ items: WorkspaceIndexHit[] }>(
      `/api/sessions/${encodeURIComponent(id)}/workspace/symbols`,
      {
        method: "POST",
        body: JSON.stringify({ query, limit }),
      },
    ),
  workspaceReferences: (
    id: string,
    input: { path: string; content: string; line: number; character: number },
  ) =>
    json<{ items: WorkspaceLocation[] }>(
      `/api/sessions/${encodeURIComponent(id)}/workspace/references`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
  workspaceFormat: (id: string, input: { path: string; content: string }) =>
    json<{ content: string; source: string }>(
      `/api/sessions/${encodeURIComponent(id)}/workspace/format`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  workspaceOrganize: (id: string, input: { path: string; content: string }) =>
    json<{ content: string; source: string }>(
      `/api/sessions/${encodeURIComponent(id)}/workspace/organize`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  workspaceRename: (
    id: string,
    input: { path: string; content: string; line: number; character: number; newName: string },
  ) =>
    json<{ files: Array<{ path: string; content: string }> }>(
      `/api/sessions/${encodeURIComponent(id)}/workspace/rename`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  renameWorkspacePath: (id: string, from: string, to: string) =>
    json<{ from: string; path: string }>(
      `/api/sessions/${encodeURIComponent(id)}/workspace/rename-path`,
      { method: "POST", body: JSON.stringify({ from, to }) },
    ),
  workspaceOutline: (id: string, input: { path: string; content?: string }) =>
    json<{ items: WorkspaceOutlineItem[] }>(
      `/api/sessions/${encodeURIComponent(id)}/workspace/outline`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  workspaceGit: (id: string, dest?: string) =>
    json<WorkspaceGitStatus>(
      withQuery(`/api/sessions/${encodeURIComponent(id)}/workspace/git`, { dest }),
    ),
  workspaceGitBranches: (id: string, dest?: string) =>
    json<{ current: string; branches: string[]; remotes?: string[] }>(
      withQuery(`/api/sessions/${encodeURIComponent(id)}/workspace/git/branches`, { dest }),
    ),
  workspaceGitCheckout: (id: string, branch: string, create = false, dest?: string) =>
    json<WorkspaceGitStatus>(`/api/sessions/${encodeURIComponent(id)}/workspace/git/checkout`, {
      method: "POST",
      body: JSON.stringify({ branch, create, ...(dest ? { dest } : {}) }),
    }),
  workspaceGitPull: (id: string, dest?: string) =>
    json<WorkspaceGitStatus>(`/api/sessions/${encodeURIComponent(id)}/workspace/git/pull`, {
      method: "POST",
      body: dest ? JSON.stringify({ dest }) : undefined,
    }),
  workspaceGitFetch: (id: string, dest?: string) =>
    json<WorkspaceGitStatus>(`/api/sessions/${encodeURIComponent(id)}/workspace/git/fetch`, {
      method: "POST",
      body: dest ? JSON.stringify({ dest }) : undefined,
    }),
  workspaceGitDiscard: (id: string, paths: string[], dest?: string) =>
    json<WorkspaceGitStatus>(`/api/sessions/${encodeURIComponent(id)}/workspace/git/discard`, {
      method: "POST",
      body: JSON.stringify({ paths, ...(dest ? { dest } : {}) }),
    }),
  workspaceGitStashList: (id: string, dest?: string) =>
    json<{ items: WorkspaceGitStash[] }>(
      withQuery(`/api/sessions/${encodeURIComponent(id)}/workspace/git/stash`, { dest }),
    ),
  workspaceGitStash: (
    id: string,
    action: "push" | "pop" | "apply" | "drop",
    message?: string,
    index?: number,
    dest?: string,
  ) =>
    json<WorkspaceGitStatus>(`/api/sessions/${encodeURIComponent(id)}/workspace/git/stash`, {
      method: "POST",
      body: JSON.stringify({ action, message, index, ...(dest ? { dest } : {}) }),
    }),
  workspaceGitHunks: (id: string, path?: string, dest?: string) =>
    json<{ items: WorkspaceGitHunk[] }>(
      withQuery(`/api/sessions/${encodeURIComponent(id)}/workspace/git/hunks`, { path, dest }),
    ),
  workspaceGitHunk: (id: string, patch: string, unstage = false, dest?: string) =>
    json<WorkspaceGitStatus>(`/api/sessions/${encodeURIComponent(id)}/workspace/git/hunk`, {
      method: "POST",
      body: JSON.stringify({ patch, unstage, ...(dest ? { dest } : {}) }),
    }),
  workspaceGitRebasePreview: (id: string, dest?: string) =>
    json<WorkspaceGitRebaseStatus>(
      withQuery(`/api/sessions/${encodeURIComponent(id)}/workspace/git/rebase`, { dest }),
    ),
  workspaceGitRebase: (
    id: string,
    input: {
      onto?: string;
      todos?: WorkspaceGitRebaseTodo[];
      action?: "continue" | "abort" | "skip";
      dest?: string;
    },
  ) =>
    json<WorkspaceGitStatus>(`/api/sessions/${encodeURIComponent(id)}/workspace/git/rebase`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  workspaceGitPullInfo: (id: string, dest?: string) =>
    json<{
      pull: { number: number; title: string; url: string; headRef: string } | null;
      repoId: string | null;
      branch?: string;
      error?: string;
    }>(withQuery(`/api/sessions/${encodeURIComponent(id)}/workspace/git/pr`, { dest })),
  workspaceFix: (
    id: string,
    input: { path: string; content: string; line: number; character: number },
  ) =>
    json<{
      items: Array<{
        title: string;
        files: Array<{ path: string; content: string }>;
        fixAll?: boolean;
      }>;
    }>(`/api/sessions/${encodeURIComponent(id)}/workspace/fix`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  workspaceProblems: (id: string, files: Array<{ path: string; content: string }>) =>
    json<{ diagnostics: WorkspaceDiagnostic[] }>(
      `/api/sessions/${encodeURIComponent(id)}/workspace/problems`,
      { method: "POST", body: JSON.stringify({ files }) },
    ),
  workspaceDebug: (id: string) =>
    json<WorkspaceDebugState>(`/api/sessions/${encodeURIComponent(id)}/workspace/debug`),
  workspaceDebugBreakpoints: (
    id: string,
    input: { path?: string; line?: number; breakpoints?: Array<{ path: string; line: number }> },
  ) =>
    json<WorkspaceDebugState>(
      `/api/sessions/${encodeURIComponent(id)}/workspace/debug/breakpoints`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  workspaceDebugStart: (id: string, program: string) =>
    json<WorkspaceDebugState>(`/api/sessions/${encodeURIComponent(id)}/workspace/debug/start`, {
      method: "POST",
      body: JSON.stringify({ program }),
    }),
  workspaceDebugCommand: (
    id: string,
    action: "continue" | "stepOver" | "stepInto" | "stepOut" | "stop",
  ) =>
    json<WorkspaceDebugState>(`/api/sessions/${encodeURIComponent(id)}/workspace/debug/command`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),
  workspaceDebugStop: (id: string) =>
    json<WorkspaceDebugState>(`/api/sessions/${encodeURIComponent(id)}/workspace/debug/stop`, {
      method: "POST",
    }),
  workspaceIndent: (id: string, path: string) =>
    json<{ indent?: string | null; tabSize?: number } | null>(
      `/api/sessions/${encodeURIComponent(id)}/workspace/indent?path=${encodeURIComponent(path)}`,
    ),
  workspaceGitStage: (id: string, paths: string[], unstage = false, dest?: string) =>
    json<WorkspaceGitStatus>(`/api/sessions/${encodeURIComponent(id)}/workspace/git/stage`, {
      method: "POST",
      body: JSON.stringify({ paths, unstage, ...(dest ? { dest } : {}) }),
    }),
  workspaceGitCommit: (id: string, message: string, dest?: string) =>
    json<WorkspaceGitStatus>(`/api/sessions/${encodeURIComponent(id)}/workspace/git/commit`, {
      method: "POST",
      body: JSON.stringify({ message, ...(dest ? { dest } : {}) }),
    }),
  workspaceBlame: (id: string, path: string, line: number, dest?: string) =>
    json<WorkspaceBlameLine | null>(
      withQuery(`/api/sessions/${encodeURIComponent(id)}/workspace/git/blame`, {
        path,
        line,
        dest,
      }),
    ),
  workspaceBlameFile: (id: string, path: string, dest?: string) =>
    json<{ items: WorkspaceBlameLine[] }>(
      withQuery(`/api/sessions/${encodeURIComponent(id)}/workspace/git/blame-file`, {
        path,
        dest,
      }),
    ),
  workspaceGitMerge: (
    id: string,
    input: { branch?: string; action?: "continue" | "abort"; dest?: string },
  ) =>
    json<WorkspaceGitStatus>(`/api/sessions/${encodeURIComponent(id)}/workspace/git/merge`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  workspaceGitConflict: (id: string, path: string, side: "ours" | "theirs", dest?: string) =>
    json<WorkspaceGitStatus>(`/api/sessions/${encodeURIComponent(id)}/workspace/git/conflict`, {
      method: "POST",
      body: JSON.stringify({ path, side, ...(dest ? { dest } : {}) }),
    }),
  promoteIdeToDocker: (id: string, runtime: "docker" | "host" = "docker") =>
    json<AgentSession>(`/api/sessions/${encodeURIComponent(id)}/promote-docker`, {
      method: "POST",
      body: JSON.stringify({ runtime }),
    }),
  workspaceIndexStatus: (id: string) =>
    json<WorkspaceIndexStatus>(`/api/sessions/${encodeURIComponent(id)}/workspace/index`),
  workspaceIndex: (id: string, force = false) =>
    json<WorkspaceIndexStatus>(`/api/sessions/${encodeURIComponent(id)}/workspace/index`, {
      method: "POST",
      body: JSON.stringify({ force }),
    }),
  mkdirWorkspace: (id: string, path: string) =>
    json<{ path: string }>(`/api/sessions/${encodeURIComponent(id)}/workspace/mkdir`, {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  revealWorkspace: (id: string, path: string) =>
    json<{ path: string }>(`/api/sessions/${encodeURIComponent(id)}/workspace/reveal`, {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  deleteWorkspaceFile: (id: string, path: string) =>
    json<{ path: string }>(
      `/api/sessions/${encodeURIComponent(id)}/workspace/file?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    ),
  designComment: (
    id: string,
    comment: { selector: string; text?: string; viewport: "desktop" | "tablet" | "phone" },
  ) =>
    json<AgentSession>(`/api/sessions/${id}/design-comment`, {
      method: "POST",
      body: JSON.stringify(comment),
    }),
  startVm: (id: string) => json<VmInstance>(`/api/sessions/${id}/vm/start`, { method: "POST" }),
  stopVm: (id: string) => json(`/api/sessions/${id}/vm/stop`, { method: "POST" }),
  pauseVm: (id: string) => json<VmInstance>(`/api/sessions/${id}/vm/pause`, { method: "POST" }),
  resumeVm: (id: string) => json<VmInstance>(`/api/sessions/${id}/vm/resume`, { method: "POST" }),
  vmLogs: (id: string) => json<{ text: string }>(`/api/sessions/${id}/vm/logs`),
  debugLogs: () => json<{ sources: DebugLogSource[] }>("/api/debug/logs"),
  debugLog: (kind: DebugLogKind, key: string) =>
    json<DebugLogDetail>(`/api/debug/logs/${encodeURIComponent(kind)}/${encodeURIComponent(key)}`),
  saveTraceEval: (kind: DebugLogKind, key: string) =>
    json<{ path: string; fixture: TraceEvalCase }>(
      `/api/debug/logs/${encodeURIComponent(kind)}/${encodeURIComponent(key)}/eval`,
      { method: "POST" },
    ),
  vms: () => json<VmInstance[]>("/api/vms"),
  dockerStatus: () => json<DockerDaemonStatus>("/api/docker/status"),
  dockerContainers: () =>
    json<{ kind: "mock" | "docker"; containers: DockerContainer[] }>("/api/docker/containers"),
  dockerContainer: (id: string) =>
    json<DockerContainer>(`/api/docker/containers/${encodeURIComponent(id)}`),
  dockerContainerAction: (id: string, action: "start" | "stop" | "restart") =>
    json<DockerContainer>(`/api/docker/containers/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
    }),
  dockerContainersStop: (ids: string[]) =>
    json<DockerBulkStopResult>("/api/docker/containers/stop", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  dockerContainerLogs: (id: string, tail?: number) =>
    json<{ text: string }>(
      `/api/docker/containers/${encodeURIComponent(id)}/logs${tail ? `?tail=${tail}` : ""}`,
    ),
  dockerContainerStats: (id: string) =>
    json<DockerContainerStats>(`/api/docker/containers/${encodeURIComponent(id)}/stats`),
  dockerSwarm: () => json<DockerSwarmSnapshot & { kind: "mock" | "docker" }>("/api/docker/swarm"),
  dockerSwarmService: (id: string) =>
    json<DockerSwarmServiceDetail>(`/api/docker/swarm/services/${encodeURIComponent(id)}`),
  dockerSwarmLogs: (id: string, tail?: number) =>
    json<{ text: string }>(
      `/api/docker/swarm/services/${encodeURIComponent(id)}/logs${tail ? `?tail=${tail}` : ""}`,
    ),
  dockerSwarmScale: (id: string, replicas: number) =>
    json<DockerSwarmService>(`/api/docker/swarm/services/${encodeURIComponent(id)}/scale`, {
      method: "POST",
      body: JSON.stringify({ replicas }),
    }),
  tools: (os: GuestOs) => json<ToolSpec[]>(`/api/tools/${os}`),
  execTool: (id: string, name: string, args: Record<string, unknown> = {}) =>
    json<{ ok: boolean; output: string; screenshotBase64?: string; recordingName?: string }>(
      `/api/sessions/${id}/tools`,
      {
        method: "POST",
        body: JSON.stringify({ name, args }),
      },
    ),
  automations: () => json<Automation[]>("/api/automations"),
  automation: (id: string) => json<Automation>(`/api/automations/${id}`),
  createAutomation: (input: CreateAutomationInput) =>
    json<Automation>("/api/automations", { method: "POST", body: JSON.stringify(input) }),
  patchAutomation: (id: string, input: PatchAutomationInput) =>
    json<Automation>(`/api/automations/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  deleteAutomation: (id: string) => json(`/api/automations/${id}`, { method: "DELETE" }),
  boards: () => json<BoardSummary[]>("/api/boards"),
  board: (id: string) => json<BoardDocument>(`/api/boards/${id}`),
  createBoard: (input: { title?: string; starter?: BoardStarter; prompt?: string } = {}) =>
    json<BoardDocument>("/api/boards", { method: "POST", body: JSON.stringify(input) }),
  patchBoard: (
    id: string,
    input: Partial<BoardDocument> & { title?: string; archived?: boolean },
  ) => json<BoardDocument>(`/api/boards/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  deleteBoard: (id: string) => json(`/api/boards/${id}`, { method: "DELETE" }),
  projects: () => json<ProjectSummary[]>("/api/projects"),
  project: (id: string) => json<ProjectDocument>(`/api/projects/${id}`),
  createProject: (input: CreateProjectInput = {}) =>
    json<ProjectDocument>("/api/projects", { method: "POST", body: JSON.stringify(input) }),
  patchProject: (id: string, input: PatchProjectInput) =>
    json<ProjectDocument>(`/api/projects/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  deleteProject: (id: string) => json(`/api/projects/${id}`, { method: "DELETE" }),
  duplicateProject: (id: string) =>
    json<ProjectDocument>(`/api/projects/${id}/duplicate`, { method: "POST" }),
  addProjectMember: (id: string, sessionId: string) =>
    json<{ project: ProjectDocument; session: AgentSession }>(`/api/projects/${id}/members`, {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),
  projectChat: (id: string, prompt?: string) =>
    json<{ project: ProjectDocument; sessionId: string }>(`/api/projects/${id}/chat`, {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),
  projectContext: (id: string) => json<ProjectContextEntry[]>(`/api/projects/${id}/context`),
  projectContextRead: (id: string, path: string) =>
    json<{ path: string; content: string }>(
      `/api/projects/${id}/context/file?path=${encodeURIComponent(path)}`,
    ),
  projectContextWrite: (id: string, path: string, content: string) =>
    json<{ path: string }>(`/api/projects/${id}/context/file`, {
      method: "PUT",
      body: JSON.stringify({ path, content }),
    }),
  projectMissionControl: (id: string) =>
    json<{
      project: ProjectDocument;
      members: Array<{
        id: string;
        name: string;
        role?: string;
        capabilities: string[];
        status: string;
        needsHuman?: string;
        pull?: AgentSession["pull"];
        computer: {
          runtime?: AgentSession["runtime"];
          vmId?: string;
          status: string;
          control?: AgentSession["control"];
        };
        artifacts: number;
        column: string;
      }>;
      needsYou: ProjectDocument["needsYou"];
      handoffs: SwarmTeamHandoff[];
      health: "healthy" | "attention" | "paused";
      routines: AgentSession["subscriptions"];
      context: ProjectContextEntry[];
      audit: ProjectDocument["audit"];
      spendUsd: number;
    }>(`/api/projects/${id}/mission-control`),
  projectNeedAction: (id: string, needId: string, action: SwarmNeedAction, response?: string) =>
    json<ProjectDocument>(`/api/projects/${id}/needs/${needId}/action`, {
      method: "POST",
      body: JSON.stringify({ action, response }),
    }),
  projectHandoffs: (id: string) => json<SwarmTeamHandoff[]>(`/api/projects/${id}/handoffs`),
  createProjectHandoff: (
    id: string,
    input: { targetTeamId: string; targetMemberId?: string; task: string },
  ) =>
    json<SwarmTeamHandoff>(`/api/projects/${id}/handoffs`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  projectHandoffAction: (
    id: string,
    handoffId: string,
    action: SwarmTeamHandoffAction,
    response?: string,
  ) =>
    json<SwarmTeamHandoff>(`/api/projects/${id}/handoffs/${handoffId}/action`, {
      method: "POST",
      body: JSON.stringify({ action, response }),
    }),
  brain: () => json<BrainDocument>("/api/brain"),
  brainStatus: () => json<BrainSummary>("/api/brain/status"),
  brainBuild: (input: { path?: string; repo?: string } = {}) =>
    json<BrainDocument & { output?: string }>("/api/brain/build", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  brainRemember: (text: string, repo?: string) =>
    json<BrainDocument & { output?: string }>("/api/brain/remember", {
      method: "POST",
      body: JSON.stringify({ text, ...(repo ? { repo } : {}) }),
    }),
  brainBrief: (input: {
    issue: string;
    target?: "jira" | "linear";
    title?: string;
    summary?: string;
    body?: string;
    post?: boolean;
  }) =>
    json<{
      ok: true;
      issue: string;
      target: "jira" | "linear";
      title?: string;
      body: string;
      output?: string;
    }>("/api/brain/brief", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  brainSearch: (q: string) =>
    json<{ output: string }>("/api/brain/search", {
      method: "POST",
      body: JSON.stringify({ q }),
    }),
  brainExport: () =>
    json<BrainDocument & { path?: string }>("/api/brain/export", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  brainIngest: (paused: boolean) =>
    json<BrainDocument & { brain?: LocusConfig["brain"] }>("/api/brain/ingest", {
      method: "POST",
      body: JSON.stringify({ paused }),
    }),
  brainCorrect: (input: {
    nodeId?: string;
    memoryId?: string;
    reason?: string;
    claim?: string;
    id?: string;
    action?: "accepted" | "dismissed";
  }) =>
    json<BrainDocument & { output?: string }>("/api/brain/correct", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  brainCorpus: () =>
    json<BrainDocument & { output?: string; added?: number }>("/api/brain/corpus", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  duplicateBoard: (id: string) =>
    json<BoardDocument>(`/api/boards/${id}/duplicate`, { method: "POST" }),
  upsertBoardObjects: (id: string, objects: BoardDocument["objects"]) =>
    json<BoardDocument>(`/api/boards/${id}/objects`, {
      method: "POST",
      body: JSON.stringify({ objects }),
    }),
  addBoardComment: (id: string, objectId: string, body: string) =>
    json<BoardDocument>(`/api/boards/${id}/comments`, {
      method: "POST",
      body: JSON.stringify({ objectId, body }),
    }),
  resolveBoardComment: (id: string, commentId: string) =>
    json<BoardDocument>(`/api/boards/${id}/comments/${commentId}/resolve`, { method: "POST" }),
  boardChat: (id: string, prompt?: string) =>
    json<{ board: BoardDocument; sessionId: string }>(`/api/boards/${id}/chat`, {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),
  runBoardFrame: (id: string, frameId: string, target: BoardRunTarget) =>
    json<{ board: BoardDocument; sessionId: string }>(`/api/boards/${id}/run-frame`, {
      method: "POST",
      body: JSON.stringify({ frameId, target }),
    }),
  pinBoardPlan: (id: string, frameId: string, sessionId: string) =>
    json<BoardDocument>(`/api/boards/${id}/pin-plan`, {
      method: "POST",
      body: JSON.stringify({ frameId, sessionId }),
    }),
  exportBoard: (id: string) => json<BoardDocument>(`/api/boards/${id}/export`),
  uploadBoardAsset: async (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file, file.name);
    const res = await apiFetch(`/api/boards/${encodeURIComponent(id)}/assets`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) throw new HttpError(await errorMessageFromResponse(res), res.status);
    return (await res.json()) as { assetId: string; mime: string };
  },
  automationRuns: (id?: string, opts?: { limit?: number; offset?: number }) => {
    const base = id ? `/api/automations/${id}/runs` : "/api/automation-runs";
    const params = new URLSearchParams();
    if (typeof opts?.limit === "number" && Number.isFinite(opts.limit) && opts.limit > 0) {
      params.set("limit", String(Math.floor(opts.limit)));
    }
    if (typeof opts?.offset === "number" && Number.isFinite(opts.offset) && opts.offset > 0) {
      params.set("offset", String(Math.floor(opts.offset)));
    }
    const query = params.toString();
    return json<AutomationRun[]>(query ? `${base}?${query}` : base);
  },
  runAutomation: (id: string, body?: { runId?: string }) =>
    json<AutomationRun>(`/api/automations/${id}/run`, {
      method: "POST",
      ...(body?.runId ? { body: JSON.stringify({ runId: body.runId }) } : {}),
    }),
  stopAutomation: (id: string) =>
    json<{ ok: true; run?: AutomationRun }>(`/api/automations/${id}/stop`, { method: "POST" }),
  cloneAutomation: (id: string) =>
    json<Automation>(`/api/automations/${id}/clone`, { method: "POST" }),
  testAutomationWebhook: (id: string) =>
    json<AutomationRun>(`/api/automations/${id}/test-webhook`, { method: "POST" }),
  repos: () => json<LinkedRepo[]>("/api/repos"),
  linkRepo: (input: CreateLinkedRepoInput) =>
    json<LinkedRepo>("/api/repos", { method: "POST", body: JSON.stringify(input) }),
  importRepos: () =>
    json<{ accounts: ForgeImportAccount[] }>("/api/repos/import", { method: "POST" }),
  repo: (id: string) => json<LinkedRepo>(`/api/repos/${id}`),
  repoBranches: (id: string) => json<RepoBranchList>(`/api/repos/${id}/branches`),
  patchRepo: (id: string, input: PatchLinkedRepoInput) =>
    json<LinkedRepo>(`/api/repos/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteRepo: async (id: string) => {
    const result = await json(`/api/repos/${id}`, { method: "DELETE" });
    clearPullCaches(id);
    clearIssueCaches(id);
    return result;
  },
  refreshRepo: async (id: string) => {
    invalidatePullLists(id);
    invalidateIssueLists(id);
    return json<LinkedRepo>(`/api/repos/${id}/refresh`, { method: "POST" });
  },
  repoPulls: (id: string, state: PullListState = "open", opts?: { fresh?: boolean }) =>
    repoPullsCached(id, state, opts),
  repoPull: (id: string, number: number, opts?: { fresh?: boolean }) =>
    repoPullCached(id, number, opts),
  repoIssues: (id: string, state: IssueListState = "open", opts?: { fresh?: boolean }) =>
    repoIssuesCached(id, state, opts),
  repoIssue: (id: string, number: number, opts?: { fresh?: boolean }) =>
    repoIssueCached(id, number, opts),
  commentIssue: async (id: string, number: number, input: { body: string }) =>
    rememberMutatedIssue(
      id,
      number,
      await json<IssueDetail>(`/api/repos/${id}/issues/${number}/comments`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ),
  commentPull: async (
    id: string,
    number: number,
    input: { body: string; path?: string; line?: number; side?: "LEFT" | "RIGHT" },
  ) =>
    rememberMutatedPull(
      id,
      number,
      await json<PullRequestDetail>(`/api/repos/${id}/pulls/${number}/comments`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ),
  reviewPull: async (
    id: string,
    number: number,
    input: { body: string; event?: "COMMENT" | "APPROVE" | "REQUEST_CHANGES" },
  ) =>
    rememberMutatedPull(
      id,
      number,
      await json<PullRequestDetail>(`/api/repos/${id}/pulls/${number}/reviews`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ),
  mergePull: async (id: string, number: number) =>
    rememberMutatedPull(
      id,
      number,
      await json<PullRequestDetail>(`/api/repos/${id}/pulls/${number}/merge`, { method: "POST" }),
    ),
  setPullFileViewed: async (id: string, number: number, path: string, viewed: boolean) =>
    rememberMutatedPull(
      id,
      number,
      await json<PullRequestDetail>(`/api/repos/${id}/pulls/${number}/files/viewed`, {
        method: "PUT",
        body: JSON.stringify({ path, viewed }),
      }),
    ),
  repoPullLoadPath: (id: string, number: number) =>
    json<LoadPathReview>(`/api/repos/${id}/pulls/${number}/loadpath`),
  patchPullLoadPath: (id: string, number: number, input: { notes: string }) =>
    json<LoadPathReview>(`/api/repos/${id}/pulls/${number}/loadpath`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  repoPullChangeStack: (
    id: string,
    number: number,
    opts: { fresh?: boolean; sha?: string } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.fresh) params.set("fresh", "1");
    if (opts.sha) params.set("sha", opts.sha);
    const query = params.toString();
    return json<ChangeStack>(
      `/api/repos/${id}/pulls/${number}/changestack${query ? `?${query}` : ""}`,
    );
  },
  listPullChangeStackRevisions: (id: string, number: number) =>
    json<{ revisions: ChangeStackRevision[] }>(
      `/api/repos/${id}/pulls/${number}/changestack/revisions`,
    ),
  refreshPullChangeStack: (id: string, number: number) =>
    json<ChangeStack>(`/api/repos/${id}/pulls/${number}/changestack`, { method: "POST" }),
  summarizePullChangeStack: (id: string, number: number) =>
    json<ChangeStack>(`/api/repos/${id}/pulls/${number}/changestack`, {
      method: "POST",
      body: JSON.stringify({ fresh: false }),
    }),
  startRepoAgent: (id: string, input: Partial<CreateSessionInput> & { reuse?: boolean } = {}) =>
    json<AgentSession>(`/api/repos/${id}/agents`, { method: "POST", body: JSON.stringify(input) }),
  startSetupSession: (id: string) =>
    json<AgentSession>(`/api/repos/${id}/setup-environment`, { method: "POST" }),
  repoArchitecture: (id: string) => json<ArchitectureAnalysis>(`/api/repos/${id}/architecture`),
  suggestArchitecture: (id: string, input: { scope: ArchScope; target?: string }) =>
    json<AgentSession>(`/api/repos/${id}/architecture/suggest`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  startReviewSession: (id: string, number: number) =>
    json<AgentSession>(`/api/repos/${id}/pulls/${number}/review-session`, { method: "POST" }),
  startFixSession: (id: string, number: number) =>
    json<AgentSession>(`/api/repos/${id}/pulls/${number}/fix-session`, { method: "POST" }),
  slackStatus: () => json<SlackStatus>("/api/slack/status"),
  slackConversations: (refresh = false) =>
    json<SlackConversation[]>(`/api/slack/conversations${refresh ? "?refresh=1" : ""}`),
  slackStar: (id: string, starred: boolean) =>
    json<SlackConversation[]>(`/api/slack/conversations/${encodeURIComponent(id)}/star`, {
      method: "POST",
      body: JSON.stringify({ starred }),
    }),
  slackEmoji: (refresh = false) =>
    json<Record<string, string>>(`/api/slack/emoji${refresh ? "?refresh=1" : ""}`),
  slackUnwatch: () => json<{ ok: true }>("/api/slack/unwatch", { method: "POST" }),
  slackHistory: (id: string, opts: { oldest?: string; latest?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.oldest) params.set("oldest", opts.oldest);
    if (opts.latest) params.set("latest", opts.latest);
    const qs = params.toString();
    return json<SlackMessage[]>(
      `/api/slack/conversations/${encodeURIComponent(id)}/history${qs ? `?${qs}` : ""}`,
    );
  },
  slackReplies: (id: string, ts: string) =>
    json<SlackMessage[]>(
      `/api/slack/conversations/${encodeURIComponent(id)}/replies?ts=${encodeURIComponent(ts)}`,
    ),
  slackPost: (
    id: string,
    text: string,
    threadTs?: string,
    gif?: { url: string; title?: string },
    as?: SlackPostAs,
    replyBroadcast?: boolean,
  ) =>
    json<SlackMessage>(`/api/slack/conversations/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text, threadTs, gif, as, replyBroadcast }),
    }),
  slackUpdate: (id: string, ts: string, text: string, as?: SlackPostAs) =>
    json<SlackMessage>(`/api/slack/conversations/${encodeURIComponent(id)}/messages`, {
      method: "PATCH",
      body: JSON.stringify({ ts, text, as }),
    }),
  slackDelete: (id: string, ts: string, as?: SlackPostAs) =>
    json<SlackMessage>(
      `/api/slack/conversations/${encodeURIComponent(id)}/messages?ts=${encodeURIComponent(ts)}${as === "bot" ? "&as=bot" : ""}`,
      { method: "DELETE" },
    ),
  slackMarkRead: (id: string, ts?: string) =>
    json<SlackConversation[]>(`/api/slack/conversations/${encodeURIComponent(id)}/read`, {
      method: "POST",
      body: JSON.stringify({ ts }),
    }),
  slackUpload: async (
    id: string,
    file: File,
    opts: { comment?: string; threadTs?: string; as?: SlackPostAs } = {},
  ) => {
    const form = new FormData();
    form.append("file", file, file.name);
    if (opts.comment) form.append("comment", opts.comment);
    if (opts.threadTs) form.append("threadTs", opts.threadTs);
    if (opts.as) form.append("as", opts.as);
    const res = await apiFetch(`/api/slack/conversations/${encodeURIComponent(id)}/files`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) throw new HttpError(await errorMessageFromResponse(res), res.status);
    return (await res.json()) as SlackMessage;
  },
  slackReact: (
    id: string,
    ts: string,
    name: string,
    opts: { remove?: boolean; threadTs?: string } = {},
  ) =>
    json<SlackMessage>(`/api/slack/conversations/${encodeURIComponent(id)}/reactions`, {
      method: "POST",
      body: JSON.stringify({ ts, name, remove: opts.remove, threadTs: opts.threadTs }),
    }),
  slackGiphy: (query = "") =>
    json<SlackGifSearch>(
      `/api/slack/giphy${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`,
    ),
  slackRun: (input: SlackRunInput) =>
    json<{ sessionId: string; created: boolean }>("/api/slack/run", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  slackSearch: (query: string) =>
    json<SlackSearchHit[]>(`/api/slack/search?q=${encodeURIComponent(query.trim())}`),
  slackActivity: () => json<SlackActivityItem[]>("/api/slack/activity"),
  startSlackOauth: (
    input: {
      accountId?: string;
      oauthClientId?: string;
      oauthClientSecret?: string;
    } = {},
  ) =>
    json<{ method: "redirect"; authorizeUrl: string; expiresIn: number }>(
      "/api/slack/oauth/start",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
  slackOauthStatus: (accountId?: string) =>
    json<{
      status: "idle" | "pending" | "complete" | "error" | "expired";
      authorizeUrl?: string;
      userName?: string;
      teamName?: string;
      error?: string;
    }>(`/api/slack/oauth/status${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`),
  disconnectSlackOauth: (accountId?: string) =>
    json<{ ok: true; config: LocusConfig }>("/api/slack/oauth/disconnect", {
      method: "POST",
      body: JSON.stringify({ accountId }),
    }),
  grafanaStatus: () => json<GrafanaExplorerStatus>("/api/grafana/status"),
  grafanaRecents: () => json<GrafanaRecentQuery[]>("/api/grafana/recents"),
  grafanaDashboards: (query = "") =>
    json<GrafanaDashboardHit[]>(
      `/api/grafana/dashboards${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`,
    ),
  grafanaDashboard: (uid: string) =>
    json<GrafanaDashboardView>(`/api/grafana/dashboards/${encodeURIComponent(uid)}`),
  grafanaAlerts: () => json<GrafanaAlert[]>("/api/grafana/alerts"),
  grafanaPins: () => json<GrafanaPin[]>("/api/grafana/pins"),
  grafanaPin: (input: { uid: string; title?: string }) =>
    json<GrafanaPin[]>("/api/grafana/pins", { method: "POST", body: JSON.stringify(input) }),
  grafanaUnpin: (uid: string) =>
    json<GrafanaPin[]>(`/api/grafana/pins/${encodeURIComponent(uid)}`, { method: "DELETE" }),
  grafanaTraceHop: (input: { traceId: string }) =>
    json<GrafanaTraceHop>("/api/grafana/trace-hop", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  grafanaDashboardQuery: (
    uid: string,
    input: {
      from?: string;
      to?: string;
      panelId?: number;
      variables?: Record<string, string>;
    } = {},
  ) =>
    json<GrafanaDashboardQueryResult>(`/api/grafana/dashboards/${encodeURIComponent(uid)}/query`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  grafanaQuery: (input: {
    query: string;
    from?: string;
    to?: string;
    mode?: string;
    limit?: number;
    datasource?: string;
    explore_url_only?: boolean;
    enrich?: boolean;
  }) =>
    json<{
      lucene: string;
      explore_url: string;
      from: string;
      to: string;
      count?: number;
      histogram?: Array<{ t: number; count: number }>;
      logs?: Array<GrafanaLogHitLite & { source?: Record<string, unknown> }>;
      datasource?: { name?: string };
      trace?: GrafanaTraceResult;
      traceHop?: GrafanaTraceHop;
      links?: GrafanaRepoLink[];
    }>("/api/grafana/query", { method: "POST", body: JSON.stringify(input) }),
  grafanaTrace: (input: { logs?: GrafanaLogHitLite[]; query?: string }) =>
    json<GrafanaTraceResult>("/api/grafana/trace", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  grafanaBrief: (input: {
    logs?: GrafanaLogHitLite[];
    query?: string;
    from?: string;
    to?: string;
  }) =>
    json<GrafanaBriefing>("/api/grafana/brief", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  grafanaInvestigate: (input: {
    query: string;
    from?: string;
    to?: string;
    note?: string;
    logs?: GrafanaLogHitLite[];
    links?: GrafanaRepoLink[];
    exploreUrl?: string;
    repoId?: string;
    providerId?: string;
    model?: string;
    asLucene?: boolean;
    panelType?: string;
  }) =>
    json<{ sessionId: string; created: boolean }>("/api/grafana/investigate", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  startGoogleOauth: (
    input: {
      accountId?: string;
      oauthClientId?: string;
      oauthClientSecret?: string;
    } = {},
  ) =>
    json<{ method: "redirect"; authorizeUrl: string; expiresIn: number }>(
      "/api/google/oauth/start",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
  googleOauthStatus: (accountId?: string) =>
    json<{
      status: "idle" | "pending" | "complete" | "error" | "expired";
      authorizeUrl?: string;
      userName?: string;
      error?: string;
    }>(`/api/google/oauth/status${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`),
  disconnectGoogleOauth: (accountId?: string) =>
    json<{ ok: true; config: LocusConfig }>("/api/google/oauth/disconnect", {
      method: "POST",
      body: JSON.stringify({ accountId }),
    }),
};
