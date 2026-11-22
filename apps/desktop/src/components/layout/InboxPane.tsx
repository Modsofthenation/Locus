import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from "react";
import {
  activeSlackReviewers,
  parseProductMode,
  sessionMatchesSurface,
  type AgentSession,
  type AutomationRunStatus,
  type SlackReviewActive,
  type SlackReviewRun,
} from "@locus/shared";
import { api } from "@/lib/api";
import {
  approvalPreview,
  sameToolRows,
  stepInboxFocus,
  type ApprovalPreview,
} from "@/lib/inboxDecision";
import { buildInboxRows, inboxRowLabel, openInboxRow, type InboxRow } from "@/lib/inboxList";
import { showErrorNotice } from "@/lib/notice";
import {
  REVIEW_OUTCOME_LABEL,
  activeAgents,
  automationActivity,
  isActiveSession,
  nextScheduledRun,
  recentSessions,
  reviewOutcomeTone,
  reviewSessions,
  reviewerName,
  slackReviewActivity,
} from "@/lib/dashboard";
import { formatAgo, formatUntil } from "@/lib/timeAgo";
import { openSettings, useStore, type Action } from "@/state/store";
import { EmptyHero } from "./EmptyHero";

type Decision = "approved" | "denied";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

const RISK_LABEL = { low: "Low risk", medium: "Check first", high: "High risk" } as const;

function ApprovalDetail({ preview }: { preview: ApprovalPreview }) {
  return (
    <div className="inbox-decision-body">
      <p className="inbox-decision-what">
        <span className={`inbox-risk ${preview.risk}`} title={preview.riskReason}>
          {RISK_LABEL[preview.risk]}
        </span>
        <span>{preview.label}</span>
      </p>
      {preview.why ? (
        <blockquote className="inbox-decision-why" data-testid="inbox-why">
          {preview.why}
        </blockquote>
      ) : null}
      {preview.command ? (
        <pre className="inbox-decision-command" data-testid="inbox-command">
          <code>{preview.command}</code>
        </pre>
      ) : null}
      {preview.files.length ? (
        <ul className="inbox-decision-files">
          {preview.files.slice(0, 6).map((file) => (
            <li key={file}>{file}</li>
          ))}
          {preview.files.length > 6 ? <li>+{preview.files.length - 6} more</li> : null}
        </ul>
      ) : null}
      <dl className="inbox-decision-facts">
        <dt>Tool</dt>
        <dd>
          <code>{preview.call.name}</code>
        </dd>
        <dt>Runs in</dt>
        <dd>{preview.where}</dd>
        {preview.path && !preview.files.length ? (
          <>
            <dt>Path</dt>
            <dd>
              <code>{preview.path}</code>
            </dd>
          </>
        ) : null}
        {preview.branch ? (
          <>
            <dt>Branch</dt>
            <dd>
              <code>{preview.branch}</code>
            </dd>
          </>
        ) : null}
        <dt>Risk</dt>
        <dd>{preview.riskReason}</dd>
      </dl>
      {preview.argsText && !preview.command ? (
        <details className="inbox-decision-args">
          <summary>Arguments</summary>
          <pre>{preview.argsText}</pre>
        </details>
      ) : null}
    </div>
  );
}

const RUN_DOT: Record<AutomationRunStatus, string> = {
  queued: "provisioning",
  running: "running",
  succeeded: "idle",
  failed: "error",
  skipped: "stopped",
  needs_you: "needs-you",
};

const RUN_LABEL: Record<AutomationRunStatus, string> = {
  queued: "Queued",
  running: "Working",
  succeeded: "Done",
  failed: "Failed",
  skipped: "Skipped",
  needs_you: "Needs you",
};

const STATUS_LABEL: Record<AgentSession["status"], string> = {
  draft: "Draft",
  provisioning: "Starting",
  idle: "Idle",
  running: "Working",
  error: "Error",
  stopped: "Stopped",
};

