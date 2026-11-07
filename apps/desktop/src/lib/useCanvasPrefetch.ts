import { useEffect, useRef } from "react";
import type { AgentSession } from "@locus/shared";
import { api } from "./api";

export type CanvasPrefetchDispatch = (action: {
  type: "canvas";
  sessionId: string;
  html: string;
}) => void;

/**
 * Load `/workspace/index.html` for each design so sidebar / phone thumbs can
 * paint. In-flight fetches must still apply after a re-render: putting
 * `canvasHtml` in the effect deps (or dropping results on cleanup) cancels
 * siblings as soon as the first canvas lands, and React Strict Mode cleanup
 * would drop every first-pass request.
 */
export function useCanvasPrefetch(
  enabled: boolean,
  designs: AgentSession[],
  canvasHtml: Record<string, string>,
  dispatch: CanvasPrefetchDispatch,
) {
  const fetched = useRef(new Map<string, string>());
  const canvasHtmlRef = useRef(canvasHtml);
  canvasHtmlRef.current = canvasHtml;
  const designsRef = useRef(designs);
  designsRef.current = designs;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const catalog = designs.map((row) => `${row.id}:${row.updatedAt}:${row.status}`).join("|");

  useEffect(() => {
    if (!enabled) return;
    for (const session of designsRef.current) {
      if (canvasHtmlRef.current[session.id]) continue;
      const stamp = `${session.updatedAt}:${session.status}`;
      if (fetched.current.get(session.id) === stamp) continue;
      fetched.current.set(session.id, stamp);
      void api.canvas(session.id).then(
        (canvas) => {
          if (!canvas.html) return;
          if (canvasHtmlRef.current[session.id]) return;
          dispatchRef.current({ type: "canvas", sessionId: session.id, html: canvas.html });
        },
        () => {
          fetched.current.delete(session.id);
        },
      );
    }
  }, [enabled, catalog]);
}
