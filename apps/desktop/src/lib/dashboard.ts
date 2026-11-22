import type {
  AgentSession,
  Automation,
  AutomationRun,
  SlackReviewActive,
  SlackReviewOutcome,
  SlackReviewRun,
  SlackReviewer,
} from "@locus/shared";

/** A chat that is booting or mid-turn right now. */
export function isActiveSession(session: AgentSession): boolean {
  return session.status === "running" || session.status === "provisioning";
}

export function isReviewSession(session: AgentSession): boolean {
  return session.kind === "review";
}

function newestFirst<T>(rows: T[], at: (row: T) => string | undefined): T[] {
  return [...rows].sort((a, b) => (Date.parse(at(b) ?? "") || 0) - (Date.parse(at(a) ?? "") || 0));
}

export type DashboardAgent = {
  session: AgentSession;
  /** spawn_agent children still working. */
  subagents: number;
};

/** Coding / design / board chats working now (not review chats, which get their own panel). */
export function activeAgents(sessions: AgentSession[]): DashboardAgent[] {
  return newestFirst(
    sessions.filter((s) => !s.archived && isActiveSession(s) && !isReviewSession(s)),
    (s) => s.updatedAt,
  ).map((session) => ({
    session,
    subagents: (session.subagents ?? []).filter((row) => row.status === "running").length,
  }));
}

/** Review chats: running ones first, then the most recently touched. */
export function reviewSessions(sessions: AgentSession[], limit = 4): AgentSession[] {
  const rows = sessions.filter((s) => !s.archived && isReviewSession(s));
  const running = newestFirst(rows.filter(isActiveSession), (s) => s.updatedAt);
  const rest = newestFirst(
    rows.filter((s) => !isActiveSession(s)),
    (s) => s.updatedAt,
  );
  return [...running, ...rest].slice(0, Math.max(limit, running.length));
}

/** Idle chats touched most recently, to pick back up. */
export function recentSessions(sessions: AgentSession[], limit = 5): AgentSession[] {
  return newestFirst(
    sessions.filter((s) => !s.archived && !isActiveSession(s) && s.status !== "draft"),
    (s) => s.updatedAt,
  ).slice(0, limit);
}

export type DashboardRun = { run: AutomationRun; name: string };

/** Job runs queued or running now, then the latest finished ones. */
export function automationActivity(
  automations: Automation[],
  runs: AutomationRun[],
  limit = 4,
): { live: DashboardRun[]; recent: DashboardRun[] } {
  const names = new Map(automations.map((row) => [row.id, row.name]));
  const named = (run: AutomationRun): DashboardRun => ({
    run,
    name: names.get(run.automationId) ?? "Job",
  });
  const sorted = newestFirst(runs, (run) => run.startedAt);
  const live = sorted.filter((r) => r.status === "running" || r.status === "queued").map(named);
  const recent = sorted
    .filter((r) => r.status !== "running" && r.status !== "queued")
    .slice(0, limit)
    .map(named);
  return { live, recent };
}

/** The soonest scheduled run among enabled jobs. */
export function nextScheduledRun(automations: Automation[]): Automation | undefined {
  const future = automations.filter((row) => row.enabled && row.nextRunAt);
  return [...future].sort((a, b) => Date.parse(a.nextRunAt!) - Date.parse(b.nextRunAt!))[0];
}

export const REVIEW_OUTCOME_LABEL: Record<SlackReviewOutcome, string> = {
  approved: "Approved",
  commented: "Commented",
  changesRequested: "Changes requested",
  clean: "No findings",
  skipped: "Skipped",
  failed: "Failed",
  answered: "Answered",
};

export function reviewOutcomeTone(outcome: SlackReviewOutcome): "ok" | "warn" | "danger" | "muted" {
  if (outcome === "approved" || outcome === "clean") return "ok";
  if (outcome === "changesRequested") return "warn";
  if (outcome === "failed") return "danger";
  if (outcome === "skipped") return "muted";
  return "ok";
}

export function reviewerName(reviewers: SlackReviewer[], id: string): string {
  return reviewers.find((row) => row.id === id)?.name || "Reviewer";
}

/** Slack reviews queued or running, plus the latest real (not dry-run) finished ones. */
export function slackReviewActivity(
  runs: SlackReviewRun[],
  active: SlackReviewActive[],
  limit = 4,
): { active: SlackReviewActive[]; recent: SlackReviewRun[] } {
  return {
    active: newestFirst(active, (row) => row.since),
    recent: newestFirst(
      runs.filter((row) => !row.dryRun),
      (row) => row.at,
    ).slice(0, limit),
  };
}
