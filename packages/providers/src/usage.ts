import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  isClaudeCodeProvider,
  isCodexCliProvider,
  isCursorCliProvider,
  isKiroCliProvider,
  type AiProvider,
  type ProviderUsage,
  type ProviderUsageSource,
  type ProviderUsageWindow,
} from "@locus/shared";
import type { CursorCliSpawner } from "./cursorCli.js";
import { spawnCursorCli } from "./cursorCli.js";
import { resolveKiroCliCommand } from "./kiroCli.js";

/**
 * Reads plan / quota usage for local agent CLIs from the same account each CLI
 * is signed in with. Tokens are read from the CLI's own credential store, sent
 * only to that vendor's own endpoint, and never returned to callers.
 */
export interface ProviderUsageDeps {
  fetchFn?: typeof fetch;
  spawnFn?: CursorCliSpawner;
  readText?: (path: string) => Promise<string | undefined>;
  listDir?: (path: string) => Promise<string[]>;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
  now?: () => Date;
}

type Resolved = Required<ProviderUsageDeps>;

const FETCH_TIMEOUT_MS = 10_000;
const KIRO_USAGE_TIMEOUT_MS = 20_000;
const KEYCHAIN_TIMEOUT_MS = 5_000;
const CODEX_SESSION_FILES = 8;

export const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export const CURSOR_USAGE_URL = "https://cursor.com/api/usage-summary";

export { isUsageCapableProvider } from "@locus/shared";

export async function readProviderUsage(
  provider: AiProvider,
  deps: ProviderUsageDeps = {},
): Promise<ProviderUsage> {
  const d = resolveDeps(deps);
  const base = {
    providerId: provider.id,
    providerName: provider.name,
    kind: provider.kind,
  };
  try {
    let body: UsageBody;
    if (isCodexCliProvider(provider)) body = await codexUsage(provider, d);
    else if (isClaudeCodeProvider(provider)) body = await claudeUsage(provider, d);
    else if (isCursorCliProvider(provider)) body = await cursorUsage(d);
    else if (isKiroCliProvider(provider)) body = await kiroUsage(provider, d);
    else
      body = unavailable("Usage is only available for Codex, Claude Code, Cursor and Kiro CLIs.");
    return { ...base, ...body, fetchedAt: d.now().toISOString() };
  } catch (err) {
    return {
      ...base,
      ...unavailable(err instanceof Error ? err.message : String(err)),
      fetchedAt: d.now().toISOString(),
    };
  }
}

type UsageBody = Pick<ProviderUsage, "ok" | "source" | "windows"> &
  Partial<Pick<ProviderUsage, "plan" | "message">>;

function unavailable(message: string, source: ProviderUsageSource = "none"): UsageBody {
  return { ok: false, source, windows: [], message };
}

function resolveDeps(deps: ProviderUsageDeps): Resolved {
  const env = deps.env ?? process.env;
  return {
    fetchFn: deps.fetchFn ?? fetch,
    spawnFn: deps.spawnFn ?? spawnCursorCli,
    readText:
      deps.readText ??
      (async (path) => {
        try {
          return await readFile(path, "utf8");
        } catch {
          return undefined;
        }
      }),
    listDir:
      deps.listDir ??
      (async (path) => {
        try {
          return await readdir(path);
        } catch {
          return [];
        }
      }),
    env,
    platform: deps.platform ?? process.platform,
    home: deps.home ?? env.HOME ?? env.USERPROFILE ?? homedir(),
    now: deps.now ?? (() => new Date()),
  };
}

function hasProviderKey(provider: Pick<AiProvider, "apiKey">): boolean {
  const key = provider.apiKey?.trim();
  return Boolean(key && !key.includes("•"));
}

function apiKeyBilling(name: string): UsageBody {
  return {
    ok: true,
    source: "none",
    windows: [],
    message: `${name} is using an API key, so usage is billed per token with no plan quota.`,
  };
}

