import { describe, expect, it } from "vitest";
import { defaultTuneRanges, parseCanvasTuneAttrs, parseDesignTune } from "./models/designTune.js";
import { applyDesignTune, builtinDesignSystems } from "./models/designSystem.js";

describe("design tune", () => {
  it("clamps operator knobs", () => {
    expect(parseDesignTune({ radiusPx: 99, spacePx: 1, fontPx: "18" })).toEqual({
      radiusPx: 48,
      spacePx: 4,
      fontPx: 18,
    });
    expect(parseDesignTune({ radiusPx: "nope" })).toBeUndefined();
    expect(
      parseDesignTune({ gravity: 200, jump: 2, fireRate: 8, volume: 40, seed: 12000 }),
    ).toEqual({
      gravity: 160,
      jump: 4,
      fireRate: 8,
      volume: 40,
      seed: 9999,
    });
    expect(parseDesignTune({ head: -90, arms: 12, legs: 200, twist: 3 })).toEqual({
      head: -45,
      arms: 12,
      legs: 60,
      twist: 3,
    });
  });

  it("reads data-tune ranges from the canvas, else defaults", () => {
    const ranges = parseCanvasTuneAttrs('<html data-tune="space:6-12,radius:0-24,type:12-22">');
    expect(ranges.find((row) => row.key === "space")).toEqual({ key: "space", min: 6, max: 12 });
    expect(ranges.find((row) => row.key === "radius")).toEqual({ key: "radius", min: 0, max: 24 });
    expect(parseCanvasTuneAttrs("<html>")).toEqual(defaultTuneRanges());
  });

  it("applies knobs onto the live design system", () => {
    const system = builtinDesignSystems()[0]!;
    const tuned = applyDesignTune(system, { radiusPx: 4, spacePx: 12, fontPx: 14 });
    expect(tuned.radiusPx).toBe(4);
    expect(tuned.spacePx).toBe(12);
    expect(tuned.typography.basePx).toBe(14);
    expect(applyDesignTune(system)).toBe(system);
  });
});
