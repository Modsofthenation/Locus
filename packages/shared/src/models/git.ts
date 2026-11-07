export const FORGE_KINDS = ["github", "gitlab", "bitbucket"] as const;
export type ForgeKind = (typeof FORGE_KINDS)[number];

export function isForgeKind(value: unknown): value is ForgeKind {
  return value === "github" || value === "gitlab" || value === "bitbucket";
}

export type ForgeAuthMethod = "token" | "oauth";

export interface GitForgeAccount {
  id: string;
  kind: ForgeKind;
  name: string;
  username?: string;
  token?: string;
  sshKeyPath?: string;
  apiBaseUrl: string;
  /** How the current token was obtained. Absent means a pasted PAT. */
  authMethod?: ForgeAuthMethod;
  oauthClientId?: string;
  oauthClientSecret?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
}

export interface RepoCheckout {
  forge: ForgeKind;
  url: string;
  ref?: string;
  dest?: string;
  accountId?: string;
}

export const DEFAULT_FORGE_SPECS: Array<
  Omit<GitForgeAccount, "id" | "token" | "sshKeyPath" | "username">
> = [
  { kind: "github", name: "GitHub", apiBaseUrl: "https://api.github.com" },
  { kind: "gitlab", name: "GitLab", apiBaseUrl: "https://gitlab.com/api/v4" },
  { kind: "bitbucket", name: "Bitbucket", apiBaseUrl: "https://api.bitbucket.org/2.0" },
];

export function defaultForgeApiUrl(kind: ForgeKind): string {
  return (
    DEFAULT_FORGE_SPECS.find((row) => row.kind === kind)?.apiBaseUrl ?? "https://api.github.com"
  );
}

export function forgeLabel(kind: ForgeKind): string {
  if (kind === "gitlab") return "GitLab";
  if (kind === "bitbucket") return "Bitbucket";
  return "GitHub";
}

export function forgeSupportsSso(kind: ForgeKind): boolean {
  return kind === "github" || kind === "bitbucket" || kind === "gitlab";
}

export function forgeOauthCallbackUrl(bindPort = 7420): string {
  const port = Number(bindPort);
  return `http://127.0.0.1:${Number.isInteger(port) && port > 0 ? port : 7420}/api/oauth/callback`;
}

export function forgeWebOrigin(kind: ForgeKind, apiBaseUrl: string): string {
  const fallback =
    kind === "gitlab"
      ? "https://gitlab.com"
      : kind === "bitbucket"
        ? "https://bitbucket.org"
        : "https://github.com";
  try {
    const url = new URL(apiBaseUrl);
    const host = url.hostname.toLowerCase();
    const origin = `${url.protocol}//${url.host}`;
    if (kind === "github" && (host === "api.github.com" || host === "github.com")) {
      return "https://github.com";
    }
    if (kind === "bitbucket" && (host === "api.bitbucket.org" || host === "bitbucket.org")) {
      return "https://bitbucket.org";
    }
    if (kind === "gitlab" && (host === "gitlab.com" || host.startsWith("gitlab."))) {
      return host === "gitlab.com" ? "https://gitlab.com" : origin.replace(/\/api\/v4$/i, "");
    }
    return origin.replace(/\/api(?:\/v\d+)?$/i, "") || fallback;
  } catch {
    return fallback;
  }
}

export const GITHUB_OAUTH_SCOPES = "repo read:user read:org workflow";
export const BITBUCKET_OAUTH_SCOPES = "account repository:write pullrequest:write";
export const GITLAB_OAUTH_SCOPES = "api";

export function githubDeviceCodeUrl(webOrigin: string): string {
  return `${webOrigin.replace(/\/$/, "")}/login/device/code`;
}

export function githubAccessTokenUrl(webOrigin: string): string {
  return `${webOrigin.replace(/\/$/, "")}/login/oauth/access_token`;
}

export function bitbucketAuthorizeUrl(webOrigin: string): string {
  return `${webOrigin.replace(/\/$/, "")}/site/oauth2/authorize`;
}

