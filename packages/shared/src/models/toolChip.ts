import { askUserItems } from "./askUser.js";
import {
  askUserArgsFromCursorAskQuestion,
  CURSOR_CREATE_PLAN_TOOL,
  CURSOR_SWITCH_MODE_TOOL,
  isCursorAskQuestionTool,
  isCursorCreatePlanTool,
  isCursorSwitchModeTool,
} from "./cursorPlan.js";
import { playwrightChipDetail } from "./playwrightCanvas.js";
import { fileReadPaths } from "./tools.js";
import { parseSubagentKind } from "./subagentKind.js";

export function parseExitCode(text?: string): number | undefined {
  if (!text) return undefined;
  const match =
    text.match(/\(exit\s+(-?\d+)\)/i) || text.match(/\bexit(?:\s+code)?\s*[:=]?\s*(-?\d+)\b/i);
  if (!match) return undefined;
  const code = Number(match[1]);
  return Number.isFinite(code) ? code : undefined;
}

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

function strArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

/** Map Cursor/Claude aliases onto Locus catalog names for chips, activity, and execution. */
export function canonicalToolName(name: string): string {
  if (name === "read" || name === "Read" || name === "read_file") return "file_read";
  if (
    name === "write" ||
    name === "Write" ||
    name === "write_file" ||
    name === "edit_file" ||
    name === "delete" ||
    name === "Delete"
  ) {
    return "file_write";
  }
  if (
    name === "search_replace" ||
    name === "searchReplace" ||
    name === "StrReplace" ||
    name === "str_replace" ||
    name === "Edit" ||
    name === "edit" ||
    name === "MultiEdit"
  ) {
    return "apply_patch";
  }
  if (
    name === "run_terminal_cmd" ||
    name === "shell" ||
    name === "Shell" ||
    name === "bash" ||
    name === "Bash" ||
    name === "terminal"
  ) {
    return "exec";
  }
  if (name === "Grep") return "grep";
  if (name === "Glob") return "glob";
  if (name === "LS" || name === "ls") return "file_list";
  if (name === "WriteCanvas" || name === "write_canvas") return "canvas_write";
  if (name === "ReadCanvas" || name === "read_canvas") return "canvas_read";
  if (isCursorAskQuestionTool(name)) return "ask_user";
  if (isCursorCreatePlanTool(name)) return CURSOR_CREATE_PLAN_TOOL;
  if (isCursorSwitchModeTool(name)) return CURSOR_SWITCH_MODE_TOOL;
  return name;
}

export function toolArgsForChip(args: Record<string, unknown>): Record<string, unknown> {
  let next = args;
  if (!strArg(next, "path")) {
    const target =
      strArg(next, "target_file") ||
      strArg(next, "relative_workspace_path") ||
      strArg(next, "file_path");
    if (target) next = { ...next, path: target };
  }
  if (typeof next.content !== "string") {
    if (typeof next.contents === "string") next = { ...next, content: next.contents };
    else if (typeof next.fileText === "string") next = { ...next, content: next.fileText };
    else if (typeof next.streamContent === "string") {
      next = { ...next, content: next.streamContent };
    }
  }
  if (!strArg(next, "command")) {
    const cmd = strArg(next, "cmd");
    if (cmd) next = { ...next, command: cmd };
  }
  return next;
}

function canvasToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const next = { ...toolArgsForChip(args) };
  if (typeof next.html !== "string") {
    const html = strArg(next, "content");
    if (html) next.html = html;
  }
  if (!strArg(next, "id")) {
    const id = strArg(args, "canvas_id") || strArg(args, "canvasId");
    if (id) next.id = id;
  }
  return next;
}

export function canonicalToolCall(
  name: string,
  args: Record<string, unknown> = {},
): { name: string; arguments: Record<string, unknown> } {
  if (isCursorAskQuestionTool(name)) {
    return { name: "ask_user", arguments: askUserArgsFromCursorAskQuestion(args) };
  }
  const canon = canonicalToolName(name);
  if (canon === "canvas_write" || canon === "canvas_read") {
    return { name: canon, arguments: canvasToolArgs(args) };
  }
  return { name: canon, arguments: toolArgsForChip(args) };
}

