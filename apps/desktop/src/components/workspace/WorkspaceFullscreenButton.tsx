import { IconCompress, IconExpand } from "@/components/layout/Icons";
import { Tooltip } from "@/components/layout/Tooltip";

export function WorkspaceFullscreenButton(props: { isFullscreen: boolean; onToggle: () => void }) {
  const label = props.isFullscreen ? "Exit full screen" : "Full screen files";
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className={`btn icon ghost${props.isFullscreen ? " on" : ""}`}
        aria-pressed={props.isFullscreen}
        data-testid="workspace-fullscreen"
        onClick={props.onToggle}
      >
        {props.isFullscreen ? <IconCompress /> : <IconExpand />}
      </button>
    </Tooltip>
  );
}
