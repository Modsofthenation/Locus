import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import { createApp } from "../app.js";
import { Hub } from "../core/hub.js";
import { JsonStore } from "../core/store.js";
import { SessionService } from "../session/sessions.js";
import { BrainService } from "./brain.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((dir) =>
        rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }).catch(
          () => undefined,
        ),
      ),
  );
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "locus-brain-"));
  cleanup.push(dir);
  const store = new JsonStore(dir);
  await store.init();
  const hub = new Hub();
  const brain = new BrainService(store, hub);
  return { dir, store, hub, brain };
}

describe("BrainService", () => {
  it("refuses secrets and stores a remember with provenance", async () => {
    const { brain, dir } = await setup();
    try {
      const refused = await brain.remember({ text: "sk-abcdefghijklmnopqrstuvwxyz012345" });
      expect(refused.ok).toBe(false);
      expect(refused.output).toMatch(/secret/i);
      const saved = await brain.remember({ text: "we never bill from the worker" });
      expect(saved.ok).toBe(true);
      const doc = await brain.get();
      expect(doc.memories.some((row) => /never bill/.test(row.claim))).toBe(true);
      expect(doc.journal.some((row) => row.actor === "session")).toBe(true);
      const raw = await readFile(join(dir, "brain", "default", "brain.sqlite"));
      expect(raw.byteLength).toBeGreaterThan(0);
    } finally {
      brain.close();
    }
  });

  it("indexes package.json and Hono routes", async () => {
    const { brain, dir } = await setup();
    try {
      const repo = join(dir, "repo");
      await mkdir(join(repo, "src"), { recursive: true });
      await mkdir(join(repo, ".git"), { recursive: true });
      await writeFile(join(repo, ".git", "HEAD"), "abc123deadbeef\n");
      await writeFile(
        join(repo, "package.json"),
        JSON.stringify({ name: "billing-gateway", description: "Charges" }),
      );
      await writeFile(
        join(repo, "src", "app.ts"),
        'export function createApp() {\n  app.get("/api/health", (c) => c.json({ ok: true }));\n}\n',
      );
      await mkdir(join(repo, "node_modules"), { recursive: true });
      await writeFile(join(repo, "node_modules", "evil.ts"), 'app.get("/api/evil", () => null);\n');
      const indexed = await brain.indexPath(repo, { actor: "indexer:test" });
      expect(indexed.output).toMatch(/Indexed/);
      const found = await brain.find({ q: "billing" });
      expect(found).toMatch(/billing-gateway/);
      const card = await brain.entity("service:billing-gateway");
      expect(card).toMatch(/Service/);
      expect(card).toMatch(/src\/app\.ts:2/);
      expect(await brain.search("health")).toMatch(/GET \/api\/health|health/i);
      expect(await brain.find({ q: "evil" })).toMatch(/No matches|empty/i);
      expect(await brain.orient()).toMatch(/billing-gateway|health|Brain is empty|ambient/i);
      const before = await brain.get();
      const again = await brain.indexPath(repo, { actor: "indexer:test" });
      expect(again.output).toMatch(/Unchanged HEAD/);
      const after = await brain.get();
      expect(after.journal.length).toBe(before.journal.length);
    } finally {
      brain.close();
    }
  });

  it("keeps a separate indexed-repo entry per checkout path", async () => {
    const { brain, dir } = await setup();
    try {
      async function seed(name: string, pkg: string): Promise<string> {
        const repo = join(dir, name);
        await mkdir(join(repo, "src"), { recursive: true });
        await mkdir(join(repo, ".git"), { recursive: true });
        await writeFile(join(repo, ".git", "HEAD"), `${name}-head\n`);
        await writeFile(join(repo, "package.json"), JSON.stringify({ name: pkg }));
        await writeFile(join(repo, "src", "app.ts"), `app.get("/api/${name}", () => null);\n`);
        return repo;
      }
      const a = await seed("repo-a", "alpha-service");
      const b = await seed("repo-b", "beta-service");
      await brain.indexPath(a, { actor: "indexer:test" });
      await brain.indexPath(b, { actor: "indexer:test" });
      const doc = await brain.get();
      expect(doc.repos).toHaveLength(2);
      expect(doc.repos.map((row) => row.path).sort()).toEqual([a, b].sort());
      expect(doc.activity.filter((row) => row.kind === "index")).toHaveLength(2);
      const scopes = new Set(doc.repos.map((row) => row.url || row.path));
      expect(
        doc.activity
          .filter((row) => row.kind === "index")
          .every((row) => row.repo && scopes.has(row.repo)),
      ).toBe(true);
      expect(doc.nodes.length).toBeGreaterThan(0);
      expect(doc.nodes.every((row) => row.repo && scopes.has(row.repo))).toBe(true);
      expect(new Set(doc.nodes.map((row) => row.repo)).size).toBe(2);
    } finally {
      brain.close();
    }
  });

  it("rejects indexing a non-directory and skips symlink escapes", async () => {
    const { brain, dir } = await setup();
    try {
      const repo = join(dir, "repo");
      await mkdir(join(repo, "src"), { recursive: true });
      await writeFile(join(repo, "package.json"), JSON.stringify({ name: "safe" }));
      await writeFile(join(repo, "src", "app.ts"), 'app.get("/api/ok", () => null);\n');
      const file = join(dir, "not-a-dir.txt");
      await writeFile(file, "nope");
      await expect(brain.indexPath(file)).rejects.toThrow(/directory|not found/i);

      const outside = join(dir, "outside");
      await mkdir(outside, { recursive: true });
      await writeFile(join(outside, "leak.ts"), 'app.get("/api/leak", () => null);\n');
      try {
        const { symlink } = await import("node:fs/promises");
        await symlink(outside, join(repo, "escape"), "dir");
      } catch {
        // Windows may lack symlink privilege — still covered by containedPath on walk.
        return;
      }
      await brain.indexPath(repo, { actor: "indexer:jail" });
      expect(await brain.find({ q: "leak" })).toMatch(/No matches|empty/i);
      expect(await brain.find({ q: "ok" })).toMatch(/GET \/api\/ok|ok/i);
    } finally {
      brain.close();
    }
  });

  it("consolidates distill observations without blocking", async () => {
    const { brain } = await setup();
    try {
      const first = await brain.distillText(
        "Remember this: we never call Stripe from the worker\n",
      );
      expect(first.count).toBeGreaterThan(0);
      const second = await brain.distillText(
        "Remember this: we never call Stripe from the worker\n",
      );
      expect(second.count).toBeGreaterThan(0);
      const doc = await brain.get();
      const hits = doc.memories.filter((row) => /never call stripe/i.test(row.claim));
      expect(hits).toHaveLength(1);
      expect(hits[0]?.evidenceCount).toBeGreaterThanOrEqual(2);
      expect(await brain.orient()).toMatch(/never call Stripe/i);
    } finally {
      brain.close();
    }
  });

  it("distills durable lines from a multi-turn session tail", async () => {
    const { brain } = await setup();
    try {
      const { sessionDistillTail } = await import("@locus/shared");
      const blob = sessionDistillTail([
        { role: "user", content: "Remember this: we never call Stripe from the worker" },
        { role: "assistant", content: "Understood." },
        { role: "user", content: "Please rename the helper." },
        { role: "assistant", content: "Renamed." },
      ]);
      const result = await brain.distillText(blob);
      expect(result.count).toBeGreaterThan(0);
      expect(await brain.orient()).toMatch(/never call Stripe/i);
    } finally {
      brain.close();
    }
  });
});

