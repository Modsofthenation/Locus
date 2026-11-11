import {
  INTEGRATION_TOOL_NAMES,
  MANAGE_INTEGRATION_PLUGIN_NAME,
  MCP_CALL_NAME,
  MCP_CODE_NAME,
  MCP_GET_TOOL_INFO_NAME,
  MCP_LIST_TOOLS_NAME,
  automationHealth,
  automationLatestAgentRun,
  automationLifetimeSpendUsd,
  automationRunUsd,
  clipFact,
  enabledPlugins,
  formatNextFire,
  formatUsd,
  integrationKindForTool,
  integrationLabel,
  integrationsWithTokens,
  isMcpToolName,
  lastAssistantText,
  mcpFunctionName,
  pluginFunctionName,
  overLifetimeCap,
  runHistoryStatusLabel,
  type AgentSession,
  type Automation,
  type AutomationRun,
  type AutomationSchedule,
  type LocusConfig,
} from "@locus/shared";

/** Collapse the detail-pane prompt when it has this many lines or more. */
export const PROMPT_COLLAPSE_LINE_THRESHOLD = 6;

export type RunHistoryFilter =
  "all" | "running" | "succeeded" | "failed" | "skipped" | "test" | "needs_you";

export type AutomationListSort = "priority" | "schedule";

export type AutomationTriggerFamily = "clock" | "forge" | "pull_request" | "webhook";

export const CLOCK_SCHEDULE_KINDS = ["interval", "adaptive", "daily", "weekly", "cron"] as const;

export type ClockScheduleKind = (typeof CLOCK_SCHEDULE_KINDS)[number];

export const AUTOMATION_TRIGGER_FAMILIES: {
  id: AutomationTriggerFamily;
  title: string;
  blurb: string;
}[] = [
  { id: "clock", title: "On a schedule", blurb: "Daily, weekly, cron, or interval." },
  { id: "forge", title: "Git push", blurb: "When a new commit lands." },
  { id: "pull_request", title: "Pull request", blurb: "When a PR is opened or updated." },
  { id: "webhook", title: "Webhook", blurb: "HTTP POST or Slack event." },
];

export function isClockScheduleKind(kind: AutomationSchedule["kind"]): kind is ClockScheduleKind {
  return (CLOCK_SCHEDULE_KINDS as readonly string[]).includes(kind);
}

export function automationTriggerFamily(kind: AutomationSchedule["kind"]): AutomationTriggerFamily {
  if (kind === "forge" || kind === "pull_request" || kind === "webhook") return kind;
  return "clock";
}

export function defaultKindForTriggerFamily(
  family: AutomationTriggerFamily,
  current: AutomationSchedule["kind"],
): AutomationSchedule["kind"] {
  if (family === "clock") return isClockScheduleKind(current) ? current : "daily";
  return family;
}

const SCHEDULE_GROUP_ORDER: AutomationSchedule["kind"][] = [
  "interval",
  "adaptive",
  "daily",
  "weekly",
  "cron",
  "forge",
  "pull_request",
  "webhook",
];

export function promptLineCount(prompt: string): number {
  if (!prompt) return 0;
  return prompt.split(/\r\n|\r|\n/).length;
}

export function promptNeedsCollapse(prompt: string): boolean {
  return promptLineCount(prompt) >= PROMPT_COLLAPSE_LINE_THRESHOLD;
}

export function runMatchesHistoryFilter(
  run: Pick<AutomationRun, "status" | "error">,
  filter: RunHistoryFilter,
): boolean {
  if (filter === "all") return true;
  const label = runHistoryStatusLabel(run);
  if (filter === "running") return label === "running" || label === "queued";
  if (filter === "test") return label === "test";
  if (filter === "skipped") return label === "skipped";
  return label === filter;
}

