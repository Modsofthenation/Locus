import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dismissNotice,
  errorMessage,
  showErrorNotice,
  showNotice,
  showUndoNotice,
  subscribeNotices,
} from "./notice";

describe("notices", () => {
  afterEach(() => {
    dismissNotice();
    vi.useRealTimers();
  });

  it("keeps the latest three and supports undo", () => {
    const seen: string[][] = [];
    const stop = subscribeNotices((rows) => seen.push(rows.map((row) => row.message)));
    showNotice("one");
    showNotice("two");
    showNotice("three");
    showNotice("four");
    expect(seen.at(-1)).toEqual(["two", "three", "four"]);
    const undo = vi.fn();
    showUndoNotice("Archived 1 idle chat", undo);
    const latest = seen.at(-1);
    expect(latest?.at(-1)).toBe("Archived 1 idle chat");
    stop();
  });

  it("dismisses by id", () => {
    let current: string[] = [];
    const stop = subscribeNotices((rows) => {
      current = rows.map((row) => row.message);
    });
    const id = showNotice("keep me");
    showNotice("drop me");
    dismissNotice(id);
    expect(current).toEqual(["drop me"]);
    stop();
  });

  it("surfaces failed requests with Retry", () => {
    let current: Array<{ message: string; action?: string }> = [];
    const stop = subscribeNotices((rows) => {
      current = rows.map((row) => ({ message: row.message, action: row.actionLabel }));
    });
    const retry = vi.fn();
    showErrorNotice(new Error("disk full"), "Could not save", { onRetry: retry });
    expect(current.at(-1)).toEqual({ message: "disk full", action: "Retry" });
    expect(errorMessage({}, "Could not save")).toBe("Could not save");
    stop();
  });
});
