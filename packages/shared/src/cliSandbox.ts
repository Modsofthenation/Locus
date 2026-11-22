import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isLoopbackHost } from "./security.js";

/**
 * Containment for CLI agents (Cursor / Claude Code / Codex / Kiro / Custom) that a Locus
 * process spawns on its own machine for a **Docker** guest.
 *
 * Those CLIs bring their own shell tool, so without this they can read every file the
 * spawning user can. Two callers use it:
 *
 * - the control plane (`apps/server/src/session/cliSandbox.ts`), hiding `<LOCUS_HOME>`
 *   (config, other sessions, attachments, traces) and isolating the network;
 * - `locus-worker` (`packages/worker/src/cursorCli.ts`), hiding `<LOCUS_WORKER_HOME>`
 *   (token, TLS key, other guests' workspaces);
 * - the Slack PR reviewer (`apps/server/src/slack/reviewSandbox.ts`), which also hides the
 *   home directory (`isolateHome`) because its CLI reads untrusted pull requests.
 *
 * - **Filesystem:** hides the data dir and re-exposes only this guest's workspace.
 * - **Network** (opt-in, `network: true`): the control plane on `127.0.0.1:<bindPort>`
 *   trusts loopback clients as the operator, so the CLI gets its own loopback. Outbound
 *   egress still works, but the only host loopback ports it can reach are `loopbackPorts`
 *   (the session MCP gateway) plus any in `LOCUS_CLI_SANDBOX_ALLOW_PORTS`.
 *
 * Linux uses bubblewrap (`bwrap`), inside pasta (from `passt`) for the network namespace.
 * macOS uses `sandbox-exec`. Anything else fails closed.
 */

export type CliSandboxBackend = "bwrap" | "sandbox-exec";

export type CliSandboxPolicy = {
  /** The Locus data dir (`LOCUS_HOME` or `LOCUS_WORKER_HOME`). Hidden from the CLI. */
  locusHome: string;
  /** The guest workspace. Read-write, even when it lives under `locusHome`. */
  workspace: string;
  /**
   * Host loopback ports the CLI may connect to: the session MCP gateway port.
   * Every other host loopback port (the control plane included) is unreachable.
   */
  loopbackPorts?: number[];
  /**
   * Also hide the user's home directory, binding back only what the CLI needs to sign in and
   * run. For a CLI that reads untrusted input (a pull request) and could otherwise read
   * `~/.ssh`, cloud credentials and the like. Paths under {@link CLI_SANDBOX_SECRET_HOME_PATHS}
   * or `locusHome` are never bound back.
   */
  isolateHome?: CliHomeIsolation;
};

export type CliHomeIsolation = {
  /** The home directory, replaced by an empty tmpfs (Linux) or denied (macOS). */
  home: string;
  /** Under `home`, bound back read-write: the CLI's config and login (token refreshes write). */
  readWrite?: string[];
  /** Under `home`, bound back read-only: the CLI's install (binary, Node version manager). */
  readOnly?: string[];
  /**
   * Other directories replaced by an empty tmpfs on Linux / denied on macOS, e.g. `/tmp` and
   * `$XDG_RUNTIME_DIR`, where agent sockets (ssh-agent, gpg-agent, keyrings) live. The workspace
   * is bound back even when it is inside one.
   */
  hide?: string[];
};

/**
 * Credential stores under the home directory that an `isolateHome` sandbox never binds back,
 * even when an allow-list entry is (or contains, or sits inside) one of them.
 */
export const CLI_SANDBOX_SECRET_HOME_PATHS = [
  ".ssh",
  ".aws",
  ".azure",
  ".config/gcloud",
  ".config/gh",
  ".config/git/credentials",
  ".kube",
  ".docker",
  ".gnupg",
  ".password-store",
  ".local/share/keyrings",
  ".netrc",
  ".git-credentials",
  ".npmrc",
  ".pypirc",
  ".pgpass",
  ".vault-token",
  ".terraform.d",
] as const;

/** One path bound back into a hidden home: `src` (symlinks resolved) mounted at `dest`. */
export type CliHomeBind = { src: string; dest: string; write: boolean };

