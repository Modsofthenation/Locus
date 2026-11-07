import { useRef } from "react";
import { useDialogFocus } from "@/lib/useDialogFocus";

export function ConfirmModal(props: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  testId?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, props.onCancel, dialogRef);

  return (
    <div
      className="modal-backdrop"
      onClick={props.onCancel}
      data-testid={props.testId ?? "confirm-modal"}
    >
      <div
        className="modal close-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-modal-title">{props.title}</h2>
        <p className="modal-lead">{props.body}</p>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn${props.danger ? " danger" : " primary"}`}
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
