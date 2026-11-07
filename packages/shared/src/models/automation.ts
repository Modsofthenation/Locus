import type { RepoCheckout } from "./git.js";
import type { RepoMemory } from "./memory.js";
import type { AgentPlacement } from "./placement.js";
import type { AgentRuntime, GuestOs, HardwareOverride, NetworkJail } from "./vm.js";
import type { AutonomyTier } from "./autonomy.js";
import type { AutomationEvent } from "./webhook.js";

export type AutomationSchedule =
  | { kind: "interval"; everyMinutes: number }
  | {
      kind: "adaptive";
      startHour: number;
      startMinute: number;
      endHour: number;
      endMinute: number;
      everyMinutes: number;
      otherwiseEveryMinutes: number;
      /** Days the job may fire. Omit for every day. 0 = Sunday. */
      weekdays?: number[];
    }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number }
  | { kind: "cron"; expr: string }
  | { kind: "forge" }
  | { kind: "pull_request" }
  | { kind: "webhook" };

export type AutomationRunStatus =
  "queued" | "running" | "succeeded" | "failed" | "skipped" | "needs_you";
export type AutomationTrigger = "schedule" | "manual" | "forge" | "pull_request" | "webhook";
export type AutomationOverlap = "skip" | "coalesce" | "queue";

/** Per-job notify. When unset, the global failed-only switch still applies. */
export interface AutomationNotify {
  success: boolean;
  failure: boolean;
  needsYou: boolean;
}

/** One-line result stored on the run so it survives chat pruning. */
export const RUN_SUMMARY_MAX = 280;
export const OVERLAP_SKIP_REASON = "A run is already in progress";
export const LIFETIME_CAP_SKIP_REASON = "Lifetime spend cap reached";

export function isEventSchedule(schedule: AutomationSchedule): boolean {
  return (
    schedule.kind === "forge" || schedule.kind === "pull_request" || schedule.kind === "webhook"
  );
}

export function isClockSchedule(schedule: AutomationSchedule): boolean {
  return (
    schedule.kind === "daily" ||
    schedule.kind === "weekly" ||
    schedule.kind === "adaptive" ||
    schedule.kind === "cron"
  );
}

/** Skipped run written by Simulate trigger on the webhook card. No agent boots. */
export const TEST_WEBHOOK_SKIP_REASON = "Test POST accepted. No agent run.";

/** Leftover running/queued runs after a process restart. */
export const INTERRUPTED_AUTOMATION_RUN_NOTE = "Interrupted";

export function isTestWebhookSkip(run: Pick<AutomationRun, "status" | "error">): boolean {
  return run.status === "skipped" && run.error === TEST_WEBHOOK_SKIP_REASON;
}

/** Agent actually started, or a real succeed/fail. Test pings and overlap skips do not count. */
export function isAgentAutomationRun(
  run: Pick<AutomationRun, "status" | "sessionId" | "error">,
): boolean {
  if (isTestWebhookSkip(run)) return false;
  if (
    run.status === "succeeded" ||
    run.status === "failed" ||
    run.status === "needs_you" ||
    run.status === "running" ||
    run.status === "queued"
  ) {
    return true;
  }
  return Boolean(run.sessionId);
}

export function runHistoryStatusLabel(run: Pick<AutomationRun, "status" | "error">): string {
  return isTestWebhookSkip(run) ? "test" : run.status;
}

export function runStatusText(run: Pick<AutomationRun, "status" | "error">): string {
  const label = runHistoryStatusLabel(run);
  return label === "needs_you" ? "needs you" : label;
}

/** Desktop/Slack/webhook notify: never test pings. Per-job notify overrides the global switch. */
export function shouldNotifyAutomationOutcome(
  run: Pick<AutomationRun, "status" | "error">,
  failedOnly: boolean,
  notify?: AutomationNotify,
): boolean {
  if (isTestWebhookSkip(run)) return false;
  if (run.status === "skipped" || run.status === "queued" || run.status === "running") return false;
  if (notify) {
    if (run.status === "failed") return notify.failure;
    if (run.status === "succeeded") return notify.success;
    if (run.status === "needs_you") return notify.needsYou;
    return false;
  }
  if (run.status === "needs_you") return true;
  if (run.status === "failed") return true;
  if (failedOnly) return false;
  return run.status === "succeeded";
}

export const AUTOMATION_STARTER_IDS = ["nightly", "git-push", "slack-ops", "digest"] as const;
export type AutomationStarterId = (typeof AUTOMATION_STARTER_IDS)[number];

