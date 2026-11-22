import type { ReactNode } from "react";
import { IconReturn } from "@/components/layout/Icons";

/**
 * The app's chat composer (same markup as the Board, Design and new-agent
 * composers), used to describe or refine a generated theme.
 * Enter sends; Shift+Enter adds a line.
 */
export function ThemeComposer(props: {
  id: string;
  value: string;
  placeholder: string;
  busy: boolean;
  sendLabel: string;
  busyLabel: string;
  onChange: (value: string) => void;
  onSend: () => void;
  /** Extra controls on the left of the bar (chips). */
  children?: ReactNode;
  /** Controls beside Send, like the provider/model picker. */
  toolbarEnd?: ReactNode;
  /** Why sending is unavailable; disables Send and becomes its tooltip. */
  disabledReason?: string;
  testId?: string;
  rows?: number;
}) {
  const disabled = props.busy || !props.value.trim() || Boolean(props.disabledReason);
  return (
    <form
      className="theme-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) props.onSend();
      }}
    >
      <div className="empty-composer">
        <textarea
          id={props.id}
          data-testid={props.testId}
          value={props.value}
          rows={props.rows ?? 2}
          placeholder={props.placeholder}
          aria-busy={props.busy}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!disabled) props.onSend();
            }
          }}
        />
        <div className="empty-composer-bar">
          {props.children}
          <div className="composer-toolbar-end">
            {props.toolbarEnd}
            <button
              type="submit"
              className="btn primary small composer-send"
              disabled={disabled}
              aria-label={props.busy ? props.busyLabel : props.sendLabel}
              title={props.disabledReason ?? props.sendLabel}
            >
              <span className="composer-send-label">
                {props.busy ? props.busyLabel : props.sendLabel}
              </span>
              <IconReturn />
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
