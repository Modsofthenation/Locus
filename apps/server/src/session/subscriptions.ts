import {
  advanceSubscription,
  checksFixRepoId,
  findBoundAgent,
  isFailingCheckStatus,
  parseReviewSettings,
  planCiFix,
  settleCiFixState,
  formatChecksCursor,
  isCanvasSession,
  isSlackChannelMessage,
  newCheckFailures,
  normalizeSubscriptions,
  parseOwnerRepo,
  resolveForgeAccount,
  wrapSubscriptionEvent,
  type AgentSession,
  type PullCheck,
  type SessionSubscription,
  type SlackMessage,
  type SubscriptionSnapshot,
} from "@locus/shared";
import type { Hub } from "../core/hub.js";
import type { SessionService } from "./sessions.js";
import type { SlackGateway } from "../slack/slackGateway.js";
import type { JsonStore } from "../core/store.js";
import { ForgeClient } from "../git/forge.js";
import { withFreshForgeToken } from "../git/forgeOauth.js";
import type { RepoService } from "../git/repos.js";
import { IntegrationsClient } from "../integrations/integrations.js";
import { listGrafanaAlerts } from "../integrations/grafanaLive.js";

function slackTsGreater(a: string, b: string): boolean {
  return Number(a) > Number(b);
}

function slackIsReply(row: SlackMessage): boolean {
  return Boolean(row.threadTs && row.threadTs !== row.ts && !row.replyBroadcast);
}

export class SubscriptionService {
  private ticking = false;
  private timer?: ReturnType<typeof setInterval>;
  private readonly forge: ForgeClient;
  private readonly integrations: IntegrationsClient;
  /** Head SHA and checks seen by the last checks snapshot, keyed by subscription id. */
  private readonly lastChecks = new Map<string, { headSha: string; checks: PullCheck[] }>();

  constructor(
    private readonly store: JsonStore,
    private readonly sessions: Pick<SessionService, "sendChat"> &
      Partial<Pick<SessionService, "flagNeedsHuman">>,
    private readonly opts: {
      slack?: SlackGateway;
      hub?: Hub;
      repos?: Pick<RepoService, "startFixSession">;
      projects?: {
        isPaused: (id: string | undefined) => Promise<boolean>;
        tickFleet?: () => Promise<void>;
      };
      now?: () => Date;
      pollMs?: number;
      fetch?: typeof fetch;
    } = {},
  ) {
    this.forge = new ForgeClient(opts.fetch ?? fetch);
    this.integrations = new IntegrationsClient(opts.fetch ?? fetch);
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  start(intervalMs = this.opts.pollMs ?? 10_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const sessions = await this.store.loadSessions();
      for (const session of sessions) {
        if (session.archived || isCanvasSession(session)) continue;
        const subs = normalizeSubscriptions(session.subscriptions);
        if (!subs.length) continue;
        await this.tickSession(session, subs);
      }
      await this.opts.projects?.tickFleet?.().catch(() => undefined);
    } finally {
      this.ticking = false;
    }
  }

