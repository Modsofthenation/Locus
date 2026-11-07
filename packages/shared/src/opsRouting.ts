import { looksLikeVerifyCommand } from "./codingLoop.js";
import { isDockerSwarmToolName, looksLikeDockerSwarmPrompt } from "./models/dockerSwarm.js";
import { isIntegrationToolName, type IntegrationKind } from "./models/integration.js";
import { isMcpDiscoveryToolName, isMcpToolName } from "./models/mcp.js";
import { canonicalToolName } from "./models/toolChip.js";
import { execArgCommands } from "./models/tools.js";

/** Workspace fishing rounds before we tell the model to use first-party integrations or MCP. */
export const OPS_ROUTING_SEARCH_ROUNDS = 4;
export const MAX_OPS_ROUTING_NUDGES = 1;

export const OPS_ROUTING_HABIT =
  "When the operator names Grafana, Slack, Jira, Confluence, Linear, incident.io, AWS IAM, Portainer, Docker Swarm, Figma, Gmail, Google Calendar, Google Drive, Kubernetes, or Sentry, call those host tools (grafana_query / grafana_search / slack_* / jira_* / confluence_* / linear_* / incidentio_* / aws_sts_identity / aws_iam_list / aws_iam_get / aws_iam_simulate / portainer_* / docker_swarm / figma_* / gmail_* / calendar_* / drive_* / k8s_list / k8s_get / k8s_logs / k8s_events / sentry_*) or mcp_call / mcp_code in the first round. grafana_search lists dashboards; grafana_query runs Elasticsearch/Lucene logs; confluence_search uses CQL; linear_search / linear_get list and fetch issues; incidentio_search / incidentio_get list and fetch incidents; portainer_endpoints / portainer_containers / portainer_logs inspect the fleet; docker_swarm inspects this machine's Docker Swarm (nodes/services/stacks/logs, scale behind Approve); figma_get / figma_images read a file or node; k8s_logs reads pod logs; sentry_search / sentry_get read issues and the latest stack. Do not grep the workspace to learn how integrations work. An offloaded or truncated tool result is complete on disk — grep that file or narrow the query. Do not re-fetch those APIs with exec or curl.";

export const OPS_ROUTING_NUDGE =
  "The operator named Grafana, Slack, Jira, Confluence, Linear, incident.io, AWS IAM, Portainer, Docker Swarm, Figma, Gmail, Calendar, Drive, Kubernetes, or Sentry. Call grafana_query / grafana_search / slack_* / jira_* / confluence_* / linear_* / incidentio_* / aws_sts_identity / aws_iam_* / portainer_* / docker_swarm / figma_* / gmail_* / calendar_* / drive_* / k8s_* / sentry_* (or mcp_call / mcp_code) now. Listing MCP tools is not enough. Do not grep the workspace for how those APIs work. Do not treat an offloaded or truncated result as a broken API — grep the saved file or narrow the query. Do not curl those APIs from exec.";

const SEARCH_TOOLS = new Set([
  "grep",
  "glob",
  "file_read",
  "file_list",
  "repo_map",
  "exec",
  "powershell",
]);

const OPS_KIND_RE: Array<{ kind: IntegrationKind; re: RegExp }> = [
  { kind: "grafana", re: /\bgrafana\b|\bloki\b|\blogql\b|\blucene\b|\belasticsearch\b/i },
  { kind: "slack", re: /\bslack\b/i },
  { kind: "jira", re: /\bjira\b/i },
  { kind: "confluence", re: /\bconfluence\b/i },
  {
    kind: "linear",
    re: /\blinear\.app\b|\blinear issues?\b|\blinear tickets?\b|\bLinear\b|\bLINEAR\b/,
  },
  { kind: "incidentio", re: /\bincident\.io\b|\bincidentio\b|\bincident io\b/i },
  {
    kind: "aws",
    re: /\baws iam\b|\biam (?:user|role|policy|access)\b|\bimdsv?2?\b|\binstance metadata\b|\bgetcalleridentity\b|\bsimulateprincipalpolicy\b/i,
  },
  { kind: "portainer", re: /\bportainer\b/i },
  { kind: "figma", re: /\bfigma\b|\bfigjam\b/i },
  { kind: "gmail", re: /\bgmail\b/i },
  { kind: "gcal", re: /\bgoogle calendar\b|\bgcal\b|\bcalendar event/i },
  { kind: "gdrive", re: /\bgoogle drive\b|\bgdrive\b/i },
  {
    kind: "kubernetes",
    re: /\bkubernetes\b|\bk8s\b|\bkubectl\b|\bkubeconfig\b|\bkubelet\b|\bcrashloopbackoff\b/i,
  },
  { kind: "sentry", re: /\bsentry\b/i },
];

