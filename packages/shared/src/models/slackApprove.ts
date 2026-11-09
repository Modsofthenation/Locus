const GIT_WRITE = new Set([
  "git_push",
  "git_pr",
  "git_pr_merge",
  "git_pr_review",
  "git_pr_comment",
  "git_issue_comment",
]);

/** Tools an operator may Approve / Deny from Slack. `git_push` and other forge writes stay in Locus. */
export const SLACK_APPROVABLE_TOOLS = new Set(["slack_post", "slack_upload"]);

export function slackCanApproveTool(name: string): boolean {
  const tool = name.trim();
  if (!tool || GIT_WRITE.has(tool)) return false;
  return SLACK_APPROVABLE_TOOLS.has(tool);
}

export function slackApprovalActionId(decision: "approved" | "denied"): string {
  return decision === "approved" ? "locus_approve" : "locus_deny";
}

export function parseSlackApprovalValue(
  raw: string,
): { sessionId: string; callId: string } | undefined {
  const match = /^([a-zA-Z0-9_-]{8,64}):([a-zA-Z0-9_-]{8,64})$/.exec(raw.trim());
  if (!match?.[1] || !match[2]) return undefined;
  return { sessionId: match[1], callId: match[2] };
}

export function formatSlackApprovalValue(sessionId: string, callId: string): string {
  return `${sessionId}:${callId}`;
}