export interface AutomationStarter {
  id: AutomationStarterId;
  title: string;
  blurb: string;
  name: string;
  prompt: string;
  schedule: AutomationSchedule;
}

export const AUTOMATION_STARTERS: AutomationStarter[] = [
  {
    id: "nightly",
    title: "Nightly tests",
    blurb: "Daily after hours. Run the suite and report failures.",
    name: "Nightly tests",
    prompt:
      "Run the project's test suite. If anything fails, summarize the failures and the first stack traces. Do not push or open a pull request.",
    schedule: { kind: "daily", hour: 2, minute: 0 },
  },
  {
    id: "git-push",
    title: "Review on git push",
    blurb: "Webhook plus polling when a commit lands.",
    name: "Review on git push",
    prompt:
      "Review the latest push. Summarize the change, call out bugs and missing tests, and do not push or merge.",
    schedule: { kind: "forge" },
  },
  {
    id: "slack-ops",
    title: "Slack ops webhook",
    blurb: "POST from Slack or a pager. No git repo required.",
    name: "Ops webhook",
    prompt:
      "Research this event using allowlisted MCP tools. Return a short summary with links. Prefer reads. Do not post to Slack unless the prompt says so.",
    schedule: { kind: "webhook" },
  },
  {
    id: "digest",
    title: "Daily digest",
    blurb: "Morning summary of open work.",
    name: "Daily digest",
    prompt:
      "Summarize open pull requests, failing checks, and anything that needs a human today. Keep it short.",
    schedule: { kind: "daily", hour: 9, minute: 0 },
  },
];

export function automationStarterById(
  id: string | null | undefined,
): AutomationStarter | undefined {
  return AUTOMATION_STARTERS.find((row) => row.id === id);
}

export function nextCloneName(name: string, existing: string[]): string {
  const base = `${name.trim() || "Automation"} copy`;
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  prompt: string;
  os: GuestOs;
  templateId: string;
  runtime?: AgentRuntime;
  dockerImage?: string;
  /** Existing absolute folder host automations use as `/workspace`. */
  hostDir?: string;
  providerId: string;
  model: string;
  repo?: RepoCheckout;
  repoId?: string;
  hardware?: HardwareOverride;
  startVm: boolean;
  reuseSession?: boolean;
  /** Swarm teammate that owns this routine (optional). */
  ownerSessionId?: string;
  /** When set, the agent can save short facts that carry into later runs. */
  persistMemory?: boolean;
  /** Facts saved by `remember` when persistMemory is on. */
  memories?: RepoMemory[];
  imageId?: string;
  /** Named guest preset. Live fields overlay this job at run time. */
  namedEnvironmentId?: string;
  placement?: AgentPlacement;
  backendId?: string;
  network?: NetworkJail;
  schedule: AutomationSchedule;
  webhookSecret?: string;
  /** Per-automation Slack signing secret; falls back to Settings → Advanced. */
  slackSigningSecret?: string;
  notifyWebhook?: string;
  notifyChannel?: string;
  allowedMcpTools?: string[];
  allowHosts?: string[];
  maxUsd?: number;
  /** Stops the next fire once stored run spend reaches this total. Separate from the per-run cap. */
  lifetimeMaxUsd?: number;
  /** skip drops overlaps. coalesce runs the latest event once the current run finishes. queue keeps one visible waiting run. */
  overlap?: AutomationOverlap;
  /** IANA zone for clock fires and blackout dates. Omit to use the machine zone. */
  timeZone?: string;
  /** YYYY-MM-DD dates in `timeZone` (or the machine zone) that do not fire. */
  blackoutDates?: string[];
  /** When set, replaces the global automations failed-only switch for this job. */
  notify?: AutomationNotify;
  autonomy?: AutonomyTier;
  lastForgeSha?: string;
  lastWebhookEventId?: string;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  sessionId?: string;
  status: AutomationRunStatus;
  trigger: AutomationTrigger;
  error?: string;
  /** Why this run fired: schedule label, push sha, or webhook text. */
  reason?: string;
  /** Assistant result or the needs-you question. Survives chat pruning. */
  summary?: string;
  /** Scrubbed trigger payload for replay. */
  event?: AutomationEvent;
  /** Token spend snapshotted when the run finished. */
  spendUsd?: number;
  startedAt: string;
  finishedAt?: string;
}

