import { useEffect, type RefObject } from "react";
import {
  CANVAS_FRAME_HTML_TYPE,
  CANVAS_FRAME_PATH,
  CANVAS_FRAME_READY_TYPE,
  CANVAS_FRAME_SRCDOC_ATTR,
} from "@locus/shared";
import { withPhoneToken } from "./phoneAuth";

export function canvasFrameSrc(): string {
  return withPhoneToken(CANVAS_FRAME_PATH);
}

export function isCanvasFrameReady(
  data: unknown,
): data is { type: typeof CANVAS_FRAME_READY_TYPE } {
  return Boolean(
    data &&
    typeof data === "object" &&
    (data as { type?: unknown }).type === CANVAS_FRAME_READY_TYPE,
  );
}

export function postCanvasFrameHtml(win: Window | null | undefined, html: string): void {
  if (!win || !html) return;
  try {
    win.postMessage({ type: CANVAS_FRAME_HTML_TYPE, html }, "*");
  } catch {
    /* unique-origin frames still accept postMessage */
  }
}

export function canvasFrameDoc(frame: HTMLIFrameElement | null | undefined): string {
  return frame?.getAttribute(CANVAS_FRAME_SRCDOC_ATTR) ?? frame?.srcdoc ?? "";
}

/** Inject painted HTML into a /api/canvas-frame runner once it (or a later html) is ready. */
export function useCanvasFrameHtml(
  html: string | null | undefined,
  frameRef: RefObject<HTMLIFrameElement | null>,
): void {
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const frame = frameRef.current;
      if (!frame?.contentWindow || event.source !== frame.contentWindow) return;
      if (isCanvasFrameReady(event.data)) postCanvasFrameHtml(frame.contentWindow, html ?? "");
    }
    window.addEventListener("message", onMessage);
    postCanvasFrameHtml(frameRef.current?.contentWindow, html ?? "");
    return () => window.removeEventListener("message", onMessage);
  }, [html, frameRef]);
}
