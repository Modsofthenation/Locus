import { useEffect, useRef, useState } from "react";
import { agentCanvasDocument, newestAgentCanvas, type AgentCanvasRef } from "@locus/shared";
import { api } from "@/lib/api";

/**
 * Opens the canvas tab when this chat's canvas metadata changes after the
 * first paint. Opening an existing chat stays on Files.
 */
export function useAgentCanvasFocus(
  sessionId: string | undefined,
  canvases: AgentCanvasRef[] | undefined,
): number {
  const stamp = (canvases ?? []).map((row) => `${row.id}:${row.updatedAt}`).join("|");
  const [focus, setFocus] = useState(0);
  const [seen, setSeen] = useState<{ sessionId?: string; stamp: string } | null>(null);

  useEffect(() => {
    if (!seen || seen.sessionId !== sessionId) {
      setSeen({ sessionId, stamp });
      setFocus(0);
      return;
    }
    if (seen.stamp !== stamp && stamp) {
      setSeen({ sessionId, stamp });
      setFocus((current) => current + 1);
    }
  }, [sessionId, stamp, seen]);

  return focus;
}

/** Runs `open` once per new canvas. Pane collapse must not run it again. */
export function useAgentCanvasOpen(focus: number, open: () => void): void {
  const openRef = useRef(open);
  openRef.current = open;
  const handled = useRef(0);
  useEffect(() => {
    if (!focus) {
      handled.current = 0;
      return;
    }
    if (handled.current === focus) return;
    handled.current = focus;
    openRef.current();
  }, [focus]);
}

export function AgentCanvasPane(props: {
  sessionId: string;
  canvases: AgentCanvasRef[];
  focus: number;
}) {
  const newest = newestAgentCanvas(props.canvases);
  const [active, setActive] = useState(newest?.id ?? "");
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = props.canvases.find((row) => row.id === active) ?? newest;
  const selectedId = selected?.id;
  const selectedUpdated = selected?.updatedAt;

  useEffect(() => {
    const next = newest?.id;
    if (next) setActive(next);
    // Follow the canvas just written. Depending on `canvases` would overwrite a tab pick on every session refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focus, props.sessionId]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setError(null);
    void api
      .agentCanvas(props.sessionId, selectedId)
      .then((doc) => {
        if (!cancelled) setHtml(doc.html);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setHtml(null);
          setError(err instanceof Error ? err.message : "Couldn't open the canvas");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.sessionId, selectedId, selectedUpdated]);

  if (!selected) return null;
  return (
    <div className="agent-canvas-stage">
      {props.canvases.length > 1 ? (
        <div className="agent-canvas-bar" role="tablist" aria-label="Canvases">
          {props.canvases.map((row) => (
            <button
              key={row.id}
              type="button"
              role="tab"
              className={`btn small ghost ${row.id === selected.id ? "on" : ""}`}
              aria-selected={row.id === selected.id}
              onClick={() => setActive(row.id)}
            >
              {row.title}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="hint">{error}</p> : null}
      {html ? (
        <iframe title={selected.title} sandbox="allow-scripts" srcDoc={agentCanvasDocument(html)} />
      ) : error ? null : (
        <p className="hint">Opening {selected.title}…</p>
      )}
    </div>
  );
}
