import { Modal } from "@/components/layout/Modal";
import { openSettings, useStore } from "@/state/store";
import { ProviderUsagePanel } from "./ProviderUsagePanel";

/** Plan usage for every signed-in agent CLI, reachable from the composer meter, model menu and ⌘K. */
export function PlanUsageModal() {
  const { state, dispatch } = useStore();
  if (!state.planUsage) return null;
  const close = () => dispatch({ type: "planUsage", open: false });
  return (
    <Modal
      titleId="plan-usage-title"
      className="plan-usage-modal"
      testId="plan-usage-modal"
      onClose={close}
    >
      <h2 id="plan-usage-title">Plan usage</h2>
      <p className="modal-lead">
        Quota left on the plans your agent CLIs are signed in to. API-key providers are billed per
        token instead.
      </p>
      <ProviderUsagePanel
        title={null}
        focusProviderId={state.planUsage.providerId}
        empty={
          <p className="hint">
            No signed-in agent CLI reports plan usage. Turn on Codex CLI, Claude Code, Cursor CLI or
            Kiro CLI in Settings → Providers.
          </p>
        }
      />
      <div className="modal-actions">
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            close();
            openSettings(dispatch, "providers");
          }}
        >
          Provider settings
        </button>
        <button type="button" className="btn primary" onClick={close}>
          Done
        </button>
      </div>
    </Modal>
  );
}
