export const EDITOR_LINE_PX = 18;
export const EDITOR_PAD_PX = 12;
export const EDITOR_CHAR_PX = 7.2;
export const EDITOR_VIEW_BUFFER = 24;
export const EDITOR_VIEW_FALLBACK = 96;
/** Refresh the painted window before the overscan is exhausted. */
const VIEW_RELOAD_MARGIN = 8;

function wrapCols(widthPx: number, charPx: number): number {
  return Math.max(1, Math.floor(Math.max(charPx, widthPx) / charPx));
}

function lineDisplayWidth(line: string, tabSize: number, upTo?: number): number {
  const end = upTo == null ? line.length : Math.min(line.length, Math.max(0, upTo));
  let width = 0;
  for (let i = 0; i < end; i += 1) {
    if (line[i] === "\t") width += tabSize - (width % tabSize);
    else width += 1;
  }
  return width;
}

export function wrapLineHeightsFromLines(
  lines: readonly string[],
  widthPx: number,
  charPx = EDITOR_CHAR_PX,
  tabSize = 2,
): number[] {
  const cols = wrapCols(widthPx, charPx);
  if (!lines.length) return [1];
  return lines.map((line) =>
    Math.max(1, Math.ceil(Math.max(1, lineDisplayWidth(line, tabSize)) / cols)),
  );
}

export function wrapVisualAt(
  line: string,
  character: number,
  widthPx: number,
  charPx = EDITOR_CHAR_PX,
  tabSize = 2,
): { row: number; col: number } {
  const cols = wrapCols(widthPx, charPx);
  const width = lineDisplayWidth(line, tabSize, character);
  return { row: Math.floor(width / cols), col: width % cols };
}

export function visualPrefix(heights: readonly number[]): number[] {
  const prefix = [0];
  for (const h of heights) prefix.push(prefix[prefix.length - 1]! + h);
  return prefix;
}

export function visualCount(heights: readonly number[]): number {
  return heights.reduce((sum, n) => sum + n, 0) || 1;
}

export function logicalIndexAtVisual(prefix: readonly number[], visualZero: number): number {
  if (prefix.length < 2) return 0;
  const clamped = Math.max(0, visualZero);
  for (let i = 0; i < prefix.length - 1; i += 1) {
    if (clamped < prefix[i + 1]!) return i;
  }
  return prefix.length - 2;
}

export function lineOffsetInView(
  line: number,
  viewStart: number,
  heights?: readonly number[],
): number {
  if (!heights?.length) return (line - viewStart) * EDITOR_LINE_PX;
  const prefix = visualPrefix(heights);
  const from = prefix[Math.max(0, viewStart - 1)] ?? 0;
  const at = prefix[Math.max(0, line - 1)] ?? from;
  return (at - from) * EDITOR_LINE_PX;
}

export function markHeightPx(
  startLine: number,
  lineCount: number,
  heights?: readonly number[],
): number {
  const count = Math.max(1, lineCount);
  if (!heights?.length) return count * EDITOR_LINE_PX;
  const prefix = visualPrefix(heights);
  const from = prefix[Math.max(0, startLine - 1)] ?? 0;
  const to = prefix[Math.min(heights.length, startLine - 1 + count)] ?? from + count;
  return Math.max(EDITOR_LINE_PX, (to - from) * EDITOR_LINE_PX);
}

export function editorScrollHeight(lineCount: number, heights?: readonly number[]): number {
  const visual = heights?.length ? visualCount(heights) : Math.max(1, lineCount);
  return EDITOR_PAD_PX * 2 + visual * EDITOR_LINE_PX;
}

export function editorViewRange(
  scrollTop: number,
  clientHeight: number,
  lineCount: number,
  heights?: readonly number[],
): { start: number; end: number } {
  if (!heights?.length) {
    if (clientHeight <= 0) {
      return { start: 1, end: Math.min(lineCount, EDITOR_VIEW_FALLBACK) };
    }
    const start = Math.max(
      1,
      Math.floor((scrollTop - EDITOR_PAD_PX) / EDITOR_LINE_PX) - EDITOR_VIEW_BUFFER + 1,
    );
    const end = Math.min(
      lineCount,
      Math.floor((scrollTop + clientHeight - EDITOR_PAD_PX) / EDITOR_LINE_PX) +
        EDITOR_VIEW_BUFFER +
        1,
    );
    return { start, end: Math.max(start, end) };
  }
  const total = visualCount(heights);
  const prefix = visualPrefix(heights);
  if (clientHeight <= 0) {
    const visEnd = Math.min(total, EDITOR_VIEW_FALLBACK);
    return {
      start: logicalIndexAtVisual(prefix, 0) + 1,
      end: logicalIndexAtVisual(prefix, Math.max(0, visEnd - 1)) + 1,
    };
  }
  const visStart = Math.max(
    0,
    Math.floor((scrollTop - EDITOR_PAD_PX) / EDITOR_LINE_PX) - EDITOR_VIEW_BUFFER,
  );
  const visEnd = Math.min(
    total,
    Math.floor((scrollTop + clientHeight - EDITOR_PAD_PX) / EDITOR_LINE_PX) +
      EDITOR_VIEW_BUFFER +
      1,
  );
  const start = logicalIndexAtVisual(prefix, visStart) + 1;
  const end = logicalIndexAtVisual(prefix, Math.max(visStart, visEnd - 1)) + 1;
  return { start, end: Math.max(start, end) };
}

