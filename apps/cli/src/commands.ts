import { readFile } from "node:fs/promises";
import { applyBrainSetup } from "./brainSetup.js";
import {
  AGENT_RECIPES,
  DESIGN_RECIPES,
  GAME_RECIPES,
  DEFAULT_DOCKER_IMAGE,
  isAgentPlacement,
  isAgentRuntime,
  isAutonomyTier,
  isGuestOs,
  GUEST_OSES,
  isPullListState,
  isSessionKind,
  isThemeId,
  parseSlackPostAs,
  recipeById,
  sessionKind,
  isProjectStarter,
  isBoardStarter,
  ASSET_POLY_BUDGETS,
  ASSET_QUALITY_TIERS,
  ASSET_RESOLUTIONS,
  ASSET_REST_POSES,
  ASSET_TOPOLOGY_MODES,
  parseAssetBuild,
  resolveAssetBuild,
  type AgentSession,
  type Automation,
  openBrainCorrections,
  type BrainDocument,
  type BrainSummary,
  type ChatMessage,
  type CreateAutomationInput,
  type CreateSessionInput,
  type LinkedRepo,
  type LocusConfig,
  type ProjectDocument,
  type ProjectSummary,
  type BoardSummary,
  type BoardDocument,
  type SessionKind,
  type SlackConversation,
  type ToolCall,
  type ClientEvent,
} from "@locus/shared";
import {
  flagBool,
  flagList,
  flagNum,
  flagStr,
  need,
  restJoin,
  UsageError,
  type Flags,
} from "./args.js";
import { LocusClient } from "./client.js";
import { formatKv, formatTable, printJson, shortId, truncate, yn } from "./format.js";
import { helpFor } from "./help.js";
import { isCompletionShell, renderCompletion } from "./completion.js";
import { startServer } from "./serve.js";
import { CLI_VERSION } from "./version.js";

export interface Ctx {
  client: LocusClient;
  flags: Flags;
  args: string[];
  json: boolean;
  write: (text: string) => void;
  writeln: (text: string) => void;
  err: (text: string) => void;
}

type Handler = (ctx: Ctx) => Promise<void>;

const ROUTES: Array<{ path: string[]; run: Handler }> = [
  { path: ["serve"], run: cmdServe },
  { path: ["status"], run: cmdStatus },
  { path: ["setup", "install-qemu"], run: cmdInstallQemu },
  { path: ["setup"], run: cmdSetup },
  { path: ["ui"], run: cmdUi },
  { path: ["events"], run: cmdEvents },
  { path: ["completion"], run: cmdCompletion },
  { path: ["help"], run: cmdHelp },
  { path: ["version"], run: cmdVersion },

  { path: ["agent", "list"], run: cmdAgentList },
  { path: ["agent", "ls"], run: cmdAgentList },
  { path: ["agent", "get"], run: cmdAgentGet },
  { path: ["agent", "show"], run: cmdAgentGet },
  { path: ["agent", "new"], run: cmdAgentNew },
  { path: ["agent", "create"], run: cmdAgentNew },
  { path: ["agent", "chat"], run: cmdAgentChat },
  { path: ["agent", "send"], run: cmdAgentChat },
  { path: ["agent", "abort"], run: cmdAgentAbort },
  { path: ["agent", "queue", "send"], run: cmdAgentQueueSend },
  { path: ["agent", "approve"], run: cmdAgentApprove },
  { path: ["agent", "deny"], run: cmdAgentDeny },
  { path: ["agent", "rewind"], run: cmdAgentRewind },
  { path: ["agent", "clear"], run: cmdAgentClear },
  { path: ["agent", "checkpoint-diff"], run: cmdCheckpointDiff },
  { path: ["agent", "memory"], run: cmdAgentMemory },
  { path: ["agent", "fork"], run: cmdAgentFork },
  { path: ["agent", "duplicate"], run: cmdAgentFork },
  { path: ["agent", "takeover"], run: cmdAgentTakeover },
  { path: ["agent", "handback"], run: cmdAgentHandback },
  { path: ["agent", "browser-takeover"], run: cmdAgentBrowserTakeover },
  { path: ["agent", "browser-handback"], run: cmdAgentBrowserHandback },
  { path: ["agent", "undo"], run: cmdAgentUndo },
  { path: ["agent", "save-environment"], run: cmdAgentSaveEnvironment },
  { path: ["agent", "delete"], run: cmdAgentDelete },
  { path: ["agent", "rm"], run: cmdAgentDelete },
  { path: ["agent", "pin"], run: (ctx) => cmdAgentPatch(ctx, { pinned: true }) },
  { path: ["agent", "unpin"], run: (ctx) => cmdAgentPatch(ctx, { pinned: false }) },
  { path: ["agent", "archive"], run: (ctx) => cmdAgentPatch(ctx, { archived: true }) },
  { path: ["agent", "unarchive"], run: (ctx) => cmdAgentPatch(ctx, { archived: false }) },
  { path: ["agent", "rename"], run: cmdAgentRename },
  { path: ["agent", "workers", "spawn"], run: cmdWorkersSpawn },
  { path: ["agent", "workers", "diff"], run: cmdWorkersDiff },
  { path: ["agent", "workers", "merge"], run: cmdWorkersMerge },
  { path: ["agent", "role", "cycle"], run: cmdRoleCycle },
  { path: ["agent", "promote"], run: cmdPromote },
  { path: ["agent", "canvas"], run: cmdAgentCanvas },
  { path: ["agent", "preview"], run: cmdPreview },
  { path: ["agent", "workspace", "tree"], run: cmdWorkspaceTree },
  { path: ["agent", "workspace", "cat"], run: cmdWorkspaceCat },
  { path: ["agent", "workspace", "write"], run: cmdWorkspaceWrite },
  { path: ["agent", "workspace", "grep"], run: cmdWorkspaceGrep },
  { path: ["agent", "workspace", "search"], run: cmdWorkspaceSearch },
  { path: ["agent", "workspace", "mkdir"], run: cmdWorkspaceMkdir },
  { path: ["agent", "workspace", "git"], run: cmdWorkspaceGit },
  { path: ["agent", "tool"], run: cmdTool },
  { path: ["agent", "vm", "start"], run: (ctx) => cmdVm(ctx, "start") },
  { path: ["agent", "vm", "stop"], run: (ctx) => cmdVm(ctx, "stop") },
  { path: ["agent", "vm", "pause"], run: (ctx) => cmdVm(ctx, "pause") },
  { path: ["agent", "vm", "resume"], run: (ctx) => cmdVm(ctx, "resume") },
  { path: ["agent", "vm", "logs"], run: cmdVmLogs },
  { path: ["agent", "transcript"], run: cmdTranscript },
  { path: ["agent", "logs"], run: cmdTranscript },
  { path: ["agent", "recipes"], run: cmdRecipes },
  { path: ["session"], run: cmdAgentHelp },
  { path: ["sessions"], run: cmdAgentList },
  { path: ["agent"], run: cmdAgentHelp },

  {
    path: ["design", "list"],
    run: (ctx) => cmdAgentList({ ...ctx, flags: { ...ctx.flags, kind: "design" } }),
  },
  {
    path: ["design", "new"],
    run: (ctx) =>
      cmdAgentNew({ ...ctx, flags: { ...ctx.flags, kind: ctx.flags.kind ?? "design" } }),
  },
  { path: ["design", "get"], run: cmdAgentGet },
  { path: ["design", "canvas"], run: cmdCanvas },
  { path: ["design", "comment"], run: cmdDesignComment },
  { path: ["design", "promote"], run: cmdPromote },
  { path: ["design", "fork"], run: cmdAgentFork },
  { path: ["design", "duplicate"], run: cmdAgentFork },
  { path: ["design", "variant", "list"], run: cmdVariantList },
  { path: ["design", "variant", "create"], run: cmdVariantCreate },
  { path: ["design", "variant", "activate"], run: cmdVariantActivate },
  { path: ["design", "variant", "rename"], run: cmdVariantRename },
  { path: ["design", "variant", "delete"], run: cmdVariantDelete },
  { path: ["design", "systems", "list"], run: cmdSystemsList },
  { path: ["design", "systems", "get"], run: cmdSystemsGet },
  { path: ["design", "systems", "create"], run: cmdSystemsCreate },
  { path: ["design", "systems", "import"], run: cmdSystemsImport },
  { path: ["design", "systems", "delete"], run: cmdSystemsDelete },
  { path: ["design", "systems", "default"], run: cmdSystemsDefault },
  { path: ["design"], run: cmdDesignHelp },

  {
    path: ["game", "list"],
    run: (ctx) => cmdAgentList({ ...ctx, flags: { ...ctx.flags, kind: "game" } }),
  },
  {
    path: ["game", "new"],
    run: (ctx) => cmdAgentNew({ ...ctx, flags: { ...ctx.flags, kind: ctx.flags.kind ?? "game" } }),
  },
  { path: ["game", "get"], run: cmdAgentGet },
  { path: ["game", "canvas"], run: cmdCanvas },
  { path: ["game", "comment"], run: cmdDesignComment },
  { path: ["game", "promote"], run: cmdPromote },
  { path: ["game", "fork"], run: cmdAgentFork },
  { path: ["game", "duplicate"], run: cmdAgentFork },
  { path: ["game", "link"], run: cmdGameLink },
  { path: ["game", "assets"], run: cmdGameAssets },
  { path: ["game", "play-link"], run: cmdGamePlayLink },
  { path: ["game", "generate"], run: cmdGameGenerate },
  { path: ["game", "styles", "list"], run: cmdGameStylesList },
  { path: ["game", "styles", "create"], run: cmdGameStylesCreate },
  { path: ["game", "styles", "save"], run: cmdGameStylesSave },
  { path: ["game", "styles", "delete"], run: cmdGameStylesDelete },
  { path: ["game", "styles", "default"], run: cmdGameStylesDefault },
  { path: ["game"], run: cmdGameHelp },

  {
    path: ["asset", "list"],
    run: (ctx) => cmdAgentList({ ...ctx, flags: { ...ctx.flags, kind: "assets" } }),
  },
  {
    path: ["asset", "new"],
    run: (ctx) =>
      cmdAgentNew({ ...ctx, flags: { ...ctx.flags, kind: ctx.flags.kind ?? "assets" } }),
  },
  { path: ["asset", "get"], run: cmdAgentGet },
  { path: ["asset", "canvas"], run: cmdCanvas },
  { path: ["asset", "comment"], run: cmdDesignComment },
  { path: ["asset", "promote"], run: cmdPromote },
  { path: ["asset", "fork"], run: cmdAgentFork },
  { path: ["asset", "duplicate"], run: cmdAgentFork },
  { path: ["asset", "pack"], run: cmdAssetPack },
  { path: ["asset", "styles", "list"], run: cmdAssetStylesList },
  { path: ["asset", "styles", "create"], run: cmdAssetStylesCreate },
  { path: ["asset", "styles", "save"], run: cmdAssetStylesSave },
  { path: ["asset", "styles", "delete"], run: cmdAssetStylesDelete },
  { path: ["asset", "styles", "default"], run: cmdAssetStylesDefault },
  { path: ["asset"], run: cmdAssetHelp },

  {
    path: ["ide", "new"],
    run: cmdIdeNew,
  },
  { path: ["ide", "create"], run: cmdIdeNew },
  { path: ["ide"], run: cmdIdeHelp },

  { path: ["repo", "list"], run: cmdRepoList },
  { path: ["repo", "get"], run: cmdRepoGet },
  { path: ["repo", "link"], run: cmdRepoLink },
  { path: ["repo", "import"], run: cmdRepoImport },
  { path: ["repo", "refresh"], run: cmdRepoRefresh },
  { path: ["repo", "delete"], run: cmdRepoDelete },
  { path: ["repo", "patch"], run: cmdRepoPatch },
  { path: ["repo", "pulls"], run: cmdRepoPulls },
  { path: ["repo", "pull"], run: cmdRepoPull },
  { path: ["repo", "comment"], run: cmdRepoComment },
  { path: ["repo", "review"], run: cmdRepoReview },
  { path: ["repo", "merge"], run: cmdRepoMerge },
  { path: ["repo", "agent"], run: cmdRepoAgent },
  { path: ["repo", "setup"], run: cmdRepoSetup },
  { path: ["repo", "fix-session"], run: cmdRepoFixSession },
  { path: ["repo", "review-session"], run: cmdRepoReviewSession },
  { path: ["repo", "stack"], run: cmdRepoStack },
  { path: ["repo", "stack", "create"], run: cmdRepoStackCreate },
  { path: ["codebase"], run: cmdRepoHelp },
  { path: ["repo"], run: cmdRepoHelp },

  { path: ["slack", "status"], run: cmdSlackStatus },
  { path: ["slack", "login"], run: cmdSlackLogin },
  { path: ["slack", "logout"], run: cmdSlackLogout },
  { path: ["slack", "channels"], run: cmdSlackChannels },
  { path: ["slack", "star"], run: (ctx) => cmdSlackStar(ctx, true) },
  { path: ["slack", "unstar"], run: (ctx) => cmdSlackStar(ctx, false) },
  { path: ["slack", "history"], run: cmdSlackHistory },
  { path: ["slack", "replies"], run: cmdSlackReplies },
  { path: ["slack", "send"], run: cmdSlackSend },
  { path: ["slack", "react"], run: cmdSlackReact },
  { path: ["slack", "gif"], run: cmdSlackGif },
  { path: ["slack", "ask"], run: cmdSlackAsk },
  { path: ["slack"], run: cmdSlackHelp },

  { path: ["grafana", "status"], run: cmdGrafanaStatus },
  { path: ["grafana", "dashboards"], run: cmdGrafanaDashboards },
  { path: ["grafana", "get"], run: cmdGrafanaGet },
  { path: ["grafana", "query"], run: cmdGrafanaQuery },
  { path: ["grafana"], run: cmdGrafanaHelp },

  { path: ["docker", "list"], run: cmdDockerList },
  { path: ["docker", "get"], run: cmdDockerGet },
  { path: ["docker", "start"], run: (ctx) => cmdDockerAction(ctx, "start") },
  { path: ["docker", "stop"], run: (ctx) => cmdDockerAction(ctx, "stop") },
  { path: ["docker", "restart"], run: (ctx) => cmdDockerAction(ctx, "restart") },
  { path: ["docker", "stop-many"], run: cmdDockerStopMany },
  { path: ["docker", "logs"], run: cmdDockerLogs },
  { path: ["docker", "stats"], run: cmdDockerStats },
  { path: ["docker", "swarm", "status"], run: cmdDockerSwarmStatus },
  { path: ["docker", "swarm", "nodes"], run: cmdDockerSwarmNodes },
  { path: ["docker", "swarm", "services"], run: cmdDockerSwarmServices },
  { path: ["docker", "swarm", "stacks"], run: cmdDockerSwarmStacks },
  { path: ["docker", "swarm", "get"], run: cmdDockerSwarmGet },
  { path: ["docker", "swarm", "logs"], run: cmdDockerSwarmLogs },
  { path: ["docker", "swarm", "scale"], run: cmdDockerSwarmScale },
  { path: ["docker", "swarm"], run: cmdDockerSwarmStatus },
  { path: ["docker"], run: cmdDockerHelp },

  { path: ["project", "list"], run: cmdProjectList },
  { path: ["project", "ls"], run: cmdProjectList },
  { path: ["project", "get"], run: cmdProjectGet },
  { path: ["project", "show"], run: cmdProjectGet },
  { path: ["project", "new"], run: cmdProjectNew },
  { path: ["project", "create"], run: cmdProjectNew },
  { path: ["project", "chat"], run: cmdProjectChat },
  { path: ["project", "pause"], run: (ctx) => cmdProjectPause(ctx, true) },
  { path: ["project", "unpause"], run: (ctx) => cmdProjectPause(ctx, false) },
  { path: ["project", "keep"], run: (ctx) => cmdProjectKeep(ctx, true) },
  { path: ["project", "unkeep"], run: (ctx) => cmdProjectKeep(ctx, false) },
  { path: ["project", "delete"], run: cmdProjectDelete },
  { path: ["project", "rm"], run: cmdProjectDelete },
  { path: ["project", "duplicate"], run: cmdProjectDuplicate },
  { path: ["project", "copy"], run: cmdProjectDuplicate },
  { path: ["project", "context"], run: cmdProjectContext },
  { path: ["project", "mission"], run: cmdProjectMission },
  { path: ["project"], run: cmdProjectHelp },
  { path: ["board", "list"], run: cmdBoardList },
  { path: ["board", "ls"], run: cmdBoardList },
  { path: ["board", "get"], run: cmdBoardGet },
  { path: ["board", "show"], run: cmdBoardGet },
  { path: ["board", "new"], run: cmdBoardNew },
  { path: ["board", "create"], run: cmdBoardNew },
  { path: ["board", "delete"], run: cmdBoardDelete },
  { path: ["board", "rm"], run: cmdBoardDelete },
  { path: ["board", "chat"], run: cmdBoardChat },
  { path: ["board", "run"], run: cmdBoardRun },
  { path: ["board", "export"], run: cmdBoardExport },
  { path: ["board", "duplicate"], run: cmdBoardDuplicate },
  { path: ["board", "copy"], run: cmdBoardDuplicate },
  { path: ["board"], run: cmdBoardHelp },

  { path: ["brain", "status"], run: cmdBrainStatus },
  { path: ["brain", "build"], run: cmdBrainBuild },
  { path: ["brain", "search"], run: cmdBrainSearch },
  { path: ["brain", "remember"], run: cmdBrainRemember },
  { path: ["brain", "inbox"], run: cmdBrainInbox },
  { path: ["brain", "correct"], run: cmdBrainCorrect },
  { path: ["brain", "setup"], run: cmdBrainSetup },
  { path: ["brain"], run: cmdBrainHelp },

  { path: ["automation", "list"], run: cmdAutoList },
  { path: ["automation", "get"], run: cmdAutoGet },
  { path: ["automation", "new"], run: cmdAutoNew },
  { path: ["automation", "patch"], run: cmdAutoPatch },
  { path: ["automation", "enable"], run: (ctx) => cmdAutoEnabled(ctx, true) },
  { path: ["automation", "disable"], run: (ctx) => cmdAutoEnabled(ctx, false) },
  { path: ["automation", "delete"], run: cmdAutoDelete },
  { path: ["automation", "run"], run: cmdAutoRun },
  { path: ["automation", "runs"], run: cmdAutoRuns },
  { path: ["automation", "clone"], run: cmdAutoClone },
  { path: ["automation", "test-webhook"], run: cmdAutoTestWebhook },
  { path: ["automation"], run: cmdAutoHelp },

  { path: ["workflow", "list"], run: cmdWorkflowList },
  { path: ["workflow", "templates"], run: cmdWorkflowTemplates },
  { path: ["workflow", "add"], run: cmdWorkflowAdd },
  { path: ["workflow", "import"], run: cmdWorkflowImport },
  { path: ["workflow", "show"], run: cmdWorkflowShow },
  { path: ["workflow", "get"], run: cmdWorkflowShow },
  { path: ["workflow", "delete"], run: cmdWorkflowDelete },
  { path: ["workflow", "run"], run: cmdWorkflowRun },
  { path: ["workflow", "resume"], run: cmdWorkflowResume },
  { path: ["workflow", "runs"], run: cmdWorkflowRuns },
  { path: ["workflow"], run: cmdWorkflowHelp },

  { path: ["config", "show"], run: cmdConfigShow },
  { path: ["config", "policy"], run: cmdConfigPolicy },
  { path: ["config", "revoke-all"], run: cmdRevokeAll },
  { path: ["config", "providers"], run: cmdProviders },
  { path: ["config", "provider", "test"], run: cmdProviderTest },
  { path: ["config", "provider", "models"], run: cmdProviderModels },
  { path: ["config", "mcp"], run: cmdMcp },
  { path: ["config", "skills"], run: cmdSkills },
  { path: ["config", "git"], run: cmdGit },
  { path: ["config", "git", "oauth", "start"], run: cmdGitOauthStart },
  { path: ["config", "git", "oauth", "status"], run: cmdGitOauthStatus },
  { path: ["config", "git", "oauth", "disconnect"], run: cmdGitOauthDisconnect },
  { path: ["config", "workers", "add"], run: cmdWorkerAdd },
  { path: ["config", "workers", "test"], run: cmdWorkerTest },
  { path: ["config", "workers"], run: cmdWorkers },
  { path: ["config", "phone"], run: cmdPhone },
  { path: ["config", "phone", "enable"], run: (ctx) => cmdPhoneSet(ctx, true) },
  { path: ["config", "phone", "disable"], run: (ctx) => cmdPhoneSet(ctx, false) },
  { path: ["config", "phone", "rotate"], run: cmdPhoneRotate },
  { path: ["config", "chrome"], run: cmdChrome },
  { path: ["config", "chrome", "enable"], run: (ctx) => cmdChromeSet(ctx, true) },
  { path: ["config", "chrome", "disable"], run: (ctx) => cmdChromeSet(ctx, false) },
  { path: ["config", "chrome", "rotate"], run: cmdChromeRotate },
  { path: ["config", "funnel"], run: cmdFunnel },
  { path: ["config", "funnel", "enable"], run: (ctx) => cmdFunnelSet(ctx, true) },
  { path: ["config", "funnel", "disable"], run: (ctx) => cmdFunnelSet(ctx, false) },
  { path: ["config", "theme"], run: cmdTheme },
  { path: ["config", "reset"], run: cmdReset },
  { path: ["config"], run: cmdConfigShow },

  { path: ["image", "list"], run: cmdImageList },
  { path: ["image", "capture"], run: cmdImageCapture },
  { path: ["image", "delete"], run: cmdImageDelete },
  { path: ["image", "fetch"], run: cmdImageFetch },
  { path: ["image", "fetch-virtio"], run: cmdImageFetchVirtio },
  { path: ["image"], run: cmdImageList },

  { path: ["debug", "logs"], run: cmdDebugLogs },
  { path: ["debug", "log"], run: cmdDebugLog },
  { path: ["debug", "eval"], run: cmdDebugEval },
  { path: ["debug", "egress"], run: cmdDebugEgress },
  { path: ["debug", "approvals"], run: cmdDebugApprovals },
  { path: ["debug"], run: cmdDebugLogs },

  { path: ["chat"], run: cmdAgentChat },
  { path: ["new"], run: cmdAgentNew },
  { path: ["ls"], run: cmdAgentList },
];

