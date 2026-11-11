import type { ReactNode } from "react";

/**
 * One plain lead sentence, with the longer explanation behind a native
 * "How this works" disclosure. Used at the top of dense Settings pages.
 */
export function HowItWorks(props: { lead: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <div className="settings-how" data-testid={props.testId}>
      <p className="settings-how-lead">{props.lead}</p>
      <details className="settings-how-details">
        <summary>How this works</summary>
        <div className="settings-how-body">{props.children}</div>
      </details>
    </div>
  );
}

/** The on/off switch used across Settings (same look as Notifications). */
export function SettingsSwitch(props: {
  on: boolean;
  label: string;
  disabled?: boolean;
  testId?: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`settings-switch ${props.on ? "on" : ""}`}
      role="switch"
      aria-checked={props.on}
      aria-label={props.label}
      data-testid={props.testId}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.on)}
    />
  );
}

/** Label (+ optional hint) on the left, switch on the right. */
export function SettingsToggleRow(props: {
  label: string;
  hint?: ReactNode;
  on: boolean;
  disabled?: boolean;
  testId?: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="settings-toggle-row">
      <div className="settings-toggle-copy">
        <span className="settings-toggle-label">{props.label}</span>
        {props.hint ? <span className="settings-toggle-hint">{props.hint}</span> : null}
      </div>
      <SettingsSwitch
        on={props.on}
        label={props.label}
        disabled={props.disabled}
        testId={props.testId}
        onChange={props.onChange}
      />
    </div>
  );
}