/** Keep the current window while the viewport stays inside the overscan. */
export function shouldUpdateEditorView(
  current: { start: number; end: number },
  next: { start: number; end: number },
  margin = VIEW_RELOAD_MARGIN,
): boolean {
  if (next.start === current.start && next.end === current.end) return false;
  return next.start < current.start + margin || next.end > current.end - margin;
}

export function gutterNumberText(start: number, end: number): string {
  const from = Math.max(1, start);
  const to = Math.max(from, end);
  let out = String(from);
  for (let i = from + 1; i <= to; i += 1) out += `\n${i}`;
  return out;
}

export function overlayTranslateY(
  startLine: number,
  scrollTop: number,
  heights?: readonly number[],
): number {
  if (!heights?.length) return (Math.max(1, startLine) - 1) * EDITOR_LINE_PX - scrollTop;
  const prefix = visualPrefix(heights);
  const visual = prefix[Math.max(0, startLine - 1)] ?? 0;
  return visual * EDITOR_LINE_PX - scrollTop;
}

/** Place the inline AI box just under the last line of the selection in the painted window. */
export function inlineAiAnchorTop(
  endLine: number,
  viewStart: number,
  heights?: readonly number[],
): number {
  return EDITOR_PAD_PX + lineOffsetInView(endLine, viewStart, heights) + EDITOR_LINE_PX + 4;
}

export function inlineAiSelectionRects(opts: {
  startLine: number;
  endLine: number;
  startCol: number;
  endCol: number;
  viewStart: number;
  viewEnd: number;
  lineText: (line: number) => string;
  heights?: readonly number[];
  wrapWidth?: number;
  tabSize?: number;
}): Array<{ top: number; left: number; width: number; height: number }> {
  const from = Math.max(opts.startLine, opts.viewStart);
  const to = Math.min(opts.endLine, opts.viewEnd);
  if (to < from) return [];
  const tabSize = opts.tabSize ?? 2;
  const rects: Array<{ top: number; left: number; width: number; height: number }> = [];
  for (let line = from; line <= to; line += 1) {
    const text = opts.lineText(line);
    const colStart = line === opts.startLine ? Math.max(0, opts.startCol - 1) : 0;
    const colEnd =
      line === opts.endLine ? Math.max(colStart, opts.endCol - 1) : Math.max(colStart, text.length);
    const lineTop = EDITOR_PAD_PX + lineOffsetInView(line, opts.viewStart, opts.heights);
    if (opts.wrapWidth && opts.wrapWidth > 0) {
      const cols = wrapCols(opts.wrapWidth, EDITOR_CHAR_PX);
      const startVis = wrapVisualAt(text, colStart, opts.wrapWidth, EDITOR_CHAR_PX, tabSize);
      const endVis = wrapVisualAt(text, colEnd, opts.wrapWidth, EDITOR_CHAR_PX, tabSize);
      for (let row = startVis.row; row <= endVis.row; row += 1) {
        const leftCol = row === startVis.row ? startVis.col : 0;
        const rightCol = row === endVis.row ? Math.max(leftCol + 1, endVis.col) : cols;
        rects.push({
          top: lineTop + row * EDITOR_LINE_PX,
          left: EDITOR_PAD_PX + leftCol * EDITOR_CHAR_PX,
          width: Math.max(EDITOR_CHAR_PX, (rightCol - leftCol) * EDITOR_CHAR_PX),
          height: EDITOR_LINE_PX,
        });
      }
    } else {
      rects.push({
        top: lineTop,
        left: EDITOR_PAD_PX + colStart * EDITOR_CHAR_PX,
        width: Math.max(EDITOR_CHAR_PX, (colEnd - colStart) * EDITOR_CHAR_PX),
        height: EDITOR_LINE_PX,
      });
    }
  }
  return rects;
}

export function marksInView<T extends { startLine: number; lineCount: number }>(
  marks: readonly T[],
  startLine: number,
  endLine: number,
): T[] {
  return marks.filter((mark) => {
    const from = mark.startLine;
    const to = from + Math.max(1, mark.lineCount) - 1;
    return to >= startLine && from <= endLine;
  });
}

export function diagsInView<T extends { startLine: number }>(
  diags: readonly T[],
  startLine: number,
  endLine: number,
): T[] {
  return diags.filter((diag) => {
    const line = diag.startLine + 1;
    return line >= startLine && line <= endLine;
  });
}
