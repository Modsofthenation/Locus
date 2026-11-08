import { closeConfirmCopy, type CloseGuardSession } from "@/lib/closeGuard";
import { Modal } from "./Modal";

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

  return (
    <Modal
      titleId="close-confirm-title"
      className="close-confirm"
      testId="close-confirm-modal"
      onClose={onCancel}
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
    </Modal>
  );
}