export function bitbucketTokenUrl(webOrigin: string): string {
  return `${webOrigin.replace(/\/$/, "")}/site/oauth2/access_token`;
}

export function gitlabAuthorizeUrl(webOrigin: string): string {
  return `${webOrigin.replace(/\/$/, "")}/oauth/authorize`;
}

export function gitlabTokenUrl(webOrigin: string): string {
  return `${webOrigin.replace(/\/$/, "")}/oauth/token`;
}

export function redirectAuthorizeUrl(kind: ForgeKind, webOrigin: string): string {
  if (kind === "gitlab") return gitlabAuthorizeUrl(webOrigin);
  return bitbucketAuthorizeUrl(webOrigin);
}

export function redirectTokenUrl(kind: ForgeKind, webOrigin: string): string {
  if (kind === "gitlab") return gitlabTokenUrl(webOrigin);
  return bitbucketTokenUrl(webOrigin);
}

export function redirectOauthScopes(kind: ForgeKind): string {
  if (kind === "gitlab") return GITLAB_OAUTH_SCOPES;
  return BITBUCKET_OAUTH_SCOPES;
}

export function forgeOauthClientIdEnv(kind: ForgeKind): string | undefined {
  if (kind === "github") return "LOCUS_GITHUB_OAUTH_CLIENT_ID";
  if (kind === "bitbucket") return "LOCUS_BITBUCKET_OAUTH_CLIENT_ID";
  if (kind === "gitlab") return "LOCUS_GITLAB_OAUTH_CLIENT_ID";
  return undefined;
}

export function forgeOauthClientSecretEnv(kind: ForgeKind): string | undefined {
  if (kind === "github") return "LOCUS_GITHUB_OAUTH_CLIENT_SECRET";
  if (kind === "bitbucket") return "LOCUS_BITBUCKET_OAUTH_CLIENT_SECRET";
  if (kind === "gitlab") return "LOCUS_GITLAB_OAUTH_CLIENT_SECRET";
  return undefined;
}

export function tokenExpiresSoon(expiresAt: string | undefined, skewMs = 60_000): boolean {
  if (!expiresAt) return false;
  const ms = Date.parse(expiresAt);
  return Number.isFinite(ms) && ms - skewMs <= Date.now();
}

export function forgeOauthScopes(kind: ForgeKind): string {
  if (kind === "gitlab") return GITLAB_OAUTH_SCOPES;
  if (kind === "bitbucket") return BITBUCKET_OAUTH_SCOPES;
  return GITHUB_OAUTH_SCOPES;
}

export function forgeHostLabel(kind: ForgeKind, apiBaseUrl: string): string {
  try {
    return new URL(forgeWebOrigin(kind, apiBaseUrl)).hostname;
  } catch {
    return kind === "gitlab" ? "gitlab.com" : kind === "bitbucket" ? "bitbucket.org" : "github.com";
  }
}

