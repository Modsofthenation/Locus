import type { ExtraToolDef } from "./mcp.js";

export const ASK_USER_NAME = "ask_user";
export const ASK_USER_MAX_QUESTIONS = 6;

export interface AskUserItem {
  id: string;
  question: string;
  choices: string[];
  allowFreeText: boolean;
}

export const ASK_USER_TOOL: ExtraToolDef = {
  name: ASK_USER_NAME,
  description:
    "Pause and ask the operator one question or a short series. Use when a decision, a missing product requirement, or an unclear outcome would change the work. Prefer questions[] (typically 3–5, each with suggested choices) instead of many separate calls. Do not use this to report progress.",
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description:
          "The question to show, or a short heading when questions[] is a series (for example “A few details before the first draft”).",
      },
      choices: {
        type: "array",
        description:
          "Optional suggested answers for a single question. The operator may pick one or type their own.",
      },
      allowFreeText: {
        type: "boolean",
        description:
          "If true, show a text field in addition to choices. Defaults to true when choices are absent.",
      },
      questions: {
        type: "array",
        description:
          "Ask 2–6 questions in one pause. Each entry is { question, choices?, allowFreeText? } or a string. Use this when several gaps would change the design or outcome. Do not also write the canvas in the same tool round.",
      },
    },
    required: ["question"],
  },
};

export function isAskUserToolName(name: string): boolean {
  return name === ASK_USER_NAME;
}

/** Unwrap nested / stringified `ask_user` payloads models sometimes emit. */
export function normalizeAskUserArgs(
  args: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return coerceAskUserFields(unwrapAskUserPayload(args ?? {}, 0));
}

export function askUserQuestion(args: Record<string, unknown> | undefined): string {
  const question = normalizeAskUserArgs(args).question;
  return typeof question === "string" ? question.trim() : "";
}

export function askUserChoices(args: Record<string, unknown> | undefined): string[] {
  return uniqueStrings(normalizeAskUserArgs(args).choices, 8);
}

export function askUserAllowsFreeText(args: Record<string, unknown> | undefined): boolean {
  const normalized = normalizeAskUserArgs(args);
  return allowsFreeText(normalized, uniqueStrings(normalized.choices, 8).length);
}

/** Heading shown above a series. Empty when `question` is the only question. */
export function askUserIntro(args: Record<string, unknown> | undefined): string {
  const normalized = normalizeAskUserArgs(args);
  const items = parseQuestionList(normalized);
  if (!items.length) return "";
  return typeof normalized.question === "string" ? normalized.question.trim() : "";
}

export function askUserItems(args: Record<string, unknown> | undefined): AskUserItem[] {
  const normalized = normalizeAskUserArgs(args);
  const listed = parseQuestionList(normalized);
  if (listed.length) {
    return listed.map((item, i) => toItem(item, i)).filter((item) => item.question);
  }
  const question = typeof normalized.question === "string" ? normalized.question.trim() : "";
  if (!question) return [];
  const choices = uniqueStrings(normalized.choices, 8);
  return [
    {
      id: "q1",
      question,
      choices,
      allowFreeText: allowsFreeText(normalized, choices.length),
    },
  ];
}

export function formatAskUserReply(items: AskUserItem[], answers: Record<string, string>): string {
  return items
    .map((item, i) => {
      const answer = (answers[item.id] ?? "").trim() || "(no answer)";
      return `${i + 1}. ${item.question}\n${answer}`;
    })
    .join("\n\n");
}

function unwrapAskUserPayload(
  args: Record<string, unknown>,
  depth: number,
): Record<string, unknown> {
  if (depth > 3) return args;
  const listed = parseQuestionList(args);
  if (listed.length) return args;

  const question = args.question;
  if (typeof question === "string") {
    const trimmed = question.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const nested = asObject(trimmed);
      if (nested && (nested.questions != null || nested.question != null)) {
        return unwrapAskUserPayload(nested, depth + 1);
      }
    }
    if (typeof args.questions !== "string") return args;
  }

  for (const key of ["ask_user", "askUser", "_raw", "value"] as const) {
    if (args[key] == null) continue;
    const nested = asObject(args[key]);
    if (nested) return unwrapAskUserPayload(nested, depth + 1);
  }
  return args;
}

function coerceAskUserFields(args: Record<string, unknown>): Record<string, unknown> {
  const next = { ...args };
  if (typeof next.questions === "string") {
    const parsed = parseJson(next.questions);
    if (Array.isArray(parsed)) next.questions = parsed;
  }
  if (typeof next.choices === "string") {
    const parsed = parseJson(next.choices);
    if (Array.isArray(parsed)) next.choices = parsed;
  }
  return next;
}

function parseQuestionList(args: Record<string, unknown> | undefined): unknown[] {
  const value = args?.questions;
  if (typeof value === "string") {
    const parsed = parseJson(value);
    if (Array.isArray(parsed)) return parsed.slice(0, ASK_USER_MAX_QUESTIONS);
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.slice(0, ASK_USER_MAX_QUESTIONS);
}

function toItem(raw: unknown, index: number): AskUserItem {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
      const nested = asObject(trimmed);
      if (nested) return toItem(nested, index);
    }
    return { id: `q${index + 1}`, question: trimmed, choices: [], allowFreeText: true };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { id: `q${index + 1}`, question: "", choices: [], allowFreeText: true };
  }
  const row = coerceAskUserFields(raw as Record<string, unknown>);
  const question = typeof row.question === "string" ? row.question.trim() : "";
  const id =
    typeof row.id === "string" && row.id.trim() ? row.id.trim().slice(0, 32) : `q${index + 1}`;
  const choices = uniqueStrings(row.choices, 8);
  return { id, question, choices, allowFreeText: allowsFreeText(row, choices.length) };
}

function allowsFreeText(row: Record<string, unknown> | undefined, choiceCount: number): boolean {
  if (isTruthyFlag(row?.allowFreeText)) return true;
  if (isFalseyFlag(row?.allowFreeText)) return choiceCount === 0;
  return choiceCount === 0;
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === "true";
}

function isFalseyFlag(value: unknown): boolean {
  return value === false || value === "false";
}

function uniqueStrings(value: unknown, cap: number): string[] {
  if (typeof value === "string") {
    const parsed = parseJson(value);
    if (Array.isArray(parsed)) return uniqueStrings(parsed, cap);
    return [];
  }
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (text && !out.includes(text)) out.push(text);
  }
  return out.slice(0, cap);
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return undefined;
  const parsed = parseJson(value.trim());
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  if (typeof parsed === "string") return asObject(parsed);
  return undefined;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
