import type { DesignTune } from "./designTune.js";
import { parsePlaywrightSteps, type PlaywrightStep } from "./playwrightCanvas.js";
import { looksHostFallbackCanvas } from "./hostFallback.js";

export const GAME_FEEL_KEYS = ["gravity", "jump", "fire", "shake", "hit-stop", "volume"] as const;
export type GameFeelKey = (typeof GAME_FEEL_KEYS)[number];

export interface GameFeelRange {
  key: GameFeelKey;
  min: number;
  max: number;
}

export const GAME_FEEL_DEFAULTS: Record<GameFeelKey, { min: number; max: number; value: number }> =
  {
    gravity: { min: 20, max: 160, value: 80 },
    jump: { min: 4, max: 32, value: 16 },
    fire: { min: 2, max: 24, value: 8 },
    shake: { min: 0, max: 24, value: 6 },
    "hit-stop": { min: 0, max: 16, value: 4 },
    volume: { min: 0, max: 100, value: 80 },
  };

const FEEL_ALIASES: Record<string, GameFeelKey> = {
  gravity: "gravity",
  jump: "jump",
  fire: "fire",
  "fire-rate": "fire",
  firerate: "fire",
  shake: "shake",
  screenshake: "shake",
  "hit-stop": "hit-stop",
  hitstop: "hit-stop",
  volume: "volume",
};

export const GAME_LANDSCAPE = {
  id: "landscape" as const,
  label: "Landscape",
  width: 844,
  height: 390,
};

export const DEFAULT_GAME_CONTROLS = "Arrows / stick: move · Space / A: action · R: restart";

/** Record chrome captures this many milliseconds of play, matching the docs. */
export const GAME_RECORD_MS = 15_000;

/** Balance runs this many seeded playtests before the iterate prompt. */
export const GAME_BALANCE_RUNS = 3;

export const GAME_GDD_PATH = "GDD.md";

export function livingGameGdd(input: { title?: string; loop?: string } = {}): string {
  const title = input.title?.trim() || "Game";
  return [
    `# ${title} — one-page GDD`,
    "",
    "## Fantasy",
    "",
    "Who the player is and what they want in one sentence.",
    "",
    "## Verbs",
    "",
    "Move, act, fail, restart.",
    "",
    "## Loop",
    "",
    input.loop?.trim() || "First 30 seconds: a goal, a threat, and a score or win/lose.",
    "",
    "## Fail",
    "",
    "Readable death and instant restart.",
    "",
    "## Content",
    "",
    "Rooms, waves, and cards live in `rooms.json`, `waves.json`, `deck.json`.",
    "",
    "Write this page before the first loop. Then implement `index.html` from it.",
    "",
  ].join("\n");
}

export const GAME_PWA_SW = `self.addEventListener("install", (event) => {
  event.waitUntil(caches.open("locus-game").then((cache) => cache.addAll(["./", "./index.html"])));
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
});
`;

export function gamePwaFiles(
  input: { title?: string; description?: string } = {},
): Record<string, string> {
  const name = (input.title?.trim() || "Locus game").slice(0, 48);
  const shortName = name.slice(0, 12);
  const description = input.description?.trim().slice(0, 280);
  const itch = [`[itch]`, `title = ${JSON.stringify(name)}`];
  if (description) itch.push(`description = ${JSON.stringify(description)}`);
  return {
    "manifest.webmanifest": `${JSON.stringify(
      {
        name,
        short_name: shortName,
        start_url: "./index.html",
        display: "standalone",
        background_color: "#111111",
        theme_color: "#111111",
        ...(description ? { description } : {}),
      },
      null,
      2,
    )}\n`,
    "sw.js": GAME_PWA_SW,
    ".itch.toml": `${itch.join("\n")}\n`,
  };
}

export const GAME_PWA_FILES = gamePwaFiles();

export function withGamePwaShell(html: string): string {
  if (html.includes("data-locus-game-pwa")) return html;
  const tags = `<link rel="manifest" href="./manifest.webmanifest" data-locus-game-pwa />
<script data-locus-game-pwa>
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(function(){});
</script>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${tags}</head>`);
  if (/<html\b[^>]*>/i.test(html))
    return html.replace(/<html\b[^>]*>/i, (open) => `${open}${tags}`);
  return `${tags}${html}`;
}

export const GAME_SFX_BANK_JS = `const AC = window.AudioContext || window.webkitAudioContext;
const buffers = Object.create(null);
function volume() {
  const n = Number(getComputedStyle(document.documentElement).getPropertyValue("--volume"));
  return (Number.isFinite(n) ? n : 80) / 200;
}
export async function play(kind) {
  const ctx = new AC();
  const gain = ctx.createGain();
  gain.gain.value = volume();
  gain.connect(ctx.destination);
  try {
    if (!buffers[kind]) {
      for (const ext of ["wav", "ogg"]) {
        const res = await fetch("./sfx/" + kind + "." + ext);
        if (!res.ok) continue;
        buffers[kind] = await ctx.decodeAudioData(await res.arrayBuffer());
        break;
      }
    }
    if (buffers[kind]) {
      const node = ctx.createBufferSource();
      node.buffer = buffers[kind];
      node.connect(gain);
      node.start();
      return;
    }
  } catch (e) {}
  const osc = ctx.createOscillator();
  const table = { hit: [180, 90], pickup: [660, 70], die: [90, 220], jump: [320, 70], ui: [440, 50] };
  const [freq, ms] = table[kind] || table.ui;
  osc.frequency.value = freq;
  osc.connect(gain);
  osc.start();
  setTimeout(() => osc.stop(), ms);
}
export function tone(kind) { play(kind); }
`;

export type GameVendorLib = "three" | "phaser";

export interface GameKit {
  id: string;
  title: string;
  blurb: string;
  tilePx: number;
  files: Record<string, string>;
  vendorLib?: GameVendorLib;
}

export const GAME_KITS: GameKit[] = [
  {
    id: "pixel-pack",
    title: "Pixel pack",
    blurb: "16px tiles, sprite palette, and a tiny SFX recipe.",
    tilePx: 16,
    files: {
      "GAME.md": `# Pixel pack

Tile size: 16px. Draw on a 16×16 grid. Keep the palette to the :root colors.
Persist high score in localStorage key locus-game.
`,
      "vendor/tokens.css": `:root {
  --tile: 16px;
  --gravity: 80;
  --jump: 16;
  --fire: 8;
  --shake: 6;
  --hit-stop: 4;
  --volume: 80;
}
`,
      "vendor/sfx.js": `export function beep(freq = 440, ms = 80) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  gain.gain.value = (Number(getComputedStyle(document.documentElement).getPropertyValue("--volume")) || 80) / 200;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  setTimeout(() => osc.stop(), ms);
}
`,
    },
  },
  {
    id: "three-starter",
    title: "Three.js",
    blurb: "Vendored Three.js module plus a boot helper. Promote copies this folder.",
    tilePx: 32,
    vendorLib: "three",
    files: {
      "GAME.md": `# Three.js starter

Import from \`./vendor/boot-three.js\` (it loads \`./vendor/three.module.js\`). Relative ES modules need HTTP preview — call preview with no port. No CDNs.
The live canvas is already the Three project Promote (three-vite) will copy.
`,
      "vendor/boot-three.js": `import * as THREE from "./three.module.js";

export { THREE };

export function createThreeGame(canvas, opts = {}) {
  const width = opts.width || canvas.clientWidth || 844;
  const height = opts.height || canvas.clientHeight || 390;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 200);
  camera.position.set(0, 2.2, 6);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const clock = new THREE.Clock();
  return { THREE, scene, camera, renderer, clock };
}
`,
    },
  },
  {
    id: "phaser",
    title: "Phaser",
    blurb: "Vendored Phaser 3 module plus a boot helper. Promote copies this folder.",
    tilePx: 16,
    vendorLib: "phaser",
    files: {
      "GAME.md": `# Phaser starter

Import from \`./vendor/boot-phaser.js\` (it loads \`./vendor/phaser.esm.js\`). Relative ES modules need HTTP preview — call preview with no port. No CDNs.
The live canvas is already the Phaser project Promote (phaser) will copy.
`,
      "vendor/boot-phaser.js": `import Phaser from "./phaser.esm.js";

export { Phaser };

export function createPhaserGame(parent, opts = {}) {
  const width = opts.width || 844;
  const height = opts.height || 390;
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width,
    height,
    backgroundColor: opts.backgroundColor || "#111111",
    physics: { default: "arcade", arcade: { gravity: { y: opts.gravity ?? 400 } } },
    scene: opts.scene,
  });
}
`,
    },
  },
  {
    id: "sfx-pack",
    title: "SFX pack",
    blurb: "Named cues: local WAV/OGG under vendor/sfx, else Web Audio.",
    tilePx: 16,
    files: {
      "GAME.md": `# SFX pack

Prefer local \`vendor/sfx/{hit,pickup,die,jump,ui}.wav\` decoded with Web Audio.
If a file is missing, synthesize a short buffer. No remote mp3/ogg. Persist mute in localStorage key locus-game.
`,
      "vendor/sfx.js": GAME_SFX_BANK_JS,
      "vendor/sfx/bank.js": GAME_SFX_BANK_JS,
    },
  },
];

