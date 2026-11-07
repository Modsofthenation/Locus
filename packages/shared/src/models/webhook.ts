import { wrapUntrusted } from "../untrusted.js";

const SECRET_KEY = /key|token|secret|password|passwd|auth|signature|bearer/i;
export const MAX_WEBHOOK_BYTES = 65_536;
export const EVENT_PROMPT_MAX = 8_192;
export const SLACK_NOTIFY_MAX = 3_500;
export const WEBHOOK_MAX_SKEW_SEC = 60 * 5;

export interface AutomationEvent {
  source: "generic" | "slack";
  text?: string;
  channel?: string;
  user?: string;
  eventId?: string;
  payload: Record<string, unknown>;
}

export function slackUrlChallenge(raw: string): string | undefined {
  try {
    const body = JSON.parse(raw) as { type?: unknown; challenge?: unknown };
    if (
      body.type === "url_verification" &&
      typeof body.challenge === "string" &&
      body.challenge.trim()
    ) {
      return body.challenge;
    }
  } catch {
    /* not JSON */
  }
  return undefined;
}

export function parseWebhookEvent(raw: string, contentType?: string): AutomationEvent {
  const payload = parseBody(raw, contentType);
  if (typeof payload.command === "string" && payload.command.trim()) {
    return {
      source: "slack",
      text: str(payload.text),
      channel: str(payload.channel_id) || str(payload.channel_name),
      user: str(payload.user_id) || str(payload.user_name),
      eventId: str(payload.trigger_id),
      payload: scrub(payload),
    };
  }
  if (payload.type === "event_callback" && payload.event && typeof payload.event === "object") {
    const ev = payload.event as Record<string, unknown>;
    return {
      source: "slack",
      text: str(ev.text),
      channel: str(ev.channel),
      user: str(ev.user),
      eventId: str(payload.event_id),
      payload: scrub(payload),
    };
  }
  return {
    source: "generic",
    text: str(payload.text) || str(payload.message),
    channel: str(payload.channel) || str(payload.channel_id),
    user: str(payload.user) || str(payload.user_id),
    eventId: str(payload.event_id) || str(payload.id),
    payload: scrub(payload),
  };
}

export function shouldSkipSlackEvent(event: AutomationEvent): boolean {
  if (event.source !== "slack") return false;
  const nested =
    event.payload.event && typeof event.payload.event === "object"
      ? (event.payload.event as Record<string, unknown>)
      : undefined;
  if (nested) {
    if (nested.bot_id || nested.subtype === "bot_message") return true;
    const type = str(nested.type);
    if (type && type !== "app_mention" && type !== "message") return true;
  }
  return false;
}

export function formatAutomationPrompt(prompt: string, event?: AutomationEvent): string {
  const base = prompt.trim();
  if (!event) return base;
  const json = JSON.stringify(
    {
      source: event.source,
      text: event.text,
      channel: event.channel,
      user: event.user,
      eventId: event.eventId,
      payload: event.payload,
    },
    null,
    2,
  );
  return `${base}

${wrapUntrusted({ kind: "webhook-event", text: json, maxBytes: EVENT_PROMPT_MAX })}`;
}

export function isSlackIncomingWebhookUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "hooks.slack.com" || host.endsWith(".hooks.slack.com");
  } catch {
    return false;
  }
}

export function slackNotifyBody(input: {
  name: string;
  status: string;
  trigger: string;
  error?: string;
  summary?: string;
}): { text: string; blocks: Array<{ type: string; text: { type: string; text: string } }> } {
  const summary = (input.summary ?? "").trim().slice(0, SLACK_NOTIFY_MAX);
  const lines = [`*${input.name}* — ${input.status} (${input.trigger})`];
  if (input.error) lines.push(`Error: ${input.error}`);
  if (summary) lines.push(summary);
  else if (!input.error) lines.push("Run finished.");
  const text = lines.join("\n");
  return {
    text,
    blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
  };
}

function parseBody(raw: string, contentType?: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  const form = (contentType ?? "").toLowerCase().includes("application/x-www-form-urlencoded");
  if (form) {
    const out: Record<string, unknown> = {};
    const params = new URLSearchParams(trimmed);
    for (const [key, value] of params.entries()) out[key] = value;
    return out;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return { text: trimmed.slice(0, EVENT_PROMPT_MAX) };
  }
}

function scrub(value: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    if (item && typeof item === "object" && !Array.isArray(item) && depth < 2) {
      out[key] = scrub(item as Record<string, unknown>, depth + 1);
    } else if (typeof item === "string") {
      out[key] = item.length > 2_000 ? `${item.slice(0, 2_000)}…` : item;
    } else if (typeof item === "number" || typeof item === "boolean" || item == null) {
      out[key] = item;
    }
  }
  return out;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function automationHookPath(id: string): string {
  return `/api/hooks/automations/${id}`;
}

export function automationHookUrl(
  id: string,
  opts?: { webhookBaseUrl?: string; bindHost?: string; bindPort?: number },
): string {
  const base = opts?.webhookBaseUrl?.replace(/\/+$/, "");
  if (base) return `${base}${automationHookPath(id)}`;
  const host = opts?.bindHost?.trim() || "127.0.0.1";
  const port = typeof opts?.bindPort === "number" && opts.bindPort > 0 ? opts.bindPort : 7420;
  return `http://${host}:${port}${automationHookPath(id)}`;
}

export function automationHookCurl(
  url: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  return [
    `curl -sS -X POST ${JSON.stringify(url)}`,
    `  -H "X-Locus-Secret: ${secret}"`,
    `  -H "X-Locus-Timestamp: ${timestamp}"`,
    `  -H "Content-Type: application/json"`,
    `  -d '{"text":"test"}'`,
  ].join(" \\\n");
}

/** Unix seconds (or ms) within WEBHOOK_MAX_SKEW_SEC of now. */
export function webhookTimestampValid(timestamp: string | undefined, nowMs = Date.now()): boolean {
  if (!timestamp?.trim()) return false;
  const n = Number(timestamp);
  if (!Number.isFinite(n)) return false;
  const seconds = n > 1e12 ? n / 1000 : n;
  return Math.abs(nowMs / 1000 - seconds) <= WEBHOOK_MAX_SKEW_SEC;
}
