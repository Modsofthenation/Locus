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
