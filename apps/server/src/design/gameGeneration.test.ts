import { afterEach, describe, expect, it } from "vitest";
import {
  GAME_CONTENT_FILES,
  GAME_STYLE_FORMAT,
  DEFAULT_DESIGN_PALETTE,
  type AgentSession,
  type LocusConfig,
} from "@locus/shared";
import { createApp } from "../app.js";
import { Hub } from "../core/hub.js";
import { SessionService } from "../session/sessions.js";
import { JsonStore } from "../core/store.js";
import { MockHypervisor } from "@locus/hypervisor";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cleanup: string[] = [];

afterEach(() => {
  cleanup.length = 0;
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "locus-gg-"));
  cleanup.push(dir);
  const store = new JsonStore(dir);
  await store.init();
  const hypervisor = new MockHypervisor(dir);
  const hub = new Hub();
  const sessions = new SessionService(store, hypervisor, hub);
  const app = createApp({ store, sessions, hypervisor });
  return { dir, store, app };
}

async function createGame(
  app: ReturnType<typeof createApp>,
  extra: Record<string, unknown> = {},
): Promise<AgentSession> {
  const config = (await (await app.request("/api/config")).json()) as LocusConfig;
  const res = await app.request("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      os: "ubuntu",
      templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
      kind: "game",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
      title: "Arena",
      designSystemId: "three-starter",
      ...extra,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as AgentSession;
}

describe("games generation API", () => {
  it("creates a game style, applies it, and lands content plus the Three kit", async () => {
    const ctx = await setup();
    const created = await ctx.app.request("/api/game-styles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Neon tile",
        summary: "Night market",
        guidelines: "Hard pixels.",
        tilePx: 16,
        hud: "arcade",
        juice: "crunchy",
        palette: DEFAULT_DESIGN_PALETTE,
      }),
    });
    expect(created.status).toBe(201);
    const style = (await created.json()) as { id: string; name: string };
    await ctx.app.request(`/api/game-styles/${style.id}/default`, { method: "POST" });

    const session = await createGame(ctx.app);
    expect(session.kind).toBe("game");
    expect(session.gameStyleId).toBe(style.id);
    expect(session.designSystemId).toBe("three-starter");

    const root = join(ctx.dir, "docker-workspaces", session.id);
    const brief = await readFile(join(root, "GAME.md"), "utf8");
    expect(brief).toMatch(/Neon tile/);
    expect(brief).toMatch(/Hard pixels/);
    expect(await readFile(join(root, GAME_CONTENT_FILES.rooms), "utf8")).toContain('"start"');
    expect(await readFile(join(root, GAME_CONTENT_FILES.waves), "utf8")).toContain('"w1"');
    expect(await readFile(join(root, GAME_CONTENT_FILES.deck), "utf8")).toContain('"strike"');
    expect(await readFile(join(root, "GDD.md"), "utf8")).toMatch(/one-page GDD/);
    expect(await readFile(join(root, "vendor/boot-three.js"), "utf8")).toContain("three.module.js");

    const imported = await ctx.app.request("/api/game-styles/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: JSON.stringify({
          format: GAME_STYLE_FORMAT,
          version: 1,
          style: { name: "Imported neon", juice: "floaty" },
        }),
        filename: "neon.locus-game-style.json",
      }),
    });
    expect(imported.status).toBe(201);
    expect(((await imported.json()) as { juice: string }).juice).toBe("floaty");
  });

  it("mints a play link and serves the canvas without /api auth", async () => {
    const ctx = await setup();
    const session = await createGame(ctx.app, { designSystemId: "phaser" });
    const minted = await ctx.app.request(`/api/sessions/${session.id}/play-link`);
    expect(minted.status).toBe(200);
    const link = (await minted.json()) as { token: string; url: string; lanUrls: string[] };
    expect(link.token).toMatch(/^pl_/);
    expect(link.url).toContain(`/play/${link.token}/`);
    expect(Array.isArray(link.lanUrls)).toBe(true);

    const page = await ctx.app.request(`/play/${link.token}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("data-locus-play-booth");
    const missing = await ctx.app.request("/play/pl_nope/");
    expect(missing.status).toBe(404);

    const boot = await ctx.app.request(`/play/${link.token}/vendor/boot-phaser.js`);
    expect(boot.status).toBe(200);
    expect(await boot.text()).toContain("phaser.esm.js");
  });

  it("queues an SFX generate on the game and rejects a bad kind", async () => {
    const ctx = await setup();
    const session = await createGame(ctx.app, { designSystemId: "" });
    const bad = await ctx.app.request(`/api/sessions/${session.id}/generate-asset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "cutscene" }),
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);

    const sfx = await ctx.app.request(`/api/sessions/${session.id}/generate-asset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "sfx" }),
    });
    expect(sfx.status).toBe(201);
    const body = (await sfx.json()) as { game: AgentSession; asset?: AgentSession };
    expect(body.asset).toBeUndefined();
    expect(body.game.id).toBe(session.id);
  });

  it("stores a play-booth note and splits the loop into game.js", async () => {
    const ctx = await setup();
    const session = await createGame(ctx.app);
    const minted = await ctx.app.request(`/api/sessions/${session.id}/play-link`);
    const link = (await minted.json()) as { token: string };
    const emptyScores = await ctx.app.request(`/play/${link.token}/scores`);
    expect(emptyScores.status).toBe(200);
    expect(((await emptyScores.json()) as { scores: unknown[] }).scores).toEqual([]);
    const booth = await ctx.app.request(`/play/${link.token}/booth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        note: "died on the straight",
        seed: 2,
        tape: ["ArrowUp@0+40"],
        score: 18,
        handle: "Ada",
      }),
    });
    expect(booth.status).toBe(200);
    const scored = (await booth.json()) as { scores: Array<{ score: number; handle?: string }> };
    expect(scored.scores[0]).toMatchObject({ score: 18, handle: "Ada" });
    const listed = await ctx.app.request(`/play/${link.token}/scores`);
    expect(((await listed.json()) as { scores: Array<{ score: number }> }).scores[0]?.score).toBe(
      18,
    );
    const root = join(ctx.dir, "docker-workspaces", session.id);
    expect(await readFile(join(root, ".locus-game/studio.json"), "utf8")).toContain(
      "died on the straight",
    );

    await writeFile(
      join(root, "index.html"),
      `<!doctype html><html><body><canvas></canvas><script>
function loop(){ var score = 0; addEventListener("keydown", function(){ score += 1; }); }
loop();
</script></body></html>`,
    );
    const split = await ctx.app.request(`/api/sessions/${session.id}/game/split`, {
      method: "POST",
    });
    expect(split.status).toBe(200);
    expect(await readFile(join(root, "game.js"), "utf8")).toContain("function loop");
    expect(await readFile(join(root, "index.html"), "utf8")).toContain('src="./game.js"');
  });
});
