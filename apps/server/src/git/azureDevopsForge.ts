import {
  mergeRepoBranches,
  type ForgeRepoHint,
  type GitForgeAccount,
  type IssueDetail,
  type IssueListState,
  type IssueRef,
  type PullListState,
  type PullRequestRef,
  type RepoBranchList,
} from "@locus/shared";
import {
  azureDevOpsAuthHeaders,
  fail,
  forgeJson,
  pullFlags,
  type ForgeFetcher,
} from "./forgeHttp.js";
import type {
  CreatePullInput,
  CreatedPull,
  ForgeAdapter,
  PostCommentInput,
  PostIssueCommentInput,
  PostReviewInput,
} from "./forgeAdapter.js";

const API = "api-version=7.1";

function azHostAccount(account: GitForgeAccount): GitForgeAccount {
  try {
    const url = new URL(account.apiBaseUrl);
    return { ...account, apiBaseUrl: `${url.protocol}//${url.host}` };
  } catch {
    return { ...account, apiBaseUrl: "https://dev.azure.com" };
  }
}

function azJson<T>(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  path: string,
  init?: RequestInit,
) {
  const suffix = path.includes("?") ? `&${API}` : `?${API}`;
  return forgeJson<T>(
    fetchFn,
    azHostAccount(account),
    `${path}${suffix}`,
    init,
    azureDevOpsAuthHeaders,
  );
}

function orgOf(account: GitForgeAccount, owner: string): { org: string; project: string } {
  const bits = owner.split("/").filter(Boolean);
  if (bits.length >= 2) return { org: bits[0]!, project: bits[1]! };
  try {
    const url = new URL(account.apiBaseUrl);
    const seg = url.pathname
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .find((part) => part && part !== "_apis");
    if (seg) return { org: seg, project: bits[0] || seg };
  } catch {
    /* fall through */
  }
  if (account.username?.trim()) {
    return { org: account.username.trim(), project: bits[0] || account.username.trim() };
  }
  return { org: bits[0] || "", project: bits[0] || "" };
}

function repoPath(account: GitForgeAccount, owner: string, repo: string): string {
  const { org, project } = orgOf(account, owner);
  return `/${org}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}`;
}

type AzRepo = {
  id?: string;
  name?: string;
  remoteUrl?: string;
  webUrl?: string;
  defaultBranch?: string;
  project?: { name?: string; id?: string };
  isDisabled?: boolean;
};

type AzPull = {
  pullRequestId?: number;
  title?: string;
  description?: string;
  status?: string;
  isDraft?: boolean;
  url?: string;
  creationDate?: string;
  closedDate?: string;
  createdBy?: { displayName?: string; uniqueName?: string };
  sourceRefName?: string;
  targetRefName?: string;
  lastMergeSourceCommit?: { commitId?: string };
  repository?: { name?: string; webUrl?: string; project?: { name?: string } };
};

