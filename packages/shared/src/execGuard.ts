import { isSensitivePath } from "./security.js";

export function execCommandsFromArgs(args: Record<string, unknown>): string[] {
  const commands: string[] = [];
  if (typeof args.command === "string" && args.command.trim()) commands.push(args.command);
  if (Array.isArray(args.commands)) {
    for (const item of args.commands) {
      if (typeof item === "string" && item.trim()) commands.push(item);
    }
  }
  return commands;
}

export function commandLooksLikeForcePush(command: string): boolean {
  const text = command.replace(/\s+/g, " ");
  if (!/\bgit\b/i.test(text) || !/\bpush\b/i.test(text)) return false;
  if (/(?:^|\s)(?:--force|--force-with-lease|-f)(?:\s|$)/.test(text)) return true;
  return /(?:^|\s)\+[^\s]+/.test(text);
}

export function commandLooksLikeDangerousRm(command: string): boolean {
  const match = command.match(/\brm\b([^;&|]*)/i);
  const rest = match?.[1];
  if (rest === undefined) return false;
  const flags = rest
    .trim()
    .split(/\s+/)
    .filter((token) => token.startsWith("-"));
  if (!flags.length) return false;
  const short = flags.filter((token) => token.startsWith("-") && !token.startsWith("--")).join("");
  const long = new Set(flags.filter((token) => token.startsWith("--")));
  const recursive = /[rR]/.test(short) || long.has("--recursive");
  const force = short.includes("f") || long.has("--force");
  return recursive && force;
}

