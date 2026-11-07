import { afterEach, describe, expect, it } from "vitest";
import {
  ASSET_STYLE_FORMAT,
  DEFAULT_DESIGN_PALETTE,
  type AgentSession,
  type LocusConfig,
} from "@locus/shared";
import { createApp } from "../app.js";
import { Hub } from "../core/hub.js";
import { SessionService } from "../session/sessions.js";
import { JsonStore } from "../core/store.js";
import { MockHypervisor } from "@locus/hypervisor";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cleanup: string[] = [];

afterEach(() => {
  cleanup.length = 0;
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "locus-as-"));
  cleanup.push(dir);
  const store = new JsonStore(dir);
  await store.init();
  const hypervisor = new MockHypervisor(dir);
  const hub = new Hub();
  const sessions = new SessionService(store, hypervisor, hub);
  const app = createApp({ store, sessions, hypervisor });
  return { dir, store, app };
}

describe("asset styles API", () => {
  it("creates, defaults, and applies a style to a new assets session", async () => {
    const ctx = await setup();
    const listed = await ctx.app.request("/api/asset-styles");
    expect(listed.status).toBe(200);
    const empty = (await listed.json()) as { styles: unknown[] };
    expect(empty.styles).toEqual([]);

    const created = await ctx.app.request("/api/asset-styles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Clay hero",
        summary: "Chunky terracotta",
        guidelines: "Rounded silhouettes, 2k tris.",
        palette: DEFAULT_DESIGN_PALETTE,
      }),
    });
    expect(created.status).toBe(201);
    const style = (await created.json()) as { id: string; name: string };
    expect(style.name).toBe("Clay hero");

    const asDefault = await ctx.app.request(`/api/asset-styles/${style.id}/default`, {
      method: "POST",
    });
    expect(asDefault.status).toBe(200);
    expect(((await asDefault.json()) as { defaultId?: string }).defaultId).toBe(style.id);

    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const sessionRes = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
        kind: "assets",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
      }),
    });
    expect(sessionRes.status).toBe(201);
    const session = (await sessionRes.json()) as AgentSession;
    expect(session.kind).toBe("assets");
    expect(session.assetStyleId).toBe(style.id);
    const brief = await readFile(
      join(ctx.dir, "docker-workspaces", session.id, "ASSET.md"),
      "utf8",
    );
    expect(brief).toMatch(/Clay hero/);
    expect(brief).toMatch(/2k tris/);
    expect(session.assetBuild).toMatchObject({ topology: "smart", quality: "standard" });
    expect(brief).toMatch(/## Build/);
    expect(brief).toMatch(/Smart topology/);

    const file = {
      format: ASSET_STYLE_FORMAT,
      version: 1,
      style: { name: "Imported clay", guidelines: "Keep the grout." },
    };
    const imported = await ctx.app.request("/api/asset-styles/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: JSON.stringify(file), filename: "clay.locus-asset-style.json" }),
    });
    expect(imported.status).toBe(201);
    expect(((await imported.json()) as { name: string }).name).toBe("Imported clay");
  });

  it("saves a style from an assets studio and applies it to another session", async () => {
    const ctx = await setup();
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const firstRes = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
        kind: "assets",
        title: "Swan mesh",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
        prompt: "A clay swan",
      }),
    });
    expect(firstRes.status).toBe(201);
    const first = (await firstRes.json()) as AgentSession;
    const ws = join(ctx.dir, "docker-workspaces", first.id);
    await import("node:fs/promises").then(({ writeFile, mkdir }) =>
      mkdir(ws, { recursive: true }).then(() =>
        Promise.all([
          writeFile(
            join(ws, "ASSET.md"),
            `# Swan mesh\n\n## Mode\n\n3D mesh.\n\n## Notes\n\n- Rounded clay body, cream grout.\n`,
          ),
          writeFile(
            join(ws, "index.html"),
            `<html data-locus-material="clay"><style>:root{--primary:#c45c26;--accent:#f3e6c8}</style>
<img src="./source.png" /><script>THREE.MeshStandardMaterial</script></html>`,
          ),
        ]),
      ),
    );

    const saved = await ctx.app.request(`/api/sessions/${first.id}/asset-style`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Clay swan" }),
    });
    expect(saved.status).toBe(201);
    const style = (await saved.json()) as { id: string; name: string; guidelines: string };
    expect(style.name).toBe("Clay swan");
    expect(style.guidelines).toMatch(/cream grout/);
    expect(style.guidelines).toMatch(/source\.png/);
    expect(style.guidelines).toMatch(/Clay \/ untextured/);
    expect(style.guidelines).not.toMatch(/^3D mesh\.$/m);

    const bound = (await (
      await ctx.app.request(`/api/sessions/${first.id}`)
    ).json()) as AgentSession;
    expect(bound.assetStyleId).toBe(style.id);

    const nextRes = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
        kind: "assets",
        title: "Clay fox",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
        assetStyleId: style.id,
      }),
    });
    expect(nextRes.status).toBe(201);
    const next = (await nextRes.json()) as AgentSession;
    expect(next.assetStyleId).toBe(style.id);
    expect(await readFile(join(ctx.dir, "docker-workspaces", next.id, "ASSET.md"), "utf8")).toMatch(
      /Clay swan/,
    );
  });

  it("rejects saving a style from a design session", async () => {
    const ctx = await setup();
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const sessionRes = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates.find((t) => t.os === "ubuntu")!.id,
        kind: "design",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
      }),
    });
    const session = (await sessionRes.json()) as AgentSession;
    const saved = await ctx.app.request(`/api/sessions/${session.id}/asset-style`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });
    expect(saved.status).toBe(400);
  });
});
