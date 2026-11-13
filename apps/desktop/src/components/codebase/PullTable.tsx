import { useState } from "react";
import { isDraftPull, type PullRequestRef } from "@locus/shared";
import { IconBuildFail, IconChat, IconReview, IconTaskDone } from "@/components/layout/Icons";

export function formatUpdatedPhrase(iso?: string, now = Date.now()): string | undefined {
  const label = formatPrCreated(iso, now);
  return label === "—" ? undefined : `updated ${label}`;
}

export function formatPrCreated(iso?: string, now = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 86400 * 7) return formatRelativePhrase(iso, now) ?? "—";
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatRelativePhrase(iso?: string, now = Date.now()): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 45) return "just now";
  if (sec < 3600) return plural(Math.max(1, Math.floor(sec / 60)), "minute");
  if (sec < 86400) return plural(Math.floor(sec / 3600), "hour");
  if (sec < 86400 * 7) return plural(Math.floor(sec / 86400), "day");
  return undefined;
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

function authorInitials(name?: string): string {
  if (!name?.trim()) return "?";
  const parts = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

function avatarSrc(row: PullRequestRef): string | undefined {
  if (row.authorAvatarUrl) return row.authorAvatarUrl;
  if (row.forge === "github" && row.author) {
    return `https://github.com/${encodeURIComponent(row.author)}.png?size=48`;
  }
  return undefined;
}

function statusBadge(row: PullRequestRef): { label: string; tone: string } | undefined {
  if (isDraftPull(row)) return { label: "Draft", tone: "draft" };
  if (row.state === "merged") return { label: "Merged", tone: "merged" };
  if (row.state === "closed") return { label: "Closed", tone: "closed" };
  return undefined;
}

export function PullTable(props: {
  rows: PullRequestRef[];
  selectedNumber?: number | null;
  onSelect: (number: number) => void;
  showHeader?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`pr-table${props.compact ? " compact" : ""}`}
      role="table"
      aria-label="Pull requests"
    >
      {props.showHeader !== false ? (
        <div className="pr-table-head" role="row">
          <span role="columnheader">Summary</span>
          <span role="columnheader">Created</span>
          <span role="columnheader">Activity</span>
          <span role="columnheader">Reviewers</span>
          <span role="columnheader">Builds</span>
        </div>
      ) : null}
      {props.rows.map((row) => (
        <button
          key={row.number}
          type="button"
          role="row"
          className={`pr-table-row${props.selectedNumber === row.number ? " active" : ""}`}
          onClick={() => props.onSelect(row.number)}
        >
          <PullSummaryCell row={row} />
          <span className="pr-table-created" role="cell">
            {formatPrCreated(row.createdAt ?? row.updatedAt)}
          </span>
          <PullActivityCell row={row} />
          <PullReviewersCell row={row} />
          <PullBuildsCell row={row} />
        </button>
      ))}
    </div>
  );
}

export function PullSummaryCell(props: {
  row: PullRequestRef;
  /** The narrow PR list leaves branches to the detail header (they only fit as "cla… → m…"). */
  branches?: boolean;
}) {
  const row = props.row;
  const showBranches = props.branches !== false;
  const badge = statusBadge(row);
  const updated = formatUpdatedPhrase(row.updatedAt);
  return (
    <span className="pr-summary" role="cell">
      <AuthorAvatar row={row} />
      <span className="pr-summary-body">
        <span className="pr-summary-title">
          {badge ? <span className={`pr-draft-badge ${badge.tone}`}>{badge.label}</span> : null}
          <strong>{row.title}</strong>
        </span>
        <span className="pr-summary-sub">
          <span className="pr-summary-meta">
            {row.author ? <span className="pr-summary-author">{row.author}</span> : null}
            <span className="pr-id">#{row.number}</span>
            {updated ? <span>{updated}</span> : null}
          </span>
          {showBranches && (row.headRef || row.baseRef) ? (
            <span className="pr-summary-branches">
              {row.headRef ? <code title={row.headRef}>{row.headRef}</code> : null}
              {row.headRef && row.baseRef ? (
                <span className="pr-branch-arrow" aria-hidden>
                  →
                </span>
              ) : null}
              {row.baseRef ? <code title={row.baseRef}>{row.baseRef}</code> : null}
            </span>
          ) : null}
        </span>
      </span>
    </span>
  );
}

function AuthorAvatar(props: { row: PullRequestRef }) {
  const [failed, setFailed] = useState(false);
  const src = avatarSrc(props.row);
  const initials = authorInitials(props.row.author);
  if (!src || failed) {
    return (
      <span className="pr-avatar pr-avatar-fallback" aria-hidden>
        {initials}
      </span>
    );
  }
  return (
    <span className="pr-avatar">
      <img src={src} alt="" onError={() => setFailed(true)} />
    </span>
  );
}

function PullActivityCell(props: { row: PullRequestRef }) {
  const comments = props.row.commentCount ?? 0;
  const reviews = props.row.reviewCount ?? 0;
  if (comments <= 0 && reviews <= 0) {
    return <span className="pr-table-activity" role="cell" />;
  }
  return (
    <span className="pr-table-activity" role="cell">
      {comments > 0 ? (
        <span className="pr-activity-stat" title={`${comments} comments`}>
          <IconChat />
          {comments}
        </span>
      ) : null}
      {reviews > 0 ? (
        <span className="pr-activity-stat" title={`${reviews} reviews`}>
          <IconReview />
          {reviews}
        </span>
      ) : null}
    </span>
  );
}

function PullReviewersCell(props: { row: PullRequestRef }) {
  const names = props.row.reviewers ?? [];
  if (!names.length) {
    return (
      <span className="pr-table-reviewers is-empty" role="cell">
        No reviewers
      </span>
    );
  }
  return (
    <span className="pr-table-reviewers" role="cell" title={names.join(", ")}>
      {names.join(", ")}
    </span>
  );
}

function PullBuildsCell(props: { row: PullRequestRef }) {
  const state = props.row.checkState;
  if (!state || state === "neutral") {
    return <span className="pr-table-builds" role="cell" />;
  }
  if (state === "success") {
    return (
      <span className="pr-table-builds ok" role="cell" title="Checks passing">
        <IconTaskDone />
      </span>
    );
  }
  if (state === "failure") {
    return (
      <span className="pr-table-builds bad" role="cell" title="Checks failing">
        <IconBuildFail />
      </span>
    );
  }
  return (
    <span className="pr-table-builds busy" role="cell" title="Checks pending">
      <span className="pr-build-pending" />
    </span>
  );
}
