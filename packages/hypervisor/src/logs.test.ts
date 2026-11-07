import { describe, expect, it } from "vitest";
import { MAX_VM_LOG, appendVmLog, formatStatusLine } from "./logs.js";

describe("vm logs", () => {
  it("keeps the tail when the buffer overflows", () => {
    const overflow = appendVmLog("keep-", "x".repeat(MAX_VM_LOG));
    expect(overflow.startsWith("keep-")).toBe(false);
    expect(overflow.endsWith("x")).toBe(true);
    expect(overflow).toHaveLength(MAX_VM_LOG);
  });

  it("formats a status line", () => {
    expect(formatStatusLine("booting")).toMatch(/\] booting\n$/);
    expect(formatStatusLine("error", "no iso")).toMatch(/\] error: no iso\n$/);
  });
});