export function toolChipBits(
  name: string,
  args: Record<string, unknown> = {},
  result?: string,
  error?: string,
): string[] {
  name = canonicalToolName(name);
  args = toolArgsForChip(args);
  const bits = [
    name.startsWith("mcp_")
      ? name.replace(/^mcp_/, "mcp ")
      : name.startsWith("plugin_")
        ? name.replace(/^plugin_/, "plugin ")
        : name,
  ];
  if (name === "exec" || name === "powershell") {
    const cmds = Array.isArray(args.commands)
      ? args.commands.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0,
        )
      : [];
    if (cmds.length > 1) bits.push(`${cmds.length} commands`);
    else {
      const cmd = strArg(args, "command") || cmds[0] || "";
      if (cmd) bits.push(clip(cmd, 56));
    }
    const code = parseExitCode(`${error ?? ""}\n${result ?? ""}`);
    if (code != null) bits.push(`exit ${code}`);
    else if (error) bits.push("failed");
  } else if (name === "canvas_write" || name === "canvas_read") {
    bits[0] = "canvas";
    const title = strArg(args, "title") || strArg(args, "id");
    if (title) bits.push(clip(title, 48));
  } else if (name === "file_read" || name === "file_write" || name === "file_list") {
    const paths = name === "file_read" ? fileReadPaths(args) : [];
    if (paths.length > 1) bits.push(`${paths.length} files`);
    else {
      const path = strArg(args, "path") || paths[0] || "";
      if (path) bits.push(clip(path, 64));
    }
  } else if (name === "grep" || name === "glob") {
    const pattern = strArg(args, "pattern");
    const path = strArg(args, "path");
    if (pattern) bits.push(clip(pattern, 40));
    if (path) bits.push(clip(path, 40));
  } else if (name === "preview") {
    const port = args.port;
    if (port != null && String(port).trim()) bits.push(`:${clip(String(port), 8)}`);
    const previewPath = strArg(args, "path");
    if (previewPath) bits.push(clip(previewPath, 40));
  } else if (name === "playwright") {
    const detail = playwrightChipDetail(args);
    if (detail) bits.push(clip(detail, 48));
  } else if (name === "browser_trace") {
    bits[0] = "DevTools trace";
    const action = strArg(args, "action");
    if (action) bits.push(action);
  } else if (name === "websearch") {
    bits[0] = "web search";
    const query = strArg(args, "query");
    if (query) bits.push(clip(query, 48));
  } else if (name === "scratchpad") {
    bits[0] = "scratchpad";
    const action = strArg(args, "action");
    if (action) bits.push(action);
  } else if (name === "orient") {
    bits[0] = "orient";
  } else if (name === "find_entity") {
    bits[0] = "find entity";
    const q = strArg(args, "q");
    if (q) bits.push(clip(q, 40));
  } else if (name === "get_entity") {
    bits[0] = "get entity";
    const id = strArg(args, "id");
    if (id) bits.push(clip(id, 40));
  } else if (name === "search_knowledge") {
    bits[0] = "search knowledge";
    const q = strArg(args, "q");
    if (q) bits.push(clip(q, 40));
  } else if (name === "remember") {
    bits[0] = "memory";
    const action = strArg(args, "action");
    if (action) bits.push(action);
    const text = strArg(args, "text");
    if (text) bits.push(clip(text, 40));
  } else if (name === "subscribe") {
    bits[0] = "subscribe";
    const kind = strArg(args, "kind") || strArg(args, "action");
    if (kind) bits.push(clip(kind, 24));
    const title = strArg(args, "title") || strArg(args, "name") || strArg(args, "channelId");
    if (title) bits.push(clip(title, 40));
  } else if (name === "unsubscribe") {
    bits[0] = "unsubscribe";
    const id = strArg(args, "id");
    if (id) bits.push(clip(id, 24));
  } else if (name === "task_list") {
    bits[0] = "task list";
    const action = strArg(args, "action");
    if (action) bits.push(action);
    const text = strArg(args, "text");
    if (text) bits.push(clip(text, 40));
  } else if (name === "repo_map") {
    bits[0] = "repo map";
    const query = strArg(args, "query") || strArg(args, "path");
    if (query) bits.push(clip(query, 48));
  } else if (name === "git_pr_loadpath") {
    bits[0] = "load path";
    const number = args.pull_number;
    if (number != null && String(number).trim()) bits.push(`#${clip(String(number), 8)}`);
  } else if (
    name === "git_pr_get" ||
    name === "git_pr_list" ||
    name === "git_pr_comment" ||
    name === "git_pr_review" ||
    name === "git_pr_checks" ||
    name === "git_pr_merge" ||
    name === "git_issue_get" ||
    name === "git_issue_list" ||
    name === "git_issue_comment"
  ) {
    const number = args.pull_number ?? args.issue_number ?? args.number;
    if (number != null && String(number).trim()) bits.push(`#${clip(String(number), 8)}`);
  } else if (name === "host_sessions") {
    bits[0] = "host sessions";
    const action = strArg(args, "action") || "list";
    bits.push(clip(action, 12));
    const session = strArg(args, "session") || strArg(args, "kind") || strArg(args, "query");
    if (session) bits.push(clip(session, 40));
    const path = strArg(args, "path");
    if (path) bits.push(clip(path, 40));
  } else if (name === "spawn_agent") {
    const kind = parseSubagentKind(args.kind);
    bits[0] = kind ? `${kind} sub-agent` : "sub-agent";
    const task = strArg(args, "task");
    if (task) bits.push(clip(task, 48));
  } else if (name === "read_skill") {
    bits[0] = "skill";
    const skill = strArg(args, "name");
    if (skill) bits.push(clip(skill, 40));
  } else if (name === "ask_user") {
    bits[0] = "ask user";
    const items = askUserItems(args);
    if (items.length > 1) bits.push(`${items.length} questions`);
    else {
      const question = items[0]?.question || strArg(args, "question");
      if (question) bits.push(clip(question, 48));
    }
  } else if (name === CURSOR_CREATE_PLAN_TOOL) {
    bits[0] = "plan";
    const title = strArg(args, "name") || strArg(args, "overview");
    if (title) bits.push(clip(title, 48));
  } else if (name === CURSOR_SWITCH_MODE_TOOL) {
    bits[0] = "plan mode";
    const mode = strArg(args, "targetModeId") || strArg(args, "mode");
    if (mode) bits.push(clip(mode, 16));
  } else if (name === "grafana_query") {
    bits[0] = "grafana query";
    const query = strArg(args, "query") || strArg(args, "q") || strArg(args, "lucene");
    if (query) bits.push(clip(query, 40));
    const from = strArg(args, "from");
    if (from) bits.push(clip(from, 16));
  } else if (name === "confluence_search") {
    bits[0] = "confluence search";
    const query = strArg(args, "cql") || strArg(args, "query");
    if (query) bits.push(clip(query, 40));
  } else if (name === "confluence_get") {
    bits[0] = "confluence get";
    const page = strArg(args, "id") || strArg(args, "page") || strArg(args, "title");
    if (page) bits.push(clip(page, 24));
  } else if (name === "confluence_create") {
    bits[0] = "confluence create";
    const title = strArg(args, "title");
    if (title) bits.push(clip(title, 40));
  } else if (name === "confluence_update") {
    bits[0] = "confluence update";
    const page = strArg(args, "id") || strArg(args, "page") || strArg(args, "title");
    if (page) bits.push(clip(page, 24));
  } else if (name === "confluence_comment") {
    bits[0] = "confluence comment";
    const page = strArg(args, "id") || strArg(args, "page") || strArg(args, "title");
    if (page) bits.push(clip(page, 24));
  } else if (name.startsWith("linear_")) {
    bits[0] = name.replace(/_/g, " ");
    const detail =
      strArg(args, "issue") ||
      strArg(args, "key") ||
      strArg(args, "identifier") ||
      strArg(args, "query") ||
      strArg(args, "q") ||
      strArg(args, "title") ||
      strArg(args, "team");
    if (detail) bits.push(clip(detail, 40));
  } else if (name.startsWith("k8s_")) {
    bits[0] = name.replace(/^k8s_/, "k8s ").replace(/_/g, " ");
    const detail =
      strArg(args, "name") ||
      strArg(args, "pod") ||
      strArg(args, "kind") ||
      strArg(args, "resource") ||
      strArg(args, "namespace") ||
      strArg(args, "ns");
    if (detail) bits.push(clip(detail, 40));
  } else if (name.startsWith("incidentio_")) {
    bits[0] = name.replace(/^incidentio_/, "incident.io ").replace(/_/g, " ");
    const detail =
      strArg(args, "incident") ||
      strArg(args, "id") ||
      strArg(args, "query") ||
      strArg(args, "q") ||
      strArg(args, "name") ||
      strArg(args, "title");
    if (detail) bits.push(clip(detail, 40));
  } else if (name === "sentry_projects") {
    bits[0] = "sentry projects";
    const org = strArg(args, "org") || strArg(args, "organization");
    if (org) bits.push(clip(org, 24));
  } else if (name === "sentry_search") {
    bits[0] = "sentry search";
    const query = strArg(args, "query") || strArg(args, "q");
    if (query) bits.push(clip(query, 40));
  } else if (name === "sentry_get") {
    bits[0] = "sentry get";
    const issue = strArg(args, "issue") || strArg(args, "issue_id") || strArg(args, "key");
    if (issue) bits.push(clip(issue, 24));
  } else if (name === "sentry_events") {
    bits[0] = "sentry events";
    const issue = strArg(args, "issue") || strArg(args, "issue_id") || strArg(args, "key");
    if (issue) bits.push(clip(issue, 24));
  } else if (name === "sentry_update") {
    bits[0] = "sentry update";
    const issue = strArg(args, "issue") || strArg(args, "issue_id") || strArg(args, "key");
    if (issue) bits.push(clip(issue, 24));
    const status = strArg(args, "status");
    if (status) bits.push(clip(status, 16));
  } else if (name === "miro_list") {
    bits[0] = "miro list";
  } else if (name === "miro_get") {
    bits[0] = "miro get";
    const board = strArg(args, "board") || strArg(args, "board_id");
    if (board) bits.push(clip(board, 24));
  } else if (name === "miro_import") {
    bits[0] = "miro import";
    const board = strArg(args, "board") || strArg(args, "board_id");
    if (board) bits.push(clip(board, 24));
  } else if (name === "miro_export") {
    bits[0] = "miro export";
    const board = strArg(args, "board") || strArg(args, "board_id");
    if (board) bits.push(clip(board, 24));
  } else if (name.startsWith("figma_")) {
    bits[0] = name.replace(/_/g, " ");
    const file =
      strArg(args, "file") ||
      strArg(args, "url") ||
      strArg(args, "file_key") ||
      strArg(args, "key") ||
      strArg(args, "team") ||
      strArg(args, "project");
    if (file) bits.push(clip(file, 32));
  } else if (name === "aws_sts_identity") {
    bits[0] = "aws identity";
  } else if (name === "aws_iam_list") {
    bits[0] = "aws iam list";
    const resource = strArg(args, "resource") || "user";
    bits.push(clip(resource, 24));
  } else if (name === "aws_iam_get") {
    bits[0] = "aws iam get";
    const resource = strArg(args, "resource");
    const nameArg = strArg(args, "name") || strArg(args, "arn");
    if (resource) bits.push(clip(resource, 24));
    if (nameArg) bits.push(clip(nameArg, 32));
  } else if (name === "aws_iam_simulate") {
    bits[0] = "aws iam simulate";
    const principal = strArg(args, "principal");
    if (principal) bits.push(clip(principal, 40));
  } else if (name === "docker_swarm") {
    bits[0] = "docker swarm";
    const action = strArg(args, "action") || "status";
    bits.push(clip(action, 16));
    const service = strArg(args, "service");
    if (service) bits.push(clip(service, 24));
    const replicas = args.replicas;
    if (action === "scale" && (typeof replicas === "number" || typeof replicas === "string")) {
      bits.push(`×${String(replicas)}`);
    }
  } else if (name.startsWith("portainer_")) {
    bits[0] = name.replace(/^portainer_/, "portainer ").replace(/_/g, " ");
    const target =
      strArg(args, "container") ||
      strArg(args, "stack") ||
      strArg(args, "endpoint") ||
      strArg(args, "name") ||
      strArg(args, "id");
    if (target) bits.push(clip(target, 32));
    const action = strArg(args, "action");
    if (action) bits.push(clip(action, 12));
  } else if (name === "gmail_search") {
    bits[0] = "gmail search";
    const query = strArg(args, "q") || strArg(args, "query");
    if (query) bits.push(clip(query, 40));
  } else if (name === "gmail_get") {
    bits[0] = "gmail get";
    const id = strArg(args, "id") || strArg(args, "message");
    if (id) bits.push(clip(id, 24));
  } else if (name === "gmail_send") {
    bits[0] = "gmail send";
    const to = strArg(args, "to");
    if (to) bits.push(clip(to, 32));
    const subject = strArg(args, "subject");
    if (subject) bits.push(clip(subject, 32));
  } else if (name === "calendar_list") {
    bits[0] = args.calendars === true ? "calendar list" : "calendar events";
    const query = strArg(args, "q") || strArg(args, "query");
    if (query) bits.push(clip(query, 32));
  } else if (name === "calendar_get") {
    bits[0] = "calendar get";
    const event = strArg(args, "event") || strArg(args, "id");
    if (event) bits.push(clip(event, 24));
  } else if (name === "calendar_create") {
    bits[0] = "calendar create";
    const summary = strArg(args, "summary") || strArg(args, "title");
    if (summary) bits.push(clip(summary, 40));
  } else if (name === "drive_list") {
    bits[0] = "drive list";
    const query = strArg(args, "q") || strArg(args, "query");
    if (query) bits.push(clip(query, 40));
  } else if (name === "drive_get") {
    bits[0] = "drive get";
    const file = strArg(args, "file") || strArg(args, "id");
    if (file) bits.push(clip(file, 24));
  } else if (name === "drive_upload") {
    bits[0] = "drive upload";
    const filename = strArg(args, "name") || strArg(args, "filename");
    if (filename) bits.push(clip(filename, 32));
  } else if (name.startsWith("project_")) {
    bits[0] = name.replace(/^project_/, "project ").replace(/_/g, " ");
    const task = strArg(args, "task") || strArg(args, "path") || strArg(args, "member_id");
    if (task) bits.push(clip(task, 40));
  } else if (name === "mcp_list_tools") {
    bits[0] = "mcp list";
    const server = strArg(args, "server");
    if (server) bits.push(clip(server, 32));
  } else if (name === "mcp_get_tool_info") {
    bits[0] = "mcp info";
    const tool = strArg(args, "tool") || strArg(args, "server");
    if (tool) bits.push(clip(tool, 40));
  } else if (name === "mcp_call") {
    bits[0] = "mcp call";
    const target = [strArg(args, "server"), strArg(args, "tool")].filter(Boolean).join(" ");
    if (target) bits.push(clip(target, 48));
  } else if (name === "mcp_code") {
    bits[0] = "mcp code";
  } else if (name === "manage_integration_plugin") {
    bits[0] = "plugin";
    const action = strArg(args, "action") || strArg(args, "slug") || strArg(args, "name");
    if (action) bits.push(clip(action, 32));
  } else if (name.startsWith("plugin_")) {
    bits[0] = name.replace(/^plugin_/, "plugin ");
  } else {
    const path = strArg(args, "path") || strArg(args, "cwd");
    if (path) bits.push(clip(path, 48));
  }
  return bits;
}

