import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./session.js";
import {
  appendThinkingText,
  clusterChatThread,
  formatThinkingSnippet,
  formatWaitElapsed,
  flushThinkTaggedText,
  localModelWaitHint,
  localModelWaitLabel,
  splitThinkTaggedText,
  showThoughtTraces,
  turnToolCalls,
} from "./chatThread.js";

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role">): ChatMessage {
  return { content: "", createdAt: "2020-01-01T00:00:00.000Z", ...partial };
}

describe("clusterChatThread", () => {
  it("folds tool results under the assistant that issued them", () => {
    const user = msg({ id: "u", role: "user", content: "fix it" });
    const assistant = msg({
      id: "a",
      role: "assistant",
      content: "Looking at the chat pane.",
      toolCalls: [{ id: "c1", name: "exec", arguments: { command: "grep cors" }, startedAt: "t" }],
    });
    const tool = msg({ id: "t", role: "tool", toolCallId: "c1", content: "hit" });
    const clusters = clusterChatThread([user, assistant, tool]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toMatchObject({ kind: "single", message: user });
    expect(clusters[1]).toMatchObject({ kind: "turn", message: assistant, tools: [tool] });
  });

  it("keeps a leading tool message as its own entry", () => {
    const tool = msg({ id: "t", role: "tool", content: "shot" });
    const assistant = msg({ id: "a", role: "assistant", content: "ok" });
    const clusters = clusterChatThread([tool, assistant]);
    expect(clusters[0]).toMatchObject({ kind: "single", message: tool });
    expect(clusters[1]).toMatchObject({ kind: "turn", message: assistant, tools: [] });
  });
});

describe("turnToolCalls", () => {
  it("includes tool-message calls that are not on the assistant", () => {
    const assistant = msg({
      id: "a",
      role: "assistant",
      toolCalls: [{ id: "c1", name: "apply_patch", arguments: {}, startedAt: "t" }],
    });
    const tool = msg({
      id: "t",
      role: "tool",
      toolCalls: [{ id: "c2", name: "git_diff", arguments: {}, startedAt: "t" }],
    });
    expect(turnToolCalls(assistant, [tool]).map((call) => call.id)).toEqual(["c1", "c2"]);
  });
});

describe("showThoughtTraces", () => {
  it("hides traces in Swarm product mode or on a Swarm session", () => {
    expect(showThoughtTraces()).toBe(true);
    expect(showThoughtTraces({ productMode: "developer" })).toBe(true);
    expect(showThoughtTraces({ surface: "developer" })).toBe(true);
    expect(showThoughtTraces({ productMode: "swarm" })).toBe(false);
    expect(showThoughtTraces({ surface: "swarm" })).toBe(false);
    expect(showThoughtTraces({ productMode: "developer", surface: "swarm" })).toBe(false);
  });
});

describe("formatThinkingSnippet", () => {
  it("returns empty for blank reasoning", () => {
    expect(formatThinkingSnippet("   \n")).toBe("");
  });

  it("keeps short reasoning and trims the tail of long reasoning", () => {
    expect(formatThinkingSnippet("plan the layout")).toBe("plan the layout");
    const long = `${"word ".repeat(80)}end`;
    const snippet = formatThinkingSnippet(long, 20);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.length).toBe(20);
    expect(snippet.endsWith("end")).toBe(true);
    const wide = formatThinkingSnippet("x".repeat(400));
    expect(wide.startsWith("…")).toBe(true);
    expect(wide.length).toBe(280);
  });
});

describe("appendThinkingText", () => {
  it("concatenates deltas and stops at the cap", () => {
    expect(appendThinkingText(undefined, "plan ")).toBe("plan ");
    expect(appendThinkingText("plan ", "the page")).toBe("plan the page");
    expect(appendThinkingText("keep", " more", 6)).toBe("keep m");
    expect(appendThinkingText("already full!!", " extra", 12)).toBe("already full!!");
  });
});

describe("local model wait copy", () => {
  it("labels Ollama and other loopback servers", () => {
    expect(localModelWaitLabel({ name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" })).toBe(
      "Waiting for Ollama…",
    );
    expect(localModelWaitHint({ name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" })).toMatch(
      /loading into memory/i,
    );
    expect(localModelWaitLabel({ name: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" })).toBe(
      "Loading local model…",
    );
    expect(
      localModelWaitLabel({ name: "OpenAI", baseUrl: "https://api.openai.com/v1" }),
    ).toBeUndefined();
  });

  it("formats elapsed wait time", () => {
    expect(formatWaitElapsed(0)).toBe("0s");
    expect(formatWaitElapsed(12)).toBe("12s");
    expect(formatWaitElapsed(75)).toBe("1:15");
  });
});

describe("splitThinkTaggedText", () => {
  it("splits a complete think wrapper out of assistant text", () => {
    expect(splitThinkTaggedText("<think>plan the fix</think>Hello")).toEqual({
      reasoning: "plan the fix",
      text: "Hello",
      state: { buf: "", inThink: false },
    });
  });

  it("holds a partial tag across chunks", () => {
    const first = splitThinkTaggedText("<thi");
    expect(first).toEqual({ reasoning: "", text: "", state: { buf: "<thi", inThink: false } });
    const second = splitThinkTaggedText("nk>plan", first.state);
    expect(second.reasoning).toBe("plan");
    expect(second.text).toBe("");
    expect(second.state.inThink).toBe(true);
    const third = splitThinkTaggedText("</think>PONG", second.state);
    expect(third).toEqual({ reasoning: "", text: "PONG", state: { buf: "", inThink: false } });
  });

  it("flushes an unclosed think block as reasoning", () => {
    const open = splitThinkTaggedText("<think>still going");
    expect(open.reasoning).toBe("still going");
    expect(open.state.inThink).toBe(true);
    expect(flushThinkTaggedText(open.state)).toEqual({ reasoning: "", text: "" });
  });

  it("flushes a dangling less-than as visible text", () => {
    const split = splitThinkTaggedText("use n <");
    expect(split.text).toBe("use n ");
    expect(split.state.buf).toBe("<");
    expect(flushThinkTaggedText(split.state)).toEqual({ reasoning: "", text: "<" });
  });
});
