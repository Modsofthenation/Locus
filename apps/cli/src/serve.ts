import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { LocusClient } from "./client.js";

export async function startServer(opts: {
  url: string;
  out: (line: string) => void;
  err: (line: string) => void;
}): Promise<number> {
  const client = new LocusClient(opts.url);
  try {
    const health = await client.get<{ ok?: boolean; hypervisor?: string; docker?: string }>(
      "/api/health",
    );
    opts.out(
      `Already running at ${opts.url} (hypervisor ${health.hypervisor ?? "?"} · docker ${health.docker ?? "?"})`,
    );
    return 0;
  } catch {
    /* start a new process */
  }

  const require = createRequire(import.meta.url);
  const tsxCli = require.resolve("tsx/cli");
  const entry = fileURLToPath(new URL("../../server/src/index.ts", import.meta.url));
  opts.out(`Starting Locus control plane (${entry})`);
  const child: ChildProcess = spawn(process.execPath, [tsxCli, entry], {
    stdio: "inherit",
    env: process.env,
  });
  const code: number = await new Promise((resolve) => {
    child.on("exit", (status, signal) => {
      if (signal) resolve(1);
      else resolve(status ?? 1);
    });
    child.on("error", (err) => {
      opts.err(err instanceof Error ? err.message : String(err));
      resolve(1);
    });
  });
  return code;
}
