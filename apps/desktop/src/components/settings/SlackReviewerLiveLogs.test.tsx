import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SlackReviewerApiLogEntry } from "@locus/shared";

const apiMock = vi.hoisted(() => ({ slackReviewerLogs: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: apiMock }));

import { SlackReviewerLiveLogs } from "./SlackReviewerLiveLogs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entry = (patch: Partial<SlackReviewerApiLogEntry>): SlackReviewerApiLogEntry => ({
  seq: 1,
  at: "2026-11-22T10:00:00.000Z",
  durationMs: 120,
  service: "slack",
  method: "peekHistory",
  endpoint: "conversations.history",
  phase: "channel",
  reviewerId: "r1",
  ok: true,
  request: '["C1"]',
  summary: "2 items",
  response: '[{"ts":"1.0"}]',
  ...patch,
});

describe("SlackReviewerLiveLogs", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    apiMock.slackReviewerLogs.mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("fetches nothing until opened, then shows calls newest first and polls for more", async () => {
    apiMock.slackReviewerLogs.mockResolvedValueOnce({
      entries: [
        entry({ seq: 1 }),
        entry({
          seq: 2,
          service: "forge",
          method: "listPulls",
          endpoint: "GET pulls (open)",
          phase: "autoReview",
          ok: false,
          summary: "HTTP 404",
          response: undefined,
        }),
      ],
      lastSeq: 2,
    });
    await act(async () => root.render(<SlackReviewerLiveLogs reviewerName={() => "Core"} />));
    expect(apiMock.slackReviewerLogs).not.toHaveBeenCalled();

    const toggle = host.querySelector<HTMLButtonElement>(
      '[data-testid="slack-reviewer-logs-toggle"]',
    )!;
    await act(async () => toggle.click());
    expect(apiMock.slackReviewerLogs).toHaveBeenCalledWith(0);
    const rows = [...host.querySelectorAll('[data-testid="slack-reviewer-log"]')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("forge.listPulls");
    expect(rows[0]!.textContent).toContain("HTTP 404");
    expect(rows[1]!.textContent).toContain("slack.peekHistory");
    expect(rows[1]!.textContent).toContain("Core");

    apiMock.slackReviewerLogs.mockResolvedValueOnce({
      entries: [entry({ seq: 3, method: "replies", phase: "threads" })],
      lastSeq: 3,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(apiMock.slackReviewerLogs).toHaveBeenLastCalledWith(2);
    expect(host.querySelectorAll('[data-testid="slack-reviewer-log"]')).toHaveLength(3);
  });
});
