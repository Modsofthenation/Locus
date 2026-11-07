import type { AgentRuntime, GuestOs } from "./vm.js";
import {
  isForgeKind,
  normalizeRepoUrl,
  parseRepoCheckout,
  parseRepoUrl,
  repoDisplayName,
  type ForgeKind,
  type RepoCheckout,
} from "./git.js";
import { wrapUntrusted } from "../untrusted.js";
import { normalizeRepoReviewPrompt } from "./reviewPrompt.js";

export const PULL_STATES = ["open", "draft", "merged", "closed"] as const;
export type PullState = (typeof PULL_STATES)[number];

export const PULL_LIST_STATES = ["open", "draft", "all"] as const;
export type PullListState = (typeof PULL_LIST_STATES)[number];

export function isPullState(value: unknown): value is PullState {
  return value === "open" || value === "draft" || value === "merged" || value === "closed";
}

export function isPullListState(value: unknown): value is PullListState {
  return value === "open" || value === "draft" || value === "all";
}

export function parsePullListState(value: unknown): PullListState {
  return isPullListState(value) ? value : "open";
}

export const PULL_CHECK_ROLLUPS = ["success", "failure", "pending", "neutral"] as const;
export type PullCheckRollup = (typeof PULL_CHECK_ROLLUPS)[number];

export function isPullCheckRollup(value: unknown): value is PullCheckRollup {
  return value === "success" || value === "failure" || value === "pending" || value === "neutral";
}

/** Map forge CI / check-rollup strings onto the four list-row states. */
export function parsePullCheckRollup(value: unknown): PullCheckRollup | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const raw = value.trim().toLowerCase();
  if (raw === "success" || raw === "passed") return "success";
  if (raw === "failure" || raw === "failed" || raw === "error") return "failure";
  if (
    raw === "pending" ||
    raw === "queued" ||
    raw === "in_progress" ||
    raw === "running" ||
    raw === "expected"
  ) {
    return "pending";
  }
  if (raw === "neutral" || raw === "cancelled" || raw === "canceled" || raw === "skipped") {
    return "neutral";
  }
  return undefined;
}

/** How long a Codebase PR list or detail stays valid before the next forge fetch. */
export const PULL_CACHE_TTL_MS = 2 * 60 * 1000;

export function isPullCacheFresh(
  fetchedAt: string | number,
  now = Date.now(),
  ttlMs = PULL_CACHE_TTL_MS,
): boolean {
  const t = typeof fetchedAt === "number" ? fetchedAt : Date.parse(fetchedAt);
  return Number.isFinite(t) && now - t >= 0 && now - t < ttlMs;
}

export function wantsFreshPulls(value: unknown): boolean {
  return value === true || value === "1" || value === "true";
}

export const ISSUE_STATES = ["open", "closed"] as const;
export type IssueState = (typeof ISSUE_STATES)[number];

export const ISSUE_LIST_STATES = ["open", "closed", "all"] as const;
export type IssueListState = (typeof ISSUE_LIST_STATES)[number];

export function isIssueState(value: unknown): value is IssueState {
  return value === "open" || value === "closed";
}

export function isIssueListState(value: unknown): value is IssueListState {
  return value === "open" || value === "closed" || value === "all";
}

export function parseIssueListState(value: unknown): IssueListState {
  return isIssueListState(value) ? value : "open";
}

export function parseIssueState(value: unknown): IssueState {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    raw === "closed" ||
    raw === "resolved" ||
    raw === "invalid" ||
    raw === "duplicate" ||
    raw === "wontfix" ||
    raw === "wont fix"
  ) {
    return "closed";
  }
  return "open";
}

export function isDraftPull(row: { state?: string; draft?: boolean }): boolean {
  return row.draft === true || row.state === "draft";
}

export function isOpenInboxPull(row: { state?: string; draft?: boolean }): boolean {
  return row.state === "open" || isDraftPull(row);
}

