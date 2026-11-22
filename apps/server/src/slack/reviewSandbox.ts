import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import {
  isClaudeCodeProvider,
  isCodexCliProvider,
  isCursorCliProvider,
  isGenericCliProvider,
  isKiroCliProvider,
  type AiProvider,
} from "@locus/shared";
import {
  cliHomeAllowList,
  resolveCliSandbox,
  type CliHomeKind,
  type detectCliSandboxBackend,
} from "@locus/shared/cliSandbox";
import { spawnCursorCli, type CursorCliSpawner } from "@locus/providers";

/**
 * Sandbox for the Slack PR reviewer's CLI agent. The CLI reads untrusted pull request text, so
 * on top of the Docker-session sandbox (`<LOCUS_HOME>` hidden, own network namespace with no
 * host loopback) the home directory is hidden too, with only the selected CLI's login and
 * install bound back. `/tmp` and `$XDG_RUNTIME_DIR` (agent sockets) are hidden on Linux. The
 * folder the CLI runs in (the clone, or the scratch folder) is the only other writable path.
 * See docs/cli-agent-sandbox.md.
 */

/** No sandbox on this machine: the review fails with this instead of running the CLI unsandboxed. */
export class ReviewSandboxError extends Error {
  override name = "ReviewSandboxError";
}

export const REVIEW_SANDBOX_PURPOSE =
  "The Slack reviewer runs CLI agents in a sandbox, because they read untrusted pull requests: " +
  "no home directory beyond the CLI's own login, no Locus config, no Locus control plane.";

export function reviewCliKind(
  provider: Pick<AiProvider, "kind" | "baseUrl">,
): CliHomeKind | undefined {
  if (isClaudeCodeProvider(provider)) return "claude";
  if (isCodexCliProvider(provider)) return "codex";
  if (isCursorCliProvider(provider)) return "cursor";
  if (isKiroCliProvider(provider)) return "kiro";
  if (isGenericCliProvider(provider)) return "generic";
  return undefined;
}

export type ReviewSandboxOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
  /** Tests: skip probing this machine. */
  detect?: typeof detectCliSandboxBackend;
  /** The spawner the sandboxed request goes to. Defaults to spawning a child process. */
  spawn?: CursorCliSpawner;
};

/**
 * The spawner for a reviewer CLI that runs in `workspace`: sandboxed, or undefined (the
 * default spawner) when the provider is not a CLI or the operator set `LOCUS_CLI_SANDBOX=off`.
 * Throws {@link ReviewSandboxError} when this machine has no working sandbox.
 */
export function reviewCliSpawner(
  input: {
    provider: Pick<AiProvider, "kind" | "baseUrl" | "cli">;
    workspace: string;
    locusHome: string;
  } & ReviewSandboxOptions,
): CursorCliSpawner | undefined {
  const kind = reviewCliKind(input.provider);
  if (!kind) return undefined;
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const home = input.home ?? homedir();
  const hide: string[] = [];
  if (platform === "linux") {
    hide.push("/tmp");
    const runtime = env.XDG_RUNTIME_DIR?.trim();
    if (runtime && isAbsolute(runtime) && runtime !== "/") hide.push(runtime);
  }
  const sandbox = resolveCliSandbox(
    {
      locusHome: input.locusHome,
      workspace: input.workspace,
      isolateHome: {
        home,
        readWrite: cliHomeAllowList(kind, {
          home,
          platform,
          env,
          command: input.provider.cli?.command,
        }),
        hide,
      },
    },
    {
      env,
      platform,
      network: true,
      purpose: REVIEW_SANDBOX_PURPOSE,
      ...(input.detect ? { detect: input.detect } : {}),
    },
  );
  if (!sandbox) return undefined;
  if (!sandbox.ok) throw new ReviewSandboxError(sandbox.reason);
  const spawn = input.spawn ?? spawnCursorCli;
  return (req) => spawn(sandbox.wrap(req));
}