// ---------------------------------------------------------------- Codex CLI

async function codexUsage(provider: AiProvider, d: Resolved): Promise<UsageBody> {
  if (hasProviderKey(provider)) return apiKeyBilling("Codex CLI");
  const codexHome = d.env.CODEX_HOME?.trim() || join(d.home, ".codex");
  const auth = parseJson(await d.readText(join(codexHome, "auth.json")));
  const tokens = asRecord(auth?.tokens);
  const accessToken = str(tokens?.access_token);
  const accountId = str(tokens?.account_id);
  let oauthError: string | undefined;
  if (accessToken) {
    try {
      const body = await fetchJson(d, CODEX_USAGE_URL, {
        Authorization: `Bearer ${accessToken}`,
        ...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
      });
      const parsed = parseCodexOauthUsage(body, d.now());
      if (parsed.windows.length || parsed.plan) return parsed;
    } catch (err) {
      oauthError = err instanceof Error ? err.message : String(err);
    }
  } else if (str(auth?.OPENAI_API_KEY)) {
    return apiKeyBilling("Codex CLI");
  }
  const fromLogs = await codexUsageFromSessions(codexHome, d);
  if (fromLogs) return fromLogs;
  if (oauthError) return unavailable(`Codex usage request failed: ${oauthError}`, "oauth");
  return unavailable("Codex CLI is not signed in with ChatGPT. Run `codex login`.");
}

export function parseCodexOauthUsage(body: unknown, now: Date): UsageBody {
  const root = asRecord(body);
  const rateLimit = asRecord(root?.rate_limit);
  const windows: ProviderUsageWindow[] = [];
  for (const [key, fallback] of [
    ["primary_window", "primary"],
    ["secondary_window", "secondary"],
  ] as const) {
    const w = asRecord(rateLimit?.[key]);
    if (!w) continue;
    const minutes = toMinutes(num(w.limit_window_seconds));
    windows.push({
      id: windowId(minutes, fallback),
      label: windowLabel(minutes, fallback),
      usedPercent: num(w.used_percent),
      resetsAt: epochToIso(num(w.reset_at)) ?? secondsFromNow(num(w.reset_after_seconds), now),
      ...(minutes ? { windowMinutes: minutes } : {}),
      unit: "percent",
    });
  }
  const credits = asRecord(root?.credits);
  const balance = num(credits?.balance) ?? numString(credits?.balance);
  if (credits?.has_credits === true && balance != null && credits.unlimited !== true) {
    windows.push({ id: "credits", label: "Credits left", used: balance, unit: "credits" });
  }
  const plan = titleCase(str(root?.plan_type));
  return { ok: true, source: "oauth", windows, ...(plan ? { plan } : {}) };
}

async function codexUsageFromSessions(
  codexHome: string,
  d: Resolved,
): Promise<UsageBody | undefined> {
  const files = await newestCodexRollouts(join(codexHome, "sessions"), d);
  for (const file of files) {
    const text = await d.readText(file);
    if (!text) continue;
    const parsed = parseCodexSessionRateLimits(text);
    if (parsed) return parsed;
  }
  return undefined;
}

async function newestCodexRollouts(root: string, d: Resolved): Promise<string[]> {
  const out: string[] = [];
  const desc = (rows: string[]) => [...rows].sort().reverse();
  for (const year of desc(await d.listDir(root))) {
    for (const month of desc(await d.listDir(join(root, year)))) {
      for (const day of desc(await d.listDir(join(root, year, month)))) {
        const dir = join(root, year, month, day);
        const rollouts = desc((await d.listDir(dir)).filter((f) => f.endsWith(".jsonl")));
        for (const name of rollouts) {
          out.push(join(dir, name));
          if (out.length >= CODEX_SESSION_FILES) return out;
        }
      }
    }
  }
  return out;
}

