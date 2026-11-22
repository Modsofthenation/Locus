import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLI_SANDBOX_SECRET_HOME_PATHS,
  bwrapArgs,
  cliHomeAllowList,
  cliHomeBinds,
  cliInstallDirs,
  resolveCliSandbox,
  seatbeltProfile,
  type CliSandboxPolicy,
} from "./cliSandbox.js";

const HOME = "/home/op";
const SECRETS = CLI_SANDBOX_SECRET_HOME_PATHS.map((p) => `${HOME}/${p}`);

const policy: CliSandboxPolicy = {
  locusHome: `${HOME}/.locus`,
  workspace: `${HOME}/.locus/slack-reviewers/checkouts/r1`,
  isolateHome: {
    home: HOME,
    readWrite: cliHomeAllowList("claude", { home: HOME, platform: "linux" }),
    readOnly: [`${HOME}/.local/bin`, `${HOME}/.nvm/versions/node/v22/bin`],
    hide: ["/tmp", "/run/user/1000"],
  },
};
const req = { command: "claude", args: ["-p", "hi"], cwd: policy.workspace, env: {} };

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("cliSandbox isolateHome", () => {
  it("hides HOME, /tmp and the runtime dir behind tmpfs and binds back only the CLI's paths", () => {
    const args = bwrapArgs(policy, req);
    const tmpfs = args.flatMap((arg, i) => (arg === "--tmpfs" ? [args[i + 1]] : []));
    // LOCUS_HOME is inside the hidden home, so the home tmpfs already covers it.
    expect(tmpfs).toEqual([HOME, "/tmp", "/run/user/1000"]);
    const triple = (flag: string) =>
      args.flatMap((arg, i) => (arg === flag ? [[args[i + 1], args[i + 2]]] : []));
    expect(triple("--bind-try")).toEqual([
      [`${HOME}/.claude`, `${HOME}/.claude`],
      [`${HOME}/.claude.json`, `${HOME}/.claude.json`],
      [`${HOME}/.config/claude`, `${HOME}/.config/claude`],
    ]);
    expect(triple("--ro-bind-try")).toEqual([
      [`${HOME}/.local/bin`, `${HOME}/.local/bin`],
      [`${HOME}/.nvm/versions/node/v22/bin`, `${HOME}/.nvm/versions/node/v22/bin`],
    ]);
    // Binds come after the tmpfs that hides them, and the workspace comes last.
    const lastTmpfs = args.lastIndexOf("--tmpfs");
    expect(args.indexOf("--ro-bind-try")).toBeGreaterThan(lastTmpfs);
    const ws = args.indexOf("--bind");
    expect(args.slice(ws, ws + 3)).toEqual(["--bind", policy.workspace, policy.workspace]);
    expect(ws).toBeGreaterThan(args.lastIndexOf("--bind-try"));
    for (const secret of SECRETS) expect(args).not.toContain(secret);
  });

  it("still hides LOCUS_HOME when it lives outside HOME", () => {
    const args = bwrapArgs(
      { ...policy, locusHome: "/srv/locus", workspace: "/srv/locus/c/r1" },
      req,
    );
    const tmpfs = args.flatMap((arg, i) => (arg === "--tmpfs" ? [args[i + 1]] : []));
    expect(tmpfs).toEqual([HOME, "/srv/locus", "/tmp", "/run/user/1000"]);
  });

  it("never binds a secret path, HOME itself, LOCUS_HOME, or anything outside HOME", () => {
    const binds = cliHomeBinds({
      ...policy,
      isolateHome: {
        home: HOME,
        readWrite: [
          HOME,
          `${HOME}/`,
          "/",
          "/etc",
          `${HOME}/.config`, // contains .config/gcloud and .config/gh
          `${HOME}/.local`, // contains .local/share/keyrings
          `${HOME}/.locus`,
          `${HOME}/.locus/config.json`,
          `${HOME}/.ssh/id_ed25519`,
          `${HOME}/../other/.codex`,
          "relative/.codex",
          ...SECRETS,
          `${HOME}/.codex`,
        ],
      },
    });
    expect(binds).toEqual([{ src: `${HOME}/.codex`, dest: `${HOME}/.codex`, write: true }]);
  });

  it("refuses an allowed path that is a symlink into a secret dir", () => {
    const home = mkdtempSync(join(tmpdir(), "locus-home-"));
    dirs.push(home);
    mkdirSync(join(home, ".ssh"));
    symlinkSync(join(home, ".ssh"), join(home, ".claude"));
    mkdirSync(join(home, ".codex"));
    const binds = cliHomeBinds({
      locusHome: join(home, ".locus"),
      workspace: "/w",
      isolateHome: { home, readWrite: [join(home, ".claude"), join(home, ".codex")] },
    });
    const real = realpathSync(home);
    expect(binds).toEqual([{ src: join(real, ".codex"), dest: join(real, ".codex"), write: true }]);
  });

  it("allows each CLI only its own login paths", () => {
    const linux = (kind: Parameters<typeof cliHomeAllowList>[0], command?: string) =>
      cliHomeAllowList(kind, { home: HOME, platform: "linux", env: {}, command });
    expect(linux("claude")).toEqual([
      `${HOME}/.claude`,
      `${HOME}/.claude.json`,
      `${HOME}/.config/claude`,
    ]);
    expect(linux("codex")).toEqual([`${HOME}/.codex`]);
    expect(linux("cursor")).toEqual([`${HOME}/.cursor`, `${HOME}/.config/cursor`]);
    expect(linux("kiro")).toContain(`${HOME}/.kiro`);
    expect(linux("generic", "/usr/local/bin/gemini")).toEqual([
      `${HOME}/.gemini`,
      `${HOME}/.config/gemini`,
      `${HOME}/.local/share/gemini`,
    ]);
    expect(
      cliHomeAllowList("codex", {
        home: HOME,
        platform: "linux",
        env: { CODEX_HOME: "/data/codex" },
      }),
    ).toContain("/data/codex");
    expect(cliHomeAllowList("claude", { home: "/Users/op", platform: "darwin" })).toContain(
      "/Users/op/Library/Keychains",
    );
    // A custom CLI named after a secret store gets nothing for it.
    const ssh = cliHomeBinds({
      ...policy,
      isolateHome: { home: HOME, readWrite: linux("generic", "ssh") },
    });
    expect(ssh.map((bind) => bind.dest)).toEqual([
      `${HOME}/.config/ssh`,
      `${HOME}/.local/share/ssh`,
      `${HOME}/.gemini`,
    ]);
  });

  it("writes a Seatbelt profile that denies HOME and allows only the CLI's paths back", () => {
    const mac: CliSandboxPolicy = {
      locusHome: "/Users/op/.locus",
      workspace: "/var/folders/x/T/locus-oneshot-1",
      loopbackPorts: [],
      isolateHome: {
        home: "/Users/op",
        readWrite: cliHomeAllowList("claude", { home: "/Users/op", platform: "darwin" }),
        readOnly: ["/Users/op/.local/bin"],
      },
    };
    const profile = seatbeltProfile(mac, true);
    const line = (text: string) => profile.indexOf(text);
    const denyHome = line('(deny file-read* file-write* (subpath "/Users/op"))');
    expect(denyHome).toBeGreaterThan(-1);
    const allowClaude = line('(allow file-read* file-write* (subpath "/Users/op/.claude"))');
    expect(allowClaude).toBeGreaterThan(denyHome);
    expect(profile).toContain('(allow file-read* (subpath "/Users/op/.local/bin"))');
    expect(profile).not.toContain(
      '(allow file-read* file-write* (subpath "/Users/op/.local/bin"))',
    );
    expect(profile).toContain('(allow file-read-metadata (literal "/Users/op"))');
    expect(profile).toContain('(allow file-read-metadata (literal "/Users/op/.local"))');
    // Secrets and LOCUS_HOME are denied again after the allows; the workspace is allowed last.
    const denySsh = line('(deny file-read* file-write* (subpath "/Users/op/.ssh"))');
    expect(denySsh).toBeGreaterThan(allowClaude);
    expect(
      profile.lastIndexOf('(deny file-read* file-write* (subpath "/Users/op/.locus"))'),
    ).toBeGreaterThan(allowClaude);
    for (const secret of CLI_SANDBOX_SECRET_HOME_PATHS) {
      expect(profile).not.toMatch(
        new RegExp(`\\(allow [^)]*"/Users/op/${secret.replace(/\./g, "\\.")}"`),
      );
    }
    expect(
      line('(allow file-read* file-write* (subpath "/var/folders/x/T/locus-oneshot-1"))'),
    ).toBeGreaterThan(denySsh);
    expect(profile).toContain('(deny network-outbound (remote ip "localhost:*"))');
  });

  it("binds back a CLI installed under HOME, read-only, when it wraps a spawn", () => {
    const home = mkdtempSync(join(tmpdir(), "locus-home-"));
    dirs.push(home);
    const bin = join(home, ".local", "bin");
    const pkg = join(home, ".npm-global", "lib", "node_modules", "@acme", "agent");
    mkdirSync(bin, { recursive: true });
    mkdirSync(join(pkg, "dist"), { recursive: true });
    writeFileSync(join(pkg, "dist", "cli.js"), "#!/usr/bin/env node\n");
    chmodSync(join(pkg, "dist", "cli.js"), 0o755);
    symlinkSync(join(pkg, "dist", "cli.js"), join(bin, "agent"));
    const env = { PATH: `${bin}:/usr/bin:/bin` };
    const real = realpathSync(home);
    const dirsFound = cliInstallDirs("agent", env, home);
    expect(dirsFound).toContain(bin);
    expect(dirsFound).toContain(join(real, ".npm-global", "lib", "node_modules", "@acme", "agent"));
    // A CLI outside HOME adds nothing.
    expect(cliInstallDirs("sh", { PATH: "/usr/bin:/bin" }, home)).toEqual([]);

    const sandbox = resolveCliSandbox(
      { locusHome: join(home, ".locus"), workspace: "/w", isolateHome: { home, readWrite: [] } },
      { env: {}, platform: "linux", network: true, detect: () => ({ backend: "bwrap" }) },
    );
    if (!sandbox?.ok) throw new Error("expected a sandbox");
    const wrapped = sandbox.wrap({ command: "agent", args: [] as string[], cwd: "/w", env });
    expect(wrapped.command).toBe("pasta");
    const at = wrapped.args.indexOf("--ro-bind-try");
    expect(at).toBeGreaterThan(-1);
    expect(wrapped.args).toContain(
      join(real, ".npm-global", "lib", "node_modules", "@acme", "agent"),
    );
    // No host loopback port is forwarded: the reviewer has no MCP gateway.
    const T = wrapped.args.indexOf("-T");
    expect(wrapped.args.slice(T, T + 2)).toEqual(["-T", "none"]);
  });

  it("names the purpose, the missing package and the opt-out when no sandbox works", () => {
    const none = resolveCliSandbox(policy, {
      env: {},
      platform: "linux",
      network: true,
      purpose: "The reviewer runs CLIs sandboxed.",
      detect: () => ({ reason: "pasta (package passt) is not installed." }),
    });
    if (none?.ok !== false) throw new Error("expected a refusal");
    expect(none.reason).toMatch(/^The reviewer runs CLIs sandboxed\. pasta \(package passt\)/);
    expect(none.reason).toMatch(/bubblewrap and passt/);
    expect(none.reason).toMatch(/LOCUS_CLI_SANDBOX=off/);
  });
});