export function namedOpsKinds(text: string): IntegrationKind[] {
  const out: IntegrationKind[] = [];
  for (const row of OPS_KIND_RE) {
    if (row.re.test(text)) out.push(row.kind);
  }
  return out;
}

export function looksLikeOpsPrompt(text: string): boolean {
  return namedOpsKinds(text).length > 0 || looksLikeDockerSwarmPrompt(text);
}

export function isWorkspaceSearchTool(name: string, args?: Record<string, unknown>): boolean {
  const n = canonicalToolName(name).replace(/^locus-/, "");
  if (!SEARCH_TOOLS.has(n) && !SEARCH_TOOLS.has(name)) return false;
  if (n !== "exec" && n !== "powershell") return true;
  const cmds = execArgCommands(args ?? {});
  if (!cmds.length) return true;
  return !cmds.some((cmd) => looksLikeVerifyCommand(cmd));
}

/** A call that actually pulls logs or posts — not MCP catalog discovery. */
export function isOpsProgressTool(name: string): boolean {
  if (isIntegrationToolName(name) || isDockerSwarmToolName(name)) return true;
  if (isMcpDiscoveryToolName(name)) return false;
  return isMcpToolName(name);
}

export function shouldNudgeOpsRouting(obs: {
  named: boolean;
  calledOps: boolean;
  searchRounds: number;
  nudges: number;
  planTurn?: boolean;
  stopped?: boolean;
}): boolean {
  return (
    obs.named &&
    !obs.calledOps &&
    !obs.planTurn &&
    !obs.stopped &&
    obs.searchRounds >= OPS_ROUTING_SEARCH_ROUNDS &&
    obs.nudges < MAX_OPS_ROUTING_NUDGES
  );
}

export function formatCursorOpsRoutingCard(input: {
  prompt: string;
  connected: IntegrationKind[];
  /** Cursor CLI can call Locus host integration tools through the injected locus MCP server. */
  hostToolsViaMcp?: boolean;
}): string {
  if (!looksLikeOpsPrompt(input.prompt)) return "";
  const connected = input.connected.length
    ? `Connected in Locus Settings: ${input.connected.join(", ")}.`
    : "No Grafana/Slack/Jira/Confluence/Linear/incident.io/AWS IAM/Portainer/Figma/Gmail/Calendar/Drive/Kubernetes/Sentry token is configured in Locus Settings.";
  if (input.hostToolsViaMcp && input.connected.length) {
    return [
      "Ops routing (Cursor runtime): Call grafana_query / grafana_search / slack_* / jira_* / confluence_* / linear_* / incidentio_* / aws_sts_identity / aws_iam_* / portainer_* / figma_* / gmail_* / calendar_* / drive_* / k8s_* / sentry_* on the locus MCP server in the first round. Listing MCP tools is not enough.",
      connected,
      "Do not grep the workspace or integrations.ts to learn those APIs. Do not drive another Locus session via localhost.",
      "A truncated or offloaded API result is not a broken API — grep the saved file or narrow the query. Do not write a scrape script or curl.",
    ].join(" ");
  }
  return [
    "Ops routing (Cursor runtime): Locus host tools such as grafana_query, slack_post, and portainer_containers are not in this catalog.",
    connected,
    "If MCP lists Grafana, Slack, Jira, Confluence, Linear, incident.io, AWS IAM, Portainer, Figma, Gmail, Calendar, Drive, Kubernetes, or Sentry, call those tools in the first round (mcp_call / mcp_code, not only listing them).",
    "Do not grep the workspace or integrations.ts to learn those APIs. Do not drive another Locus session via localhost.",
    "A truncated or offloaded API result is not a broken API — grep the saved file or narrow the query. Do not write a scrape script or curl.",
    "If you cannot query logs via MCP, stop and say so.",
  ].join(" ");
}
