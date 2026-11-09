import { existsSync, readdirSync } from "node:fs";
import { win32 } from "node:path";

export interface WindowsCliSpawnOpts {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  listDirs?: (path: string) => string[];
}

export interface WindowsCliSpawnTarget {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
  envPatch?: Record<string, string>;
}

const PS1_EXT = /\.ps1$/i;
const JS_EXT = /\.js$/i;
const EXE_EXT = /\.(exe|com)$/i;
/** Cursor CLI version folders look like `2026.08.31-fd13201`. */
const VERSION_DIR_RE = /^(\d{4})\.(\d{1,2})\.(\d{1,2})-[A-Za-z0-9]+$/;

/**
 * Node 20.12+ / 22 refuse `spawn(file.cmd)` on Windows without a shell
 * (`spawn EINVAL`, CVE-2024-27980). Cursor's Windows install is a `.cmd`
 * wrapper around `versions/<ver>/node.exe` + `index.js`. Prefer that PE
 * entrypoint so long prompts do not also hit cmd.exe's ~8191 char cap.
 */
export function resolveWindowsCliSpawn(
  command: string,
  args: string[],
  opts: WindowsCliSpawnOpts = {},
): WindowsCliSpawnTarget {
  const platform = opts.platform ?? process.platform;
  if (platform !== "win32") return { command, args };
  const env = opts.env ?? {};
  const exists = opts.exists ?? existsSync;
  const listDirs = opts.listDirs ?? defaultListDirs;
  const resolved = resolveWin32CommandPath(command, env, exists) ?? command;
  const target = spawnTargetForResolved(resolved, args, env, exists, listDirs);
  return wrapHiddenConsoleSpawn(target, { platform, env, exists });
}

/** Hide the CLI process tree by giving it a headless console children can inherit. */
export function wrapHiddenConsoleSpawn(
  target: WindowsCliSpawnTarget,
  opts: Pick<WindowsCliSpawnOpts, "platform" | "env" | "exists"> = {},
): WindowsCliSpawnTarget {
  const platform = opts.platform ?? process.platform;
  if (platform !== "win32") return target;
  if (/(^|[\\/])conhost\.exe$/i.test(target.command)) return target;
  const env = opts.env ?? {};
  const exists = opts.exists ?? existsSync;
  const root = env.SystemRoot || env.windir || "C:\\Windows";
  const conhost = win32.join(root, "System32", "conhost.exe");
  if (!exists(conhost)) return target;
  return {
    command: conhost,
    args: ["--headless", target.command, ...target.args],
    windowsVerbatimArguments: false,
    envPatch: target.envPatch,
  };
}

export function quoteWindowsCmdArg(value: string): string {
  if (value.length === 0) return '""';
  return `"${value.replace(/%/g, "%%").replace(/"/g, '""')}"`;
}

export function cursorCliSpawnFailureMessage(err: unknown, command: string): string {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
  if (code === "ENOENT" || /ENOENT/i.test(message)) {
    return `Cursor CLI (${command}) is not on PATH. Install from cursor.com/install, or set the binary path on this provider.`;
  }
  if (code === "EINVAL" || /EINVAL/i.test(message)) {
    return `Cursor CLI (${command}) could not be started (spawn EINVAL). On Windows Node cannot spawn a .cmd wrapper directly — point CLI binary at %LOCALAPPDATA%\\cursor-agent\\cursor-agent.cmd and Locus will launch the real executable.`;
  }
  return message.trim() || "Cursor CLI failed";
}

function spawnTargetForResolved(
  resolved: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean,
  listDirs: (path: string) => string[],
): WindowsCliSpawnTarget {
  if (JS_EXT.test(resolved)) {
    const node = win32.join(win32.dirname(resolved), "node.exe");
    if (exists(node)) return { command: node, args: [resolved, ...args] };
  }
  const invokedAs = win32.basename(resolved) || "agent";
  const installDir = hasWinPathSep(resolved) ? win32.dirname(resolved) : "";
  if (installDir) {
    const unwrapped =
      cursorAgentLaunch(installDir, args, invokedAs, exists) ??
      latestVersionLaunch(installDir, args, invokedAs, exists, listDirs);
    if (unwrapped) return unwrapped;
  }
  if (PS1_EXT.test(resolved)) return wrapPowershell(resolved, args, env);
  if (EXE_EXT.test(resolved)) return { command: resolved, args };
  return wrapCmd(resolved, args, env);
}

