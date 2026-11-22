import type { CodexReasoningEffort } from "./provider.js";
import type { WorkerTestState } from "./workerCompare.js";

/**
 * A Host agent whose workspace is a `git worktree` of another checkout.
 * Parallel agents share one object store and each edit their own branch.
 */
export interface SessionWorktree {
  /** Toplevel of the checkout the worktree was added from (`git worktree add` ran here). */
  source: string;
  /** Absolute worktree folder; also the session `hostDir`. */
  path: string;
  /** Branch created for this agent. */
  branch: string;
  /** Commit the branch started from. Diffstats are measured against it. */
  baseSha: string;
  /** Branch name checked out in `source` when the worktree was made (empty when detached). */
  baseBranch?: string;
}

/** One agent row in a parallel fan-out: which provider/model (CLI or API) runs it. */
export interface WorktreeAgentSpec {
  providerId: string;
  model: string;
  reasoningEffort?: CodexReasoningEffort;
}

export interface WorktreeDiffStat {
  files: number;
  insertions: number;
  deletions: number;
}

/** Board row for one parallel agent. */
export interface WorkerBoardRow {
  id: string;
  title: string;
  role: string;
  status: string;
  providerId: string;
  model: string;
  branch?: string;
  worktreePath?: string;
  stat: WorktreeDiffStat;
  /** Commits on the branch since `baseSha`. */
  commits: number;
  /** Uncommitted files in the worktree. */
  dirty: number;
  needsYou?: boolean;
  error?: string;
  /** Changed paths against the base (committed, uncommitted, untracked). */
  files?: string[];
  /** Last test command in the transcript. */
  tests?: WorkerTestState;
  testCommand?: string;
  /** Last lint / typecheck command results in the transcript. */
  lint?: WorkerTestState;
  typecheck?: WorkerTestState;
  /** Latest review verdict for this worker (its PR review, or a verdict in its transcript). */
  verdict?: { verdict: "PASS" | "FAIL"; risk: "low" | "high"; reasons: string[] };
  /** Estimated spend for this agent's turns. */
  usd?: number;
}

export interface WorkerConnectionStatus {
  connection: "connected" | "stopped" | "missing" | "unreachable";
  task: "running" | "finished" | "unknown";
  reconnecting?: boolean;
  canResume: boolean;
}

export interface WorkerVerification {
  id: string;
  checks: {
    step: "test" | "lint" | "typecheck";
    status: "passed" | "failed" | "skipped";
    command?: string;
    output?: string;
    failedTests?: string[];
  }[];
  reason?: string;
}

const BRANCH_PREFIX = "locus/";

/** `locus/<slug>-<n>`: readable in `git branch`, unique per group via `suffix`. */
export function worktreeBranchName(title: string, suffix: string): string {
  const slug =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32)
      .replace(/-+$/g, "") || "agent";
  const tail = suffix.replace(/[^A-Za-z0-9._-]+/g, "").slice(0, 12) || "1";
  return `${BRANCH_PREFIX}${slug}-${tail}`;
}

/** Folder name under `~/.locus/worktrees`: `<repo>-<id>`; never a path. */
export function worktreeDirName(sourceDir: string, id: string): string {
  const leaf = sourceDir.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "repo";
  const repo =
    leaf
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[.-]+/, "")
      .slice(0, 40) || "repo";
  const tail = id.replace(/[^A-Za-z0-9]+/g, "").slice(0, 12) || "wt";
  return `${repo}-${tail}`;
}

export function parseSessionWorktree(value: unknown): SessionWorktree | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string).trim() : "");
  const source = text("source");
  const path = text("path");
  const branch = text("branch");
  const baseSha = text("baseSha");
  if (!source || !path || !branch || !/^[0-9a-f]{7,64}$/i.test(baseSha)) return undefined;
  const baseBranch = text("baseBranch");
  return { source, path, branch, baseSha, ...(baseBranch ? { baseBranch } : {}) };
}

export const WORKTREE_AGENTS_MAX = 8;

