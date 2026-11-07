import {
  mergeRepoBranches,
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
  type PullListState,
  type PullRequestDetail,
  type PullRequestRef,
  type RepoBranchList,
} from "@locus/shared";
import {
  fail,
  forgeJson,
  gitlabAuthHeaders,
  gitlabProject,
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

function gitlabJson<T>(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  path: string,
  init?: RequestInit,
) {
  return forgeJson<T>(fetchFn, account, path, init, gitlabAuthHeaders);
}

export async function listGitlabRepos(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
): Promise<ForgeRepoHint[]> {
  const { ok, json, text } = await gitlabJson<
    Array<{
      name?: string;
      path?: string;
      path_with_namespace?: string;
      http_url_to_repo?: string;
      default_branch?: string;
      visibility?: string;
    }>
  >(
    fetchFn,
    account,
    "/projects?membership=true&simple=true&per_page=100&order_by=last_activity_at",
  );
  if (!ok || !Array.isArray(json)) throw fail({ status: 400 } as Response, text);
  return json.flatMap((row) => {
    const path = row.path_with_namespace || "";
    const [owner, ...rest] = path.split("/");
    const name = rest.join("/") || row.path || row.name;
    const url = row.http_url_to_repo || (path ? `https://gitlab.com/${path}.git` : "");
    if (!owner || !name || !url) return [];
    return [
      {
        forge: "gitlab" as const,
        accountId: account.id,
        accountName: account.name,
        owner,
        name,
        url,
        defaultBranch: row.default_branch,
        private: row.visibility === "private",
      },
    ];
  });
}

export async function listGitlabPulls(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  state: PullListState,
): Promise<Omit<PullRequestRef, "repoId">[]> {
  const glState = state === "all" ? "all" : "opened";
  const { ok, json, text } = await gitlabJson<
    Array<{
      iid?: number;
      title?: string;
      web_url?: string;
      draft?: boolean;
      work_in_progress?: boolean;
      state?: string;
      author?: { username?: string; avatar_url?: string };
      created_at?: string;
      updated_at?: string;
      source_branch?: string;
      target_branch?: string;
      sha?: string;
      user_notes_count?: number;
      reviewers?: Array<{ username?: string }>;
      head_pipeline?: { status?: string };
      pipeline?: { status?: string };
    }>
  >(
    fetchFn,
    account,
    `/projects/${gitlabProject(owner, repo)}/merge_requests?state=${glState}&per_page=30`,
  );
  if (!ok || !Array.isArray(json)) throw fail({ status: 400 } as Response, text);
  return json.flatMap((row) => {
    if (!row.iid || !row.web_url) return [];
    const flags = pullFlags({
      state: row.state,
      draft: row.draft,
      workInProgress: row.work_in_progress,
    });
    const reviewers = (row.reviewers ?? [])
      .map((item) => item.username?.trim())
      .filter((name): name is string => Boolean(name));
    return [
      {
        forge: "gitlab" as const,
        number: row.iid,
        title: row.title || `!${row.iid}`,
        state: flags.state,
        headRef: row.source_branch ?? "",
        baseRef: row.target_branch ?? "",
        headSha: row.sha ?? "",
        url: row.web_url,
        author: row.author?.username,
        authorAvatarUrl: row.author?.avatar_url,
        draft: flags.draft,
        createdAt: row.created_at,
        updatedAt: row.updated_at ?? new Date().toISOString(),
        commentCount: typeof row.user_notes_count === "number" ? row.user_notes_count : undefined,
        reviewers: reviewers.length ? reviewers : undefined,
        checkState: parsePullCheckRollup(row.head_pipeline?.status ?? row.pipeline?.status),
      },
    ];
  });
}

export async function getGitlabPull(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
): Promise<Omit<PullRequestDetail, "repoId">> {
  const id = gitlabProject(owner, repo);
  const mr = await gitlabJson<{
    iid?: number;
    title?: string;
    description?: string;
    web_url?: string;
    draft?: boolean;
    work_in_progress?: boolean;
    state?: string;
    author?: { username?: string; avatar_url?: string };
    created_at?: string;
    updated_at?: string;
    source_branch?: string;
    target_branch?: string;
    sha?: string;
    diff_refs?: { base_sha?: string; start_sha?: string; head_sha?: string };
  }>(fetchFn, account, `/projects/${id}/merge_requests/${number}`);
  if (!mr.ok) throw fail({ status: mr.status } as Response, mr.text);
  const [changes, notes, commits, pipelines] = await Promise.all([
    gitlabJson<{
      changes?: Array<{
        new_path?: string;
        old_path?: string;
        new_file?: boolean;
        deleted_file?: boolean;
        diff?: string;
      }>;
    }>(fetchFn, account, `/projects/${id}/merge_requests/${number}/changes`),
    gitlabJson<
      Array<{
        id?: number;
        body?: string;
        author?: { username?: string };
        created_at?: string;
        position?: { new_path?: string; new_line?: number };
      }>
    >(fetchFn, account, `/projects/${id}/merge_requests/${number}/notes?per_page=100&sort=asc`),
    gitlabJson<
      Array<{
        id?: string;
        title?: string;
        message?: string;
        author_name?: string;
        created_at?: string;
      }>
    >(fetchFn, account, `/projects/${id}/merge_requests/${number}/commits`),
    gitlabJson<Array<{ name?: string; status?: string; web_url?: string }>>(
      fetchFn,
      account,
      `/projects/${id}/merge_requests/${number}/pipelines`,
    ),
  ]);
  const flags = pullFlags({
    state: mr.json.state,
    draft: mr.json.draft,
    workInProgress: mr.json.work_in_progress,
  });
  const summary: Omit<PullRequestRef, "repoId"> = {
    forge: "gitlab",
    number: mr.json.iid ?? number,
    title: mr.json.title || `!${number}`,
    state: flags.state,
    headRef: mr.json.source_branch ?? "",
    baseRef: mr.json.target_branch ?? "",
    headSha: mr.json.diff_refs?.head_sha || mr.json.sha || "",
    url: mr.json.web_url ?? "",
    author: mr.json.author?.username,
    authorAvatarUrl: mr.json.author?.avatar_url,
    draft: flags.draft,
    createdAt: mr.json.created_at,
    updatedAt: mr.json.updated_at ?? new Date().toISOString(),
  };
  return {
    ...summary,
    body: mr.json.description ?? "",
    files: (changes.json.changes ?? []).map((row) => ({
      path: row.new_path || row.old_path || "",
      previousPath: row.old_path && row.old_path !== row.new_path ? row.old_path : undefined,
      status: row.new_file ? "added" : row.deleted_file ? "removed" : "modified",
      patch: row.diff,
    })),
    comments: (Array.isArray(notes.json) ? notes.json : []).flatMap((row) => {
      if (!row.id || !row.body) return [];
      return [
        {
          id: String(row.id),
          body: row.body,
          author: row.author?.username,
          path: row.position?.new_path,
          line: row.position?.new_line,
          createdAt: row.created_at ?? "",
        } satisfies PullComment,
      ];
    }),
    commits: (Array.isArray(commits.json) ? commits.json : []).flatMap((row) => {
      if (!row.id) return [];
      return [
        {
          sha: row.id,
          message: row.message || row.title || "",
          author: row.author_name,
          createdAt: row.created_at,
        },
      ];
    }),
    checks: (Array.isArray(pipelines.json) ? pipelines.json : []).map((row) => ({
      name: row.name || "pipeline",
      status: gitlabPipelineStatus(row.status),
      url: row.web_url,
    })),
  };
}

export async function createGitlabPull(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  input: CreatePullInput,
): Promise<CreatedPull> {
  const { ok, json, text } = await gitlabJson<{
    iid?: number;
    title?: string;
    web_url?: string;
    draft?: boolean;
  }>(fetchFn, account, `/projects/${gitlabProject(owner, repo)}/merge_requests`, {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      description: input.body ?? "",
      source_branch: input.head,
      target_branch: input.base,
      draft: input.draft === true,
    }),
  });
  if (!ok || !json.iid || !json.web_url) throw fail({ status: 400 } as Response, text);
  return {
    number: json.iid,
    title: json.title || input.title,
    url: json.web_url,
    state: json.draft ? "draft" : "open",
  };
}

