import { useRef } from "react";
import { closeConfirmCopy, type CloseGuardSession } from "@/lib/closeGuard";
import { useDialogFocus } from "@/lib/useDialogFocus";

export function CloseConfirmModal({
  agents,
  onCancel,
  onConfirm,
}: {
  agents: Array<Pick<CloseGuardSession, "title">>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = closeConfirmCopy(agents);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, onCancel, dialogRef);

  return (
    <div className="modal-backdrop" onClick={onCancel} data-testid="close-confirm-modal">
      <div
        className="modal close-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-confirm-title"
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="close-confirm-title">{copy.title}</h2>
        <p className="modal-lead">{copy.body}</p>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn danger" onClick={onConfirm}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
