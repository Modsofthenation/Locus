import { readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import type { GuestOs } from "@locus/shared";
import {
  DOCKER_WORKSPACE,
  execCommandsFromArgs,
  fileReadPaths,
  HOST_TOOLS,
  normalizePatchCwd,
  refuseHostExecCommand,
  resolvePatchPath,
  type ComputerUseToolName,
} from "@locus/shared";
import { applyGuestPatch } from "./applyPatch.js";
import { linuxCommand } from "./commands.js";
import {
  inspectHostPath,
  isHostFile,
  lexicalHostPath,
  resolveReadPath,
  resolveWritePath,
} from "./hostPath.js";
import { hostExecEnv, hostGitAuthEnv, hostSpawnErrorOutput, posixShellPath } from "./posixShell.js";
import { writeFileKeepExec } from "./workspaceWrite.js";
import type { GuestRuntime, ToolRequest, ToolResult } from "./types.js";
import { optNum, str } from "./types.js";
import {
  CdpChromiumDriver,
  dispatchBrowserTool,
  isBrowserToolRequest,
  type ChromiumDriver,
} from "./chromium.js";
import { launchHostChrome, type HostChromeHandle } from "./hostChrome.js";

const HOST_SET = new Set<string>(HOST_TOOLS);

export class HostGuestRuntime implements GuestRuntime {
  readonly liveGuest = true;
  private browser?: ChromiumDriver;
  private chrome?: HostChromeHandle;

  constructor(
    readonly os: GuestOs,
    private readonly hostRoot: string,
    private readonly runner: HostExec = hostExec,
    private readonly chromeProfileDir?: string,
    private readonly liveBrowser?: () => ChromiumDriver | undefined,
  ) {}

  async syncHostDirToGuest(_hostDir: string, _guestDir: string): Promise<void> {}

  async prepareHostWorkspace(): Promise<void> {}

  chromium(): ChromiumDriver | undefined {
    const live = this.liveBrowser?.();
    if (live) return live;
    if (!this.chromeProfileDir) return undefined;
    return this.browserFor();
  }

  async execute(
    req: ToolRequest,
    signal?: AbortSignal,
    onOutput?: (chunk: string) => void,
  ): Promise<ToolResult> {
    if (!HOST_SET.has(req.name)) {
      return { ok: false, output: `${req.name} is not available in a host agent` };
    }
    if (isBrowserToolRequest(req)) {
      const live = this.liveBrowser?.();
      if (live) return dispatchBrowserTool(req, live);
      if (!this.chromeProfileDir) {
        return { ok: false, output: "Host Chrome needs an isolated profile directory" };
      }
      return dispatchBrowserTool(req, this.browserFor());
    }
    if (req.name === "apply_patch") return this.applyPatch(req);
    if (req.name === "file_read") return this.fileRead(req);
    if (req.name === "file_write") return this.fileWrite(req);
    if (req.name === "file_list") return this.fileList(req);
    if (req.name === "exec" || req.name === "powershell" || req.name === "start_process") {
      for (const command of execCommandsFromArgs(req.args)) {
        const refused = refuseHostExecCommand(command, this.hostRoot);
        if (refused) return { ok: false, output: refused };
      }
    }
    const remote = hostCommand(req, this.hostRoot);
    const shell = posixShellPath();
    const extraEnv = hostGitAuthEnv(req);
    let result: { code: number; stdout: string; stderr: string };
    try {
      result = await this.runner([shell, "-lc", remote], this.hostRoot, signal, onOutput, extraEnv);
    } catch (err) {
      return { ok: false, output: hostSpawnErrorOutput(err, shell, this.hostRoot) };
    }
    const output = [result.stdout, result.stderr]
      .filter((part) => part.trim())
      .join("\n")
      .trim();
    return { ok: result.code === 0, output: output || `(exit ${result.code})` };
  }

  private async applyPatch(req: ToolRequest): Promise<ToolResult> {
    const result = await applyGuestPatch({
      patch: str(req.args, "patch"),
      requestedCwd: str(req.args, "path", DOCKER_WORKSPACE),
      workspace: DOCKER_WORKSPACE,
      isFile: (p) => isHostFile(lexicalHostPath(p, this.hostRoot)),
      read: async (guest) => {
        if (!(await resolveWritePath(guest, this.hostRoot))) {
          return { ok: false, output: `path is outside /workspace: ${guest}` };
        }
        const hostPath = await resolveReadPath(guest, this.hostRoot);
        if (!hostPath) return { content: undefined };
        try {
          return { content: await readFile(hostPath, "utf8") };
        } catch {
          return { content: undefined };
        }
      },
      write: async (guest, content) => {
        const hostPath = await resolveWritePath(guest, this.hostRoot);
        if (!hostPath) return { ok: false, output: `path is outside /workspace: ${guest}` };
        await writeFileKeepExec(hostPath, content);
      },
      remove: async (guest) => {
        const hostPath = await resolveReadPath(guest, this.hostRoot);
        if (hostPath) await unlink(hostPath).catch(() => undefined);
      },
    });
    return result ?? { ok: false, output: "patch failed" };
  }

  private async fileRead(req: ToolRequest): Promise<ToolResult> {
    const paths = fileReadPaths(req.args).map((path) => resolvePatchPath(DOCKER_WORKSPACE, path));
    if (!paths.length) return { ok: false, output: "file_read needs path or paths" };
    const parts: string[] = [];
    for (const path of paths) {
      const found = await inspectHostPath(path, this.hostRoot);
      if (found.kind === "outside") {
        return { ok: false, output: `path is outside /workspace: ${path}` };
      }
      if (found.kind === "missing") {
        if (paths.length === 1) return { ok: false, output: `not found: ${path}` };
        parts.push(`=== ${path} ===\nnot found: ${path}`);
        continue;
      }
      let content: string;
      try {
        content = await readFile(found.path, "utf8");
      } catch {
        if (paths.length === 1) return { ok: false, output: `not found: ${path}` };
        parts.push(`=== ${path} ===\nnot found: ${path}`);
        continue;
      }
      const offset = optNum(req.args, "offset");
      const limit = optNum(req.args, "limit");
      let body = content;
      if (offset != null || limit != null) {
        const lines = content.split("\n");
        const start = Math.max(0, Math.round(offset ?? 1) - 1);
        const count = Math.max(1, Math.round(limit ?? lines.length));
        body = lines.slice(start, start + count).join("\n");
      }
      parts.push(paths.length > 1 ? `=== ${path} ===\n${body}` : body);
    }
    return { ok: true, output: parts.join("\n") };
  }

  private async fileWrite(req: ToolRequest): Promise<ToolResult> {
    const path = resolvePatchPath(DOCKER_WORKSPACE, str(req.args, "path"));
    const hostPath = await resolveWritePath(path, this.hostRoot);
    if (!hostPath) return { ok: false, output: `path is outside /workspace: ${path}` };
    await writeFile(hostPath, str(req.args, "content"));
    return { ok: true, output: `wrote ${path}` };
  }

  private async fileList(req: ToolRequest): Promise<ToolResult> {
    const path = resolvePatchPath(DOCKER_WORKSPACE, str(req.args, "path", DOCKER_WORKSPACE));
    const found = await inspectHostPath(path, this.hostRoot);
    if (found.kind === "outside")
      return { ok: false, output: `path is outside /workspace: ${path}` };
    const hostPath = found.kind === "ok" ? found.path : lexicalHostPath(path, this.hostRoot);
    if (!hostPath) return { ok: false, output: `path is outside /workspace: ${path}` };
    try {
      const names = await readdir(hostPath);
      return { ok: true, output: names.join("\n") || "(empty)" };
    } catch (err) {
      return { ok: false, output: err instanceof Error ? err.message : "list failed" };
    }
  }

  private browserFor(): ChromiumDriver {
    this.browser ??= new CdpChromiumDriver(
      "host",
      async () => ({ code: 0, stdout: "", stderr: "" }),
      fetch,
      {
        launch: async () => {
          if (!this.chromeProfileDir) {
            return { ok: false, output: "Host Chrome profile is missing" };
          }
          try {
            this.chrome ??= await launchHostChrome(this.chromeProfileDir);
            return { ok: true, output: "ready" };
          } catch (err) {
            return {
              ok: false,
              output: err instanceof Error ? err.message : "Host Chrome failed to start",
            };
          }
        },
        endpoint: async () => {
          if (!this.chrome) this.chrome = await launchHostChrome(this.chromeProfileDir ?? "");
          return this.chrome.endpoint;
        },
      },
    );
    return this.browser;
  }
}

export function hostCommand(req: ToolRequest, hostRoot: string): string {
  const ws = DOCKER_WORKSPACE;
  const args = bindHostArgs(req, hostRoot);
  if (req.name === "git_clone" && !str(args, "dest")) args.dest = hostRoot;
  if (req.name === "git_fetch" && !str(args, "path")) args.path = hostRoot;
  if (req.name === "apply_patch") {
    args.path = normalizePatchCwd(str(args, "path", ws), ws);
  } else if (
    (req.name === "git_status" ||
      req.name === "git_diff" ||
      req.name === "git_log" ||
      req.name === "git_commit" ||
      req.name === "git_branch" ||
      req.name === "git_push" ||
      req.name === "git_stash" ||
      req.name === "git_revert" ||
      req.name === "grep" ||
      req.name === "glob") &&
    !str(args, "path")
  ) {
    args.path = hostRoot;
  }
  return linuxCommand({ name: req.name as ComputerUseToolName, args }, "ubuntu");
}

function bindHostArgs(req: ToolRequest, hostRoot: string): Record<string, unknown> {
  const args = { ...req.args };
  for (const key of ["path", "cwd", "dest"]) {
    if (typeof args[key] === "string") args[key] = rewriteWorkspacePath(args[key], hostRoot);
  }
  if (typeof args.command === "string")
    args.command = rewriteWorkspaceCommand(args.command, hostRoot);
  if (Array.isArray(args.commands)) {
    args.commands = args.commands.map((item) =>
      typeof item === "string" ? rewriteWorkspaceCommand(item, hostRoot) : item,
    );
  }
  if (Array.isArray(args.paths)) {
    args.paths = args.paths.map((item) =>
      typeof item === "string" ? rewriteWorkspacePath(item, hostRoot) : item,
    );
  }
  return args;
}

/**
 * Host exec is `sh -lc`, including Git Bash on Windows. An unquoted
 * `C:\Users\...` loses every backslash (`\U` → `U`), so `cd /workspace`
 * becomes `cd C:Users...` and the shell cannot find the directory.
 * Drive paths become `/c/Users/...` and command tokens are single-quoted.
 */
export function posixShellHostPath(hostPath: string): string {
  const normalized = hostPath.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  const drive = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!drive) return normalized || "/";
  const rest = drive[2] ?? "";
  return rest ? `/${drive[1]!.toLowerCase()}/${rest}` : `/${drive[1]!.toLowerCase()}`;
}

