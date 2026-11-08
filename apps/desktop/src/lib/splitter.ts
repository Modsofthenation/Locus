/** Shared keyboard stepping for pane splitters (fractions or pixel widths). */

export type SplitAxis = "horizontal" | "vertical";

export function stepSplitValue(opts: {
  key: string;
  shift?: boolean;
  value: number;
  min: number;
  max: number;
  axis: SplitAxis;
  step?: number;
  largeStep?: number;
}): number | null {
  const step = opts.shift ? (opts.largeStep ?? (opts.step ?? 1) * 4) : (opts.step ?? 1);
  const shrink = opts.axis === "vertical" ? opts.key === "ArrowLeft" : opts.key === "ArrowUp";
  const grow = opts.axis === "vertical" ? opts.key === "ArrowRight" : opts.key === "ArrowDown";
  if (opts.key === "Home") return opts.min;
  if (opts.key === "End") return opts.max;
  if (shrink) return clampSplit(opts.value - step, opts.min, opts.max);
  if (grow) return clampSplit(opts.value + step, opts.min, opts.max);
  return null;
}

export function clampSplit(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
