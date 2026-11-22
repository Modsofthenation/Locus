import {
  WORKER_COUNT_MAX,
  WORKER_COUNT_MIN,
  WORKER_GROUP_MAX,
  lastUserPrompt,
  sessionRuntime,
  type AgentSession,
  type WorktreeAgentSpec,
} from "@locus/shared";
import { useState } from "react";
import { useStore } from "@/state/store";
import { api } from "@/lib/api";
import { Modal } from "@/components/layout/Modal";
import { AgentRows } from "@/components/workers/AgentRows";

export function WorkersModal({ session, onClose }: { session: AgentSession; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const providers = state.config?.providers ?? [];
  const host = sessionRuntime(session) === "host";
  const max = host ? WORKER_GROUP_MAX : WORKER_COUNT_MAX;
  const [rows, setRows] = useState<WorktreeAgentSpec[]>(() =>
    Array.from({ length: 3 }, () => ({ providerId: session.providerId, model: session.model })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prompt = lastUserPrompt(session.messages);
  const count = rows.length;

  async function start() {
    if (!prompt) return;
    setBusy(true);
    setError(null);
    try {
      const workers = await api.spawnWorkers(session.id, { prompt, agents: rows });
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
      <h2 id="workers-title">Run in parallel</h2>
      <p className="modal-lead">
        {host
          ? `Run the last prompt on ${count} agents, each in its own git worktree and branch off this checkout. Mix providers and CLIs (Claude Code, Codex, …), then merge the one you want from the board.`
          : `Snapshot this workspace and run the last prompt on ${count} isolated Docker containers. Keep one, archive the rest.`}
      </p>
      <AgentRows providers={providers} rows={rows} onChange={setRows} max={max} />
      {count < WORKER_COUNT_MIN ? (
        <p className="hint">Add at least {WORKER_COUNT_MIN} agents.</p>
      ) : null}
      {error && <p className="scrim-note is-danger">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !prompt || count < WORKER_COUNT_MIN || count > max}
          onClick={() => void start()}
        >
          {busy ? "Starting…" : `Start ${count} agents`}
        </button>
      </div>
    </Modal>
  );
}
