export interface ApprovalPolicy {
  /** Tool names that skip chat approval (still cannot skip git_push to a protected branch). */
  autoAllow?: string[];
  /** Tool names that always wait, including exec. */
  alwaysAsk?: string[];
  /** Tool names that are denied before they run. */
  deny?: string[];
  /** Reject git_push / git_pr onto main, master, or trunk. */
  protectDefaultBranch?: boolean;
}

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  autoAllow: [],
  alwaysAsk: [],
  deny: [],
  protectDefaultBranch: true,
};

export function parseApprovalPolicy(raw: unknown): ApprovalPolicy {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_APPROVAL_POLICY };
  const value = raw as Record<string, unknown>;
  const names = (input: unknown): string[] =>
    Array.isArray(input)
      ? input
          .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
          .map((item) => item.trim())
      : [];
  return {
    autoAllow: names(value.autoAllow),
    alwaysAsk: names(value.alwaysAsk),
    deny: names(value.deny),
    protectDefaultBranch: value.protectDefaultBranch === false ? false : true,
  };
}

export function policyEntryMatches(
  entry: string,
  name: string,
  args?: Record<string, unknown>,
): boolean {
  const rule = entry.trim();
  if (!rule) return false;
  if (rule === name) return true;
  if (rule === "mcp" && name.startsWith("mcp_")) return true;
  if (rule === "plugin" && (name.startsWith("plugin_") || name === "manage_integration_plugin"))
    return true;
  const match = rule.match(/^([a-z0-9_]+)\(([a-z0-9_]+):(.+)\)$/i);
  if (!match) return false;
  const tool = match[1];
  const param = match[2];
  const rawValue = match[3];
  if (!tool || !param || rawValue == null) return false;
  if (tool !== name && !(tool === "mcp" && name.startsWith("mcp_"))) return false;
  const expected = rawValue.trim();
  const actual = args?.[param];
  if (actual === undefined || actual === null) return false;
  const text = Array.isArray(actual)
    ? actual.map((item) => String(item)).join("\n")
    : String(actual);
  if (expected.endsWith("*")) {
    const prefix = expected.slice(0, -1);
    return text === prefix || text.startsWith(prefix);
  }
  if (param === "path" || param === "paths") {
    return text === expected || text.endsWith(`/${expected}`) || text.includes(expected);
  }
  return text === expected;
}

/** Session-sticky allow from Needs you. Prefer a branch glob when we have one. */
export function stickyAllowEntry(name: string, args?: Record<string, unknown>): string {
  const branch = typeof args?.branch === "string" ? args.branch.trim() : "";
  if (
    branch &&
    (name === "git_push" ||
      name === "git_pr" ||
      name === "git_pr_merge" ||
      name === "git_pr_review" ||
      name === "git_pr_comment")
  ) {
    const pattern = stickyBranchPattern(branch);
    return `${name}(branch:${pattern})`;
  }
  return name;
}

function stickyBranchPattern(branch: string): string {
  let name = branch.replace(/^refs\/heads\//, "");
  const remote = name.split("/")[0];
  if (remote === "origin" || remote === "upstream" || remote === "fork") {
    name = name.slice(remote.length + 1);
  }
  const slash = name.indexOf("/");
  if (slash > 0) return `${name.slice(0, slash + 1)}*`;
  return name;
}

/** Session Always allow beats tier alwaysAsk for the same tool. Config deny still wins. */
export function alwaysAskMinusSticky(
  alwaysAsk: string[] | undefined,
  sticky: string[] | undefined,
): string[] {
  if (!alwaysAsk?.length) return [];
  if (!sticky?.length) return [...alwaysAsk];
  return alwaysAsk.filter((ask) => {
    const tool = ask.replace(/\(.*$/, "");
    return !sticky.some((entry) => entry === tool || entry === ask || entry.startsWith(`${tool}(`));
  });
}

export function policyListMatches(
  list: string[] | undefined,
  name: string,
  args?: Record<string, unknown>,
): boolean {
  return Boolean(list?.some((entry) => policyEntryMatches(entry, name, args)));
}

export function toolDeniedByPolicy(
  name: string,
  policy?: ApprovalPolicy,
  args?: Record<string, unknown>,
): boolean {
  return policyListMatches(policy?.deny, name, args);
}

export function policyToolNeedsApproval(
  name: string,
  policy?: ApprovalPolicy,
  args?: Record<string, unknown>,
): boolean {
  if (policyListMatches(policy?.deny, name, args)) return false;
  if (policyListMatches(policy?.alwaysAsk, name, args)) return true;
  if (name === "mcp_list_tools" || name === "mcp_get_tool_info" || name === "read_skill") {
    return false;
  }
  if (name === "ask_user") return true;
  if (name.startsWith("mcp_")) {
    if (policyListMatches(policy?.autoAllow, name, args) || policy?.autoAllow?.includes("mcp"))
      return false;
    return true;
  }
  if (name.startsWith("plugin_") || name === "manage_integration_plugin") {
    if (policyListMatches(policy?.autoAllow, name, args) || policy?.autoAllow?.includes("plugin"))
      return false;
    return true;
  }
  if (name === "git_push") {
    if (policy?.protectDefaultBranch !== false && isDefaultBranchTarget(args)) return false;
    if (policyListMatches(policy?.autoAllow, name, args)) return false;
    return true;
  }
  if (
    name === "git_pr" ||
    name === "git_pr_review" ||
    name === "git_pr_comment" ||
    name === "git_pr_merge" ||
    name === "git_issue_comment"
  ) {
    if (policy?.protectDefaultBranch !== false && isDefaultBranchTarget(args)) return true;
    if (policyListMatches(policy?.autoAllow, name, args)) return false;
    return true;
  }
  if (
    name === "jira_comment" ||
    name === "jira_create" ||
    name === "jira_update" ||
    name === "jira_transition" ||
    name === "confluence_create" ||
    name === "confluence_update" ||
    name === "confluence_comment" ||
    name === "linear_comment" ||
    name === "linear_create" ||
    name === "linear_update" ||
    name === "slack_post" ||
    name === "slack_upload" ||
    name === "sentry_update" ||
    name === "board_upsert" ||
    name === "board_delete" ||
    name === "board_cluster" ||
    name === "brain_brief" ||
    name === "miro_export" ||
    name === "figma_comment" ||
    name === "incidentio_comment" ||
    name === "incidentio_create" ||
    name === "incidentio_update" ||
    name === "portainer_container_action" ||
    name === "portainer_stack_action" ||
    name === "gmail_send" ||
    (name === "docker_swarm" &&
      typeof args?.action === "string" &&
      args.action.trim().toLowerCase() === "scale") ||
    name === "calendar_create" ||
    name === "drive_upload" ||
    name === "k8s_apply" ||
    name === "k8s_delete" ||
    name === "k8s_scale"
  ) {
    if (policyListMatches(policy?.autoAllow, name, args)) return false;
    return true;
  }
  if (policyListMatches(policy?.autoAllow, name, args)) return false;
  return false;
}

export function isDefaultBranchTarget(args?: Record<string, unknown>): boolean {
  if (!args) return false;
  const branch =
    typeof args.branch === "string" ? args.branch : typeof args.base === "string" ? args.base : "";
  const name = branch
    .trim()
    .replace(/^refs\/heads\//, "")
    .toLowerCase();
  return name === "main" || name === "master" || name === "trunk";
}