export interface CreateAutomationInput {
  name: string;
  prompt: string;
  os: GuestOs;
  templateId: string;
  runtime?: AgentRuntime;
  dockerImage?: string;
  hostDir?: string;
  providerId: string;
  model: string;
  repo?: RepoCheckout;
  repoId?: string;
  hardware?: HardwareOverride;
  startVm?: boolean;
  reuseSession?: boolean;
  ownerSessionId?: string;
  persistMemory?: boolean;
  imageId?: string;
  namedEnvironmentId?: string;
  placement?: AgentPlacement;
  backendId?: string;
  network?: NetworkJail;
  enabled?: boolean;
  schedule: AutomationSchedule;
  notifyWebhook?: string;
  notifyChannel?: string;
  allowedMcpTools?: string[];
  allowHosts?: string[];
  maxUsd?: number;
  lifetimeMaxUsd?: number;
  overlap?: AutomationOverlap;
  timeZone?: string;
  blackoutDates?: string[];
  notify?: AutomationNotify;
  autonomy?: AutonomyTier;
}

export interface PatchAutomationInput {
  name?: string;
  prompt?: string;
  os?: GuestOs;
  templateId?: string;
  runtime?: AgentRuntime;
  dockerImage?: string | null;
  hostDir?: string | null;
  providerId?: string;
  model?: string;
  repo?: RepoCheckout | null;
  repoId?: string | null;
  hardware?: HardwareOverride | null;
  startVm?: boolean;
  reuseSession?: boolean;
  ownerSessionId?: string | null;
  persistMemory?: boolean;
  memories?: RepoMemory[] | null;
  imageId?: string | null;
  namedEnvironmentId?: string | null;
  placement?: AgentPlacement | null;
  backendId?: string | null;
  network?: NetworkJail | null;
  enabled?: boolean;
  schedule?: AutomationSchedule;
  slackSigningSecret?: string | null;
  notifyWebhook?: string | null;
  notifyChannel?: string | null;
  allowedMcpTools?: string[] | null;
  allowHosts?: string[] | null;
  maxUsd?: number | null;
  lifetimeMaxUsd?: number | null;
  overlap?: AutomationOverlap | null;
  timeZone?: string | null;
  blackoutDates?: string[] | null;
  notify?: AutomationNotify | null;
  autonomy?: AutonomyTier | null;
  /** Mint a new webhook secret. Event jobs only. */
  rotateWebhookSecret?: boolean;
}

export function routinesForTeammate(
  automations: Automation[],
  sessionId: string,
  limit = 8,
): Automation[] {
  const owned = automations.filter((row) => row.ownerSessionId === sessionId);
  const unowned = automations.filter((row) => !row.ownerSessionId);
  return [...owned, ...unowned].slice(0, limit);
}

export function cloneAutomationInput(item: Automation, name: string): CreateAutomationInput {
  return {
    name,
    prompt: item.prompt,
    os: item.os,
    templateId: item.templateId,
    runtime: item.runtime,
    dockerImage: item.dockerImage,
    hostDir: item.hostDir,
    providerId: item.providerId,
    model: item.model,
    repo: item.repo,
    repoId: item.repoId,
    hardware: item.hardware,
    startVm: item.startVm,
    reuseSession: item.reuseSession,
    ownerSessionId: item.ownerSessionId,
    persistMemory: item.persistMemory,
    imageId: item.imageId,
    namedEnvironmentId: item.namedEnvironmentId,
    placement: item.placement,
    backendId: item.backendId,
    network: item.network,
    enabled: item.enabled,
    schedule: item.schedule,
    notifyWebhook: item.notifyWebhook,
    notifyChannel: item.notifyChannel,
    allowedMcpTools: item.allowedMcpTools,
    allowHosts: item.allowHosts,
    maxUsd: item.maxUsd,
    lifetimeMaxUsd: item.lifetimeMaxUsd,
    overlap: item.overlap,
    timeZone: item.timeZone,
    blackoutDates: item.blackoutDates,
    notify: item.notify,
    autonomy: item.autonomy,
  };
}

export const SCHEDULE_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function formatClockTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseClockTime(value: string): { hour: number; minute: number } {
  const parts = value.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  return { hour: Number.isFinite(h) ? h : 9, minute: Number.isFinite(m) ? m : 0 };
}

/** Form fields for a clock, forge, or webhook schedule. Both editors call this. */
export interface AutomationScheduleDraft {
  kind: AutomationSchedule["kind"];
  everyMinutes?: number;
  otherwiseEveryMinutes?: number;
  time?: string;
  windowStart?: string;
  windowEnd?: string;
  weekday?: number;
  weekdays?: number[];
  cronExpr?: string;
}