export async function commentGitlab(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
  input: PostCommentInput,
): Promise<{ ok: boolean; output: string }> {
  const { ok, text } = await gitlabJson(
    fetchFn,
    account,
    `/projects/${gitlabProject(owner, repo)}/merge_requests/${number}/notes`,
    {
      method: "POST",
      body: JSON.stringify({
        body:
          input.path && input.line ? `${input.body}\n\n_${input.path}:${input.line}_` : input.body,
      }),
    },
  );
  return { ok, output: text.slice(0, 4000) };
}

export async function reviewGitlab(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
  input: PostReviewInput,
): Promise<{ ok: boolean; output: string }> {
  const note = await commentGitlab(fetchFn, account, owner, repo, number, { body: input.body });
  if (input.event === "APPROVE") {
    const { ok, text } = await gitlabJson(
      fetchFn,
      account,
      `/projects/${gitlabProject(owner, repo)}/merge_requests/${number}/approve`,
      { method: "POST", body: "{}" },
    );
    return { ok: ok && note.ok, output: `${note.output}\n${text}`.slice(0, 4000) };
  }
  if (input.event === "REQUEST_CHANGES") {
    const labeled = await commentGitlab(fetchFn, account, owner, repo, number, {
      body: `**Request changes**\n\n${input.body}`,
    });
    return labeled;
  }
  return note;
}