/** Latest `token_count` event carrying `rate_limits` in a Codex rollout log. */
export function parseCodexSessionRateLimits(text: string): UsageBody | undefined {
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.includes("rate_limits")) continue;
    const row = parseJson(line);
    const payload = asRecord(row?.payload) ?? row;
    const limits = asRecord(payload?.rate_limits);
    if (!limits) continue;
    const at = str(row?.timestamp);
    const seenAt = at && !Number.isNaN(Date.parse(at)) ? new Date(at) : undefined;
    const windows: ProviderUsageWindow[] = [];
    for (const key of ["primary", "secondary"] as const) {
      const w = asRecord(limits[key]);
      if (!w) continue;
      const minutes = num(w.window_minutes);
      const resetsAt =
        epochToIso(num(w.resets_at)) ??
        (seenAt ? secondsFromNow(num(w.resets_in_seconds), seenAt) : undefined);
      windows.push({
        id: windowId(minutes, key),
        label: windowLabel(minutes, key),
        usedPercent: num(w.used_percent),
        ...(resetsAt ? { resetsAt } : {}),
        ...(minutes ? { windowMinutes: minutes } : {}),
        unit: "percent",
      });
    }
    if (!windows.length) continue;
    const plan = titleCase(str(limits.plan_type));
    return {
      ok: true,
      source: "session-log",
      windows,
      ...(plan ? { plan } : {}),
      message: seenAt
        ? `From your last Codex session (${seenAt.toISOString()}).`
        : "From your last Codex session.",
    };
  }
  return undefined;
}

// ---------------------------------------------------------------- Claude Code

async function claudeUsage(provider: AiProvider, d: Resolved): Promise<UsageBody> {
  if (hasProviderKey(provider)) return apiKeyBilling("Claude Code");
  const configDir = d.env.CLAUDE_CONFIG_DIR?.trim() || join(d.home, ".claude");
  let creds = parseJson(await d.readText(join(configDir, ".credentials.json")));
  if (!creds && d.platform === "darwin") {
    creds = parseJson(await readKeychain(d, "Claude Code-credentials"));
  }
  const oauth = asRecord(creds?.claudeAiOauth);
  const token = str(oauth?.accessToken);
  if (!token) {
    return unavailable("Claude Code is not signed in with a Claude plan. Run `claude` and /login.");
  }
  const expiresAt = num(oauth?.expiresAt);
  if (expiresAt && expiresAt < d.now().getTime()) {
    return unavailable("Claude Code sign-in has expired. Run `claude` once to refresh it.");
  }
  const body = await fetchJson(d, CLAUDE_USAGE_URL, {
    Authorization: `Bearer ${token}`,
    "anthropic-beta": "oauth-2025-04-20",
  });
  const parsed = parseClaudeUsage(body);
  const plan = titleCase(str(oauth?.subscriptionType));
  return { ...parsed, ...(plan ? { plan } : {}) };
}

const CLAUDE_WINDOWS: Array<[string, string, number]> = [
  ["five_hour", "5-hour", 300],
  ["seven_day", "Weekly", 10_080],
  ["seven_day_opus", "Weekly · Opus", 10_080],
  ["seven_day_sonnet", "Weekly · Sonnet", 10_080],
];

export function parseClaudeUsage(body: unknown): UsageBody {
  const root = asRecord(body);
  const windows: ProviderUsageWindow[] = [];
  for (const [key, label, minutes] of CLAUDE_WINDOWS) {
    const w = asRecord(root?.[key]);
    const pct = num(w?.utilization);
    if (!w || pct == null) continue;
    const resetsAt = isoOrUndefined(str(w.resets_at));
    windows.push({
      id: key,
      label,
      usedPercent: pct,
      unit: "percent",
      windowMinutes: minutes,
      ...(resetsAt ? { resetsAt } : {}),
    });
  }
  const extra = asRecord(root?.extra_usage);
  const extraPct = num(extra?.utilization);
  if (extra?.is_enabled === true && extraPct != null) {
    windows.push({
      id: "extra_usage",
      label: "Extra usage",
      usedPercent: extraPct,
      unit: "percent",
    });
  }
  return { ok: true, source: "oauth", windows };
}

