import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./index.js";
import { CLI_VERSION } from "./version.js";

type Handler = (req: IncomingMessage, url: URL, body: unknown) => unknown;

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function listen(
  handlers: Record<string, Handler>,
): Promise<{ url: string; close: () => Promise<void>; hits: string[] }> {
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const key = `${req.method ?? "GET"} ${url.pathname}`;
    hits.push(key);
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      let body: unknown;
      if (chunks.length) {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          body = Buffer.concat(chunks).toString("utf8");
        }
      }
      const handler = handlers[key] ?? handlers[`${req.method} *`];
      if (!handler) {
        json(res, 404, { error: `no mock for ${key}` });
        return;
      }
      try {
        const result = handler(req, url, body);
        json(res, 200, result);
      } catch (err) {
        json(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    hits,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

const session = {
  id: "sess-aaa111",
  title: "Fix checkout",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  kind: "agent",
  runtime: "docker",
  providerId: "prov-1",
  model: "mock",
  status: "idle",
  messages: [
    { id: "m1", role: "user", content: "fix it", createdAt: "2026-01-01T00:00:00Z" },
    { id: "m2", role: "assistant", content: "done", createdAt: "2026-01-01T00:00:01Z" },
  ],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:01Z",
};

const config = {
  theme: "ember",
  providers: [
    {
      id: "prov-1",
      name: "Mock",
      kind: "openai",
      baseUrl: "http://127.0.0.1",
      models: ["mock"],
      defaultModel: "mock",
      enabled: true,
      extraHeaders: {},
    },
  ],
  templates: [{ id: "ubuntu-24.04", os: "ubuntu", name: "Ubuntu" }],
  hardwareProfiles: [],
  forges: [{ id: "forge-1", kind: "github", name: "GitHub", apiBaseUrl: "https://api.github.com" }],
  mcpServers: [],
  skills: [],
  workers: [],
  advanced: { bindHost: "127.0.0.1", bindPort: 7420, dataDir: "/tmp/locus-test" },
};

let mock: Awaited<ReturnType<typeof listen>> | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

async function cli(argv: string[]) {
  if (!mock) throw new Error("mock not started");
  return runCli(["--api", mock.url, ...argv]);
}

describe("locus CLI", () => {
  it("prints help", async () => {
    const result = await runCli(["help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("locus agent list");
    expect(result.stdout).toContain("locus slack status");
    expect(result.stdout).toContain("locus grafana status|dashboards|get|query");
    expect(result.stdout).toContain("locus project list");
    expect(result.stdout).toContain("locus brain status");
    expect(result.stdout).toContain("remember|inbox|correct");
    expect(result.stdout).toContain(
      "locus game list|new|get|canvas|comment|promote|fork|link|assets|play-link|generate",
    );
    expect(result.stdout).toContain("locus game styles list|create|save|delete|default");
    expect(result.stdout).toContain("locus asset list|new|get|canvas|comment|promote|fork|pack");
    expect(result.stdout).toContain("locus asset styles list|create|save|delete|default");
    expect(result.stdout).toContain("locus completion bash|zsh|fish");
    expect(result.stdout).toContain("locus board list|new|get|delete|duplicate|chat|run|export");
    expect(result.stdout).toContain(
      "locus automation list|get|new|patch|enable|disable|delete|run|runs|clone|test-webhook",
    );
    expect(result.stdout).toContain(
      "locus workflow list|templates|add|import|show|delete|run|resume|runs",
    );
  });

  it("prints game help and creates a game from the arcade recipe", async () => {
    const help = await runCli(["game"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Games canvases");
    expect(help.stdout).toContain("--recipe arcade");
    expect(help.stdout).toContain("juice");
    expect(help.stdout).toContain("match-3");
    expect(help.stdout).toContain("tower-defense");
    expect(help.stdout).toContain("roguelike");
    expect(help.stdout).toContain("endless-drive");
    expect(help.stdout).toContain("play-link");
    expect(help.stdout).toContain("game styles");
    expect(help.stdout).toContain("canvas-vite");
    let created: unknown;
    mock = await listen({
      "GET /api/config": () => config,
      "POST /api/sessions": (_req, _url, body) => {
        created = body;
        return { ...session, kind: "game", title: "Arcade dodge" };
      },
    });
    const result = await cli(["game", "new", "Arcade dodge", "--recipe", "arcade"]);
    expect(result.code).toBe(0);
    expect(created).toMatchObject({
      kind: "game",
      runtime: "docker",
      prompt: "Arcade dodge",
    });
  });

  it("prints asset help and creates an assets studio from the image-to-3d recipe", async () => {
    const help = await runCli(["asset"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Assets canvases");
    expect(help.stdout).toContain("--recipe image-to-3d");
    expect(help.stdout).toContain("walk-cycle");
    expect(help.stdout).toContain("hold");
    expect(help.stdout).toContain("attacks");
    expect(help.stdout).toContain("three-vite");
    expect(help.stdout).toContain("asset styles");
    expect(help.stdout).toContain("--topology");
    expect(help.stdout).toContain("--quality");
    expect(help.stdout).toContain("--printable");
    let created: unknown;
    mock = await listen({
      "GET /api/config": () => config,
      "POST /api/sessions": (_req, _url, body) => {
        created = body;
        return { ...session, kind: "assets", title: "Hero from a photo" };
      },
    });
    const result = await cli(["asset", "new", "Hero from a photo", "--recipe", "image-to-3d"]);
    expect(result.code).toBe(0);
    expect(created).toMatchObject({
      kind: "assets",
      runtime: "docker",
      prompt: "Hero from a photo",
    });
  });

  it("lists asset styles and creates a studio with --style", async () => {
    let created: unknown;
    mock = await listen({
      "GET /api/config": () => config,
      "GET /api/asset-styles": () => ({
        styles: [{ id: "st1", name: "Clay hero" }],
        defaultId: "st1",
      }),
      "POST /api/sessions": (_req, _url, body) => {
        created = body;
        return {
          ...session,
          kind: "assets",
          title: "Fox",
          assetStyleId: (body as { assetStyleId?: string }).assetStyleId,
        };
      },
    });
    const listed = await cli(["asset", "styles", "list"]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("Clay hero");
    const result = await cli(["asset", "new", "Fox", "--style", "st1"]);
    expect(result.code).toBe(0);
    expect(created).toMatchObject({ kind: "assets", assetStyleId: "st1" });
  });

  it("lists game styles, mints a play link, and creates a game with --style", async () => {
    let created: unknown;
    mock = await listen({
      "GET /api/config": () => config,
      "GET /api/game-styles": () => ({
        styles: [{ id: "gs1", name: "Neon tile" }],
        defaultId: "gs1",
      }),
      "GET /api/sessions/g1/play-link": () => ({
        token: "pl_abc",
        url: "http://127.0.0.1:7420/play/pl_abc/",
        lanUrls: [],
      }),
      "POST /api/sessions/g1/generate-asset": (_req, _url, body) => ({
        game: { ...session, id: "g1", kind: "game", title: "Arena" },
        asset: (body as { kind?: string }).kind === "sfx" ? undefined : { ...session, id: "a1" },
      }),
      "GET /api/sessions": () => [{ ...session, id: "g1", kind: "game", title: "Arena" }],
      "GET /api/sessions/g1": () => ({ ...session, id: "g1", kind: "game", title: "Arena" }),
      "POST /api/sessions": (_req, _url, body) => {
        created = body;
        return {
          ...session,
          kind: "game",
          title: "Neon crawl",
          gameStyleId: (body as { gameStyleId?: string }).gameStyleId,
        };
      },
    });
    const listed = await cli(["game", "styles", "list"]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("Neon tile");
    const link = await cli(["game", "play-link", "g1"]);
    expect(link.code).toBe(0);
    expect(link.stdout).toContain("/play/pl_abc/");
    const generated = await cli(["game", "generate", "g1", "sfx"]);
    expect(generated.code).toBe(0);
    expect(generated.stdout).toContain("Queued sfx");
    const result = await cli(["game", "new", "Neon crawl", "--style", "gs1"]);
    expect(result.code).toBe(0);
    expect(created).toMatchObject({ kind: "game", gameStyleId: "gs1" });
  });

  it("creates an assets studio with Meshy-like build flags", async () => {
    let created: unknown;
    mock = await listen({
      "GET /api/config": () => config,
      "POST /api/sessions": (_req, _url, body) => {
        created = body;
        return { ...session, kind: "assets", title: "Print swan" };
      },
    });
    const result = await cli([
      "asset",
      "new",
      "Print swan",
      "--topology",
      "high-detail",
      "--quality",
      "flagship",
      "--resolution",
      "4x",
      "--rest-pose",
      "t-pose",
      "--poly-budget",
      "2k",
      "--split",
      "--multi-view",
      "--printable",
      "--no-texture",
    ]);
    expect(result.code).toBe(0);
    expect(created).toMatchObject({
      kind: "assets",
      assetBuild: {
        topology: "high-detail",
        quality: "flagship",
        resolution: "4x",
        restPose: "t-pose",
        polyBudget: "2k",
        texture: false,
        split: true,
        multiView: true,
        printable: true,
      },
    });
  });

  it("links an Assets chat into a game and lists the refs", async () => {
    const game = {
      ...session,
      id: "game-1",
      kind: "game",
      title: "Arcade",
      assetRefs: [{ sessionId: "asset-1", slug: "knight", title: "Knight" }],
    };
    const asset = { ...session, id: "asset-1", kind: "assets", title: "Knight" };
    let linkedBody: unknown;
    mock = await listen({
      "GET /api/sessions": () => [game, asset],
      "GET /api/sessions/game-1": () => game,
      "GET /api/sessions/asset-1": () => asset,
      "POST /api/sessions/game-1/linked-assets": (_req, _url, body) => {
        linkedBody = body;
        return {
          refs: [{ sessionId: "asset-1", slug: "knight" }],
          prompts: [{ slug: "knight", dir: "vendor/assets/knight" }],
        };
      },
    });
    const linked = await cli(["game", "link", "game-1", "asset-1"]);
    expect(linked.code).toBe(0);
    expect(linked.stdout).toContain("@asset:knight");
    expect(linkedBody).toEqual({ assetIds: ["asset-1"] });
    const listed = await cli(["game", "assets", "game-1"]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("knight");
  });

  it("rebuilds an asset pack", async () => {
    const asset = { ...session, id: "asset-1", kind: "assets", title: "Knight" };
    mock = await listen({
      "GET /api/sessions": () => [asset],
      "GET /api/sessions/asset-1": () => asset,
      "POST /api/sessions/asset-1/asset-pack": () => ({
        slug: "knight",
        kind: "sprite",
        files: [{ name: "source.png", role: "source" }],
      }),
    });
    const result = await cli(["asset", "pack", "asset-1"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("knight");
    expect(mock.hits).toContain("POST /api/sessions/asset-1/asset-pack");
  });

  it("rejects unknown asset build values instead of using defaults", async () => {
    let created = false;
    mock = await listen({
      "GET /api/config": () => config,
      "POST /api/sessions": () => {
        created = true;
        return { ...session, kind: "assets" };
      },
    });
    const result = await cli(["asset", "new", "Swan", "--poly-budget", "50k"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--poly-budget must be 2k, 8k, 20k");
    expect(created).toBe(false);
  });

  it("prints version", async () => {
    const result = await runCli(["--version"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(CLI_VERSION);
  });

  it("rejects unknown commands", async () => {
    const result = await runCli(["nope"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown command");
  });

  it("lists agents as a table and as json", async () => {
    mock = await listen({
      "GET /api/sessions": () => [session],
    });
    const table = await cli(["agent", "list"]);
    expect(table.code).toBe(0);
    expect(table.stdout).toContain("Fix checkout");
    expect(table.stdout).toContain("docker");
    const asJson = await cli(["--json", "agent", "list"]);
    expect(JSON.parse(asJson.stdout)[0].id).toBe("sess-aaa111");
  });

  it("resolves a session by prefix", async () => {
    mock = await listen({
      "GET /api/sessions": () => [session],
      "GET /api/sessions/sess-aaa111": () => session,
    });
    const result = await cli(["agent", "get", "sess-aaa"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Fix checkout");
    expect(result.stdout).toContain("assistant");
  });

  it("creates an agent with docker defaults", async () => {
    let created: unknown;
    mock = await listen({
      "GET /api/config": () => config,
      "POST /api/sessions": (_req, _url, body) => {
        created = body;
        return { ...session, title: (body as { title?: string }).title ?? session.title };
      },
    });
    const result = await cli(["agent", "new", "--runtime", "docker", "fix the tests"]);
    expect(result.code).toBe(0);
    expect(created).toMatchObject({
      runtime: "docker",
      os: "ubuntu",
      providerId: "prov-1",
      model: "mock",
      prompt: "fix the tests",
      startVm: true,
      dockerImage: "locus/agent",
    });
  });

  it("omits dockerImage for host runtimes", async () => {
    let created: { dockerImage?: string; runtime?: string; startVm?: boolean } | undefined;
    mock = await listen({
      "GET /api/config": () => config,
      "POST /api/sessions": (_req, _url, body) => {
        created = body as { dockerImage?: string; runtime?: string; startVm?: boolean };
        return { ...session, runtime: "host", title: "host agent" };
      },
    });
    const result = await cli(["agent", "new", "--runtime", "host", "work here"]);
    expect(result.code).toBe(0);
    expect(created?.runtime).toBe("host");
    expect(created?.dockerImage).toBeUndefined();
    expect(created?.startVm).toBe(false);
  });

  it("creates an IDE workspace from locus ide new --dir", async () => {
    let created: unknown;
    mock = await listen({
      "GET /api/config": () => config,
      "POST /api/sessions": (_req, _url, body) => {
        created = body;
        return { ...session, kind: "ide", runtime: "host", title: "app" };
      },
    });
    const result = await cli(["ide", "new", "--dir", "/tmp/app", "--title", "app"]);
    expect(result.code).toBe(0);
    expect(created).toMatchObject({
      kind: "ide",
      runtime: "host",
      hostDir: "/tmp/app",
      title: "app",
      startVm: false,
    });
  });

  it("sends chat async by default without waiting for the transcript", async () => {
    let posted: unknown;
    let gets = 0;
    mock = await listen({
      "GET /api/sessions": () => [session],
      "GET /api/sessions/sess-aaa111": () => {
        gets += 1;
        return session;
      },
      "POST /api/sessions/sess-aaa111/chat": (_req, _url, body) => {
        posted = body;
        return { ok: true };
      },
    });
    const result = await cli(["agent", "chat", "sess-aaa111", "try again"]);
    expect(result.code).toBe(0);
    expect(posted).toMatchObject({ content: "try again" });
    expect(result.stdout).toContain("async");
    expect(gets).toBe(1);
  });

  it("waits for the transcript when --wait is set", async () => {
    let posted: unknown;
    mock = await listen({
      "GET /api/sessions": () => [session],
      "GET /api/sessions/sess-aaa111": () => session,
      "POST /api/sessions/sess-aaa111/chat": (_req, _url, body) => {
        posted = body;
        return { ok: true };
      },
    });
    const result = await cli(["agent", "chat", "sess-aaa111", "try again", "--wait"]);
    expect(result.code).toBe(0);
    expect(posted).toMatchObject({ content: "try again" });
    expect(result.stdout).toContain("done");
  });

  it("passes --notify through to the chat API", async () => {
    let posted: unknown;
    mock = await listen({
      "GET /api/sessions": () => [session],
      "GET /api/sessions/sess-aaa111": () => session,
      "POST /api/sessions/sess-aaa111/chat": (_req, _url, body) => {
        posted = body;
        return { ok: true };
      },
    });
    const result = await cli([
      "agent",
      "chat",
      "sess-aaa111",
      "ask the peer",
      "--notify",
      "coord-111",
    ]);
    expect(result.code).toBe(0);
    expect(posted).toMatchObject({ content: "ask the peer", notifySessionId: "coord-111" });
    expect(result.stdout).toContain("async");
  });

  it("sends a queued prompt now", async () => {
    const queued = {
      ...session,
      status: "running" as const,
      queue: [{ id: "q-abc", text: "do this next" }],
    };
    let sent = false;
    mock = await listen({
      "GET /api/sessions": () => [queued],
      "GET /api/sessions/sess-aaa111": () =>
        sent
          ? {
              ...session,
              messages: [
                ...session.messages,
                {
                  id: "m3",
                  role: "user",
                  content: "do this next",
                  createdAt: "2026-01-01T00:00:02Z",
                },
                {
                  id: "m4",
                  role: "assistant",
                  content: "on it",
                  createdAt: "2026-01-01T00:00:03Z",
                },
              ],
            }
          : queued,
      "POST /api/sessions/sess-aaa111/queue/q-abc/send": () => {
        sent = true;
        return { ...session, status: "running" };
      },
    });
    const result = await cli(["agent", "queue", "send", "sess-aaa111", "q-abc"]);
    expect(result.code).toBe(0);
    expect(sent).toBe(true);
    expect(result.stdout).toContain("do this next");
    expect(result.stdout).toContain("on it");
  });

  it("waits through provisioning before printing the transcript", async () => {
    let gets = 0;
    mock = await listen({
      "GET /api/sessions": () => [session],
      "GET /api/sessions/sess-aaa111": () => {
        gets += 1;
        if (gets === 1) return session;
        if (gets === 2) return { ...session, status: "provisioning" };
        return {
          ...session,
          status: "idle",
          messages: [
            ...session.messages,
            { id: "m3", role: "assistant", content: "shipped", createdAt: "2026-01-01T00:00:02Z" },
          ],
        };
      },
      "POST /api/sessions/sess-aaa111/chat": () => ({ ok: true }),
    });
    const result = await cli([
      "agent",
      "chat",
      "sess-aaa111",
      "keep going",
      "--wait",
      "--timeout",
      "5",
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("shipped");
    expect(gets).toBeGreaterThanOrEqual(3);
  });

  it("exits 2 when a tool call needs approval", async () => {
    const waiting = {
      ...session,
      messages: [
        ...session.messages,
        {
          id: "m3",
          role: "assistant",
          content: "",
          createdAt: "2026-01-01T00:00:02Z",
          toolCalls: [
            { id: "tc1", name: "git_push", arguments: {}, approval: "needed", startedAt: "t" },
          ],
        },
      ],
    };
    mock = await listen({
      "GET /api/sessions": () => [waiting],
      "GET /api/sessions/sess-aaa111": () => waiting,
      "POST /api/sessions/sess-aaa111/chat": () => ({ ok: true }),
    });
    const result = await cli(["agent", "chat", "sess-aaa111", "push it", "--wait"]);
    expect(result.code).toBe(2);
    expect(result.stdout).toContain("Approval needed");
    expect(result.stdout).toContain("git_push");
  });

  it("approves a tool call", async () => {
    mock = await listen({
      "GET /api/sessions": () => [session],
      "GET /api/sessions/sess-aaa111": () => session,
      "POST /api/sessions/sess-aaa111/approvals": (_req, _url, body) => {
        expect(body).toMatchObject({ toolCallId: "tc1", decision: "approved" });
        return session;
      },
    });
    const result = await cli(["agent", "approve", "sess-aaa", "tc1"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Approved");
  });

  it("approves and persists always-allow", async () => {
    mock = await listen({
      "GET /api/sessions": () => [session],
      "GET /api/sessions/sess-aaa111": () => session,
      "POST /api/sessions/sess-aaa111/approvals": (_req, _url, body) => {
        expect(body).toMatchObject({
          toolCallId: "tc1",
          decision: "approved",
          persist: true,
        });
        return session;
      },
    });
    const result = await cli(["agent", "approve", "sess-aaa", "tc1", "--always"]);
    expect(result.code).toBe(0);
  });

  it("clears chat and model context", async () => {
    mock = await listen({
      "GET /api/sessions": () => [session],
      "GET /api/sessions/sess-aaa111": () => session,
      "POST /api/sessions/sess-aaa111/clear": () => ({ ...session, messages: [] }),
    });
    const result = await cli(["agent", "clear", "sess-aaa"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Cleared chat");
    expect(mock.hits).toContain("POST /api/sessions/sess-aaa111/clear");
  });

  it("lists slack channels by name", async () => {
    mock = await listen({
      "GET /api/slack/conversations": () => [
        { id: "C123", name: "eng", kind: "channel" },
        { id: "D9", name: "alice", kind: "im" },
      ],
      "POST /api/slack/conversations/C123/messages": (_req, _url, body) => body,
    });
    const result = await cli(["slack", "send", "eng", "hello", "--as", "bot"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("hello");
  });

  it("lists docker containers", async () => {
    mock = await listen({
      "GET /api/docker/containers": () => ({
        kind: "mock",
        containers: [{ id: "abc123def", name: "locus-1", image: "locus/agent", state: "running" }],
      }),
    });
    const result = await cli(["docker", "list"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("locus-1");
  });

  it("lists docker swarm services and scales", async () => {
    mock = await listen({
      "GET /api/docker/swarm": () => ({
        kind: "docker",
        info: { state: "active", controlAvailable: true, nodeAddr: "10.0.0.2" },
        nodes: [
          { id: "n1n1n1n1n1n1", hostname: "manager", status: "Ready", availability: "Active" },
        ],
        services: [
          {
            id: "svc123456789",
            name: "web",
            image: "nginx:latest",
            mode: "replicated",
            replicas: "1/1",
          },
        ],
        stacks: [{ name: "app", services: 1 }],
      }),
      "POST /api/docker/swarm/services/web/scale": (_req, _url, body) => {
        expect(body).toEqual({ replicas: 3 });
        return {
          id: "svc123456789",
          name: "web",
          replicas: "3/3",
          mode: "replicated",
          image: "nginx:latest",
        };
      },
    });
    const status = await cli(["docker", "swarm", "status"]);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain("state active");
    const services = await cli(["docker", "swarm", "services"]);
    expect(services.code).toBe(0);
    expect(services.stdout).toContain("web");
    const scaled = await cli(["docker", "swarm", "scale", "web", "3"]);
    expect(scaled.code).toBe(0);
    expect(scaled.stdout).toContain("3/3");
  });

  it("lists Grafana dashboards and prints live panel values", async () => {
    mock = await listen({
      "GET /api/grafana/dashboards": () => [{ uid: "check", title: "Checkout", tags: ["prod"] }],
      "POST /api/grafana/query": (_req, _url, body) => {
        expect(body).toMatchObject({ query: "logger.level:error", from: "now-6h", limit: 10 });
        return {
          lucene: "logger.level:error",
          explore_url: "https://grafana.example.com/explore",
          from: "now-6h",
          to: "now",
          count: 1,
          logs: [
            { timestamp: "2026-10-21T12:00:00.000Z", level: "error", message: "TimeoutError" },
          ],
        };
      },
      "POST /api/grafana/dashboards/check/query": (_req, _url, body) => {
        expect(body).toEqual({ from: "now-6h" });
        return {
          uid: "check",
          title: "Checkout",
          url: "https://grafana.example.com/d/check",
          from: "now-6h",
          to: "now",
          panels: [
            {
              title: "Error rate",
              type: "timeseries",
              series: [{ name: "checkout", points: [{ t: 1, value: 4 }] }],
            },
            { title: "Notes", type: "text", text: "Watch checkout timeouts." },
          ],
        };
      },
    });
    const listed = await cli(["grafana", "dashboards"]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("Checkout");
    const got = await cli(["grafana", "get", "check", "--from", "now-6h"]);
    expect(got.code).toBe(0);
    expect(got.stdout).toContain("Error rate");
    expect(got.stdout).toContain("4");
    expect(got.stdout).toContain("Watch checkout");
    const queried = await cli([
      "grafana",
      "query",
      "logger.level:error",
      "--from",
      "now-6h",
      "--limit",
      "10",
    ]);
    expect(queried.code).toBe(0);
    expect(queried.stdout).toContain("TimeoutError");
    expect(queried.stdout).toContain("now-6h");
  });

  it("saves a named environment from a session", async () => {
    mock = await listen({
      "GET /api/sessions": () => [session],
      "GET /api/sessions/sess-aaa111": () => session,
      "POST /api/sessions/sess-aaa111/save-environment": (_req, _url, body) => {
        expect(body).toMatchObject({ name: "acme-prod" });
        return { environment: { id: "env-1", name: "acme-prod" } };
      },
    });
    const result = await cli(["agent", "save-environment", "sess-aaa", "--name", "acme-prod"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("acme-prod");
  });

  it("creates an interval automation", async () => {
    let created: unknown;
    mock = await listen({
      "GET /api/config": () => config,
      "POST /api/automations": (_req, _url, body) => {
        created = body;
        return {
          id: "auto-1",
          name: "Nightly",
          enabled: true,
          schedule: (body as { schedule: unknown }).schedule,
        };
      },
    });
    const result = await cli([
      "automation",
      "new",
      "--name",
      "Nightly",
      "--prompt",
      "run tests",
      "--schedule",
      "daily",
      "--hour",
      "2",
    ]);
    expect(result.code).toBe(0);
    expect(created).toMatchObject({
      name: "Nightly",
      prompt: "run tests",
      schedule: { kind: "daily", hour: 2, minute: 0 },
    });
  });

  it("shows redacted config", async () => {
    mock = await listen({
      "GET /api/config": () => config,
    });
    const result = await cli(["config", "show"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("ember");
    expect(result.stdout).toContain("providers");
  });

  it("adds a worker from a pasteable blob", async () => {
    let posted: unknown;
    mock = await listen({
      "POST /api/workers": (_req, _url, body) => {
        posted = body;
        return {
          worker: { id: "w1", name: "studio", url: "https://192.168.1.8:7421" },
          config: { workers: [{ id: "w1", name: "studio", url: "https://192.168.1.8:7421" }] },
        };
      },
    });
    const blob = "locus-worker:add?url=https%3A%2F%2F192.168.1.8%3A7421&token=secret&name=studio";
    const result = await cli(["config", "workers", "add", blob]);
    expect(result.code).toBe(0);
    expect(posted).toEqual({ blob });
    expect(result.stdout).toContain("Added studio");
  });

  it("links a repo", async () => {
    mock = await listen({
      "POST /api/repos": (_req, _url, body) => ({
        id: "repo-1",
        name: "Locus",
        checkout: { url: (body as { url: string }).url },
      }),
    });
    const result = await cli([
      "repo",
      "link",
      "--url",
      "https://github.com/Modsofthenation/Locus",
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Locus");
  });

  it("reuses a repo agent, starts a fix session, and lists memories", async () => {
    const repo = {
      id: "repo-1",
      name: "Locus",
      checkout: { url: "https://github.com/Modsofthenation/Locus" },
    };
    let reuse: unknown;
    mock = await listen({
      "GET /api/repos": () => [repo],
      "GET /api/sessions": () => [session],
      "GET /api/sessions/sess-aaa111": () => session,
      "POST /api/repos/repo-1/agents": (_req, _url, body) => {
        reuse = (body as { reuse?: boolean }).reuse;
        return session;
      },
      "POST /api/repos/repo-1/pulls/12/fix-session": () => session,
      "POST /api/repos/repo-1/setup-environment": () => session,
      "GET /api/sessions/sess-aaa111/memories": () => ({
        memories: [{ id: "m1", text: "Default branch is main" }],
      }),
      "POST /api/sessions/sess-aaa111/memories": (_req, _url, body) => ({
        output: `Saved: ${(body as { text?: string }).text}`,
        memories: [{ id: "m1", text: (body as { text?: string }).text }],
      }),
      "GET /api/sessions/sess-aaa111/checkpoints/ck1/diff": () => ({
        diff: "a.txt | 1 +\n\n+two\n",
      }),
    });
    const continued = await cli(["repo", "agent", "repo-1", "--reuse"]);
    expect(continued.code).toBe(0);
    expect(reuse).toBe(true);
    expect(continued.stdout).toContain("sess-aaa111");
    const created = await cli(["repo", "agent", "repo-1", "--new"]);
    expect(created.code).toBe(0);
    expect(reuse).toBe(false);
    const fix = await cli(["repo", "fix-session", "repo-1", "12"]);
    expect(fix.code).toBe(0);
    const setup = await cli(["repo", "setup", "repo-1"]);
    expect(setup.code).toBe(0);
    const listed = await cli(["agent", "memory", "sess-aaa"]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("Default branch is main");
    const added = await cli(["agent", "memory", "sess-aaa", "add", "Uses Vite"]);
    expect(added.code).toBe(0);
    expect(added.stdout).toContain("Uses Vite");
    const diff = await cli(["agent", "checkpoint-diff", "sess-aaa", "ck1"]);
    expect(diff.code).toBe(0);
    expect(diff.stdout).toContain("+two");
  });

  it("lists and creates projects", async () => {
    let created: unknown;
    mock = await listen({
      "GET /api/projects": () => [
        {
          id: "proj-aaa111",
          title: "Auth",
          starter: "feature",
          memberCount: 1,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      "POST /api/projects": (_req, _url, body) => {
        created = body;
        return {
          id: "proj-bbb222",
          title: "Migration",
          recipeId: "migration",
          memberIds: [],
          maxConcurrentMembers: 4,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        };
      },
    });
    const table = await cli(["project", "list"]);
    expect(table.code).toBe(0);
    expect(table.stdout).toContain("Auth");
    const made = await cli(["project", "new", "Migrate CSS", "--starter", "migration"]);
    expect(made.code).toBe(0);
    expect(created).toMatchObject({ starter: "migration", prompt: "Migrate CSS" });
  });

  it("prints brain status and remembers a fact", async () => {
    mock = await listen({
      "GET /api/brain/status": () => ({
        id: "default",
        title: "Brain",
        nodeCount: 0,
        edgeCount: 0,
        memoryCount: 0,
        updatedAt: "2026-01-01T00:00:00Z",
        empty: true,
      }),
      "POST /api/brain/remember": (_req, _url, body) => ({
        id: "default",
        title: "Brain",
        nodes: [],
        edges: [],
        memories: [],
        corpus: [],
        journal: [],
        activity: [],
        repos: [],
        updatedAt: "2026-01-01T00:00:00Z",
        output: `Queued (${(body as { text?: string }).text})`,
      }),
    });
    const status = await cli(["brain", "status"]);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain("default");
    const remembered = await cli(["brain", "remember", "we never bill from the worker"]);
    expect(remembered.code).toBe(0);
    expect(remembered.stdout).toContain("never bill");
  });

  it("lists the brain inbox and accepts a correction", async () => {
    const accepted: string[] = [];
    mock = await listen({
      "GET /api/brain": () => ({
        id: "default",
        title: "Brain",
        nodes: [],
        edges: [],
        memories: [],
        corpus: [],
        journal: [],
        activity: [],
        repos: [],
        corrections: [
          {
            id: "fix:abc",
            nodeId: "service:billing",
            claim: "billing-gateway",
            reason: "Wrong owner",
            status: "open",
            actor: "agent",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
        updatedAt: "2026-01-01T00:00:00Z",
      }),
      "POST /api/brain/correct": (_req, _url, body) => {
        accepted.push((body as { id?: string }).id ?? "");
        return { output: "Accepted fix:abc." };
      },
    });
    const inbox = await cli(["brain", "inbox"]);
    expect(inbox.code).toBe(0);
    expect(inbox.stdout).toContain("Wrong owner");
    const ok = await cli(["brain", "correct", "--accept", "fix:abc"]);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain("Accepted");
    expect(accepted).toEqual(["fix:abc"]);
  });

  it("writes personal brain hooks that post a transcript tail to loopback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-brain-setup-"));
    await mkdir(join(dir, ".git"));
    const hits: string[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk as Buffer));
      req.on("end", () => {
        hits.push(Buffer.concat(chunks).toString("utf8"));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, count: 0 }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const result = await runCli(["brain", "setup", dir, "--port", String(port)]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(".locus/hooks/brain-ingest.mjs");
      const hooks = await readFile(join(dir, ".cursor/hooks.json"), "utf8");
      expect(hooks).toContain("afterAgentResponse");
      expect(hooks).toContain("brain-ingest.mjs cursor");
      const claude = await readFile(join(dir, ".claude/settings.local.json"), "utf8");
      expect(claude).toContain("brain-ingest.mjs claude");
      const exclude = await readFile(join(dir, ".git/info/exclude"), "utf8");
      expect(exclude).toContain(".locus/hooks/");
      const child = spawn(
        process.execPath,
        [join(dir, ".locus/hooks/brain-ingest.mjs"), "cursor"],
        {
          cwd: dir,
          env: { ...process.env, LOCUS_PORT: String(port) },
          stdio: ["pipe", "ignore", "ignore"],
        },
      );
      child.stdin.end(
        JSON.stringify({
          text: "Remember this: we never bill from the worker sk-abcdefghijklmnopqrstuvwxyz012345",
        }),
      );
      const code = await new Promise<number>((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", (status) => resolve(status ?? 1));
      });
      expect(code).toBe(0);
      expect(hits).toHaveLength(1);
      expect(hits[0]).toContain("never bill from the worker");
      expect(hits[0]).toContain("[redacted]");
      expect(hits[0]).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
      expect(hits[0]).toContain('"source":"cursor"');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("prints a helpful error when the server is down", async () => {
    const result = await runCli(["--api", "http://127.0.0.1:1", "status"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("locus serve");
  });
});
