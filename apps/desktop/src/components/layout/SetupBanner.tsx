import type { ReactNode } from "react";

/**
 * The one quiet setup row on start screens (Agents, Design, Games, Assets):
 * "<title> · <detail>" with its actions on the right.
 */
export function SetupBanner(props: {
  title: string;
  detail?: ReactNode;
  children?: ReactNode;
  testId?: string;
  onDismiss?: () => void;
}) {
  return (
    <div className="setup-banner" role="status" data-testid={props.testId}>
      <p className="setup-banner-copy">
        <strong>{props.title}</strong>
        {props.detail ? <span className="hint"> · {props.detail}</span> : null}
      </p>
      <div className="setup-banner-actions">
        {props.children}
        {props.onDismiss ? (
          <button type="button" className="btn small ghost" onClick={props.onDismiss}>
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Missing-provider row shared by every start screen. */
export function ProviderSetupBanner(props: { onFinish: () => void; onDismiss?: () => void }) {
  return (
    <SetupBanner
      title="Finish setup"
      detail="Provider"
      testId="provider-setup-banner"
      onDismiss={props.onDismiss}
    >
      <button type="button" className="btn small primary" onClick={props.onFinish}>
        Continue
      </button>
    </SetupBanner>
  );
}
