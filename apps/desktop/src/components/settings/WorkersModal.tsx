import {
  WORKER_COUNT_DEFAULT,
  WORKER_COUNT_MAX,
  WORKER_COUNT_MIN,
  lastUserPrompt,
  type AgentSession,
} from "@locus/shared";
import { useRef, useState } from "react";
import { useStore } from "@/state/store";
import { api } from "@/lib/api";
import { startWorkers } from "@/lib/compare";
import { useDialogFocus } from "@/lib/useDialogFocus";

export function WorkersModal({ session, onClose }: { session: AgentSession; onClose: () => void }) {
  const { dispatch } = useStore();
  const [count, setCount] = useState(WORKER_COUNT_DEFAULT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prompt = lastUserPrompt(session.messages);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, onClose, dialogRef);

  async function start() {
    if (!prompt) return;
    setBusy(true);
    setError(null);
    try {
      const workers = await startWorkers(session, count);
      for (const worker of workers) dispatch({ type: "session", session: worker });
      try {
        dispatch({ type: "session", session: await api.session(session.id) });
      } catch {
        /* hub session.updated still refreshes the parent banner */
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not spawn workers");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workers-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="workers-title">Spawn workers</h2>
        <p className="modal-lead">
          Snapshot this workspace and run the last prompt on {count} isolated Docker containers.
          Keep one, archive the rest.
        </p>
        <div className="field">
          <label>Workers</label>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {Array.from(
              { length: WORKER_COUNT_MAX - WORKER_COUNT_MIN + 1 },
              (_, i) => WORKER_COUNT_MIN + i,
            ).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p className="scrim-note" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !prompt}
            onClick={() => void start()}
          >
            {busy ? "Starting…" : "Spawn workers"}
          </button>
        </div>
      </div>
    </div>
  );
}
