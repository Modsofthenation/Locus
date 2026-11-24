import {
  forgeGitHost,
  gitFetchTarget,
  gitHttpsAuthUser,
  isForgeKind,
  parseRepoUrl,
  remoteUrlForToken,
  type ForgeKind,
} from "@locus/shared";

export function gitAuthHeader(url: string, token?: string): string | undefined {
  if (!token) return undefined;
  const user = gitHttpsAuthUser(url, token);
  return `AUTHORIZATION: Basic ${Buffer.from(`${user}:${token}`).toString("base64")}`;
}

export function authenticatedCloneUrl(url: string, token?: string): string {
  if (!token) return url;
  const remote = remoteUrlForToken(url, token);
  try {
    const parsed = new URL(remote);
    parsed.username = gitHttpsAuthUser(remote, token);
    parsed.password = token;
    return parsed.toString();
  } catch {
    return remote;
  }
}

export function argPull(args: Record<string, unknown>): number | undefined {
  const value = args.pull ?? args.pull_number;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function argForge(args: Record<string, unknown>, url?: string): ForgeKind | undefined {
  const raw = typeof args.forge === "string" ? args.forge : "";
  if (isForgeKind(raw)) return raw;
  return url ? parseRepoUrl(url)?.forge : undefined;
}

function posix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function powershell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quote(value: string, windows: boolean): string {
  return windows ? powershell(value) : posix(value);
}

/**
 * Global/system config keys a Locus-token git command keeps. Everything else (credential
 * helpers, `url.*.insteadOf`, `http.*.extraHeader`) is dropped so the Locus token is the only
 * git auth, while corporate proxies, CA bundles, `safe.directory`, SSH commands and LFS
 * filters still apply.
 */
export const GIT_ISOLATED_CONFIG_KEEP =
  "^(http\\..*|core\\.(sshcommand|autocrlf|eol|longpaths|fsmonitor)|safe\\.directory|filter\\..*|lfs\\..*|user\\..*|protocol\\..*)$";

/**
 * Environment set up before git runs. Always: no terminal prompts and SSH in batch mode
 * (unless the operator configured their own SSH command), so a missing key or passphrase
 * fails fast instead of hanging. With a Locus token: a filtered copy of the operator's
 * global/system config replaces it for these commands.
 */
export function gitEnvPrelude(windows: boolean, isolate: boolean, repo?: string): string {
  const at = repo ? `-C ${quote(repo, windows)} ` : "";
  if (windows) {
    const parts: string[] = [];
    if (isolate) {
      parts.push(
        "$locusGitCfg = [IO.Path]::GetTempFileName()",
        `foreach ($s in '--system','--global') { git config $s --includes --get-regexp ${powershell(GIT_ISOLATED_CONFIG_KEEP)} 2>$null | ForEach-Object { $kv = $_ -split ' ', 2; if ($kv[0] -notmatch 'extraheader$') { $v = if ($kv.Count -gt 1) { $kv[1] } else { 'true' }; git config --file $locusGitCfg --add $kv[0] $v } } }`,
      );
    }
    parts.push(
      `if (-not $env:GIT_SSH_COMMAND -and -not $env:GIT_SSH -and -not (git ${at}config --get core.sshCommand 2>$null)) { $env:GIT_SSH_COMMAND='ssh -o BatchMode=yes' }`,
      "$env:GIT_TERMINAL_PROMPT='0'",
      "$env:GIT_PROGRESS_DELAY='0'",
    );
    if (isolate) {
      parts.push(
        "$env:GIT_CONFIG_NOSYSTEM='1'",
        "$env:GIT_CONFIG_GLOBAL=$locusGitCfg",
        "$env:GCM_INTERACTIVE='Never'",
      );
    }
    return `${parts.join("; ")}; `;
  }
  const parts: string[] = [];
  if (isolate) {
    parts.push(
      'locus_git_cfg=$(mktemp 2>/dev/null || echo "${TMPDIR:-/tmp}/locus-gitcfg-$$")',
      ': > "$locus_git_cfg"',
      "trap 'rm -f \"$locus_git_cfg\"' EXIT",
      `for s in --system --global; do git config $s --includes --get-regexp ${posix(GIT_ISOLATED_CONFIG_KEEP)} 2>/dev/null; done | while IFS=' ' read -r k v; do case "$k" in *extraheader) ;; *) git config --file "$locus_git_cfg" --add "$k" "\${v:-true}" ;; esac; done`,
    );
  }
  parts.push(
    `if [ -z "\${GIT_SSH_COMMAND:-}" ] && [ -z "\${GIT_SSH:-}" ] && [ -z "$(git ${at}config --get core.sshCommand 2>/dev/null)" ]; then export GIT_SSH_COMMAND='ssh -o BatchMode=yes'; fi`,
    "export GIT_TERMINAL_PROMPT=0 GIT_PROGRESS_DELAY=0",
  );
  if (isolate) {
    parts.push(
      'export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL="$locus_git_cfg" GCM_INTERACTIVE=Never',
    );
  }
  return `${parts.join("; ")}; `;
}

/** Wrap a command with the git environment prelude (and temp-config cleanup on Windows). */
function withGitEnv(body: string, windows: boolean, isolate: boolean, repo?: string): string {
  const prelude = gitEnvPrelude(windows, isolate, repo);
  if (!windows) return `${prelude}${body}`;
  if (!isolate) return `${prelude}${body}`;
  return `try { ${prelude}${body} } finally { if ($locusGitCfg) { Remove-Item -Force $locusGitCfg -ErrorAction SilentlyContinue } }`;
}

function authPrefix(
  url: string | undefined,
  token: string | undefined,
  windows: boolean,
  forge?: ForgeKind,
): string {
  if (!token) return "";
  // Read the token from the guest/process env (`GIT_TOKEN`), never argv/`ps`.
  // Clear inherited helpers so they cannot send a second Authorization header.
  // Without a remote URL, the forge kind picks the username (Bitbucket x-token-auth,
  // GitLab oauth2) instead of assuming GitHub.
  const user = gitHttpsAuthUser(url || forgeGitHost(forge), token);
  const helper = `!f() { echo username=${user}; echo password=$GIT_TOKEN; }; f`;
  const extra = windows
    ? `-c credential.helper= -c credential.helper=${powershell(helper)} `
    : `-c credential.helper= -c credential.helper=${posix(helper)} `;
  return extra;
}

function joinSteps(steps: string[], windows: boolean): string {
  return steps.join(windows ? "; " : " && ");
}

/** Reuse dest when it already has a commit so resume does not `git clone` into a full tree. */
function cloneOrReuse(dest: string, body: string, windows: boolean): string {
  const destQ = quote(dest, windows);
  const note = quote(`already cloned at ${dest}`, windows);
  if (windows) {
    return `if (git -C ${destQ} rev-parse --verify HEAD 2>$null) { Write-Output ${note} } else { ${body} }`;
  }
  return `if git -C ${destQ} rev-parse --verify HEAD >/dev/null 2>&1; then echo ${note}; else ${body}; fi`;
}

function fetchSpecArg(spec: string, localBranch: string): string {
  return `+${spec}:refs/heads/${localBranch}`;
}

type CloneOpts = {
  url: string;
  dest: string;
  ref?: string;
  pull?: number;
  token?: string;
  forge?: ForgeKind;
  windows: boolean;
};

export function gitCloneCommand(opts: CloneOpts): string {
  return withGitEnv(cloneBody(opts), opts.windows, Boolean(opts.token));
}

function cloneBody(opts: CloneOpts): string {
  const remote = remoteUrlForToken(opts.url, opts.token);
  const auth = authPrefix(remote, opts.token, opts.windows, opts.forge);
  const env = "";
  const dest = quote(opts.dest, opts.windows);
  const url = quote(remote, opts.windows);
  const branchTarget = opts.ref?.trim()
    ? gitFetchTarget({ url: remote, ref: opts.ref, forge: opts.forge })
    : undefined;
  const prTarget =
    typeof opts.pull === "number" && opts.pull > 0
      ? gitFetchTarget({ url: remote, pull: opts.pull, forge: opts.forge })
      : undefined;
  const mkdir = opts.windows
    ? `New-Item -ItemType Directory -Force -Path ${dest}`
    : `mkdir -p ${dest}`;

  if (!branchTarget && !prTarget) {
    return cloneOrReuse(
      opts.dest,
      `${mkdir}${opts.windows ? "; " : " && "}${env}git ${auth}clone --progress --depth 1 ${url} ${dest}`,
      opts.windows,
    );
  }

  // Named branch plus PR number: try origin/<branch>, then the forge PR head (forks).
  if (branchTarget?.mode === "branch" && prTarget) {
    const branch = quote(branchTarget.localBranch, opts.windows);
    const fetchBranch = `${env}git -C ${dest} ${auth}fetch --progress --depth 1 origin ${quote(branchTarget.spec, opts.windows)}`;
    const fetchPr = `${env}git -C ${dest} ${auth}fetch --progress --depth 1 origin ${quote(prTarget.spec, opts.windows)}`;
    const fetch = opts.windows
      ? `${fetchBranch}; if (-not $?) { ${fetchPr} }`
      : `(${fetchBranch} || ${fetchPr})`;
    return cloneOrReuse(
      opts.dest,
      joinSteps(
        [
          mkdir,
          `git init -b ${branch} ${dest}`,
          `git -C ${dest} remote add origin ${url}`,
          fetch,
          `git -C ${dest} checkout -B ${branch} FETCH_HEAD`,
        ],
        opts.windows,
      ),
      opts.windows,
    );
  }

  const target = prTarget ?? branchTarget!;
  if (target.mode === "branch") {
    return cloneOrReuse(
      opts.dest,
      `${mkdir}${opts.windows ? "; " : " && "}${env}git ${auth}clone --progress --depth 1 --branch ${quote(target.spec, opts.windows)} ${url} ${dest}`,
      opts.windows,
    );
  }
  const spec = quote(fetchSpecArg(target.spec, target.localBranch), opts.windows);
  const branch = quote(target.localBranch, opts.windows);
  return cloneOrReuse(
    opts.dest,
    joinSteps(
      [
        mkdir,
        `git init ${dest}`,
        `git -C ${dest} remote add origin ${url}`,
        `${env}git -C ${dest} ${auth}fetch --progress --depth 1 origin ${spec}`,
        `git -C ${dest} checkout ${branch}`,
      ],
      opts.windows,
    ),
    opts.windows,
  );
}

type FetchOpts = {
  path: string;
  url?: string;
  ref?: string;
  pull?: number;
  token?: string;
  forge?: ForgeKind;
  windows: boolean;
};

/**
 * The remote argument for fetch/push. With a token and a known HTTPS URL, git talks to that
 * URL directly so `origin` is never rewritten (an operator's SSH origin stays as they set it,
 * and a `www.` or stale-credential origin does not leak into auth). Otherwise `origin`.
 */
function remoteArg(url: string | undefined, token: string | undefined, windows: boolean) {
  const remote = url ? remoteUrlForToken(url, token) : undefined;
  const direct = Boolean(token && remote && /^(?:https?|file):\/\//i.test(remote));
  return { remote, direct, arg: direct ? quote(remote!, windows) : "origin" };
}

/**
 * Fetch into an existing checkout. Never shallows a full clone, and never re-grafts a shallow
 * one: `--depth=1` is only used in an already-shallow checkout for a ref it has never fetched. A branch is fetched
 * into `refs/remotes/origin/<branch>` and then integrated: the current branch fast-forwards,
 * another existing local branch is checked out and fast-forwarded, a new one is created to
 * track it. A diverged local branch is left alone and reported (`LOCUS_DIVERGED`).
 */
export function gitFetchCommand(opts: FetchOpts): string {
  const w = opts.windows;
  const { remote, direct, arg } = remoteArg(opts.url, opts.token, w);
  const auth = authPrefix(remote || opts.url, opts.token, w, opts.forge);
  const path = quote(opts.path, w);
  const git = `git -C ${path}`;
  const depthArg = w ? "@locusDepth" : "$locus_depth";
  const target = gitFetchTarget({
    url: remote ?? opts.url,
    ref: opts.ref,
    pull: opts.pull,
    forge: opts.forge,
  });
  const track = !target
    ? undefined
    : target.mode === "branch"
      ? `refs/remotes/origin/${target.spec}`
      : target.mode === "pr"
        ? `refs/locus/fetch/${target.localBranch}`
        : undefined;
  // In a shallow checkout a plain fetch only brings commits missing on top of what is
  // there, and stays shallow; `--depth=1` would re-graft the new tip with no parent so the
  // branch looks diverged. Use it only for a ref the checkout has never seen. A full
  // clone never gets --depth (that would make it shallow).
  const known = track
    ? w
      ? `(${git} rev-parse --verify --quiet ${quote(track, w)} 2>$null)`
      : `${git} rev-parse --verify --quiet ${quote(track, w)} >/dev/null 2>&1`
    : undefined;
  const depth = w
    ? `$locusDepth = @(); if ((${git} rev-parse --is-shallow-repository 2>$null) -eq 'true'${known ? ` -and -not ${known}` : ""}) { $locusDepth = @('--depth=1') }; `
    : `locus_depth=; if [ "$(${git} rev-parse --is-shallow-repository 2>/dev/null)" = true ]${known ? ` && ! ${known}` : ""}; then locus_depth=--depth=1; fi; `;
  let body: string;
  if (!target) {
    // No ref: a plain fetch of every branch. Never pass --depth here.
    const spec = direct ? ` ${quote("+refs/heads/*:refs/remotes/origin/*", w)}` : "";
    body = `${git} ${auth}fetch --progress ${arg}${spec}`;
  } else if (target.mode === "sha") {
    const sha = quote(target.spec, w);
    const branch = quote(target.localBranch, w);
    body = w
      ? `${depth}${git} ${auth}fetch --progress ${depthArg} ${arg} ${sha}; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; ${git} checkout -B ${branch} FETCH_HEAD`
      : `${depth}${git} ${auth}fetch --progress ${depthArg} ${arg} ${sha} && ${git} checkout -B ${branch} FETCH_HEAD`;
  } else {
    const local = target.localBranch;
    const spec = quote(`+${target.spec}:${track!}`, w);
    const fetch = `${git} ${auth}fetch --progress ${depthArg} ${arg} ${spec}`;
    const integrate = integrateFetched({
      git,
      local,
      track: track!,
      upstream: target.mode === "branch" ? `origin/${target.spec}` : undefined,
      windows: w,
    });
    body = w
      ? `${depth}${fetch}; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; ${integrate}`
      : `${depth}${fetch} && ${integrate}`;
  }
  return withGitEnv(body, w, Boolean(opts.token), opts.path);
}

function integrateFetched(opts: {
  git: string;
  local: string;
  track: string;
  upstream?: string;
  windows: boolean;
}): string {
  const { git, windows: w } = opts;
  const local = quote(opts.local, w);
  const track = quote(opts.track, w);
  const head = quote(`refs/heads/${opts.local}`, w);
  const range = quote(`HEAD...${opts.track}`, w);
  const label = opts.upstream ?? opts.track;
  const divergedPrefix = `LOCUS_DIVERGED: fetched ${label} but local ${opts.local} has diverged (ahead/behind: `;
  const divergedSuffix = `); nothing was merged. Rebase or merge ${label}.`;
  if (w) {
    const upstream = opts.upstream
      ? `${git} branch ${quote(`--set-upstream-to=${opts.upstream}`, w)} ${local} 2>$null | Out-Null; `
      : "";
    return [
      `$locusCur = ${git} symbolic-ref --quiet --short HEAD 2>$null`,
      `if ($locusCur -ne ${local}) { ${git} show-ref --verify --quiet ${head}; if ($LASTEXITCODE -eq 0) { ${git} checkout ${local}; if ($LASTEXITCODE -ne 0) { exit 1 } } else { ${git} checkout -b ${local} ${track}; if ($LASTEXITCODE -ne 0) { exit 1 }; ${upstream}Write-Output ${quote(`Created ${opts.local} from ${label}`, w)}; exit 0 } }`,
      `${git} merge-base --is-ancestor ${track} HEAD; if ($LASTEXITCODE -eq 0) { Write-Output ${quote(`${opts.local} is up to date with ${label}`, w)}; exit 0 }`,
      `${git} merge-base --is-ancestor HEAD ${track}; if ($LASTEXITCODE -eq 0) { ${git} merge --ff-only ${track}; exit $LASTEXITCODE }`,
      `$locusCounts = ${git} rev-list --left-right --count ${range}`,
      `Write-Error (${quote(divergedPrefix, w)} + $locusCounts + ${quote(divergedSuffix, w)})`,
      "exit 1",
    ].join("; ");
  }
  const upstream = opts.upstream
    ? `{ ${git} branch ${quote(`--set-upstream-to=${opts.upstream}`, w)} ${local} >/dev/null 2>&1 || true; } && `
    : "";
  return [
    `locus_cur=$(${git} symbolic-ref --quiet --short HEAD 2>/dev/null || true)`,
    `if [ "$locus_cur" != ${local} ]; then if ${git} show-ref --verify --quiet ${head}; then ${git} checkout ${local} || exit 1; else ${git} checkout -b ${local} ${track} || exit 1; ${upstream}echo ${quote(`Created ${opts.local} from ${label}`, w)}; exit 0; fi; fi`,
    `if ${git} merge-base --is-ancestor ${track} HEAD; then echo ${quote(`${opts.local} is up to date with ${label}`, w)}; elif ${git} merge-base --is-ancestor HEAD ${track}; then ${git} merge --ff-only ${track}; else { printf '%s' ${quote(divergedPrefix, w)}; ${git} rev-list --left-right --count ${range} | tr '\\t' '/' | tr -d '\\n'; printf '%s\\n' ${quote(divergedSuffix, w)}; } >&2; exit 1; fi`,
  ].join("; ");
}

/**
 * Push the current branch. Refuses detached HEAD and protected branches. With a token and a
 * known URL, pushes to that URL (origin is not rewritten) and records the remote-tracking
 * ref and upstream itself; otherwise `push -u origin HEAD`.
 */
export function gitPushCommand(opts: {
  path: string;
  token?: string;
  windows: boolean;
  url?: string;
  forge?: ForgeKind;
}): string {
  const w = opts.windows;
  const { remote, direct, arg } = remoteArg(opts.url, opts.token, w);
  const auth = authPrefix(remote || opts.url, opts.token, w, opts.forge);
  const path = quote(opts.path, w);
  const git = `git -C ${path}`;
  const detached =
    "LOCUS_DETACHED_HEAD: HEAD is not on a branch. Create one with git_branch before git_push.";
  if (w) {
    const guard = `$b = ${git} symbolic-ref --quiet --short HEAD 2>$null; if (-not $b) { Write-Error ${quote(detached, w)}; exit 1 }; if ($b -match '^(main|master|trunk)$') { Write-Error "Refusing git_push to protected branch $b"; exit 1 }; `;
    const push = direct
      ? `${git} ${auth}push ${arg} "HEAD:refs/heads/$b"; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; ${git} update-ref "refs/remotes/origin/$b" HEAD; ${git} branch "--set-upstream-to=origin/$b" $b 2>$null | Out-Null`
      : `${git} ${auth}push -u origin HEAD`;
    return withGitEnv(`${guard}${push}`, w, Boolean(opts.token), opts.path);
  }
  const guard = `b=$(${git} symbolic-ref --quiet --short HEAD 2>/dev/null) || { echo ${quote(detached, w)} >&2; exit 1; }; case "$b" in main|master|trunk) echo "Refusing git_push to protected branch $b" >&2; exit 1;; esac; `;
  const push = direct
    ? `${git} ${auth}push ${arg} "HEAD:refs/heads/$b" && ${git} update-ref "refs/remotes/origin/$b" HEAD && { ${git} branch "--set-upstream-to=origin/$b" "$b" >/dev/null 2>&1 || true; }`
    : `${git} ${auth}push -u origin HEAD`;
  return withGitEnv(`${guard}${push}`, w, Boolean(opts.token), opts.path);
}

/**
 * Switch to a branch, creating it when missing. Never resets an existing branch (the old
 * `checkout -B` dropped its commits). `from` only applies when the branch is created.
 */
export function gitBranchCommand(opts: {
  path: string;
  name: string;
  from?: string;
  windows: boolean;
}): string {
  const w = opts.windows;
  const git = `git -C ${quote(opts.path, w)}`;
  const name = quote(opts.name, w);
  const head = quote(`refs/heads/${opts.name}`, w);
  const from = opts.from?.trim() ? ` ${quote(opts.from.trim(), w)}` : "";
  const note = opts.from?.trim()
    ? quote(
        `Branch ${opts.name} already exists; switched to it without resetting it to ${opts.from.trim()}.`,
        w,
      )
    : "";
  if (w) {
    return `${git} show-ref --verify --quiet ${head}; if ($LASTEXITCODE -eq 0) { ${git} checkout ${name}${note ? `; if ($LASTEXITCODE -eq 0) { Write-Output ${note} }` : ""} } else { ${git} checkout -b ${name}${from} }`;
  }
  return `if ${git} show-ref --verify --quiet ${head}; then ${git} checkout ${name}${note ? ` && echo ${note}` : ""}; else ${git} checkout -b ${name}${from}; fi`;
}
