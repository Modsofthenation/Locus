#!/usr/bin/env node
/**
 * Re-run a command on failure. Package Linux / macOS / Windows use this
 * around electron-builder: GitHub's electron-builder-binaries CDN returns
 * 504 after Electron itself has already downloaded, and builder's own
 * retry window is only ~12s.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 30_000;

export function parseRetryEnv(env = process.env) {
  const attempts = Number.parseInt(env.RETRY_ATTEMPTS ?? String(DEFAULT_ATTEMPTS), 10);
  const delayMs = Number.parseInt(env.RETRY_DELAY_MS ?? String(DEFAULT_DELAY_MS), 10);
  return {
    attempts: Number.isFinite(attempts) && attempts > 0 ? attempts : DEFAULT_ATTEMPTS,
    delayMs: Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : DEFAULT_DELAY_MS,
  };
}

export function runCommand(command, args, spawnFn = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnFn(command, args, {
      stdio: "inherit",
      // npm is npm.cmd on Windows; Unix can spawn npm/node directly.
      shell: process.platform === "win32",
      env: process.env,
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code: code ?? 1, signal });
    });
  });
}

export async function retryCommand(command, args, options) {
  const { attempts, delayMs, sleep, run } = options;
  let last = { code: 1 };
  for (let i = 1; i <= attempts; i++) {
    last = await run(command, args);
    if (last.code === 0) return last;
    if (i < attempts) {
      console.error(
        `retry-cmd: ${command} failed (attempt ${i}/${attempts}, code ${last.code}${
          last.signal ? `, signal ${last.signal}` : ""
        }); retrying in ${delayMs / 1000}s`,
      );
      await sleep(delayMs);
    }
  }
  return last;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error("usage: retry-cmd.mjs <command> [args...]");
    process.exit(2);
  }
  const { attempts, delayMs } = parseRetryEnv();
  const last = await retryCommand(argv[0], argv.slice(1), {
    attempts,
    delayMs,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    run: runCommand,
  });
  process.exit(last.code);
}
