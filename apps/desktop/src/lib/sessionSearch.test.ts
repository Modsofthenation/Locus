import { describe, expect, it } from "vitest";
import type { AgentSession } from "@locus/shared";
import { sessionMatchesQuery, sessionSearchHaystack } from "./sessionSearch";

function session(partial: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    title: "Host agent",
    os: "ubuntu",
    templateId: "ubuntu-24.04",
    providerId: "p",
    model: "grok-4",
    status: "idle",
    messages: [
      {
        id: "u1",
        role: "user",
        content: "Fix the login form validation",
        createdAt: "2020-01-01T00:00:00.000Z",
      },
    ],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("sessionMatchesQuery", () => {
  it("matches title, model, and the last user prompt", () => {
    const row = session();
    expect(sessionMatchesQuery(row, "")).toBe(true);
    expect(sessionMatchesQuery(row, "host")).toBe(true);
    expect(sessionMatchesQuery(row, "grok")).toBe(true);
    expect(sessionMatchesQuery(row, "login form")).toBe(true);
    expect(sessionSearchHaystack(row).toLowerCase()).toContain("fix the login form validation");
    expect(sessionMatchesQuery(row, "docker")).toBe(false);
  });

  it("matches the live git branch", () => {
    const row = session({
      gitBranch: "feat/sidebar-branch",
      repo: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
    });
    expect(sessionMatchesQuery(row, "sidebar-branch")).toBe(true);
    expect(sessionMatchesQuery(row, "main")).toBe(false);
  });

  it("matches an earlier user prompt, not only the latest", () => {
    const row = session({
      messages: [
        {
          id: "u1",
          role: "user",
          content: "Fix the login form validation",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
        {
          id: "u2",
          role: "user",
          content: "Then update the billing invoice",
          createdAt: "2020-01-01T00:01:00.000Z",
        },
      ],
    });
    expect(sessionMatchesQuery(row, "login form")).toBe(true);
    expect(sessionMatchesQuery(row, "billing invoice")).toBe(true);
    expect(sessionMatchesQuery(row, "docker")).toBe(false);
  });
});