function within(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function overlaps(a: string, b: string): boolean {
  return within(a, b) || within(b, a);
}

/**
 * The binds an `isolateHome` policy puts back, in mount order (read-only first, so a read-write
 * entry inside a read-only one stays writable). Drops anything outside the home, the home
 * itself, and anything overlapping a secret path or `locusHome`, before and after resolving
 * symlinks (a `~/.claude` symlink to `~/.ssh` is still `~/.ssh`).
 */
export function cliHomeBinds(policy: CliSandboxPolicy): CliHomeBind[] {
  const iso = policy.isolateHome;
  if (!iso) return [];
  const home = resolve(iso.home);
  const homeReal = real(home);
  const locus = [resolve(policy.locusHome), real(policy.locusHome)];
  const secrets = CLI_SANDBOX_SECRET_HOME_PATHS.flatMap((p) => [join(home, p), join(homeReal, p)]);
  const blocked = (path: string) =>
    within(home, path) ||
    within(homeReal, path) ||
    secrets.some((secret) => overlaps(path, secret)) ||
    locus.some((dir) => overlaps(path, dir));
  const out: CliHomeBind[] = [];
  const seen = new Set<string>();
  const add = (paths: string[] | undefined, write: boolean) => {
    for (const raw of paths ?? []) {
      if (!raw || !isAbsolute(raw)) continue;
      const abs = resolve(raw);
      const base = within(abs, home) ? home : within(abs, homeReal) ? homeReal : undefined;
      if (!base) continue;
      const dest = join(homeReal, relative(base, abs));
      const src = real(abs);
      if (blocked(abs) || blocked(dest) || blocked(src) || seen.has(`${write}:${dest}`)) continue;
      seen.add(`${write}:${dest}`);
      out.push({ src, dest, write });
    }
  };
  add(iso.readOnly, false);
  add(iso.readWrite, true);
  return out;
}

export type CliHomeKind = "claude" | "codex" | "cursor" | "kiro" | "generic";

/**
 * What a CLI agent needs from the home directory to sign in and keep its settings, by kind.
 * `command` names a custom CLI, whose `~/.<name>`, `~/.config/<name>` and
 * `~/.local/share/<name>` are allowed. `CLAUDE_CONFIG_DIR` / `CODEX_HOME` are honoured.
 */
export function cliHomeAllowList(
  kind: CliHomeKind,
  opts: { home: string; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; command?: string },
): string[] {
  const env = opts.env ?? {};
  const mac = (opts.platform ?? process.platform) === "darwin";
  const at = (...parts: string[]) => join(opts.home, ...parts);
  const appSupport = (name: string) => (mac ? [at("Library", "Application Support", name)] : []);
  const list: string[] = [];
  switch (kind) {
    case "claude":
      list.push(at(".claude"), at(".claude.json"), at(".config", "claude"));
      if (env.CLAUDE_CONFIG_DIR?.trim()) list.push(resolve(env.CLAUDE_CONFIG_DIR.trim()));
      break;
    case "codex":
      list.push(at(".codex"));
      if (env.CODEX_HOME?.trim()) list.push(resolve(env.CODEX_HOME.trim()));
      break;
    case "cursor":
      list.push(at(".cursor"), at(".config", "cursor"), ...appSupport("cursor-agent"));
      break;
    case "kiro":
      list.push(
        at(".kiro"),
        at(".local", "share", "kiro-cli"),
        at(".config", "kiro"),
        ...appSupport("kiro-cli"),
      );
      break;
    case "generic": {
      const name = (opts.command ?? "")
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.(?:exe|cmd|bat)$/i, "");
      if (name && /^[\w.-]+$/.test(name) && !name.startsWith(".")) {
        list.push(at(`.${name}`), at(".config", name), at(".local", "share", name));
        list.push(...appSupport(name));
      }
      // Gemini CLI is the usual custom CLI and keeps its login here whatever its wrapper is called.
      list.push(at(".gemini"));
      break;
    }
  }
  // macOS CLIs keep their login in the Keychain. The keychain files are encrypted, and
  // securityd decides which items a process may read.
  if (mac) list.push(at("Library", "Keychains"));
  return [...new Set(list)];
}

