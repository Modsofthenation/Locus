import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSession, ChatMessage } from "@locus/shared";
import { JsonStore, serializeSession } from "./store.js";

const ARTIFACT = "/opt/cursor/artifacts/session_persist_perf.json";
const cleanup: string[] = [];

afterEach(async () => {
  cleanup.length = 0;
});

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function session(partial: Partial<AgentSession> = {}): AgentSession {
  const t = "2026-08-19T12:00:00.000Z";
  return {
    id: "s1",
    title: "Ubuntu agent",
    os: "ubuntu",
    templateId: "ubuntu",
    providerId: "openai",
    model: "gpt-4.1",
    status: "idle",
    messages: [],
    createdAt: t,
    updatedAt: t,
    ...partial,
  };
}

function toolThread(files: number): ChatMessage[] {
  const dump = `{"ok":true,"body":"${"z".repeat(8_000)}"}`;
  const messages: ChatMessage[] = [];
  for (let i = 0; i < files; i += 1) {
    messages.push({
      id: `u${i}`,
      role: "user",
      content: `Please patch file ${i}`,
      createdAt: "2026-08-19T12:00:00.000Z",
    });
    messages.push({
      id: `a${i}`,
      role: "assistant",
      content: `Updated src/mod${i}.ts`,
      createdAt: "2026-08-19T12:00:00.000Z",
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
    });
  }
  return messages;
}

describe("session persist perf", () => {
  it("writes compact JSON and skips an unchanged rewrite", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-perf-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const row = session({ messages: toolThread(16) });
    const pretty = JSON.stringify(row, null, 2);
    const compact = serializeSession(row);

    const stringifyPretty: number[] = [];
    const stringifyCompact: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const prettyStart = performance.now();
      JSON.stringify(row, null, 2);
      stringifyPretty.push(performance.now() - prettyStart);
      const compactStart = performance.now();
      serializeSession(row);
      stringifyCompact.push(performance.now() - compactStart);
    }

    await store.replaceSession(row);
    const path = join(dir, "sessions", "s1.json");
    const first = await readFile(path, "utf8");
    const rewrite: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const start = performance.now();
      await store.replaceSession(row);
      rewrite.push(performance.now() - start);
    }
    const second = await readFile(path, "utf8");

    const payload = {
      prettyBytes: Buffer.byteLength(pretty),
      compactBytes: Buffer.byteLength(compact),
      prettyMedianMs: Number(median(stringifyPretty).toFixed(2)),
      compactMedianMs: Number(median(stringifyCompact).toFixed(2)),
      unchangedRewriteMedianMs: Number(median(rewrite).toFixed(2)),
    };
    try {
      mkdirSync("/opt/cursor/artifacts", { recursive: true });
      writeFileSync(ARTIFACT, `${JSON.stringify(payload, null, 2)}\n`);
    } catch {
      /* artifacts dir is optional outside the cloud agent */
    }
    console.log("session persist perf", payload);

    expect(first).toBe(compact);
    expect(second).toBe(first);
    expect(JSON.parse(first)).toEqual(row);
    expect(compact.length).toBeLessThan(pretty.length);
    expect(median(stringifyCompact)).toBeLessThanOrEqual(median(stringifyPretty) * 1.5);
    expect(first.includes("\n  ")).toBe(false);
  });
});