export function parseWorktreeAgents(value: unknown): WorktreeAgentSpec[] {
  if (!Array.isArray(value)) return [];
  const out: WorktreeAgentSpec[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const providerId = typeof raw.providerId === "string" ? raw.providerId.trim() : "";
    const model = typeof raw.model === "string" ? raw.model.trim() : "";
    if (!providerId || !model) continue;
    const effort =
      typeof raw.reasoningEffort === "string" && raw.reasoningEffort.trim()
        ? (raw.reasoningEffort.trim() as CodexReasoningEffort)
        : undefined;
    out.push({ providerId, model, ...(effort ? { reasoningEffort: effort } : {}) });
    if (out.length >= WORKTREE_AGENTS_MAX) break;
  }
  return out;
}

/** `git diff --shortstat` → counts. Empty output is a clean tree. */
export function parseShortStat(text: string): WorktreeDiffStat {
  const num = (re: RegExp) => Number(re.exec(text)?.[1] ?? 0) || 0;
  return {
    files: num(/(\d+) files? changed/),
    insertions: num(/(\d+) insertions?\(\+\)/),
    deletions: num(/(\d+) deletions?\(-\)/),
  };
}

/** Counts from a unified diff (used when only a patch is available, e.g. Docker workers). */
export function diffStatFromPatch(patch: string): WorktreeDiffStat {
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) files += 1;
    else if (line.startsWith("+++") || line.startsWith("---")) continue;
    else if (line.startsWith("+")) insertions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { files, insertions, deletions };
}

export interface GitWorktreeEntry {
  path: string;
  head?: string;
  branch?: string;
  detached?: boolean;
  bare?: boolean;
  prunable?: boolean;
}

/** Parse `git worktree list --porcelain`. */
export function parseWorktreeList(text: string): GitWorktreeEntry[] {
  const out: GitWorktreeEntry[] = [];
  let cur: GitWorktreeEntry | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      if (cur) out.push(cur);
      cur = undefined;
      continue;
    }
    const space = line.indexOf(" ");
    const key = space < 0 ? line : line.slice(0, space);
    const val = space < 0 ? "" : line.slice(space + 1);
    if (key === "worktree") {
      if (cur) out.push(cur);
      cur = { path: val };
      continue;
    }
    if (!cur) continue;
    if (key === "HEAD") cur.head = val;
    else if (key === "branch") cur.branch = val.replace(/^refs\/heads\//, "");
    else if (key === "detached") cur.detached = true;
    else if (key === "bare") cur.bare = true;
    else if (key === "prunable") cur.prunable = true;
  }
  if (cur) out.push(cur);
  return out;
}

/** Default files copied from the source checkout into a fresh worktree (git-ignored, so absent). */
export function isWorktreeSeedFile(name: string): boolean {
  if (name === ".env.example" || name === ".env.sample" || name === ".env.template") return false;
  return /^\.env(\.[A-Za-z0-9_-]+)*$/.test(name) || name === ".envrc" || name === ".npmrc";
}

/** `.locus/worktree.json`: extra files to copy and a setup command for each new worktree. */
export interface WorktreeSetupConfig {
  copy: string[];
  setup?: string;
}

export function parseWorktreeSetupConfig(value: unknown): WorktreeSetupConfig {
  if (!value || typeof value !== "object") return { copy: [] };
  const raw = value as Record<string, unknown>;
  const copy = Array.isArray(raw.copy)
    ? raw.copy
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().replace(/\\/g, "/"))
        .filter(
          (item) =>
            item &&
            !item.startsWith("/") &&
            !/^[A-Za-z]:/.test(item) &&
            !item.split("/").some((part) => part === ".." || part === ".git"),
        )
        .slice(0, 64)
    : [];
  const setup = typeof raw.setup === "string" && raw.setup.trim() ? raw.setup.trim() : undefined;
  return { copy, ...(setup ? { setup } : {}) };
}

export function worktreeWorkerPlaybook(branch: string, role: string, count: number): string {
  return [
    `You are agent ${role} of ${count} working on the same task in parallel.`,
    `Your workspace is a private git worktree on branch ${branch}; other agents cannot see your files.`,
    "Commit your work on this branch when done. Do not push or open a pull request unless asked.",
    "Prefer a distinct approach from the other agents.",
  ].join(" ");
}
