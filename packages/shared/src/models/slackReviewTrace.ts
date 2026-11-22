/**
 * Slack PR reviewer trace: what the model thought and did during one review or thread answer —
 * the prompt it was given, its reasoning, the files it read or searched (with what came back),
 * and the reply it wrote. Settings → Reviewers shows it on each run so a reviewer's verdict can
 * be checked against how it got there.
 *
 * Traces live beside the reviewer state as one JSON file per run, not inside `state.json`, and
 * are capped so a long CLI run can't grow without bound.
 */

/** One step of a trace, in the order it happened. */
export type SlackReviewTraceStep =
  /** The user message the model was given (the system prompt is the reviewer's settings). */
  | { kind: "prompt"; text: string; at: string }
  /** Model reasoning / extended thinking, when the provider streams it. */
  | { kind: "thinking"; text: string; at: string }
  /** Reply text the model wrote. */
  | { kind: "text"; text: string; at: string }
  /** A tool the model called, with its arguments and (once it ran) its output. */
  | {
      kind: "tool";
      id: string;
      tool: string;
      args?: string;
      output?: string;
      /** The call was refused (round or cost budget spent, or not an allowed tool). */
      refused?: boolean;
      at: string;
    }
  /** Something the service did between model calls: a retry, the next part of a split PR. */
  | { kind: "note"; text: string; at: string };

/** A run's trace, as `GET /api/slack/reviewers/traces/:id` returns it. */
export interface SlackReviewTrace {
  id: string;
  reviewerId: string;
  pr: string;
  kind: "review" | "answer";
  /** Provider and model label, once known. */
  model?: string;
  startedAt: string;
  /** Unset while the run is still going. */
  finishedAt?: string;
  steps: SlackReviewTraceStep[];
  /** Steps or text were dropped to stay under the caps. */
  truncated?: boolean;
  /** The run is still in progress; poll again for more steps. */
  live?: boolean;
}

export const SLACK_REVIEW_TRACE_LIMITS = {
  /** Steps kept per trace. Later steps are dropped and `truncated` is set. */
  maxSteps: 400,
  /** Characters kept per prompt, thinking or text step. */
  maxText: 40_000,
  /** Characters kept of a tool call's arguments (as JSON). */
  maxArgs: 2_000,
  /** Characters kept of a tool call's output. */
  maxOutput: 6_000,
  /** Trace files kept on disk; the oldest go first. */
  maxFiles: 200,
} as const;

/** Trace ids are UUIDs; anything else is refused before it reaches a file path. */
export function isSlackReviewTraceId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function clip(text: string, max: number): { text: string; clipped: boolean } {
  if (text.length <= max) return { text, clipped: false };
  return { text: `${text.slice(0, max)}…`, clipped: true };
}

/**
 * Append a step to a trace in place. Streamed thinking and text arrive in small chunks: a chunk
 * of the same kind as the last step extends it rather than adding a step. Text is clipped to the
 * limits; returns whether anything was dropped.
 */
export function appendSlackReviewTraceStep(
  trace: Pick<SlackReviewTrace, "steps" | "truncated">,
  step: SlackReviewTraceStep,
): boolean {
  const limits = SLACK_REVIEW_TRACE_LIMITS;
  const last = trace.steps.at(-1);
  if ((step.kind === "thinking" || step.kind === "text") && last?.kind === step.kind) {
    if (last.text.length >= limits.maxText) {
      trace.truncated = true;
      return true;
    }
    const merged = clip(last.text + step.text, limits.maxText);
    last.text = merged.text;
    if (merged.clipped) trace.truncated = true;
    return merged.clipped;
  }
  if (trace.steps.length >= limits.maxSteps) {
    trace.truncated = true;
    return true;
  }
  let clipped = false;
  if (step.kind === "tool") {
    const args = step.args === undefined ? undefined : clip(step.args, limits.maxArgs);
    const output = step.output === undefined ? undefined : clip(step.output, limits.maxOutput);
    clipped = Boolean(args?.clipped || output?.clipped);
    trace.steps.push({
      ...step,
      ...(args ? { args: args.text } : {}),
      ...(output ? { output: output.text } : {}),
    });
  } else {
    if (!step.text) return false;
    const body = clip(step.text, limits.maxText);
    clipped = body.clipped;
    trace.steps.push({ ...step, text: body.text });
  }
  if (clipped) trace.truncated = true;
  return clipped;
}

/**
 * Record a tool call's output on the step that started it (matched by id, newest first). A
 * result with no matching call — some CLIs report only the result — becomes its own step.
 */
export function finishSlackReviewTraceTool(
  trace: Pick<SlackReviewTrace, "steps" | "truncated">,
  result: { id: string; tool?: string; output: string; refused?: boolean; at: string },
): void {
  const output = clip(result.output, SLACK_REVIEW_TRACE_LIMITS.maxOutput);
  if (output.clipped) trace.truncated = true;
  for (let i = trace.steps.length - 1; i >= 0; i--) {
    const step = trace.steps[i]!;
    if (step.kind === "tool" && step.id === result.id && step.output === undefined) {
      step.output = output.text;
      if (result.refused) step.refused = true;
      return;
    }
  }
  appendSlackReviewTraceStep(trace, {
    kind: "tool",
    id: result.id,
    tool: result.tool ?? "tool",
    output: result.output,
    ...(result.refused ? { refused: true } : {}),
    at: result.at,
  });
}

/** Tool arguments as one line of JSON for the trace, or undefined when there are none. */
export function slackReviewTraceArgs(
  args: Record<string, unknown> | undefined,
): string | undefined {
  if (!args || !Object.keys(args).length) return undefined;
  try {
    return JSON.stringify(args);
  } catch {
    return undefined;
  }
}

/** Counts for a trace's summary line: thinking blocks, tool calls, refused calls. */
export function summarizeSlackReviewTrace(trace: Pick<SlackReviewTrace, "steps">): {
  thinking: number;
  tools: number;
  refused: number;
} {
  let thinking = 0;
  let tools = 0;
  let refused = 0;
  for (const step of trace.steps) {
    if (step.kind === "thinking") thinking++;
    else if (step.kind === "tool") {
      tools++;
      if (step.refused) refused++;
    }
  }
  return { thinking, tools, refused };
}
