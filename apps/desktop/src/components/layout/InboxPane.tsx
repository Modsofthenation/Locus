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
  clipFact,
  parseProductMode,
  repoDisplayName,
  sessionMatchesSurface,
  toolActivityLabel,
  type AgentSession,
  type AutomationRun,
  type AutomationRunStatus,
  type SlackReviewActive,
  type SlackReviewRun,
} from "@locus/shared";
import { api } from "@/lib/api";
import { plainJobError, runOutcomeLabel } from "@/lib/automations";
import {
  approvalPreview,
  findPendingCall,
  pendingActionLabel,
  sameToolRows,
  stepInboxFocus,
  type ApprovalPreview,
} from "@/lib/inboxDecision";
import { isBatchableApproval } from "@/lib/needsYou";
import { buildInboxRows, inboxRowLabel, openInboxRow, type InboxRow } from "@/lib/inboxList";
import { showErrorNotice } from "@/lib/notice";
import {
  REVIEW_OUTCOME_LABEL,
  activeAgents,
  agentActivity,
  agentRuntimeLabel,
  automationActivity,
  isActiveSession,
  nextScheduledRuns,
  recentSessions,
  reviewOutcomeTone,
  reviewSessions,
  reviewerName,
  slackReviewActivity,
  sessionOutcome,
} from "@/lib/dashboard";
import { formatAgo } from "@/lib/timeAgo";
import { useStore, type Action } from "@/state/store";
import { EmptyHero } from "./EmptyHero";
import { IconPlus } from "./Icons";
import { ModelUsagePanel } from "./ModelUsagePanel";
import { JobRunNotice, startJobRun } from "@/components/automations/jobRun";

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
const QUEUE_GROUPS = ["Questions", "Approvals", "Jobs", "Board", "Brain"] as const;
type QueueGroup = (typeof QUEUE_GROUPS)[number];
type QueueRow = InboxRow & { group: QueueGroup; summary: string };

function queueRows(rows: InboxRow[], sessions: AgentSession[], runs: AutomationRun[]): QueueRow[] {
  const sessionById = new Map(sessions.map((row) => [row.id, row]));
  const runById = new Map(runs.map((run) => [run.id, run]));
  return rows
    .map((row): QueueRow => {
      if (row.kind === "session") {
        const session = sessionById.get(row.sessionId ?? "");
        const call = row.callId ? findPendingCall(session, row.callId)?.call : undefined;
        if (call && isBatchableApproval(call.name)) {
          return {
            ...row,
            group: "Approvals",
            summary: pendingActionLabel(toolActivityLabel(call.name, call.arguments)),
          };
        }
        return { ...row, group: "Questions", summary: row.detail };
      }
      if (row.kind === "automation") {
        const run = runById.get(row.runId ?? "");
        const detail = run ? jobDetail(run, sessionById.get(run.sessionId ?? "")) : undefined;
        return {
          ...row,
          group: "Jobs",
          summary: detail ? `${row.detail} · ${detail}` : row.detail,
        };
      }
      return { ...row, group: row.kind === "board" ? "Board" : "Brain", summary: row.detail };
    })
    .sort((a, b) => {
      const group = QUEUE_GROUPS.indexOf(a.group) - QUEUE_GROUPS.indexOf(b.group);
      if (group) return group;
      if (a.group === "Jobs" && a.detail !== b.detail) return a.detail === "Failing" ? -1 : 1;
      const time = (row: InboxRow) => Date.parse(row.at ?? "") || 0;
      return a.group === "Jobs"
        ? time(b) - time(a)
        : (time(a) || Infinity) - (time(b) || Infinity) || 0;
    });
}

