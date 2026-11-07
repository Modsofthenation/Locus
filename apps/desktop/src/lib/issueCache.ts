import {
  isPullCacheFresh,
  type IssueDetail,
  type IssueListState,
  type IssueRef,
} from "@locus/shared";

type ListEntry = { at: number; rows: IssueRef[] };
type DetailEntry = { at: number; issue: IssueDetail };

const lists = new Map<string, ListEntry>();
const details = new Map<string, DetailEntry>();

export function issueListCacheKey(repoId: string, state: IssueListState): string {
  return `${repoId}:${state}`;
}

export function issueDetailCacheKey(repoId: string, number: number): string {
  return `${repoId}:${number}`;
}

export function peekIssueList(
  repoId: string,
  state: IssueListState,
): { rows: IssueRef[]; fresh: boolean } | undefined {
  const hit = lists.get(issueListCacheKey(repoId, state));
  if (!hit) return undefined;
  return { rows: hit.rows, fresh: isPullCacheFresh(hit.at) };
}

export function peekIssueDetail(
  repoId: string,
  number: number,
): { issue: IssueDetail; fresh: boolean } | undefined {
  const hit = details.get(issueDetailCacheKey(repoId, number));
  if (!hit) return undefined;
  return { issue: hit.issue, fresh: isPullCacheFresh(hit.at) };
}

export function rememberIssueList(
  repoId: string,
  state: IssueListState,
  rows: IssueRef[],
  at = Date.now(),
): void {
  lists.set(issueListCacheKey(repoId, state), { at, rows });
}

export function rememberIssueDetail(
  repoId: string,
  number: number,
  issue: IssueDetail,
  at = Date.now(),
): void {
  details.set(issueDetailCacheKey(repoId, number), { at, issue });
}

export function invalidateIssueLists(repoId: string): void {
  const prefix = `${repoId}:`;
  for (const key of lists.keys()) {
    if (key.startsWith(prefix)) lists.delete(key);
  }
}

export function clearIssueCaches(repoId?: string): void {
  if (!repoId) {
    lists.clear();
    details.clear();
    return;
  }
  invalidateIssueLists(repoId);
  const prefix = `${repoId}:`;
  for (const key of details.keys()) {
    if (key.startsWith(prefix)) details.delete(key);
  }
}
