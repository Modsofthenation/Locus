import { ASK_USER_MAX_QUESTIONS } from "./askUser.js";
import {
  MAX_PLAN_ITEMS,
  parsePlanFilesAndRisks,
  planFromAssistant,
  type PlanItem,
  type PlanStepStatus,
  type SessionPlan,
} from "./plan.js";

export const CURSOR_CREATE_PLAN_TOOL = "createPlan";
export const CURSOR_SWITCH_MODE_TOOL = "switchMode";

function foldToolName(name: string): string {
  return name.trim().replace(/[_-]/g, "").toLowerCase();
}

export function isCursorCreatePlanTool(name: string): boolean {
  return foldToolName(name) === "createplan";
}

export function isCursorAskQuestionTool(name: string): boolean {
  return foldToolName(name) === "askquestion";
}

export function isCursorSwitchModeTool(name: string): boolean {
  return foldToolName(name) === "switchmode";
}

/** createPlan / switchMode land on the plan card, not as tool chips. */
export function isHiddenCursorPlanTool(name: string): boolean {
  return isCursorCreatePlanTool(name) || isCursorSwitchModeTool(name);
}

export function cursorSwitchedToPlan(args: Record<string, unknown> | undefined): boolean {
  const mode = String(
    args?.targetModeId ?? args?.target_mode_id ?? args?.toModeId ?? args?.mode ?? "",
  )
    .trim()
    .toLowerCase();
  return mode === "plan";
}

export function messageProposesCursorPlan(
  message?: {
    toolCalls?: ReadonlyArray<{ name: string; arguments?: Record<string, unknown> }>;
  } | null,
): boolean {
  const calls = message?.toolCalls ?? [];
  if (calls.some((call) => isCursorCreatePlanTool(call.name))) return true;
  return calls.some(
    (call) => isCursorSwitchModeTool(call.name) && cursorSwitchedToPlan(call.arguments),
  );
}

export function shouldFinishCursorPlanTurn(
  planTurn: boolean,
  message?: {
    toolCalls?: ReadonlyArray<{ name: string; arguments?: Record<string, unknown> }>;
  } | null,
): boolean {
  return planTurn || messageProposesCursorPlan(message);
}

export function planFromCursorCreatePlan(
  args: Record<string, unknown> | undefined,
  messageId?: string,
): SessionPlan | undefined {
  if (!args) return undefined;
  const items: PlanItem[] = [];
  const todos = Array.isArray(args.todos) ? args.todos : [];
  for (const raw of todos) {
    if (items.length >= MAX_PLAN_ITEMS) break;
    const todo = cursorTodoItem(raw);
    if (!todo) continue;
    items.push({ id: `p${items.length + 1}`, text: todo.text, status: todo.status });
  }
  const planText =
    (typeof args.plan === "string" && args.plan) ||
    (typeof args.overview === "string" && args.overview) ||
    "";
  const { files, risks } = parsePlanFilesAndRisks(planText);
  if (!items.length && planText) {
    const parsed = planFromAssistant(planText, messageId);
    if (parsed) {
      return {
        ...parsed,
        messageId,
        phase: "proposed",
        ...(files.length ? { files } : {}),
        ...(risks.length ? { risks } : {}),
      };
    }
  }
  if (!items.length && !files.length && !risks.length) return undefined;
  return {
    messageId,
    phase: "proposed",
    items,
    ...(files.length ? { files } : {}),
    ...(risks.length ? { risks } : {}),
  };
}

export function planFromCursorToolCalls(
  calls: ReadonlyArray<{ name: string; arguments?: Record<string, unknown> }> | undefined,
  messageId?: string,
): SessionPlan | undefined {
  if (!calls?.length) return undefined;
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const call = calls[i]!;
    if (!isCursorCreatePlanTool(call.name)) continue;
    const plan = planFromCursorCreatePlan(call.arguments, messageId);
    if (plan) return plan;
  }
  return undefined;
}

export function askUserArgsFromCursorAskQuestion(
  args: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const title =
    (typeof args?.title === "string" && args.title.trim()) ||
    (typeof args?.question === "string" && args.question.trim()) ||
    "";
  const listed = Array.isArray(args?.questions) ? args.questions : [];
  const questions = listed
    .slice(0, ASK_USER_MAX_QUESTIONS)
    .map((row) => cursorAskQuestionItem(row))
    .filter((row) => row.question);
  if (questions.length) {
    return {
      question: title || questions[0]!.question,
      questions,
    };
  }
  if (title) return { question: title };
  return args ?? {};
}

function cursorTodoItem(raw: unknown): { text: string; status: PlanStepStatus } | undefined {
  if (typeof raw === "string") {
    const text = raw.trim();
    return text ? { text: text.slice(0, 400), status: "pending" } : undefined;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const text = [row.content, row.text, row.title, row.task].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  if (!text?.trim()) return undefined;
  return { text: text.trim().slice(0, 400), status: cursorTodoStatus(row.status) };
}

function cursorTodoStatus(value: unknown): PlanStepStatus {
  const raw = String(value ?? "").toUpperCase();
  if (raw.includes("CANCEL") || raw.includes("SKIP")) return "skipped";
  if (raw.includes("COMPLETE") || raw.includes("DONE")) return "done";
  if (raw.includes("PROGRESS") || raw.includes("RUNNING")) return "running";
  return "pending";
}

function cursorAskQuestionItem(raw: unknown): {
  id?: string;
  question: string;
  choices: string[];
  allowFreeText: boolean;
} {
  if (typeof raw === "string") {
    return { question: raw.trim(), choices: [], allowFreeText: true };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { question: "", choices: [], allowFreeText: true };
  }
  const row = raw as Record<string, unknown>;
  const question =
    (typeof row.prompt === "string" && row.prompt.trim()) ||
    (typeof row.question === "string" && row.question.trim()) ||
    "";
  const id = typeof row.id === "string" && row.id.trim() ? row.id.trim().slice(0, 32) : undefined;
  const options = Array.isArray(row.options)
    ? row.options
    : Array.isArray(row.choices)
      ? row.choices
      : [];
  const choices: string[] = [];
  for (const option of options) {
    if (typeof option === "string" && option.trim()) {
      choices.push(option.trim());
      continue;
    }
    if (!option || typeof option !== "object" || Array.isArray(option)) continue;
    const label = (option as { label?: unknown }).label;
    if (typeof label === "string" && label.trim()) choices.push(label.trim());
  }
  return {
    ...(id ? { id } : {}),
    question,
    choices: choices.slice(0, 8),
    allowFreeText: row.allowMultiple === true || choices.length === 0,
  };
}