function nextFireSortKey(item: Pick<Automation, "enabled" | "schedule" | "nextRunAt">): number {
  if (!item.enabled) return Number.POSITIVE_INFINITY;
  const next = formatNextFire(item);
  if (!next || next === "On webhook") return Number.POSITIVE_INFINITY - 1;
  const ms = Date.parse(next);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY - 1;
}

/** Failing first, then live runs, then soonest next fire, then paused. */
export function sortAutomationsByPriority(
  items: Automation[],
  runs: AutomationRun[],
): Automation[] {
  return [...items].sort((a, b) => {
    const healthA = automationHealth(a, automationLatestAgentRun(runs, a.id));
    const healthB = automationHealth(b, automationLatestAgentRun(runs, b.id));
    const rank = (h: typeof healthA) =>
      h === "failing" || h === "needs_you" ? 0 : h === "healthy" ? 1 : 2;
    const byHealth = rank(healthA) - rank(healthB);
    if (byHealth !== 0) return byHealth;
    const liveA = runs.some(
      (r) => r.automationId === a.id && (r.status === "running" || r.status === "queued"),
    );
    const liveB = runs.some(
      (r) => r.automationId === b.id && (r.status === "running" || r.status === "queued"),
    );
    if (liveA !== liveB) return liveA ? -1 : 1;
    const byNext = nextFireSortKey(a) - nextFireSortKey(b);
    if (byNext !== 0) return byNext;
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}

export function scheduleGroupLabel(kind: AutomationSchedule["kind"]): string {
  switch (kind) {
    case "interval":
      return "Interval";
    case "adaptive":
      return "Adaptive";
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "cron":
      return "Cron";
    case "forge":
      return "Git push";
    case "pull_request":
      return "Pull request";
    case "webhook":
      return "Webhook";
  }
}

export function groupAutomationsBySchedule(items: Automation[]): {
  kind: AutomationSchedule["kind"];
  label: string;
  items: Automation[];
}[] {
  const byKind = new Map<AutomationSchedule["kind"], Automation[]>();
  for (const item of items) {
    const list = byKind.get(item.schedule.kind) ?? [];
    list.push(item);
    byKind.set(item.schedule.kind, list);
  }
  return SCHEDULE_GROUP_ORDER.filter((kind) => byKind.has(kind)).map((kind) => ({
    kind,
    label: scheduleGroupLabel(kind),
    items: byKind.get(kind)!,
  }));
}

export function automationFleetExtras(
  items: Automation[],
  runs: AutomationRun[],
  sessions: AgentSession[],
  config: LocusConfig | undefined,
  nowMs = Date.now(),
): { running: number; overCap: number; dueSoon: number } {
  let running = 0;
  let overCap = 0;
  let dueSoon = 0;
  const hour = 60 * 60 * 1000;
  for (const item of items) {
    if (
      runs.some(
        (r) => r.automationId === item.id && (r.status === "running" || r.status === "queued"),
      )
    ) {
      running += 1;
    }
    const spend = automationSpendLabel(runs, item, sessions, config);
    if (spend?.over) overCap += 1;
    if (!item.enabled) continue;
    const next = formatNextFire(item);
    if (!next || next === "On webhook") continue;
    const ms = Date.parse(next);
    if (Number.isFinite(ms) && ms >= nowMs && ms - nowMs <= hour) dueSoon += 1;
  }
  return { running, overCap, dueSoon };
}

export function formatAutomationFleetExtras(extras: {
  running: number;
  overCap: number;
  dueSoon: number;
}): string | undefined {
  const parts: string[] = [];
  if (extras.running) parts.push(`${extras.running} running`);
  if (extras.overCap) parts.push(`${extras.overCap} over cap`);
  if (extras.dueSoon) parts.push(`${extras.dueSoon} due soon`);
  return parts.length ? parts.join(" · ") : undefined;
}

export type AllowlistOption = { group: string; name: string };

export function automationAllowlistOptions(
  config: LocusConfig | undefined,
  selected: string[] = [],
): AllowlistOption[] {
  const out: AllowlistOption[] = [];
  const seen = new Set<string>();
  function add(group: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push({ group, name: trimmed });
  }
  const servers = (config?.mcpServers ?? []).filter((server) => server.enabled !== false);
  if (servers.length) {
    add("MCP", MCP_LIST_TOOLS_NAME);
    add("MCP", MCP_GET_TOOL_INFO_NAME);
    add("MCP", MCP_CALL_NAME);
    add("MCP", MCP_CODE_NAME);
    for (const server of servers) {
      for (const tool of server.allowedTools ?? []) {
        add("MCP", isMcpToolName(tool) ? tool : mcpFunctionName(server.id, tool));
      }
    }
  }
  const kinds = new Set(integrationsWithTokens(config?.integrations).map((row) => row.kind));
  for (const name of INTEGRATION_TOOL_NAMES) {
    const kind = integrationKindForTool(name);
    if (kind && kinds.has(kind)) add(integrationLabel(kind), name);
  }
  const plugins = enabledPlugins(config?.integrationPlugins);
  for (const plugin of plugins) {
    for (const tool of plugin.tools) add("Plugins", pluginFunctionName(plugin.slug, tool.name));
  }
  if (plugins.length) add("Plugins", MANAGE_INTEGRATION_PLUGIN_NAME);
  for (const name of selected) add("Selected", name);
  return out;
}

function estimatedRunUsd(
  run: AutomationRun,
  item: Pick<Automation, "providerId" | "model">,
  session: AgentSession | undefined,
  config: LocusConfig | undefined,
): number | undefined {
  const providerId = session?.providerId ?? item.providerId;
  const model = session?.model ?? item.model;
  const provider = config?.providers.find((row) => row.id === providerId);
  return automationRunUsd({
    spendUsd: run.spendUsd,
    usage: session?.usage,
    provider,
    model,
  });
}

export function runSpendLabel(
  run: AutomationRun,
  item: Pick<Automation, "maxUsd" | "providerId" | "model">,
  session: AgentSession | undefined,
  config: LocusConfig | undefined,
): string {
  const usd = estimatedRunUsd(run, item, session, config);
  const cap =
    typeof item.maxUsd === "number" && item.maxUsd > 0 ? formatUsd(item.maxUsd) : undefined;
  if (usd == null) return cap ? `— / ${cap}` : "—";
  return cap ? `${formatUsd(usd)} / ${cap}` : formatUsd(usd);
}

export function automationSpendLabel(
  runs: AutomationRun[],
  item: Pick<Automation, "id" | "lifetimeMaxUsd" | "providerId" | "model">,
  sessions: AgentSession[],
  config: LocusConfig | undefined,
): { label: string; over: boolean } | undefined {
  const stored = automationLifetimeSpendUsd(runs, item.id);
  const byId = new Map(sessions.map((row) => [row.id, row]));
  let estimated = 0;
  let anyEstimate = false;
  const seen = new Set<string>();
  for (const run of runs) {
    if (run.automationId !== item.id || seen.has(run.id)) continue;
    seen.add(run.id);
    if (typeof run.spendUsd === "number") continue;
    const usd = estimatedRunUsd(
      run,
      item,
      run.sessionId ? byId.get(run.sessionId) : undefined,
      config,
    );
    if (usd == null) continue;
    estimated += usd;
    anyEstimate = true;
  }
  const total = stored > 0 ? stored : estimated;
  const cap =
    typeof item.lifetimeMaxUsd === "number" && item.lifetimeMaxUsd > 0
      ? item.lifetimeMaxUsd
      : undefined;
  if (total === 0 && !anyEstimate && cap == null) return undefined;
  const capLabel = cap != null ? formatUsd(cap) : undefined;
  if (total === 0 && cap != null) return { label: capLabel!, over: false };
  if (total === 0) return undefined;
  return {
    label: capLabel ? `${formatUsd(total)} / ${capLabel}` : formatUsd(total),
    over: stored > 0 && overLifetimeCap(cap, stored),
  };
}

export function runOutcomeLabel(
  run: AutomationRun,
  session: AgentSession | undefined,
): string | undefined {
  if (run.status === "failed" || run.status === "skipped") {
    return run.error?.trim() || run.summary?.trim();
  }
  if (run.summary?.trim()) return run.summary.trim();
  if (run.error?.trim()) return run.error.trim();
  const summary = session ? lastAssistantText(session.messages) : undefined;
  return summary ? clipFact(summary, 96) : undefined;
}

export const DOCKER_DOWN_MESSAGE = "Docker isn't running — switch to Host or start Docker";

export type PlainJobError = {
  /** One plain sentence for the run row / notice. */
  summary: string;
  /** What the runtime actually said, behind "Show details". */
  detail: string;
  /** Known cause the UI can offer actions for. */
  cause?: "docker";
};

const DOCKER_DOWN_PATTERNS = [
  /docker\.sock/i,
  /docker API at/i,
  /Cannot connect to the Docker daemon/i,
  /Is the docker daemon running/i,
  /docker daemon (is )?not (running|reachable)/i,
  /error during connect:.*docker/i,
];

export function isDockerDownError(text: string | undefined): boolean {
  const raw = text?.trim();
  if (!raw) return false;
  return DOCKER_DOWN_PATTERNS.some((re) => re.test(raw));
}

/** Map raw runtime errors we recognise to plain language; unknown errors return null. */
export function plainJobError(text: string | undefined): PlainJobError | null {
  const raw = text?.trim();
  if (!raw) return null;
  if (isDockerDownError(raw)) return { summary: DOCKER_DOWN_MESSAGE, detail: raw, cause: "docker" };
  return null;
}

/**
 * Back-to-back system notes that map to the same plain error (Docker down twice in a row).
 * Keep the latest; it usually carries the most context ("this turn did not run").
 */
export function supersededPlainErrorIds(
  messages: Array<{ id: string; role: string; content: string }>,
): Set<string> {
  const hide = new Set<string>();
  let prevId: string | undefined;
  let prevSummary: string | undefined;
  for (const message of messages) {
    const summary = message.role === "system" ? plainJobError(message.content)?.summary : undefined;
    if (summary && prevId && prevSummary === summary) hide.add(prevId);
    prevId = summary ? message.id : undefined;
    prevSummary = summary;
  }
  return hide;
}

export function spendChipTitle(args: {
  over: boolean;
  label: string;
  sessionCount: number;
  pendingSessions: number;
}): string {
  const parts = [
    "Lifetime spend uses the cost stored on each run. Last run is the per-run cap. Over means the lifetime cap.",
    args.sessionCount
      ? `Counted ${args.sessionCount} chat${args.sessionCount === 1 ? "" : "s"}.`
      : "No run chats loaded yet.",
  ];
  if (args.pendingSessions > 0) {
    parts.push(`${args.pendingSessions} still loading…`);
  }
  if (args.over) parts.push("Over the spend cap.");
  return parts.join(" ");
}

export function automationFunnelHint(webhookBaseUrl: string | undefined): {
  public: boolean;
  text: string;
} {
  const base = webhookBaseUrl?.replace(/\/+$/, "");
  if (base) {
    return {
      public: true,
      text: `Reachable at ${base} (Funnel / webhook base).`,
    };
  }
  return {
    public: false,
    text: "Loopback only — GitHub.com and Slack.com cannot reach this. Enable Tailscale Funnel in Settings → Advanced.",
  };
}

/** Recent runs across the fleet for the Automations activity strip. */
export function fleetRecentRuns(runs: AutomationRun[], limit = 12): AutomationRun[] {
  return [...runs]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
    .slice(0, limit);
}

export function fleetShouldAutoOpen(runs: AutomationRun[]): boolean {
  return fleetRecentRuns(runs, 10).some((run) => run.status === "failed");
}
