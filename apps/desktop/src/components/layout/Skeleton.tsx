import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Tooltip } from "./Tooltip";

export function Skeleton(props: {
  lines?: number;
  testId?: string;
  className?: string;
  label?: string;
}) {
  const lines = Math.max(1, props.lines ?? 3);
  return (
    <div
      className={`ui-skeleton${props.className ? ` ${props.className}` : ""}`}
      data-testid={props.testId ?? "ui-skeleton"}
      role={props.label ? "status" : undefined}
      aria-busy="true"
      aria-label={props.label}
      aria-hidden={props.label ? undefined : true}
    >
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className={`skeleton line${i === 0 ? " wide" : ""}`} />
      ))}
    </div>
  );
}

export function InlineError(props: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  testId?: string;
}) {
  return (
    <div className="inline-error" data-testid={props.testId ?? "inline-error"} role="alert">
      <p>{props.message}</p>
      {props.onRetry ? (
        <button type="button" className="btn small ghost" onClick={props.onRetry}>
          {props.retryLabel ?? "Retry"}
        </button>
      ) : null}
    </div>
  );
}

/** Pane-level failure. Use InlineError for a field or section. */
export function ErrorBanner(props: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="error-row" data-testid={props.testId ?? "error-banner"} role="alert">
      <span className="error-dot" aria-hidden="true" />
      <p>{props.message}</p>
      {props.onRetry ? (
        <button type="button" className="btn small" onClick={props.onRetry}>
          {props.retryLabel ?? "Retry"}
        </button>
      ) : null}
      {props.action}
    </div>
  );
}

export function BusyButton({
  busy,
  busyLabel,
  disabledReason,
  children,
  className,
  disabled,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  busyLabel?: string;
  disabledReason?: string;
}) {
  const off = Boolean(disabled || busy);
  const button = (
    <button
      type={type}
      className={className}
      disabled={off}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <span className="ui-busy-dot" aria-hidden /> : null}
      {busy ? (busyLabel ?? children) : children}
    </button>
  );
  if (!disabledReason) return button;
  return (
    <Tooltip
      label={typeof children === "string" ? children : "Action"}
      disabledReason={disabledReason}
    >
      {button}
    </Tooltip>
  );
}
