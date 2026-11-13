import {
  mergeRepoBranches,
  readmeExcerpt,
  type RepoAbout,
  parseIssueState,
  parsePullCheckRollup,
  type ForgeRepoHint,
  type GitForgeAccount,
  type IssueComment,
  type IssueDetail,
  type IssueListState,
  type IssueRef,
  type PullCheck,
  type PullComment,
  type PullCommit,
  type PullFile,
  type PullListState,
  type PullRequestDetail,
  type PullRequestRef,
  type RepoBranchList,
} from "@locus/shared";
import {
  fail,
  forgeJson,
  giteaAuthHeaders,
  githubAuthHeaders,
  hasForgeToken,
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

function githubCompatible(account: GitForgeAccount): boolean {
  return account.kind === "gitea" || account.kind === "forgejo";
}

function githubJson<T>(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  path: string,
  init?: RequestInit,
) {
  return forgeJson<T>(
    fetchFn,
    account,
    path,
    init,
    githubCompatible(account) ? giteaAuthHeaders : githubAuthHeaders,
  );
}

function mapForge(account: GitForgeAccount): GitForgeAccount["kind"] {
  return githubCompatible(account) ? account.kind : "github";
}

export async function listGithubRepos(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
): Promise<ForgeRepoHint[]> {
  const { ok, json, text } = await githubJson<
    Array<{
      name?: string;
      full_name?: string;
      clone_url?: string;
      html_url?: string;
      default_branch?: string;
      private?: boolean;
      owner?: { login?: string };
    }>
  >(
    fetchFn,
    account,
    githubCompatible(account)
      ? "/user/repos?limit=50&sort=updated"
      : "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
  );
  if (!ok || !Array.isArray(json)) throw fail({ status: 400 } as Response, text);
  return json.flatMap((row) => {
    const owner = row.owner?.login || row.full_name?.split("/")[0];
    const name = row.name;
    const origin =
      account.kind === "gitea" || account.kind === "forgejo"
        ? account.apiBaseUrl.replace(/\/api\/v1\/?$/i, "")
        : "https://github.com";
    const url = row.clone_url || (owner && name ? `${origin}/${owner}/${name}.git` : "");
    if (!owner || !name || !url) return [];
    return [
      {
        forge: mapForge(account),
        accountId: account.id,
        accountName: account.name,
        owner,
        name,
        url,
        defaultBranch: row.default_branch,
        private: row.private,
      },
    ];
  });
}

type GithubPullListRow = {
  number?: number;
  title?: string;
  html_url?: string;
  draft?: boolean;
  merged_at?: string | null;
  state?: string;
  user?: { login?: string; avatar_url?: string };
  created_at?: string;
  updated_at?: string;
  head?: { ref?: string; sha?: string };
  base?: { ref?: string };
  requested_reviewers?: Array<{ login?: string }>;
};

export async function listGithubPulls(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  state: PullListState,
): Promise<Omit<PullRequestRef, "repoId">[]> {
  // GraphQL always needs a token; tokenless reads of public repos use REST.
  if (!githubCompatible(account) && hasForgeToken(account)) {
    const fromGraphql = await listGithubPullsGraphql(fetchFn, account, owner, repo, state);
    if (fromGraphql) return fromGraphql;
  }
  return listGithubPullsRest(fetchFn, account, owner, repo, state);
}

async function listGithubPullsRest(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  state: PullListState,
): Promise<Omit<PullRequestRef, "repoId">[]> {
  const ghState = state === "all" ? "all" : "open";
  const { ok, json, text } = await githubJson<GithubPullListRow[]>(
    fetchFn,
    account,
    `/repos/${owner}/${repo}/pulls?state=${ghState}&per_page=30`,
  );
  if (!ok || !Array.isArray(json)) throw fail({ status: 400 } as Response, text);
  return json.flatMap((row) => mapGithubRestPull(row, mapForge(account)) ?? []);
}

function mapGithubRestPull(
  row: GithubPullListRow,
  forge: GitForgeAccount["kind"] = "github",
): Omit<PullRequestRef, "repoId"> | undefined {
  if (!row.number || !row.html_url) return undefined;
  const flags = pullFlags({
    state: row.state,
    merged: Boolean(row.merged_at),
    draft: row.draft,
  });
  const reviewers = (row.requested_reviewers ?? [])
    .map((item) => item.login?.trim())
    .filter((name): name is string => Boolean(name));
  return {
    forge,
    number: row.number,
    title: row.title || `#${row.number}`,
    state: flags.state,
    headRef: row.head?.ref ?? "",
    baseRef: row.base?.ref ?? "",
    headSha: row.head?.sha ?? "",
    url: row.html_url,
    author: row.user?.login,
    authorAvatarUrl: row.user?.avatar_url,
    draft: flags.draft,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? new Date().toISOString(),
    reviewers: reviewers.length ? reviewers : undefined,
  };
}

type GithubGraphqlActor = { login?: string; avatarUrl?: string; name?: string };

type GithubGraphqlPull = {
  number?: number;
  title?: string;
  url?: string;
  isDraft?: boolean;
  state?: string;
  createdAt?: string;
  updatedAt?: string;
  author?: GithubGraphqlActor | null;
  headRefName?: string;
  baseRefName?: string;
  headRefOid?: string;
  comments?: { totalCount?: number };
  reviews?: { totalCount?: number };
  reviewRequests?: {
    nodes?: Array<{ requestedReviewer?: GithubGraphqlActor | null } | null>;
  };
  commits?: {
    nodes?: Array<{ commit?: { statusCheckRollup?: { state?: string } | null } } | null>;
  };
};

async function listGithubPullsGraphql(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  state: PullListState,
): Promise<Omit<PullRequestRef, "repoId">[] | undefined> {
  const states = state === "all" ? ["OPEN", "CLOSED", "MERGED"] : ["OPEN"];
  const { ok, json } = await githubGraphql<{
    data?: { repository?: { pullRequests?: { nodes?: Array<GithubGraphqlPull | null> } } };
  }>(
    fetchFn,
    account,
    `query($owner: String!, $name: String!, $states: [PullRequestState!]) {
      repository(owner: $owner, name: $name) {
        pullRequests(first: 30, states: $states, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes {
            number
            title
            url
            isDraft
            state
            createdAt
            updatedAt
            author { login avatarUrl }
            headRefName
            baseRefName
            headRefOid
            comments { totalCount }
            reviews { totalCount }
            reviewRequests(first: 10) {
              nodes { requestedReviewer { ... on User { login } ... on Team { name } } }
            }
            commits(last: 1) {
              nodes { commit { statusCheckRollup { state } } }
            }
          }
        }
      }
    }`,
    { owner, name: repo, states },
  );
  const nodes = json.data?.repository?.pullRequests?.nodes;
  if (!ok || !nodes) return undefined;
  return nodes.flatMap((node) => mapGithubGraphqlPull(node) ?? []);
}

function mapGithubGraphqlPull(
  node: GithubGraphqlPull | null | undefined,
): Omit<PullRequestRef, "repoId"> | undefined {
  if (!node?.number || !node.url) return undefined;
  const flags = pullFlags({
    state: node.state,
    merged: (node.state ?? "").toUpperCase() === "MERGED",
    draft: node.isDraft,
  });
  const reviewers = (node.reviewRequests?.nodes ?? [])
    .map((item) => item?.requestedReviewer?.login?.trim() || item?.requestedReviewer?.name?.trim())
    .filter((name): name is string => Boolean(name));
  const commentCount = node.comments?.totalCount;
  const reviewCount = node.reviews?.totalCount;
  const checkState = parsePullCheckRollup(
    node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state,
  );
  return {
    forge: "github",
    number: node.number,
    title: node.title || `#${node.number}`,
    state: flags.state,
    headRef: node.headRefName ?? "",
    baseRef: node.baseRefName ?? "",
    headSha: node.headRefOid ?? "",
    url: node.url,
    author: node.author?.login,
    authorAvatarUrl: node.author?.avatarUrl,
    draft: flags.draft,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt ?? new Date().toISOString(),
    commentCount: typeof commentCount === "number" ? commentCount : undefined,
    reviewCount: typeof reviewCount === "number" ? reviewCount : undefined,
    reviewers: reviewers.length ? reviewers : undefined,
    checkState,
  };
}

export async function getGithubPull(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
): Promise<Omit<PullRequestDetail, "repoId">> {
  const listed = await listGithubPulls(fetchFn, account, owner, repo, "all");
  let summary = listed.find((row) => row.number === number);
  const pull = await githubJson<{
    number?: number;
    title?: string;
    body?: string;
    html_url?: string;
    draft?: boolean;
    merged?: boolean;
    state?: string;
    node_id?: string;
    user?: { login?: string; avatar_url?: string };
    created_at?: string;
    updated_at?: string;
    head?: { ref?: string; sha?: string };
    base?: { ref?: string };
    requested_reviewers?: Array<{ login?: string }>;
  }>(fetchFn, account, `/repos/${owner}/${repo}/pulls/${number}`);
  if (!pull.ok) throw fail({ status: pull.status } as Response, pull.text);
  const flags = pullFlags({
    state: pull.json.state,
    merged: pull.json.merged,
    draft: pull.json.draft,
  });
  const reviewers = (pull.json.requested_reviewers ?? [])
    .map((item) => item.login?.trim())
    .filter((name): name is string => Boolean(name));
  summary = {
    forge: mapForge(account),
    number: pull.json.number ?? number,
    title: pull.json.title || `#${number}`,
    state: flags.state,
    headRef: pull.json.head?.ref ?? summary?.headRef ?? "",
    baseRef: pull.json.base?.ref ?? summary?.baseRef ?? "",
    headSha: pull.json.head?.sha ?? summary?.headSha ?? "",
    url: pull.json.html_url ?? summary?.url ?? `https://github.com/${owner}/${repo}/pull/${number}`,
    author: pull.json.user?.login,
    authorAvatarUrl: pull.json.user?.avatar_url ?? summary?.authorAvatarUrl,
    draft: flags.draft,
    createdAt: pull.json.created_at ?? summary?.createdAt,
    updatedAt: pull.json.updated_at ?? new Date().toISOString(),
    commentCount: summary?.commentCount,
    reviewCount: summary?.reviewCount,
    reviewers: reviewers.length ? reviewers : summary?.reviewers,
    checkState: summary?.checkState,
  };
  const [files, reviewComments, issueComments, commits, checks, viewed] = await Promise.all([
    githubJson<
      Array<{ filename?: string; status?: string; patch?: string; previous_filename?: string }>
    >(fetchFn, account, `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`),
    githubJson<
      Array<{
        id?: number;
        body?: string;
        user?: { login?: string };
        path?: string;
        line?: number;
        original_line?: number;
        side?: string;
        created_at?: string;
        html_url?: string;
      }>
    >(fetchFn, account, `/repos/${owner}/${repo}/pulls/${number}/comments?per_page=100`),
    githubJson<
      Array<{
        id?: number;
        body?: string;
        user?: { login?: string };
        created_at?: string;
        html_url?: string;
      }>
    >(fetchFn, account, `/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`),
    githubJson<
      Array<{
        sha?: string;
        commit?: { message?: string; author?: { name?: string; date?: string } };
      }>
    >(fetchFn, account, `/repos/${owner}/${repo}/pulls/${number}/commits?per_page=50`),
    githubJson<{
      statuses?: Array<{ context?: string; state?: string; target_url?: string }>;
      state?: string;
    }>(fetchFn, account, `/repos/${owner}/${repo}/commits/${summary.headSha || "HEAD"}/status`),
    githubViewedPaths(fetchFn, account, owner, repo, number),
  ]);
  return {
    ...summary,
    body: pull.json.body ?? "",
    files: githubFiles(files.json, viewed),
    comments: [
      ...githubReviewComments(reviewComments.json),
      ...githubIssueComments(issueComments.json),
    ],
    commits: githubCommits(commits.json),
    checks: githubChecks(checks.json),
  };
}

export async function createGithubPull(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  input: CreatePullInput,
): Promise<CreatedPull> {
  const { ok, json, text } = await githubJson<{
    number?: number;
    title?: string;
    html_url?: string;
    draft?: boolean;
  }>(fetchFn, account, `/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      body: input.body ?? "",
      head: input.head,
      base: input.base,
      draft: input.draft === true,
    }),
  });
  if (!ok || !json.number || !json.html_url) throw fail({ status: 400 } as Response, text);
  return {
    number: json.number,
    title: json.title || input.title,
    url: json.html_url,
    state: json.draft ? "draft" : "open",
  };
}

export async function commentGithub(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
  input: PostCommentInput,
): Promise<{ ok: boolean; output: string }> {
  if (input.path && input.line) {
    const pull = await githubJson<{ head?: { sha?: string } }>(
      fetchFn,
      account,
      `/repos/${owner}/${repo}/pulls/${number}`,
    );
    const commitId = pull.json.head?.sha;
    const { ok, text } = await githubJson(
      fetchFn,
      account,
      `/repos/${owner}/${repo}/pulls/${number}/comments`,
      {
        method: "POST",
        body: JSON.stringify({
          body: input.body,
          path: input.path,
          line: input.line,
          side: input.side === "LEFT" ? "LEFT" : "RIGHT",
          commit_id: commitId,
        }),
      },
    );
    return { ok, output: text.slice(0, 4000) };
  }
  const { ok, text } = await githubJson(
    fetchFn,
    account,
    `/repos/${owner}/${repo}/issues/${number}/comments`,
    {
      method: "POST",
      body: JSON.stringify({ body: input.body }),
    },
  );
  return { ok, output: text.slice(0, 4000) };
}

export async function reviewGithub(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
  input: PostReviewInput,
): Promise<{ ok: boolean; output: string }> {
  const { ok, text } = await githubJson(
    fetchFn,
    account,
    `/repos/${owner}/${repo}/pulls/${number}/reviews`,
    {
      method: "POST",
      body: JSON.stringify({
        body: input.body,
        event: input.event,
        comments: (input.comments ?? []).map((row) => ({
          path: row.path,
          line: row.line,
          body: row.body,
          side: row.side === "LEFT" ? "LEFT" : "RIGHT",
        })),
      }),
    },
  );
  return { ok, output: text.slice(0, 4000) };
}

export async function mergeGithub(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
): Promise<{ ok: boolean; output: string }> {
  const { ok, text } = await githubJson(
    fetchFn,
    account,
    `/repos/${owner}/${repo}/pulls/${number}/merge`,
    {
      method: "PUT",
      body: JSON.stringify({ merge_method: "merge" }),
    },
  );
  return { ok, output: text.slice(0, 4000) };
}

function githubGraphqlUrl(account: GitForgeAccount): string {
  const root = account.apiBaseUrl.replace(/\/$/, "");
  if (root.endsWith("/api/v3")) return `${root.slice(0, -6)}graphql`;
  return `${root}/graphql`;
}

async function githubGraphql<T>(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ ok: boolean; json: T; text: string }> {
  const res = await fetchFn(githubGraphqlUrl(account), {
    method: "POST",
    headers: {
      ...githubAuthHeaders(account, { "content-type": "application/json" }),
      accept: "application/vnd.github+json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let json = {} as T;
  try {
    json = JSON.parse(text) as T;
  } catch {
    /* ignore */
  }
  return { ok: res.ok, json, text };
}

async function githubViewedPaths(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
): Promise<Set<string>> {
  const viewed = new Set<string>();
  if (githubCompatible(account) || !hasForgeToken(account)) return viewed;
  try {
    const { ok, json } = await githubGraphql<{
      data?: {
        repository?: {
          pullRequest?: {
            files?: { nodes?: Array<{ path?: string; viewerViewedState?: string }> };
          };
        };
      };
    }>(
      fetchFn,
      account,
      `query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            files(first: 100) { nodes { path viewerViewedState } }
          }
        }
      }`,
      { owner, name: repo, number },
    );
    if (!ok) return viewed;
    for (const row of json.data?.repository?.pullRequest?.files?.nodes ?? []) {
      if (row.path && row.viewerViewedState === "VIEWED") viewed.add(row.path);
    }
  } catch {
    /* GraphQL is optional; REST files still work */
  }
  return viewed;
}

async function githubPullNodeId(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
): Promise<string | undefined> {
  const pull = await githubJson<{ node_id?: string }>(
    fetchFn,
    account,
    `/repos/${owner}/${repo}/pulls/${number}`,
  );
  return pull.ok && typeof pull.json.node_id === "string" ? pull.json.node_id : undefined;
}

export async function setGithubFileViewed(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
  path: string,
  viewed: boolean,
): Promise<{ ok: boolean; output: string }> {
  const id = await githubPullNodeId(fetchFn, account, owner, repo, number);
  if (!id) return { ok: false, output: "Could not load pull id" };
  const mutation = viewed
    ? `mutation($id: ID!, $path: String!) { markFileAsViewed(input: { pullRequestId: $id, path: $path }) { clientMutationId } }`
    : `mutation($id: ID!, $path: String!) { unmarkFileAsViewed(input: { pullRequestId: $id, path: $path }) { clientMutationId } }`;
  const { ok, text } = await githubGraphql(fetchFn, account, mutation, { id, path });
  return { ok, output: text.slice(0, 4000) };
}

function githubFiles(
  rows:
    | Array<{ filename?: string; status?: string; patch?: string; previous_filename?: string }>
    | undefined,
  viewed: Set<string>,
): PullFile[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row.filename) return [];
    const status =
      row.status === "added" ||
      row.status === "removed" ||
      row.status === "renamed" ||
      row.status === "modified"
        ? row.status
        : "changed";
    return [
      {
        path: row.filename,
        status,
        patch: row.patch,
        previousPath: row.previous_filename,
        viewed: viewed.has(row.filename) ? true : undefined,
      },
    ];
  });
}

function githubReviewComments(
  rows:
    | Array<{
        id?: number;
        body?: string;
        user?: { login?: string };
        path?: string;
        line?: number;
        original_line?: number;
        side?: string;
        created_at?: string;
        html_url?: string;
      }>
    | undefined,
): PullComment[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row.id || !row.body) return [];
    return [
      {
        id: String(row.id),
        body: row.body,
        author: row.user?.login,
        path: row.path,
        line: row.line ?? row.original_line,
        side: row.side === "LEFT" ? "LEFT" : row.side === "RIGHT" ? "RIGHT" : undefined,
        createdAt: row.created_at ?? "",
        url: row.html_url,
      },
    ];
  });
}

function githubIssueComments(
  rows:
    | Array<{
        id?: number;
        body?: string;
        user?: { login?: string };
        created_at?: string;
        html_url?: string;
      }>
    | undefined,
): PullComment[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row.id || !row.body) return [];
    return [
      {
        id: `issue:${row.id}`,
        body: row.body,
        author: row.user?.login,
        createdAt: row.created_at ?? "",
        url: row.html_url,
      },
    ];
  });
}

function githubCommits(
  rows:
    | Array<{
        sha?: string;
        commit?: { message?: string; author?: { name?: string; date?: string } };
      }>
    | undefined,
): PullCommit[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row.sha) return [];
    return [
      {
        sha: row.sha,
        message: row.commit?.message ?? "",
        author: row.commit?.author?.name,
        createdAt: row.commit?.author?.date,
      },
    ];
  });
}

function githubChecks(
  body: { statuses?: Array<{ context?: string; state?: string; target_url?: string }> } | undefined,
): PullCheck[] {
  return (body?.statuses ?? []).map((row) => ({
    name: row.context || "status",
    status: githubStatus(row.state),
    url: row.target_url,
  }));
}

function githubStatus(state?: string): PullCheck["status"] {
  if (state === "success") return "success";
  if (state === "failure" || state === "error") return "failure";
  if (state === "pending") return "in_progress";
  return "neutral";
}

export async function listGithubBranches(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
): Promise<RepoBranchList> {
  const [meta, listed] = await Promise.all([
    githubJson<{ default_branch?: string }>(fetchFn, account, `/repos/${owner}/${repo}`),
    githubJson<Array<{ name?: string }>>(
      fetchFn,
      account,
      `/repos/${owner}/${repo}/branches?per_page=100`,
    ),
  ]);
  if (!listed.ok || !Array.isArray(listed.json))
    throw fail({ status: 400 } as Response, listed.text);
  const names = listed.json.flatMap((row) => (row.name?.trim() ? [row.name.trim()] : []));
  return mergeRepoBranches(names, meta.ok ? meta.json.default_branch : undefined);
}

export async function githubRepoAbout(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
): Promise<RepoAbout> {
  const base = `/repos/${owner}/${repo}`;
  const meta = await githubJson<{
    description?: string | null;
    homepage?: string | null;
    license?: { spdx_id?: string | null; name?: string | null } | null;
    language?: string | null;
    stargazers_count?: number;
    stars_count?: number;
    forks_count?: number;
    topics?: string[];
  }>(fetchFn, account, base);
  if (!meta.ok) throw fail({ status: meta.status } as Response, meta.text);
  const m = meta.json;
  const spdx = m.license?.spdx_id && m.license.spdx_id !== "NOASSERTION" ? m.license.spdx_id : "";
  const about: RepoAbout = {
    description: m.description?.trim() || undefined,
    homepage: m.homepage?.trim() || undefined,
    license: spdx || m.license?.name?.trim() || undefined,
    language: m.language?.trim() || undefined,
    stars: m.stargazers_count ?? m.stars_count,
    forks: m.forks_count,
    topics: m.topics?.length ? m.topics.slice(0, 8) : undefined,
  };
  if (githubCompatible(account)) return about;
  const [readme, firstIssues] = await Promise.all([
    githubJson<{ content?: string; encoding?: string }>(fetchFn, account, `${base}/readme`).catch(
      () => null,
    ),
    githubJson<unknown[]>(
      fetchFn,
      account,
      `${base}/issues?state=open&labels=${encodeURIComponent("good first issue")}&per_page=100`,
    ).catch(() => null),
  ]);
  if (readme?.ok && readme.json.encoding === "base64" && readme.json.content) {
    const text = Buffer.from(readme.json.content, "base64").toString("utf8");
    about.readme = readmeExcerpt(text) || undefined;
  }
  if (firstIssues?.ok && Array.isArray(firstIssues.json)) {
    about.goodFirstIssues = firstIssues.json.length;
  }
  return about;
}

export async function githubLatestCommitSha(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  branch: string,
): Promise<string | undefined> {
  const { ok, json } = await githubJson<{ sha?: string }>(
    fetchFn,
    account,
    `/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`,
  );
  if (!ok) return undefined;
  return typeof json.sha === "string" ? json.sha : undefined;
}

export async function githubLatestOpenPullCursor(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
): Promise<string | undefined> {
  const { ok, json } = await githubJson<Array<{ number?: number; updated_at?: string }>>(
    fetchFn,
    account,
    `/repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=1`,
  );
  if (!ok) return undefined;
  const row = json[0];
  return row?.number != null ? `pr:${row.number}:${row.updated_at ?? ""}` : undefined;
}

type GithubIssueRow = {
  number?: number;
  title?: string;
  html_url?: string;
  state?: string;
  body?: string;
  user?: { login?: string; avatar_url?: string };
  created_at?: string;
  updated_at?: string;
  comments?: number;
  labels?: Array<{ name?: string } | string>;
  assignees?: Array<{ login?: string }>;
  pull_request?: unknown;
};

function githubIssueLabels(row: GithubIssueRow): string[] | undefined {
  const names = (row.labels ?? [])
    .map((item) => (typeof item === "string" ? item : item.name)?.trim())
    .filter((name): name is string => Boolean(name));
  return names.length ? names : undefined;
}

function mapGithubIssue(
  row: GithubIssueRow,
  forge: GitForgeAccount["kind"] = "github",
): Omit<IssueRef, "repoId"> | undefined {
  if (!row.number || !row.html_url || row.pull_request) return undefined;
  const assignees = (row.assignees ?? [])
    .map((item) => item.login?.trim())
    .filter((name): name is string => Boolean(name));
  return {
    forge,
    number: row.number,
    title: row.title || `#${row.number}`,
    state: parseIssueState(row.state),
    url: row.html_url,
    author: row.user?.login,
    authorAvatarUrl: row.user?.avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? new Date().toISOString(),
    commentCount: typeof row.comments === "number" ? row.comments : undefined,
    labels: githubIssueLabels(row),
    assignees: assignees.length ? assignees : undefined,
  };
}