export function resolveGameKit(id: string | undefined): GameKit | undefined {
  const raw = id?.trim();
  if (!raw) return undefined;
  return GAME_KITS.find((row) => row.id === raw);
}

export function parseGameControls(html: string): string {
  const match = html.match(/\bdata-controls\s*=\s*["']([^"']+)["']/i);
  const text = match?.[1]?.trim();
  return text || DEFAULT_GAME_CONTROLS;
}

export function parseCanvasFeelAttrs(html: string): GameFeelRange[] {
  const match = html.match(/\bdata-tune\s*=\s*["']([^"']+)["']/i);
  const found = new Map<GameFeelKey, GameFeelRange>();
  if (match?.[1]) {
    for (const part of match[1].split(",")) {
      const item = part.trim().match(/^([a-z-]+)\s*:\s*(\d+)\s*-\s*(\d+)$/i);
      if (!item) continue;
      const key = FEEL_ALIASES[item[1]!.toLowerCase()];
      if (!key) continue;
      const min = Number(item[2]);
      const max = Number(item[3]);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) continue;
      const bounds = GAME_FEEL_DEFAULTS[key];
      const lo = Math.max(bounds.min, Math.round(min));
      const hi = Math.min(bounds.max, Math.round(max));
      if (lo >= hi) continue;
      found.set(key, { key, min: lo, max: hi });
    }
  }
  return GAME_FEEL_KEYS.map((key) => found.get(key) ?? { key, ...GAME_FEEL_DEFAULTS[key] });
}

export function feelFromTune(tune?: DesignTune): Record<GameFeelKey, number> {
  return {
    gravity: tune?.gravity ?? GAME_FEEL_DEFAULTS.gravity.value,
    jump: tune?.jump ?? GAME_FEEL_DEFAULTS.jump.value,
    fire: tune?.fireRate ?? GAME_FEEL_DEFAULTS.fire.value,
    shake: tune?.shake ?? GAME_FEEL_DEFAULTS.shake.value,
    "hit-stop": tune?.hitStop ?? GAME_FEEL_DEFAULTS["hit-stop"].value,
    volume: tune?.volume ?? GAME_FEEL_DEFAULTS.volume.value,
  };
}

export const GAME_FEEL_PRESETS = {
  floaty: { gravity: 40, jump: 24, fire: 6, shake: 2, "hit-stop": 2, volume: 80 },
  crunchy: { gravity: 100, jump: 12, fire: 14, shake: 14, "hit-stop": 10, volume: 90 },
  heavy: { gravity: 140, jump: 8, fire: 4, shake: 8, "hit-stop": 6, volume: 80 },
} as const;
export type GameFeelPreset = keyof typeof GAME_FEEL_PRESETS;

export function tuneFromFeel(feel: Record<GameFeelKey, number>, extra?: DesignTune): DesignTune {
  return {
    ...extra,
    gravity: feel.gravity,
    jump: feel.jump,
    fireRate: feel.fire,
    shake: feel.shake,
    hitStop: feel["hit-stop"],
    volume: feel.volume,
  };
}

export function exploreGameLoopsPrompt(hasCanvas: boolean): string {
  const goal = hasCanvas
    ? "Explore three distinct playable loops of the current game."
    : "Explore three distinct playable loops for this brief.";
  return [
    goal,
    "Write three complete, self-contained HTML games:",
    "- /workspace/.locus-variants/direction-1.html",
    "- /workspace/.locus-variants/direction-2.html",
    "- /workspace/.locus-variants/direction-3.html",
    "Each loop should change controls or difficulty, not just the palette. Keep a playable loop, score or win/lose, and restart. Honor feel CSS vars, data-controls, localStorage key locus-game, and window.__locusGame. Put rooms in rooms.json, waves in waves.json, and cards in deck.json — do not hardcode a second level in index.html. Use file_write for each complete HTML document. Do not write /workspace/index.html until all three files exist. Then copy the strongest to /workspace/index.html. The three files are playable builds the operator can pin and play without another turn.",
  ].join("\n");
}

export const GAME_BRIEF_PATH = "GAME.md";
export const GAME_LAST_RUN_PATH = ".locus-game/last-run.json";

export interface GameTapeEvent {
  code: string;
  t: number;
  hold?: number;
}

export interface GameLastRun {
  at: string;
  seed: number;
  score?: number;
  deaths?: number;
  time?: number;
  fps?: number;
  keys: string[];
  tape: string[];
  playtest?: string;
  playable?: boolean;
}

function optionalRunNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

const GAME_TAPE_TIMED_SOURCE = "^([^@]+)@([0-9]+)(?:[+]([0-9]+))?$";
const GAME_KEY_LETTER_SOURCE = "^Key([A-Z])$";
const GAME_KEY_DIGIT_SOURCE = "^Digit([0-9])$";
const GAME_NAMED_KEY_CODES = ["Escape", "Enter", "Tab", "Backspace"] as const;

export function gameKeyFromCode(code: string): string {
  const raw = code.trim();
  if (!raw) return "";
  if (raw === "Space") return " ";
  if (raw.startsWith("Arrow") || (GAME_NAMED_KEY_CODES as readonly string[]).includes(raw)) {
    return raw;
  }
  const letter = new RegExp(GAME_KEY_LETTER_SOURCE, "i").exec(raw);
  if (letter) return letter[1]!.toLowerCase();
  const digit = new RegExp(GAME_KEY_DIGIT_SOURCE).exec(raw);
  if (digit) return digit[1]!;
  return raw;
}

export function formatGameTapeEvent(event: GameTapeEvent): string {
  const hold =
    event.hold != null && Number.isFinite(event.hold)
      ? `+${Math.max(0, Math.round(event.hold))}`
      : "";
  return `${event.code}@${Math.max(0, Math.round(event.t || 0))}${hold}`;
}

export function tapeEventCode(raw: string): string {
  return raw.split("@")[0] || raw;
}

export function parseGameTape(value: unknown): GameTapeEvent[] {
  if (!Array.isArray(value)) return [];
  const out: GameTapeEvent[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item === "string") {
      const timed = item.match(new RegExp(GAME_TAPE_TIMED_SOURCE));
      if (timed) {
        out.push({
          code: timed[1]!,
          t: Number(timed[2]),
          hold: timed[3] != null ? Number(timed[3]) : undefined,
        });
      } else if (item.trim()) {
        out.push({ code: item.trim(), t: index * 120, hold: 40 });
      }
      continue;
    }
    if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      const code = String(row.code ?? row.key ?? "").trim();
      if (!code) continue;
      const t = optionalRunNumber(row.t ?? row.at) ?? index * 120;
      const hold = optionalRunNumber(row.hold ?? row.ms);
      out.push({ code, t, hold });
    }
  }
  return out;
}

