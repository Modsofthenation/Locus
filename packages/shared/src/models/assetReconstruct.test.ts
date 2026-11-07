import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  ASSET_PHOTO_RECONSTRUCT_PROMPT,
  ASSET_RECONSTRUCT_FILE,
  ASSET_RECONSTRUCT_JS,
  assetPhotoContourCount,
  buildAssetPhotoHull,
  cutoutAssetRgba,
  enhanceAssetRgba,
} from "./assetReconstruct.js";

function rgba(
  width: number,
  height: number,
  fill: [number, number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = fill[3];
  }
  return data;
}

function paintRect(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: [number, number, number, number],
): void {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * width + x) * 4;
      data[o] = color[0];
      data[o + 1] = color[1];
      data[o + 2] = color[2];
      data[o + 3] = color[3];
    }
  }
}

describe("asset photo reconstruct", () => {
  it("names the vendor helper and photo contract", () => {
    expect(ASSET_RECONSTRUCT_FILE).toBe("vendor/reconstruct.js");
    expect(ASSET_PHOTO_RECONSTRUCT_PROMPT).toMatch(/punch out the backdrop/);
    expect(ASSET_PHOTO_RECONSTRUCT_PROMPT).toMatch(/vendor\/reconstruct\.js/);
    expect(ASSET_PHOTO_RECONSTRUCT_PROMPT).toMatch(/Do not billboard/);
    expect(ASSET_PHOTO_RECONSTRUCT_PROMPT).toMatch(/source-mask\.png/);
    expect(assetPhotoContourCount({ quality: "flagship", topology: "high-detail" })).toBe(144);
    expect(assetPhotoContourCount({ quality: "standard", topology: "smart" })).toBe(48);
  });

  it("punches a white backdrop around a colored subject", () => {
    const width = 32;
    const height = 32;
    const data = rgba(width, height, [250, 250, 250, 255]);
    paintRect(data, width, 10, 8, 22, 24, [200, 40, 30, 255]);
    const cut = cutoutAssetRgba(data, width, height);
    expect(cut.confidence).toBe("high");
    expect(cut.subjectRatio).toBeGreaterThan(0.08);
    expect(cut.subjectRatio).toBeLessThan(0.4);
    expect(data[(2 * width + 2) * 4 + 3]).toBe(0);
    expect(data[(16 * width + 16) * 4 + 3]).toBeGreaterThan(200);
    expect(data[(16 * width + 16) * 4]).toBeGreaterThan(150);
  });

  it("keeps existing alpha instead of flooding a cutout", () => {
    const width = 16;
    const height = 16;
    const data = rgba(width, height, [10, 10, 10, 0]);
    paintRect(data, width, 4, 4, 12, 12, [20, 180, 90, 255]);
    const cut = cutoutAssetRgba(data, width, height);
    expect(cut.usedExistingAlpha).toBe(true);
    expect(cut.confidence).toBe("high");
    expect(data[(1 * width + 1) * 4 + 3]).toBe(0);
    expect(data[(8 * width + 8) * 4 + 3]).toBe(255);
  });

  it("stretches low-contrast photos before reconstruct", () => {
    const width = 8;
    const height = 8;
    const data = rgba(width, height, [120, 120, 120, 255]);
    data[0] = 110;
    data[1] = 110;
    data[2] = 110;
    data[4] = 130;
    data[5] = 130;
    data[6] = 130;
    enhanceAssetRgba(data, width, height);
    expect(Math.max(data[0]!, data[4]!)).toBeGreaterThan(200);
    expect(Math.min(data[0]!, data[4]!)).toBeLessThan(40);
  });

  it("builds a silhouette hull that matches the subject, not the full frame", () => {
    const width = 40;
    const height = 40;
    const data = rgba(width, height, [255, 255, 255, 255]);
    paintRect(data, width, 12, 6, 28, 34, [40, 90, 210, 255]);
    enhanceAssetRgba(data, width, height);
    const hull = buildAssetPhotoHull(data, width, height, { maxContour: 32 });
    expect(hull.confidence).toBe("high");
    expect(hull.verts.length).toBeGreaterThanOrEqual(6);
    expect(hull.faces.length).toBeGreaterThanOrEqual(4);
    expect(hull.contour.length).toBeGreaterThanOrEqual(4);
    const xs = hull.contour.map((p) => p.x);
    const ys = hull.contour.map((p) => p.y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...xs)).toBeLessThanOrEqual(30);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...ys)).toBeLessThanOrEqual(36);
    const fullFrame =
      hull.contour.length === 4 && Math.min(...xs) <= 1 && Math.max(...xs) >= width - 1;
    expect(fullFrame).toBe(false);
  });

  it("ships a vendor module that cutouts the same subject", () => {
    expect(ASSET_RECONSTRUCT_JS).toMatch(/export function enhanceRgba/);
    expect(ASSET_RECONSTRUCT_JS).toMatch(/export async function reconstructFromPhoto/);
    expect(ASSET_RECONSTRUCT_JS).toMatch(/export function paintPhotoHull/);
    expect(ASSET_RECONSTRUCT_JS).toMatch(/crossOrigin/);
    const src = ASSET_RECONSTRUCT_JS.replaceAll(
      "export async function",
      "async function",
    ).replaceAll("export function", "function");
    const sandbox: Record<string, unknown> = {
      Uint8ClampedArray,
      Uint8Array,
      Uint32Array,
      Int32Array,
      Math,
    };
    runInNewContext(
      `${src}\nthis.enhanceRgba = enhanceRgba; this.cutoutRgba = cutoutRgba; this.buildPhotoHull = buildPhotoHull;`,
      sandbox,
    );
    const width = 24;
    const height = 24;
    const data = rgba(width, height, [248, 248, 248, 255]);
    paintRect(data, width, 7, 5, 17, 19, [30, 160, 70, 255]);
    const cutoutRgba = sandbox.cutoutRgba as (
      pixels: Uint8ClampedArray,
      w: number,
      h: number,
    ) => { confidence: string; subjectRatio: number };
    const cut = cutoutRgba(data, width, height);
    expect(cut.confidence).toBe("high");
    expect(data[(2 * width + 2) * 4 + 3]).toBe(0);
    expect(data[(12 * width + 12) * 4 + 3]).toBeGreaterThan(200);
  });
});