export interface LinkedRepo {
  id: string;
  name: string;
  checkout: RepoCheckout;
  defaultRuntime?: AgentRuntime;
  dockerImage?: string;
  os?: GuestOs;
  playbook?: string;
  /** Extra review rules for this repo, appended to the standard review lens. */
  reviewPrompt?: string;
  autoReview?: boolean;
  /** Named environment to boot later coding agents from (golden image + jail). */
  namedEnvironmentId?: string;
  lastFetchAt?: string;
  lastPushedAt?: string;
  openPullCount?: number;
  openIssueCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PullRequestRef {
  repoId: string;
  forge: ForgeKind;
  number: number;
  title: string;
  state: PullState;
  headRef: string;
  baseRef: string;
  headSha: string;
  url: string;
  author?: string;
  authorAvatarUrl?: string;
  draft?: boolean;
  createdAt?: string;
  updatedAt: string;
  commentCount?: number;
  reviewCount?: number;
  reviewers?: string[];
  checkState?: PullCheckRollup;
  sessionIds?: string[];
}

export interface PullFile {
  path: string;
  status: "added" | "modified" | "removed" | "renamed" | "changed";
  patch?: string;
  previousPath?: string;
  /** GitHub viewer viewed-file state. Other forges omit this. */
  viewed?: boolean;
}

export interface PullComment {
  id: string;
  body: string;
  author?: string;
  path?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
  createdAt: string;
  url?: string;
}

export interface PullCheck {
  name: string;
  status: "queued" | "in_progress" | "success" | "failure" | "cancelled" | "neutral" | "error";
  url?: string;
}

export interface PullCommit {
  sha: string;
  message: string;
  author?: string;
  createdAt?: string;
}

export interface PullRequestDetail extends PullRequestRef {
  body?: string;
  files: PullFile[];
  comments: PullComment[];
  commits: PullCommit[];
  checks: PullCheck[];
}

export interface IssueComment {
  id: string;
  body: string;
  author?: string;
  createdAt: string;
  url?: string;
}

export interface IssueRef {
  repoId: string;
  forge: ForgeKind;
  number: number;
  title: string;
  state: IssueState;
  url: string;
  author?: string;
  authorAvatarUrl?: string;
  createdAt?: string;
  updatedAt: string;
  commentCount?: number;
  labels?: string[];
  assignees?: string[];
}

export interface IssueDetail extends IssueRef {
  body?: string;
  comments: IssueComment[];
}

export interface ForgeRepoHint {
  forge: ForgeKind;
  accountId: string;
  accountName: string;
  owner: string;
  name: string;
  url: string;
  defaultBranch?: string;
  private?: boolean;
}

export interface RepoBranchList {
  branches: string[];
  defaultBranch?: string;
}

/** Default first, then remaining names in the order given. */
export function mergeRepoBranches(names: string[], defaultBranch?: string): RepoBranchList {
  const seen = new Set<string>();
  const branches: string[] = [];
  const add = (value?: string) => {
    const name = value?.trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    branches.push(name);
  };
  const fallback = defaultBranch?.trim() || undefined;
  add(fallback);
  for (const name of names) add(name);
  return { branches, defaultBranch: fallback };
}

export interface ForgeImportAccount {
  accountId: string;
  accountName: string;
  kind: ForgeKind;
  error?: string;
  repos: ForgeRepoHint[];
}

export interface CreateLinkedRepoInput {
  url: string;
  name?: string;
  ref?: string;
  accountId?: string;
}

export interface PatchLinkedRepoInput {
  name?: string;
  ref?: string;
  accountId?: string;
  defaultRuntime?: AgentRuntime | null;
  dockerImage?: string | null;
  os?: GuestOs | null;
  playbook?: string | null;
  reviewPrompt?: string | null;
  autoReview?: boolean;
  namedEnvironmentId?: string | null;
}

export function parseLinkedRepo(raw: unknown): LinkedRepo | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : undefined;
  const checkout = parseRepoCheckout(value.checkout);
  if (!id || !checkout) return undefined;
  const name =
    typeof value.name === "string" && value.name.trim()
      ? value.name.trim()
      : repoDisplayName(checkout.url);
  const createdAt =
    typeof value.createdAt === "string" && value.createdAt.trim()
      ? value.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof value.updatedAt === "string" && value.updatedAt.trim() ? value.updatedAt : createdAt;
  return {
    id,
    name,
    checkout,
    defaultRuntime:
      value.defaultRuntime === "docker" || value.defaultRuntime === "vm"
        ? value.defaultRuntime
        : undefined,
    dockerImage:
      typeof value.dockerImage === "string" && value.dockerImage.trim()
        ? value.dockerImage.trim()
        : undefined,
    os:
      value.os === "ubuntu" ||
      value.os === "debian" ||
      value.os === "omarchy" ||
      value.os === "windows-11" ||
      value.os === "windows-10"
        ? value.os
        : undefined,
    playbook:
      typeof value.playbook === "string" && value.playbook.trim()
        ? value.playbook.trim()
        : undefined,
    reviewPrompt: normalizeRepoReviewPrompt(value.reviewPrompt),
    autoReview: value.autoReview === true,
    namedEnvironmentId:
      typeof value.namedEnvironmentId === "string" && value.namedEnvironmentId.trim()
        ? value.namedEnvironmentId.trim()
        : undefined,
    lastFetchAt: typeof value.lastFetchAt === "string" ? value.lastFetchAt : undefined,
    lastPushedAt: typeof value.lastPushedAt === "string" ? value.lastPushedAt : undefined,
    openPullCount:
      typeof value.openPullCount === "number" && Number.isFinite(value.openPullCount)
        ? value.openPullCount
        : undefined,
    openIssueCount:
      typeof value.openIssueCount === "number" && Number.isFinite(value.openIssueCount)
        ? value.openIssueCount
        : undefined,
    createdAt,
    updatedAt,
  };
}