  private async tickSession(session: AgentSession, subs: SessionSubscription[]): Promise<void> {
    const now = this.now();
    const next: SessionSubscription[] = [];
    const fires: string[] = [];
    for (const sub of subs) {
      let snapshot: SubscriptionSnapshot | null | undefined;
      if (sub.kind === "slack_channel" || sub.kind === "slack_thread") {
        snapshot = await this.slackSnapshot(session, sub);
      } else if (sub.kind === "pull_request") {
        snapshot = await this.pullSnapshot(session, sub);
      } else if (sub.kind === "checks") {
        this.lastChecks.delete(`${session.id}:${sub.id}`);
        snapshot = await this.checksSnapshot(session, sub);
      } else if (
        sub.kind === "linear_issue" ||
        sub.kind === "jira_issue" ||
        sub.kind === "sentry_issue" ||
        sub.kind === "incident" ||
        sub.kind === "grafana_alert"
      ) {
        snapshot = await this.integrationSnapshot(session, sub);
      }
      const result = advanceSubscription(sub, now, snapshot);
      const seen =
        sub.kind === "checks" ? this.lastChecks.get(`${session.id}:${sub.id}`) : undefined;
      if (seen && result.next && !result.fire) {
        const settled = settleCiFixState(sub.ciFix, seen.checks);
        result.next = { ...result.next, ciFix: settled };
      }
      if (result.fire) {
        let wake = result.fire;
        if (sub.kind === "checks" && this.opts.repos) {
          const fixed = await this.startCiFix(session, sub, seen);
          if (fixed.ciFix !== undefined && result.next) {
            result.next = { ...result.next, ciFix: fixed.ciFix ?? undefined };
          }
          if (fixed.suppressWake) wake = "";
        }
        if (wake) {
          const paused = session.projectId
            ? await this.opts.projects?.isPaused(session.projectId)
            : false;
          if (!paused) fires.push(wake);
        }
      }
      if (result.next) next.push(result.next);
    }
    const changed =
      fires.length > 0 ||
      next.length !== subs.length ||
      next.some((row, i) => JSON.stringify(row) !== JSON.stringify(subs[i]));
    if (changed) {
      const updated = await this.store.mutateSession(session.id, (current) => {
        current.subscriptions = next.length ? next : undefined;
      });
      if (updated) this.opts.hub?.broadcast({ type: "session.updated", session: updated });
    }
    for (const prompt of fires) {
      try {
        await this.sessions.sendChat(session.id, prompt);
      } catch {
        /* a wake should not crash the poller */
      }
    }
  }

  /**
   * A checks wake on the session's linked repo: start one CI fix per head SHA + failing
   * set (with check names, condensed logs, and the head SHA in the prompt), and stop with
   * Needs you after `review.ciFixMaxAttempts` consecutive fixes on the same check.
   * `ciFix: null` means clear the stored state.
   */
  private async startCiFix(
    session: AgentSession,
    sub: SessionSubscription,
    seen: { headSha: string; checks: PullCheck[] } | undefined,
  ): Promise<{ suppressWake: boolean; ciFix?: SessionSubscription["ciFix"] | null }> {
    const repos = this.opts.repos;
    const repoId = checksFixRepoId(session, sub);
    if (!repos || !repoId || !sub.pullNumber) return { suppressWake: false };
    const config = await this.store.loadConfig().catch(() => undefined);
    const maxAttempts = parseReviewSettings(config?.review).ciFixMaxAttempts;
    const decision = seen
      ? planCiFix(sub.ciFix, {
          headSha: seen.headSha,
          checks: seen.checks,
          maxAttempts,
          now: this.now(),
        })
      : undefined;
    const ciFix = decision
      ? decision.state.lastKey || decision.state.attempts
        ? decision.state
        : null
      : undefined;
    if (decision?.action === "duplicate") return { suppressWake: true, ciFix };
    if (decision?.action === "cap") {
      const targets = new Set([session.id]);
      const sessions = await this.store.loadSessions().catch(() => []);
      const bound = findBoundAgent(sessions, { repoId, pullNumber: sub.pullNumber });
      if (bound) targets.add(bound.id);
      for (const id of targets) {
        await this.sessions.flagNeedsHuman?.(id, decision.summary).catch(() => undefined);
      }
      return { suppressWake: true, ciFix };
    }
    try {
      const failing = seen?.checks.filter((row) => isFailingCheckStatus(row.status)) ?? [];
      const { session: fix } = await repos.startFixSession(repoId, sub.pullNumber, {
        ci: {
          headSha: seen?.headSha,
          checks: failing.map((row) => row.name),
          attempt: decision?.action === "start" ? decision.attempt : undefined,
          maxAttempts,
        },
      });
      return { suppressWake: fix.id === session.id, ciFix };
    } catch {
      /* still wake the subscriber; do not count an attempt that never started */
      return { suppressWake: false };
    }
  }

