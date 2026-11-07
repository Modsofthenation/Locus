import type { TaskItem } from "./workingState.js";

export const PLAN_STEP_STATUSES = ["pending", "running", "done", "skipped"] as const;
export type PlanStepStatus = (typeof PLAN_STEP_STATUSES)[number];

export function isPlanStepStatus(value: unknown): value is PlanStepStatus {
  return PLAN_STEP_STATUSES.includes(value as PlanStepStatus);
}

export const PLAN_OWNERS = ["model", "operator"] as const;
export type PlanOwner = (typeof PLAN_OWNERS)[number];

export const PLAN_PHASES = ["proposed", "accepted"] as const;
export type PlanPhase = (typeof PLAN_PHASES)[number];

export function isPlanPhase(value: unknown): value is PlanPhase {
  return value === "proposed" || value === "accepted";
}

/** Read-only tools allowed while /plan is grounding a proposed plan. `exec` is extra when safe. */
export const PLAN_READ_TOOLS = new Set([
  "grep",
  "glob",
  "file_read",
  "file_list",
  "repo_map",
  "git_diff",
  "git_log",
  "git_status",
  "mcp_list_tools",
  "mcp_get_tool_info",
  "read_skill",
  "ask_user",
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
  "board_list",
  "board_get",
  "project_get",
  "project_context_list",
  "project_context_read",
  "task_list",
  "orient",
  "find_entity",
  "get_entity",
  "search_knowledge",
  "host_sessions",
  "canvas_read",
]);

export function isPlanReadTool(name: string): boolean {
  return PLAN_READ_TOOLS.has(name);
}

export function planPhase(plan?: Pick<SessionPlan, "phase"> | null): PlanPhase {
  return plan?.phase === "proposed" ? "proposed" : "accepted";
}

export function acceptPlan(plan: SessionPlan): SessionPlan {
  return { ...plan, phase: "accepted" };
}

export function isPlanOwner(value: unknown): value is PlanOwner {
  return value === "model" || value === "operator";
}

/** Tools that count as finishing the current plan step. Reads do not. */
export const PLAN_ADVANCE_TOOLS = new Set([
  "apply_patch",
  "file_write",
  "git_commit",
  "git_push",
  "git_pr",
  "git_pr_review",
  "git_pr_comment",
  "git_pr_merge",
  "git_issue_comment",
  "git_branch",
  "git_stash",
  "git_revert",
  "start_process",
  "preview",
]);

export function planToolAdvances(name: string): boolean {
  return PLAN_ADVANCE_TOOLS.has(name);
}

export interface PlanItem {
  id: string;
  text: string;
  status?: PlanStepStatus;
  owner?: PlanOwner;
}

export interface SessionPlan {
  items: PlanItem[];
  messageId?: string;
  /** New /plan output starts proposed. Missing phase is treated as accepted. */
  phase?: PlanPhase;
  files?: string[];
  risks?: string[];
}

export function parsePlanFilesAndRisks(text: string): { files: string[]; risks: string[] } {
  const files: string[] = [];
  const risks: string[] = [];
  let section: "files" | "risks" | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^files\s*:/i.test(line)) {
      section = "files";
      const rest = line.replace(/^files\s*:\s*/i, "").trim();
      if (rest) files.push(rest);
      continue;
    }
    if (/^risks\s*:/i.test(line)) {
      section = "risks";
      const rest = line.replace(/^risks\s*:\s*/i, "").trim();
      if (rest) risks.push(rest);
      continue;
    }
    if (/^(steps|plan|checklist)\s*:/i.test(line)) {
      section = undefined;
      continue;
    }
    const item = line.match(/^(?:[-*]|\d+[.)])\s+(.+)$/);
    if (!section || !item?.[1]) continue;
    const target = section === "files" ? files : risks;
    target.push(item[1].trim());
  }
  return { files: uniqueMeta(files, 40), risks: uniqueMeta(risks, 20) };
}

function uniqueMeta(values: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

export function parsePlanItems(text: string): string[] {
  const items: string[] = [];
  let inFence = false;
  let skipSection = false;
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const trimmed = raw.trim();
    if (/^(files|risks)\s*:/i.test(trimmed)) {
      skipSection = true;
      continue;
    }
    if (/^(steps|plan|checklist)\s*:/i.test(trimmed)) {
      skipSection = false;
      continue;
    }
    if (skipSection) continue;
    const match = trimmed.match(/^(?:\d+[.)]|[-*])\s+(.+)$/);
    if (match?.[1]?.trim()) items.push(match[1].trim());
  }
  return items;
}

export function planFromAssistant(text: string, messageId?: string): SessionPlan | undefined {
  const lines = parsePlanItems(text);
  const { files, risks } = parsePlanFilesAndRisks(text);
  if (!lines.length && !files.length && !risks.length) return undefined;
  if (!lines.length) {
    return {
      messageId,
      phase: "proposed",
      items: [],
      ...(files.length ? { files } : {}),
      ...(risks.length ? { risks } : {}),
    };
  }
  return {
    messageId,
    phase: "proposed",
    items: lines.map((item, index) => ({ id: `p${index + 1}`, text: item, status: "pending" })),
    ...(files.length ? { files } : {}),
    ...(risks.length ? { risks } : {}),
  };
}

/** Checklist rows a single /plan turn may hand to the operator's plan card. */
export const MAX_PLAN_ITEMS = 20;

