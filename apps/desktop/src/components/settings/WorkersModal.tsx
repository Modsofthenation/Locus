import {
  WORKER_COUNT_DEFAULT,
  WORKER_COUNT_MAX,
  WORKER_COUNT_MIN,
  lastUserPrompt,
  type AgentSession,
} from "@locus/shared";
import { useState } from "react";
import { useStore } from "@/state/store";
import { api } from "@/lib/api";
import { startWorkers } from "@/lib/compare";
import { Modal } from "@/components/layout/Modal";
import { Select } from "@/components/layout/Select";

export function WorkersModal({ session, onClose }: { session: AgentSession; onClose: () => void }) {
  const { dispatch } = useStore();
  const [count, setCount] = useState(WORKER_COUNT_DEFAULT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prompt = lastUserPrompt(session.messages);

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
    <Modal titleId="workers-title" onClose={onClose}>
      <h2 id="workers-title">Spawn workers</h2>
      <p className="modal-lead">
        Snapshot this workspace and run the last prompt on {count} isolated Docker containers. Keep
        one, archive the rest.
      </p>
      <div className="field">
        <label>Workers</label>
        <Select
          ariaLabel="Workers"
          value={String(count)}
          options={Array.from(
            { length: WORKER_COUNT_MAX - WORKER_COUNT_MIN + 1 },
            (_, i) => WORKER_COUNT_MIN + i,
          ).map((n) => ({ value: String(n), label: String(n) }))}
          onChange={(value) => setCount(Number(value))}
        />
      </div>
      {error && <p className="scrim-note is-danger">{error}</p>}
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
    </Modal>
  );
}
