import { describe, expect, it } from "vitest";
import {
  appendSlackReviewTraceStep,
  finishSlackReviewTraceTool,
  isSlackReviewTraceId,
  SLACK_REVIEW_TRACE_LIMITS,
  slackReviewTraceArgs,
  summarizeSlackReviewTrace,
  type SlackReviewTrace,
} from "./slackReviewTrace.js";

const at = "2026-11-21T00:00:00.000Z";

function empty(): Pick<SlackReviewTrace, "steps" | "truncated"> {
  return { steps: [] };
}

describe("slack review trace", () => {
  it("joins streamed chunks of the same kind and splits on a change of kind", () => {
    const trace = empty();
    appendSlackReviewTraceStep(trace, { kind: "thinking", text: "a", at });
    appendSlackReviewTraceStep(trace, { kind: "thinking", text: "b", at });
    appendSlackReviewTraceStep(trace, { kind: "text", text: "c", at });
    appendSlackReviewTraceStep(trace, { kind: "thinking", text: "d", at });
    expect(trace.steps).toEqual([
      { kind: "thinking", text: "ab", at },
      { kind: "text", text: "c", at },
      { kind: "thinking", text: "d", at },
    ]);
    expect(trace.truncated).toBeUndefined();
  });

  it("clips long text, args and output and marks the trace truncated", () => {
    const trace = empty();
    const long = "x".repeat(SLACK_REVIEW_TRACE_LIMITS.maxText + 10);
    expect(appendSlackReviewTraceStep(trace, { kind: "text", text: long, at })).toBe(true);
    expect((trace.steps[0] as { text: string }).text).toHaveLength(
      SLACK_REVIEW_TRACE_LIMITS.maxText + 1,
    );
    // Further chunks onto a full step are dropped.
    appendSlackReviewTraceStep(trace, { kind: "text", text: "more", at });
    expect((trace.steps[0] as { text: string }).text.endsWith("more")).toBe(false);
    appendSlackReviewTraceStep(trace, {
      kind: "tool",
      id: "t",
      tool: "grep",
      args: "a".repeat(SLACK_REVIEW_TRACE_LIMITS.maxArgs + 5),
      at,
    });
    expect((trace.steps[1] as { args: string }).args).toHaveLength(
      SLACK_REVIEW_TRACE_LIMITS.maxArgs + 1,
    );
    expect(trace.truncated).toBe(true);
  });

  it("stops adding steps at the step cap", () => {
    const trace = empty();
    for (let i = 0; i < SLACK_REVIEW_TRACE_LIMITS.maxSteps + 3; i++) {
      appendSlackReviewTraceStep(trace, { kind: "note", text: `n${i}`, at });
    }
    expect(trace.steps).toHaveLength(SLACK_REVIEW_TRACE_LIMITS.maxSteps);
    expect(trace.truncated).toBe(true);
  });

  it("puts a tool's output on its call, or adds a step for a result with no call", () => {
    const trace = empty();
    appendSlackReviewTraceStep(trace, { kind: "tool", id: "t1", tool: "read_file", at });
    finishSlackReviewTraceTool(trace, { id: "t1", output: "body", at });
    finishSlackReviewTraceTool(trace, { id: "t9", tool: "grep", output: "hit", refused: true, at });
    expect(trace.steps).toEqual([
      { kind: "tool", id: "t1", tool: "read_file", output: "body", at },
      { kind: "tool", id: "t9", tool: "grep", output: "hit", refused: true, at },
    ]);
    expect(summarizeSlackReviewTrace(trace)).toEqual({ thinking: 0, tools: 2, refused: 1 });
  });

  it("formats args and accepts only UUID ids", () => {
    expect(slackReviewTraceArgs({})).toBeUndefined();
    expect(slackReviewTraceArgs({ path: "a.ts" })).toBe('{"path":"a.ts"}');
    expect(isSlackReviewTraceId("3f2b8c1e-1d2a-4c3b-9e8f-0a1b2c3d4e5f")).toBe(true);
    expect(isSlackReviewTraceId("../state")).toBe(false);
  });
});
