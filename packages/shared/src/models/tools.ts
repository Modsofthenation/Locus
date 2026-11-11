import type { AgentRuntime, GuestOs } from "./vm.js";
import { isLinux, isWindows } from "./vm.js";
import { policyToolNeedsApproval, type ApprovalPolicy } from "./approval.js";
import {
  INTEGRATION_TOOL_NAMES,
  integrationReady,
  isIntegrationToolName,
  type IntegrationAccount,
} from "./integration.js";
import { AGENT_CANVAS_TOOLS, isAgentCanvasToolName } from "./agentCanvas.js";
import { BOARD_TOOL_NAMES } from "./board.js";
import { PROJECT_TOOL_NAMES } from "./project.js";
import { isRuntimeToolName } from "./workingState.js";
import {
  installCommandsNeedApproval,
  packageJsonLifecycleRisk,
  patchTouchesLifecycleScripts,
} from "../supplyChain.js";
import {
  TOOL_SCHEMAS,
  RECORD_SCREEN_MODES,
  type JsonSchema,
  type RecordScreenMode,
} from "./toolSchemas.js";

export type ToolOs = GuestOs;

export type ComputerUseToolName =
  | "exec"
  | "screenshot"
  | "record_screen"
  | "mouse_move"
  | "mouse_click"
  | "mouse_drag"
  | "mouse_scroll"
  | "key"
  | "type_text"
  | "clipboard_get"
  | "clipboard_set"
  | "window_list"
  | "window_focus"
  | "file_read"
  | "file_write"
  | "file_list"
  | "canvas_write"
  | "canvas_read"
  | "grep"
  | "glob"
  | "apply_patch"
  | "git_clone"
  | "git_fetch"
  | "git_status"
  | "git_diff"
  | "git_log"
  | "git_commit"
  | "git_branch"
  | "git_push"
  | "git_pr"
  | "git_pr_review"
  | "git_pr_list"
  | "git_pr_get"
  | "git_pr_loadpath"
  | "git_pr_comment"
  | "git_pr_checks"
  | "git_pr_merge"
  | "git_issue_list"
  | "git_issue_get"
  | "git_issue_comment"
  | "git_stash"
  | "git_revert"
  | "jira_search"
  | "jira_get"
  | "jira_comment"
  | "jira_create"
  | "jira_update"
  | "jira_transition"
  | "confluence_search"
  | "confluence_get"
  | "confluence_create"
  | "confluence_update"
  | "confluence_comment"
  | "linear_search"
  | "linear_get"
  | "linear_comment"
  | "linear_create"
  | "linear_update"
  | "slack_post"
  | "slack_upload"
  | "slack_channels"
  | "slack_history"
  | "slack_replies"
  | "grafana_search"
  | "grafana_get"
  | "grafana_query"
  | "sentry_projects"
  | "sentry_search"
  | "sentry_get"
  | "sentry_events"
  | "sentry_update"
  | "miro_list"
  | "miro_get"
  | "miro_import"
  | "miro_export"
  | "figma_list"
  | "figma_get"
  | "figma_images"
  | "figma_comment"
  | "incidentio_search"
  | "incidentio_get"
  | "incidentio_comment"
  | "incidentio_create"
  | "incidentio_update"
  | "aws_sts_identity"
  | "aws_iam_list"
  | "aws_iam_get"
  | "aws_iam_simulate"
  | "portainer_endpoints"
  | "portainer_containers"
  | "portainer_inspect"
  | "portainer_logs"
  | "portainer_stacks"
  | "portainer_container_action"
  | "portainer_stack_action"
  | "gmail_search"
  | "gmail_get"
  | "gmail_send"
  | "calendar_list"
  | "calendar_get"
  | "calendar_create"
  | "drive_list"
  | "drive_get"
  | "drive_upload"
  | "k8s_list"
  | "k8s_get"
  | "k8s_logs"
  | "k8s_events"
  | "k8s_apply"
  | "k8s_delete"
  | "k8s_scale"
  | "powershell"
  | "uia_tree"
  | "a11y_tree"
  | "start_process"
  | "preview"
  | "playwright"
  | "browser_tabs"
  | "browser_navigate"
  | "browser_snapshot"
  | "browser_click"
  | "browser_type"
  | "browser_console"
  | "browser_network"
  | "browser_pdf"
  | "browser_trace"
  | "browser_download"
  | "board_list"
  | "board_get"
  | "board_upsert"
  | "board_delete"
  | "board_comment"
  | "board_cluster"
  | "project_get"
  | "project_spawn"
  | "project_steer"
  | "project_stop"
  | "project_replace"
  | "team_directory"
  | "team_handoff"
  | "project_collect"
  | "project_propose_merge"
  | "project_propose_rule"
  | "project_context_list"
  | "project_context_read"
  | "project_context_write"
  | "project_context_delete"
  | "team_roster"
  | "team_peer_status"
  | "team_add_teammate"
  | "team_message";

export { RECORD_SCREEN_MODES, type RecordScreenMode } from "./toolSchemas.js";

export function isRecordScreenMode(value: string): value is RecordScreenMode {
  return (RECORD_SCREEN_MODES as readonly string[]).includes(value);
}

export function sanitizeRecordingName(raw?: string): string {
  return sanitizeArtifactStem(raw, "recording");
}

