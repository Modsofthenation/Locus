import { describe, expect, it, vi } from "vitest";
import {
  crashFromUnknown,
  crashFromWindowError,
  mergeCrash,
  restartFrontend,
  sameCrash,
} from "./crash";

describe("crash", () => {
  it("keeps the message and stack from an Error", () => {
    const err = new Error("pane exploded");
    err.stack = "Error: pane exploded\n    at ChatPane (ChatPane.tsx:10:2)";
    const crash = crashFromUnknown(err);
    expect(crash.title).toBe("pane exploded");
    expect(crash.stack).toContain("ChatPane.tsx:10:2");
    expect(crash.id).toMatch(/^crash-\d+$/);
  });

  it("stringifies unknown values", () => {
    expect(crashFromUnknown("nope").title).toBe("nope");
    expect(crashFromUnknown({ boom: true }).title).toBe('{"boom":true}');
  });

  it("treats matching title and stack as the same crash", () => {
    const a = crashFromUnknown(new Error("x"));
    const b = { ...crashFromUnknown(new Error("x")), stack: a.stack };
    expect(sameCrash(a, b)).toBe(true);
    expect(sameCrash(a, crashFromUnknown(new Error("y")))).toBe(false);
  });

  it("ignores extension and ResizeObserver noise", () => {
    expect(
      crashFromWindowError({
        message: "ResizeObserver loop completed with undelivered notifications.",
      }),
    ).toBeNull();
    expect(crashFromWindowError({ message: "Script error." })).toBeNull();
    expect(
      crashFromWindowError({
        message: "boom",
        error: new Error("boom"),
        filename: "chrome-extension://abc/content.js",
      }),
    ).toBeNull();
    expect(crashFromWindowError({ message: "Failed to load", error: null })).toBeNull();
  });

  it("captures uncaught window exceptions", () => {
    const err = new Error("click handler died");
    err.stack = "Error: click handler died\n    at onClick";
    const crash = crashFromWindowError({
      message: "Uncaught Error: click handler died",
      error: err,
    });
    expect(crash?.title).toBe("click handler died");
    expect(crash?.stack).toContain("onClick");
  });

  it("appends unique crashes and caps the list", () => {
    const first = crashFromUnknown(new Error("one"));
    const again = { ...crashFromUnknown(new Error("one")), stack: first.stack };
    expect(mergeCrash([first], again)).toEqual([first]);
    const rows = [{ id: "a", title: "a" }];
    for (let i = 0; i < 10; i++) rows.push({ id: `n${i}`, title: `n${i}` });
    const merged = mergeCrash(rows.slice(0, 8), { id: "z", title: "z" });
    expect(merged).toHaveLength(8);
    expect(merged.at(-1)?.title).toBe("z");
    expect(merged[0]?.title).not.toBe("a");
  });

  it("reloads the window to restart the frontend", () => {
    const loc = { reload: vi.fn() };
    restartFrontend(loc);
    expect(loc.reload).toHaveBeenCalledTimes(1);
  });
});
