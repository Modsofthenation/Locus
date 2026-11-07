import { describe, expect, it } from "vitest";
import { exportApprovals, summarizeSessionEgress } from "./audit.js";
import type { TraceEvent } from "./trace.js";

describe("session audit", () => {
  it("summarizes egress hosts and bytes", () => {
    const events: TraceEvent[] = [
      {
        t: "t1",
        kind: "egress",
        sessionId: "s1",
        name: "allow",
        detail: "api.anthropic.com:443",
        args: { bytesSent: 1200 },
      },
      {
        t: "t2",
        kind: "egress",
        sessionId: "s1",
        name: "deny",
        detail: "evil.example:443",
      },
      {
        t: "t3",
        kind: "egress",
        sessionId: "s1",
        name: "allow",
        detail: "api.github.com:443",
        args: { host: "api.github.com", bytesSent: 80 },
      },
    ];
    const summary = summarizeSessionEgress(events, "s1");
    expect(summary.bytesSent).toBe(1280);
    expect(summary.allowed).toBe(2);
    expect(summary.denied).toBe(1);
    expect(summary.hosts.find((row) => row.host === "api.anthropic.com")?.kind).toBe("provider");
    expect(summary.hosts.find((row) => row.host === "api.github.com")?.kind).toBe("forge");
  });

  it("exports approval rows for push, PR, MCP, and integration writes", () => {
    const events: TraceEvent[] = [
      {
        t: "2026-11-06T00:00:00.000Z",
        kind: "approval",
        sessionId: "s1",
        name: "approved",
        args: { tool: "git_push", by: "operator", persist: true },
      },
      {
        t: "2026-11-06T00:01:00.000Z",
        kind: "approval",
        sessionId: "s1",
        name: "denied",
        args: { tool: "mcp_call", by: "operator" },
      },
      {
        t: "2026-11-06T00:02:00.000Z",
        kind: "approval",
        sessionId: "s1",
        name: "approved",
        args: { tool: "jira_comment", by: "operator" },
      },
    ];
    const rows = exportApprovals(events);
    expect(rows.map((row) => row.category)).toEqual(["push", "mcp", "integration"]);
    expect(rows[0]?.by).toBe("operator");
    expect(rows[1]?.decision).toBe("denied");
  });
});
