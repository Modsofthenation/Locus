import { checkBudget } from "./governor.js";
import { parseBudgetSettings, type BudgetCap, type BudgetSettings } from "./models/controls.js";

/** `YYYY-MM-DD` in the control plane's local time zone. Daily caps roll over at local midnight. */
export function localDayKey(at: Date | number = new Date()): string {
  const d = typeof at === "number" ? new Date(at) : at;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface SpendTotals {
  usd: number;
  tokens: number;
}

export interface ModelUsageTotal {
  providerId: string;
  providerName?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedTokens: number;
  unpricedTokens: number;
  usd?: number;
}

export interface ModelUsageSummary {
  since?: string;
  models: ModelUsageTotal[];
}

export interface DaySpend {
  day: string;
  global: SpendTotals;
  automations: Record<string, SpendTotals>;
  projects: Record<string, SpendTotals>;
  sessions: Record<string, SpendTotals>;
}

export interface SpendEntry {
  atMs: number;
  sessionId: string;
  automationId?: string;
  projectId?: string;
  usd?: number;
  tokens: number;
}

export type BudgetScope = "global" | "automation" | "project";

export interface BudgetOverride {
  day: string;
  scope: BudgetScope;
  id?: string;
  by: string;
  reason?: string;
  t: string;
}

export function emptyDaySpend(day: string): DaySpend {
  return { day, global: { usd: 0, tokens: 0 }, automations: {}, projects: {}, sessions: {} };
}

function bump(map: Record<string, SpendTotals>, id: string, usd: number, tokens: number): void {
  const row = map[id] ?? { usd: 0, tokens: 0 };
  row.usd += usd;
  row.tokens += tokens;
  map[id] = row;
}

/** Per-day spend accounting across sessions. Pure; persistence is the caller's job. */
export class SpendBook {
  private readonly days = new Map<string, DaySpend>();

  constructor(initial?: DaySpend[]) {
    for (const row of initial ?? []) this.days.set(row.day, structuredClone(row));
  }

  add(entry: SpendEntry): DaySpend {
    const day = localDayKey(entry.atMs);
    const row = this.days.get(day) ?? emptyDaySpend(day);
    const usd = typeof entry.usd === "number" && Number.isFinite(entry.usd) ? entry.usd : 0;
    const tokens = Number.isFinite(entry.tokens) ? Math.max(0, entry.tokens) : 0;
    row.global.usd += usd;
    row.global.tokens += tokens;
    bump(row.sessions, entry.sessionId, usd, tokens);
    if (entry.automationId) bump(row.automations, entry.automationId, usd, tokens);
    if (entry.projectId) bump(row.projects, entry.projectId, usd, tokens);
    this.days.set(day, row);
    return row;
  }

  day(at: Date | number | string = Date.now()): DaySpend {
    const key = typeof at === "string" ? at : localDayKey(at);
    return structuredClone(this.days.get(key) ?? emptyDaySpend(key));
  }

  all(): DaySpend[] {
    return [...this.days.values()].map((row) => structuredClone(row));
  }

  /** Keep the newest `keep` days. */
  prune(keep = 35): void {
    const keys = [...this.days.keys()].sort();
    for (const key of keys.slice(0, Math.max(0, keys.length - keep))) this.days.delete(key);
  }
}

export type DailyBudgetVerdict =
  | { ok: true; warn?: string }
  | {
      ok: false;
      scope: BudgetScope;
      id?: string;
      reason: "usd" | "tokens";
      used: number;
      cap: number;
      message: string;
    };

function overridden(
  overrides: BudgetOverride[] | undefined,
  day: string,
  scope: BudgetScope,
  id?: string,
): boolean {
  return Boolean(
    overrides?.some(
      (row) => row.day === day && row.scope === scope && (scope === "global" || row.id === id),
    ),
  );
}

function scopeLabel(scope: BudgetScope, id?: string, reason?: "usd" | "tokens"): string {
  if (scope === "global") return reason === "tokens" ? "daily token cap" : "daily spend cap";
  return `${scope} daily cap${id ? ` (${id})` : ""}`;
}

function formatAmount(reason: "usd" | "tokens", value: number): string {
  if (reason === "usd") return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
  return Math.round(value).toLocaleString("en-US");
}

/** Message the turn posts when a daily cap stops it. Starts with "Budget reached" on purpose. */
export function budgetReachedMessage(verdict: Extract<DailyBudgetVerdict, { ok: false }>): string {
  return `Budget reached: ${scopeLabel(verdict.scope, verdict.id, verdict.reason)} (${formatAmount(verdict.reason, verdict.used)} / ${formatAmount(verdict.reason, verdict.cap)} today). The turn stopped before the next model call. Raise the cap in Settings → Advanced → Budgets or override for today (\`locus budget override\`), then send a message to continue.`;
}

/**
 * Check the global, automation, and project daily caps for a session's next model call.
 * Reuses the governor so USD and token limits behave like per-task caps.
 */
export function checkDailyBudgets(input: {
  settings?: BudgetSettings;
  spend: DaySpend;
  automationId?: string;
  projectId?: string;
  overrides?: BudgetOverride[];
}): DailyBudgetVerdict {
  const settings = parseBudgetSettings(input.settings);
  if (!settings) return { ok: true };
  const scopes: Array<{ scope: BudgetScope; id?: string; cap?: BudgetCap; used: SpendTotals }> = [
    { scope: "global", cap: settings, used: input.spend.global },
  ];
  if (input.automationId) {
    scopes.push({
      scope: "automation",
      id: input.automationId,
      cap: settings.automations?.[input.automationId],
      used: input.spend.automations[input.automationId] ?? { usd: 0, tokens: 0 },
    });
  }
  if (input.projectId) {
    scopes.push({
      scope: "project",
      id: input.projectId,
      cap: settings.projects?.[input.projectId],
      used: input.spend.projects[input.projectId] ?? { usd: 0, tokens: 0 },
    });
  }
  let warn: string | undefined;
  for (const row of scopes) {
    if (!row.cap) continue;
    if (row.cap.dailyUsd == null && row.cap.dailyTokens == null) continue;
    if (overridden(input.overrides, input.spend.day, row.scope, row.id)) continue;
    const verdict = checkBudget(
      { usd: row.used.usd, tokens: row.used.tokens, startedAtMs: 0, round: 0 },
      { maxUsd: row.cap.dailyUsd, maxTokens: row.cap.dailyTokens },
      0,
    );
    if (!verdict.ok) {
      const reason: "usd" | "tokens" = verdict.reason === "tokens" ? "tokens" : "usd";
      const result: Extract<DailyBudgetVerdict, { ok: false }> = {
        ok: false,
        scope: row.scope,
        id: row.id,
        reason,
        used: reason === "usd" ? row.used.usd : row.used.tokens,
        cap: (reason === "usd" ? row.cap.dailyUsd : row.cap.dailyTokens) ?? 0,
        message: "",
      };
      result.message = budgetReachedMessage(result);
      return result;
    }
    if (verdict.warn && !warn) warn = `Near the ${scopeLabel(row.scope, row.id)}.`;
  }
  return warn ? { ok: true, warn } : { ok: true };
}

export interface DailyBudgetStatus {
  day: string;
  spentUsd: number;
  spentTokens: number;
  capUsd?: number;
  capTokens?: number;
  overridden: boolean;
  automations: Array<{ id: string; spentUsd: number; spentTokens: number } & BudgetCap>;
  projects: Array<{ id: string; spentUsd: number; spentTokens: number } & BudgetCap>;
}

export function dailyBudgetStatus(input: {
  settings?: BudgetSettings;
  spend: DaySpend;
  overrides?: BudgetOverride[];
}): DailyBudgetStatus {
  const settings = parseBudgetSettings(input.settings) ?? {};
  const rows = (
    caps: Record<string, BudgetCap> | undefined,
    spent: Record<string, SpendTotals>,
  ) => {
    const ids = new Set([...Object.keys(caps ?? {}), ...Object.keys(spent)]);
    return [...ids].sort().map((id) => ({
      id,
      spentUsd: spent[id]?.usd ?? 0,
      spentTokens: spent[id]?.tokens ?? 0,
      ...(caps?.[id] ?? {}),
    }));
  };
  return {
    day: input.spend.day,
    spentUsd: input.spend.global.usd,
    spentTokens: input.spend.global.tokens,
    capUsd: settings.dailyUsd,
    capTokens: settings.dailyTokens,
    overridden: overridden(input.overrides, input.spend.day, "global"),
    automations: rows(settings.automations, input.spend.automations),
    projects: rows(settings.projects, input.spend.projects),
  };
}

/** Short "Today $1.20 / $5.00" label for surfaces that already show cost. */
export function formatDailySpendHint(status?: DailyBudgetStatus): string | undefined {
  if (!status || (status.capUsd == null && status.capTokens == null)) return undefined;
  if (status.capUsd != null) {
    return `Today ${formatAmount("usd", status.spentUsd)} / ${formatAmount("usd", status.capUsd)}${status.overridden ? " (override)" : ""}`;
  }
  return `Today ${formatAmount("tokens", status.spentTokens)} / ${formatAmount("tokens", status.capTokens ?? 0)} tokens${status.overridden ? " (override)" : ""}`;
}
