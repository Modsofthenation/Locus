import { formatPrCard, parseOwnerRepo, type GitForgeAccount } from "@locus/shared";
import type { CreatedPull, ForgeAdapter } from "./forgeAdapter.js";
import { createBitbucketForgeAdapter } from "./bitbucketForge.js";
import {
  assertPrComment,
  filterListedPulls,
  normalizeRef,
  type ForgeFetcher,
} from "./forgeHttp.js";
import { createGithubForgeAdapter } from "./githubForge.js";
import { createGitlabForgeAdapter } from "./gitlabForge.js";
import { createAzureDevOpsForgeAdapter } from "./azureDevopsForge.js";

export type { ForgeFetcher } from "./forgeHttp.js";
export type {
  ForgeAdapter,
  CreatePullInput,
  CreatedPull,
  PostCommentInput,
  PostIssueCommentInput,
  PostReviewInput,
  ReviewCommentInput,
} from "./forgeAdapter.js";

function selectForgeAdapter(kind: GitForgeAccount["kind"], fetchFn: ForgeFetcher): ForgeAdapter {
  if (kind === "gitlab") return createGitlabForgeAdapter(fetchFn);
  if (kind === "bitbucket") return createBitbucketForgeAdapter(fetchFn);
  if (kind === "azuredevops") return createAzureDevOpsForgeAdapter(fetchFn);
  return createGithubForgeAdapter(fetchFn);
}

export class ForgeClient {
  private readonly adapters = new Map<GitForgeAccount["kind"], ForgeAdapter>();

  constructor(private readonly fetchFn: ForgeFetcher = fetch) {}

  adapter(account: GitForgeAccount): ForgeAdapter {
    const cached = this.adapters.get(account.kind);
    if (cached) return cached;
    const selected = selectForgeAdapter(account.kind, this.fetchFn);
    this.adapters.set(account.kind, selected);
    return selected;
  }

  async listRepos(account: GitForgeAccount) {
    return this.adapter(account).listRepos(account);
  }

  async listPulls(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    state: Parameters<ForgeAdapter["listPulls"]>[3] = "open",
  ) {
    const rows = await this.adapter(account).listPulls(account, owner, repo, state);
    return filterListedPulls(rows, state);
  }

  async getPull(account: GitForgeAccount, owner: string, repo: string, number: number) {
    return this.adapter(account).getPull(account, owner, repo, number);
  }

  async createPull(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    input: Parameters<ForgeAdapter["createPull"]>[3],
  ) {
    return this.adapter(account).createPull(account, owner, repo, input);
  }

  async postComment(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    number: number,
    input: Parameters<ForgeAdapter["postComment"]>[4],
  ) {
    const body = assertPrComment(input.body);
    return this.adapter(account).postComment(account, owner, repo, number, { ...input, body });
  }

  async listIssues(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    state: Parameters<ForgeAdapter["listIssues"]>[3] = "open",
  ) {
    return this.adapter(account).listIssues(account, owner, repo, state);
  }

  async getIssue(account: GitForgeAccount, owner: string, repo: string, number: number) {
    return this.adapter(account).getIssue(account, owner, repo, number);
  }

  async postIssueComment(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    number: number,
    input: Parameters<ForgeAdapter["postIssueComment"]>[4],
  ) {
    const body = assertPrComment(input.body);
    return this.adapter(account).postIssueComment(account, owner, repo, number, { body });
  }

  async postReview(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    number: number,
    input: Parameters<ForgeAdapter["postReview"]>[4],
  ) {
    const body = assertPrComment(input.body);
    return this.adapter(account).postReview(account, owner, repo, number, { ...input, body });
  }

  async merge(account: GitForgeAccount, owner: string, repo: string, number: number) {
    return this.adapter(account).merge(account, owner, repo, number);
  }

  async setFileViewed(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    number: number,
    path: string,
    viewed: boolean,
  ) {
    const adapter = this.adapter(account);
    if (!adapter.setFileViewed) throw new Error("Viewed files are GitHub-only");
    return adapter.setFileViewed(account, owner, repo, number, path, viewed);
  }

  async lookupPullNumber(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    head?: string,
  ): Promise<number | undefined> {
    const rows = await this.listPulls(account, owner, repo, "open");
    const match = rows.find((row) => !head || row.headRef === head) ?? rows[0];
    return match?.number;
  }

  /** Latest commit SHA for poll adapters. HTTP/parse failure returns undefined. */
  async latestCommitSha(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    ref?: string,
  ): Promise<string | undefined> {
    const branch = normalizeRef(ref) || "HEAD";
    try {
      return await this.adapter(account).latestCommitSha(account, owner, repo, branch);
    } catch {
      return undefined;
    }
  }

  /** Latest open pull cursor (`pr:` / `mr:`) for poll adapters. HTTP/parse failure returns undefined. */
  async latestOpenPullCursor(
    account: GitForgeAccount,
    owner: string,
    repo: string,
  ): Promise<string | undefined> {
    try {
      return await this.adapter(account).latestOpenPullCursor(account, owner, repo);
    } catch {
      return undefined;
    }
  }

  async listBranches(account: GitForgeAccount, owner: string, repo: string) {
    return this.adapter(account).listBranches(account, owner, repo);
  }
}

export function createdPullOutput(created: CreatedPull): string {
  return formatPrCard({
    number: created.number,
    title: created.title,
    url: created.url,
    state: created.state,
  });
}

export function requireOwnerRepo(url: string): { owner: string; repo: string } {
  const parsed = parseOwnerRepo(url);
  if (!parsed) throw new Error(`Could not parse repo URL: ${url}`);
  return parsed;
}