// ---------------------------------------------------------------- Cursor CLI

async function cursorUsage(d: Resolved): Promise<UsageBody> {
  const token = await cursorAccessToken(d);
  if (!token) {
    return unavailable("Cursor CLI is not signed in. Run `cursor-agent login`.");
  }
  const claims = decodeJwt(token);
  const exp = num(claims?.exp);
  if (exp && exp * 1000 < d.now().getTime()) {
    return unavailable("Cursor CLI sign-in has expired. Run `cursor-agent login`.");
  }
  const userId = str(claims?.sub)?.split("|").filter(Boolean).pop();
  if (!userId || !/^[A-Za-z0-9._-]+$/.test(userId)) {
    return unavailable("Cursor CLI token has no user id; run `cursor-agent login` again.");
  }
  const body = await fetchJson(d, CURSOR_USAGE_URL, {
    Cookie: `WorkosCursorSessionToken=${userId}%3A%3A${token}`,
  });
  return parseCursorUsageSummary(body);
}

async function cursorAccessToken(d: Resolved): Promise<string | undefined> {
  const configHome = d.env.XDG_CONFIG_HOME?.trim() || join(d.home, ".config");
  const candidates = [
    join(configHome, "cursor", "auth.json"),
    join(d.home, ".cursor", "auth.json"),
  ];
  if (d.platform === "win32" && d.env.APPDATA) {
    candidates.push(join(d.env.APPDATA, "Cursor", "auth.json"));
  }
  for (const path of candidates) {
    const token = str(parseJson(await d.readText(path))?.accessToken);
    if (token) return token;
  }
  if (d.platform === "darwin") {
    const fromKeychain = (await readKeychain(d, "cursor-access-token"))?.trim();
    if (fromKeychain) return fromKeychain;
  }
  return undefined;
}

export function parseCursorUsageSummary(body: unknown): UsageBody {
  const root = asRecord(body);
  const resetsAt = isoOrUndefined(str(root?.billingCycleEnd));
  const individual = asRecord(root?.individualUsage);
  const team = asRecord(root?.teamUsage);
  const windows: ProviderUsageWindow[] = [];
  const plan = asRecord(individual?.plan);
  const overall = asRecord(individual?.overall);
  const pooled = asRecord(team?.pooled);
  const primary = plan ?? overall ?? pooled;
  if (primary) {
    const used = cents(primary.used);
    const limit = cents(primary.limit);
    const pct = num(primary.totalPercentUsed);
    windows.push({
      id: "monthly",
      label: plan ? "Included usage" : overall ? "Personal limit" : "Team pool",
      ...(pct != null ? { usedPercent: pct } : {}),
      ...(used != null ? { used } : {}),
      ...(limit ? { limit } : {}),
      unit: "usd",
      ...(resetsAt ? { resetsAt } : {}),
    });
  }
  const onDemand = asRecord(individual?.onDemand) ?? asRecord(team?.onDemand);
  const odUsed = cents(onDemand?.used);
  const odLimit = cents(onDemand?.limit);
  if (onDemand && (odUsed || odLimit)) {
    windows.push({
      id: "on_demand",
      label: "On-demand",
      ...(odUsed != null ? { used: odUsed } : {}),
      ...(odLimit ? { limit: odLimit } : {}),
      unit: "usd",
      ...(resetsAt ? { resetsAt } : {}),
    });
  }
  const membership = titleCase(str(root?.membershipType));
  return { ok: true, source: "web", windows, ...(membership ? { plan: membership } : {}) };
}

// ---------------------------------------------------------------- Kiro CLI

