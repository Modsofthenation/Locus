import {
  isPullCacheFresh,
  type PullListState,
  type PullRequestDetail,
  type PullRequestRef,
} from "@locus/shared";

type ListEntry = { at: number; rows: PullRequestRef[] };
type DetailEntry = { at: number; pull: PullRequestDetail };

const lists = new Map<string, ListEntry>();
const details = new Map<string, DetailEntry>();

export function pullListCacheKey(repoId: string, state: PullListState): string {
  return `${repoId}:${state}`;
}

export function pullDetailCacheKey(repoId: string, number: number): string {
  return `${repoId}:${number}`;
}

export function peekPullList(
  repoId: string,
  state: PullListState,
): { rows: PullRequestRef[]; fresh: boolean } | undefined {
  const hit = lists.get(pullListCacheKey(repoId, state));
  if (!hit) return undefined;
  return { rows: hit.rows, fresh: isPullCacheFresh(hit.at) };
}

export function peekPullDetail(
  repoId: string,
  number: number,
): { pull: PullRequestDetail; fresh: boolean } | undefined {
  const hit = details.get(pullDetailCacheKey(repoId, number));
  if (!hit) return undefined;
  return { pull: hit.pull, fresh: isPullCacheFresh(hit.at) };
}

export function rememberPullList(
  repoId: string,
  state: PullListState,
  rows: PullRequestRef[],
  at = Date.now(),
): void {
  lists.set(pullListCacheKey(repoId, state), { at, rows });
}

export function rememberPullDetail(
  repoId: string,
  number: number,
  pull: PullRequestDetail,
  at = Date.now(),
): void {
  details.set(pullDetailCacheKey(repoId, number), { at, pull });
}

export function invalidatePullLists(repoId: string): void {
  const prefix = `${repoId}:`;
  for (const key of lists.keys()) {
    if (key.startsWith(prefix)) lists.delete(key);
  }
}

export function clearPullCaches(repoId?: string): void {
  if (!repoId) {
    lists.clear();
    details.clear();
    return;
  }
  invalidatePullLists(repoId);
  const prefix = `${repoId}:`;
  for (const key of details.keys()) {
    if (key.startsWith(prefix)) details.delete(key);
  }
}
