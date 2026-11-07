import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@locus/shared";
import { chatFindHits } from "./chatFind";

const ARTIFACT = "/opt/cursor/artifacts/chat_find_perf.json";
const MESSAGE_COUNT = 400;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function thread(): ChatMessage[] {
  return Array.from({ length: MESSAGE_COUNT }, (_, i) =>
    i % 2 === 0
      ? {
          id: `u${i}`,
          role: "user" as const,
          content: `Please change file ${i} login form`,
          createdAt: "2020-01-01T00:00:00.000Z",
        }
      : {
          id: `a${i}`,
          role: "assistant" as const,
          content: `Updated src/mod${i}.ts and auth.ts`,
          createdAt: "2020-01-01T00:00:00.000Z",
          toolCalls: [
            {
              id: `c${i}`,
              name: "grep",
              arguments: { pattern: "login" },
              startedAt: "t",
            },
          ],
        },
  );
}

describe("chatFindHits perf", () => {
  it("keeps typing a query cheaper after the thread haystack is warm", () => {
    const messages = thread();
    expect(chatFindHits(messages, "login form")[0]).toBe("u0");
    expect(chatFindHits(messages, "auth.ts").length).toBeGreaterThan(0);
    expect(chatFindHits(messages, "missing-xyz")).toEqual([]);

    const queries = ["l", "lo", "log", "login", "login f", "login form"];
    const firstPass: number[] = [];
    const repeatPass: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const fresh = thread();
      const coldStart = performance.now();
      for (const query of queries) chatFindHits(fresh, query);
      firstPass.push(performance.now() - coldStart);
      const warmStart = performance.now();
      for (const query of queries) chatFindHits(fresh, query);
      repeatPass.push(performance.now() - warmStart);
    }

    const payload = {
      messages: MESSAGE_COUNT,
      queries: queries.length,
      firstMedianMs: Number(median(firstPass).toFixed(2)),
      repeatMedianMs: Number(median(repeatPass).toFixed(2)),
      speedup: Number((median(firstPass) / Math.max(median(repeatPass), 0.01)).toFixed(2)),
    };
    try {
      mkdirSync("/opt/cursor/artifacts", { recursive: true });
      writeFileSync(ARTIFACT, `${JSON.stringify(payload, null, 2)}\n`);
    } catch {
      /* artifacts dir is optional outside the cloud agent */
    }
    console.log("chat find perf", payload);
    expect(median(repeatPass)).toBeLessThan(median(firstPass));
  });
});
