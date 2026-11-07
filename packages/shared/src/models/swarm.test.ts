import { describe, expect, it } from "vitest";
import {
  boundedContextText,
  needDedupeKey,
  parseSwarmNeeds,
  parseSwarmTeamHandoff,
  pendingSwarmNeeds,
  pendingSwarmTeamHandoffs,
} from "./swarm.js";

describe("swarm durable state", () => {
  it("parses needs and keeps only actionable items", () => {
    const needs = parseSwarmNeeds([
      {
        id: "n1",
        sessionId: "s1",
        teammateName: "Nova",
        reason: "Approve deploy",
        status: "open",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        attempts: 1,
      },
      { id: "bad" },
    ]);
    expect(needs).toHaveLength(1);
    expect(pendingSwarmNeeds(needs)).toHaveLength(1);
    expect(needDedupeKey(" s1 ", "Approve   deploy")).toBe("s1::approve deploy");
  });

  it("prioritizes durable index files and respects the budget", () => {
    const text = boundedContextText({
      index: "Goal: ship the feature",
      files: [
        { path: "z-last.md", bytes: 20 },
        { path: "preferences.md", bytes: 10 },
        { path: "INDEX.md", bytes: 10 },
      ],
      // Floor is Math.max(256, budget) in boundedContextText.
      budget: 256,
    });
    expect(text).toContain("INDEX.md");
    expect(text).toContain("preferences.md");
    expect(text.length).toBeLessThanOrEqual(256);
  });

  it("injects ranked note excerpts without allowing one note to consume the budget", () => {
    const text = boundedContextText({
      title: "Auth",
      index: "Ship the login slice",
      files: [
        { path: "preferences.md", bytes: 2000 },
        { path: "research/auth.md", bytes: 9000 },
      ],
      summaries: [
        { path: "preferences.md", content: "Prefer small PRs." },
        { path: "research/auth.md", content: "The auth boundary is the API gateway." },
      ],
      budget: 256,
    });
    expect(text).toContain("Project: Auth");
    expect(text).toContain("Prefer small PRs.");
    expect(text.length).toBeLessThanOrEqual(256);
  });

  it("parses cross-team handoffs and keeps queued work actionable", () => {
    const handoff = parseSwarmTeamHandoff({
      id: "h1",
      sourceTeamId: "team-a",
      sourceTeamName: "Platform",
      targetTeamId: "team-b",
      targetTeamName: "Experience",
      task: "Review the login flow",
      status: "queued",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });
    expect(handoff?.targetTeamName).toBe("Experience");
    expect(pendingSwarmTeamHandoffs([handoff!])).toHaveLength(1);
    const completed = parseSwarmTeamHandoff({ ...handoff, status: "completed" });
    expect(pendingSwarmTeamHandoffs([completed!])).toHaveLength(0);
  });
});
