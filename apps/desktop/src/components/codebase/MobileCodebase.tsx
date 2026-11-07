import { useEffect, useMemo, useState } from "react";
import {
  buildPreMergeBoard,
  forgeLabel,
  isDraftPull,
  type ChangeStack,
  type LinkedRepo,
  type PullRequestDetail,
  type PullRequestRef,
} from "@locus/shared";
import { api } from "@/lib/api";
import { formatMarkdown } from "@/lib/markdown";
import { matchesMobileQuery } from "@/lib/mobileShell";
import { formatAgo } from "./Codebase";
import { ChangeStackPanel } from "./ChangeStackPanel";
import { patchFilesFromPull } from "@/components/chat/PatchCard";
import { IconChevron, IconMore } from "@/components/layout/Icons";
import { OverflowMenu, MenuItem } from "@/components/layout/OverflowMenu";
import { Mascot } from "@/components/layout/Mascot";

export function MobileRepoList(props: {
  repos: LinkedRepo[];
  onOpen: (id: string) => void;
  query?: string;
}) {
  if (!props.repos.length) {
    return (
      <div className="mobile-empty">
        <Mascot pose="idle" size={64} />
        <h2>No repos yet</h2>
        <p>Link a repo on the desktop. Reply, review, and merge from a pull.</p>
      </div>
    );
  }
  const visible = props.repos.filter((row) =>
    matchesMobileQuery(`${row.name} ${row.checkout.url}`, props.query ?? ""),
  );
  if (!visible.length) {
    return <p className="hint mobile-filter-empty">Nothing matches this search.</p>;
  }
  return (
    <ul className="mobile-list" data-testid="mobile-code">
      {visible.map((row) => (
        <li key={row.id}>
          <button type="button" className="mobile-row" onClick={() => props.onOpen(row.id)}>
            <span
              className={`mobile-status-dot${row.openPullCount ? " is-running" : " is-idle"}`}
              aria-hidden="true"
            />
            <span className="mobile-row-main">
              <span className="mobile-row-head">
                <span className="mobile-row-title">{row.name}</span>
                <span className="mobile-row-time">{formatAgo(row.updatedAt, true)}</span>
              </span>
              <span className="mobile-row-mono">
                {forgeLabel(row.checkout.forge)}
                {row.openPullCount ? ` / ${row.openPullCount} open` : ""}
              </span>
            </span>
            <span className="mobile-row-chevron" aria-hidden="true">
              <IconChevron />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function MobileRepoPulls(props: { repo: LinkedRepo; onOpen: (number: number) => void }) {
  const [pulls, setPulls] = useState<PullRequestRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api
      .repoPulls(props.repo.id, "open")
      .then((rows) => {
        if (!cancelled) setPulls(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load pulls");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.repo.id]);

  if (loading) {
    return (
      <div className="mobile-empty">
        <p>Loading open pulls…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="mobile-empty">
        <h2>Could not load pulls</h2>
        <p>{error}</p>
      </div>
    );
  }
  if (!pulls.length) {
    return (
      <div className="mobile-empty">
        <Mascot pose="rest" size={64} />
        <h2>No open pulls</h2>
        <p>Open PRs for {props.repo.name} land here. Merge from the pull.</p>
      </div>
    );
  }
  return (
    <ul className="mobile-list" data-testid="mobile-pulls">
      {pulls.map((row) => (
        <li key={row.number}>
          <button type="button" className="mobile-row" onClick={() => props.onOpen(row.number)}>
            <span className="mobile-status-dot is-ok" aria-hidden="true" />
            <span className="mobile-row-main">
              <span className="mobile-row-head">
                <span className="mobile-row-title">{row.title}</span>
                <span className="mobile-row-time">{formatAgo(row.updatedAt, true)}</span>
              </span>
              <span className="mobile-row-mono">
                #{row.number}
                {isDraftPull(row) ? " / draft" : ` / ${row.state}`}
                {row.author ? ` / ${row.author}` : ""}
              </span>
            </span>
            <span className="mobile-row-chevron" aria-hidden="true">
              <IconChevron />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function MobilePullDetail(props: { repo: LinkedRepo; number: number; onBack: () => void }) {
  const [pull, setPull] = useState<PullRequestDetail | null>(null);
  const [stack, setStack] = useState<ChangeStack | null>(null);
  const [stackOpen, setStackOpen] = useState(false);
  const [stackLayer, setStackLayer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [reviewBody, setReviewBody] = useState("");
  const [reviewEvent, setReviewEvent] = useState<"COMMENT" | "APPROVE" | "REQUEST_CHANGES">(
    "COMMENT",
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPull(null);
    setStack(null);
    setStackOpen(false);
    setStackLayer(null);
    setError(null);
    void api
      .repoPull(props.repo.id, props.number)
      .then((detail) => {
        if (!cancelled) setPull(detail);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load pull");
      });
    void api
      .repoPullChangeStack(props.repo.id, props.number)
      .then((next) => {
        if (!cancelled) setStack(next);
      })
      .catch(() => {
        if (!cancelled) setStack(null);
      });
    return () => {
      cancelled = true;
    };
  }, [props.number, props.repo.id]);

  async function postReply() {
    const body = reply.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const detail = await api.commentPull(props.repo.id, props.number, { body });
      setPull(detail);
      setReply("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not comment");
    } finally {
      setBusy(false);
    }
  }

  async function postReview() {
    const body = reviewBody.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const detail = await api.reviewPull(props.repo.id, props.number, {
        body,
        event: reviewEvent,
      });
      setPull(detail);
      setReviewBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not review");
    } finally {
      setBusy(false);
    }
  }

  async function mergePull() {
    if (!pull || busy) return;
    if (isDraftPull(pull) || pull.state === "merged" || pull.state === "closed") return;
    if (!window.confirm("Merge this pull request on the forge?")) return;
    setBusy(true);
    setError(null);
    try {
      const detail = await api.mergePull(props.repo.id, props.number);
      setPull(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setBusy(false);
    }
  }

  const preMerge = useMemo(
    () =>
      pull
        ? buildPreMergeBoard({
            checks: pull.checks,
            comments: pull.comments,
            files: pull.files,
            stack,
          })
        : null,
    [pull, stack],
  );

  return (
    <div className="mobile-screen is-canvas" data-testid="mobile-pull">
      <header className="mobile-top is-thread">
        <button type="button" className="mobile-icon-btn mobile-back" onClick={props.onBack}>
          Back
        </button>
        <div className="mobile-top-title">
          <h1>
            {props.repo.name} #{props.number}
          </h1>
        </div>
        <span className="mobile-top-spacer" />
      </header>
      <div className="mobile-body mobile-pr">
        {error ? <p className="mobile-error">{error}</p> : null}
        {!pull && !error ? <p className="hint">Loading pull…</p> : null}
        {pull ? (
          <>
            <h2 className="mobile-pr-title">{pull.title}</h2>
            <p className="mobile-pr-meta">
              {isDraftPull(pull) ? "draft" : pull.state}
              {pull.author ? ` · ${pull.author}` : ""}
              {` · ${pull.headRef} → ${pull.baseRef}`}
            </p>
            {pull.body?.trim() ? (
              <div
                className="mobile-pr-body"
                dangerouslySetInnerHTML={{ __html: formatMarkdown(pull.body) }}
              />
            ) : (
              <p className="hint">No description.</p>
            )}
            {stack?.cohorts.length ? (
              <section className="mobile-pr-stack" data-testid="mobile-change-stack">
                <h3 className="mobile-pr-heading">Change stack</h3>
                <p className="hint">Heuristic walkthrough. Summaries stay on the desktop.</p>
                <ul className="mobile-pr-stack-list">
                  {stack.cohorts.flatMap((cohort) =>
                    cohort.layers.map((layer, index) => (
                      <li key={layer.id}>
                        <button
                          type="button"
                          className="mobile-setting-row"
                          onClick={() => {
                            setStackLayer(layer.id);
                            setStackOpen(true);
                          }}
                        >
                          <span>
                            {cohort.title} · {layer.title}
                          </span>
                          <span className="mobile-setting-value">
                            {layer.fileCount} file{layer.fileCount === 1 ? "" : "s"}
                            {index === 0 ? "" : ""}
                          </span>
                        </button>
                      </li>
                    )),
                  )}
                </ul>
                {stackOpen ? (
                  <ChangeStackPanel
                    stack={stack}
                    stale={Boolean(stack.headSha && pull.headSha && stack.headSha !== pull.headSha)}
                    busy={busy}
                    pullFiles={patchFilesFromPull(pull.files)}
                    pullHeadSha={pull.headSha}
                    commentBody=""
                    focused={false}
                    compact
                    onCommentBody={() => undefined}
                    onSelectLine={() => undefined}
                    onComment={() => undefined}
                    onClearComment={() => undefined}
                    onUpdate={() => undefined}
                    onJumpToFile={() => undefined}
                    onOpenInIde={() => undefined}
                    onToggleFocus={() => undefined}
                    preMerge={preMerge}
                    focusLayerId={stackLayer}
                  />
                ) : null}
              </section>
            ) : null}
            <h3 className="mobile-pr-heading">Comments</h3>
            {pull.comments.length ? (
              <ul className="mobile-pr-comments">
                {pull.comments.map((row) => (
                  <li key={row.id} className="mobile-pr-comment">
                    <p className="mobile-pr-meta">
                      {row.author ?? "comment"}
                      {row.path ? ` · ${row.path}` : ""}
                    </p>
                    <div
                      className="mobile-pr-body"
                      dangerouslySetInnerHTML={{ __html: formatMarkdown(row.body) }}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">No comments yet.</p>
            )}
            <form
              className="mobile-pr-write"
              onSubmit={(event) => {
                event.preventDefault();
                void postReply();
              }}
            >
              <label className="mobile-field">
                Reply
                <textarea
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  rows={3}
                  placeholder="Reply on the conversation."
                />
              </label>
              <button type="submit" className="btn" disabled={busy || !reply.trim()}>
                Post comment
              </button>
            </form>
            <form
              className="mobile-pr-write"
              onSubmit={(event) => {
                event.preventDefault();
                void postReview();
              }}
            >
              <label className="mobile-field">
                Review
                <textarea
                  value={reviewBody}
                  onChange={(event) => setReviewBody(event.target.value)}
                  rows={3}
                  placeholder="Summarize the review for the author."
                />
              </label>
              <div className="review-events" role="group" aria-label="Review event">
                {(
                  [
                    ["COMMENT", "Comment"],
                    ["APPROVE", "Approve"],
                    ["REQUEST_CHANGES", "Request changes"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={reviewEvent === id ? "active" : ""}
                    onClick={() => setReviewEvent(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button type="submit" className="btn primary" disabled={busy || !reviewBody.trim()}>
                Submit review
              </button>
            </form>
            <OverflowMenu
              label={<IconMore />}
              title="Pull request actions"
              toggleClassName="btn icon ghost"
              align="right"
            >
              <MenuItem
                disabled={
                  busy || isDraftPull(pull) || pull.state === "merged" || pull.state === "closed"
                }
                onClick={() => void mergePull()}
              >
                {pull.state === "merged" ? "Merged" : "Merge"}
              </MenuItem>
            </OverflowMenu>
            <p className="hint">Start agent stays on the desktop.</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
