import { describe, expect, it } from "vitest";
import {
  MAX_SESSION_SUBSCRIPTIONS,
  advanceSubscription,
  applySubscribe,
  applyUnsubscribe,
  checksFixRepoId,
  formatChecksCursor,
  formatSubscriptionList,
  formatSubscriptionMeta,
  formatSubscriptionsPrompt,
  newCheckFailures,
  nextTimerFireAt,
  parseForgePullUrl,
  subscriptionDedupeKey,
} from "./subscribe.js";

const now = new Date("2026-08-29T12:00:00.000Z");

describe("parseForgePullUrl", () => {
  it("parses GitHub, GitLab, and Bitbucket pull URLs", () => {
    expect(parseForgePullUrl("https://github.com/acme/app/pull/12")).toEqual({
      forge: "github",
      pullUrl: "https://github.com/acme/app/pull/12",
      repoUrl: "https://github.com/acme/app.git",
      pullNumber: 12,
      title: "acme/app#12",
    });
    expect(parseForgePullUrl("https://gitlab.com/acme/app/-/merge_requests/4")).toMatchObject({
      forge: "gitlab",
      pullNumber: 4,
      title: "acme/app!4",
    });
    expect(parseForgePullUrl("https://bitbucket.org/acme/app/pull-requests/9")).toMatchObject({
      forge: "bitbucket",
      pullNumber: 9,
    });
  });
});

