import { describe, expect, it } from "vitest";
import {
  PASTA_DNS,
  bwrapArgs,
  cliSandboxAllowedPorts,
  cliSandboxDisabled,
  loopbackProxyPorts,
  pastaArgs,
  resolvConfUsesLoopback,
  sandboxResolvConf,
  resolveCliSandbox,
  scrubCliEnv,
  seatbeltProfile,
  wrapCliSpawnRequest,
} from "./cliSandbox.js";

const policy = { locusHome: "/home/op/.locus", workspace: "/home/op/.locus/docker-workspaces/s1" };
const req = {
  command: "kiro-cli",
  args: ["chat", "--no-interactive", "hi"],
  cwd: "/home/op/.locus/docker-workspaces/s1",
  env: { PATH: "/usr/bin", LOCUS_MASTER_KEY: "k", LOCUS_GIT_MCP_URL: "http://127.0.0.1:7420/mcp" },
};

const mac = () => ({ backend: "sandbox-exec" as const });

describe("cliSandbox", () => {
  it("hides LOCUS_HOME behind a tmpfs, re-binds the workspace, and remounts /proc", () => {
    const args = bwrapArgs(policy, req);
    const at = (flag: string) => args.indexOf(flag);
    expect(args.slice(at("--tmpfs"), at("--tmpfs") + 2)).toEqual(["--tmpfs", policy.locusHome]);
    expect(args.slice(at("--bind"), at("--bind") + 3)).toEqual([
      "--bind",
      policy.workspace,
      policy.workspace,
    ]);
    // The workspace bind must come after the tmpfs or it would be covered by it.
    expect(at("--bind")).toBeGreaterThan(at("--tmpfs"));
    expect(args).toContain("--unshare-pid");
    expect(args.slice(at("--proc"), at("--proc") + 2)).toEqual(["--proc", "/proc"]);
    expect(args.slice(at("--"))).toEqual(["--", "kiro-cli", "chat", "--no-interactive", "hi"]);
  });

  it("writes a Seatbelt profile that denies LOCUS_HOME but allows the workspace", () => {
    const profile = seatbeltProfile({ locusHome: '/Users/o"p/.locus', workspace: "/w" });
    expect(profile).toContain('(deny file-read* file-write* (subpath "/Users/o\\"p/.locus"))');
    expect(profile.indexOf('(allow file-read* file-write* (subpath "/w"))')).toBeGreaterThan(
      profile.indexOf("(deny"),
    );
    const wrapped = wrapCliSpawnRequest("sandbox-exec", policy, req, { isolateNetwork: false });
    expect(wrapped.command).toBe("/usr/bin/sandbox-exec");
    expect(wrapped.args[1]).not.toContain("network-outbound");
    expect(wrapped.args.slice(2)).toEqual(["kiro-cli", "chat", "--no-interactive", "hi"]);
  });

  it("drops Locus secrets from the CLI env but keeps the MCP URL", () => {
    const env = scrubCliEnv({
      ...req.env,
      LOCUS_WORKER_TOKEN: "t",
      LOCUS_GIPHY_API_KEY: "g",
      CURSOR_API_KEY: "provider-key",
    });
    expect(env).toEqual({
      PATH: "/usr/bin",
      LOCUS_GIT_MCP_URL: "http://127.0.0.1:7420/mcp",
      CURSOR_API_KEY: "provider-key",
    });
    expect(wrapCliSpawnRequest("bwrap", policy, req).env.LOCUS_MASTER_KEY).toBeUndefined();
  });

  it("honours LOCUS_CLI_SANDBOX=off and fails closed with a reason elsewhere", () => {
    expect(cliSandboxDisabled({ LOCUS_CLI_SANDBOX: "off" })).toBe(true);
    expect(cliSandboxDisabled({})).toBe(false);
    expect(resolveCliSandbox(policy, { env: { LOCUS_CLI_SANDBOX: "off" } })).toBeUndefined();
    const none = resolveCliSandbox(policy, { env: {}, platform: "win32" });
    expect(none?.ok).toBe(false);
    if (none && !none.ok) expect(none.reason).toMatch(/LOCUS_CLI_SANDBOX=off/);
  });

  it("puts bwrap in a pasta network namespace that forwards only the allowed loopback ports", () => {
    const wrapped = wrapCliSpawnRequest("bwrap", { ...policy, loopbackPorts: [40001] }, req, {
      isolateNetwork: true,
    });
    expect(wrapped.command).toBe("pasta");
    const split = wrapped.args.indexOf("--");
    const pasta = wrapped.args.slice(0, split);
    // -T must be explicit: pasta's default (auto) forwards every host port, the control plane too.
    expect(pasta.slice(pasta.indexOf("-T"), pasta.indexOf("-T") + 2)).toEqual(["-T", "40001"]);
    expect(pasta.slice(pasta.indexOf("-U"), pasta.indexOf("-U") + 2)).toEqual(["-U", "none"]);
    expect(pasta.slice(pasta.indexOf("-t"), pasta.indexOf("-t") + 2)).toEqual(["-t", "none"]);
    expect(pasta).toContain("--no-map-gw");
    expect(wrapped.args[split + 1]).toBe("bwrap");
    expect(wrapped.args.slice(split + 2)).toEqual(bwrapArgs(policy, req));
    expect(pastaArgs({ loopbackPorts: [] })).toEqual(expect.arrayContaining(["-T", "none"]));
    expect(pastaArgs({ loopbackPorts: [9, 7, 9] })).toEqual(expect.arrayContaining(["-T", "7,9"]));
  });

  it("forwards DNS through pasta when the host resolver is on loopback", () => {
    const host = "# stub\nnameserver 127.0.0.53\noptions edns0 trust-ad\nsearch lan\n";
    expect(resolvConfUsesLoopback(host)).toBe(true);
    expect(resolvConfUsesLoopback("nameserver 1.1.1.1\n")).toBe(false);
    expect(sandboxResolvConf(host)).toBe(
      `nameserver ${PASTA_DNS}\n# stub\noptions edns0 trust-ad\nsearch lan\n`,
    );
    const args = bwrapArgs(policy, req, { loopbackPorts: [1], resolvConf: "/x/resolv.conf" });
    expect(args).toEqual(expect.arrayContaining(["--dns-forward", PASTA_DNS]));
    const at = args.indexOf("--ro-bind");
    expect(args.slice(at, at + 3)).toEqual(["--ro-bind", "/x/resolv.conf", "/etc/resolv.conf"]);
  });

  it("denies host loopback on macOS except the allowed ports", () => {
    const profile = seatbeltProfile({ ...policy, loopbackPorts: [40001] }, true);
    const deny = profile.indexOf('(deny network-outbound (remote ip "localhost:*"))');
    const allow = profile.indexOf('(allow network-outbound (remote ip "localhost:40001"))');
    expect(deny).toBeGreaterThan(-1);
    expect(allow).toBeGreaterThan(deny);
  });

  it("finds loopback proxies and parses allowed ports", () => {
    expect(
      loopbackProxyPorts({
        HTTPS_PROXY: "http://127.0.0.1:3128",
        http_proxy: "localhost:8080",
        ALL_PROXY: "socks5://[::1]",
        NO_PROXY: "127.0.0.1:9",
      }).sort(),
    ).toEqual([1080, 3128, 8080]);
    expect(loopbackProxyPorts({ HTTPS_PROXY: "http://proxy.corp:3128" })).toEqual([]);
    expect(cliSandboxAllowedPorts({ LOCUS_CLI_SANDBOX_ALLOW_PORTS: "3128, 8080,x,0" })).toEqual([
      3128, 8080,
    ]);
  });

  it("fails closed on a loopback proxy unless its port is allowed", () => {
    const env = { HTTPS_PROXY: "http://127.0.0.1:3128" };
    const blocked = resolveCliSandbox(policy, {
      env,
      platform: "darwin",
      detect: mac,
      network: true,
    });
    if (blocked?.ok !== false) throw new Error("expected a refusal");
    expect(blocked.reason).toMatch(/LOCUS_CLI_SANDBOX_ALLOW_PORTS=3128/);

    const allowed = resolveCliSandbox(
      { ...policy, loopbackPorts: [40001] },
      {
        env: { ...env, LOCUS_CLI_SANDBOX_ALLOW_PORTS: "3128" },
        platform: "darwin",
        detect: mac,
        network: true,
      },
    );
    if (!allowed?.ok) throw new Error("expected a sandbox");
    const profile = allowed.wrap(req).args[1];
    expect(profile).toContain('(allow network-outbound (remote ip "localhost:3128"))');
    expect(profile).toContain('(allow network-outbound (remote ip "localhost:40001"))');

    const shared = resolveCliSandbox(policy, {
      env: { ...env, LOCUS_CLI_SANDBOX_NET: "host" },
      platform: "darwin",
      detect: mac,
      network: true,
    });
    if (!shared?.ok) throw new Error("expected a sandbox");
    expect(shared.isolatesNetwork).toBe(false);
  });
});

describe("cliSandbox network is opt-in", () => {
  it("leaves the network alone unless the caller asks (the worker keeps its loopback MCP proxy)", () => {
    const sandbox = resolveCliSandbox(policy, {
      env: {},
      platform: "darwin",
      detect: () => ({ backend: "sandbox-exec" }),
    });
    if (!sandbox?.ok) throw new Error("expected a sandbox");
    expect(sandbox.isolatesNetwork).toBe(false);
    expect(sandbox.wrap(req).args[1]).not.toContain("network-outbound");
    expect(wrapCliSpawnRequest("bwrap", policy, req).command).toBe("bwrap");
  });
});
