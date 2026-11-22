import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./index.js";
import { PASSPHRASE_ENV } from "./maintenance.js";

type Handler = (req: IncomingMessage, url: URL, body: unknown) => unknown;
const closers: Array<() => Promise<void>> = [];
const savedPass = process.env[PASSPHRASE_ENV];

afterEach(async () => {
  if (savedPass == null) delete process.env[PASSPHRASE_ENV];
  else process.env[PASSPHRASE_ENV] = savedPass;
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function mock(handlers: Record<string, Handler>) {
  const bodies: Record<string, unknown> = {};
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const key = `${req.method} ${url.pathname}`;
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
      bodies[key] = body;
      const handler = handlers[key];
      res.writeHead(handler ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(handler ? handler(req, url, body) : { error: `no mock ${key}` }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => new Promise((r) => server.close(() => r())));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, bodies };
}

describe("locus backup / restore", () => {
  it("backs up with the passphrase from the environment", async () => {
    process.env[PASSPHRASE_ENV] = "correct horse";
    const api = await mock({
      "POST /api/backup": () => ({
        path: "/home/me/x.locusbak",
        sizeBytes: 2048,
        manifest: { files: 12, bytes: 4096, includeDisks: false, skipped: [] },
      }),
    });
    const out = await runCli(["--api", api.url, "backup", "x.locusbak"]);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout).toMatch(/Backed up 12 files/);
    expect(out.stdout).toMatch(/--include-disks/);
    expect(api.bodies["POST /api/backup"]).toMatchObject({
      passphrase: "correct horse",
      includeDisks: false,
    });
    expect((api.bodies["POST /api/backup"] as { out: string }).out).toMatch(/x\.locusbak$/);
  });

  it("refuses to prompt without a terminal", async () => {
    delete process.env[PASSPHRASE_ENV];
    const api = await mock({});
    const out = await runCli(["--api", api.url, "backup"]);
    expect(out.code).not.toBe(0);
    expect(out.stderr).toMatch(/LOCUS_BACKUP_PASSPHRASE/);
  });

  it("asks for --yes before staging a restore, then stages it", async () => {
    process.env[PASSPHRASE_ENV] = "correct horse";
    const api = await mock({
      "POST /api/restore": () => ({ files: 9, manifest: { createdAt: "2026-11-01T00:00:00Z" } }),
    });
    const refused = await runCli(["--api", api.url, "restore", "b.locusbak"]);
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toMatch(/--yes/);
    const ok = await runCli(["--api", api.url, "restore", "b.locusbak", "--yes"]);
    expect(ok.code, ok.stderr).toBe(0);
    expect(ok.stdout).toMatch(/Staged 9 files/);
    expect(ok.stdout).toMatch(/reopen Locus/);
  });
});

describe("locus update", () => {
  it("reports an available release", async () => {
    const api = await mock({
      "GET /api/updates": (_req, url) => {
        expect(url.searchParams.get("refresh")).toBe("1");
        return {
          status: "available",
          current: "0.20.0",
          latest: "v0.21.0",
          asset: { name: "Locus-0.21.0.AppImage", url: "u" },
          checksums: { name: "SHA256SUMS-linux", url: "s" },
        };
      },
    });
    const out = await runCli(["--api", api.url, "update"]);
    expect(out.stdout).toMatch(/Locus 0\.21\.0 is available/);
    expect(out.stdout).toMatch(/locus update download/);
  });
});

describe("locus eval", () => {
  it("starts a run with parsed provider/model targets", async () => {
    const api = await mock({
      "POST /api/benchmarks": (_r, _u, body) => ({
        id: "bench-1",
        status: "running",
        results: [{}, {}],
        targets: (body as { targets: unknown[] }).targets,
        summary: [],
      }),
    });
    const out = await runCli([
      "--api",
      api.url,
      "eval",
      "run",
      "--model",
      "openrouter/anthropic/claude,ollama/qwen3",
      "--case",
      "fix-add",
    ]);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout).toMatch(/Started bench-1/);
    expect(api.bodies["POST /api/benchmarks"]).toMatchObject({
      targets: [
        { providerId: "openrouter", model: "anthropic/claude" },
        { providerId: "ollama", model: "qwen3" },
      ],
      caseIds: ["fix-add"],
    });
  });

  it("rejects a target without a provider", async () => {
    const api = await mock({});
    const out = await runCli(["--api", api.url, "eval", "run", "--model", "gpt-5"]);
    expect(out.code).not.toBe(0);
    expect(out.stderr).toMatch(/provider\/model/);
  });

  it("lists the built-in cases", async () => {
    const out = await runCli(["eval", "cases"]);
    expect(out.stdout).toMatch(/fix-add/);
    expect(out.stdout).toMatch(/cross-file-feature/);
  });
});

