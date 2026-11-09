import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  cursorCliSpawnFailureMessage,
  resolveWindowsCliSpawn,
} from "@locus/shared/windowsCliSpawn";

export interface WorkerCursorCliRequest {
  command: string;
  args: string[];
  apiKey?: string;
  /** Worker-loopback session MCP URL. Rewrites Codex `locus_git` argv/env. */
  gitMcpUrl?: string;
}

const LOCUS_GIT_URL_PREFIX = "mcp_servers.locus_git.url=";

function rewriteWorkspaceArg(command: string, args: string[], workspace: string): string[] {
  const next = [...args];
  const idx = next.indexOf("--workspace");
  if (idx >= 0) {
    next[idx + 1] = workspace;
    return next;
  }
  const cdIdx = next.indexOf("--cd");
  if (cdIdx >= 0) {
    next[cdIdx + 1] = workspace;
    return next;
  }
  const base = command.trim().split(/[/\\]/).pop()?.toLowerCase() ?? "";
  if (base === "agent" || base === "cursor-agent" || base === "cursor-agent.cmd") {
    next.unshift("--workspace", workspace);
  } else if (base === "codex" || base === "codex.exe" || base === "codex.cmd") {
    next.unshift("--cd", workspace);
  }
  return next;
}

export function rewriteWorkerCliMcpArgs(args: string[], sessionUrl: string): string[] {
  const url = sessionUrl.trim();
  if (!url) return args;
  return args.map((arg) =>
    arg.startsWith(LOCUS_GIT_URL_PREFIX) ? `${LOCUS_GIT_URL_PREFIX}${JSON.stringify(url)}` : arg,
  );
}

export function workerGitMcpUrl(args: string[]): string | undefined {
  for (const arg of args) {
    if (!arg.startsWith(LOCUS_GIT_URL_PREFIX)) continue;
    const raw = arg.slice(LOCUS_GIT_URL_PREFIX.length);
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
    } catch {
      const trimmed = raw.replace(/^"|"$/g, "").trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

export function workerCliEnv(
  command: string,
  apiKey?: string,
  gitMcpUrl?: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (gitMcpUrl?.trim()) env.LOCUS_GIT_MCP_URL = gitMcpUrl.trim();
  else delete env.LOCUS_GIT_MCP_URL;
  if (!apiKey || apiKey.includes("•")) return env;
  const base = command.trim().split(/[/\\]/).pop()?.toLowerCase() ?? "";
  if (base === "claude" || base === "claude.exe") {
    env.ANTHROPIC_API_KEY = apiKey;
    env.CLAUDE_API_KEY = apiKey;
    return env;
  }
  if (base === "codex" || base === "codex.exe" || base === "codex.cmd") {
    env.OPENAI_API_KEY = apiKey;
    return env;
  }
  if (
    base === "kiro-cli" ||
    base === "kiro-cli.exe" ||
    base === "kiro-cli.cmd" ||
    base === "kiro" ||
    base === "kiro.exe"
  ) {
    env.KIRO_API_KEY = apiKey;
    return env;
  }
  env.CURSOR_API_KEY = apiKey;
  return env;
}

export function workerCliArgs(
  command: string,
  args: string[],
  workspace: string,
  sessionUrl?: string,
): string[] {
  const next = rewriteWorkspaceArg(command, args, workspace);
  return sessionUrl ? rewriteWorkerCliMcpArgs(next, sessionUrl) : next;
}

export function allowedWorkerCursorCliCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed || /[\0;&|`$<>\n]/.test(trimmed)) return false;
  const base = trimmed.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  return ![
    "sh",
    "bash",
    "zsh",
    "dash",
    "csh",
    "tcsh",
    "fish",
    "cmd",
    "cmd.exe",
    "powershell",
    "powershell.exe",
    "pwsh",
    "pwsh.exe",
    "node",
    "nodejs",
    "python",
    "python3",
    "perl",
    "ruby",
    "php",
    "lua",
    "osascript",
    "wscript",
    "cscript",
  ].includes(base);
}

export function spawnWorkerCursorCli(
  req: WorkerCursorCliRequest,
  workspace: string,
  signal?: AbortSignal,
): { stream: ReadableStream<Uint8Array>; kill: () => void } {
  const command = req.command.trim() || "agent";
  const args = workerCliArgs(command, req.args, workspace, req.gitMcpUrl);
  const env = workerCliEnv(command, req.apiKey, workerGitMcpUrl(args) ?? req.gitMcpUrl);
  const resolved = resolveWindowsCliSpawn(command, args, { env });
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(resolved.command, resolved.args, {
      cwd: workspace,
      env: { ...env, ...resolved.envPatch },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: resolved.windowsVerbatimArguments === true,
    });
  } catch (err) {
    const message = cursorCliSpawnFailureMessage(err, command);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message })}\n`));
        controller.close();
      },
    });
    return { stream, kill: () => undefined };
  }
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
  if (signal) {
    if (signal.aborted) kill();
    else signal.addEventListener("abort", kill, { once: true });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const fail = (err: unknown) => {
        const message = cursorCliSpawnFailureMessage(err, command);
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message })}\n`));
          controller.close();
        } catch {
          /* already closed */
        }
        kill();
      };
      child.on("error", fail);
      if (!child.stdout) {
        fail(new Error("Cursor CLI produced no stdout"));
        return;
      }
      const rl = createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        try {
          controller.enqueue(encoder.encode(`${line}\n`));
        } catch {
          kill();
        }
      });
      const finish = (code?: number | null) => {
        if (code && code !== 0) {
          const message = stderr.trim() || `Cursor CLI exited ${code}`;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message })}\n`));
          } catch {
            /* already closed */
          }
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      child.on("close", (code) => finish(code));
      rl.on("close", () => undefined);
    },
    cancel() {
      kill();
    },
  });
  return { stream, kill };
}
