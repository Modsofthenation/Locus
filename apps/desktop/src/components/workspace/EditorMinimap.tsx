import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import {
  MINIMAP_WIDTH,
  minimapScrollTop,
  paintMinimap,
  shouldShowMinimap,
} from "@/lib/editorMinimap";

export function EditorMinimap(props: {
  hostRef: RefObject<HTMLDivElement | null>;
  text: string;
  lineCount: number;
  binary?: boolean;
  enabled?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef(false);
  const visible = shouldShowMinimap({
    lineCount: props.lineCount,
    binary: props.binary,
    enabled: props.enabled,
  });

  useEffect(() => {
    if (!visible) return;
    const host = props.hostRef.current;
    const el = canvas.current;
    if (!host || !el) return;
    const lines = props.text.split("\n");
    const ink = getComputedStyle(el).getPropertyValue("--muted") || "#8b909c";
    const viewport =
      getComputedStyle(el).getPropertyValue("--minimap-window") || "rgba(255,255,255,0.14)";

    function paint() {
      const node = canvas.current;
      if (!node || !host) return;
      const height = Math.max(1, Math.floor(host.clientHeight));
      const width = MINIMAP_WIDTH;
      if (node.width !== width) node.width = width;
      if (node.height !== height) node.height = height;
      const ctx = node.getContext("2d");
      if (!ctx) return;
      paintMinimap(ctx, {
        width,
        height,
        lines,
        scrollTop: host.scrollTop,
        clientHeight: host.clientHeight,
        scrollHeight: host.scrollHeight,
        ink: ink.trim() || "#9aa4b2",
        viewport: viewport.trim() || "rgba(255,255,255,0.14)",
      });
    }

    paint();
    host.addEventListener("scroll", paint, { passive: true });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(paint) : null;
    ro?.observe(host);
    return () => {
      host.removeEventListener("scroll", paint);
      ro?.disconnect();
    };
  }, [visible, props.hostRef, props.text, props.lineCount]);

  if (!visible) return null;

  function scrollTo(event: ReactPointerEvent<HTMLCanvasElement>) {
    const host = props.hostRef.current;
    const el = canvas.current;
    if (!host || !el) return;
    const rect = el.getBoundingClientRect();
    const next = minimapScrollTop(
      event.clientY - rect.top,
      rect.height,
      host.scrollHeight,
      host.clientHeight,
    );
    host.scrollTop = next;
  }

  return (
    <canvas
      ref={canvas}
      className="workspace-minimap"
      width={MINIMAP_WIDTH}
      height={120}
      aria-label="Editor minimap"
      data-testid="editor-minimap"
      onPointerDown={(event) => {
        drag.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        scrollTo(event);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        scrollTo(event);
      }}
      onPointerUp={() => {
        drag.current = false;
      }}
      onPointerCancel={() => {
        drag.current = false;
      }}
    />
  );
}
