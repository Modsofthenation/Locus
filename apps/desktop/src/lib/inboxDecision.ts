import {
  canonicalToolCall,
  isAskUserToolName,
  operatorVisibleText,
  patchFilesFromTool,
  sessionRuntime,
  toolActivityLabel,
  type AgentSession,
  type ToolCall,
} from "@locus/shared";
import type { InboxRow } from "./inboxList";

export type ApprovalRisk = "low" | "medium" | "high";

/** Everything the Inbox needs to approve or deny a tool call without opening the chat. */
export type ApprovalPreview = {
  call: ToolCall;
  /** Canonical tool name (`exec`, `apply_patch`, `git_push`, …). */
  tool: string;
  /** Plain sentence: "Ran npm test", "Edited src/app.ts". */
  label: string;
  command?: string;
  path?: string;
  branch?: string;
  /** Files an edit would touch. */
  files: string[];
  /** Arguments as pretty JSON, clipped, for anything the fields above miss. */
  argsText: string;
  /** The agent's last words before it asked, so the operator sees why. */
  why?: string;
  /** Where it runs: "Host · /home/me/repo", "Docker container", … */
  where: string;
  risk: ApprovalRisk;
  riskReason: string;
  /** Approve / Deny apply (ask_user needs an answer in the chat instead). */
  batchable: boolean;
};

const ARGS_MAX = 1200;
const WHY_MAX = 280;

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function findPendingCall(
  session: AgentSession | undefined,
  callId: string | undefined,
): { call: ToolCall; index: number } | undefined {
  if (!session || !callId) return undefined;
  for (let i = 0; i < session.messages.length; i++) {
    for (const call of session.messages[i]!.toolCalls ?? []) {
      if (call.id === callId && call.approval === "needed" && !call.finishedAt) {
        return { call, index: i };
      }
    }
  }
  return undefined;
}

function lastAgentWords(session: AgentSession, index: number): string | undefined {
  for (let i = index; i >= 0; i--) {
    const message = session.messages[i]!;
    if (message.role === "user") return undefined;
    if (message.role !== "assistant") continue;
    const text = operatorVisibleText(message.role, message.content).trim();
    if (text) return clip(text.replace(/\s+/g, " "), WHY_MAX);
  }
  return undefined;
}

function whereLabel(session: AgentSession): string {
  const runtime = sessionRuntime(session);
  const folder = session.hostDir?.trim();
  if (runtime === "host") return folder ? `This machine · ${folder}` : "This machine";
  if (runtime === "docker") return "Docker container";
  return "Virtual machine";
}

const DESTRUCTIVE_COMMAND =
  /\b(rm\s+-[a-z]*[rf]|sudo|mkfs|dd\s+if=|chmod\s+-R|chown\s+-R|git\s+push\s+.*--force|git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f|curl\b.*\|\s*(?:ba|z)?sh|wget\b.*\|\s*(?:ba|z)?sh|shutdown|reboot|kill\s+-9|drop\s+(?:table|database))\b/i;

const OUTWARD_TOOLS = new Set([
  "git_push",
  "git_pr",
  "git_pr_merge",
  "git_pr_comment",
  "git_pr_review",
  "slack_post",
  "brain_brief",
]);

/** A hint, not a policy: what could go wrong if this is approved. */
export function approvalRisk(
  tool: string,
  args: Record<string, unknown>,
  runtime: ReturnType<typeof sessionRuntime>,
): { risk: ApprovalRisk; reason: string } {
  const command = str(args, "command") ?? "";
  if (tool === "git_pr_merge") return { risk: "high", reason: "Merges a pull request" };
  if ((tool === "exec" || tool === "powershell") && DESTRUCTIVE_COMMAND.test(command)) {
    return { risk: "high", reason: "Command can delete or overwrite data" };
  }
  if (OUTWARD_TOOLS.has(tool)) {
    return { risk: "medium", reason: "Visible to other people once it runs" };
  }
  if (runtime === "host" && (tool === "exec" || tool === "powershell")) {
    return { risk: "medium", reason: "Runs on this machine, outside a sandbox" };
  }
  if (runtime === "host" && (tool === "file_write" || tool === "apply_patch")) {
    return { risk: "medium", reason: "Changes files on this machine" };
  }
  if (tool.startsWith("mcp_")) return { risk: "medium", reason: "Calls an external MCP tool" };
  return {
    risk: "low",
    reason: runtime === "host" ? "Read-only or contained" : "Contained in the agent's guest",
  };
}

const PAST_TO_ASK: Array<[RegExp, string]> = [
  [/^Ran\b/, "Run"],
  [/^Wrote\b/, "Write"],
  [/^Edited\b/, "Edit"],
  [/^Read\b/, "Read"],
  [/^Listed\b/, "List"],
  [/^Grepped\b/, "Search"],
  [/^Searched\b/, "Search"],
  [/^Built\b/, "Build"],
  [/^Updated\b/, "Update"],
];

/** Activity labels are written for finished calls ("Ran npm test"); ask in the present. */
export function pendingActionLabel(label: string): string {
  for (const [pattern, verb] of PAST_TO_ASK) {
    if (pattern.test(label)) return label.replace(pattern, verb);
  }
  return label;
}

export function approvalPreview(
  session: AgentSession | undefined,
  callId: string | undefined,
): ApprovalPreview | undefined {
  const found = findPendingCall(session, callId);
  if (!session || !found) return undefined;
  const { call, index } = found;
  const canon = canonicalToolCall(call.name, call.arguments);
  const args = canon.arguments;
  const files = patchFilesFromTool(canon.name, args).map((file) => file.path);
  const runtime = sessionRuntime(session);
  const { risk, reason } = approvalRisk(canon.name, args, runtime);
  let argsText: string;
  try {
    argsText = clip(JSON.stringify(call.arguments, null, 2), ARGS_MAX);
  } catch {
    argsText = "";
  }
  return {
    call,
    tool: canon.name,
    label: pendingActionLabel(toolActivityLabel(call.name, call.arguments)),
    command: str(args, "command"),
    path: str(args, "path"),
    branch: str(args, "branch"),
    files,
    argsText: argsText === "{}" ? "" : argsText,
    why: lastAgentWords(session, index),
    where: whereLabel(session),
    risk,
    riskReason: reason,
    batchable: !isAskUserToolName(call.name),
  };
}

/** Other pending approvals of the same tool, for "Approve all". Includes `row` itself. */
export function sameToolRows(
  rows: InboxRow[],
  sessions: AgentSession[],
  row: InboxRow,
): InboxRow[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const name = findPendingCall(byId.get(row.sessionId ?? ""), row.callId)?.call.name;
  if (!name || isAskUserToolName(name)) return [];
  return rows.filter((other) => {
    if (!other.sessionId || !other.callId) return false;
    const call = findPendingCall(byId.get(other.sessionId), other.callId)?.call;
    return call?.name === name;
  });
}

/** Move the focused Inbox row by `delta`, staying in range. */
export function stepInboxFocus(rows: InboxRow[], key: string | null, delta: number): string | null {
  if (!rows.length) return null;
  const index = rows.findIndex((row) => row.key === key);
  const from = index < 0 ? 0 : index;
  const next = Math.min(rows.length - 1, Math.max(0, from + delta));
  return rows[next]!.key;
}
