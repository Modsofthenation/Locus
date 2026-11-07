import { existsSync } from "node:fs";
import { looksLikeSecretName, stripAppImageMountsFromPath } from "@locus/shared";

const UNIX_PATH_DIRS = [
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
  "/usr/local/bin",
  "/opt/homebrew/bin",
];

/** Absolute `sh` candidates. Relative `sh` fails with `spawn sh ENOENT` when PATH is empty. */
export function posixShellCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const override = env.LOCUS_SHELL?.trim();
  if (platform === "win32") {
    const gitRoot = env.GIT_INSTALL_ROOT?.trim();
    const programFiles = env.ProgramFiles?.trim() || "C:\\Program Files";
    const local = env.LOCALAPPDATA?.trim();
    const fromPath = pathDirs(env, ";").flatMap((dir) => [
      joinPath("win32", dir, "sh.exe"),
      joinPath("win32", dir, "bash.exe"),
      joinPath("win32", dir, "sh"),
    ]);
    return unique([
      override,
      gitRoot ? joinPath("win32", gitRoot, "bin", "sh.exe") : "",
      gitRoot ? joinPath("win32", gitRoot, "usr", "bin", "sh.exe") : "",
      joinPath("win32", programFiles, "Git", "bin", "sh.exe"),
      joinPath("win32", programFiles, "Git", "usr", "bin", "sh.exe"),
      local ? joinPath("win32", local, "Programs", "Git", "bin", "sh.exe") : "",
      local ? joinPath("win32", local, "Programs", "Git", "usr", "bin", "sh.exe") : "",
      ...fromPath,
    ]);
  }
  return unique([override, "/bin/sh", "/bin/bash", "/usr/bin/sh", "/usr/bin/bash"]);
}

export function posixShellPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): string {
  for (const path of posixShellCandidates(platform, env)) {
    if (exists(path)) return path;
  }
  return platform === "win32" ? "sh.exe" : "/bin/sh";
}

const GIT_HOST_TOOLS = new Set(["git_clone", "git_fetch", "git_push"]);

/** Overlay the Locus forge token so Windows GCM/`gh` cannot send a leftover `GITHUB_TOKEN`. */
export function hostGitAuthEnv(req: {
  name: string;
  args: Record<string, unknown>;
}): NodeJS.ProcessEnv | undefined {
  if (!GIT_HOST_TOOLS.has(req.name)) return undefined;
  const token = typeof req.args.token === "string" ? req.args.token.trim() : "";
  const env: NodeJS.ProcessEnv = {
    GCM_INTERACTIVE: "Never",
    GIT_TERMINAL_PROMPT: "0",
  };
  if (token) {
    env.GIT_TOKEN = token;
    env.GITHUB_TOKEN = token;
    env.GH_TOKEN = token;
  }
  return env;
}

/** Keep host `ls`/`git` findable when Electron/AppImage launched with an empty PATH. */
export function hostExecEnv(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  shellPath?: string,
): NodeJS.ProcessEnv {
  const sep = platform === "win32" ? ";" : ":";
  const extras = platform === "win32" ? windowsGitBins(env, shellPath) : UNIX_PATH_DIRS;
  const current = (env.PATH ?? env.Path ?? "").split(sep).filter(Boolean);
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const dir of [...current, ...extras]) {
    const key = platform === "win32" ? dir.toLowerCase() : dir;
    if (!dir || seen.has(key)) continue;
    seen.add(key);
    dirs.push(dir);
  }
  const path = stripAppImageMountsFromPath(dirs.join(sep), sep, env.APPDIR);
  const next: NodeJS.ProcessEnv = { ...env, PATH: path };
  for (const key of Object.keys(next)) {
    if (key === "LOCUS_SHELL" || key === "SSH_AUTH_SOCK" || key === "SSH_AGENT_PID") continue;
    if (/^LOCUS_/.test(key) || looksLikeSecretName(key)) delete next[key];
  }
  return next;
}

export function hostSpawnErrorOutput(err: unknown, command: string, cwd: string): string {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
  const message = err instanceof Error ? err.message : String(err);
  if (code === "ENOENT" || /ENOENT/i.test(message)) {
    return `Could not start a POSIX shell (${command}) in ${cwd}. Host exec needs /bin/sh, or Git for Windows on Windows.`;
  }
  return message.trim() || "host exec failed";
}

function windowsGitBins(env: NodeJS.ProcessEnv, shellPath?: string): string[] {
  const dirs: string[] = [];
  const addRoot = (root: string) => {
    if (!root) return;
    dirs.push(
      joinPath("win32", root, "bin"),
      joinPath("win32", root, "usr", "bin"),
      joinPath("win32", root, "mingw64", "bin"),
      joinPath("win32", root, "cmd"),
    );
  };
  if (shellPath && /[\\/]/.test(shellPath)) {
    const dir = dirnamePath("win32", shellPath);
    dirs.push(dir);
    addRoot(dirnamePath("win32", dir));
  }
  const gitRoot = env.GIT_INSTALL_ROOT?.trim();
  if (gitRoot) addRoot(gitRoot);
  addRoot(joinPath("win32", env.ProgramFiles?.trim() || "C:\\Program Files", "Git"));
  const local = env.LOCALAPPDATA?.trim();
  if (local) addRoot(joinPath("win32", local, "Programs", "Git"));
  return unique(dirs);
}

function joinPath(platform: string, ...parts: string[]): string {
  const sep = platform === "win32" ? "\\" : "/";
  return parts
    .map((part, i) => {
      const normalized = part.replace(/[\\/]+/g, sep);
      if (i === 0) return stripTrailingSep(normalized);
      return stripTrailingSep(normalized.replace(/^[\\/]+/, ""));
    })
    .filter(Boolean)
    .join(sep);
}

function dirnamePath(platform: string, path: string): string {
  const sep = platform === "win32" ? "\\" : "/";
  const normalized = stripTrailingSep(path.replace(/[\\/]+/g, sep));
  const idx = normalized.lastIndexOf(sep);
  if (idx <= 0) return normalized;
  return normalized.slice(0, idx);
}

function stripTrailingSep(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

function pathDirs(env: NodeJS.ProcessEnv, sep: string): string[] {
  return (env.PATH ?? env.Path ?? "").split(sep).filter(Boolean);
}

function unique(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const item = value?.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}