function aliasTokens(tokens: string[]): string[] {
  if (tokens[0] === "sessions") return ["agent", "list", ...tokens.slice(1)];
  if (tokens[0] === "session") return ["agent", ...tokens.slice(1)];
  if (tokens[0] === "codebase") return ["repo", ...tokens.slice(1)];
  if (tokens[0] === "automations") return ["automation", "list", ...tokens.slice(1)];
  if (tokens[0] === "workflows") return ["workflow", "list", ...tokens.slice(1)];
  if (tokens[0] === "auto") return ["automation", ...tokens.slice(1)];
  return tokens;
}

export async function dispatch(ctx: Ctx, tokens: string[]): Promise<void> {
  tokens = aliasTokens(tokens);
  if (!tokens.length || tokens[0] === "help") {
    ctx.writeln(helpFor(tokens.slice(1)));
    return;
  }
  let best: { path: string[]; run: Handler } | undefined;
  for (const route of ROUTES) {
    if (route.path.length > tokens.length) continue;
    if (route.path.every((part, i) => tokens[i] === part)) {
      if (!best || route.path.length >= best.path.length) best = route;
    }
  }
  if (!best) {
    throw new UsageError(`Unknown command: ${tokens.join(" ")}. Try \`locus help\`.`);
  }
  await best.run({ ...ctx, args: tokens.slice(best.path.length) });
}

function done<T>(ctx: Ctx, value: T, text: () => string): void {
  if (ctx.json) printJson(ctx.writeln, value);
  else ctx.writeln(text());
}

async function loadConfig(ctx: Ctx): Promise<LocusConfig> {
  return ctx.client.get<LocusConfig>("/api/config");
}

async function listSessions(ctx: Ctx): Promise<AgentSession[]> {
  return ctx.client.get<AgentSession[]>("/api/sessions");
}

async function resolveSession(ctx: Ctx, token: string, kind?: SessionKind): Promise<AgentSession> {
  const rows = await listSessions(ctx);
  const pool = kind ? rows.filter((row) => sessionKind(row) === kind) : rows;
  const exact = pool.find((row) => row.id === token);
  if (exact) return ctx.client.get<AgentSession>(`/api/sessions/${exact.id}`);
  const prefixes = pool.filter((row) => row.id.startsWith(token));
  if (prefixes.length === 1)
    return ctx.client.get<AgentSession>(`/api/sessions/${prefixes[0]!.id}`);
  const titles = pool.filter((row) => row.title.toLowerCase().includes(token.toLowerCase()));
  if (titles.length === 1) return ctx.client.get<AgentSession>(`/api/sessions/${titles[0]!.id}`);
  if (prefixes.length > 1 || titles.length > 1) {
    throw new UsageError(`Ambiguous session ${token}. Use a longer id.`);
  }
  throw new UsageError(`No session matches ${token}`);
}

async function resolveRepo(ctx: Ctx, token: string): Promise<LinkedRepo> {
  const rows = await ctx.client.get<LinkedRepo[]>("/api/repos");
  const exact = rows.find((row) => row.id === token);
  if (exact) return exact;
  const prefixes = rows.filter((row) => row.id.startsWith(token));
  if (prefixes.length === 1) return prefixes[0]!;
  const names = rows.filter(
    (row) =>
      row.name.toLowerCase().includes(token.toLowerCase()) ||
      row.checkout.url.toLowerCase().includes(token.toLowerCase()),
  );
  if (names.length === 1) return names[0]!;
  if (prefixes.length > 1 || names.length > 1) throw new UsageError(`Ambiguous repo ${token}`);
  throw new UsageError(`No repo matches ${token}`);
}

async function resolveAutomation(ctx: Ctx, token: string): Promise<Automation> {
  const rows = await ctx.client.get<Automation[]>("/api/automations");
  const exact = rows.find((row) => row.id === token);
  if (exact) return exact;
  const prefixes = rows.filter((row) => row.id.startsWith(token));
  if (prefixes.length === 1) return prefixes[0]!;
  const names = rows.filter((row) => row.name.toLowerCase().includes(token.toLowerCase()));
  if (names.length === 1) return names[0]!;
  throw new UsageError(`No automation matches ${token}`);
}

