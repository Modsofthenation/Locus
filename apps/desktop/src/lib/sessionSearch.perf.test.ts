import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AgentSession } from "@locus/shared";
import { sessionMatchesQuery, sessionSearchHaystack } from "./sessionSearch";

const ARTIFACT = "/opt/cursor/artifacts/session_search_perf.json";
const SESSION_COUNT = 200;
const PROMPTS = 40;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function makeSessions(): AgentSession[] {
  return Array.from({ length: SESSION_COUNT }, (_, i) => ({
    id: `s${i}`,
    title: i % 17 === 0 ? `Auth review ${i}` : `Host agent ${i}`,
    os: "ubuntu",
    templateId: "ubuntu-24.04",
    providerId: "p",
    model: "grok-4",
    status: "idle",
    gitBranch: i % 11 === 0 ? "feat/sidebar-branch" : "main",
    messages: Array.from({ length: PROMPTS }, (_, j) => ({
      id: `u${i}-${j}`,
      role: "user" as const,
      content:
        j === PROMPTS - 1
          ? `Please change file ${i}`
          : `Earlier prompt ${j} about widgets and invoices ${i}`,
      createdAt: "2020-01-01T00:00:00.000Z",
    })),
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  }));
}

function legacyMatches(session: AgentSession, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return sessionSearchHaystack(session).toLowerCase().includes(q);
}

describe("session search perf", () => {
  it("filters a large sidebar cheaper than joining every prompt", () => {
    const rows = makeSessions();
    const queries = ["auth review", "sidebar-branch", "widgets and invoices 7", "missing-xyz"];
    for (const query of queries) {
      const next = rows.filter((row) => sessionMatchesQuery(row, query)).map((row) => row.id);
      const old = rows.filter((row) => legacyMatches(row, query)).map((row) => row.id);
      expect(next).toEqual(old);
    }

    const oldTimes: number[] = [];
    const newTimes: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const oldStart = performance.now();
      for (const query of queries) {
        for (const row of rows) legacyMatches(row, query);
      }
      oldTimes.push(performance.now() - oldStart);
      const newStart = performance.now();
      for (const query of queries) {
        for (const row of rows) sessionMatchesQuery(row, query);
      }
      newTimes.push(performance.now() - newStart);
    }

    const payload = {
      sessions: SESSION_COUNT,
      prompts: PROMPTS,
      queries: queries.length,
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
    console.log("session search perf", payload);
    expect(median(newTimes)).toBeLessThan(median(oldTimes));
  });
});
