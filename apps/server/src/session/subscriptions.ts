import {
  advanceSubscription,
  checksFixRepoId,
  formatChecksCursor,
  isCanvasSession,
  isSlackChannelMessage,
  newCheckFailures,
  normalizeSubscriptions,
  parseOwnerRepo,
  resolveForgeAccount,
  wrapSubscriptionEvent,
  type AgentSession,
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

  constructor(
    private readonly store: JsonStore,
    private readonly sessions: Pick<SessionService, "sendChat">,
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
        snapshot = await this.checksSnapshot(session, sub);
      }
      const result = advanceSubscription(sub, now, snapshot);
      if (result.fire) {
        let wake = result.fire;
        if (sub.kind === "checks" && this.opts.repos) {
          const repoId = checksFixRepoId(session, sub);
          if (repoId && sub.pullNumber) {
            try {
              const { session: fix } = await this.opts.repos.startFixSession(
                repoId,
                sub.pullNumber,
              );
              if (fix.id === session.id) wake = "";
            } catch {
              /* still wake the subscriber */
            }
          }
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
}
