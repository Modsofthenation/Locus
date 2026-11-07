import { DOCKER_WORKSPACE, LINUX_WORKSPACE, WINDOWS_WORKSPACE } from "./vm.js";
import {
  cursorGithubRepoUrl,
  normalizeRepoUrl,
  parseRepoCheckout,
  repoDisplayName,
  shortRepoName,
  type RepoCheckout,
} from "./git.js";
import { attachLinkedCheckout, type LinkedRepo } from "./repo.js";

export type SessionRepoFields = {
  repo?: RepoCheckout;
  repoId?: string;
  extraRepos?: RepoCheckout[];
  extraRepoIds?: string[];
};

const GIT_PATH_TOOLS = new Set([
  "git_status",
  "git_diff",
  "git_log",
  "git_commit",
  "git_branch",
  "git_push",
  "git_stash",
  "git_revert",
  "git_fetch",
  "apply_patch",
]);

export function isGitPathToolName(name: string): boolean {
  return GIT_PATH_TOOLS.has(name);
}

export function parseRepoCheckouts(raw: unknown): RepoCheckout[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: RepoCheckout[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const checkout = parseRepoCheckout(row);
    if (!checkout) continue;
    const key = normalizeRepoUrl(checkout.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(checkout);
  }
  return out.length ? out : undefined;
}

export function parseRepoIdList(raw: unknown): string[] | undefined {
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const ids = values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return ids.length ? [...new Set(ids)] : undefined;
}

export function sessionRepoCheckouts(session: SessionRepoFields): RepoCheckout[] {
  const extra = session.extraRepos ?? [];
  if (!session.repo?.url) return extra.filter((row) => row.url);
  const key = normalizeRepoUrl(session.repo.url);
  return [session.repo, ...extra.filter((row) => normalizeRepoUrl(row.url) !== key)];
}

export function isMultiRepoWorkspace(session: SessionRepoFields): boolean {
  return sessionRepoCheckouts(session).length > 1;
}

export function attachLinkedCheckouts(
  repos: LinkedRepo[],
  input: SessionRepoFields,
): SessionRepoFields {
  const extraIds = parseRepoIdList(input.extraRepoIds) ?? [];
  const primaryId = input.repoId?.trim() || undefined;
  const rows: Array<{ id?: string; checkout: RepoCheckout }> = [];
  const seen = new Set<string>();

  const push = (id: string | undefined, checkout: RepoCheckout | undefined) => {
    if (!checkout?.url) return;
    const key = normalizeRepoUrl(checkout.url);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ id, checkout });
  };

  if (primaryId) {
    const attached = attachLinkedCheckout(repos, { repoId: primaryId, repo: input.repo });
    push(attached.repoId, attached.repo);
  } else if (input.repo?.url) {
    const attached = attachLinkedCheckout(repos, { repo: input.repo });
    push(attached.repoId, attached.repo);
  }

  for (const id of extraIds) {
    if (id === primaryId) continue;
    const linked = repos.find((row) => row.id === id);
    const override = linked
      ? (input.extraRepos ?? []).find(
          (row) => normalizeRepoUrl(row.url) === normalizeRepoUrl(linked.checkout.url),
        )
      : undefined;
    const attached = attachLinkedCheckout(repos, { repoId: id, repo: override });
    push(attached.repoId, attached.repo);
  }

  for (const row of input.extraRepos ?? []) {
    const attached = attachLinkedCheckout(repos, { repo: row });
    push(attached.repoId, attached.repo);
  }

  const [first, ...rest] = rows;
  if (!first) return {};
  return {
    repo: first.checkout,
    repoId: first.id,
    extraRepos: rest.length ? rest.map((row) => row.checkout) : undefined,
    extraRepoIds: rest.some((row) => row.id)
      ? rest.map((row) => row.id).filter((id): id is string => Boolean(id))
      : undefined,
  };
}

