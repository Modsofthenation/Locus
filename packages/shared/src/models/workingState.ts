import type { ExtraToolDef } from "./mcp.js";
import { BRAIN_TOOL_NAMES } from "./brain.js";
import { REMEMBER_TOOL_NAME } from "./memory.js";
import { SUBSCRIBE_TOOL_NAME, UNSUBSCRIBE_TOOL_NAME } from "./subscribe.js";
import type { SessionPlan } from "./plan.js";
import { SUBAGENT_KINDS } from "./subagentKind.js";
import { HOST_SESSIONS_TOOL_NAME } from "./hostSessions.js";
import { DOCKER_SWARM_TOOL_NAME } from "./dockerSwarm.js";

export const TASK_ITEM_STATUSES = ["pending", "in_progress", "done", "cancelled"] as const;
export type TaskItemStatus = (typeof TASK_ITEM_STATUSES)[number];

export function isTaskItemStatus(value: unknown): value is TaskItemStatus {
  return TASK_ITEM_STATUSES.includes(value as TaskItemStatus);
}

export interface TaskItem {
  id: string;
  text: string;
  status: TaskItemStatus;
}

export interface AgentWorkingState {
  scratchpad?: string;
  tasks?: TaskItem[];
  plan?: Array<{ id: string; text: string; status?: string }>;
}

export const SCRATCHPAD_TOOL_NAME = "scratchpad";
export const TASK_LIST_TOOL_NAME = "task_list";
export const REPO_MAP_TOOL_NAME = "repo_map";
export const SPAWN_AGENT_TOOL_NAME = "spawn_agent";

const RUNTIME_TOOL_NAMES = new Set([
  SCRATCHPAD_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
  REPO_MAP_TOOL_NAME,
  SPAWN_AGENT_TOOL_NAME,
  HOST_SESSIONS_TOOL_NAME,
  DOCKER_SWARM_TOOL_NAME,
  REMEMBER_TOOL_NAME,
  SUBSCRIBE_TOOL_NAME,
  UNSUBSCRIBE_TOOL_NAME,
  ...BRAIN_TOOL_NAMES,
]);

export function isRuntimeToolName(name: string): boolean {
  return RUNTIME_TOOL_NAMES.has(name);
}

export function isScratchpadToolName(name: string): boolean {
  return name === SCRATCHPAD_TOOL_NAME;
}

export function isTaskListToolName(name: string): boolean {
  return name === TASK_LIST_TOOL_NAME;
}

export function isRepoMapToolName(name: string): boolean {
  return name === REPO_MAP_TOOL_NAME;
}

export function isSpawnAgentToolName(name: string): boolean {
  return name === SPAWN_AGENT_TOOL_NAME;
}

export const SCRATCHPAD_TOOL: ExtraToolDef = {
  name: SCRATCHPAD_TOOL_NAME,
  description:
    "Externalize durable notes (decisions, constraints, findings) so they survive compaction. After compact, continue from these notes instead of re-reading whole files.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "read, write (replace), or append",
        enum: ["read", "write", "append"],
      },
      content: { type: "string", description: "Text to store. Required for write and append." },
    },
    required: ["action"],
  },
};

export const TASK_LIST_TOOL: ExtraToolDef = {
  name: TASK_LIST_TOOL_NAME,
  description:
    "Keep the current plan as a checklist outside working memory. Update it as you go; compaction preserves this list. Do not spend a round only updating this list once the plan is written.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "list, add, update, complete, or clear",
        enum: ["list", "add", "update", "complete", "clear"],
      },
      id: { type: "string", description: "Item id for update or complete (for example t1)." },
      text: { type: "string", description: "Item text for add or update." },
      status: {
        type: "string",
        description: "pending, in_progress, done, or cancelled",
        enum: [...TASK_ITEM_STATUSES],
      },
    },
    required: ["action"],
  },
};

export const REPO_MAP_TOOL: ExtraToolDef = {
  name: REPO_MAP_TOOL_NAME,
  description:
    "Read the workspace file tree and symbol index. The prompt already ranks likely files for this request; use query/path to zoom in, then grep (with context) or file_read paths[] on the hits.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Optional symbol or path substring to filter the map.",
      },
      path: {
        type: "string",
        description: "Optional directory prefix such as src/ or /workspace/apps.",
      },
    },
  },
};

export const SPAWN_AGENT_TOOL: ExtraToolDef = {
  name: SPAWN_AGENT_TOOL_NAME,
  description:
    "Spawn an isolated child agent. It returns a summary, not a transcript. Do not nest. Omit kind to use the session default. If the operator asked for a different kind this turn, pass that kind.",
  parameters: {
    type: "object",
    properties: {
      task: { type: "string", description: "Concrete research or exploration goal for the child." },
      focus: { type: "string", description: "Optional path or area to stay inside." },
      kind: {
        type: "string",
        enum: [...SUBAGENT_KINDS],
        description:
          "Child agent kind. Omit to use the session default. Pass this when the operator asked for a different kind this turn (explore, implement, or review).",
      },
    },
    required: ["task"],
  },
};

export const RUNTIME_TOOLS: ExtraToolDef[] = [
  SCRATCHPAD_TOOL,
  TASK_LIST_TOOL,
  REPO_MAP_TOOL,
  SPAWN_AGENT_TOOL,
];