export function forgeAccountInitials(
  account: Pick<GitForgeAccount, "username" | "name" | "kind">,
): string {
  const username = account.username?.replace(/^@/, "").trim();
  const source = (username || account.name || forgeShort(account.kind)).replace(/^@/, "").trim();
  if (!username) return forgeShort(account.kind);
  const parts = source.split(/[.\-_\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
  }
  const compact = parts[0] || forgeShort(account.kind);
  return compact.slice(0, 2).toUpperCase();
}

export function forgeAccountHandle(account: Pick<GitForgeAccount, "username" | "name">): string {
  const username = account.username?.trim().replace(/^@/, "");
  if (username) return `@${username}`;
  return account.name;
}

export function forgeAccountSubtitle(account: Pick<GitForgeAccount, "kind" | "name">): string {
  const label = forgeLabel(account.kind);
  const name = account.name.trim();
  if (!name || name === label) return label;
  if (
    name.startsWith(`${label} `) ||
    name.startsWith(`${label}—`) ||
    name.startsWith(`${label} —`)
  ) {
    return name;
  }
  return `${label} — ${name}`;
}

export type ForgeAccountStatusKind = "signed-in" | "expiring" | "expired" | "signed-out";

const TOKEN_EXPIRY_WARN_MS = 7 * 24 * 60 * 60 * 1000;

export function forgeAccountStatus(
  account: Pick<GitForgeAccount, "token" | "tokenExpiresAt">,
  now = Date.now(),
  warnWithinMs = TOKEN_EXPIRY_WARN_MS,
): { kind: ForgeAccountStatusKind; label: string } {
  if (!account.token?.trim()) return { kind: "signed-out", label: "Not signed in" };
  if (!account.tokenExpiresAt) return { kind: "signed-in", label: "Signed in" };
  const ms = Date.parse(account.tokenExpiresAt);
  if (!Number.isFinite(ms)) return { kind: "signed-in", label: "Signed in" };
  const remaining = ms - now;
  if (remaining <= 0) return { kind: "expired", label: "Token expired" };
  if (remaining <= warnWithinMs) {
    if (remaining < 24 * 60 * 60 * 1000) {
      const hours = Math.max(1, Math.round(remaining / (60 * 60 * 1000)));
      return {
        kind: "expiring",
        label: `Token expires in ${hours} hour${hours === 1 ? "" : "s"}`,
      };
    }
    const days = Math.max(1, Math.round(remaining / (24 * 60 * 60 * 1000)));
    return {
      kind: "expiring",
      label: `Token expires in ${days} day${days === 1 ? "" : "s"}`,
    };
  }
  return { kind: "signed-in", label: "Signed in" };
}

export function formatForgeUsedAt(iso?: string, now = Date.now()): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t > now + 60_000) return undefined;
  const delta = Math.max(0, now - t);
  const mins = Math.round(delta / 60_000);
  if (mins < 1) return "Used just now";
  if (mins === 1) return "Used 1 minute ago";
  if (mins < 60) return `Used ${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours === 1) return "Used 1 hour ago";
  if (hours < 24) return `Used ${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Used yesterday";
  return `Used ${days} days ago`;
}

export function latestForgeRepoActivity(
  repos: Array<{ lastFetchAt?: string; lastPushedAt?: string; updatedAt?: string }>,
): string | undefined {
  let latestMs: number | undefined;
  let latest: string | undefined;
  for (const row of repos) {
    for (const value of [row.lastFetchAt, row.lastPushedAt, row.updatedAt]) {
      if (!value) continue;
      const ms = Date.parse(value);
      if (!Number.isFinite(ms)) continue;
      if (latestMs == null || ms > latestMs) {
        latestMs = ms;
        latest = value;
      }
    }
  }
  return latest;
}

export function replaceForgeAccount(
  forges: GitForgeAccount[],
  account: GitForgeAccount,
): GitForgeAccount[] {
  if (forges.some((row) => row.id === account.id)) {
    return forges.map((row) => (row.id === account.id ? account : row));
  }
  return [...forges, account];
}

export function clearForgeOauth(account: GitForgeAccount): GitForgeAccount {
  return {
    ...account,
    token: undefined,
    refreshToken: undefined,
    tokenExpiresAt: undefined,
    authMethod: undefined,
    username: undefined,
  };
}

export interface ForgeOauthStart {
  method: "device" | "redirect";
  userCode?: string;
  verificationUri?: string;
  verificationUriComplete?: string;
  authorizeUrl?: string;
  expiresIn: number;
  interval?: number;
}

export interface ForgeOauthStatus {
  status: "idle" | "pending" | "complete" | "error" | "expired";
  method?: "device" | "redirect";
  userCode?: string;
  verificationUri?: string;
  verificationUriComplete?: string;
  authorizeUrl?: string;
  username?: string;
  error?: string;
}

export function forgeShort(kind: ForgeKind): string {
  if (kind === "gitlab") return "GL";
  if (kind === "bitbucket") return "BB";
  return "GH";
}

export function forgeHasToken(account: Pick<GitForgeAccount, "token">): boolean {
  return Boolean(account.token?.trim());
}

export function forgesWithTokens(forges: GitForgeAccount[]): GitForgeAccount[] {
  return forges.filter(forgeHasToken);
}

