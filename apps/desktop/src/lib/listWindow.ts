/** Fixed-row list windowing, same idea as the editor paint window. */

export const LIST_OVERSCAN = 12;
export const LIST_ROW_FALLBACK = 80;
const RELOAD_MARGIN = 8;

export type ListWindow = {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
  height: number;
};

export function listScrollHeight(rowCount: number, rowPx: number): number {
  return Math.max(0, rowCount) * Math.max(1, rowPx);
}

export function listSizePrefix(sizes: ArrayLike<number>): number[] {
  const offsets = new Array(sizes.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    offsets[i + 1] = offsets[i] + Math.max(0, typeof size === "number" ? size : 0);
  }
  return offsets;
}

/** Largest index i in [0, n] such that offsets[i] <= y. */
export function listIndexAtOffset(offsets: number[], y: number): number {
  const n = Math.max(0, offsets.length - 1);
  if (n <= 0) return 0;
  let lo = 0;
  let hi = n;
  const target = Math.max(0, y);
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((offsets[mid] ?? 0) <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Keep the same row under the viewport when sizes above it change.
 * Without this, measuring a tall row replaces a short pad and yanks the thread toward the top.
 */
export function listPreserveScrollTop(
  prevOffsets: number[],
  nextOffsets: number[],
  scrollTop: number,
): number {
  if (prevOffsets.length < 2 || nextOffsets.length < 2) return scrollTop;
  const prevLast = prevOffsets.length - 2;
  const nextLast = nextOffsets.length - 2;
  const idx = Math.min(listIndexAtOffset(prevOffsets, scrollTop), prevLast, nextLast);
  if (idx < 0) return scrollTop;
  const inner = scrollTop - (prevOffsets[idx] ?? 0);
  return (nextOffsets[idx] ?? 0) + inner;
}

function windowFromOffsets(
  start: number,
  end: number,
  rowCount: number,
  offsets: number[],
): ListWindow {
  const height = offsets[rowCount] ?? 0;
  if (rowCount <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0, height: 0 };
  let from = Math.max(0, Math.min(start, rowCount));
  let to = Math.max(0, Math.min(end, rowCount));
  if (from >= to) {
    // scrollTop overshot the estimated range (rows taller than the guess): keep the tail.
    from = Math.max(0, rowCount - LIST_ROW_FALLBACK);
    to = rowCount;
  }
  return {
    start: from,
    end: to,
    padTop: offsets[from] ?? 0,
    padBottom: height - (offsets[to] ?? height),
    height,
  };
}

export function listWindowFromSizes(opts: {
  scrollTop: number;
  clientHeight: number;
  sizes: ArrayLike<number>;
  overscan?: number;
  stickToEnd?: boolean;
}): ListWindow {
  const rowCount = opts.sizes.length;
  const offsets = listSizePrefix(opts.sizes);
  if (rowCount === 0) return { start: 0, end: 0, padTop: 0, padBottom: 0, height: 0 };
  const overscan = opts.overscan ?? LIST_OVERSCAN;
  if (opts.clientHeight <= 0 || opts.stickToEnd) {
    if (opts.stickToEnd) {
      return windowFromOffsets(
        Math.max(0, rowCount - LIST_ROW_FALLBACK),
        rowCount,
        rowCount,
        offsets,
      );
    }
    return windowFromOffsets(0, Math.min(rowCount, LIST_ROW_FALLBACK), rowCount, offsets);
  }
  const first = Math.max(0, listIndexAtOffset(offsets, opts.scrollTop) - overscan);
  const lastAt = listIndexAtOffset(offsets, opts.scrollTop + opts.clientHeight);
  const last = Math.min(rowCount, lastAt + 1 + overscan);
  return windowFromOffsets(first, last, rowCount, offsets);
}

export function listWindowRange(opts: {
  scrollTop: number;
  clientHeight: number;
  rowCount: number;
  rowPx: number;
  overscan?: number;
  stickToEnd?: boolean;
}): ListWindow {
  const rowPx = Math.max(1, opts.rowPx);
  const rowCount = Math.max(0, opts.rowCount);
  const height = listScrollHeight(rowCount, rowPx);
  if (rowCount === 0) return { start: 0, end: 0, padTop: 0, padBottom: 0, height: 0 };
  const overscan = opts.overscan ?? LIST_OVERSCAN;
  if (opts.clientHeight <= 0 || opts.stickToEnd) {
    if (opts.stickToEnd) {
      const start = Math.max(0, rowCount - LIST_ROW_FALLBACK);
      return {
        start,
        end: rowCount,
        padTop: start * rowPx,
        padBottom: 0,
        height,
      };
    }
    const end = Math.min(rowCount, LIST_ROW_FALLBACK);
    return { start: 0, end, padTop: 0, padBottom: (rowCount - end) * rowPx, height };
  }
  const at = Math.min(rowCount, Math.max(0, Math.floor(opts.scrollTop / rowPx)));
  const first = Math.max(0, at - overscan);
  const last = Math.min(
    rowCount,
    Math.ceil((Math.min(opts.scrollTop, height) + opts.clientHeight) / rowPx) + overscan,
  );
  let start = Math.min(first, last);
  let end = Math.max(start, last);
  if (start >= end) {
    start = Math.max(0, rowCount - LIST_ROW_FALLBACK);
    end = rowCount;
  }
  return {
    start,
    end,
    padTop: start * rowPx,
    padBottom: (rowCount - end) * rowPx,
    height,
  };
}

/** Keep the current window while the viewport stays inside the overscan. */
export function shouldUpdateListWindow(
  current: Pick<ListWindow, "start" | "end">,
  next: Pick<ListWindow, "start" | "end">,
  margin = RELOAD_MARGIN,
): boolean {
  if (next.start === current.start && next.end === current.end) return false;
  return next.start < current.start + margin || next.end > current.end - margin;
}

export function sameListWindow(current: ListWindow, next: ListWindow): boolean {
  return (
    current.start === next.start &&
    current.end === next.end &&
    current.padTop === next.padTop &&
    current.padBottom === next.padBottom &&
    current.height === next.height
  );
}
