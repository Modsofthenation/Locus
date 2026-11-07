import { describe, expect, it } from "vitest";
import { decodePngRgba, encodePngRgba, isPng } from "./pngRgba.js";

describe("png rgba", () => {
  it("round-trips an RGBA buffer", () => {
    const width = 3;
    const height = 2;
    const data = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 0, 40, 50, 60, 128, 70, 80, 90,
      255,
    ]);
    const png = encodePngRgba(width, height, data);
    expect(isPng(png)).toBe(true);
    const decoded = decodePngRgba(png);
    expect(decoded?.width).toBe(3);
    expect(decoded?.height).toBe(2);
    expect(Array.from(decoded?.data ?? [])).toEqual(Array.from(data));
  });

  it("decodes a 1x1 PNG fixture", () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const decoded = decodePngRgba(png);
    expect(decoded?.width).toBe(1);
    expect(decoded?.height).toBe(1);
    expect(decoded?.data.length).toBe(4);
  });
});