export function toolChipLabel(
  name: string,
  args: Record<string, unknown> = {},
  result?: string,
  error?: string,
): string {
  return toolChipBits(name, args, result, error).join(" · ");
}

export function toolChipStatus(args: {
  approval?: string;
  finishedAt?: string;
  error?: string;
  result?: string;
}): string {
  if (args.approval === "needed" && !args.finishedAt) {
    return args.result ? "waiting for approval — review diff" : "waiting for approval";
  }
  if (args.error) return "failed";
  if (args.result) return "done";
  return "running";
}

export type ToolActivityCall = {
  name: string;
  arguments?: Record<string, unknown>;
  result?: string;
  error?: string;
  approval?: string;
  finishedAt?: string;
};

const ACTIVITY_VERB = /^(Read|Grepped|Ran|Wrote|Edited|Listed|Searched)\b/;
const ACTIVITY_LIST_ITEMS = 4;
const ACTIVITY_LIST_CHARS = 72;

/** Operator-facing one-liner. Technical command/path stay in `toolChipLabel`. */
export function toolActivityLabel(name: string, args: Record<string, unknown> = {}): string {
  name = canonicalToolName(name);
  args = toolArgsForChip(args);
  if (name === "file_read") {
    const range = lineRange(args);
    const paths = fileReadPaths(args);
    if (paths.length > 1) {
      return joinActivityLabels(paths.map((path) => readPathLabel(path, range))) || "Read files";
    }
    return readPathLabel(strArg(args, "path") || paths[0] || "", range);
  }
  if (name === "canvas_write") {
    const title = strArg(args, "title");
    return title ? `Built canvas ${clip(title, 48)}` : "Built a canvas";
  }
  if (name === "canvas_read") return "Read the canvas";
  if (name === "file_write")
    return ["Wrote", leaf(strArg(args, "path"))].filter(Boolean).join(" ") || "Wrote a file";
  if (name === "file_list") return ["Listed", leaf(strArg(args, "path")) || "files"].join(" ");
  if (name === "grep")
    return ["Grepped", clip(strArg(args, "pattern"), 40)].filter(Boolean).join(" ") || "Grepped";
  if (name === "glob")
    return (
      ["Searched", clip(strArg(args, "pattern"), 48)].filter(Boolean).join(" ") || "Searched files"
    );
  if (name === "apply_patch") return ["Edited", leaf(strArg(args, "path")) || "files"].join(" ");
  if (name === "playwright") return "Playwright-tested the page";
  if (name === "exec" || name === "powershell") return friendlyExec(args);
  if (name === "websearch") {
    const query = strArg(args, "query");
    return query ? `Searched the web for ${clip(query, 40)}` : "Searched the web";
  }
  if (name === "repo_map")
    return strArg(args, "query") || strArg(args, "path")
      ? `Mapped ${clip(strArg(args, "query") || strArg(args, "path"), 40)}`
      : "Mapped the repo";
  if (name === "scratchpad") return "Updated notes";
  if (name === "orient") return "Oriented on the brain";
  if (name === "find_entity") {
    const q = strArg(args, "q");
    return q ? `Looked up ${clip(q, 40)} in the brain` : "Looked up an entity";
  }
  if (name === "get_entity") {
    const id = strArg(args, "id");
    return id ? `Read ${clip(id, 40)}` : "Read an entity";
  }
  if (name === "search_knowledge") {
    const q = strArg(args, "q");
    return q ? `Searched the brain for ${clip(q, 40)}` : "Searched the brain";
  }
  if (name === "remember") {
    const action = strArg(args, "action");
    const text = strArg(args, "text");
    if (action === "forget") return text ? `Forgot ${clip(text, 40)}` : "Forgot a saved fact";
    if (action === "clear") return "Cleared saved facts";
    if (action === "list") return "Listed saved facts";
    return text ? `Remembered ${clip(text, 40)}` : "Saved a fact";
  }
  if (name === "subscribe") {
    const action = strArg(args, "action");
    if (action === "list") return "Listed subscriptions";
    const kind = strArg(args, "kind");
    const title = strArg(args, "title") || strArg(args, "name") || strArg(args, "channelId");
    if (kind && title) return `Subscribed ${clip(kind.replace(/_/g, " "), 24)} ${clip(title, 32)}`;
    if (kind) return `Subscribed ${clip(kind.replace(/_/g, " "), 32)}`;
    return "Subscribed";
  }
  if (name === "unsubscribe") {
    const id = strArg(args, "id");
    return id ? `Unsubscribed ${clip(id, 24)}` : "Unsubscribed";
  }
  if (name === "task_list") return "Updated the task list";
  if (name === "spawn_agent") {
    const task = strArg(args, "task");
    return task ? `Asked a sub-agent to ${clip(task, 40)}` : "Asked a sub-agent";
  }
  if (name === "read_skill") {
    const skill = strArg(args, "name");
    return skill ? `Loaded skill /${clip(skill, 32)}` : "Loaded a skill";
  }
  if (name === "ask_user") {
    const items = askUserItems(args);
    if (items.length > 1) return `Asked ${items.length} questions`;
    const question = items[0]?.question || strArg(args, "question");
    return question ? `Asked ${clip(question, 40)}` : "Asked the operator";
  }
  if (name === "mcp_list_tools") return "Listed MCP tools";
  if (name === "mcp_get_tool_info") return "Looked up an MCP tool";
  if (name === "mcp_call") {
    const tool = strArg(args, "tool") || strArg(args, "server");
    return tool ? `Called MCP ${clip(tool, 32)}` : "Called MCP";
  }
  if (name === "mcp_code") return "Ran MCP code";
  if (name === "manage_integration_plugin") {
    const action = strArg(args, "action");
    const label = strArg(args, "name") || strArg(args, "slug");
    if (action && label) return `${titleName(action)} plugin ${clip(label, 24)}`;
    if (action) return `${titleName(action)} a plugin`;
    return "Updated an integration plugin";
  }
  if (name.startsWith("plugin_")) return titleName(name.replace(/^plugin_/, ""));
  if (name === "git_pr_loadpath") {
    const number = args.pull_number;
    return number != null && String(number).trim()
      ? `Traced load path #${String(number).trim()}`
      : "Traced the load path";
  }
  if (name === "git_diff") return "Git diff";
  if (name === "git_status") return "Git status";
  if (name === "git_log") return "Git log";
  if (name === "git_show") return "Git show";
  if (name === "git_commit") return "Git commit";
  if (name === "git_push") return "Git push";
  if (name === "git_pr") return "Opened a pull request";
  if (name === "screenshot") return "Screenshot";
  if (name === "window_focus")
    return strArg(args, "title")
      ? `Focused ${clip(strArg(args, "title"), 32)}`
      : "Focused a window";
  if (name === "browser_trace") return "DevTools trace";
  if (name.startsWith("mcp_")) return titleName(name.replace(/^mcp_/, ""));
  return titleName(name);
}

