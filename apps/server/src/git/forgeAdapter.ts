import type {
  CiCheckRun,
  ForgeRepoHint,
  GitForgeAccount,
  IssueDetail,
  IssueListState,
  IssueRef,
  PullFile,
  PullListState,
  PullRequestDetail,
  PullRequestRef,
  RepoBranchList,
  RepoAbout,
} from "@locus/shared";

export interface CreatePullInput {
  title: string;
  body?: string;
  head: string;
  base: string;
  draft?: boolean;
}

export interface PostCommentInput {
  body: string;
  path?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
}

export interface PostIssueCommentInput {
  body: string;
}

export interface ReviewCommentInput {
  path: string;
  line: number;
  body: string;
  side?: "LEFT" | "RIGHT";
}

export interface PostReviewInput {
  body: string;
  event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
  comments?: ReviewCommentInput[];
}

export interface CreatedPull {
  number: number;
  title: string;
  url: string;
  state?: string;
}

/** One file written on a new branch cut from `base` (`commitFileToNewBranch`). */
export interface CommitFileInput {
  branch: string;
  base: string;
  path: string;
  content: string;
  message: string;
  /** The caller found no such file on `base`: fail instead of overwriting one it couldn't read. */
  expectNew?: boolean;
}

/** Largest file `readFile` returns; bigger files read as undefined. */
export const READ_FILE_MAX_BYTES = 256 * 1024;

/** First comment of a review thread, as `resolveReviewThreads` shows it to `pick`. */
export interface ReviewThreadInfo {
  path?: string;
  line?: number;
  body: string;
  author?: string;
}

export interface ForgeAdapter {
  listRepos(account: GitForgeAccount): Promise<ForgeRepoHint[]>;
  /** Description, license, stars, README excerpt. Optional: only GitHub-compatible forges. */
  about?(account: GitForgeAccount, owner: string, repo: string): Promise<RepoAbout>;
  listPulls(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    state: PullListState,
  ): Promise<Omit<PullRequestRef, "repoId">[]>;
  getPull(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    number: number,
  ): Promise<Omit<PullRequestDetail, "repoId">>;
  createPull(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    input: CreatePullInput,
  ): Promise<CreatedPull>;
  postComment(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    number: number,
    input: PostCommentInput,
  ): Promise<{ ok: boolean; output: string }>;
  listIssues(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    state: IssueListState,
  ): Promise<Omit<IssueRef, "repoId">[]>;
  getIssue(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    number: number,
  ): Promise<Omit<IssueDetail, "repoId">>;
  postIssueComment(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    number: number,
    input: PostIssueCommentInput,
  ): Promise<{ ok: boolean; output: string }>;
  postReview(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    number: number,
    input: PostReviewInput,
  ): Promise<{ ok: boolean; output: string }>;
  merge(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    number: number,
  ): Promise<{ ok: boolean; output: string }>;
  setFileViewed?(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    number: number,
    path: string,
    viewed: boolean,
  ): Promise<{ ok: boolean; output: string }>;
  latestCommitSha(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    ref: string,
  ): Promise<string | undefined>;
  latestOpenPullCursor(
    account: GitForgeAccount,
    owner: string,
    repo: string,
  ): Promise<string | undefined>;
  listBranches(account: GitForgeAccount, owner: string, repo: string): Promise<RepoBranchList>;
  /**
   * Files changed from `base` to `head`, when `base` is an ancestor of `head`. Undefined when it
   * is not (force-push, rebase) or the forge can't tell. Optional: GitHub, GitLab, Bitbucket.
   */
  compareCommits?(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    base: string,
    head: string,
  ): Promise<PullFile[] | undefined>;
  /**
   * Text of one file at a ref, or undefined when it doesn't exist or exceeds
   * `READ_FILE_MAX_BYTES`. Optional: GitHub-compatible forges, GitLab, Bitbucket.
   */
  readFile?(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string | undefined>;
  /**
   * Resolve the open review threads on a pull whose first comment `pick` selects. Returns how many
   * were resolved. Optional: GitHub (GraphQL) and GitLab (discussions).
   */
  resolveReviewThreads?(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    number: number,
    pick: (thread: ReviewThreadInfo) => boolean,
  ): Promise<number>;
  /**
   * Create `branch` from `base` and commit one file (created or replaced) on it. Optional:
   * GitHub and GitLab. Throws on failure, including when the branch already exists.
   */
  commitFileToNewBranch?(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    input: CommitFileInput,
  ): Promise<void>;
  /** CI jobs / check runs for a pull head. Forges without it fall back to `getPull().checks`. */
  listCheckRuns?(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    input: { number: number; headSha: string },
  ): Promise<CiCheckRun[]>;
  /** Raw job log (or check output) for one run. Returns a note instead of throwing. */
  fetchCheckLog?(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    run: CiCheckRun,
  ): Promise<{ text?: string; note?: string }>;
}
