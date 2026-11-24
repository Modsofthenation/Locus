import { useRef, type CSSProperties, type FormEventHandler, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/lib/useDialogFocus";

/** Shared dialog chrome: backdrop, focus trap, Escape, and optional click-outside close. */
export function Modal(props: {
  onClose: () => void;
  children: ReactNode;
  titleId?: string;
  label?: string;
  className?: string;
  backdropClassName?: string;
  testId?: string;
  dialogTestId?: string;
  closeOnBackdrop?: boolean;
  trap?: boolean;
  busy?: boolean;
  describedBy?: string;
  style?: CSSProperties;
  onInput?: FormEventHandler<HTMLDivElement>;
  onChange?: FormEventHandler<HTMLDivElement>;
  /** Ignore backdrop clicks for this many ms after mount (opening click). */
  closeGuardMs?: number;
  /**
   * Render into document.body. Use when the opener sits inside a positioned, z-indexed
   * parent (e.g. the topbar), whose stacking context would otherwise trap the dialog
   * below sibling panels.
   */
  portal?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const openedAt = useRef(Date.now());
  useDialogFocus(true, props.onClose, dialogRef, { trap: props.trap });
  const closeOnBackdrop = props.closeOnBackdrop !== false;
  const labelledBy = props.titleId;
  const label = labelledBy ? undefined : props.label;
  function onBackdrop() {
    if (!closeOnBackdrop) return;
    if (props.closeGuardMs && Date.now() - openedAt.current < props.closeGuardMs) return;
    props.onClose();
  }
  const backdrop = (
    <div
      className={`modal-backdrop${props.backdropClassName ? ` ${props.backdropClassName}` : ""}`}
      onClick={onBackdrop}
      data-testid={props.testId}
    >
      <div
        className={`modal${props.className ? ` ${props.className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={label}
        aria-describedby={props.describedBy}
        aria-busy={props.busy || undefined}
        data-testid={props.dialogTestId}
        ref={dialogRef}
        style={props.style}
        onClick={(event) => event.stopPropagation()}
        onInput={props.onInput}
        onChange={props.onChange}
      >
        {props.children}
      </div>
    </div>
  );
  return props.portal ? createPortal(backdrop, document.body) : backdrop;
}