describe("applySubscribe", () => {
  it("adds, lists, dedupes, and unsubscribes", () => {
    const added = applySubscribe(
      [],
      { kind: "slack_channel", channelId: "C0123ABCDEF", channelName: "eng" },
      { id: "s1", createdAt: now.toISOString(), now },
    );
    expect(added.subscriptions).toHaveLength(1);
    expect(added.subscriptions[0]?.title).toBe("#eng");
    expect(added.output).toMatch(/Subscribed s1/);
    expect(added.output).toMatch(/Do not post a listening notice/);

    const listed = applySubscribe(added.subscriptions, { action: "list" });
    expect(listed.output).toMatch(/s1/);
    expect(formatSubscriptionList([])).toMatch(/No active/);

    const dup = applySubscribe(added.subscriptions, {
      kind: "slack_channel",
      channelId: "C0123ABCDEF",
    });
    expect(dup.subscriptions).toHaveLength(1);
    expect(dup.output).toMatch(/Already subscribed/);

    const gone = applyUnsubscribe(added.subscriptions, { id: "s1" });
    expect(gone.subscriptions).toEqual([]);
    expect(gone.output).toMatch(/Unsubscribed s1/);
  });

  it("dedupes timers by name and keeps the old config", () => {
    const first = applySubscribe(
      [],
      { kind: "timer", name: "check-ci", delaySeconds: 30, prompt: "look at CI" },
      { id: "t1", createdAt: now.toISOString(), now },
    );
    expect(first.subscriptions[0]?.delaySeconds).toBe(30);
    const again = applySubscribe(first.subscriptions, {
      kind: "timer",
      name: "check-ci",
      delaySeconds: 90,
    });
    expect(again.subscriptions[0]?.delaySeconds).toBe(30);
    expect(again.output).toMatch(/unsubscribe first/i);
  });

  it("requires Slack IDs and timer delay or cron", () => {
    expect(applySubscribe([], { kind: "slack_channel" }).output).toMatch(/channelId is required/);
    expect(applySubscribe([], { kind: "slack_thread", channelId: "C1" }).output).toMatch(
      /threadTs is required/,
    );
    expect(applySubscribe([], { kind: "timer", name: "x" }).output).toMatch(/delaySeconds or cron/);
    expect(applySubscribe([], { kind: "pull_request" }).output).toMatch(/pullUrl or pullNumber/);
    expect(applySubscribe([], { kind: "linear_issue" }).output).toMatch(/issueId is required/);
    expect(applySubscribe([], { kind: "grafana_alert" }).output).toMatch(
      /alertFingerprint or issueId/,
    );
  });

  it("subscribes to Linear and Grafana coordinates", () => {
    const linear = applySubscribe(
      [],
      { kind: "linear_issue", issueId: "ENG-12" },
      { id: "l1", createdAt: now.toISOString(), now },
    );
    expect(linear.subscriptions[0]).toMatchObject({
      kind: "linear_issue",
      issueId: "ENG-12",
      title: "ENG-12",
    });
    const grafana = applySubscribe(
      [],
      { kind: "grafana_alert", alertFingerprint: "abc" },
      { id: "g1", createdAt: now.toISOString(), now },
    );
    expect(grafana.subscriptions[0]).toMatchObject({
      kind: "grafana_alert",
      alertFingerprint: "abc",
    });
  });

  it("parses Azure DevOps and Gitea pull URLs", () => {
    const azure = applySubscribe(
      [],
      {
        kind: "pull_request",
        pullUrl: "https://dev.azure.com/org/proj/_git/app/pullrequest/9",
      },
      { id: "a1", createdAt: now.toISOString(), now },
    );
    expect(azure.subscriptions[0]).toMatchObject({
      forge: "azuredevops",
      pullNumber: 9,
    });
    const gitea = applySubscribe(
      [],
      { kind: "pull_request", pullUrl: "https://git.example.com/acme/app/pulls/3" },
      { id: "g1", createdAt: now.toISOString(), now },
    );
    expect(gitea.subscriptions[0]).toMatchObject({
      forge: "gitea",
      pullNumber: 3,
    });
  });

  it("fills a pull subscription from a URL or the bound session pull", () => {
    const fromUrl = applySubscribe(
      [],
      { kind: "pull_request", pullUrl: "https://github.com/acme/app/pull/12" },
      { id: "p1", createdAt: now.toISOString(), now },
    );
    expect(fromUrl.subscriptions[0]).toMatchObject({
      kind: "pull_request",
      pullNumber: 12,
      title: "acme/app#12",
    });
    const fromSession = applySubscribe(
      [],
      { kind: "pull_request", pullNumber: 12 },
      {
        id: "p2",
        createdAt: now.toISOString(),
        now,
        sessionPull: {
          number: 12,
          url: "https://github.com/acme/app/pull/12",
          title: "acme/app#12",
        },
        sessionRepoUrl: "https://github.com/acme/app.git",
      },
    );
    expect(fromSession.subscriptions[0]?.pullNumber).toBe(12);
    expect(subscriptionDedupeKey(fromUrl.subscriptions[0]!)).toBe(
      subscriptionDedupeKey(fromSession.subscriptions[0]!),
    );

    const checks = applySubscribe(
      [],
      { kind: "checks", pullUrl: "https://github.com/acme/app/pull/12" },
      { id: "c1", createdAt: now.toISOString(), now },
    );
    expect(checks.subscriptions[0]).toMatchObject({
      kind: "checks",
      pullNumber: 12,
      title: "acme/app#12 checks",
    });
    expect(subscriptionDedupeKey(checks.subscriptions[0]!)).toBe(
      "checks:https://github.com/acme/app:12",
    );
    expect(subscriptionDedupeKey(fromUrl.subscriptions[0]!)).not.toBe(
      subscriptionDedupeKey(checks.subscriptions[0]!),
    );
  });

  it("caps the number of live subscriptions", () => {
    let rows = applySubscribe(
      [],
      { kind: "timer", name: "t0", delaySeconds: 5 },
      { id: "s0", createdAt: now.toISOString(), now },
    ).subscriptions;
    for (let i = 1; i < MAX_SESSION_SUBSCRIPTIONS; i += 1) {
      rows = applySubscribe(
        rows,
        { kind: "timer", name: `t${i}`, delaySeconds: 5 },
        { id: `s${i}`, createdAt: now.toISOString(), now },
      ).subscriptions;
    }
    expect(rows).toHaveLength(MAX_SESSION_SUBSCRIPTIONS);
    const extra = applySubscribe(rows, { kind: "timer", name: "overflow", delaySeconds: 5 });
    expect(extra.subscriptions).toHaveLength(MAX_SESSION_SUBSCRIPTIONS);
    expect(extra.output).toMatch(/cap/);
  });
});

