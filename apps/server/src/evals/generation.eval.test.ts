import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockDockerEngine, MockHypervisor } from "@locus/hypervisor";
import {
  ADHERENCE_NUDGE_PREFIX,
  ASSET_ITERATE_UNCHANGED_NEEDS_HUMAN,
  ASSET_PLAYWRIGHT_NUDGE,
  ASSET_POSE_PRESETS,
  ASSET_SCULPT_NUDGE,
  DESIGN_ADHERENCE_NEEDS_HUMAN,
  DESIGN_ITERATE_UNCHANGED_NEEDS_HUMAN,
  DESIGN_MUTATE_NUDGE,
  DESIGN_QUALITY_NUDGE,
  HOST_FALLBACK_NUDGE,
  DEFAULT_DESIGN_PALETTE,
  DEFAULT_DESIGN_TYPOGRAPHY,
  GAME_FOLLOW_UP_NEEDS_HUMAN,
  GAME_ITERATE_UNCHANGED_NEEDS_HUMAN,
  GAME_JUICE_NUDGE,
  GAME_MUTATE_NUDGE,
  GAME_PLAYWRIGHT_NUDGE,
  feelFromTune,
  iterateAssetPrompt,
  iterateGamePrompt,
  fallbackAssetCanvasHtml,
  fallbackDesignCanvasHtml,
  fallbackGameCanvasHtml,
  looksGenericDesign,
  scoreGenerationEval,
  unusedLinkedAssetsNudge,
} from "@locus/shared";
import type { CompleteRequest } from "@locus/providers";
import { Hub } from "../core/hub.js";
import { SessionService } from "../session/sessions.js";
import { JsonStore } from "../core/store.js";