export function parseLinkedRepos(raw: unknown): LinkedRepo[] {
  if (!Array.isArray(raw)) return [];
  const out: LinkedRepo[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const repo = parseLinkedRepo(row);
    if (!repo) continue;
    const key = `${repo.checkout.accountId ?? ""}:${normalizeRepoUrl(repo.checkout.url)}`;
    if (seen.has(key) || seen.has(repo.id)) continue;
    seen.add(key);
    seen.add(repo.id);
    out.push(repo);
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));
}

export function matchLinkedRepo(
  repos: LinkedRepo[],
  url?: string,
  accountId?: string,
): LinkedRepo | undefined {
  if (!url) return undefined;
  const key = normalizeRepoUrl(url);
  const matches = repos.filter((row) => normalizeRepoUrl(row.checkout.url) === key);
  if (accountId) return matches.find((row) => row.checkout.accountId === accountId) ?? matches[0];
  return matches[0];
}

/** Resolve a create/patch checkout against the linked catalog. Unknown `repoId` throws. */
export function attachLinkedCheckout(
  repos: LinkedRepo[],
  input: { repoId?: string; repo?: RepoCheckout },
): { repoId?: string; repo?: RepoCheckout } {
  if (input.repoId) {
    const linked = repos.find((row) => row.id === input.repoId);
    if (!linked) throw new Error("Unknown linked repo");
    return { repoId: linked.id, repo: { ...linked.checkout, ...input.repo } };
  }
  if (!input.repo?.url) return {};
  const match = matchLinkedRepo(repos, input.repo.url, input.repo.accountId);
  return { repoId: match?.id, repo: input.repo };
}

export function parsePullFile(raw: unknown): PullFile | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const path = typeof value.path === "string" && value.path.trim() ? value.path.trim() : undefined;
  if (!path) return undefined;
  const status =
    value.status === "added" ||
    value.status === "modified" ||
    value.status === "removed" ||
    value.status === "renamed" ||
    value.status === "changed"
      ? value.status
      : "modified";
  return {
    path,
    status,
    patch: typeof value.patch === "string" ? value.patch : undefined,
    previousPath: typeof value.previousPath === "string" ? value.previousPath : undefined,
    viewed: typeof value.viewed === "boolean" ? value.viewed : undefined,
  };
}

/** Budget for unified diffs inlined into git_pr_get so a 70-file PR does not flood the prompt. */
const PULL_PATCH_BUDGET = 24_000;
const PULL_PATCH_FILE_MAX = 4_096;

export const GIT_PR_GET_INCLUDES = ["summary", "files", "comments", "checks"] as const;
export type GitPrGetInclude = (typeof GIT_PR_GET_INCLUDES)[number];

export function isGitPrGetInclude(value: string): value is GitPrGetInclude {
  return (GIT_PR_GET_INCLUDES as readonly string[]).includes(value);
}

/** Keep git_pr_get scoped to the files the reviewer named. */
export function selectPullFiles(files: PullFile[], paths?: string[]): PullFile[] {
  if (!paths?.length) return files;
  return files.filter((file) =>
    paths.some((path) => file.path === path || file.path.endsWith(`/${path}`)),
  );
}

export function parseGitPrGetInclude(raw: unknown): GitPrGetInclude[] | undefined {
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const includes = values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter(isGitPrGetInclude);
  return includes.length ? [...new Set(includes)] : undefined;
}

