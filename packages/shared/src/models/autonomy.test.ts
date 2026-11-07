import { describe, expect, it } from "vitest";
import { parseApprovalPolicy, toolDeniedByPolicy } from "./approval.js";
import { toolNeedsApproval } from "./tools.js";
import {
  approvalPolicyForTier,
  AUTONOMOUS_DEFAULT_MAX_USD,
  formatAutonomy,
  mergeApprovalPolicy,
  parseAutonomyTier,
  resolveSpendCapUsd,
  sessionAutonomy,
} from "./autonomy.js";

describe("autonomy tiers", () => {
  it("parses tiers and falls back to guided", () => {
    expect(parseAutonomyTier("supervised")).toBe("supervised");
    expect(parseAutonomyTier("nope")).toBe("guided");
    expect(sessionAutonomy(undefined, "autonomous")).toBe("autonomous");
    expect(formatAutonomy("autonomous")).toMatch(/overnight/);
  });

  it("asks for every mutating command in supervised", () => {
    const policy = approvalPolicyForTier("supervised");
    expect(toolNeedsApproval("exec", policy, { command: "ls" })).toBe(true);
    expect(toolNeedsApproval("file_write", policy, { path: "a.ts", content: "x" })).toBe(true);
    expect(toolNeedsApproval("apply_patch", policy, { patch: "diff" })).toBe(true);
    expect(toolNeedsApproval("git_commit", policy, { message: "wip" })).toBe(true);
    expect(toolNeedsApproval("start_process", policy, { command: "npm start" })).toBe(true);
    expect(toolNeedsApproval("file_read", policy, { path: "a.ts" })).toBe(false);
  });

  it("keeps guided defaults: push/PR/MCP wait, reads do not", () => {
    const policy = approvalPolicyForTier("guided");
    expect(formatAutonomy("guided")).toMatch(/Host agents also ask for exec/);
    expect(toolNeedsApproval("grep", policy)).toBe(false);
    expect(toolNeedsApproval("exec", policy, { command: "ls" })).toBe(false);
    expect(toolNeedsApproval("git_push", policy)).toBe(true);
    expect(toolNeedsApproval("git_pr", policy, { title: "t" })).toBe(true);
    expect(toolNeedsApproval("mcp_jira_search", policy)).toBe(true);
    expect(toolNeedsApproval("plugin_status_create", policy)).toBe(true);
    expect(toolNeedsApproval("manage_integration_plugin", policy)).toBe(true);
    expect(toolNeedsApproval("exec", policy, { command: "npm install lodash" })).toBe(true);
    expect(toolNeedsApproval("powershell", policy, { command: "pip install requests" })).toBe(true);
    expect(toolNeedsApproval("exec", policy, { command: "apt-get install curl" })).toBe(true);
  });

  it("auto-allows MCP, push, PR, comments, and installs in autonomous except protected branches", () => {
    const policy = approvalPolicyForTier("autonomous");
    expect(toolNeedsApproval("mcp_jira_search", policy)).toBe(false);
    expect(toolNeedsApproval("plugin_status_create", policy)).toBe(false);
    expect(toolNeedsApproval("manage_integration_plugin", policy)).toBe(false);
    expect(toolNeedsApproval("git_push", policy, { branch: "feat" })).toBe(false);
    expect(toolNeedsApproval("git_push", policy, { branch: "main" })).toBe(false);
    expect(toolNeedsApproval("git_pr", policy, { title: "t", base: "master" })).toBe(true);
    expect(toolNeedsApproval("git_pr_comment", policy)).toBe(false);
    expect(toolNeedsApproval("git_issue_comment", policy)).toBe(false);
    expect(toolNeedsApproval("jira_comment", policy)).toBe(false);
    expect(toolNeedsApproval("jira_create", policy)).toBe(false);
    expect(toolNeedsApproval("jira_update", policy)).toBe(false);
    expect(toolNeedsApproval("jira_transition", policy)).toBe(false);
    expect(toolNeedsApproval("confluence_create", policy)).toBe(false);
    expect(toolNeedsApproval("confluence_update", policy)).toBe(false);
    expect(toolNeedsApproval("confluence_comment", policy)).toBe(false);
    expect(toolNeedsApproval("linear_comment", policy)).toBe(false);
    expect(toolNeedsApproval("linear_create", policy)).toBe(false);
    expect(toolNeedsApproval("linear_update", policy)).toBe(false);
    expect(toolNeedsApproval("slack_post", policy)).toBe(false);
    expect(toolNeedsApproval("slack_upload", policy)).toBe(false);
    expect(toolNeedsApproval("incidentio_comment", policy)).toBe(false);
    expect(toolNeedsApproval("incidentio_create", policy)).toBe(false);
    expect(toolNeedsApproval("incidentio_update", policy)).toBe(false);
    expect(toolNeedsApproval("portainer_container_action", policy)).toBe(false);
    expect(toolNeedsApproval("portainer_stack_action", policy)).toBe(false);
    expect(toolNeedsApproval("docker_swarm", policy, { action: "scale", replicas: 3 })).toBe(false);
    expect(toolNeedsApproval("gmail_send", policy)).toBe(false);
    expect(toolNeedsApproval("calendar_create", policy)).toBe(false);
    expect(toolNeedsApproval("drive_upload", policy)).toBe(false);
    expect(toolNeedsApproval("k8s_apply", policy)).toBe(false);
    expect(toolNeedsApproval("k8s_delete", policy)).toBe(false);
    expect(toolNeedsApproval("k8s_scale", policy)).toBe(false);
    expect(toolNeedsApproval("sentry_update", policy)).toBe(false);
    expect(toolNeedsApproval("exec", policy, { command: "npm install lodash" })).toBe(false);
    expect(
      toolNeedsApproval("file_write", policy, {
        path: "package.json",
        content: '{"scripts":{"postinstall":"x"}}',
      }),
    ).toBe(false);
  });

  it("lets Advanced alwaysAsk and deny overlay the tier", () => {
    const policy = mergeApprovalPolicy(
      approvalPolicyForTier("autonomous"),
      parseApprovalPolicy({ alwaysAsk: ["git_push"], deny: ["slack_post"] }),
    );
    expect(toolNeedsApproval("git_push", policy, { branch: "feat" })).toBe(true);
    expect(toolNeedsApproval("slack_post", policy)).toBe(false);
    expect(toolDeniedByPolicy("slack_post", policy)).toBe(true);
    expect(toolNeedsApproval("mcp_jira_search", policy)).toBe(false);
  });

  it("requires a spend cap on autonomous and defaults to $20", () => {
    expect(resolveSpendCapUsd("guided", undefined, undefined)).toBeUndefined();
    expect(resolveSpendCapUsd("guided", 5, 1)).toBe(5);
    expect(resolveSpendCapUsd("autonomous", undefined, undefined)).toBe(AUTONOMOUS_DEFAULT_MAX_USD);
    expect(resolveSpendCapUsd("autonomous", undefined, 8)).toBe(8);
    expect(resolveSpendCapUsd("autonomous", 3, 8)).toBe(3);
  });
});