const KIND_LABEL: Partial<Record<NonNullable<AgentSession["kind"]>, string>> = {
  design: "Design",
  game: "Game",
  assets: "Asset",
  review: "Review",
  setup: "Setup",
  ide: "IDE",
  board: "Board",
  project: "Project",
};

/** Rows a side panel lists before folding the rest into "+N more". */
const PANEL_LIMIT = 5;

/** Slack review queue refresh: fast while something runs, slow otherwise. */
const SLACK_BUSY_MS = 5_000;
const SLACK_IDLE_MS = 30_000;

function useSlackReviews(enabled: boolean): {
  active: SlackReviewActive[];
  recent: SlackReviewRun[];
  error: string | null;
} {
  const [runs, setRuns] = useState<SlackReviewRun[]>([]);
  const [active, setActive] = useState<SlackReviewActive[]>([]);
  const [error, setError] = useState<string | null>(null);
  const busy = active.length > 0;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = async () => {
      try {
        const result = await api.slackReviewerRuns();
        if (!live) return;
        setRuns(result.runs);
        setActive(result.active ?? []);
        setError(null);
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : "Could not load reviews");
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), busy ? SLACK_BUSY_MS : SLACK_IDLE_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [enabled, busy]);
  return useMemo(() => ({ ...slackReviewActivity(runs, active), error }), [runs, active, error]);
}

function openSlackThread(dispatch: Dispatch<Action>, channelId: string, threadTs: string) {
  dispatch({ type: "section", section: "slack" });
  dispatch({ type: "selectSlackChannel", id: channelId });
  dispatch({ type: "slackThread", ts: threadTs });
}

function StatTile(props: {
  label: string;
  value: number;
  hint?: string;
  tone?: "attention" | "live" | "danger";
  /** Panel this tile jumps to. */
  target: string;
  onJump: (target: string) => void;
}) {
  return (
    <button
      type="button"
      className={`dash-stat ${props.tone ?? ""}`}
      aria-controls={props.target}
      title={`Go to ${props.label.toLowerCase()}`}
      onClick={() => props.onJump(props.target)}
    >
      <span className="dash-stat-value">{props.value}</span>
      <span className="dash-stat-label">{props.label}</span>
      {props.hint ? <span className="dash-stat-hint">{props.hint}</span> : null}
    </button>
  );
}

