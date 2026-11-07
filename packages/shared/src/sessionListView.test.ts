import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AgentSession, ChatMessage } from "./models/session.js";
import {
  LIST_VIEW_TEXT_CHARS,
  LIST_VIEW_TOOL_CHARS,
  isSessionListView,
  sessionListView,
  sessionListViews,
} from "./sessionListView.js";

const ARTIFACT = "/opt/cursor/artifacts/session_list_payload.json";

function session(partial: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    title: "Host agent",
    os: "ubuntu",
    templateId: "ubuntu-24.04",
    providerId: "p",
    model: "grok-4",
    status: "idle",
    messages: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...partial,
  };
}

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role">): ChatMessage {
  return { content: "", createdAt: "2020-01-01T00:00:00.000Z", ...partial };
}

describe("sessionListView", () => {
  it("leaves a small session as the same object", () => {
    const row = session({
      messages: [msg({ id: "u", role: "user", content: "Fix login" })],
    });
    expect(sessionListView(row)).toBe(row);
    expect(isSessionListView(row)).toBe(false);
  });

  it("keeps user prompts and approval chips while clipping tool dumps", () => {
    const dump = `export const n = 1;\n${"x".repeat(12_000)}`;
    const row = session({
      needsHuman: "Approve git_push",
      messages: [
        msg({ id: "u", role: "user", content: "unique-search-token-zed" }),
        msg({
          id: "a",
          role: "assistant",
          content: "Looking.",
          toolCalls: [
            {
              id: "c1",
              name: "git_push",
              arguments: { path: "src/app.ts", content: dump },
              result: dump,
              approval: "needed",
              startedAt: "t",
            },
          ],
        }),
        msg({ id: "t", role: "tool", toolCallId: "c1", content: dump }),
      ],
    });
    const slim = sessionListView(row);
    expect(slim).not.toBe(row);
    expect(isSessionListView(slim)).toBe(true);
    expect(row.messages[2]?.content).toHaveLength(dump.length);
    expect(slim.messages[0]?.content).toBe("unique-search-token-zed");
    expect(slim.messages[1]?.toolCalls?.[0]?.approval).toBe("needed");
    expect(slim.messages[1]?.toolCalls?.[0]?.name).toBe("git_push");
    expect(String(slim.messages[1]?.toolCalls?.[0]?.arguments.path)).toBe("src/app.ts");
    expect(String(slim.messages[1]?.toolCalls?.[0]?.arguments.content).length).toBeLessThanOrEqual(
      LIST_VIEW_TOOL_CHARS,
    );
    expect(slim.messages[2]?.content.length).toBeLessThanOrEqual(LIST_VIEW_TOOL_CHARS);
    expect(slim.messages[1]?.content).toBe("Looking.");
  });

  it("drops screenshot bytes but keeps the screenshot name", () => {
    const row = session({
      messages: [
        msg({
          id: "a",
          role: "assistant",
          content: "shot",
          screenshotName: "t1.png",
          screenshotBase64: "a".repeat(8_000),
        }),
      ],
    });
    const slim = sessionListView(row);
    expect(slim.messages[0]?.screenshotName).toBe("t1.png");
    expect(slim.messages[0]?.screenshotBase64).toBeUndefined();
    expect(row.messages[0]?.screenshotBase64?.length).toBe(8_000);
  });

  it("clips oversized assistant text without mutating the original", () => {
    const content = "y".repeat(LIST_VIEW_TEXT_CHARS + 400);
    const row = session({
      messages: [msg({ id: "a", role: "assistant", content })],
    });
    const slim = sessionListView(row);
    expect(slim.messages[0]?.content.length).toBe(LIST_VIEW_TEXT_CHARS);
    expect(row.messages[0]?.content).toBe(content);
  });
});

describe("session list payload size", () => {
  it("is much smaller than the full transcript for a long tool-heavy thread", () => {
    const dump = `{"ok":true,"body":"${"z".repeat(20_000)}"}`;
    const files = 24;
    const messages: ChatMessage[] = [];
    for (let i = 0; i < files; i += 1) {
      messages.push(msg({ id: `u${i}`, role: "user", content: `Please patch file ${i}` }));
      messages.push(
        msg({
          id: `a${i}`,
          role: "assistant",
          content: `Updated src/mod${i}.ts`,
          toolCalls: [
            {
              id: `c${i}`,
              name: "file_write",
              arguments: { path: `src/mod${i}.ts`, content: dump },
              result: dump,
              startedAt: "t",
              finishedAt: "t",
            },
          ],
        }),
        msg({ id: `t${i}`, role: "tool", toolCallId: `c${i}`, content: dump }),
      );
    }
    const row = session({ id: "heavy", messages });
    const list = sessionListViews([row, session({ id: "s2" })]);
    const fullBytes = Buffer.byteLength(JSON.stringify(row));
    const listBytes = Buffer.byteLength(JSON.stringify(list[0]));
    const start = performance.now();
    for (let i = 0; i < 8; i += 1) sessionListView(row);
    const slimMs = performance.now() - start;
    const stringifyStart = performance.now();
    for (let i = 0; i < 8; i += 1) JSON.stringify(row);
    const fullStringifyMs = performance.now() - stringifyStart;
    const listStringifyStart = performance.now();
    for (let i = 0; i < 8; i += 1) JSON.stringify(list[0]);
    const listStringifyMs = performance.now() - listStringifyStart;
    const payload = {
      files,
      fullBytes,
      listBytes,
      ratio: Number((fullBytes / Math.max(listBytes, 1)).toFixed(2)),
      slimMs: Number(slimMs.toFixed(2)),
      fullStringifyMs: Number(fullStringifyMs.toFixed(2)),
      listStringifyMs: Number(listStringifyMs.toFixed(2)),
    };
    try {
      mkdirSync("/opt/cursor/artifacts", { recursive: true });
      writeFileSync(ARTIFACT, `${JSON.stringify(payload, null, 2)}\n`);
    } catch {
      /* artifacts dir is optional outside the cloud agent */
    }
    console.log("session list payload", payload);
    expect(list[0]?.listView).toBe(true);
    expect(list[1]).toBeDefined();
    expect(isSessionListView(list[1]!)).toBe(false);
    expect(listBytes).toBeLessThan(fullBytes / 4);
    expect(listStringifyMs).toBeLessThan(fullStringifyMs);
  });
});