const DESIGN_SLOP = `<!doctype html><html><head><style>body{font-family:Inter,sans-serif;background:linear-gradient(135deg,#667eea,#764ba2)}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_FALLBACK = `<!doctype html><html lang="en" data-locus-host-fallback="design"><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:ui-sans-serif,system-ui,sans-serif}</style></head><body><h1>First draft</h1></body></html>`;
const ASSET_FALLBACK = `<!doctype html><html lang="en" data-locus-host-fallback="asset"><body><canvas></canvas><script>import * as THREE from "./vendor/three.module.js"; reconstructFromPhoto("./source.png");</script></body></html>`;
const GAME_FALLBACK = `<!doctype html><html lang="en" data-locus-host-fallback="game"><body><script>window.addEventListener('keydown', () => {});</script>Score 0<button>Restart</button></body></html>`;
const DESIGN_FALLBACK_UNSTAMPED = fallbackDesignCanvasHtml(
  "Design a distinctive editorial landing",
  DEFAULT_DESIGN_PALETTE,
).replace(/\s*data-locus-host-fallback="design"/, "");
const ASSET_FALLBACK_UNSTAMPED = fallbackAssetCanvasHtml(
  "Build a wired 3D hero mesh",
  DEFAULT_DESIGN_PALETTE,
).replace(/\s*data-locus-host-fallback="asset"/, "");
const DESIGN_FALLBACK_MUTATED = DESIGN_FALLBACK_UNSTAMPED.replace("14%", "15%");
const DESIGN_FALLBACK_TWO_TOKEN = DESIGN_FALLBACK_UNSTAMPED.replace("14%", "15%").replace(
  /First draft/g,
  "Draft",
);
const ASSET_FALLBACK_MUTATED = ASSET_FALLBACK_UNSTAMPED.replace("72, 118", "70, 110");
const GAME_FALLBACK_UNSTAMPED = fallbackGameCanvasHtml(
  "Dodge rocks with arrows.",
  DEFAULT_DESIGN_PALETTE,
).replace(/\s*data-locus-host-fallback="game"/, "");
const GAME_FALLBACK_TWO_TOKEN_JUICED = GAME_FALLBACK_UNSTAMPED.replace("x: 420", "x: 421")
  .replace("x-12, y-24, 24, 24", "x-10, y-20, 20, 20")
  .replace("const keys = {};", "const keys = {}; function beep(){ new AudioContext(); }");
const DESIGN_GEIST = `<!doctype html><html><head><style>body{font-family:Geist,sans-serif}</style></head><body><div class="bg-gradient-to-br from-indigo-500">Hi</div></body></html>`;
const DESIGN_INDIGO = `<!doctype html><html><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:"Iowan Old Style",serif;background:var(--bg);color:var(--text)}</style></head><body><div class="bg-indigo-600"><h1>Press ledger</h1></div></body></html>`;
const DESIGN_OKLCH = `<!doctype html><html><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:"Iowan Old Style",serif;background:oklch(0.546 0.245 262.881);color:var(--text)}</style></head><body><h1>Press ledger</h1></body></html>`;
const DESIGN_HWB = `<!doctype html><html><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:"Iowan Old Style",serif;background:hwb(239 39% 5%);color:var(--text)}</style></head><body><h1>Press ledger</h1></body></html>`;
const DESIGN_HSL_NUMBER = `<!doctype html><html><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:"Iowan Old Style",serif;background:hsl(239.1 84.2 66.7);color:var(--text)}</style></head><body><h1>Press ledger</h1></body></html>`;
const DESIGN_RGB_PERCENT = `<!doctype html><html><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:"Iowan Old Style",serif;background:rgb(38.8% 40% 94.5%);color:var(--text)}</style></head><body><h1>Press ledger</h1></body></html>`;
const DESIGN_TW_BARE = `<!doctype html><html><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:"Iowan Old Style",serif;background:var(--bg);color:var(--text)}</style></head><body><div class="bg-indigo"><h1>Press ledger</h1></div></body></html>`;
const DESIGN_P3 = `<!doctype html><html><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:"Iowan Old Style",serif;background:color(display-p3 0.3904 0.3996 0.9126);color:var(--text)}</style></head><body><h1>Press ledger</h1></body></html>`;
const DESIGN_REC2020 = `<!doctype html><html><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:"Iowan Old Style",serif;background:color(rec2020 0.3828 0.3557 0.8958);color:var(--text)}</style></head><body><h1>Press ledger</h1></body></html>`;
const DESIGN_PROPHOTO = `<!doctype html><html><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:"Iowan Old Style",serif;background:color(prophoto-rgb 0.388 0.400 0.945);color:var(--text)}</style></head><body><h1>Press ledger</h1></body></html>`;
const DESIGN_COLOR_OKLCH = `<!doctype html><html><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:"Iowan Old Style",serif;background:color(oklch 0.546 0.245 262.881);color:var(--text)}</style></head><body><h1>Press ledger</h1></body></html>`;
const DESIGN_NAMED = `<!doctype html><html><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:"Iowan Old Style",serif;background:indigo;color:var(--text)}</style></head><body><h1>Press ledger</h1></body></html>`;
const DESIGN_PURPLE = `<!doctype html><html><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:"Iowan Old Style",serif;background:purple;color:var(--text)}</style></head><body><h1>Press ledger</h1></body></html>`;
const DESIGN_NAVY = `<!doctype html><html><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:"Iowan Old Style",serif;background:navy;color:var(--text)}</style></head><body><h1>Press ledger</h1></body></html>`;
const DESIGN_SHORTHAND = `<!doctype html><html><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:"Iowan Old Style",serif;background:var(--bg);color:var(--text);border-top:1px solid indigo}</style></head><body><h1>Press ledger</h1></body></html>`;
const DESIGN_INSTRUMENT = `<!doctype html><html><head><style>body{font-family:"Instrument Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_FONT_SHORTHAND = `<!doctype html><html><head><style>body{font:16px/1.4 "Instrument Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_RADIAL = `<!doctype html><html><head><style>body{font-family:Urbanist,sans-serif;background:radial-gradient(#111,#222)}</style></head><body><h1>Press ledger</h1></body></html>`;
const DESIGN_TW_SANS = `<!doctype html><html><body class="font-sans"><h1>Unlock your potential</h1></body></html>`;
const DESIGN_SYNE = `<!doctype html><html><head><style>body{font-family:Syne,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_RECKLESS = `<!doctype html><html><head><style>body{font-family:Reckless,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_FAVORIT = `<!doctype html><html><head><style>body{font-family:Favorit,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_NEUE_MONTREAL = `<!doctype html><html><head><style>body{font-family:"PP Neue Montreal",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_PP_RIGHT = `<!doctype html><html><head><style>body{font-family:"PP Right Grotesk",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_GRAPHIK = `<!doctype html><html><head><style>body{font-family:Graphik,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_CIRCULAR = `<!doctype html><html><head><style>body{font-family:Circular,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_LATO = `<!doctype html><html><head><style>body{font-family:Lato,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_DIDOT = `<!doctype html><html><head><style>body{font-family:Didot,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_CASLON = `<!doctype html><html><head><style>body{font-family:Caslon,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_BEBAS = `<!doctype html><html><head><style>body{font-family:"Bebas Neue",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_COMFORTAA = `<!doctype html><html><head><style>body{font-family:Comfortaa,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_SENTINEL = `<!doctype html><html><head><style>body{font-family:Sentinel,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_VERLAG = `<!doctype html><html><head><style>body{font-family:Verlag,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_IDLEWILD = `<!doctype html><html><head><style>body{font-family:Idlewild,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_CALIBRE = `<!doctype html><html><head><style>body{font-family:Calibre,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_STYRENE = `<!doctype html><html><head><style>body{font-family:Styrene,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_GILL = `<!doctype html><html><head><style>body{font-family:"Gill Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_TRAJAN = `<!doctype html><html><head><style>body{font-family:Trajan,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_MENLO = `<!doctype html><html><head><style>body{font-family:Menlo,monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_WARNOCK = `<!doctype html><html><head><style>body{font-family:Warnock,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_CASCADIA = `<!doctype html><html><head><style>body{font-family:"Cascadia Code",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_INPUT = `<!doctype html><html><head><style>body{font-family:"Input Mono",monospace;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_CLASH_GROTESK = `<!doctype html><html><head><style>body{font-family:"Clash Grotesk",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_CHARTER = `<!doctype html><html><head><style>body{font-family:Charter,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_MILLER = `<!doctype html><html><head><style>body{font-family:Miller,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_MONA = `<!doctype html><html><head><style>body{font-family:"Mona Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_EVERETT = `<!doctype html><html><head><style>body{font-family:"TWK Everett",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_SPECTRAL = `<!doctype html><html><head><style>body{font-family:Spectral,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_YESEVA = `<!doctype html><html><head><style>body{font-family:"Yeseva One",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_VULF = `<!doctype html><html><head><style>body{font-family:"Vulf Sans",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_DEGULAR = `<!doctype html><html><head><style>body{font-family:Degular,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_ORBITRON = `<!doctype html><html><head><style>body{font-family:Orbitron,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_YOUNG = `<!doctype html><html><head><style>body{font-family:"Young Serif",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_COPPERPLATE = `<!doctype html><html><head><style>body{font-family:Copperplate,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_HEEBO = `<!doctype html><html><head><style>body{font-family:Heebo,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_ASSISTANT = `<!doctype html><html><head><style>body{font-family:Assistant,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_OXYGEN = `<!doctype html><html><head><style>body{font-family:Oxygen,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_ALEGREYA = `<!doctype html><html><head><style>body{font-family:Alegreya,serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_ELECTROLIZE = `<!doctype html><html><head><style>body{font-family:Electrolize,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_INDIE = `<!doctype html><html><head><style>body{font-family:"Indie Flower",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_KALAM = `<!doctype html><html><head><style>body{font-family:Kalam,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_STAATLICHES = `<!doctype html><html><head><style>body{font-family:Staatliches,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_CAIRO = `<!doctype html><html><head><style>body{font-family:Cairo,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_NANUM = `<!doctype html><html><head><style>body{font-family:"Nanum Gothic",sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_TANGERINE = `<!doctype html><html><head><style>body{font-family:Tangerine,cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_K2D = `<!doctype html><html><head><style>body{font-family:K2D,sans-serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_REENIE = `<!doctype html><html><head><style>body{font-family:"Reenie Beanie",cursive;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_SCHEHERAZADE = `<!doctype html><html><head><style>body{font-family:"Scheherazade New",serif;background:#fff}</style></head><body><h1>Unlock your potential</h1></body></html>`;
const DESIGN_OK = `<!doctype html><html><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:Georgia,serif;background:var(--bg);color:var(--text)}</style></head><body><h1>Press ledger</h1></body></html>`;
const DESIGN_HEADLINE = `<!doctype html><html><head><style>:root{--bg:#111;--text:#eee;--primary:#e08;--line:#333}body{font-family:Georgia,serif;background:var(--bg);color:var(--text)}</style></head><body><h1>Night press</h1></body></html>`;
const DESIGN_KIT_HEX = `<!doctype html><html><head><style>:root{--bg:#111114;--surface:#1c1c22;--text:#f4f1ea;--muted:#9a958c;--primary:#e08a4c;--accent:#d4c4a8;--line:#333}body{font-family:"Iowan Old Style",Palatino,serif;background:var(--bg);color:var(--text)}.mark{color:#ff00aa}</style></head><body><h1>Press ledger</h1></body></html>`;
const GAME_DRY =
  "<!doctype html><html><body><script>window.addEventListener('keydown', () => {});</script>Score 0<button>Restart</button></body></html>";
const GAME_OK =
  "<!doctype html><html><body><script>window.addEventListener('keydown', () => {}); function beep(){ new AudioContext().createOscillator(); }</script>Score 0<button>Restart</button></body></html>";
const GAME_MODE =
  '<!doctype html><html><body><script>window.addEventListener(\'keydown\', () => {}); function beep(){ new AudioContext().createOscillator(); }</script>Score 0<button type="button" id="bMode">Mode: Race</button><button>Restart</button></body></html>';
const GAME_USED =
  "<!doctype html><html><body><script>window.addEventListener('keydown', () => {}); function beep(){ new AudioContext().createOscillator(); } drawImage(\"vendor/assets/knight/source.png\");</script>Score 0<button>Restart</button></body></html>";
const ASSET_EMPTY = `<!doctype html><html><body><canvas></canvas><script>import * as THREE from "./vendor/three.module.js"</script></body></html>`;
const ASSET_OK = `<!doctype html><html><body><canvas></canvas><script>import * as THREE from "./vendor/three.module.js"; reconstructFromPhoto("./source.png");</script></body></html>`;
const ASSET_RETOPO = `<!doctype html><html><body><canvas></canvas><script>import * as THREE from "./vendor/three.module.js"; reconstructFromPhoto("./source.png"); mesh.geometry.setAttribute("position", pos);</script></body></html>`;

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

async function waitFor(
  sessions: SessionService,
  id: string,
  pred: (session: NonNullable<Awaited<ReturnType<SessionService["get"]>>>) => boolean,
) {
  const deadline = Date.now() + 15_000;
  let fresh = await sessions.get(id);
  while (Date.now() < deadline) {
    fresh = await sessions.get(id);
    if (fresh && pred(fresh)) return fresh;
    await new Promise((r) => setTimeout(r, 20));
  }
  return fresh;
}

async function runCanvasEval(input: {
  kind: "design" | "game" | "assets";
  slop: string;
  ok: string;
  prompt: string;
  seedHtml?: string;
  assetRefs?: Array<{ sessionId: string; slug: string; title?: string }>;
  designSystemId?: string;
}): Promise<{ html: string | null; messages: string[]; needsHuman?: string }> {
  const dir = await mkdtemp(join(tmpdir(), "locus-generation-eval-"));
  cleanup.push(dir);
  const store = new JsonStore(dir);
  await store.init();
  const config = await store.loadConfig();
  const provider = config.providers[0]!;
  provider.apiKey = "sk-test";
  await store.saveConfig(config);
  if (input.designSystemId) {
    await store.saveDesignSystems([
      {
        id: input.designSystemId,
        name: "Eval kit",
        summary: "Kit with leftover hex",
        palette: DEFAULT_DESIGN_PALETTE,
        typography: DEFAULT_DESIGN_TYPOGRAPHY,
        radiusPx: 12,
        spacePx: 8,
        kit: { fileCount: 1, bytes: 32, skillName: "evalkit" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  }
  let round = 0;
  async function* engine(_req: CompleteRequest) {
    round += 1;
    if (round === 1) {
      yield {
        type: "tool_call" as const,
        id: "w1",
        name: "file_write",
        arguments: { path: "/workspace/index.html", content: input.slop },
      };
      return;
    }
    if (round === 2) {
      yield { type: "tool_call" as const, id: "p1", name: "playwright", arguments: {} };
      return;
    }
    if (round === 3) {
      yield {
        type: "tool_call" as const,
        id: "w2",
        name: "file_write",
        arguments: { path: "/workspace/index.html", content: input.ok },
      };
      return;
    }
    yield { type: "text" as const, text: "Canvas quality pass landed." };
  }
  const hypervisor = new MockHypervisor(dir);
  const docker = new MockDockerEngine(dir);
  const sessions = new SessionService(store, hypervisor, new Hub(), engine, undefined, docker);
  const created = await sessions.create({
    os: "ubuntu",
    templateId: config.templates[0]!.id,
    kind: input.kind,
    runtime: "docker",
    dockerImage: "locus/agent",
    providerId: provider.id,
    model: "x-preview-f-free",
    startVm: true,
    designSystemId: input.designSystemId,
    prompt: input.assetRefs?.length || input.seedHtml ? undefined : input.prompt,
  });
  try {
    if (input.seedHtml) {
      await sessions.workspace.writeWorkspace(created.id, "index.html", input.seedHtml);
    }
    if (input.assetRefs?.length) {
      await store.mutateSession(created.id, (current) => {
        current.assetRefs = input.assetRefs;
      });
    }
    if (input.assetRefs?.length || input.seedHtml) {
      await sessions.sendChat(created.id, input.prompt);
    }
    const done = await waitFor(
      sessions,
      created.id,
      (session) =>
        session.status !== "running" &&
        session.messages.some((m) => m.content.includes("Canvas quality pass landed")),
    );
    const html = (await sessions.design.readCanvas(created.id).catch(() => ({ html: null }))).html;
    return {
      html,
      messages: (done?.messages ?? []).map((m) => m.content),
      needsHuman: done?.needsHuman,
    };
  } finally {
    await sessions.abortChat(created.id).catch(() => undefined);
    hypervisor.shutdown();
  }
}

describe("generation harness smoke", () => {
  it("design-slop: generic first paint, look, quality patch, distinctive canvas", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_SLOP,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({ id: "design-slop", kind: "design", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-indigo: Iowan plus solid indigo utility, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_INDIGO)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_INDIGO,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({ id: "design-indigo", kind: "design", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-oklch: Iowan plus oklch indigo, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_OKLCH)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_OKLCH,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({ id: "design-oklch", kind: "design", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-hwb: Iowan plus hwb indigo, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_HWB)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_HWB,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({ id: "design-hwb", kind: "design", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-hsl-number: Iowan plus unitless hsl indigo, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_HSL_NUMBER)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_HSL_NUMBER,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-hsl-number",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-rgb-percent: Iowan plus rgb() percent indigo, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_RGB_PERCENT)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_RGB_PERCENT,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-rgb-percent",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-tw-bare: Iowan plus unshaded Tailwind indigo, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_TW_BARE)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_TW_BARE,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-tw-bare",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-p3: Iowan plus display-p3 indigo, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_P3)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_P3,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({ id: "design-p3", kind: "design", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-rec2020: Iowan plus rec2020 indigo, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_REC2020)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_REC2020,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({ id: "design-rec2020", kind: "design", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-prophoto: Iowan plus prophoto-rgb indigo, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_PROPHOTO)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_PROPHOTO,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({ id: "design-prophoto", kind: "design", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-color-oklch: Iowan plus color(oklch) indigo, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_COLOR_OKLCH)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_COLOR_OKLCH,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-color-oklch",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-named: Iowan plus named CSS indigo, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_NAMED)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_NAMED,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({ id: "design-named", kind: "design", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-purple: Iowan plus named CSS purple, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_PURPLE)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_PURPLE,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({ id: "design-purple", kind: "design", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-navy: Iowan plus named CSS navy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_NAVY)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_NAVY,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({ id: "design-navy", kind: "design", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-shorthand: Iowan plus border-top indigo, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_SHORTHAND)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_SHORTHAND,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({ id: "design-shorthand", kind: "design", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-instrument: Instrument Sans plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_INSTRUMENT)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_INSTRUMENT,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-instrument",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-font-shorthand: Instrument Sans font: shorthand plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_FONT_SHORTHAND)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_FONT_SHORTHAND,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-font-shorthand",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-radial: Urbanist plus radial-gradient, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_RADIAL)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_RADIAL,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-radial",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-tw-sans: Tailwind font-sans plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_TW_SANS)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_TW_SANS,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-tw-sans",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-syne: Syne plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_SYNE)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_SYNE,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-syne",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-reckless: Reckless plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_RECKLESS)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_RECKLESS,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-reckless",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-favorit: Favorit plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_FAVORIT)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_FAVORIT,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-favorit",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-neue-montreal: PP Neue Montreal plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_NEUE_MONTREAL)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_NEUE_MONTREAL,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-neue-montreal",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-pp-right: PP Right Grotesk plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_PP_RIGHT)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_PP_RIGHT,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-pp-right",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-graphik: Graphik plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_GRAPHIK)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_GRAPHIK,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-graphik",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-circular: Circular plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_CIRCULAR)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_CIRCULAR,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-circular",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-lato: Lato plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_LATO)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_LATO,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-lato",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-didot: Didot plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_DIDOT)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_DIDOT,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-didot",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-caslon: Caslon plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_CASLON)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_CASLON,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-caslon",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-bebas: Bebas Neue plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_BEBAS)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_BEBAS,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-bebas",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-comfortaa: Comfortaa plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_COMFORTAA)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_COMFORTAA,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-comfortaa",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-sentinel: Sentinel plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_SENTINEL)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_SENTINEL,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-sentinel",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-verlag: Verlag plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_VERLAG)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_VERLAG,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-verlag",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-idlewild: Idlewild plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_IDLEWILD)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_IDLEWILD,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-idlewild",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-calibre: Calibre plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_CALIBRE)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_CALIBRE,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-calibre",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-styrene: Styrene plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_STYRENE)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_STYRENE,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-styrene",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-gill: Gill Sans plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_GILL)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_GILL,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-gill",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-trajan: Trajan plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_TRAJAN)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_TRAJAN,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-trajan",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-menlo: Menlo plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_MENLO)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_MENLO,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-menlo",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-warnock: Warnock plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_WARNOCK)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_WARNOCK,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-warnock",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-cascadia: Cascadia Code plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_CASCADIA)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_CASCADIA,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-cascadia",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-input: Input Mono plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_INPUT)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_INPUT,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-input",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-clash-grotesk: Clash Grotesk plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_CLASH_GROTESK)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_CLASH_GROTESK,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-clash-grotesk",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-charter: Charter plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_CHARTER)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_CHARTER,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-charter",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-miller: Miller plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_MILLER)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_MILLER,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-miller",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-mona: Mona Sans plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_MONA)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_MONA,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-mona",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-everett: TWK Everett plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_EVERETT)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_EVERETT,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-everett",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-spectral: Spectral plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_SPECTRAL)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_SPECTRAL,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-spectral",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-yeseva: Yeseva One plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_YESEVA)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_YESEVA,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-yeseva",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-vulf: Vulf Sans plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_VULF)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_VULF,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-vulf",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-degular: Degular plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_DEGULAR)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_DEGULAR,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-degular",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-orbitron: Orbitron plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_ORBITRON)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_ORBITRON,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-orbitron",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-young: Young Serif plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_YOUNG)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_YOUNG,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-young",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-copperplate: Copperplate plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_COPPERPLATE)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_COPPERPLATE,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-copperplate",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-heebo: Heebo plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_HEEBO)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_HEEBO,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-heebo",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-assistant: Assistant plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_ASSISTANT)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_ASSISTANT,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-assistant",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-oxygen: Oxygen plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_OXYGEN)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_OXYGEN,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-oxygen",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-alegreya: Alegreya plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_ALEGREYA)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_ALEGREYA,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-alegreya",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-electrolize: Electrolize plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_ELECTROLIZE)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_ELECTROLIZE,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-electrolize",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-indie: Indie Flower plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_INDIE)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_INDIE,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-indie",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-kalam: Kalam plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_KALAM)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_KALAM,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-kalam",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-staatliches: Staatliches plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_STAATLICHES)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_STAATLICHES,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-staatliches",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-cairo: Cairo plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_CAIRO)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_CAIRO,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-cairo",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-nanum: Nanum Gothic plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_NANUM)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_NANUM,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-nanum",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-tangerine: Tangerine plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_TANGERINE)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_TANGERINE,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-tangerine",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-k2d: K2D plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_K2D)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_K2D,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-k2d",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-reenie: Reenie Beanie plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_REENIE)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_REENIE,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-reenie",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-scheherazade: Scheherazade New plus unlock copy, look, quality patch, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_SCHEHERAZADE)).toBe(true);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_SCHEHERAZADE,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-scheherazade",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-geist: Geist indigo utilities, look, quality patch, distinctive canvas", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_GEIST,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({ id: "design-geist", kind: "design", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("game-dry: playable first paint, look, juice patch, juicy loop", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "game",
      slop: GAME_DRY,
      ok: GAME_OK,
      prompt: "Build a playable arcade loop",
    });
    expect(messages).toContain(GAME_JUICE_NUDGE);
    const score = scoreGenerationEval({ id: "game-dry", kind: "game", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "playable" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("asset-empty: empty Three canvas, look, sculpt patch, reconstruct hull", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "assets",
      slop: ASSET_EMPTY,
      ok: ASSET_OK,
      prompt: "Build a wired 3D hero mesh",
    });
    expect(messages).toContain(ASSET_SCULPT_NUDGE);
    const score = scoreGenerationEval({ id: "asset-empty", kind: "asset", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "wired" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("game-unused: juicy first paint with linked packs, look, load note, vendor path", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "game",
      slop: GAME_OK,
      ok: GAME_USED,
      prompt: "Build a playable arcade loop with the knight pack",
      assetRefs: [{ sessionId: "asset-knight", slug: "knight", title: "Knight" }],
    });
    expect(messages).toContain(unusedLinkedAssetsNudge(["knight"]));
    const score = scoreGenerationEval({
      id: "game-unused",
      kind: "game",
      html: html ?? "",
      assetSlugs: ["knight"],
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "playable" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-host-fallback: host stub first paint, look, rewrite note, distinctive canvas", async () => {
    expect(looksGenericDesign(DESIGN_FALLBACK)).toBe(false);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_FALLBACK,
      ok: DESIGN_OK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(HOST_FALLBACK_NUDGE);
    expect(messages).not.toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-host-fallback",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-host-fallback-stuck: host stub, look, talk through quality cap, needs a human", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_FALLBACK,
      ok: DESIGN_FALLBACK,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(HOST_FALLBACK_NUDGE);
    const score = scoreGenerationEval({
      id: "design-host-fallback-stuck",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: false, reason: "host fallback" });
    expect(needsHuman).toMatch(/starter draft on this canvas/);
  }, 30_000);

  it("game-host-fallback: host stub first paint, look, rewrite note, juicy loop", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "game",
      slop: GAME_FALLBACK,
      ok: GAME_OK,
      prompt: "Build a playable arcade loop",
    });
    expect(messages).toContain(HOST_FALLBACK_NUDGE);
    expect(messages).not.toContain(GAME_JUICE_NUDGE);
    const score = scoreGenerationEval({ id: "game-host-fallback", kind: "game", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "playable" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("asset-host-fallback: host stub first paint, look, rewrite note, reconstruct hull", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "assets",
      slop: ASSET_FALLBACK,
      ok: ASSET_OK,
      prompt: "Build a wired 3D hero mesh",
    });
    expect(messages).toContain(HOST_FALLBACK_NUDGE);
    expect(messages).not.toContain(ASSET_SCULPT_NUDGE);
    const score = scoreGenerationEval({
      id: "asset-host-fallback",
      kind: "asset",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "wired" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-host-fallback-unstamped-stuck: stripped host stub, look, talk through quality cap, needs a human", async () => {
    expect(DESIGN_FALLBACK_UNSTAMPED).not.toMatch(/data-locus-host-fallback/);
    expect(looksGenericDesign(DESIGN_FALLBACK_UNSTAMPED)).toBe(false);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_FALLBACK_UNSTAMPED,
      ok: DESIGN_FALLBACK_UNSTAMPED,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(HOST_FALLBACK_NUDGE);
    const score = scoreGenerationEval({
      id: "design-host-fallback-unstamped-stuck",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: false, reason: "host fallback" });
    expect(needsHuman).toMatch(/starter draft on this canvas/);
  }, 30_000);

  it("asset-host-fallback-unstamped-stuck: stripped host stub, look, talk through quality cap, needs a human", async () => {
    expect(ASSET_FALLBACK_UNSTAMPED).not.toMatch(/data-locus-host-fallback/);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "assets",
      slop: ASSET_FALLBACK_UNSTAMPED,
      ok: ASSET_FALLBACK_UNSTAMPED,
      prompt: "Build a wired 3D hero mesh",
    });
    expect(messages).toContain(HOST_FALLBACK_NUDGE);
    expect(messages).not.toContain(ASSET_SCULPT_NUDGE);
    const score = scoreGenerationEval({
      id: "asset-host-fallback-unstamped-stuck",
      kind: "asset",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: false, reason: "host fallback" });
    expect(needsHuman).toMatch(/starter draft on this canvas/);
  }, 30_000);

  it("design-host-fallback-mutated-stuck: one-token stub edit, look, talk through quality cap, needs a human", async () => {
    expect(DESIGN_FALLBACK_MUTATED).not.toMatch(/data-locus-host-fallback/);
    expect(DESIGN_FALLBACK_MUTATED).toMatch(/15%/);
    expect(looksGenericDesign(DESIGN_FALLBACK_MUTATED)).toBe(false);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_FALLBACK_MUTATED,
      ok: DESIGN_FALLBACK_MUTATED,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(HOST_FALLBACK_NUDGE);
    const score = scoreGenerationEval({
      id: "design-host-fallback-mutated-stuck",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: false, reason: "host fallback" });
    expect(needsHuman).toMatch(/starter draft on this canvas/);
  }, 30_000);

  it("design-host-fallback-two-token-stuck: two-token stub edit, look, talk through quality cap, needs a human", async () => {
    expect(DESIGN_FALLBACK_TWO_TOKEN).not.toMatch(/data-locus-host-fallback/);
    expect(DESIGN_FALLBACK_TWO_TOKEN).toMatch(/15%/);
    expect(DESIGN_FALLBACK_TWO_TOKEN).not.toMatch(/First draft/);
    expect(looksGenericDesign(DESIGN_FALLBACK_TWO_TOKEN)).toBe(false);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_FALLBACK_TWO_TOKEN,
      ok: DESIGN_FALLBACK_TWO_TOKEN,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(HOST_FALLBACK_NUDGE);
    expect(messages).not.toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({
      id: "design-host-fallback-two-token-stuck",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: false, reason: "host fallback" });
    expect(needsHuman).toMatch(/starter draft on this canvas/);
  }, 30_000);

  it("game-host-fallback-two-token-stuck: two-token juiced stub, look, rewrite note, needs a human", async () => {
    expect(GAME_FALLBACK_TWO_TOKEN_JUICED).not.toMatch(/data-locus-host-fallback/);
    expect(GAME_FALLBACK_TWO_TOKEN_JUICED).toMatch(/x: 421/);
    expect(GAME_FALLBACK_TWO_TOKEN_JUICED).toMatch(/AudioContext/);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "game",
      slop: GAME_FALLBACK_TWO_TOKEN_JUICED,
      ok: GAME_FALLBACK_TWO_TOKEN_JUICED,
      prompt: "Build a playable arcade loop",
    });
    expect(messages).toContain(HOST_FALLBACK_NUDGE);
    expect(messages).not.toContain(GAME_JUICE_NUDGE);
    const score = scoreGenerationEval({
      id: "game-host-fallback-two-token-stuck",
      kind: "game",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: false, reason: "host fallback" });
    expect(needsHuman).toMatch(/starter draft on this canvas/);
  }, 30_000);

  it("asset-host-fallback-mutated-stuck: one-token stub edit, look, talk through quality cap, needs a human", async () => {
    expect(ASSET_FALLBACK_MUTATED).not.toMatch(/data-locus-host-fallback/);
    expect(ASSET_FALLBACK_MUTATED).toMatch(/70, 110/);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "assets",
      slop: ASSET_FALLBACK_MUTATED,
      ok: ASSET_FALLBACK_MUTATED,
      prompt: "Build a wired 3D hero mesh",
    });
    expect(messages).toContain(HOST_FALLBACK_NUDGE);
    expect(messages).not.toContain(ASSET_SCULPT_NUDGE);
    const score = scoreGenerationEval({
      id: "asset-host-fallback-mutated-stuck",
      kind: "asset",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: false, reason: "host fallback" });
    expect(needsHuman).toMatch(/starter draft on this canvas/);
  }, 30_000);

  it("design-stuck: generic first paint, look, talk through quality cap, needs a human", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_SLOP,
      ok: DESIGN_SLOP,
      prompt: "Design a distinctive editorial landing",
    });
    expect(messages).toContain(DESIGN_QUALITY_NUDGE);
    const score = scoreGenerationEval({ id: "design-stuck", kind: "design", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: false, reason: "generic template" });
    expect(needsHuman).toMatch(/generic AI template/);
  }, 30_000);

  it("design-adherence-stuck: distinctive first paint with unmapped kit hex, look, talk through cap, needs a human", async () => {
    expect(looksGenericDesign(DESIGN_KIT_HEX)).toBe(false);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      slop: DESIGN_KIT_HEX,
      ok: DESIGN_KIT_HEX,
      prompt: "Design a distinctive editorial landing",
      designSystemId: "eval-kit",
    });
    expect(messages.some((row) => row.startsWith(ADHERENCE_NUDGE_PREFIX))).toBe(true);
    const score = scoreGenerationEval({
      id: "design-adherence-stuck",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBe(DESIGN_ADHERENCE_NEEDS_HUMAN);
  }, 30_000);

  it("design-change: distinctive canvas, make the headline bolder, look, mutate patch, ships", async () => {
    expect(looksGenericDesign(DESIGN_OK)).toBe(false);
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      seedHtml: DESIGN_OK,
      slop: DESIGN_OK,
      ok: DESIGN_HEADLINE,
      prompt: "make the headline bolder",
    });
    expect(messages).toContain(DESIGN_MUTATE_NUDGE);
    const score = scoreGenerationEval({
      id: "design-change",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("design-change-stuck: distinctive canvas, make the headline bolder, look, talk through mutate cap, needs a human", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "design",
      seedHtml: DESIGN_OK,
      slop: DESIGN_OK,
      ok: DESIGN_OK,
      prompt: "make the headline bolder",
    });
    expect(messages).toContain(DESIGN_MUTATE_NUDGE);
    const score = scoreGenerationEval({
      id: "design-change-stuck",
      kind: "design",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "distinctive canvas" });
    expect(needsHuman).toBe(DESIGN_ITERATE_UNCHANGED_NEEDS_HUMAN);
  }, 30_000);

  it("game-control: juicy first paint missing #bMode, look, mutate patch, control lands", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "game",
      slop: GAME_OK,
      ok: GAME_MODE,
      prompt: "add #bMode for race",
    });
    expect(messages).toContain(GAME_MUTATE_NUDGE);
    const score = scoreGenerationEval({ id: "game-control", kind: "game", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "playable" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("game-control-stuck: juicy first paint missing #bMode, look, talk through mutate cap, needs a human", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "game",
      slop: GAME_OK,
      ok: GAME_OK,
      prompt: "add #bMode for race",
    });
    expect(messages).toContain(GAME_MUTATE_NUDGE);
    const score = scoreGenerationEval({
      id: "game-control-stuck",
      kind: "game",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "playable" });
    expect(needsHuman).toBe(GAME_FOLLOW_UP_NEEDS_HUMAN);
  }, 30_000);

  it("game-iterate: juicy canvas, Soften chip, look, mutate patch, ships", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "game",
      seedHtml: GAME_OK,
      slop: GAME_OK,
      ok: GAME_MODE,
      prompt: iterateGamePrompt("soften", { feel: feelFromTune(), seed: 0 }),
    });
    expect(messages).toContain(GAME_PLAYWRIGHT_NUDGE);
    expect(messages).toContain(GAME_MUTATE_NUDGE);
    const score = scoreGenerationEval({ id: "game-iterate", kind: "game", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "playable" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("game-iterate-stuck: juicy canvas, Soften chip, look, talk through mutate cap, needs a human", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "game",
      seedHtml: GAME_OK,
      slop: GAME_OK,
      ok: GAME_OK,
      prompt: iterateGamePrompt("soften", { feel: feelFromTune(), seed: 0 }),
    });
    expect(messages).toContain(GAME_PLAYWRIGHT_NUDGE);
    expect(messages).toContain(GAME_MUTATE_NUDGE);
    const score = scoreGenerationEval({
      id: "game-iterate-stuck",
      kind: "game",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "playable" });
    expect(needsHuman).toBe(GAME_ITERATE_UNCHANGED_NEEDS_HUMAN);
  }, 30_000);

  it("game-change: juicy canvas, make it faster, look, mutate patch, ships", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "game",
      seedHtml: GAME_OK,
      slop: GAME_OK,
      ok: GAME_MODE,
      prompt: "make it faster",
    });
    expect(messages).toContain(GAME_PLAYWRIGHT_NUDGE);
    expect(messages).toContain(GAME_MUTATE_NUDGE);
    const score = scoreGenerationEval({ id: "game-change", kind: "game", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "playable" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("game-change-stuck: juicy canvas, make it faster, look, talk through mutate cap, needs a human", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "game",
      seedHtml: GAME_OK,
      slop: GAME_OK,
      ok: GAME_OK,
      prompt: "make it faster",
    });
    expect(messages).toContain(GAME_PLAYWRIGHT_NUDGE);
    expect(messages).toContain(GAME_MUTATE_NUDGE);
    const score = scoreGenerationEval({
      id: "game-change-stuck",
      kind: "game",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "playable" });
    expect(needsHuman).toBe(GAME_ITERATE_UNCHANGED_NEEDS_HUMAN);
  }, 30_000);

  it("game-dry-stuck: playable first paint, look, talk through juice cap, needs a human", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "game",
      slop: GAME_DRY,
      ok: GAME_DRY,
      prompt: "Build a playable arcade loop",
    });
    expect(messages).toContain(GAME_JUICE_NUDGE);
    const score = scoreGenerationEval({ id: "game-dry-stuck", kind: "game", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: false, reason: "dry" });
    expect(needsHuman).toMatch(/no juice/);
  }, 30_000);

  it("asset-empty-stuck: empty Three canvas, look, talk through sculpt cap, needs a human", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "assets",
      slop: ASSET_EMPTY,
      ok: ASSET_EMPTY,
      prompt: "Build a wired 3D hero mesh",
    });
    expect(messages).toContain(ASSET_SCULPT_NUDGE);
    const score = scoreGenerationEval({ id: "asset-empty-stuck", kind: "asset", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: false, reason: "placeholder" });
    expect(needsHuman).toMatch(/placeholder/);
  }, 30_000);

  it("asset-iterate: wired studio, Retopo chip, look, mutate patch, ships", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "assets",
      seedHtml: ASSET_OK,
      slop: ASSET_OK,
      ok: ASSET_RETOPO,
      prompt: iterateAssetPrompt("retopo", { pose: ASSET_POSE_PRESETS.idle }),
    });
    expect(messages).toContain(ASSET_PLAYWRIGHT_NUDGE);
    expect(messages).toContain(DESIGN_MUTATE_NUDGE);
    const score = scoreGenerationEval({ id: "asset-iterate", kind: "asset", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "wired" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("asset-iterate-stuck: wired studio, Retopo chip, look, talk through mutate cap, needs a human", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "assets",
      seedHtml: ASSET_OK,
      slop: ASSET_OK,
      ok: ASSET_OK,
      prompt: iterateAssetPrompt("retopo", { pose: ASSET_POSE_PRESETS.idle }),
    });
    expect(messages).toContain(ASSET_PLAYWRIGHT_NUDGE);
    expect(messages).toContain(DESIGN_MUTATE_NUDGE);
    const score = scoreGenerationEval({
      id: "asset-iterate-stuck",
      kind: "asset",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "wired" });
    expect(needsHuman).toBe(ASSET_ITERATE_UNCHANGED_NEEDS_HUMAN);
  }, 30_000);

  it("asset-change: wired studio, make the mesh smoother, look, mutate patch, ships", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "assets",
      seedHtml: ASSET_OK,
      slop: ASSET_OK,
      ok: ASSET_RETOPO,
      prompt: "make the mesh smoother",
    });
    expect(messages).toContain(ASSET_PLAYWRIGHT_NUDGE);
    expect(messages).toContain(DESIGN_MUTATE_NUDGE);
    const score = scoreGenerationEval({ id: "asset-change", kind: "asset", html: html ?? "" });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "wired" });
    expect(needsHuman).toBeUndefined();
  }, 30_000);

  it("asset-change-stuck: wired studio, make the mesh smoother, look, talk through mutate cap, needs a human", async () => {
    const { html, messages, needsHuman } = await runCanvasEval({
      kind: "assets",
      seedHtml: ASSET_OK,
      slop: ASSET_OK,
      ok: ASSET_OK,
      prompt: "make the mesh smoother",
    });
    expect(messages).toContain(ASSET_PLAYWRIGHT_NUDGE);
    expect(messages).toContain(DESIGN_MUTATE_NUDGE);
    const score = scoreGenerationEval({
      id: "asset-change-stuck",
      kind: "asset",
      html: html ?? "",
    });
    expect(score, score.reason).toMatchObject({ passed: true, reason: "wired" });
    expect(needsHuman).toBe(ASSET_ITERATE_UNCHANGED_NEEDS_HUMAN);
  }, 30_000);
});
