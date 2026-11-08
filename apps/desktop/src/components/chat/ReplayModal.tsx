import { useEffect, useState } from "react";
import { canReplay, replayFrames, type AgentSession } from "@locus/shared";
import { DesktopOverlay } from "@/components/layout/DesktopOverlay";
import { Modal } from "@/components/layout/Modal";

export function ReplayModal({ session, onClose }: { session: AgentSession; onClose: () => void }) {
  const frames = replayFrames(session.id, session.messages);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const frame = frames[index];

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const timer = setInterval(() => {
      setIndex((current) => {
        if (current >= frames.length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 900);
    return () => clearInterval(timer);
  }, [playing, frames.length]);

  if (!canReplay(session.messages) || !frame) return null;

  return (
    <Modal titleId="replay-modal-title" className="replay-modal" onClose={onClose}>
      <h2 id="replay-modal-title">Replay</h2>
      <p className="modal-lead">
        {frame.who}
        {frame.content ? ` · ${frame.content.slice(0, 80)}` : ""}
      </p>
      <div className="replay-stage">
        {frame.screenshotBase64 ? (
          <img alt="" src={`data:image/png;base64,${frame.screenshotBase64}`} />
        ) : frame.screenshotName ? (
          <img
            alt=""
            src={`/api/sessions/${session.id}/screenshots/${encodeURIComponent(frame.screenshotName)}`}
          />
        ) : (
          <div className="replay-empty">No screenshot at this step</div>
        )}
        {frame.overlay ? <DesktopOverlay overlay={frame.overlay} /> : null}
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(frames.length - 1, 0)}
        value={index}
        aria-label="Replay frame"
        onChange={(event) => {
          setPlaying(false);
          setIndex(Number(event.target.value));
        }}
      />
      <div className="modal-actions">
        <span className="hint">
          {index + 1} / {frames.length}
        </span>
        <button
          className="btn small"
          aria-label={playing ? "Pause replay" : "Play replay"}
          onClick={() => setPlaying((value) => !value)}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button className="btn small" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