const PULL_COMMENT_LIMIT = 24;
const PULL_COMMENT_BODY_MAX = 180;
const REVIEW_SUMMARY_RE = /^#{1,3}\s*Review PR\b/i;

function isReviewSummaryComment(body: string): boolean {
  return REVIEW_SUMMARY_RE.test(body.trim());
}

function commentThreadKey(row: PullComment): string {
  if (row.path) return `${row.path}#${row.line ?? 0}`;
  return `general:${row.id}`;
}

function clipCommentBody(body: string): string {
  const first =
    body
      .split(/\r?\n/)
      .map((line) => line.replace(/^#{1,6}\s*/, "").trim())
      .find((line) => line.length > 0) ?? "";
  if (first.length <= PULL_COMMENT_BODY_MAX) return first;
  return `${first.slice(0, PULL_COMMENT_BODY_MAX)}…`;
}

/** Existing PR comments for git_pr_get and the review prompt (untrusted). */
export function formatPullComments(comments: PullComment[], limit = PULL_COMMENT_LIMIT): string {
  if (!comments.length) return "(no comments)";
  const findings = comments.filter((row) => !isReviewSummaryComment(row.body));
  const selected = findings.length ? findings : comments;
  const groups = new Map<string, PullComment[]>();
  const order: string[] = [];
  for (const row of selected) {
    const key = commentThreadKey(row);
    const existing = groups.get(key);
    if (existing) {
      existing.push(row);
      continue;
    }
    groups.set(key, [row]);
    order.push(key);
  }
  const rows: string[] = [];
  let counted = 0;
  for (const key of order) {
    if (counted >= limit) break;
    const group = groups.get(key) ?? [];
    const slice = group.slice(0, limit - counted);
    counted += slice.length;
    const head = slice[0];
    const loc = head?.path ? `${head.path}${head.line ? `:${head.line}` : ""}` : "";
    rows.push(
      slice
        .map((row, index) => {
          const who = row.author ?? "unknown";
          const body = clipCommentBody(row.body);
          if (index === 0) return `${who}${loc ? ` ${loc}` : ""}: ${body}`;
          return `  ${who}: ${body}`;
        })
        .join("\n"),
    );
  }
  const extra = selected.length > counted ? `\n…${selected.length - counted} more` : "";
  return wrapUntrusted({
    kind: "pr-text",
    source: "comments",
    text: `${rows.join("\n\n")}${extra}`,
  });
}

/** Spend the git_pr_get patch budget on these paths first (load-path read order). */
export function orderPullFilesForPatches(files: PullFile[], priority?: string[]): PullFile[] {
  if (!priority?.length) return files;
  const remaining = [...files];
  const first: PullFile[] = [];
  for (const path of priority) {
    const idx = remaining.findIndex((file) => file.path === path || file.path.endsWith(`/${path}`));
    if (idx >= 0) first.push(remaining.splice(idx, 1)[0]!);
  }
  return [...first, ...remaining];
}

export const PULL_PATCH_INCLUDED_NOTE =
  "Patches included for every text file in this response. Do not re-call git_pr_get with paths[].";

export function pullPatchSkippedNote(paths: string[]): string {
  return `Patch budget skipped ${paths.length} file(s): ${paths.join(", ")}. Re-call git_pr_get with paths=[those files] only.`;
}

/** File list plus clipped untrusted patches for git_pr_get. Files without a remaining budget are listed by path only. */
export function formatPullFiles(
  files: PullFile[],
  paths?: string[],
  opts?: { priority?: string[] },
): string {
  const selected = orderPullFilesForPatches(selectPullFiles(files, paths), opts?.priority);
  if (!selected.length) return "(no files)";
  const parts: string[] = [];
  const skipped: string[] = [];
  let budget = PULL_PATCH_BUDGET;
  let inlined = 0;
  for (const file of selected) {
    const from = file.previousPath ? ` (from ${file.previousPath})` : "";
    const header = `${file.status} ${file.path}${from}`;
    const patch = file.patch?.trim();
    if (!patch) {
      parts.push(header);
      continue;
    }
    if (budget <= 0) {
      skipped.push(file.path);
      parts.push(header);
      continue;
    }
    const wrapped = wrapUntrusted({
      kind: "pr-text",
      source: `patch:${file.path}`,
      text: patch,
      maxBytes: Math.min(PULL_PATCH_FILE_MAX, budget),
    });
    budget -= wrapped.length;
    inlined += 1;
    parts.push(`${header}\n${wrapped}`);
  }
  const footer = skipped.length
    ? pullPatchSkippedNote(skipped)
    : inlined
      ? PULL_PATCH_INCLUDED_NOTE
      : "";
  return footer ? `${parts.join("\n\n")}\n\n${footer}` : parts.join("\n\n");
}

/** GitHub 422 when the reviewer is the PR author. */
export function isOwnPullReviewRejected(output: string): boolean {
  const text = output.toLowerCase();
  return (
    /can(?:not| not) (?:approve|request changes)(?: on)? (?:your|their) own (?:pull|merge) request/.test(
      text,
    ) ||
    /review_on_self|pullrequestreviewrevieweronself/.test(text) ||
    /you cannot approve your own/.test(text)
  );
}

export function ownPullReviewFallbackNote(event: "APPROVE" | "REQUEST_CHANGES"): string {
  const verdict = event === "APPROVE" ? "PASS" : "FAIL";
  return `Posted as COMMENT (GitHub does not allow ${event} on the author's own PR). Keep the JSON verdict (${verdict}).`;
}

export function parsePullRequestDetail(
  raw: unknown,
  repoId?: string,
): PullRequestDetail | undefined {
  const ref = parsePullRequestRef(raw, repoId);
  if (!ref) return undefined;
  const value = raw as Record<string, unknown>;
  return {
    ...ref,
    body: typeof value.body === "string" ? value.body : undefined,
    files: Array.isArray(value.files) ? value.files.flatMap((row) => parsePullFile(row) ?? []) : [],
    comments: Array.isArray(value.comments)
      ? value.comments.flatMap((row) => {
          if (!row || typeof row !== "object") return [];
          const item = row as Record<string, unknown>;
          const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : undefined;
          const body = typeof item.body === "string" ? item.body : "";
          if (!id) return [];
          const side = item.side === "LEFT" || item.side === "RIGHT" ? item.side : undefined;
          return [
            {
              id,
              body,
              author: typeof item.author === "string" ? item.author : undefined,
              path: typeof item.path === "string" ? item.path : undefined,
              line:
                typeof item.line === "number" && Number.isFinite(item.line) ? item.line : undefined,
              side,
              createdAt:
                typeof item.createdAt === "string" && item.createdAt
                  ? item.createdAt
                  : ref.updatedAt,
              url: typeof item.url === "string" ? item.url : undefined,
            },
          ];
        })
      : [],
    commits: Array.isArray(value.commits)
      ? value.commits.flatMap((row) => {
          if (!row || typeof row !== "object") return [];
          const item = row as Record<string, unknown>;
          const sha = typeof item.sha === "string" && item.sha.trim() ? item.sha.trim() : undefined;
          if (!sha) return [];
          return [
            {
              sha,
              message: typeof item.message === "string" ? item.message : "",
              author: typeof item.author === "string" ? item.author : undefined,
              createdAt: typeof item.createdAt === "string" ? item.createdAt : undefined,
            },
          ];
        })
      : [],
    checks: Array.isArray(value.checks)
      ? value.checks.flatMap((row) => {
          if (!row || typeof row !== "object") return [];
          const item = row as Record<string, unknown>;
          const name =
            typeof item.name === "string" && item.name.trim() ? item.name.trim() : undefined;
          if (!name) return [];
          const status =
            item.status === "queued" ||
            item.status === "in_progress" ||
            item.status === "success" ||
            item.status === "failure" ||
            item.status === "cancelled" ||
            item.status === "neutral" ||
            item.status === "error"
              ? item.status
              : "neutral";
          return [{ name, status, url: typeof item.url === "string" ? item.url : undefined }];
        })
      : [],
  };
}

export function parsePullListCache(
  raw: unknown,
  repoId?: string,
): { fetchedAt: string; state: PullListState; pulls: PullRequestRef[] } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const fetchedAt =
    typeof value.fetchedAt === "string" && value.fetchedAt.trim()
      ? value.fetchedAt.trim()
      : undefined;
  if (!fetchedAt) return undefined;
  const pulls = Array.isArray(value.pulls)
    ? value.pulls.flatMap((row) => parsePullRequestRef(row, repoId) ?? [])
    : [];
  return { fetchedAt, state: parsePullListState(value.state), pulls };
}

export function parsePullDetailCache(
  raw: unknown,
  repoId?: string,
): { fetchedAt: string; pull: PullRequestDetail } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const fetchedAt =
    typeof value.fetchedAt === "string" && value.fetchedAt.trim()
      ? value.fetchedAt.trim()
      : undefined;
  const nested = value.pull && typeof value.pull === "object" ? value.pull : undefined;
  const pull = parsePullRequestDetail(nested ?? value, repoId);
  if (!fetchedAt || !pull) return undefined;
  return { fetchedAt, pull };
}

