import { describe, expect, it } from "vitest";
import {
  CHAT_SCROLL_MIN_THUMB,
  chatScrollFromPointer,
  chatScrollGrabOffset,
  chatScrollOverflow,
  chatScrollThumb,
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
