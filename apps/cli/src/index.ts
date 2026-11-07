import { pathToFileURL } from "node:url";
import { ApprovalPendingError, dispatch, type Ctx } from "./commands.js";
import { UsageError, flagBool, flagStr, parseArgv } from "./args.js";
import { HttpError, LocusClient, defaultApiUrl } from "./client.js";
import { HELP_ROOT } from "./help.js";
import { CLI_VERSION } from "./version.js";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  env?: NodeJS.ProcessEnv;
}

export async function runCli(argv: string[], options: RunOptions = {}): Promise<RunResult> {
  let stdout = "";
  let stderr = "";
  const writeOut = (text: string) => {
    stdout += text;
    options.stdout?.(text);
  };
  const writeErr = (text: string) => {
    stderr += text;
    options.stderr?.(text);
  };
  const writeln = (line: string) => writeOut(line.endsWith("\n") ? line : `${line}\n`);
  const errln = (line: string) => writeErr(line.endsWith("\n") ? line : `${line}\n`);

  try {
    const parsed = parseArgv(argv);
    if (flagBool(parsed.flags, "version") && !parsed.tokens.length) {
      writeln(`locus ${CLI_VERSION}`);
      return { code: 0, stdout, stderr };
    }
    if (flagBool(parsed.flags, "help") && parsed.tokens[0] !== "help") {
      writeln(HELP_ROOT);
      return { code: 0, stdout, stderr };
    }
    const url = (flagStr(parsed.flags, "api") || defaultApiUrl()).replace(/\/+$/, "");
    const ctx: Ctx = {
      client: new LocusClient(url),
      flags: parsed.flags,
      args: parsed.tokens,
      json: flagBool(parsed.flags, "json"),
      write: writeOut,
      writeln,
      err: errln,
    };
    await dispatch(ctx, parsed.tokens);
    return { code: 0, stdout, stderr };
  } catch (err) {
    if (err instanceof ApprovalPendingError) {
      errln(err.message);
      return { code: 2, stdout, stderr };
    }
    const message = err instanceof Error ? err.message : String(err);
    errln(message);
    const code =
      err instanceof UsageError ? 1 : err instanceof HttpError ? (err.status >= 500 ? 1 : 1) : 1;
    return { code, stdout, stderr };
  }
}

function invokedAsCli(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return import.meta.url === pathToFileURL(argv1).href;
  } catch {
    return false;
  }
}

if (invokedAsCli()) {
  const safeWrite =
    (stream: NodeJS.WriteStream) =>
    (text: string): void => {
      try {
        stream.write(text);
      } catch {
        /* closed pipe (EPIPE) */
      }
    };
  const result = await runCli(process.argv.slice(2), {
    stdout: safeWrite(process.stdout),
    stderr: safeWrite(process.stderr),
  });
  process.exitCode = result.code;
}