/** Agent scratch trees the model is allowed to wipe without a recursive-delete wall. */
export function recursiveRmTargetAllowed(command: string): boolean {
  const match = command.match(/\brm\b(?:\s+-[a-zA-Z-]+)*\s+(\S+)/i);
  const raw = match?.[1]?.replace(/^['"]|['"]$/g, "") ?? "";
  if (!raw) return false;
  const target = raw.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!target || target === "/" || target === "/workspace" || target === ".") return false;
  if (target === "/tmp" || target.startsWith("/tmp/")) return true;
  if (target === "/workspace/repro" || target.startsWith("/workspace/repro/")) return true;
  if (target === "/workspace/.locus-scratch" || target.startsWith("/workspace/.locus-scratch/"))
    return true;
  return false;
}

export function commandTouchesSensitivePath(command: string): boolean {
  const tokens = command.split(/[\s"'`]+/).filter(Boolean);
  return tokens.some(
    (token) => isSensitivePath(token) || isSensitivePath(token.replace(/^[,;]+/, "")),
  );
}

export function commandLooksLikeProtectedBranchPush(command: string): boolean {
  if (!/\bgit\b/i.test(command) || !/\bpush\b/i.test(command)) return false;
  const text = command.replace(/\s+/g, " ").replace(/refs\/heads\//gi, "");
  return /(?:^|[\s/:+])(main|master|trunk)(?:\s|$)/i.test(text);
}

const APPIMAGE_MOUNT_DIR = /\/tmp\/\.mount_[Ll]ocus/;
const APPIMAGE_MOUNT_BIN =
  /(?:^|[\s;|&]|\(|`|\$\()(?:env\s+(?:\S+=\S+\s+)*)?(?:["']?)\/tmp\/\.mount_[Ll]ocus[^/\s]*\/(?:locus|AppRun)(?:\.exe)?(?:["']?)(?:\s|$)/;
const LOCUS_APPIMAGE = /(?:^|[\s;|&]|\(|`|\$\()(?:\.\/)?Locus[^/\s]*\.AppImage\b/i;

/** AppImage FUSE mounts and APPDIR must not win `locus` on PATH for host/CLI shells. */
export function isAppImageMountDir(dir: string, appDir?: string): boolean {
  const normalized = dir.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return false;
  if (APPIMAGE_MOUNT_DIR.test(normalized)) return true;
  const extra = appDir?.replace(/\\/g, "/").replace(/\/+$/, "");
  if (extra && (normalized === extra || normalized.startsWith(`${extra}/`))) return true;
  return false;
}

export function stripAppImageMountsFromPath(
  pathValue: string | undefined,
  sep: string,
  appDir?: string,
): string {
  return (pathValue ?? "")
    .split(sep)
    .filter((dir) => dir && !isAppImageMountDir(dir, appDir))
    .join(sep);
}

/**
 * Invoking the packaged desktop binary (`locus` on the AppImage PATH,
 * `/tmp/.mount_Locus-*`, `Locus-*.AppImage`) opens another GUI, not a CLI.
 */
export function commandLooksLikeLocusDesktopLaunch(command: string): boolean {
  if (APPIMAGE_MOUNT_BIN.test(command) || LOCUS_APPIMAGE.test(command)) return true;
  const parts = command.split(/\s*(?:&&|\|\||[;\n])\s*/);
  for (const part of parts) {
    const stripped = part
      .trim()
      .replace(/^(?:sudo\s+)?(?:env\s+(?:\S+=\S+\s+)*)?/, "")
      .replace(/^["']|["']$/g, "");
    if (/^(?:\.[/\\]|[/\\]|(?:[A-Za-z]:)?[^;&|]*[/\\])?locus(?:\.exe)?(?:\s|$)/i.test(stripped)) {
      return true;
    }
  }
  return false;
}

/** Dumping process env would pull GIT_TOKEN / provider keys into model context. */
export function commandLooksLikeEnvDump(command: string): boolean {
  const text = command.replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (/\bprintenv\b/i.test(text)) return true;
  if (/\bexport\s+-p\b/i.test(text)) return true;
  if (/\bdeclare\s+-[a-zA-Z]*x\b/i.test(text)) return true;
  if (/\bset(?:\s|$)/i.test(text) && !/\bset\s+-/i.test(text) && /\bset\b/.test(text)) {
    if (/(?:^|[;&|]\s*)set(?:\s*$|\s*[|&>])/i.test(text)) return true;
  }
  if (/\/proc\/(?:self|\d+|[^/\s]+)\/(?:environ|cmdline)\b/.test(text)) return true;
  if (/(?:^|[;&|]\s*)env(?:\s*$|\s*[|&>])/i.test(text)) return true;
  if (/\bstrings\b/i.test(text) && /\/proc\//.test(text)) return true;
  if (/\bxargs\b/i.test(text) && /\/proc\//.test(text)) return true;
  if (/(?:^|[;&|]\s*)(?:cat|less|more|head|tail)\s+[^\n;|&]*\*\.env\b/i.test(text)) return true;
  return false;
}

export function commandOutboundFetchHost(command: string): string | undefined {
  if (!/\b(?:curl|wget|fetch)\b/i.test(command)) return undefined;
  const match = command.match(/https?:\/\/([^/\s:'"]+)/i);
  if (!match?.[1]) return "unknown";
  return match[1].toLowerCase();
}

const HOST_SYSTEM_BIN = /^\/(?:usr|bin|sbin|lib|lib64|opt|nix|dev|etc\/alternatives)\b/;
const HOST_FS_ROOT = /^\/(?:tmp|home|etc|var|root|mnt|media|opt|data|Users|workspace)\b/;

/**
 * Tokenizer leftovers that are not filesystem paths: HTML tags (`</body>` → `/body`),
 * sed/awk regex (`/^const`, `/foo/g`), and protocol-relative `//`.
 */
export function hostExecTokenLooksLikeFilesystemPath(token: string): boolean {
  if (!token.startsWith("/")) return false;
  if (token === "//" || token.startsWith("//")) return false;
  if (/^https?:\/\//i.test(token)) return false;
  if (/^\/[\^$.*+[(\\?]/.test(token)) return false;
  if (/^\/(?:[^/\s]+\/)+[gimsuy]*$/.test(token) && !HOST_FS_ROOT.test(token)) return false;
  if (/^\/[A-Za-z][A-Za-z0-9-]*$/.test(token) && !HOST_FS_ROOT.test(token)) return false;
  return true;
}

/** Host `exec` must not read or write paths outside this session's workspace. */
export function refuseHostExecCommand(command: string, hostRoot: string): string | undefined {
  if (commandLooksLikeLocusDesktopLaunch(command)) {
    return "Refusing to launch the Locus desktop app from exec. This binary is the GUI, not a CLI. Use the HTTP API on 127.0.0.1:7420 or npm run locus.";
  }
  const root = hostRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const rewritten = command.split("/workspace").join(root);
  if (/(?:^|[^*])>{1,2}\s*\/(?:usr|bin|sbin|lib|lib64|opt|nix|etc)\b/.test(rewritten)) {
    return "Refusing host exec write outside /workspace. Host agents stay inside this session's workspace.";
  }
  if (/\|\s*(?:sh|bash|zsh|dash|fish|pwsh|powershell)\b/i.test(rewritten)) {
    return "Refusing host exec that pipes into a shell. Host agents stay inside this session's workspace.";
  }
  const tokens = rewritten.split(/[\s"'`;|&<>()]+/).filter(Boolean);
  for (const token of tokens) {
    if (token.includes("..")) {
      return `Refusing host exec path outside /workspace: ${token}. Host agents stay inside this session's workspace.`;
    }
    const expanded = token
      .replace(/^~(?=\/|$)/, "/home")
      .replace(/^~[A-Za-z0-9._-]+(?=\/|$)/, "/home")
      .replace(/^\$HOME(?=\/|$)/, "/home");
    if (!expanded.startsWith("/")) continue;
    if (expanded === root || expanded.startsWith(`${root}/`)) continue;
    if (HOST_SYSTEM_BIN.test(expanded)) continue;
    if (expanded.startsWith("/tmp/locus")) continue;
    if (/^https?:\/\//i.test(token)) continue;
    if (!hostExecTokenLooksLikeFilesystemPath(expanded)) continue;
    return `Refusing host exec path outside /workspace: ${token}. Host agents stay inside this session's workspace.`;
  }
  return undefined;
}

export function refuseExecCommand(
  command: string,
  opts?: { allowHosts?: string[] },
): string | undefined {
  if (commandLooksLikeLocusDesktopLaunch(command)) {
    return "Refusing to launch the Locus desktop app from exec. This binary is the GUI, not a CLI. Use the HTTP API on 127.0.0.1:7420 or npm run locus.";
  }
  if (commandLooksLikeForcePush(command)) {
    return "Refusing git push --force. Force-push is denied by the harness; push a new branch instead.";
  }
  if (commandLooksLikeProtectedBranchPush(command)) {
    return "Refusing git push to a protected branch (main/master/trunk). Push a feature branch instead.";
  }
  if (commandLooksLikeDangerousRm(command) && !recursiveRmTargetAllowed(command)) {
    return "Refusing recursive delete (rm -rf). Remove specific files inside /workspace, not a tree wipe.";
  }
  if (commandLooksLikeEnvDump(command)) {
    return "Refusing a command that dumps process environment. Secrets stay in environment variables, not in model context.";
  }
  if (commandTouchesSensitivePath(command)) {
    return "Refusing a command that names a credential file. Secrets stay in environment variables, not in the shell or model context.";
  }
  if (opts?.allowHosts) {
    const host = commandOutboundFetchHost(command);
    if (host) {
      const allowed = opts.allowHosts.map((item) => item.trim().toLowerCase()).filter(Boolean);
      if (host !== "unknown" && (host === "localhost" || host.endsWith(".localhost")))
        return undefined;
      if (!allowed.some((item) => host === item || host.endsWith(`.${item}`))) {
        return `Refusing outbound fetch to ${host}. Add it to this agent's allow hosts, or drop the curl/wget.`;
      }
    }
  }
  return undefined;
}
