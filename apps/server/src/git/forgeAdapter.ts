import type {
  ForgeRepoHint,
  GitForgeAccount,
  IssueDetail,
  IssueListState,
  IssueRef,
  PullListState,
  PullRequestDetail,
  PullRequestRef,
  RepoBranchList,
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

export interface ForgeAdapter {
  listRepos(account: GitForgeAccount): Promise<ForgeRepoHint[]>;
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
}
