import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";

export interface SpawnedProcess {
  pid?: number;
  stdin?: NodeJS.WritableStream | null;
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ExecOptions {
  onOutput?: (chunk: string) => void;
}

export interface CommandRunner {
  which(binary: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
  exec(command: string, args: string[], opts?: ExecOptions): Promise<ExecResult>;
  spawn(
    command: string,
    args: string[],
    opts?: { cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean },
  ): SpawnedProcess;
}

async function which(binary: string): Promise<string | null> {
  if (binary.includes("/") || binary.includes("\\")) {
    try {
      await access(binary, constants.X_OK);
      return binary;
    } catch {
      try {
        await access(binary, constants.F_OK);
        return binary;
      } catch {
        return null;
      }
    }
  }
  const pathVar = process.env.PATH ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const exts = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const dir of pathVar.split(sep)) {
    for (const ext of exts) {
      const candidate = `${dir}${dir.endsWith("\\") || dir.endsWith("/") ? "" : "/"}${binary}${ext}`;
      try {
        await access(candidate, constants.F_OK);
        return candidate;
      } catch {
        /* continue */
      }
    }
  }
  return null;
}

export const nodeRunner: CommandRunner = {
  which,
  exists: async (path: string) => {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  },
  exec: (command, args, opts) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      const take = (d: Buffer, sink: "stdout" | "stderr") => {
        const chunk = d.toString();
        if (sink === "stdout") stdout += chunk;
        else stderr += chunk;
        opts?.onOutput?.(chunk);
      };
      child.stdout?.on("data", (d: Buffer) => take(d, "stdout"));
      child.stderr?.on("data", (d: Buffer) => take(d, "stderr"));
      child.on("error", reject);
      child.on("exit", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    }),
  spawn: (command, args, opts) => {
    const child: ChildProcess = spawn(command, args, {
      cwd: opts?.cwd,
      env: opts?.env,
      shell: opts?.shell ?? false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    return child;
  },
};
