import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AgentSession, ChatMessage } from "@locus/shared";
import { initialState, mergeSession, patchSessionMessage, reducer } from "./store";

const ARTIFACT = "/opt/cursor/artifacts/session_merge_perf.json";
const MESSAGE_COUNT = 800;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function thread(count: number, prefix: string): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `${prefix} message ${i} ${"word ".repeat(8)}`,
    createdAt: "2020-01-01T00:00:00.000Z",
  }));
}

function sessionWith(messages: ChatMessage[], id = "s1"): AgentSession {
  return {
    id,
    title: "Host agent",
    os: "ubuntu",
    templateId: "ubuntu-24.04",
    providerId: "p",
    model: "grok-4",
    status: "running",
    messages,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
}

/** Previous merge: linear find by id on every incoming message. */
function legacyMergeSession(prev: AgentSession, next: AgentSession): AgentSession {
  const messages = next.messages.map((m) => {
    const old = prev.messages.find((x) => x.id === m.id);
    if (!old) return m;
    let nextMsg = m;
    if (old.content.length > m.content.length && old.content.startsWith(m.content)) {
      nextMsg = { ...nextMsg, content: old.content };
    }
    return nextMsg;
  });
  return { ...next, messages };
}

describe("mergeSession perf", () => {
  it("merges a long thread much cheaper than a linear id scan", () => {
    const prev = sessionWith(thread(MESSAGE_COUNT, "live"));
    const incoming = sessionWith(
      thread(MESSAGE_COUNT, "wire").map((row, i) =>
        i === MESSAGE_COUNT - 1 ? { ...row, content: "live message 799 word ".repeat(1) } : row,
      ),
    );
    const expected = mergeSession(prev, incoming);
    expect(legacyMergeSession(prev, incoming).messages[MESSAGE_COUNT - 1]?.content).toBe(
      expected.messages[MESSAGE_COUNT - 1]?.content,
    );
    expect(expected.messages).toHaveLength(MESSAGE_COUNT);

    const oldTimes: number[] = [];
    const newTimes: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      const oldStart = performance.now();
      legacyMergeSession(prev, incoming);
      oldTimes.push(performance.now() - oldStart);
      const newStart = performance.now();
      mergeSession(prev, incoming);
      newTimes.push(performance.now() - newStart);
    }

    const payload = {
      messages: MESSAGE_COUNT,
      oldMedianMs: Number(median(oldTimes).toFixed(2)),
      nextMedianMs: Number(median(newTimes).toFixed(2)),
      speedup: Number((median(oldTimes) / Math.max(median(newTimes), 0.01)).toFixed(2)),
    };
    try {
      mkdirSync("/opt/cursor/artifacts", { recursive: true });
      writeFileSync(ARTIFACT, `${JSON.stringify(payload, null, 2)}\n`);
    } catch {
      /* artifacts dir is optional outside the cloud agent */
    }
    console.log("session merge perf", payload);
    expect(median(newTimes)).toBeLessThan(median(oldTimes));
  });

  it("patches a live token cheaper than mapping the whole thread", () => {
    const messages = thread(MESSAGE_COUNT, "live");
    messages[MESSAGE_COUNT - 1] = {
      ...messages[MESSAGE_COUNT - 1]!,
      content: "partial",
    };
    let state = reducer(initialState, {
      type: "session",
      session: sessionWith(messages),
    });
    state = reducer(state, { type: "session", session: sessionWith(thread(20, "other"), "s2") });
    const target = state.sessions.find((row) => row.id === "s1")!;
    expect(target.messages[MESSAGE_COUNT - 1]?.content).toBe("partial");

    const patched = patchSessionMessage(state.sessions, "s1", `m${MESSAGE_COUNT - 1}`, (row) => ({
      ...row,
      content: row.content + " token",
    }));
    expect(patched?.find((row) => row.id === "s1")?.messages[MESSAGE_COUNT - 1]?.content).toBe(
      "partial token",
    );
    expect(patched?.find((row) => row.id === "s1")?.messages[0]).toBe(target.messages[0]);

    const oldTimes: number[] = [];
    const newTimes: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const oldStart = performance.now();
      state.sessions.map((s) => {
        if (s.id !== "s1") return s;
        return {
          ...s,
          messages: s.messages.map((m) =>
            m.id === `m${MESSAGE_COUNT - 1}` ? { ...m, content: m.content + "x" } : m,
          ),
        };
      });
      oldTimes.push(performance.now() - oldStart);
      const newStart = performance.now();
      patchSessionMessage(state.sessions, "s1", `m${MESSAGE_COUNT - 1}`, (row) => ({
        ...row,
        content: row.content + "x",
      }));
      newTimes.push(performance.now() - newStart);
    }

    const payload = {
      messages: MESSAGE_COUNT,
      oldMedianMs: Number(median(oldTimes).toFixed(3)),
      nextMedianMs: Number(median(newTimes).toFixed(3)),
      speedup: Number((median(oldTimes) / Math.max(median(newTimes), 0.001)).toFixed(2)),
    };
    try {
      mkdirSync("/opt/cursor/artifacts", { recursive: true });
      writeFileSync(
        "/opt/cursor/artifacts/session_delta_perf.json",
        `${JSON.stringify(payload, null, 2)}\n`,
      );
    } catch {
      /* artifacts dir is optional outside the cloud agent */
    }
    console.log("session delta perf", payload);
    expect(median(newTimes)).toBeLessThan(median(oldTimes));
  });
});
