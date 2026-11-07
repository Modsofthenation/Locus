import { describe, expect, it } from "vitest";
import {
  MAX_PROMPT_QUEUE,
  dropLandedQueueItems,
  normalizePromptQueue,
  pendingPromptQueue,
  promptMatchesQueue,
  queueItemBadge,
} from "./queue.js";

describe("prompt queue", () => {
  it("keeps plan and skill flags and drops empty rows", () => {
    expect(
      normalizePromptQueue([
        { id: "a", text: "  follow up  ", plan: true },
        { id: "b", text: "review staging", skill: "Review" },
        { id: "c", text: "   " },
        { text: "no id" },
        { id: "silent", text: "group mention", notifySessionId: "coord", wakeRequester: false },
        null,
      ]),
    ).toEqual([
      { id: "a", text: "follow up", plan: true },
      { id: "b", text: "review staging", skill: "review" },
      { id: "q3", text: "no id" },
      { id: "silent", text: "group mention", notifySessionId: "coord", wakeRequester: false },
    ]);
    expect(
      normalizePromptQueue([
        {
          id: "att",
          text: "",
          attachments: [{ name: "a.md", mime: "text/markdown", bytes: 3, storedName: "a.md" }],
        },
      ]),
    ).toEqual([
      {
        id: "att",
        text: "",
        attachments: [{ name: "a.md", mime: "text/markdown", bytes: 3, storedName: "a.md" }],
      },
    ]);
    expect(queueItemBadge({ id: "a", text: "x", plan: true })).toBe("Plan");
    expect(queueItemBadge({ id: "b", text: "x", skill: "review" })).toBe("/review");
    expect(queueItemBadge({ id: "c", text: "x" })).toBeUndefined();
  });

  it("hides queue rows that already landed as the latest user message", () => {
    const queue = [
      { id: "q1", text: "Can we make sure the colour scheme matches" },
      { id: "q2", text: "then tighten the hero" },
    ];
    expect(promptMatchesQueue(queue, "Can we make sure the colour scheme matches")).toBe(true);
    expect(
      pendingPromptQueue(queue, "Can we make sure the colour scheme matches").map((row) => row.id),
    ).toEqual(["q2"]);
    expect(dropLandedQueueItems(queue, "Can we make sure the colour scheme matches")).toEqual([
      { id: "q2", text: "then tighten the hero" },
    ]);
    expect(dropLandedQueueItems([{ id: "q1", text: "same" }], "same")).toBeUndefined();
    expect(dropLandedQueueItems(queue, "unrelated")).toBe(queue);
  });

  it("caps length and skips duplicate ids", () => {
    const rows = Array.from({ length: MAX_PROMPT_QUEUE + 5 }, (_, i) => ({
      id: `q${i}`,
      text: `item ${i}`,
    }));
    rows.push({ id: "q0", text: "dup" });
    expect(normalizePromptQueue(rows)).toHaveLength(MAX_PROMPT_QUEUE);
    expect(
      normalizePromptQueue([
        { id: "same", text: "one" },
        { id: "same", text: "two" },
      ]),
    ).toEqual([{ id: "same", text: "one" }]);
  });
});