const COLLAPSE_KINDS = new Set(["read", "grep", "run", "write", "edit", "search", "list"]);
const NAME_JOIN_MAX = 4;

/** Reads, searches, commands, and other inspect tools fold into one Cursor-style summary. */
export function isFoldableToolActivity(call: ToolActivityCall): boolean {
  if (call.approval === "needed" && !call.finishedAt) return false;
  const name = canonicalToolName(call.name);
  if (
    name === "spawn_agent" ||
    name === "ask_user" ||
    name === "git_pr" ||
    name === "slack_post" ||
    name === "brain_brief" ||
    name === "canvas_write"
  ) {
    return false;
  }
  const kind = activityKind(name, call.arguments ?? {});
  return kind !== "edit" && kind !== "write";
}

/** Split a turn's tools into activity rows. Consecutive foldable calls share one expandable summary. */
export function toolActivityGroups<T extends ToolActivityCall>(calls: T[]): T[][] {
  if (!calls.length) return [];
  const groups: T[][] = [];
  let batch: T[] = [];
  const flush = () => {
    if (!batch.length) return;
    groups.push(batch);
    batch = [];
  };
  for (const call of calls) {
    if (isFoldableToolActivity(call)) {
      batch.push(call);
      continue;
    }
    flush();
    groups.push([call]);
  }
  flush();
  return groups;
}

