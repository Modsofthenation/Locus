import {
  formatSubscriptionMeta,
  subscriptionKindLabel,
  type SessionSubscription,
} from "@locus/shared";
import { IconClock, IconClose, IconHash, IconRepo } from "@/components/layout/Icons";

function KindIcon({ kind }: { kind: SessionSubscription["kind"] }) {
  if (kind === "timer") return <IconClock />;
  if (kind === "pull_request") return <IconRepo />;
  return <IconHash />;
}

export function SubscriptionCard({
  subscriptions,
  onRemove,
}: {
  subscriptions: SessionSubscription[];
  onRemove: (id: string) => void;
}) {
  if (!subscriptions.length) return null;
  const heading =
    subscriptions.length === 1 ? "1 subscription" : `${subscriptions.length} subscriptions`;

  return (
    <div className="sub-card" data-testid="subscription-card" role="region" aria-label={heading}>
      <div className="sub-card-head">
        <span className="sub-card-title">Listening</span>
        <span className="sub-card-count">{heading}</span>
      </div>
      <ul className="sub-card-list">
        {subscriptions.map((row) => (
          <li key={row.id} data-testid={`subscription-${row.id}`}>
            <span className="sub-card-icon" aria-hidden>
              <KindIcon kind={row.kind} />
            </span>
            <span className="sub-card-body">
              <span className="sub-card-kind">{subscriptionKindLabel(row.kind)}</span>
              <span className="sub-card-name">{row.title}</span>
              <span className="sub-card-meta">{formatSubscriptionMeta(row)}</span>
            </span>
            <button
              type="button"
              className="btn small ghost"
              data-testid={`subscription-remove-${row.id}`}
              aria-label={`Remove ${row.title}`}
              onClick={() => onRemove(row.id)}
            >
              <IconClose /> Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SubscriptionList({
  subscriptions,
  onRemove,
  onRemoveAll,
}: {
  subscriptions: SessionSubscription[];
  onRemove: (id: string) => void;
  onRemoveAll?: () => void;
}) {
  if (!subscriptions.length) {
    return (
      <p className="modal-lead" data-testid="subscription-empty">
        Ask this agent to subscribe to a Slack channel or thread, a GitHub/GitLab/Bitbucket pull
        request, or a timer.
      </p>
    );
  }
  return (
    <div className="sub-settings" data-testid="subscription-settings">
      <ul className="sub-card-list">
        {subscriptions.map((row) => (
          <li key={row.id}>
            <span className="sub-card-icon" aria-hidden>
              <KindIcon kind={row.kind} />
            </span>
            <span className="sub-card-body">
              <span className="sub-card-kind">{subscriptionKindLabel(row.kind)}</span>
              <span className="sub-card-name">{row.title}</span>
              <span className="sub-card-meta">{formatSubscriptionMeta(row)}</span>
            </span>
            <button
              type="button"
              className="btn small ghost"
              aria-label={`Remove ${row.title}`}
              onClick={() => onRemove(row.id)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {onRemoveAll ? (
        <button type="button" className="btn small ghost" onClick={onRemoveAll}>
          Cancel all
        </button>
      ) : null}
    </div>
  );
}
