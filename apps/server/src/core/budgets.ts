import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SpendBook,
  checkDailyBudgets,
  dailyBudgetStatus,
  estimateUsd,
  localDayKey,
  resolveUsageRates,
  type BudgetOverride,
  type BudgetScope,
  type DailyBudgetStatus,
  type DailyBudgetVerdict,
  type DaySpend,
  type LocusConfig,
  type TokenUsage,
} from "@locus/shared";

export interface BudgetSessionRef {
  id: string;
  providerId: string;
  model: string;
  automationId?: string;
  projectId?: string;
}

export interface UsageRecorded {
  sessionId: string;
  atMs: number;
  inputTokens: number;
  outputTokens: number;
  usd?: number;
  model: string;
  providerId: string;
}

interface StoredSpend {
  days?: DaySpend[];
  overrides?: BudgetOverride[];
}

/**
 * Daily spend ledger behind the server-enforced caps. Every provider usage delta (native and CLI
 * turns) lands here; turns check it at start and between rounds. Persisted to
 * `<dataDir>/budgets/spend.json` so a restart does not reset today's total.
 */
export class BudgetService {
  private book: SpendBook | undefined;
  private overrides: BudgetOverride[] = [];
  private loading: Promise<void> | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private saving: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(event: UsageRecorded) => void>();

  constructor(
    private readonly dataDir: string,
    private readonly now: () => number = Date.now,
  ) {}

  private get path(): string {
    return join(this.dataDir, "budgets", "spend.json");
  }

  onUsage(listener: (event: UsageRecorded) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async ensure(): Promise<SpendBook> {
    if (this.book) return this.book;
    this.loading ??= (async () => {
      let stored: StoredSpend = {};
      try {
        stored = JSON.parse(await readFile(this.path, "utf8")) as StoredSpend;
      } catch {
        /* first run */
      }
      this.book = new SpendBook(Array.isArray(stored.days) ? stored.days : []);
      this.overrides = Array.isArray(stored.overrides) ? stored.overrides : [];
    })();
    await this.loading;
    return this.book!;
  }

  async record(session: BudgetSessionRef, delta: TokenUsage, config: LocusConfig): Promise<void> {
    const tokens = Math.max(0, delta.inputTokens) + Math.max(0, delta.outputTokens);
    if (tokens <= 0) return;
    const book = await this.ensure();
    const provider = config.providers.find((row) => row.id === session.providerId);
    const usd = estimateUsd(delta, resolveUsageRates(provider, session.model));
    const atMs = this.now();
    book.add({
      atMs,
      sessionId: session.id,
      automationId: session.automationId,
      projectId: session.projectId,
      usd,
      tokens,
    });
    this.scheduleSave();
    const event: UsageRecorded = {
      sessionId: session.id,
      atMs,
      inputTokens: delta.inputTokens,
      outputTokens: delta.outputTokens,
      usd,
      model: session.model,
      providerId: session.providerId,
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* observers never fail a turn */
      }
    }
  }

  async today(): Promise<DaySpend> {
    return (await this.ensure()).day(this.now());
  }

  async check(
    session: Pick<BudgetSessionRef, "automationId" | "projectId">,
    config: LocusConfig,
  ): Promise<DailyBudgetVerdict> {
    if (!config.budgets) return { ok: true };
    const book = await this.ensure();
    return checkDailyBudgets({
      settings: config.budgets,
      spend: book.day(this.now()),
      automationId: session.automationId,
      projectId: session.projectId,
      overrides: this.overrides,
    });
  }

  async status(config: LocusConfig): Promise<DailyBudgetStatus> {
    const book = await this.ensure();
    return dailyBudgetStatus({
      settings: config.budgets,
      spend: book.day(this.now()),
      overrides: this.overrides,
    });
  }

  async override(input: {
    scope: BudgetScope;
    id?: string;
    by: string;
    reason?: string;
  }): Promise<BudgetOverride> {
    await this.ensure();
    const row: BudgetOverride = {
      day: localDayKey(this.now()),
      scope: input.scope,
      id: input.scope === "global" ? undefined : input.id,
      by: input.by,
      reason: input.reason?.trim().slice(0, 300) || undefined,
      t: new Date(this.now()).toISOString(),
    };
    const today = row.day;
    this.overrides = [...this.overrides.filter((item) => item.day >= today), row];
    this.scheduleSave();
    await this.flush();
    return row;
  }

  async listOverrides(): Promise<BudgetOverride[]> {
    await this.ensure();
    const today = localDayKey(this.now());
    return this.overrides.filter((row) => row.day === today);
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.flush();
    }, 500);
    this.saveTimer.unref?.();
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    const book = this.book;
    if (!book) return;
    book.prune(35);
    const body: StoredSpend = { days: book.all(), overrides: this.overrides };
    this.saving = this.saving
      .catch(() => undefined)
      .then(async () => {
        await mkdir(join(this.dataDir, "budgets"), { recursive: true, mode: 0o700 });
        const tmp = `${this.path}.tmp`;
        await writeFile(tmp, `${JSON.stringify(body)}\n`, { mode: 0o600 });
        await rename(tmp, this.path);
      });
    await this.saving.catch((err) => {
      console.warn("Budget ledger save failed:", err instanceof Error ? err.message : err);
    });
  }
}