async function resolveChannel(ctx: Ctx, token: string): Promise<SlackConversation> {
  const rows = await ctx.client.get<SlackConversation[]>("/api/slack/conversations");
  const exact = rows.find((row) => row.id === token);
  if (exact) return exact;
  const names = rows.filter((row) => {
    const name = row.name.replace(/^[@#]/, "").toLowerCase();
    return name === token.replace(/^[@#]/, "").toLowerCase() || row.id.startsWith(token);
  });
  if (names.length === 1) return names[0]!;
  if (names.length > 1) throw new UsageError(`Ambiguous channel ${token}`);
  throw new UsageError(`No Slack conversation matches ${token}`);
}

function pendingApproval(session: AgentSession): ToolCall | undefined {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i]!;
    const hit = msg.toolCalls?.find((call) => call.approval === "needed");
    if (hit) return hit;
  }
  return undefined;
}

function formatSession(row: AgentSession): string {
  return formatKv([
    ["id", row.id],
    ["title", row.title],
    ["kind", sessionKind(row)],
    ["runtime", row.runtime ?? "vm"],
    ["os", row.os],
    ["status", row.status],
    ["provider", row.providerId],
    ["model", row.model],
    ["repo", row.repoId || row.repo?.url],
    ["extraRepos", row.extraRepos?.map((item) => item.url).join(", ")],
    ["autonomy", row.autonomy],
    ["error", row.error],
  ]);
}

function printTranscript(ctx: Ctx, session: AgentSession): void {
  const lines: string[] = [];
  for (const msg of session.messages) {
    if (msg.hidden) continue;
    lines.push(formatMessage(msg));
    for (const call of msg.toolCalls ?? []) {
      const state = call.approval
        ? ` ${call.approval}`
        : call.error
          ? " error"
          : call.finishedAt
            ? " done"
            : " …";
      lines.push(`  tool ${call.name} ${call.id}${state}`);
      if (call.error) lines.push(`    ${call.error}`);
    }
  }
  const pending = pendingApproval(session);
  if (pending) {
    lines.push("");
    lines.push(`Approval needed: ${pending.name} ${pending.id}`);
    lines.push(`  locus agent approve ${shortId(session.id)} ${pending.id}`);
    lines.push(`  locus agent deny ${shortId(session.id)} ${pending.id}`);
  }
  ctx.writeln(lines.join("\n") || "(no messages)");
}

function formatMessage(msg: ChatMessage): string {
  const role = msg.role.padEnd(9);
  const steer = msg.steer ? " [steer]" : "";
  return `${role}${steer}  ${msg.content.trim() || "(empty)"}`;
}

async function cmdServe(ctx: Ctx): Promise<void> {
  const code = await startServer({ url: ctx.client.baseUrl, out: ctx.writeln, err: ctx.err });
  if (code !== 0) throw new Error(`Server exited with ${code}`);
}

async function cmdStatus(ctx: Ctx): Promise<void> {
  const health = await ctx.client.get<{
    ok: boolean;
    hypervisor?: string;
    docker?: string;
    name?: string;
  }>("/api/health");
  const setup = await ctx.client.get<Record<string, unknown>>("/api/setup");
  const slack = await ctx.client
    .get<Record<string, unknown>>("/api/slack/status")
    .catch(() => null);
  done(ctx, { health, setup, slack }, () =>
    formatKv([
      ["url", ctx.client.baseUrl],
      ["ok", yn(health.ok)],
      ["hypervisor", String(health.hypervisor ?? "")],
      ["docker", String(health.docker ?? "")],
      ["setup.complete", String(setup.completed ?? setup.setupCompleted ?? "")],
      ["slack", slack ? String(slack.connected) : "n/a"],
    ]),
  );
}

async function cmdSetup(ctx: Ctx): Promise<void> {
  const setup = await ctx.client.get<unknown>("/api/setup");
  done(ctx, setup, () => JSON.stringify(setup, null, 2));
}

async function cmdInstallQemu(ctx: Ctx): Promise<void> {
  const result = await ctx.client.post<unknown>("/api/hypervisor/install");
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdUi(ctx: Ctx): Promise<void> {
  try {
    const res = await fetch(ctx.client.url("/"));
    const html = await res.text();
    if (res.ok && /<html/i.test(html)) {
      done(ctx, { url: ctx.client.baseUrl }, () => ctx.client.baseUrl);
      return;
    }
  } catch {
    /* fall through */
  }
  ctx.writeln(
    `Control plane is at ${ctx.client.baseUrl}. Desktop UI is http://127.0.0.1:5173 when you run \`npm run dev\`.`,
  );
}

async function cmdEvents(ctx: Ctx): Promise<void> {
  ctx.writeln(`Streaming events from ${ctx.client.wsUrl("/ws")} (Ctrl+C to stop)`);
  await new Promise<void>((resolve, reject) => {
    const stop = ctx.client.connectEvents(
      (event) => {
        if (ctx.json) ctx.writeln(JSON.stringify(event));
        else ctx.writeln(`${event.type}  ${summarizeEvent(event)}`);
      },
      (err) => {
        stop();
        if (err) reject(err);
        else resolve();
      },
    );
    process.once("SIGINT", () => {
      stop();
      resolve();
    });
  });
}

function summarizeEvent(event: ClientEvent): string {
  if ("sessionId" in event && typeof event.sessionId === "string") return event.sessionId;
  if ("id" in event && typeof event.id === "string") return event.id;
  if (event.type === "session.updated") {
    return `${shortId(event.session.id)} ${event.session.status}`;
  }
  return "";
}

function cmdHelp(ctx: Ctx): Promise<void> {
  ctx.writeln(helpFor(ctx.args));
  return Promise.resolve();
}

function cmdVersion(ctx: Ctx): Promise<void> {
  done(ctx, { name: "locus", version: CLI_VERSION }, () => `locus ${CLI_VERSION}`);
  return Promise.resolve();
}

function cmdAgentHelp(ctx: Ctx): Promise<void> {
  ctx.writeln(helpFor(["agent"]));
  return Promise.resolve();
}

function cmdDesignHelp(ctx: Ctx): Promise<void> {
  ctx.writeln(helpFor(["design"]));
  return Promise.resolve();
}

function cmdGameHelp(ctx: Ctx): Promise<void> {
  ctx.writeln(helpFor(["game"]));
  return Promise.resolve();
}

function cmdAssetHelp(ctx: Ctx): Promise<void> {
  ctx.writeln(helpFor(["asset"]));
  return Promise.resolve();
}

function cmdIdeHelp(ctx: Ctx): Promise<void> {
  ctx.writeln(helpFor(["ide"]));
  return Promise.resolve();
}

async function cmdIdeNew(ctx: Ctx): Promise<void> {
  const dir = flagStr(ctx.flags, "dir") ?? flagStr(ctx.flags, "host-dir");
  return cmdAgentNew({
    ...ctx,
    flags: {
      ...ctx.flags,
      kind: ctx.flags.kind ?? "ide",
      runtime: ctx.flags.runtime ?? "host",
      "no-start": ctx.flags["no-start"] ?? true,
      ...(dir ? { "host-dir": dir } : {}),
    },
  });
}

function cmdRepoHelp(ctx: Ctx): Promise<void> {
  ctx.writeln(helpFor(["repo"]));
  return Promise.resolve();
}

function cmdSlackHelp(ctx: Ctx): Promise<void> {
  ctx.writeln(helpFor(["slack"]));
  return Promise.resolve();
}

function cmdDockerHelp(ctx: Ctx): Promise<void> {
  ctx.writeln(helpFor(["docker"]));
  return Promise.resolve();
}

function cmdAutoHelp(ctx: Ctx): Promise<void> {
  ctx.writeln(helpFor(["automation"]));
  return Promise.resolve();
}

function cmdProjectHelp(ctx: Ctx): Promise<void> {
  ctx.writeln(helpFor(["project"]));
  return Promise.resolve();
}

function cmdBrainHelp(ctx: Ctx): Promise<void> {
  ctx.writeln(helpFor(["brain"]));
  return Promise.resolve();
}

async function cmdAgentList(ctx: Ctx): Promise<void> {
  const kindRaw = flagStr(ctx.flags, "kind");
  const kind = kindRaw && isSessionKind(kindRaw) ? kindRaw : undefined;
  if (kindRaw && !kind) throw new UsageError("--kind must be agent, design, game, or review");
  const archived = flagBool(ctx.flags, "archived");
  let rows = await listSessions(ctx);
  if (kind) rows = rows.filter((row) => sessionKind(row) === kind);
  if (!archived) rows = rows.filter((row) => !row.archived);
  done(ctx, rows, () =>
    formatTable(rows, [
      { key: "id", header: "ID", value: (row) => shortId(row.id) },
      { key: "title", header: "TITLE", value: (row) => truncate(row.title, 36) },
      { key: "kind", header: "KIND", value: (row) => sessionKind(row) },
      { key: "runtime", header: "RUNTIME", value: (row) => row.runtime ?? "vm" },
      { key: "status", header: "STATUS", value: (row) => row.status },
      { key: "model", header: "MODEL", value: (row) => row.model },
    ]),
  );
}

async function cmdAgentGet(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  done(ctx, session, () => `${formatSession(session)}\n\n${transcriptText(session)}`);
}

function transcriptText(session: AgentSession): string {
  const lines: string[] = [];
  for (const msg of session.messages) {
    if (msg.hidden) continue;
    lines.push(formatMessage(msg));
  }
  return lines.join("\n") || "(no messages)";
}

async function cmdRecipes(ctx: Ctx): Promise<void> {
  const rows = [...AGENT_RECIPES, ...DESIGN_RECIPES, ...GAME_RECIPES];
  done(ctx, rows, () =>
    formatTable(rows, [
      { key: "id", header: "ID", value: (row) => row.id },
      { key: "title", header: "TITLE", value: (row) => row.title },
      { key: "runtime", header: "RUNTIME", value: (row) => row.runtime },
      { key: "kind", header: "KIND", value: (row) => row.kind ?? "agent" },
    ]),
  );
}

function assetBuildFlag(
  flags: Flags,
  flag: string,
  key: string,
  choices: readonly string[],
): string | undefined {
  const value = flagStr(flags, flag);
  if (value && !parseAssetBuild({ [key]: value })) {
    throw new UsageError(`--${flag} must be ${choices.join(", ")}`);
  }
  return value;
}

function assetBuildFromFlags(flags: Flags): ReturnType<typeof parseAssetBuild> {
  const topology = assetBuildFlag(flags, "topology", "topology", ASSET_TOPOLOGY_MODES);
  const quality = assetBuildFlag(flags, "quality", "quality", ASSET_QUALITY_TIERS);
  const resolution = assetBuildFlag(flags, "resolution", "resolution", ASSET_RESOLUTIONS);
  const restPose = assetBuildFlag(flags, "rest-pose", "restPose", ASSET_REST_POSES);
  const polyBudget = assetBuildFlag(flags, "poly-budget", "polyBudget", ASSET_POLY_BUDGETS);
  const noTexture = flagBool(flags, "no-texture");
  const split = flagBool(flags, "split");
  const multiView = flagBool(flags, "multi-view");
  const noEnhance = flagBool(flags, "no-enhance");
  const printable = flagBool(flags, "printable");
  if (
    !topology &&
    !quality &&
    !resolution &&
    !restPose &&
    !polyBudget &&
    !noTexture &&
    !split &&
    !multiView &&
    !noEnhance &&
    !printable
  ) {
    return undefined;
  }
  return resolveAssetBuild(
    parseAssetBuild({
      topology,
      quality,
      resolution,
      restPose,
      polyBudget,
      texture: noTexture ? false : undefined,
      split: split || undefined,
      multiView: multiView || undefined,
      enhance: noEnhance ? false : undefined,
      printable: printable || undefined,
    }),
  );
}

async function cmdAgentNew(ctx: Ctx): Promise<void> {
  const config = await loadConfig(ctx);
  const recipeId = flagStr(ctx.flags, "recipe");
  const recipe = recipeId ? recipeById(recipeId) : undefined;
  if (recipeId && !recipe)
    throw new UsageError(`Unknown recipe ${recipeId}. Try locus agent recipes.`);
  const kindRaw = flagStr(ctx.flags, "kind") ?? recipe?.kind;
  const kind = kindRaw && isSessionKind(kindRaw) ? kindRaw : "agent";
  const osRaw = flagStr(ctx.flags, "os") ?? recipe?.os ?? "ubuntu";
  if (!isGuestOs(osRaw)) throw new UsageError(`--os must be ${GUEST_OSES.join(", ")}`);
  const runtimeRaw = flagStr(ctx.flags, "runtime") ?? recipe?.runtime ?? "docker";
  if (!isAgentRuntime(runtimeRaw)) throw new UsageError("--runtime must be docker, vm, or host");
  const templateId =
    flagStr(ctx.flags, "template") ?? config.templates.find((row) => row.os === osRaw)?.id ?? "";
  if (!templateId)
    throw new UsageError(`No VM template for OS ${osRaw}. Add media in Settings → Machines.`);
  const provider =
    config.providers.find((row) => row.id === flagStr(ctx.flags, "provider")) ??
    config.providers.find((row) => row.enabled) ??
    config.providers[0];
  if (!provider) throw new UsageError("Add a model provider in Settings, then retry.");
  const placementRaw = flagStr(ctx.flags, "placement") ?? flagStr(ctx.flags, "where");
  const worker = flagStr(ctx.flags, "worker");
  const prompt = restJoin(ctx.args) || flagStr(ctx.flags, "prompt") || recipe?.prompt;
  const input: CreateSessionInput = {
    title: flagStr(ctx.flags, "title") || (prompt ? truncate(prompt, 60) : undefined),
    os: osRaw,
    templateId,
    kind,
    runtime: runtimeRaw,
    providerId: provider.id,
    model: flagStr(ctx.flags, "model") || provider.defaultModel,
    startVm: !flagBool(ctx.flags, "no-start") && (runtimeRaw !== "host" || Boolean(worker)),
    prompt: prompt || undefined,
    dockerImage:
      flagStr(ctx.flags, "docker-image") ||
      recipe?.dockerImage ||
      (runtimeRaw === "docker" ? DEFAULT_DOCKER_IMAGE : undefined),
    repoId: flagList(ctx.flags, "repo")[0],
    extraRepoIds: flagList(ctx.flags, "repo").slice(1).length
      ? flagList(ctx.flags, "repo").slice(1)
      : undefined,
    imageId: flagStr(ctx.flags, "image"),
    hostDir: flagStr(ctx.flags, "host-dir"),
    playbook: flagStr(ctx.flags, "playbook") || recipe?.playbook,
    allowedTools: recipe?.allowedTools,
    vision: recipe?.vision,
    designSystemId: flagStr(ctx.flags, "system"),
    assetStyleId: kind === "assets" ? flagStr(ctx.flags, "style") : undefined,
    gameStyleId: kind === "game" ? flagStr(ctx.flags, "style") : undefined,
    assetBuild: assetBuildFromFlags(ctx.flags),
  };
  const autonomy = flagStr(ctx.flags, "autonomy");
  if (autonomy && isAutonomyTier(autonomy)) input.autonomy = autonomy;
  else if (autonomy) throw new UsageError("--autonomy must be guided, supervised, or autonomous");
  const network = flagStr(ctx.flags, "network");
  if (network === "open" || network === "restricted" || network === "none") input.network = network;
  const vision = flagStr(ctx.flags, "vision");
  if (vision === "off" || vision === "latest") input.vision = vision;
  if (placementRaw && isAgentPlacement(placementRaw)) input.placement = placementRaw;
  if (worker) {
    input.placement = "worker";
    input.backendId = worker;
  }
  if (flagBool(ctx.flags, "live-chrome")) {
    if (runtimeRaw !== "host") throw new UsageError("--live-chrome is only for --runtime host");
    input.liveChrome = true;
  }
  const session = await ctx.client.post<AgentSession>("/api/sessions", input);
  done(ctx, session, () => formatSession(session));
}

async function cmdAgentChat(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const content = restJoin(ctx.args, 1);
  if (!content) {
    printTranscript(ctx, session);
    ctx.writeln('\nPass a message: locus agent chat <id> "your prompt"');
    return;
  }
  const notify = flagStr(ctx.flags, "notify");
  await ctx.client.post(`/api/sessions/${session.id}/chat`, {
    content,
    plan: flagBool(ctx.flags, "plan"),
    steer: flagBool(ctx.flags, "steer"),
    skill: flagStr(ctx.flags, "skill"),
    ...(notify ? { notifySessionId: notify } : {}),
  });
  // Default async so Swarm coordinators can dispatch peers without blocking.
  // Pass --wait to block until the turn ends.
  const wait = flagBool(ctx.flags, "wait");
  if (!wait) {
    done(
      ctx,
      { ok: true, sessionId: session.id, async: true as const },
      () => `Sent ${shortId(session.id)} (async — peer keeps working; pass --wait to block)`,
    );
    return;
  }
  const timeoutMs = (flagNum(ctx.flags, "timeout") ?? 600) * 1000;
  const next = await waitForTurn(ctx, session.id, timeoutMs);
  if (ctx.json) printJson(ctx.writeln, next);
  else printTranscript(ctx, next);
  if (pendingApproval(next)) throw new ApprovalPendingError(next.id);
}

export class ApprovalPendingError extends Error {
  constructor(readonly sessionId: string) {
    super(`Approval needed on session ${sessionId}`);
    this.name = "ApprovalPendingError";
  }
}

function turnComplete(session: AgentSession): boolean {
  return (
    Boolean(pendingApproval(session)) ||
    session.status === "idle" ||
    session.status === "error" ||
    session.status === "stopped"
  );
}

async function waitForTurn(ctx: Ctx, sessionId: string, timeoutMs: number): Promise<AgentSession> {
  const deadline = Date.now() + timeoutMs;
  const check = async (): Promise<AgentSession | undefined> => {
    const last = await ctx.client.get<AgentSession>(`/api/sessions/${sessionId}`);
    return turnComplete(last) ? last : undefined;
  };
  const immediate = await check();
  if (immediate) return immediate;
  return new Promise((resolve, reject) => {
    let settled = false;
    let stopWs = () => {};
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(interval);
      stopWs();
    };
    const succeed = (session: AgentSession) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(session);
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const timer = setTimeout(
      () =>
        fail(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the turn`)),
      Math.max(0, deadline - Date.now()),
    );
    const interval = setInterval(() => {
      void check().then((hit) => {
        if (hit) succeed(hit);
      }, fail);
    }, 750);
    try {
      stopWs = ctx.client.connectEvents((event) => {
        if (
          !ctx.json &&
          flagBool(ctx.flags, "stream") &&
          event.type === "chat.delta" &&
          event.sessionId === sessionId
        ) {
          ctx.write(event.delta);
        }
        if (event.type === "chat.done" && event.sessionId === sessionId) {
          void check().then((hit) => {
            if (hit) succeed(hit);
          }, fail);
        }
        if (event.type === "session.updated" && event.session.id === sessionId) {
          if (turnComplete(event.session)) succeed(event.session);
        }
      });
    } catch {
      /* poll only */
    }
  });
}

async function cmdAgentAbort(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const result = await ctx.client.post(`/api/sessions/${session.id}/chat/abort`);
  done(ctx, result, () => `Aborted ${session.id}`);
}

async function cmdAgentQueueSend(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const itemToken = need(ctx.args, 1, "queue item id");
  const item = resolveQueueItem(session, itemToken);
  await ctx.client.post(`/api/sessions/${session.id}/queue/${item.id}/send`);
  const timeoutMs = (flagNum(ctx.flags, "timeout") ?? 600) * 1000;
  const next = await waitForTurn(ctx, session.id, timeoutMs);
  if (ctx.json) printJson(ctx.writeln, next);
  else printTranscript(ctx, next);
  if (pendingApproval(next)) throw new ApprovalPendingError(next.id);
}

function resolveQueueItem(
  session: AgentSession,
  token: string,
): NonNullable<AgentSession["queue"]>[number] {
  const queue = session.queue ?? [];
  const exact = queue.find((row) => row.id === token);
  if (exact) return exact;
  const prefixes = queue.filter((row) => row.id.startsWith(token));
  if (prefixes.length === 1) return prefixes[0]!;
  if (prefixes.length > 1) throw new UsageError(`Ambiguous queue item ${token}`);
  throw new UsageError(`No queued prompt matches ${token}`);
}

async function cmdAgentApprove(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const toolCallId = need(ctx.args, 1, "tool call id");
  const next = await ctx.client.post<AgentSession>(`/api/sessions/${session.id}/approvals`, {
    toolCallId,
    decision: "approved",
    answer: flagStr(ctx.flags, "answer"),
    persist: flagBool(ctx.flags, "always") || undefined,
  });
  done(ctx, next, () => `Approved ${toolCallId} on ${session.id}`);
}

async function cmdAgentDeny(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const toolCallId = need(ctx.args, 1, "tool call id");
  const next = await ctx.client.post<AgentSession>(`/api/sessions/${session.id}/approvals`, {
    toolCallId,
    decision: "denied",
  });
  done(ctx, next, () => `Denied ${toolCallId} on ${session.id}`);
}

async function cmdAgentRewind(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const checkpointId = flagStr(ctx.flags, "checkpoint");
  const next = await ctx.client.post<AgentSession>(`/api/sessions/${session.id}/rewind`, {
    ...(checkpointId ? { checkpointId } : {}),
  });
  done(ctx, next, () => `Rewound ${session.id}`);
}

async function cmdAgentClear(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const next = await ctx.client.post<AgentSession>(`/api/sessions/${session.id}/clear`);
  done(ctx, next, () => `Cleared chat ${session.id}`);
}

async function cmdAgentFork(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const next = await ctx.client.post<AgentSession>(`/api/sessions/${session.id}/fork`);
  done(ctx, next, () => formatSession(next));
}

async function cmdAgentTakeover(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const next = await ctx.client.post<AgentSession>(`/api/sessions/${session.id}/takeover`);
  done(
    ctx,
    next,
    () => `Takeover ${session.id} (drive the guest from the desktop VNC/Chromium pane)`,
  );
}

async function cmdAgentHandback(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const next = await ctx.client.post<AgentSession>(`/api/sessions/${session.id}/handback`);
  done(ctx, next, () => `Handed back ${session.id}`);
}

async function cmdAgentBrowserTakeover(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const next = await ctx.client.post<AgentSession>(`/api/sessions/${session.id}/browser/takeover`);
  done(ctx, next, () => `Browser takeover ${session.id} (does not abort chat)`);
}

async function cmdAgentBrowserHandback(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const next = await ctx.client.post<AgentSession>(`/api/sessions/${session.id}/browser/handback`);
  done(ctx, next, () => `Browser handed back ${session.id}`);
}

async function cmdAgentUndo(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const next = await ctx.client.post<AgentSession>(`/api/sessions/${session.id}/undo-file`);
  done(ctx, next, () => `Undid last file edit on ${session.id}`);
}

async function cmdAgentSaveEnvironment(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const name = flagStr(ctx.flags, "name") || restJoin(ctx.args, 1);
  if (!name) throw new UsageError("Need --name");
  const result = await ctx.client.post(`/api/sessions/${session.id}/save-environment`, { name });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdAgentDelete(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  await ctx.client.delete(`/api/sessions/${session.id}`);
  done(ctx, { ok: true, id: session.id }, () => `Deleted ${session.id}`);
}

async function cmdAgentPatch(ctx: Ctx, patch: Record<string, unknown>): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const next = await ctx.client.patch<AgentSession>(`/api/sessions/${session.id}`, patch);
  done(ctx, next, () => formatSession(next));
}

async function cmdCheckpointDiff(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const checkpointId = need(ctx.args, 1, "checkpoint id");
  const result = await ctx.client.get<{ diff: string }>(
    `/api/sessions/${session.id}/checkpoints/${encodeURIComponent(checkpointId)}/diff`,
  );
  done(ctx, result, () => result.diff || "(empty)");
}

async function cmdAgentMemory(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const action = (ctx.args[1] ?? "list").trim().toLowerCase();
  if (action === "list") {
    const result = await ctx.client.get<{ memories: Array<{ id: string; text: string }> }>(
      `/api/sessions/${session.id}/memories`,
    );
    done(ctx, result, () =>
      result.memories.length
        ? formatTable(result.memories, [
            { key: "id", header: "ID", value: (row) => shortId(row.id) },
            { key: "text", header: "TEXT", value: (row) => truncate(row.text, 72) },
          ])
        : "No saved facts.",
    );
    return;
  }
  if (action === "add") {
    const text = restJoin(ctx.args, 2) || flagStr(ctx.flags, "text");
    if (!text) throw new UsageError("Missing fact text");
    const result = await ctx.client.post<{ output: string }>(
      `/api/sessions/${session.id}/memories`,
      {
        action: "add",
        text,
      },
    );
    done(ctx, result, () => result.output);
    return;
  }
  if (action === "forget") {
    const id = ctx.args[2]?.trim() || flagStr(ctx.flags, "id");
    if (!id) throw new UsageError("Missing memory id");
    const result = await ctx.client.post<{ output: string }>(
      `/api/sessions/${session.id}/memories`,
      {
        action: "forget",
        id,
      },
    );
    done(ctx, result, () => result.output);
    return;
  }
  throw new UsageError("Use list, add, or forget");
}

async function cmdAgentRename(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const title = restJoin(ctx.args, 1) || flagStr(ctx.flags, "title");
  if (!title) throw new UsageError("Missing title");
  const next = await ctx.client.patch<AgentSession>(`/api/sessions/${session.id}`, { title });
  done(ctx, next, () => formatSession(next));
}

async function cmdWorkersSpawn(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const result = await ctx.client.post<AgentSession[]>(`/api/sessions/${session.id}/workers`, {
    count: flagNum(ctx.flags, "count"),
    prompt: flagStr(ctx.flags, "prompt") || restJoin(ctx.args, 1) || undefined,
  });
  done(ctx, result, () => `Spawned ${result.length} worker(s)`);
}

async function cmdWorkersDiff(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const result = await ctx.client.get<unknown>(`/api/sessions/${session.id}/workers/diff`);
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdWorkersMerge(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const workerId = need(ctx.args, 1, "worker id");
  const next = await ctx.client.post<AgentSession>(`/api/sessions/${session.id}/workers/merge`, {
    workerId,
  });
  done(ctx, next, () => `Merged ${workerId} into ${session.id}`);
}

async function cmdRoleCycle(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const next = await ctx.client.post<AgentSession>(`/api/sessions/${session.id}/roles`);
  done(ctx, next, () => `Role ${next.role ?? "default"} on ${session.id}`);
}

async function cmdGameLink(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "game session id"));
  const asset = await resolveSession(ctx, need(ctx.args, 1, "asset session id"));
  const result = await ctx.client.post<{
    refs: Array<{ sessionId: string; slug: string }>;
    prompts: Array<{ slug: string; dir: string }>;
  }>(`/api/sessions/${session.id}/linked-assets`, { assetIds: [asset.id] });
  done(
    ctx,
    result,
    () =>
      `Linked ${asset.id} → ${session.id} as ${result.prompts.map((row) => `@asset:${row.slug}`).join(", ") || result.refs.map((row) => row.slug).join(", ")}`,
  );
}

async function cmdGameAssets(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "game session id"));
  const refs = session.assetRefs ?? [];
  done(ctx, refs, () =>
    refs.length
      ? refs.map((row) => `${row.slug}\t${row.sessionId}\t${row.title ?? ""}`).join("\n")
      : "(no linked assets)",
  );
}

async function cmdGamePlayLink(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "game session id"));
  const result = await ctx.client.get<{ token: string; url: string; lanUrls: string[] }>(
    `/api/sessions/${session.id}/play-link`,
  );
  done(
    ctx,
    result,
    () => [result.url, ...(result.lanUrls ?? [])].filter(Boolean).join("\n") || result.token,
  );
}

async function cmdGameGenerate(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "game session id"));
  const kind = need(ctx.args, 1, "kind (sprite|sheet|mesh|sfx)");
  const result = await ctx.client.post<{ game: AgentSession; asset?: AgentSession }>(
    `/api/sessions/${session.id}/generate-asset`,
    { kind },
  );
  done(ctx, result, () =>
    result.asset
      ? `Generating ${kind} as ${result.asset.id} for ${session.id}`
      : `Queued ${kind} on ${session.id}`,
  );
}

async function cmdGameStylesList(ctx: Ctx): Promise<void> {
  const result = await ctx.client.get<{
    styles: Array<{ id: string; name: string }>;
    defaultId?: string;
  }>("/api/game-styles");
  done(ctx, result, () =>
    formatTable(result.styles, [
      { key: "id", header: "ID", value: (row) => shortId(row.id) },
      { key: "name", header: "NAME", value: (row) => row.name },
      { key: "default", header: "DEFAULT", value: (row) => yn(row.id === result.defaultId) },
    ]),
  );
}

async function cmdGameStylesCreate(ctx: Ctx): Promise<void> {
  const name = flagStr(ctx.flags, "name") || need(ctx.args, 0, "name");
  const result = await ctx.client.post("/api/game-styles", {
    name,
    summary: flagStr(ctx.flags, "summary"),
    guidelines: flagStr(ctx.flags, "guidelines"),
  });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdGameStylesSave(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const result = await ctx.client.post(`/api/sessions/${session.id}/game-style`, {
    name: flagStr(ctx.flags, "name"),
    summary: flagStr(ctx.flags, "summary"),
    guidelines: flagStr(ctx.flags, "guidelines"),
  });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdGameStylesDelete(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "style id");
  const result = await ctx.client.delete(`/api/game-styles/${encodeURIComponent(id)}`);
  done(ctx, result, () => `Deleted ${id}`);
}

async function cmdGameStylesDefault(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "style id");
  const result = await ctx.client.post(`/api/game-styles/${encodeURIComponent(id)}/default`);
  done(ctx, result, () => `Default game style ${id}`);
}

async function cmdAssetPack(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "asset session id"));
  const result = await ctx.client.post(`/api/sessions/${session.id}/asset-pack`, {});
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdPromote(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const result = await ctx.client.post<{ agent: AgentSession; design: AgentSession }>(
    `/api/sessions/${session.id}/promote`,
    { scaffold: flagStr(ctx.flags, "scaffold") },
  );
  done(ctx, result, () => `Promoted design ${result.design.id} → agent ${result.agent.id}`);
}

async function cmdAgentCanvas(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const listed = await ctx.client.get<{
    canvases: Array<{ id: string; title: string; updatedAt: string }>;
  }>(`/api/sessions/${session.id}/agent-canvases`);
  const want = flagStr(ctx.flags, "canvas");
  const rows = [...listed.canvases].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const pick = want
    ? rows.find((row) => row.id === want || row.id.startsWith(want) || row.title === want)
    : rows.at(-1);
  if (!pick) {
    done(ctx, listed, () => "(no canvas)");
    return;
  }
  const canvas = await ctx.client.get<{ html: string; title: string; id: string }>(
    `/api/sessions/${session.id}/agent-canvases/${encodeURIComponent(pick.id)}`,
  );
  done(ctx, canvas, () => canvas.html || "(empty canvas)");
}

async function cmdCanvas(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const canvas = await ctx.client.get<{ html: string | null; path: string; mtime?: string }>(
    `/api/sessions/${session.id}/canvas`,
  );
  done(ctx, canvas, () => canvas.html || "(empty canvas)");
}

async function cmdPreview(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const preview = await ctx.client.get<unknown>(`/api/sessions/${session.id}/preview`);
  done(ctx, preview, () => JSON.stringify(preview, null, 2));
}

async function cmdWorkspaceTree(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const path = ctx.args[1] ?? "";
  const qs = path ? `?path=${encodeURIComponent(path)}` : "";
  const tree = await ctx.client.get<{
    entries: Array<{ name: string; path: string; type: string; size?: number }>;
  }>(`/api/sessions/${session.id}/workspace${qs}`);
  done(ctx, tree, () =>
    formatTable(tree.entries, [
      { key: "type", header: "TYPE", value: (row) => row.type },
      { key: "name", header: "NAME", value: (row) => row.name },
      { key: "path", header: "PATH", value: (row) => row.path },
    ]),
  );
}

async function cmdWorkspaceCat(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const path = need(ctx.args, 1, "path");
  const file = await ctx.client.get<{ path: string; content: string }>(
    `/api/sessions/${session.id}/workspace/file?path=${encodeURIComponent(path)}`,
  );
  done(ctx, file, () => file.content);
}

async function cmdWorkspaceWrite(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const path = need(ctx.args, 1, "path");
  const fromFile = flagStr(ctx.flags, "file");
  const content = fromFile
    ? await readFile(fromFile, "utf8")
    : flagStr(ctx.flags, "text") || restJoin(ctx.args, 2);
  if (!content && content !== "")
    throw new UsageError("Pass --file, --text, or the contents as arguments");
  const result = await ctx.client.put(`/api/sessions/${session.id}/workspace/file`, {
    path,
    content,
  });
  done(ctx, result, () => `Wrote ${path}`);
}

async function cmdTool(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const name = need(ctx.args, 1, "tool name");
  const args: Record<string, unknown> = {};
  const argFlag = flagStr(ctx.flags, "arg");
  if (argFlag) {
    for (const part of argFlag.split(",")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      args[part.slice(0, eq).trim()] = part.slice(eq + 1);
    }
  }
  const result = await ctx.client.post(`/api/sessions/${session.id}/tools`, { name, args });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdVm(ctx: Ctx, action: "start" | "stop" | "pause" | "resume"): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const result = await ctx.client.post(`/api/sessions/${session.id}/vm/${action}`);
  done(ctx, result, () => `${action} ${session.id}`);
}

async function cmdVmLogs(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const logs = await ctx.client.get<{ text: string }>(`/api/sessions/${session.id}/vm/logs`);
  done(ctx, logs, () => logs.text || "(empty)");
}

async function cmdTranscript(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  if (ctx.json) printJson(ctx.writeln, session.messages);
  else printTranscript(ctx, session);
}

async function cmdDesignComment(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const selector = flagStr(ctx.flags, "selector");
  const text = flagStr(ctx.flags, "text") || restJoin(ctx.args, 1);
  if (!selector || !text) throw new UsageError("Need --selector and --text");
  const viewport = flagStr(ctx.flags, "viewport") ?? "desktop";
  if (viewport !== "desktop" && viewport !== "tablet" && viewport !== "phone") {
    throw new UsageError("--viewport must be desktop, tablet, or phone");
  }
  const next = await ctx.client.post<AgentSession>(`/api/sessions/${session.id}/design-comment`, {
    selector,
    text,
    viewport,
  });
  done(ctx, next, () => `Commented on ${selector}`);
}

async function cmdVariantList(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  done(ctx, session.designVariants ?? [], () =>
    formatTable(session.designVariants ?? [], [
      { key: "id", header: "ID", value: (row) => row.id },
      { key: "name", header: "NAME", value: (row) => row.name },
      {
        key: "active",
        header: "ACTIVE",
        value: (row) => yn(row.id === session.activeVariantId),
      },
    ]),
  );
}

async function cmdVariantCreate(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const next = await ctx.client.post<AgentSession>(`/api/sessions/${session.id}/design/variants`, {
    name: flagStr(ctx.flags, "name") || restJoin(ctx.args, 1) || undefined,
  });
  done(ctx, next, () => formatSession(next));
}

async function cmdVariantActivate(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const variantId = need(ctx.args, 1, "variant id");
  const next = await ctx.client.post<AgentSession>(
    `/api/sessions/${session.id}/design/variants/${encodeURIComponent(variantId)}/activate`,
  );
  done(ctx, next, () => `Activated ${variantId}`);
}

async function cmdVariantRename(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const variantId = need(ctx.args, 1, "variant id");
  const name = restJoin(ctx.args, 2) || flagStr(ctx.flags, "name");
  if (!name) throw new UsageError("Missing name");
  const next = await ctx.client.patch<AgentSession>(
    `/api/sessions/${session.id}/design/variants/${encodeURIComponent(variantId)}`,
    { name },
  );
  done(ctx, next, () => `Renamed ${variantId} → ${name}`);
}

async function cmdVariantDelete(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const variantId = need(ctx.args, 1, "variant id");
  const next = await ctx.client.delete<AgentSession>(
    `/api/sessions/${session.id}/design/variants/${encodeURIComponent(variantId)}`,
  );
  done(ctx, next, () => `Deleted variant ${variantId}`);
}

async function cmdSystemsList(ctx: Ctx): Promise<void> {
  const result = await ctx.client.get<{
    systems: Array<{ id: string; name: string }>;
    builtins: Array<{ id: string; name: string }>;
    defaultId?: string;
  }>("/api/design-systems");
  done(ctx, result, () => {
    const rows = [
      ...result.systems.map((row) => ({ ...row, source: "saved" })),
      ...result.builtins.map((row) => ({ ...row, source: "builtin" })),
    ];
    return formatTable(rows, [
      { key: "id", header: "ID", value: (row) => shortId(row.id) },
      { key: "name", header: "NAME", value: (row) => row.name },
      { key: "source", header: "SOURCE", value: (row) => row.source },
      { key: "default", header: "DEFAULT", value: (row) => yn(row.id === result.defaultId) },
    ]);
  });
}

async function cmdSystemsCreate(ctx: Ctx): Promise<void> {
  const name = flagStr(ctx.flags, "name") || need(ctx.args, 0, "name");
  const result = await ctx.client.post("/api/design-systems", { name });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdSystemsImport(ctx: Ctx): Promise<void> {
  const file = flagStr(ctx.flags, "file") || need(ctx.args, 0, "file path");
  const text = await readFile(file, "utf8");
  const result = await ctx.client.post("/api/design-systems/import", {
    text,
    filename: flagStr(ctx.flags, "filename") || file,
  });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdSystemsDelete(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "system id");
  const result = await ctx.client.delete(`/api/design-systems/${encodeURIComponent(id)}`);
  done(ctx, result, () => `Deleted ${id}`);
}

async function cmdSystemsDefault(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "system id");
  const result = await ctx.client.post(`/api/design-systems/${encodeURIComponent(id)}/default`);
  done(ctx, result, () => `Default design system ${id}`);
}

async function cmdAssetStylesList(ctx: Ctx): Promise<void> {
  const result = await ctx.client.get<{
    styles: Array<{ id: string; name: string }>;
    defaultId?: string;
  }>("/api/asset-styles");
  done(ctx, result, () =>
    formatTable(result.styles, [
      { key: "id", header: "ID", value: (row) => shortId(row.id) },
      { key: "name", header: "NAME", value: (row) => row.name },
      { key: "default", header: "DEFAULT", value: (row) => yn(row.id === result.defaultId) },
    ]),
  );
}

async function cmdAssetStylesCreate(ctx: Ctx): Promise<void> {
  const name = flagStr(ctx.flags, "name") || need(ctx.args, 0, "name");
  const result = await ctx.client.post("/api/asset-styles", {
    name,
    summary: flagStr(ctx.flags, "summary"),
    guidelines: flagStr(ctx.flags, "guidelines"),
  });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdAssetStylesSave(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const result = await ctx.client.post(`/api/sessions/${session.id}/asset-style`, {
    name: flagStr(ctx.flags, "name"),
    summary: flagStr(ctx.flags, "summary"),
    guidelines: flagStr(ctx.flags, "guidelines"),
  });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdAssetStylesDelete(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "style id");
  const result = await ctx.client.delete(`/api/asset-styles/${encodeURIComponent(id)}`);
  done(ctx, result, () => `Deleted ${id}`);
}

async function cmdAssetStylesDefault(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "style id");
  const result = await ctx.client.post(`/api/asset-styles/${encodeURIComponent(id)}/default`);
  done(ctx, result, () => `Default asset style ${id}`);
}

async function cmdRepoList(ctx: Ctx): Promise<void> {
  const rows = await ctx.client.get<LinkedRepo[]>("/api/repos");
  done(ctx, rows, () =>
    formatTable(rows, [
      { key: "id", header: "ID", value: (row) => shortId(row.id) },
      { key: "name", header: "NAME", value: (row) => row.name },
      { key: "url", header: "URL", value: (row) => row.checkout.url },
      { key: "open", header: "OPEN PRS", value: (row) => String(row.openPullCount ?? "") },
    ]),
  );
}

async function cmdRepoGet(ctx: Ctx): Promise<void> {
  const repo = await resolveRepo(ctx, need(ctx.args, 0, "repo id"));
  done(ctx, repo, () =>
    formatKv([
      ["id", repo.id],
      ["name", repo.name],
      ["url", repo.checkout.url],
      ["ref", repo.checkout.ref],
      ["autoReview", yn(repo.autoReview)],
    ]),
  );
}

async function cmdRepoLink(ctx: Ctx): Promise<void> {
  const url = flagStr(ctx.flags, "url") || need(ctx.args, 0, "repo url");
  const repo = await ctx.client.post<LinkedRepo>("/api/repos", {
    url,
    name: flagStr(ctx.flags, "name"),
    ref: flagStr(ctx.flags, "ref"),
    accountId: flagStr(ctx.flags, "account"),
  });
  done(ctx, repo, () => `${repo.id}  ${repo.name}  ${repo.checkout.url}`);
}

async function cmdRepoImport(ctx: Ctx): Promise<void> {
  const result = await ctx.client.post<unknown>("/api/repos/import");
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdRepoRefresh(ctx: Ctx): Promise<void> {
  const repo = await resolveRepo(ctx, need(ctx.args, 0, "repo id"));
  const next = await ctx.client.post<LinkedRepo>(`/api/repos/${repo.id}/refresh`);
  done(ctx, next, () => `Refreshed ${next.name}`);
}

async function cmdRepoDelete(ctx: Ctx): Promise<void> {
  const repo = await resolveRepo(ctx, need(ctx.args, 0, "repo id"));
  await ctx.client.delete(`/api/repos/${repo.id}`);
  done(ctx, { ok: true, id: repo.id }, () => `Deleted ${repo.name}`);
}

async function cmdRepoPatch(ctx: Ctx): Promise<void> {
  const repo = await resolveRepo(ctx, need(ctx.args, 0, "repo id"));
  const patch: Record<string, unknown> = {};
  if (flagStr(ctx.flags, "name")) patch.name = flagStr(ctx.flags, "name");
  if (flagStr(ctx.flags, "ref")) patch.ref = flagStr(ctx.flags, "ref");
  if (flagStr(ctx.flags, "playbook")) patch.playbook = flagStr(ctx.flags, "playbook");
  if (flagBool(ctx.flags, "auto-review")) patch.autoReview = true;
  const next = await ctx.client.patch<LinkedRepo>(`/api/repos/${repo.id}`, patch);
  done(ctx, next, () => `${next.id}  ${next.name}`);
}

async function cmdRepoPulls(ctx: Ctx): Promise<void> {
  const repo = await resolveRepo(ctx, need(ctx.args, 0, "repo id"));
  const state = flagStr(ctx.flags, "state") ?? "open";
  if (!isPullListState(state)) throw new UsageError("--state must be open, draft, or all");
  const qs = `state=${state}${flagBool(ctx.flags, "fresh") ? "&fresh=1" : ""}`;
  const rows = await ctx.client.get<
    Array<{ number: number; title: string; state: string; headRef?: string }>
  >(`/api/repos/${repo.id}/pulls?${qs}`);
  done(ctx, rows, () =>
    formatTable(rows, [
      { key: "number", header: "#", value: (row) => String(row.number) },
      { key: "title", header: "TITLE", value: (row) => truncate(row.title, 48) },
      { key: "state", header: "STATE", value: (row) => row.state },
      { key: "head", header: "HEAD", value: (row) => row.headRef ?? "" },
    ]),
  );
}

async function cmdRepoPull(ctx: Ctx): Promise<void> {
  const repo = await resolveRepo(ctx, need(ctx.args, 0, "repo id"));
  const number = need(ctx.args, 1, "pull number");
  const qs = flagBool(ctx.flags, "fresh") ? "?fresh=1" : "";
  const pull = await ctx.client.get<unknown>(`/api/repos/${repo.id}/pulls/${number}${qs}`);
  done(ctx, pull, () => JSON.stringify(pull, null, 2));
}

async function cmdRepoComment(ctx: Ctx): Promise<void> {
  const repo = await resolveRepo(ctx, need(ctx.args, 0, "repo id"));
  const number = need(ctx.args, 1, "pull number");
  const body = flagStr(ctx.flags, "body") || restJoin(ctx.args, 2);
  if (!body) throw new UsageError("Need --body");
  const result = await ctx.client.post(`/api/repos/${repo.id}/pulls/${number}/comments`, {
    body,
    path: flagStr(ctx.flags, "path"),
    line: flagNum(ctx.flags, "line"),
    side: flagStr(ctx.flags, "side"),
  });
  done(ctx, result, () => `Commented on ${repo.name}#${number}`);
}

async function cmdRepoReview(ctx: Ctx): Promise<void> {
  const repo = await resolveRepo(ctx, need(ctx.args, 0, "repo id"));
  const number = need(ctx.args, 1, "pull number");
  const body = flagStr(ctx.flags, "body") || restJoin(ctx.args, 2);
  if (!body) throw new UsageError("Need --body");
  const result = await ctx.client.post(`/api/repos/${repo.id}/pulls/${number}/reviews`, {
    body,
    event: flagStr(ctx.flags, "event") || "COMMENT",
  });
  done(ctx, result, () => `Review on ${repo.name}#${number}`);
}

async function cmdRepoMerge(ctx: Ctx): Promise<void> {
  const repo = await resolveRepo(ctx, need(ctx.args, 0, "repo id"));
  const number = need(ctx.args, 1, "pull number");
  const result = await ctx.client.post(`/api/repos/${repo.id}/pulls/${number}/merge`);
  done(ctx, result, () => `Merged ${repo.name}#${number}`);
}

async function cmdRepoAgent(ctx: Ctx): Promise<void> {
  const repo = await resolveRepo(ctx, need(ctx.args, 0, "repo id"));
  const session = await ctx.client.post<AgentSession>(`/api/repos/${repo.id}/agents`, {
    prompt: flagStr(ctx.flags, "prompt") || restJoin(ctx.args, 1) || undefined,
    title: flagStr(ctx.flags, "title"),
    runtime: flagStr(ctx.flags, "runtime"),
    model: flagStr(ctx.flags, "model"),
    providerId: flagStr(ctx.flags, "provider"),
    reuse: flagBool(ctx.flags, "reuse") && !flagBool(ctx.flags, "new"),
  });
  done(ctx, session, () => formatSession(session));
}

async function cmdRepoSetup(ctx: Ctx): Promise<void> {
  const repo = await resolveRepo(ctx, need(ctx.args, 0, "repo id"));
  const session = await ctx.client.post<AgentSession>(`/api/repos/${repo.id}/setup-environment`);
  done(ctx, session, () => formatSession(session));
}

async function cmdRepoFixSession(ctx: Ctx): Promise<void> {
  const repo = await resolveRepo(ctx, need(ctx.args, 0, "repo id"));
  const number = need(ctx.args, 1, "pull number");
  const session = await ctx.client.post<AgentSession>(
    `/api/repos/${repo.id}/pulls/${number}/fix-session`,
  );
  done(ctx, session, () => formatSession(session));
}

async function cmdRepoReviewSession(ctx: Ctx): Promise<void> {
  const repo = await resolveRepo(ctx, need(ctx.args, 0, "repo id"));
  const number = need(ctx.args, 1, "pull number");
  const session = await ctx.client.post<AgentSession>(
    `/api/repos/${repo.id}/pulls/${number}/review-session`,
  );
  done(ctx, session, () => formatSession(session));
}

async function cmdSlackStatus(ctx: Ctx): Promise<void> {
  const status = await ctx.client.get<Record<string, unknown>>("/api/slack/status");
  done(ctx, status, () =>
    formatKv(Object.entries(status).map(([k, v]) => [k, v === undefined ? "" : String(v)])),
  );
}

async function cmdSlackLogin(ctx: Ctx): Promise<void> {
  const started = await ctx.client.post<{ authorizeUrl: string; expiresIn: number }>(
    "/api/slack/oauth/start",
    {
      oauthClientId: flagStr(ctx.flags, "client-id"),
      oauthClientSecret: flagStr(ctx.flags, "client-secret"),
      accountId: flagStr(ctx.flags, "account"),
    },
  );
  done(
    ctx,
    started,
    () => `Open this URL, then return:\n${started.authorizeUrl}\nExpires in ${started.expiresIn}s`,
  );
}

async function cmdSlackLogout(ctx: Ctx): Promise<void> {
  const result = await ctx.client.post("/api/slack/oauth/disconnect", {
    accountId: flagStr(ctx.flags, "account"),
  });
  done(ctx, result, () => "Disconnected Slack");
}

async function cmdSlackChannels(ctx: Ctx): Promise<void> {
  const qs = flagBool(ctx.flags, "refresh") ? "?refresh=1" : "";
  const rows = await ctx.client.get<SlackConversation[]>(`/api/slack/conversations${qs}`);
  done(ctx, rows, () =>
    formatTable(rows, [
      { key: "id", header: "ID", value: (row) => row.id },
      { key: "name", header: "NAME", value: (row) => row.name },
      { key: "kind", header: "KIND", value: (row) => row.kind },
      { key: "star", header: "STAR", value: (row) => yn(row.starred) },
    ]),
  );
}

async function cmdSlackStar(ctx: Ctx, starred: boolean): Promise<void> {
  const channel = await resolveChannel(ctx, need(ctx.args, 0, "channel"));
  const rows = await ctx.client.post(`/api/slack/conversations/${channel.id}/star`, { starred });
  done(ctx, rows, () => `${starred ? "Starred" : "Unstarred"} ${channel.name}`);
}

async function cmdSlackHistory(ctx: Ctx): Promise<void> {
  const channel = await resolveChannel(ctx, need(ctx.args, 0, "channel"));
  const params = new URLSearchParams();
  if (flagStr(ctx.flags, "oldest")) params.set("oldest", flagStr(ctx.flags, "oldest")!);
  if (flagStr(ctx.flags, "latest")) params.set("latest", flagStr(ctx.flags, "latest")!);
  const qs = params.toString();
  const rows = await ctx.client.get<
    Array<{ ts: string; userName?: string; userId?: string; text: string }>
  >(`/api/slack/conversations/${channel.id}/history${qs ? `?${qs}` : ""}`);
  done(
    ctx,
    rows,
    () =>
      rows
        .map((row) => `${row.ts}  ${row.userName || row.userId || "?"}  ${row.text}`)
        .join("\n") || "(empty)",
  );
}

async function cmdSlackReplies(ctx: Ctx): Promise<void> {
  const channel = await resolveChannel(ctx, need(ctx.args, 0, "channel"));
  const ts = need(ctx.args, 1, "thread ts");
  const rows = await ctx.client.get<Array<{ ts: string; userName?: string; text: string }>>(
    `/api/slack/conversations/${channel.id}/replies?ts=${encodeURIComponent(ts)}`,
  );
  done(
    ctx,
    rows,
    () =>
      rows.map((row) => `${row.ts}  ${row.userName ?? "?"}  ${row.text}`).join("\n") || "(empty)",
  );
}

async function cmdSlackSend(ctx: Ctx): Promise<void> {
  const channel = await resolveChannel(ctx, need(ctx.args, 0, "channel"));
  const text = restJoin(ctx.args, 1) || flagStr(ctx.flags, "text");
  if (!text && !flagStr(ctx.flags, "gif")) throw new UsageError("Missing message text");
  const asRaw = flagStr(ctx.flags, "as");
  const message = await ctx.client.post(`/api/slack/conversations/${channel.id}/messages`, {
    text: text || "",
    threadTs: flagStr(ctx.flags, "thread"),
    as: asRaw ? parseSlackPostAs(asRaw) : undefined,
    gif: flagStr(ctx.flags, "gif") ? { url: flagStr(ctx.flags, "gif") } : undefined,
  });
  done(ctx, message, () => JSON.stringify(message, null, 2));
}

async function cmdSlackReact(ctx: Ctx): Promise<void> {
  const channel = await resolveChannel(ctx, need(ctx.args, 0, "channel"));
  const ts = need(ctx.args, 1, "message ts");
  const name = need(ctx.args, 2, "emoji name");
  const result = await ctx.client.post(`/api/slack/conversations/${channel.id}/reactions`, {
    ts,
    name,
    remove: flagBool(ctx.flags, "remove"),
    threadTs: flagStr(ctx.flags, "thread"),
  });
  done(ctx, result, () => `${flagBool(ctx.flags, "remove") ? "Removed" : "Added"} :${name}:`);
}

async function cmdSlackGif(ctx: Ctx): Promise<void> {
  const q = flagStr(ctx.flags, "query") || restJoin(ctx.args) || "";
  const result = await ctx.client.get<{ hits: Array<{ id: string; title: string; url: string }> }>(
    `/api/slack/giphy${q ? `?q=${encodeURIComponent(q)}` : ""}`,
  );
  done(ctx, result, () =>
    formatTable(result.hits, [
      { key: "id", header: "ID", value: (row) => row.id },
      { key: "title", header: "TITLE", value: (row) => row.title },
      { key: "url", header: "URL", value: (row) => row.url },
    ]),
  );
}

async function cmdSlackAsk(ctx: Ctx): Promise<void> {
  const channel = await resolveChannel(ctx, need(ctx.args, 0, "channel"));
  const text = restJoin(ctx.args, 1) || flagStr(ctx.flags, "text");
  if (!text) throw new UsageError("Missing Ask Locus text");
  const result = await ctx.client.post("/api/slack/run", {
    channelId: channel.id,
    threadTs: flagStr(ctx.flags, "thread"),
    text,
    providerId: flagStr(ctx.flags, "provider"),
    model: flagStr(ctx.flags, "model"),
  });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdDockerList(ctx: Ctx): Promise<void> {
  const result = await ctx.client.get<{
    kind: string;
    containers: Array<{ id: string; name: string; image: string; state: string; status?: string }>;
  }>("/api/docker/containers");
  done(ctx, result, () =>
    formatTable(result.containers, [
      { key: "id", header: "ID", value: (row) => shortId(row.id, 12) },
      { key: "name", header: "NAME", value: (row) => row.name },
      { key: "image", header: "IMAGE", value: (row) => row.image },
      { key: "state", header: "STATE", value: (row) => row.state },
    ]),
  );
}

async function cmdDockerGet(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "container id");
  const row = await ctx.client.get<unknown>(`/api/docker/containers/${encodeURIComponent(id)}`);
  done(ctx, row, () => JSON.stringify(row, null, 2));
}

async function cmdDockerAction(ctx: Ctx, action: "start" | "stop" | "restart"): Promise<void> {
  const id = need(ctx.args, 0, "container id");
  const row = await ctx.client.post(`/api/docker/containers/${encodeURIComponent(id)}/${action}`);
  done(ctx, row, () => `${action} ${id}`);
}

async function cmdDockerStopMany(ctx: Ctx): Promise<void> {
  if (!ctx.args.length) throw new UsageError("Pass one or more container ids");
  const result = await ctx.client.post("/api/docker/containers/stop", { ids: ctx.args });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdDockerLogs(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "container id");
  const tail = flagNum(ctx.flags, "tail");
  const logs = await ctx.client.get<{ text: string }>(
    `/api/docker/containers/${encodeURIComponent(id)}/logs${tail ? `?tail=${tail}` : ""}`,
  );
  done(ctx, logs, () => logs.text || "(empty)");
}

async function cmdDockerStats(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "container id");
  const stats = await ctx.client.get<unknown>(
    `/api/docker/containers/${encodeURIComponent(id)}/stats`,
  );
  done(ctx, stats, () => JSON.stringify(stats, null, 2));
}

type DockerSwarmSnapshot = {
  kind?: string;
  info: {
    state: string;
    controlAvailable: boolean;
    nodeId?: string;
    nodeAddr?: string;
    error?: string;
  };
  nodes: Array<{
    id: string;
    hostname: string;
    status: string;
    availability: string;
    managerStatus?: string;
  }>;
  services: Array<{
    id: string;
    name: string;
    image: string;
    mode: string;
    replicas: string;
    ports?: string;
  }>;
  stacks: Array<{ name: string; services: number; orchestrator?: string }>;
};

async function loadDockerSwarm(ctx: Ctx): Promise<DockerSwarmSnapshot> {
  return ctx.client.get<DockerSwarmSnapshot>("/api/docker/swarm");
}

function swarmStatusText(row: DockerSwarmSnapshot): string {
  const bits = [`state ${row.info.state}`];
  bits.push(row.info.controlAvailable ? "manager" : "worker");
  if (row.info.nodeAddr) bits.push(row.info.nodeAddr);
  if (row.info.error) bits.push(row.info.error);
  bits.push(`${row.nodes.length} nodes`);
  bits.push(`${row.services.length} services`);
  bits.push(`${row.stacks.length} stacks`);
  return bits.join(" · ");
}

async function cmdGrafanaHelp(ctx: Ctx): Promise<void> {
  ctx.writeln(helpFor(["grafana"]));
}

async function cmdGrafanaStatus(ctx: Ctx): Promise<void> {
  const status = await ctx.client.get<Record<string, unknown>>("/api/grafana/status");
  done(ctx, status, () =>
    formatKv(
      Object.entries(status)
        .filter(([key]) => key !== "datasources")
        .map(([k, v]) => [
          k,
          Array.isArray(v) ? String(v.length) : v === undefined ? "" : String(v),
        ]),
    ),
  );
}

async function cmdGrafanaDashboards(ctx: Ctx): Promise<void> {
  const q = restJoin(ctx.args) || flagStr(ctx.flags, "q") || "";
  const rows = await ctx.client.get<
    Array<{ uid: string; title: string; tags?: string[]; url?: string }>
  >(`/api/grafana/dashboards${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
  done(ctx, rows, () =>
    formatTable(rows, [
      { key: "uid", header: "UID", value: (row) => row.uid },
      { key: "title", header: "TITLE", value: (row) => row.title },
      { key: "tags", header: "TAGS", value: (row) => (row.tags ?? []).join(",") },
    ]),
  );
}

async function cmdGrafanaQuery(ctx: Ctx): Promise<void> {
  const query = restJoin(ctx.args) || flagStr(ctx.flags, "query") || flagStr(ctx.flags, "q");
  if (!query) throw new UsageError("lucene query is required");
  const payload: {
    query: string;
    from?: string;
    to?: string;
    datasource?: string;
    limit?: number;
  } = { query };
  const from = flagStr(ctx.flags, "from");
  const to = flagStr(ctx.flags, "to");
  const datasource = flagStr(ctx.flags, "datasource");
  const limit = flagNum(ctx.flags, "limit");
  if (from) payload.from = from;
  if (to) payload.to = to;
  if (datasource) payload.datasource = datasource;
  if (limit != null) payload.limit = limit;
  const row = await ctx.client.post<{
    lucene: string;
    explore_url: string;
    from: string;
    to: string;
    count?: number;
    logs?: Array<{ timestamp?: string; level?: string; message?: string }>;
  }>("/api/grafana/query", payload);
  done(ctx, row, () => grafanaQueryText(row));
}

async function cmdGrafanaGet(ctx: Ctx): Promise<void> {
  const token = need(ctx.args, 0, "dashboard uid");
  const from = flagStr(ctx.flags, "from");
  const to = flagStr(ctx.flags, "to");
  const uid = await resolveGrafanaDashboard(ctx, token);
  const payload: { from?: string; to?: string } = {};
  if (from) payload.from = from;
  if (to) payload.to = to;
  const row = await ctx.client.post<{
    uid: string;
    title: string;
    url?: string;
    from: string;
    to: string;
    panels: Array<{
      title: string;
      type: string;
      error?: string;
      stat?: { value: string; unit?: string };
      series?: Array<{ name: string; points: Array<{ t: number; value: number }> }>;
      logs?: unknown[];
      table?: { rows: unknown[] };
      text?: string;
    }>;
  }>(`/api/grafana/dashboards/${encodeURIComponent(uid)}/query`, payload);
  done(ctx, row, () => grafanaDashboardText(row));
}

async function resolveGrafanaDashboard(ctx: Ctx, token: string): Promise<string> {
  const rows = await ctx.client.get<Array<{ uid: string; title: string }>>(
    `/api/grafana/dashboards?q=${encodeURIComponent(token)}`,
  );
  const exact = rows.find((row) => row.uid === token);
  if (exact) return exact.uid;
  const names = rows.filter((row) => row.title.toLowerCase().includes(token.toLowerCase()));
  if (names.length === 1) return names[0]!.uid;
  if (names.length > 1) throw new UsageError(`Ambiguous dashboard ${token}`);
  if (/^[\w-]+$/.test(token)) return token;
  throw new UsageError(`No Grafana dashboard matches ${token}`);
}

function grafanaQueryText(row: {
  lucene: string;
  explore_url: string;
  from: string;
  to: string;
  count?: number;
  logs?: Array<{ timestamp?: string; level?: string; message?: string }>;
}): string {
  const head = formatKv([
    ["lucene", row.lucene],
    ["range", `${row.from} → ${row.to}`],
    ["count", row.count != null ? String(row.count) : ""],
    ["explore", row.explore_url],
  ]);
  const logs = (row.logs ?? [])
    .map((hit) =>
      [hit.timestamp ?? "", hit.level ?? "", truncate(hit.message ?? "", 180)]
        .filter(Boolean)
        .join(" "),
    )
    .join("\n");
  return logs ? `${head}\n${logs}` : head;
}

function grafanaDashboardText(row: {
  title: string;
  url?: string;
  from: string;
  to: string;
  panels: Array<{
    title: string;
    type: string;
    error?: string;
    stat?: { value: string; unit?: string };
    series?: Array<{ name: string; points: Array<{ t: number; value: number }> }>;
    logs?: unknown[];
    table?: { rows: unknown[] };
    text?: string;
  }>;
}): string {
  const head = formatKv([
    ["title", row.title],
    ["range", `${row.from} → ${row.to}`],
    ["url", row.url],
  ]);
  const panels = formatTable(row.panels, [
    { key: "title", header: "PANEL", value: (panel) => panel.title },
    { key: "type", header: "TYPE", value: (panel) => panel.type },
    {
      key: "value",
      header: "VALUE",
      value: (panel) => {
        if (panel.error) return panel.error;
        if (panel.stat?.value)
          return panel.stat.unit ? `${panel.stat.value} ${panel.stat.unit}` : panel.stat.value;
        const last = panel.series?.[0]?.points.at(-1);
        if (last) return String(last.value);
        if (panel.logs?.length) return `${panel.logs.length} logs`;
        if (panel.table?.rows.length) return `${panel.table.rows.length} rows`;
        if (panel.text?.trim()) return truncate(panel.text, 40);
        return "No data";
      },
    },
  ]);
  return `${head}\n${panels}`;
}

async function cmdDockerSwarmStatus(ctx: Ctx): Promise<void> {
  const snapshot = await loadDockerSwarm(ctx);
  done(ctx, snapshot, () => swarmStatusText(snapshot));
}

async function cmdDockerSwarmNodes(ctx: Ctx): Promise<void> {
  const snapshot = await loadDockerSwarm(ctx);
  done(ctx, snapshot.nodes, () =>
    formatTable(snapshot.nodes, [
      { key: "id", header: "ID", value: (row) => shortId(row.id, 12) },
      { key: "hostname", header: "HOSTNAME", value: (row) => row.hostname },
      { key: "status", header: "STATUS", value: (row) => row.status },
      { key: "availability", header: "AVAIL", value: (row) => row.availability },
      { key: "managerStatus", header: "MANAGER", value: (row) => row.managerStatus ?? "" },
    ]),
  );
}

async function cmdDockerSwarmServices(ctx: Ctx): Promise<void> {
  const snapshot = await loadDockerSwarm(ctx);
  done(ctx, snapshot.services, () =>
    formatTable(snapshot.services, [
      { key: "id", header: "ID", value: (row) => shortId(row.id, 12) },
      { key: "name", header: "NAME", value: (row) => row.name },
      { key: "mode", header: "MODE", value: (row) => row.mode },
      { key: "replicas", header: "REPLICAS", value: (row) => row.replicas },
      { key: "image", header: "IMAGE", value: (row) => row.image },
    ]),
  );
}

async function cmdDockerSwarmStacks(ctx: Ctx): Promise<void> {
  const snapshot = await loadDockerSwarm(ctx);
  done(ctx, snapshot.stacks, () =>
    formatTable(snapshot.stacks, [
      { key: "name", header: "NAME", value: (row) => row.name },
      { key: "services", header: "SERVICES", value: (row) => String(row.services) },
      { key: "orchestrator", header: "ORCH", value: (row) => row.orchestrator ?? "" },
    ]),
  );
}

async function cmdDockerSwarmGet(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "service id");
  const row = await ctx.client.get<unknown>(`/api/docker/swarm/services/${encodeURIComponent(id)}`);
  done(ctx, row, () => JSON.stringify(row, null, 2));
}

async function cmdDockerSwarmLogs(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "service id");
  const tail = flagNum(ctx.flags, "tail");
  const logs = await ctx.client.get<{ text: string }>(
    `/api/docker/swarm/services/${encodeURIComponent(id)}/logs${tail ? `?tail=${tail}` : ""}`,
  );
  done(ctx, logs, () => logs.text || "(empty)");
}

async function cmdDockerSwarmScale(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "service id");
  const replicas = flagNum(ctx.flags, "replicas") ?? Number.parseInt(ctx.args[1] ?? "", 10);
  if (!Number.isFinite(replicas)) throw new UsageError("Need replica count");
  const row = await ctx.client.post(`/api/docker/swarm/services/${encodeURIComponent(id)}/scale`, {
    replicas,
  });
  done(ctx, row, () => JSON.stringify(row, null, 2));
}

async function resolveProject(ctx: Ctx, token: string): Promise<ProjectSummary> {
  const rows = await ctx.client.get<ProjectSummary[]>("/api/projects");
  const exact = rows.find((row) => row.id === token);
  if (exact) return exact;
  const prefixes = rows.filter((row) => row.id.startsWith(token));
  if (prefixes.length === 1) return prefixes[0]!;
  const names = rows.filter((row) => row.title.toLowerCase().includes(token.toLowerCase()));
  if (names.length === 1) return names[0]!;
  if (prefixes.length > 1 || names.length > 1) throw new UsageError(`Ambiguous project ${token}`);
  throw new UsageError(`No project matches ${token}`);
}

async function cmdProjectList(ctx: Ctx): Promise<void> {
  const rows = await ctx.client.get<ProjectSummary[]>("/api/projects");
  done(ctx, rows, () =>
    formatTable(rows, [
      { key: "id", header: "ID", value: (row) => shortId(row.id) },
      { key: "title", header: "TITLE", value: (row) => row.title },
      { key: "starter", header: "STARTER", value: (row) => row.starter ?? "blank" },
      { key: "members", header: "MEMBERS", value: (row) => String(row.memberCount) },
      { key: "paused", header: "PAUSED", value: (row) => yn(Boolean(row.paused)) },
    ]),
  );
}

async function cmdProjectGet(ctx: Ctx): Promise<void> {
  const row = await ctx.client.get<ProjectDocument>(
    `/api/projects/${(await resolveProject(ctx, need(ctx.args, 0, "project id"))).id}`,
  );
  done(ctx, row, () =>
    formatKv([
      ["id", row.id],
      ["title", row.title],
      ["starter", row.recipeId ?? "blank"],
      ["coordinator", row.coordinatorSessionId ?? ""],
      ["members", String(row.memberIds.length)],
      ["paused", yn(Boolean(row.paused))],
      ["keepAlive", yn(Boolean(row.keepAlive))],
      ["placement", row.placement ?? "local"],
    ]),
  );
}

async function cmdProjectNew(ctx: Ctx): Promise<void> {
  const starterFlag = flagStr(ctx.flags, "starter");
  const starter = isProjectStarter(starterFlag) ? starterFlag : "blank";
  const created = await ctx.client.post<ProjectDocument>("/api/projects", {
    title: flagStr(ctx.flags, "title"),
    starter,
    prompt: restJoin(ctx.args, 0) || undefined,
  });
  done(ctx, created, () => `${shortId(created.id)}  ${created.title}`);
}

async function cmdProjectChat(ctx: Ctx): Promise<void> {
  const project = await resolveProject(ctx, need(ctx.args, 0, "project id"));
  const content = restJoin(ctx.args, 1);
  const opened = await ctx.client.post<{ project: ProjectDocument; sessionId: string }>(
    `/api/projects/${project.id}/chat`,
    { prompt: content || undefined },
  );
  if (!content) {
    done(ctx, opened, () => `Coordinator ${shortId(opened.sessionId)}`);
    return;
  }
  const timeoutMs = (flagNum(ctx.flags, "timeout") ?? 600) * 1000;
  const next = await waitForTurn(ctx, opened.sessionId, timeoutMs);
  if (ctx.json) printJson(ctx.writeln, next);
  else printTranscript(ctx, next);
}

async function cmdProjectPause(ctx: Ctx, paused: boolean): Promise<void> {
  const project = await resolveProject(ctx, need(ctx.args, 0, "project id"));
  const next = await ctx.client.put<ProjectDocument>(`/api/projects/${project.id}`, { paused });
  done(ctx, next, () => `${next.title} ${paused ? "paused" : "resumed"}`);
}

async function cmdProjectKeep(ctx: Ctx, keepAlive: boolean): Promise<void> {
  const project = await resolveProject(ctx, need(ctx.args, 0, "project id"));
  const next = await ctx.client.put<ProjectDocument>(`/api/projects/${project.id}`, { keepAlive });
  done(
    ctx,
    next,
    () =>
      `${next.title} ${keepAlive ? "stays running after you quit Locus" : "stops with the desktop"}`,
  );
}

async function cmdBrainSetup(ctx: Ctx): Promise<void> {
  const dir = restJoin(ctx.args, 0) || process.cwd();
  const port = flagNum(ctx.flags, "port") ?? 7420;
  const written = await applyBrainSetup(dir, port);
  done(
    ctx,
    { dir, port, written },
    () => `Brain hooks in ${dir}\n${written.map((path) => `  ${path}`).join("\n")}`,
  );
}

async function cmdBrainStatus(ctx: Ctx): Promise<void> {
  const row = await ctx.client.get<BrainSummary>("/api/brain/status");
  done(ctx, row, () =>
    formatKv([
      ["id", row.id],
      ["title", row.title],
      ["nodes", String(row.nodeCount)],
      ["edges", String(row.edgeCount)],
      ["memories", String(row.memoryCount)],
      ["updated", row.updatedAt],
      ["empty", yn(row.empty)],
      ["inbox", String(row.inboxCount ?? 0)],
    ]),
  );
}

async function cmdBrainBuild(ctx: Ctx): Promise<void> {
  const path = restJoin(ctx.args, 0);
  const row = await ctx.client.post<BrainDocument & { output?: string }>("/api/brain/build", {
    path: path || undefined,
  });
  done(ctx, row, () => row.output || `Brain ${row.id}: ${row.nodes.length} nodes`);
}

async function cmdBrainSearch(ctx: Ctx): Promise<void> {
  const q = restJoin(ctx.args, 0);
  if (!q) throw new UsageError("search text is required");
  const row = await ctx.client.post<{ output: string }>("/api/brain/search", { q });
  done(ctx, row, () => row.output || "No matches.");
}

async function cmdBrainRemember(ctx: Ctx): Promise<void> {
  const text = restJoin(ctx.args, 0);
  if (!text) throw new UsageError("text is required");
  const row = await ctx.client.post<BrainDocument & { output?: string }>("/api/brain/remember", {
    text,
  });
  done(ctx, row, () => row.output || "Saved.");
}

async function cmdBrainInbox(ctx: Ctx): Promise<void> {
  const doc = await ctx.client.get<BrainDocument>("/api/brain");
  const rows = openBrainCorrections(doc);
  done(ctx, rows, () =>
    rows.length
      ? formatTable(rows, [
          { key: "id", header: "ID", value: (row) => shortId(row.id) },
          { key: "target", header: "TARGET", value: (row) => row.nodeId || row.memoryId || "—" },
          { key: "reason", header: "REASON", value: (row) => truncate(row.reason, 60) },
        ])
      : "Inbox is empty.",
  );
}

async function cmdBrainCorrect(ctx: Ctx): Promise<void> {
  const accept = flagBool(ctx.flags, "accept");
  const dismiss = flagBool(ctx.flags, "dismiss");
  if (accept && dismiss) throw new UsageError("Use --accept or --dismiss, not both");
  if (accept || dismiss) {
    const id = need(ctx.args, 0, "correction id");
    const row = await ctx.client.post<BrainDocument & { output?: string }>("/api/brain/correct", {
      id,
      action: accept ? "accepted" : "dismissed",
    });
    done(ctx, row, () => row.output || (accept ? "Accepted." : "Dismissed."));
    return;
  }
  const reason = restJoin(ctx.args, 0);
  if (!reason) throw new UsageError("reason is required (or pass --accept/--dismiss <id>)");
  const nodeId = flagStr(ctx.flags, "node");
  const memoryId = flagStr(ctx.flags, "memory");
  if (!nodeId && !memoryId) throw new UsageError("Pass --node or --memory");
  const row = await ctx.client.post<BrainDocument & { output?: string }>("/api/brain/correct", {
    reason,
    nodeId,
    memoryId,
  });
  done(ctx, row, () => row.output || "Queued.");
}

async function cmdAutoList(ctx: Ctx): Promise<void> {
  const rows = await ctx.client.get<Automation[]>("/api/automations");
  done(ctx, rows, () =>
    formatTable(rows, [
      { key: "id", header: "ID", value: (row) => shortId(row.id) },
      { key: "name", header: "NAME", value: (row) => row.name },
      { key: "on", header: "ON", value: (row) => yn(row.enabled) },
      { key: "schedule", header: "SCHEDULE", value: (row) => row.schedule.kind },
      { key: "runtime", header: "RUNTIME", value: (row) => row.runtime ?? "vm" },
    ]),
  );
}

async function cmdAutoGet(ctx: Ctx): Promise<void> {
  const row = await resolveAutomation(ctx, need(ctx.args, 0, "automation id"));
  done(ctx, row, () =>
    formatKv([
      ["id", row.id],
      ["name", row.name],
      ["enabled", yn(row.enabled)],
      ["schedule", JSON.stringify(row.schedule)],
      ["prompt", truncate(row.prompt, 80)],
      ["next", row.nextRunAt],
    ]),
  );
}

function parseSchedule(flags: Flags): CreateAutomationInput["schedule"] {
  const kind = flagStr(flags, "schedule") ?? "interval";
  if (kind === "interval") {
    return { kind: "interval", everyMinutes: flagNum(flags, "every") ?? 60 };
  }
  if (kind === "daily") {
    return {
      kind: "daily",
      hour: flagNum(flags, "hour") ?? 9,
      minute: flagNum(flags, "minute") ?? 0,
    };
  }
  if (kind === "weekly") {
    return {
      kind: "weekly",
      weekday: flagNum(flags, "weekday") ?? 1,
      hour: flagNum(flags, "hour") ?? 9,
      minute: flagNum(flags, "minute") ?? 0,
    };
  }
  if (kind === "cron") {
    const expr = flagStr(flags, "cron");
    if (!expr) throw new UsageError("--cron expression required");
    return { kind: "cron", expr };
  }
  if (kind === "adaptive") {
    const start = flagStr(flags, "start") ?? "09:00";
    const end = flagStr(flags, "end") ?? "17:00";
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const weekdays = (flagStr(flags, "weekdays") ?? "")
      .split(",")
      .map((row) => Number(row.trim()))
      .filter((day) => Number.isInteger(day));
    return {
      kind: "adaptive",
      startHour: sh ?? 9,
      startMinute: sm ?? 0,
      endHour: eh ?? 17,
      endMinute: em ?? 0,
      everyMinutes: flagNum(flags, "every") ?? 60,
      otherwiseEveryMinutes: flagNum(flags, "otherwise") ?? 180,
      ...(weekdays.length ? { weekdays } : {}),
    };
  }
  if (kind === "forge" || kind === "pull_request" || kind === "webhook") return { kind };
  throw new UsageError(
    "--schedule must be interval, daily, weekly, cron, adaptive, forge, pull_request, or webhook",
  );
}

async function cmdAutoNew(ctx: Ctx): Promise<void> {
  const config = await loadConfig(ctx);
  const osRaw = flagStr(ctx.flags, "os") ?? "ubuntu";
  if (!isGuestOs(osRaw)) throw new UsageError("Invalid --os");
  const provider =
    config.providers.find((row) => row.id === flagStr(ctx.flags, "provider")) ??
    config.providers.find((row) => row.enabled) ??
    config.providers[0];
  if (!provider) throw new UsageError("Add a model provider first");
  const templateId = config.templates.find((row) => row.os === osRaw)?.id ?? "";
  const input: CreateAutomationInput = {
    name: flagStr(ctx.flags, "name") || need(ctx.args, 0, "name"),
    prompt: flagStr(ctx.flags, "prompt") || restJoin(ctx.args, 1) || "",
    os: osRaw,
    templateId,
    runtime: isAgentRuntime(flagStr(ctx.flags, "runtime") ?? "docker")
      ? ((flagStr(ctx.flags, "runtime") ?? "docker") as CreateAutomationInput["runtime"])
      : "docker",
    providerId: provider.id,
    model: flagStr(ctx.flags, "model") || provider.defaultModel,
    schedule: parseSchedule(ctx.flags),
    enabled: !flagBool(ctx.flags, "disabled"),
    reuseSession: flagBool(ctx.flags, "reuse"),
    persistMemory: flagBool(ctx.flags, "persist-memory"),
    repoId: flagList(ctx.flags, "repo")[0],
    notifyWebhook: flagStr(ctx.flags, "notify"),
    notifyChannel: flagStr(ctx.flags, "channel"),
    timeZone: flagStr(ctx.flags, "timezone"),
    overlap: parseOverlapFlag(flagStr(ctx.flags, "overlap")),
    lifetimeMaxUsd: flagNum(ctx.flags, "lifetime-max-usd"),
    blackoutDates: parseBlackoutFlag(flagStr(ctx.flags, "blackout")),
    notify: parseNotifyFlag(flagStr(ctx.flags, "notify-on")),
  };
  if (!input.prompt) throw new UsageError("Need --prompt");
  const row = await ctx.client.post<Automation>("/api/automations", input);
  done(ctx, row, () => `${row.id}  ${row.name}  ${row.schedule.kind}`);
}

async function cmdAutoPatch(ctx: Ctx): Promise<void> {
  const row = await resolveAutomation(ctx, need(ctx.args, 0, "automation id"));
  const patch: Record<string, unknown> = {};
  if (flagStr(ctx.flags, "name")) patch.name = flagStr(ctx.flags, "name");
  if (flagStr(ctx.flags, "prompt")) patch.prompt = flagStr(ctx.flags, "prompt");
  if (flagStr(ctx.flags, "schedule")) patch.schedule = parseSchedule(ctx.flags);
  if (flagStr(ctx.flags, "timezone")) patch.timeZone = flagStr(ctx.flags, "timezone");
  if (flagStr(ctx.flags, "overlap"))
    patch.overlap = parseOverlapFlag(flagStr(ctx.flags, "overlap"));
  if (flagStr(ctx.flags, "lifetime-max-usd")) {
    patch.lifetimeMaxUsd = flagNum(ctx.flags, "lifetime-max-usd");
  }
  if (flagStr(ctx.flags, "blackout"))
    patch.blackoutDates = parseBlackoutFlag(flagStr(ctx.flags, "blackout"));
  if (flagStr(ctx.flags, "notify-on"))
    patch.notify = parseNotifyFlag(flagStr(ctx.flags, "notify-on"));
  const next = await ctx.client.put<Automation>(`/api/automations/${row.id}`, patch);
  done(ctx, next, () => `${next.id}  ${next.name}`);
}

async function cmdAutoEnabled(ctx: Ctx, enabled: boolean): Promise<void> {
  const row = await resolveAutomation(ctx, need(ctx.args, 0, "automation id"));
  const next = await ctx.client.put<Automation>(`/api/automations/${row.id}`, { enabled });
  done(ctx, next, () => `${next.name} ${enabled ? "enabled" : "disabled"}`);
}

async function cmdAutoDelete(ctx: Ctx): Promise<void> {
  const row = await resolveAutomation(ctx, need(ctx.args, 0, "automation id"));
  await ctx.client.delete(`/api/automations/${row.id}`);
  done(ctx, { ok: true, id: row.id }, () => `Deleted ${row.name}`);
}

async function cmdAutoRun(ctx: Ctx): Promise<void> {
  const row = await resolveAutomation(ctx, need(ctx.args, 0, "automation id"));
  const replay = flagStr(ctx.flags, "replay");
  const run = await ctx.client.post(
    `/api/automations/${row.id}/run`,
    replay ? { runId: replay } : undefined,
  );
  done(ctx, run, () => JSON.stringify(run, null, 2));
}

function parseOverlapFlag(value: string | undefined): "skip" | "coalesce" | "queue" | undefined {
  if (!value) return undefined;
  if (value === "skip" || value === "coalesce" || value === "queue") return value;
  throw new UsageError("--overlap must be skip, coalesce, or queue");
}

function parseBlackoutFlag(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  return value
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean);
}

function parseNotifyFlag(
  value: string | undefined,
): { success: boolean; failure: boolean; needsYou: boolean } | undefined {
  if (!value?.trim()) return undefined;
  const names = new Set(
    value
      .split(",")
      .map((row) => row.trim().toLowerCase())
      .filter(Boolean),
  );
  return {
    success: names.has("success"),
    failure: names.has("failure"),
    needsYou: names.has("needs-you") || names.has("needs_you") || names.has("needsyou"),
  };
}

async function cmdAutoRuns(ctx: Ctx): Promise<void> {
  const id = ctx.args[0];
  const rows = await ctx.client.get<
    Array<{ id: string; status: string; trigger: string; startedAt: string; error?: string }>
  >(id ? `/api/automations/${(await resolveAutomation(ctx, id)).id}/runs` : "/api/automation-runs");
  done(ctx, rows, () =>
    formatTable(rows, [
      { key: "id", header: "ID", value: (row) => shortId(row.id) },
      { key: "status", header: "STATUS", value: (row) => row.status },
      { key: "trigger", header: "TRIGGER", value: (row) => row.trigger },
      { key: "started", header: "STARTED", value: (row) => row.startedAt },
    ]),
  );
}

async function cmdConfigShow(ctx: Ctx): Promise<void> {
  const config = await loadConfig(ctx);
  const policy = config.managedPolicy;
  done(ctx, config, () =>
    formatKv([
      ["theme", config.theme],
      ["providers", String(config.providers.length)],
      ["templates", String(config.templates.length)],
      ["forges", String(config.forges.length)],
      ["mcp", String(config.mcpServers?.length ?? 0)],
      ["skills", String(config.skills?.length ?? 0)],
      ["bind", `${config.advanced.bindHost}:${config.advanced.bindPort}`],
      ["dataDir", config.advanced.dataDir],
      [
        "policy",
        policy?.active
          ? `${policy.policy.name ?? "organization"} (${policy.source ?? "active"})`
          : "off",
      ],
    ]),
  );
}

async function cmdConfigPolicy(ctx: Ctx): Promise<void> {
  const config = await loadConfig(ctx);
  const policy = config.managedPolicy;
  done(ctx, policy ?? { active: false }, () => {
    if (!policy?.active) return "No managed policy is active.";
    return formatKv([
      ["name", policy.policy.name ?? "organization"],
      ["source", policy.source ?? ""],
      ["signed", policy.signed ? "yes" : "no"],
      ["locked", policy.locked.join(", ")],
      ["providers", (policy.policy.allowedProviders ?? []).join(", ")],
      ["token-free", policy.policy.tokenFreeMode ? "yes" : "no"],
      ["gif", policy.policy.gifLookup ? "on" : "off"],
    ]);
  });
}

async function cmdRevokeAll(ctx: Ctx): Promise<void> {
  if (flagStr(ctx.flags, "confirm") !== "REVOKE") {
    throw new UsageError("Refusing to revoke tokens. Pass --confirm REVOKE");
  }
  const result = await ctx.client.post("/api/integrations/revoke-all", { confirm: "REVOKE" });
  done(ctx, result, () => "Revoked all integration tokens.");
}

async function cmdDebugEgress(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session"));
  const summary = await ctx.client.get<{
    hosts: Array<{
      host: string;
      allowed: number;
      denied: number;
      bytesSent: number;
      kind: string;
    }>;
    bytesSent: number;
  }>(`/api/sessions/${session.id}/audit/egress`);
  done(ctx, summary, () =>
    formatTable(summary.hosts, [
      { key: "host", header: "HOST", value: (row) => row.host },
      { key: "kind", header: "KIND", value: (row) => row.kind },
      { key: "allowed", header: "ALLOW", value: (row) => String(row.allowed) },
      { key: "denied", header: "DENY", value: (row) => String(row.denied) },
      { key: "bytes", header: "BYTES", value: (row) => String(row.bytesSent) },
    ]),
  );
}

async function cmdDebugApprovals(ctx: Ctx): Promise<void> {
  const id = ctx.args[0];
  const path = id
    ? `/api/sessions/${(await resolveSession(ctx, id)).id}/audit/approvals`
    : "/api/audit/approvals";
  const result = await ctx.client.get<{
    approvals: Array<{
      t: string;
      sessionId: string;
      tool: string;
      decision: string;
      by: string;
      category: string;
    }>;
  }>(path);
  done(ctx, result, () =>
    formatTable(result.approvals, [
      { key: "t", header: "WHEN", value: (row) => row.t },
      { key: "session", header: "SESSION", value: (row) => shortId(row.sessionId) },
      { key: "tool", header: "TOOL", value: (row) => row.tool },
      { key: "decision", header: "DECISION", value: (row) => row.decision },
      { key: "by", header: "BY", value: (row) => row.by },
      { key: "category", header: "KIND", value: (row) => row.category },
    ]),
  );
}

async function cmdProviders(ctx: Ctx): Promise<void> {
  const config = await loadConfig(ctx);
  done(ctx, config.providers, () =>
    formatTable(config.providers, [
      { key: "id", header: "ID", value: (row) => shortId(row.id) },
      { key: "name", header: "NAME", value: (row) => row.name },
      { key: "kind", header: "KIND", value: (row) => row.kind },
      { key: "on", header: "ON", value: (row) => yn(row.enabled) },
      { key: "model", header: "DEFAULT", value: (row) => row.defaultModel },
    ]),
  );
}

async function cmdProviderTest(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "provider id");
  const result = await ctx.client.post(`/api/providers/${id}/test`, {
    apiKey: flagStr(ctx.flags, "key"),
    baseUrl: flagStr(ctx.flags, "base-url"),
  });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdProviderModels(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "provider id");
  const result = await ctx.client.post<{ models: string[] }>(`/api/providers/${id}/models`, {
    apiKey: flagStr(ctx.flags, "key"),
    baseUrl: flagStr(ctx.flags, "base-url"),
  });
  done(ctx, result, () => result.models.join("\n"));
}

async function cmdMcp(ctx: Ctx): Promise<void> {
  const config = await loadConfig(ctx);
  const rows = config.mcpServers ?? [];
  done(ctx, rows, () =>
    formatTable(rows, [
      { key: "id", header: "ID", value: (row) => row.id },
      { key: "name", header: "NAME", value: (row) => row.name },
      { key: "on", header: "ON", value: (row) => yn(row.enabled) },
    ]),
  );
}

async function cmdSkills(ctx: Ctx): Promise<void> {
  const config = await loadConfig(ctx);
  const rows = config.skills ?? [];
  done(ctx, rows, () =>
    formatTable(rows, [
      { key: "id", header: "ID", value: (row) => row.id },
      { key: "name", header: "NAME", value: (row) => row.name },
    ]),
  );
}

async function cmdGit(ctx: Ctx): Promise<void> {
  const config = await loadConfig(ctx);
  done(ctx, config.forges, () =>
    formatTable(config.forges, [
      { key: "id", header: "ID", value: (row) => shortId(row.id) },
      { key: "name", header: "NAME", value: (row) => row.name },
      { key: "kind", header: "KIND", value: (row) => row.kind },
      { key: "url", header: "API", value: (row) => row.apiBaseUrl },
    ]),
  );
}

async function cmdGitOauthStart(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "forge id");
  const result = await ctx.client.post(`/api/forges/${id}/oauth/start`);
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdGitOauthStatus(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "forge id");
  const result = await ctx.client.get(`/api/forges/${id}/oauth/status`);
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdGitOauthDisconnect(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "forge id");
  const result = await ctx.client.post(`/api/forges/${id}/oauth/disconnect`);
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdWorkers(ctx: Ctx): Promise<void> {
  const config = await loadConfig(ctx);
  const rows = config.workers ?? [];
  done(ctx, rows, () =>
    formatTable(rows, [
      { key: "id", header: "ID", value: (row) => shortId(row.id) },
      { key: "name", header: "NAME", value: (row) => row.name },
      { key: "url", header: "URL", value: (row) => row.url },
    ]),
  );
}

async function cmdWorkerAdd(ctx: Ctx): Promise<void> {
  const blob = restJoin(ctx.args);
  const url = flagStr(ctx.flags, "url");
  const token = flagStr(ctx.flags, "secret");
  const fingerprint = flagStr(ctx.flags, "fingerprint");
  const name = flagStr(ctx.flags, "name");
  if (!blob && !url) {
    throw new UsageError("Pass a locus-worker add line, or --url and --secret");
  }
  const result = await ctx.client.post<{
    worker?: { id: string; name: string; url: string };
  }>("/api/workers", {
    blob: blob || undefined,
    url,
    token,
    fingerprint,
    name,
  });
  done(ctx, result, () =>
    `Added ${result.worker?.name ?? "worker"} ${result.worker?.url ?? ""}`.trim(),
  );
}

async function cmdWorkerTest(ctx: Ctx): Promise<void> {
  const config = await loadConfig(ctx);
  const id = ctx.args[0];
  const worker = id ? (config.workers ?? []).find((row) => row.id.startsWith(id)) : undefined;
  const url = flagStr(ctx.flags, "url") || worker?.url;
  if (!url) throw new UsageError("Pass a worker id or --url");
  const result = await ctx.client.post("/api/workers/test", {
    url,
    token: flagStr(ctx.flags, "secret") || worker?.token,
  });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdPhone(ctx: Ctx): Promise<void> {
  const result = await ctx.client.get<Record<string, unknown>>("/api/phone");
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdPhoneSet(ctx: Ctx, enabled: boolean): Promise<void> {
  const result = await ctx.client.post("/api/phone", { enabled });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdPhoneRotate(ctx: Ctx): Promise<void> {
  const result = await ctx.client.post("/api/phone/rotate");
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdChrome(ctx: Ctx): Promise<void> {
  const result = await ctx.client.get<Record<string, unknown>>("/api/chrome-extension");
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdChromeSet(ctx: Ctx, enabled: boolean): Promise<void> {
  const result = await ctx.client.post("/api/chrome-extension", { enabled });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdChromeRotate(ctx: Ctx): Promise<void> {
  const result = await ctx.client.post("/api/chrome-extension/rotate");
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdFunnel(ctx: Ctx): Promise<void> {
  const result = await ctx.client.get<unknown>("/api/tailscale");
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdFunnelSet(ctx: Ctx, enabled: boolean): Promise<void> {
  const result = await ctx.client.post("/api/tailscale/funnel", { enabled });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdTheme(ctx: Ctx): Promise<void> {
  const theme = ctx.args[0] || flagStr(ctx.flags, "theme");
  const config = await loadConfig(ctx);
  if (!theme) {
    done(ctx, { theme: config.theme }, () => config.theme);
    return;
  }
  if (!isThemeId(theme)) throw new UsageError(`Unknown theme ${theme}`);
  const next = await ctx.client.put("/api/config", { ...config, theme });
  done(ctx, next, () => `Theme ${theme}`);
}

async function cmdReset(ctx: Ctx): Promise<void> {
  const confirm = flagStr(ctx.flags, "confirm");
  if (confirm !== "RESET") throw new UsageError("Refusing to wipe. Pass --confirm RESET");
  const result = await ctx.client.post("/api/reset", { confirm: "RESET" });
  done(ctx, result, () => "Reset complete");
}

async function cmdImageList(ctx: Ctx): Promise<void> {
  const rows =
    await ctx.client.get<Array<{ id: string; name: string; os?: string }>>("/api/images");
  done(ctx, rows, () =>
    formatTable(rows, [
      { key: "id", header: "ID", value: (row) => shortId(row.id) },
      { key: "name", header: "NAME", value: (row) => row.name },
      { key: "os", header: "OS", value: (row) => row.os ?? "" },
    ]),
  );
}

async function cmdImageCapture(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const name = flagStr(ctx.flags, "name") || restJoin(ctx.args, 1);
  if (!name) throw new UsageError("Need --name");
  const image = await ctx.client.post(`/api/sessions/${session.id}/images`, { name });
  done(ctx, image, () => JSON.stringify(image, null, 2));
}

async function cmdImageDelete(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "image id");
  await ctx.client.delete(`/api/images/${id}`);
  done(ctx, { ok: true, id }, () => `Deleted ${id}`);
}

async function cmdImageFetch(ctx: Ctx): Promise<void> {
  const os = flagStr(ctx.flags, "os") || need(ctx.args, 0, "os");
  const result = await ctx.client.post("/api/media/fetch", { os });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdImageFetchVirtio(ctx: Ctx): Promise<void> {
  const result = await ctx.client.post("/api/media/fetch", { media: "virtio" });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdDebugLogs(ctx: Ctx): Promise<void> {
  const result = await ctx.client.get<unknown>("/api/debug/logs");
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdDebugLog(ctx: Ctx): Promise<void> {
  const kind = need(ctx.args, 0, "kind");
  const key = need(ctx.args, 1, "key");
  const result = await ctx.client.get(
    `/api/debug/logs/${encodeURIComponent(kind)}/${encodeURIComponent(key)}`,
  );
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdDebugEval(ctx: Ctx): Promise<void> {
  const kind = need(ctx.args, 0, "kind");
  const key = need(ctx.args, 1, "key");
  const result = await ctx.client.post(
    `/api/debug/logs/${encodeURIComponent(kind)}/${encodeURIComponent(key)}/eval`,
  );
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdCompletion(ctx: Ctx): Promise<void> {
  const shell = (ctx.args[0] || "bash").toLowerCase();
  if (!isCompletionShell(shell)) throw new UsageError("Shell must be bash, zsh, or fish");
  ctx.write(
    renderCompletion(
      shell,
      ROUTES.map((row) => row.path.join(" ")),
    ),
  );
}

async function cmdSystemsGet(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "system id");
  const result = await ctx.client.get<{
    systems: Array<{ id: string; name: string }>;
    builtins: Array<{ id: string; name: string }>;
    defaultId?: string;
  }>("/api/design-systems");
  const row = [...result.systems, ...result.builtins].find(
    (item) => item.id === id || item.id.startsWith(id),
  );
  if (!row) throw new UsageError(`Design system not found: ${id}`);
  done(ctx, row, () => JSON.stringify({ ...row, default: row.id === result.defaultId }, null, 2));
}

async function cmdWorkspaceGrep(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const query = restJoin(ctx.args, 1) || flagStr(ctx.flags, "query");
  if (!query) throw new UsageError("grep query is required");
  const result = await ctx.client.post<{
    hits?: Array<{ path: string; line: number; text: string }>;
  }>(`/api/sessions/${session.id}/workspace/grep`, { query });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdWorkspaceSearch(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const query = restJoin(ctx.args, 1) || flagStr(ctx.flags, "query");
  if (!query) throw new UsageError("search query is required");
  const result = await ctx.client.post(`/api/sessions/${session.id}/workspace/search`, { query });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdWorkspaceMkdir(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const path = need(ctx.args, 1, "path");
  const result = await ctx.client.post(`/api/sessions/${session.id}/workspace/mkdir`, { path });
  done(ctx, result, () => `mkdir ${path}`);
}

async function cmdWorkspaceGit(ctx: Ctx): Promise<void> {
  const session = await resolveSession(ctx, need(ctx.args, 0, "session id"));
  const result = await ctx.client.get(`/api/sessions/${session.id}/workspace/git`);
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdRepoStack(ctx: Ctx): Promise<void> {
  const repo = await resolveRepo(ctx, need(ctx.args, 0, "repo id"));
  const number = need(ctx.args, 1, "pull number");
  const result = await ctx.client.get(
    `/api/repos/${repo.id}/pulls/${encodeURIComponent(number)}/changestack`,
  );
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdRepoStackCreate(ctx: Ctx): Promise<void> {
  const repo = await resolveRepo(ctx, need(ctx.args, 0, "repo id"));
  const number = need(ctx.args, 1, "pull number");
  const result = await ctx.client.post(
    `/api/repos/${repo.id}/pulls/${encodeURIComponent(number)}/changestack`,
  );
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdProjectDelete(ctx: Ctx): Promise<void> {
  const project = await resolveProject(ctx, need(ctx.args, 0, "project id"));
  const result = await ctx.client.delete(`/api/projects/${project.id}`);
  done(ctx, result, () => `Deleted ${project.id}`);
}

async function cmdProjectDuplicate(ctx: Ctx): Promise<void> {
  const project = await resolveProject(ctx, need(ctx.args, 0, "project id"));
  const next = await ctx.client.post<ProjectDocument>(`/api/projects/${project.id}/duplicate`);
  done(ctx, next, () => `${shortId(next.id)}  ${next.title}`);
}

async function cmdProjectContext(ctx: Ctx): Promise<void> {
  const project = await resolveProject(ctx, need(ctx.args, 0, "project id"));
  const result = await ctx.client.get(`/api/projects/${project.id}/context`);
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdProjectMission(ctx: Ctx): Promise<void> {
  const project = await resolveProject(ctx, need(ctx.args, 0, "project id"));
  const result = await ctx.client.get(`/api/projects/${project.id}/mission-control`);
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

function cmdBoardHelp(ctx: Ctx): Promise<void> {
  ctx.writeln(helpFor(["board"]));
  return Promise.resolve();
}

async function resolveBoard(ctx: Ctx, token: string): Promise<BoardSummary> {
  const rows = await ctx.client.get<BoardSummary[]>("/api/boards");
  const exact = rows.find((row) => row.id === token);
  if (exact) return exact;
  const prefixes = rows.filter((row) => row.id.startsWith(token));
  if (prefixes.length === 1) return prefixes[0]!;
  const titles = rows.filter((row) => row.title.toLowerCase().includes(token.toLowerCase()));
  if (titles.length === 1) return titles[0]!;
  throw new UsageError(`Board not found: ${token}`);
}

async function cmdBoardList(ctx: Ctx): Promise<void> {
  const rows = await ctx.client.get<BoardSummary[]>("/api/boards");
  done(ctx, rows, () =>
    formatTable(rows, [
      { key: "id", header: "ID", value: (row) => shortId(row.id) },
      { key: "title", header: "TITLE", value: (row) => row.title },
      { key: "starter", header: "STARTER", value: (row) => row.starter ?? "blank" },
      { key: "objects", header: "OBJECTS", value: (row) => String(row.objectCount) },
    ]),
  );
}

async function cmdBoardGet(ctx: Ctx): Promise<void> {
  const board = await ctx.client.get<BoardDocument>(
    `/api/boards/${(await resolveBoard(ctx, need(ctx.args, 0, "board id"))).id}`,
  );
  done(ctx, board, () =>
    formatKv([
      ["id", board.id],
      ["title", board.title],
      ["starter", board.starter ?? "blank"],
      ["objects", String(board.objects?.length ?? 0)],
      ["updated", board.updatedAt],
    ]),
  );
}

async function cmdBoardNew(ctx: Ctx): Promise<void> {
  const starterFlag = flagStr(ctx.flags, "starter");
  const starter = starterFlag && isBoardStarter(starterFlag) ? starterFlag : undefined;
  const created = await ctx.client.post<BoardDocument>("/api/boards", {
    title: flagStr(ctx.flags, "title"),
    starter,
    prompt: restJoin(ctx.args, 0) || undefined,
  });
  done(ctx, created, () => `${shortId(created.id)}  ${created.title}`);
}

async function cmdBoardDelete(ctx: Ctx): Promise<void> {
  const board = await resolveBoard(ctx, need(ctx.args, 0, "board id"));
  const result = await ctx.client.delete(`/api/boards/${board.id}`);
  done(ctx, result, () => `Deleted ${board.id}`);
}

async function cmdBoardChat(ctx: Ctx): Promise<void> {
  const board = await resolveBoard(ctx, need(ctx.args, 0, "board id"));
  const prompt = restJoin(ctx.args, 1);
  const result = await ctx.client.post(`/api/boards/${board.id}/chat`, {
    prompt: prompt || undefined,
  });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdBoardRun(ctx: Ctx): Promise<void> {
  const board = await resolveBoard(ctx, need(ctx.args, 0, "board id"));
  const frameId = need(ctx.args, 1, "frame id");
  const result = await ctx.client.post(`/api/boards/${board.id}/run-frame`, { frameId });
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdBoardDuplicate(ctx: Ctx): Promise<void> {
  const board = await resolveBoard(ctx, need(ctx.args, 0, "board id"));
  const next = await ctx.client.post<BoardDocument>(`/api/boards/${board.id}/duplicate`);
  done(ctx, next, () => `${shortId(next.id)}  ${next.title}`);
}

async function cmdBoardExport(ctx: Ctx): Promise<void> {
  const board = await resolveBoard(ctx, need(ctx.args, 0, "board id"));
  const result = await ctx.client.get(`/api/boards/${board.id}/export`);
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

async function cmdAutoClone(ctx: Ctx): Promise<void> {
  const row = await resolveAutomation(ctx, need(ctx.args, 0, "automation id"));
  const cloned = await ctx.client.post<Automation>(`/api/automations/${row.id}/clone`);
  done(ctx, cloned, () => `${cloned.id}  ${cloned.name}`);
}

async function cmdAutoTestWebhook(ctx: Ctx): Promise<void> {
  const row = await resolveAutomation(ctx, need(ctx.args, 0, "automation id"));
  const result = await ctx.client.post(`/api/automations/${row.id}/test-webhook`);
  done(ctx, result, () => JSON.stringify(result, null, 2));
}

type WorkflowRow = { id: string; name: string; description?: string; nodeCount?: number };

async function cmdWorkflowHelp(ctx: Ctx): Promise<void> {
  ctx.writeln(helpFor(["workflow"]));
}

async function cmdWorkflowList(ctx: Ctx): Promise<void> {
  const rows = await ctx.client.get<WorkflowRow[]>("/api/workflows");
  done(ctx, rows, () =>
    formatTable(rows, [
      { key: "id", header: "ID", value: (row) => shortId(row.id) },
      { key: "name", header: "NAME", value: (row) => row.name },
      { key: "nodes", header: "NODES", value: (row) => String(row.nodeCount ?? "") },
    ]),
  );
}

async function cmdWorkflowTemplates(ctx: Ctx): Promise<void> {
  const rows =
    await ctx.client.get<Array<{ id: string; name: string; origin: string }>>(
      "/api/workflow-templates",
    );
  done(ctx, rows, () =>
    formatTable(rows, [
      { key: "id", header: "ID", value: (row) => row.id },
      { key: "name", header: "NAME", value: (row) => row.name },
      { key: "origin", header: "FROM", value: (row) => row.origin },
    ]),
  );
}

async function cmdWorkflowAdd(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "template id");
  const row = await ctx.client.post<WorkflowRow>(
    `/api/workflow-templates/${encodeURIComponent(id)}`,
  );
  done(ctx, row, () => `${row.id}  ${row.name}`);
}

async function cmdWorkflowImport(ctx: Ctx): Promise<void> {
  const file = need(ctx.args, 0, "workflow file");
  const body = JSON.parse(await readFile(file, "utf8")) as unknown;
  const row = await ctx.client.post<WorkflowRow>("/api/workflows", body);
  done(ctx, row, () => `${row.id}  ${row.name}`);
}

async function cmdWorkflowShow(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "workflow id");
  const row = await ctx.client.get<WorkflowRow>(`/api/workflows/${encodeURIComponent(id)}`);
  done(ctx, row, () =>
    formatKv([
      ["id", row.id],
      ["name", row.name],
      ["description", row.description ?? ""],
      ["nodes", String(row.nodeCount ?? "")],
    ]),
  );
}

async function cmdWorkflowDelete(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "workflow id");
  await ctx.client.delete(`/api/workflows/${encodeURIComponent(id)}`);
  done(ctx, { ok: true }, () => `Deleted ${id}`);
}

async function cmdWorkflowRun(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "workflow id");
  const session = flagStr(ctx.flags, "session");
  if (!session) throw new UsageError("--session is required");
  const raw = flagStr(ctx.flags, "input");
  const input = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  const run = await ctx.client.post(`/api/workflows/${encodeURIComponent(id)}/run`, {
    sessionId: session,
    input,
  });
  done(ctx, run, () => JSON.stringify(run, null, 2));
}

async function cmdWorkflowResume(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "workflow id");
  const session = flagStr(ctx.flags, "session");
  const runId = flagStr(ctx.flags, "run");
  if (!session || !runId) throw new UsageError("--session and --run are required");
  const approved = flagBool(ctx.flags, "approve");
  if (!approved && !flagBool(ctx.flags, "deny")) {
    throw new UsageError("Pass --approve or --deny");
  }
  const run = await ctx.client.post(`/api/workflows/${encodeURIComponent(id)}/resume`, {
    sessionId: session,
    runId,
    approved,
    resumeToken: flagStr(ctx.flags, "token"),
  });
  done(ctx, run, () => JSON.stringify(run, null, 2));
}

async function cmdWorkflowRuns(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "workflow id");
  const runs = await ctx.client.get<Array<{ id: string; status: string; startedAt: string }>>(
    `/api/workflows/${encodeURIComponent(id)}/runs`,
  );
  done(ctx, runs, () =>
    formatTable(runs, [
      { key: "id", header: "RUN", value: (row) => shortId(row.id) },
      { key: "status", header: "STATUS", value: (row) => row.status },
      { key: "started", header: "STARTED", value: (row) => row.startedAt },
    ]),
  );
}