export function parsePullRequestRef(raw: unknown, repoId?: string): PullRequestRef | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const number = typeof value.number === "number" ? value.number : Number(value.number);
  if (!Number.isInteger(number) || number <= 0) return undefined;
  const title =
    typeof value.title === "string" && value.title.trim() ? value.title.trim() : `#${number}`;
  const url = typeof value.url === "string" && value.url.trim() ? value.url.trim() : "";
  const forge = isForgeKind(value.forge) ? value.forge : (parseRepoUrl(url)?.forge ?? "github");
  const state = isPullState(value.state) ? value.state : "open";
  const headRef = typeof value.headRef === "string" ? value.headRef : "";
  const baseRef = typeof value.baseRef === "string" ? value.baseRef : "";
  const headSha = typeof value.headSha === "string" ? value.headSha : "";
  const id = typeof value.repoId === "string" && value.repoId.trim() ? value.repoId.trim() : repoId;
  if (!id || !url) return undefined;
  return {
    repoId: id,
    forge,
    number,
    title,
    state,
    headRef,
    baseRef,
    headSha,
    url,
    author: typeof value.author === "string" ? value.author : undefined,
    authorAvatarUrl:
      typeof value.authorAvatarUrl === "string" && /^https?:\/\//i.test(value.authorAvatarUrl)
        ? value.authorAvatarUrl
        : undefined,
    draft: value.draft === true || state === "draft",
    createdAt: typeof value.createdAt === "string" && value.createdAt ? value.createdAt : undefined,
    updatedAt:
      typeof value.updatedAt === "string" && value.updatedAt
        ? value.updatedAt
        : new Date().toISOString(),
    commentCount: parseNonNegativeInt(value.commentCount),
    reviewCount: parseNonNegativeInt(value.reviewCount),
    reviewers: parseNameList(value.reviewers),
    checkState: parsePullCheckRollup(value.checkState),
    sessionIds: Array.isArray(value.sessionIds)
      ? value.sessionIds.filter(
          (item): item is string => typeof item === "string" && Boolean(item.trim()),
        )
      : undefined,
  };
}

function parseNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return undefined;
  return value;
}

function parseNameList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value.filter(
    (item): item is string => typeof item === "string" && Boolean(item.trim()),
  );
  return names.length ? names : undefined;
}

export function formatPrCard(input: {
  number: number;
  title: string;
  url: string;
  state?: string;
}): string {
  const state = input.state ? ` (${input.state})` : "";
  return `Opened #${input.number} ${input.title}${state}\n${input.url}`;
}

export const GIT_ISSUE_GET_INCLUDES = ["summary", "comments"] as const;
export type GitIssueGetInclude = (typeof GIT_ISSUE_GET_INCLUDES)[number];

export function isGitIssueGetInclude(value: string): value is GitIssueGetInclude {
  return (GIT_ISSUE_GET_INCLUDES as readonly string[]).includes(value);
}

export function parseGitIssueGetInclude(raw: unknown): GitIssueGetInclude[] | undefined {
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const includes = values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter(isGitIssueGetInclude);
  return includes.length ? [...new Set(includes)] : undefined;
}

const ISSUE_COMMENT_LIMIT = 24;

export function formatIssueComments(comments: IssueComment[], limit = ISSUE_COMMENT_LIMIT): string {
  if (!comments.length) return "(no comments)";
  const selected = comments.slice(0, limit);
  const extra =
    comments.length > selected.length ? `\n…${comments.length - selected.length} more` : "";
  const rows = selected.map((row) => {
    const who = row.author ?? "unknown";
    return `${who}: ${clipCommentBody(row.body)}`;
  });
  return wrapUntrusted({
    kind: "issue-text",
    source: "comments",
    text: `${rows.join("\n\n")}${extra}`,
  });
}

export function formatIssueCard(input: {
  number: number;
  title: string;
  url: string;
  state?: string;
}): string {
  const state = input.state ? ` (${input.state})` : "";
  return `Issue #${input.number} ${input.title}${state}\n${input.url}`;
}

