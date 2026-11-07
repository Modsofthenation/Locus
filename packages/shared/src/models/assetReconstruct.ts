/** Photo-to-mesh reconstruct: enhance, punch out backdrop, silhouette hull, albedo UVs. */

export const ASSET_RECONSTRUCT_FILE = "vendor/reconstruct.js";
export const ASSET_MASK_FILE = "source-mask.png";

export const ASSET_PHOTO_RECONSTRUCT_PROMPT = [
  "Photo reconstruct when ./source.png exists: punch out the backdrop, trace a high-fidelity silhouette, extrude a hull whose thickness follows the cutout (and ./source-side.png / ./source-back.png when present), and map albedo only onto the subject.",
  "Do not billboard the whole photo, do not paint the studio backdrop onto the mesh, and do not use CSS preserve-3d or a photo-on-a-div as the model.",
  "Prefer ./vendor/reconstruct.js (reconstructFromPhoto / paintPhotoHull) when present — it enhances, cutouts, and returns a textured hull. Side/back photos are extra views of the same subject, not a second character.",
  "If ./source-mask.png exists, honor that alpha as the silhouette.",
].join(" ");

export type AssetRgba = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type AssetPhotoVertex = {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
};

export type AssetPhotoHull = {
  contour: { x: number; y: number }[];
  verts: AssetPhotoVertex[];
  faces: [number, number, number][];
  width: number;
  height: number;
  subjectRatio: number;
  confidence: "high" | "low";
};

export function assetPhotoContourCount(input?: { topology?: string; quality?: string }): number {
  const hi = input?.topology === "high-detail";
  const flag = input?.quality === "flagship";
  if (hi && flag) return 144;
  if (hi || flag) return 96;
  return 48;
}

export function enhanceAssetRgba(data: Uint8ClampedArray, width: number, height: number): void {
  const n = width * height;
  if (n < 2) return;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (data[o + 3]! < 8) continue;
    const bin = luma(data[o]!, data[o + 1]!, data[o + 2]!);
    hist[bin] = (hist[bin] ?? 0) + 1;
  }
  const counted = hist.reduce((sum, v) => sum + v, 0);
  if (counted < 8) return;
  const lo = percentileFromHist(hist, counted, 0.02);
  const hi = Math.max(lo + 8, percentileFromHist(hist, counted, 0.98));
  const scale = 255 / (hi - lo);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (data[o + 3]! < 8) continue;
    data[o] = clampByte((data[o]! - lo) * scale);
    data[o + 1] = clampByte((data[o + 1]! - lo) * scale);
    data[o + 2] = clampByte((data[o + 2]! - lo) * scale);
  }
}

export function cutoutAssetRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { subjectRatio: number; confidence: "high" | "low"; usedExistingAlpha: boolean } {
  const n = width * height;
  let opaque = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3]! >= 128) opaque += 1;
  const existing = n ? opaque / n : 0;
  if (existing > 0.04 && existing < 0.92) {
    return { subjectRatio: existing, confidence: "high", usedExistingAlpha: true };
  }

  const border = sampleBorderMedian(data, width, height);
  const threshold = Math.max(28, border.spread * 0.9);
  const keep = new Uint8Array(n);
  keep.fill(1);
  floodBackground(data, width, height, keep, border.r, border.g, border.b, threshold * 1.15);
  closeMask(keep, width, height);
  keepLargest(keep, width, height);

  let subject = 0;
  for (let i = 0; i < n; i++) {
    if (keep[i]) subject += 1;
    else data[i * 4 + 3] = 0;
  }
  const ratio = n ? subject / n : 0;
  if (ratio < 0.04 || ratio > 0.94) {
    for (let i = 0; i < n; i++) data[i * 4 + 3] = 255;
    return { subjectRatio: 1, confidence: "low", usedExistingAlpha: false };
  }
  featherMask(data, keep, width, height);
  return { subjectRatio: ratio, confidence: "high", usedExistingAlpha: false };
}

