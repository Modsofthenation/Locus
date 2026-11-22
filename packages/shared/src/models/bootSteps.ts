/**
 * Guest boot steps: the ordered list the chat shows while a Docker container,
 * VM, or Host workspace starts, plus per-image duration history for estimates.
 * Pure helpers only — the server owns the clock and storage.
 */

/** `cloud`: a Fargate task boots `locus-worker`, then the agent runs inside it. */
export type BootKind = "docker" | "vm" | "host" | "cloud";

export type BootStepId =
  | "provision"
  | "pull"
  | "start"
  | "disk"
  | "boot"
  | "connect"
  | "worktree"
  | "clone"
  | "setup"
  | "ready";

export type BootStepState = "pending" | "active" | "done" | "skipped" | "error";

export interface BootStep {
  id: BootStepId;
  label: string;
  state: BootStepState;
  /** Epoch ms. */
  startedAt?: number;
  /** Epoch ms. */
  endedAt?: number;
  /** Median of past runs for this kind/image, when history exists. */
  estimateMs?: number;
  error?: string;
}

export interface BootProgress {
  kind: BootKind;
  /** History bucket, e.g. `docker:ubuntu:24.04`. */
  key: string;
  startedAt: number;
  steps: BootStep[];
  done?: boolean;
  error?: string;
}

/** Past step durations (ms) by history key, newest last. */
export type BootHistory = Record<string, Partial<Record<BootStepId, number[]>>>;

export const BOOT_HISTORY_MAX = 10;

export const BOOT_STEP_LABELS: Record<BootStepId, string> = {
  provision: "Start cloud task",
  pull: "Pull image",
  start: "Start container",
  disk: "Prepare disk",
  boot: "Boot",
  connect: "Connect agent",
  worktree: "Create worktree",
  clone: "Clone repo",
  setup: "Install",
  ready: "Ready",
};

export type BootPlanOptions = {
  /** A repo still needs cloning. */
  repo?: boolean;
  /** Host: a git worktree is being created. */
  worktree?: boolean;
  /** Host: `.locus/worktree.json` has a setup command. */
  setup?: boolean;
};

export function bootStepPlan(kind: BootKind, opts: BootPlanOptions = {}): BootStepId[] {
  const clone: BootStepId[] = opts.repo ? ["clone"] : [];
  if (kind === "docker") return ["pull", "start", ...clone, "setup", "ready"];
  if (kind === "vm") return ["disk", "boot", "connect", ...clone, "ready"];
  if (kind === "cloud") return ["provision", "connect", ...clone, "ready"];
  const worktree: BootStepId[] = opts.worktree ? ["worktree"] : [];
  const setup: BootStepId[] = opts.setup ? ["setup"] : [];
  return [...worktree, ...clone, ...setup, "ready"];
}

export function bootHistoryKey(kind: BootKind, image?: string): string {
  const tag = image?.trim();
  return tag ? `${kind}:${tag}` : kind;
}

export function medianMs(values: readonly number[]): number | undefined {
  const rows = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!rows.length) return undefined;
  const mid = Math.floor(rows.length / 2);
  const value = rows.length % 2 ? rows[mid]! : (rows[mid - 1]! + rows[mid]!) / 2;
  return Math.round(value);
}

export function estimateBootStepMs(
  history: BootHistory,
  key: string,
  step: BootStepId,
  maxRuns = BOOT_HISTORY_MAX,
): number | undefined {
  const runs = history[key]?.[step];
  if (!runs?.length) return undefined;
  return medianMs(runs.slice(-maxRuns));
}

export function beginBootProgress(
  input: {
    kind: BootKind;
    key: string;
    at: number;
    history?: BootHistory;
  } & BootPlanOptions,
): BootProgress {
  const ids = bootStepPlan(input.kind, input);
  const steps = ids.map((id, index): BootStep => {
    const estimateMs =
      id === "ready" ? undefined : estimateBootStepMs(input.history ?? {}, input.key, id);
    return {
      id,
      label: BOOT_STEP_LABELS[id],
      state: index === 0 ? "active" : "pending",
      ...(index === 0 ? { startedAt: input.at } : {}),
      ...(estimateMs !== undefined ? { estimateMs } : {}),
    };
  });
  return { kind: input.kind, key: input.key, startedAt: input.at, steps };
}

/**
 * Move to `id`: the active step finishes, skipped-over pending steps are marked
 * skipped, and `id` becomes active. Unknown or already-passed steps are a no-op,
 * so callers can report steps from several code paths without coordinating.
 */
