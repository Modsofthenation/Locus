import { useEffect } from "react";
import { useStore } from "@/state/store";
import { ChatPane } from "@/components/chat/ChatPane";
import { WorkspaceBody } from "@/components/workspace/WorkspaceBody";
import { AndroidStart } from "./AndroidStart";
import { AndroidWorkbench } from "./AndroidWorkbench";
import { androidProjects, claimAndroidPanelOpen, rememberAndroidReturn } from "./androidNav";
import "./android.css";

/*
 * The project picker, "+ New project" and "Back to <project>" live in the Topbar's Android
 * branch; this pane only switches between the start form and the selected project's workspace.
 */
export function AndroidPane() {
  const { state, dispatch } = useStore();
  const selected = androidProjects(state).find((s) => s.id === state.selectedId);
  const selectedId = selected?.id;
  useEffect(() => {
    if (!selectedId) return;
    // Opening a project forgets any pending "Back to"; it opens with the device panel shown.
    rememberAndroidReturn(null);
    if (claimAndroidPanelOpen(selectedId) && state.vmCollapsed) dispatch({ type: "showVmPane" });
    // Only on project change: later toggles belong to the operator.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  return (
    <section className="android-section" aria-label="Android app builder">
      {selected ? (
        <WorkspaceBody
          variant="design"
          collapsed={state.vmCollapsed}
          topbarToggle
          chat={<ChatPane />}
          preview={<AndroidWorkbench key={selected.id} sessionId={selected.id} />}
        />
      ) : (
        <AndroidStart />
      )}
    </section>
  );
}
