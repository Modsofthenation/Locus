import { useMemo, useState } from "react";
import {
  chatNudgeForSession,
  loadNudgeDismissed,
  saveNudgeDismissed,
  type ChatNudgeId,
} from "@/lib/discoverability";
import { useStore } from "@/state/store";
import { IconClose } from "./Icons";
import type { AgentSession } from "@locus/shared";

export function FeatureNudge({ session }: { session: AgentSession }) {
  const { state, dispatch } = useStore();
  const [tick, setTick] = useState(0);
  const nudge = useMemo(
    () =>
      chatNudgeForSession({
        session,
        sessions: state.sessions,
        hasAutomations: state.automations.length > 0,
        dismissed: (id) => loadNudgeDismissed(id),
      }),
    // tick forces re-read after dismiss
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, state.sessions, state.automations.length, tick],
  );

  if (!nudge) return null;

  function dismiss(id: ChatNudgeId) {
    saveNudgeDismissed(id);
    setTick((n) => n + 1);
  }

  function run() {
    if (nudge!.id === "compare") {
      dispatch({ type: "compare", open: true });
    } else if (nudge!.id === "automation") {
      dispatch({ type: "section", section: "automations" });
      dispatch({ type: "newAutomation", open: true });
    } else if (nudge!.id === "ide") {
      dispatch({ type: "section", section: "ide" });
    }
    dismiss(nudge!.id);
  }

  return (
    <div className="feature-nudge" role="status" data-testid={`feature-nudge-${nudge.id}`}>
      <span title={nudge.text}>{nudge.text}</span>
      <button type="button" className="btn small primary" onClick={run}>
        {nudge.actionLabel}
      </button>
      <button
        type="button"
        className="btn small ghost feature-nudge-dismiss"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={() => dismiss(nudge.id)}
      >
        <IconClose />
      </button>
    </div>
  );
}