describe("brain HTTP + MCP", () => {
  it("serves status, remember, search, and MCP tools", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-brain-http-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const hub = new Hub();
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, hub);
    const brain = new BrainService(store, hub);
    const app = createApp({ store, sessions, hypervisor, hub, brain });
    try {
      const status = await app.request("/api/brain/status");
      expect(status.status).toBe(200);
      const remembered = await app.request("/api/brain/remember", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "health check is unauthenticated",
          repo: "https://github.com/acme/billing",
        }),
      });
      expect(remembered.status).toBe(200);
      const transcript = await app.request("/api/brain/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "Remember this: we never call Stripe from the worker\nsk-abcdefghijklmnopqrstuvwxyz012345",
          source: "cursor",
          repo: "/tmp/billing",
        }),
      });
      expect(transcript.status).toBe(200);
      const distilled = (await transcript.json()) as {
        output?: string;
        memories?: Array<{ claim: string }>;
      };
      expect(distilled.output).toMatch(/Distilled/);
      expect(distilled.memories?.some((row) => /never call Stripe/i.test(row.claim))).toBe(true);
      expect(JSON.stringify(distilled.memories)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
      const empty = await app.request("/api/brain/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "   ", source: "codex" }),
      });
      expect(empty.status).toBe(400);
      const rememberedDoc = (await remembered.json()) as {
        memories: Array<{ repo?: string }>;
        activity: Array<{ kind: string; repo?: string }>;
      };
      expect(rememberedDoc.memories[0]?.repo).toBe("https://github.com/acme/billing");
      expect(
        rememberedDoc.activity.some(
          (row) => row.kind === "remember" && row.repo === "https://github.com/acme/billing",
        ),
      ).toBe(true);
      const secret = await app.request("/api/brain/remember", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "sk-abcdefghijklmnopqrstuvwxyz012345" }),
      });
      expect(secret.status).toBe(400);
      const searched = await app.request("/api/brain/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: "unauthenticated" }),
      });
      expect(await searched.json()).toMatchObject({
        output: expect.stringMatching(/unauthenticated/),
      });
      const listed = await app.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      const listedBody = (await listed.json()) as {
        result: { tools: Array<{ name: string }> };
      };
      expect(listedBody.result.tools.map((row) => row.name)).toEqual(
        expect.arrayContaining(["orient", "search_knowledge", "remember"]),
      );
      const oriented = await app.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "orient", arguments: {} },
        }),
      });
      const orientedBody = (await oriented.json()) as {
        result: { content: Array<{ text: string }>; isError?: boolean };
      };
      expect(orientedBody.result.isError).toBeFalsy();
      expect(orientedBody.result.content[0]?.text).toMatch(/health check|Brain|ambient|empty/i);
    } finally {
      brain.close();
    }
  });

  it("queues and accepts a graph correction", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-brain-correct-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const hub = new Hub();
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, hub);
    const brain = new BrainService(store, hub);
    const app = createApp({ store, sessions, hypervisor, hub, brain });
    try {
      await brain.remember({ text: "we never bill from the worker" });
      const doc = await brain.get();
      const memoryId = doc.memories[0]?.id;
      expect(memoryId).toBeTruthy();
      const queued = await app.request("/api/brain/correct", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memoryId, reason: "We do bill from the worker now." }),
      });
      expect(queued.status).toBe(200);
      const queuedDoc = (await queued.json()) as {
        corrections: Array<{ id: string; status: string }>;
      };
      expect(queuedDoc.corrections.some((row) => row.status === "open")).toBe(true);
      const status = await app.request("/api/brain/status");
      expect(await status.json()).toMatchObject({ inboxCount: 1 });
      const id = queuedDoc.corrections.find((row) => row.status === "open")?.id;
      const accepted = await app.request("/api/brain/correct", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action: "accepted" }),
      });
      expect(accepted.status).toBe(200);
      expect(await (await app.request("/api/brain/status")).json()).toMatchObject({
        inboxCount: 0,
      });
    } finally {
      brain.close();
    }
  });
});
