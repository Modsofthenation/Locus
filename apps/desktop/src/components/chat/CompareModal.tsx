import { otherCompareModel, type AgentSession } from "@locus/shared";
import { useState } from "react";
import { useStore } from "@/state/store";
import { startModelCompare } from "@/lib/compare";
import { Modal } from "@/components/layout/Modal";
import { ModelPicker } from "@/components/settings/ModelPicker";

export function CompareModal({ session, onClose }: { session: AgentSession; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const providers = state.config?.providers ?? [];
  const suggested = otherCompareModel(providers, session.providerId, session.model);
  const [providerId, setProviderId] = useState(suggested.providerId);
  const [model, setModel] = useState(suggested.model);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const { a, b } = await startModelCompare(session, { providerId, model });
      dispatch({ type: "session", session: a });
      dispatch({ type: "session", session: b });
      dispatch({ type: "select", id: b.id });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start compare");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal titleId="compare-title" onClose={onClose}>
      <h2 id="compare-title">Compare models</h2>
      <p className="modal-lead">
        Fork this guest, run the last prompt on a second model, then pick a winner.
      </p>
      <ModelPicker
        providers={providers}
        providerId={providerId}
        model={model}
        onChange={(next) => {
          setProviderId(next.providerId);
          setModel(next.model);
        }}
      />
      {error && <p className="scrim-note is-danger">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !model}
          onClick={() => void start()}
        >
          {busy ? "Starting…" : "Start compare"}
        </button>
      </div>
    </Modal>
  );
}
