import { DEFAULT_APPROVAL_POLICY, type ApprovalPolicy } from "./approval.js";

export const AUTONOMY_TIERS = ["supervised", "guided", "autonomous"] as const;
export type AutonomyTier = (typeof AUTONOMY_TIERS)[number];

export const DEFAULT_AUTONOMY: AutonomyTier = "guided";
export const AUTONOMOUS_DEFAULT_MAX_USD = 20;

export const SUPERVISED_ALWAYS_ASK = [
  "exec",
  "file_write",
  "apply_patch",
  "git_commit",
  "start_process",
  "powershell",
] as const;

/** Host-runtime Guided: exec can reach the rest of the operator machine. */
export const HOST_GUIDED_ALWAYS_ASK = ["exec", "powershell", "start_process"] as const;

export const AUTONOMOUS_AUTO_ALLOW = [
  "git_push",
  "git_pr",
  "git_pr_review",
  "git_pr_comment",
  "git_pr_merge",
  "git_issue_comment",
  "jira_comment",
  "jira_create",
  "jira_update",
  "jira_transition",
  "confluence_create",
  "confluence_update",
  "confluence_comment",
  "linear_comment",
  "linear_create",
  "linear_update",
  "slack_post",
  "slack_upload",
  "sentry_update",
  "miro_export",
  "figma_comment",
  "incidentio_comment",
  "incidentio_create",
  "incidentio_update",
  "portainer_container_action",
  "portainer_stack_action",
  "docker_swarm",
  "gmail_send",
  "calendar_create",
  "drive_upload",
  "k8s_apply",
  "k8s_delete",
  "k8s_scale",
  "mcp",
  "plugin",
  "install",
] as const;

export function isAutonomyTier(value: unknown): value is AutonomyTier {
  return value === "supervised" || value === "guided" || value === "autonomous";
}

export function parseAutonomyTier(
  value: unknown,
  fallback: AutonomyTier = DEFAULT_AUTONOMY,
): AutonomyTier {
  return isAutonomyTier(value) ? value : fallback;
}

export function sessionAutonomy(session?: AutonomyTier, fallback?: AutonomyTier): AutonomyTier {
  if (isAutonomyTier(session)) return session;
  if (isAutonomyTier(fallback)) return fallback;
  return DEFAULT_AUTONOMY;
}

export function formatAutonomy(tier: AutonomyTier): string {
  if (tier === "supervised") return "Supervised — show every mutating command";
  if (tier === "autonomous")
    return "Autonomous — overnight; auto-allows push/PR/MCP/plugins/installs; $20 spend cap";
  return "Guided — ask for push, PR, MCP, plugins, and installs (no default spend cap). Host agents also ask for exec.";
}

export function approvalPolicyForTier(tier: AutonomyTier): ApprovalPolicy {
  if (tier === "supervised") {
    return {
      autoAllow: [],
      alwaysAsk: [...SUPERVISED_ALWAYS_ASK],
      deny: [],
      protectDefaultBranch: true,
    };
  }
  if (tier === "autonomous") {
    return {
      autoAllow: [...AUTONOMOUS_AUTO_ALLOW],
      alwaysAsk: [],
      deny: [],
      protectDefaultBranch: true,
    };
  }
  return { ...DEFAULT_APPROVAL_POLICY };
}

export function mergeApprovalPolicy(
  base: ApprovalPolicy,
  overlay?: ApprovalPolicy,
): ApprovalPolicy {
  if (!overlay) {
    return {
      autoAllow: [...(base.autoAllow ?? [])],
      alwaysAsk: [...(base.alwaysAsk ?? [])],
      deny: [...(base.deny ?? [])],
      protectDefaultBranch: base.protectDefaultBranch !== false,
    };
  }
  return {
    autoAllow: uniq([...(base.autoAllow ?? []), ...(overlay.autoAllow ?? [])]),
    alwaysAsk: uniq([...(base.alwaysAsk ?? []), ...(overlay.alwaysAsk ?? [])]),
    deny: uniq([...(base.deny ?? []), ...(overlay.deny ?? [])]),
    protectDefaultBranch:
      overlay.protectDefaultBranch === false ? false : base.protectDefaultBranch !== false,
  };
}

export function resolveSpendCapUsd(
  tier: AutonomyTier,
  sessionMax?: number,
  configMax?: number,
): number | undefined {
  const cap = positive(sessionMax) ?? positive(configMax);
  if (tier === "autonomous") return cap ?? AUTONOMOUS_DEFAULT_MAX_USD;
  return cap;
}

function uniq(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function positive(value?: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}
