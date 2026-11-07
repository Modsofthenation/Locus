import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import { forgeMcpTools } from "@locus/shared";
import { createApp } from "../app.js";
import { Hub } from "../core/hub.js";
import { dispatchLocusMcp } from "./locusMcp.js";
import { SessionService } from "../session/sessions.js";
import { JsonStore } from "../core/store.js";

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

describe("locus MCP rpc", () => {
  it("lists and calls first-party integration tools", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const ctx = {
      tools: [
        {
          name: "grafana_query",
          description: "Query Grafana",
          inputSchema: { type: "object" as const, properties: {} },
        },
      ],
      call: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return {
          ok: true,
          output: JSON.stringify({ lucene: args.query, explore_url: "http://g" }),
        };
      },
    };
    const listed = await dispatchLocusMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, ctx);
    expect(listed).toMatchObject({
      result: { tools: [{ name: "grafana_query" }] },
    });
    const called = await dispatchLocusMcp(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "grafana_query", arguments: { query: "logger.level:error" } },
      },
      ctx,
    );
    expect(called).toMatchObject({
      result: {
        isError: false,
        content: [{ type: "text", text: expect.stringContaining("logger.level:error") }],
      },
    });
    expect(calls).toEqual([{ name: "grafana_query", args: { query: "logger.level:error" } }]);
  });

  it("returns a playwright screenshot as MCP image content", async () => {
    const called = await dispatchLocusMcp(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "playwright", arguments: { click: "#btnWire" } },
      },
      {
        tools: [],
        call: async () => ({
          ok: true,
          output: "Playwright desktop 1280×800 (live)\nscreenshot captured",
          screenshotBase64: "abc123",
          screenshotMime: "image/png",
        }),
      },
    );
    expect(called).toMatchObject({
      result: {
        isError: false,
        content: [
          { type: "text", text: "Playwright desktop 1280×800 (live)\nscreenshot captured" },
          { type: "image", data: "abc123", mimeType: "image/png" },
        ],
      },
    });
  });

  it("preserves typed failure metadata in tool envelopes", async () => {
    const called = await dispatchLocusMcp(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "git_push", arguments: {} },
      },
      {
        tools: [],
        call: async () => ({
          ok: false,
          status: "blocked" as const,
          category: "test-gate",
          retryable: false,
          details: { failureKind: "test-failure", failedTests: ["src/a.test.ts"] },
          output: "Harness blocked git_push: tests failed.",
        }),
      },
    );
    expect(called).toMatchObject({
      result: {
        isError: true,
        structuredContent: {
          ok: false,
          status: "blocked",
          category: "test-gate",
          retryable: false,
          details: { failureKind: "test-failure", failedTests: ["src/a.test.ts"] },
        },
      },
    });
  });

  it("lists and calls forge PR tools on the session MCP", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const ctx = {
      tools: forgeMcpTools(),
      call: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { ok: true, output: "clipped files" };
      },
    };
    const listed = await dispatchLocusMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, ctx);
    expect(listed).toMatchObject({
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "git_pr_get" }),
          expect.objectContaining({ name: "git_pr_review" }),
        ]),
      },
    });
    const called = await dispatchLocusMcp(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "git_pr_get", arguments: { include: ["files"], paths: ["a.ts"] } },
      },
      ctx,
    );
    expect(called).toMatchObject({
      result: {
        isError: false,
        content: [{ type: "text", text: "clipped files" }],
      },
    });
    expect(calls).toEqual([{ name: "git_pr_get", args: { include: ["files"], paths: ["a.ts"] } }]);
  });

  it("ignores notifications and rejects unknown methods", async () => {
    const ctx = { tools: [], call: async () => ({ ok: false, output: "no" }) };
    expect(
      await dispatchLocusMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx),
    ).toBeUndefined();
    const missing = await dispatchLocusMcp(
      { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "exec" } },
      ctx,
    );
    expect(missing).toMatchObject({ result: { isError: true } });
    const unknown = await dispatchLocusMcp({ jsonrpc: "2.0", id: 3, method: "foo" }, ctx);
    expect(unknown).toMatchObject({ error: { code: -32601 } });
  });

  it("advertises server instructions during initialize", async () => {
    const initialized = await dispatchLocusMcp(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      },
      {
        tools: [],
        instructions: "Use the session Git tools for publishing changes.",
        call: async () => ({ ok: false, output: "no" }),
      },
    );
    expect(initialized).toMatchObject({
      result: { instructions: "Use the session Git tools for publishing changes." },
    });
  });

  it("returns a playwright screenshot as an MCP image block", async () => {
    const called = await dispatchLocusMcp(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "playwright", arguments: { click: "#btnWire" } },
      },
      {
        tools: [],
        call: async () => ({
          ok: true,
          output: "Playwright desktop 1280×800 (live)\nscreenshot captured",
          screenshotBase64: "abc123",
        }),
      },
    );
    expect(called).toMatchObject({
      result: {
        isError: false,
        content: [
          { type: "text", text: expect.stringContaining("screenshot captured") },
          { type: "image", data: "abc123", mimeType: "image/png" },
        ],
      },
    });
  });

  it("exposes grafana_query on POST /mcp using the vaulted Settings token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-mcp-http-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    config.integrations = [
      {
        id: "g1",
        kind: "grafana",
        name: "Grafana",
        enabled: true,
        baseUrl: "https://grafana.example.com",
        token: "glsa_test",
      },
    ];
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const app = createApp({ store, sessions, hypervisor });
    expect((await app.request("/mcp")).status).toBe(405);
    const listed = await app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(listed.status).toBe(200);
    const catalog = (await listed.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(catalog.result.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["grafana_query", "grafana_search", "grafana_get"]),
    );
    const queried = await app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "grafana_query",
          arguments: { query: "logger.level:error", explore_url_only: true },
        },
      }),
    });
    const body = (await queried.json()) as {
      result: { isError?: boolean; content: Array<{ text: string }> };
    };
    expect(body.result.isError).toBeFalsy();
    expect(body.result.content[0]?.text).toContain("logger.level:error");
    expect(body.result.content[0]?.text).toContain("explore_url");
    expect(body.result.content[0]?.text).not.toContain("glsa_test");
    hypervisor.shutdown();
  });

  it("exposes git_pr_* on POST /mcp/sessions/:sessionId", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-mcp-session-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const app = createApp({ store, sessions, hypervisor });
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "review",
      runtime: "docker",
      dockerImage: "locus/node",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
    });
    const missing = await app.request("/mcp/sessions/missing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(missing.status).toBe(404);
    const listed = await app.request(`/mcp/sessions/${created.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(listed.status).toBe(200);
    const catalog = (await listed.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(catalog.result.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "git_pr_get",
        "git_pr_loadpath",
        "git_pr_comment",
        "git_pr_review",
        "git_issue_list",
        "git_issue_get",
        "git_issue_comment",
        "canvas_write",
        "canvas_read",
      ]),
    );
    const global = await app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const globalCatalog = (await global.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(globalCatalog.result.tools.map((t) => t.name)).not.toContain("git_pr_get");
    hypervisor.shutdown();
  });

  it("does not expose git_pr_* on a coding session MCP", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-mcp-coding-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const app = createApp({ store, sessions, hypervisor });
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const listed = await app.request(`/mcp/sessions/${created.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const catalog = (await listed.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(catalog.result.tools.map((t) => t.name)).not.toContain("git_pr_review");
    expect(catalog.result.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["canvas_write", "canvas_read"]),
    );
    expect(catalog.result.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["git_issue_list", "git_issue_get", "git_issue_comment"]),
    );
    const called = await app.request(`/mcp/sessions/${created.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "git_pr_review", arguments: { event: "APPROVE" } },
      }),
    });
    const body = (await called.json()) as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toMatch(/review sessions/);
    hypervisor.shutdown();
  });

  it("exposes playwright on design, game, and assets session MCP and not on coding sessions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-mcp-game-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const app = createApp({ store, sessions, hypervisor });
    const game = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "game",
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const listed = await app.request(`/mcp/sessions/${game.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const catalog = (await listed.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(catalog.result.tools.map((t) => t.name)).toContain("playwright");
    expect(catalog.result.tools.map((t) => t.name)).toContain("host_sessions");
    const coding = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const codingListed = await app.request(`/mcp/sessions/${coding.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const codingCatalog = (await codingListed.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(codingCatalog.result.tools.map((t) => t.name)).not.toContain("playwright");
    expect(codingCatalog.result.tools.map((t) => t.name)).toContain("host_sessions");
    const assets = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "assets",
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const assetsListed = await app.request(`/mcp/sessions/${assets.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const assetsCatalog = (await assetsListed.json()) as {
      result: { tools: Array<{ name: string; description?: string }> };
    };
    expect(assetsCatalog.result.tools.map((t) => t.name)).toContain("playwright");
    expect(assetsCatalog.result.tools.find((t) => t.name === "playwright")?.description).toMatch(
      /tainted canvas/,
    );
    const design = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const designListed = await app.request(`/mcp/sessions/${design.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const designCatalog = (await designListed.json()) as {
      result: { tools: Array<{ name: string; description?: string }> };
    };
    expect(designCatalog.result.tools.map((t) => t.name)).toContain("playwright");
    expect(designCatalog.result.tools.map((t) => t.name)).not.toContain("canvas_write");
    expect(designCatalog.result.tools.find((t) => t.name === "playwright")?.description).toMatch(
      /design canvas/,
    );
    const designInitialized = await app.request(`/mcp/sessions/${design.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      }),
    });
    const designInit = (await designInitialized.json()) as { result?: { instructions?: string } };
    expect(designInit.result?.instructions).toMatch(/playwright/);
    expect(designInit.result?.instructions).toMatch(/first paint/);
    const called = await app.request(`/mcp/sessions/${coding.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "playwright", arguments: { click: "#go" } },
      }),
    });
    const body = (await called.json()) as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toMatch(/design, game, and assets sessions/);
    hypervisor.shutdown();
  });

  it("exposes playwright-only MCP on assets sessions and refuses orient", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-mcp-assets-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const app = createApp({ store, sessions, hypervisor });
    const assets = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "assets",
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const listed = await app.request(`/mcp/sessions/${assets.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const catalog = (await listed.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(catalog.result.tools.map((t) => t.name)).toEqual(["playwright", "host_sessions"]);
    const initialized = await app.request(`/mcp/sessions/${assets.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      }),
    });
    const initBody = (await initialized.json()) as { result?: { instructions?: string } };
    expect(initBody.result?.instructions).toMatch(/canvas-files/);
    expect(initBody.result?.instructions).toMatch(/do not call orient/);
    const oriented = await app.request(`/mcp/sessions/${assets.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "orient", arguments: {} },
      }),
    });
    const body = (await oriented.json()) as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toMatch(/Brain tools/);
    hypervisor.shutdown();
  });
});