export function sanitizeArtifactStem(raw?: string, fallback = "artifact"): string {
  const trimmed = (raw ?? "").trim();
  const leaf = trimmed.replace(/\\/g, "/").split("/").pop() ?? "";
  const withoutExt = leaf.replace(/\.[A-Za-z0-9]{1,8}$/i, "");
  const cleaned = withoutExt
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

export const BROWSER_ARTIFACT_KINDS = ["pdf", "trace", "download"] as const;
export type BrowserArtifactKind = (typeof BROWSER_ARTIFACT_KINDS)[number];

export function isBrowserArtifactKind(value: unknown): value is BrowserArtifactKind {
  return value === "pdf" || value === "trace" || value === "download";
}

export interface ToolSpec {
  name: ComputerUseToolName;
  description: string;
  os: ToolOs[];
}

const LINUX_TOOL_OS: ToolOs[] = ["ubuntu", "debian", "omarchy"];
const WINDOWS_TOOL_OS: ToolOs[] = ["windows-11", "windows-10"];
const ALL_TOOL_OS: ToolOs[] = [...LINUX_TOOL_OS, ...WINDOWS_TOOL_OS];

export const COMPUTER_USE_TOOLS: ToolSpec[] = [
  {
    name: "exec",
    description:
      "Run a shell command in the guest and return stdout, stderr, and exit code. Optional cwd and timeout_ms. For independent reads (git show, git grep, cat), pass commands[] in one call instead of one exec per turn. Do not put heredocs (<<EOF) in commands[]; use command, or file_write a script then exec it.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "screenshot",
    description:
      "Capture the current graphical desktop as a PNG. In Docker this is the headed Chromium window.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "record_screen",
    description:
      "Control screen recording of the guest desktop for GUI walkthroughs. Modes: START_RECORDING, SAVE_RECORDING, DISCARD_RECORDING. For SAVE_RECORDING, pass save_as_filename as a short name (no slashes or extension).",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "mouse_move",
    description: "Move the pointer to an absolute screen coordinate.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "mouse_click",
    description:
      "Click a mouse button at the current or given coordinate. Pass count=2 for a double-click.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "mouse_drag",
    description:
      "Drag the pointer from (x1,y1) to (x2,y2). Omit the start to drag from the current position.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "mouse_scroll",
    description:
      "Scroll the mouse wheel at the current or given coordinate. Positive delta scrolls up, negative scrolls down. Set axis to horizontal for sideways scroll.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "key",
    description: "Press a key or key combination (e.g. ctrl+c, win+r).",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "type_text",
    description: "Type unicode text into the focused control.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "clipboard_get",
    description: "Read the guest clipboard.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "clipboard_set",
    description: "Write the guest clipboard.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "window_list",
    description: "List top-level windows with titles and bounds.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "window_focus",
    description: "Focus a window by title or id.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "file_read",
    description:
      "Read a file from the guest filesystem. Optional 1-based offset and limit (lines). Pass paths[] to read up to 8 files in one call instead of one file_read per turn. If a read fails or the file is large, retry with offset/limit rather than treating it as missing.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "file_write",
    description: "Write a file on the guest filesystem.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "canvas_write",
    description:
      "Write a durable HTML canvas the operator opens beside this chat (a report, table, or dashboard). Not for code fixes or repo files. Pass title and html — one self-contained document, inline CSS and script, no fetch and no remote URLs. Optional id updates that canvas; omit id to create one. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "canvas_read",
    description:
      "Read a canvas this chat already wrote. Optional id (defaults to the latest). Returns the html so you can canvas_write a full replacement. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "file_list",
    description: "List a directory on the guest filesystem.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "grep",
    description:
      "Search file contents in the guest workspace with ripgrep (falls back to grep). Honors .gitignore and .locusignore. Returns 3 lines of surrounding context by default so you often do not need a follow-up file_read. Optional path, glob, and context (0–8).",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "glob",
    description:
      "Find files by glob pattern on the guest (e.g. **/*.ts). Uses ripgrep --files when rg is available.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "apply_patch",
    description:
      "Apply a unified diff in the guest workspace (---/+++/@@ hunks or *** Begin Patch). @@ may omit line numbers. Context lines start with a space. Do not send a prose description.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_clone",
    description:
      "Clone a GitHub, GitLab, or Bitbucket repository into the guest over HTTPS using the forge token (no SSH key required). Optional dest (defaults to the workspace root, or a per-repo dest when several repos are attached). Optional ref fetches that remote branch or tag. Optional pull / pull_number fetches the forge PR/MR head when the branch is on a fork. Skip this if the workspace is already a checkout.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_fetch",
    description:
      "Fetch a branch, tag, SHA, or pull request into an existing guest checkout using the forge token over HTTPS. Optional pull number for PR heads from forks.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_status",
    description:
      "Return git status for the guest workspace. Optional path for a non-primary checkout in a multi-repo workspace.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_diff",
    description: "Show git diff for the guest workspace. Set staged=true for the index.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_log",
    description: "Show recent git commits in the guest workspace.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_commit",
    description: "Stage all changes and commit in the guest workspace.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_branch",
    description: "Create or switch a git branch in the guest workspace.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_push",
    description:
      "Push the current branch to origin using the forge token. Optional path for a non-primary checkout in a multi-repo workspace. Waits for operator approval in chat.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_pr",
    description:
      "Open a GitHub, GitLab, or Bitbucket pull request for the guest workspace branch. Optional path for a non-primary checkout in a multi-repo workspace. Optional draft=true. Waits for operator approval in chat.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_pr_review",
    description:
      "Post a review on the open pull request for this branch. Pass body and optional event=COMMENT|APPROVE|REQUEST_CHANGES. GitHub rejects APPROVE/REQUEST_CHANGES on the author's own PR — this tool posts COMMENT in that case and still records the requested event for the verdict. Post inline notes with git_pr_comment first — this tool does not take comments[]. Waits for operator approval.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_pr_list",
    description:
      "List pull requests for the repository attached to this agent. Host-side; no guest required.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_pr_get",
    description:
      'Fetch a pull request (title, body, clipped file diffs, checks, comments). Optional pull_number and include[] (summary|files|comments|checks). When comments and the load path are already in the user message, pass include=["files"] and omit paths[] unless a prior files response listed paths without patches. Review these patches before reading whole files. Do not use a third-party verbosity=full dump.',
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_pr_loadpath",
    description:
      "Architecture-aware load path for a pull request: how the diff reaches tests, APIs, UI, jobs, and permissions, plus merge risk and operator notes. Skip if the user message already includes the load path brief. Optional pull_number. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_pr_comment",
    description:
      "Post a conversation or inline comment on a pull request. Pass body, optional path/line/side, optional pull_number. Waits for operator approval.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_pr_checks",
    description:
      "List check runs / pipeline status for the open pull request. Skip if git_pr_get already returned Checks or checks are in the user message. Optional pull_number. Host-side (not a third-party pipeline MCP).",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_pr_merge",
    description: "Merge the open pull request for this branch. Waits for operator approval.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_issue_list",
    description:
      "List GitHub, GitLab, or Bitbucket issues for the repository attached to this agent. Host-side; no guest required. Does not include pull requests.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_issue_get",
    description:
      "Fetch an issue (title, body, comments). Pass issue_number. Optional include[] (summary|comments). Host-side; no guest required.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_issue_comment",
    description:
      "Post a comment on a GitHub, GitLab, or Bitbucket issue. Pass body and issue_number. Waits for operator approval.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "jira_search",
    description:
      "Search Jira issues (JQL). Host-side first-party integration; tokens stay in Settings.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "jira_get",
    description: "Fetch a Jira issue by key (e.g. OPS-12). Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "jira_comment",
    description:
      "Add a comment on a Jira issue. Pass issue key and body. Waits for operator approval.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "jira_create",
    description:
      "Create a Jira issue. Pass project key, summary, and optional description, issuetype, and parent/epic. Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "jira_update",
    description:
      "Update existing Jira issue(s): parent/Epic Link, summary, description, labels, or extra fields. Pass issue or issues[] plus parent. Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "jira_transition",
    description:
      "Transition a Jira issue (for example to In Progress or Done). Pass issue key and transition name or id. Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "confluence_search",
    description:
      "Search Confluence pages (CQL). Host-side first-party integration; tokens stay in Settings.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "confluence_get",
    description:
      "Fetch a Confluence page by id, or by title plus space key. Host-side. Returns storage HTML.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "confluence_create",
    description:
      "Create a Confluence page. Pass space key, title, and body (storage HTML or plain text). Optional parent page id. Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "confluence_update",
    description:
      "Update a Confluence page title and/or body. Pass id (or title plus space) and the new fields. Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "confluence_comment",
    description:
      "Add a comment on a Confluence page. Pass page id (or title plus space) and body. Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "linear_search",
    description:
      "Search Linear issues. Optional query, team key, state, or assignee (me). Host-side first-party integration; tokens stay in Settings.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "linear_get",
    description: "Fetch a Linear issue by identifier (e.g. ENG-12). Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "linear_comment",
    description:
      "Add a comment on a Linear issue. Pass issue identifier and body. Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "linear_create",
    description:
      "Create a Linear issue. Pass team key, title, and optional description, state, assignee, parent, labels, priority. Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "linear_update",
    description:
      "Update a Linear issue: title, description, state, assignee, parent, labels, or priority. Pass issue identifier. Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "slack_post",
    description:
      'Post a Slack message. Default is the signed-in operator. Pass as="bot" to post as the Locus app. Pass channel and text. Waits for operator approval. Host-side.',
    os: [...ALL_TOOL_OS],
  },
  {
    name: "slack_upload",
    description:
      'Upload a file to Slack. Default is the signed-in operator. Pass as="bot" to upload as the Locus app. Pass channel, filename, and content or bytes_base64. Waits for operator approval. Host-side. Max 20 MiB.',
    os: [...ALL_TOOL_OS],
  },
  {
    name: "slack_channels",
    description: "List Slack channels and DMs the signed-in operator can see. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "slack_history",
    description: "Read recent Slack messages in a channel the operator can open. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "slack_replies",
    description: "Read a Slack thread. Pass channel and thread_ts. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "grafana_search",
    description: "Search Grafana dashboards. Host-side first-party integration.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "grafana_get",
    description: "Fetch a Grafana dashboard by uid. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "grafana_query",
    description:
      "Query Grafana Elasticsearch logs with a Lucene query taken from the operator prompt (Grafana 8.5+). Do not invent a product-specific filter template. Optional from/to (default now-1h to now), mode (count|logs|both), limit, datasource, explore_url_only. Returns JSON that always includes lucene and explore_url. Large results are offloaded to disk — grep that file; do not curl Grafana. Host-side; API key in Settings → Integrations.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "sentry_projects",
    description:
      "List Sentry organizations and projects the token can see. Host-side first-party integration; auth token stays in Settings.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "sentry_search",
    description:
      "Search Sentry issues. Pass a Sentry search query from the operator prompt (is:unresolved, level:error, …). Optional org, project, statsPeriod, limit, sort. Host-side; do not curl Sentry.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "sentry_get",
    description:
      "Fetch a Sentry issue by id, short id (WEB-12), or permalink. Includes the latest event stack by default. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "sentry_events",
    description:
      "List events for a Sentry issue, or fetch latest / a specific event with stack frames. Pass issue and optional event, latest, or limit. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "sentry_update",
    description:
      "Update a Sentry issue: status (resolved, ignored, unresolved) and optional assignedTo. Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "miro_list",
    description: "List Miro boards the token can see. Host-side first-party integration.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "miro_get",
    description:
      "Read a Miro board as context. Pass board (Miro board id). Returns a compact object list. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "miro_import",
    description:
      "Copy a Miro board into Locus objects. Pass board (Miro board id). Then board_upsert the returned objects onto the current canvas. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "miro_export",
    description:
      "Publish Locus canvas objects to Miro. Pass objects[] from board_get, plus board (existing id) or name (create a board). Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "figma_list",
    description:
      "List Figma projects and files. Optional team (team id or figma.com/files/team/… URL) or project. Without those, returns the signed-in user. Host-side first-party integration.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "figma_get",
    description:
      "Read a Figma file or node as a compact tree (pages, frames, text, fills). Pass file (file key or figma.com/design/… URL). Optional node / ids and depth. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "figma_images",
    description:
      "Render Figma nodes to PNG/JPG/SVG/PDF URLs. Pass file (key or URL) and ids (comma-separated node ids, 1:2 or 1-2). Optional format and scale. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "figma_comment",
    description:
      "Post a comment on a Figma file. Pass file (key or URL), message, optional node. Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "incidentio_search",
    description:
      "List or filter incident.io incidents. Optional query (name, summary, or INC-123), status_category (live/active, triage, closed, …), status, severity, page_size. Host-side first-party integration; tokens stay in Settings.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "incidentio_get",
    description: "Fetch an incident.io incident by id or reference (INC-123). Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "incidentio_comment",
    description:
      "Post an incident.io update (message) on an incident. Pass incident id or INC-123 and body. Optional status or severity. Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "incidentio_create",
    description:
      "Create an incident.io incident. Pass name, optional summary, status, severity, and visibility (public|private, default public). Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "incidentio_update",
    description:
      "Edit an incident.io incident: name, summary, status, or severity. Pass incident id or INC-123. Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "aws_sts_identity",
    description:
      "Return the AWS caller identity (account, ARN, user id) for the Settings → Integrations AWS IAM credentials or instance metadata. Host-side; keys stay in the vault.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "aws_iam_list",
    description:
      "List IAM users, roles, or policies. Pass resource=user|role|policy. Optional path_prefix and marker. Host-side AWS IAM integration.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "aws_iam_get",
    description:
      "Fetch an IAM user, role, managed policy, or attached role policies. Pass resource=user|role|policy|attached_role_policies and name or arn. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "aws_iam_simulate",
    description:
      "Simulate whether a principal can perform IAM actions (SimulatePrincipalPolicy). Pass principal ARN and actions. Optional resources. Host-side; does not change IAM.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "portainer_endpoints",
    description:
      "List Portainer environments (endpoints). Host-side first-party integration; access token stays in Settings.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "portainer_containers",
    description:
      "List Docker containers on a Portainer environment. Pass endpoint (id or name); omit when only one environment exists. Optional name filter. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "portainer_inspect",
    description:
      "Inspect a Docker container on a Portainer environment. Pass container (id or name) and optional endpoint. Returns image, state, ports, and EnvCount — not Env values. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "portainer_logs",
    description:
      "Tail stdout/stderr for a Docker container on a Portainer environment. Pass container and optional endpoint, tail (default 100). Host-side; do not curl Portainer.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "portainer_stacks",
    description:
      "List Portainer stacks, or pass stack (id or name) for details and the compose file. Optional endpoint filter. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "portainer_container_action",
    description:
      "Start, stop, or restart a Docker container on a Portainer environment. Pass container, action (start|stop|restart), and optional endpoint. Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "portainer_stack_action",
    description:
      "Start or stop a Portainer stack. Pass stack (id or name), action (start|stop), and optional endpoint. Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "gmail_search",
    description:
      "Search Gmail (same q= as Gmail search). Host-side first-party integration; tokens stay in Settings.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "gmail_get",
    description: "Fetch a Gmail message by id. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "gmail_send",
    description:
      "Send an email from the signed-in Google account. Pass to, subject, and body. Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "calendar_list",
    description:
      "List Google Calendar events (default calendar primary) or calendars when calendars=true. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "calendar_get",
    description:
      "Fetch a Google Calendar event by id. Optional calendar (default primary). Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "calendar_create",
    description:
      "Create a Google Calendar event. Pass summary, start, and end (ISO-8601). Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "drive_list",
    description: "List Google Drive files (Drive query q). Host-side first-party integration.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "drive_get",
    description:
      "Fetch a Google Drive file by id (metadata, plus text contents when the file is small). Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "drive_upload",
    description:
      "Upload a file to Google Drive. Pass name and content or bytes_base64. Waits for operator approval. Host-side. Max 20 MiB.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "k8s_list",
    description:
      "List Kubernetes resources (pods, deployments, services, …). Pass kind and optional namespace / label selector. Host-side; cluster token stays in Settings.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "k8s_get",
    description:
      "Fetch one Kubernetes resource. Pass kind and name, plus namespace for namespaced objects. Secret data is redacted. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "k8s_logs",
    description:
      "Read pod logs. Pass name (pod) and optional namespace, container, tail, previous. Host-side. Do not kubectl from exec.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "k8s_events",
    description:
      "List Kubernetes events. Optional namespace, name, and kind (involved object). Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "k8s_apply",
    description:
      "Server-side apply a Kubernetes JSON or YAML manifest. Pass manifest. Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "k8s_delete",
    description:
      "Delete a Kubernetes resource. Pass kind and name, plus namespace when needed. Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "k8s_scale",
    description:
      "Scale a Deployment, ReplicaSet, or StatefulSet. Pass name, replicas, and optional namespace. Waits for operator approval. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_stash",
    description:
      "Stash or restore uncommitted changes in the guest workspace. Pass action=pop to restore.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "git_revert",
    description:
      "Revert a commit in the guest workspace (default HEAD). Creates a new revert commit.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "powershell",
    description: "Run a PowerShell command (Windows guests).",
    os: [...WINDOWS_TOOL_OS],
  },
  {
    name: "uia_tree",
    description: "Dump a UI Automation subtree for the named or focused window (Windows).",
    os: [...WINDOWS_TOOL_OS],
  },
  {
    name: "a11y_tree",
    description: "Dump visible windows, WM_CLASS, geometry, and the focused window (Linux).",
    os: [...LINUX_TOOL_OS],
  },
  {
    name: "start_process",
    description: "Start a GUI or console process on the guest.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "preview",
    description:
      "Serve the workspace over HTTP in the operator pane. Design: omit port — the live canvas loads /api/sessions/:id/canvas-files/ so relative ES modules (./vendor/three.module.js) resolve. Docker coding: pass the guest TCP port (bind 0.0.0.0) and optional path. Do not tell the operator to run npx serve.",
    os: [...LINUX_TOOL_OS],
  },
  {
    name: "playwright",
    description:
      'Run Playwright-style checks against a page. Design: the live canvas. Automations and coding: pass url, or call preview first. Pass click, clicks[], fill_selector+fill_text, expect_text, wait_for, or steps[] like "click #deploy". Optional viewport desktop|tablet|phone. Live click/fill/wait captures a PNG into chat (screenshot=false skips; screenshot=true forces a live capture). Do not npm install Playwright or write a spec file.',
    os: [...ALL_TOOL_OS],
  },
  {
    name: "browser_tabs",
    description:
      "List, create, close, or select Chromium tabs. Pass action=list|new|close|select. new needs url; select/close need targetId.",
    os: [...LINUX_TOOL_OS],
  },
  {
    name: "browser_navigate",
    description:
      "Open a URL in the guest Chromium the operator is watching. Prefer this over exec of a bare https:// URL.",
    os: [...LINUX_TOOL_OS],
  },
  {
    name: "browser_snapshot",
    description:
      "Accessibility tree of the active tab with refs like @e12. Prefer this over guessing click coordinates.",
    os: [...LINUX_TOOL_OS],
  },
  {
    name: "browser_click",
    description: "Click a ref from the last browser_snapshot (for example @e12).",
    os: [...LINUX_TOOL_OS],
  },
  {
    name: "browser_type",
    description: "Focus a snapshot ref and type text into it.",
    os: [...LINUX_TOOL_OS],
  },
  {
    name: "browser_console",
    description: "Return recent Chromium console errors and warnings.",
    os: [...LINUX_TOOL_OS],
  },
  {
    name: "browser_network",
    description: "Return recent failed Chromium network requests.",
    os: [...LINUX_TOOL_OS],
  },
  {
    name: "browser_pdf",
    description:
      "Print the current Chromium tab to PDF. Optional save_as_filename (no path or extension).",
    os: [...LINUX_TOOL_OS],
  },
  {
    name: "browser_trace",
    description:
      "Record a Chrome DevTools trace of the current tab (JSON for Perfetto / chrome://tracing). Pass action=start|stop. stop may include save_as_filename.",
    os: [...LINUX_TOOL_OS],
  },
  {
    name: "browser_download",
    description:
      "Save Chromium downloads under /tmp/locus-downloads. Pass action=enable|list|latest|get. latest copies the newest file into session artifacts; get copies filename.",
    os: [...LINUX_TOOL_OS],
  },
  {
    name: "board_list",
    description:
      "List planning boards on this machine (id, title, updatedAt). Host-side. No guest.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "board_get",
    description:
      "Read objects on a planning board. Optional board_id (defaults to this chat's board) and frame_id. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "board_upsert",
    description:
      "Create or update canvas objects (sticky, text, shape, connector, frame, card, image, table, timeline, ink). Pass objects[]. Optional fontSize, shape, stackId (stickies that share stackId form a deck), table.columns/rows, timeline.items with YYYY-MM-DD start/end, ink.points. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "board_delete",
    description: "Remove canvas objects by id. Pass ids[]. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "board_comment",
    description: "Pin a comment on a canvas object. Pass object_id and body. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "board_cluster",
    description:
      "Group selected stickies by shared theme words and snap them into labeled frames. Pass ids[] of sticky ids. One call. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "project_get",
    description:
      "Project mission control: members, roles/capabilities, spend, routines, Needs-you inbox, audit trail, and context index. Optional project_id (defaults to this chat's project). Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "project_spawn",
    description:
      "Spawn a project member session. Pass task. Optional kind (agent|review|design), placement (local|worker), focus, title, role, and capabilities[]. Returns immediately with member id. Coordinator only.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "project_steer",
    description:
      "Send a follow-up to a project member. Pass member_id and prompt. Coordinator only.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "project_stop",
    description: "Abort a project member's current turn. Pass member_id. Coordinator only.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "project_replace",
    description:
      "Replace a project member while retaining the old assignment in the roster. Pass member_id and task. Optional role, capabilities[], focus, and title. Coordinator only.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "team_directory",
    description:
      "List named Swarm teams with ids, member counts, pause state, and Needs-you counts. Use before team_handoff when the target id is unknown.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "team_handoff",
    description:
      "Send a bounded task to another named Swarm team. Pass target_team_id and task; optionally target_member_id. The receiving team can accept, decline, and report completion.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "project_collect",
    description: "Latest assistant summary, status, and PR url for a member. Pass member_id.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "project_propose_merge",
    description:
      "Ask the operator to merge a member's open pull request. Pass member_id. Does not merge — still needs Approve on git_pr_merge. Coordinator only.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "project_propose_rule",
    description:
      "Write a garden/lint convention into context/rules/ and ping the operator to apply it. Pass title and rule. Coordinator only.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "project_context_list",
    description: "List files in this project's shared context tree. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "project_context_read",
    description: "Read a project context file. Pass path relative to context/ (e.g. INDEX.md).",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "project_context_write",
    description:
      "Write a project context file. Pass path and content. Path is jailed to context/. No secrets.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "project_context_delete",
    description: "Delete a project context file. Pass path.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "team_roster",
    description:
      "List Locus Swarm teammates: name, role, status, needs_human, brief snippet. Use for questions about the team. Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "team_peer_status",
    description:
      "Status for one Swarm teammate. Pass teammate_id or name (display name / title). Host-side.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "team_add_teammate",
    description:
      "Create a new Swarm teammate chat. Pass name and role (e.g. Designer, Builder, Researcher). Optional personality and brief. Coordinator only. Returns the new teammate id.",
    os: [...ALL_TOOL_OS],
  },
  {
    name: "team_message",
    description:
      "Send a fire-and-forget message to a Swarm teammate (does not wait for their reply). Pass teammate_id or name, plus message. Returns immediately; you are notified when they finish, need you, or fail. Prefer this over shelling out to locus agent chat.",
    os: [...ALL_TOOL_OS],
  },
];

export function toolsForOs(os: ToolOs): ToolSpec[] {
  return COMPUTER_USE_TOOLS.filter((t) =>
    t.os.some(
      (listed) =>
        listed === os || (isLinux(listed) && isLinux(os)) || (isWindows(listed) && isWindows(os)),
    ),
  );
}

const DOCKER_ONLY_TOOLS = new Set<ComputerUseToolName>([
  "browser_tabs",
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_console",
  "browser_network",
  "browser_pdf",
  "browser_trace",
  "browser_download",
]);

function uniqueCatalog(...groups: ComputerUseToolName[][]): ComputerUseToolName[] {
  const seen = new Set<ComputerUseToolName>();
  const out: ComputerUseToolName[] = [];
  for (const group of groups) {
    for (const name of group) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** File, git, forge, and integration tools Host and Docker catalogs share. */
export const SHARED_RUNTIME_TOOLS: ComputerUseToolName[] = [
  "exec",
  "file_read",
  "file_write",
  "canvas_write",
  "canvas_read",
  "file_list",
  "grep",
  "glob",
  "apply_patch",
  "git_clone",
  "git_fetch",
  "git_status",
  "git_diff",
  "git_log",
  "git_commit",
  "git_branch",
  "git_push",
  "git_pr",
  "git_pr_review",
  "git_pr_list",
  "git_pr_get",
  "git_pr_loadpath",
  "git_pr_comment",
  "git_pr_checks",
  "git_pr_merge",
  "git_issue_list",
  "git_issue_get",
  "git_issue_comment",
  "jira_search",
  "jira_get",
  "jira_comment",
  "jira_create",
  "jira_update",
  "jira_transition",
  "confluence_search",
  "confluence_get",
  "confluence_create",
  "confluence_update",
  "confluence_comment",
  "linear_search",
  "linear_get",
  "linear_comment",
  "linear_create",
  "linear_update",
  "slack_post",
  "slack_upload",
  "slack_channels",
  "slack_history",
  "slack_replies",
  "grafana_search",
  "grafana_get",
  "grafana_query",
  "sentry_projects",
  "sentry_search",
  "sentry_get",
  "sentry_events",
  "sentry_update",
  "miro_list",
  "miro_get",
  "miro_import",
  "miro_export",
  "figma_list",
  "figma_get",
  "figma_images",
  "figma_comment",
  "incidentio_search",
  "incidentio_get",
  "incidentio_comment",
  "incidentio_create",
  "incidentio_update",
  "aws_sts_identity",
  "aws_iam_list",
  "aws_iam_get",
  "aws_iam_simulate",
  "portainer_endpoints",
  "portainer_containers",
  "portainer_inspect",
  "portainer_logs",
  "portainer_stacks",
  "portainer_container_action",
  "portainer_stack_action",
  "gmail_search",
  "gmail_get",
  "gmail_send",
  "calendar_list",
  "calendar_get",
  "calendar_create",
  "drive_list",
  "drive_get",
  "drive_upload",
  "k8s_list",
  "k8s_get",
  "k8s_logs",
  "k8s_events",
  "k8s_apply",
  "k8s_delete",
  "k8s_scale",
  "git_stash",
  "git_revert",
  "preview",
  "playwright",
  "project_context_list",
  "project_context_read",
  "project_context_write",
  "project_context_delete",
];

/** Headed Chromium on the operator machine (isolated `host-chrome/<session>` profile). */
export const HOST_BROWSER_TOOLS: ComputerUseToolName[] = [
  "screenshot",
  "mouse_move",
  "mouse_click",
  "mouse_drag",
  "mouse_scroll",
  "key",
  "type_text",
  "browser_tabs",
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_console",
  "browser_network",
  "browser_pdf",
  "browser_trace",
  "browser_download",
];

const DOCKER_HEADED_TOOLS: ComputerUseToolName[] = [
  "start_process",
  "record_screen",
  ...HOST_BROWSER_TOOLS,
];

const HOST_PLANNING_TOOLS: ComputerUseToolName[] = [
  "board_list",
  "board_get",
  "board_upsert",
  "board_delete",
  "board_comment",
  "board_cluster",
  "project_get",
  "project_spawn",
  "project_steer",
  "project_stop",
  "project_replace",
  "team_directory",
  "team_handoff",
  "project_collect",
  "project_propose_merge",
  "project_propose_rule",
  "team_roster",
  "team_peer_status",
  "team_add_teammate",
  "team_message",
];

export const DOCKER_TOOLS: ComputerUseToolName[] = uniqueCatalog(
  SHARED_RUNTIME_TOOLS,
  DOCKER_HEADED_TOOLS,
);

/** File, git, and shell tools that run on this machine, plus opt-in headed Chrome. */
export const HOST_TOOLS: ComputerUseToolName[] = uniqueCatalog(
  SHARED_RUNTIME_TOOLS,
  HOST_PLANNING_TOOLS,
  HOST_BROWSER_TOOLS,
);

/** Host-only catalog for planning-board chat. No guest file/exec tools. */
export const BOARD_CHAT_TOOLS: ComputerUseToolName[] = [
  "board_list",
  "board_get",
  "board_upsert",
  "board_delete",
  "board_comment",
  "board_cluster",
  "jira_search",
  "jira_get",
  "confluence_search",
  "confluence_get",
  "linear_search",
  "linear_get",
  "slack_channels",
  "slack_history",
  "slack_replies",
  "grafana_search",
  "grafana_get",
  "grafana_query",
  "sentry_projects",
  "sentry_search",
  "sentry_get",
  "sentry_events",
  "miro_list",
  "miro_get",
  "miro_import",
  "miro_export",
  "figma_list",
  "figma_get",
  "figma_images",
  "figma_comment",
  "incidentio_search",
  "incidentio_get",
  "aws_sts_identity",
  "aws_iam_list",
  "aws_iam_get",
  "aws_iam_simulate",
  "portainer_endpoints",
  "portainer_containers",
  "portainer_inspect",
  "portainer_logs",
  "portainer_stacks",
  "gmail_search",
  "gmail_get",
  "calendar_list",
  "calendar_get",
  "drive_list",
  "drive_get",
  "k8s_list",
  "k8s_get",
  "k8s_logs",
  "k8s_events",
];

/** Host-only catalog for a Project coordinator. No apply_patch / exec. */
export const PROJECT_CHAT_TOOLS: ComputerUseToolName[] = [
  "project_get",
  "project_spawn",
  "project_steer",
  "project_stop",
  "project_replace",
  "team_directory",
  "team_handoff",
  "project_collect",
  "project_propose_merge",
  "project_propose_rule",
  "project_context_list",
  "project_context_read",
  "project_context_write",
  "project_context_delete",
  "team_roster",
  "team_peer_status",
  "team_add_teammate",
  "team_message",
  "git_pr_list",
  "git_pr_get",
  "git_pr_checks",
  "git_issue_list",
  "git_issue_get",
  "jira_search",
  "jira_get",
  "confluence_search",
  "confluence_get",
  "linear_search",
  "linear_get",
  "sentry_search",
  "sentry_get",
  "slack_channels",
  "slack_history",
  "slack_replies",
  "incidentio_search",
  "incidentio_get",
  "gmail_search",
  "gmail_get",
  "calendar_list",
  "calendar_get",
  "drive_list",
  "drive_get",
  "board_list",
  "board_get",
];

/**
 * Lean catalog for a Swarm group-chat coordinator. Mentions fan out to
 * existing teammates via team_message; fleet spawn / forge / Slack / Board
 * schemas stay off every turn.
 */
export const GROUP_CHAT_TOOLS: ComputerUseToolName[] = [
  "project_get",
  "project_context_list",
  "project_context_read",
  "project_context_write",
  "project_context_delete",
  "team_roster",
  "team_peer_status",
  "team_add_teammate",
  "team_message",
];

export function toolsForRuntime(os: ToolOs, runtime: AgentRuntime = "vm"): ToolSpec[] {
  const tools = toolsForOs(os).filter(
    (t) => runtime === "docker" || runtime === "host" || !DOCKER_ONLY_TOOLS.has(t.name),
  );
  if (runtime === "host") {
    const allow = new Set<string>(HOST_TOOLS);
    return tools.filter((t) => allow.has(t.name));
  }
  if (runtime !== "docker") return tools;
  const allow = new Set<string>(DOCKER_TOOLS);
  return tools.filter((t) => allow.has(t.name));
}

/** Same catalog as toolsForRuntime, minus first-party integrations until that account has a token. */
export function configuredToolsForRuntime(
  os: ToolOs,
  runtime: AgentRuntime = "vm",
  integrations?: IntegrationAccount[],
): ToolSpec[] {
  return toolsForRuntime(os, runtime).filter((t) => integrationReady(t.name, integrations));
}

export const APPROVAL_TOOLS: ComputerUseToolName[] = [
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
  "board_upsert",
  "board_delete",
  "board_cluster",
  "miro_export",
  "figma_comment",
  "incidentio_comment",
  "incidentio_create",
  "incidentio_update",
  "portainer_container_action",
  "portainer_stack_action",
  "gmail_send",
  "calendar_create",
  "drive_upload",
  "k8s_apply",
  "k8s_delete",
  "k8s_scale",
];

const PARALLEL_SAFE_TOOLS = new Set<string>([
  "file_read",
  "file_list",
  "grep",
  "glob",
  "git_status",
  "git_diff",
  "git_log",
  "git_pr_list",
  "git_pr_get",
  "git_pr_loadpath",
  "git_pr_checks",
  "git_issue_list",
  "git_issue_get",
  "jira_search",
  "jira_get",
  "confluence_search",
  "confluence_get",
  "linear_search",
  "linear_get",
  "grafana_search",
  "grafana_get",
  "grafana_query",
  "sentry_projects",
  "sentry_search",
  "sentry_get",
  "sentry_events",
  "miro_list",
  "miro_get",
  "miro_import",
  "figma_list",
  "figma_get",
  "figma_images",
  "incidentio_search",
  "incidentio_get",
  "aws_sts_identity",
  "aws_iam_list",
  "aws_iam_get",
  "aws_iam_simulate",
  "portainer_endpoints",
  "portainer_containers",
  "portainer_inspect",
  "portainer_logs",
  "portainer_stacks",
  "gmail_search",
  "gmail_get",
  "calendar_list",
  "calendar_get",
  "drive_list",
  "drive_get",
  "k8s_list",
  "k8s_get",
  "k8s_logs",
  "k8s_events",
  "slack_channels",
  "slack_history",
  "slack_replies",
  "websearch",
  "window_list",
  "clipboard_get",
  "a11y_tree",
  "uia_tree",
  "browser_tabs",
  "browser_snapshot",
  "browser_console",
  "browser_network",
  "repo_map",
  "mcp_list_tools",
  "mcp_get_tool_info",
  "read_skill",
  "board_list",
  "board_get",
  "project_get",
  "project_collect",
  "project_context_list",
  "project_context_read",
  "team_roster",
  "team_peer_status",
]);

const PARALLEL_SAFE_READ_ACTIONS: Record<string, Set<string>> = {
  scratchpad: new Set(["read"]),
  task_list: new Set(["list"]),
  remember: new Set(["list"]),
  subscribe: new Set(["list"]),
};

/** True when every tool is a read and they can share one model round without waiting on each other. */
export function toolsRunInParallel(names: string[]): boolean {
  return names.length > 1 && names.every((name) => PARALLEL_SAFE_TOOLS.has(name));
}

export function toolCallsRunInParallel(
  calls: Array<{ name: string; arguments?: Record<string, unknown> }>,
): boolean {
  if (calls.length <= 1) return false;
  return calls.every((call) => {
    if (PARALLEL_SAFE_TOOLS.has(call.name)) return true;
    const allowed = PARALLEL_SAFE_READ_ACTIONS[call.name];
    if (!allowed) return false;
    const action =
      typeof call.arguments?.action === "string" ? call.arguments.action.trim().toLowerCase() : "";
    return allowed.has(action);
  });
}

export function execArgCommands(args: Record<string, unknown> = {}): string[] {
  if (Array.isArray(args.commands)) {
    const listed = args.commands
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim());
    if (listed.length) return listed;
  }
  if (typeof args.command === "string" && args.command.trim()) return [args.command.trim()];
  return [];
}

/** Paths for file_read: `path` plus `paths[]`, capped so one call cannot dump the tree. */
export function fileReadPaths(args: Record<string, unknown> = {}): string[] {
  const out: string[] = [];
  const push = (value: string) => {
    const path = value.trim();
    if (path && !out.includes(path)) out.push(path);
  };
  if (typeof args.path === "string") push(args.path);
  if (Array.isArray(args.paths)) {
    for (const item of args.paths) {
      if (typeof item === "string") push(item);
    }
  }
  return out.slice(0, 8);
}

export function toolNeedsApproval(
  name: string,
  policy?: ApprovalPolicy,
  args?: Record<string, unknown>,
): boolean {
  if (policyToolNeedsApproval(name, policy, args)) return true;
  if (policy?.autoAllow?.includes("install")) return false;
  if (
    (name === "exec" || name === "powershell") &&
    installCommandsNeedApproval(execArgCommands(args ?? {}))
  )
    return true;
  if (
    name === "file_write" &&
    packageJsonLifecycleRisk(String(args?.path ?? ""), String(args?.content ?? ""))
  )
    return true;
  if (name === "apply_patch" && patchTouchesLifecycleScripts(String(args?.patch ?? "")))
    return true;
  return false;
}

/** Forge PR and issue tools run on the control plane, not in the Guest. */
export const FORGE_TOOLS = [
  "git_pr",
  "git_pr_review",
  "git_pr_list",
  "git_pr_get",
  "git_pr_loadpath",
  "git_pr_comment",
  "git_pr_checks",
  "git_pr_merge",
  "git_issue_list",
  "git_issue_get",
  "git_issue_comment",
] as const;
export type ForgeToolName = (typeof FORGE_TOOLS)[number];

export function isForgeToolName(name: string): name is ForgeToolName {
  return (FORGE_TOOLS as readonly string[]).includes(name);
}

/** Swarm roster / peer tools (host-side). */
export const SWARM_TEAM_TOOLS = [
  "team_roster",
  "team_peer_status",
  "team_add_teammate",
  "team_message",
] as const;
export type SwarmTeamToolName = (typeof SWARM_TEAM_TOOLS)[number];

export function isSwarmTeamToolName(name: string): name is SwarmTeamToolName {
  return (SWARM_TEAM_TOOLS as readonly string[]).includes(name);
}

/**
 * Tools the Guest runtime must not execute. Forge, integrations, Board, Project
 * (except team_directory / team_handoff), Swarm team, and runtime/Brain tools
 * stay on the control plane.
 */
const GUEST_PROJECT_TOOLS = new Set(["team_directory", "team_handoff"]);
const CONTROL_PLANE_TOOLS = new Set<string>([
  ...FORGE_TOOLS,
  ...INTEGRATION_TOOL_NAMES,
  ...AGENT_CANVAS_TOOLS,
  ...BOARD_TOOL_NAMES,
  ...SWARM_TEAM_TOOLS,
  ...PROJECT_TOOL_NAMES.filter((name) => !GUEST_PROJECT_TOOLS.has(name)),
]);

export function isControlPlaneToolName(name: string): boolean {
  return CONTROL_PLANE_TOOLS.has(name) || isRuntimeToolName(name);
}

export function toolNeedsGuest(name: string): boolean {
  return !isControlPlaneToolName(name);
}

export function parseToolAllowlist(
  os: ToolOs,
  names: string[],
  runtime: AgentRuntime = "vm",
): ComputerUseToolName[] {
  const allowed = new Set(toolsForRuntime(os, runtime).map((t) => t.name));
  const out: ComputerUseToolName[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    if (!allowed.has(name as ComputerUseToolName)) {
      throw new Error(`Unknown tool for this guest: ${name}`);
    }
    if (!out.includes(name as ComputerUseToolName)) out.push(name as ComputerUseToolName);
  }
  return out;
}

export type { JsonSchema, JsonSchemaProperty } from "./toolSchemas.js";
export { TOOL_SCHEMAS } from "./toolSchemas.js";
export type { ToolOverlay } from "./toolOverlay.js";
export { GUEST_SCREEN, overlayFromTool, overlayPosition } from "./toolOverlay.js";

/** Lean forge tools exposed to Cursor CLI through the session-scoped locus MCP server. */
export const FORGE_MCP_TOOLS: ComputerUseToolName[] = [
  "git_pr_list",
  "git_pr_get",
  "git_pr_loadpath",
  "git_pr_comment",
  "git_pr_review",
  "git_pr_checks",
  "git_issue_list",
  "git_issue_get",
  "git_issue_comment",
];

export function isForgeIssueMcpToolName(name: string): boolean {
  return name === "git_issue_list" || name === "git_issue_get" || name === "git_issue_comment";
}

export function forgeIssueMcpTools(): Array<{
  name: string;
  description: string;
  inputSchema: JsonSchema;
}> {
  return forgeMcpTools().filter((tool) => isForgeIssueMcpToolName(tool.name));
}

export function isForgeMcpToolName(name: string): name is ComputerUseToolName {
  return (FORGE_MCP_TOOLS as readonly string[]).includes(name);
}

/** Session MCP tools for Cursor CLI Design/Games/Assets (native CLI has no playwright). */
export function isCanvasMcpToolName(name: string): name is ComputerUseToolName {
  return name === "playwright";
}

export function canvasMcpTools(kind: "game" | "assets" | "design" = "game"): Array<{
  name: string;
  description: string;
  inputSchema: JsonSchema;
}> {
  const description =
    kind === "assets"
      ? "Click and screenshot the live asset studio. Pass click #btnWire or the mesh, then screenshot once. Page errors (tainted canvas / SecurityError) mean getImageData failed — set img.crossOrigin='anonymous'; relative photos switch the iframe to canvas-files HTTP automatically. Do not iterate flood-fill or click Wireframe in a loop. HUD text such as css-3d or 3D mesh is not a playtest. Do not npm i Playwright."
      : kind === "design"
        ? "Click and screenshot the live design canvas. After a write, screenshot (or click/fill a control) so the PNG is in chat, then patch visual bugs those pixels show. Do not stop after the first paint. Do not npm i Playwright."
        : "Click and screenshot the live game canvas iframe. Click the new control (or Restart / the first type=button), drive until stats.time moves, then screenshot. HUD expect of road # / bumps is not a playtest. Do not npm i Playwright.";
  return COMPUTER_USE_TOOLS.filter((t) => isCanvasMcpToolName(t.name)).map((t) => ({
    name: t.name,
    description,
    inputSchema: TOOL_SCHEMAS[t.name],
  }));
}

/** Coding and review chats can build a canvas beside the thread from Cursor/Claude/Codex CLI. */
export function agentCanvasMcpTools(): Array<{
  name: string;
  description: string;
  inputSchema: JsonSchema;
}> {
  return COMPUTER_USE_TOOLS.filter((t) => isAgentCanvasToolName(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: TOOL_SCHEMAS[t.name],
  }));
}

export function forgeMcpTools(): Array<{
  name: string;
  description: string;
  inputSchema: JsonSchema;
}> {
  return COMPUTER_USE_TOOLS.filter((t) => isForgeMcpToolName(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: TOOL_SCHEMAS[t.name],
  }));
}

/** First-party integration tools for a Cursor CLI MCP server. Secrets stay on the host. */
export function integrationMcpTools(integrations?: IntegrationAccount[]): Array<{
  name: string;
  description: string;
  inputSchema: JsonSchema;
}> {
  return COMPUTER_USE_TOOLS.filter(
    (t) => isIntegrationToolName(t.name) && integrationReady(t.name, integrations),
  ).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: TOOL_SCHEMAS[t.name],
  }));
}

export function openaiToolDefs(os: ToolOs, allowed?: string[], runtime: AgentRuntime = "vm") {
  const defs = toolsForRuntime(os, runtime).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: TOOL_SCHEMAS[t.name],
    },
  }));
  return allowed === undefined ? defs : defs.filter((d) => allowed.includes(d.function.name));
}

export function anthropicToolDefs(os: ToolOs, allowed?: string[], runtime: AgentRuntime = "vm") {
  const defs = toolsForRuntime(os, runtime).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: TOOL_SCHEMAS[t.name],
  }));
  return allowed === undefined ? defs : defs.filter((d) => allowed.includes(d.name));
}