export function buildAutomationSchedule(draft: AutomationScheduleDraft): AutomationSchedule {
  const kind = draft.kind;
  if (kind === "forge" || kind === "pull_request" || kind === "webhook") return { kind };
  if (kind === "cron") return { kind, expr: draft.cronExpr ?? "" };
  if (kind === "interval") return { kind, everyMinutes: draft.everyMinutes ?? 0 };
  if (kind === "adaptive") {
    const start = parseClockTime(draft.windowStart ?? "09:00");
    const end = parseClockTime(draft.windowEnd ?? "17:00");
    const picked = [...new Set(draft.weekdays ?? [])].sort((a, b) => a - b);
    return {
      kind,
      startHour: start.hour,
      startMinute: start.minute,
      endHour: end.hour,
      endMinute: end.minute,
      everyMinutes: draft.everyMinutes ?? 0,
      otherwiseEveryMinutes: draft.otherwiseEveryMinutes ?? 0,
      ...(picked.length && picked.length < 7 ? { weekdays: picked } : {}),
    };
  }
  const { hour, minute } = parseClockTime(draft.time ?? "09:00");
  if (kind === "weekly") return { kind, weekday: draft.weekday ?? 1, hour, minute };
  return { kind: "daily", hour, minute };
}

function validClock(hour: number, minute: number): boolean {
  return (
    Number.isInteger(hour) &&
    Number.isInteger(minute) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59
  );
}

function validIntervalMinutes(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

export function validateSchedule(schedule: AutomationSchedule): string | undefined {
  if (schedule.kind === "forge" || schedule.kind === "pull_request" || schedule.kind === "webhook")
    return undefined;
  if (schedule.kind === "cron") {
    return parseCronExpr(schedule.expr) ? undefined : "Cron must be 5 fields: m h dom mon dow";
  }
  if (schedule.kind === "interval") {
    if (!validIntervalMinutes(schedule.everyMinutes)) {
      return "Interval must be at least 1 minute";
    }
    return undefined;
  }
  if (schedule.kind === "adaptive") {
    if (!validClock(schedule.startHour, schedule.startMinute)) {
      return "Window start must be a valid hour and minute";
    }
    if (!validClock(schedule.endHour, schedule.endMinute)) {
      return "Window end must be a valid hour and minute";
    }
    if (schedule.startHour === schedule.endHour && schedule.startMinute === schedule.endMinute) {
      return "Window start and end must differ";
    }
    if (!validIntervalMinutes(schedule.everyMinutes)) {
      return "Window interval must be at least 1 minute";
    }
    if (!validIntervalMinutes(schedule.otherwiseEveryMinutes)) {
      return "Otherwise interval must be at least 1 minute";
    }
    if (schedule.weekdays) {
      if (!schedule.weekdays.length) return "Pick at least one weekday";
      const seen = new Set<number>();
      for (const day of schedule.weekdays) {
        if (!Number.isInteger(day) || day < 0 || day > 6) return "Weekdays must be 0–6";
        if (seen.has(day)) return "Weekdays must be unique";
        seen.add(day);
      }
    }
    return undefined;
  }
  if (schedule.hour < 0 || schedule.hour > 23 || schedule.minute < 0 || schedule.minute > 59) {
    return "Time must be a valid hour and minute";
  }
  if (schedule.kind === "weekly" && (schedule.weekday < 0 || schedule.weekday > 6)) {
    return "Weekday must be 0–6";
  }
  return undefined;
}

export interface ScheduleFireOpts {
  /** IANA zone. Omit to use this machine’s local zone. */
  timeZone?: string;
  /** YYYY-MM-DD dates that do not fire, in `timeZone` or local time. */
  blackoutDates?: string[];
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

interface ZoneClock {
  get(date: Date): WallClock;
  at(wall: WallClock): Date;
}

interface CronSpec {
  minute: number[];
  hour: number[];
  dom: number[];
  month: number[];
  dow: number[];
  domAny: boolean;
  dowAny: boolean;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function hostClock(): ZoneClock {
  return {
    get(date) {
      return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
        weekday: date.getDay(),
      };
    },
    at(wall) {
      return new Date(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0, 0);
    },
  };
}

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = zoneFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    zoneFormatters.set(timeZone, fmt);
  }
  return fmt;
}

