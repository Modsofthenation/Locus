import { IconCompress, IconExpand } from "@/components/layout/Icons";

export function WorkspaceFullscreenButton(props: { isFullscreen: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`btn icon ghost${props.isFullscreen ? " on" : ""}`}
      title={props.isFullscreen ? "Exit full screen" : "Full screen files"}
      aria-pressed={props.isFullscreen}
      data-testid="workspace-fullscreen"
      onClick={props.onToggle}
    >
      {props.isFullscreen ? <IconCompress /> : <IconExpand />}
    </button>
  );
}
