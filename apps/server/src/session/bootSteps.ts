import type {
  BootHistory,
  BootKind,
  BootPlanOptions,
  BootProgress,
  BootStepId,
  ClientEvent,
} from "@locus/shared";
import {
  advanceBootProgress,
  beginBootProgress,
  failBootProgress,
  finishBootProgress,
  recordBootHistory,
} from "@locus/shared";

export type BootTrackerPorts = {
  broadcast: (event: ClientEvent) => void;
  loadHistory: () => Promise<BootHistory>;
  saveHistory: (history: BootHistory) => Promise<void>;
  now?: () => number;
};

/**
 * Per-session guest boot step list. Steps arrive from several code paths
 * (adapter `start()`, status changes, clone, workspace setup); the pure
 * transitions in `@locus/shared` make late or repeated reports no-ops.
 */
export class BootTracker {
  private active = new Map<string, BootProgress>();
  private history: BootHistory | undefined;
  private historyLoad: Promise<BootHistory> | undefined;

  constructor(private readonly ports: BootTrackerPorts) {}

  private now(): number {
    return this.ports.now?.() ?? Date.now();
  }

  private async loadHistory(): Promise<BootHistory> {
    if (this.history) return this.history;
    this.historyLoad ??= this.ports.loadHistory().catch(() => ({}));
    this.history = await this.historyLoad;
    return this.history;
  }

  get(sessionId: string): BootProgress | undefined {
    return this.active.get(sessionId);
  }

  isRunning(sessionId: string): boolean {
    const row = this.active.get(sessionId);
    return Boolean(row && !row.done && !row.error);
  }

  /**
   * Start a step list unless one is already running for this session.
   * `at` backdates the first step when its work began before the session existed.
   */
  async begin(
    sessionId: string,
    input: { kind: BootKind; key: string; at?: number } & BootPlanOptions,
  ): Promise<void> {
    if (this.isRunning(sessionId)) return;
    const history = await this.loadHistory();
    if (this.isRunning(sessionId)) return;
    const progress = beginBootProgress({ ...input, at: input.at ?? this.now(), history });
    this.set(sessionId, progress);
  }

  step(sessionId: string, id: BootStepId): void {
    const current = this.active.get(sessionId);
    if (!current) return;
    const next = advanceBootProgress(current, id, this.now());
    if (next !== current) this.set(sessionId, next);
  }

  async finish(sessionId: string): Promise<void> {
    const current = this.active.get(sessionId);
    if (!current || current.done || current.error) return;
    const next = finishBootProgress(current, this.now());
    this.set(sessionId, next);
    const history = recordBootHistory(await this.loadHistory(), next);
    if (history === this.history) return;
    this.history = history;
    await this.ports.saveHistory(history).catch(() => undefined);
  }

  fail(sessionId: string, error: string): void {
    const current = this.active.get(sessionId);
    if (!current || current.done || current.error) return;
    this.set(sessionId, failBootProgress(current, error, this.now()));
  }

  clear(sessionId: string): void {
    if (!this.active.delete(sessionId)) return;
    this.ports.broadcast({ type: "boot.progress", sessionId, progress: null });
  }

  reset(): void {
    this.active.clear();
  }

  private set(sessionId: string, progress: BootProgress): void {
    this.active.set(sessionId, progress);
    this.ports.broadcast({ type: "boot.progress", sessionId, progress });
  }
}
