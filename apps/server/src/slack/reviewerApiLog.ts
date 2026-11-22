/**
 * Records every Slack and forge call `SlackReviewerService` makes, for Settings → Reviewers →
 * Live logs. The service wraps its Slack and forge clients with `wrap`, and runs each poll inside
 * `scope` so a call knows whether the channel poll, the thread poll, or `autoReview` made it.
 * Calls outside a scope come from a running review or answer. In memory only.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import {
  formatSlackReviewerApiLogValue,
  summarizeSlackReviewerApiResult,
  SLACK_REVIEWER_API_ENDPOINTS,
  SLACK_REVIEWER_API_LOG_MAX,
  type SlackReviewerApiLogEntry,
  type SlackReviewerApiLogResponse,
  type SlackReviewerApiPhase,
} from "@locus/shared";
import { errorText } from "./reviewerHelpers.js";

interface Scope {
  phase: SlackReviewerApiPhase;
  reviewerId?: string;
}

export class ReviewerApiLog {
  private readonly entries: SlackReviewerApiLogEntry[] = [];
  private seq = 0;
  private readonly scopes = new AsyncLocalStorage<Scope>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly max = SLACK_REVIEWER_API_LOG_MAX,
  ) {}

  /** Run `fn` with its Slack and forge calls tagged with `phase` and `reviewerId`. */
  scope<T>(phase: SlackReviewerApiPhase, reviewerId: string | undefined, fn: () => T): T {
    return this.scopes.run({ phase, ...(reviewerId ? { reviewerId } : {}) }, fn);
  }

  /** Entries with `seq` above `after`, oldest first. */
  list(after = 0): SlackReviewerApiLogResponse {
    return {
      entries: this.entries.filter((row) => row.seq > after).map((row) => ({ ...row })),
      lastSeq: this.seq,
    };
  }

  /**
   * A copy of `target` whose function properties record each call. Other properties and the
   * `this` the methods see are the original's.
   */
  wrap<T extends object>(service: "slack" | "forge", target: T): T {
    return new Proxy(target, {
      get: (obj, prop, receiver) => {
        const value: unknown = Reflect.get(obj, prop, receiver);
        // Subscriptions are not API calls.
        if (typeof value !== "function" || typeof prop !== "string" || prop.startsWith("on"))
          return value;
        const fn = value as (...args: unknown[]) => unknown;
        return (...args: unknown[]) => this.call(service, prop, args, () => fn.apply(obj, args));
      },
    });
  }

  private call(
    service: "slack" | "forge",
    method: string,
    args: unknown[],
    run: () => unknown,
  ): unknown {
    const started = this.now();
    const done = (ok: boolean, value: unknown) =>
      this.record(service, method, args, started, ok, value);
    let result: unknown;
    try {
      result = run();
    } catch (err) {
      done(false, err);
      throw err;
    }
    if (result && typeof (result as Promise<unknown>).then === "function") {
      return (result as Promise<unknown>).then(
        (value) => {
          done(true, value);
          return value;
        },
        (err: unknown) => {
          done(false, err);
          throw err;
        },
      );
    }
    done(true, result);
    return result;
  }

  private record(
    service: "slack" | "forge",
    method: string,
    args: unknown[],
    started: number,
    ok: boolean,
    value: unknown,
  ): void {
    try {
      const scope = this.scopes.getStore();
      const request = formatSlackReviewerApiLogValue(args);
      const response = ok ? formatSlackReviewerApiLogValue(value) : undefined;
      const endpoint = SLACK_REVIEWER_API_ENDPOINTS[`${service}.${method}`];
      this.entries.push({
        seq: ++this.seq,
        at: new Date(started).toISOString(),
        durationMs: Math.max(0, this.now() - started),
        service,
        method,
        ...(endpoint ? { endpoint } : {}),
        phase: scope?.phase ?? "review",
        ...(scope?.reviewerId ? { reviewerId: scope.reviewerId } : {}),
        ok,
        request: request.text,
        summary: ok ? summarizeSlackReviewerApiResult(value) : errorText(value),
        ...(response ? { response: response.text } : {}),
        ...(request.truncated || response?.truncated ? { truncated: true } : {}),
      });
      if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
    } catch {
      /* Logging never breaks a call. */
    }
  }
}