function rewriteWorkspacePath(value: string, hostRoot: string): string {
  const root = posixShellHostPath(hostRoot);
  if (value === DOCKER_WORKSPACE) return root;
  if (value.startsWith(`${DOCKER_WORKSPACE}/`) || value.startsWith(`${DOCKER_WORKSPACE}\\`)) {
    return root + value.slice(DOCKER_WORKSPACE.length).replace(/\\/g, "/");
  }
  if (!value.includes(DOCKER_WORKSPACE)) return value;
  return value.split(DOCKER_WORKSPACE).join(root);
}

function rewriteWorkspaceCommand(value: string, hostRoot: string): string {
  const root = posixShellHostPath(hostRoot);
  const token = DOCKER_WORKSPACE;
  let out = "";
  let i = 0;
  while (i < value.length) {
    const idx = value.indexOf(token, i);
    if (idx < 0) {
      out += value.slice(i);
      break;
    }
    if (!isWorkspaceToken(value, idx)) {
      out += value.slice(i, idx + token.length);
      i = idx + token.length;
      continue;
    }
    out += value.slice(i, idx);
    const quote = quoteAt(value, idx);
    let end = idx + token.length;
    const next = value[end];
    if (next === "/" || next === "\\") {
      if (quote) {
        while (end < value.length && value[end] !== quote) end += 1;
      } else {
        while (end < value.length && !isShellMeta(value[end]!)) end += 1;
      }
    }
    const suffix = value.slice(idx + token.length, end).replace(/\\/g, "/");
    const replacement = `${root}${suffix}`;
    if (quote === "'") out += replacement.replace(/'/g, `'\\''`);
    else if (quote === '"') out += escapeDoubleQuoted(replacement);
    else out += shellSingleQuote(replacement);
    i = end;
  }
  return out;
}

function isWorkspaceToken(value: string, idx: number): boolean {
  const token = DOCKER_WORKSPACE;
  if (value.slice(idx, idx + token.length) !== token) return false;
  const prev = idx > 0 ? value[idx - 1]! : "";
  if (prev && /[A-Za-z0-9_.-]/.test(prev)) return false;
  const next = value[idx + token.length];
  if (next && /[A-Za-z0-9_.-]/.test(next)) return false;
  return true;
}

function quoteAt(value: string, idx: number): "'" | '"' | "" {
  let quote: "'" | '"' | "" = "";
  for (let i = 0; i < idx; i += 1) {
    const ch = value[i]!;
    if (quote === "'") {
      if (ch === "'") quote = "";
      continue;
    }
    if (quote === '"') {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === '"') quote = "";
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
  }
  return quote;
}

function isShellMeta(ch: string): boolean {
  return " \t\n\r;|&<>()$`\\\"'#".includes(ch);
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function escapeDoubleQuoted(value: string): string {
  return value.replace(/[\\"$`]/g, (ch) => `\\${ch}`);
}

export type HostExec = (
  argv: string[],
  cwd: string,
  signal?: AbortSignal,
  onOutput?: (chunk: string) => void,
  extraEnv?: NodeJS.ProcessEnv,
) => Promise<{ code: number; stdout: string; stderr: string }>;

async function hostExec(
  argv: string[],
  cwd: string,
  signal?: AbortSignal,
  onOutput?: (chunk: string) => void,
  extraEnv?: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    if (!(await stat(cwd)).isDirectory()) {
      return { code: 1, stdout: "", stderr: `Host workspace is not a directory: ${cwd}` };
    }
  } catch {
    return { code: 1, stdout: "", stderr: `Host workspace does not exist: ${cwd}` };
  }
  const { spawn } = await import("node:child_process");
  const command = argv[0]!;
  return new Promise((resolvePromise) => {
    let done = false;
    const finish = (result: { code: number; stdout: string; stderr: string }) => {
      if (done) return;
      done = true;
      resolvePromise(result);
    };
    const child = spawn(command, argv.slice(1), {
      cwd,
      env: { ...hostExecEnv(process.platform, process.env, command), ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
      signal,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const take = (d: Buffer, sink: "stdout" | "stderr") => {
      const chunk = d.toString();
      if (sink === "stdout") stdout += chunk;
      else stderr += chunk;
      onOutput?.(chunk);
    };
    child.stdout?.on("data", (d: Buffer) => take(d, "stdout"));
    child.stderr?.on("data", (d: Buffer) => take(d, "stderr"));
    child.on("error", (err) => {
      if (signal?.aborted) {
        finish({ code: 1, stdout, stderr: stderr.trim() || "aborted" });
        return;
      }
      finish({
        code: 1,
        stdout,
        stderr: stderr.trim() || hostSpawnErrorOutput(err, command, cwd),
      });
    });
    child.on("exit", (code) => finish({ stdout, stderr, code: signal?.aborted ? 1 : (code ?? 1) }));
  });
}