export function sanitizeCloneDirName(raw: string, fallback = "repo"): string {
  const last =
    raw
      .replace(/\.git$/i, "")
      .split(/[\\/]/)
      .filter((part) => part && part !== "." && part !== "..")
      .at(-1) ?? fallback;
  const cleaned = last.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

const KNOWN_WORKSPACE_ROOTS = [
  DOCKER_WORKSPACE,
  LINUX_WORKSPACE,
  WINDOWS_WORKSPACE.replace(/\\/g, "/"),
];

export function destRelativeToWorkspace(dest: string | undefined, workspaceRoot: string): string {
  if (!dest?.trim()) return "";
  const posix = dest.replace(/\\/g, "/").replace(/\/+$/, "");
  const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "") || DOCKER_WORKSPACE;
  if (posix === root) return "";
  if (posix.startsWith(`${root}/`)) return posix.slice(root.length + 1);
  if (posix.startsWith("/")) return "";
  return posix
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

/** Relative dest name (`lib`) for a checkout under any known guest workspace root. */
export function checkoutDestRel(dest: string | undefined): string {
  if (!dest?.trim()) return "";
  const posix = dest.replace(/\\/g, "/").replace(/\/+$/, "");
  for (const root of KNOWN_WORKSPACE_ROOTS) {
    const rel = destRelativeToWorkspace(posix, root);
    if (rel) return rel;
  }
  if (posix.startsWith("/")) return posix.split("/").filter(Boolean).at(-1) ?? "";
  return posix
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

/** True when `path` names the checkout directory itself, not a file inside it. */
export function isCheckoutDirAlias(path: string | undefined, dest: string | undefined): boolean {
  if (!path?.trim() || !dest?.trim()) return false;
  const needle = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const abs = dest.replace(/\\/g, "/").replace(/\/+$/, "");
  if (needle === abs) return true;
  const needleRel = checkoutDestRel(needle);
  const destRel = checkoutDestRel(abs);
  return Boolean(needleRel && destRel && needleRel === destRel);
}

function uniqueDest(base: string, used: Set<string>): string {
  if (!used.has(base.toLowerCase())) return base;
  let i = 2;
  let next = `${base}-${i}`;
  while (used.has(next.toLowerCase())) {
    i += 1;
    next = `${base}-${i}`;
  }
  return next;
}

export function assignWorkspaceCloneDests(
  checkouts: RepoCheckout[],
  workspaceRoot: string,
): RepoCheckout[] {
  if (checkouts.length <= 1) return checkouts;
  const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "") || DOCKER_WORKSPACE;
  const used = new Set<string>();
  return checkouts.map((checkout) => {
    const rel =
      destRelativeToWorkspace(checkout.dest, root) ||
      sanitizeCloneDirName(shortRepoName(checkout.url));
    let dest = `${root}/${rel || sanitizeCloneDirName(shortRepoName(checkout.url))}`;
    if (used.has(dest.toLowerCase())) {
      dest = `${root}/${sanitizeCloneDirName(repoDisplayName(checkout.url).replace("/", "-"))}`;
    }
    dest = uniqueDest(dest, used);
    used.add(dest.toLowerCase());
    return { ...checkout, dest };
  });
}

export function assignSessionCloneDests(
  attached: SessionRepoFields,
  workspaceRoot: string,
): SessionRepoFields {
  const checkouts = sessionRepoCheckouts(attached);
  if (checkouts.length <= 1) return attached;
  const assigned = assignWorkspaceCloneDests(checkouts, workspaceRoot);
  const [first, ...rest] = assigned;
  if (!first) return attached;
  return {
    ...attached,
    repo: first,
    extraRepos: rest.length ? rest : undefined,
  };
}

export function matchWorkspaceCheckout(
  session: SessionRepoFields,
  opts: { path?: string; url?: string; dest?: string } = {},
): RepoCheckout | undefined {
  const checkouts = sessionRepoCheckouts(session);
  if (!checkouts.length) return undefined;
  if (opts.url) {
    const key = normalizeRepoUrl(opts.url);
    const hit = checkouts.find((row) => normalizeRepoUrl(row.url) === key);
    if (hit) return hit;
  }
  const needle = (opts.path || opts.dest || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (needle) {
    const needleRel = checkoutDestRel(needle);
    const ranked = checkouts
      .filter((row) => row.dest)
      .map((row) => {
        const dest = row.dest!.replace(/\\/g, "/").replace(/\/+$/, "");
        if (needle === dest || needle.startsWith(`${dest}/`)) return { row, len: dest.length };
        const destRel = checkoutDestRel(dest);
        if (destRel && (needleRel === destRel || needleRel.startsWith(`${destRel}/`))) {
          return { row, len: dest.length };
        }
        return undefined;
      })
      .filter((row): row is { row: RepoCheckout; len: number } => Boolean(row))
      .sort((a, b) => b.len - a.len);
    if (ranked[0]) return ranked[0].row;
  }
  return checkouts[0];
}

export type WorkspaceGitDest = {
  dest: string;
  name: string;
  url?: string;
  primary?: boolean;
};

export function gitWorkspaceDests(
  session: SessionRepoFields,
  workspaceRoot = DOCKER_WORKSPACE,
): WorkspaceGitDest[] {
  const checkouts = sessionRepoCheckouts(session);
  if (!checkouts.length) return [];
  return checkouts.map((row, index) => ({
    dest: destRelativeToWorkspace(row.dest, workspaceRoot),
    name: shortRepoName(row.url),
    url: row.url,
    primary: index === 0 ? true : undefined,
  }));
}

export function resolveGitWorkspaceDest(
  session: SessionRepoFields,
  dest: string | undefined,
  workspaceRoot = DOCKER_WORKSPACE,
): string {
  const dests = gitWorkspaceDests(session, workspaceRoot);
  if (!dests.length) return "";
  const needle = (dest ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (needle) {
    const hit = dests.find((row) => row.dest === needle);
    if (hit) return hit.dest;
  }
  return dests[0]?.dest ?? "";
}

export function matchGitDest(rel: string, dests: WorkspaceGitDest[]): WorkspaceGitDest | undefined {
  const path = rel.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!path) return undefined;
  return dests
    .filter((row) => row.dest && (path === row.dest || path.startsWith(`${row.dest}/`)))
    .sort((a, b) => b.dest.length - a.dest.length)[0];
}

export function relInGitDest(rel: string, dest: string): string {
  const path = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!dest) return path;
  if (path === dest) return ".";
  if (path.startsWith(`${dest}/`)) return path.slice(dest.length + 1);
  return path;
}

export function cursorCloudReposFromSession(
  session: SessionRepoFields,
): Array<{ url: string; startingRef?: string }> {
  const out: Array<{ url: string; startingRef?: string }> = [];
  const seen = new Set<string>();
  for (const checkout of sessionRepoCheckouts(session)) {
    const url = cursorGithubRepoUrl(checkout.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, startingRef: checkout.ref });
  }
  return out;
}

