import { Modal } from "./Modal";

export function ConfirmModal(props: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  testId?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      titleId="confirm-modal-title"
      className="close-confirm"
      testId={props.testId ?? "confirm-modal"}
      onClose={props.onCancel}
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
    </Modal>
  );
}
