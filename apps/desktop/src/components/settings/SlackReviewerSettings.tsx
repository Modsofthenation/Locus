import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  clampSlackReviewerCost,
  clampSlackReviewerNumber,
  DEFAULT_REVIEW_IGNORE_GLOBS,
  formatSlackAuthorMapText,
  parseSlackAuthorMapText,
  DEFAULT_SLACK_REVIEWER_STATUS,
  hasUsableKey,
  renderSlackReviewerStatus,
  SLACK_REVIEWER_LIMITS,
  SLACK_REVIEWER_PROMPT_MAX,
  supportsPromptCompletion,
  isPromptCliProvider,
  cliPromptCharLimit,
  enabledSkills,
  estimateTokens,
  resolveSlackReviewerSkills,
  slackReactionNameOrEmpty,
  parseSlackReactionNames,
  slackReviewReactionPresetOf,
  SLACK_REVIEW_REACTION_PRESETS,
  SLACK_REVIEW_REACTION_PRESET_IDS,
  type SlackReviewReactionMap,
  parseSlackPathPrompts,
  parseSlackRequesters,
  slackReviewProposeSupported,
  resolveForgeAccount,
  parseSlackRepoNotesKey,
  SLACK_REVIEWER_PATH_PROMPT_MAX,
  SLACK_REVIEWER_PATH_PROMPTS_MAX,
  type GitForgeAccount,
  type SlackReviewerPathPrompt,
  type AgentSkill,
  type AgentSession,
  type AiProvider,
  type IntegrationAccount,
  type SlackConversation,
  type SlackMember,
  type SlackRepoNote,
  type SlackReviewer,
  type SlackReviewerFeedback,
  type SlackReviewerStats,
  type SlackReviewerForgeMode,
  type SlackReviewerNumberField,
  type SlackReviewerStatusTemplates,
  type SlackReviewOutcome,
  type SlackReviewActive,
  type SlackReviewRun,
  type SlackReviewSeverity,
  type SlackReviewThread,
  type SlackReviewerPollStatus,
  type SlackReviewerPolling,
  type SlackStatus,
} from "@locus/shared";
import { api } from "@/lib/api";
import { isActiveSession } from "@/lib/dashboard";
import { sessionHasNeedsYou } from "@/lib/needsYou";
import { formatAgo } from "@/lib/timeAgo";
import { IconChevron } from "@/components/layout/Icons";
import { Select, type SelectOption } from "@/components/layout/Select";
import { BusyButton, InlineError } from "@/components/layout/Skeleton";
import { EmptyHint } from "@/components/layout/EmptyHero";
import { ModelPicker } from "./ModelPicker";
import { SlackUserMultiSelect } from "./SlackUserMultiSelect";
import { SlackReviewerAccuracy, SlackReviewerVerifyFields } from "./SlackReviewerAccuracy";
import { SlackReviewTraceToggle } from "./SlackReviewTraceView";
import { SlackReviewerLiveLogs } from "./SlackReviewerLiveLogs";
import { SlackReviewerPollingSettings } from "./SlackReviewerPollingSettings";
import {
  SLACK_PREVIEW_PR,
  SlackReviewerPreview,
  slackPreviewHtml,
  slackPreviewVars,
} from "./SlackReviewerPreview";
import { HowItWorks, SettingsSwitch, SettingsToggleRow } from "./SettingsBits";

type Patch = Partial<SlackReviewer> | ((row: SlackReviewer) => SlackReviewer);

const FORGE_MODE_OPTIONS: SelectOption<SlackReviewerForgeMode>[] = [
  {
    value: "comment",
    label: "Comment only",
    hint: "A COMMENT review with inline findings. Never approves.",
  },
  {
    value: "verdict",
    label: "Approve or request changes",
    hint: "APPROVE when nothing blocking, REQUEST_CHANGES on a blocker or major.",
  },
  { value: "none", label: "Slack only", hint: "Nothing is posted to the PR." },
];

const SEVERITY_OPTIONS: SelectOption<SlackReviewSeverity>[] = [
  { value: "blocker", label: "Blockers only" },
  { value: "major", label: "Major and up" },
  { value: "minor", label: "Minor and up" },
  { value: "nit", label: "Everything, including nits" },
];

const STATUS_LABELS: Record<keyof SlackReviewerStatusTemplates, string> = {
  started: "Started",
  commented: "Left comments",
  approved: "Approved",
  changesRequested: "Requested changes",
  clean: "No issues",
  failed: "Failed",
  skipped: "Skipped",
  queued: "Queued",
  dismissed: "Dismissed a finding",
  partDone: "Finished one part of a large PR",
};

const STATUS_PLACEHOLDERS =
  "{pr} {url} {title} {author} {sha} {model} {provider} {files} {tokens} {checkout} {comments} {summary} {findings} {progress} {usage} {reason} {ahead} {dismissed} {part}";

/** How often the run lists refresh while something is queued or running (same as Home). */
export const ACTIVE_REFRESH_MS = 5_000;
/** How often the run lists refresh when nothing is queued or running. */
export const IDLE_REFRESH_MS = 30_000;

const OUTCOME_LABELS: Record<SlackReviewOutcome, string> = {
  approved: "Approved",
  commented: "Commented",
  changesRequested: "Changes requested",
  clean: "No issues",
  skipped: "Skipped",
  failed: "Failed",
  answered: "Answered a question",
};

export const SLACK_REVIEWER_PROMPT_PLACEHOLDER =
  "e.g. This is a TypeScript API on Postgres. Focus on missing auth checks, SQL built from strings, unhandled promise rejections, and migrations that lock large tables. Ignore formatting and naming.";

function lines(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((row) => row.trim())
    .filter(Boolean);
}

/** API providers plus local CLI agents; Cursor Cloud can't answer a single prompt. */
function promptProviders(providers: AiProvider[]): AiProvider[] {
  return providers.filter((row) => supportsPromptCompletion(row));
}

/** Add or remove a `/name` skill reference in a reviewer prompt. */
export function toggleSkillRef(prompt: string, name: string, on: boolean): string {
  const ref = `(?<=^|[\\s([{"'\`])\\/${name}(?=$|[\\s)\\]}.,;:!?"'\`])`;
  if (on) {
    if (new RegExp(ref, "i").test(prompt)) return prompt;
    const base = prompt.trimEnd();
    return base ? `${base} /${name}` : `/${name}`;
  }
  // Take the spaces in front of each reference with it, so "and /x, then" reads "and, then".
  return prompt.replace(new RegExp(`[ \\t]*${ref}`, "gi"), "").trim();
}

/**
 * What the server will use when this reviewer runs. Settings sees masked API keys, so a masked
 * key counts as present here; the server makes the final call with the real key.
 */
export function previewReviewerModel(
  reviewer: Pick<SlackReviewer, "providerId" | "model">,
  providers: AiProvider[],
  slack: IntegrationAccount | undefined,
):
  | { provider: AiProvider; model: string; source: "reviewer" | "slack" | "first"; cli: boolean }
  | undefined {
  const usable = (row: AiProvider) =>
    row.enabled &&
    supportsPromptCompletion(row) &&
    (hasUsableKey(row.apiKey, row.baseUrl, row.kind) || Boolean(row.apiKey?.includes("•")));
  const pick = (
    id: string | undefined,
    model: string | undefined,
    source: "reviewer" | "slack",
  ) => {
    const provider = id ? providers.find((row) => row.id === id) : undefined;
    if (!provider || !usable(provider)) return undefined;
    const cli = isPromptCliProvider(provider);
    const resolved = model || provider.defaultModel || provider.models[0] || "";
    if (!resolved && !cli) return undefined;
    return { provider, model: resolved || `${provider.name} default`, source, cli };
  };
  // Same rule as the server: a CLI agent is never the silent fallback.
  const first = providers.find((row) => usable(row) && !isPromptCliProvider(row));
  const firstModel = reviewer.model || first?.defaultModel || first?.models[0];
  return (
    pick(reviewer.providerId, reviewer.model, "reviewer") ??
    pick(slack?.defaultProviderId, reviewer.model || slack?.defaultModel, "slack") ??
    (first && firstModel
      ? { provider: first, model: firstModel, source: "first" as const, cli: false }
      : undefined)
  );
}

const REVIEW_VIEWS = [
  ["activity", "Activity"],
  ["reviewers", "Reviewers"],
  ["diagnostics", "Diagnostics"],
] as const;

