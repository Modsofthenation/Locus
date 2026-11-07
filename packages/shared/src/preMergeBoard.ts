import { hasConflictMarkers } from "./conflictMarkers.js";
import { layerForPath, type ChangeStack } from "./changeStack.js";
import type { LoadPathReview } from "./loadpath.js";
import type { PullCheck, PullComment } from "./models/repo.js";

const FAILING_CHECKS = new Set<PullCheck["status"]>(["failure", "error", "cancelled"]);
const REVIEW_SUMMARY_RE = /^#{1,3}\s*Review PR\b/i;

export interface PreMergeRow {
  id: string;
  kind: "check" | "comment" | "conflict" | "risk";
  title: string;
  detail: string;
  path?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
  layerId?: string;
}

export interface PreMergeBoard {
  failingChecks: PreMergeRow[];
  openComments: PreMergeRow[];
  conflicts: PreMergeRow[];
  highRiskFiles: PreMergeRow[];
}

export function preMergeAttention(board: PreMergeBoard): number {
  return (
    board.failingChecks.length +
    board.openComments.length +
    board.conflicts.length +
    board.highRiskFiles.length
  );
}

export function buildPreMergeBoard(input: {
  checks?: PullCheck[];
  comments?: PullComment[];
  files?: Array<{ path: string; patch?: string }>;
  loadPath?: LoadPathReview | null;
  stack?: ChangeStack | null;
}): PreMergeBoard {
  const stack = input.stack ?? null;
  const failingChecks = (input.checks ?? [])
    .filter((row) => FAILING_CHECKS.has(row.status))
    .map((row) => ({
      id: `check:${row.name}`,
      kind: "check" as const,
      title: row.name,
      detail: row.status.replace(/_/g, " "),
    }));

  const openComments = (input.comments ?? [])
    .filter((row) => !REVIEW_SUMMARY_RE.test(row.body.trim()))
    .slice(0, 12)
    .map((row) => {
      const layerId = row.path && stack ? layerForPath(stack, row.path)?.layerId : undefined;
      const where = row.path ? `${row.path}${row.line ? `:${row.line}` : ""}` : "conversation";
      return {
        id: `comment:${row.id}`,
        kind: "comment" as const,
        title: clip(row.body),
        detail: `${row.author || "comment"} · ${where}`,
        path: row.path,
        line: row.line,
        side: row.side,
        layerId,
      };
    });

  const conflicts = (input.files ?? [])
    .filter((file) => file.patch && hasConflictMarkers(file.patch))
    .map((file) => ({
      id: `conflict:${file.path}`,
      kind: "conflict" as const,
      title: file.path,
      detail: "Conflict markers in the diff",
      path: file.path,
      layerId: stack ? layerForPath(stack, file.path)?.layerId : undefined,
    }));

  const highRiskFiles = highRiskRows(input.loadPath ?? null, stack);

  return { failingChecks, openComments, conflicts, highRiskFiles };
}

function highRiskRows(loadPath: LoadPathReview | null, stack: ChangeStack | null): PreMergeRow[] {
  if (!loadPath) return [];
  const seen = new Set<string>();
  const rows: PreMergeRow[] = [];
  const push = (path: string, detail: string) => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    rows.push({
      id: `risk:${path}`,
      kind: "risk",
      title: path,
      detail,
      path,
      layerId: stack ? layerForPath(stack, path)?.layerId : undefined,
    });
  };
  for (const sink of loadPath.untestedSinks) {
    push(sink.path, `Untested ${sink.layer} sink`);
  }
  if (loadPath.risk === "high") {
    for (const node of loadPath.nodes) {
      if (node.layer === "permissions" || (node.sink && !node.tested)) {
        push(node.path, `${node.layer} · ${node.kind}`);
      }
    }
  }
  return rows;
}

function clip(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= 96 ? line : `${line.slice(0, 95)}…`;
}