export function parseGameLastRun(value: unknown): GameLastRun | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const keys = Array.isArray(row.keys) ? row.keys.map((item) => tapeEventCode(String(item))) : [];
  const events = parseGameTape(Array.isArray(row.tape) ? row.tape : keys);
  const seed = Number(row.seed);
  return {
    at: typeof row.at === "string" ? row.at : new Date().toISOString(),
    seed: Number.isFinite(seed) ? Math.max(0, Math.round(seed)) : 0,
    score: optionalRunNumber(row.score),
    deaths: optionalRunNumber(row.deaths),
    time: optionalRunNumber(row.time),
    fps: optionalRunNumber(row.fps),
    keys,
    tape: events.length ? events.map(formatGameTapeEvent) : keys,
    playtest: typeof row.playtest === "string" ? row.playtest : undefined,
    playable: typeof row.playable === "boolean" ? row.playable : undefined,
  };
}

export function parsePlaytestStats(report: string): {
  score?: number;
  deaths?: number;
  time?: number;
  fps?: number;
} {
  const line = report.match(/\bstats\b[^\n]*/i)?.[0] ?? report;
  const pick = (name: string) => {
    const match = line.match(new RegExp(`\\b${name}\\s*[=:]\\s*(-?\\d+(?:\\.\\d+)?)`, "i"));
    return match ? Number(match[1]) : undefined;
  };
  return {
    score: pick("score") ?? pick("sc"),
    deaths: pick("deaths") ?? pick("d"),
    time: pick("time") ?? pick("t"),
    fps: pick("fps"),
  };
}

export function playtestLooksPlayable(report: string): boolean {
  const text = report.trim();
  if (!text) return false;
  if (/\bfail {2}|\berror:|\bnot found\b|tainted by cross-origin/i.test(text)) return false;
  return /\bok {2}/.test(text) || /^ok\b/m.test(text);
}

export function isKitGameBrief(text?: string | null): boolean {
  const body = text?.trim() ?? "";
  if (!body) return true;
  return !/^##\s+(Loop|Controls|Feel)\b/m.test(body);
}

