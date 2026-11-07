import type { TraceEvent } from "./trace.js";

export interface EgressHostSummary {
  host: string;
  allowed: number;
  denied: number;
  bytesSent: number;
  kind: "provider" | "forge" | "integration" | "other";
}

export interface SessionEgressSummary {
  sessionId: string;
  hosts: EgressHostSummary[];
  bytesSent: number;
  allowed: number;
  denied: number;
}

export interface ApprovalExportRow {
  t: string;
  sessionId: string;
  tool: string;
  decision: "approved" | "denied" | "cancelled";
  by: string;
  persist?: boolean;
  category: "push" | "pr" | "mcp" | "integration" | "other";
  detail?: string;
}

const PROVIDER_HOSTS = [
  "api.anthropic.com",
  "api.openai.com",
  "openai.com",
  "amazonaws.com",
  "bedrock-runtime",
  "ollama",
  "127.0.0.1",
  "localhost",
];
const FORGE_HOSTS = [
  "github.com",
  "api.github.com",
  "githubusercontent.com",
  "gitlab.com",
  "bitbucket.org",
  "atlassian.net",
];
const INTEGRATION_HOSTS = [
  "slack.com",
  "linear.app",
  "api.linear.app",
  "atlassian.net",
  "grafana",
  "sentry.io",
  "miro.com",
  "figma.com",
  "incident.io",
  "amazonaws.com",
  "googleapis.com",
  "gmail.googleapis.com",
];

function classifyHost(host: string): EgressHostSummary["kind"] {
  const h = host.toLowerCase();
  if (PROVIDER_HOSTS.some((item) => h === item || h.includes(item) || h.endsWith(`.${item}`))) {
    if (INTEGRATION_HOSTS.some((item) => h.includes(item)) && h.includes("slack"))
      return "integration";
    return "provider";
  }
  if (FORGE_HOSTS.some((item) => h === item || h.endsWith(`.${item}`))) return "forge";
  if (INTEGRATION_HOSTS.some((item) => h === item || h.includes(item) || h.endsWith(`.${item}`))) {
    return "integration";
  }
  return "other";
}

function hostFromEgress(event: TraceEvent): { host: string; port?: number } | undefined {
  const fromArgs = typeof event.args?.host === "string" ? event.args.host.trim() : "";
  if (fromArgs) {
    const port = typeof event.args?.port === "number" ? event.args.port : undefined;
    return { host: fromArgs.toLowerCase(), port };
  }
  const detail = event.detail?.trim() ?? "";
  const match = detail.match(/^([^:\s]+)(?::(\d+))?$/);
  if (!match?.[1]) return undefined;
  return { host: match[1].toLowerCase(), port: match[2] ? Number(match[2]) : undefined };
}

export function summarizeSessionEgress(
  events: TraceEvent[],
  sessionId?: string,
): SessionEgressSummary {
  const rows = events.filter(
    (event) => event.kind === "egress" && (!sessionId || event.sessionId === sessionId),
  );
  const byHost = new Map<string, EgressHostSummary>();
  let bytesSent = 0;
  let allowed = 0;
  let denied = 0;
  for (const event of rows) {
    const parsed = hostFromEgress(event);
    if (!parsed) continue;
    const current = byHost.get(parsed.host) ?? {
      host: parsed.host,
      allowed: 0,
      denied: 0,
      bytesSent: 0,
      kind: classifyHost(parsed.host),
    };
    const ok = event.name !== "deny" && event.ok !== false;
    if (ok) {
      current.allowed += 1;
      allowed += 1;
    } else {
      current.denied += 1;
      denied += 1;
    }
    const sent =
      typeof event.args?.bytesSent === "number" && Number.isFinite(event.args.bytesSent)
        ? Math.max(0, Math.round(event.args.bytesSent))
        : 0;
    current.bytesSent += sent;
    bytesSent += sent;
    byHost.set(parsed.host, current);
  }
  const hosts = [...byHost.values()].sort(
    (a, b) =>
      b.bytesSent - a.bytesSent ||
      b.allowed + b.denied - (a.allowed + a.denied) ||
      a.host.localeCompare(b.host),
  );
  return {
    sessionId: sessionId || rows[0]?.sessionId || "",
    hosts,
    bytesSent,
    allowed,
    denied,
  };
}

function approvalCategory(tool: string): ApprovalExportRow["category"] {
  if (tool === "git_push") return "push";
  if (tool.startsWith("git_pr") || tool === "git_issue_comment") return "pr";
  if (tool.startsWith("mcp_")) return "mcp";
  if (
    /^(jira_|confluence_|linear_|slack_|grafana_|sentry_|miro_|figma_|incidentio_|gmail_|calendar_|drive_|k8s_|portainer_|plugin_)/.test(
      tool,
    )
  ) {
    return "integration";
  }
  return "other";
}

export function exportApprovals(events: TraceEvent[], sessionId?: string): ApprovalExportRow[] {
  const rows: ApprovalExportRow[] = [];
  for (const event of events) {
    if (sessionId && event.sessionId !== sessionId) continue;
    if (event.kind !== "approval") continue;
    const decision =
      event.name === "denied" || event.detail === "denied"
        ? "denied"
        : event.name === "cancelled" || event.detail === "cancelled"
          ? "cancelled"
          : "approved";
    const tool = (typeof event.args?.tool === "string" && event.args.tool) || event.id || "tool";
    rows.push({
      t: event.t,
      sessionId: event.sessionId,
      tool,
      decision,
      by:
        typeof event.args?.by === "string" && event.args.by.trim()
          ? event.args.by.trim()
          : "operator",
      persist: event.args?.persist === true,
      category: approvalCategory(tool),
      detail: event.detail,
    });
  }
  return rows.sort((a, b) => a.t.localeCompare(b.t));
}