function githubStandaloneIssueComments(
  rows:
    | Array<{
        id?: number;
        body?: string;
        user?: { login?: string };
        created_at?: string;
        html_url?: string;
      }>
    | undefined,
): IssueComment[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row.id || !row.body) return [];
    return [
      {
        id: String(row.id),
        body: row.body,
        author: row.user?.login,
        createdAt: row.created_at ?? "",
        url: row.html_url,
      },
    ];
  });
}

export async function listGithubIssues(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  state: IssueListState,
): Promise<Omit<IssueRef, "repoId">[]> {
  const ghState = state === "all" ? "all" : state;
  const { ok, status, json, text } = await githubJson<GithubIssueRow[]>(
    fetchFn,
    account,
    `/repos/${owner}/${repo}/issues?state=${ghState}&per_page=30&sort=updated`,
  );
  if (status === 404 || status === 410) return [];
  if (!ok || !Array.isArray(json)) throw fail({ status: 400 } as Response, text);
  return json.flatMap((row) => mapGithubIssue(row, mapForge(account)) ?? []);
}

export async function getGithubIssue(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
): Promise<Omit<IssueDetail, "repoId">> {
  const issue = await githubJson<GithubIssueRow>(
    fetchFn,
    account,
    `/repos/${owner}/${repo}/issues/${number}`,
  );
  if (!issue.ok) throw fail({ status: issue.status } as Response, issue.text);
  if (issue.json.pull_request) {
    throw fail({ status: 400 } as Response, "That's a pull request — use git_pr_get");
  }
  const summary = mapGithubIssue(issue.json, mapForge(account));
  if (!summary) throw fail({ status: 400 } as Response, issue.text || "Issue not found");
  const comments = await githubJson<
    Array<{
      id?: number;
      body?: string;
      user?: { login?: string };
      created_at?: string;
      html_url?: string;
    }>
  >(fetchFn, account, `/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`);
  return {
    ...summary,
    body: issue.json.body ?? "",
    comments: githubStandaloneIssueComments(comments.json),
  };
}