function findOnPath(command: string, env: NodeJS.ProcessEnv): string | undefined {
  if (!command) return undefined;
  if (command.includes("/")) return existsSync(command) ? resolve(command) : undefined;
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** For a file inside `node_modules`, the package root (`…/node_modules/@scope/pkg`). */
function packageRoot(file: string): string | undefined {
  const parts = file.split(sep);
  const at = parts.lastIndexOf("node_modules");
  if (at < 0 || at + 1 >= parts.length) return undefined;
  const end = parts[at + 1]!.startsWith("@") ? at + 3 : at + 2;
  return end <= parts.length ? parts.slice(0, end).join(sep) : undefined;
}

/**
 * Where `command` (and `node`, for CLIs that are Node scripts) is installed, when that is under
 * `home`: the PATH entry's folder and the folder (or npm package) its symlinks resolve to, for
 * example `~/.local/bin` + `~/.local/share/claude/versions`, or an nvm version's `bin` + the
 * global package. Reads the filesystem. An `isolateHome` sandbox binds these read-only.
 */
export function cliInstallDirs(command: string, env: NodeJS.ProcessEnv, home: string): string[] {
  const roots = [resolve(home), real(home)];
  const out = new Set<string>();
  const keep = (dir: string | undefined) => {
    if (dir && roots.some((root) => dir !== root && within(dir, root))) out.add(dir);
  };
  for (const name of [command, "node"]) {
    const found = findOnPath(name, env);
    if (!found) continue;
    keep(dirname(found));
    const target = real(found);
    keep(packageRoot(target) ?? dirname(target));
  }
  return [...out];
}

/** The parts of a spawn the sandbox rewrites. Extra fields pass through untouched. */
export type CliSpawnArgv = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
};

export type ResolvedCliSandbox =
  | {
      ok: true;
      backend: CliSandboxBackend;
      /** False when the caller did not ask for it, or `LOCUS_CLI_SANDBOX_NET=host`. */
      isolatesNetwork: boolean;
      wrap: <T extends CliSpawnArgv>(req: T) => T;
    }
  | { ok: false; reason: string };

/** Operator escape hatch: `LOCUS_CLI_SANDBOX=off` runs Docker-session CLIs unsandboxed. */
export function cliSandboxDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.LOCUS_CLI_SANDBOX?.trim().toLowerCase();
  return raw === "off" || raw === "0" || raw === "false";
}

/**
 * `LOCUS_CLI_SANDBOX_NET=host` keeps the filesystem sandbox but shares the host network,
 * including the loopback control plane. For machines without a usable pasta.
 */
export function cliSandboxSharesHostNetwork(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LOCUS_CLI_SANDBOX_NET?.trim().toLowerCase() === "host";
}

/** `LOCUS_CLI_SANDBOX_ALLOW_PORTS=3128,8080`: extra host loopback ports, e.g. a local proxy. */
export function cliSandboxAllowedPorts(env: NodeJS.ProcessEnv = process.env): number[] {
  const out: number[] = [];
  for (const part of (env.LOCUS_CLI_SANDBOX_ALLOW_PORTS ?? "").split(/[\s,]+/)) {
    const port = Number(part);
    if (part && Number.isInteger(port) && port > 0 && port < 65536) out.push(port);
  }
  return out;
}

const PROXY_ENV = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
];

/** Ports of `*_PROXY` env vars that point at this machine's loopback. */
export function loopbackProxyPorts(env: NodeJS.ProcessEnv): number[] {
  const ports = new Set<number>();
  for (const key of PROXY_ENV) {
    const raw = env[key]?.trim();
    if (!raw) continue;
    let url: URL;
    try {
      url = new URL(raw.includes("://") ? raw : `http://${raw}`);
    } catch {
      continue;
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!isLoopbackHost(host)) continue;
    const fallback = url.protocol === "https:" ? 443 : url.protocol.startsWith("socks") ? 1080 : 80;
    ports.add(Number(url.port) || fallback);
  }
  return [...ports];
}

/** `LOCUS_MASTER_KEY`, `LOCUS_WORKER_TOKEN`, `LOCUS_GIPHY_API_KEY`, … */
const SECRET_ENV = /^LOCUS_.*(?:KEY|TOKEN|SECRET|PASSWORD)$/;