function zonedClock(timeZone: string): ZoneClock {
  const clock: ZoneClock = {
    get(date) {
      const parts = zoneFormatter(timeZone).formatToParts(date);
      const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
      let hour = Number(pick("hour"));
      if (hour === 24) hour = 0;
      const weekday = WEEKDAY_SHORT.indexOf(pick("weekday") as (typeof WEEKDAY_SHORT)[number]);
      return {
        year: Number(pick("year")),
        month: Number(pick("month")),
        day: Number(pick("day")),
        hour,
        minute: Number(pick("minute")),
        weekday: weekday < 0 ? 0 : weekday,
      };
    },
    at(wall) {
      let utc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0, 0);
      for (let i = 0; i < 6; i += 1) {
        const got = clock.get(new Date(utc));
        const diff =
          Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) -
          Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute);
        if (diff === 0) return new Date(utc);
        utc += diff;
      }
      return new Date(utc);
    },
  };
  return clock;
}

function clockFor(timeZone?: string): ZoneClock {
  if (!timeZone) return hostClock();
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return zonedClock(timeZone);
  } catch {
    return hostClock();
  }
}

function ymd(wall: WallClock): string {
  return `${wall.year}-${String(wall.month).padStart(2, "0")}-${String(wall.day).padStart(2, "0")}`;
}

function addCalendarDays(wall: WallClock, days: number): WallClock {
  const utc = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
    hour: wall.hour,
    minute: wall.minute,
    weekday: utc.getUTCDay(),
  };
}

function addWallMinutes(wall: WallClock, minutes: number): WallClock {
  const utc = new Date(
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute + minutes),
  );
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
    hour: utc.getUTCHours(),
    minute: utc.getUTCMinutes(),
    weekday: utc.getUTCDay(),
  };
}

function sameMinute(a: WallClock, b: WallClock): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute
  );
}

function parseCronField(field: string, min: number, max: number): number[] | undefined {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    if (!part) return undefined;
    const slash = part.split("/");
    if (slash.length > 2) return undefined;
    const step = slash.length === 2 ? Number(slash[1]) : 1;
    if (!Number.isInteger(step) || step < 1) return undefined;
    const base = slash[0] ?? "";
    let start = min;
    let end = max;
    if (base === "*") {
      start = min;
      end = max;
    } else if (base.includes("-")) {
      const bits = base.split("-");
      if (bits.length !== 2) return undefined;
      start = Number(bits[0]);
      end = Number(bits[1]);
    } else {
      start = Number(base);
      end = start;
    }
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < min ||
      end > max ||
      start > end
    ) {
      return undefined;
    }
    for (let n = start; n <= end; n += step) values.add(n);
  }
  return values.size ? [...values].sort((a, b) => a - b) : undefined;
}

/** Five-field cron. Day-of-month and day-of-week both restricted means either may match. 7 is Sunday. */
export function parseCronExpr(expr: string): CronSpec | undefined {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return undefined;
  const minute = parseCronField(parts[0]!, 0, 59);
  const hour = parseCronField(parts[1]!, 0, 23);
  const dom = parseCronField(parts[2]!, 1, 31);
  const month = parseCronField(parts[3]!, 1, 12);
  const dowRaw = parseCronField(parts[4]!, 0, 7);
  if (!minute || !hour || !dom || !month || !dowRaw) return undefined;
  const dow = [...new Set(dowRaw.map((day) => (day === 7 ? 0 : day)))].sort((a, b) => a - b);
  return {
    minute,
    hour,
    dom,
    month,
    dow,
    domAny: parts[2] === "*",
    dowAny: parts[4] === "*",
  };
}

function cronMatches(spec: CronSpec, wall: WallClock): boolean {
  if (!spec.minute.includes(wall.minute)) return false;
  if (!spec.hour.includes(wall.hour)) return false;
  if (!spec.month.includes(wall.month)) return false;
  const domOk = spec.dom.includes(wall.day);
  const dowOk = spec.dow.includes(wall.weekday);
  if (spec.domAny && spec.dowAny) return true;
  if (spec.domAny) return dowOk;
  if (spec.dowAny) return domOk;
  return domOk || dowOk;
}

function nextCron(expr: string, from: Date, clock: ZoneClock): Date {
  const spec = parseCronExpr(expr);
  if (!spec) throw new Error("Cron must be 5 fields: m h dom mon dow");
  let wall = addWallMinutes(clock.get(from), 1);
  for (let i = 0; i < 366 * 24 * 60; i += 1) {
    if (cronMatches(spec, wall)) {
      const at = clock.at(wall);
      if (sameMinute(clock.get(at), wall) && at.getTime() > from.getTime()) return at;
    }
    wall = addWallMinutes(wall, 1);
  }
  throw new Error("No matching cron time in the next year");
}

function nextDaily(hour: number, minute: number, from: Date, clock: ZoneClock): Date {
  const wall = clock.get(from);
  let at = clock.at({ ...wall, hour, minute });
  if (at.getTime() <= from.getTime()) {
    at = clock.at({ ...addCalendarDays(wall, 1), hour, minute });
  }
  return at;
}

