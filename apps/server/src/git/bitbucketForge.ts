import {
  mergeRepoBranches,
  parseIssueState,
  type ForgeRepoHint,
  type GitForgeAccount,
  type IssueComment,
  type IssueDetail,
  type IssueListState,
  type IssueRef,
  type PullCheck,
  type PullComment,
  type PullFile,
  type PullListState,
  type PullRequestDetail,
  type PullRequestRef,
  type RepoBranchList,
} from "@locus/shared";
import {
  bitbucketAuthHeaders,
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

function bitbucketJson<T>(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  path: string,
  init?: RequestInit,
) {
  return forgeJson<T>(fetchFn, account, path, init, bitbucketAuthHeaders);
}

const BITBUCKET_OPEN_DRAFTS_Q = encodeURIComponent('state="OPEN" AND draft=true');

type BitbucketPullRow = {
  id?: number;
  title?: string;
  state?: string;
  draft?: boolean;
  created_on?: string;
  updated_on?: string;
  comment_count?: number;
  author?: {
    display_name?: string;
    nickname?: string;
    links?: { avatar?: { href?: string } };
  };
  source?: { branch?: { name?: string }; commit?: { hash?: string } };
  destination?: { branch?: { name?: string } };
  links?: { html?: { href?: string } };
  participants?: Array<{
    role?: string;
    user?: { display_name?: string; nickname?: string };
  }>;
};

function mapBitbucketPullRow(row: BitbucketPullRow): Omit<PullRequestRef, "repoId"> | undefined {
  const url = row.links?.html?.href;
  if (!row.id || !url) return undefined;
  const flags = pullFlags({ state: row.state, draft: row.draft });
  const reviewers = (row.participants ?? [])
    .filter((item) => (item.role ?? "").toUpperCase() === "REVIEWER")
    .map((item) => item.user?.nickname || item.user?.display_name)
    .map((name) => name?.trim())
    .filter((name): name is string => Boolean(name));
  return {
    forge: "bitbucket",
    number: row.id,
    title: row.title || `#${row.id}`,
    state: flags.state,
    headRef: row.source?.branch?.name ?? "",
    baseRef: row.destination?.branch?.name ?? "",
    headSha: row.source?.commit?.hash ?? "",
    url,
    author: row.author?.nickname || row.author?.display_name,
    authorAvatarUrl: row.author?.links?.avatar?.href,
    draft: flags.draft,
    createdAt: row.created_on,
    updatedAt: row.updated_on ?? new Date().toISOString(),
    commentCount: typeof row.comment_count === "number" ? row.comment_count : undefined,
    reviewers: reviewers.length ? reviewers : undefined,
  };
}

export async function listBitbucketRepos(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
): Promise<ForgeRepoHint[]> {
  const { ok, json, text } = await bitbucketJson<{
    values?: Array<{
      name?: string;
      slug?: string;
      is_private?: boolean;
      mainbranch?: { name?: string };
      links?: { clone?: Array<{ href?: string; name?: string }>; html?: { href?: string } };
      workspace?: { slug?: string };
      full_name?: string;
    }>;
  }>(fetchFn, account, "/repositories?role=member&pagelen=50");
  if (!ok) throw fail({ status: 400 } as Response, text);
  return (json.values ?? []).flatMap((row) => {
    const full = row.full_name || "";
    const [owner, name] = full.split("/");
    const https = row.links?.clone?.find((item) => item.name === "https")?.href;
    const url = https || (owner && name ? `https://bitbucket.org/${owner}/${name}.git` : "");
    if (!owner || !name || !url) return [];
    return [
      {
        forge: "bitbucket" as const,
        accountId: account.id,
        accountName: account.name,
        owner,
        name,
        url,
        defaultBranch: row.mainbranch?.name,
        private: row.is_private,
      },
    ];
  });
}

export async function listBitbucketPulls(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  state: PullListState,
): Promise<Omit<PullRequestRef, "repoId">[]> {
  const byId = new Map<number, Omit<PullRequestRef, "repoId">>();
  const ingest = (values: BitbucketPullRow[] | undefined) => {
    for (const row of values ?? []) {
      const mapped = mapBitbucketPullRow(row);
      if (mapped) byId.set(mapped.number, mapped);
    }
  };

  if (state !== "draft") {
    const extra =
      state === "all" ? "&state=OPEN&state=MERGED&state=DECLINED&state=SUPERSEDED" : "&state=OPEN";
    const { ok, json, text } = await bitbucketJson<{ values?: BitbucketPullRow[] }>(
      fetchFn,
      account,
      `/repositories/${owner}/${repo}/pullrequests?pagelen=30${extra}`,
    );
    if (!ok) throw fail({ status: 400 } as Response, text);
    ingest(json.values);
  }

  // Bitbucket's state=OPEN list omits drafts (BCLOUD-23659). Query them separately and merge.
  const drafts = await bitbucketJson<{ values?: BitbucketPullRow[] }>(
    fetchFn,
    account,
    `/repositories/${owner}/${repo}/pullrequests?pagelen=30&q=${BITBUCKET_OPEN_DRAFTS_Q}`,
  );
  if (drafts.ok) ingest(drafts.json.values);
  else if (state === "draft") throw fail({ status: 400 } as Response, drafts.text);

  return [...byId.values()];
}

export async function getBitbucketPull(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
): Promise<Omit<PullRequestDetail, "repoId">> {
  const pr = await bitbucketJson<
    BitbucketPullRow & {
      description?: string;
      links?: { html?: { href?: string }; diff?: { href?: string } };
    }
  >(fetchFn, account, `/repositories/${owner}/${repo}/pullrequests/${number}`);
  if (!pr.ok) throw fail({ status: pr.status } as Response, pr.text);
  const [diffstat, diff, comments, commits, statuses] = await Promise.all([
    bitbucketJson<{
      values?: Array<{
        status?: string;
        old?: { path?: string } | null;
        new?: { path?: string } | null;
      }>;
    }>(
      fetchFn,
      account,
      `/repositories/${owner}/${repo}/pullrequests/${number}/diffstat?pagelen=100`,
    ),
    bitbucketJson<unknown>(
      fetchFn,
      account,
      `/repositories/${owner}/${repo}/pullrequests/${number}/diff`,
    ),
    bitbucketJson<{
      values?: Array<{
        id?: number;
        content?: { raw?: string };
        user?: { display_name?: string; nickname?: string };
        created_on?: string;
        inline?: { path?: string; to?: number | null };
        links?: { html?: { href?: string } };
      }>;
    }>(
      fetchFn,
      account,
      `/repositories/${owner}/${repo}/pullrequests/${number}/comments?pagelen=50`,
    ),
    bitbucketJson<{
      values?: Array<{
        hash?: string;
        message?: string;
        date?: string;
        author?: { raw?: string };
      }>;
    }>(
      fetchFn,
      account,
      `/repositories/${owner}/${repo}/pullrequests/${number}/commits?pagelen=50`,
    ),
    bitbucketJson<{ values?: Array<{ name?: string; state?: string; url?: string }> }>(
      fetchFn,
      account,
      `/repositories/${owner}/${repo}/commit/${pr.json.source?.commit?.hash ?? "HEAD"}/statuses`,
    ),
  ]);
  const mapped = mapBitbucketPullRow(pr.json);
  const flags = pullFlags({ state: pr.json.state, draft: pr.json.draft });
  const summary: Omit<PullRequestRef, "repoId"> = mapped ?? {
    forge: "bitbucket",
    number: pr.json.id ?? number,
    title: pr.json.title || `#${number}`,
    state: flags.state,
    headRef: pr.json.source?.branch?.name ?? "",
    baseRef: pr.json.destination?.branch?.name ?? "",
    headSha: pr.json.source?.commit?.hash ?? "",
    url: pr.json.links?.html?.href ?? "",
    author: pr.json.author?.nickname || pr.json.author?.display_name,
    draft: flags.draft,
    updatedAt: pr.json.updated_on ?? new Date().toISOString(),
  };
  return {
    ...summary,
    body: pr.json.description ?? "",
    files: bitbucketFiles(diffstat.json.values, diff.ok ? diff.text : ""),
    comments: (comments.json.values ?? []).flatMap((row) => {
      if (!row.id) return [];
      return [
        {
          id: String(row.id),
          body: row.content?.raw ?? "",
          author: row.user?.nickname || row.user?.display_name,
          path: row.inline?.path,
          line: row.inline?.to ?? undefined,
          createdAt: row.created_on ?? "",
          url: row.links?.html?.href,
        } satisfies PullComment,
      ];
    }),
    commits: (commits.json.values ?? []).flatMap((row) => {
      if (!row.hash) return [];
      return [
        {
          sha: row.hash,
          message: row.message ?? "",
          author: row.author?.raw,
          createdAt: row.date,
        },
      ];
    }),
    checks: (statuses.json.values ?? []).map((row) => ({
      name: row.name || "status",
      status: bitbucketStatus(row.state),
      url: row.url,
    })),
  };
}

export async function createBitbucketPull(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  input: CreatePullInput,
): Promise<CreatedPull> {
  const { ok, json, text } = await bitbucketJson<{
    id?: number;
    title?: string;
    draft?: boolean;
    state?: string;
    links?: { html?: { href?: string } };
  }>(fetchFn, account, `/repositories/${owner}/${repo}/pullrequests`, {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      description: input.body ?? "",
      source: { branch: { name: input.head } },
      destination: { branch: { name: input.base } },
      draft: input.draft === true,
    }),
  });
  const url = json.links?.html?.href;
  if (!ok || !json.id || !url) throw fail({ status: 400 } as Response, text);
  const flags = pullFlags({
    state: json.state,
    draft: json.draft === true || input.draft === true,
  });
  return { number: json.id, title: json.title || input.title, url, state: flags.state };
}

