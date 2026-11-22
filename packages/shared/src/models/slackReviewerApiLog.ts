/**
 * Live log of the Slack and forge API calls the Slack reviewer makes (channel polls, thread polls,
 * `autoReview` PR listing, and the calls a review makes), for the "Live logs" section of
 * Settings → Reviewers. Kept in memory on the server only; never saved.
 */

/** Which loop made the call. Calls made outside a poll (by a running review or answer) are `review`. */
export type SlackReviewerApiPhase = "channel" | "threads" | "autoReview" | "review";

/** One Slack or forge call, as `GET /api/slack/reviewers/logs` returns it. */
export interface SlackReviewerApiLogEntry {
  /** Increasing per process, so a client can ask only for newer entries. */
  seq: number;
  /** When the call started. */
  at: string;
  durationMs: number;
  service: "slack" | "forge";
  /** Client method, e.g. `peekHistory` or `listPulls`. */
  method: string;
  /** The HTTP API it stands for, e.g. `conversations.history`, when known. */
  endpoint?: string;
  phase: SlackReviewerApiPhase;
  reviewerId?: string;
  ok: boolean;
  /** Arguments as JSON, with credentials redacted and long values trimmed. */
  request: string;
  /** One line about the result, e.g. "12 items", or the error message. */
  summary: string;
  /** The response as JSON, redacted and trimmed. Absent on errors. */
  response?: string;
  /** `request` or `response` was cut to fit. */
  truncated?: boolean;
}

/** `GET /api/slack/reviewers/logs?after=<seq>`. */
export interface SlackReviewerApiLogResponse {
  entries: SlackReviewerApiLogEntry[];
  /** Highest `seq` handed out so far; pass it as `after` next time. */
  lastSeq: number;
}

/** Entries kept in memory. */
export const SLACK_REVIEWER_API_LOG_MAX = 300;
/** Longest `request` / `response` JSON kept per entry. */
export const SLACK_REVIEWER_API_LOG_TEXT_MAX = 4_000;

/** The HTTP API each client method stands for. */
export const SLACK_REVIEWER_API_ENDPOINTS: Record<string, string> = {
  "slack.peekHistory": "conversations.history",
  "slack.replies": "conversations.replies",
  "slack.post": "chat.postMessage",
  "slack.react": "reactions.add",
  "forge.listPulls": "GET pulls (open)",
  "forge.listRepos": "GET repos",
  "forge.getPull": "GET pull + diff",
  "forge.postReview": "POST review",
  "forge.compareCommits": "GET compare",
  "forge.readFile": "GET contents",
  "forge.getIssue": "GET issue",
  "forge.ciReport": "GET checks",
  "forge.resolveReviewThreads": "resolve threads",
  "forge.listBranches": "GET branches",
  "forge.createPull": "POST pull",
  "forge.commitFileToNewBranch": "commit file",
};

const SECRET_KEY = /token|secret|password|authorization|cookie|apikey|api_key|credential/i;

/**
 * JSON for the log: keys that look like credentials become "[redacted]", strings over 500 chars
 * are trimmed, and the whole text is cut at `max`.
 */
export function formatSlackReviewerApiLogValue(
  value: unknown,
  max = SLACK_REVIEWER_API_LOG_TEXT_MAX,
): { text: string; truncated: boolean } {
  let trimmed = false;
  const seen = new WeakSet<object>();
  let text: string;
  try {
    text =
      JSON.stringify(
        value,
        (key, raw: unknown) => {
          if (key && SECRET_KEY.test(key)) return raw === undefined ? undefined : "[redacted]";
          if (typeof raw === "string" && raw.length > 500) {
            trimmed = true;
            return `${raw.slice(0, 500)}… (${raw.length.toLocaleString("en-US")} chars)`;
          }
          if (typeof raw === "bigint") return raw.toString();
          if (typeof raw === "function") return undefined;
          if (raw && typeof raw === "object") {
            if (seen.has(raw)) return "[circular]";
            seen.add(raw);
          }
          return raw;
        },
        2,
      ) ?? "undefined";
  } catch {
    text = String(value);
  }
  if (text.length > max) return { text: `${text.slice(0, max)}\n… (trimmed)`, truncated: true };
  return { text, truncated: trimmed };
}

/** One line about a result: "12 items", "ok", or a few of its fields. */
export function summarizeSlackReviewerApiResult(value: unknown): string {
  if (value === undefined || value === null) return "ok";
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of ["state", "title", "ts", "number", "url"]) {
      const v = row[key];
      if (typeof v === "string" || typeof v === "number") {
        const s = String(v);
        parts.push(`${key}: ${s.length > 60 ? `${s.slice(0, 60)}…` : s}`);
      }
      if (parts.length >= 2) break;
    }
    return parts.length ? parts.join(" · ") : `${Object.keys(row).length} fields`;
  }
  return String(value);
}
