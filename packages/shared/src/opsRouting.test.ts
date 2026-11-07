import { describe, expect, it } from "vitest";
import {
  formatCursorOpsRoutingCard,
  isOpsProgressTool,
  isWorkspaceSearchTool,
  looksLikeOpsPrompt,
  namedOpsKinds,
  OPS_ROUTING_HABIT,
  OPS_ROUTING_NUDGE,
  OPS_ROUTING_SEARCH_ROUNDS,
  shouldNudgeOpsRouting,
} from "./opsRouting.js";

describe("ops routing", () => {
  it("detects Grafana/Slack/Jira/incident.io prompts and search vs progress tools", () => {
    expect(namedOpsKinds("pull grafana errors and post to slack")).toEqual(["grafana", "slack"]);
    expect(namedOpsKinds("search confluence for the checkout runbook")).toEqual(["confluence"]);
    expect(namedOpsKinds("list open incident.io incidents")).toEqual(["incidentio"]);
    expect(namedOpsKinds("search Linear issues for checkout")).toEqual(["linear"]);
    expect(namedOpsKinds("check Linear")).toEqual(["linear"]);
    expect(namedOpsKinds("Linear ENG-12")).toEqual(["linear"]);
    expect(namedOpsKinds("Add a linear gradient")).toEqual([]);
    expect(namedOpsKinds("can this IAM role access the bucket")).toEqual(["aws"]);
    expect(namedOpsKinds("list portainer containers on prod")).toEqual(["portainer"]);
    expect(namedOpsKinds("implement this Figma frame")).toEqual(["figma"]);
    expect(namedOpsKinds("search gmail for the outage thread")).toEqual(["gmail"]);
    expect(namedOpsKinds("create a google calendar event tomorrow")).toEqual(["gcal"]);
    expect(namedOpsKinds("upload the spec to google drive")).toEqual(["gdrive"]);
    expect(namedOpsKinds("list crashloopbackoff pods with kubectl")).toEqual(["kubernetes"]);
    expect(namedOpsKinds("open the sentry issue WEB-12")).toEqual(["sentry"]);
    expect(looksLikeOpsPrompt("logger.level:error LogQL last hour")).toBe(true);
    expect(looksLikeOpsPrompt("Add a README")).toBe(false);
    expect(looksLikeOpsPrompt("list docker swarm services")).toBe(true);
    expect(isOpsProgressTool("docker_swarm")).toBe(true);
    expect(isWorkspaceSearchTool("grep")).toBe(true);
    expect(isWorkspaceSearchTool("exec")).toBe(true);
    expect(isOpsProgressTool("grafana_query")).toBe(true);
    expect(isOpsProgressTool("mcp_call")).toBe(true);
    expect(isOpsProgressTool("mcp_grafana_query")).toBe(true);
    expect(isOpsProgressTool("mcp_list_tools")).toBe(false);
    expect(isOpsProgressTool("mcp_get_tool_info")).toBe(false);
    expect(OPS_ROUTING_HABIT).toMatch(/grafana_query/);
    expect(OPS_ROUTING_HABIT).toMatch(/figma_\*/);
    expect(OPS_ROUTING_HABIT).toMatch(/Do not re-fetch those APIs/);
    expect(OPS_ROUTING_NUDGE).toMatch(/Listing MCP tools is not enough/);
  });

  it("nudges after a search streak without an integration or MCP call", () => {
    const base = {
      named: true,
      calledOps: false,
      searchRounds: OPS_ROUTING_SEARCH_ROUNDS,
      nudges: 0,
    };
    expect(shouldNudgeOpsRouting(base)).toBe(true);
    expect(shouldNudgeOpsRouting({ ...base, searchRounds: 3 })).toBe(false);
    expect(shouldNudgeOpsRouting({ ...base, calledOps: true })).toBe(false);
    expect(shouldNudgeOpsRouting({ ...base, nudges: 1 })).toBe(false);
    expect(shouldNudgeOpsRouting({ ...base, planTurn: true })).toBe(false);
    expect(shouldNudgeOpsRouting({ ...base, named: false })).toBe(false);
  });

  it("writes a Cursor ops card only for ops prompts", () => {
    expect(formatCursorOpsRoutingCard({ prompt: "Add a README", connected: ["grafana"] })).toBe("");
    const card = formatCursorOpsRoutingCard({
      prompt: "Pull Grafana error logs and post to Slack",
      connected: ["grafana", "slack"],
    });
    expect(card).toMatch(/grafana_query/);
    expect(card).toMatch(/Connected in Locus Settings: grafana, slack/);
    expect(card).toMatch(/Do not write a scrape script or curl/);
    expect(card).toMatch(/Listing them/i);
    expect(card).toMatch(/are not in this catalog/);
    const bridged = formatCursorOpsRoutingCard({
      prompt: "Pull Grafana error logs and post to Slack",
      connected: ["grafana", "slack"],
      hostToolsViaMcp: true,
    });
    expect(bridged).toMatch(/locus MCP server/);
    expect(bridged).not.toMatch(/are not in this catalog/);
    expect(bridged).not.toMatch(/If you cannot query logs via MCP, stop/);
  });
});
