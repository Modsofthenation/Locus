import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  isEventSchedule,
  normalizeRepoUrl,
  parseWebhookEvent,
  shouldSkipSlackEvent,
  slackUrlChallenge,
  type Automation,
  type AutomationEvent,
  type AutomationTrigger,
} from "@locus/shared";

export type WebhookGateInput = {
  secret?: string;
  signature?: string;
  timestamp?: string;
  event?: string;
  raw: string;
  contentType?: string;
};

export type WebhookDecision =
  | { kind: "challenge"; challenge: string }
  | { kind: "ping" }
  | { kind: "skip" }
  | { kind: "reject"; message: string }
  | {
      kind: "queue";
      trigger: AutomationTrigger;
      event?: AutomationEvent;
      sha?: string;
      eventId?: string;
    };

export function webhookDedupeId(event: AutomationEvent, raw: string): string {
  if (event.eventId) return event.eventId;
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export function secretsEqual(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function hmacValid(secret: string, raw: string, signature: string | undefined): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const got = signature.slice("sha256=".length);
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(got, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function normalizeRef(ref?: string): string {
  return (ref ?? "").replace(/^refs\/heads\//, "").trim();
}

export function parseWebhookPayload(raw: string): {
  repoUrl?: string;
  ref?: string;
  sha?: string;
  deleted?: boolean;
} {
  if (!raw.trim()) return {};
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const repo =
      body.repository && typeof body.repository === "object"
        ? (body.repository as Record<string, unknown>)
        : undefined;
    const repoUrl =
      str(repo?.clone_url) ||
      str(repo?.html_url) ||
      str(
        repo?.links && typeof repo.links === "object"
          ? (repo.links as { html?: { href?: string } }).html?.href
          : undefined,
      );
    const push =
      body.push && typeof body.push === "object"
        ? (body.push as {
            changes?: Array<{
              new?: { name?: string; target?: { hash?: string } };
              old?: unknown;
              closed?: boolean;
            }>;
          })
        : undefined;
    const change = push?.changes?.[0];
    const ref = str(body.ref) || str(change?.new?.name);
    const sha = str(body.after) || str(change?.new?.target?.hash);
    const deleted =
      body.deleted === true ||
      Boolean(change?.closed) ||
      sha === "0000000000000000000000000000000000000000";
    return { repoUrl, ref, sha: deleted ? undefined : sha, deleted };
  } catch {
    return {};
  }
}

export function forgeRunEvent(
  kind: "forge" | "pull_request",
  payload: { sha?: string; ref?: string; repoUrl?: string },
): AutomationEvent {
  const short = payload.sha?.slice(0, 12);
  const text =
    kind === "pull_request"
      ? short
        ? `pull ${short}`
        : "pull request"
      : short
        ? `push ${short}`
        : "git push";
  return {
    source: "generic",
    text,
    eventId: payload.sha,
    payload: {
      ...(payload.sha ? { sha: payload.sha } : {}),
      ...(payload.ref ? { ref: payload.ref } : {}),
      ...(payload.repoUrl ? { repoUrl: payload.repoUrl } : {}),
    },
  };
}

export function locusWebhookAuthorized(
  webhookSecret: string | undefined,
  input: WebhookGateInput,
  timestampOk: boolean,
): boolean {
  if (!webhookSecret) return false;
  const hmacOk =
    hmacValid(webhookSecret, input.raw, input.signature) ||
    (timestampOk && hmacValid(webhookSecret, `${input.timestamp}.${input.raw}`, input.signature));
  const secretOk = secretsEqual(input.secret ?? "", webhookSecret) && timestampOk;
  return hmacOk || secretOk;
}

/** Headers+body → ping | challenge | skip | queue. Auth is a port. */
export function decideWebhook(input: {
  item: Automation;
  raw: string;
  contentType?: string;
  headerEvent?: string;
  lastWebhookEventId?: string;
}): WebhookDecision {
  const { item } = input;
  if (!isEventSchedule(item.schedule)) {
    return { kind: "reject", message: "This automation is not triggered by webhooks" };
  }
  const challenge = slackUrlChallenge(input.raw);
  if (challenge) return { kind: "challenge", challenge };
  const headerEvent = (input.headerEvent ?? "").toLowerCase();
  if (headerEvent === "ping") return { kind: "ping" };
  if (item.schedule.kind === "pull_request") {
    if (headerEvent && !/pull_request|merge_request|pullrequest/.test(headerEvent)) {
      return { kind: "skip" };
    }
  } else if (item.schedule.kind === "forge") {
    if (headerEvent && headerEvent !== "push" && headerEvent !== "repo:push") {
      return { kind: "skip" };
    }
  }
  if (item.schedule.kind === "forge" || item.schedule.kind === "pull_request") {
    const payload = parseWebhookPayload(input.raw);
    if (payload.deleted) return { kind: "skip" };
    if (
      item.repo?.url &&
      payload.repoUrl &&
      normalizeRepoUrl(payload.repoUrl) !== normalizeRepoUrl(item.repo.url)
    ) {
      return { kind: "reject", message: "Webhook repository does not match this automation" };
    }
    if (
      item.repo?.ref &&
      payload.ref &&
      normalizeRef(payload.ref) !== normalizeRef(item.repo.ref)
    ) {
      return { kind: "skip" };
    }
    const trigger = item.schedule.kind === "pull_request" ? "pull_request" : "forge";
    return {
      kind: "queue",
      trigger,
      sha: payload.sha,
      event: forgeRunEvent(trigger, payload),
    };
  }

  const event = parseWebhookEvent(input.raw, input.contentType);
  if (shouldSkipSlackEvent(event)) return { kind: "skip" };
  const eventId = webhookDedupeId(event, input.raw);
  if (eventId && eventId === (input.lastWebhookEventId ?? item.lastWebhookEventId)) {
    return { kind: "skip" };
  }
  return { kind: "queue", trigger: "webhook", event, eventId };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
