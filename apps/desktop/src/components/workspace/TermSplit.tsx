import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

export const HOST_TERM_SPLIT_KEY = "locus.hostTermSplit";
export const DOCKER_TERM_SPLIT_KEY = "locus.dockerTermSplit";
export const TERM_SPLIT_MIN = 0.18;
export const TERM_SPLIT_MAX = 0.72;
export const HOST_TERM_SPLIT_DEFAULT = 0.32;
export const DOCKER_TERM_SPLIT_DEFAULT = 0.4;
export const TERM_GUTTER_PX = 6;
/** Matches `.docker-term .term-tabs` min-height. */
export const TERM_TAB_ROW_PX = 36;
/** Editor stays `1fr` so CSS can interpolate the terminal track (`36px` ↔ `Npx`). */
export const TERM_COLLAPSED_ROWS = `minmax(0, 1fr) 0px ${TERM_TAB_ROW_PX}px`;

export function clampTermSplit(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.round(value * 100) / 100;
  return Math.min(TERM_SPLIT_MAX, Math.max(TERM_SPLIT_MIN, rounded));
}

export function loadTermSplit(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw.trim() === "") return clampTermSplit(fallback, fallback);
    return clampTermSplit(Number(raw), fallback);
  } catch {
    return clampTermSplit(fallback, fallback);
  }
}

export function saveTermSplit(key: string, value: number, fallback: number) {
  try {
    localStorage.setItem(key, String(clampTermSplit(value, fallback)));
  } catch {
    /* ignore quota / private mode */
  }
}

export function expandedTermPx(height: number, frac: number): number {
  const usable = Math.max(0, height - TERM_GUTTER_PX);
  return Math.max(120, Math.min(Math.max(0, usable - 80), Math.round(usable * frac)));
}

export function termSplitRows(frac: number, collapsed: boolean, height = 0): string {
  if (collapsed) return TERM_COLLAPSED_ROWS;
  if (height > TERM_TAB_ROW_PX) {
    return `minmax(0, 1fr) ${TERM_GUTTER_PX}px ${expandedTermPx(height, frac)}px`;
  }
  return `minmax(80px, ${1 - frac}fr) ${TERM_GUTTER_PX}px minmax(120px, ${frac}fr)`;
}

export function useTermSplit(key: string, fallback: number, collapsed: boolean) {
  const [frac, setFrac] = useState(() => loadTermSplit(key, fallback));
  const [dragging, setDragging] = useState(false);
  const [height, setHeight] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const read = () => {
      const next = Math.round(el.getBoundingClientRect().height);
      setHeight((prev) => (prev === next ? prev : next));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function onGutterDown(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    const origin = event.clientY;
    const start = frac;
    const paneHeight = root.current?.getBoundingClientRect().height ?? 0;
    if (paneHeight <= TERM_GUTTER_PX) return;
    const node = event.currentTarget;
    if (typeof node.setPointerCapture === "function") node.setPointerCapture(event.pointerId);
    setDragging(true);
    function move(ev: PointerEvent) {
      setFrac(clampTermSplit(start - (ev.clientY - origin) / paneHeight, fallback));
    }
    function up() {
      setDragging(false);
      if (typeof node.releasePointerCapture === "function") {
        node.releasePointerCapture(event.pointerId);
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setFrac((value) => {
        saveTermSplit(key, value, fallback);
        return value;
      });
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onHandleDown(event: ReactPointerEvent<HTMLElement>) {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("button, input, select, textarea, a, [role='button']")
    ) {
      return;
    }
    onGutterDown(event);
  }

  function onGutterKey(event: ReactKeyboardEvent<HTMLElement>) {
    const step = event.shiftKey ? 0.08 : 0.03;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setFrac((value) => {
        const next = clampTermSplit(value + step, fallback);
        saveTermSplit(key, next, fallback);
        return next;
      });
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setFrac((value) => {
        const next = clampTermSplit(value - step, fallback);
        saveTermSplit(key, next, fallback);
        return next;
      });
    } else if (event.key === "Home") {
      event.preventDefault();
      setFrac(() => {
        saveTermSplit(key, TERM_SPLIT_MIN, fallback);
        return TERM_SPLIT_MIN;
      });
    } else if (event.key === "End") {
      event.preventDefault();
      setFrac(() => {
        saveTermSplit(key, TERM_SPLIT_MAX, fallback);
        return TERM_SPLIT_MAX;
      });
    }
  }

  return {
    frac,
    dragging,
    gridTemplateRows: termSplitRows(frac, collapsed, height),
    root,
    onGutterDown,
    onHandleDown,
    onGutterKey,
  };
}

export function TermGutter(props: {
  collapsed: boolean;
  frac: number;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}) {
  const percent = Math.round(props.frac * 100);
  return (
    <div
      className="term-gutter"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize terminal"
      aria-hidden={props.collapsed || undefined}
      aria-valuemin={Math.round(TERM_SPLIT_MIN * 100)}
      aria-valuemax={Math.round(TERM_SPLIT_MAX * 100)}
      aria-valuenow={percent}
      aria-valuetext={`${percent}% terminal`}
      tabIndex={props.collapsed ? -1 : 0}
      onPointerDown={props.collapsed ? undefined : props.onPointerDown}
      onKeyDown={props.collapsed ? undefined : props.onKeyDown}
    />
  );
}
