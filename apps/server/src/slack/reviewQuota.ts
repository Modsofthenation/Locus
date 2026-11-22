/**
 * "Current provider usage" for the end of a Slack review's usage line: plan usage for agent CLIs
 * that report it (Claude Code, Codex, Cursor CLI, Kiro), or today's Locus spend for API providers,
 * which have no plan quota to read. Never slows or fails a review: reads are cached briefly and
 * give up after a few seconds.
 */
import {
  formatDailySpendHint,
  formatProviderUsageBrief,
  isUsageCapableProvider,
  type AiProvider,
  type DailyBudgetStatus,
  type LocusConfig,
  type ProviderUsage,
} from "@locus/shared";

export const REVIEW_QUOTA_CACHE_MS = 60_000;
export const REVIEW_QUOTA_TIMEOUT_MS = 4_000;

export interface ReviewQuotaDeps {
  /** Plan usage for a usage-capable CLI provider. */
  readUsage?: (provider: AiProvider) => Promise<ProviderUsage>;
  /** Today's spend and caps (Settings → Budgets). */
  budgetStatus?: (config: LocusConfig) => Promise<DailyBudgetStatus>;
  now?: () => number;
  timeoutMs?: number;
}

export class ReviewQuotaReader {
  private readonly cache = new Map<string, { at: number; text: string | undefined }>();

  constructor(private readonly deps: ReviewQuotaDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** One short line, e.g. "Kiro: Monthly credits 212/1,000 (21%) (resets in 9d)", or undefined. */
  async line(provider: AiProvider, config: LocusConfig): Promise<string | undefined> {
    const usageCapable = isUsageCapableProvider(provider);
    if (usageCapable ? !this.deps.readUsage : !this.deps.budgetStatus) return undefined;
    const key = usageCapable ? `plan:${provider.id}` : "locus-today";
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < REVIEW_QUOTA_CACHE_MS) return hit.text;
    const read = usageCapable
      ? this.deps.readUsage!(provider).then((usage) =>
          formatProviderUsageBrief(usage, { now: new Date(this.now()) }),
        )
      : this.deps.budgetStatus!(config).then(formatLocusSpendToday);
    const text = await withTimeout(read, this.deps.timeoutMs ?? REVIEW_QUOTA_TIMEOUT_MS).catch(
      () => undefined,
    );
    this.cache.set(key, { at: this.now(), text });
    return text;
  }
}

/** "Locus today: $1.20 / $5.00" with a cap, "Locus today: $1.20" without one. */
export function formatLocusSpendToday(status: DailyBudgetStatus): string | undefined {
  const hint = formatDailySpendHint(status);
  if (hint) return `Locus ${hint.replace(/^Today /, "today: ")}`;
  if (!(status.spentUsd > 0)) return undefined;
  const usd = status.spentUsd < 0.01 ? status.spentUsd.toFixed(4) : status.spentUsd.toFixed(2);
  return `Locus today: $${usd}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