export async function commentGithubIssue(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
  input: PostIssueCommentInput,
): Promise<{ ok: boolean; output: string }> {
  const existing = await githubJson<GithubIssueRow>(
    fetchFn,
    account,
    `/repos/${owner}/${repo}/issues/${number}`,
  );
  if (!existing.ok) throw fail({ status: existing.status } as Response, existing.text);
  if (existing.json.pull_request) {
    throw fail({ status: 400 } as Response, "That's a pull request — use git_pr_comment");
  }
  const { ok, text } = await githubJson(
    fetchFn,
    account,
    `/repos/${owner}/${repo}/issues/${number}/comments`,
    {
      method: "POST",
      body: JSON.stringify({ body: input.body }),
    },
  );
  return { ok, output: text.slice(0, 4000) };
}

export function createGithubForgeAdapter(fetchFn: ForgeFetcher): ForgeAdapter {
  return {
    listRepos: (account) => listGithubRepos(fetchFn, account),
    listPulls: (account, owner, repo, state) =>
      listGithubPulls(fetchFn, account, owner, repo, state),
    getPull: (account, owner, repo, number) => getGithubPull(fetchFn, account, owner, repo, number),
    createPull: (account, owner, repo, input) =>
      createGithubPull(fetchFn, account, owner, repo, input),
    postComment: (account, owner, repo, number, input) =>
      commentGithub(fetchFn, account, owner, repo, number, input),
    listIssues: (account, owner, repo, state) =>
      listGithubIssues(fetchFn, account, owner, repo, state),
    getIssue: (account, owner, repo, number) =>
      getGithubIssue(fetchFn, account, owner, repo, number),
    postIssueComment: (account, owner, repo, number, input) =>
      commentGithubIssue(fetchFn, account, owner, repo, number, input),
    postReview: (account, owner, repo, number, input) =>
      reviewGithub(fetchFn, account, owner, repo, number, input),
    merge: (account, owner, repo, number) => mergeGithub(fetchFn, account, owner, repo, number),
    setFileViewed: (account, owner, repo, number, path, viewed) =>
      setGithubFileViewed(fetchFn, account, owner, repo, number, path, viewed),
    latestCommitSha: (account, owner, repo, ref) =>
      githubLatestCommitSha(fetchFn, account, owner, repo, ref),
    latestOpenPullCursor: (account, owner, repo) =>
      githubLatestOpenPullCursor(fetchFn, account, owner, repo),
    listBranches: (account, owner, repo) => listGithubBranches(fetchFn, account, owner, repo),
    about: (account, owner, repo) => githubRepoAbout(fetchFn, account, owner, repo),
  };
}
