/** FitAddon sizes rows from the parent border box and ignores parent padding. */

export function ptyRowsForHost(visibleHeight: number, cellHeight: number): number {
  if (!(cellHeight > 0)) return 1;
  return Math.max(1, Math.floor(visibleHeight / cellHeight));
}

type FitTerm = {
  cols: number;
  rows: number;
  element?: HTMLElement;
  resize(cols: number, rows: number): void;
};

function box(el: Element): DOMRect {
  return el.getBoundingClientRect();
}

function layerHeight(el: HTMLElement): number {
  const rect = box(el);
  return Math.max(rect.height, el.clientHeight, el.offsetHeight);
}

function contentHeight(el: HTMLElement): number {
  const style = getComputedStyle(el);
  const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const inner = layerHeight(el) - (Number.isFinite(pad) ? pad : 0);
  return Math.max(0, inner);
}

function paintedLayer(termEl: HTMLElement): HTMLElement | undefined {
  const canvas = termEl.querySelector("canvas");
  if (canvas instanceof HTMLElement && layerHeight(canvas) > 0) return canvas;
  const rows = termEl.querySelector(".xterm-rows");
  if (rows instanceof HTMLElement && layerHeight(rows) > 0) return rows;
  const screen = termEl.querySelector(".xterm-screen");
  return screen instanceof HTMLElement ? screen : undefined;
}

function clipLayer(termEl: HTMLElement): HTMLElement {
  const host = termEl.closest(".pty-host");
  if (host instanceof HTMLElement && layerHeight(host) > 0) return host;
  const frame = termEl.closest(".pty-frame");
  if (frame instanceof HTMLElement && layerHeight(frame) > 0) return frame;
  return termEl;
}

function isHiddenPty(el: HTMLElement): boolean {
  return Boolean(el.closest("[hidden]") || el.closest(".collapsed"));
}

function axisClips(value: string): boolean {
  return value === "hidden" || value === "auto" || value === "scroll" || value === "clip";
}

function clipsOverflowY(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  if (axisClips(style.overflowY)) return true;
  // jsdom leaves overflowY as "visible" when only `overflow` is set.
  if (style.overflowY === "visible" || style.overflowY === "") {
    const shorthand = style.overflow.trim().split(/\s+/)[0] ?? "";
    return axisClips(shorthand);
  }
  return false;
}

/** Host content box intersected with overflow-clip ancestors (getBoundingClientRect is not clipped). */
export function ptyVisibleHeight(el: HTMLElement): number {
  const rect = box(el);
  const height = contentHeight(el);
  if (height <= 0) return 0;
  let top = rect.height > 0 ? rect.top : 0;
  let bottom = rect.height > 0 ? rect.bottom : top + height;
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (!clipsOverflowY(node)) continue;
    const br = box(node);
    const nh = layerHeight(node);
    if (nh <= 0) continue;
    const nTop = br.height > 0 ? br.top : 0;
    const nBottom = br.height > 0 ? br.bottom : nTop + nh;
    top = Math.max(top, nTop);
    bottom = Math.min(bottom, nBottom);
  }
  const clipped = bottom - top;
  if (clipped > 0 && clipped < height) return clipped;
  return height;
}

/** After FitAddon.fit(), shrink until the painted rows sit inside the visible clip box. */
export function fitPty(fit: { fit(): void }, term: FitTerm): void {
  const el = term.element;
  if (!el || isHiddenPty(el)) return;
  const clip = clipLayer(el);
  if (ptyVisibleHeight(clip) <= 0) return;
  fit.fit();
  if (term.rows < 1) return;
  for (let i = 0; i < 4 && term.rows > 1; i += 1) {
    const painted = paintedLayer(el);
    if (!painted) return;
    const paintedH = layerHeight(painted);
    const visibleH = ptyVisibleHeight(clip);
    if (visibleH <= 0 || paintedH <= 0) return;
    if (paintedH <= visibleH + 0.5) return;
    const rows = ptyRowsForHost(visibleH, paintedH / term.rows);
    if (rows >= term.rows) return;
    term.resize(term.cols, rows);
  }
}
