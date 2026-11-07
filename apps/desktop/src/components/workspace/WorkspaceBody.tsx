import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useStackedWorkspace } from "@/lib/useStackedWorkspace";

export const CHAT_SPLIT_KEY = "locus.chatSplit";
export const DESIGN_SPLIT_KEY = "locus.designSplit";
export const IDE_SPLIT_KEY = "locus.ideSplit";
export const CHAT_SPLIT_MIN = 0.28;
export const CHAT_SPLIT_MAX = 0.72;
export const CHAT_SPLIT_DEFAULT = 0.55;
export const DESIGN_SPLIT_DEFAULT = 0.4;
export const IDE_SPLIT_DEFAULT = 0.62;
export const PREVIEW_RAIL_PX = 44;
export const STACKED_RAIL_PX = 48;
const GUTTER_PX = 6;
/** Same track count as the expanded split so the grid can interpolate to a rail. */
export const COLLAPSED_BODY_COLUMNS = `minmax(0, 1fr) 0px minmax(${PREVIEW_RAIL_PX}px, 0fr)`;
/** Definite bottom track so the rail cannot collapse to 0 on portrait rows. */
export const COLLAPSED_BODY_ROWS = `minmax(0, 1fr) 0px ${STACKED_RAIL_PX}px`;
export const SINGLE_BODY_TRACK = "minmax(0, 1fr)";

export function splitTracks(frac: number): string {
  return `minmax(0, ${frac}fr) ${GUTTER_PX}px minmax(0, ${1 - frac}fr)`;
}

/** Pixel bottom track so collapse interpolates to an expanded pane. */
export function stackedBodyRows(frac: number, collapsed: boolean, height: number): string {
  if (collapsed) return COLLAPSED_BODY_ROWS;
  if (height > STACKED_RAIL_PX + GUTTER_PX) {
    const usable = Math.max(0, height - GUTTER_PX);
    const bottom = Math.max(160, Math.min(Math.round(usable * (1 - frac)), usable - 160));
    return `minmax(0, 1fr) ${GUTTER_PX}px ${bottom}px`;
  }
  return splitTracks(frac);
}

export function clampChatSplit(value: number, fallback = CHAT_SPLIT_DEFAULT): number {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.round(value * 100) / 100;
  return Math.min(CHAT_SPLIT_MAX, Math.max(CHAT_SPLIT_MIN, rounded));
}

export function loadChatSplit(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw.trim() === "") return clampChatSplit(fallback, fallback);
    return clampChatSplit(Number(raw), fallback);
  } catch {
    return clampChatSplit(fallback, fallback);
  }
}

export function saveChatSplit(key: string, value: number) {
  try {
    localStorage.setItem(key, String(clampChatSplit(value)));
  } catch {
    /* ignore quota / private mode */
  }
}

export function WorkspaceBody(props: {
  variant: "agent" | "design" | "host" | "ide" | "board";
  collapsed: boolean;
  chat: ReactNode;
  preview: ReactNode | null;
}) {
  const hostChat = props.variant === "host" || !props.preview;
  const editorFirst = props.variant === "ide" || props.variant === "board";
  const splitKey =
    props.variant === "design" ? DESIGN_SPLIT_KEY : editorFirst ? IDE_SPLIT_KEY : CHAT_SPLIT_KEY;
  const fallback =
    props.variant === "design"
      ? DESIGN_SPLIT_DEFAULT
      : editorFirst
        ? IDE_SPLIT_DEFAULT
        : CHAT_SPLIT_DEFAULT;
  const prefersStacked = useStackedWorkspace();
  const [frac, setFrac] = useState(() => loadChatSplit(splitKey, fallback));
  const [dragging, setDragging] = useState(false);
  const [height, setHeight] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const hasSplit = Boolean(props.preview) && !hostChat;
  const stacked = prefersStacked && hasSplit;

  useEffect(() => {
    setFrac(loadChatSplit(splitKey, fallback));
  }, [splitKey, fallback]);

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

  function nudgeFrac(next: number) {
    const clamped = clampChatSplit(next);
    saveChatSplit(splitKey, clamped);
    setFrac(clamped);
  }

  function onGutterDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const box = root.current?.getBoundingClientRect();
    const size = stacked ? (box?.height ?? 0) : (box?.width ?? 0);
    if (size <= GUTTER_PX) return;
    const origin = stacked ? event.clientY : event.clientX;
    const start = frac;
    const node = event.currentTarget;
    if (typeof node.setPointerCapture === "function") node.setPointerCapture(event.pointerId);
    setDragging(true);
    function move(ev: PointerEvent) {
      const point = stacked ? ev.clientY : ev.clientX;
      setFrac(clampChatSplit(start + (point - origin) / size));
    }
    function up() {
      setDragging(false);
      if (typeof node.releasePointerCapture === "function")
        node.releasePointerCapture(event.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setFrac((value) => {
        saveChatSplit(splitKey, value);
        return value;
      });
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onGutterKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 0.08 : 0.03;
    const shrink = event.key === "ArrowLeft" || (stacked && event.key === "ArrowUp");
    const grow = event.key === "ArrowRight" || (stacked && event.key === "ArrowDown");
    if (shrink) {
      event.preventDefault();
      nudgeFrac(frac - step);
    } else if (grow) {
      event.preventDefault();
      nudgeFrac(frac + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      nudgeFrac(CHAT_SPLIT_MIN);
    } else if (event.key === "End") {
      event.preventDefault();
      nudgeFrac(CHAT_SPLIT_MAX);
    }
  }

  const className = [
    "body",
    props.variant === "design" ? "design" : "",
    editorFirst ? "ide" : "",
    props.variant === "board" ? "board" : "",
    hostChat ? "host-chat" : "",
    props.collapsed ? "vm-collapsed" : "",
    stacked ? "body-stacked" : "",
    dragging ? "resizing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const percent = Math.round(frac * 100);
  const gutterLabel = editorFirst ? "Resize editor and chat" : "Resize chat and preview";
  const valueText = editorFirst ? `${percent}% editor` : `${percent}% chat`;
  const expandedTracks = splitTracks(frac);
  const stackedRows = stackedBodyRows(frac, props.collapsed, height);

  return (
    <div
      ref={root}
      className={className}
      style={
        hasSplit
          ? stacked
            ? {
                gridTemplateColumns: SINGLE_BODY_TRACK,
                gridTemplateRows: stackedRows,
              }
            : {
                gridTemplateColumns: props.collapsed ? COLLAPSED_BODY_COLUMNS : expandedTracks,
              }
          : undefined
      }
    >
      {editorFirst ? (
        <div id="files-pane" className="body-files" tabIndex={-1}>
          {props.preview}
        </div>
      ) : (
        props.chat
      )}
      {hasSplit ? (
        <div
          className="body-gutter"
          role="separator"
          aria-orientation={stacked ? "horizontal" : "vertical"}
          aria-label={gutterLabel}
          aria-hidden={props.collapsed || undefined}
          aria-valuemin={Math.round(CHAT_SPLIT_MIN * 100)}
          aria-valuemax={Math.round(CHAT_SPLIT_MAX * 100)}
          aria-valuenow={percent}
          aria-valuetext={valueText}
          tabIndex={props.collapsed ? -1 : 0}
          onPointerDown={props.collapsed ? undefined : onGutterDown}
          onKeyDown={props.collapsed ? undefined : onGutterKey}
        />
      ) : null}
      {editorFirst ? (
        props.chat
      ) : props.preview ? (
        <div id="files-pane" className="body-files" tabIndex={-1}>
          {props.preview}
        </div>
      ) : null}
    </div>
  );
}