describe("locus bench", () => {
  it("lists server cases with kind and language", async () => {
    const api = await mock({
      "GET /api/benchmarks/cases": () => ({
        cases: [
          { id: "fix-add", title: "Fix a one-line bug", kind: "toy" },
          { id: "go-wordwrap", title: "Word wrap", kind: "spec", language: "go" },
        ],
        errors: ["bad.json: id is required"],
      }),
    });
    const out = await runCli(["--api", api.url, "bench", "cases"]);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout).toMatch(/go-wordwrap\s+spec\s+go/);
    expect(out.stdout).toMatch(/! bad\.json: id is required/);
  });

  it("prints history per model and harness version", async () => {
    const api = await mock({
      "GET /api/benchmarks/history": () => ({
        rows: [
          {
            providerId: "openai",
            model: "gpt-5",
            harnessVersion: "0.20.0+abc1234.deadbeef",
            runs: 2,
            runIds: ["a", "b"],
            cases: 10,
            passed: 7,
            passRate: 0.7,
            usdPerCase: 0.02,
            medianMs: 42_000,
            tokens: 1000,
            firstAt: "2026-11-01T00:00:00Z",
            lastAt: "2026-11-08T00:00:00Z",
          },
        ],
      }),
    });
    const out = await runCli(["--api", api.url, "bench", "history"]);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout).toMatch(/openai\/gpt-5/);
    expect(out.stdout).toMatch(/0\.20\.0\+abc1234\.deadbeef/);
    expect(out.stdout).toMatch(/7\/10/);
    expect(out.stdout).toMatch(/70%/);
  });

  it("compares two runs and hides unchanged cases unless --all", async () => {
    const api = await mock({
      "GET /api/benchmarks/compare": (_r, url) => {
        expect(url.searchParams.get("a")).toBe("r1");
        expect(url.searchParams.get("b")).toBe("r2");
        return {
          a: { id: "r1", harnessVersion: "h1", passRate: 0.5, cases: 2 },
          b: { id: "r2", harnessVersion: "h2", passRate: 0.5, cases: 2 },
          rows: [
            { caseId: "x", target: "p/m", before: 1, after: 0, change: "broke" },
            { caseId: "z", target: "p/m", before: 1, after: 1, change: "still-passing" },
          ],
          fixed: 0,
          broke: 1,
        };
      },
    });
    const out = await runCli(["--api", api.url, "bench", "compare", "r1", "r2"]);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout).toMatch(/0 fixed · 1 broke/);
    expect(out.stdout).toMatch(/x .*broke/);
    expect(out.stdout).not.toMatch(/still-passing/);
    const all = await runCli(["--api", api.url, "bench", "compare", "r1", "r2", "--all"]);
    expect(all.stdout).toMatch(/still-passing/);
  });

  it("mines a repo, polls the job and reports kept specs", async () => {
    let polls = 0;
    const api = await mock({
      "POST /api/benchmarks/mine": () => ({
        id: "mine-1",
        status: "running",
        repo: "/r",
        progress: ["Scanned 40 commits, 3 candidates."],
      }),
      "GET /api/benchmarks/mine/mine-1": () => {
        polls += 1;
        return {
          id: "mine-1",
          status: "done",
          repo: "/r",
          progress: [
            "Scanned 40 commits, 3 candidates.",
            "✓ abc1234 fix rounding — 1 fail-to-pass",
          ],
          result: {
            scanned: 40,
            outDir: "/r/.locus/benchmarks",
            specs: [{ id: "r-abc1234" }],
            candidates: [
              {
                sha: "abc1234ffff",
                subject: "fix rounding",
                kept: true,
                reason: "ok",
                file: "/r/.locus/benchmarks/r-abc1234.json",
              },
              { sha: "def5678ffff", subject: "refactor", kept: false, reason: "already pass" },
            ],
          },
        };
      },
    });
    const out = await runCli([
      "--api",
      api.url,
      "bench",
      "mine",
      "/r",
      "--since",
      "6 months ago",
      "--limit",
      "3",
      "--no-setup",
      "--poll-ms",
      "1",
    ]);
    expect(out.code, out.stderr).toBe(0);
    expect(polls).toBe(1);
    expect(api.bodies["POST /api/benchmarks/mine"]).toMatchObject({
      repo: "/r",
      since: "6 months ago",
      limit: 3,
      setup: null,
    });
    expect(out.stderr).toMatch(/✓ abc1234 fix rounding/);
    expect(out.stdout).toMatch(/2 candidates verified, 1 kept/);
    expect(out.stdout).toMatch(/r-abc1234\.json/);
  });

  it("passes --suite to run as an absolute path", async () => {
    const api = await mock({
      "POST /api/benchmarks": (_r, _u, body) => ({
        id: "bench-2",
        status: "running",
        results: [{}],
        targets: (body as { targets: unknown[] }).targets,
        summary: [],
      }),
    });
    const out = await runCli([
      "--api",
      api.url,
      "bench",
      "run",
      "--model",
      "p/m",
      "--suite",
      "suite-dir",
    ]);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout).toMatch(/locus bench show bench-2/);
    expect((api.bodies["POST /api/benchmarks"] as { suite: string }).suite).toMatch(/suite-dir$/);
  });
});
