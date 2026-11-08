import { useState } from "react";
import { Modal } from "./Modal";

export function PromptModal(props: {
  title: string;
  body?: string;
  value?: string;
  confirmLabel?: string;
  testId?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(props.value ?? "");

  return (
    <Modal
      titleId="prompt-modal-title"
      className="close-confirm"
      testId={props.testId ?? "prompt-modal"}
      onClose={props.onCancel}
    >
      <h2 id="prompt-modal-title">{props.title}</h2>
      {props.body ? <p className="modal-lead">{props.body}</p> : null}
      <form
        className="prompt-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          props.onConfirm(value);
        }}
      >
        <input
          className="prompt-modal-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoFocus
          aria-label={props.title}
        />
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            {props.confirmLabel ?? "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