function refName(raw?: string): string {
  return (raw ?? "").replace(/^refs\/heads\//, "");
}

function pullUrl(account: GitForgeAccount, owner: string, repo: string, id: number): string {
  const { org, project } = orgOf(account, owner);
  return `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${id}`;
}

function mapPull(
  account: GitForgeAccount,
  owner: string,
  repo: string,
  row: AzPull,
): Omit<PullRequestRef, "repoId"> | undefined {
  const number = row.pullRequestId;
  if (!number) return undefined;
  const flags = pullFlags({
    state: row.status,
    merged: (row.status ?? "").toLowerCase() === "completed",
    draft: row.isDraft,
  });
  return {
    forge: "azuredevops",
    number,
    title: row.title || `#${number}`,
    state: flags.state,
    headRef: refName(row.sourceRefName),
    baseRef: refName(row.targetRefName),
    headSha: row.lastMergeSourceCommit?.commitId ?? "",
    url: row.url || pullUrl(account, owner, repo, number),
    author: row.createdBy?.displayName,
    draft: flags.draft,
    createdAt: row.creationDate,
    updatedAt: row.closedDate ?? row.creationDate ?? new Date().toISOString(),
  };
}

export function createAzureDevOpsForgeAdapter(fetchFn: ForgeFetcher): ForgeAdapter {
  return {
    async listRepos(account: GitForgeAccount): Promise<ForgeRepoHint[]> {
      const { org } = orgOf(account, "");
      const path = org ? `/${org}/_apis/git/repositories` : "/_apis/git/repositories";
      const { ok, json, text } = await azJson<{ value?: AzRepo[] }>(fetchFn, account, path);
      if (!ok || !Array.isArray(json.value)) throw fail({ status: 400 } as Response, text);
      return json.value.flatMap((row) => {
        const project = row.project?.name;
        const name = row.name;
        const url = row.remoteUrl || row.webUrl;
        if (!project || !name || !url || row.isDisabled) return [];
        return [
          {
            forge: "azuredevops" as const,
            accountId: account.id,
            accountName: account.name,
            owner: org ? `${org}/${project}` : project,
            name,
            url,
            defaultBranch: refName(row.defaultBranch) || undefined,
          },
        ];
      });
    },

    async listPulls(account, owner, repo, state: PullListState) {
      const status = state === "all" ? undefined : state === "draft" ? "active" : "active";
      const qs = status ? `?searchCriteria.status=${status}` : "";
      const { ok, json, text } = await azJson<{ value?: AzPull[] }>(
        fetchFn,
        account,
        `${repoPath(account, owner, repo)}/pullrequests${qs}`,
      );
      if (!ok || !Array.isArray(json.value)) throw fail({ status: 400 } as Response, text);
      return json.value.flatMap((row) => mapPull(account, owner, repo, row) ?? []);
    },

    async getPull(account, owner, repo, number) {
      const { ok, json, text } = await azJson<AzPull>(
        fetchFn,
        account,
        `${repoPath(account, owner, repo)}/pullrequests/${number}`,
      );
      if (!ok) throw fail({ status: 400 } as Response, text);
      const summary = mapPull(account, owner, repo, json);
      if (!summary) throw fail({ status: 400 } as Response, text || "Pull request not found");
      const threads = await azJson<{
        value?: Array<{
          id?: number;
          comments?: Array<{
            id?: number;
            content?: string;
            author?: { displayName?: string };
            publishedDate?: string;
          }>;
        }>;
      }>(fetchFn, account, `${repoPath(account, owner, repo)}/pullrequests/${number}/threads`);
      const comments = (threads.json.value ?? []).flatMap((thread) =>
        (thread.comments ?? []).flatMap((row) => {
          if (!row.content) return [];
          return [
            {
              id: String(row.id ?? thread.id ?? ""),
              body: row.content,
              author: row.author?.displayName,
              createdAt: row.publishedDate ?? "",
            },
          ];
        }),
      );
      return {
        ...summary,
        body: json.description ?? "",
        files: [],
        comments,
        commits: [],
        checks: [],
      };
    },

    async createPull(account, owner, repo, input: CreatePullInput): Promise<CreatedPull> {
      const { ok, json, text } = await azJson<AzPull>(
        fetchFn,
        account,
        `${repoPath(account, owner, repo)}/pullrequests`,
        {
          method: "POST",
          body: JSON.stringify({
            sourceRefName: input.head.startsWith("refs/") ? input.head : `refs/heads/${input.head}`,
            targetRefName: input.base.startsWith("refs/") ? input.base : `refs/heads/${input.base}`,
            title: input.title,
            description: input.body ?? "",
            isDraft: Boolean(input.draft),
          }),
        },
      );
      if (!ok || !json.pullRequestId) throw fail({ status: 400 } as Response, text);
      return {
        number: json.pullRequestId,
        title: json.title || input.title,
        url: json.url || pullUrl(account, owner, repo, json.pullRequestId),
        state: json.status,
      };
    },

    async postComment(account, owner, repo, number, input: PostCommentInput) {
      const { ok, text } = await azJson(
        fetchFn,
        account,
        `${repoPath(account, owner, repo)}/pullrequests/${number}/threads`,
        {
          method: "POST",
          body: JSON.stringify({
            comments: [{ parentCommentId: 0, content: input.body, commentType: 1 }],
            status: 1,
          }),
        },
      );
      return { ok, output: ok ? "Posted comment" : text.slice(0, 4000) };
    },

    async listIssues(_account, _owner, _repo, _state: IssueListState) {
      return [] as Omit<IssueRef, "repoId">[];
    },

    async getIssue(_account, _owner, _repo, number): Promise<Omit<IssueDetail, "repoId">> {
      throw new Error(`Azure DevOps work items are not mapped as git issues (${number})`);
    },

    async postIssueComment(_account, _owner, _repo, _number, _input: PostIssueCommentInput) {
      return { ok: false, output: "Azure DevOps work-item comments are not supported" };
    },

    async postReview(account, owner, repo, number, input: PostReviewInput) {
      return this.postComment(account, owner, repo, number, { body: input.body });
    },

    async merge(account, owner, repo, number) {
      const current = await azJson<AzPull>(
        fetchFn,
        account,
        `${repoPath(account, owner, repo)}/pullrequests/${number}`,
      );
      if (!current.ok) throw fail({ status: 400 } as Response, current.text);
      const { ok, text } = await azJson(
        fetchFn,
        account,
        `${repoPath(account, owner, repo)}/pullrequests/${number}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: "completed",
            lastMergeSourceCommit: current.json.lastMergeSourceCommit,
          }),
        },
      );
      return { ok, output: ok ? `Merged #${number}` : text.slice(0, 4000) };
    },

    async latestCommitSha(account, owner, repo, ref) {
      const { ok, json } = await azJson<{ commitId?: string }>(
        fetchFn,
        account,
        `${repoPath(account, owner, repo)}/commits/${encodeURIComponent(refName(ref) || ref)}`,
      );
      return ok ? json.commitId : undefined;
    },

    async latestOpenPullCursor(account, owner, repo) {
      const rows = await this.listPulls(account, owner, repo, "open");
      const first = rows[0];
      return first ? `${first.number}:${first.updatedAt}` : undefined;
    },

    async listBranches(account, owner, repo): Promise<RepoBranchList> {
      const { ok, json } = await azJson<{
        value?: Array<{ name?: string; isBaseVersion?: boolean }>;
      }>(fetchFn, account, `${repoPath(account, owner, repo)}/refs?filter=heads/`);
      const names = (json.value ?? []).flatMap((row) => {
        const name = refName(row.name);
        return name ? [name] : [];
      });
      const def = names[0];
      return mergeRepoBranches(ok ? names : [], def);
    },
  };
}
