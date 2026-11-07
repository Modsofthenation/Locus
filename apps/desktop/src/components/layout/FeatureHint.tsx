import type { FeatureHint } from "@/lib/discoverability";
import { openSettings, useStore } from "@/state/store";

export function runFeatureActionFromDispatch(
  dispatch: ReturnType<typeof useStore>["dispatch"],
  action: FeatureHint["action"],
): void {
  switch (action.kind) {
    case "section":
      if (action.section === "agents") {
        dispatch({ type: "section", section: "agents" });
        dispatch({ type: "select", id: null });
        dispatch({ type: "new", open: true });
        return;
      }
      dispatch({ type: "section", section: action.section });
      return;
    case "settings":
      openSettings(dispatch, action.tab);
      return;
    case "new-automation":
      dispatch({ type: "section", section: "automations" });
      dispatch({ type: "newAutomation", open: true });
      return;
    case "compare":
      dispatch({ type: "compare", open: true });
      return;
    case "replay":
      dispatch({ type: "replay", open: true });
      return;
  }
}

/** One-line adjacent-feature tip for section empty states. */
export function FeatureHintRow({ hint }: { hint: FeatureHint }) {
  const { dispatch } = useStore();
  return (
    <p className="feature-hint" data-testid={`feature-hint-${hint.id}`}>
      <span>{hint.text}</span>{" "}
      <button
        type="button"
        className="btn small"
        onClick={() => runFeatureActionFromDispatch(dispatch, hint.action)}
      >
        {hint.actionLabel}
      </button>
    </p>
  );
}