  private async slackSnapshot(
    session: AgentSession,
    sub: SessionSubscription,
  ): Promise<SubscriptionSnapshot | null> {
    const slack = this.opts.slack;
    const channelId = sub.channelId?.trim();
    if (!slack || !channelId) return null;
    try {
      const rows =
        sub.kind === "slack_thread" && sub.threadTs
          ? await slack.replies(channelId, sub.threadTs)
          : await slack.peekHistory(channelId, sub.cursor ? { oldest: sub.cursor } : {});
      const skipTs = session.slack?.lastPostTs;
      const fresh = rows
        .filter((row) => row.ts)
        .filter((row) => (skipTs ? row.ts !== skipTs : true))
        .filter((row) => row.agent !== true)
        .filter((row) => {
          if (sub.kind === "slack_thread") return true;
          if (sub.topLevelOnly) return isSlackChannelMessage(row);
          return true;
        })
        .filter((row) => (sub.cursor ? slackTsGreater(row.ts, sub.cursor) : true))
        .filter((row) => {
          if (sub.kind === "slack_channel" && sub.topLevelOnly && slackIsReply(row)) return false;
          return true;
        })
        .sort((a, b) => Number(a.ts) - Number(b.ts));
      const latest = rows.reduce(
        (max, row) => (slackTsGreater(row.ts, max) ? row.ts : max),
        sub.cursor ?? "0",
      );
      if (!sub.cursor) {
        const primed = latest !== "0" ? latest : String(this.now().getTime() / 1000);
        return { cursor: primed, summary: "" };
      }
      if (!fresh.length) return { cursor: sub.cursor, summary: "" };
      const cursor = fresh.at(-1)?.ts ?? sub.cursor;
      const lines = fresh.slice(-8).map((row) => {
        const who = row.userName || row.userId || "someone";
        return `${who}: ${row.text || "(file or empty)"}`;
      });
      return {
        cursor,
        summary: wrapSubscriptionEvent("slack-message", sub.title, lines.join("\n")),
      };
    } catch {
      return null;
    }
  }

  private async pullSnapshot(
    session: AgentSession,
    sub: SessionSubscription,
  ): Promise<SubscriptionSnapshot | null> {
    const repoUrl = sub.repoUrl || session.repo?.url;
    const number = sub.pullNumber;
    if (!repoUrl || !number) return null;
    const parsed = parseOwnerRepo(repoUrl);
    if (!parsed) return null;
    try {
      const config = await this.store.loadConfig();
      const account = resolveForgeAccount(config.forges, {
        accountId: session.repo?.accountId,
        kind: sub.forge ?? session.repo?.forge,
        url: repoUrl,
      });
      if (!account) return null;
      const fresh = await withFreshForgeToken(this.store, account, this.opts.fetch ?? fetch);
      if (!fresh.token) return null;
      const pull = await this.forge.getPull(fresh, parsed.owner, parsed.repo, number);
      const cursor = [
        pull.updatedAt,
        pull.headSha,
        pull.state,
        String(pull.comments.length),
        pull.checks.map((check) => `${check.name}:${check.status}`).join(","),
      ].join("|");
      if (!sub.cursor) return { cursor, summary: "" };
      if (cursor === sub.cursor) return { cursor, summary: "" };
      const comments = pull.comments
        .slice(-6)
        .map((row) => `${row.author ?? "unknown"}: ${row.body}`)
        .join("\n");
      const summary = [
        `${pull.title} (${pull.state}) ${pull.headRef} → ${pull.baseRef} ${pull.headSha.slice(0, 8)}`,
        wrapSubscriptionEvent(
          "pr-text",
          sub.title,
          comments || "(no new comments in this snapshot)",
        ),
      ].join("\n\n");
      return { cursor, summary };
    } catch {
      return null;
    }
  }