export function toolActivitySummary(calls: ToolActivityCall[]): string {
  if (!calls.length) return "Working";
  if (calls.length === 1) return toolActivityLabel(calls[0]!.name, calls[0]!.arguments ?? {});
  const units = activityUnits(calls);
  const kinds = new Set(units.map((unit) => unit.kind));
  const kind = [...kinds][0];
  const useNames =
    kinds.size === 1 &&
    Boolean(kind && COLLAPSE_KINDS.has(kind)) &&
    units.length < NAME_JOIN_MAX &&
    !units.every((unit) => isCountLabel(unit.label));
  if (useNames) {
    return joinActivityLabels(units.map((unit) => unit.label)) || cursorActivitySummary(calls);
  }
  return cursorActivitySummary(calls);
}

export function toolActivityStatus(calls: ToolActivityCall[]): string | undefined {
  if (calls.some((call) => call.approval === "needed" && !call.finishedAt))
    return "waiting for approval";
  if (calls.some((call) => !call.finishedAt && !call.error)) return "running";
  if (calls.length > 0 && calls.every((call) => call.error)) return "failed";
  return undefined;
}

export function toolActivityOpen(calls: ToolActivityCall[]): boolean {
  return calls.some((call) => call.approval === "needed" && !call.finishedAt);
}

