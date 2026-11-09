import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  isStuckToBottom,
  observePinThreadToLatest,
  pinThreadToLatest,
  schedulePinThreadToLatest,
  STICK_BOTTOM_PX,
} from "./threadScroll";

const dir = dirname(fileURLToPath(import.meta.url));
const css = [
  readFileSync(join(dir, "../index.css"), "utf8"),
  readFileSync(join(dir, "../styles/phone.css"), "utf8"),
].join("\n");

describe("isStuckToBottom", () => {
  it("treats a small gap as stuck and a larger gap as pinned", () => {
    expect(isStuckToBottom({ scrollTop: 920, scrollHeight: 1000, clientHeight: 80 })).toBe(true);
    expect(isStuckToBottom({ scrollTop: 0, scrollHeight: 1000, clientHeight: 80 })).toBe(false);
    expect(
      isStuckToBottom({
        scrollTop: 1000 - 80 - STICK_BOTTOM_PX,
        scrollHeight: 1000,
        clientHeight: 80,
      }),
    ).toBe(true);
    expect(
      isStuckToBottom({
        scrollTop: 1000 - 80 - STICK_BOTTOM_PX - 1,
        scrollHeight: 1000,
        clientHeight: 80,
      }),
    ).toBe(false);
  });
});

describe("chat thread scroll CSS", () => {
  it("opts the thread out of overflow anchoring so a tall message cannot snap the viewport", () => {
    expect(css).toMatch(/\.thread \{[\s\S]*?min-height:\s*0/);
    expect(css).toMatch(/\.thread \{[\s\S]*?overflow-anchor:\s*none/);
    expect(css).toMatch(/\.mobile-thread \{[\s\S]*?overflow-anchor:\s*none/);
  });

  it("stops the in-progress task icon when the operator prefers reduced motion", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.task-list li\[data-status="in_progress"\] \.task-list-icon/,
    );
  });
});

describe("pinThreadToLatest", () => {
  it("sets scrollTop to scrollHeight", () => {
    const el = { scrollTop: 12, scrollHeight: 1800 };
    pinThreadToLatest(el);
    expect(el.scrollTop).toBe(1800);
  });

  it("pins again after animation frames once the thread grows", async () => {
    const el = document.createElement("div");
    let height = 400;
    let top = 0;
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => height });
    Object.defineProperty(el, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = value;
      },
    });
    const stop = schedulePinThreadToLatest(el);
    expect(top).toBe(400);
    height = 2200;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    expect(top).toBe(2200);
    stop();
  });

  it("pins when the observed thread resizes", () => {
    const callbacks: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          callbacks.push(cb);
        }
        observe() {}
        disconnect() {}
      },
    );
    const el = document.createElement("div");
    let height = 400;
    let top = 0;
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => height });
    Object.defineProperty(el, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = value;
      },
    });
    const stop = observePinThreadToLatest(el);
    expect(top).toBe(400);
    height = 2600;
    callbacks[0]?.();
    expect(top).toBe(2600);
    stop();
    vi.unstubAllGlobals();
  });
});
