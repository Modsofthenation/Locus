import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, DebugLogDetail } from "@locus/shared";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/net";
import { TraceModal } from "./TraceModal";

vi.mock("@/lib/api", () => ({
  api: {
    debugLog: vi.fn(),
    saveTraceEval: vi.fn(),
    sessionEgress: vi.fn(),
    sessionApprovals: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

const session: AgentSession = {
  id: "sess-1",
  title: "Host chat",
  os: "ubuntu",
  templateId: "host",
  runtime: "host",
  providerId: "p",
  model: "grok-4",
  status: "idle",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

const detail: DebugLogDetail = {
  source: {
    id: "trace:sess-1",
    kind: "trace",
    title: "Host chat",
    path: "/tmp/traces/sess-1.jsonl",
    sessionId: "sess-1",
    bytes: 120,
    mtime: "2026-08-22T00:00:00.000Z",
    summary: "2 events · tools repo_map",
  },
  text: '{"kind":"tool.call","name":"repo_map"}\n',
  truncated: false,
  events: [
    { t: "2026-08-22T00:00:00.000Z", kind: "tool.call", sessionId: "sess-1", name: "repo_map" },
  ],
};

describe("TraceModal", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  async function render() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<TraceModal session={session} onClose={() => undefined} />);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("loads this agent's trace and keeps eval actions in a ⋯ menu", async () => {
    expect(css).toMatch(/\.debug-log-actions \{[\s\S]*?flex-shrink:\s*0/);
    expect(css).toMatch(/\.debug-log-actions \.btn \{[\s\S]*?white-space:\s*nowrap/);
    expect(css).toMatch(/\.trace-modal \{[\s\S]*?width:\s*min\(840px/);
    vi.mocked(api.debugLog).mockResolvedValue(detail);
    vi.mocked(api.sessionEgress).mockResolvedValue({
      sessionId: "sess-1",
      hosts: [
        { host: "api.anthropic.com", allowed: 1, denied: 0, bytesSent: 120, kind: "provider" },
      ],
      bytesSent: 120,
      allowed: 1,
      denied: 0,
    });
    vi.mocked(api.sessionApprovals).mockResolvedValue({
      approvals: [
        {
          t: "2026-08-22T00:00:00.000Z",
          sessionId: "sess-1",
          tool: "git_push",
          decision: "approved",
          by: "operator",
          category: "push",
        },
      ],
    });
    vi.mocked(api.saveTraceEval).mockResolvedValue({
      path: "/tmp/evals/sess-1.json",
      fixture: {
        sessionId: "sess-1",
        prompt: "",
        tools: [{ name: "repo_map" }],
        failed: false,
        outcome: "ok",
        selfCorrects: 0,
        approvals: 0,
      },
    });
    await render();
    expect(api.debugLog).toHaveBeenCalledWith("trace", "sess-1");
    expect(host.querySelector("[data-testid='egress-summary']")?.textContent).toMatch(
      /api\.anthropic\.com/,
    );
    expect(host.querySelector("[data-testid='approvals-export']")?.textContent).toMatch(/git_push/);
    expect(host.querySelector("#trace-title")?.textContent).toBe("Trace");
    expect(host.textContent).toContain("Host chat");
    expect(host.querySelector(".debug-log-raw")?.textContent).toContain("tool.call");
    const actions = host.querySelector(".debug-log-actions");
    expect([...actions!.querySelectorAll(":scope > button")].map((btn) => btn.textContent)).toEqual(
      ["Copy raw"],
    );
    expect(host.querySelector("[aria-label='Trace actions']")).toBeTruthy();
    expect(
      [...host.querySelectorAll(".debug-log-actions .menu-item")].map((btn) => btn.textContent),
    ).toEqual(["Copy eval", "Save as eval"]);
    await act(async () => {
      [...host.querySelectorAll(".debug-log-actions .menu-item")]
        .find((btn) => btn.textContent === "Save as eval")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(api.saveTraceEval).toHaveBeenCalledWith("trace", "sess-1");
  });

  it("shows an empty state when this agent has no trace yet", async () => {
    vi.mocked(api.debugLog).mockRejectedValue(new HttpError("Not found", 404));
    vi.mocked(api.sessionEgress).mockRejectedValue(new HttpError("Not found", 404));
    vi.mocked(api.sessionApprovals).mockRejectedValue(new HttpError("Not found", 404));
    await render();
    expect(host.textContent).toContain("No trace yet");
    expect(host.textContent).toContain("Host chat");
    expect(host.querySelector(".debug-log-raw")).toBeNull();
  });
});
