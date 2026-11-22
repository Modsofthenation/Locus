import { describe, expect, it } from "vitest";
import type { AiProvider } from "@locus/shared";
import type { CursorCliSpawnRequest } from "@locus/providers";
import { ReviewSandboxError, reviewCliKind, reviewCliSpawner } from "./reviewSandbox.js";

const codex = { kind: "codex-cli", baseUrl: "codex-cli://local" } as AiProvider;
const api = { kind: "anthropic", baseUrl: "https://api.anthropic.com" } as AiProvider;
const base = {
  workspace: "/tmp/locus-oneshot-1",
  locusHome: "/home/op/.locus",
  home: "/home/op",
  platform: "linux" as const,
};
const req: CursorCliSpawnRequest = {
  command: "codex",
  args: ["exec"],
  cwd: base.workspace,
  env: {},
};

function capture() {
  const seen: CursorCliSpawnRequest[] = [];
  const spawn = (r: CursorCliSpawnRequest) => {
    seen.push(r);
    return { lines: (async function* () {})(), wait: async () => ({ code: 0, stderr: "" }) };
  };
  return { seen, spawn };
}

describe("reviewCliSpawner", () => {
  it("leaves API providers alone", () => {
    expect(reviewCliKind(api)).toBeUndefined();
    expect(reviewCliSpawner({ ...base, provider: api, env: {} })).toBeUndefined();
  });

  it("wraps a CLI in bwrap inside pasta with HOME, /tmp and the runtime dir hidden", () => {
    const { seen, spawn } = capture();
    const spawner = reviewCliSpawner({
      ...base,
      provider: codex,
      env: { XDG_RUNTIME_DIR: "/run/user/1000" },
      detect: () => ({ backend: "bwrap" }),
      spawn,
    });
    spawner!(req);
    const { command, args } = seen[0]!;
    expect(command).toBe("pasta");
    const tmpfs = args.flatMap((arg, i) => (arg === "--tmpfs" ? [args[i + 1]] : []));
    expect(tmpfs).toEqual(["/home/op", "/tmp", "/run/user/1000"]);
    expect(args).toEqual(
      expect.arrayContaining(["--bind-try", "/home/op/.codex", "/home/op/.codex"]),
    );
    expect(args).not.toContain("/home/op/.claude");
    expect(args.slice(args.indexOf("--bind"), args.indexOf("--bind") + 3)).toEqual([
      "--bind",
      base.workspace,
      base.workspace,
    ]);
  });

  it("uses a Seatbelt profile on macOS", () => {
    const { seen, spawn } = capture();
    reviewCliSpawner({
      ...base,
      home: "/Users/op",
      locusHome: "/Users/op/.locus",
      platform: "darwin",
      provider: codex,
      env: {},
      detect: () => ({ backend: "sandbox-exec" }),
      spawn,
    })!(req);
    expect(seen[0]!.command).toBe("/usr/bin/sandbox-exec");
    const profile = seen[0]!.args[1]!;
    expect(profile).toContain('(deny file-read* file-write* (subpath "/Users/op"))');
    expect(profile).toContain('(allow file-read* file-write* (subpath "/Users/op/.codex"))');
    expect(profile).toContain('(deny network-outbound (remote ip "localhost:*"))');
  });

  it("runs unsandboxed only with LOCUS_CLI_SANDBOX=off", () => {
    expect(
      reviewCliSpawner({
        ...base,
        provider: codex,
        env: { LOCUS_CLI_SANDBOX: "off" },
        detect: () => ({ reason: "never asked" }),
      }),
    ).toBeUndefined();
  });

  it("throws a ReviewSandboxError naming the package and the opt-out when no sandbox works", () => {
    let thrown: unknown;
    try {
      reviewCliSpawner({
        ...base,
        provider: codex,
        env: {},
        detect: () => ({ reason: "bubblewrap (bwrap) is not installed." }),
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ReviewSandboxError);
    const message = (thrown as Error).message;
    expect(message).toMatch(/bubblewrap \(bwrap\) is not installed/);
    expect(message).toMatch(/Install bubblewrap and passt/);
    expect(message).toMatch(/LOCUS_CLI_SANDBOX=off/);
  });

  it("refuses a loopback proxy unless its port is allowed", () => {
    expect(() =>
      reviewCliSpawner({
        ...base,
        provider: codex,
        env: { HTTPS_PROXY: "http://127.0.0.1:3128" },
        detect: () => ({ backend: "bwrap" }),
      }),
    ).toThrow(/LOCUS_CLI_SANDBOX_ALLOW_PORTS=3128/);
    const { seen, spawn } = capture();
    reviewCliSpawner({
      ...base,
      provider: codex,
      env: { HTTPS_PROXY: "http://127.0.0.1:3128", LOCUS_CLI_SANDBOX_ALLOW_PORTS: "3128" },
      detect: () => ({ backend: "bwrap" }),
      spawn,
    })!(req);
    const args = seen[0]!.args;
    expect(args.slice(args.indexOf("-T"), args.indexOf("-T") + 2)).toEqual(["-T", "3128"]);
  });
});
