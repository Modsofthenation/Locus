import { encodeIntegrationJson, type IntegrationAccount } from "@locus/shared";

export type IntegrationFetcher = typeof fetch;

const IDENTIFIER = /^[A-Z][A-Z0-9]+-\d+$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  url
  priority
  updatedAt
  state { id name type }
  assignee { id name email }
  team { id key name }
  labels { nodes { id name } }
  parent { id identifier title }
`;

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function graphqlUrl(account: IntegrationAccount): string {
  return `${account.baseUrl.replace(/\/+$/, "").replace(/\/graphql$/i, "")}/graphql`;
}

function authHeaders(account: IntegrationAccount): Record<string, string> {
  const token = account.token?.trim() ?? "";
  const value = /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
  return {
    Authorization: value,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function gql(
  account: IntegrationAccount,
  fetchFn: IntegrationFetcher,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetchFn(graphqlUrl(account), {
    method: "POST",
    headers: authHeaders(account),
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  const text = await res.text();
  let json: { data?: Record<string, unknown>; errors?: Array<{ message?: string }> };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error(text.slice(0, 400) || `HTTP ${res.status}`);
  }
  const err = (json.errors ?? [])
    .map((row) => row.message?.trim())
    .filter((row): row is string => Boolean(row))
    .join("; ");
  if (!res.ok) throw new Error(err || text.slice(0, 400) || `HTTP ${res.status}`);
  if (err) throw new Error(err);
  return json.data ?? {};
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nodes(value: unknown): unknown[] {
  const list = rec(value).nodes;
  return Array.isArray(list) ? list : [];
}

function issueId(args: Record<string, unknown>): string {
  return str(args, "issue") || str(args, "key") || str(args, "id") || str(args, "identifier");
}

function slim(row: unknown): Record<string, unknown> {
  const issue = rec(row);
  const state = rec(issue.state);
  const assignee = rec(issue.assignee);
  const team = rec(issue.team);
  const parent = rec(issue.parent);
  const labels = nodes(issue.labels)
    .map((item) => String(rec(item).name ?? "").trim())
    .filter(Boolean);
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    priority: issue.priority,
    updatedAt: issue.updatedAt,
    state: state.name ?? undefined,
    assignee: assignee.name || assignee.email || undefined,
    team: team.key || team.name || undefined,
    parent: parent.identifier ?? undefined,
    labels: labels.length ? labels : undefined,
  };
}

export async function callLinear(
  name: string,
  args: Record<string, unknown>,
  account: IntegrationAccount,
  fetchFn: IntegrationFetcher,
): Promise<{ ok: boolean; output: string }> {
  if (name === "linear_search") return linearSearch(args, account, fetchFn);
  if (name === "linear_create") return linearCreate(args, account, fetchFn);
  const id = issueId(args);
  if (!id) return { ok: false, output: "issue identifier is required" };
  if (name === "linear_get") return linearGet(id, account, fetchFn);
  if (name === "linear_update") return linearUpdate(id, args, account, fetchFn);
  if (name === "linear_comment") return linearComment(id, args, account, fetchFn);
  return { ok: false, output: `Unknown Linear tool ${name}` };
}

async function linearSearch(
  args: Record<string, unknown>,
  account: IntegrationAccount,
  fetchFn: IntegrationFetcher,
): Promise<{ ok: boolean; output: string }> {
  const query = str(args, "query") || str(args, "q") || str(args, "term");
  const team = str(args, "team");
  const state = str(args, "state") || str(args, "status");
  const assignee = str(args, "assignee");
  if (query && IDENTIFIER.test(query) && !team && !state && !assignee) {
    const issue = await fetchIssue(account, fetchFn, query);
    return {
      ok: true,
      output: encodeIntegrationJson({ issues: issue ? [slim(issue)] : [] }),
    };
  }
  const teamId = team ? await resolveTeamId(account, fetchFn, team) : undefined;
  if (query) {
    const data = await gql(
      account,
      fetchFn,
      `query Search($term: String!, $first: Int, $teamId: String) {
        searchIssues(term: $term, first: $first, teamId: $teamId) { nodes { ${ISSUE_FIELDS} } }
      }`,
      { term: query, first: 20, teamId },
    );
    let issues = nodes(data.searchIssues).map(slim);
    if (state) {
      const wanted = state.toLowerCase();
      issues = issues.filter((row) => String(row.state ?? "").toLowerCase() === wanted);
    }
    if (assignee) {
      const wanted = assignee.toLowerCase();
      issues = issues.filter((row) =>
        String(row.assignee ?? "")
          .toLowerCase()
          .includes(wanted),
      );
    }
    return { ok: true, output: encodeIntegrationJson({ issues }) };
  }
  const filter: Record<string, unknown> = {};
  if (teamId) filter.team = { id: { eq: teamId } };
  if (state) filter.state = { name: { eqIgnoreCase: state } };
  if (assignee === "me" || assignee === "self") {
    filter.assignee = { isMe: { eq: true } };
  } else if (assignee) {
    filter.assignee = assignee.includes("@")
      ? { email: { eqIgnoreCase: assignee } }
      : { displayName: { eqIgnoreCase: assignee } };
  }
  const data = await gql(
    account,
    fetchFn,
    `query List($first: Int, $filter: IssueFilter) {
      issues(first: $first, filter: $filter, orderBy: updatedAt) { nodes { ${ISSUE_FIELDS} } }
    }`,
    { first: 20, filter: Object.keys(filter).length ? filter : undefined },
  );
  return { ok: true, output: encodeIntegrationJson({ issues: nodes(data.issues).map(slim) }) };
}

async function linearGet(
  id: string,
  account: IntegrationAccount,
  fetchFn: IntegrationFetcher,
): Promise<{ ok: boolean; output: string }> {
  const issue = await fetchIssue(account, fetchFn, id, true);
  if (!issue) return { ok: false, output: `Unknown Linear issue ${id}` };
  const comments = nodes(rec(issue).comments).map((row) => {
    const comment = rec(row);
    const user = rec(comment.user);
    return {
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt,
      user: user.name ?? undefined,
    };
  });
  return {
    ok: true,
    output: encodeIntegrationJson({
      ...slim(issue),
      description: rec(issue).description,
      comments,
    }),
  };
}

async function linearCreate(
  args: Record<string, unknown>,
  account: IntegrationAccount,
  fetchFn: IntegrationFetcher,
): Promise<{ ok: boolean; output: string }> {
  const team = str(args, "team");
  const title = str(args, "title") || str(args, "summary") || str(args, "name");
  if (!team || !title) return { ok: false, output: "team and title are required" };
  const teamId = await resolveTeamId(account, fetchFn, team);
  const description = str(args, "description") || str(args, "body");
  const input: Record<string, unknown> = { teamId, title };
  if (description) input.description = description;
  const priority = linearPriority(args.priority);
  if (priority != null) input.priority = priority;
  const stateId = await resolveStateId(
    account,
    fetchFn,
    teamId,
    str(args, "state") || str(args, "status"),
  );
  if (stateId) input.stateId = stateId;
  const assigneeId = await resolveAssigneeId(account, fetchFn, str(args, "assignee"));
  if (assigneeId) input.assigneeId = assigneeId;
  const parentId = await resolveIssueId(account, fetchFn, str(args, "parent") || str(args, "epic"));
  if (parentId) input.parentId = parentId;
  const labelIds = await resolveLabelIds(account, fetchFn, teamId, args.labels);
  if (labelIds?.length) input.labelIds = labelIds;
  const data = await gql(
    account,
    fetchFn,
    `mutation Create($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { identifier url } }
    }`,
    { input },
  );
  const created = rec(rec(data.issueCreate).issue);
  const identifier = String(created.identifier ?? "").trim();
  if (!identifier) return { ok: false, output: encodeIntegrationJson(data.issueCreate) };
  const url = String(created.url ?? "").trim();
  return { ok: true, output: url ? `Created ${identifier} ${url}` : `Created ${identifier}` };
}

async function linearUpdate(
  id: string,
  args: Record<string, unknown>,
  account: IntegrationAccount,
  fetchFn: IntegrationFetcher,
): Promise<{ ok: boolean; output: string }> {
  const issue = await fetchIssue(account, fetchFn, id);
  if (!issue) return { ok: false, output: `Unknown Linear issue ${id}` };
  const issueRec = rec(issue);
  const uuid = String(issueRec.id ?? "").trim();
  const identifier = String(issueRec.identifier ?? id).trim();
  const teamId = String(rec(issueRec.team).id ?? "").trim();
  const input: Record<string, unknown> = {};
  const title = str(args, "title") || str(args, "summary") || str(args, "name");
  if (title) input.title = title;
  const description = str(args, "description") || str(args, "body");
  if (description) input.description = description;
  const priority = linearPriority(args.priority);
  if (priority != null) input.priority = priority;
  const stateId = await resolveStateId(
    account,
    fetchFn,
    teamId,
    str(args, "state") || str(args, "status") || str(args, "transition"),
  );
  if (stateId) input.stateId = stateId;
  const assigneeRaw = str(args, "assignee");
  if (assigneeRaw === "none" || assigneeRaw === "unassigned") {
    input.assigneeId = null;
  } else {
    const assigneeId = await resolveAssigneeId(account, fetchFn, assigneeRaw);
    if (assigneeId) input.assigneeId = assigneeId;
  }
  const parentId = await resolveIssueId(account, fetchFn, str(args, "parent") || str(args, "epic"));
  if (parentId) input.parentId = parentId;
  const labelIds = await resolveLabelIds(account, fetchFn, teamId, args.labels);
  if (labelIds) input.labelIds = labelIds;
  if (!Object.keys(input).length) return { ok: false, output: "nothing to update" };
  await gql(
    account,
    fetchFn,
    `mutation Update($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success issue { identifier url } }
    }`,
    { id: uuid || id, input },
  );
  return { ok: true, output: `Updated ${identifier}` };
}

async function linearComment(
  id: string,
  args: Record<string, unknown>,
  account: IntegrationAccount,
  fetchFn: IntegrationFetcher,
): Promise<{ ok: boolean; output: string }> {
  const body = str(args, "body") || str(args, "comment") || str(args, "message");
  if (!body) return { ok: false, output: "body is required" };
  const issue = await fetchIssue(account, fetchFn, id);
  if (!issue) return { ok: false, output: `Unknown Linear issue ${id}` };
  const uuid = String(rec(issue).id ?? "").trim();
  const identifier = String(rec(issue).identifier ?? id).trim();
  await gql(
    account,
    fetchFn,
    `mutation Comment($input: CommentCreateInput!) {
      commentCreate(input: $input) { success comment { id } }
    }`,
    { input: { issueId: uuid || id, body } },
  );
  return { ok: true, output: `Commented on ${identifier}` };
}

async function fetchIssue(
  account: IntegrationAccount,
  fetchFn: IntegrationFetcher,
  id: string,
  withComments = false,
): Promise<Record<string, unknown> | undefined> {
  const extra = withComments
    ? `comments(first: 10) { nodes { id body createdAt user { name } } }`
    : "";
  const data = await gql(
    account,
    fetchFn,
    `query Issue($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} ${extra} } }`,
    { id },
  );
  const issue = rec(data.issue);
  return issue.id || issue.identifier ? issue : undefined;
}

async function resolveTeamId(
  account: IntegrationAccount,
  fetchFn: IntegrationFetcher,
  team: string,
): Promise<string> {
  if (UUID.test(team)) return team;
  const data = await gql(
    account,
    fetchFn,
    `query Team($key: String!) {
      teams(filter: { key: { eqIgnoreCase: $key } }) { nodes { id key name } }
    }`,
    { key: team },
  );
  const match =
    nodes(data.teams).find((row) => {
      const item = rec(row);
      return String(item.key ?? "").toLowerCase() === team.toLowerCase();
    }) ?? nodes(data.teams)[0];
  const id = String(rec(match).id ?? "").trim();
  if (!id) throw new Error(`Unknown Linear team ${team}`);
  return id;
}

async function resolveStateId(
  account: IntegrationAccount,
  fetchFn: IntegrationFetcher,
  teamId: string,
  wanted: string,
): Promise<string | undefined> {
  if (!wanted) return undefined;
  if (UUID.test(wanted)) return wanted;
  if (!teamId) return undefined;
  const data = await gql(
    account,
    fetchFn,
    `query States($id: String!) {
      team(id: $id) { states { nodes { id name type } } }
    }`,
    { id: teamId },
  );
  const states = nodes(rec(data.team).states);
  const match = states.find(
    (row) => String(rec(row).name ?? "").toLowerCase() === wanted.toLowerCase(),
  );
  const id = String(rec(match).id ?? "").trim();
  if (!id) throw new Error(`Unknown Linear state ${wanted}`);
  return id;
}

async function resolveAssigneeId(
  account: IntegrationAccount,
  fetchFn: IntegrationFetcher,
  wanted: string,
): Promise<string | undefined> {
  if (!wanted) return undefined;
  if (UUID.test(wanted)) return wanted;
  if (wanted === "me" || wanted === "self") {
    const data = await gql(account, fetchFn, `query Viewer { viewer { id } }`);
    const id = String(rec(data.viewer).id ?? "").trim();
    if (!id) throw new Error("Could not resolve Linear viewer");
    return id;
  }
  const filter = wanted.includes("@")
    ? { email: { eqIgnoreCase: wanted } }
    : { displayName: { eqIgnoreCase: wanted } };
  const data = await gql(
    account,
    fetchFn,
    `query Users($filter: UserFilter) { users(filter: $filter) { nodes { id name email displayName } } }`,
    { filter },
  );
  const id = String(rec(nodes(data.users)[0]).id ?? "").trim();
  if (!id) throw new Error(`Unknown Linear assignee ${wanted}`);
  return id;
}

async function resolveIssueId(
  account: IntegrationAccount,
  fetchFn: IntegrationFetcher,
  raw: string,
): Promise<string | undefined> {
  if (!raw) return undefined;
  if (UUID.test(raw)) return raw;
  const issue = await fetchIssue(account, fetchFn, raw);
  const id = String(rec(issue).id ?? "").trim();
  if (!id) throw new Error(`Unknown Linear issue ${raw}`);
  return id;
}

function labelNames(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    const rows = raw
      .filter((row): row is string => typeof row === "string")
      .map((row) => row.trim())
      .filter(Boolean);
    return rows.length ? rows : undefined;
  }
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const rows = raw
    .split(/[\s,]+/)
    .map((row) => row.trim())
    .filter(Boolean);
  return rows.length ? rows : undefined;
}

async function resolveLabelIds(
  account: IntegrationAccount,
  fetchFn: IntegrationFetcher,
  teamId: string,
  raw: unknown,
): Promise<string[] | undefined> {
  const names = labelNames(raw);
  if (!names) return undefined;
  const ids: string[] = [];
  for (const name of names) {
    if (UUID.test(name)) {
      ids.push(name);
      continue;
    }
    const data = await gql(
      account,
      fetchFn,
      teamId
        ? `query Labels($name: String!, $teamId: String!) {
            issueLabels(filter: { name: { eqIgnoreCase: $name }, team: { id: { eq: $teamId } } }) {
              nodes { id name }
            }
          }`
        : `query Labels($name: String!) {
            issueLabels(filter: { name: { eqIgnoreCase: $name } }) { nodes { id name } }
          }`,
      teamId ? { name, teamId } : { name },
    );
    const id = String(rec(nodes(data.issueLabels)[0]).id ?? "").trim();
    if (!id) throw new Error(`Unknown Linear label ${name}`);
    ids.push(id);
  }
  return ids;
}

function linearPriority(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 4) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw.trim());
    if (Number.isInteger(n) && n >= 0 && n <= 4) return n;
  }
  return undefined;
}
