import { describe, expect, it } from "vitest";
import { isPlanReadTool } from "./plan.js";
import { canonicalToolCall } from "./toolChip.js";
import {
  AGENT_CANVAS_HTML_MAX,
  agentCanvasDocument,
  prepareAgentCanvasWrite,
  resolveAgentCanvasId,
  sessionAdvertisesAgentCanvas,
  sessionOffersAgentCanvas,
  upsertAgentCanvas,
} from "./agentCanvas.js";

describe("agent canvases", () => {
  it("wraps a fragment and rejects network loads", () => {
    const ok = prepareAgentCanvasWrite({
      title: "Billing review",
      html: "<h1>March</h1><p>12 failing invoices</p>",
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.id).toBe("billing-review");
    expect(ok.html).toMatch(/<html/i);
    expect(ok.html).toContain("<h1>March</h1>");
    expect(agentCanvasDocument(ok.html)).toContain("default-src 'none'");

    expect(
      prepareAgentCanvasWrite({
        title: "Remote",
        html: "<script src='https://cdn.example/app.js'></script>",
      }).ok,
    ).toBe(false);
    expect(
      prepareAgentCanvasWrite({
        title: "Fetch",
        html: "<script>fetch('/api')</script>",
      }),
    ).toMatchObject({ ok: false });
    expect(
      prepareAgentCanvasWrite({ title: "Big", html: "x".repeat(AGENT_CANVAS_HTML_MAX + 1) }).ok,
    ).toBe(false);
  });

  it("updates by id and caps new canvases", () => {
    const first = upsertAgentCanvas(undefined, {
      id: "billing-review",
      title: "Billing review",
      updatedAt: "2026-10-21T00:00:00.000Z",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = upsertAgentCanvas(first.canvases, {
      id: "billing-review",
      title: "Billing review",
      updatedAt: "2026-10-21T01:00:00.000Z",
    });
    expect(again.ok && again.canvases).toHaveLength(1);
    const full = Array.from({ length: 8 }, (_, i) => ({
      id: `c${i}`,
      title: `C${i}`,
      updatedAt: "2026-10-21T00:00:00.000Z",
    }));
    expect(upsertAgentCanvas(full, { id: "extra", title: "Extra", updatedAt: "t" }).ok).toBe(false);
    expect(resolveAgentCanvasId(first.canvases, undefined)?.id).toBe("billing-review");
  });

  it("is offered on coding and review chats, and read is plan-safe", () => {
    expect(sessionOffersAgentCanvas({ kind: "agent" })).toBe(true);
    expect(sessionOffersAgentCanvas({})).toBe(true);
    expect(sessionOffersAgentCanvas({ kind: "review" })).toBe(true);
    expect(sessionOffersAgentCanvas({ kind: "ide" })).toBe(true);
    expect(sessionOffersAgentCanvas({ kind: "design" })).toBe(false);
    expect(sessionOffersAgentCanvas({ kind: "game" })).toBe(false);
    expect(sessionOffersAgentCanvas({ kind: "board" })).toBe(false);
    expect(sessionAdvertisesAgentCanvas({ kind: "agent" })).toBe(true);
    expect(sessionAdvertisesAgentCanvas({ kind: "review", allowedTools: ["canvas_write"] })).toBe(
      true,
    );
    expect(sessionAdvertisesAgentCanvas({ kind: "review", allowedTools: ["file_read"] })).toBe(
      false,
    );
    expect(sessionAdvertisesAgentCanvas({ kind: "design" })).toBe(false);
    expect(isPlanReadTool("canvas_read")).toBe(true);
    expect(isPlanReadTool("canvas_write")).toBe(false);
  });

  it("maps Cursor WriteCanvas arguments onto canvas_write", () => {
    expect(
      canonicalToolCall("WriteCanvas", {
        title: "Audit",
        contents: "<p>Findings</p>",
        canvas_id: "audit",
      }),
    ).toEqual({
      name: "canvas_write",
      arguments: {
        title: "Audit",
        contents: "<p>Findings</p>",
        canvas_id: "audit",
        content: "<p>Findings</p>",
        html: "<p>Findings</p>",
        id: "audit",
      },
    });
    expect(canonicalToolCall("ReadCanvas", { canvas_id: "audit" }).name).toBe("canvas_read");
  });
});