export function formatAttachedReposPrompt(input: {
  checkouts: RepoCheckout[];
  design?: boolean;
  host?: boolean;
  machine?: string;
}): string {
  const checkouts = input.checkouts.filter((row) => row.url);
  if (!checkouts.length) return "";
  if (input.design) {
    const first = checkouts[0]!;
    return `Attached repository: ${first.url}${first.ref ? ` (ref ${first.ref})` : ""}. It is cloned into /workspace/_repo as read-only design context before you start. Skim CONTEXT.md, grep for the named screen, and file_read only those files (offset/limit) for tokens and layout — do not walk the whole tree, grep product internals, or read other sessions' workspaces. Do not edit files under /workspace/_repo. Your only write target is the live canvas at /workspace/index.html. This session does not commit, push, or open pull requests; git work happens only after Promote to agent.`;
  }
  if (checkouts.length === 1) {
    const first = checkouts[0]!;
    const dest = first.dest?.trim();
    const destNote = dest && dest !== DOCKER_WORKSPACE ? ` at ${dest}` : "";
    return input.host
      ? `Attached repository: ${first.url}${first.ref ? ` (ref ${first.ref})` : ""}. Clone into /workspace${destNote && dest !== "/workspace" ? ` (${dest})` : ""} and work there.`
      : `Attached repository: ${first.url}${first.ref ? ` (ref ${first.ref})` : ""}. Clone and work inside the ${input.machine ?? "guest"}, not the host.`;
  }
  const lines = checkouts.map((row, index) => {
    const dest =
      row.dest?.trim() || `${DOCKER_WORKSPACE}/${sanitizeCloneDirName(shortRepoName(row.url))}`;
    const primary =
      index === 0 ? " — primary. git_pr / git_push without path use this checkout." : "";
    return `- ${row.url}${row.ref ? ` (ref ${row.ref})` : ""} at ${dest}${primary}`;
  });
  const sample = checkouts.find((row) => row.dest?.trim())?.dest?.replace(/\\/g, "/") ?? "";
  const root = sample.includes("/")
    ? sample.replace(/\/[^/]+$/, "") || DOCKER_WORKSPACE
    : DOCKER_WORKSPACE;
  return [
    `Attached repositories (cloned into ${root}/<name> before you start):`,
    ...lines,
    "Pass path to git_status, git_commit, git_push, git_fetch, and git_pr for a non-primary checkout (the dest listed above). Do not git_clone again unless a dest is empty.",
  ].join("\n");
}

export function sessionRepoState(input: SessionRepoFields): SessionRepoFields {
  return {
    repo: input.repo,
    repoId: input.repoId,
    extraRepos: input.extraRepos?.length ? input.extraRepos : undefined,
    extraRepoIds: input.extraRepoIds?.length ? input.extraRepoIds : undefined,
  };
}