  private async checksSnapshot(
    session: AgentSession,
    sub: SessionSubscription,
  ): Promise<SubscriptionSnapshot | null> {
    const repoUrl = sub.repoUrl || session.repo?.url;
    const number = sub.pullNumber;
    if (!repoUrl || !number) return null;
    const parsed = parseOwnerRepo(repoUrl);
    if (!parsed) return null;
    try {
      const config = await this.store.loadConfig();
      const account = resolveForgeAccount(config.forges, {
        accountId: session.repo?.accountId,
        kind: sub.forge ?? session.repo?.forge,
        url: repoUrl,
      });
      if (!account) return null;
      const fresh = await withFreshForgeToken(this.store, account, this.opts.fetch ?? fetch);
      if (!fresh.token) return null;
      const pull = await this.forge.getPull(fresh, parsed.owner, parsed.repo, number);
      this.lastChecks.set(`${session.id}:${sub.id}`, {
        headSha: pull.headSha,
        checks: pull.checks,
      });
      const cursor = formatChecksCursor(pull.headSha, pull.checks);
      if (!sub.cursor) return { cursor, summary: "" };
      const failures = newCheckFailures(sub.cursor, pull.checks);
      if (!failures.length) return { cursor, summary: "" };
      return {
        cursor,
        summary: wrapSubscriptionEvent(
          "pr-text",
          sub.title,
          failures.map((row) => `${row.name}: ${row.status}`).join("\n"),
        ),
      };
    } catch {
      return null;
    }
  }

  private async integrationSnapshot(
    _session: AgentSession,
    sub: SessionSubscription,
  ): Promise<SubscriptionSnapshot | null> {
    try {
      const config = await this.store.loadConfig();
      const rows = config.integrations;
      if (sub.kind === "grafana_alert") {
        const account = this.integrations.account(rows, "grafana");
        if (!account) return null;
        const alerts = await listGrafanaAlerts(account, this.opts.fetch ?? fetch);
        const wanted = (sub.alertFingerprint || sub.issueId || "").trim().toLowerCase();
        const match = wanted
          ? alerts.find(
              (row) =>
                row.fingerprint.toLowerCase() === wanted || row.name.toLowerCase() === wanted,
            )
          : alerts[0];
        const cursor = alerts
          .map((row) => `${row.fingerprint}:${row.state}:${row.startsAt ?? ""}`)
          .sort()
          .join("|");
        if (!sub.cursor) return { cursor, summary: "" };
        if (cursor === sub.cursor) return { cursor, summary: "" };
        const body = match
          ? `${match.name} (${match.state}) ${match.summary ?? ""}`.trim()
          : alerts.map((row) => `${row.name}:${row.state}`).join("\n") || "No firing alerts";
        return {
          cursor,
          summary: wrapSubscriptionEvent("issue-text", sub.title, body),
        };
      }
      const tool =
        sub.kind === "linear_issue"
          ? "linear_get"
          : sub.kind === "jira_issue"
            ? "jira_get"
            : sub.kind === "sentry_issue"
              ? "sentry_get"
              : "incidentio_get";
      const issueId = sub.issueId?.trim();
      if (!issueId) return null;
      const argKey =
        sub.kind === "incident"
          ? "incident"
          : sub.kind === "sentry_issue"
            ? "issue"
            : sub.kind === "jira_issue"
              ? "issue"
              : "id";
      const got = await this.integrations.call(
        tool,
        { [argKey]: issueId, issue: issueId, id: issueId },
        rows,
      );
      if (!got.ok) return null;
      const cursor = got.output.slice(0, 2000);
      if (!sub.cursor) return { cursor, summary: "" };
      if (cursor === sub.cursor) return { cursor, summary: "" };
      return {
        cursor,
        summary: wrapSubscriptionEvent("issue-text", sub.title, got.output.slice(0, 1500)),
      };
    } catch {
      return null;
    }
  }
}