function usePreviousHomeVisit(mode: string) {
  const key = `locus.home.lastVisit.${mode}`;
  const [previous] = useState(() => {
    try {
      const value = Number(localStorage.getItem(key));
      return Number.isFinite(value) && value > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  });
  useEffect(() => {
    function saveVisit() {
      try {
        localStorage.setItem(key, String(Date.now()));
      } catch {
        // Home also works in a renderer with storage disabled.
      }
    }
    window.addEventListener("pagehide", saveVisit);
    return () => {
      window.removeEventListener("pagehide", saveVisit);
      saveVisit();
    };
  }, [key]);
  return previous;
}

function jobDetail(run: AutomationRun, session?: AgentSession) {
  const detail = runOutcomeLabel(run, session);
  return detail ? (plainJobError(detail)?.summary ?? clipFact(detail, 140)) : undefined;
}

/** Slack review queue refresh: fast while something runs, slow otherwise. */
const SLACK_BUSY_MS = 5_000;
const SLACK_IDLE_MS = 30_000;

function useSlackReviews(enabled: boolean): {
  active: SlackReviewActive[];
  recent: SlackReviewRun[];
  runs: SlackReviewRun[];
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
  return useMemo(
    () => ({ ...slackReviewActivity(runs, active), runs, error }),
    [runs, active, error],
  );
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
  show?: boolean;
  children: ReactNode;
}) {
  if (props.show === false) return null;
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
  detail?: string;
  href?: string;
  actionLabel?: string;
  badge?: { label: string; tone: string };
  onOpen?: () => void;
}) {
  const meta = [...props.meta, props.actionLabel].filter(Boolean).join(" · ");
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
        {props.detail ? <span className="dash-line-detail">{props.detail}</span> : null}
      </span>
    </>
  );
  return props.href ? (
    <a className="dash-line" href={props.href} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : props.onOpen ? (
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
  context?: string[];
  activity?: string;
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
        ...(props.context ?? []),
        props.extra,
        row.pull ? `#${row.pull.number}` : undefined,
        formatAgo(row.updatedAt, true),
      ]}
      detail={props.activity}
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
  const previousVisit = usePreviousHomeVisit(mode);
  const [sinceVisit, setSinceVisit] = useState(false);
  const [allOutcomes, setAllOutcomes] = useState(false);
  const sessions = useMemo(
    () => state.sessions.filter((s) => sessionMatchesSurface(s, mode)),
    [state.sessions, mode],
  );
  const rows = useMemo(
    () =>
      queueRows(
        buildInboxRows({
          sessions,
          boards: state.boards,
          brain: state.brain,
          automations: state.automations,
          runs: state.runs,
        }),
        sessions,
        state.runs,
      ),
    [sessions, state.boards, state.brain, state.automations, state.runs],
  );
  const focusKey = state.inboxFocusKey;
  const setFocusKey = useCallback(
    (key: string | null) => dispatch({ type: "inboxFocus", key }),
    [dispatch],
  );
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [replaying, setReplaying] = useState<string>();
  const replayingRef = useRef(false);
  const queueRef = useRef<HTMLDivElement>(null);

  const index = Math.max(
    0,
    rows.findIndex((row) => row.key === focusKey),
  );
  const current: QueueRow | undefined = rows[index];
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
  const selectedRun = state.runs.find((run) => run.id === current?.runId);
  const selectedJob = state.automations.find((job) => job.id === current?.automationId);

  async function replaySelectedRun() {
    if (!selectedJob || !selectedRun || replayingRef.current) return;
    replayingRef.current = true;
    setReplaying(selectedRun.id);
    try {
      await startJobRun(selectedJob, dispatch, { runId: selectedRun.id });
    } finally {
      replayingRef.current = false;
      setReplaying(undefined);
    }
  }

  useEffect(() => {
    const queue = queueRef.current;
    const row = queue?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (!queue || !row) return;
    const bounds = queue.getBoundingClientRect();
    const selected = row.getBoundingClientRect();
    if (selected.top < bounds.top) queue.scrollTop -= bounds.top - selected.top;
    if (selected.bottom > bounds.bottom) queue.scrollTop += selected.bottom - bounds.bottom;
    if (queue.contains(document.activeElement)) row.focus({ preventScroll: true });
  }, [current?.key]);

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
        if (
          event.target instanceof HTMLButtonElement &&
          !event.target.matches('.dash-queue-item[aria-pressed="true"]')
        )
          return;
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

  const active = useMemo(
    () => activeAgents(sessions.filter((row) => !waitingIds.has(row.id))),
    [sessions, waitingIds],
  );
  const reviews = useMemo(() => reviewSessions(sessions), [sessions]);
  const recent = useMemo(() => recentSessions(sessions), [sessions]);
  const jobs = useMemo(
    () => automationActivity(state.automations, state.runs),
    [state.automations, state.runs],
  );
  const nextJobs = useMemo(() => nextScheduledRuns(state.automations), [state.automations]);
  const reviewers = useMemo(
    () => activeSlackReviewers(state.config?.slackReviewers),
    [state.config?.slackReviewers],
  );
  const slack = useSlackReviews(reviewers.length > 0);
  const failingJobs = rows.filter(
    (row) => row.kind === "automation" && row.detail === "Failing",
  ).length;
  const blockedJobs = rows.filter(
    (row) => row.kind === "automation" && row.detail === "Needs you",
  ).length;
  const runningJobs = jobs.live.filter(({ run }) => run.status === "running").length;
  const queuedJobs = jobs.live.length - runningJobs;
  const queuedReviews = slack.active.filter((row) => row.status === "queued").length;
  const runningReviews =
    reviews.filter((row) => isActiveSession(row) && !waitingIds.has(row.id)).length +
    slack.active.filter((row) => row.status === "running").length;
  const subagents = active.reduce((sum, row) => sum + row.subagents, 0);
  const showReviews = Boolean(
    reviews.length || reviewers.length || slack.active.length || slack.recent.length,
  );
  const showJobs = Boolean(
    jobs.live.length || jobs.recent.length || nextJobs.length || failingJobs || blockedJobs,
  );
  const showActivity = active.length > 0 || showReviews || showJobs;
  const jobWord = mode === "swarm" ? "Routines" : "Jobs";
  const agentWord = mode === "swarm" ? "teammates" : "agents";
  const openSession = (id: string) => {
    dispatch({ type: "select", id });
    dispatch({ type: "inbox", open: false });
  };
  const openRun = (run: AutomationRun) =>
    dispatch({ type: "selectAutomation", id: run.automationId, runId: run.id });
  const jump = (target: string) => {
    const el = document.getElementById(target);
    if (!el) return;
    el.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    el.focus({ preventScroll: true });
  };
  const shownActive = active.slice(0, PANEL_LIMIT);
  const hiddenActive = active.length - shownActive.length;
  const label = current ? inboxRowLabel(current, Boolean(preview?.batchable), mode) : "";
  const jobHint = [
    queuedJobs ? `${queuedJobs} queued` : "",
    blockedJobs ? `${blockedJobs} need you` : "",
    failingJobs ? `${failingJobs} failing` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const jobNames = new Map(state.automations.map((job) => [job.id, job.name]));
  const outcomes = [
    ...sessions.flatMap((row) => {
      const outcome = waitingIds.has(row.id) ? undefined : sessionOutcome(row);
      return outcome
        ? [
            {
              key: `chat:${row.id}`,
              title: row.title,
              dot: row.status,
              ...outcome,
              label:
                row.status === "error"
                  ? "Session failed"
                  : row.pull?.checkState === "success"
                    ? "PR checks passed"
                    : row.pull?.checkState === "failure"
                      ? "PR checks failed"
                      : "Agent reply",
              actionLabel: "Open chat",
              onOpen: () => openSession(row.id),
              href: undefined,
            },
          ]
        : [];
    }),
    ...state.runs.flatMap((run) => {
      if (run.status !== "failed" && run.status !== "succeeded") return [];
      const name = jobNames.get(run.automationId);
      if (!name) return [];
      return [
        {
          key: `job:${run.id}`,
          title: name,
          dot: RUN_DOT[run.status],
          at: run.finishedAt ?? run.startedAt,
          label: RUN_LABEL[run.status],
          actionLabel: "View run",
          detail: jobDetail(run),
          onOpen: () => openRun(run),
          href: undefined,
        },
      ];
    }),
    ...slack.runs.flatMap((run) => {
      if (run.dryRun || run.outcome === "skipped") return [];
      const detail = run.summary || run.reason;
      const href = /^https?:\/\//i.test(run.url) ? run.url : undefined;
      return [
        {
          key: `review:${run.reviewerId}:${run.url}:${run.at}`,
          title: run.pr,
          at: run.at,
          dot: run.outcome === "failed" ? "error" : "idle",
          label: REVIEW_OUTCOME_LABEL[run.outcome],
          actionLabel: href ? "Open PR" : run.channelId && run.threadTs ? "Open thread" : undefined,
          detail: detail ? clipFact(detail, 140) : undefined,
          href,
          onOpen:
            run.channelId && run.threadTs
              ? () => openSlackThread(dispatch, run.channelId!, run.threadTs!)
              : undefined,
        },
      ];
    }),
  ]
    .filter((row) => !sinceVisit || !previousVisit || Date.parse(row.at) > previousVisit)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return (
    <div className="inbox-pane inbox-dashboard" data-testid="inbox-pane">
      <header className="dash-heading">
        <div>
          <h1>Home</h1>
          <p>
            {showActivity
              ? "Decisions and recent activity across your workspace."
              : "Review work that needs your attention."}
          </p>
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            dispatch({ type: "section", section: "agents" });
            dispatch({ type: "select", id: null });
          }}
        >
          <IconPlus />
          {mode === "swarm" ? "Create a teammate" : "Start an agent"}
        </button>
      </header>
      {showActivity ? (
        <div className="dash-stats" data-testid="dash-stats">
          <StatTile
            label="Needs you"
            value={rows.length}
            tone={rows.length ? "attention" : undefined}
            target="dash-needs"
            onJump={jump}
          />
          {active.length > 0 ? (
            <StatTile
              label={`Active ${agentWord}`}
              value={active.length}
              hint={subagents ? `+${subagents} subagent${subagents === 1 ? "" : "s"}` : undefined}
              tone={active.length ? "live" : undefined}
              target="dash-active"
              onJump={jump}
            />
          ) : null}
          {showReviews ? (
            <StatTile
              label="Reviews running"
              value={runningReviews}
              hint={
                slack.error
                  ? "Slack status unavailable"
                  : queuedReviews
                    ? `${queuedReviews} queued`
                    : undefined
              }
              tone={runningReviews ? "live" : undefined}
              target="dash-reviewers"
              onJump={jump}
            />
          ) : null}
          {showJobs ? (
            <StatTile
              label={`${jobWord} running`}
              value={runningJobs}
              hint={jobHint || undefined}
              tone={failingJobs ? "danger" : runningJobs ? "live" : undefined}
              target="dash-jobs"
              onJump={jump}
            />
          ) : null}
        </div>
      ) : null}
      <div className={`dash-grid${showActivity ? "" : " dash-grid-single"}`}>
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
                  <div className="dash-triage">
                    <div
                      className="dash-queue"
                      ref={queueRef}
                      role="region"
                      aria-label="Items that need you"
                    >
                      {QUEUE_GROUPS.map((group) => {
                        const items = rows.filter((row) => row.group === group);
                        if (!items.length) return null;
                        return (
                          <div
                            className="dash-queue-group"
                            key={group}
                            role="group"
                            aria-label={group === "Jobs" ? jobWord : group}
                          >
                            <h3>{group === "Jobs" ? jobWord : group}</h3>
                            {items.map((row) => (
                              <button
                                className="dash-queue-item"
                                type="button"
                                key={row.key}
                                aria-pressed={row.key === current.key}
                                aria-controls="dash-decision"
                                onClick={() => setFocusKey(row.key)}
                              >
                                <span className="dash-queue-title">{row.title}</span>
                                {row.at ? <time dateTime={row.at}>{formatAgo(row.at)}</time> : null}
                                <span className="dash-queue-detail">
                                  {clipFact(row.summary, 140)}
                                </span>
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                    <div
                      className="inbox-next"
                      id="dash-decision"
                      data-testid="inbox-next"
                      aria-busy={busy}
                    >
                      <p className="inbox-next-kind">{label}</p>
                      <p className="inbox-next-title">{current.title}</p>
                      {preview ? (
                        <ApprovalDetail preview={preview} />
                      ) : (
                        <p className="inbox-next-detail">{current.summary}</p>
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
                          {current.runId ? "View run" : current.sessionId ? "Open chat" : "Open"}
                        </button>
                        {selectedRun?.status === "failed" && selectedJob?.enabled ? (
                          <button
                            type="button"
                            className="btn"
                            disabled={Boolean(replaying)}
                            onClick={() => void replaySelectedRun()}
                          >
                            {replaying === selectedRun.id ? "Starting…" : "Run again"}
                          </button>
                        ) : null}
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
                      {selectedJob ? (
                        <JobRunNotice key={selectedJob.id} item={selectedJob} />
                      ) : null}
                    </div>
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
                  lead={`Approvals, questions, and failing ${jobWord.toLowerCase()} show up here.`}
                />
              )}
            </div>
          </section>
          <DashPanel
            title="Recent"
            show={Boolean(outcomes.length || recent.length || sinceVisit)}
            testId="dash-recent"
            id="dash-recent"
            empty="Finished work and recent chats show up here."
            action={
              previousVisit ? (
                <button
                  type="button"
                  className="btn small ghost"
                  aria-pressed={sinceVisit}
                  onClick={() => {
                    setSinceVisit((value) => !value);
                    setAllOutcomes(false);
                  }}
                >
                  Since last visit
                </button>
              ) : undefined
            }
          >
            {(allOutcomes ? outcomes : outcomes.slice(0, PANEL_LIMIT)).map((row) => (
              <DashLine
                key={row.key}
                dot={row.dot}
                title={row.title}
                meta={[row.label, formatAgo(row.at, true)]}
                detail={row.detail}
                onOpen={row.onOpen}
                href={row.href}
                actionLabel={row.actionLabel}
              />
            ))}
            {!outcomes.length && sinceVisit ? (
              <p className="dash-note">No new outcomes since your last visit.</p>
            ) : null}
            {outcomes.length > PANEL_LIMIT ? (
              <button
                type="button"
                className="dash-more"
                aria-expanded={allOutcomes}
                onClick={() => setAllOutcomes((value) => !value)}
              >
                {allOutcomes
                  ? "Show fewer outcomes"
                  : `Show ${outcomes.length - PANEL_LIMIT} more outcomes`}
              </button>
            ) : null}
            {!sinceVisit && recent.length ? (
              <details className="dash-resumable" open={!outcomes.length}>
                <summary>Recent chats</summary>
                {recent.map((row) => (
                  <SessionLine
                    key={row.id}
                    session={row}
                    needsYou={waitingIds.has(row.id)}
                    onOpen={openSession}
                  />
                ))}
              </details>
            ) : null}
          </DashPanel>
          <ModelUsagePanel providers={state.config?.providers} />
        </div>
        <div className="dash-side" hidden={!showActivity}>
          <DashPanel
            show={active.length > 0}
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
                context={[
                  state.projects.find((project) => project.id === row.projectId)?.title ??
                    (row.repo ? repoDisplayName(row.repo.url) : ""),
                  agentRuntimeLabel(row),
                  row.cursorCloud
                    ? ""
                    : row.backendId || row.placement === "worker"
                      ? (state.config?.workers?.find((worker) => worker.id === row.backendId)
                          ?.name ?? "Remote worker")
                      : "This machine",
                ].filter(Boolean)}
                activity={agentActivity(row)}
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
            title="Reviews"
            show={showReviews}
            count={runningReviews ? `${runningReviews} running` : undefined}
            testId="dash-reviewers"
            id="dash-reviewers"
            empty="No review chats or Slack reviewers yet."
            action={
              mode === "developer" ? (
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => dispatch({ type: "section", section: "reviews" })}
                >
                  Open Reviews
                </button>
              ) : undefined
            }
          >
            {slack.error ? (
              <p className="dash-note" role="status">
                Slack reviewer status could not refresh. Saved results may be out of date.
              </p>
            ) : null}
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
              </p>
            ) : null}
          </DashPanel>
          <DashPanel
            title={jobWord}
            show={showJobs}
            count={
              [
                runningJobs ? `${runningJobs} running` : "",
                queuedJobs ? `${queuedJobs} queued` : "",
              ]
                .filter(Boolean)
                .join(" · ") || undefined
            }
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
            {[
              ...jobs.live.filter(({ run }) => run.status === "running"),
              ...jobs.live.filter(({ run }) => run.status === "queued"),
              ...jobs.recent,
            ].map(({ run, name }) => (
              <DashLine
                key={run.id}
                dot={RUN_DOT[run.status]}
                title={name}
                meta={[RUN_LABEL[run.status], formatAgo(run.finishedAt ?? run.startedAt, true)]}
                detail={jobDetail(run)}
                onOpen={() => openRun(run)}
              />
            ))}
            {nextJobs.length ? (
              <div className="dash-upcoming">
                <h4>Upcoming</h4>
                {nextJobs.map((job) => (
                  <DashLine
                    key={job.id}
                    dot="idle"
                    title={job.name}
                    meta={[
                      new Date(job.at).toLocaleString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      }),
                    ]}
                    onOpen={() => dispatch({ type: "selectAutomation", id: job.id })}
                  />
                ))}
              </div>
            ) : null}
          </DashPanel>
        </div>
      </div>
    </div>
  );
}
