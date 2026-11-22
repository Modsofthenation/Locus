import {
  cliSandboxSharesHostNetwork,
  detectCliSandboxBackend as detectSharedCliSandboxBackend,
  resolveCliSandbox as resolveSharedCliSandbox,
  type CliSandboxBackend,
  type CliSandboxPolicy,
} from "@locus/shared/cliSandbox";
import type { CursorCliSpawner } from "@locus/providers";

/**
 * Control-plane adapter for the CLI sandbox in `@locus/shared/cliSandbox`: wraps a
 * {@link CursorCliSpawner} so a Docker session's CLI cannot see `<LOCUS_HOME>` except
 * that session's workspace, and cannot reach the control plane on loopback (only the
 * session MCP gateway port in `policy.loopbackPorts`). `locus-worker` uses the same
 * helpers for worker Docker guests, filesystem only.
 */

export {
  bwrapArgs,
  cliSandboxDisabled,
  scrubCliEnv,
  seatbeltProfile,
  wrapCliSpawnRequest,
  type CliSandboxBackend,
  type CliSandboxPolicy,
} from "@locus/shared/cliSandbox";

export type CliSandbox =
  | {
      ok: true;
      backend: CliSandboxBackend;
      /** False when `LOCUS_CLI_SANDBOX_NET=host` keeps the host network. */
      isolatesNetwork: boolean;
      wrap: (spawn: CursorCliSpawner) => CursorCliSpawner;
    }
  | { ok: false; reason: string };

/** The control plane's probe includes the network namespace (pasta) unless opted out. */
export function detectCliSandboxBackend(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) {
  return detectSharedCliSandboxBackend(platform, { network: !cliSandboxSharesHostNetwork(env) });
}

export function resolveCliSandbox(
  policy: CliSandboxPolicy,
  opts: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {},
): CliSandbox | undefined {
  const sandbox = resolveSharedCliSandbox(policy, {
    ...opts,
    where: "this machine",
    network: true,
  });
  if (!sandbox?.ok) return sandbox;
  return {
    ok: true,
    backend: sandbox.backend,
    isolatesNetwork: sandbox.isolatesNetwork,
    wrap: (spawn) => (req) => spawn(sandbox.wrap(req)),
  };
}
