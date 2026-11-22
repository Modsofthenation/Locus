import { describe, expect, it } from "vitest";
import { formatProviderUsageBrief } from "./providerUsage.js";

const now = new Date("2026-11-22T00:00:00Z");

describe("formatProviderUsageBrief", () => {
  it("shows percent windows, busiest reset, and credits with counts", () => {
    expect(
      formatProviderUsageBrief(
        {
          ok: true,
          providerName: "Claude Code",
          windows: [
            {
              id: "five_hour",
              label: "5-hour",
              usedPercent: 23.4,
              resetsAt: "2026-11-22T01:00:00Z",
            },
            { id: "weekly", label: "Weekly", usedPercent: 61, resetsAt: "2026-11-25T00:00:00Z" },
          ],
        },
        { now },
      ),
    ).toBe("Claude Code: 5-hour 23%, Weekly 61% (resets in 3d)");
    expect(
      formatProviderUsageBrief(
        {
          ok: true,
          providerName: "Kiro",
          windows: [
            {
              id: "monthly",
              label: "Monthly credits",
              used: 212,
              limit: 1000,
              unit: "credits",
              resetsAt: "2026-11-22T05:30:00Z",
            },
          ],
        },
        { now },
      ),
    ).toBe("Kiro: Monthly credits 212/1,000 credits (21%) (resets in 6h)");
  });

  it("keeps the busiest windows in vendor order, and gives nothing when unavailable", () => {
    const windows = [
      { id: "a", label: "A", usedPercent: 10 },
      { id: "b", label: "B", usedPercent: 90 },
      { id: "c", label: "C", usedPercent: 50 },
      { id: "d", label: "D", usedPercent: 70 },
    ];
    expect(formatProviderUsageBrief({ ok: true, providerName: "X", windows }, { now })).toBe(
      "X: B 90%, C 50%, D 70%",
    );
    expect(formatProviderUsageBrief({ ok: false, providerName: "X", windows }, { now })).toBe(
      undefined,
    );
    expect(formatProviderUsageBrief({ ok: true, providerName: "X", windows: [] })).toBe(undefined);
  });
});
