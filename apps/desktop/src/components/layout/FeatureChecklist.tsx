import { useMemo, useState } from "react";
import {
  capabilityTodos,
  loadFeatureChecklistDismissed,
  saveFeatureChecklistDismissed,
  shouldShowFeatureChecklist,
} from "@/lib/discoverability";
import { loadFinishSetupDismissed } from "@/components/settings/FinishSetupChecklist";
import { runFeatureActionFromDispatch } from "@/components/layout/FeatureHint";
import { IconClose } from "@/components/layout/Icons";
import { useStore } from "@/state/store";

/**
 * Cursor-style "What's new" card — fixed bottom-left, one capability CTA at a time.
 * Mounted on the desktop shell so it does not crowd the Agents empty composer.
 */
export function FeatureChecklist() {
  const { state, dispatch } = useStore();
  const [dismissed, setDismissed] = useState(() => loadFeatureChecklistDismissed());
  const mcpServerCount = state.config?.mcpServers?.length ?? 0;
  const setupHintDismissed = loadFinishSetupDismissed();

  const visible = shouldShowFeatureChecklist({
    setup: state.setup,
    setupHintDismissed,
    featureDismissed: dismissed,
    automations: state.automations,
    projects: state.projects,
    brain: state.brain,
    slackStatus: state.slackStatus,
    mcpServerCount,
  });

  const todos = useMemo(
    () =>
      capabilityTodos({
        automations: state.automations,
        projects: state.projects,
        brain: state.brain,
        slackStatus: state.slackStatus,
        mcpServerCount,
      }),
    [state.automations, state.projects, state.brain, state.slackStatus, mcpServerCount],
  );

  if (!visible) return null;

  const open = todos.filter((row) => !row.done);
  const next = open[0];
  if (!next) return null;
  const remaining = open.length - 1;

  return (
    <aside className="try-next-corner" data-testid="feature-checklist" aria-label="Try next">
      <div className="try-next-corner-head">
        <p className="try-next-corner-kicker">Try next</p>
        <button
          type="button"
          className="btn icon ghost"
          title="Dismiss"
          aria-label="Dismiss"
          onClick={() => {
            saveFeatureChecklistDismissed(true);
            setDismissed(true);
          }}
        >
          <IconClose />
        </button>
      </div>
      <p className="try-next-corner-title">{next.label}</p>
      <p className="try-next-corner-copy">
        {remaining > 0
          ? `${remaining} more tip${remaining === 1 ? "" : "s"} after this.`
          : "A quick way to unlock more of Locus."}
      </p>
      <div className="try-next-corner-actions">
        <button
          type="button"
          className="btn small primary"
          onClick={() => runFeatureActionFromDispatch(dispatch, next.action)}
        >
          {next.label}
        </button>
      </div>
    </aside>
  );
}
