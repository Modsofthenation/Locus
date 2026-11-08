import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { SplitAxis } from "@/lib/splitter";

/** Keyboard-accessible resize gutter. Arrow keys move, Home/End jump, double-click resets. */
export function Splitter(props: {
  orientation: SplitAxis;
  label: string;
  value: number;
  min: number;
  max: number;
  valueText?: string;
  className?: string;
  hidden?: boolean;
  disabled?: boolean;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onDoubleClick?: () => void;
}) {
  const off = Boolean(props.disabled || props.hidden);
  return (
    <div
      className={props.className}
      role="separator"
      aria-orientation={props.orientation}
      aria-label={props.label}
      aria-hidden={off || undefined}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={props.value}
      aria-valuetext={props.valueText}
      hidden={props.hidden || undefined}
      tabIndex={off ? -1 : 0}
      onPointerDown={off ? undefined : props.onPointerDown}
      onKeyDown={off ? undefined : props.onKeyDown}
      onDoubleClick={off ? undefined : props.onDoubleClick}
    />
  );
}