function DashPanel(props: {
  title: string;
  /** Badge beside the title, e.g. "3" or "2 running". Omitted when empty. */
  count?: string;
  testId: string;
  id: string;
  empty: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const items = (Array.isArray(props.children) ? props.children.flat() : [props.children]).filter(
    Boolean,
  );
  return (
    <section
      className="dash-panel"
      data-testid={props.testId}
      id={props.id}
      tabIndex={-1}
      aria-labelledby={`${props.id}-title`}
    >
      <header className="dash-panel-head">
        <h3 id={`${props.id}-title`}>
          {props.title}
          {props.count ? <span className="dash-panel-count">{props.count}</span> : null}
        </h3>
        {props.action}
      </header>
      {items.length ? (
        <div className="dash-panel-body">{props.children}</div>
      ) : (
        <p className="dash-note">{props.empty}</p>
      )}
    </section>
  );
}

function DashLine(props: {
  dot: string;
  title: string;
  meta: Array<string | undefined>;
  badge?: { label: string; tone: string };
  onOpen?: () => void;
}) {
  const meta = props.meta.filter(Boolean).join(" · ");
  const body = (
    <>
      <span className={`dot ${props.dot}`} aria-hidden="true" />
      <span className="dash-line-text">
        <span className="dash-line-title">
          <span className="title-text">{props.title}</span>
          {props.badge ? (
            <span className={`dash-badge ${props.badge.tone}`}>{props.badge.label}</span>
          ) : null}
        </span>
        {meta ? <span className="dash-line-meta">{meta}</span> : null}
      </span>
    </>
  );
  return props.onOpen ? (
    <button type="button" className="dash-line" title={props.title} onClick={props.onOpen}>
      {body}
    </button>
  ) : (
    <div className="dash-line" title={props.title}>
      {body}
    </div>
  );
}

function SessionLine(props: {
  session: AgentSession;
  extra?: string;
  /** Waiting on an approval or answer: shown as "Needs you", not its idle status. */
  needsYou?: boolean;
  onOpen: (id: string) => void;
}) {
  const row = props.session;
  const kind = (row.kind && KIND_LABEL[row.kind]) || undefined;
  return (
    <DashLine
      dot={props.needsYou ? "needs-you" : row.status}
      title={row.title}
      meta={[
        kind,
        props.needsYou ? "Needs you" : STATUS_LABEL[row.status],
        props.extra,
        row.pull ? `#${row.pull.number}` : undefined,
        formatAgo(row.updatedAt, true),
      ]}
      onOpen={() => props.onOpen(row.id)}
    />
  );
}

/**
 * Main pane while the rail Inbox is open: a dashboard with counts up top, the decision card for
 * the focused Needs-you item, and side panels for active agents, reviewers, jobs, and recent chats.
 * Approvals show the command, files, and the agent's reason, and can be decided
 * here. J/K (or ↑/↓) move, A approves, D denies, Enter opens the chat.
 */
export function InboxPane() {
  const { state, dispatch } = useStore();
  const mode = parseProductMode(state.config?.productMode);
  const sessions = useMemo(
    () => state.sessions.filter((s) => sessionMatchesSurface(s, mode)),
    [state.sessions, mode],
  );
  const rows = useMemo(
    () =>
      buildInboxRows({
        sessions,
        boards: state.boards,
        brain: state.brain,
        automations: state.automations,
        runs: state.runs,
      }),
    [sessions, state.boards, state.brain, state.automations, state.runs],
  );
  const focusKey = state.inboxFocusKey;
  const setFocusKey = useCallback(
    (key: string | null) => dispatch({ type: "inboxFocus", key }),
    [dispatch],
  );
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const index = Math.max(
    0,
    rows.findIndex((row) => row.key === focusKey),
  );
  const current: InboxRow | undefined = rows[index];
  const session = sessions.find((row) => row.id === current?.sessionId);
  const preview = current?.callId ? approvalPreview(session, current.callId) : undefined;
  const sameTool = useMemo(
    () => (current && preview?.batchable ? sameToolRows(rows, sessions, current) : []),
    [current, preview?.batchable, rows, sessions],
  );
  const waitingIds = useMemo(
    () => new Set(rows.map((row) => row.sessionId).filter(Boolean)),
    [rows],
  );

  // Keep focus on the same position when the decided row drops out of the list.
  useEffect(() => {
    if (!rows.length) {
      if (focusKey !== null) setFocusKey(null);
      return;
    }
    if (!focusKey || !rows.some((row) => row.key === focusKey)) {
      setFocusKey(rows[Math.min(index, rows.length - 1)]!.key);
    }
  }, [rows, focusKey, index, setFocusKey]);

  const decide = useCallback(
    async (targets: InboxRow[], decision: Decision, always = false) => {
      if (busyRef.current || !targets.length) return;
      busyRef.current = true;
      setBusy(true);
      try {
        for (const row of targets) {
          if (!row.sessionId || !row.callId) continue;
          const updated = await api.resolveApproval(
            row.sessionId,
            row.callId,
            decision,
            undefined,
            always || undefined,
          );
          dispatch({ type: "session", session: updated });
        }
      } catch (err) {
        showErrorNotice(err, decision === "approved" ? "Could not approve" : "Could not deny");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [dispatch],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector("[role='dialog']")) return;
      const key = event.key;
      if (key === "j" || key === "ArrowDown") {
        event.preventDefault();
        setFocusKey(stepInboxFocus(rows, focusKey, 1));
      } else if (key === "k" || key === "ArrowUp") {
        event.preventDefault();
        setFocusKey(stepInboxFocus(rows, focusKey, -1));
      } else if (key === "Enter" && current) {
        if (event.target instanceof HTMLButtonElement) return;
        event.preventDefault();
        openInboxRow(current, dispatch);
      } else if ((key === "a" || key === "d") && current && preview?.batchable) {
        event.preventDefault();
        void decide([current], key === "a" ? "approved" : "denied");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, focusKey, setFocusKey, current, preview?.batchable, decide, dispatch]);

  const active = useMemo(() => activeAgents(sessions), [sessions]);
  const reviews = useMemo(() => reviewSessions(sessions), [sessions]);
  const recent = useMemo(() => recentSessions(sessions), [sessions]);
  const jobs = useMemo(
    () => automationActivity(state.automations, state.runs),
    [state.automations, state.runs],
  );
  const nextJob = useMemo(() => nextScheduledRun(state.automations), [state.automations]);
  const reviewers = useMemo(
    () => activeSlackReviewers(state.config?.slackReviewers),
    [state.config?.slackReviewers],
  );
  const slack = useSlackReviews(reviewers.length > 0);
  const failingJobs = rows.filter((row) => row.kind === "automation").length;
  const queuedReviews = slack.active.filter((row) => row.status === "queued").length;
  const runningReviews =
    reviews.filter(isActiveSession).length +
    slack.active.filter((row) => row.status === "running").length;
  const subagents = active.reduce((sum, row) => sum + row.subagents, 0);
  const jobWord = mode === "swarm" ? "Routines" : "Jobs";
  const agentWord = mode === "swarm" ? "teammates" : "agents";
  const openSession = (id: string) => {
    dispatch({ type: "select", id });
    dispatch({ type: "inbox", open: false });
  };
  const jump = (target: string) => {
    const el = document.getElementById(target);
    if (!el) return;
    el.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    el.focus({ preventScroll: true });
  };
  const shownActive = active.slice(0, PANEL_LIMIT);
  const hiddenActive = active.length - shownActive.length;
  const label = current ? inboxRowLabel(current, Boolean(preview?.batchable), mode) : "";

  return (
    <div className="inbox-pane inbox-dashboard" data-testid="inbox-pane">
      <div className="dash-stats" data-testid="dash-stats">
        <StatTile
          label="Needs you"
          value={rows.length}
          tone={rows.length ? "attention" : undefined}
          target="dash-needs"
          onJump={jump}
        />
        <StatTile
          label={`Active ${agentWord}`}
          value={active.length}
          hint={subagents ? `+${subagents} subagent${subagents === 1 ? "" : "s"}` : undefined}
          tone={active.length ? "live" : undefined}
          target="dash-active"
          onJump={jump}
        />
        <StatTile
          label="Reviews running"
          value={runningReviews}
          hint={queuedReviews ? `${queuedReviews} queued` : undefined}
          tone={runningReviews ? "live" : undefined}
          target="dash-reviewers"
          onJump={jump}
        />
        <StatTile
          label={`${jobWord} running`}
          value={jobs.live.length}
          hint={failingJobs ? `${failingJobs} failing` : undefined}
          tone={failingJobs ? "danger" : jobs.live.length ? "live" : undefined}
          target="dash-jobs"
          onJump={jump}
        />
      </div>
      <div className="dash-grid">
        <div className="dash-main">
          <section className="dash-needs" id="dash-needs" tabIndex={-1} aria-label="Needs you">
            <div className="empty-card inbox-decision-card">
              {current ? (
                <>
                  <header className="inbox-decision-head">
                    <h2>
                      {rows.length === 1 ? "1 item needs you" : `${rows.length} items need you`}
                    </h2>
                    {rows.length > 1 ? (
                      <div className="inbox-stepper" data-testid="inbox-stepper">
                        <button
                          type="button"
                          className="btn small ghost"
                          disabled={index === 0}
                          aria-label="Previous item"
                          onClick={() => setFocusKey(stepInboxFocus(rows, current.key, -1))}
                        >
                          ↑ Prev
                        </button>
                        <span>
                          {index + 1} of {rows.length}
                        </span>
                        <button
                          type="button"
                          className="btn small ghost"
                          disabled={index >= rows.length - 1}
                          aria-label="Next item"
                          onClick={() => setFocusKey(stepInboxFocus(rows, current.key, 1))}
                        >
                          Next ↓
                        </button>
                      </div>
                    ) : null}
                  </header>
                  <div className="inbox-next" data-testid="inbox-next" aria-busy={busy}>
                    <p className="inbox-next-kind">{label}</p>
                    <p className="inbox-next-title">{current.title}</p>
                    {preview ? (
                      <ApprovalDetail preview={preview} />
                    ) : (
                      <p className="inbox-next-detail">{current.detail}</p>
                    )}
                    <div className="inbox-decision-actions">
                      {preview?.batchable ? (
                        <>
                          <button
                            type="button"
                            className="btn primary"
                            disabled={busy}
                            data-testid="inbox-approve"
                            onClick={() => void decide([current], "approved")}
                          >
                            Approve <kbd>A</kbd>
                          </button>
                          <button
                            type="button"
                            className="btn"
                            disabled={busy}
                            data-testid="inbox-deny"
                            onClick={() => void decide([current], "denied")}
                          >
                            Deny <kbd>D</kbd>
                          </button>
                          <button
                            type="button"
                            className="btn ghost"
                            disabled={busy}
                            title="Approve, and stop asking for this tool in this chat"
                            onClick={() => void decide([current], "approved", true)}
                          >
                            Always allow
                          </button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        className={`btn ${preview?.batchable ? "ghost" : "primary"}`}
                        onClick={() => openInboxRow(current, dispatch)}
                      >
                        {preview?.batchable ? "Open chat" : "Open"}
                      </button>
                    </div>
                    {sameTool.length > 1 ? (
                      <button
                        type="button"
                        className="btn small ghost inbox-approve-all"
                        disabled={busy}
                        data-testid="inbox-approve-all"
                        onClick={() => void decide(sameTool, "approved")}
                      >
                        Approve all {sameTool.length} waiting <code>{preview?.call.name}</code>{" "}
                        calls
                      </button>
                    ) : null}
                  </div>
                  <p className="inbox-keys" aria-hidden="true">
                    <kbd>J</kbd>/<kbd>K</kbd> move · <kbd>A</kbd> approve · <kbd>D</kbd> deny ·{" "}
                    <kbd>Enter</kbd> open
                  </p>
                </>
              ) : (
                <EmptyHero
                  pose="rest"
                  title="All caught up"
                  lead={`Approvals, questions, and failing ${mode === "swarm" ? "routines" : "jobs"} show up here.`}
                />
              )}
            </div>
          </section>
          <DashPanel
            title="Recent"
            testId="dash-recent"
            id="dash-recent"
            empty="Chats you work in show up here."
          >
            {recent.map((row) => (
              <SessionLine
                key={row.id}
                session={row}
                needsYou={waitingIds.has(row.id)}
                onOpen={openSession}
              />
            ))}
          </DashPanel>
        </div>
        <div className="dash-side">
          <DashPanel
            title={`Active ${agentWord}`}
            count={active.length ? String(active.length) : undefined}
            testId="dash-active"
            id="dash-active"
            empty={`No ${agentWord} working right now.`}
          >
            {shownActive.map(({ session: row, subagents: subs }) => (
              <SessionLine
                key={row.id}
                session={row}
                extra={subs ? `${subs} subagent${subs === 1 ? "" : "s"}` : undefined}
                onOpen={openSession}
              />
            ))}
            {hiddenActive > 0 ? (
              <button
                type="button"
                className="dash-more"
                data-testid="dash-active-more"
                onClick={() => {
                  dispatch({ type: "inbox", open: false });
                  dispatch({ type: "section", section: "agents" });
                }}
              >
                +{hiddenActive} more in {mode === "swarm" ? "Teammates" : "Agents"}
              </button>
            ) : null}
          </DashPanel>
          <DashPanel
            title="Reviewers"
            count={runningReviews ? `${runningReviews} running` : undefined}
            testId="dash-reviewers"
            id="dash-reviewers"
            empty="No review chats or Slack reviewers yet."
            action={
              <button
                type="button"
                className="btn small ghost"
                onClick={() => openSettings(dispatch, "reviewers")}
              >
                Manage
              </button>
            }
          >
            {slack.active.map((row) => (
              <DashLine
                key={`${row.reviewerId}:${row.url}:${row.kind}`}
                dot={row.status === "running" ? "running" : "provisioning"}
                title={row.pr}
                meta={[
                  reviewerName(reviewers, row.reviewerId),
                  row.kind === "answer"
                    ? "Answering"
                    : row.status === "running"
                      ? "Reviewing"
                      : "Queued",
                  formatAgo(row.since, true),
                ]}
                onOpen={
                  row.channelId && row.threadTs
                    ? () => openSlackThread(dispatch, row.channelId!, row.threadTs!)
                    : undefined
                }
              />
            ))}
            {reviews.map((row) => (
              <SessionLine
                key={row.id}
                session={row}
                needsYou={waitingIds.has(row.id)}
                onOpen={openSession}
              />
            ))}
            {slack.recent.map((row) => (
              <DashLine
                key={`${row.reviewerId}:${row.url}:${row.at}`}
                dot="idle"
                title={row.pr}
                badge={{
                  label: REVIEW_OUTCOME_LABEL[row.outcome],
                  tone: reviewOutcomeTone(row.outcome),
                }}
                meta={[
                  reviewerName(reviewers, row.reviewerId),
                  row.comments ? `${row.comments} comment${row.comments === 1 ? "" : "s"}` : "",
                  formatAgo(row.at, true),
                ]}
                onOpen={
                  row.channelId && row.threadTs
                    ? () => openSlackThread(dispatch, row.channelId!, row.threadTs!)
                    : undefined
                }
              />
            ))}
            {reviewers.length && !slack.active.length && !slack.recent.length ? (
              <p className="dash-note">
                {reviewers.length} Slack reviewer{reviewers.length === 1 ? "" : "s"} watching
                {slack.error ? ` · ${slack.error}` : ""}
              </p>
            ) : null}
          </DashPanel>
          <DashPanel
            title={jobWord}
            count={jobs.live.length ? `${jobs.live.length} running` : undefined}
            testId="dash-jobs"
            id="dash-jobs"
            empty={`No ${jobWord.toLowerCase()} have run yet.`}
            action={
              <button
                type="button"
                className="btn small ghost"
                onClick={() => dispatch({ type: "section", section: "automations" })}
              >
                All {jobWord.toLowerCase()}
              </button>
            }
          >
            {[...jobs.live, ...jobs.recent].map(({ run, name }) => (
              <DashLine
                key={run.id}
                dot={RUN_DOT[run.status]}
                title={name}
                meta={[RUN_LABEL[run.status], formatAgo(run.finishedAt ?? run.startedAt, true)]}
                onOpen={() => dispatch({ type: "selectAutomation", id: run.automationId })}
              />
            ))}
            {nextJob?.nextRunAt ? (
              <p className="dash-note">
                Next: {nextJob.name} · {formatUntil(nextJob.nextRunAt)}
              </p>
            ) : null}
          </DashPanel>
        </div>
      </div>
    </div>
  );
}