export function buildAssetPhotoHull(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  opts?: { maxContour?: number; depth?: number },
): AssetPhotoHull {
  const maxContour = Math.max(12, Math.min(192, opts?.maxContour ?? 48));
  const depth = opts?.depth ?? 0.16;
  const cut = cutoutAssetRgba(data, width, height);
  const raw = traceContour(data, width, height);
  const contour = simplifyRdp(raw, rdpEpsilon(raw, maxContour)).slice(0, maxContour);
  if (contour.length < 3) {
    return unitCardHull(width, height, cut);
  }
  ensureWinding(contour);
  const bounds = boundsOf(contour);
  const span = Math.max(bounds.w, bounds.h, 1);
  const verts: AssetPhotoVertex[] = [];
  const faces: [number, number, number][] = [];
  const front: number[] = [];
  for (const p of contour) {
    front.push(verts.length);
    verts.push({
      x: (p.x - bounds.cx) / span,
      y: -(p.y - bounds.cy) / span,
      z: depth,
      u: p.x / width,
      v: p.y / height,
    });
  }
  const back: number[] = [];
  for (const p of contour) {
    back.push(verts.length);
    verts.push({
      x: (p.x - bounds.cx) / span,
      y: -(p.y - bounds.cy) / span,
      z: -depth,
      u: p.x / width,
      v: p.y / height,
    });
  }
  const cap = earClip(contour);
  for (const tri of cap) faces.push([front[tri[0]]!, front[tri[1]]!, front[tri[2]]!]);
  for (const tri of cap) faces.push([back[tri[0]]!, back[tri[2]]!, back[tri[1]]!]);
  const n = contour.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([front[i]!, front[j]!, back[j]!]);
    faces.push([front[i]!, back[j]!, back[i]!]);
  }
  return {
    contour,
    verts,
    faces,
    width,
    height,
    subjectRatio: cut.subjectRatio,
    confidence: cut.confidence,
  };
}

function unitCardHull(
  width: number,
  height: number,
  cut: { subjectRatio: number; confidence: "high" | "low" },
): AssetPhotoHull {
  const contour = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const verts: AssetPhotoVertex[] = [
    { x: -0.5, y: 0.5, z: 0.04, u: 0, v: 0 },
    { x: 0.5, y: 0.5, z: 0.04, u: 1, v: 0 },
    { x: 0.5, y: -0.5, z: 0.04, u: 1, v: 1 },
    { x: -0.5, y: -0.5, z: 0.04, u: 0, v: 1 },
    { x: -0.5, y: 0.5, z: -0.04, u: 0, v: 0 },
    { x: 0.5, y: 0.5, z: -0.04, u: 1, v: 0 },
    { x: 0.5, y: -0.5, z: -0.04, u: 1, v: 1 },
    { x: -0.5, y: -0.5, z: -0.04, u: 0, v: 1 },
  ];
  const faces: [number, number, number][] = [
    [0, 1, 2],
    [0, 2, 3],
    [4, 6, 5],
    [4, 7, 6],
    [0, 5, 1],
    [0, 4, 5],
    [1, 5, 6],
    [1, 6, 2],
    [2, 6, 7],
    [2, 7, 3],
    [3, 7, 4],
    [3, 4, 0],
  ];
  return {
    contour,
    verts,
    faces,
    width,
    height,
    subjectRatio: cut.subjectRatio,
    confidence: cut.confidence,
  };
}

function luma(r: number, g: number, b: number): number {
  return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function percentileFromHist(hist: Uint32Array, total: number, p: number): number {
  const target = Math.max(1, Math.floor(total * p));
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i]!;
    if (acc >= target) return i;
  }
  return 255;
}

function sampleBorderMedian(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { r: number; g: number; b: number; spread: number } {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const edge = Math.max(1, Math.min(6, Math.floor(Math.min(width, height) / 16)));
  const take = (x: number, y: number) => {
    const o = (y * width + x) * 4;
    rs.push(data[o]!);
    gs.push(data[o + 1]!);
    bs.push(data[o + 2]!);
  };
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < edge; y++) take(x, y);
    for (let y = height - edge; y < height; y++) take(x, y);
  }
  for (let y = edge; y < height - edge; y++) {
    for (let x = 0; x < edge; x++) take(x, y);
    for (let x = width - edge; x < width; x++) take(x, y);
  }
  const r = median(rs);
  const g = median(gs);
  const b = median(bs);
  let spread = 0;
  const n = Math.min(rs.length, 400);
  const step = Math.max(1, Math.floor(rs.length / n));
  let count = 0;
  for (let i = 0; i < rs.length; i += step) {
    spread += chroma(rs[i]!, gs[i]!, bs[i]!, r, g, b);
    count += 1;
  }
  return { r, g, b, spread: count ? spread / count : 24 };
}