/** Drop Locus' own secrets from the CLI env. Provider keys the CLI needs are set explicitly. */
export function scrubCliEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (SECRET_ENV.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function real(path: string): string {
  const abs = resolve(path);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

function uniquePorts(ports: number[] | undefined): number[] {
  return [...new Set((ports ?? []).filter((p) => Number.isInteger(p) && p > 0 && p < 65536))].sort(
    (a, b) => a - b,
  );
}

/** pasta's DNS address inside the namespace when the host resolver is on loopback (as podman). */
export const PASTA_DNS = "169.254.1.1";

/** True when `/etc/resolv.conf` sends DNS to a loopback stub (systemd-resolved, dnsmasq, …). */
export function resolvConfUsesLoopback(text: string): boolean {
  return text
    .split("\n")
    .map((line) => /^\s*nameserver\s+(\S+)/.exec(line)?.[1])
    .some((addr) => addr !== undefined && isLoopbackHost(addr));
}

/** The host resolv.conf with its nameservers swapped for {@link PASTA_DNS}. */
export function sandboxResolvConf(text: string): string {
  const kept = text.split("\n").filter((line) => !/^\s*nameserver\s/.test(line) && line.trim());
  return [`nameserver ${PASTA_DNS}`, ...kept, ""].join("\n");
}

export type BwrapNetwork = {
  /** Host loopback ports forwarded into the namespace. */
  loopbackPorts: number[];
  /** Replacement `/etc/resolv.conf` (a file outside the sandbox) when DNS needs forwarding. */
  resolvConf?: string;
};

/**
 * pasta argv: a fresh user + network namespace with egress, but no host loopback except
 * `loopbackPorts`. `-T` must be explicit: its default (`auto`) would forward every port the
 * host is listening on, the control plane included.
 */
export function pastaArgs(net: BwrapNetwork): string[] {
  const ports = uniquePorts(net.loopbackPorts);
  return [
    "--config-net",
    "--quiet",
    // Without this the gateway address is NAT'ed to the host's loopback.
    "--no-map-gw",
    "-t",
    "none",
    "-u",
    "none",
    "-T",
    ports.length ? ports.join(",") : "none",
    "-U",
    "none",
    ...(net.resolvConf ? ["--dns-forward", PASTA_DNS] : []),
  ];
}

/**
 * bubblewrap argv: whole host visible, fresh /proc, `<LOCUS_HOME>` replaced by an empty tmpfs.
 * With `isolateHome`, the home directory and `hide` paths become empty tmpfs too, and only
 * {@link cliHomeBinds} come back, before the workspace.
 */
export function bwrapArgs(
  policy: CliSandboxPolicy,
  req: CliSpawnArgv,
  net?: BwrapNetwork,
): string[] {
  const home = real(policy.locusHome);
  const workspace = real(policy.workspace);
  const iso = policy.isolateHome;
  const userHome = iso ? real(iso.home) : undefined;
  const hidden: string[] = [];
  if (userHome) hidden.push("--tmpfs", userHome);
  // Inside a tmpfs home, LOCUS_HOME is already gone.
  if (!userHome || !within(home, userHome)) hidden.push("--tmpfs", home);
  for (const dir of iso?.hide ?? []) hidden.push("--tmpfs", real(dir));
  for (const bind of cliHomeBinds(policy)) {
    hidden.push(bind.write ? "--bind-try" : "--ro-bind-try", bind.src, bind.dest);
  }
  const inner = [
    "--die-with-parent",
    "--new-session",
    // A private PID namespace + fresh /proc so /proc/<locus-pid>/root and /environ
    // cannot be used to walk around the tmpfs or read the control plane's env.
    "--unshare-pid",
    "--dev-bind",
    "/",
    "/",
    "--proc",
    "/proc",
    ...(net?.resolvConf ? ["--ro-bind", net.resolvConf, "/etc/resolv.conf"] : []),
    ...hidden,
    "--bind",
    workspace,
    workspace,
    "--chdir",
    real(req.cwd),
    "--",
    req.command,
    ...req.args,
  ];
  return net ? [...pastaArgs(net), "--", "bwrap", ...inner] : inner;
}

function sbplString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * macOS Seatbelt profile. Later rules win, so the workspace allow overrides the home deny
 * and the allowed loopback ports override the loopback deny. With `isolateHome` the user's
 * home and `hide` paths are denied too, {@link cliHomeBinds} are allowed again (read-only ones
 * for reading only), and the secret paths and `<LOCUS_HOME>` are denied once more after them.
 */
export function seatbeltProfile(policy: CliSandboxPolicy, isolateNetwork = false): string {
  const home = real(policy.locusHome);
  const workspace = real(policy.workspace);
  const deny = (path: string) => `(deny file-read* file-write* (subpath ${sbplString(path)}))`;
  const lines = ["(version 1)", "(allow default)"];
  const iso = policy.isolateHome;
  const userHome = iso ? real(iso.home) : undefined;
  if (iso && userHome) {
    lines.push(deny(userHome), ...(iso.hide ?? []).map((dir) => deny(real(dir))));
  }
  lines.push(deny(home));
  if (iso && userHome) {
    const binds = cliHomeBinds(policy);
    // Path lookups walk through the home and the folders between it and each allowed path.
    const walk = new Set<string>([userHome]);
    for (const bind of binds) {
      for (let dir = dirname(bind.dest); dir !== userHome && within(dir, userHome);) {
        walk.add(dir);
        dir = dirname(dir);
      }
    }
    for (const dir of walk) lines.push(`(allow file-read-metadata (literal ${sbplString(dir)}))`);
    for (const bind of binds) {
      const ops = bind.write ? "file-read* file-write*" : "file-read*";
      for (const path of new Set([bind.dest, bind.src])) {
        lines.push(`(allow ${ops} (subpath ${sbplString(path)}))`);
      }
    }
    lines.push(...CLI_SANDBOX_SECRET_HOME_PATHS.map((secret) => deny(join(userHome, secret))));
    lines.push(deny(home));
  }
  lines.push(`(allow file-read* file-write* (subpath ${sbplString(workspace)}))`);
  if (isolateNetwork) {
    lines.push('(deny network-outbound (remote ip "localhost:*"))');
    for (const port of uniquePorts(policy.loopbackPorts)) {
      lines.push(`(allow network-outbound (remote ip "localhost:${port}"))`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

/** Where the sandbox's resolv.conf lives. Outside the tmpfs view, read by bwrap before it. */
function writeSandboxResolvConf(locusHome: string): string | undefined {
  let text: string;
  try {
    text = readFileSync("/etc/resolv.conf", "utf8");
  } catch {
    return undefined;
  }
  if (!resolvConfUsesLoopback(text)) return undefined;
  const dir = join(locusHome, "cli-sandbox");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "resolv.conf");
  writeFileSync(file, sandboxResolvConf(text));
  return file;
}

export function wrapCliSpawnRequest<T extends CliSpawnArgv>(
  backend: CliSandboxBackend,
  policy: CliSandboxPolicy,
  req: T,
  opts: { isolateNetwork?: boolean; resolvConf?: string } = {},
): T {
  const env = scrubCliEnv(req.env);
  const isolate = opts.isolateNetwork ?? false;
  if (backend === "bwrap") {
    if (!isolate) return { ...req, env, command: "bwrap", args: bwrapArgs(policy, req) };
    return {
      ...req,
      env,
      command: "pasta",
      args: bwrapArgs(policy, req, {
        loopbackPorts: policy.loopbackPorts ?? [],
        resolvConf: opts.resolvConf,
      }),
    };
  }
  return {
    ...req,
    env,
    command: "/usr/bin/sandbox-exec",
    args: ["-p", seatbeltProfile(policy, isolate), req.command, ...req.args],
  };
}

type Probe = { backend?: CliSandboxBackend; reason?: string };
const probed = new Map<string, Probe>();

/** Find a working sandbox on this machine. Cached; bwrap and pasta are probed because userns can be off. */
export function detectCliSandboxBackend(
  platform: NodeJS.Platform = process.platform,
  opts: { network?: boolean } = {},
): Probe {
  const network = opts.network ?? false;
  if (platform !== process.platform) return probe(platform, network);
  const key = `${platform}:${network}`;
  let found = probed.get(key);
  if (!found) {
    found = probe(platform, network);
    probed.set(key, found);
  }
  return found;
}

const BWRAP_PROBE = [
  "--die-with-parent",
  "--unshare-pid",
  "--dev-bind",
  "/",
  "/",
  "--proc",
  "/proc",
  "true",
];

function probe(platform: NodeJS.Platform, network: boolean): Probe {
  if (platform === "darwin") {
    return existsSync("/usr/bin/sandbox-exec")
      ? { backend: "sandbox-exec" }
      : { reason: "/usr/bin/sandbox-exec is missing." };
  }
  if (platform === "linux") {
    const run = spawnSync("bwrap", BWRAP_PROBE, {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 5_000,
    });
    if (run.error) return { reason: "bubblewrap (bwrap) is not installed." };
    if (run.status !== 0) {
      const err = String(run.stderr ?? "").trim();
      return {
        reason: `bubblewrap (bwrap) cannot create a sandbox here${err ? `: ${err}` : ""}. Unprivileged user namespaces may be disabled.`,
      };
    }
    if (!network) return { backend: "bwrap" };
    const net = spawnSync(
      "pasta",
      [...pastaArgs({ loopbackPorts: [] }), "--", "bwrap", ...BWRAP_PROBE],
      { stdio: ["ignore", "ignore", "pipe"], timeout: 10_000 },
    );
    if ((net.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return {
        reason:
          "pasta (package passt) is not installed. It gives the CLI its own network namespace so it cannot reach the Locus control plane.",
      };
    }
    // pasta can hang after a setup failure (no /dev/net/tun), so a timeout is a failure too.
    if (net.error || net.status !== 0) {
      const err = String(net.stderr ?? "")
        .split("\n")
        .filter((line) => line.trim() && !/syslog/i.test(line))
        .join(" ")
        .trim();
      return {
        reason: `pasta cannot create a network namespace here${err ? `: ${err}` : ""}. It needs /dev/net/tun and unprivileged user namespaces, and Locus must not run as root.`,
      };
    }
    return { backend: "bwrap" };
  }
  return { reason: `No CLI sandbox is available on ${platform}.` };
}

/**
 * `undefined` when the operator opted out, `{ ok: false }` (fail closed) when this machine
 * has no working sandbox, else a `wrap` that rewrites a spawn to run inside it.
 *
 * `where` names the machine in the failure message ("this machine", "this worker").
 * `network: true` also isolates the network (see the module comment).
 */
export function resolveCliSandbox(
  policy: CliSandboxPolicy,
  opts: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    where?: string;
    network?: boolean;
    /** Replaces the failure message's opening ("CLI agents on Docker sessions run on …"). */
    purpose?: string;
    /** Tests: skip probing this machine. */
    detect?: typeof detectCliSandboxBackend;
  } = {},
): ResolvedCliSandbox | undefined {
  const env = opts.env ?? process.env;
  if (cliSandboxDisabled(env)) return undefined;
  const isolateNetwork = Boolean(opts.network) && !cliSandboxSharesHostNetwork(env);
  const found = (opts.detect ?? detectCliSandboxBackend)(opts.platform, {
    network: isolateNetwork,
  });
  if (!found.backend) {
    const where = opts.where ?? "this machine";
    const install = opts.network
      ? `Install bubblewrap and passt (Linux), set LOCUS_CLI_SANDBOX_NET=host to keep only the ` +
        `filesystem sandbox, or LOCUS_CLI_SANDBOX=off to run unsandboxed (see SECURITY.md).`
      : `Install bubblewrap (Linux) or set LOCUS_CLI_SANDBOX=off to run unsandboxed (see SECURITY.md).`;
    return {
      ok: false,
      reason: `${
        opts.purpose ??
        `CLI agents on Docker sessions run on ${where} and are sandboxed so they cannot read ` +
          `other sessions or Locus config${opts.network ? ", or call the Locus control plane" : ""}.`
      } ${found.reason ?? ""} ${install}`,
    };
  }
  const allowed = cliSandboxAllowedPorts(env);
  if (isolateNetwork) {
    // A loopback proxy would be unreachable, so every provider call would fail. Forwarding
    // it silently is no better: the proxy can connect to the control plane for the CLI.
    const blocked = loopbackProxyPorts(env).filter((port) => !allowed.includes(port));
    if (blocked.length) {
      return {
        ok: false,
        reason:
          `This machine's proxy is on loopback port ${blocked.join(", ")}, which the CLI sandbox ` +
          `blocks. If that proxy refuses loopback targets, allow it with ` +
          `LOCUS_CLI_SANDBOX_ALLOW_PORTS=${blocked.join(",")}. Otherwise set ` +
          `LOCUS_CLI_SANDBOX_NET=host (see docs/cli-agent-sandbox.md).`,
      };
    }
  }
  const backend = found.backend;
  const effective: CliSandboxPolicy = {
    ...policy,
    loopbackPorts: uniquePorts([...(policy.loopbackPorts ?? []), ...allowed]),
  };
  return {
    ok: true,
    backend,
    isolatesNetwork: isolateNetwork,
    wrap: (req) => {
      const resolvConf =
        backend === "bwrap" && isolateNetwork
          ? writeSandboxResolvConf(policy.locusHome)
          : undefined;
      // A hidden home also hides a CLI installed under it: bind its install back read-only.
      const iso = effective.isolateHome;
      const withInstall: CliSandboxPolicy = iso
        ? {
            ...effective,
            isolateHome: {
              ...iso,
              readOnly: [
                ...(iso.readOnly ?? []),
                ...cliInstallDirs(req.command, req.env, iso.home),
              ],
            },
          }
        : effective;
      return wrapCliSpawnRequest(backend, withInstall, req, { isolateNetwork, resolvConf });
    },
  };
}