export function advanceBootProgress(
  progress: BootProgress,
  id: BootStepId,
  at: number,
): BootProgress {
  if (progress.done || progress.error) return progress;
  const target = progress.steps.findIndex((s) => s.id === id);
  if (target < 0) return progress;
  const current = progress.steps[target]!;
  if (current.state !== "pending") return progress;
  const steps = progress.steps.map((step, index): BootStep => {
    if (index < target) {
      if (step.state === "active") return { ...step, state: "done", endedAt: at };
      if (step.state === "pending") return { ...step, state: "skipped" };
      return step;
    }
    if (index === target) return { ...step, state: "active", startedAt: at };
    return step;
  });
  return { ...progress, steps };
}

/** Finish every step: active → done, pending → skipped, Ready → done. */
export function finishBootProgress(progress: BootProgress, at: number): BootProgress {
  if (progress.done || progress.error) return progress;
  const steps = progress.steps.map((step): BootStep => {
    if (step.id === "ready") {
      return { ...step, state: "done", startedAt: step.startedAt ?? at, endedAt: at };
    }
    if (step.state === "active") return { ...step, state: "done", endedAt: at };
    if (step.state === "pending") return { ...step, state: "skipped" };
    return step;
  });
  return { ...progress, steps, done: true };
}

export function failBootProgress(progress: BootProgress, error: string, at: number): BootProgress {
  if (progress.done || progress.error) return progress;
  let marked = false;
  const steps = progress.steps.map((step): BootStep => {
    if (step.state !== "active") return step;
    marked = true;
    return { ...step, state: "error", endedAt: at, error };
  });
  if (!marked) {
    const first = steps.findIndex((s) => s.state === "pending");
    if (first >= 0)
      steps[first] = { ...steps[first]!, state: "error", startedAt: at, endedAt: at, error };
  }
  return { ...progress, steps, error };
}

export function activeBootStep(progress: BootProgress | undefined): BootStep | undefined {
  return progress?.steps.find((s) => s.state === "active" || s.state === "error");
}

/** Append finished step durations from a completed boot into history (keeps the last `maxRuns`). */
export function recordBootHistory(
  history: BootHistory,
  progress: BootProgress,
  maxRuns = BOOT_HISTORY_MAX,
): BootHistory {
  if (!progress.done || progress.error) return history;
  const bucket: Partial<Record<BootStepId, number[]>> = { ...(history[progress.key] ?? {}) };
  let changed = false;
  for (const step of progress.steps) {
    if (step.id === "ready" || step.state !== "done") continue;
    if (step.startedAt === undefined || step.endedAt === undefined) continue;
    const ms = step.endedAt - step.startedAt;
    if (!Number.isFinite(ms) || ms < 0) continue;
    bucket[step.id] = [...(bucket[step.id] ?? []), ms].slice(-maxRuns);
    changed = true;
  }
  if (!changed) return history;
  return { ...history, [progress.key]: bucket };
}

export function parseBootHistory(raw: unknown): BootHistory {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: BootHistory = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const bucket: Partial<Record<BootStepId, number[]>> = {};
    for (const [step, runs] of Object.entries(value as Record<string, unknown>)) {
      if (!(step in BOOT_STEP_LABELS) || !Array.isArray(runs)) continue;
      const rows = runs.filter(
        (v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0,
      );
      if (rows.length) bucket[step as BootStepId] = rows.slice(-BOOT_HISTORY_MAX);
    }
    if (Object.keys(bucket).length) out[key] = bucket;
  }
  return out;
}

/** `4s`, `40s`, `2m`, `2m 5s`. */
export function formatBootDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export function formatBootEstimate(ms: number | undefined): string | undefined {
  if (ms === undefined) return undefined;
  return `usually ~${formatBootDuration(ms)}`;
}

/** Elapsed for a step: finished duration, or running time against `now`. */
export function bootStepElapsedMs(step: BootStep, now: number): number | undefined {
  if (step.startedAt === undefined) return undefined;
  const end = step.endedAt ?? (step.state === "active" ? now : undefined);
  if (end === undefined) return undefined;
  return Math.max(0, end - step.startedAt);
}

/** Right-hand text for a step row: `12s`, or `5s · usually ~40s` while active. */
export function bootStepMeta(step: BootStep, now: number): string {
  if (step.state === "pending" || step.state === "skipped") return "";
  const elapsed = bootStepElapsedMs(step, now);
  const time = elapsed === undefined ? "" : formatBootDuration(elapsed);
  if (step.state !== "active") return time;
  const usually = formatBootEstimate(step.estimateMs);
  return [time, usually].filter(Boolean).join(" · ");
}

export function bootProgressTitle(progress: BootProgress): string {
  if (progress.error) return "Start failed";
  if (progress.kind === "docker") return "Starting container";
  if (progress.kind === "vm") return "Starting VM";
  if (progress.kind === "cloud") return "Starting cloud agent";
  return "Preparing workspace";
}