function median(values: number[]): number {
  if (!values.length) return 255;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function chroma(r: number, g: number, b: number, pr: number, pg: number, pb: number): number {
  const dr = r - pr;
  const dg = g - pg;
  const db = b - pb;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function floodBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  keep: Uint8Array,
  pr: number,
  pg: number,
  pb: number,
  threshold: number,
): void {
  const n = width * height;
  const seen = new Uint8Array(n);
  const qx = new Int32Array(n);
  const qy = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const push = (x: number, y: number) => {
    const i = y * width + x;
    if (seen[i]) return;
    const o = i * 4;
    if (chroma(data[o]!, data[o + 1]!, data[o + 2]!, pr, pg, pb) > threshold) return;
    seen[i] = 1;
    keep[i] = 0;
    qx[tail] = x;
    qy[tail] = y;
    tail += 1;
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    push(0, y);
    push(width - 1, y);
  }
  while (head < tail) {
    const x = qx[head]!;
    const y = qy[head]!;
    head += 1;
    if (x > 0) push(x - 1, y);
    if (x + 1 < width) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y + 1 < height) push(x, y + 1);
  }
}

function closeMask(keep: Uint8Array, width: number, height: number): void {
  dilate(keep, width, height);
  erode(keep, width, height);
}

function dilate(keep: Uint8Array, width: number, height: number): void {
  const next = keep.slice();
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (keep[y * width + x]) continue;
      if (
        keep[y * width + x - 1] ||
        keep[y * width + x + 1] ||
        keep[(y - 1) * width + x] ||
        keep[(y + 1) * width + x]
      ) {
        next[y * width + x] = 1;
      }
    }
  }
  keep.set(next);
}

function erode(keep: Uint8Array, width: number, height: number): void {
  const next = keep.slice();
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (!keep[y * width + x]) continue;
      if (
        !keep[y * width + x - 1] ||
        !keep[y * width + x + 1] ||
        !keep[(y - 1) * width + x] ||
        !keep[(y + 1) * width + x]
      ) {
        next[y * width + x] = 0;
      }
    }
  }
  keep.set(next);
}

function keepLargest(keep: Uint8Array, width: number, height: number): void {
  const n = width * height;
  const seen = new Uint8Array(n);
  let best: number[] = [];
  const qx = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (!keep[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    const cells: number[] = [];
    seen[start] = 1;
    qx[tail++] = start;
    while (head < tail) {
      const i = qx[head++]!;
      cells.push(i);
      const x = i % width;
      const y = (i / width) | 0;
      const neigh = [
        x > 0 ? i - 1 : -1,
        x + 1 < width ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y + 1 < height ? i + width : -1,
      ];
      for (const j of neigh) {
        if (j < 0 || seen[j] || !keep[j]) continue;
        seen[j] = 1;
        qx[tail++] = j;
      }
    }
    if (cells.length > best.length) best = cells;
  }
  if (!best.length) return;
  keep.fill(0);
  for (const i of best) keep[i] = 1;
}

function featherMask(
  data: Uint8ClampedArray,
  keep: Uint8Array,
  width: number,
  height: number,
): void {
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (!keep[i]) continue;
      const edge = !keep[i - 1] || !keep[i + 1] || !keep[i - width] || !keep[i + width];
      if (edge) data[i * 4 + 3] = 220;
    }
  }
}

function traceContour(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { x: number; y: number }[] {
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3]! >= 128;
  let sx = -1;
  let sy = -1;
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inside(x, y)) {
        sx = x;
        sy = y;
        break outer;
      }
    }
  }
  if (sx < 0) return [];
  const dirs = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  const pts: { x: number; y: number }[] = [];
  let x = sx;
  let y = sy;
  let dir = 0;
  for (let step = 0; step < width * height; step++) {
    pts.push({ x, y });
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8;
      const nx = x + dirs[d]![0]!;
      const ny = y + dirs[d]![1]!;
      if (!inside(nx, ny)) continue;
      x = nx;
      y = ny;
      dir = d;
      found = true;
      break;
    }
    if (!found) break;
    if (x === sx && y === sy && pts.length > 8) break;
  }
  return pts;
}