function nextWeekly(
  weekday: number,
  hour: number,
  minute: number,
  from: Date,
  clock: ZoneClock,
): Date {
  const wall = clock.get(from);
  const delta = (weekday - wall.weekday + 7) % 7;
  let day = addCalendarDays(wall, delta);
  let at = clock.at({ ...day, hour, minute });
  if (at.getTime() <= from.getTime()) {
    day = addCalendarDays(day, 7);
    at = clock.at({ ...day, hour, minute });
  }
  return at;
}

export function computeNextRunAt(
  schedule: AutomationSchedule,
  from: Date = new Date(),
  opts?: ScheduleFireOpts,
): Date {
  const err = validateSchedule(schedule);
  if (err) throw new Error(err);
  if (
    schedule.kind === "forge" ||
    schedule.kind === "pull_request" ||
    schedule.kind === "webhook"
  ) {
    throw new Error("Event automations do not use a clock schedule");
  }
  const clock = clockFor(opts?.timeZone);
  const blackouts = new Set(
    (opts?.blackoutDates ?? []).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row)),
  );
  let cursor = from;
  for (let i = 0; i < 400; i += 1) {
    const next = nextUnchecked(schedule, cursor, clock);
    if (!blackouts.has(ymd(clock.get(next)))) return next;
    const nextDay = addCalendarDays({ ...clock.get(next), hour: 0, minute: 0 }, 1);
    cursor = new Date(clock.at(nextDay).getTime() - 1);
  }
  throw new Error("No run falls outside blackout dates");
}

function nextUnchecked(schedule: AutomationSchedule, from: Date, clock: ZoneClock): Date {
  if (schedule.kind === "interval") {
    return new Date(from.getTime() + schedule.everyMinutes * 60_000);
  }
  if (schedule.kind === "adaptive") return nextAdaptiveRunAt(schedule, from, clock);
  if (schedule.kind === "cron") return nextCron(schedule.expr, from, clock);
  if (schedule.kind === "daily") return nextDaily(schedule.hour, schedule.minute, from, clock);
  if (schedule.kind === "weekly") {
    return nextWeekly(schedule.weekday, schedule.hour, schedule.minute, from, clock);
  }
  throw new Error("Event automations do not use a clock schedule");
}

function formatEveryPhrase(everyMinutes: number): string {
  if (everyMinutes === 60) return "Every hour";
  if (everyMinutes % 60 === 0) return `Every ${everyMinutes / 60} hours`;
  return `Every ${everyMinutes} minutes`;
}

function formatEveryLower(everyMinutes: number): string {
  return formatEveryPhrase(everyMinutes).replace(/^Every /, "every ");
}

function formatWeekdayList(days: number[] | undefined): string {
  if (!days?.length) return "";
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const key = sorted.join(",");
  if (key === "1,2,3,4,5") return " on weekdays";
  if (key === "0,6") return " on weekends";
  return ` on ${sorted.map((day) => WEEKDAY_SHORT[day] ?? "day").join(", ")}`;
}

function clockMinutes(hour: number, minute: number): number {
  return hour * 60 + minute;
}

function weekdayAllowed(schedule: { weekdays?: number[] }, weekday: number): boolean {
  return !schedule.weekdays?.length || schedule.weekdays.includes(weekday);
}

function inAdaptiveWindow(
  schedule: Extract<AutomationSchedule, { kind: "adaptive" }>,
  at: Date,
  clock: ZoneClock,
): boolean {
  const wall = clock.get(at);
  if (!weekdayAllowed(schedule, wall.weekday)) return false;
  const t = clockMinutes(wall.hour, wall.minute);
  const start = clockMinutes(schedule.startHour, schedule.startMinute);
  const end = clockMinutes(schedule.endHour, schedule.endMinute);
  if (start < end) return t >= start && t < end;
  return t >= start || t < end;
}

function nextAdaptiveWindowStart(
  schedule: Extract<AutomationSchedule, { kind: "adaptive" }>,
  from: Date,
  clock: ZoneClock,
): Date {
  let cursor = from;
  for (let i = 0; i < 8; i += 1) {
    const wall = clock.get(cursor);
    let start = clock.at({ ...wall, hour: schedule.startHour, minute: schedule.startMinute });
    if (start.getTime() <= cursor.getTime()) {
      start = clock.at({
        ...addCalendarDays(wall, 1),
        hour: schedule.startHour,
        minute: schedule.startMinute,
      });
    }
    if (weekdayAllowed(schedule, clock.get(start).weekday)) return start;
    cursor = start;
  }
  const wall = clock.get(from);
  return clock.at({
    ...addCalendarDays(wall, 1),
    hour: schedule.startHour,
    minute: schedule.startMinute,
  });
}

