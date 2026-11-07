import {
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

function gitNullConfig(windows: boolean): string {
  return windows ? "NUL" : "/dev/null";
}

function authPrefix(url: string, token: string | undefined, windows: boolean): string {
  if (!token) return "";
  // Read the token from the guest/process env (`GIT_TOKEN`), never argv/`ps`.
  // Clear inherited helpers so they cannot send a second Authorization header.
  const user = gitHttpsAuthUser(url, token);
  const helper = `!f() { echo username=${user}; echo password=$GIT_TOKEN; }; f`;
  const extra = windows
    ? `-c credential.helper= -c credential.helper=${powershell(helper)} `
    : `-c credential.helper= -c credential.helper=${posix(helper)} `;
  return extra;
}

function promptEnv(windows: boolean, isolate = false): string {
  const parts = windows
    ? ["$env:GIT_TERMINAL_PROMPT='0'", "$env:GIT_PROGRESS_DELAY='0'"]
    : ["GIT_TERMINAL_PROMPT=0", "GIT_PROGRESS_DELAY=0"];
  if (isolate) {
    // Ignore host url.insteadOf / credential.https://github.com.helper so the
    // Locus token is the only git auth (Open in IDE clones on the host).
    const empty = gitNullConfig(windows);
    if (windows) {
      parts.push(
        "$env:GIT_CONFIG_NOSYSTEM='1'",
        `$env:GIT_CONFIG_GLOBAL=${powershell(empty)}`,
        "$env:GCM_INTERACTIVE='Never'",
      );
    } else {
      parts.push(
        "GIT_CONFIG_NOSYSTEM=1",
        `GIT_CONFIG_GLOBAL=${posix(empty)}`,
        "GCM_INTERACTIVE=Never",
      );
    }
  }
  return windows ? `${parts.join("; ")}; ` : `${parts.join(" ")} `;
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

export function gitCloneCommand(opts: {
  url: string;
  dest: string;
  ref?: string;
  pull?: number;
  token?: string;
  forge?: ForgeKind;
  windows: boolean;
}): string {
  const remote = remoteUrlForToken(opts.url, opts.token);
  const auth = authPrefix(remote, opts.token, opts.windows);
  const env = promptEnv(opts.windows, Boolean(opts.token));
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

export function gitFetchCommand(opts: {
  path: string;
  url?: string;
  ref?: string;
  pull?: number;
  token?: string;
  forge?: ForgeKind;
  windows: boolean;
}): string {
  const remote = opts.url ? remoteUrlForToken(opts.url, opts.token) : undefined;
  const auth = authPrefix(
    remote || opts.url || "https://github.com/x/x.git",
    opts.token,
    opts.windows,
  );
  const env = promptEnv(opts.windows, Boolean(opts.token));
  const path = quote(opts.path, opts.windows);
  const setUrl =
    remote && opts.token
      ? `git -C ${path} remote set-url origin ${quote(remote, opts.windows)}${opts.windows ? "; " : " && "}`
      : "";
  const target = gitFetchTarget({
    url: remote ?? opts.url,
    ref: opts.ref,
    pull: opts.pull,
    forge: opts.forge,
  });
  if (!target) {
    return `${setUrl}${env}git -C ${path} ${auth}fetch --progress origin`;
  }
  if (target.mode === "branch") {
    const spec = quote(target.spec, opts.windows);
    return joinSteps(
      [
        `${setUrl}${env}git -C ${path} ${auth}fetch --progress --depth 1 origin ${spec}`,
        `git -C ${path} checkout ${spec}`,
      ],
      opts.windows,
    );
  }
  const spec = quote(fetchSpecArg(target.spec, target.localBranch), opts.windows);
  const branch = quote(target.localBranch, opts.windows);
  return joinSteps(
    [
      `${setUrl}${env}git -C ${path} ${auth}fetch --progress --depth 1 origin ${spec}`,
      `git -C ${path} checkout ${branch}`,
    ],
    opts.windows,
  );
}

export function gitPushCommand(opts: {
  path: string;
  token?: string;
  windows: boolean;
  url?: string;
}): string {
  const remote = opts.url ? remoteUrlForToken(opts.url, opts.token) : undefined;
  const auth = authPrefix(
    remote || opts.url || "https://github.com/x/x.git",
    opts.token,
    opts.windows,
  );
  const env = promptEnv(opts.windows, Boolean(opts.token));
  const path = quote(opts.path, opts.windows);
  const setUrl =
    remote && opts.token
      ? `git -C ${path} remote set-url origin ${quote(remote, opts.windows)}${opts.windows ? "; " : " && "}`
      : "";
  const guard = opts.windows
    ? `$b = git -C ${path} rev-parse --abbrev-ref HEAD; if ($b -match '^(main|master|trunk)$') { Write-Error "Refusing git_push to protected branch $b"; exit 1 }; `
    : `b=$(git -C ${path} rev-parse --abbrev-ref HEAD) && case "$b" in main|master|trunk) echo "Refusing git_push to protected branch $b" >&2; exit 1;; esac && `;
  return `${setUrl}${guard}${env}git -C ${path} ${auth}push -u origin HEAD`;
}
