import {
  formatPrCard,
  parseOwnerRepo,
  type CiFailureReport,
  type GitForgeAccount,
  type PullCheck,
  type PullFile,
} from "@locus/shared";
import { buildCiReport } from "./forgeCi.js";
import type {
  CommitFileInput,
  CreatedPull,
  ForgeAdapter,
  ReviewThreadInfo,
} from "./forgeAdapter.js";
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
  CommitFileInput,
  CreatePullInput,
  CreatedPull,
  PostCommentInput,
  PostIssueCommentInput,
  PostReviewInput,
  ReviewCommentInput,
  ReviewThreadInfo,
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

  /** Overview facts; undefined when this forge's adapter has none. */
  async about(account: GitForgeAccount, owner: string, repo: string) {
    const adapter = this.adapter(account);
    return adapter.about ? adapter.about(account, owner, repo) : undefined;
  }

  /** Files changed from `base` to `head`; undefined after a force-push or on forges without it. */
  async compareCommits(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    base: string,
    head: string,
  ): Promise<PullFile[] | undefined> {
    const adapter = this.adapter(account);
    if (!adapter.compareCommits) return undefined;
    try {
      return await adapter.compareCommits(account, owner, repo, base, head);
    } catch {
      return undefined;
    }
  }

  /** A file's text at `ref`; undefined when missing, too large, or the forge can't read files. */
  async readFile(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string | undefined> {
    const adapter = this.adapter(account);
    if (!adapter.readFile) return undefined;
    try {
      return await adapter.readFile(account, owner, repo, path, ref);
    } catch {
      return undefined;
    }
  }

  /** Resolve open review threads `pick` selects; 0 on failure or forges without threads. */
  async resolveReviewThreads(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    number: number,
    pick: (thread: ReviewThreadInfo) => boolean,
  ): Promise<number> {
    const adapter = this.adapter(account);
    if (!adapter.resolveReviewThreads) return 0;
    try {
      return await adapter.resolveReviewThreads(account, owner, repo, number, pick);
    } catch {
      return 0;
    }
  }

  /** Create `branch` from `base` with one file written on it. Throws on forges without it. */
  async commitFileToNewBranch(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    input: CommitFileInput,
  ): Promise<void> {
    const adapter = this.adapter(account);
    if (!adapter.commitFileToNewBranch) {
      throw new Error(`Committing files is not supported on ${account.kind}`);
    }
    await adapter.commitFileToNewBranch(account, owner, repo, input);
  }

  async listBranches(account: GitForgeAccount, owner: string, repo: string) {
    return this.adapter(account).listBranches(account, owner, repo);
  }

  /**
   * Failing CI checks for a pull head with condensed job logs. Reads the pull when the head
   * SHA or checks are not passed. Forges without job logs list names and status only.
   */
  async ciReport(
    account: GitForgeAccount,
    owner: string,
    repo: string,
    input: {
      number: number;
      headSha?: string;
      checks?: PullCheck[];
      check?: string;
      maxChars?: number;
      maxLogs?: number;
    },
  ): Promise<CiFailureReport> {
    let headSha = input.headSha;
    let checks = input.checks;
    if (!headSha || !checks) {
      const pull = await this.getPull(account, owner, repo, input.number);
      headSha = headSha || pull.headSha;
      checks = checks ?? pull.checks;
    }
    const adapter = this.adapter(account);
    return buildCiReport(
      {
        kind: account.kind,
        listCheckRuns: adapter.listCheckRuns
          ? (sha) =>
              adapter.listCheckRuns!(account, owner, repo, { number: input.number, headSha: sha })
          : undefined,
        fetchCheckLog: adapter.fetchCheckLog
          ? (run) => adapter.fetchCheckLog!(account, owner, repo, run)
          : undefined,
      },
      {
        headSha: headSha ?? "",
        checks: checks ?? [],
        check: input.check,
        maxChars: input.maxChars,
        maxLogs: input.maxLogs,
      },
    );
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
