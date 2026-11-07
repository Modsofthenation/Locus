import { afterEach, describe, expect, it } from "vitest";
import {
  DESIGN_SYSTEM_FORMAT,
  DEFAULT_DESIGN_PALETTE,
  PALETTE_PRESETS,
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
import { zipStore } from "../media/unzip.js";

const cleanup: string[] = [];

afterEach(async () => {
  /* files under tmpdir are left for the OS */
  cleanup.length = 0;
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "locus-ds-"));
  cleanup.push(dir);
  const store = new JsonStore(dir);
  await store.init();
  const hypervisor = new MockHypervisor(dir);
  const hub = new Hub();
  const sessions = new SessionService(store, hypervisor, hub);
  const app = createApp({ store, sessions, hypervisor });
  return { dir, store, app };
}

describe("design systems API", () => {
  it("creates, exports, imports, and applies a system to a design session", async () => {
    const ctx = await setup();
    const listed = await ctx.app.request("/api/design-systems");
    expect(listed.status).toBe(200);
    const empty = (await listed.json()) as { systems: unknown[]; builtins: unknown[] };
    expect(empty.systems).toEqual([]);
    expect(empty.builtins.length).toBeGreaterThan(0);

    const created = await ctx.app.request("/api/design-systems", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Acme",
        summary: "Warm brand",
        palette: PALETTE_PRESETS[2]!.colors,
        guidelines: "No purple gradients.",
      }),
    });
    expect(created.status).toBe(201);
    const system = (await created.json()) as {
      id: string;
      name: string;
      palette: typeof DEFAULT_DESIGN_PALETTE;
    };
    expect(system.name).toBe("Acme");
    expect(system.palette.primary).toBe(PALETTE_PRESETS[2]!.colors.primary);

    const spoof = await ctx.app.request("/api/design-systems", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Fake kit",
        palette: PALETTE_PRESETS[2]!.colors,
        kit: { fileCount: 10, bytes: 999, skillName: "fake" },
      }),
    });
    expect(spoof.status).toBe(201);
    expect(((await spoof.json()) as { kit?: unknown }).kit).toBeUndefined();

    const asDefault = await ctx.app.request(`/api/design-systems/${system.id}/default`, {
      method: "POST",
    });
    expect(asDefault.status).toBe(200);
    expect(((await asDefault.json()) as { defaultId?: string }).defaultId).toBe(system.id);

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
    expect(sessionRes.status).toBe(201);
    const session = (await sessionRes.json()) as AgentSession;
    expect(session.designSystemId).toBe(system.id);
    expect(session.palette).toEqual(PALETTE_PRESETS[2]!.colors);

    const file = {
      format: DESIGN_SYSTEM_FORMAT,
      version: 1,
      system: { name: "Imported", palette: DEFAULT_DESIGN_PALETTE, radiusPx: 4, spacePx: 6 },
    };
    const imported = await ctx.app.request("/api/design-systems/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: JSON.stringify(file), filename: "acme.locus-design.json" }),
    });
    expect(imported.status).toBe(201);
    expect(((await imported.json()) as { name: string }).name).toBe("Imported");

    const fromCss = await ctx.app.request("/api/design-systems/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "brand.html",
        text: `<style>:root { --bg:#111111; --surface:#222222; --text:#fafafa; --muted:#888888; --primary:#e08a4c; --accent:#d4c4a8; --radius: 9px; }</style>`,
      }),
    });
    expect(fromCss.status).toBe(201);
    const cssSystem = (await fromCss.json()) as {
      name: string;
      palette: { primary: string };
      radiusPx: number;
    };
    expect(cssSystem.name).toBe("brand");
    expect(cssSystem.palette.primary).toBe("#e08a4c");
    expect(cssSystem.radiusPx).toBe(9);
  });

  it("imports a Claude Design zip and rejects a tokenless manifest", async () => {
    const ctx = await setup();
    const manifest = {
      namespace: "Frontyard_978eb3",
      components: [],
      cards: [{ path: "components/buttons.html", group: "Components" }],
      tokens: [],
      source: "spa",
    };
    const colors = `<style>:root {
      --primary-600: #196BE6; --copy-50: #F9FAFB; --copy-100: #EBECEE;
      --copy-500: #6B7280; --copy-800: #1F2A37; --navy-600: #1F2937;
      --sans: Inter, sans-serif; --radius: 8px;
    }</style>`;
    const zip = zipStore({
      "frontyard/_ds_manifest.json": JSON.stringify(manifest),
      "frontyard/foundations/colors.html": colors,
    });
    const imported = await ctx.app.request("/api/design-systems/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "frontyard.zip", zipBase64: zip.toString("base64") }),
    });
    expect(imported.status).toBe(201);
    const system = (await imported.json()) as {
      name: string;
      palette: { primary: string; text: string };
      radiusPx: number;
    };
    expect(system.name).toBe("Frontyard");
    expect(system.palette.primary).toBe("#196be6");
    expect(system.palette.text).toBe("#1f2a37");
    expect(system.radiusPx).toBe(8);

    const kitZip = zipStore({
      "_ds_manifest.json": JSON.stringify({
        namespace: "Harbor_a1b2c3",
        cards: [{ path: "preview/colors.html", group: "Colors" }],
        tokens: [],
        source: "spa",
      }),
      "colors_and_type.css": colors,
      "preview/colors.html": colors,
      "uploads/ebook.pdf": Buffer.alloc(80, 1),
    });
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array(kitZip)], "Harbor_Design_System.zip", {
        type: "application/zip",
      }),
    );
    const fromForm = await ctx.app.request("/api/design-systems/import", {
      method: "POST",
      body: form,
    });
    expect(fromForm.status).toBe(201);
    expect(((await fromForm.json()) as { name: string }).name).toBe("Harbor");

    const manifestOnly = await ctx.app.request("/api/design-systems/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "_ds_manifest.json", text: JSON.stringify(manifest) }),
    });
    expect(manifestOnly.status).toBe(400);
    expect(((await manifestOnly.json()) as { error: string }).error).toMatch(/zip/i);
  });

  it("lands skill, UI kits, and assets into a Design workspace and serves them on the canvas", async () => {
    const ctx = await setup();
    const colors = `<style>:root {
      --primary-600: #1F6B4A; --copy-50: #F7F4EE; --copy-100: #EFE8D8;
      --copy-500: #6F6758; --copy-800: #1C1914; --navy-600: #2A3A32;
      --sans: Inter, sans-serif; --radius: 10px;
    }</style>`;
    const zip = zipStore({
      "_ds_manifest.json": JSON.stringify({
        namespace: "Harbor_a1b2c3",
        cards: [{ path: "preview/colors.html", group: "Colors" }],
        tokens: [],
        source: "spa",
      }),
      "colors_and_type.css": colors,
      "skill/harbor-design/SKILL.md":
        "---\ntitle: Harbor\n---\nUse Inter, green CTAs, and marketing ui_kits.\n",
      "ui_kits/marketing/Hero.jsx": "export function Hero() { return <section>Hero</section> }",
      "assets/logo.svg": "<svg xmlns='http://www.w3.org/2000/svg'><title>Harbor</title></svg>",
      "fonts/Inter.ttf": Buffer.alloc(80, 7),
      "uploads/ebook.pdf": Buffer.alloc(80, 1),
      "export/index.html": "<html>nope</html>",
    });
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array(zip)], "Harbor_Design_System.zip", { type: "application/zip" }),
    );
    const imported = await ctx.app.request("/api/design-systems/import", {
      method: "POST",
      body: form,
    });
    expect(imported.status).toBe(201);
    const system = (await imported.json()) as {
      id: string;
      name: string;
      kit?: { skillName?: string; fileCount: number };
    };
    expect(system.name).toBe("Harbor");
    expect(system.kit?.skillName).toBe("harbor-design");
    expect(system.kit?.fileCount).toBeGreaterThanOrEqual(5);
    expect(
      await readFile(join(ctx.dir, "design-kits", system.id, "assets/logo.svg"), "utf8"),
    ).toContain("Harbor");
    expect(
      await readFile(
        join(ctx.dir, "design-kits", system.id, "skill/harbor-design/SKILL.md"),
        "utf8",
      ),
    ).toMatch(/marketing ui_kits/);

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
        designSystemId: system.id,
        startVm: false,
      }),
    });
    expect(sessionRes.status).toBe(201);
    const session = (await sessionRes.json()) as AgentSession;
    const ws = join(ctx.dir, "docker-workspaces", session.id);
    expect(await readFile(join(ws, "ui_kits/marketing/Hero.jsx"), "utf8")).toContain("Hero");
    expect(await readFile(join(ws, "assets/logo.svg"), "utf8")).toContain("Harbor");
    expect(await readFile(join(ws, ".locus/skills/harbor-design.md"), "utf8")).toMatch(/Inter/);

    const asset = await ctx.app.request(`/api/sessions/${session.id}/canvas-files/assets/logo.svg`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toMatch(/svg/);
    expect(asset.headers.get("access-control-allow-origin")).toBe("*");
    expect(await asset.text()).toContain("Harbor");

    const font = await ctx.app.request(`/api/sessions/${session.id}/canvas-files/fonts/Inter.ttf`);
    expect(font.status).toBe(200);
    expect(font.headers.get("content-type")).toBe("font/ttf");
    expect(font.headers.get("cross-origin-resource-policy")).toBe("cross-origin");

    const blank = await ctx.app.request("/api/sessions", {
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
    const other = (await blank.json()) as AgentSession;
    const applied = await ctx.app.request(`/api/sessions/${other.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ designSystemId: system.id }),
    });
    expect(applied.status).toBe(200);
    expect(
      await readFile(join(ctx.dir, "docker-workspaces", other.id, "assets/logo.svg"), "utf8"),
    ).toContain("Harbor");
  });
});