export async function mergeGitlab(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
): Promise<{ ok: boolean; output: string }> {
  const { ok, text } = await gitlabJson(
    fetchFn,
    account,
    `/projects/${gitlabProject(owner, repo)}/merge_requests/${number}/merge`,
    { method: "PUT", body: "{}" },
  );
  return { ok, output: text.slice(0, 4000) };
}

function gitlabPipelineStatus(status?: string): PullCheck["status"] {
  if (status === "success") return "success";
  if (status === "failed" || status === "canceled")
    return status === "canceled" ? "cancelled" : "failure";
  if (status === "running" || status === "pending") return "in_progress";
  return "neutral";
}

export async function listGitlabBranches(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
): Promise<RepoBranchList> {
  const { ok, json, text } = await gitlabJson<Array<{ name?: string; default?: boolean }>>(
    fetchFn,
    account,
    `/projects/${gitlabProject(owner, repo)}/repository/branches?per_page=100`,
  );
  if (!ok || !Array.isArray(json)) throw fail({ status: 400 } as Response, text);
  const names = json.flatMap((row) => (row.name?.trim() ? [row.name.trim()] : []));
  const defaultBranch = json.find((row) => row.default)?.name;
  return mergeRepoBranches(names, defaultBranch);
}

export async function gitlabLatestCommitSha(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  branch: string,
): Promise<string | undefined> {
  const { ok, json } = await gitlabJson<{ id?: string }>(
    fetchFn,
    account,
    `/projects/${gitlabProject(owner, repo)}/repository/commits/${encodeURIComponent(branch)}`,
  );
  if (!ok) return undefined;
  return typeof json.id === "string" ? json.id : undefined;
}

export async function gitlabLatestOpenPullCursor(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
): Promise<string | undefined> {
  const { ok, json } = await gitlabJson<Array<{ iid?: number; updated_at?: string }>>(
    fetchFn,
    account,
    `/projects/${gitlabProject(owner, repo)}/merge_requests?state=opened&order_by=updated_at&per_page=1`,
  );
  if (!ok) return undefined;
  const row = json[0];
  return row?.iid != null ? `mr:${row.iid}:${row.updated_at ?? ""}` : undefined;
}

type GitlabIssueRow = {
  iid?: number;
  title?: string;
  web_url?: string;
  state?: string;
  description?: string;
  author?: { username?: string; avatar_url?: string };
  created_at?: string;
  updated_at?: string;
  user_notes_count?: number;
  labels?: string[];
  assignees?: Array<{ username?: string }>;
};

function mapGitlabIssue(row: GitlabIssueRow): Omit<IssueRef, "repoId"> | undefined {
  if (!row.iid || !row.web_url) return undefined;
  const labels = (row.labels ?? []).map((name) => name.trim()).filter(Boolean);
  const assignees = (row.assignees ?? [])
    .map((item) => item.username?.trim())
    .filter((name): name is string => Boolean(name));
  return {
    forge: "gitlab",
    number: row.iid,
    title: row.title || `#${row.iid}`,
    state: parseIssueState(row.state === "opened" ? "open" : row.state),
    url: row.web_url,
    author: row.author?.username,
    authorAvatarUrl: row.author?.avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? new Date().toISOString(),
    commentCount: typeof row.user_notes_count === "number" ? row.user_notes_count : undefined,
    labels: labels.length ? labels : undefined,
    assignees: assignees.length ? assignees : undefined,
  };
}

