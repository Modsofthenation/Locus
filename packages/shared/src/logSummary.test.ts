import { describe, expect, it } from "vitest";
import { partitionBootLog, summarizeLogBlob } from "./logSummary.js";

const FSDEV_BLOB = `[2026-08-18T12:10:18.546Z] creating
[2026-08-18T12:10:18.589Z] booting
C:\\Program Files\\qemu\\qemu-system-x86_64.exe: -fsdev local,id=cidata,path=C:\\Users\\locus\\.locus\\vms\\6308db78-4104-4440-a426-7f88c36e8657\\cidata,security_model=mapped-xattr: There is no option group 'fsdev'
C:\\Program Files\\qemu\\qemu-system-x86_64.exe: -fsdev local,id=cidata,path=C:\\Users\\locus\\.locus\\vms\\6308db78-4104-4440-a426-7f88c36e8657\\cidata,security_model=mapped-xattr: fsdev support is disabled`;

describe("summarizeLogBlob", () => {
  it("keeps short notes as a single line with no detail", () => {
    expect(summarizeLogBlob("Guest is ready.")).toEqual({
      summary: "Guest is ready.",
      detail: null,
    });
    expect(summarizeLogBlob("Booting the guest and waiting for SSH.")).toEqual({
      summary: "Booting the guest and waiting for SSH.",
      detail: null,
    });
  });

  it("collapses a Windows QEMU fsdev dump to one sentence", () => {
    const result = summarizeLogBlob(FSDEV_BLOB);
    expect(result.summary).toBe(
      "This QEMU build has fsdev/9p disabled, so the guest could not start.",
    );
    expect(result.detail).toContain("fsdev support is disabled");
    expect(result.detail).toContain("creating");
  });

  it("falls back to a truncated last error line for unknown dumps", () => {
    const blob = [
      "[2026-08-18T12:10:18.546Z] creating",
      "panic: something went very wrong ".repeat(8),
    ].join("\n");
    const result = summarizeLogBlob(blob);
    expect(result.detail).toBe(blob.trim());
    expect(result.summary.length).toBeLessThanOrEqual(140);
    expect(result.summary).toMatch(/panic:/);
  });

  it("leaves empty input as an empty summary", () => {
    expect(summarizeLogBlob("   \n")).toEqual({ summary: "", detail: null });
  });
});

describe("partitionBootLog", () => {
  it("keeps status lines and collapses the qemu error block", () => {
    const parts = partitionBootLog(`${FSDEV_BLOB}\n[2026-08-18T12:10:19.000Z] stopped\n`);
    expect(parts[0]).toEqual({ summary: "[2026-08-18T12:10:18.546Z] creating", detail: null });
    expect(parts[1]).toEqual({ summary: "[2026-08-18T12:10:18.589Z] booting", detail: null });
    expect(parts[2]?.summary).toMatch(/fsdev\/9p disabled/);
    expect(parts[2]?.detail).toContain("no option group");
    expect(parts[3]).toEqual({ summary: "[2026-08-18T12:10:19.000Z] stopped", detail: null });
  });
});
