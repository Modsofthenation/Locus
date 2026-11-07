import { formatChecksCursor, newCheckFailures } from "./subscribe.js";
import { wrapUntrusted } from "../untrusted.js";

/** Last forge snapshot the project watcher has already handled for one member. */
export interface FleetWatchEntry {
  checks?: string;
  checkState?: string;
  commentIds: string[];
  fixSignature?: string;
  readySignature?: string;
}

export interface FleetWakePull {
  number: number;
  state?: string;
  headSha: string;
  checkState?: string;
  checks: Array<{ name: string; status: string }>;
  comments: Array<{ id: string; author?: string; body: string }>;
}

export interface FleetWakeDecision {
  action: "prime" | "spawn" | "ready" | "none";
  entry: FleetWatchEntry;
  task?: string;
  reason?: string;
}

function commentIds(pull: FleetWakePull): string[] {
  return pull.comments
    .map((row) => row.id)
    .filter(Boolean)
    .slice(-40);
}

function entryFrom(pull: FleetWakePull, extra: Partial<FleetWatchEntry> = {}): FleetWatchEntry {
  return {
    checks: formatChecksCursor(pull.headSha, pull.checks),
    checkState: pull.checkState,
    commentIds: commentIds(pull),
    ...extra,
  };
}

/**
 * One step of the project fleet watcher.
 * The first snapshot primes and does not spawn. Later snapshots spawn on a new
 * failing check or a new review comment, or flag Needs you when CI goes green.
 * Merge is never the action.
 */
export function decideFleetWake(
  previous: FleetWatchEntry | undefined,
  pull: FleetWakePull,
): FleetWakeDecision {
  if (!previous) {
    return { action: "prime", entry: entryFrom(pull) };
  }
  const failures = newCheckFailures(previous.checks, pull.checks);
  const seen = new Set(previous.commentIds);
  const freshComments = pull.comments.filter((row) => row.id && !seen.has(row.id)).slice(-4);
  const failureKey = failures
    .map((row) => row.name)
    .sort()
    .join(",");
  const commentKey = freshComments
    .map((row) => row.id)
    .sort()
    .join(",");
  const fixSignature = `fix:${pull.headSha}:${failureKey}:${commentKey}`;
  if ((failures.length > 0 || freshComments.length > 0) && previous.fixSignature !== fixSignature) {
    const lines = [
      ...failures.map((row) => `${row.name}: ${row.status}`),
      ...freshComments.map(
        (row) => `${row.author ?? "reviewer"}: ${(row.body ?? "").slice(0, 400)}`,
      ),
    ];
    const task = [
      `Pull request #${pull.number} needs a fix on its existing branch. Do not merge. git_pr_merge stays behind Approve.`,
      "Stop when the tests you can run locally pass and the branch is pushed.",
      "",
      wrapUntrusted({
        kind: "pr-text",
        source: `pr-${pull.number}`,
        text: lines.join("\n") || "(no detail)",
      }),
    ].join("\n");
    return {
      action: "spawn",
      task,
      entry: entryFrom(pull, { fixSignature, readySignature: previous.readySignature }),
    };
  }
  const readySignature = `green:${pull.headSha}`;
  const becameGreen =
    pull.state === "open" &&
    pull.checkState === "success" &&
    previous.checkState !== undefined &&
    previous.checkState !== "success" &&
    previous.readySignature !== readySignature;
  if (becameGreen) {
    return {
      action: "ready",
      reason: `Propose merge #${pull.number}. CI success. Approve git_pr_merge on the member.`,
      entry: entryFrom(pull, {
        fixSignature: previous.fixSignature,
        readySignature,
      }),
    };
  }
  return {
    action: "none",
    entry: entryFrom(pull, {
      fixSignature: previous.fixSignature,
      readySignature: previous.readySignature,
    }),
  };
}

export function parseFleetWatchMap(raw: unknown): Record<string, FleetWatchEntry> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, FleetWatchEntry> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key.trim() || !value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const commentIds = Array.isArray(row.commentIds)
      ? row.commentIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
      : [];
    out[key] = {
      checks: typeof row.checks === "string" ? row.checks : undefined,
      checkState: typeof row.checkState === "string" ? row.checkState : undefined,
      commentIds,
      fixSignature: typeof row.fixSignature === "string" ? row.fixSignature : undefined,
      readySignature: typeof row.readySignature === "string" ? row.readySignature : undefined,
    };
  }
  return Object.keys(out).length ? out : undefined;
}

/** True when quitting the desktop should leave the control-plane process running. */
export function projectKeepsControlPlane(
  projects: Array<{ keepAlive?: boolean; paused?: boolean; archived?: boolean }>,
): boolean {
  return projects.some(
    (row) => row.keepAlive === true && row.paused !== true && row.archived !== true,
  );
}