export function formatWorkingState(state?: AgentWorkingState): string {
  const tasks = state?.tasks ?? [];
  const plan = state?.plan ?? [];
  const pad = (state?.scratchpad ?? "").trim();
  const taskLines = tasks.length
    ? tasks.map((item) => `- [${item.status}] ${item.id}: ${item.text}`).join("\n")
    : "(empty)";
  const scratch = pad ? clip(pad, 4_000) : "(empty)";
  const parts = [`Task list:\n${taskLines}`, `Scratchpad:\n${scratch}`];
  if (plan.length) {
    parts.unshift(
      `Session plan:\n${plan.map((item) => `- [${item.status ?? "pending"}] ${item.id}: ${item.text}`).join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

export function taskListFromPlan(plan: SessionPlan): TaskItem[] {
  return plan.items.slice(0, 40).map((item, index) => ({
    id: `t${index + 1}`,
    text: item.text.slice(0, 400),
    status:
      item.status === "done"
        ? "done"
        : item.status === "skipped"
          ? "cancelled"
          : item.status === "running"
            ? "in_progress"
            : "pending",
  }));
}

export function sessionWorkingState(session: {
  scratchpad?: string;
  taskList?: TaskItem[];
  plan?: SessionPlan;
}): AgentWorkingState {
  return {
    scratchpad: session.scratchpad,
    tasks: session.taskList,
    plan: session.plan?.items,
  };
}

export function applyScratchpad(
  current: string | undefined,
  args: Record<string, unknown>,
): { text: string; output: string } {
  const action = typeof args.action === "string" ? args.action.trim().toLowerCase() : "read";
  const content = typeof args.content === "string" ? args.content : "";
  if (action === "read" || !action) {
    const text = current?.trim() ? current : "(empty)";
    return { text: current ?? "", output: text };
  }
  if (action === "write") {
    const text = content.slice(0, 16_000);
    return {
      text,
      output: text.trim() ? `Scratchpad saved (${text.length} chars).` : "Scratchpad cleared.",
    };
  }
  if (action === "append") {
    const next = [current?.trim(), content.trim()].filter(Boolean).join("\n").slice(0, 16_000);
    return { text: next, output: `Scratchpad appended (${next.length} chars).` };
  }
  return { text: current ?? "", output: `Unknown scratchpad action: ${action}` };
}

export function applyTaskList(
  current: TaskItem[] | undefined,
  args: Record<string, unknown>,
): { tasks: TaskItem[]; output: string } {
  const action = typeof args.action === "string" ? args.action.trim().toLowerCase() : "list";
  const tasks = [...(current ?? [])];
  if (action === "list" || !action) {
    return { tasks, output: formatTaskList(tasks) };
  }
  if (action === "clear") {
    return { tasks: [], output: "Task list cleared." };
  }
  if (action === "add") {
    const text = typeof args.text === "string" ? args.text.trim() : "";
    if (!text) return { tasks, output: "text is required to add a task" };
    if (tasks.length >= 40) return { tasks, output: "Task list is full (40 items)." };
    const id = nextTaskId(tasks);
    const status = isTaskItemStatus(args.status) ? args.status : "pending";
    tasks.push({ id, text: text.slice(0, 400), status });
    return { tasks, output: formatTaskList(tasks) };
  }
  const id = typeof args.id === "string" ? args.id.trim() : "";
  const item = tasks.find((row) => row.id === id);
  if (!item) return { tasks, output: id ? `Unknown task id: ${id}` : "id is required" };
  if (action === "complete") {
    item.status = "done";
    return { tasks, output: formatTaskList(tasks) };
  }
  if (action === "update") {
    if (typeof args.text === "string" && args.text.trim())
      item.text = args.text.trim().slice(0, 400);
    if (isTaskItemStatus(args.status)) item.status = args.status;
    return { tasks, output: formatTaskList(tasks) };
  }
  return { tasks, output: `Unknown task_list action: ${action}` };
}

export function formatTaskList(tasks: TaskItem[]): string {
  if (!tasks.length) return "(empty task list)";
  return tasks.map((item) => `- [${item.status}] ${item.id}: ${item.text}`).join("\n");
}

export const TASK_LIST_PREVIEW_LIMIT = 6;

export function taskListDoneCount(tasks: TaskItem[]): number {
  return tasks.filter((item) => item.status === "done").length;
}

/** Window around the first open item so a long list still shows current work. */
export function previewTaskItems(
  tasks: TaskItem[],
  showAll = false,
  limit = TASK_LIST_PREVIEW_LIMIT,
): TaskItem[] {
  if (showAll || tasks.length <= limit) return tasks;
  const firstOpen = tasks.findIndex(
    (item) => item.status === "pending" || item.status === "in_progress",
  );
  const focus = firstOpen === -1 ? Math.max(0, tasks.length - limit) : Math.max(0, firstOpen - 1);
  const start = Math.min(focus, Math.max(0, tasks.length - limit));
  return tasks.slice(start, start + limit);
}

function nextTaskId(tasks: TaskItem[]): string {
  let n = tasks.length + 1;
  const used = new Set(tasks.map((item) => item.id));
  while (used.has(`t${n}`)) n += 1;
  return `t${n}`;
}

function clip(text: string, max: number): string {
  const one = text.trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

export function parseTaskItems(raw: unknown): TaskItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: TaskItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const value = row as Record<string, unknown>;
    const id = typeof value.id === "string" && value.id.trim() ? value.id.trim().slice(0, 32) : "";
    const text = typeof value.text === "string" ? value.text.trim().slice(0, 400) : "";
    if (!id || !text) continue;
    out.push({
      id,
      text,
      status: isTaskItemStatus(value.status) ? value.status : "pending",
    });
    if (out.length >= 40) break;
  }
  return out;
}
