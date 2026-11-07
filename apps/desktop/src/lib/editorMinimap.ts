export const MINIMAP_WIDTH = 64;
export const MINIMAP_MIN_LINES = 40;
const SAMPLE_COLS = 48;

export function shouldShowMinimap(input: {
  lineCount: number;
  binary?: boolean;
  enabled?: boolean;
}): boolean {
  if (input.enabled === false || input.binary) return false;
  return input.lineCount >= MINIMAP_MIN_LINES;
}

export function minimapScrollTop(
  clickY: number,
  canvasHeight: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const max = Math.max(0, scrollHeight - clientHeight);
  if (canvasHeight <= 0) return 0;
  const t = Math.min(1, Math.max(0, clickY / canvasHeight));
  return t * max;
}

export function minimapViewportRect(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  canvasHeight: number,
): { y: number; h: number } {
  const total = Math.max(1, scrollHeight);
  const h = Math.max(8, (clientHeight / total) * canvasHeight);
  const maxY = Math.max(0, canvasHeight - h);
  const maxScroll = Math.max(1, scrollHeight - clientHeight);
  const y = maxScroll <= 0 ? 0 : (scrollTop / maxScroll) * maxY;
  return { y, h };
}

export function lineInk(line: string, cols = SAMPLE_COLS): number {
  const slice = line.replace(/\t/g, "  ").slice(0, cols);
  let n = 0;
  for (let i = 0; i < slice.length; i += 1) {
    if (slice[i] !== " ") n += 1;
  }
  return n / Math.max(1, cols);
}

/** Map a source line onto the canvas so a short file still fills the pane. */
export function minimapLineSpan(
  index: number,
  lineCount: number,
  height: number,
): { y: number; h: number } {
  if (lineCount <= 0 || height <= 0 || index < 0 || index >= lineCount) return { y: 0, h: 0 };
  const y = Math.floor((index * height) / lineCount);
  const end = Math.floor(((index + 1) * height) / lineCount);
  return { y, h: Math.max(1, end - y) };
}

export function paintMinimap(
  ctx: Pick<CanvasRenderingContext2D, "clearRect" | "fillRect" | "fillStyle">,
  input: {
    width: number;
    height: number;
    lines: readonly string[];
    scrollTop: number;
    clientHeight: number;
    scrollHeight: number;
    ink: string;
    viewport: string;
  },
): void {
  const { width, height } = input;
  ctx.clearRect(0, 0, width, height);
  if (height <= 0 || !input.lines.length) return;
  const lineCount = input.lines.length;
  ctx.fillStyle = input.ink;
  for (let i = 0; i < lineCount; i += 1) {
    const ink = lineInk(input.lines[i] ?? "");
    if (ink <= 0) continue;
    const span = minimapLineSpan(i, lineCount, height);
    const w = Math.max(1, Math.round(ink * (width - 6)));
    ctx.fillRect(3, span.y, w, span.h > 2 ? span.h - 1 : span.h);
  }
  const view = minimapViewportRect(input.scrollTop, input.clientHeight, input.scrollHeight, height);
  ctx.fillStyle = input.viewport;
  ctx.fillRect(0, view.y, width, view.h);
}