async function kiroUsage(provider: AiProvider, d: Resolved): Promise<UsageBody> {
  const { command, prefixArgs } = resolveKiroCliCommand(provider, d.env);
  // Same rule as the health check: the command is configurable, so never
  // hand it the provider secret just to read a usage summary.
  const env: NodeJS.ProcessEnv = { ...d.env };
  delete env.KIRO_API_KEY;
  const result = await runProbe(
    d,
    { command, args: [...prefixArgs, "chat", "--no-interactive", "/usage"], cwd: d.home, env },
    KIRO_USAGE_TIMEOUT_MS,
  );
  const text = `${result.stdout}\n${result.stderr}`;
  const parsed = parseKiroUsage(text, d.now());
  if (parsed) return parsed;
  if (hasProviderKey(provider)) return apiKeyBilling("Kiro CLI");
  if (/not\s+(?:logged|signed)\s+in|login|authenticat/i.test(text)) {
    return unavailable("Kiro CLI is not signed in. Run `kiro-cli login`.", "cli");
  }
  return unavailable(
    result.code === 0
      ? "Kiro CLI did not print a usage summary. Update kiro-cli and retry."
      : `\`${command} chat /usage\` failed (exit ${result.code}).`,
    "cli",
  );
}

const ANSI = new RegExp(String.raw`\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007`, "g");