function leaf(path: string): string {
  if (!path) return "";
  const cleaned = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function numArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value)))
    return Number(value);
  return undefined;
}

function lineRange(args: Record<string, unknown>): string {
  const offset = numArg(args, "offset");
  const limit = numArg(args, "limit");
  if (offset != null && limit != null) return `L${offset}-${offset + limit - 1}`;
  if (offset != null) return `L${offset}+`;
  return "";
}

function readPathLabel(path: string, range = ""): string {
  return ["Read", leaf(path), range].filter(Boolean).join(" ");
}

function titleName(name: string): string {
  const trimmed = name.replace(/_/g, " ").trim();
  if (!trimmed) return "Tool";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function execCommands(args: Record<string, unknown>): string[] {
  if (Array.isArray(args.commands)) {
    return args.commands.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
  }
  const command = strArg(args, "command");
  return command ? [command] : [];
}

function stripCd(command: string): string {
  return command
    .replace(/^(?:cd\s+(?:'[^']+'|"[^"]+"|\S+)\s+&&\s+)+/i, "")
    .replace(
      /^(?:(?:Set-Location|Push-Location|cd)\s+(?:-LiteralPath\s+)?(?:'[^']+'|"[^"]+"|\S+)\s*;\s*)+/i,
      "",
    )
    .trim();
}

function unwrapShellCommand(raw: string): string {
  let command = raw.trim();
  if (!command) return command;

  // Codex CLI on Windows reports the full PowerShell launcher command. Keep the
  // useful command inside -Command instead of showing the launcher path.
  if (/powershell(?:\.exe)?\b/i.test(command)) {
    const match = command.match(/\s-(?:Command|c)\s+([\s\S]+)$/i);
    if (match?.[1]) command = match[1].trim();
  } else if (/\bcmd(?:\.exe)?\b/i.test(command)) {
    const match = command.match(/\s\/c\s+([\s\S]+)$/i);
    if (match?.[1]) command = match[1].trim();
  } else if (/^["']?(?:bash|sh)(?:\.exe)?["']?\b/i.test(command)) {
    const match = command.match(/\s-(?:c|lc)\s+([\s\S]+)$/i);
    if (match?.[1]) command = match[1].trim();
  }

  if (
    (command.startsWith('"') && command.endsWith('"')) ||
    (command.startsWith("'") && command.endsWith("'"))
  ) {
    command = command.slice(1, -1).trim();
  }
  if (command.startsWith("& {") && command.endsWith("}")) {
    command = command.slice(3, -1).trim();
  }
  return command.replace(/^\$ErrorActionPreference\s*=\s*['"][^'"]+['"]\s*;\s*/i, "").trim();
}

function firstToken(text: string): string {
  const quoted = text.match(/^(['"])([\s\S]*?)\1/);
  if (quoted?.[2] != null) return quoted[2];
  return (text.split(/\s+/)[0] ?? "").replace(/^['"]|['"]$/g, "");
}

function stripLeadingFlags(text: string): string {
  return text.replace(/^(?:-[A-Za-z0-9]+\s+)+/, "").trim();
}

function friendlyExec(args: Record<string, unknown>): string {
  const cmds = execCommands(args);
  if (!cmds.length) return "Ran a command";
  if (cmds.length === 1) return friendlyExecOne(cmds[0]!);
  return joinActivityLabels(cmds.map(friendlyExecOne)) || `Ran ${cmds.length} commands`;
}

function friendlyExecOne(raw: string): string {
  const cmd = stripCd(unwrapShellCommand(raw));
  if (!cmd) return "Ran a command";

  const grep = cmd.match(/^(?:git\s+)?(?:grep|rg)\b\s*(.*)$/i);
  if (grep) {
    const pattern = firstToken(stripLeadingFlags(grep[1] ?? ""));
    return pattern ? `Grepped ${clip(pattern, 40)}` : "Grepped";
  }

  const sed = cmd.match(/^sed\s+-n\s+['"]?(\d+),(\d+)p['"]?\s+(\S+)/i);
  if (sed) return `Read ${leaf(sed[3] ?? "")} L${sed[1]}-${sed[2]}`;

  const inspect = cmd.match(/^(?:cat|head|tail)(?:\s+(?:-n=?|--lines=)\s*\d+|\s+-\d+)*\s+(\S+)$/i);
  if (inspect?.[1] && !inspect[1].startsWith("-")) return `Read ${leaf(inspect[1])}`;

  if (/^git\s+diff\b/.test(cmd)) return "Git diff";
  if (/^git\s+status\b/.test(cmd)) return "Git status";
  if (/^git\s+log\b/.test(cmd)) return "Git log";
  if (/^git\s+show\b/.test(cmd)) {
    const spec = cmd
      .split(/\s+/)
      .slice(2)
      .find((part) => part.includes("/") || part.includes(":"));
    const file = spec?.includes(":") ? spec.slice(spec.indexOf(":") + 1) : spec;
    return file ? `Read ${leaf(file)}` : "Git show";
  }

  const psGrep = cmd.match(/^(?:Select-String|sls)\b[\s\S]*?-Pattern\s+("[^"]*"|'[^']*'|\S+)/i);
  if (psGrep?.[1]) return `Grepped ${clip(unquote(psGrep[1]), 40)}`;

  const psRead = cmd.match(
    /^(?:Get-Content|gc)\b[\s\S]*?-(?:Path|LiteralPath)\s+("[^"]*"|'[^']*'|\S+)/i,
  );
  if (psRead?.[1]) return `Read ${leaf(unquote(psRead[1]))}`;

  const psList = cmd.match(/^(?:Get-ChildItem|gci|dir)\b(?:\s+[^;]*)?/i);
  if (psList) return "Listed files";

  return `Ran ${clip(cmd, 48)}`;
}

function unquote(value: string): string {
  return value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
    ? value.slice(1, -1)
    : value;
}

function callActivityLabels(call: ToolActivityCall): string[] {
  const args = call.arguments ?? {};
  if (call.name === "exec" || call.name === "powershell") {
    const cmds = execCommands(args);
    if (cmds.length > 1) return cmds.map(friendlyExecOne);
  }
  if (call.name === "file_read") {
    const paths = fileReadPaths(args);
    if (paths.length > 1) {
      const range = lineRange(args);
      return paths.map((path) => readPathLabel(path, range));
    }
  }
  return [toolActivityLabel(call.name, args)];
}

function prepareJoinLabel(label: string): string {
  if (/^Git /.test(label)) return `Ran git ${label.slice(4).toLowerCase()}`;
  return label;
}

function joinActivityLabels(labels: string[]): string {
  const unique: string[] = [];
  for (const label of labels) {
    const next = prepareJoinLabel(label);
    if (next && !unique.includes(next)) unique.push(next);
  }
  if (!unique.length) return "";
  if (unique.length === 1) return unique[0]!;

  const verbs = unique.map((label) => label.match(ACTIVITY_VERB)?.[1]);
  const verb = verbs.every((item) => item && item === verbs[0]) ? verbs[0] : undefined;
  const items = unique.map((label) => (verb ? label.slice(verb.length).trim() : label));

  let count = Math.min(ACTIVITY_LIST_ITEMS, items.length);
  while (count >= 1) {
    const more = items.length - count;
    const text = formatActivityList(verb, items.slice(0, count), more);
    if (count === 1 || text.length <= ACTIVITY_LIST_CHARS) {
      return text.length <= ACTIVITY_LIST_CHARS ? text : clip(text, ACTIVITY_LIST_CHARS);
    }
    count--;
  }
  return unique[0]!;
}

function formatActivityList(verb: string | undefined, items: string[], more: number): string {
  const list = items.join(", ");
  const head = verb ? `${verb} ${list}` : list;
  return more > 0 ? `${head} + ${more} more` : head;
}

function activityUnits(calls: ToolActivityCall[]): { kind: string; label: string }[] {
  return calls.flatMap((call) =>
    callActivityLabels(call).map((label) => ({ kind: kindFromLabel(label), label })),
  );
}

function cursorActivitySummary(calls: ToolActivityCall[]): string {
  const units = activityUnits(calls);
  let files = 0;
  let searches = 0;
  let tools = 0;
  let commands = 0;
  let edits = 0;
  for (const unit of units) {
    if (unit.kind === "read" || unit.kind === "list") files += 1;
    else if (unit.kind === "grep" || unit.kind === "search") searches += 1;
    else if (unit.kind === "run") commands += 1;
    else if (unit.kind === "write" || unit.kind === "edit") edits += 1;
    else tools += 1;
  }
  const running = calls.some((call) => !call.finishedAt);
  const parts: string[] = [];
  if (files) parts.push(countWord(files, "file", "files"));
  if (edits) parts.push(edits === 1 ? "edited 1 file" : `edited ${edits} files`);
  if (searches) parts.push(countWord(searches, "search", "searches"));
  if (tools) parts.push(countWord(tools, "tool", "tools"));
  if (commands) parts.push(commands === 1 ? "ran 1 command" : `ran ${commands} commands`);
  if (!parts.length) return running ? "Working" : "Done";
  if (!files && !searches && !tools) {
    if (!edits) return commands === 1 ? "Ran 1 command" : `Ran ${commands} commands`;
    if (!commands) return edits === 1 ? "Edited 1 file" : `Edited ${edits} files`;
  }
  return `${running ? "Exploring" : "Explored"} ${parts.join(", ")}`;
}

function countWord(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

function activityKind(name: string, args: Record<string, unknown>): string {
  return kindFromLabel(toolActivityLabel(name, args));
}

function kindFromLabel(label: string): string {
  const prepared = prepareJoinLabel(label);
  if (prepared.startsWith("Read ")) return "read";
  if (prepared.startsWith("Grepped")) return "grep";
  if (prepared.startsWith("Ran ")) return "run";
  if (prepared.startsWith("Wrote ")) return "write";
  if (prepared.startsWith("Edited ")) return "edit";
  if (prepared.startsWith("Searched")) return "search";
  if (prepared.startsWith("Listed ")) return "list";
  return "other";
}

function isCountLabel(label: string): boolean {
  return /^(Ran \d+ commands|Read \d+ files|Grepped \d+ patterns|Wrote \d+ files|Edited \d+ files|Searched \d+ patterns|Listed \d+ paths)$/.test(
    label,
  );
}