function cursorAgentLaunch(
  dir: string,
  args: string[],
  invokedAs: string,
  exists: (path: string) => boolean,
): WindowsCliSpawnTarget | undefined {
  const node = win32.join(dir, "node.exe");
  const script = win32.join(dir, "index.js");
  if (exists(node) && exists(script)) {
    return {
      command: node,
      args: [script, ...args],
      envPatch: { CURSOR_INVOKED_AS: invokedAs },
    };
  }
  for (const name of ["cursor-agent.exe", "agent.exe"]) {
    const exe = win32.join(dir, name);
    if (exists(exe)) return { command: exe, args };
  }
  return undefined;
}

function latestVersionLaunch(
  installDir: string,
  args: string[],
  invokedAs: string,
  exists: (path: string) => boolean,
  listDirs: (path: string) => string[],
): WindowsCliSpawnTarget | undefined {
  const versions = win32.join(installDir, "versions");
  const candidates = listDirs(versions)
    .map((name) => ({ name, path: win32.join(versions, name) }))
    .filter((row) => cursorAgentLaunch(row.path, args, invokedAs, exists));
  if (!candidates.length) return undefined;
  candidates.sort((a, b) => {
    const rank = versionRank(b.name) - versionRank(a.name);
    if (rank) return rank;
    return b.name.localeCompare(a.name);
  });
  return cursorAgentLaunch(candidates[0]!.path, args, invokedAs, exists);
}

function versionRank(name: string): number {
  const match = name.match(VERSION_DIR_RE);
  if (!match) return 0;
  return Number(`${match[1]}${match[2]!.padStart(2, "0")}${match[3]!.padStart(2, "0")}`);
}

function wrapCmd(command: string, args: string[], env: NodeJS.ProcessEnv): WindowsCliSpawnTarget {
  const comspec = env.ComSpec?.trim() || env.COMSPEC?.trim() || "cmd.exe";
  const line = [quoteWindowsCmdArg(command), ...args.map(quoteWindowsCmdArg)].join(" ");
  return {
    command: comspec,
    args: ["/d", "/v:off", "/s", "/c", `"${line}"`],
    windowsVerbatimArguments: true,
  };
}

function wrapPowershell(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): WindowsCliSpawnTarget {
  const root = env.SystemRoot?.trim() || env.SYSTEMROOT?.trim() || "C:\\Windows";
  return {
    command: win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
  };
}

function resolveWin32CommandPath(
  command: string,
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean,
): string | undefined {
  if (hasWinPathSep(command)) {
    if (exists(command)) return command;
    if (!win32.extname(command)) {
      for (const ext of [".exe", ".cmd", ".bat", ".ps1"]) {
        const candidate = `${command}${ext}`;
        if (exists(candidate)) return candidate;
      }
    }
    return undefined;
  }
  const pathVar = env.PATH ?? env.Path ?? "";
  const exts = pathext(env);
  for (const dir of pathVar.split(";")) {
    if (!dir.trim()) continue;
    for (const name of commandNames(command, exts)) {
      const candidate = win32.join(dir, name);
      if (exists(candidate)) return candidate;
    }
  }
  return undefined;
}

function commandNames(command: string, exts: string[]): string[] {
  if (win32.extname(command)) return [command];
  const names = [command];
  for (const ext of exts) {
    const suffix = ext.startsWith(".") ? ext : `.${ext}`;
    names.push(command + suffix);
    const lower = command + suffix.toLowerCase();
    if (!names.includes(lower)) names.push(lower);
  }
  return names;
}

function pathext(env: NodeJS.ProcessEnv): string[] {
  return (env.PATHEXT ?? ".EXE;.CMD;.BAT")
    .split(";")
    .map((ext) => ext.trim())
    .filter(Boolean);
}

function hasWinPathSep(command: string): boolean {
  return /[\\/]/.test(command) || /^[A-Za-z]:/.test(command);
}

function defaultListDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