function rdpEpsilon(pts: { x: number; y: number }[], maxPoints: number): number {
  if (pts.length <= maxPoints) return 0.6;
  const b = boundsOf(pts);
  return Math.max(1.2, Math.max(b.w, b.h) / Math.max(18, maxPoints / 2));
}

function simplifyRdp(pts: { x: number; y: number }[], eps: number): { x: number; y: number }[] {
  if (pts.length < 3) return pts.slice();
  const out: { x: number; y: number }[] = [];
  const rec = (start: number, end: number) => {
    let maxD = 0;
    let idx = start;
    const a = pts[start]!;
    const b = pts[end]!;
    for (let i = start + 1; i < end; i++) {
      const d = distToSeg(pts[i]!, a, b);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps) {
      rec(start, idx);
      rec(idx, end);
    } else {
      out.push(a);
    }
  };
  rec(0, pts.length - 1);
  out.push(pts[pts.length - 1]!);
  return out.length >= 3 ? out : pts.slice(0, 12);
}

function distToSeg(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function boundsOf(pts: { x: number; y: number }[]): {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

function ensureWinding(pts: { x: number; y: number }[]): void {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  if (area < 0) pts.reverse();
}

function earClip(pts: { x: number; y: number }[]): [number, number, number][] {
  const n0 = pts.length;
  const idx = pts.map((_, i) => i);
  const faces: [number, number, number][] = [];
  const area2 = (i: number, j: number, k: number) => {
    const a = pts[i]!;
    const b = pts[j]!;
    const c = pts[k]!;
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  };
  const inside = (p: number, a: number, b: number, c: number) => {
    const x = pts[p]!.x;
    const y = pts[p]!.y;
    const s1 =
      (pts[b]!.x - pts[a]!.x) * (y - pts[a]!.y) - (pts[b]!.y - pts[a]!.y) * (x - pts[a]!.x);
    const s2 =
      (pts[c]!.x - pts[b]!.x) * (y - pts[b]!.y) - (pts[c]!.y - pts[b]!.y) * (x - pts[b]!.x);
    const s3 =
      (pts[a]!.x - pts[c]!.x) * (y - pts[c]!.y) - (pts[a]!.y - pts[c]!.y) * (x - pts[c]!.x);
    return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < n0 * 4) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i - 1 + idx.length) % idx.length]!;
      const i1 = idx[i]!;
      const i2 = idx[(i + 1) % idx.length]!;
      if (area2(i0, i1, i2) <= 0) continue;
      let ear = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (inside(j, i0, i1, i2)) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      faces.push([i0, i1, i2]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) faces.push([idx[0]!, idx[1]!, idx[2]!]);
  if (!faces.length && n0 >= 3) {
    for (let i = 1; i < n0 - 1; i++) faces.push([0, i, i + 1]);
  }
  return faces;
}

