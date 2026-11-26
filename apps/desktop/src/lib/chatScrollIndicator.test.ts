import { describe, expect, it } from "vitest";
import {
  CHAT_SCROLL_MIN_THUMB,
  chatScrollFromPointer,
  chatScrollGrabOffset,
  chatScrollOverflow,
  chatScrollThumb,
  CHAT_TICK_MIN_GAP,
  chatActiveTurn,
  chatNearestTick,
  chatTickMagnify,
  chatTickPositions,
  chatTurnMarks,
  chatTurnSnippet,
} from "./chatScrollIndicator";

describe("chat scroll indicator", () => {
  it("hides when the thread fits", () => {
    expect(chatScrollOverflow(400, 400)).toBe(false);
    expect(chatScrollOverflow(80, 80)).toBe(false);
    expect(chatScrollOverflow(1000, 80)).toBe(true);
  });

  it("sizes the thumb from the viewport and clamps it to the track", () => {
    const mid = chatScrollThumb({
      scrollTop: 460,
      clientHeight: 80,
      scrollHeight: 1000,
      trackHeight: 400,
    });
    expect(mid.height).toBe(CHAT_SCROLL_MIN_THUMB);
    expect(mid.y).toBeGreaterThan(0);
    expect(mid.y + mid.height).toBeLessThanOrEqual(400);

    const top = chatScrollThumb({
      scrollTop: 0,
      clientHeight: 80,
      scrollHeight: 1000,
      trackHeight: 400,
    });
    expect(top.y).toBe(0);

    const bottom = chatScrollThumb({
      scrollTop: 920,
      clientHeight: 80,
      scrollHeight: 1000,
      trackHeight: 400,
    });
    expect(bottom.y + bottom.height).toBe(400);
  });

  it("keeps a short overflow thumb inside a short track", () => {
    const thumb = chatScrollThumb({
      scrollTop: 10,
      clientHeight: 80,
      scrollHeight: 100,
      trackHeight: 30,
    });
    expect(thumb.height).toBe(30);
    expect(thumb.y).toBe(0);
  });

  it("grabs inside the thumb and centers a click on the track", () => {
    expect(chatScrollGrabOffset(80, 40, 48)).toBe(40);
    expect(chatScrollGrabOffset(10, 40, 48)).toBe(24);
    expect(chatScrollGrabOffset(200, 40, 48)).toBe(24);
  });

  it("maps a pointer to scrollTop", () => {
    expect(
      chatScrollFromPointer({
        pointerY: 24,
        trackHeight: 400,
        scrollHeight: 1000,
        clientHeight: 80,
        grabOffset: 24,
      }),
    ).toBe(0);
    expect(
      chatScrollFromPointer({
        pointerY: 400,
        trackHeight: 400,
        scrollHeight: 1000,
        clientHeight: 80,
        grabOffset: 24,
      }),
    ).toBe(920);
    expect(
      chatScrollFromPointer({
        pointerY: -8,
        trackHeight: 400,
        scrollHeight: 1000,
        clientHeight: 80,
        grabOffset: 24,
      }),
    ).toBe(0);
  });
});

describe("chat turn ticks", () => {
  const rows = [
    { message: { id: "u1", role: "user", content: "Fix the **header** popover" } },
    { message: { id: "a1", role: "assistant", content: "Looking.\n\nmore" } },
    { message: { id: "t1", role: "tool", content: "ok" } },
    { message: { id: "a2", role: "assistant", content: "Header now matches the mock." } },
    { message: { id: "u2", role: "user", content: "Rebase onto develop" } },
    { message: { id: "a3", role: "assistant", content: "" } },
  ];
  const offsets = [0, 40, 200, 260, 400, 460, 520];

  it("makes one mark per prompt with the turn's last reply", () => {
    expect(chatTurnMarks(rows, offsets)).toEqual([
      { id: "u1", top: 0, prompt: "Fix the header popover", reply: "Header now matches the mock." },
      { id: "u2", top: 400, prompt: "Rebase onto develop", reply: "" },
    ]);
    expect(chatTurnMarks(rows, offsets, { skip: (id) => id === "u2" })).toHaveLength(1);
  });

  it("trims snippets to the first paragraph", () => {
    expect(chatTurnSnippet("first   line\nwrapped\n\nsecond")).toBe("first line wrapped");
    expect(chatTurnSnippet("x".repeat(300), 10)).toBe(`${"x".repeat(9)}…`);
  });

  it("spaces ticks evenly and compresses long chats", () => {
    expect(chatTickPositions(3, 100)).toEqual([40, 50, 60]);
    const many = chatTickPositions(51, 100);
    expect(many[1]! - many[0]!).toBe(CHAT_TICK_MIN_GAP);
    expect(chatTickPositions(0, 100)).toEqual([]);
  });

  it("magnifies near the pointer and picks the nearest tick", () => {
    expect(chatTickMagnify(0)).toBe(1);
    expect(chatTickMagnify(10)).toBeGreaterThan(chatTickMagnify(20));
    expect(chatTickMagnify(30)).toBeGreaterThan(0);
    expect(chatTickMagnify(42)).toBe(0);
    expect(chatNearestTick([10, 20, 30], 24)).toBe(1);
  });

  it("tracks the active turn from the viewport", () => {
    const tops = [0, 400, 900];
    expect(chatActiveTurn(tops, { scrollTop: 0, clientHeight: 300, scrollHeight: 2000 })).toBe(0);
    expect(chatActiveTurn(tops, { scrollTop: 350, clientHeight: 300, scrollHeight: 2000 })).toBe(1);
    expect(chatActiveTurn(tops, { scrollTop: 1700, clientHeight: 300, scrollHeight: 2000 })).toBe(
      2,
    );
  });
});