describe("timers and wake prompts", () => {
  it("computes the next delay and cron fire", () => {
    const delay = nextTimerFireAt({ delaySeconds: 45 }, now);
    expect(delay?.toISOString()).toBe("2026-08-29T12:00:45.000Z");
    const cron = nextTimerFireAt({ cron: "0 14 * * *" }, now);
    expect(cron).toBeInstanceOf(Date);
    expect(cron!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("fires a due once-timer and drops it", () => {
    const sub = applySubscribe(
      [],
      { kind: "timer", name: "nudge", delaySeconds: 1, once: true, prompt: "check the queue" },
      { id: "t1", createdAt: now.toISOString(), now },
    ).subscriptions[0]!;
    const idle = advanceSubscription(sub, now);
    expect(idle.fire).toBeUndefined();
    expect(idle.next?.id).toBe("t1");
    const due = advanceSubscription(sub, new Date("2026-08-29T12:00:02.000Z"));
    expect(due.next).toBeUndefined();
    expect(due.fire).toMatch(/check the queue/);
    expect(due.fire).toMatch(/untrusted/);
    expect(due.fire).toMatch(/unsubscribe with id t1/);
  });

  it("recurs a delaySeconds timer unless once is true", () => {
    const sub = applySubscribe(
      [],
      { kind: "timer", name: "poll", delaySeconds: 30 },
      { id: "t2", createdAt: now.toISOString(), now },
    ).subscriptions[0]!;
    expect(sub.once).toBe(false);
    const due = advanceSubscription(sub, new Date("2026-08-29T12:00:31.000Z"));
    expect(due.fire).toMatch(/poll/);
    expect(due.next?.id).toBe("t2");
    expect(due.next?.nextFireAt).toBe("2026-08-29T12:01:02.000Z");
  });

  it("snapshots slack/PR cursors without firing, then fires on change", () => {
    const sub = applySubscribe(
      [],
      { kind: "slack_thread", channelId: "C1", threadTs: "1.2" },
      { id: "s1", createdAt: now.toISOString(), now },
    ).subscriptions[0]!;
    const primed = advanceSubscription(sub, now, { cursor: "1.2", summary: "old" });
    expect(primed.fire).toBeUndefined();
    expect(primed.next?.cursor).toBe("1.2");
    const fired = advanceSubscription(primed.next!, now, {
      cursor: "1.3",
      summary: "alice: shipped it",
    });
    expect(fired.fire).toMatch(/alice: shipped it/);
    expect(fired.next?.cursor).toBe("1.3");
    expect(fired.next?.lastFiredAt).toBe(now.toISOString());

    const quiet = advanceSubscription(primed.next!, now, { cursor: "1.4", summary: "" });
    expect(quiet.fire).toBeUndefined();
    expect(quiet.next?.cursor).toBe("1.4");
    expect(quiet.next?.lastFiredAt).toBeUndefined();
  });

  it("detects new CI failures without re-firing the same red check", () => {
    const cursor = formatChecksCursor("abc", [
      { name: "test", status: "success" },
      { name: "lint", status: "failure" },
    ]);
    expect(cursor).toBe("abc|lint:failure,test:success");
    expect(
      newCheckFailures(cursor, [
        { name: "test", status: "success" },
        { name: "lint", status: "failure" },
      ]),
    ).toEqual([]);
    expect(
      newCheckFailures(cursor, [
        { name: "test", status: "failure" },
        { name: "lint", status: "failure" },
      ]),
    ).toEqual([{ name: "test", status: "failure" }]);
  });

  it("only starts Fix on the session's linked repo", () => {
    const session = {
      repoId: "r1",
      repo: { url: "https://github.com/acme/app.git" },
    };
    expect(
      checksFixRepoId(session, {
        repoUrl: "https://github.com/acme/app",
        pullNumber: 12,
      }),
    ).toBe("r1");
    expect(
      checksFixRepoId(session, {
        repoUrl: "https://github.com/other/lib.git",
        pullNumber: 12,
      }),
    ).toBeUndefined();
    expect(checksFixRepoId(session, { pullNumber: 12 })).toBe("r1");
    expect(checksFixRepoId({ repoId: "r1" }, { pullNumber: 12 })).toBeUndefined();
  });

  it("formats the working-state prompt and card meta", () => {
    const sub = applySubscribe(
      [],
      { kind: "timer", name: "nudge", delaySeconds: 60 },
      { id: "t1", createdAt: now.toISOString(), now },
    ).subscriptions[0]!;
    expect(formatSubscriptionsPrompt([sub])).toMatch(/t1 Timer: nudge/);
    expect(formatSubscriptionMeta(sub, now.getTime())).toMatch(/Next in 1m/);
    expect(formatSubscriptionsPrompt([])).toBe("");
  });
});