export function parseIssueComment(
  raw: unknown,
  fallbackCreatedAt?: string,
): IssueComment | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : undefined;
  if (!id) return undefined;
  return {
    id,
    body: typeof item.body === "string" ? item.body : "",
    author: typeof item.author === "string" ? item.author : undefined,
    createdAt:
      typeof item.createdAt === "string" && item.createdAt
        ? item.createdAt
        : (fallbackCreatedAt ?? new Date().toISOString()),
    url: typeof item.url === "string" ? item.url : undefined,
  };
}

export function parseIssueRef(raw: unknown, repoId?: string): IssueRef | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const number = typeof value.number === "number" ? value.number : Number(value.number);
  if (!Number.isInteger(number) || number <= 0) return undefined;
  const title =
    typeof value.title === "string" && value.title.trim() ? value.title.trim() : `#${number}`;
  const url = typeof value.url === "string" && value.url.trim() ? value.url.trim() : "";
  const forge = isForgeKind(value.forge) ? value.forge : (parseRepoUrl(url)?.forge ?? "github");
  const id = typeof value.repoId === "string" && value.repoId.trim() ? value.repoId.trim() : repoId;
  if (!id || !url) return undefined;
  return {
    repoId: id,
    forge,
    number,
    title,
    state: isIssueState(value.state) ? value.state : parseIssueState(value.state),
    url,
    author: typeof value.author === "string" ? value.author : undefined,
    authorAvatarUrl:
      typeof value.authorAvatarUrl === "string" && /^https?:\/\//i.test(value.authorAvatarUrl)
        ? value.authorAvatarUrl
        : undefined,
    createdAt: typeof value.createdAt === "string" && value.createdAt ? value.createdAt : undefined,
    updatedAt:
      typeof value.updatedAt === "string" && value.updatedAt
        ? value.updatedAt
        : new Date().toISOString(),
    commentCount: parseNonNegativeInt(value.commentCount),
    labels: parseNameList(value.labels),
    assignees: parseNameList(value.assignees),
  };
}

export function parseIssueDetail(raw: unknown, repoId?: string): IssueDetail | undefined {
  const ref = parseIssueRef(raw, repoId);
  if (!ref) return undefined;
  const value = raw as Record<string, unknown>;
  return {
    ...ref,
    body: typeof value.body === "string" ? value.body : undefined,
    comments: Array.isArray(value.comments)
      ? value.comments.flatMap((row) => parseIssueComment(row, ref.updatedAt) ?? [])
      : [],
  };
}

export function parseIssueListCache(
  raw: unknown,
  repoId?: string,
): { fetchedAt: string; state: IssueListState; issues: IssueRef[] } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const fetchedAt =
    typeof value.fetchedAt === "string" && value.fetchedAt.trim()
      ? value.fetchedAt.trim()
      : undefined;
  if (!fetchedAt) return undefined;
  const issues = Array.isArray(value.issues)
    ? value.issues.flatMap((row) => parseIssueRef(row, repoId) ?? [])
    : [];
  return { fetchedAt, state: parseIssueListState(value.state), issues };
}

export function parseIssueDetailCache(
  raw: unknown,
  repoId?: string,
): { fetchedAt: string; issue: IssueDetail } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const fetchedAt =
    typeof value.fetchedAt === "string" && value.fetchedAt.trim()
      ? value.fetchedAt.trim()
      : undefined;
  const nested = value.issue && typeof value.issue === "object" ? value.issue : undefined;
  const issue = parseIssueDetail(nested ?? value, repoId);
  if (!fetchedAt || !issue) return undefined;
  return { fetchedAt, issue };
}

export function parsePrCard(
  output: string,
): { number?: number; title?: string; url?: string } | undefined {
  const url =
    output.match(/https?:\/\/[^\s"'<>]+\/(?:pull|pulls|merge_requests|pullrequests)\/\d+/i)?.[0] ??
    output.match(/https?:\/\/[^\s"'<>]+/i)?.[0];
  const heading = output.match(/Opened\s+#(\d+)\s+(.+)/i);
  const number = heading ? Number(heading[1]) : Number(output.match(/#(\d+)/)?.[1]);
  return {
    number: Number.isInteger(number) && number > 0 ? number : undefined,
    title: heading?.[2]?.split("\n")[0]?.trim(),
    url,
  };
}