function gitlabIssueNotes(
  rows:
    | Array<{
        id?: number;
        body?: string;
        system?: boolean;
        author?: { username?: string };
        created_at?: string;
      }>
    | undefined,
): IssueComment[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row.id || !row.body || row.system) return [];
    return [
      {
        id: String(row.id),
        body: row.body,
        author: row.author?.username,
        createdAt: row.created_at ?? "",
      },
    ];
  });
}

export async function listGitlabIssues(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  state: IssueListState,
): Promise<Omit<IssueRef, "repoId">[]> {
  const glState = state === "open" ? "opened" : state;
  const { ok, status, json, text } = await gitlabJson<GitlabIssueRow[]>(
    fetchFn,
    account,
    `/projects/${gitlabProject(owner, repo)}/issues?state=${glState}&per_page=30&order_by=updated_at`,
  );
  if (status === 404 || status === 410) return [];
  if (!ok || !Array.isArray(json)) throw fail({ status: 400 } as Response, text);
  return json.flatMap((row) => mapGitlabIssue(row) ?? []);
}

export async function getGitlabIssue(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
): Promise<Omit<IssueDetail, "repoId">> {
  const id = gitlabProject(owner, repo);
  const issue = await gitlabJson<GitlabIssueRow>(
    fetchFn,
    account,
    `/projects/${id}/issues/${number}`,
  );
  if (!issue.ok) throw fail({ status: issue.status } as Response, issue.text);
  const summary = mapGitlabIssue(issue.json);
  if (!summary) throw fail({ status: 400 } as Response, issue.text || "Issue not found");
  const notes = await gitlabJson<
    Array<{
      id?: number;
      body?: string;
      system?: boolean;
      author?: { username?: string };
      created_at?: string;
    }>
  >(fetchFn, account, `/projects/${id}/issues/${number}/notes?per_page=100&sort=asc`);
  return {
    ...summary,
    body: issue.json.description ?? "",
    comments: gitlabIssueNotes(notes.json),
  };
}

export async function commentGitlabIssue(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
  input: PostIssueCommentInput,
): Promise<{ ok: boolean; output: string }> {
  const { ok, text } = await gitlabJson(
    fetchFn,
    account,
    `/projects/${gitlabProject(owner, repo)}/issues/${number}/notes`,
    {
      method: "POST",
      body: JSON.stringify({ body: input.body }),
    },
  );
  return { ok, output: text.slice(0, 4000) };
}

export function createGitlabForgeAdapter(fetchFn: ForgeFetcher): ForgeAdapter {
  return {
    listRepos: (account) => listGitlabRepos(fetchFn, account),
    listPulls: (account, owner, repo, state) =>
      listGitlabPulls(fetchFn, account, owner, repo, state),
    getPull: (account, owner, repo, number) => getGitlabPull(fetchFn, account, owner, repo, number),
    createPull: (account, owner, repo, input) =>
      createGitlabPull(fetchFn, account, owner, repo, input),
    postComment: (account, owner, repo, number, input) =>
      commentGitlab(fetchFn, account, owner, repo, number, input),
    listIssues: (account, owner, repo, state) =>
      listGitlabIssues(fetchFn, account, owner, repo, state),
    getIssue: (account, owner, repo, number) =>
      getGitlabIssue(fetchFn, account, owner, repo, number),
    postIssueComment: (account, owner, repo, number, input) =>
      commentGitlabIssue(fetchFn, account, owner, repo, number, input),
    postReview: (account, owner, repo, number, input) =>
      reviewGitlab(fetchFn, account, owner, repo, number, input),
    merge: (account, owner, repo, number) => mergeGitlab(fetchFn, account, owner, repo, number),
    latestCommitSha: (account, owner, repo, ref) =>
      gitlabLatestCommitSha(fetchFn, account, owner, repo, ref),
    latestOpenPullCursor: (account, owner, repo) =>
      gitlabLatestOpenPullCursor(fetchFn, account, owner, repo),
    listBranches: (account, owner, repo) => listGitlabBranches(fetchFn, account, owner, repo),
  };
}
