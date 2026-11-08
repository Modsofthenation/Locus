import { spawn } from "node:child_process";
import { sshArgv, type SshTarget } from "./ssh.js";

export function posixShellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Env vars that differ from this process — API keys, MCP URLs — not the host PATH. */
export function sshCliEnv(env: NodeJS.ProcessEnv | undefined): Record<string, string> {
  const extra: Record<string, string> = {};
  if (!env) return extra;
  for (const [key, value] of Object.entries(env)) {
    if (value == null || value === "") continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] === value) continue;
    extra[key] = value;
  }
  return extra;
}

export function sshRemoteCommand(req: {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const cmd = [req.command, ...(req.args ?? [])].map(posixShellQuote).join(" ");
  const env = Object.entries(sshCliEnv(req.env))
    .map(([key, value]) => `${key}=${posixShellQuote(value)}`)
    .join(" ");
  const run = env ? `${env} ${cmd}` : cmd;
  if (req.cwd?.trim()) return `cd ${posixShellQuote(req.cwd.trim())} && ${run}`;
  return run;
}

export interface SshCliForward {
  listenPort: number;
  host?: string;
  hostPort: number;
}

export interface SshCliHandle {
  lines: AsyncIterable<string>;
  wait(): Promise<{ code: number; stderr: string }>;
  kill?: () => void;
}

export function sshTargetFromInstance(vm: {
  ssh?: { host: string; port: number; username: string; identityFile?: string };
}): SshTarget | undefined {
  if (!vm.ssh) return undefined;
  return {
    host: vm.ssh.host,
    port: vm.ssh.port,
    username: vm.ssh.username,
    identityFile: vm.ssh.identityFile,
  };
}

/** Spawn a CLI over SSH, optionally reverse-forwarding the control-plane MCP port. */
export function spawnCliOverSsh(
  target: SshTarget,
  req: {
    command: string;
    args: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  },
  extra: { reverseForwards?: SshCliForward[] } = {},
): SshCliHandle {
  const forwards: string[] = [];
  for (const fwd of extra.reverseForwards ?? []) {
    const host = fwd.host?.trim() || "127.0.0.1";
    forwards.push("-R", `${fwd.listenPort}:${host}:${fwd.hostPort}`);
  }
  const argv = sshArgv(target, sshRemoteCommand(req), forwards);
  const child = spawn(argv[0]!, argv.slice(1), {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += String(chunk);
    if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
  });
  const kill = () => {
    if (child.exitCode != null || child.signalCode != null) return;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
    }, 1500).unref?.();
  };
  if (req.signal) {
    if (req.signal.aborted) kill();
    else req.signal.addEventListener("abort", kill, { once: true });
  }
  const wait = new Promise<{ code: number; stderr: string }>((resolve, reject) => {
    child.on("error", (err) => {
      req.signal?.removeEventListener("abort", kill);
      reject(err);
    });
    child.on("close", (code) => {
      req.signal?.removeEventListener("abort", kill);
      resolve({ code: code ?? 1, stderr });
    });
  });
  void wait.catch(() => undefined);
  return {
    lines: readStdoutLines(child.stdout),
    wait: () => wait,
    kill,
  };
}

async function* readStdoutLines(stdout: NodeJS.ReadableStream | null): AsyncGenerator<string> {
  if (!stdout) return;
  let buf = "";
  for await (const chunk of stdout) {
    buf += String(chunk);
    const parts = buf.split(/\r?\n/);
    buf = parts.pop() ?? "";
    for (const line of parts) {
      if (line.trim()) yield line;
    }
  }
  if (buf.trim()) yield buf;
}
