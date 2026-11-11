import { spawn } from "node:child_process";
import { posix } from "node:path";
import type { GuestOs } from "@locus/shared";
import { isWindows } from "@locus/shared";
import { applyGuestPatch } from "./applyPatch.js";
import { commandFor, decorateRemoteToolResult, isSupported } from "./commands.js";
import type { GuestRuntime, ToolRequest, ToolResult } from "./types.js";
import { str } from "./types.js";
import { powershellEncodedCommand } from "./winrm.js";

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  identityFile?: string;
}

export type SshExec = (
  argv: string[],
  signal?: AbortSignal,
  stdin?: string,
  onOutput?: (chunk: string) => void,
) => Promise<{ code: number; stdout: string; stderr: string }>;

const READY_TOKEN = "LOCUS_READY";
const READY_PROBE = `(command -v cloud-init >/dev/null 2>&1 && cloud-init status --wait || true) && echo ${READY_TOKEN}`;

export class SshGuestRuntime implements GuestRuntime {
  readonly liveGuest = true;
  constructor(
    readonly os: GuestOs,
    private readonly target: SshTarget,
    private readonly runner: SshExec = sshExec,
  ) {}

  async syncHostDirToGuest(_hostDir: string, _guestDir: string): Promise<void> {}

  async prepareHostWorkspace(): Promise<void> {}

  chromium() {
    return undefined;
  }

  async execute(
    req: ToolRequest,
    signal?: AbortSignal,
    onOutput?: (chunk: string) => void,
  ): Promise<ToolResult> {
    if (!isSupported(this.os, req.name)) {
      return { ok: false, output: `${req.name} is not available on ${this.os}` };
    }
    if (req.name === "apply_patch" && !isWindows(this.os)) {
      return this.applyPatchInGuest(req);
    }
    const remote = commandFor(this.os, req);
    const argv = sshArgv(
      this.target,
      isWindows(this.os) ? powershellEncodedCommand(remote) : remote,
    );
    const result = await this.runner(argv, signal, undefined, onOutput);
    return decorateRemoteToolResult(req.name, result);
  }

  /**
   * Apply unified diffs with the host parser over SSH. Do not fall through to
   * guest `git apply`/`patch` — a hunk mismatch becomes "can't find file to patch"
   * and leaves `.rej` files in the workspace.
   */
  private async applyPatchInGuest(req: ToolRequest): Promise<ToolResult> {
    const workspace = "/home/locus/workspace";
    const requested = str(req.args, "path", workspace);
    const fileProbe =
      requested && requested !== workspace
        ? await this.remote(`test -f -- ${posixQuote(requested)}`)
        : { code: 1 };
    const result = await applyGuestPatch({
      patch: str(req.args, "patch"),
      requestedCwd: requested,
      workspace,
      isFile: (p) => p === requested && fileProbe.code === 0,
      read: async (dest) => {
        const got = await this.remote(`cat -- ${posixQuote(dest)}`);
        return { content: got.code === 0 ? got.stdout : undefined };
      },
      write: async (guest, content) => {
        const written = await this.writeGuestFile(guest, content);
        if (written.code !== 0) {
          return {
            ok: false,
            output: (written.stderr || written.stdout || `failed to write ${guest}`).trim(),
          };
        }
      },
      remove: async (guest) => {
        await this.remote(`rm -f -- ${posixQuote(guest)}`);
      },
    });
    return result ?? { ok: false, output: "patch failed" };
  }

  /** Write over SSH stdin so file size is not bounded by ARG_MAX. */
  private async writeGuestFile(guest: string, content: string) {
    const dir = posix.dirname(guest);
    const mkdir = await this.remote(`mkdir -p -- ${posixQuote(dir)}`);
    if (mkdir.code !== 0) return mkdir;
    return this.runner(sshArgv(this.target, `cat > ${posixQuote(guest)}`), undefined, content);
  }

  private remote(command: string) {
    return this.runner(sshArgv(this.target, command));
  }
}

function posixQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sshBaseOpts(target: SshTarget): string[] {
  return [
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "LogLevel=ERROR",
    "-o",
    "ConnectTimeout=8",
    "-o",
    "BatchMode=yes",
    ...(target.identityFile ? ["-o", "IdentitiesOnly=yes", "-i", target.identityFile] : []),
  ];
}

export function sshArgv(target: SshTarget, remote: string, extra: string[] = []): string[] {
  return [
    "ssh",
    ...sshBaseOpts(target),
    ...extra,
    "-p",
    String(target.port),
    `${target.username}@${target.host}`,
    remote,
  ];
}

export function scpPutArgv(target: SshTarget, localPath: string, remotePath: string): string[] {
  return [
    "scp",
    ...sshBaseOpts(target),
    "-P",
    String(target.port),
    localPath,
    `${target.username}@${target.host}:${remotePath}`,
  ];
}

export function scpGetArgv(target: SshTarget, remotePath: string, localPath: string): string[] {
  return [
    "scp",
    ...sshBaseOpts(target),
    "-P",
    String(target.port),
    `${target.username}@${target.host}:${remotePath}`,
    localPath,
  ];
}

export const runSsh = sshExec;

export async function waitForSsh(
  target: SshTarget,
  opts: {
    timeoutMs?: number;
    intervalMs?: number;
    signal?: AbortSignal;
    exec?: SshExec;
    probe?: string;
  } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const intervalMs = opts.intervalMs ?? 2000;
  const exec = opts.exec ?? sshExec;
  const probe = opts.probe ?? READY_PROBE;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) return false;
    try {
      const result = await exec(
        sshArgv(target, probe, ["-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=40"]),
        opts.signal,
      );
      if (opts.signal?.aborted) return false;
      if (result.code === 0 && result.stdout.includes(READY_TOKEN)) return true;
    } catch {
      if (opts.signal?.aborted) return false;
      /* connection refused, try again */
    }
    await sleep(intervalMs, opts.signal);
  }
  return false;
}

export function isSshTransportError(result: ToolResult): boolean {
  if (result.ok) return false;
  const output = result.output.toLowerCase();
  return (
    result.output.includes("(exit 255)") ||
    output.includes("connection refused") ||
    output.includes("connection timed out") ||
    output.includes("connection reset") ||
    output.includes("permission denied") ||
    output.includes("no route to host") ||
    output.includes("connection closed") ||
    output.includes("aborted")
  );
}

function sshExec(
  argv: string[],
  signal?: AbortSignal,
  stdin?: string,
  onOutput?: (chunk: string) => void,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve({ code: 1, stdout: "", stderr: "aborted" });
      return;
    }
    const child = spawn(argv[0]!, argv.slice(1), {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const onAbort = () => {
      child.kill("SIGKILL");
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const take = (d: Buffer, sink: "stdout" | "stderr") => {
      const chunk = d.toString();
      if (sink === "stdout") stdout += chunk;
      else stderr += chunk;
      onOutput?.(chunk);
    };
    child.stdout.on("data", (d: Buffer) => take(d, "stdout"));
    child.stderr.on("data", (d: Buffer) => take(d, "stderr"));
    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("exit", (code) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (stdin != null) child.stdin.write(stdin, "utf8");
    child.stdin.end();
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
