import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  canShowTimeline,
  timelineStops,
  type AgentSession,
  type TimelineStop,
} from "@locus/shared";
import { api } from "@/lib/api";
import { useStore } from "@/state/store";
import { DesktopOverlay } from "@/components/layout/DesktopOverlay";

type TimelineCtx = {
  sessionId: string;
  stops: TimelineStop[];
  selected: TimelineStop | undefined;
  busy: boolean;
  select: (id: string) => void;
  restore: (checkpointId: string) => void;
};

const Timeline = createContext<TimelineCtx | null>(null);

function useTimeline() {
  const ctx = useContext(Timeline);
  if (!ctx) throw new Error("GuestTimeline missing");
  return ctx;
}

export function screenshotSrc(
  sessionId: string,
  stop: Pick<TimelineStop, "screenshotBase64" | "screenshotName">,
): string | undefined {
  if (stop.screenshotBase64) return `data:image/png;base64,${stop.screenshotBase64}`;
  if (stop.screenshotName) {
    return `/api/sessions/${sessionId}/screenshots/${encodeURIComponent(stop.screenshotName)}`;
  }
  return undefined;
}

export function GuestTimeline({
  session,
  children,
}: {
  session: AgentSession;
  children: ReactNode;
}) {
  const { state, dispatch } = useStore();
  const [selectedId, setSelectedId] = useState("live");
  const [busy, setBusy] = useState(false);
  const stops = useMemo(() => timelineStops(session), [session]);
  const selected = stops.find((stop) => stop.id === selectedId) ?? stops.find((stop) => stop.live);

  useEffect(() => {
    setSelectedId("live");
  }, [session.id]);

  useEffect(() => {
    const seek = state.timelineSeek;
    if (!seek || seek.sessionId !== session.id) return;
    setSelectedId(seek.stopId);
    dispatch({ type: "seekTimeline", seek: null });
  }, [state.timelineSeek, session.id, dispatch]);

  useEffect(() => {
    if (!stops.some((stop) => stop.id === selectedId)) setSelectedId("live");
  }, [selectedId, stops]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (selected?.live !== false) return;
      event.preventDefault();
      setSelectedId("live");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected?.live]);

  async function restore(checkpointId: string) {
    setBusy(true);
    try {
      const updated = await api.rewind(session.id, checkpointId);
      dispatch({ type: "session", session: updated });
      setSelectedId("live");
    } catch {
      /* keep the preview so Restore can be retried */
    } finally {
      setBusy(false);
    }
  }

  if (!canShowTimeline(session)) return children;

  return (
    <Timeline.Provider
      value={{
        sessionId: session.id,
        stops,
        selected,
        busy,
        select: setSelectedId,
        restore: (checkpointId) => void restore(checkpointId),
      }}
    >
      {children}
      <Filmstrip />
    </Timeline.Provider>
  );
}

export function TimelinePreviewLayer() {
  const ctx = useContext(Timeline);
  if (!ctx?.selected || ctx.selected.live) return null;
  const stop = ctx.selected;
  const src = screenshotSrc(ctx.sessionId, stop);
  return (
    <div className="timeline-preview" data-testid="timeline-preview">
      {src ? (
        <img alt="" src={src} />
      ) : (
        <div className="replay-empty">No screenshot at this step</div>
      )}
      {stop.overlay ? <DesktopOverlay overlay={stop.overlay} /> : null}
      <div className="timeline-preview-bar">
        <span>
          Preview · {stop.who}
          {stop.content ? ` · ${stop.content.slice(0, 72)}` : ""}
        </span>
        <span className="row">
          {stop.checkpointId ? (
            <button
              type="button"
              className="btn small primary"
              disabled={ctx.busy}
              onClick={() => ctx.restore(stop.checkpointId!)}
            >
              {ctx.busy ? "Restoring…" : "Restore"}
            </button>
          ) : null}
          <button type="button" className="btn small" onClick={() => ctx.select("live")}>
            Now
          </button>
        </span>
      </div>
    </div>
  );
}

function Filmstrip() {
  const { sessionId, stops, selected, select } = useTimeline();
  const index = Math.max(
    0,
    stops.findIndex((stop) => stop.id === selected?.id),
  );

  return (
    <div className="guest-timeline" data-testid="guest-timeline">
      <div className="guest-timeline-track" role="toolbar" aria-label="Guest timeline">
        {stops.map((stop) => {
          const src = screenshotSrc(sessionId, stop);
          const active = stop.id === selected?.id;
          return (
            <button
              key={stop.id}
              type="button"
              className={`timeline-stop ${active ? "active" : ""} ${stop.live ? "live" : ""} ${src ? "" : "blank"}`}
              title={
                stop.live
                  ? "Now — live guest"
                  : `${stop.who}${stop.checkpointId ? " · restore point" : ""}`
              }
              aria-current={active ? "true" : undefined}
              onClick={() => select(stop.id)}
            >
              {src ? (
                <img alt="" src={src} />
              ) : (
                <span className="timeline-stop-label">{stop.live ? "Now" : "Turn"}</span>
              )}
              {stop.checkpointId ? <span className="timeline-mark" /> : null}
            </button>
          );
        })}
      </div>
      {stops.length > 2 ? (
        <input
          type="range"
          min={0}
          max={stops.length - 1}
          value={index}
          aria-label="Scrub guest timeline"
          onChange={(event) => {
            const stop = stops[Number(event.target.value)];
            if (stop) select(stop.id);
          }}
        />
      ) : null}
    </div>
  );
}