export async function commentBitbucket(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
  input: PostCommentInput,
): Promise<{ ok: boolean; output: string }> {
  const body: Record<string, unknown> = { content: { raw: input.body } };
  if (input.path && input.line) body.inline = { path: input.path, to: input.line };
  const { ok, text } = await bitbucketJson(
    fetchFn,
    account,
    `/repositories/${owner}/${repo}/pullrequests/${number}/comments`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return { ok, output: text.slice(0, 4000) };
}

export async function reviewBitbucket(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
  input: PostReviewInput,
): Promise<{ ok: boolean; output: string }> {
  const note = await commentBitbucket(fetchFn, account, owner, repo, number, { body: input.body });
  if (input.event === "APPROVE") {
    const { ok, text } = await bitbucketJson(
      fetchFn,
      account,
      `/repositories/${owner}/${repo}/pullrequests/${number}/approve`,
      { method: "POST", body: "{}" },
    );
    return { ok: ok && note.ok, output: `${note.output}\n${text}`.slice(0, 4000) };
  }
  if (input.event === "REQUEST_CHANGES") {
    const { ok, text } = await bitbucketJson(
      fetchFn,
      account,
      `/repositories/${owner}/${repo}/pullrequests/${number}/request-changes`,
      { method: "POST", body: "{}" },
    );
    if (ok) return { ok: note.ok, output: `${note.output}\n${text}`.slice(0, 4000) };
  }
  return note;
}

export async function mergeBitbucket(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
): Promise<{ ok: boolean; output: string }> {
  const { ok, text } = await bitbucketJson(
    fetchFn,
    account,
    `/repositories/${owner}/${repo}/pullrequests/${number}/merge`,
    {
      method: "POST",
      body: JSON.stringify({ message: "Merged from Locus", close_source_branch: false }),
    },
  );
  return { ok, output: text.slice(0, 4000) };
}

function bitbucketPath(value?: string | null): string | undefined {
  if (!value || value === "/dev/null") return undefined;
  let path = value.trim();
  if (path.startsWith('"') && path.endsWith('"') && path.length >= 2) {
    path = path.slice(1, -1).replace(/\\"/g, '"');
  }
  path = path.replace(/^[ab]\//, "");
  return path || undefined;
}

function gitDiffPaths(header: string): { oldPath?: string; newPath?: string } {
  const rest = header.replace(/^diff --git\s+/, "").trim();
  const tokens: string[] = [];
  for (let i = 0; i < rest.length;) {
    if (rest[i] === " ") {
      i += 1;
      continue;
    }
    if (rest[i] === '"') {
      const end = rest.indexOf('"', i + 1);
      if (end === -1) break;
      tokens.push(rest.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    const end = rest.indexOf(" ", i);
    tokens.push(end === -1 ? rest.slice(i) : rest.slice(i, end));
    i = end === -1 ? rest.length : end;
  }
  if (tokens.length < 2) return {};
  return { oldPath: bitbucketPath(tokens[0]), newPath: bitbucketPath(tokens[tokens.length - 1]) };
}

function plusMinusPath(patch: string, prefix: "+++" | "---"): string | undefined {
  const match = prefix === "+++" ? patch.match(/^\+\+\+\s+(.+)$/m) : patch.match(/^---\s+(.+)$/m);
  const raw = match?.[1]?.split("\t")[0]?.trim();
  return bitbucketPath(raw);
}

function bitbucketFilePatches(diff: string): Map<string, string> {
  const map = new Map<string, string>();
  const text = diff.replace(/\r\n/g, "\n");
  if (!text.trim()) return map;
  const parts = text.includes("diff --git ") ? text.split(/(?=^diff --git )/m) : [text];
  for (const part of parts) {
    const patch = part.trim();
    if (!patch) continue;
    const git = gitDiffPaths(patch.match(/^diff --git .+$/m)?.[0] ?? "");
    const plus = plusMinusPath(patch, "+++");
    const minus = plusMinusPath(patch, "---");
    const path = plus ?? git.newPath ?? minus ?? git.oldPath;
    if (!path) continue;
    map.set(path, patch);
    if (minus && minus !== path) map.set(minus, patch);
    if (git.oldPath && git.oldPath !== path) map.set(git.oldPath, patch);
    if (git.newPath && git.newPath !== path) map.set(git.newPath, patch);
  }
  return map;
}

function bitbucketFiles(
  rows:
    | Array<{ status?: string; old?: { path?: string } | null; new?: { path?: string } | null }>
    | undefined,
  diff: string,
): PullFile[] {
  const patches = bitbucketFilePatches(diff);
  return (rows ?? []).flatMap((row) => {
    const path = row.new?.path || row.old?.path || "";
    if (!path) return [];
    const previousPath = row.old?.path && row.old.path !== row.new?.path ? row.old.path : undefined;
    const status =
      row.status === "added" ||
      row.status === "removed" ||
      row.status === "renamed" ||
      row.status === "modified"
        ? row.status
        : "changed";
    return [
      {
        path,
        previousPath,
        status,
        patch: patches.get(path) ?? (previousPath ? patches.get(previousPath) : undefined),
      },
    ];
  });
}

function bitbucketStatus(state?: string): PullCheck["status"] {
  const value = (state ?? "").toUpperCase();
  if (value === "SUCCESSFUL") return "success";
  if (value === "FAILED") return "failure";
  if (value === "INPROGRESS") return "in_progress";
  if (value === "STOPPED") return "cancelled";
  return "neutral";
}

export async function listBitbucketBranches(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
): Promise<RepoBranchList> {
  const [meta, listed] = await Promise.all([
    bitbucketJson<{ mainbranch?: { name?: string } }>(
      fetchFn,
      account,
      `/repositories/${owner}/${repo}`,
    ),
    bitbucketJson<{ values?: Array<{ name?: string }> }>(
      fetchFn,
      account,
      `/repositories/${owner}/${repo}/refs/branches?pagelen=100`,
    ),
  ]);
  if (!listed.ok) throw fail({ status: 400 } as Response, listed.text);
  const names = (listed.json.values ?? []).flatMap((row) =>
    row.name?.trim() ? [row.name.trim()] : [],
  );
  return mergeRepoBranches(names, meta.ok ? meta.json.mainbranch?.name : undefined);
}

export async function bitbucketLatestCommitSha(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  branch: string,
): Promise<string | undefined> {
  const { ok, json } = await bitbucketJson<{
    values?: Array<{ hash?: string }>;
    hash?: string;
  }>(
    fetchFn,
    account,
    `/repositories/${owner}/${repo}/commits/${encodeURIComponent(branch)}?pagelen=1`,
  );
  if (!ok) return undefined;
  return json.values?.[0]?.hash ?? json.hash;
}

export async function bitbucketLatestOpenPullCursor(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
): Promise<string | undefined> {
  const { ok, json } = await bitbucketJson<{
    values?: Array<{ id?: number; updated_on?: string }>;
  }>(fetchFn, account, `/repositories/${owner}/${repo}/pullrequests?state=OPEN&pagelen=1`);
  if (!ok) return undefined;
  const row = json.values?.[0];
  return row?.id != null ? `pr:${row.id}:${row.updated_on ?? ""}` : undefined;
}

type BitbucketIssueRow = {
  id?: number;
  title?: string;
  state?: string;
  content?: { raw?: string };
  created_on?: string;
  updated_on?: string;
  comment_count?: number;
  kind?: string;
  priority?: string;
  reporter?: {
    display_name?: string;
    nickname?: string;
    links?: { avatar?: { href?: string } };
  };
  assignee?: { display_name?: string; nickname?: string };
  links?: { html?: { href?: string } };
};

function bitbucketIssueQuery(state: IssueListState): string {
  if (state === "open") {
    return encodeURIComponent('state="new" OR state="open" OR state="on hold"');
  }
  if (state === "closed") {
    return encodeURIComponent(
      'state="resolved" OR state="closed" OR state="invalid" OR state="duplicate" OR state="wontfix"',
    );
  }
  return "";
}

function mapBitbucketIssue(row: BitbucketIssueRow): Omit<IssueRef, "repoId"> | undefined {
  const url = row.links?.html?.href;
  if (!row.id || !url) return undefined;
  const labels = [row.kind, row.priority]
    .map((item) => item?.trim())
    .filter((name): name is string => Boolean(name));
  const assignee = row.assignee?.nickname || row.assignee?.display_name;
  return {
    forge: "bitbucket",
    number: row.id,
    title: row.title || `#${row.id}`,
    state: parseIssueState(row.state),
    url,
    author: row.reporter?.nickname || row.reporter?.display_name,
    authorAvatarUrl: row.reporter?.links?.avatar?.href,
    createdAt: row.created_on,
    updatedAt: row.updated_on ?? new Date().toISOString(),
    commentCount: typeof row.comment_count === "number" ? row.comment_count : undefined,
    labels: labels.length ? labels : undefined,
    assignees: assignee ? [assignee] : undefined,
  };
}

function bitbucketIssueComments(
  rows:
    | Array<{
        id?: number;
        content?: { raw?: string };
        user?: { display_name?: string; nickname?: string };
        created_on?: string;
        links?: { html?: { href?: string } };
      }>
    | undefined,
): IssueComment[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const body = row.content?.raw?.trim();
    if (!row.id || !body) return [];
    return [
      {
        id: String(row.id),
        body,
        author: row.user?.nickname || row.user?.display_name,
        createdAt: row.created_on ?? "",
        url: row.links?.html?.href,
      },
    ];
  });
}

export async function listBitbucketIssues(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  state: IssueListState,
): Promise<Omit<IssueRef, "repoId">[]> {
  const q = bitbucketIssueQuery(state);
  const suffix = q ? `&q=${q}` : "";
  const { ok, status, json, text } = await bitbucketJson<{ values?: BitbucketIssueRow[] }>(
    fetchFn,
    account,
    `/repositories/${owner}/${repo}/issues?pagelen=30&sort=-updated_on${suffix}`,
  );
  if (status === 404 || status === 410) return [];
  if (!ok) throw fail({ status: 400 } as Response, text);
  return (json.values ?? []).flatMap((row) => mapBitbucketIssue(row) ?? []);
}

export async function getBitbucketIssue(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
): Promise<Omit<IssueDetail, "repoId">> {
  const issue = await bitbucketJson<BitbucketIssueRow>(
    fetchFn,
    account,
    `/repositories/${owner}/${repo}/issues/${number}`,
  );
  if (!issue.ok) throw fail({ status: issue.status } as Response, issue.text);
  const summary = mapBitbucketIssue(issue.json);
  if (!summary) throw fail({ status: 400 } as Response, issue.text || "Issue not found");
  const comments = await bitbucketJson<{
    values?: Array<{
      id?: number;
      content?: { raw?: string };
      user?: { display_name?: string; nickname?: string };
      created_on?: string;
      links?: { html?: { href?: string } };
    }>;
  }>(fetchFn, account, `/repositories/${owner}/${repo}/issues/${number}/comments?pagelen=50`);
  return {
    ...summary,
    body: issue.json.content?.raw ?? "",
    comments: bitbucketIssueComments(comments.json.values),
  };
}

export async function commentBitbucketIssue(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  number: number,
  input: PostIssueCommentInput,
): Promise<{ ok: boolean; output: string }> {
  const { ok, text } = await bitbucketJson(
    fetchFn,
    account,
    `/repositories/${owner}/${repo}/issues/${number}/comments`,
    {
      method: "POST",
      body: JSON.stringify({ content: { raw: input.body } }),
    },
  );
  return { ok, output: text.slice(0, 4000) };
}

export function createBitbucketForgeAdapter(fetchFn: ForgeFetcher): ForgeAdapter {
  return {
    listRepos: (account) => listBitbucketRepos(fetchFn, account),
    listPulls: (account, owner, repo, state) =>
      listBitbucketPulls(fetchFn, account, owner, repo, state),
    getPull: (account, owner, repo, number) =>
      getBitbucketPull(fetchFn, account, owner, repo, number),
    createPull: (account, owner, repo, input) =>
      createBitbucketPull(fetchFn, account, owner, repo, input),
    postComment: (account, owner, repo, number, input) =>
      commentBitbucket(fetchFn, account, owner, repo, number, input),
    listIssues: (account, owner, repo, state) =>
      listBitbucketIssues(fetchFn, account, owner, repo, state),
    getIssue: (account, owner, repo, number) =>
      getBitbucketIssue(fetchFn, account, owner, repo, number),
    postIssueComment: (account, owner, repo, number, input) =>
      commentBitbucketIssue(fetchFn, account, owner, repo, number, input),
    postReview: (account, owner, repo, number, input) =>
      reviewBitbucket(fetchFn, account, owner, repo, number, input),
    merge: (account, owner, repo, number) => mergeBitbucket(fetchFn, account, owner, repo, number),
    latestCommitSha: (account, owner, repo, ref) =>
      bitbucketLatestCommitSha(fetchFn, account, owner, repo, ref),
    latestOpenPullCursor: (account, owner, repo) =>
      bitbucketLatestOpenPullCursor(fetchFn, account, owner, repo),
    listBranches: (account, owner, repo) => listBitbucketBranches(fetchFn, account, owner, repo),
  };
}
