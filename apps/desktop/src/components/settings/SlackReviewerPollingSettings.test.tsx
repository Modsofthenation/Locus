import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseSlackReviewer,
  parseSlackReviewerPolling,
  type SlackReviewerPollStatus,
  type SlackReviewerPolling,
} from "@locus/shared";
import { SlackReviewerPollingSettings } from "./SlackReviewerPollingSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const reviewer = parseSlackReviewer({ id: "r1", name: "API reviews", channelId: "C1" })!;

function mount(status?: Record<string, SlackReviewerPollStatus>) {
  const seen: { polling?: SlackReviewerPolling } = {};
  function Harness() {
    const [polling, setPolling] = useState<SlackReviewerPolling | undefined>(undefined);
    seen.polling = polling;
    return (
      <SlackReviewerPollingSettings
        polling={polling}
        status={status}
        reviewers={[reviewer]}
        onChange={setPolling}
      />
    );
  }
  act(() => root.render(<Harness />));
  return seen;
}

function q<T extends Element = HTMLElement>(selector: string): T {
  const el = host.querySelector<T>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
}

function choose(testId: string, value: string) {
  act(() => {
    q(`[data-testid="${testId}"] summary`).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
  });
  const item = q<HTMLButtonElement>(
    `[data-testid="${testId}"] [role="menuitem"][data-value="${value}"]`,
  );
  act(() => item.click());
}

function type(testId: string, value: string) {
  const input = q<HTMLInputElement>(`[data-testid="${testId}"]`);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

describe("SlackReviewerPollingSettings", () => {
  it("starts fixed at the old intervals and shows no adaptive fields", () => {
    mount();
    expect(q("[data-testid='slack-reviewer-polling'] summary").textContent).toContain(
      "Fixed · channels every 20s",
    );
    expect(host.querySelector("[data-testid='slack-reviewer-poll-maxBackoff']")).toBeNull();
    expect(host.querySelector("[data-testid='slack-reviewer-poll-start']")).toBeNull();
  });

  it("edits intervals, clamped, with auto-review in minutes", () => {
    const seen = mount();
    type("slack-reviewer-poll-channelSec", "2");
    expect(seen.polling).toMatchObject({ channelSec: 5 });
    type("slack-reviewer-poll-autoReviewSec", "10");
    expect(seen.polling).toMatchObject({ autoReviewSec: 600 });
  });

  it("adaptive shows the back-off cap, smart adds active hours", () => {
    const seen = mount();
    choose("slack-reviewer-poll-mode", "adaptive");
    expect(seen.polling?.mode).toBe("adaptive");
    type("slack-reviewer-poll-maxBackoff", "3");
    expect(seen.polling?.maxBackoff).toBe(3);
    expect(q("[data-testid='slack-reviewer-polling'] summary").textContent).toContain("(up to 1m)");
    choose("slack-reviewer-poll-mode", "smart");
    choose("slack-reviewer-poll-start", "9");
    choose("slack-reviewer-poll-end", "17");
    act(() => q<HTMLButtonElement>("[data-testid='slack-reviewer-poll-weekdays']").click());
    expect(seen.polling).toEqual({
      ...parseSlackReviewerPolling({ mode: "smart", maxBackoff: 3 }),
      activeHours: { start: 9, end: 17, weekdaysOnly: false },
    });
  });

  it("shows what each reviewer polls at now and why", () => {
    mount({ r1: { events: false, channelMs: 45_000, threadsMs: 60_000, offHours: true } });
    expect(q("[data-testid='slack-reviewer-poll-status']").textContent).toBe(
      "API reviews: channel every 45s · threads every 1m (outside active hours)",
    );
  });
});