export function SlackReviewerSettings(props: {
  reviewers: SlackReviewer[];
  providers: AiProvider[];
  integrations: IntegrationAccount[];
  /** Settings → Skills; a reviewer prompt names the ones it uses as /name. */
  skills: AgentSkill[];
  expanded: string | null;
  onToggleExpand: (id: string) => void;
  onAdd: () => void;
  onPatch: (index: number, patch: Patch) => void;
  onRemove: (index: number) => void;
  /** Flush the Settings draft so a manual run uses what is on screen. */
  onPersist: () => Promise<boolean>;
  onOpenIntegrations: () => void;
  reviewChats?: AgentSession[];
  onOpenReviewChat?: (id: string) => void;
  /** Open a review's Slack thread in the Slack pane. */
  onOpenChat?: (channelId: string, threadTs: string) => void;
  /** Settings → Git accounts, to tell which repos can take a REVIEW.md proposal. */
  forges?: GitForgeAccount[];
  /** How often every reviewer polls (fixed, adaptive, smart). */
  polling?: SlackReviewerPolling;
  onPollingChange?: (next: SlackReviewerPolling) => void;
}) {
  const [view, setView] = useState<(typeof REVIEW_VIEWS)[number][0]>("activity");
  const slackAccount = props.integrations.find((row) => row.kind === "slack");
  const [status, setStatus] = useState<SlackStatus | null>(null);
  const [channels, setChannels] = useState<SlackConversation[]>([]);
  const [members, setMembers] = useState<{
    rows: SlackMember[];
    loading: boolean;
    error: string | null;
  }>({ rows: [], loading: false, error: null });
  const [runs, setRuns] = useState<SlackReviewRun[]>([]);
  const [feedback, setFeedback] = useState<Record<string, SlackReviewerFeedback>>({});
  const [stats, setStats] = useState<Record<string, SlackReviewerStats>>({});
  const [active, setActive] = useState<SlackReviewActive[]>([]);
  const [threads, setThreads] = useState<SlackReviewThread[]>([]);
  const [pollStatus, setPollStatus] = useState<Record<string, SlackReviewerPollStatus>>({});
  const [runsError, setRunsError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const result = await api.slackReviewerRuns();
      setRuns(result.runs);
      setFeedback(result.feedback ?? {});
      setStats(result.stats ?? {});
      setActive(result.active ?? []);
      setThreads(result.threads ?? []);
      setPollStatus(result.polling ?? {});
      setRunsError(null);
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : "Could not load recent reviews");
    }
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const next = await api.slackStatus();
        if (!live) return;
        setStatus(next);
        if (next.connected) {
          setMembers((m) => ({ ...m, loading: true }));
          void api.slackUsers().then(
            (rows) => live && setMembers({ rows, loading: false, error: null }),
            (err: unknown) =>
              live &&
              setMembers({
                rows: [],
                loading: false,
                error: err instanceof Error ? err.message : "Could not load Slack members",
              }),
          );
          const rows = await api.slackConversations();
          if (live)
            setChannels(rows.filter((row) => row.kind === "channel" || row.kind === "private"));
        }
      } catch {
        if (live) setStatus({ connected: false, socket: "down" });
      }
    })();
    void loadRuns();
    return () => {
      live = false;
    };
  }, [loadRuns]);

  // Keep the lists current like Home does: fast while something is queued or running, so it
  // moves to Recent reviews when it ends, and slowly otherwise to pick up new reviews.
  const busy = active.length > 0;
  useEffect(() => {
    const timer = window.setInterval(
      () => void loadRuns(),
      busy ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS,
    );
    return () => window.clearInterval(timer);
  }, [busy, loadRuns]);

  const reviewerName = (id: string) => props.reviewers.find((row) => row.id === id)?.name;
  const showSlackActivity = Boolean(
    props.reviewers.length || runs.length || active.length || threads.length,
  );

  return (
    <div className="slack-reviewers review-workspace-content" data-testid="slack-reviewers">
      <nav className="review-workspace-nav" aria-label="Reviews">
        {REVIEW_VIEWS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="review-view-button"
            aria-current={id === view ? "page" : undefined}
            aria-controls={`review-view-${id}`}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <section
        className="settings-body"
        id="review-view-reviewers"
        hidden={view !== "reviewers"}
        aria-label="Slack reviewers"
      >
        <header className="review-panel-head">
          <div>
            <h3>Slack reviewers</h3>
            <p className="hint">
              Watch a Slack channel for pull requests and review them automatically.
            </p>
          </div>
          <button
            type="button"
            className="btn primary small"
            data-testid="slack-reviewer-add"
            onClick={props.onAdd}
          >
            Add reviewer
          </button>
        </header>
        <HowItWorks testId="slack-reviewers-how" summary="How Slack reviews work">
          <p>
            A reviewer polls its channel every 20 seconds by default (see Polling in Diagnostics:
            fixed, adaptive, or smart). Top-level posts with a GitHub, GitLab, or Bitbucket PR link
            start a review. Thread replies and bot posts are ignored. On first start it skips the
            channel&apos;s backlog.
          </p>
          <p>
            Lockfiles, generated files, and binaries are dropped. Unchanged lines are trimmed, and
            the diff is capped by the token budget below. By default the PR is cloned so the model
            can check callers and tests, and it also sees CI status, the issues the PR closes, and
            the repo&apos;s own AGENTS.md / CONTRIBUTING.md. A PR is reviewed once per commit:
            posting it again without new commits gets &quot;already reviewed&quot;. Spend counts
            toward your daily budget caps.
          </p>
          <p>
            In the review thread people can say &quot;re-review&quot;, &quot;won&apos;t fix
            #2&quot;, or @-mention the reviewer with a question. 👍 / 👎 on the final message count
            towards the reviewer&apos;s accuracy stats.
          </p>
          <p>
            Unlike Ask Locus, a reviewer posts status lines without Approve / Deny, and only in the
            thread of the post that asked. PR descriptions and diffs are treated as untrusted data.
          </p>
        </HowItWorks>

        {status && !status.connected ? (
          <div className="slack-reviewer-callout" data-testid="slack-reviewers-signin">
            <p>
              Sign in with Slack first. Reviewers read the channel and reply as you or the Locus
              bot.
            </p>
            <button type="button" className="btn small" onClick={props.onOpenIntegrations}>
              Open Integrations
            </button>
          </div>
        ) : null}

        {props.reviewers.length === 0 ? (
          <EmptyHint
            title="No reviewers yet."
            lead="Add one, pick a channel, and write what it should look for."
            testId="slack-reviewers-empty"
          />
        ) : (
          props.reviewers.map((reviewer, i) => (
            <SlackReviewerCard
              key={reviewer.id}
              reviewer={reviewer}
              providers={props.providers}
              skills={props.skills}
              slackAccount={slackAccount}
              canPostAsBot={status?.canPostAsBot}
              me={
                status?.connected
                  ? { name: status.userName, avatarUrl: status.avatarUrl }
                  : undefined
              }
              channels={channels}
              members={members}
              feedback={feedback[reviewer.id]}
              stats={stats[reviewer.id]}
              expanded={props.expanded === reviewer.id}
              onToggleExpand={() => props.onToggleExpand(reviewer.id)}
              onPatch={(patch) => props.onPatch(i, patch)}
              onRemove={() => props.onRemove(i)}
              onPersist={props.onPersist}
              onRunCheck={loadRuns}
              onRan={(run) => setRuns((rows) => [run, ...rows].slice(0, 50))}
              forges={props.forges}
            />
          ))
        )}
      </section>

      <section
        className="settings-body review-activity"
        id="review-view-activity"
        hidden={view !== "activity"}
        aria-label="Review activity"
      >
        {showSlackActivity || runsError ? (
          <>
            <div className="slack-reviewer-runs-head">
              <h3>Slack reviews in progress</h3>
              <button type="button" className="btn small ghost" onClick={() => void loadRuns()}>
                Refresh
              </button>
            </div>
            {runsError ? <InlineError message={runsError} onRetry={() => void loadRuns()} /> : null}
            {active.length === 0 ? (
              <p className="hint" data-testid="slack-reviewer-active-empty">
                Nothing queued or running.
              </p>
            ) : (
              <ul className="slack-reviewer-runs" data-testid="slack-reviewer-active">
                {active.map((row) => (
                  <li
                    key={`${row.reviewerId}-${row.kind}-${row.pr}-${row.since}`}
                    className={`slack-reviewer-run ${row.status}`}
                  >
                    <span className={`slack-reviewer-outcome ${row.status}`}>
                      {row.status === "running"
                        ? row.kind === "answer"
                          ? "Answering"
                          : "Reviewing"
                        : "Queued"}
                    </span>
                    <PrLink url={row.url} pr={row.pr} />
                    <MetaLine
                      parts={[
                        reviewerName(row.reviewerId),
                        row.dryRun ? "dry run" : undefined,
                        <Ago key="at" iso={row.since} prefix="started " />,
                      ]}
                    />
                    <OpenChatButton
                      channelId={row.channelId}
                      threadTs={row.threadTs}
                      onOpenChat={props.onOpenChat}
                    />
                    <SlackReviewTraceToggle traceId={row.traceId} />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
        {props.reviewChats?.length ? (
          <>
            <div className="slack-reviewer-runs-head">
              <h3>Agent review chats</h3>
            </div>
            <ul className="slack-reviewer-runs">
              {props.reviewChats.map((chat) => (
                <li className="slack-reviewer-run" key={chat.id}>
                  <span className="slack-reviewer-outcome">
                    {sessionHasNeedsYou(chat)
                      ? "Needs you"
                      : isActiveSession(chat)
                        ? "Running"
                        : chat.status === "error"
                          ? "Failed"
                          : "Open"}
                  </span>
                  <button
                    type="button"
                    className="btn small ghost review-chat-title"
                    onClick={() => props.onOpenReviewChat?.(chat.id)}
                  >
                    {chat.title}
                  </button>
                  <Ago iso={chat.updatedAt} />
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {showSlackActivity ? (
          <>
            <div className="slack-reviewer-runs-head">
              <h3>Recent Slack reviews</h3>
            </div>
            {runs.length === 0 && !runsError ? (
              <p className="hint" data-testid="slack-reviewer-runs-empty">
                No reviews yet.
              </p>
            ) : (
              <ul className="slack-reviewer-runs" data-testid="slack-reviewer-runs">
                {runs.map((run) => (
                  <SlackReviewRunRow
                    key={`${run.reviewerId}-${run.pr}-${run.at}`}
                    run={run}
                    reviewerName={reviewerName(run.reviewerId)}
                    onOpenChat={props.onOpenChat}
                  />
                ))}
              </ul>
            )}
          </>
        ) : null}
        {threads.length ? (
          <details className="review-thread-disclosure">
            <summary>Watched Slack threads ({threads.length})</summary>
            <ul className="slack-reviewer-runs" data-testid="slack-reviewer-threads">
              {threads.map((row) => (
                <li
                  key={`${row.reviewerId}-${row.channelId}-${row.threadTs}`}
                  className="slack-reviewer-run"
                >
                  <PrLink url={row.url} pr={row.pr} />
                  <MetaLine
                    parts={[
                      reviewerName(row.reviewerId),
                      row.answers
                        ? `${row.answers} question${row.answers === 1 ? "" : "s"} answered`
                        : undefined,
                      <Ago key="at" iso={row.at} prefix="last review " />,
                    ]}
                  />
                  <OpenChatButton
                    channelId={row.channelId}
                    threadTs={row.threadTs}
                    onOpenChat={props.onOpenChat}
                  />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {!showSlackActivity && !runsError ? (
          <div className="review-activity-empty">
            <p className="hint">
              {props.reviewChats?.length
                ? "Add a Slack reviewer to review pull requests posted in a channel."
                : "Review chats opened from Codebase and reviews started in Slack appear here."}
            </p>
            <button type="button" className="btn small" onClick={() => setView("reviewers")}>
              Set up a Slack reviewer
            </button>
          </div>
        ) : null}
      </section>

      <section
        className="settings-body"
        id="review-view-diagnostics"
        hidden={view !== "diagnostics"}
        aria-label="Review diagnostics"
      >
        {props.onPollingChange ? (
          <SlackReviewerPollingSettings
            polling={props.polling}
            status={pollStatus}
            reviewers={props.reviewers}
            onChange={props.onPollingChange}
          />
        ) : null}
        {view === "diagnostics" ? <SlackReviewerLiveLogs reviewerName={reviewerName} /> : null}
      </section>
    </div>
  );
}

/** A PR link styled with the theme, not the browser's default blue. */
function PrLink(props: { url: string; pr: string }) {
  return (
    <a className="slack-reviewer-pr-link" href={props.url} target="_blank" rel="noreferrer">
      {props.pr}
    </a>
  );
}

/** "4m ago" with the full local date and time as a tooltip. */
function Ago(props: { iso: string; prefix?: string }) {
  const t = Date.parse(props.iso);
  return (
    <time
      dateTime={props.iso}
      title={Number.isNaN(t) ? undefined : new Date(t).toLocaleString()}
      data-testid="slack-reviewer-ago"
    >
      {props.prefix}
      {formatAgo(props.iso)}
    </time>
  );
}

/** Muted "a · b · c" line; empty parts are dropped. */
function MetaLine(props: { parts: ReactNode[]; className?: string }) {
  const parts = props.parts.filter((part) => part !== undefined && part !== null && part !== "");
  if (!parts.length) return null;
  return (
    <span className={`meta${props.className ? ` ${props.className}` : ""}`}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i ? " · " : null}
          {part}
        </Fragment>
      ))}
    </span>
  );
}

/** Opens a review's Slack thread in the Slack pane. Hidden for runs with no thread (dry runs). */
function OpenChatButton(props: {
  channelId?: string;
  threadTs?: string;
  onOpenChat?: (channelId: string, threadTs: string) => void;
}) {
  const { channelId, threadTs, onOpenChat } = props;
  if (!channelId || !threadTs || !onOpenChat) return null;
  return (
    <button
      type="button"
      className="btn small ghost slack-reviewer-open-chat"
      data-testid="slack-reviewer-open-chat"
      onClick={() => onOpenChat(channelId, threadTs)}
    >
      Open chat
    </button>
  );
}

function SlackReviewRunRow(props: {
  run: SlackReviewRun;
  reviewerName?: string;
  onOpenChat?: (channelId: string, threadTs: string) => void;
}) {
  const { run } = props;
  const approx = run.usage?.estimated ? "~" : "";
  const tokens = run.usage
    ? `${approx}${run.usage.inputTokens.toLocaleString("en-US")} in${run.usage.cachedInputTokens ? ` (${run.usage.cachedInputTokens.toLocaleString("en-US")} cached)` : ""} / ${approx}${run.usage.outputTokens.toLocaleString("en-US")} out${run.usage.estimated ? " (estimated)" : ""}`
    : undefined;
  const cost =
    run.usd !== undefined
      ? `~$${run.usd < 0.01 ? run.usd.toFixed(4) : run.usd.toFixed(2)}`
      : undefined;
  return (
    <li className={`slack-reviewer-run slack-reviewer-run-rich ${run.outcome}`}>
      <div className="slack-reviewer-run-main">
        <div className="slack-reviewer-run-primary">
          <span className={`slack-reviewer-outcome ${run.outcome}`}>
            {OUTCOME_LABELS[run.outcome]}
          </span>
          <PrLink url={run.url} pr={run.pr} />
          <MetaLine
            className="slack-reviewer-run-result"
            parts={[
              props.reviewerName,
              run.comments !== undefined
                ? `${run.comments} comment${run.comments === 1 ? "" : "s"}`
                : undefined,
              run.votes && (run.votes.up || run.votes.down)
                ? `👍 ${run.votes.up} · 👎 ${run.votes.down}`
                : undefined,
              run.dryRun ? "dry run" : undefined,
              run.reason,
            ]}
          />
        </div>
        <MetaLine
          className="slack-reviewer-run-secondary"
          parts={[run.model, tokens, cost, <Ago key="at" iso={run.at} />]}
        />
      </div>
      <OpenChatButton
        channelId={run.channelId}
        threadTs={run.threadTs}
        onOpenChat={props.onOpenChat}
      />
      <SlackReviewTraceToggle traceId={run.traceId} />
    </li>
  );
}

function NumberField(props: {
  label: string;
  field: SlackReviewerNumberField;
  value: number;
  hint?: ReactNode;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  const [min, max] = SLACK_REVIEWER_LIMITS[props.field];
  const commit = () => {
    const next = clampSlackReviewerNumber(props.field, text);
    setText(String(next));
    if (next !== props.value) props.onCommit(next);
  };
  return (
    <div className="field">
      <label htmlFor={`reviewer-${props.field}`}>{props.label}</label>
      <input
        id={`reviewer-${props.field}`}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={text}
        disabled={props.disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      {props.hint ? <span className="hint">{props.hint}</span> : null}
    </div>
  );
}

function ListField(props: {
  label: string;
  value: string[];
  placeholder: string;
  hint?: ReactNode;
  testId?: string;
  onCommit: (value: string[]) => void;
}) {
  const [text, setText] = useState(props.value.join("\n"));
  useEffect(() => setText(props.value.join("\n")), [props.value]);
  return (
    <div className="field">
      <label>{props.label}</label>
      <textarea
        rows={3}
        spellCheck={false}
        value={text}
        placeholder={props.placeholder}
        data-testid={props.testId}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const next = lines(text);
          if (next.join("\n") !== props.value.join("\n")) props.onCommit(next);
        }}
      />
      {props.hint ? <span className="hint">{props.hint}</span> : null}
    </div>
  );
}

/**
 * `pathPrompts`: one glob + instructions per row, add / remove. Rows missing a glob or text stay on
 * screen while being typed but are not saved until both are filled.
 */
function PathPromptsField(props: {
  reviewerId: string;
  value: SlackReviewerPathPrompt[];
  onCommit: (value: SlackReviewerPathPrompt[]) => void;
}) {
  const [rows, setRows] = useState<SlackReviewerPathPrompt[]>(props.value);
  const saved = JSON.stringify(props.value);
  useEffect(() => {
    // Saved elsewhere (another tab, a reload): show it, unless it is what these rows already save.
    setRows((current) =>
      JSON.stringify(parseSlackPathPrompts(current)) === saved ? current : props.value,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);
  const commit = (next: SlackReviewerPathPrompt[]) => {
    const parsed = parseSlackPathPrompts(next);
    if (JSON.stringify(parsed) !== saved) props.onCommit(parsed);
  };
  const update = (index: number, patch: Partial<SlackReviewerPathPrompt>) =>
    setRows((list) => list.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const tokens = estimateTokens(
    parseSlackPathPrompts(rows)
      .map((row) => row.prompt)
      .join("\n\n"),
  );
  return (
    <div className="field" data-testid={`slack-reviewer-path-prompts-${props.reviewerId}`}>
      <label>Instructions per path</label>
      {rows.map((row, index) => (
        <div key={index} className="slack-reviewer-path-prompt">
          <input
            type="text"
            spellCheck={false}
            aria-label={`Path glob ${index + 1}`}
            placeholder="migrations/**"
            value={row.glob}
            data-testid={`slack-reviewer-path-glob-${index}`}
            onChange={(e) => update(index, { glob: e.target.value })}
            onBlur={() => commit(rows)}
          />
          <textarea
            rows={2}
            aria-label={`Instructions for path ${index + 1}`}
            placeholder="Check every migration can run on a live table without a long lock, and has a down step."
            maxLength={SLACK_REVIEWER_PATH_PROMPT_MAX}
            value={row.prompt}
            data-testid={`slack-reviewer-path-prompt-${index}`}
            onChange={(e) => update(index, { prompt: e.target.value })}
            onBlur={() => commit(rows)}
          />
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              const next = rows.filter((_, i) => i !== index);
              setRows(next);
              commit(next);
            }}
          >
            Remove
          </button>
        </div>
      ))}
      {rows.length < SLACK_REVIEWER_PATH_PROMPTS_MAX ? (
        <button
          type="button"
          className="btn small ghost"
          data-testid={`slack-reviewer-path-prompt-add-${props.reviewerId}`}
          onClick={() => setRows((list) => [...list, { glob: "", prompt: "" }])}
        >
          Add path instructions
        </button>
      ) : null}
      <span className="hint">
        When the PR changes a file matching the glob (same syntax as the ignore list), the text is
        sent with that review as extra instructions for those files. It goes in the review message,
        not the system prompt, so the cached prefix is unchanged
        {tokens ? `; ~${tokens.toLocaleString("en-US")} tokens when every row matches` : ""}. /name
        skills in it are sent too.
      </span>
    </div>
  );
}

/** One emoji name (`robot_face`) or a comma separated list, committed on blur. */
function EmojiField(props: {
  label: string;
  value: string | string[];
  placeholder?: string;
  hint?: ReactNode;
  testId?: string;
  onCommit: (value: string | string[]) => void;
}) {
  const many = Array.isArray(props.value);
  const shown = many ? (props.value as string[]).join(", ") : (props.value as string);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const next = many ? parseSlackReactionNames(text) : slackReactionNameOrEmpty(text);
    const nextText = Array.isArray(next) ? next.join(", ") : next;
    setText(nextText);
    if (nextText !== shown) props.onCommit(next);
  };
  return (
    <div className="field">
      <label>{props.label}</label>
      <input
        type="text"
        spellCheck={false}
        value={text}
        placeholder={props.placeholder ?? "none"}
        aria-label={props.label}
        data-testid={props.testId}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      {props.hint ? <span className="hint">{props.hint}</span> : null}
    </div>
  );
}

/** Which emoji mean what on the PR post: a preset, then every name editable. */
function ReactionProtocolFields(props: {
  reviewerId: string;
  map: SlackReviewReactionMap;
  forgeMode: SlackReviewerForgeMode;
  onChange: (map: SlackReviewReactionMap) => void;
}) {
  const { map } = props;
  const preset = slackReviewReactionPresetOf(map);
  const set = (patch: Partial<SlackReviewReactionMap>) => props.onChange({ ...map, ...patch });
  const id = props.reviewerId;
  return (
    <div className="slack-reviewer-reactions" data-testid={`slack-reviewer-reactions-${id}`}>
      <div className="field">
        <label>Reaction legend</label>
        <div className="slack-reviewer-preview-chips" role="group" aria-label="Reaction legend">
          {SLACK_REVIEW_REACTION_PRESET_IDS.map((row) => (
            <button
              key={row}
              type="button"
              className={`btn small ghost${row === preset ? " on" : ""}`}
              aria-pressed={row === preset}
              data-testid={`slack-reviewer-reactions-preset-${row}-${id}`}
              onClick={() => props.onChange({ ...SLACK_REVIEW_REACTION_PRESETS[row].map })}
            >
              {SLACK_REVIEW_REACTION_PRESETS[row].label}
            </button>
          ))}
          {preset ? null : <span className="hint">Custom</span>}
        </div>
        <span className="hint">
          {preset
            ? SLACK_REVIEW_REACTION_PRESETS[preset].hint
            : "Edited from a preset. Pick one to start over."}{" "}
          Emoji names without colons; custom workspace emoji work if they exist there.
        </span>
      </div>
      <div className="grid-2">
        <EmojiField
          label="Picked up (kept)"
          value={map.pickup}
          placeholder="robot_face"
          testId={`slack-reviewer-reactions-pickup-${id}`}
          onCommit={(pickup) => set({ pickup: pickup as string })}
        />
        <EmojiField
          label="While reviewing (removed after)"
          value={map.working}
          placeholder="eyes"
          testId={`slack-reviewer-reactions-working-${id}`}
          onCommit={(working) => set({ working: working as string })}
        />
        <EmojiField
          label="Left comments, by round"
          value={map.commented}
          placeholder="speech_balloon, speech_balloon_plus1"
          hint="First review, then each re-review that still has comments. The last one repeats."
          testId={`slack-reviewer-reactions-commented-${id}`}
          onCommit={(commented) => set({ commented: commented as string[] })}
        />
        {props.forgeMode === "verdict" ? (
          <EmojiField
            label="Requested changes, by round"
            value={map.changesRequested}
            placeholder="speech_balloon"
            testId={`slack-reviewer-reactions-changes-${id}`}
            onCommit={(changesRequested) => set({ changesRequested: changesRequested as string[] })}
          />
        ) : null}
        {props.forgeMode === "verdict" ? (
          <EmojiField
            label="Approved"
            value={map.approved}
            hint="Leave empty when the tick should come from a human."
            testId={`slack-reviewer-reactions-approved-${id}`}
            onCommit={(approved) => set({ approved: approved as string })}
          />
        ) : null}
        <EmojiField
          label="No issues"
          value={map.clean}
          testId={`slack-reviewer-reactions-clean-${id}`}
          onCommit={(clean) => set({ clean: clean as string })}
        />
        <EmojiField
          label="Review failed"
          value={map.failed}
          testId={`slack-reviewer-reactions-failed-${id}`}
          onCommit={(failed) => set({ failed: failed as string })}
        />
        <EmojiField
          label="Merged or declined (stop)"
          value={map.stop}
          placeholder="mergedparrot, x"
          hint="Left by people. A post with one is not reviewed, and its thread stops being watched."
          testId={`slack-reviewer-reactions-stop-${id}`}
          onCommit={(stop) => set({ stop: stop as string[] })}
        />
      </div>
      <EmojiField
        label="Comments addressed"
        value={map.addressed}
        placeholder="lower_left_ballpoint_pen, lower_left_fountain_pen, ballpoint_pen_plus1"
        hint="Left by the author once they push fixes."
        testId={`slack-reviewer-reactions-addressed-${id}`}
        onCommit={(addressed) => set({ addressed: addressed as string[] })}
      />
      <SettingsToggleRow
        label="Re-review when comments are marked addressed"
        hint="A new pen on a post this reviewer commented on reviews the new commits in its thread, like replying “re-review”. Checked when the thread is polled (up to 10 minutes with Socket Mode on)."
        on={map.rereviewOnAddressed}
        testId={`slack-reviewer-reactions-rereview-${id}`}
        onChange={(rereviewOnAddressed) => set({ rereviewOnAddressed })}
      />
    </div>
  );
}

function SlackReviewerCard(props: {
  reviewer: SlackReviewer;
  providers: AiProvider[];
  skills: AgentSkill[];
  slackAccount?: IntegrationAccount;
  canPostAsBot?: boolean;
  me?: { name?: string; avatarUrl?: string };
  channels: SlackConversation[];
  members?: { rows: SlackMember[]; loading: boolean; error: string | null };
  feedback?: SlackReviewerFeedback;
  stats?: SlackReviewerStats;
  expanded: boolean;
  onToggleExpand: () => void;
  onPatch: (patch: Patch) => void;
  onRemove: () => void;
  onPersist: () => Promise<boolean>;
  onRunCheck: () => Promise<void>;
  onRan: (run: SlackReviewRun) => void;
  forges?: GitForgeAccount[];
}) {
  const { reviewer, onPatch } = props;
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  async function runNow() {
    setChecking(true);
    setCheckError(null);
    setChecked(false);
    try {
      if (!(await props.onPersist())) throw new Error("Save the reviewer settings before running");
      await api.slackReviewerRun(reviewer.id);
      setChecked(true);
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : "Could not run the reviewer");
    } finally {
      await props.onRunCheck();
      setChecking(false);
    }
  }

  const channel = props.channels.find((row) => row.id === reviewer.channelId);
  const channelLabel = reviewer.channelId
    ? channel
      ? `#${channel.name}`
      : reviewer.channelId
    : "No channel yet";
  const preview = previewReviewerModel(reviewer, props.providers, props.slackAccount);
  // Preview text only: with no usable key yet, show the model this reviewer would likely use.
  const sampleFallback = promptProviders(props.providers)[0];
  const sampleModel = {
    model: preview?.model ?? (reviewer.model || sampleFallback?.defaultModel || "model"),
    provider: preview?.provider.name ?? sampleFallback?.name ?? "provider",
  };
  const modelProviders = useMemo(() => promptProviders(props.providers), [props.providers]);
  const cliLimit = cliPromptCharLimit(
    typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent) ? "win32" : "posix",
  );
  const pinned = Boolean(reviewer.providerId);
  const forgeLabel = FORGE_MODE_OPTIONS.find((row) => row.value === reviewer.forgeMode)?.label;
  // Setup has to be complete before the reviewer can watch; until then the switch shows off and
  // the saved `enabled` value is left alone, so it starts as soon as the gap is filled.
  const missing = !reviewer.channelId ? "channel" : !preview ? "model" : undefined;
  const on = reviewer.enabled && !missing;
  const approxTokens = Math.round(reviewer.maxDiffChars / 4).toLocaleString("en-US");

  const channelOptions: SelectOption[] = [
    { value: "", label: "Choose a channel" },
    ...props.channels
      .map((row) => ({
        value: row.id,
        label: `${row.kind === "private" ? "🔒 " : "#"}${row.name}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    ...(reviewer.channelId && !channel
      ? [{ value: reviewer.channelId, label: reviewer.channelId }]
      : []),
  ];

  return (
    <div
      className={`provider-card slack-reviewer-card ${props.expanded ? "open" : ""} ${on ? "on" : ""}`}
      data-testid={`slack-reviewer-${reviewer.id}`}
    >
      <div className="provider-card-head">
        <button
          type="button"
          className="provider-card-summary"
          aria-expanded={props.expanded}
          onClick={props.onToggleExpand}
        >
          <span className={`provider-dot ${on ? "on" : ""}`} />
          <span className="provider-card-copy">
            <strong>{reviewer.name || "PR reviewer"}</strong>
            <span className="meta">
              {[
                channelLabel,
                preview ? preview.model : "No model",
                forgeLabel,
                reviewer.unlimitedTokens ? "No token limits" : undefined,
                props.feedback && (props.feedback.up || props.feedback.down)
                  ? `👍 ${props.feedback.up} · 👎 ${props.feedback.down}`
                  : undefined,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </button>
        <SettingsSwitch
          on={on}
          disabled={Boolean(missing)}
          label={`${reviewer.name || "PR reviewer"} enabled`}
          testId={`slack-reviewer-enabled-${reviewer.id}`}
          onChange={(enabled) => onPatch({ enabled })}
        />
        <span
          className={`provider-card-state slack-reviewer-state${missing ? " warn" : ""}`}
          data-testid={`slack-reviewer-state-${reviewer.id}`}
        >
          {missing === "channel"
            ? "Needs a channel"
            : missing === "model"
              ? "Needs a model"
              : reviewer.enabled
                ? "Watching"
                : "Off"}
        </span>
        <BusyButton
          className="btn small"
          busy={checking}
          busyLabel="Checking…"
          disabled={!on}
          title="Check this reviewer's configured sources now"
          data-testid={`slack-reviewer-run-now-${reviewer.id}`}
          onClick={() => void runNow()}
        >
          Run now
        </BusyButton>
        <button
          type="button"
          className="provider-card-chevron"
          aria-label={props.expanded ? `Collapse ${reviewer.name}` : `Expand ${reviewer.name}`}
          onClick={props.onToggleExpand}
        >
          <IconChevron expanded={props.expanded} />
        </button>
      </div>
      {checkError || checked ? (
        <div className="provider-card-body">
          {checkError ? (
            <InlineError message={checkError} />
          ) : (
            <p className="hint" role="status">
              Check complete. Any reviews will appear in Activity.
            </p>
          )}
        </div>
      ) : null}
      {props.expanded ? (
        <div className="provider-card-body">
          <div className="grid-2">
            <div className="field">
              <label htmlFor={`reviewer-name-${reviewer.id}`}>Name</label>
              <input
                id={`reviewer-name-${reviewer.id}`}
                value={reviewer.name}
                onChange={(e) => onPatch({ name: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Slack channel</label>
              {props.channels.length ? (
                <Select
                  ariaLabel="Slack channel"
                  testId={`slack-reviewer-channel-${reviewer.id}`}
                  value={reviewer.channelId}
                  options={channelOptions}
                  onChange={(channelId) => onPatch({ channelId })}
                />
              ) : (
                <input
                  value={reviewer.channelId}
                  placeholder="C0123456789"
                  spellCheck={false}
                  data-testid={`slack-reviewer-channel-${reviewer.id}`}
                  onChange={(e) => onPatch({ channelId: e.target.value.trim() })}
                />
              )}
              <span className="hint">
                Top-level posts only. If Slack has a channel allowlist, the channel must be on it.
              </span>
            </div>
          </div>

          <h4 className="slack-reviewer-section">Model</h4>
          <SettingsToggleRow
            label="Use a specific model"
            hint={
              pinned
                ? "This reviewer always uses the model below."
                : preview
                  ? `Uses ${preview.provider.name} · ${preview.model} (${preview.source === "slack" ? "Slack default" : "first enabled API provider"}).`
                  : "No enabled API provider with a key. Add one in Providers, or pick a CLI agent."
            }
            on={pinned}
            testId={`slack-reviewer-pin-model-${reviewer.id}`}
            onChange={(next) => {
              if (!next) {
                onPatch((row) => {
                  const { providerId: _p, model: _m, ...rest } = row;
                  return rest;
                });
                return;
              }
              const start =
                preview ??
                (modelProviders[0]
                  ? { provider: modelProviders[0], model: modelProviders[0].defaultModel }
                  : undefined);
              if (start) onPatch({ providerId: start.provider.id, model: start.model });
            }}
          />
          {pinned ? (
            <ModelPicker
              providers={modelProviders}
              providerId={reviewer.providerId ?? ""}
              model={reviewer.model ?? ""}
              showCosts={!preview?.cli}
              onChange={({ providerId, model }) => onPatch({ providerId, model })}
            />
          ) : null}
          {preview?.cli ? (
            <div
              className="slack-reviewer-callout slack-reviewer-cli-warning"
              role="note"
              data-testid={`slack-reviewer-cli-warning-${reviewer.id}`}
            >
              <p>
                <strong>{preview.provider.name} is a CLI agent with its own tools.</strong> It runs
                on this machine, once per review, in{" "}
                {reviewer.cloneRepo ? "a clone of the PR" : "an empty scratch folder"}, inside a
                sandbox: your home folder is hidden apart from the CLI&apos;s own login, so SSH
                keys, cloud credentials and other tokens there are out of reach, and so are Locus
                config and services on this machine&apos;s loopback. Without a sandbox (Linux needs
                bubblewrap and passt) the review fails instead. PR descriptions and diffs are
                written by PR authors, and the CLI still has internet access and can read the clone
                and files outside your home folder: a malicious PR could tell it to send what it
                reads elsewhere or put it in the review posted to the PR and Slack. Prefer CLI
                agents for repos where you trust everyone who can open a pull request.
              </p>
            </div>
          ) : (
            <p className="hint">
              API providers answer with no tools. You can also pick a CLI agent (Claude Code, Codex,
              Cursor CLI, Kiro, or a custom CLI). Cursor Cloud can&apos;t run reviews.
            </p>
          )}

          <h4 className="slack-reviewer-section">Review prompt</h4>
          <div className="field">
            <label htmlFor={`reviewer-prompt-${reviewer.id}`}>What should it look for?</label>
            <textarea
              id={`reviewer-prompt-${reviewer.id}`}
              rows={6}
              value={reviewer.prompt}
              maxLength={SLACK_REVIEWER_PROMPT_MAX}
              placeholder={SLACK_REVIEWER_PROMPT_PLACEHOLDER}
              data-testid={`slack-reviewer-prompt-${reviewer.id}`}
              onChange={(e) => onPatch({ prompt: e.target.value })}
            />
            <span className="hint">
              Added after a fixed output contract (JSON findings with severity and line). Keep it
              stable: the same prompt is cached across reviews.{" "}
              {reviewer.prompt.length.toLocaleString("en-US")} /{" "}
              {SLACK_REVIEWER_PROMPT_MAX.toLocaleString("en-US")}
            </span>
            {preview?.cli && reviewer.prompt.length > cliLimit / 2 ? (
              <p
                className="hint warn-text"
                data-testid={`slack-reviewer-prompt-cli-warning-${reviewer.id}`}
              >
                {preview.provider.name} gets the prompt on the command line, which allows about{" "}
                {cliLimit.toLocaleString("en-US")} characters here. This prompt uses over half of
                that, leaving little room for the diff, and very long prompts make reviews fail.
                Shorten it or use an API provider.
              </p>
            ) : null}
          </div>
          <ReviewerSkills
            reviewer={reviewer}
            skills={props.skills}
            onPrompt={(prompt) => onPatch({ prompt })}
          />

          <TestReview reviewer={reviewer} onPersist={props.onPersist} onRan={props.onRan} />
          <details className="slack-reviewer-details">
            <summary>Posting and severity</summary>
            <div className="grid-2">
              <div className="field">
                <label>Post thread replies as</label>
                <Select
                  ariaLabel="Post thread replies as"
                  testId={`slack-reviewer-post-as-${reviewer.id}`}
                  value={reviewer.postAs}
                  options={[
                    {
                      value: "bot",
                      label: "Locus bot",
                      hint:
                        props.canPostAsBot === false
                          ? "No bot token: reinstall the Slack app with bot chat:write"
                          : "Teammates see the Locus app",
                    },
                    { value: "user", label: "Me", hint: "Posts appear under your name" },
                  ]}
                  onChange={(postAs) => onPatch({ postAs })}
                />
              </div>
              <div className="field">
                <label>On the pull request</label>
                <Select
                  ariaLabel="On the pull request"
                  testId={`slack-reviewer-forge-mode-${reviewer.id}`}
                  value={reviewer.forgeMode}
                  options={FORGE_MODE_OPTIONS}
                  onChange={(forgeMode) => onPatch({ forgeMode })}
                />
              </div>
              <div className="field">
                <label>Report findings</label>
                <Select
                  ariaLabel="Report findings"
                  value={reviewer.minSeverity}
                  options={SEVERITY_OPTIONS}
                  onChange={(minSeverity) => onPatch({ minSeverity })}
                />
              </div>
              <NumberField
                label="Max comments per review"
                field="maxComments"
                value={reviewer.maxComments}
                onCommit={(maxComments) => onPatch({ maxComments })}
              />
            </div>
            {reviewer.forgeMode === "verdict" ? (
              <p className="hint warn-text">
                This reviewer can approve PRs. Keep branch protection that still needs a human
                approval.
              </p>
            ) : null}
            <SettingsToggleRow
              label="React on the original post"
              hint="Keeps the post's reaction stack in step with the review: picked up, comments, and per-round re-reviews. Uses your Slack account (reactions:write)."
              on={reviewer.reactions}
              onChange={(reactions) => onPatch({ reactions })}
            />
            {reviewer.reactions ? (
              <ReactionProtocolFields
                reviewerId={reviewer.id}
                map={reviewer.reactionMap}
                forgeMode={reviewer.forgeMode}
                onChange={(reactionMap) => onPatch({ reactionMap })}
              />
            ) : null}
          </details>
          <details className="slack-reviewer-details">
            <summary>Triggers and filters</summary>
            <ListField
              label="Repositories"
              value={reviewer.repos}
              placeholder={"acme/api\nacme/web-*"}
              hint="owner/repo, one per line, * as a wildcard. Empty reviews any repo a Git account can read. Links to other repos are ignored silently."
              testId={`slack-reviewer-repos-${reviewer.id}`}
              onCommit={(repos) => onPatch({ repos })}
            />
            <ListField
              label="Base branches"
              value={reviewer.baseBranches}
              placeholder={"main\nrelease/*"}
              hint="Review only PRs into these branches, one per line, * as a wildcard. Empty reviews PRs into any branch. Others are ignored silently."
              testId={`slack-reviewer-base-branches-${reviewer.id}`}
              onCommit={(baseBranches) => onPatch({ baseBranches })}
            />
            <ListField
              label="Skip PRs with these labels"
              value={reviewer.skipLabels}
              placeholder={"no-review\nskip-review"}
              hint="A PR carrying one of these labels (any case) gets a short Skipped reply and no review. [skip review] or [no review] in the PR title works too. Labels are read on GitHub, Gitea, Forgejo, GitLab and Azure DevOps; Bitbucket PRs have none."
              testId={`slack-reviewer-skip-labels-${reviewer.id}`}
              onCommit={(skipLabels) => onPatch({ skipLabels })}
            />
            <ListField
              label="Who can ask for a review"
              value={reviewer.allowedRequesters}
              placeholder={"U0123ABCD\nU0456EFGH"}
              hint="Slack member IDs, one per line. Empty: anyone in the channel. Posts, re-review and retry requests, and questions from anyone else are ignored silently. Anyone can still dismiss a finding."
              testId={`slack-reviewer-requesters-${reviewer.id}`}
              onCommit={(ids) => onPatch({ allowedRequesters: parseSlackRequesters(ids) })}
            />
            <SlackUserMultiSelect
              label="Don't review for these people"
              value={reviewer.excludedUsers}
              users={props.members?.rows ?? []}
              loading={props.members?.loading}
              error={props.members?.error}
              placeholder="Search Slack members…"
              hint="Their posts, @-mentions, and re-review, retry or question replies are ignored silently, even if they are listed above. With Review new PRs nobody posted on, PRs they author are skipped too, for authors mapped under PR authors in Slack (shown when Mention the PR author is on). Anyone can still dismiss a finding."
              testId={`slack-reviewer-excluded-${reviewer.id}`}
              onChange={(ids) => onPatch({ excludedUsers: parseSlackRequesters(ids) })}
            />
            <PathPromptsField
              reviewerId={reviewer.id}
              value={reviewer.pathPrompts}
              onCommit={(pathPrompts) => onPatch({ pathPrompts })}
            />
            <SettingsToggleRow
              label="Review new PRs nobody posted"
              hint="Every 5 minutes by default (Polling in Diagnostics), lists the open PRs of the repositories above and reviews each one opened or marked ready since the reviewer started watching (no backlog). It posts the PR to the channel first and replies in that post's thread. Exact owner/repo entries are polled; a * in the repo name is matched against the repos your Git account can list, and a * in the owner is never polled."
              on={reviewer.autoReview}
              testId={`slack-reviewer-auto-${reviewer.id}`}
              onChange={(autoReview) => onPatch({ autoReview })}
            />
            {reviewer.autoReview && !reviewer.repos.length ? (
              <p className="hint warn-text">
                Add at least one owner/repo above. With no repositories nothing is polled.
              </p>
            ) : null}
            <SettingsToggleRow
              label="Skip draft PRs"
              on={reviewer.skipDrafts}
              onChange={(skipDrafts) => onPatch({ skipDrafts })}
            />
            <SettingsToggleRow
              label="Review again after new commits"
              hint="Off: a PR is reviewed once, ever."
              on={reviewer.rereviewOnNewCommits}
              onChange={(rereviewOnNewCommits) => onPatch({ rereviewOnNewCommits })}
            />
          </details>
          <details className="slack-reviewer-details">
            <summary>Execution and verification</summary>
            <NumberField
              label="Reviews at once"
              field="maxConcurrentReviews"
              value={reviewer.maxConcurrentReviews}
              hint="How many PRs this reviewer reviews in parallel (1–4). Two reviews of the same PR never overlap. More at once means more spend at once."
              onCommit={(maxConcurrentReviews) => onPatch({ maxConcurrentReviews })}
            />
            <SettingsToggleRow
              label="Clone the repo and check around the diff"
              hint={
                preview?.cli
                  ? "The PR head is cloned (shallow, read-only) and the CLI agent runs inside it, so it can read callers, types and tests the diff doesn't show. Nothing from the PR is run."
                  : "The PR head is cloned (shallow, read-only) and the model gets read_file, grep, find_files and list_dir over it, so it can check callers, types and tests the diff doesn't show before it answers. Nothing from the PR is run. Costs more tokens than a diff-only review. Off: one completion over the diff."
              }
              on={reviewer.cloneRepo}
              testId={`slack-reviewer-clone-${reviewer.id}`}
              onChange={(cloneRepo) => onPatch({ cloneRepo })}
            />
            {reviewer.cloneRepo && !preview?.cli ? (
              <NumberField
                label="Lookup rounds"
                field="maxToolRounds"
                value={reviewer.maxToolRounds}
                hint="Rounds of reading and searching before the model must answer. Each round re-sends the conversation so far."
                onCommit={(maxToolRounds) => onPatch({ maxToolRounds })}
              />
            ) : null}
            <SlackReviewerVerifyFields
              reviewer={reviewer}
              providers={modelProviders}
              cli={preview?.cli}
              onPatch={onPatch}
            />
          </details>
          <details className="slack-reviewer-details">
            <summary>Review context</summary>
            <SettingsToggleRow
              label="Follow the repo's own guidelines"
              hint="Sends AGENTS.md, CLAUDE.md, REVIEW.md, CONTRIBUTING.md or .github/copilot-instructions.md from the base branch (up to 3 files, ~3,000 tokens), so the PR can't rewrite the rules it is held to."
              on={reviewer.repoGuidelines}
              testId={`slack-reviewer-guidelines-${reviewer.id}`}
              onChange={(repoGuidelines) => onPatch({ repoGuidelines })}
            />
            <SettingsToggleRow
              label="Read the issues the PR closes"
              hint={
                '"Fixes #123" in the PR description: the issue\'s title and description go with the review, so the model can check the change does what it asked. Same repo only, at most 2.'
              }
              on={reviewer.linkedIssues}
              testId={`slack-reviewer-issues-${reviewer.id}`}
              onChange={(linkedIssues) => onPatch({ linkedIssues })}
            />
            <SettingsToggleRow
              label="Tell the model about CI"
              hint="Which checks pass, fail or are still running at the head commit, so it doesn't repeat what CI already reports."
              on={reviewer.ciContext}
              testId={`slack-reviewer-ci-${reviewer.id}`}
              onChange={(ciContext) => onPatch({ ciContext })}
            />
            {reviewer.ciContext ? (
              <SettingsToggleRow
                label="Send failing CI logs"
                hint="When a check fails, the condensed log of up to 2 failing jobs (~1,250 tokens) goes with the review, so the model can point at the line that breaks it."
                on={reviewer.ciLogs}
                testId={`slack-reviewer-ci-logs-${reviewer.id}`}
                onChange={(ciLogs) => onPatch({ ciLogs })}
              />
            ) : null}
            <SettingsToggleRow
              label="Read the comments already on the PR"
              hint="People's and other bots' comments (the newest 20, ~1,500 tokens at most) go with the review, so it doesn't repeat a point someone already made."
              on={reviewer.prDiscussion}
              testId={`slack-reviewer-discussion-${reviewer.id}`}
              onChange={(prDiscussion) => onPatch({ prDiscussion })}
            />
            {reviewer.forgeMode === "verdict" ? (
              <SettingsToggleRow
                label="Don't approve while CI is failing"
                hint="A clean review with a failing check leaves a comment instead of an approval."
                on={reviewer.holdApprovalOnFailingCi}
                testId={`slack-reviewer-ci-hold-${reviewer.id}`}
                onChange={(holdApprovalOnFailingCi) => onPatch({ holdApprovalOnFailingCi })}
              />
            ) : null}
            <SettingsToggleRow
              label="Suggest fixes"
              hint="Small, certain fixes come as one-click suggestions on inline comments (GitHub and GitLab; other forges show a code block)."
              on={reviewer.suggestions}
              testId={`slack-reviewer-suggestions-${reviewer.id}`}
              onChange={(suggestions) => onPatch({ suggestions })}
            />
            <SettingsToggleRow
              label="Re-review only the new commits"
              hint="A follow-up review sends what changed since the last review plus the earlier findings, not the whole PR again. Falls back to the whole PR after a force-push, and on Gitea, Forgejo and Azure DevOps."
              on={reviewer.incrementalRereview}
              testId={`slack-reviewer-incremental-${reviewer.id}`}
              onChange={(incrementalRereview) => onPatch({ incrementalRereview })}
            />
            <SettingsToggleRow
              label="Resolve fixed findings on the PR"
              hint="When a follow-up review finds an earlier finding fixed, its comment thread on the PR is resolved (GitHub and GitLab)."
              on={reviewer.resolveFixedThreads}
              testId={`slack-reviewer-resolve-${reviewer.id}`}
              onChange={(resolveFixedThreads) => onPatch({ resolveFixedThreads })}
            />
          </details>
          <details className="slack-reviewer-details">
            <summary>In the thread</summary>
            <SettingsToggleRow
              label="Re-review when asked in the thread"
              hint={
                'A reply like "re-review", "review again" or "PTAL" in the review thread reviews again after new commits, and says which earlier findings were fixed. Checked about once a minute.'
              }
              on={reviewer.rereviewOnThreadReply}
              testId={`slack-reviewer-thread-rereview-${reviewer.id}`}
              onChange={(rereviewOnThreadReply) => onPatch({ rereviewOnThreadReply })}
            />
            {reviewer.rereviewOnThreadReply ? (
              <p className="hint">
                Reply <em>full re-review</em> to review the whole PR again, even on the same commit.
                A review that fails on a rate limit, overload or timeout is retried once. Reply{" "}
                <em>retry</em> to try again manually.
              </p>
            ) : null}
            <SettingsToggleRow
              label="Dismiss findings from the thread"
              hint={
                '"won\'t fix #2", "#1 is a false positive" or "dismiss all" in the thread: later reviews of the PR never raise those again. No model call.'
              }
              on={reviewer.dismissInThread}
              testId={`slack-reviewer-dismiss-${reviewer.id}`}
              onChange={(dismissInThread) => onPatch({ dismissInThread })}
            />
            <SettingsToggleRow
              label="Dismiss findings from the PR"
              hint={
                '"won\'t fix #2" in a PR comment, or "won\'t fix" / "false positive" in a reply to one of the reviewer\'s inline comments, dismisses that finding too. The Slack thread is told.'
              }
              on={reviewer.dismissOnPr}
              testId={`slack-reviewer-dismiss-pr-${reviewer.id}`}
              onChange={(dismissOnPr) => onPatch({ dismissOnPr })}
            />
            <SettingsToggleRow
              label="Review when asked on the PR"
              hint={
                'A PR comment starting "@locus review" or "@locus re-review" reviews the PR again in its review thread. On PRs with no thread it works only with "Review new PRs nobody posted" on, which posts the PR to the channel. Checked every 5–10 minutes; the reviewer\'s own and bots\' comments never count.'
              }
              on={reviewer.reviewOnPrComment}
              testId={`slack-reviewer-pr-command-${reviewer.id}`}
              onChange={(reviewOnPrComment) => onPatch({ reviewOnPrComment })}
            />
            <SettingsToggleRow
              label="Review when tagged in a thread"
              hint={
                '"@Locus review this" (or "@Locus" with a PR link) in a thread of this channel that the reviewer isn\'t watching reviews the PR there. The link comes from the reply, else the thread\'s first post, else the latest earlier reply with one. Needs the Slack app\'s message events (Socket Mode).'
              }
              on={reviewer.reviewOnMention}
              testId={`slack-reviewer-mention-${reviewer.id}`}
              onChange={(reviewOnMention) => onPatch({ reviewOnMention })}
            />
            <SettingsToggleRow
              label="Learn from dismissals"
              hint="Dismissed findings are remembered for the whole repo, and the most recent go with later reviews of any PR there as the team's conventions."
              on={reviewer.learnFromDismissals}
              testId={`slack-reviewer-learn-${reviewer.id}`}
              onChange={(learnFromDismissals) => onPatch({ learnFromDismissals })}
            />
            {reviewer.learnFromDismissals ? (
              <RepoNotes reviewerId={reviewer.id} forges={props.forges} />
            ) : null}
            <SettingsToggleRow
              label="Answer questions"
              hint={`@-mention ${reviewer.postAs === "user" ? "you" : "the Locus bot"} in the review thread to ask about the review. One small model call per question (at most ${10} per thread), counted in Recent reviews and your budget.`}
              on={reviewer.answerQuestions}
              testId={`slack-reviewer-questions-${reviewer.id}`}
              onChange={(answerQuestions) => onPatch({ answerQuestions })}
            />
            <SettingsToggleRow
              label="Mention the PR author"
              hint="Starts the final message with an @-mention of the author, for authors mapped below."
              on={reviewer.mentionAuthor}
              testId={`slack-reviewer-mention-${reviewer.id}`}
              onChange={(mentionAuthor) => onPatch({ mentionAuthor })}
            />
            {reviewer.mentionAuthor ? (
              <AuthorMapField
                value={reviewer.authorSlackIds}
                testId={`slack-reviewer-authors-${reviewer.id}`}
                onCommit={(authorSlackIds) => onPatch({ authorSlackIds })}
              />
            ) : null}
            <NumberField
              label="Threads to watch"
              field="maxWatchedThreads"
              value={reviewer.maxWatchedThreads}
              hint="Most recent review threads checked for re-review requests, dismissals, questions and 👍 / 👎. Each costs one Slack call per thread poll (every minute by default, see Polling), or one every 10 minutes while Socket Mode delivers message events."
              onCommit={(maxWatchedThreads) => onPatch({ maxWatchedThreads })}
            />
          </details>
          <details className="slack-reviewer-details">
            <summary>Token budget{reviewer.unlimitedTokens ? " · no limits" : ""}</summary>
            <SettingsToggleRow
              label="No token limits"
              hint="Send the whole diff and allow the longest reply. Lockfiles and generated files are still skipped."
              on={reviewer.unlimitedTokens}
              testId={`slack-reviewer-unlimited-${reviewer.id}`}
              onChange={(unlimitedTokens) => onPatch({ unlimitedTokens })}
            />
            {reviewer.unlimitedTokens ? (
              <p
                className="hint warn-text"
                data-testid={`slack-reviewer-unlimited-note-${reviewer.id}`}
              >
                Every changed file is sent in full, and replies can run to{" "}
                {SLACK_REVIEWER_LIMITS.maxOutputTokens[1].toLocaleString("en-US")} tokens. A large
                PR can cost many times a normal review, and a PR bigger than the model&apos;s
                context window fails instead of being reviewed in part. Daily budget caps still
                apply.
              </p>
            ) : (
              <p className="hint">
                One review sends about {approxTokens} tokens of diff at most, plus the prompt. Files
                over budget are listed by name and the model is told the review is partial.
              </p>
            )}
            {preview?.cli ? (
              <p className="hint" data-testid={`slack-reviewer-cli-budget-${reviewer.id}`}>
                {preview.provider.name} gets the prompt on the command line, so the diff is kept
                under about {cliLimit.toLocaleString("en-US")} characters even with no limits. Max
                output tokens doesn&apos;t apply to CLI agents. When a CLI reports no token counts
                (Kiro meters in credits), usage and cost are estimated from the prompt and reply and
                marked &quot;estimated&quot;; that misses files the CLI read on its own. The cost
                cap stops a CLI run only when the CLI reports usage while it runs; otherwise only
                the time limit bounds it, and the run is stopped rather than asked to answer early.
              </p>
            ) : null}
            <div className="grid-2">
              <NumberField
                label="Diff budget (characters)"
                field="maxDiffChars"
                value={reviewer.maxDiffChars}
                disabled={reviewer.unlimitedTokens}
                hint={reviewer.unlimitedTokens ? "No limit" : `≈ ${approxTokens} tokens`}
                onCommit={(maxDiffChars) => onPatch({ maxDiffChars })}
              />
              <NumberField
                label="Per-file budget (characters)"
                field="maxFileChars"
                value={reviewer.maxFileChars}
                disabled={reviewer.unlimitedTokens}
                hint={reviewer.unlimitedTokens ? "No limit" : undefined}
                onCommit={(maxFileChars) => onPatch({ maxFileChars })}
              />
              <NumberField
                label="Context lines around changes"
                field="contextLines"
                value={reviewer.contextLines}
                onCommit={(contextLines) => onPatch({ contextLines })}
              />
              <NumberField
                label="Max output tokens"
                field="maxOutputTokens"
                value={reviewer.maxOutputTokens}
                disabled={reviewer.unlimitedTokens}
                hint={
                  reviewer.unlimitedTokens
                    ? `${SLACK_REVIEWER_LIMITS.maxOutputTokens[1].toLocaleString("en-US")} (maximum)`
                    : undefined
                }
                onCommit={(maxOutputTokens) => onPatch({ maxOutputTokens })}
              />
            </div>
            <CostField
              value={reviewer.maxCostUsd}
              testId={`slack-reviewer-cost-${reviewer.id}`}
              onCommit={(maxCostUsd) => onPatch({ maxCostUsd })}
            />
            {!reviewer.unlimitedTokens || preview?.cli ? (
              <SettingsToggleRow
                label="Review large PRs in parts"
                hint={
                  reviewer.unlimitedTokens
                    ? `${preview?.provider.name ?? "This CLI agent"} still gets the prompt on the command line, so a large PR doesn't fit in one call even with No token limits. With this on it is reviewed in up to 12 parts, one model call each, and the findings merged, instead of listing the rest by name. Each part's result is posted in the thread as it finishes. Files in the same folder, and their tests, stay in the same part. Costs about one normal review per part; the cost cap covers them all.`
                    : "A PR over the diff budget is reviewed in up to 12 parts, one model call each, and the findings merged, instead of listing the rest by name. Each part's result is posted in the thread as it finishes. Files in the same folder, and their tests, stay in the same part. Costs about one normal review per part; the cost cap covers them all."
                }
                on={reviewer.splitLargePrs}
                testId={`slack-reviewer-split-${reviewer.id}`}
                onChange={(splitLargePrs) => onPatch({ splitLargePrs })}
              />
            ) : null}
            <ListField
              label="Also ignore these paths"
              value={reviewer.ignorePaths}
              placeholder={"**/testdata/**\ndocs/**"}
              hint={`Globs, one per line. Always ignored: ${DEFAULT_REVIEW_IGNORE_GLOBS.slice(0, 12).join(", ")}, and ${DEFAULT_REVIEW_IGNORE_GLOBS.length - 12} more (build output, vendored code, media).`}
              onCommit={(ignorePaths) => onPatch({ ignorePaths })}
            />
          </details>

          <details className="slack-reviewer-details">
            <summary>Slack preview</summary>
            <SlackReviewerPreview reviewer={reviewer} model={sampleModel} me={props.me} />
          </details>

          <details className="slack-reviewer-details">
            <summary>Status messages</summary>
            <p className="hint">
              Placeholders: {STATUS_PLACEHOLDERS}. Slack formatting works: *bold*, _italic_, `code`,
              :emoji:.
            </p>
            {(Object.keys(STATUS_LABELS) as Array<keyof SlackReviewerStatusTemplates>).map(
              (key) => (
                <StatusTemplateField
                  key={key}
                  name={key}
                  value={reviewer.status[key]}
                  model={sampleModel}
                  cloneRepo={reviewer.cloneRepo}
                  onChange={(value) =>
                    onPatch((row) => ({ ...row, status: { ...row.status, [key]: value } }))
                  }
                />
              ),
            )}
          </details>

          <SlackReviewerAccuracy reviewerId={reviewer.id} stats={props.stats} />

          <div className="slack-reviewer-actions">
            <button type="button" className="btn small danger" onClick={props.onRemove}>
              Remove reviewer
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const NOTE_REASON: Record<SlackRepoNote["reason"], string> = {
  "false-positive": "false positive",
  "by-design": "by design",
  "wont-fix": "won't fix",
};

/** Dismissed findings this reviewer remembers per repo, each with Forget. */
function RepoNotes(props: { reviewerId: string; forges?: GitForgeAccount[] }) {
  const [notes, setNotes] = useState<Record<string, SlackRepoNote[]> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposed, setProposed] = useState<Record<string, { url: string; number: number }>>({});
  const [proposing, setProposing] = useState<string | null>(null);
  const propose = async (repo: string) => {
    setProposing(repo);
    try {
      const pr = await api.slackReviewerProposeNotes(props.reviewerId, repo);
      setProposed((rows) => ({ ...rows, [repo]: pr }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the pull request");
    } finally {
      setProposing(null);
    }
  };
  const load = useCallback(async () => {
    try {
      setNotes(await api.slackReviewerNotes(props.reviewerId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load remembered dismissals");
    }
  }, [props.reviewerId]);
  const forget = async (input: { repo?: string; index?: number }) => {
    try {
      await api.slackReviewerForgetNotes(props.reviewerId, input);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not forget that");
    }
  };
  const repos = Object.entries(notes ?? {});
  const total = repos.reduce((sum, [, rows]) => sum + rows.length, 0);
  return (
    <details
      className="slack-reviewer-details"
      data-testid={`slack-reviewer-notes-${props.reviewerId}`}
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open && notes === null) void load();
      }}
    >
      <summary>Remembered dismissals{notes ? ` · ${total}` : ""}</summary>
      {error ? <InlineError message={error} /> : null}
      {notes && !total ? (
        <p className="hint">
          None yet. Findings dismissed in a review thread or on the PR show up here.
        </p>
      ) : null}
      {repos.map(([repo, rows]) => (
        <div key={repo} className="slack-reviewer-notes-repo">
          <div className="slack-reviewer-notes-head">
            <strong>{repo}</strong>
            <ProposeNotesButton
              repo={repo}
              forges={props.forges}
              busy={proposing === repo}
              onPropose={() => void propose(repo)}
            />
            <button type="button" className="btn small ghost" onClick={() => void forget({ repo })}>
              Forget all
            </button>
          </div>
          {proposed[repo] ? (
            <p className="hint" data-testid={`slack-reviewer-notes-proposed-${repo}`}>
              Opened{" "}
              <a href={proposed[repo]!.url} target="_blank" rel="noreferrer">
                PR #{proposed[repo]!.number}
              </a>{" "}
              adding these to REVIEW.md. The reviewer reads REVIEW.md from the base branch as repo
              guidelines, so once it merges, use Forget all here so the same notes aren&apos;t sent
              twice.
            </p>
          ) : null}
          <ul className="slack-reviewer-notes">
            {rows.map((row, index) => (
              <li key={`${row.path}-${index}`}>
                <span className="hint">
                  {NOTE_REASON[row.reason]} · {row.pr} · {row.severity} · <code>{row.path}</code>
                </span>
                <div>{row.body}</div>
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => void forget({ repo, index })}
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </details>
  );
}

/**
 * "Propose as REVIEW.md": opens a PR on the repo's forge. Disabled on forges whose API this can't
 * branch and commit on (only GitHub and GitLab can), with the reason as a tooltip.
 */
function ProposeNotesButton(props: {
  repo: string;
  forges?: GitForgeAccount[];
  busy: boolean;
  onPropose: () => void;
}) {
  const target = parseSlackRepoNotesKey(props.repo);
  const account =
    target && props.forges?.length
      ? resolveForgeAccount(props.forges, { url: target.repoUrl })
      : undefined;
  // Without the account list, let the server decide and explain.
  const supported = !props.forges?.length || slackReviewProposeSupported(account?.kind);
  return (
    <BusyButton
      className="btn small ghost"
      busy={props.busy}
      disabled={!supported}
      title={
        supported
          ? "Open a pull request that adds these as conventions to the repo's REVIEW.md"
          : undefined
      }
      disabledReason={
        supported
          ? undefined
          : `Not supported on this forge (${account?.kind ?? "no Git account"}). GitHub and GitLab only.`
      }
      data-testid={`slack-reviewer-notes-propose-${props.repo}`}
      onClick={props.onPropose}
    >
      Propose as REVIEW.md
    </BusyButton>
  );
}

function StatusTemplateField(props: {
  name: keyof SlackReviewerStatusTemplates;
  value: string;
  model: { model: string; provider: string };
  cloneRepo?: boolean;
  onChange: (value: string) => void;
}) {
  const fallback = DEFAULT_SLACK_REVIEWER_STATUS[props.name];
  const custom = props.value !== fallback;
  const outcome: SlackReviewOutcome =
    props.name === "started" ||
    props.name === "queued" ||
    props.name === "dismissed" ||
    props.name === "partDone"
      ? "commented"
      : props.name;
  const text = renderSlackReviewerStatus(
    props.value || fallback,
    SLACK_PREVIEW_PR,
    slackPreviewVars(outcome, props.model, { cloneRepo: props.cloneRepo }),
  );
  return (
    <div className="field slack-reviewer-template">
      <label>
        {STATUS_LABELS[props.name]}
        {custom ? (
          <button
            type="button"
            className="btn small ghost"
            onClick={() => props.onChange(fallback)}
          >
            Reset
          </button>
        ) : null}
      </label>
      <textarea
        rows={2}
        value={props.value}
        data-testid={`slack-reviewer-status-${props.name}`}
        onChange={(e) => props.onChange(e.target.value)}
        onBlur={() => {
          if (!props.value.trim()) props.onChange(fallback);
        }}
      />
      <div
        className="slack-md pr-md slack-reviewer-template-preview"
        data-testid={`slack-reviewer-status-preview-${props.name}`}
        dangerouslySetInnerHTML={{ __html: slackPreviewHtml(text) }}
      />
    </div>
  );
}

function CostField(props: { value: number; testId?: string; onCommit: (value: number) => void }) {
  const [text, setText] = useState(props.value ? String(props.value) : "");
  useEffect(() => setText(props.value ? String(props.value) : ""), [props.value]);
  const commit = () => {
    const next = clampSlackReviewerCost(text);
    setText(next ? String(next) : "");
    if (next !== props.value) props.onCommit(next);
  };
  return (
    <div className="field">
      <label htmlFor={props.testId}>Cost cap per review (USD)</label>
      <input
        id={props.testId}
        type="number"
        inputMode="decimal"
        min={0}
        step={0.05}
        value={text}
        placeholder="No cap"
        data-testid={props.testId}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      <span className="hint">
        When a review&apos;s estimated spend reaches this, it stops reading the repo and answers
        with what it has. Needs a known price for the model. Empty for no cap.
      </span>
    </div>
  );
}

function AuthorMapField(props: {
  value: Record<string, string>;
  testId?: string;
  onCommit: (value: Record<string, string>) => void;
}) {
  const formatted = formatSlackAuthorMapText(props.value);
  const [text, setText] = useState(formatted);
  useEffect(() => setText(formatted), [formatted]);
  return (
    <div className="field">
      <label htmlFor={props.testId}>PR authors in Slack</label>
      <textarea
        id={props.testId}
        rows={3}
        spellCheck={false}
        value={text}
        placeholder={"alice = U0123ABCD\nbob = U0456EFGH"}
        data-testid={props.testId}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const next = parseSlackAuthorMapText(text);
          setText(formatSlackAuthorMapText(next));
          if (formatSlackAuthorMapText(next) !== formatted) props.onCommit(next);
        }}
      />
      <span className="hint">
        Git login = Slack member ID, one per line (Slack profile → ⋯ → Copy member ID). Lines that
        don&apos;t parse are dropped.
      </span>
    </div>
  );
}

function ReviewerSkills(props: {
  reviewer: SlackReviewer;
  skills: AgentSkill[];
  onPrompt: (prompt: string) => void;
}) {
  const available = enabledSkills(props.skills);
  const { used, unknown } = resolveSlackReviewerSkills(props.reviewer.prompt, props.skills);
  const usedNames = new Set(used.map((row) => row.name));
  const tokens = estimateTokens(used.map((row) => row.body).join("\n\n"));
  return (
    <div
      className="field slack-reviewer-skills"
      data-testid={`slack-reviewer-skills-${props.reviewer.id}`}
    >
      <label>Skills</label>
      {available.length ? (
        <div className="slack-reviewer-skill-chips" role="group" aria-label="Skills">
          {available.map((skill) => {
            const on = usedNames.has(skill.name);
            return (
              <button
                key={skill.id}
                type="button"
                className={`btn small ghost${on ? " on" : ""}`}
                aria-pressed={on}
                title={skill.hint || skill.title}
                data-testid={`slack-reviewer-skill-${skill.name}`}
                onClick={() =>
                  props.onPrompt(toggleSkillRef(props.reviewer.prompt, skill.name, !on))
                }
              >
                /{skill.name}
              </button>
            );
          })}
        </div>
      ) : null}
      <span className="hint" data-testid={`slack-reviewer-skills-summary-${props.reviewer.id}`}>
        {available.length === 0
          ? "No skills yet. Add them in Settings → Skills, then name them in the prompt as /name."
          : used.length
            ? `Sends ${used.length === 1 ? "1 skill" : `${used.length} skills`} with every review (~${tokens.toLocaleString("en-US")} tokens): ${used.map((row) => `/${row.name}`).join(", ")}.`
            : "Name a skill in the prompt as /name, or click one, to send its instructions with every review. Only named skills are sent."}
      </span>
      {unknown.length ? (
        <span
          className="hint warn-text"
          data-testid={`slack-reviewer-skills-unknown-${props.reviewer.id}`}
        >
          No enabled skill named {unknown.map((name) => `/${name}`).join(", ")}. That text is sent
          as written.
        </span>
      ) : null}
    </div>
  );
}

function TestReview(props: {
  reviewer: SlackReviewer;
  onPersist: () => Promise<boolean>;
  onRan: (run: SlackReviewRun) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<SlackReviewRun | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [fullRereview, setFullRereview] = useState(false);
  const forgeNote = dryRun
    ? "Reviews the full PR diff without posting to the PR or Slack or recording a review."
    : props.reviewer.forgeMode === "none"
      ? "Nothing is posted to the PR or Slack."
      : "The review is posted to the PR. Nothing is posted to Slack.";
  return (
    <div className="slack-reviewer-test">
      <h4 className="slack-reviewer-section">Try it</h4>
      <div className="slack-reviewer-test-row">
        <input
          value={url}
          placeholder="https://github.com/acme/api/pull/482"
          spellCheck={false}
          aria-label="Pull request URL"
          data-testid={`slack-reviewer-test-url-${props.reviewer.id}`}
          onChange={(e) => setUrl(e.target.value)}
        />
        <BusyButton
          className="btn small"
          busy={busy}
          busyLabel="Reviewing…"
          disabled={!url.trim()}
          data-testid={`slack-reviewer-test-run-${props.reviewer.id}`}
          onClick={() => {
            void (async () => {
              setBusy(true);
              setError(null);
              setRun(null);
              try {
                if (!(await props.onPersist()))
                  throw new Error("Save the reviewer settings before running a review");
                const result = await api.slackReviewerReview(
                  props.reviewer.id,
                  url.trim(),
                  undefined,
                  { dryRun, ...(!dryRun && fullRereview ? { fullRereview: true } : {}) },
                );
                setRun(result);
                props.onRan(result);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Review failed");
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          Review now
        </BusyButton>
      </div>
      <SettingsToggleRow
        label="Dry run"
        hint="Show the findings here instead of posting a review to the PR."
        on={dryRun}
        testId={`slack-reviewer-test-dry-${props.reviewer.id}`}
        onChange={setDryRun}
      />
      {!dryRun ? (
        <SettingsToggleRow
          label="Force full re-review"
          hint="Review the full PR diff, even if the latest commit has already been reviewed."
          on={fullRereview}
          testId={`slack-reviewer-test-full-${props.reviewer.id}`}
          onChange={setFullRereview}
        />
      ) : null}
      <p className="hint">Uses this reviewer&apos;s saved settings. {forgeNote}</p>
      {error ? <InlineError message={error} /> : null}
      {run ? (
        <ul
          className="slack-reviewer-runs"
          data-testid={`slack-reviewer-test-result-${props.reviewer.id}`}
        >
          <SlackReviewRunRow run={run} />
        </ul>
      ) : null}
      {run?.dryRun ? (
        <div
          className="slack-reviewer-dry-findings"
          data-testid={`slack-reviewer-test-findings-${props.reviewer.id}`}
        >
          {run.summary ? <p>{run.summary}</p> : null}
          {run.findings?.length ? (
            <ol>
              {run.findings.map((row) => (
                <li key={row.id ?? `${row.path}:${row.line}`}>
                  <strong>{row.severity}</strong>{" "}
                  <code>
                    {row.path}
                    {row.line ? `:${row.line}` : ""}
                  </code>{" "}
                  {row.body}
                  {row.suggestion !== undefined ? (
                    <pre className="slack-reviewer-suggestion">{row.suggestion}</pre>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="hint">No findings.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
