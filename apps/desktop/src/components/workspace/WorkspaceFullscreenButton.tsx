import { IconCompress, IconExpand } from "@/components/layout/Icons";
import { Tooltip } from "@/components/layout/Tooltip";

export function WorkspaceFullscreenButton(props: {
  isFullscreen: boolean;
  onToggle: () => void;
  /** Tooltip when not full screen. Defaults to "Full screen files". */
  label?: string;
  testId?: string;
}) {
  const label = props.isFullscreen ? "Exit full screen" : (props.label ?? "Full screen files");
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className={`btn icon ghost${props.isFullscreen ? " on" : ""}`}
        aria-pressed={props.isFullscreen}
        aria-label={label}
        data-testid={props.testId ?? "workspace-fullscreen"}
        onClick={props.onToggle}
      >
        {props.isFullscreen ? <IconCompress /> : <IconExpand />}
      </button>
    </Tooltip>
  );
}
