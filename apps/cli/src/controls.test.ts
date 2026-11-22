import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditFileName,
  formatAuditLine,
  sealAuditRecord,
  type AuditHead,
} from "@locus/shared/auditChain";
import { runCli } from "./index.js";

type Handler = (req: IncomingMessage, url: URL, body: unknown) => unknown;

async function listen(handlers: Record<string, Handler>): Promise<{
  url: string;
  close: () => Promise<void>;
  hits: Array<{ key: string; body: unknown }>;
}> {
  const hits: Array<{ key: string; body: unknown }> = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const key = `${req.method ?? "GET"} ${url.pathname}`;
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
      hits.push({ key, body });
      const handler = handlers[key];
      res.writeHead(handler ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(handler ? handler(req, url, body) : { error: `no mock for ${key}` }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    hits,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn().catch(() => undefined)));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "locus-cli-controls-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const config = {
  providers: [
    {
      id: "prov-1",
      name: "Mock",
      kind: "anthropic",
      defaultModel: "claude-sonnet-4-5",
      enabled: true,
      apiKey: "••••••••",
    },
  ],
  templates: [{ id: "ubuntu-24.04", os: "ubuntu" }],
  forges: [],
  advanced: {},
};

const user = { id: "u1", role: "user", content: "go", createdAt: "2026-01-01T00:00:00Z" };

function sessionWith(extra: Record<string, unknown>, messages: unknown[] = []) {
  return {
    id: "sess-ci",
    kind: "agent",
    runtime: "host",
    providerId: "prov-1",
    model: "claude-sonnet-4-5",
    status: "idle",
    messages: [user, ...messages],
    usage: { inputTokens: 1000, outputTokens: 200 },
    createdAt: "",
    updatedAt: "",
    ...extra,
  };
}

async function ci(url: string, args: string[], dir: string) {
  const out = join(dir, "result.json");
  const result = await runCli(["ci", "run", "--api", url, "--out", out, ...args]);
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = JSON.parse(await readFile(out, "utf8")) as Record<string, unknown>;
  } catch {
    parsed = undefined;
  }
  return { ...result, json: parsed };
}