function planStatusFromTask(status: TaskItem["status"]): PlanStepStatus {
  if (status === "done") return "done";
  if (status === "cancelled") return "skipped";
  return "pending";
}

function normalizeStepText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function nextPlanId(items: PlanItem[]): string {
  const max = items.reduce((n, item) => Math.max(n, Number(item.id.slice(1)) || 0), 0);
  return `p${max + 1}`;
}

/**
 * Rows added or rewritten during this turn. Leftover session tasks from
 * earlier work are ignored so a /plan card does not inherit them.
 */
export function tasksTrackedThisTurn(
  before: ReadonlyArray<Pick<TaskItem, "id" | "text" | "status">> | null | undefined,
  after: ReadonlyArray<Pick<TaskItem, "id" | "text" | "status">> | null | undefined,
): Array<Pick<TaskItem, "text" | "status">> {
  const start = new Map((before ?? []).map((row) => [row.id, row]));
  return (after ?? []).filter((row) => {
    const prev = start.get(row.id);
    return !prev || prev.text !== row.text;
  });
}

/**
 * Fold the task_list calls made during a /plan turn into the parsed plan so
 * the operator sees one approvable artifact instead of two lists. Parsed
 * prose steps stay; task rows refine matching step statuses and append
 * anything the prose missed. Pass only this turn's rows (see
 * tasksTrackedThisTurn). No tasks and no parsed list means no card.
 */
export function planFromTurnTasks(
  plan: SessionPlan | undefined,
  tasks?: ReadonlyArray<Pick<TaskItem, "text" | "status">> | null,
): SessionPlan {
  const rows = (tasks ?? []).filter((task) => task.text.trim()).slice(0, MAX_PLAN_ITEMS);
  if (!rows.length) return plan ?? { items: [], phase: "proposed" };
  const items: PlanItem[] = (plan?.items ?? [])
    .slice(0, MAX_PLAN_ITEMS)
    .map((item) => ({ ...item }));
  for (const task of rows) {
    const key = normalizeStepText(task.text);
    const match = items.find((item) => normalizeStepText(item.text) === key);
    if (match) {
      match.status = planStatusFromTask(task.status);
      continue;
    }
    if (items.length >= MAX_PLAN_ITEMS) break;
    items.push({
      id: nextPlanId(items),
      text: task.text.slice(0, 400),
      status: planStatusFromTask(task.status),
    });
  }
  return { ...(plan ?? {}), phase: "proposed", items };
}

export function firstRunnableIndex(plan: SessionPlan, fromIndex = 0): number {
  return plan.items.findIndex(
    (item, index) => index >= fromIndex && item.status !== "skipped" && item.status !== "done",
  );
}

export function startPlanRun(plan: SessionPlan, fromIndex = 0): SessionPlan {
  const start = firstRunnableIndex(plan, fromIndex);
  return {
    ...plan,
    items: plan.items.map((item, index) => {
      if (item.status === "skipped") return item;
      if (start < 0) return item;
      if (index < start) return { ...item, status: item.status === "done" ? "done" : "skipped" };
      if (index === start) return { ...item, status: "running" };
      return { ...item, status: item.status === "done" ? "done" : "pending" };
    }),
  };
}

export function advancePlanOnTool(plan: SessionPlan, toolName?: string): SessionPlan {
  if (toolName && !planToolAdvances(toolName)) return plan;
  const items = plan.items.map((item) => ({ ...item }));
  const running = items.findIndex((item) => item.status === "running");
  if (running >= 0) {
    if (items[running]!.owner === "operator") return plan;
    items[running]!.status = "done";
    const next = items.findIndex(
      (item, index) => index > running && item.status !== "skipped" && item.status !== "done",
    );
    if (next >= 0) items[next]!.status = "running";
  }
  return { ...plan, items };
}

export function startPlanStepOnly(plan: SessionPlan, index: number): SessionPlan {
  return {
    ...plan,
    items: plan.items.map((item, i) => {
      if (item.status === "skipped") return item;
      if (i === index) return { ...item, status: "running" };
      if (item.status === "running") return { ...item, status: "pending" };
      return item;
    }),
  };
}

export function formatPlanStepPrompt(plan: SessionPlan, index: number): string {
  const item = plan.items[index];
  if (!item) return formatPlanRunPrompt(plan, index);
  return [
    `Execute only step ${index + 1}, then stop. Do not continue to later steps.`,
    `${index + 1}. ${item.text}`,
  ].join("\n");
}

export function formatPlanRunPrompt(plan: SessionPlan, fromIndex = 0): string {
  const start = firstRunnableIndex(plan, fromIndex);
  const rows = plan.items
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item, index }) => index >= (start < 0 ? fromIndex : start) && item.status !== "skipped",
    );
  return [
    start > 0
      ? `Execute this plan starting at step ${start + 1}. Do the work now with tools; do not only restate the steps.`
      : "Execute this plan. Do the work now with tools; do not only restate the steps.",
    ...rows.map(({ item, index }) => `${index + 1}. ${item.text}`),
  ].join("\n");
}

/** `undefined` if this is not a /plan command, `null` to arm plan mode, or the task text. */
export function parsePlanCommand(text: string): string | null | undefined {
  const trimmed = text.trim();
  if (!/^\/plan(?:\s|$)/i.test(trimmed)) return undefined;
  const rest = trimmed.replace(/^\/plan\s*/i, "").trim();
  return rest || null;
}
