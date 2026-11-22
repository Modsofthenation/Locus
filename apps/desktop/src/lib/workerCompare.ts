import {
  formatUsd,
  type WorkerBoardRow,
  type WorkerRankEntry,
  type WorkerRanking,
} from "@locus/shared";

/** "Tests pass" / "Tests fail" / "Not run". */
export function compareTestsLabel(row: Pick<WorkerBoardRow, "tests">): {
  text: string;
  tone: "ok" | "danger" | "muted";
} {
  if (row.tests === "pass") return { text: "Tests pass", tone: "ok" };
  if (row.tests === "fail") return { text: "Tests fail", tone: "danger" };
  return { text: "Tests not run", tone: "muted" };
}

export function compareCostLabel(row: Pick<WorkerBoardRow, "usd">): string {
  return typeof row.usd === "number" ? formatUsd(row.usd) : "—";
}

/** Rank entry per attempt id. */
export function rankById(ranking: WorkerRanking | null): Map<string, WorkerRankEntry> {
  return new Map((ranking?.entries ?? []).map((entry) => [entry.id, entry]));
}

/** Columns in rank order when ranked, else board order. */
export function orderByRank(
  rows: WorkerBoardRow[],
  ranking: WorkerRanking | null,
): WorkerBoardRow[] {
  if (!ranking) return rows;
  const ranks = rankById(ranking);
  return [...rows].sort(
    (a, b) =>
      (ranks.get(a.id)?.rank ?? Number.POSITIVE_INFINITY) -
      (ranks.get(b.id)?.rank ?? Number.POSITIVE_INFINITY),
  );
}

/** The attempts left after picking one; these are offered for discard. */
export function otherAttempts(rows: WorkerBoardRow[], pickedId: string): WorkerBoardRow[] {
  return rows.filter((row) => row.id !== pickedId);
}

/** "Discard 3 other attempts?" */
export function discardOthersTitle(count: number): string {
  return count === 1 ? "Discard the other attempt?" : `Discard ${count} other attempts?`;
}
