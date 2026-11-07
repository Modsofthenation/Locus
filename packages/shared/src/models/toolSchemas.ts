import type { ComputerUseToolName } from "./tools.js";

export interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: { type: string };
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export const RECORD_SCREEN_MODES = [
  "START_RECORDING",
  "SAVE_RECORDING",
  "DISCARD_RECORDING",
] as const;
export type RecordScreenMode = (typeof RECORD_SCREEN_MODES)[number];

export const TOOL_SCHEMAS: Record<ComputerUseToolName, JsonSchema> = {
  exec: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description:
          "Shell command to run in the guest. Combine independent reads with ; and a banner, or use commands[].",
      },
      commands: {
        type: "array",
        items: { type: "string" },
        description:
          "Independent shell commands to run in order with labeled output. Prefer this over one exec per turn. Each item must be a complete command; do not put heredocs (<<EOF) here — use command instead.",
      },
      cwd: { type: "string", description: "Working directory on the guest" },
      timeout_ms: { type: "number", description: "Kill the command after this many milliseconds" },
    },
  },
  screenshot: { type: "object", properties: {} },
  record_screen: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        description:
          "START_RECORDING to begin, SAVE_RECORDING to stop and save, DISCARD_RECORDING to discard",
        enum: [...RECORD_SCREEN_MODES],
      },
      save_as_filename: {
        type: "string",
        description:
          "Short name for the saved recording. Only used with SAVE_RECORDING. No slashes or extension.",
      },
    },
    required: ["mode"],
  },
  mouse_move: {
    type: "object",
    properties: {
      x: { type: "number", description: "Absolute X" },
      y: { type: "number", description: "Absolute Y" },
    },
    required: ["x", "y"],
  },
  mouse_click: {
    type: "object",
    properties: {
      button: { type: "number", description: "1 left, 2 middle, 3 right" },
      x: { type: "number" },
      y: { type: "number" },
      count: { type: "number", description: "Clicks to send. 2 is a double-click." },
    },
  },
  mouse_drag: {
    type: "object",
    properties: {
      x1: { type: "number", description: "Start X. Omit to drag from the current pointer." },
      y1: { type: "number", description: "Start Y" },
      x2: { type: "number" },
      y2: { type: "number" },
    },
    required: ["x2", "y2"],
  },
  mouse_scroll: {
    type: "object",
    properties: {
      delta: {
        type: "number",
        description: "Wheel notches. Positive scrolls up, negative scrolls down.",
      },
      x: { type: "number" },
      y: { type: "number" },
      axis: {
        type: "string",
        description: "vertical (default) or horizontal",
        enum: ["vertical", "horizontal"],
      },
    },
    required: ["delta"],
  },
  key: {
    type: "object",
    properties: { key: { type: "string", description: "Key or combo such as ctrl+c or win+r" } },
    required: ["key"],
  },
  type_text: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  clipboard_get: { type: "object", properties: {} },
  clipboard_set: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  window_list: { type: "object", properties: {} },
  window_focus: {
    type: "object",
    properties: { title: { type: "string" } },
    required: ["title"],
  },
  file_read: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "File to read. Relative to the guest workspace unless absolute. Use paths[] to open several files.",
      },
      paths: {
        type: "array",
        items: { type: "string" },
        description: "Up to 8 files to read in one call. Prefer this over one file_read per turn.",
      },
      offset: { type: "number", description: "1-based start line. Omit to read from the start." },
      limit: { type: "number", description: "Max lines to return per file." },
    },
  },
  file_write: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  canvas_write: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short name the operator sees on the canvas" },
      html: {
        type: "string",
        description: "Full self-contained HTML document. Inline CSS and script only.",
      },
      id: { type: "string", description: "Existing canvas id to replace. Omit to create." },
    },
    required: ["title", "html"],
  },
  canvas_read: {
    type: "object",
    properties: {
      id: { type: "string", description: "Canvas id. Omit to read the latest." },
    },
  },
  file_list: {
    type: "object",
    properties: { path: { type: "string" } },
  },
  grep: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Search pattern (extended regex on Linux, .NET regex on Windows)",
      },
      path: { type: "string", description: "Directory or file to search" },
      glob: { type: "string", description: "Optional filename glob such as *.ts" },
      context: {
        type: "number",
        description:
          "Lines of surrounding context for each match (default 3, max 8). Set 0 for match lines only.",
      },
    },
    required: ["pattern"],
  },
  glob: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Filename glob such as **/*.ts or *.md" },
      path: { type: "string", description: "Directory to search" },
    },
    required: ["pattern"],
  },
  apply_patch: {
    type: "object",
    properties: {
      patch: {
        type: "string",
        description:
          "Unified diff (--- a/file +++ b/file @@ -N,M +N,M) or *** Begin Patch / *** Update File. Bare @@ hunks without line numbers are valid. Context lines start with a leading space.",
      },
      path: {
        type: "string",
        description:
          "Workspace directory to apply in (not the file being patched). Defaults to the guest workspace.",
      },
    },
    required: ["patch"],
  },
  git_clone: {
    type: "object",
    properties: {
      url: { type: "string" },
      dest: {
        type: "string",
        description:
          "Guest directory. Defaults to the workspace root. In a multi-repo workspace use that repo's dest from the attached-repos prompt.",
      },
      ref: {
        type: "string",
        description:
          "Remote branch, tag, or SHA. Not a local pathspec. Fetched over HTTPS with the forge token.",
      },
      pull: {
        type: "number",
        description: "Pull/merge request number. Fetches the PR head (works for forks).",
      },
      pull_number: {
        type: "number",
        description: "Alias of pull.",
      },
    },
    required: ["url"],
  },
  git_fetch: {
    type: "object",
    properties: {
      path: { type: "string" },
      url: {
        type: "string",
        description: "Remote URL. SSH remotes are rewritten to HTTPS when a token is set.",
      },
      ref: { type: "string", description: "Branch, tag, SHA, or pull/N to fetch." },
      pull: { type: "number", description: "Pull/merge request number." },
    },
  },
  git_status: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Checkout directory. In a multi-repo workspace pass that repo's dest from the attached-repos prompt.",
      },
    },
  },
  git_diff: {
    type: "object",
    properties: {
      path: { type: "string" },
      staged: { type: "boolean", description: "If true, show staged changes only" },
    },
  },
  git_log: {
    type: "object",
    properties: {
      path: { type: "string" },
      max: { type: "number", description: "Commit count. Default 20." },
    },
  },
  git_commit: {
    type: "object",
    properties: {
      path: { type: "string" },
      message: { type: "string", description: "Commit message" },
    },
    required: ["message"],
  },
  git_branch: {
    type: "object",
    properties: {
      path: { type: "string" },
      name: { type: "string", description: "Branch name" },
    },
    required: ["name"],
  },
  git_push: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Checkout directory. In a multi-repo workspace pass that repo's dest from the attached-repos prompt.",
      },
    },
  },
  git_pr: {
    type: "object",
    properties: {
      title: { type: "string" },
      body: { type: "string" },
      path: {
        type: "string",
        description:
          "Checkout directory for this pull request. In a multi-repo workspace pass that repo's dest from the attached-repos prompt.",
      },
      draft: { type: "boolean", description: "Open as a draft pull request" },
      base: { type: "string", description: "Base branch. Defaults to the default branch." },
    },
    required: ["title"],
  },
  git_pr_review: {
    type: "object",
    properties: {
      body: { type: "string", description: "Review comment" },
      event: {
        type: "string",
        description: "COMMENT (default), APPROVE, or REQUEST_CHANGES",
        enum: ["COMMENT", "APPROVE", "REQUEST_CHANGES"],
      },
      pull_number: {
        type: "number",
        description: "Pull request number. Omit to use the open PR for this branch.",
      },
    },
    required: ["body"],
  },
  git_pr_list: {
    type: "object",
    properties: {
      state: { type: "string", description: "open (default), draft, or all" },
    },
  },
  git_pr_get: {
    type: "object",
    properties: {
      pull_number: {
        type: "number",
        description: "Pull request number. Omit to use the open PR for this branch.",
      },
      include: {
        type: "array",
        items: { type: "string" },
        description:
          'Sections to return: summary, files, comments, checks. Omit for a clipped full card. Prefer ["files"] when comments and the load path are already in the prompt.',
      },
      paths: {
        type: "array",
        items: { type: "string" },
        description:
          "Only include these file paths in the Files section. Omit on the first files fetch; use only when a prior response listed paths without patches.",
      },
    },
  },
  git_pr_loadpath: {
    type: "object",
    properties: {
      pull_number: {
        type: "number",
        description: "Pull request number. Omit to use the open PR for this branch.",
      },
    },
  },
  git_pr_comment: {
    type: "object",
    properties: {
      body: { type: "string", description: "Comment text" },
      path: { type: "string", description: "File path for an inline comment" },
      line: { type: "number", description: "Line number in the new file" },
      side: { type: "string", description: "RIGHT (default) or LEFT", enum: ["LEFT", "RIGHT"] },
      pull_number: { type: "number" },
    },
    required: ["body"],
  },
  git_pr_checks: {
    type: "object",
    properties: {
      pull_number: { type: "number" },
    },
  },
  git_pr_merge: {
    type: "object",
    properties: {
      pull_number: { type: "number" },
    },
  },
  git_issue_list: {
    type: "object",
    properties: {
      state: { type: "string", description: "open (default), closed, or all" },
    },
  },
  git_issue_get: {
    type: "object",
    properties: {
      issue_number: { type: "number", description: "Issue number" },
      include: {
        type: "array",
        items: { type: "string" },
        description: "Sections to return: summary, comments. Omit for a clipped full card.",
      },
    },
    required: ["issue_number"],
  },
  git_issue_comment: {
    type: "object",
    properties: {
      body: { type: "string", description: "Comment text" },
      issue_number: { type: "number", description: "Issue number" },
    },
    required: ["body", "issue_number"],
  },
  jira_search: {
    type: "object",
    properties: {
      jql: { type: "string", description: "Jira Query Language string" },
      query: { type: "string", description: "Alias for jql" },
    },
  },
  jira_get: {
    type: "object",
    properties: {
      issue: { type: "string", description: "Issue key such as OPS-12" },
      key: { type: "string" },
    },
  },
  jira_comment: {
    type: "object",
    properties: {
      issue: { type: "string", description: "Issue key" },
      key: { type: "string" },
      body: { type: "string" },
      comment: { type: "string" },
    },
    required: ["body"],
  },
  jira_create: {
    type: "object",
    properties: {
      project: { type: "string", description: "Project key (OPS) or numeric id" },
      summary: { type: "string", description: "Issue summary" },
      title: { type: "string", description: "Alias for summary" },
      description: { type: "string" },
      body: { type: "string", description: "Alias for description" },
      issuetype: { type: "string", description: "Issue type name or id (default Task)" },
      issue_type: { type: "string" },
      parent: { type: "string", description: "Parent or Epic key (e.g. SUP-846)" },
      epic: { type: "string", description: "Alias for parent / Epic Link" },
    },
    required: ["project", "summary"],
  },
  jira_update: {
    type: "object",
    properties: {
      issue: { type: "string", description: "Issue key, or comma-separated keys" },
      key: { type: "string" },
      issues: {
        type: "array",
        items: { type: "string" },
        description: "Issue keys to update (bulk parent/Epic Link)",
      },
      parent: { type: "string", description: "Parent or Epic key (e.g. SUP-846)" },
      epic: { type: "string", description: "Alias for parent / Epic Link" },
      epic_link: { type: "string", description: "Alias for parent / Epic Link" },
      summary: { type: "string" },
      title: { type: "string", description: "Alias for summary" },
      description: { type: "string" },
      body: { type: "string", description: "Alias for description" },
      labels: { type: "string", description: "Comma-separated labels to set" },
      fields: { type: "object", description: "Extra Jira fields (e.g. customfield_10500)" },
    },
  },
  jira_transition: {
    type: "object",
    properties: {
      issue: { type: "string", description: "Issue key" },
      key: { type: "string" },
      transition: { type: "string", description: "Transition name or id" },
      status: { type: "string", description: "Alias for transition name" },
    },
    required: ["issue", "transition"],
  },
  confluence_search: {
    type: "object",
    properties: {
      cql: { type: "string", description: "Confluence Query Language string" },
      query: {
        type: "string",
        description: "Alias for cql, or plain text wrapped as text ~ query",
      },
    },
  },
  confluence_get: {
    type: "object",
    properties: {
      id: { type: "string", description: "Page / content id" },
      page: { type: "string", description: "Alias for id" },
      title: { type: "string", description: "Page title when id is unknown" },
      space: { type: "string", description: "Space key (required with title)" },
    },
  },
  confluence_create: {
    type: "object",
    properties: {
      space: { type: "string", description: "Space key (ENG)" },
      title: { type: "string", description: "Page title" },
      body: { type: "string", description: "Storage HTML or plain text" },
      content: { type: "string", description: "Alias for body" },
      parent: { type: "string", description: "Parent page id" },
    },
    required: ["space", "title"],
  },
  confluence_update: {
    type: "object",
    properties: {
      id: { type: "string", description: "Page / content id" },
      page: { type: "string", description: "Alias for id" },
      title: { type: "string", description: "New title, or current title when resolving by name" },
      space: { type: "string", description: "Space key when resolving by title" },
      body: { type: "string", description: "Storage HTML or plain text" },
      content: { type: "string", description: "Alias for body" },
    },
  },
  confluence_comment: {
    type: "object",
    properties: {
      id: { type: "string", description: "Page / content id" },
      page: { type: "string", description: "Alias for id" },
      title: { type: "string", description: "Page title when id is unknown" },
      space: { type: "string", description: "Space key (required with title)" },
      body: { type: "string", description: "Comment text (storage HTML or plain text)" },
      comment: { type: "string", description: "Alias for body" },
    },
    required: ["body"],
  },
  linear_search: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search text or identifier (ENG-12)" },
      q: { type: "string", description: "Alias for query" },
      term: { type: "string", description: "Alias for query" },
      team: { type: "string", description: "Team key (ENG) or id" },
      state: { type: "string", description: "Workflow state name" },
      status: { type: "string", description: "Alias for state" },
      assignee: { type: "string", description: "Display name, email, or me" },
    },
  },
  linear_get: {
    type: "object",
    properties: {
      issue: { type: "string", description: "Issue identifier such as ENG-12" },
      key: { type: "string" },
      id: { type: "string" },
      identifier: { type: "string" },
    },
  },
  linear_comment: {
    type: "object",
    properties: {
      issue: { type: "string", description: "Issue identifier" },
      key: { type: "string" },
      id: { type: "string" },
      body: { type: "string" },
      comment: { type: "string" },
      message: { type: "string" },
    },
    required: ["body"],
  },
  linear_create: {
    type: "object",
    properties: {
      team: { type: "string", description: "Team key (ENG) or id" },
      title: { type: "string", description: "Issue title" },
      summary: { type: "string", description: "Alias for title" },
      name: { type: "string", description: "Alias for title" },
      description: { type: "string" },
      body: { type: "string", description: "Alias for description" },
      state: { type: "string", description: "Workflow state name or id" },
      status: { type: "string", description: "Alias for state" },
      assignee: { type: "string", description: "Display name, email, me, or id" },
      parent: { type: "string", description: "Parent issue identifier" },
      epic: { type: "string", description: "Alias for parent" },
      labels: { type: "string", description: "Comma-separated label names" },
      priority: { type: "number", description: "0 none, 1 urgent, 2 high, 3 medium, 4 low" },
    },
    required: ["team", "title"],
  },
  linear_update: {
    type: "object",
    properties: {
      issue: { type: "string", description: "Issue identifier" },
      key: { type: "string" },
      id: { type: "string" },
      title: { type: "string" },
      summary: { type: "string", description: "Alias for title" },
      description: { type: "string" },
      body: { type: "string", description: "Alias for description" },
      state: { type: "string", description: "Workflow state name or id" },
      status: { type: "string", description: "Alias for state" },
      transition: { type: "string", description: "Alias for state" },
      assignee: { type: "string", description: "Display name, email, me, none, or id" },
      parent: { type: "string", description: "Parent issue identifier" },
      epic: { type: "string", description: "Alias for parent" },
      labels: { type: "string", description: "Comma-separated label names" },
      priority: { type: "number", description: "0 none, 1 urgent, 2 high, 3 medium, 4 low" },
    },
  },
  slack_post: {
    type: "object",
    properties: {
      channel: { type: "string", description: "Channel ID or name" },
      text: { type: "string" },
      body: { type: "string" },
      thread_ts: { type: "string", description: "Optional thread timestamp" },
      as: {
        type: "string",
        description: 'Identity: "user" (default, signed-in operator) or "bot" (Locus app)',
      },
    },
    required: ["channel", "text"],
  },
  slack_upload: {
    type: "object",
    properties: {
      channel: { type: "string", description: "Channel ID or name" },
      filename: { type: "string", description: "File name shown in Slack" },
      content: { type: "string", description: "UTF-8 file contents when the file is text" },
      bytes_base64: { type: "string", description: "Base64 file bytes for binary uploads" },
      mime: { type: "string", description: "Optional MIME type" },
      comment: { type: "string", description: "Optional caption posted with the file" },
      thread_ts: { type: "string", description: "Optional thread timestamp" },
      as: {
        type: "string",
        description: 'Identity: "user" (default, signed-in operator) or "bot" (Locus app)',
      },
    },
    required: ["channel", "filename"],
  },
  slack_channels: {
    type: "object",
    properties: {},
  },
  slack_history: {
    type: "object",
    properties: {
      channel: { type: "string", description: "Channel ID" },
      limit: { type: "number", description: "Max messages (default 40)" },
    },
    required: ["channel"],
  },
  slack_replies: {
    type: "object",
    properties: {
      channel: { type: "string", description: "Channel ID" },
      thread_ts: { type: "string", description: "Parent message timestamp" },
      ts: { type: "string", description: "Alias for thread_ts" },
    },
    required: ["channel"],
  },
  grafana_search: {
    type: "object",
    properties: {
      query: { type: "string" },
      q: { type: "string" },
    },
  },
  grafana_get: {
    type: "object",
    properties: {
      uid: { type: "string", description: "Dashboard uid" },
      dashboard: { type: "string" },
    },
    required: ["uid"],
  },
  grafana_query: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Lucene query from the operator prompt",
      },
      q: { type: "string", description: "Alias for query" },
      lucene: { type: "string", description: "Alias for query" },
      from: {
        type: "string",
        description: "Grafana range start. Default now-1h (now-15m, now-6h, now-7d, or ISO-8601)",
      },
      to: { type: "string", description: "Grafana range end. Default now" },
      mode: {
        type: "string",
        description: "count, logs, or both (default both)",
        enum: ["count", "logs", "both"],
      },
      limit: { type: "number", description: "Max log documents (default 25, max 200)" },
      datasource: { type: "string", description: "Elasticsearch datasource name, uid, or id" },
      explore_url_only: {
        type: "boolean",
        description: "Skip the Grafana API call and only return lucene plus explore_url",
      },
    },
    required: ["query"],
  },
  sentry_projects: {
    type: "object",
    properties: {
      org: {
        type: "string",
        description: "Organization slug (optional when the token sees one org)",
      },
      organization: { type: "string", description: "Alias for org" },
    },
  },
  sentry_search: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Sentry search query from the operator prompt (is:unresolved, level:error, …)",
      },
      q: { type: "string", description: "Alias for query" },
      org: {
        type: "string",
        description: "Organization slug (optional when the token sees one org)",
      },
      organization: { type: "string", description: "Alias for org" },
      project: { type: "string", description: "Project slug or id" },
      statsPeriod: { type: "string", description: "24h, 14d, or similar Sentry stats period" },
      limit: { type: "number", description: "Max issues (default 25, max 100)" },
      sort: { type: "string", description: "date, freq, new, or user" },
    },
  },
  sentry_get: {
    type: "object",
    properties: {
      issue: { type: "string", description: "Issue id, short id (WEB-12), or permalink" },
      issue_id: { type: "string" },
      key: { type: "string" },
      org: {
        type: "string",
        description: "Organization slug (needed for short ids when several orgs exist)",
      },
      organization: { type: "string" },
      latest: {
        type: "boolean",
        description: "Include the latest event stack (default true)",
      },
    },
  },
  sentry_events: {
    type: "object",
    properties: {
      issue: { type: "string", description: "Issue id, short id, or permalink" },
      issue_id: { type: "string" },
      key: { type: "string" },
      event: { type: "string", description: "Specific event id" },
      event_id: { type: "string" },
      latest: { type: "boolean", description: "Fetch only the latest event" },
      org: { type: "string" },
      organization: { type: "string" },
      limit: { type: "number", description: "Max events when listing (default 10, max 50)" },
    },
  },
  sentry_update: {
    type: "object",
    properties: {
      issue: { type: "string", description: "Issue id, short id, or permalink" },
      issue_id: { type: "string" },
      key: { type: "string" },
      status: {
        type: "string",
        description: "resolved, ignored, unresolved, or resolvedInNextRelease",
      },
      assignedTo: { type: "string", description: "Assignee user id, username, or me" },
      assignee: { type: "string", description: "Alias for assignedTo" },
      org: { type: "string" },
      organization: { type: "string" },
    },
  },
  miro_list: { type: "object", properties: {} },
  miro_get: {
    type: "object",
    properties: {
      board: { type: "string", description: "Miro board id" },
      board_id: { type: "string", description: "Alias for board" },
    },
    required: ["board"],
  },
  miro_import: {
    type: "object",
    properties: {
      board: { type: "string", description: "Miro board id to copy into Locus objects" },
      board_id: { type: "string" },
    },
    required: ["board"],
  },
  miro_export: {
    type: "object",
    properties: {
      board: {
        type: "string",
        description: "Destination Miro board id. Omit and pass name to create one.",
      },
      board_id: { type: "string" },
      name: { type: "string", description: "Name for a new Miro board when board is omitted" },
      objects: {
        type: "array",
        items: { type: "object" },
        description: "Locus canvas objects from board_get",
      },
    },
    required: ["objects"],
  },
  figma_list: {
    type: "object",
    properties: {
      team: {
        type: "string",
        description: "Figma team id or https://www.figma.com/files/team/… URL",
      },
      team_id: { type: "string", description: "Alias for team" },
      project: { type: "string", description: "Figma project id" },
      project_id: { type: "string" },
      url: { type: "string", description: "Team or file URL" },
    },
  },
  figma_get: {
    type: "object",
    properties: {
      file: {
        type: "string",
        description: "Figma file key or https://www.figma.com/design/… URL",
      },
      url: { type: "string", description: "Alias for file" },
      file_key: { type: "string" },
      key: { type: "string" },
      node: { type: "string", description: "Node id (1:2 or 1-2)" },
      node_id: { type: "string" },
      ids: { type: "string", description: "Comma-separated node ids" },
      depth: { type: "number", description: "How deep to walk (default 2, max 8)" },
    },
    required: ["file"],
  },
  figma_images: {
    type: "object",
    properties: {
      file: { type: "string", description: "Figma file key or URL" },
      url: { type: "string" },
      ids: {
        type: "string",
        description: "Comma-separated node ids (1:2 or 1-2). Required unless node is set.",
      },
      node: { type: "string" },
      node_id: { type: "string" },
      format: {
        type: "string",
        description: "png (default), jpg, svg, or pdf",
        enum: ["png", "jpg", "svg", "pdf"],
      },
      scale: { type: "number", description: "1–4. Default 2" },
    },
    required: ["file"],
  },
  figma_comment: {
    type: "object",
    properties: {
      file: { type: "string", description: "Figma file key or URL" },
      url: { type: "string" },
      message: { type: "string", description: "Comment text" },
      body: { type: "string", description: "Alias for message" },
      node: { type: "string", description: "Node id to pin the comment on" },
      node_id: { type: "string" },
      x: { type: "number" },
      y: { type: "number" },
    },
    required: ["file", "message"],
  },
  incidentio_search: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Filter by name, summary, or reference (INC-123)",
      },
      q: { type: "string", description: "Alias for query" },
      status_category: {
        type: "string",
        description:
          "triage, live (Active), learning (Post-incident), paused, closed, declined, canceled, merged",
      },
      status: { type: "string", description: "Status name or id" },
      severity: { type: "string", description: "Severity name or id" },
      page_size: { type: "number", description: "Page size (default 25, max 250)" },
      after: { type: "string", description: "Pagination cursor from a previous search" },
    },
  },
  incidentio_get: {
    type: "object",
    properties: {
      incident: { type: "string", description: "Incident id or reference (INC-123)" },
      id: { type: "string" },
      reference: { type: "string" },
    },
  },
  incidentio_comment: {
    type: "object",
    properties: {
      incident: { type: "string", description: "Incident id or reference (INC-123)" },
      id: { type: "string" },
      body: { type: "string", description: "Update message (markdown)" },
      message: { type: "string", description: "Alias for body" },
      comment: { type: "string", description: "Alias for body" },
      status: { type: "string", description: "Optional new status name or id" },
      severity: { type: "string", description: "Optional new severity name or id" },
    },
    required: ["body"],
  },
  incidentio_create: {
    type: "object",
    properties: {
      name: { type: "string", description: "Incident name" },
      title: { type: "string", description: "Alias for name" },
      summary: { type: "string" },
      description: { type: "string", description: "Alias for summary" },
      visibility: {
        type: "string",
        description: "public (default) or private",
        enum: ["public", "private"],
      },
      status: { type: "string", description: "Status name or id" },
      severity: { type: "string", description: "Severity name or id" },
      mode: {
        type: "string",
        description: "standard (default), retrospective, test, or tutorial",
        enum: ["standard", "retrospective", "test", "tutorial"],
      },
    },
    required: ["name"],
  },
  incidentio_update: {
    type: "object",
    properties: {
      incident: { type: "string", description: "Incident id or reference (INC-123)" },
      id: { type: "string" },
      name: { type: "string" },
      title: { type: "string", description: "Alias for name" },
      summary: { type: "string" },
      description: { type: "string", description: "Alias for summary" },
      status: { type: "string", description: "Status name or id" },
      severity: { type: "string", description: "Severity name or id" },
    },
  },
  aws_sts_identity: { type: "object", properties: {} },
  aws_iam_list: {
    type: "object",
    properties: {
      resource: {
        type: "string",
        description: "user, role, or policy (default user)",
        enum: ["user", "role", "policy"],
      },
      path_prefix: { type: "string", description: "IAM path prefix (e.g. /)" },
      marker: { type: "string", description: "Pagination marker from a truncated list" },
      max_items: { type: "number", description: "Max items (default 20, max 100)" },
    },
  },
  aws_iam_get: {
    type: "object",
    properties: {
      resource: {
        type: "string",
        description: "user, role, policy, or attached_role_policies",
        enum: ["user", "role", "policy", "attached_role_policies"],
      },
      name: { type: "string", description: "IAM user, role, or policy name" },
      arn: { type: "string", description: "Policy ARN (or alias for name)" },
    },
    required: ["resource"],
  },
  aws_iam_simulate: {
    type: "object",
    properties: {
      principal: { type: "string", description: "Principal ARN to simulate" },
      actions: {
        type: "string",
        description: "Comma-separated IAM actions (e.g. s3:GetObject,iam:PassRole)",
      },
      resources: {
        type: "string",
        description: "Optional comma-separated resource ARNs (default *)",
      },
    },
    required: ["principal", "actions"],
  },
  portainer_endpoints: { type: "object", properties: {} },
  portainer_containers: {
    type: "object",
    properties: {
      endpoint: { type: "string", description: "Portainer environment id or name" },
      endpointId: { type: "string" },
      environment: { type: "string" },
      name: { type: "string", description: "Optional container name substring filter" },
      all: {
        type: "boolean",
        description: "Include stopped containers (default true)",
      },
    },
  },
  portainer_inspect: {
    type: "object",
    properties: {
      container: { type: "string", description: "Container id or name" },
      id: { type: "string" },
      name: { type: "string" },
      endpoint: { type: "string", description: "Portainer environment id or name" },
      endpointId: { type: "string" },
    },
    required: ["container"],
  },
  portainer_logs: {
    type: "object",
    properties: {
      container: { type: "string", description: "Container id or name" },
      id: { type: "string" },
      name: { type: "string" },
      endpoint: { type: "string", description: "Portainer environment id or name" },
      endpointId: { type: "string" },
      tail: { type: "number", description: "Log lines from the end (default 100, max 500)" },
    },
    required: ["container"],
  },
  portainer_stacks: {
    type: "object",
    properties: {
      stack: { type: "string", description: "Stack id or name for details plus compose file" },
      id: { type: "string" },
      name: { type: "string" },
      endpoint: { type: "string", description: "Filter by Portainer environment id or name" },
      endpointId: { type: "string" },
    },
  },
  portainer_container_action: {
    type: "object",
    properties: {
      container: { type: "string", description: "Container id or name" },
      id: { type: "string" },
      name: { type: "string" },
      action: {
        type: "string",
        description: "start, stop, or restart",
        enum: ["start", "stop", "restart"],
      },
      endpoint: { type: "string", description: "Portainer environment id or name" },
      endpointId: { type: "string" },
    },
    required: ["container", "action"],
  },
  portainer_stack_action: {
    type: "object",
    properties: {
      stack: { type: "string", description: "Stack id or name" },
      id: { type: "string" },
      name: { type: "string" },
      action: {
        type: "string",
        description: "start or stop",
        enum: ["start", "stop"],
      },
      endpoint: { type: "string", description: "Portainer environment id or name" },
      endpointId: { type: "string" },
    },
    required: ["stack", "action"],
  },
  gmail_search: {
    type: "object",
    properties: {
      q: { type: "string", description: "Gmail search query (from:, subject:, newer_than:)" },
      query: { type: "string", description: "Alias for q" },
      max: { type: "number", description: "Max messages (default 20, max 50)" },
    },
  },
  gmail_get: {
    type: "object",
    properties: {
      id: { type: "string", description: "Gmail message id" },
      message: { type: "string", description: "Alias for id" },
    },
    required: ["id"],
  },
  gmail_send: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email, or comma-separated list" },
      subject: { type: "string" },
      body: { type: "string", description: "Plain-text body" },
      text: { type: "string", description: "Alias for body" },
      cc: { type: "string" },
      bcc: { type: "string" },
      thread_id: { type: "string", description: "Optional Gmail thread id to reply in" },
    },
    required: ["to", "subject", "body"],
  },
  calendar_list: {
    type: "object",
    properties: {
      calendar: { type: "string", description: "Calendar id (default primary)" },
      time_min: { type: "string", description: "ISO-8601 start (default now)" },
      time_max: { type: "string", description: "ISO-8601 end" },
      q: { type: "string", description: "Free-text event query" },
      query: { type: "string", description: "Alias for q" },
      calendars: {
        type: "boolean",
        description: "List calendars instead of events",
      },
      max: { type: "number", description: "Max events (default 20, max 50)" },
    },
  },
  calendar_get: {
    type: "object",
    properties: {
      event: { type: "string", description: "Event id" },
      id: { type: "string", description: "Alias for event" },
      calendar: { type: "string", description: "Calendar id (default primary)" },
    },
    required: ["event"],
  },
  calendar_create: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Event title" },
      title: { type: "string", description: "Alias for summary" },
      start: { type: "string", description: "ISO-8601 start" },
      end: { type: "string", description: "ISO-8601 end" },
      calendar: { type: "string", description: "Calendar id (default primary)" },
      description: { type: "string" },
      location: { type: "string" },
      attendees: { type: "string", description: "Comma-separated attendee emails" },
    },
    required: ["summary", "start", "end"],
  },
  drive_list: {
    type: "object",
    properties: {
      q: {
        type: "string",
        description: "Drive query (name contains 'spec', mimeType = '...'). Default: not trashed",
      },
      query: { type: "string", description: "Alias for q" },
      folder: { type: "string", description: "Limit to this folder id" },
      max: { type: "number", description: "Max files (default 20, max 50)" },
    },
  },
  drive_get: {
    type: "object",
    properties: {
      file: { type: "string", description: "Drive file id" },
      id: { type: "string", description: "Alias for file" },
    },
    required: ["file"],
  },
  drive_upload: {
    type: "object",
    properties: {
      name: { type: "string", description: "File name in Drive" },
      filename: { type: "string", description: "Alias for name" },
      content: { type: "string", description: "UTF-8 file contents when the file is text" },
      bytes_base64: { type: "string", description: "Base64 file bytes for binary uploads" },
      mime: { type: "string", description: "Optional MIME type" },
      folder: { type: "string", description: "Optional parent folder id" },
    },
    required: ["name"],
  },
  k8s_list: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        description: "Resource kind (pod, deployment, service, …). Default pod",
      },
      resource: { type: "string", description: "Alias for kind" },
      namespace: { type: "string", description: "Namespace. Omit to list cluster-wide" },
      ns: { type: "string", description: "Alias for namespace" },
      label: { type: "string", description: "labelSelector (app=web)" },
      selector: { type: "string", description: "Alias for label" },
      limit: { type: "number", description: "Max items (default 50, max 200)" },
    },
  },
  k8s_get: {
    type: "object",
    properties: {
      kind: { type: "string", description: "Resource kind (pod, deployment, secret, …)" },
      resource: { type: "string", description: "Alias for kind" },
      name: { type: "string", description: "Resource name" },
      namespace: { type: "string", description: "Namespace (default default)" },
      ns: { type: "string" },
    },
    required: ["kind", "name"],
  },
  k8s_logs: {
    type: "object",
    properties: {
      name: { type: "string", description: "Pod name" },
      pod: { type: "string", description: "Alias for name" },
      namespace: { type: "string", description: "Namespace (default default)" },
      ns: { type: "string" },
      container: { type: "string", description: "Container name when the pod has several" },
      tail: { type: "number", description: "Tail lines (default 200, max 5000)" },
      previous: { type: "boolean", description: "Previous terminated container" },
    },
    required: ["name"],
  },
  k8s_events: {
    type: "object",
    properties: {
      namespace: { type: "string", description: "Namespace. Omit for all namespaces" },
      ns: { type: "string" },
      name: { type: "string", description: "Filter by involved object name" },
      kind: { type: "string", description: "Filter by involved object kind" },
      limit: { type: "number", description: "Max events (default 50, max 200)" },
    },
  },
  k8s_apply: {
    type: "object",
    properties: {
      manifest: { type: "string", description: "JSON or YAML Kubernetes manifest" },
      yaml: { type: "string", description: "Alias for manifest" },
      json: { type: "string", description: "Alias for manifest" },
      namespace: { type: "string", description: "Override metadata.namespace" },
      ns: { type: "string" },
    },
    required: ["manifest"],
  },
  k8s_delete: {
    type: "object",
    properties: {
      kind: { type: "string", description: "Resource kind" },
      resource: { type: "string" },
      name: { type: "string", description: "Resource name" },
      namespace: { type: "string", description: "Namespace (default default)" },
      ns: { type: "string" },
    },
    required: ["kind", "name"],
  },
  k8s_scale: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        description: "Deployment, ReplicaSet, or StatefulSet (default Deployment)",
      },
      name: { type: "string", description: "Workload name" },
      namespace: { type: "string", description: "Namespace (default default)" },
      ns: { type: "string" },
      replicas: { type: "number", description: "Desired replica count" },
      count: { type: "number", description: "Alias for replicas" },
    },
    required: ["name", "replicas"],
  },
  git_stash: {
    type: "object",
    properties: {
      path: { type: "string" },
      action: { type: "string", description: "push (default) or pop", enum: ["push", "pop"] },
    },
  },
  git_revert: {
    type: "object",
    properties: {
      path: { type: "string" },
      commit: { type: "string", description: "Commit SHA or HEAD (default HEAD)" },
    },
  },
  powershell: {
    type: "object",
    properties: {
      command: { type: "string" },
      cwd: { type: "string", description: "Working directory on the guest" },
      timeout_ms: { type: "number", description: "Kill the command after this many milliseconds" },
    },
    required: ["command"],
  },
  uia_tree: {
    type: "object",
    properties: {
      title: { type: "string", description: "Window title to dump. Omit for the desktop root." },
    },
  },
  a11y_tree: {
    type: "object",
    properties: {
      title: { type: "string", description: "Filter listed windows by title substring." },
    },
  },
  start_process: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
  preview: {
    type: "object",
    properties: {
      port: {
        type: "number",
        description:
          "Guest TCP port that serves HTTP (bind 0.0.0.0). Omit on Design — the canvas-files origin is used.",
      },
      path: { type: "string", description: "Path to open, default /" },
    },
  },
  playwright: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "Page to open. Design defaults to the canvas-files origin. Automations/coding: pass a URL or call preview first.",
      },
      click: { type: "string", description: "CSS or text= locator to click" },
      clicks: {
        type: "array",
        items: { type: "string" },
        description: "Locators to click in order",
      },
      fill_selector: { type: "string", description: "CSS or text= locator to type into" },
      fill_text: { type: "string", description: "Text to type into fill_selector" },
      expect_text: { type: "string", description: "Text that must appear on the page" },
      wait_for: { type: "string", description: "CSS or text= locator to wait for" },
      steps: {
        type: "array",
        items: { type: "string" },
        description:
          'Shorthand steps: "click #x", "fill #name Alice", "expect Deploy", "wait #hud", "press ArrowRight"',
      },
      key: { type: "string", description: "Keyboard code to press (ArrowRight, Space, KeyR)" },
      press: { type: "string", description: "Alias of key" },
      viewport: {
        type: "string",
        description:
          "Viewport. desktop 1280×800, tablet 768×1024, phone 390×844, landscape 844×390.",
        enum: ["desktop", "tablet", "phone", "landscape"],
      },
      screenshot: {
        type: "boolean",
        description:
          "Capture a PNG after live steps and show it in chat. Default true after click/fill/wait. Pass false to skip, true to force a live capture.",
      },
    },
  },
  browser_tabs: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "list, new, close, or select",
        enum: ["list", "new", "close", "select"],
      },
      url: { type: "string", description: "URL for action=new" },
      targetId: { type: "string", description: "Tab id for close or select" },
    },
    required: ["action"],
  },
  browser_navigate: {
    type: "object",
    properties: {
      url: { type: "string", description: "http(s) URL to open" },
    },
    required: ["url"],
  },
  browser_snapshot: { type: "object", properties: {} },
  browser_click: {
    type: "object",
    properties: {
      ref: { type: "string", description: "Ref from the last browser_snapshot, like @e12" },
    },
    required: ["ref"],
  },
  browser_type: {
    type: "object",
    properties: {
      ref: { type: "string", description: "Ref from the last browser_snapshot, like @e12" },
      text: { type: "string" },
    },
    required: ["ref", "text"],
  },
  browser_console: { type: "object", properties: {} },
  browser_network: { type: "object", properties: {} },
  browser_pdf: {
    type: "object",
    properties: {
      save_as_filename: {
        type: "string",
        description: "Short name for the PDF. No slashes or extension.",
      },
    },
  },
  browser_trace: {
    type: "object",
    properties: {
      action: { type: "string", description: "start or stop", enum: ["start", "stop"] },
      save_as_filename: {
        type: "string",
        description: "Short name for the saved DevTools trace JSON. Only used with stop.",
      },
    },
    required: ["action"],
  },
  browser_download: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "enable downloads, list files, copy the latest file, or copy a named file",
        enum: ["enable", "list", "latest", "get"],
      },
      filename: {
        type: "string",
        description: "Download name to copy into session artifacts. Used with action=get.",
      },
    },
    required: ["action"],
  },
  board_list: { type: "object", properties: {} },
  board_get: {
    type: "object",
    properties: {
      board_id: { type: "string", description: "Board id. Defaults to this chat's board." },
      frame_id: { type: "string", description: "Optional frame to slice" },
    },
  },
  board_upsert: {
    type: "object",
    properties: {
      board_id: { type: "string" },
      objects: {
        type: "array",
        items: { type: "object" },
        description:
          "Canvas objects to create or replace by id. type: sticky, text, shape, connector, frame, card, image, table, timeline, ink, or mermaid. Optional fontSize (12-48). Optional stackId groups stickies into a stack. shape: rect, rounded, ellipse, diamond, triangle, hexagon, arrow-right, cylinder, cloud, callout, document, pill, and other BOARD_SHAPE_KINDS. table: { columns:[{id,name,kind:text|status|person|date|number|select}], rows:[{id,cells:{columnId:value}}] }. timeline: { scale:days|weeks|months, items:[{id,title,start,end}] } with YYYY-MM-DD dates. ink: { points:[{x,y}] } in object-local coordinates. mermaid: put sequenceDiagram / stateDiagram-v2 / erDiagram source in text.",
      },
    },
    required: ["objects"],
  },
  board_delete: {
    type: "object",
    properties: {
      board_id: { type: "string" },
      ids: { type: "array", items: { type: "string" }, description: "Object ids to remove" },
    },
    required: ["ids"],
  },
  board_cluster: {
    type: "object",
    properties: {
      board_id: { type: "string", description: "Board id. Defaults to this chat's board." },
      ids: {
        type: "array",
        items: { type: "string" },
        description: "Sticky ids to group by theme into frames.",
      },
    },
    required: ["ids"],
  },
  board_comment: {
    type: "object",
    properties: {
      board_id: { type: "string" },
      object_id: { type: "string" },
      body: { type: "string" },
    },
    required: ["object_id", "body"],
  },
  project_get: {
    type: "object",
    properties: {
      project_id: { type: "string", description: "Project id. Defaults to this chat's project." },
    },
  },
  project_spawn: {
    type: "object",
    properties: {
      task: { type: "string", description: "What the member should do." },
      kind: {
        type: "string",
        description: "agent (default), review, or design",
        enum: ["agent", "review", "design"],
      },
      placement: {
        type: "string",
        description: "local (this machine) or worker. Defaults to the Project Where.",
        enum: ["local", "worker"],
      },
      focus: { type: "string", description: "Glob, directory, or area to stay inside." },
      title: { type: "string" },
      role: { type: "string", description: "Optional team role for the member persona." },
      personality: { type: "string", description: "Optional personality for the member." },
    },
    required: ["task"],
  },
  project_steer: {
    type: "object",
    properties: {
      member_id: { type: "string" },
      prompt: { type: "string" },
    },
    required: ["member_id", "prompt"],
  },
  project_stop: {
    type: "object",
    properties: {
      member_id: { type: "string" },
    },
    required: ["member_id"],
  },
  project_replace: {
    type: "object",
    properties: {
      member_id: { type: "string" },
      task: { type: "string" },
      focus: { type: "string" },
      title: { type: "string" },
      role: { type: "string" },
      capabilities: { type: "array", items: { type: "string" } },
    },
    required: ["member_id", "task"],
  },
  team_directory: {
    type: "object",
    properties: {},
  },
  team_handoff: {
    type: "object",
    properties: {
      target_team_id: { type: "string", description: "Id of the receiving Swarm team." },
      target_member_id: {
        type: "string",
        description: "Optional receiving member or coordinator.",
      },
      task: { type: "string", description: "Bounded task for the receiving team." },
    },
    required: ["target_team_id", "task"],
  },
  project_collect: {
    type: "object",
    properties: {
      member_id: { type: "string" },
    },
    required: ["member_id"],
  },
  project_propose_merge: {
    type: "object",
    properties: {
      member_id: { type: "string", description: "Member session id that opened the PR." },
    },
    required: ["member_id"],
  },
  project_propose_rule: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short rule name." },
      rule: { type: "string", description: "The convention to remember." },
    },
    required: ["title", "rule"],
  },
  project_context_list: { type: "object", properties: {} },
  project_context_read: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to context/, e.g. INDEX.md" },
    },
    required: ["path"],
  },
  project_context_write: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  project_context_delete: {
    type: "object",
    properties: {
      path: { type: "string" },
    },
    required: ["path"],
  },
  team_roster: { type: "object", properties: {} },
  team_peer_status: {
    type: "object",
    properties: {
      teammate_id: { type: "string", description: "Session id of the teammate." },
      name: { type: "string", description: "Display name or title when id is unknown." },
    },
  },
  team_add_teammate: {
    type: "object",
    properties: {
      name: { type: "string", description: "Display name for the new teammate." },
      role: { type: "string", description: "Hub role, e.g. Researcher, Builder, Designer, Ops." },
      personality: { type: "string", description: "Optional personality overlay." },
      brief: { type: "string", description: "Optional master brief / instructions." },
    },
    required: ["name", "role"],
  },
  team_message: {
    type: "object",
    properties: {
      teammate_id: { type: "string", description: "Session id of the teammate." },
      name: { type: "string", description: "Display name or title when id is unknown." },
      message: { type: "string", description: "Prompt / handoff for the teammate." },
    },
    required: ["message"],
  },
};