export function parseKiroUsage(raw: string, now: Date): UsageBody | undefined {
  const text = raw.replace(ANSI, "").replace(/[┃┏┓┗┛┣┫━│─╭╮╰╯├┤]/g, " ");
  const windows: ProviderUsageWindow[] = [];
  const reset = text.match(/resets?\s+on\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i);
  const resetsAt = reset ? monthDayToIso(reset, now) : undefined;
  const covered = text.match(/\(?\s*([\d.,]+)\s+of\s+([\d.,]+)\s+covered\s+in\s+plan/i);
  const bar =
    text.match(/█+[░▒▓ ]*\s*(\d{1,3}(?:\.\d+)?)\s*%/) ?? text.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (covered || bar) {
    const used = covered ? decimal(covered[1]) : undefined;
    const limit = covered ? decimal(covered[2]) : undefined;
    // The bar shows plan credits used; derive it from the counts when both exist.
    const pct = used != null && limit ? (used / limit) * 100 : bar ? Number(bar[1]) : undefined;
    windows.push({
      id: "monthly",
      label: "Monthly credits",
      ...(pct != null ? { usedPercent: pct } : {}),
      ...(used != null ? { used } : {}),
      ...(limit ? { limit } : {}),
      unit: "credits",
      ...(resetsAt ? { resetsAt } : {}),
    });
  } else {
    const legacy = text.match(/Usage:\s*([\d.,]+)\s*\/\s*([\d.,]+)\s*(requests|credits)?/i);
    if (legacy) {
      windows.push({
        id: "monthly",
        label: "Monthly usage",
        used: decimal(legacy[1]),
        limit: decimal(legacy[2]),
        unit: legacy[3]?.toLowerCase() === "requests" ? "requests" : "credits",
        ...(resetsAt ? { resetsAt } : {}),
      });
    }
  }
  const bonus = text.match(/Bonus\s+credits:?\s*([\d.,]+)\s*\/\s*([\d.,]+)\s*credits\s+used/i);
  if (bonus) {
    const expires = text.match(/expires\s+in\s+(\d+)\s+days?/i);
    const expiresAt = expires
      ? new Date(now.getTime() + Number(expires[1]) * 86_400_000).toISOString()
      : undefined;
    windows.push({
      id: "bonus",
      label: "Bonus credits",
      used: decimal(bonus[1]),
      limit: decimal(bonus[2]),
      unit: "credits",
      ...(expiresAt ? { resetsAt: expiresAt } : {}),
    });
  }
  if (!windows.length) return undefined;
  const planMatch =
    text.match(/Plan:\s*(KIRO[A-Z+ ]*?)\s*(?:\||$)/im) ??
    text.match(/^\s*(KIRO(?:\s+[A-Z+]+)+)\s*$/m);
  const plan = planMatch?.[1] ? titleCase(planMatch[1].trim()) : undefined;
  return { ok: true, source: "cli", windows, ...(plan ? { plan } : {}) };
}

function monthDayToIso(match: RegExpMatchArray, now: Date): string | undefined {
  const month = Number(match[1]) - 1;
  const day = Number(match[2]);
  if (month < 0 || month > 11 || day < 1 || day > 31) return undefined;
  let year = match[3] ? Number(match[3]) : now.getUTCFullYear();
  if (year < 100) year += 2000;
  let date = new Date(Date.UTC(year, month, day));
  if (!match[3] && date.getTime() < now.getTime() - 86_400_000) {
    date = new Date(Date.UTC(year + 1, month, day));
  }
  return date.toISOString();
}

// ---------------------------------------------------------------- helpers

async function fetchJson(
  d: Resolved,
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const res = await d.fetchFn(url, {
    method: "GET",
    headers: { Accept: "application/json", "User-Agent": "locus-usage", ...headers },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`sign-in was rejected (HTTP ${res.status}); sign in to the CLI again`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

async function readKeychain(d: Resolved, service: string): Promise<string | undefined> {
  try {
    const result = await runProbe(
      d,
      {
        command: "/usr/bin/security",
        args: ["find-generic-password", "-s", service, "-w"],
        cwd: d.home,
        env: d.env,
      },
      KEYCHAIN_TIMEOUT_MS,
    );
    return result.code === 0 ? result.stdout.trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

async function runProbe(
  d: Resolved,
  req: Parameters<CursorCliSpawner>[0],
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  let handle: ReturnType<CursorCliSpawner>;
  try {
    handle = d.spawnFn(req);
  } catch (err) {
    throw new Error(
      `Could not run \`${req.command}\`: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const lines: string[] = [];
    const collect = (async () => {
      for await (const line of handle.lines) lines.push(line);
      return handle.wait();
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`\`${req.command}\` timed out.`)), timeoutMs);
      timer.unref?.();
    });
    const result = await Promise.race([collect, timeout]);
    return { code: result.code, stdout: lines.join("\n"), stderr: result.stderr };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") throw new Error(`\`${req.command}\` is not installed or not on PATH.`);
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    handle.kill?.();
  }
}

function decodeJwt(token: string): Record<string, unknown> | undefined {
  const part = token.split(".")[1];
  if (!part) return undefined;
  try {
    return parseJson(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

function parseJson(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numString(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function decimal(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function cents(value: unknown): number | undefined {
  const n = num(value);
  return n == null ? undefined : Math.round(n) / 100;
}

function epochToIso(value: number | undefined): string | undefined {
  if (value == null || value <= 0) return undefined;
  const ms = value > 1e12 ? value : value * 1000;
  return new Date(ms).toISOString();
}

function secondsFromNow(seconds: number | undefined, from: Date): string | undefined {
  if (seconds == null || seconds < 0) return undefined;
  return new Date(from.getTime() + seconds * 1000).toISOString();
}

function isoOrUndefined(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

function toMinutes(seconds: number | undefined): number | undefined {
  return seconds ? Math.round(seconds / 60) : undefined;
}

function windowId(minutes: number | undefined, fallback: string): string {
  if (minutes === 300) return "five_hour";
  if (minutes === 10_080) return "weekly";
  return fallback;
}

function windowLabel(minutes: number | undefined, fallback: string): string {
  if (!minutes) return fallback === "primary" ? "Session" : "Weekly";
  if (minutes === 10_080) return "Weekly";
  if (minutes % 1440 === 0) return `${minutes / 1440}-day`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour`;
  return `${minutes}-minute`;
}

function titleCase(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