export function mergeKitNotesIntoBrief(brief: string, kitMd?: string): string {
  const notes = kitMd?.replace(/^#.*$/m, "").trim();
  if (!notes || /##\s+Kit\b/.test(brief)) return brief;
  if (!/##\s+Persistence\b/.test(brief)) {
    return `${brief.trim()}\n\n## Kit\n\n${notes}\n`;
  }
  return brief.replace(/\n## Persistence/, `\n## Kit\n\n${notes}\n\n## Persistence`);
}

export function formatGameLastRun(run: GameLastRun): string {
  return `${JSON.stringify(run, null, 2)}\n`;
}

export function looksPlayableGame(html?: string | null): boolean {
  const text = html?.trim() ?? "";
  if (!text) return false;
  const hasInput =
    /keydown|keyup|pointerdown|addEventListener\s*\(\s*['"]key|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|['"]Space['"]|KeySpace/.test(
      text,
    );
  const hasGoal = /score|game over|you win|winner|lives|health/i.test(text);
  const hasRestart = /restart|play again|try again|location\.reload|__locusGame/i.test(text);
  if (!hasInput || !hasGoal || !hasRestart) return false;
  const hasMenu =
    /\bid\s*=\s*["']menu["']/i.test(text) ||
    /\bclass\s*=\s*["'][^"']*\bin-menu\b/i.test(text) ||
    /html\.in-menu|getElementById\(\s*["']menu["']\)|querySelector\(\s*["']#menu["']\)/i.test(text);
  if (hasMenu) {
    const hasTypedButton = /<button\b[^>]*type\s*=\s*["']button["']/i.test(text);
    const hasMenuRoot = /\bid\s*=\s*["']menu["']/i.test(text);
    if (!hasTypedButton || !hasMenuRoot) return false;
  }
  return true;
}

export const MAX_GAME_JUICE_NUDGES = 2;

const GAME_JUICE =
  /AudioContext|webkitAudioContext|createOscillator|\.beep\s*\(|particles?\s*\(|ParticleSystem|\.particles\b|new\s+\w*Particle|screenshake|screenShake|hit-?flash|hitFlash|getPropertyValue\(\s*['"]--(?:shake|hit-stop)['"]/i;

/** Strip host chrome so operator AudioContext / --shake CSS is not counted as a juice pass. */
function gameAuthoredHtml(html: string): string {
  return stripHostStudioChrome(html);
}

/** Palette / feel / chrome tags the host injects — not an agent iterate patch. */
export function stripHostStudioChrome(html: string): string {
  return html
    .replace(/<script[^>]*data-locus-game-chrome[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*data-locus-game-feel[\s\S]*?<\/style>/gi, "")
    .replace(/<style[^>]*data-locus-palette[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*data-locus-asset-chrome[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*data-locus-asset-pose[\s\S]*?<\/style>/gi, "");
}

export function looksJuicyGame(html?: string | null): boolean {
  return GAME_JUICE.test(gameAuthoredHtml(html?.trim() ?? ""));
}

/** Playable loop with no hit flash, shake, particles, or Web Audio in the authored page. */
export function looksDryGame(html?: string | null): boolean {
  return looksPlayableGame(html) && !looksJuicyGame(html);
}

/** True when a later write replaced a real canvas with a fragment. */
export function canvasLooksWiped(
  before: string | null | undefined,
  after: string | null | undefined,
): boolean {
  const prev = (before ?? "").trim();
  const next = (after ?? "").trim();
  if (prev.length < 800) return false;
  if (!next) return true;
  const lostClose = /<\/html>/i.test(prev) && !/<\/html>/i.test(next);
  const shrunkHard = next.length < Math.max(500, prev.length * 0.15);
  return lostClose || shrunkHard;
}

export function canvasHtmlUnchanged(
  before: string | null | undefined,
  after: string | null | undefined,
): boolean {
  return (before ?? "").trim() === (after ?? "").trim();
}

export function gameCanvasBrokenPrompt(text: string): boolean {
  return /not working in (the )?locus canvas|does(?:n'?t| not) work in (the )?locus canvas|none of the buttons work|buttons? (don'?t|do not) work|can'?t click|clicks? (don'?t|do not) (work|register)/i.test(
    text,
  );
}

export const GAME_DRIVE_MIN_TIME = 2;
export const GAME_DRIVE_WAIT_MS = 2000;

const GAME_HUD_EXPECT = /^(road\s*#|bumps|trip|km|score|deaths|time)$/i;
const GAME_IDLE_CLICK = /#bRestart|#bNew|^text=(?:Restart|New|Play)$/i;

function playwrightArgsFromGameCall(args?: Record<string, unknown>): Record<string, unknown> {
  if (!args) return {};
  const nested = args.args;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return args;
}

/** HUD `expect road #` / Restart clicks are not a drive playtest. */
export function looksLikeHudOnlyGamePlaytest(input: {
  name?: string;
  arguments?: Record<string, unknown>;
}): boolean {
  const name = (input.name ?? "").replace(/^locus-/, "");
  const nested = typeof input.arguments?.name === "string" ? input.arguments.name : "";
  const tool = typeof input.arguments?.toolName === "string" ? input.arguments.toolName : "";
  if (!/playwright/i.test(name) && !/playwright/i.test(nested) && !/playwright/i.test(tool)) {
    return false;
  }
  const steps = parsePlaywrightSteps(playwrightArgsFromGameCall(input.arguments));
  if (!steps.length) return false;
  const hasRealLive = steps.some((step) => playwrightStepLooksLikeDrive(step));
  if (hasRealLive) return false;
  const expects = steps.filter((step) => step.kind === "expect");
  if (expects.length) return expects.every((step) => GAME_HUD_EXPECT.test(step.text.trim()));
  return steps.some((step) => step.kind === "click" && GAME_IDLE_CLICK.test(step.locator));
}

export function playwrightStepLooksLikeDrive(step: PlaywrightStep): boolean {
  if (step.kind === "key") return true;
  if (step.kind === "fill") return true;
  if (step.kind === "wait") return !/^#c$|^canvas$/i.test(step.locator.trim());
  if (step.kind !== "click") return false;
  return !GAME_IDLE_CLICK.test(step.locator);
}

export function playwrightStepsWantDrive(steps: PlaywrightStep[]): boolean {
  return steps.some((step) => playwrightStepLooksLikeDrive(step) || step.kind === "key");
}

export const GAME_FOLLOW_UP_NEEDS_HUMAN =
  "Game canvas is still missing the requested control. Needs a human.";

export const GAME_ITERATE_UNCHANGED_NEEDS_HUMAN =
  "Game canvas was not changed for this request. Needs a human.";

/** True when the operator asked for a named control/mode that is missing from the canvas. */
export function gameFollowUpMissingFromCanvas(
  userText?: string | null,
  html?: string | null,
): boolean {
  const prompt = userText?.trim() ?? "";
  const canvas = html ?? "";
  if (!prompt) return false;
  const ids = [...prompt.matchAll(/#([A-Za-z_][\w-]*)/g)].map((row) => row[1]!);
  if (ids.some((id) => !new RegExp(`\\bid\\s*=\\s*["']${id}["']`, "i").test(canvas))) return true;
  if (/\brace\s*mode\b|\btakedowns?\b|\bburnout\b/i.test(prompt)) {
    return !/\bbMode\b|takedown|id=["']sTd["']|Mode:\s*Race/i.test(canvas);
  }
  return false;
}

/** Leftover named control/mode after the mutate cap cannot ship. Empty canvases skip. */
export function gameFollowUpNeedsHuman(
  userText?: string | null,
  html?: string | null,
): string | undefined {
  if (!html?.trim()) return undefined;
  if (!gameFollowUpMissingFromCanvas(userText, html)) return undefined;
  return GAME_FOLLOW_UP_NEEDS_HUMAN;
}

export function looksLikeFakeGamePlaytest(input: {
  name?: string;
  arguments?: Record<string, unknown>;
  result?: string;
}): boolean {
  const name = (input.name ?? "").replace(/^locus-/, "");
  if (/playwright/i.test(name) || /playwright/i.test(String(input.arguments?.toolName ?? ""))) {
    return looksLikeHudOnlyGamePlaytest(input);
  }
  if (!/^(exec|shell|bash|terminal|run_terminal_cmd)$/i.test(name)) return false;
  const cmd = typeof input.arguments?.command === "string" ? input.arguments.command : "";
  let out = input.result ?? "";
  try {
    const parsed = JSON.parse(out) as {
      stdout?: unknown;
      interleavedOutput?: unknown;
      output?: unknown;
    };
    if (parsed && typeof parsed === "object") {
      out = String(parsed.stdout ?? parsed.interleavedOutput ?? parsed.output ?? out);
    }
  } catch {
    /* plain text */
  }
  if (/_chk\.mjs|new Function\s*\(/i.test(cmd)) return true;
  return /ok\s+\d{3,}\b/i.test(out) && /\b(skirmish|replay|syntax|playable)\b/i.test(out);
}

const LOCUS_GAME_API = [
  "reset",
  "pause",
  "resume",
  "debug",
  "stats",
  "mute",
  "seed",
  "replay",
] as const;

export function formatGameCanvasSnapshot(input: {
  html?: string | null;
  lastRun?: GameLastRun | null;
}): string {
  const html = input.html ?? "";
  const apiBlob = html.match(/__locusGame[\s\S]{0,800}/)?.[0] ?? "";
  const keys = LOCUS_GAME_API.filter((key) => new RegExp(`\\b${key}\\b`).test(apiBlob));
  const overlays = [...html.matchAll(/\bid\s*=\s*["'](menu|hud|pause|title|overlay)["']/gi)].map(
    (row) => row[1]!.toLowerCase(),
  );
  const inMenu = /\bin-menu\b|#menu\.show/i.test(html);
  const buttons = html.match(/<button\b/gi)?.length ?? 0;
  const typed = html.match(/<button\b[^>]*type\s*=\s*["']button["']/gi)?.length ?? 0;
  const lines = [
    "Game canvas snapshot (do not re-read the whole file unless you need a specific range):",
    `- index.html ${html.length} bytes, </html> ${/<\/html>/i.test(html) ? "yes" : "NO"}`,
    `- __locusGame keys: ${keys.join(", ") || "none found"}`,
    `- overlays: ${overlays.length ? [...new Set(overlays)].join(", ") : "none"}${inMenu ? ", in-menu/show" : ""}`,
    `- buttons: ${buttons} (${typed} type=button)`,
    `- host fallback: ${looksHostFallbackCanvas(html) ? "yes" : "no"}`,
  ];
  if (input.lastRun) {
    lines.push(
      `- last-run: score ${input.lastRun.score ?? "—"}, deaths ${input.lastRun.deaths ?? "—"}, time ${input.lastRun.time ?? "—"}, seed ${input.lastRun.seed}`,
    );
  }
  lines.push(
    "Patch index.html in place. Call playwright to click a visible control (the new button, Restart, or the first type=button) and drive until stats.time moves. A Node syntax check or HUD expect of road # / bumps is not a playtest.",
  );
  return lines.join("\n");
}

export function livingGameBrief(input: {
  title?: string;
  loop?: string;
  controls?: string;
  feel?: Record<GameFeelKey, number>;
  seed?: number;
  notes?: string[];
}): string {
  const feel = input.feel ?? feelFromTune();
  const parts = [
    `# ${input.title?.trim() || "Game brief"}`,
    "",
    "## Loop",
    "",
    input.loop?.trim() || "One playable loop with a goal, input, score or win/lose, and restart.",
    "",
    "## Controls",
    "",
    input.controls?.trim() || DEFAULT_GAME_CONTROLS,
    "",
    "## Feel",
    "",
    `- gravity: ${feel.gravity}`,
    `- jump: ${feel.jump}`,
    `- fire: ${feel.fire}`,
    `- shake: ${feel.shake}`,
    `- hit-stop: ${feel["hit-stop"]}`,
    `- volume: ${feel.volume}`,
    `- seed: ${input.seed ?? 0}`,
    "",
    "## Persistence",
    "",
    "High score, mute, and last tape stay in localStorage key `locus-game`.",
    "Write `.locus-game/last-run.json` after each playtest. Honor `window.__locusGame.replay`.",
    "",
    "## Content",
    "",
    "Rooms live in `rooms.json`, waves in `waves.json`, cards in `deck.json`. Load them at boot. Do not hardcode a second floor, wave table, or deck in `index.html`.",
    "Write `GDD.md` (fantasy, verbs, loop, fail) before the first playable loop.",
  ];
  if (input.notes?.length) {
    parts.push("", "## Notes", "");
    for (const note of input.notes) parts.push(`- ${note}`);
  }
  parts.push("");
  return parts.join("\n");
}

export const GAME_GENERATE_KINDS = ["sprite", "sheet", "mesh", "sfx"] as const;
export type GameGenerateKind = (typeof GAME_GENERATE_KINDS)[number];

export const GAME_GENERATE_CHIPS: Array<{
  id: GameGenerateKind;
  title: string;
  blurb: string;
  recipeId?: "cutout" | "sprite-sheet" | "text-to-3d";
}> = [
  {
    id: "sprite",
    title: "Sprite",
    blurb: "Cutout or character PNG for the live loop.",
    recipeId: "cutout",
  },
  {
    id: "sheet",
    title: "Sheet",
    blurb: "Sprite sheet with frames the loop can draw.",
    recipeId: "sprite-sheet",
  },
  { id: "mesh", title: "Mesh", blurb: "Text-to-3D GLB for a Three loop.", recipeId: "text-to-3d" },
  { id: "sfx", title: "SFX", blurb: "Named bank: local WAV/OGG or Web Audio in vendor/sfx." },
];

export function isGameGenerateKind(value: unknown): value is GameGenerateKind {
  return typeof value === "string" && (GAME_GENERATE_KINDS as readonly string[]).includes(value);
}

export function generateGameAssetPrompt(input: {
  kind: GameGenerateKind;
  title?: string;
  brief?: string;
}): string {
  const title = input.title?.trim() || "the live game";
  const brief = (input.brief ?? "").trim().slice(0, 1200);
  if (input.kind === "sfx") {
    return [
      `Add a named SFX bank for ${title}.`,
      "Write /workspace/vendor/sfx/bank.js with export function play(kind) for hit, pickup, die, jump, ui.",
      "Prefer local WAV/OGG under /workspace/vendor/sfx/ decoded with Web Audio. If a file is missing, synthesize a short buffer. No remote URLs.",
      "Honor --volume and mute in localStorage key locus-game.",
      "Wire the cues into the existing loop. Do not change the win condition or rewrite index.html.",
      brief ? `GAME.md:\n${brief}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  const noun =
    input.kind === "sheet" ? "sprite sheet" : input.kind === "mesh" ? "GLB mesh" : "sprite";
  return [
    `Generate a ${noun} for the live game "${title}".`,
    "Match the loop, silhouette, and palette in GAME.md. Export a pack the game can load from vendor/assets.",
    "This studio was spawned from that game — stay on this subject.",
    brief ? `GAME.md:\n${brief}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const GAME_ITERATE_CHIPS = [
  { id: "soften", title: "Soften", blurb: "Easier: slower hazards, fatter jumps, more time." },
  { id: "crunch", title: "Crunch", blurb: "Tighter: snappier feel, denser threats, less slack." },
  { id: "juice", title: "Juice", blurb: "Hit flash, shake, particles, and Web Audio only." },
  {
    id: "teach",
    title: "Teach",
    blurb: "How to Play overlay on boot, pause, and fail. First seconds teach the rule.",
  },
  { id: "fail-state", title: "Fail-state", blurb: "Readable fail, restart, and why you lost." },
  {
    id: "balance",
    title: "Balance",
    blurb: "Nudge difficulty from N seeded playtests, keep the loop.",
  },
] as const;
export type GameIterateChipId = (typeof GAME_ITERATE_CHIPS)[number]["id"];

/** Soften/Crunch/Juice chips, playtest fixes, and GAME.md apply asks that never patched. */
export function looksLikeGameIterateRequest(text?: string | null): boolean {
  const prompt = text?.trim() ?? "";
  if (!prompt) return false;
  if (/^Fix from playtest\./m.test(prompt)) return true;
  if (/^Apply this GAME\.md brief/m.test(prompt)) return true;
  return GAME_ITERATE_CHIPS.some((chip) => prompt.includes(`${chip.title} pass.`));
}

/** Operator Q&A such as “how do I play?” — not a canvas change request. */
export function looksLikeStudioQuestion(text?: string | null): boolean {
  const prompt = text?.trim() ?? "";
  if (!prompt) return false;
  if (/[?？]/.test(prompt)) return true;
  if (/^(how|what|why|where|when|who|which|whose|whom)\b/i.test(prompt)) return true;
  if (/\bhow do i\b/i.test(prompt)) return true;
  if (/^(can|could|do|does|did|is|are|was|were)\s+(you|i|we|it|this|the)\b/i.test(prompt)) {
    return true;
  }
  return false;
}

/** Short acknowledgements that should not force a canvas patch. */
export function looksLikeStudioAck(text?: string | null): boolean {
  const prompt = text?.trim() ?? "";
  if (!prompt) return false;
  return /^(thanks|thank you|thx|ty|tysm|lgtm|ship it|nice|cool|perfect|great|awesome|ok|okay|done|looks good|looking good|keep it|keep this|keep going|nvm|never mind|got it|sounds good|good|yes|yep|yeah)[.!\s]*$/i.test(
    prompt,
  );
}

/**
 * Follow-up that should change the live canvas: iterate chips, named controls,
 * or free-form asks such as “make it faster”. Questions and acks skip.
 */
export function looksLikeStudioChangeRequest(text?: string | null): boolean {
  const prompt = text?.trim() ?? "";
  if (!prompt) return false;
  if (looksLikeStudioQuestion(prompt) || looksLikeStudioAck(prompt)) return false;
  return true;
}

/** A change request that left the canvas identical to turn start cannot ship. Empty canvases skip. */
export function gameIterateUnchangedNeedsHuman(input: {
  userText?: string | null;
  html?: string | null;
  turnStartHtml?: string | null;
}): string | undefined {
  if (!input.html?.trim()) return undefined;
  if (!looksLikeStudioChangeRequest(input.userText)) return undefined;
  if (
    !canvasHtmlUnchanged(
      stripHostStudioChrome(input.turnStartHtml ?? ""),
      stripHostStudioChrome(input.html),
    )
  ) {
    return undefined;
  }
  return GAME_ITERATE_UNCHANGED_NEEDS_HUMAN;
}

export function iterateGamePrompt(
  id: GameIterateChipId,
  ctx: {
    feel: Record<GameFeelKey, number>;
    seed: number;
    lastRun?: GameLastRun;
    balanceRuns?: GameLastRun[];
  },
): string {
  const chip = GAME_ITERATE_CHIPS.find((row) => row.id === id);
  const run = ctx.lastRun
    ? `Last run: score ${ctx.lastRun.score ?? "—"}, deaths ${ctx.lastRun.deaths ?? "—"}, time ${ctx.lastRun.time ?? "—"}, seed ${ctx.lastRun.seed}, tape ${ctx.lastRun.tape.map(tapeEventCode).join(" ") || "none"}.`
    : "No last-run.json yet — read it if present.";
  const seeded = ctx.balanceRuns?.length
    ? `Seeded playtests (${ctx.balanceRuns.length}): ${ctx.balanceRuns
        .map(
          (row) =>
            `seed ${row.seed} score ${row.score ?? "—"} deaths ${row.deaths ?? "—"} time ${row.time ?? "—"}`,
        )
        .join("; ")}.`
    : "";
  const jobs: Record<GameIterateChipId, string> = {
    soften:
      "Make the current loop ~15% easier. Do not change the win condition or rewrite the game.",
    crunch: "Make the current loop snappier and slightly harder. Do not rewrite the game.",
    juice:
      "Add a juice pass only: hit flash, screenshake, particles, local SFX. Do not change rules.",
    teach:
      "Teach the rule in the first seconds. Ship or keep a dismissible How to Play overlay on boot, pause, and fail. If .locus-game/studio.json has a ghost tape, replay it faded on the first boot via window.__locusGame.replay. Add a one-line hint or a safe first beat, not a manual.",
    "fail-state": "Make fail/win readable and restart instant. Show why the player lost.",
    balance: `Balance from ${GAME_BALANCE_RUNS} seeded playtests. Nudge spawn/speed/feel only.`,
  };
  return [
    `${chip?.title ?? id} pass. ${jobs[id]}`,
    `Honor feel CSS vars (gravity ${ctx.feel.gravity}, jump ${ctx.feel.jump}, fire ${ctx.feel.fire}, shake ${ctx.feel.shake}, hit-stop ${ctx.feel["hit-stop"]}, volume ${ctx.feel.volume}, seed ${ctx.seed}).`,
    "Read GAME.md, GDD.md, and .locus-game/last-run.json first. Keep window.__locusGame including replay.",
    run,
    seeded,
    "Patch /workspace/index.html with apply_patch. Do not start a new genre.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function fixFromPlaytestPrompt(ctx: {
  report: string;
  feel: Record<GameFeelKey, number>;
  seed: number;
  tape: string[];
  lastRun?: GameLastRun;
}): string {
  return [
    "Fix from playtest. Diagnose the fail from the attached shot, the report, and the replay tape. Then patch /workspace/index.html.",
    `Feel: gravity ${ctx.feel.gravity}, jump ${ctx.feel.jump}, fire ${ctx.feel.fire}, seed ${ctx.seed}.`,
    `Replay tape: ${ctx.tape.map(tapeEventCode).join(" ") || "none"}. Replay it via window.__locusGame.replay or press the same keys.`,
    ctx.lastRun
      ? `Last run JSON: score ${ctx.lastRun.score ?? "—"} deaths ${ctx.lastRun.deaths ?? "—"} time ${ctx.lastRun.time ?? "—"}.`
      : "Read .locus-game/last-run.json if it exists.",
    `Playtest report:\n${ctx.report.trim() || "no report"}`,
    "Read GAME.md. Keep the loop. Do not rewrite the whole page if a small patch will do. After the fix, keep __locusGame.replay and restart working.",
  ].join("\n");
}

export function applyGameBriefPrompt(brief: string, gdd?: string): string {
  return [
    "Apply this GAME.md brief (and GDD.md if present) to the live canvas. Patch /workspace/index.html to match the fantasy, verbs, loop, controls, and feel. Keep it playable.",
    "",
    brief.trim() || livingGameBrief({}),
    gdd?.trim() ? `\nGDD.md:\n${gdd.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function keepFeelPrompt(feel: Record<GameFeelKey, number>, seed: number): string {
  return [
    "Keep these operator feel knobs as source of truth. Write them into GAME.md and honor the CSS vars on the next edit. Do not reset them.",
    `gravity=${feel.gravity} jump=${feel.jump} fire=${feel.fire} shake=${feel.shake} hit-stop=${feel["hit-stop"]} volume=${feel.volume} seed=${seed}`,
  ].join("\n");
}

export function withGameFeelCss(html: string, tune?: DesignTune): string {
  const feel = feelFromTune(tune);
  const seed = tune?.seed ?? 0;
  const css = [
    ":root {",
    `  --gravity: ${feel.gravity};`,
    `  --jump: ${feel.jump};`,
    `  --fire: ${feel.fire};`,
    `  --shake: ${feel.shake};`,
    `  --hit-stop: ${feel["hit-stop"]};`,
    `  --volume: ${feel.volume};`,
    `  --seed: ${seed};`,
    "}",
  ].join("\n");
  const tag = `<style data-locus-game-feel>${css}</style>`;
  if (html.includes("data-locus-game-feel")) {
    return html.replace(/<style data-locus-game-feel>[\s\S]*?<\/style>/i, tag);
  }
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${tag}</head>`);
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, (open) => `${open}${tag}`);
  return `${tag}${html}`;
}

export function defaultGamePlaytestSteps(html = ""): string[] {
  const steps = ["press ArrowRight", "press ArrowRight", "press Space", "press KeyR"];
  if (/restart|play again|try again/i.test(html)) steps.push("click text=Restart");
  if (/game over/i.test(html)) steps.push("expect Game over");
  else if (/you win|winner/i.test(html)) steps.push("expect win");
  else if (/score/i.test(html)) steps.push("expect Score");
  else steps.push("wait body");
  return steps;
}

export const GAME_PROMOTE_SCAFFOLDS = ["canvas-vite", "three-vite", "phaser", "static"] as const;
export type GamePromoteScaffold = (typeof GAME_PROMOTE_SCAFFOLDS)[number];

export function isGamePromoteScaffold(value: unknown): value is GamePromoteScaffold {
  return (
    value === "canvas-vite" || value === "three-vite" || value === "phaser" || value === "static"
  );
}

export function defaultGameScaffold(session: {
  designSystemId?: string | null;
}): GamePromoteScaffold {
  const kit = session.designSystemId ?? "";
  if (kit === "three-starter") return "three-vite";
  if (kit === "phaser") return "phaser";
  return "canvas-vite";
}

function gameChromeCodecSource(): string {
  return `function keyFromCode(code){
    if (!code) return "";
    if (code === "Space") return " ";
    if (code.indexOf("Arrow") === 0) return code;
    var named = ${JSON.stringify([...GAME_NAMED_KEY_CODES])};
    for (var i = 0; i < named.length; i++) if (code === named[i]) return code;
    var letter = new RegExp(${JSON.stringify(GAME_KEY_LETTER_SOURCE)}, "i").exec(code);
    if (letter) return letter[1].toLowerCase();
    var digit = new RegExp(${JSON.stringify(GAME_KEY_DIGIT_SOURCE)}).exec(code);
    if (digit) return digit[1];
    return code;
  }
  function parseTape(list){
    var out = [];
    var rows = list || [];
    var timedRe = new RegExp(${JSON.stringify(GAME_TAPE_TIMED_SOURCE)});
    for (var i = 0; i < rows.length; i++) {
      var item = rows[i];
      if (!item) continue;
      if (typeof item === "string") {
        var m = item.match(timedRe);
        if (m) out.push({ code: m[1], t: Number(m[2]), hold: m[3] ? Number(m[3]) : 40 });
        else if (String(item).trim()) out.push({ code: String(item).trim(), t: i * 120, hold: 40 });
      } else if (typeof item === "object") {
        var code = String(item.code || item.key || "").trim();
        if (!code) continue;
        var rawT = item.t != null ? item.t : item.at;
        var parsedT = Number(rawT);
        var t = rawT == null || rawT === "" || !isFinite(parsedT) ? i * 120 : parsedT;
        var rawHold = item.hold != null ? item.hold : item.ms;
        var parsedHold = Number(rawHold);
        var hold = rawHold == null || rawHold === "" || !isFinite(parsedHold) ? 40 : parsedHold;
        out.push({ code: code, t: t, hold: hold });
      }
    }
    return out;
  }`;
}

const GAME_CHROME_HOOK = `<script data-locus-game-chrome>
(function(){
  function api(){ return window.__locusGame || {}; }
  function persist(patch){
    try {
      var raw = localStorage.getItem("locus-game");
      var cur = raw ? JSON.parse(raw) : {};
      localStorage.setItem("locus-game", JSON.stringify(Object.assign({}, cur, patch || {})));
    } catch (e) {}
  }
  function readStore(){
    try { return JSON.parse(localStorage.getItem("locus-game") || "{}"); } catch (e) { return {}; }
  }
  window.__locusGameStore = { persist: persist, read: readStore };
  var muted = !!readStore().mute;
  var cssVol = Number((getComputedStyle(document.documentElement).getPropertyValue("--volume") || "").trim());
  var liveVolume = Number.isFinite(cssVol) && cssVol >= 0 ? cssVol : 80;
  function applyVolume(){
    document.documentElement.style.setProperty("--volume", String(muted ? 0 : liveVolume));
    document.documentElement.classList.toggle("locus-muted", muted);
  }
  if (muted) applyVolume();
  function setMute(on){
    muted = !!on;
    persist({ mute: muted });
    applyVolume();
    if (typeof api().mute === "function") api().mute(muted);
  }
  function clearSave(){
    try { localStorage.removeItem("locus-game"); } catch (e) {}
    persist({ mute: muted });
    if (typeof api().clearSave === "function") api().clearSave();
  }
  function unlock(){
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!window.__locusAudio) window.__locusAudio = new AC();
      window.__locusAudio.resume();
    } catch (e) {}
    if (typeof api().unlock === "function") api().unlock();
  }
  function setSeed(n){
    window.__locusGameSeed = Number(n) || 0;
    document.documentElement.style.setProperty("--seed", String(window.__locusGameSeed));
    if (typeof api().seed === "function") api().seed(window.__locusGameSeed);
  }
  function readStats(){
    var s = typeof api().stats === "function" ? api().stats() : api().stats;
    return s && typeof s === "object" ? s : null;
  }
  function statsLine(){
    var s = readStats();
    if (!s) return "";
    var bits = [];
    if (s.score != null) bits.push("sc " + s.score);
    if (s.deaths != null) bits.push("d " + s.deaths);
    if (s.time != null) bits.push("t " + s.time);
    if (s.fps != null) bits.push(s.fps + "fps");
    return bits.join(" ");
  }
  function publishStats(){
    var s = readStats();
    if (!s) return;
    try { parent.postMessage({ type: "locus-game-stats", stats: s }, "*"); } catch (e) {}
  }
  function setDebug(on){
    document.documentElement.classList.toggle("locus-debug", !!on);
    if (typeof api().debug === "function") api().debug(!!on);
    var hud = document.querySelector("[data-locus-debug-hud]");
    if (on && !hud) {
      hud = document.createElement("div");
      hud.setAttribute("data-locus-debug-hud", "");
      hud.style.cssText = "position:fixed;left:8px;top:8px;z-index:9998;font:12px/1.3 ui-monospace,monospace;background:#000a;color:#9f9;padding:6px 8px;pointer-events:none";
      document.body.appendChild(hud);
      var last = performance.now(), frames = 0, fps = 0;
      (function tick(now){
        frames += 1;
        if (now - last >= 500) { fps = Math.round(frames * 1000 / (now - last)); frames = 0; last = now; }
        hud.textContent = ("FPS " + fps + " " + statsLine()).trim();
        if (document.documentElement.classList.contains("locus-debug")) requestAnimationFrame(tick);
        else hud.remove();
      })(last);
    }
    if (on) publishStats();
  }
  var keyLog = [];
  var tape = Array.isArray(readStore().tape) ? readStore().tape.slice(0, 32) : [];
  var tapeStart = 0;
  var pending = Object.create(null);
  var pressing = false;
  var replaying = false;
  function showKeys(list){
    var hud = document.querySelector("[data-locus-keys]");
    if (!hud) {
      hud = document.createElement("div");
      hud.setAttribute("data-locus-keys", "");
      hud.style.cssText = "position:fixed;right:8px;bottom:8px;z-index:9998;font:11px/1.3 ui-monospace,monospace;background:#000a;color:#fff;padding:4px 6px;pointer-events:none";
      document.body.appendChild(hud);
    }
    hud.textContent = list.join(" ") || "keys";
  }
  function publishTape(){
    persist({ tape: tape.slice() });
    try { parent.postMessage({ type: "locus-game-tape", keys: keyLog.slice(), tape: tape.slice() }, "*"); } catch (e) {}
  }
  function noteKey(code, down){
    if (!code || replaying) return;
    if (!tapeStart) tapeStart = performance.now();
    if (down) {
      if (pending[code] != null) return;
      pending[code] = performance.now();
      keyLog.push(code);
      if (keyLog.length > 8) keyLog.shift();
      showKeys(keyLog);
      return;
    }
    var started = pending[code];
    delete pending[code];
    var t = Math.max(0, Math.round((started != null ? started : performance.now()) - tapeStart));
    var hold = started != null ? Math.max(16, Math.round(performance.now() - started)) : 40;
    tape.push(code + "@" + t + "+" + hold);
    if (tape.length > 32) tape.shift();
    publishTape();
  }
  ${gameChromeCodecSource()}
  function replay(list){
    var events = parseTape(list && list.length ? list : tape);
    if (!events.length || replaying) return;
    if (typeof api().replay === "function") {
      api().replay(events.map(function(row){ return row.code; }), events);
      return;
    }
    replaying = true;
    var origin = performance.now();
    function step(i){
      if (i >= events.length) { replaying = false; return; }
      var ev = events[i];
      var wait = Math.max(0, ev.t - (performance.now() - origin));
      setTimeout(function(){
        press(ev.code, true, true);
        setTimeout(function(){
          press(ev.code, false, true);
          step(i + 1);
        }, ev.hold || 40);
      }, wait);
    }
    step(0);
  }
  function press(code, down, silent){
    if (!code || typeof code !== "string") return;
    var key = keyFromCode(code);
    var ev = new KeyboardEvent(down ? "keydown" : "keyup", { key: key, code: code, bubbles: true });
    pressing = true;
    document.dispatchEvent(ev);
    pressing = false;
    if (!silent) noteKey(code, down);
  }
  var inputMap = {};
  try {
    var storedMap = readStore().inputMap;
    if (storedMap && typeof storedMap === "object") inputMap = storedMap;
  } catch (e) {}
  if (readStore().hudLarge && document.documentElement.classList && document.documentElement.classList.toggle) {
    document.documentElement.classList.toggle("locus-hud-lg", true);
  }
  try {
    var hudCss = document.createElement("style");
    hudCss.setAttribute("data-locus-hud-css", "");
    hudCss.textContent = "html.locus-hud-lg #hud,html.locus-hud-lg .hud,html.locus-hud-lg [data-locus-debug-hud]{font-size:18px}html.locus-ghost{outline:4px solid rgba(255,255,255,.45)}";
    if (document.head) document.head.appendChild(hudCss);
    else document.body.appendChild(hudCss);
  } catch (e) {}
  function mappedCode(code){
    var next = inputMap[code];
    return typeof next === "string" && next ? next : code;
  }
  window.addEventListener("keydown", function(e){
    if (pressing) return;
    var raw = e.code || e.key;
    var code = mappedCode(raw);
    if (code !== raw) {
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (e.preventDefault) e.preventDefault();
      press(code, true);
      return;
    }
    noteKey(raw, true);
  }, true);
  window.addEventListener("keyup", function(e){
    if (pressing) return;
    var raw = e.code || e.key;
    var code = mappedCode(raw);
    if (code !== raw) {
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (e.preventDefault) e.preventDefault();
      press(code, false);
      return;
    }
    noteKey(raw, false);
  }, true);
  window.addEventListener("pointerdown", unlock, { once: true });
  var onTouchRelease;
  function sticks(on){
    var existing = document.querySelector("[data-locus-touch-stick]");
    if (!on) {
      if (onTouchRelease) {
        window.removeEventListener("pointerup", onTouchRelease);
        window.removeEventListener("pointercancel", onTouchRelease);
        onTouchRelease = null;
      }
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    var wrap = document.createElement("div");
    wrap.setAttribute("data-locus-touch-stick", "");
    wrap.style.cssText = "position:fixed;inset:auto 12px 12px 12px;z-index:9997;display:flex;justify-content:space-between;align-items:flex-end;pointer-events:none";
    wrap.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:auto"><button type="button" data-dir="up" style="width:56px;height:56px;border-radius:50%;opacity:.75;font-size:18px">▲</button><div style="display:flex;gap:8px;align-items:center"><button type="button" data-dir="left" style="width:64px;height:64px;border-radius:50%;opacity:.75;font-size:18px">◀</button><button type="button" data-dir="down" style="width:56px;height:56px;border-radius:50%;opacity:.75;font-size:18px">▼</button><button type="button" data-dir="right" style="width:64px;height:64px;border-radius:50%;opacity:.75;font-size:18px">▶</button></div></div><div style="display:flex;gap:10px;pointer-events:auto"><button type="button" data-act="Space" style="width:64px;height:64px;border-radius:50%;opacity:.75;font-size:16px;font-weight:700">A</button><button type="button" data-act="KeyR" style="width:64px;height:64px;border-radius:50%;opacity:.75;font-size:16px;font-weight:700">R</button></div>';
    var held = Object.create(null);
    function codeFor(btn){
      var dir = btn.getAttribute("data-dir");
      if (dir === "left") return "ArrowLeft";
      if (dir === "right") return "ArrowRight";
      if (dir === "up") return "ArrowUp";
      if (dir === "down") return "ArrowDown";
      return btn.getAttribute("data-act");
    }
    function idOf(pointerId){ return pointerId == null ? -1 : pointerId; }
    function down(btn, pointerId){
      var code = codeFor(btn);
      if (!code || Object.prototype.hasOwnProperty.call(held, code)) return;
      held[code] = idOf(pointerId);
      try { if (pointerId != null) btn.setPointerCapture(pointerId); } catch (e) {}
      press(code, true);
    }
    function upFor(code, pointerId){
      if (!code || !Object.prototype.hasOwnProperty.call(held, code)) return;
      if (pointerId != null && held[code] !== -1 && held[code] !== idOf(pointerId)) return;
      delete held[code];
      press(code, false);
    }
    function releaseAll(pointerId){
      for (var code in held) {
        if (pointerId == null || held[code] === -1 || held[code] === idOf(pointerId)) upFor(code, pointerId);
      }
    }
    function release(e){
      var btn = e.target && e.target.closest ? e.target.closest("button") : null;
      if (btn) upFor(codeFor(btn), e.pointerId);
      else releaseAll(e.pointerId);
    }
    wrap.addEventListener("pointerdown", function(e){
      var btn = e.target.closest("button");
      if (!btn) return;
      e.preventDefault();
      down(btn, e.pointerId);
    });
    wrap.addEventListener("pointerup", release);
    wrap.addEventListener("pointercancel", release);
    wrap.addEventListener("lostpointercapture", release);
    onTouchRelease = function(e){ releaseAll(e.pointerId); };
    window.addEventListener("pointerup", onTouchRelease);
    window.addEventListener("pointercancel", onTouchRelease);
    document.body.appendChild(wrap);
  }
  setInterval(function(){ publishStats(); }, 500);
  var padOn = false;
  var padHeld = Object.create(null);
  var padMap = { 12: "ArrowUp", 13: "ArrowDown", 14: "ArrowLeft", 15: "ArrowRight", 0: "Space", 1: "KeyR", 9: "KeyR" };
  function pollPad(){
    if (!padOn || !navigator.getGamepads) return;
    var pads = navigator.getGamepads();
    var pad = pads && (pads[0] || pads[1] || pads[2] || pads[3]);
    if (!pad) return;
    function set(code, down){
      if (!code) return;
      if (down && !padHeld[code]) { padHeld[code] = true; press(code, true); }
      if (!down && padHeld[code]) { delete padHeld[code]; press(code, false); }
    }
    for (var i in padMap) set(padMap[i], !!(pad.buttons[i] && pad.buttons[i].pressed));
    set("ArrowLeft", pad.axes[0] < -0.45);
    set("ArrowRight", pad.axes[0] > 0.45);
    set("ArrowUp", pad.axes[1] < -0.45);
    set("ArrowDown", pad.axes[1] > 0.45);
  }
  setInterval(pollPad, 50);
  var frameCredit = 0;
  var holdFrames = false;
  var nativeRaf = typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame.bind(window) : null;
  if (nativeRaf) {
    window.requestAnimationFrame = function(cb){
      if (!holdFrames) return nativeRaf(cb);
      return nativeRaf(function(t){
        if (frameCredit > 0) { frameCredit -= 1; cb(t); }
        else window.requestAnimationFrame(cb);
      });
    };
  }
  function stepFrame(dir){
    holdFrames = true;
    if (document.documentElement.classList && document.documentElement.classList.toggle) {
      document.documentElement.classList.toggle("locus-paused", true);
    }
    if (dir > 0) frameCredit += 1;
    try { document.dispatchEvent(new CustomEvent("locus-frame-step", { detail: { dir: dir } })); } catch (e) {}
  }
  window.addEventListener("gamepadconnected", function(){
    padOn = true;
    try { parent.postMessage({ type: "locus-game-gamepad", on: true, connected: true }, "*"); } catch (e) {}
  });
  window.addEventListener("gamepaddisconnected", function(){
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (!pads || !(pads[0] || pads[1] || pads[2] || pads[3])) padOn = false;
    try { parent.postMessage({ type: "locus-game-gamepad", on: padOn, connected: false }, "*"); } catch (e) {}
  });
  window.addEventListener("message", function(ev){
    var data = ev.data || {};
    if (!data || typeof data.type !== "string") return;
    if (data.type === "locus-game-reset") {
      if (typeof api().reset === "function") api().reset();
      else {
        var btn = document.querySelector("[data-restart], #restart, button.restart");
        if (btn) btn.click();
        else location.reload();
      }
    }
    if (data.type === "locus-game-pause") {
      holdFrames = true;
      if (typeof api().pause === "function") api().pause();
      else if (document.documentElement.classList && document.documentElement.classList.toggle) {
        document.documentElement.classList.toggle("locus-paused", true);
      }
    }
    if (data.type === "locus-game-resume") {
      holdFrames = false;
      frameCredit = 0;
      if (typeof api().resume === "function") api().resume();
      else if (document.documentElement.classList && document.documentElement.classList.toggle) {
        document.documentElement.classList.toggle("locus-paused", false);
      }
    }
    if (data.type === "locus-game-debug") setDebug(!!data.on);
    if (data.type === "locus-game-touch") sticks(!!data.on);
    if (data.type === "locus-game-gamepad") padOn = !!data.on;
    if (data.type === "locus-game-mute") setMute(!!data.on);
    if (data.type === "locus-game-clear") clearSave();
    if (data.type === "locus-game-unlock") unlock();
    if (data.type === "locus-game-seed") setSeed(data.seed);
    if (data.type === "locus-game-play") document.documentElement.classList.toggle("locus-play", !!data.on);
    if (data.type === "locus-game-input") press(data.code || data.key, !!data.down);
    if (data.type === "locus-game-replay") replay(data.tape || data.keys);
    if (data.type === "locus-game-stats-request") publishStats();
    if (data.type === "locus-game-remap" && data.map && typeof data.map === "object") {
      inputMap = data.map;
      persist({ inputMap: inputMap });
    }
    if (data.type === "locus-game-hud") {
      var large = !!data.large;
      if (document.documentElement.classList && document.documentElement.classList.toggle) {
        document.documentElement.classList.toggle("locus-hud-lg", large);
      }
      persist({ hudLarge: large });
    }
    if (data.type === "locus-game-step") stepFrame(data.dir < 0 ? -1 : 1);
    if (data.type === "locus-game-ghost") {
      if (document.documentElement.classList && document.documentElement.classList.toggle) {
        document.documentElement.classList.toggle("locus-ghost", true);
      }
      replay(data.tape || data.keys);
      var ghostEvents = parseTape(data.tape || data.keys);
      var ghostLast = ghostEvents.length ? ghostEvents[ghostEvents.length - 1] : null;
      var ghostMs = ghostLast ? ghostLast.t + (ghostLast.hold || 40) + 240 : 600;
      setTimeout(function(){
        if (document.documentElement.classList && document.documentElement.classList.toggle) {
          document.documentElement.classList.toggle("locus-ghost", false);
        }
      }, ghostMs);
    }
    if (data.type === "locus-game-start") {
      window.__locusStart = { kind: data.kind || "", id: String(data.id || ""), seed: data.seed };
      if (typeof api().start === "function") api().start(window.__locusStart);
      try { document.dispatchEvent(new CustomEvent("locus-game-start", { detail: window.__locusStart })); } catch (e) {}
    }
    if (data.type === "locus-game-recipe-feel" && data.feel) {
      var recipeRoot = document.documentElement.style;
      var recipeKeys = ["steer", "grip", "cruise", "dash", "hint", "undo", "move-budget"];
      for (var ri = 0; ri < recipeKeys.length; ri++) {
        var rk = recipeKeys[ri];
        if (data.feel[rk] != null) recipeRoot.setProperty("--" + rk, String(data.feel[rk]));
      }
    }
    if (data.type === "locus-game-feel" && data.feel) {
      var root = document.documentElement.style;
      if (data.feel.gravity != null) root.setProperty("--gravity", String(data.feel.gravity));
      if (data.feel.jump != null) root.setProperty("--jump", String(data.feel.jump));
      if (data.feel.fire != null) root.setProperty("--fire", String(data.feel.fire));
      if (data.feel.shake != null) root.setProperty("--shake", String(data.feel.shake));
      if (data.feel["hit-stop"] != null) root.setProperty("--hit-stop", String(data.feel["hit-stop"]));
      if (data.feel.volume != null) {
        liveVolume = Number(data.feel.volume);
        if (!Number.isFinite(liveVolume)) liveVolume = 80;
        applyVolume();
      }
      if (data.feel.seed != null) setSeed(data.feel.seed);
    }
  });
})();
</script>`;

export function withGameChromeHook(html: string): string {
  if (html.includes("data-locus-game-chrome")) return html;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${GAME_CHROME_HOOK}</body>`);
  return `${html}${GAME_CHROME_HOOK}`;
}

export function formatPromoteGameBrief(session: {
  title?: string;
  palette?: { primary?: string; bg?: string; text?: string };
  designPins?: Array<{ viewport?: string; selector?: string; text?: string }>;
  designSystemId?: string;
}): string {
  const title = session.title?.trim() || "a game canvas";
  const parts = [
    "# Game brief",
    "",
    `Promoted from ${title}.`,
    "",
    "## Loop",
    "",
    "Keep a playable loop, keyboard/pointer/gamepad input, a score or win/lose, and a restart path.",
    "",
    "## Persistence",
    "",
    "High score and mute stay in localStorage key `locus-game`. No multiplayer server.",
  ];
  if (session.designSystemId) {
    parts.push("", `## Asset kit`, "", `Kit: ${session.designSystemId}`);
  }
  if (session.designPins?.length) {
    parts.push("", "## Comments");
    for (const pin of session.designPins) {
      parts.push(
        `- ${pin.viewport ?? "desktop"} \`${pin.selector ?? ""}\`${pin.text ? `: ${pin.text}` : ""}`,
      );
    }
  }
  if (session.palette) {
    parts.push("", "## Palette");
    if (session.palette.bg) parts.push(`- Background: ${session.palette.bg}`);
    if (session.palette.text) parts.push(`- Ink: ${session.palette.text}`);
    if (session.palette.primary) parts.push(`- Primary: ${session.palette.primary}`);
  }
  parts.push(
    "",
    "Port this canvas into the game scaffold. Keep operator comments and the playable loop.",
  );
  return parts.join("\n");
}