function adaptiveWindowEnd(
  schedule: Extract<AutomationSchedule, { kind: "adaptive" }>,
  from: Date,
  clock: ZoneClock,
): Date {
  const wall = clock.get(from);
  const startM = clockMinutes(schedule.startHour, schedule.startMinute);
  const endM = clockMinutes(schedule.endHour, schedule.endMinute);
  const t = clockMinutes(wall.hour, wall.minute);
  if (startM < endM) {
    let end = clock.at({ ...wall, hour: schedule.endHour, minute: schedule.endMinute });
    if (end.getTime() <= from.getTime()) {
      end = clock.at({
        ...addCalendarDays(wall, 1),
        hour: schedule.endHour,
        minute: schedule.endMinute,
      });
    }
    return end;
  }
  if (t >= startM) {
    return clock.at({
      ...addCalendarDays(wall, 1),
      hour: schedule.endHour,
      minute: schedule.endMinute,
    });
  }
  return clock.at({ ...wall, hour: schedule.endHour, minute: schedule.endMinute });
}

function nextAdaptiveRunAt(
  schedule: Extract<AutomationSchedule, { kind: "adaptive" }>,
  from: Date,
  clock: ZoneClock,
): Date {
  if (!weekdayAllowed(schedule, clock.get(from).weekday)) {
    return nextAdaptiveWindowStart(schedule, from, clock);
  }
  const inWindow = inAdaptiveWindow(schedule, from, clock);
  const every = inWindow ? schedule.everyMinutes : schedule.otherwiseEveryMinutes;
  const candidate = new Date(from.getTime() + every * 60_000);
  const next = inWindow
    ? candidate.getTime() < adaptiveWindowEnd(schedule, from, clock).getTime()
      ? candidate
      : adaptiveWindowEnd(schedule, from, clock)
    : (() => {
        const windowStart = nextAdaptiveWindowStart(schedule, from, clock);
        return windowStart.getTime() < candidate.getTime() ? windowStart : candidate;
      })();
  if (!weekdayAllowed(schedule, clock.get(next).weekday)) {
    return nextAdaptiveWindowStart(schedule, next, clock);
  }
  return next;
}