describe("locus ci run exit codes", () => {
  it("exits 0 on a passing run and writes the result file", async () => {
    const dir = await tempDir();
    const done = sessionWith({}, [
      { id: "a1", role: "assistant", content: "All green.", createdAt: "" },
    ]);
    const mock = await listen({
      "GET /api/health": () => ({ ok: true }),
      "GET /api/config": () => config,
      "POST /api/sessions": () => sessionWith({ status: "running" }),
      "GET /api/sessions/sess-ci": () => done,
    });
    cleanup.push(mock.close);
    const result = await ci(mock.url, ["--prompt", "run the tests", "--repo", dir], dir);
    expect(result.code).toBe(0);
    expect(result.json).toMatchObject({
      outcome: "pass",
      exitCode: 0,
      sessionId: "sess-ci",
      tokens: { input: 1000, output: 200 },
    });
    expect(typeof result.json?.costUsd).toBe("number");
    const create = mock.hits.find((hit) => hit.key === "POST /api/sessions");
    expect(create?.body).toMatchObject({ runtime: "host", hostDir: dir, startVm: false });
  });

  it("auto-denies approvals without a matching --allow rule, approves with one", async () => {
    const dir = await tempDir();
    let phase = 0;
    const call = (id: string, branch: string) => ({
      id: "a-" + id,
      role: "assistant",
      content: "",
      createdAt: "",
      toolCalls: [
        { id, name: "git_push", arguments: { branch }, approval: "needed", startedAt: "" },
      ],
    });
    const mock = await listen({
      "GET /api/health": () => ({ ok: true }),
      "GET /api/config": () => config,
      "POST /api/sessions": () => sessionWith({ status: "running" }),
      "GET /api/sessions/sess-ci": () => {
        if (phase === 0) return sessionWith({ status: "running" }, [call("t1", "main")]);
        if (phase === 1) return sessionWith({ status: "running" }, [call("t2", "locus/fix")]);
        return sessionWith({}, [{ id: "z", role: "assistant", content: "pushed", createdAt: "" }]);
      },
      "POST /api/sessions/sess-ci/approvals": () => {
        phase += 1;
        return {};
      },
    });
    cleanup.push(mock.close);
    const result = await ci(
      mock.url,
      ["--prompt", "fix", "--repo", dir, "--allow", "git_push(branch:locus/*)"],
      dir,
    );
    expect(result.code).toBe(0);
    const decisions = mock.hits
      .filter((hit) => hit.key === "POST /api/sessions/sess-ci/approvals")
      .map((hit) => hit.body);
    expect(decisions).toEqual([
      { toolCallId: "t1", decision: "denied" },
      { toolCallId: "t2", decision: "approved" },
    ]);
    expect(result.json).toMatchObject({
      deniedApprovals: [{ tool: "git_push", callId: "t1" }],
      allowedApprovals: [{ tool: "git_push", callId: "t2", rule: "git_push(branch:locus/*)" }],
    });
  });

  it("exits 2 when it stops at an approval with --no-auto-deny", async () => {
    const dir = await tempDir();
    const mock = await listen({
      "GET /api/health": () => ({ ok: true }),
      "GET /api/config": () => config,
      "POST /api/sessions": () => sessionWith({ status: "running" }),
      "GET /api/sessions/sess-ci": () =>
        sessionWith({ status: "running" }, [
          {
            id: "a",
            role: "assistant",
            content: "",
            createdAt: "",
            toolCalls: [
              { id: "t1", name: "git_pr", arguments: {}, approval: "needed", startedAt: "" },
            ],
          },
        ]),
      "POST /api/sessions/sess-ci/chat/abort": () => ({ ok: true }),
    });
    cleanup.push(mock.close);
    const result = await ci(mock.url, ["--prompt", "fix", "--repo", dir, "--no-auto-deny"], dir);
    expect(result.code).toBe(2);
    expect(result.json).toMatchObject({ outcome: "approval", pendingApproval: { tool: "git_pr" } });
  });

  it("exits 1 on a review FAIL and posts the verdict comment", async () => {
    const dir = await tempDir();
    const review = sessionWith({ kind: "review" }, [
      {
        id: "a",
        role: "assistant",
        content:
          'Found a bug.\n{"verdict":"FAIL","reasons":["null deref in cart.ts"],"risk":"low"}',
        createdAt: "",
      },
    ]);
    const mock = await listen({
      "GET /api/health": () => ({ ok: true }),
      "GET /api/config": () => config,
      "GET /api/repos": () => [{ id: "r1", checkout: { url: "https://github.com/acme/web.git" } }],
      "POST /api/repos/r1/pulls/42/review-session": () => review,
      "GET /api/sessions/sess-ci": () => review,
      "POST /api/repos/r1/pulls/42/comments": () => ({ htmlUrl: "https://github.com/c/1" }),
    });
    cleanup.push(mock.close);
    const result = await ci(
      mock.url,
      [
        "--recipe",
        "pr-reviewer",
        "--pr",
        "https://github.com/acme/web/pull/42",
        "--model",
        "claude-opus-4-1",
        "--max-usd",
        "3",
        "--post-comment",
      ],
      dir,
    );
    expect(result.code).toBe(1);
    expect(result.json).toMatchObject({
      outcome: "fail",
      verdict: "FAIL",
      reasons: ["null deref in cart.ts"],
      commentUrl: "https://github.com/c/1",
    });
    const start = mock.hits.find((hit) => hit.key.endsWith("/review-session"));
    expect(start?.body).toMatchObject({
      providerId: "prov-1",
      model: "claude-opus-4-1",
      maxUsd: 3,
    });
    const comment = mock.hits.find((hit) => hit.key.endsWith("/comments"));
    expect(String((comment?.body as { body: string }).body)).toContain("**Locus review:** FAIL");
  });

  it("exits 3 when the control plane is unreachable", async () => {
    const dir = await tempDir();
    const result = await ci("http://127.0.0.1:9", ["--prompt", "x"], dir);
    expect(result.code).toBe(3);
    expect(result.json).toMatchObject({ outcome: "error", exitCode: 3 });
  });

  it("rejects bad usage with exit 1 before starting anything", async () => {
    const result = await runCli(["ci", "run", "--recipe", "nope", "--api", "http://127.0.0.1:9"]);
    expect(result.code).not.toBe(0);
  });
});

describe("locus audit verify", () => {
  async function writeChain(dir: string, times: string[]): Promise<AuditHead | undefined> {
    let head: AuditHead | undefined;
    const files = new Map<string, string>();
    for (const t of times) {
      const record = sealAuditRecord(
        { type: "approval", actor: "operator", decision: "denied", t },
        head,
      );
      head = { seq: record.seq, hash: record.hash };
      files.set(auditFileName(t), (files.get(auditFileName(t)) ?? "") + formatAuditLine(record));
    }
    for (const [name, text] of files) await writeFile(join(dir, name), text);
    await writeFile(join(dir, "HEAD.json"), JSON.stringify(head));
    return head;
  }

  it("exits 0 for an intact chain and 1 with the first broken record", async () => {
    const dir = await tempDir();
    await writeChain(dir, ["2026-11-13T10:00:00.000Z", "2026-11-14T10:00:00.000Z"]);
    const ok = await runCli(["audit", "verify", "--dir", dir]);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain("Audit chain OK: 2 records in 2 file(s)");
    const file = join(dir, "audit-2026-11-14.jsonl");
    await writeFile(file, (await readFile(file, "utf8")).replace("denied", "approved"));
    const broken = await runCli(["audit", "verify", "--dir", dir]);
    expect(broken.code).toBe(1);
    expect(broken.stdout).toContain("audit-2026-11-14.jsonl");
    expect(broken.stdout).toMatch(/hash mismatch/);
  });

  it("exports CSV since a day from local files", async () => {
    const dir = await tempDir();
    await writeChain(dir, ["2026-11-13T10:00:00.000Z", "2026-11-14T10:00:00.000Z"]);
    const out = await runCli([
      "audit",
      "export",
      "--dir",
      dir,
      "--since",
      "2026-11-14",
      "--format",
      "csv",
    ]);
    expect(out.code).toBe(0);
    const lines = out.stdout.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(",2026-11-14T10:00:00.000Z,");
  });
});