/** Browser studio helper landed at vendor/reconstruct.js. */
export const ASSET_RECONSTRUCT_JS = `"use strict";

function luma(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) | 0;
}
function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}
function chroma(r, g, b, pr, pg, pb) {
  const dr = r - pr, dg = g - pg, db = b - pb;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}
function median(values) {
  if (!values.length) return 255;
  const sorted = values.slice().sort(function (a, b) { return a - b; });
  return sorted[(sorted.length / 2) | 0];
}

export function enhanceRgba(data, width, height) {
  const n = width * height;
  if (n < 2) return;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (data[o + 3] < 8) continue;
    hist[luma(data[o], data[o + 1], data[o + 2])]++;
  }
  let counted = 0;
  for (let i = 0; i < 256; i++) counted += hist[i];
  if (counted < 8) return;
  function pct(p) {
    const target = Math.max(1, (counted * p) | 0);
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i;
    }
    return 255;
  }
  const lo = pct(0.02);
  const hi = Math.max(lo + 8, pct(0.98));
  const scale = 255 / (hi - lo);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (data[o + 3] < 8) continue;
    data[o] = clampByte((data[o] - lo) * scale);
    data[o + 1] = clampByte((data[o + 1] - lo) * scale);
    data[o + 2] = clampByte((data[o + 2] - lo) * scale);
  }
}

export function cutoutRgba(data, width, height) {
  const n = width * height;
  let opaque = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] >= 128) opaque++;
  const existing = n ? opaque / n : 0;
  if (existing > 0.04 && existing < 0.92) {
    return { subjectRatio: existing, confidence: "high", usedExistingAlpha: true };
  }
  const edge = Math.max(1, Math.min(6, (Math.min(width, height) / 16) | 0));
  const rs = [], gs = [], bs = [];
  function take(x, y) {
    const o = (y * width + x) * 4;
    rs.push(data[o]); gs.push(data[o + 1]); bs.push(data[o + 2]);
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < edge; y++) take(x, y);
    for (let y = height - edge; y < height; y++) take(x, y);
  }
  for (let y = edge; y < height - edge; y++) {
    for (let x = 0; x < edge; x++) take(x, y);
    for (let x = width - edge; x < width; x++) take(x, y);
  }
  const pr = median(rs), pg = median(gs), pb = median(bs);
  let spread = 0, count = 0;
  const step = Math.max(1, (rs.length / 400) | 0);
  for (let i = 0; i < rs.length; i += step) {
    spread += chroma(rs[i], gs[i], bs[i], pr, pg, pb);
    count++;
  }
  const threshold = Math.max(28, (count ? spread / count : 24) * 1.15);
  const keep = new Uint8Array(n);
  keep.fill(1);
  const seen = new Uint8Array(n);
  const qx = new Int32Array(n);
  const qy = new Int32Array(n);
  let head = 0, tail = 0;
  function push(x, y) {
    const i = y * width + x;
    if (seen[i]) return;
    const o = i * 4;
    if (chroma(data[o], data[o + 1], data[o + 2], pr, pg, pb) > threshold) return;
    seen[i] = 1; keep[i] = 0; qx[tail] = x; qy[tail] = y; tail++;
  }
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { push(0, y); push(width - 1, y); }
  while (head < tail) {
    const x = qx[head], y = qy[head]; head++;
    if (x > 0) push(x - 1, y);
    if (x + 1 < width) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y + 1 < height) push(x, y + 1);
  }
  function dilate() {
    const next = keep.slice();
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (keep[i]) continue;
        if (keep[i - 1] || keep[i + 1] || keep[i - width] || keep[i + width]) next[i] = 1;
      }
    }
    keep.set(next);
  }
  function erode() {
    const next = keep.slice();
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (!keep[i]) continue;
        if (!keep[i - 1] || !keep[i + 1] || !keep[i - width] || !keep[i + width]) next[i] = 0;
      }
    }
    keep.set(next);
  }
  dilate(); erode();
  let best = [];
  const seenC = new Uint8Array(n);
  const q = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (!keep[start] || seenC[start]) continue;
    let h = 0, t = 0;
    const cells = [];
    seenC[start] = 1; q[t++] = start;
    while (h < t) {
      const i = q[h++]; cells.push(i);
      const x = i % width, y = (i / width) | 0;
      const neigh = [x > 0 ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y > 0 ? i - width : -1, y + 1 < height ? i + width : -1];
      for (let k = 0; k < 4; k++) {
        const j = neigh[k];
        if (j < 0 || seenC[j] || !keep[j]) continue;
        seenC[j] = 1; q[t++] = j;
      }
    }
    if (cells.length > best.length) best = cells;
  }
  keep.fill(0);
  for (let i = 0; i < best.length; i++) keep[best[i]] = 1;
  let subject = 0;
  for (let i = 0; i < n; i++) {
    if (keep[i]) subject++;
    else data[i * 4 + 3] = 0;
  }
  const ratio = n ? subject / n : 0;
  if (ratio < 0.04 || ratio > 0.94) {
    for (let i = 0; i < n; i++) data[i * 4 + 3] = 255;
    return { subjectRatio: 1, confidence: "low", usedExistingAlpha: false };
  }
  return { subjectRatio: ratio, confidence: "high", usedExistingAlpha: false };
}

function traceContour(data, width, height) {
  function inside(x, y) {
    return x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3] >= 128;
  }
  let sx = -1, sy = -1;
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inside(x, y)) { sx = x; sy = y; break outer; }
    }
  }
  if (sx < 0) return [];
  const dirs = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
  const pts = [];
  let x = sx, y = sy, dir = 0;
  for (let step = 0; step < width * height; step++) {
    pts.push({ x: x, y: y });
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8;
      const nx = x + dirs[d][0], ny = y + dirs[d][1];
      if (!inside(nx, ny)) continue;
      x = nx; y = ny; dir = d; found = true; break;
    }
    if (!found) break;
    if (x === sx && y === sy && pts.length > 8) break;
  }
  return pts;
}

function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function simplifyRdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const out = [];
  function rec(start, end) {
    let maxD = 0, idx = start;
    const a = pts[start], b = pts[end];
    for (let i = start + 1; i < end; i++) {
      const d = distToSeg(pts[i], a, b);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps) { rec(start, idx); rec(idx, end); }
    else out.push(a);
  }
  rec(0, pts.length - 1);
  out.push(pts[pts.length - 1]);
  return out.length >= 3 ? out : pts.slice(0, 12);
}

function ensureWinding(pts) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  if (area < 0) pts.reverse();
}

function earClip(pts) {
  const n0 = pts.length;
  const idx = pts.map(function (_, i) { return i; });
  const faces = [];
  function area2(i, j, k) {
    const a = pts[i], b = pts[j], c = pts[k];
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }
  function inside(p, a, b, c) {
    const x = pts[p].x, y = pts[p].y;
    const s1 = (pts[b].x - pts[a].x) * (y - pts[a].y) - (pts[b].y - pts[a].y) * (x - pts[a].x);
    const s2 = (pts[c].x - pts[b].x) * (y - pts[b].y) - (pts[c].y - pts[b].y) * (x - pts[b].x);
    const s3 = (pts[a].x - pts[c].x) * (y - pts[c].y) - (pts[a].y - pts[c].y) * (x - pts[c].x);
    return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  }
  let guard = 0;
  while (idx.length > 3 && guard++ < n0 * 4) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i - 1 + idx.length) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
      if (area2(i0, i1, i2) <= 0) continue;
      let ear = true;
      for (let t = 0; t < idx.length; t++) {
        const j = idx[t];
        if (j === i0 || j === i1 || j === i2) continue;
        if (inside(j, i0, i1, i2)) { ear = false; break; }
      }
      if (!ear) continue;
      faces.push([i0, i1, i2]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) faces.push([idx[0], idx[1], idx[2]]);
  if (!faces.length && n0 >= 3) {
    for (let i = 1; i < n0 - 1; i++) faces.push([0, i, i + 1]);
  }
  return faces;
}

export function buildPhotoHull(data, width, height, opts) {
  opts = opts || {};
  const maxContour = Math.max(12, Math.min(192, opts.maxContour || 48));
  const depth = opts.depth || 0.16;
  const cut = cutoutRgba(data, width, height);
  const raw = traceContour(data, width, height);
  let spanGuess = Math.max(width, height);
  const eps = raw.length <= maxContour ? 0.6 : Math.max(1.2, spanGuess / Math.max(18, maxContour / 2));
  let contour = simplifyRdp(raw, eps).slice(0, maxContour);
  if (contour.length < 3) {
    return {
      contour: [{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}],
      verts: [
        {x:-0.5,y:0.5,z:0.04,u:0,v:0},{x:0.5,y:0.5,z:0.04,u:1,v:0},{x:0.5,y:-0.5,z:0.04,u:1,v:1},{x:-0.5,y:-0.5,z:0.04,u:0,v:1},
        {x:-0.5,y:0.5,z:-0.04,u:0,v:0},{x:0.5,y:0.5,z:-0.04,u:1,v:0},{x:0.5,y:-0.5,z:-0.04,u:1,v:1},{x:-0.5,y:-0.5,z:-0.04,u:0,v:1}
      ],
      faces: [[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,5,1],[0,4,5],[1,5,6],[1,6,2],[2,6,7],[2,7,3],[3,7,4],[3,4,0]],
      width: width, height: height, subjectRatio: cut.subjectRatio, confidence: cut.confidence,
      cutout: data
    };
  }
  ensureWinding(contour);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < contour.length; i++) {
    const p = contour[i];
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, span = Math.max(maxX - minX, maxY - minY, 1);
  const verts = [];
  const faces = [];
  const front = [];
  for (let i = 0; i < contour.length; i++) {
    const p = contour[i];
    front.push(verts.length);
    verts.push({ x: (p.x - cx) / span, y: -(p.y - cy) / span, z: depth, u: p.x / width, v: p.y / height });
  }
  const back = [];
  for (let i = 0; i < contour.length; i++) {
    const p = contour[i];
    back.push(verts.length);
    verts.push({ x: (p.x - cx) / span, y: -(p.y - cy) / span, z: -depth, u: p.x / width, v: p.y / height });
  }
  const cap = earClip(contour);
  for (let i = 0; i < cap.length; i++) {
    faces.push([front[cap[i][0]], front[cap[i][1]], front[cap[i][2]]]);
    faces.push([back[cap[i][0]], back[cap[i][2]], back[cap[i][1]]]);
  }
  for (let i = 0; i < contour.length; i++) {
    const j = (i + 1) % contour.length;
    faces.push([front[i], front[j], back[j]]);
    faces.push([front[i], back[j], back[i]]);
  }
  return { contour: contour, verts: verts, faces: faces, width: width, height: height, subjectRatio: cut.subjectRatio, confidence: cut.confidence, cutout: data };
}

export async function loadPhoto(src) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  await img.decode();
  const maxEdge = 768;
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(8, (img.naturalWidth * scale) | 0);
  const h = Math.max(8, (img.naturalHeight * scale) | 0);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  return { image: image, canvas: c, img: img };
}

export async function reconstructFromPhoto(src, opts) {
  const loaded = await loadPhoto(src);
  enhanceRgba(loaded.image.data, loaded.image.width, loaded.image.height);
  const hull = buildPhotoHull(loaded.image.data, loaded.image.width, loaded.image.height, opts || {});
  hull.albedo = loaded.canvas;
  return hull;
}

function projectVert(v, cam, w, h) {
  const yaw = cam.yaw || 0, pitch = cam.pitch || 0, zoom = cam.zoom || 1;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch);
  let x = v.x * cy + v.z * sy;
  let z = -v.x * sy + v.z * cy;
  const y = v.y * cx - z * sx;
  z = v.y * sx + z * cx;
  const persp = 1.7 / (1.7 + z);
  const f = Math.min(w, h) * 0.42 * zoom * persp;
  return { x: w / 2 + x * f, y: h / 2 - y * f, z: z, u: v.u, v: v.v };
}

function texturedTriangle(ctx, img, p0, p1, p2) {
  const x0 = p0.x, y0 = p0.y, x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
  const u0 = p0.u * img.width, v0 = p0.v * img.height;
  const u1 = p1.u * img.width, v1 = p1.v * img.height;
  const u2 = p2.u * img.width, v2 = p2.v * img.height;
  const det = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1);
  if (Math.abs(det) < 1e-4) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath();
  ctx.clip();
  const a = (x0 * (v1 - v2) + x1 * (v2 - v0) + x2 * (v0 - v1)) / det;
  const b = (x0 * (u2 - u1) + x1 * (u0 - u2) + x2 * (u1 - u0)) / det;
  const c = (x0 * (u1 * v2 - u2 * v1) + x1 * (u2 * v0 - u0 * v2) + x2 * (u0 * v1 - u1 * v0)) / det;
  const d = (y0 * (v1 - v2) + y1 * (v2 - v0) + y2 * (v0 - v1)) / det;
  const e = (y0 * (u2 - u1) + y1 * (u0 - u2) + y2 * (u1 - u0)) / det;
  const f = (y0 * (u1 * v2 - u2 * v1) + y1 * (u2 * v0 - u0 * v2) + y2 * (u0 * v1 - u1 * v0)) / det;
  ctx.transform(a, d, b, e, c, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

export function paintPhotoHull(ctx, hull, cam) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  const verts = hull.verts.map(function (v) { return projectVert(v, cam || {}, w, h); });
  const faces = hull.faces.slice().sort(function (a, b) {
    const za = (verts[a[0]].z + verts[a[1]].z + verts[a[2]].z) / 3;
    const zb = (verts[b[0]].z + verts[b[1]].z + verts[b[2]].z) / 3;
    return za - zb;
  });
  const img = hull.albedo;
  const wire = !!(cam && cam.wireframe);
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    const p0 = verts[f[0]], p1 = verts[f[1]], p2 = verts[f[2]];
    if (img && !wire) texturedTriangle(ctx, img, p0, p1, p2);
    else {
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.closePath();
      ctx.fillStyle = wire ? "transparent" : "#c4b8a4";
      if (!wire) ctx.fill();
      ctx.strokeStyle = "rgba(20,16,12,0.45)";
      ctx.stroke();
    }
  }
}
`;