export function formatRunDuration(
  startedAt: string,
  finishedAt?: string,
  nowMs = Date.now(),
): string | undefined {
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return undefined;
  const end = finishedAt ? Date.parse(finishedAt) : nowMs;
  if (Number.isNaN(end) || end < start) return undefined;
  const sec = Math.round((end - start) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem ? `${min}m ${rem}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  return rem || min % 60 ? `${hr}h ${min % 60}m` : `${hr}h`;
}

export function automationMatchesQuery(
  item: Pick<Automation, "name" | "prompt" | "schedule" | "repo" | "repoId">,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    item.name,
    item.prompt,
    formatSchedule(item.schedule),
    item.schedule.kind.replace("_", " "),
    item.repo?.url,
    item.repoId,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function formatSchedule(schedule: AutomationSchedule): string {
  if (schedule.kind === "forge") return "On git push";
  if (schedule.kind === "pull_request") return "On pull request";
  if (schedule.kind === "webhook") return "On webhook";
  if (schedule.kind === "cron") return `Cron ${schedule.expr.trim()}`;
  if (schedule.kind === "interval") return formatEveryPhrase(schedule.everyMinutes);
  if (schedule.kind === "adaptive") {
    const start = formatClockTime(schedule.startHour, schedule.startMinute);
    const end = formatClockTime(schedule.endHour, schedule.endMinute);
    return `${formatEveryPhrase(schedule.everyMinutes)} ${start}–${end}${formatWeekdayList(schedule.weekdays)}, otherwise ${formatEveryLower(schedule.otherwiseEveryMinutes)}`;
  }
  const time = formatClockTime(schedule.hour, schedule.minute);
  if (schedule.kind === "daily") return `Daily at ${time}`;
  return `Weekly on ${SCHEDULE_WEEKDAYS[schedule.weekday] ?? "day"} at ${time}`;
}

export function normalizeTimeZone(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
  } catch {
    throw new Error("Unknown timezone");
  }
  return trimmed;
}

export function normalizeBlackoutDates(values: string[] | null | undefined): string[] | undefined {
  if (values == null) return undefined;
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Blackout dates must be YYYY-MM-DD");
    const [year, month, day] = value.split("-").map(Number);
    const utc = new Date(Date.UTC(year!, month! - 1, day));
    if (
      utc.getUTCFullYear() !== year ||
      utc.getUTCMonth() !== month! - 1 ||
      utc.getUTCDate() !== day
    ) {
      throw new Error("Blackout dates must be YYYY-MM-DD");
    }
    if (!out.includes(value)) out.push(value);
    if (out.length > 90) throw new Error("At most 90 blackout dates");
  }
  return out.length ? out.sort() : undefined;
}

export function normalizeOverlap(value: unknown): AutomationOverlap | undefined {
  if (value == null || value === "") return undefined;
  if (value === "skip" || value === "coalesce" || value === "queue") return value;
  throw new Error("Overlap must be skip, coalesce, or queue");
}

export function normalizeNotify(value: unknown): AutomationNotify | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== "object") {
    throw new Error("Notify must list success, failure, and needs you");
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.success !== "boolean" ||
    typeof row.failure !== "boolean" ||
    typeof row.needsYou !== "boolean"
  ) {
    throw new Error("Notify must list success, failure, and needs you");
  }
  return { success: row.success, failure: row.failure, needsYou: row.needsYou };
}

export function automationScheduleOpts(
  item: Pick<Automation, "timeZone" | "blackoutDates">,
): ScheduleFireOpts {
  return {
    ...(item.timeZone ? { timeZone: item.timeZone } : {}),
    ...(item.blackoutDates?.length ? { blackoutDates: item.blackoutDates } : {}),
  };
}

export function automationRunReason(
  trigger: AutomationTrigger,
  event?: AutomationEvent,
  schedule?: AutomationSchedule,
): string {
  const text = event?.text?.trim();
  if (text) return text.length > 80 ? `${text.slice(0, 79)}…` : text;
  if (event?.eventId) return event.eventId.slice(0, 12);
  if (trigger === "manual") return "Manual";
  if (trigger === "schedule" && schedule) return formatSchedule(schedule);
  if (trigger === "forge") return "Git push";
  if (trigger === "pull_request") return "Pull request";
  return "Webhook";
}

export function automationLifetimeSpendUsd(
  runs: Array<Pick<AutomationRun, "id" | "automationId" | "spendUsd">>,
  automationId: string,
): number {
  let total = 0;
  const seen = new Set<string>();
  for (const run of runs) {
    if (run.automationId !== automationId || seen.has(run.id)) continue;
    seen.add(run.id);
    if (typeof run.spendUsd === "number" && Number.isFinite(run.spendUsd) && run.spendUsd > 0) {
      total += run.spendUsd;
    }
  }
  return total;
}

export function overLifetimeCap(lifetimeMaxUsd: number | undefined, total: number): boolean {
  return typeof lifetimeMaxUsd === "number" && lifetimeMaxUsd > 0 && total >= lifetimeMaxUsd;
}

export function localTimezoneLabel(
  now = new Date(),
  timeZone?: string,
): { iana: string; short: string; chip: string } {
  const iana = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: iana,
    timeZoneName: "short",
  }).formatToParts(now);
  const short = parts.find((p) => p.type === "timeZoneName")?.value ?? iana;
  return { iana, short, chip: `Local time (${short})` };
}

export function formatLocalTimezone(now = new Date(), timeZone?: string): string {
  const { iana, short } = localTimezoneLabel(now, timeZone);
  return short === iana ? iana : `${short} · ${iana}`;
}

/** New chats per automation when Reuse is off. A 1-minute job then keeps about an hour. */
export const MAX_AUTOMATION_CHATS = 60;

export interface AutomationChatRef {
  id: string;
  automationId?: string;
  pinned?: boolean;
  status: string;
  createdAt: string;
}

/**
 * Oldest chats for this automation that should be deleted so the job stays at `max`.
 * Pinned chats, in-flight chats, and `keepId` (the current run) are never returned.
 */
export function automationChatIdsToPrune(
  sessions: AutomationChatRef[],
  automationId: string,
  keepId?: string,
  max = MAX_AUTOMATION_CHATS,
): string[] {
  if (!automationId || max < 1) return [];
  const mine = sessions.filter((session) => session.automationId === automationId);
  const excess = mine.length - max;
  if (excess <= 0) return [];
  const droppable = mine
    .filter(
      (session) =>
        session.id !== keepId &&
        !session.pinned &&
        session.status !== "running" &&
        session.status !== "provisioning",
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return droppable.slice(0, excess).map((session) => session.id);
}