export function mergeDefaultForges(
  forges: GitForgeAccount[],
  id: () => string = () => crypto.randomUUID(),
): GitForgeAccount[] {
  const out = Array.isArray(forges) ? [...forges] : [];
  for (const spec of DEFAULT_FORGE_SPECS) {
    if (!out.some((row) => row.kind === spec.kind)) {
      out.push({ id: id(), ...spec });
    }
  }
  return out;
}

/** HTTPS GitHub URL without `.git`, as Cursor Cloud Agents `repos[].url` expects. */
export function cursorGithubRepoUrl(url?: string): string | undefined {
  if (!url?.trim()) return undefined;
  const parsed = parseRepoUrl(url);
  if (!parsed || parsed.forge !== "github") return undefined;
  const ownerRepo = parseOwnerRepo(parsed.url);
  if (!ownerRepo) return undefined;
  return `https://github.com/${ownerRepo.owner}/${ownerRepo.repo}`;
}

export function parseRepoUrl(input: string): { forge: ForgeKind; url: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const github =
    /^(?:https?:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;
  const bitbucket =
    /^(?:https?:\/\/bitbucket\.org\/|git@bitbucket\.org:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;
  const gitlab =
    /^(?:https?:\/\/gitlab\.com\/|git@gitlab\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

  const gh = trimmed.match(github);
  if (gh) {
    return { forge: "github", url: `https://github.com/${gh[1]}/${gh[2]}.git` };
  }
  const bb = trimmed.match(bitbucket);
  if (bb) {
    return { forge: "bitbucket", url: `https://bitbucket.org/${bb[1]}/${bb[2]}.git` };
  }
  const gl = trimmed.match(gitlab);
  if (gl) {
    return { forge: "gitlab", url: `https://gitlab.com/${gl[1]}/${gl[2]}.git` };
  }
  if (trimmed.startsWith("https://") || trimmed.startsWith("git@")) {
    const host = trimmed.toLowerCase();
    const forge: ForgeKind = host.includes("bitbucket")
      ? "bitbucket"
      : host.includes("gitlab")
        ? "gitlab"
        : "github";
    return { forge, url: trimmed };
  }
  return null;
}

export function isProtectedGitBranch(name: string): boolean {
  const branch = name
    .trim()
    .replace(/^refs\/heads\//, "")
    .toLowerCase();
  return branch === "main" || branch === "master" || branch === "trunk";
}

/** Head/source branch for push/PR walls. Never treat git_pr `base` as the head. */
export function protectedGitHeadArg(
  name: string,
  args?: Record<string, unknown>,
): string | undefined {
  if (name !== "git_push" && name !== "git_pr") return undefined;
  const head = typeof args?.branch === "string" ? args.branch.trim() : "";
  if (!head || !isProtectedGitBranch(head)) return undefined;
  return head.replace(/^refs\/heads\//, "");
}

export function parseGitStatusBranch(output: string): string | undefined {
  const match = output.match(/^On branch (\S+)/m);
  return match?.[1];
}

/** Strip `refs/heads/` / `origin/` and drop detached HEAD. */
export function cleanGitHeadName(raw: string): string | undefined {
  const name = raw
    .trim()
    .replace(/^refs\/heads\//, "")
    .replace(/^origin\//, "");
  if (!name || name === "HEAD") return undefined;
  return name;
}

/** Sidebar-safe branch label: short SHAs, otherwise the cleaned head name. */
export function formatGitHeadName(raw: string): string | undefined {
  const name = cleanGitHeadName(raw);
  if (!name) return undefined;
  if (/^[0-9a-f]{7,40}$/i.test(name)) return name.slice(0, 7);
  return name;
}

/**
 * Best-known workspace branch for an agent row. Prefers the live head
 * (`gitBranch`) over the bound PR / clone starting ref.
 */
export function sessionGitBranch(session: {
  gitBranch?: string;
  compare?: { branch?: string } | null;
  pull?: { headRef?: string } | null;
  repo?: { ref?: string } | null;
}): string | undefined {
  for (const raw of [
    session.compare?.branch,
    session.gitBranch,
    session.pull?.headRef,
    session.repo?.ref,
  ]) {
    if (typeof raw !== "string") continue;
    const name = formatGitHeadName(raw);
    if (name) return name;
  }
  return undefined;
}

/** Frozen branch when `branchLock` is on: create `repo.ref`, else first observed `gitBranch`. */
export function lockedBranchRef(session: {
  branchLock?: boolean;
  repo?: { ref?: string } | null;
  gitBranch?: string;
}): string | undefined {
  if (!session.branchLock) return undefined;
  for (const raw of [session.repo?.ref, session.gitBranch]) {
    if (typeof raw !== "string") continue;
    const name = cleanGitHeadName(raw);
    if (name) return name;
  }
  return undefined;
}

/** Refusal when switching away from the locked branch. Undefined = allow (or not locked yet). */
export function branchLockRefusal(
  session: {
    branchLock?: boolean;
    repo?: { ref?: string } | null;
    gitBranch?: string;
  },
  target: string,
): string | undefined {
  const locked = lockedBranchRef(session);
  if (!locked) return undefined;
  const next = cleanGitHeadName(target);
  if (!next || next === locked) return undefined;
  return `Branch is locked to ${locked} for this session`;
}

export function parseOwnerRepo(url: string): { owner: string; repo: string } | null {
  const match = url.replace(/\.git$/, "").match(/[:/]([^/]+)\/([^/]+)\/?$/);
  if (!match?.[1] || !match[2]) return null;
  return { owner: match[1], repo: match[2] };
}

export function normalizeRepoUrl(url: string): string {
  return url
    .toLowerCase()
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
}

export function repoDisplayName(url: string, fallback = "repo"): string {
  const parsed = parseOwnerRepo(url);
  if (parsed) return `${parsed.owner}/${parsed.repo}`;
  return (
    url
      .replace(/\.git$/i, "")
      .split("/")
      .filter(Boolean)
      .at(-1) ?? fallback
  );
}

/**
 * Short repo name for tight sidebar rows: the repo segment only, without
 * `owner/`. Falls back to the full display name when owner/repo can't be parsed.
 */
export function shortRepoName(url: string, fallback = "repo"): string {
  const parsed = parseOwnerRepo(url);
  if (parsed) return parsed.repo;
  return (
    url
      .replace(/\.git$/i, "")
      .split("/")
      .filter(Boolean)
      .at(-1) ?? fallback
  );
}

export function resolveForgeAccount(
  forges: GitForgeAccount[],
  opts: { accountId?: string; kind?: ForgeKind; url?: string } = {},
): GitForgeAccount | undefined {
  if (opts.accountId) {
    const exact = forges.find((row) => row.id === opts.accountId);
    // A linked repo can still point at a signed-out default row after the
    // operator pastes a token on a different GitHub account. Prefer a token.
    if (exact && forgeHasToken(exact)) return exact;
  }
  const kind = opts.kind ?? (opts.url ? parseRepoUrl(opts.url)?.forge : undefined);
  const ofKind = kind ? forges.filter((row) => row.kind === kind) : forges;
  const withToken = ofKind.filter(forgeHasToken);
  if (withToken.length === 1) return withToken[0];
  if (withToken.length > 1) {
    if (opts.url) {
      const parsed = parseRepoUrl(opts.url);
      const host = parsed?.url.toLowerCase() ?? "";
      const byHost = withToken.find((row) => {
        try {
          const apiHost = new URL(row.apiBaseUrl).hostname.toLowerCase();
          if (host.includes("github") && apiHost.includes("github")) return true;
          if (host.includes("gitlab") && apiHost.includes("gitlab")) return true;
          if (host.includes("bitbucket") && apiHost.includes("bitbucket")) return true;
        } catch {
          /* ignore */
        }
        return false;
      });
      if (byHost) return byHost;
    }
    return withToken[0];
  }
  return ofKind[0] ?? forges.find(forgeHasToken) ?? forges[0];
}

/** Convert `git@host:path` / `ssh://git@host/path` remotes to HTTPS so a token can authenticate. */
export function toHttpsRemoteUrl(url: string): string {
  const trimmed = url.trim();
  const scp = trimmed.match(/^git@([^:]+):(.+)$/i);
  if (scp) {
    const path = scp[2]!.replace(/\.git$/i, "").replace(/^\/+/, "");
    return `https://${scp[1]}/${path}.git`;
  }
  const ssh = trimmed.match(/^ssh:\/\/(?:git@)?([^/]+)\/(.+)$/i);
  if (ssh) {
    const path = ssh[2]!.replace(/\.git$/i, "");
    return `https://${ssh[1]}/${path}.git`;
  }
  return trimmed;
}

/** When a forge token is present, rewrite SSH remotes to HTTPS so clone/fetch/push do not need an SSH key. */
export function remoteUrlForToken(url: string, token?: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (!token?.trim()) return trimmed;
  return toHttpsRemoteUrl(trimmed);
}

export function pullHeadRefspec(kind: ForgeKind, number: number): string {
  if (kind === "gitlab") return `refs/merge-requests/${number}/head`;
  if (kind === "bitbucket") return `refs/pull-requests/${number}/from`;
  return `refs/pull/${number}/head`;
}

export function parsePullRef(ref?: string): number | undefined {
  if (!ref) return undefined;
  const trimmed = ref.trim();
  const match =
    trimmed.match(
      /^(?:refs\/)?(?:pulls?|merge-requests?|pull-requests)\/(\d+)(?:\/(?:head|from|merge))?$/i,
    ) ||
    trimmed.match(/^#(\d+)$/) ||
    trimmed.match(/^pr[#/-]?(\d+)$/i) ||
    trimmed.match(/^mr[#/-]?(\d+)$/i);
  if (!match?.[1]) return undefined;
  const number = Number(match[1]);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

export type GitFetchMode = "branch" | "pr" | "sha";

export interface GitFetchTarget {
  spec: string;
  localBranch: string;
  mode: GitFetchMode;
}

function localRefName(raw: string, fallback: string): string {
  const leaf = raw.split("/").filter(Boolean).pop() || fallback;
  const cleaned = leaf.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

/** Resolve a branch, SHA, or pull/MR number to the git refspec to fetch over HTTPS. */
export function gitFetchTarget(input: {
  url?: string;
  ref?: string;
  pull?: number;
  forge?: ForgeKind;
}): GitFetchTarget | undefined {
  const forge = input.forge ?? (input.url ? parseRepoUrl(input.url)?.forge : undefined) ?? "github";
  const pull =
    typeof input.pull === "number" && Number.isInteger(input.pull) && input.pull > 0
      ? input.pull
      : parsePullRef(input.ref);
  if (pull) {
    return { spec: pullHeadRefspec(forge, pull), localBranch: `pr-${pull}`, mode: "pr" };
  }
  const raw = input.ref?.trim();
  if (!raw) return undefined;
  const branch = raw.replace(/^refs\/heads\//, "").replace(/^origin\//, "");
  if (/^[0-9a-f]{7,40}$/i.test(branch)) {
    return { spec: branch, localBranch: "locus-head", mode: "sha" };
  }
  if (branch.startsWith("refs/")) {
    return { spec: branch, localBranch: localRefName(branch, "head"), mode: "pr" };
  }
  return { spec: branch, localBranch: branch, mode: "branch" };
}

/** GitHub App installation (`ghs_`) and user-to-server (`ghu_`) tokens. */
export function isGitHubAppAccessToken(token: string): boolean {
  return /^(ghs_|ghu_)/.test(token.trim());
}

/** HTTPS username git expects for a forge host or clone URL. */
export function gitHttpsAuthUser(hostOrUrl: string, token?: string, username?: string): string {
  let host = hostOrUrl.trim().toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(hostOrUrl.trim())) {
    try {
      host = new URL(hostOrUrl.trim()).hostname.toLowerCase();
    } catch {
      /* keep the raw value */
    }
  }
  if (host.includes("bitbucket")) return "x-token-auth";
  if (host.includes("gitlab")) return "oauth2";
  const raw = token?.trim();
  if (raw && !isGitHubAppAccessToken(raw)) {
    const named = username?.trim();
    return named || "git";
  }
  return "x-access-token";
}

/** Extra copy when GitHub 403s clone with "Write access to repository not granted". */
export function gitCloneAuthFailureHint(output: string): string | undefined {
  if (!/write access to repository not granted/i.test(output)) return undefined;
  return "GitHub rejected this token for git clone. A classic PAT needs the repo scope; a fine-grained PAT needs Contents on that repository (authorize SSO if the org requires it). GitHub App installation tokens need Contents read and write.";
}

export function gitCredentialToken(env: NodeJS.Dict<string> = process.env): string {
  return (
    env.GIT_TOKEN ||
    env.GITHUB_TOKEN ||
    env.GITLAB_TOKEN ||
    env.BITBUCKET_TOKEN ||
    ""
  ).trim();
}

/** `git credential fill` body for helper action `get`. Empty when there is no token. */
export function gitCredentialFill(stdin: string, env: NodeJS.Dict<string> = {}): string {
  const token = gitCredentialToken(env);
  if (!token) return "";
  let host = "";
  for (const line of stdin.split(/\r?\n/)) {
    const match = /^host=(.*)$/i.exec(line);
    if (match) host = match[1]!.trim();
  }
  return `username=${gitHttpsAuthUser(host || "https://github.com", token)}\npassword=${token}\n`;
}

/** POSIX helper installed in the guest so `git fetch` / `ls-remote` can use GIT_TOKEN. */
export const GIT_CREDENTIAL_HELPER_SCRIPT =
  [
    "#!/bin/sh",
    '[ "$1" = get ] || exit 0',
    "user=x-access-token",
    'while IFS= read -r line || [ -n "$line" ]; do',
    '  case "$line" in',
    "    host=*bitbucket*) user=x-token-auth ;;",
    "    host=*gitlab*) user=oauth2 ;;",
    '    "") break ;;',
    "  esac",
    "done",
    'token="${GIT_TOKEN:-${GITHUB_TOKEN:-${GITLAB_TOKEN:-${BITBUCKET_TOKEN:-}}}}"',
    '[ -n "$token" ] || exit 0',
    'if [ "$user" = x-access-token ]; then',
    '  case "$token" in',
    "    ghs_*|ghu_*) ;;",
    "    *) user=git ;;",
    "  esac",
    "fi",
    'printf \'username=%s\\npassword=%s\\n\' "$user" "$token"',
  ].join("\n") + "\n";

export function gitCredentialInstallCommand(): string {
  return [
    "set +e",
    "helper=/usr/local/bin/git-credential-locus",
    "mkdir -p /usr/local/bin 2>/dev/null || helper=/tmp/git-credential-locus",
    "cat > \"$helper\" << 'LOCUS_GIT_CREDENTIAL_EOF'",
    GIT_CREDENTIAL_HELPER_SCRIPT.trimEnd(),
    "LOCUS_GIT_CREDENTIAL_EOF",
    'chmod +x "$helper" 2>/dev/null',
    "if command -v git >/dev/null 2>&1; then",
    '  git config --system --replace-all credential.helper "$helper" 2>/dev/null || git config --global --replace-all credential.helper "$helper"',
    "fi",
    "if [ -d /etc/profile.d ]; then printf '%s\\n' 'export GIT_TERMINAL_PROMPT=0' > /etc/profile.d/locus-git.sh; fi",
    "true",
  ].join("\n");
}

export function parseRepoCheckout(raw: unknown): RepoCheckout | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const parsed = typeof value.url === "string" ? parseRepoUrl(value.url) : null;
  if (!parsed) return undefined;
  const forge = isForgeKind(value.forge) ? value.forge : parsed.forge;
  const ref = typeof value.ref === "string" && value.ref.trim() ? value.ref.trim() : undefined;
  const dest = typeof value.dest === "string" && value.dest.trim() ? value.dest.trim() : undefined;
  const accountId =
    typeof value.accountId === "string" && value.accountId.trim()
      ? value.accountId.trim()
      : undefined;
  return { forge, url: parsed.url, ref, dest, accountId };
}
