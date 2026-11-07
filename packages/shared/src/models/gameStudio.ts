import {
  GAME_FEEL_KEYS,
  type GameFeelKey,
  looksJuicyGame,
  looksPlayableGame,
  parseGameControls,
} from "./gameCanvas.js";

/** Operator studio record: pins, ghost, remap, booth notes, and the seed curve. */
export const GAME_STUDIO_PATH = ".locus-game/studio.json";

export const GAME_EXTRA_FEEL_KEYS = [
  "steer",
  "grip",
  "cruise",
  "dash",
  "hint",
  "undo",
  "move-budget",
] as const;
export type GameExtraFeelKey = (typeof GAME_EXTRA_FEEL_KEYS)[number];

export const GAME_EXTRA_FEEL_DEFAULTS: Record<
  GameExtraFeelKey,
  { min: number; max: number; value: number }
> = {
  steer: { min: 0, max: 100, value: 55 },
  grip: { min: 0, max: 100, value: 40 },
  cruise: { min: 10, max: 200, value: 80 },
  dash: { min: 0, max: 40, value: 12 },
  hint: { min: 0, max: 10, value: 2 },
  undo: { min: 0, max: 20, value: 3 },
  "move-budget": { min: 1, max: 40, value: 12 },
};

/** Core sliders that belong on each starter. Missing ids keep every core knob. */
export const GAME_RECIPE_FEEL: Record<string, { core: GameFeelKey[]; extra: GameExtraFeelKey[] }> =
  {
    arcade: { core: ["fire", "shake", "hit-stop", "volume"], extra: [] },
    platformer: { core: ["gravity", "jump", "shake", "hit-stop", "volume"], extra: [] },
    puzzle: { core: ["volume"], extra: ["hint", "undo", "move-budget"] },
    "card-table": { core: ["volume"], extra: ["hint", "undo"] },
    arena: { core: ["fire", "shake", "hit-stop", "volume"], extra: ["dash"] },
    "match-3": { core: ["volume"], extra: ["hint", "undo", "move-budget"] },
    trivia: { core: ["volume"], extra: ["hint"] },
    "tower-defense": { core: ["fire", "shake", "volume"], extra: [] },
    racing: { core: ["shake", "volume"], extra: ["steer", "grip", "cruise"] },
    maze: { core: ["volume"], extra: ["hint", "move-budget"] },
    juice: { core: ["shake", "hit-stop", "volume"], extra: [] },
    "hold-move": { core: ["gravity", "jump", "volume"], extra: [] },
    "mobile-touch": { core: ["fire", "shake", "volume"], extra: [] },
    speedrun: { core: ["gravity", "jump", "volume"], extra: [] },
    roguelike: { core: ["fire", "shake", "volume"], extra: [] },
    "endless-drive": { core: ["shake", "volume"], extra: ["steer", "grip", "cruise"] },
  };

export const GAME_INPUT_CODES = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "KeyR",
] as const;

export const GAME_CURVE_SEEDS = [0, 1, 2, 3, 4] as const;

export const GAME_SAMPLE_VERDICTS = [
  "soft-lock",
  "too-easy",
  "too-hard",
  "unwinnable",
  "playable",
] as const;
export type GameSampleVerdict = (typeof GAME_SAMPLE_VERDICTS)[number];

export interface GameMomentPin {
  id: string;
  at: string;
  seed: number;
  time?: number;
  score?: number;
  deaths?: number;
  tape: string[];
  note?: string;
}

export interface GameGhost {
  seed: number;
  tape: string[];
  savedAt: string;
}

export interface GameSeedSample {
  seed: number;
  score?: number;
  deaths?: number;
  time?: number;
  verdict: GameSampleVerdict;
}

export interface GameBoothNote {
  at: string;
  note: string;
  seed: number;
  tape: string[];
  score?: number;
  deaths?: number;
  time?: number;
  handle?: string;
}

export interface PlayLinkScore {
  at: string;
  score: number;
  handle?: string;
  note?: string;
}

export interface GameStudioState {
  version: 1;
  recipeId?: string;
  activeBuildId?: string;
  moments: GameMomentPin[];
  ghost?: GameGhost;
  inputMap: Record<string, string>;
  hudLarge: boolean;
  extraFeel: Partial<Record<GameExtraFeelKey, number>>;
  curve: GameSeedSample[];
  booth: GameBoothNote[];
}

export interface GameReleaseCheck {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

function optNum(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function tapeList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, cap);
}

export function emptyGameStudio(): GameStudioState {
  return {
    version: 1,
    moments: [],
    inputMap: {},
    hudLarge: false,
    extraFeel: {},
    curve: [],
    booth: [],
  };
}

export function feelKeysForRecipe(recipeId?: string | null): GameFeelKey[] {
  const id = recipeId?.trim() ?? "";
  if (!id || !GAME_RECIPE_FEEL[id]) return [...GAME_FEEL_KEYS];
  return GAME_RECIPE_FEEL[id]!.core;
}

export function extraFeelKeysForRecipe(recipeId?: string | null): GameExtraFeelKey[] {
  const id = recipeId?.trim() ?? "";
  if (!id || !GAME_RECIPE_FEEL[id]) return [];
  return GAME_RECIPE_FEEL[id]!.extra;
}

export function sanitizeInputMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = new Set<string>(GAME_INPUT_CODES);
  const out: Record<string, string> = {};
  for (const [from, to] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.has(from) || typeof to !== "string" || !allowed.has(to) || from === to) continue;
    out[from] = to;
  }
  return out;
}

export function sanitizeExtraFeel(value: unknown): Partial<Record<GameExtraFeelKey, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  const out: Partial<Record<GameExtraFeelKey, number>> = {};
  for (const key of GAME_EXTRA_FEEL_KEYS) {
    const bounds = GAME_EXTRA_FEEL_DEFAULTS[key];
    const n = optNum(row[key]);
    if (n == null) continue;
    out[key] = Math.min(bounds.max, Math.max(bounds.min, Math.round(n)));
  }
  return out;
}

function parseMoment(value: unknown): GameMomentPin | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim().slice(0, 40) : "";
  if (!id) return undefined;
  const seed = optNum(row.seed) ?? 0;
  return {
    id,
    at: typeof row.at === "string" ? row.at : new Date().toISOString(),
    seed: Math.max(0, Math.round(seed)),
    time: optNum(row.time),
    score: optNum(row.score),
    deaths: optNum(row.deaths),
    tape: tapeList(row.tape, 32),
    note: typeof row.note === "string" ? row.note.trim().slice(0, 160) : undefined,
  };
}

function parseBooth(value: unknown): GameBoothNote | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const note = typeof row.note === "string" ? row.note.trim().slice(0, 280) : "";
  const tape = tapeList(row.tape, 32);
  const score = optNum(row.score);
  if (!note && !tape.length && score == null) return undefined;
  const handle = typeof row.handle === "string" ? row.handle.trim().slice(0, 32) : "";
  return {
    at: typeof row.at === "string" ? row.at : new Date().toISOString(),
    note,
    seed: Math.max(0, Math.round(optNum(row.seed) ?? 0)),
    tape,
    score,
    deaths: optNum(row.deaths),
    time: optNum(row.time),
    handle: handle || undefined,
  };
}

export function playLinkScores(booth: GameBoothNote[], cap = 10): PlayLinkScore[] {
  return booth
    .filter((row) => row.score != null && Number.isFinite(row.score))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.at.localeCompare(b.at))
    .slice(0, cap)
    .map((row) => ({
      at: row.at,
      score: row.score as number,
      handle: row.handle,
      note: row.note || undefined,
    }));
}

export function parseGameStudio(value: unknown): GameStudioState {
  const empty = emptyGameStudio();
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  const row = value as Record<string, unknown>;
  const recipeId = typeof row.recipeId === "string" ? row.recipeId.trim() : "";
  const activeBuildId =
    typeof row.activeBuildId === "string" && /^[A-Za-z0-9._-]+$/.test(row.activeBuildId)
      ? row.activeBuildId
      : undefined;
  const moments = Array.isArray(row.moments)
    ? row.moments
        .map(parseMoment)
        .filter((pin): pin is GameMomentPin => Boolean(pin))
        .slice(-12)
    : [];
  let ghost: GameGhost | undefined;
  if (row.ghost && typeof row.ghost === "object") {
    const g = row.ghost as Record<string, unknown>;
    const tape = tapeList(g.tape, 32);
    if (tape.length) {
      ghost = {
        seed: Math.max(0, Math.round(optNum(g.seed) ?? 0)),
        tape,
        savedAt: typeof g.savedAt === "string" ? g.savedAt : new Date().toISOString(),
      };
    }
  }
  const curve = Array.isArray(row.curve)
    ? row.curve
        .map((item) => {
          if (!item || typeof item !== "object") return undefined;
          const sample = item as Record<string, unknown>;
          const verdict = GAME_SAMPLE_VERDICTS.find((name) => name === sample.verdict);
          if (!verdict) return undefined;
          const parsed: GameSeedSample = {
            seed: Math.max(0, Math.round(optNum(sample.seed) ?? 0)),
            score: optNum(sample.score),
            deaths: optNum(sample.deaths),
            time: optNum(sample.time),
            verdict,
          };
          return parsed;
        })
        .filter((sample): sample is GameSeedSample => Boolean(sample))
        .slice(0, 12)
    : [];
  const booth = Array.isArray(row.booth)
    ? row.booth
        .map(parseBooth)
        .filter((note): note is GameBoothNote => Boolean(note))
        .slice(-40)
    : [];
  return {
    version: 1,
    recipeId: recipeId && GAME_RECIPE_FEEL[recipeId] ? recipeId : undefined,
    activeBuildId,
    moments,
    ghost,
    inputMap: sanitizeInputMap(row.inputMap),
    hudLarge: row.hudLarge === true,
    extraFeel: sanitizeExtraFeel(row.extraFeel),
    curve,
    booth,
  };
}

export function formatGameStudio(state: GameStudioState): string {
  return `${JSON.stringify(parseGameStudio(state), null, 2)}\n`;
}

export function createMomentPin(input: {
  seed: number;
  time?: number;
  score?: number;
  deaths?: number;
  tape: string[];
  note?: string;
  at?: string;
}): GameMomentPin {
  const at = input.at ?? new Date().toISOString();
  const id = `m${at.replace(/\D/g, "").slice(-10) || "0"}`;
  return parseMoment({
    id,
    at,
    seed: input.seed,
    time: input.time,
    score: input.score,
    deaths: input.deaths,
    tape: input.tape,
    note: input.note,
  })!;
}

export function withMoment(state: GameStudioState, pin: GameMomentPin): GameStudioState {
  return parseGameStudio({ ...state, moments: [...state.moments, pin] });
}

export function formatMomentFix(pin: GameMomentPin): string {
  return [
    "Pinned moment. Patch this moment in place. Do not tour the HUD and do not restore an older loop.",
    `Moment ${pin.id} seed ${pin.seed} time ${pin.time ?? "—"} score ${pin.score ?? "—"} deaths ${pin.deaths ?? "—"}.`,
    `Tape slice: ${pin.tape.join(" ") || "none"}.`,
    pin.note ? `Note: ${pin.note}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function classifySeedSample(sample: {
  score?: number;
  deaths?: number;
  time?: number;
}): GameSampleVerdict {
  const time = sample.time ?? 0;
  const deaths = sample.deaths ?? 0;
  const score = sample.score ?? 0;
  if (time < 0.4 && deaths === 0 && score === 0) return "soft-lock";
  if (time > 0 && time < 2 && deaths > 0) return "too-hard";
  if (time >= 8 && deaths === 0 && score === 0) return "unwinnable";
  if (time >= 8 && deaths === 0 && score > 0) return "too-easy";
  return "playable";
}

export function createSeedSample(input: {
  seed: number;
  score?: number;
  deaths?: number;
  time?: number;
}): GameSeedSample {
  return {
    seed: Math.max(0, Math.round(input.seed)),
    score: input.score,
    deaths: input.deaths,
    time: input.time,
    verdict: classifySeedSample(input),
  };
}

export function parseBoothPayload(raw: unknown): GameBoothNote | undefined {
  return parseBooth(raw);
}

export function withBoothNote(state: GameStudioState, note: GameBoothNote): GameStudioState {
  return parseGameStudio({ ...state, booth: [...state.booth, note] });
}

export function itchBlurbFromGdd(gdd?: string | null): string {
  const text = gdd ?? "";
  const fantasy = text.match(/## Fantasy\s+([\s\S]*?)(?:\n## |\s*$)/i)?.[1]?.trim() ?? "";
  if (!fantasy || /who the player is/i.test(fantasy)) return "";
  return fantasy
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 280);
}

export function gameReleaseChecklist(input: {
  html?: string | null;
  gdd?: string | null;
}): GameReleaseCheck[] {
  const html = input.html ?? "";
  const blurb = itchBlurbFromGdd(input.gdd);
  const controls = /data-controls\s*=\s*["'][^"']+["']/i.test(html);
  return [
    {
      id: "playable",
      label: "Playable loop",
      ok: looksPlayableGame(html),
      detail: "Input, a score or win/lose, and a restart.",
    },
    {
      id: "juice",
      label: "Juice",
      ok: looksJuicyGame(html),
      detail: "Hit flash, shake, particles, or Web Audio in the game script.",
    },
    {
      id: "controls",
      label: "Controls line",
      ok: controls,
      detail: parseGameControls(html),
    },
    {
      id: "mute",
      label: "Mute persisted",
      ok: /locus-game/.test(html) && /mute/i.test(html),
      detail: "Mute stays in localStorage key locus-game.",
    },
    {
      id: "best",
      label: "Personal best",
      ok: /locus-game/.test(html) && /best|high\s*score|personal/i.test(html),
      detail: "A best or high score in localStorage key locus-game.",
    },
    {
      id: "how-to-play",
      label: "How to Play overlay",
      ok: /how to play|how-to-play|data-how-to-play/i.test(html),
      detail: "A dismissible How to Play on boot, pause, or fail.",
    },
    {
      id: "blurb",
      label: "Itch blurb from GDD",
      ok: blurb.length > 0,
      detail: blurb || "Write a Fantasy line in GDD.md.",
    },
  ];
}

export function formatReleaseNotes(checks: GameReleaseCheck[], blurb: string): string {
  const lines = ["# Release check", ""];
  for (const row of checks) {
    lines.push(`- [${row.ok ? "x" : " "}] ${row.label}${row.detail ? ` — ${row.detail}` : ""}`);
  }
  if (blurb) lines.push("", "## Itch", "", blurb);
  lines.push("");
  return lines.join("\n");
}

export function splitLiveGameHtml(html: string): { indexHtml: string; gameJs: string } | undefined {
  const source = html ?? "";
  if (!source.trim()) return undefined;
  if (/<script\b[^>]*\bsrc\s*=\s*["']\.?\/?game\.js["']/i.test(source)) return undefined;
  const scripts: string[] = [];
  const next = source.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (full, attrs, body) => {
    const attr = String(attrs ?? "");
    if (/\bsrc\s*=/.test(attr) || /data-locus-/.test(attr)) return full;
    const code = String(body ?? "").trim();
    if (code.length < 40) return full;
    scripts.push(code);
    return "";
  });
  if (!scripts.length) return undefined;
  const tag = `<script src="./game.js"></script>`;
  const indexHtml = /<\/body>/i.test(next)
    ? next.replace(/<\/body>/i, `${tag}</body>`)
    : `${next}${tag}`;
  return { indexHtml, gameJs: `${scripts.join("\n\n")}\n` };
}

export function withPlayBooth(html: string, token: string): string {
  if (html.includes("data-locus-play-booth")) return html;
  const safe = token.trim().replace(/[^A-Za-z0-9_-]/g, "");
  if (!safe) return html;
  const form = `<aside data-locus-play-booth data-locus-play-board style="position:fixed;right:8px;bottom:8px;z-index:10000;max-width:240px;font:12px sans-serif;background:#111;color:#eee;padding:8px;border:1px solid #333">
<p style="margin:0 0 6px">Unlisted · this link</p>
<ol data-locus-play-scores style="margin:0 0 8px;padding-left:1.2em"></ol>
<form action="/play/${safe}/booth" method="post" style="display:flex;flex-direction:column;gap:4px">
<input name="handle" maxlength="32" placeholder="Name" />
<input name="note" maxlength="280" placeholder="How did it go?" />
<button type="submit" name="intent" value="note">Send note</button>
<button type="submit" name="intent" value="score">Post score</button>
</form>
</aside>
<script data-locus-play-booth>
(function(){
  var root = document.querySelector("[data-locus-play-booth]");
  var form = root && root.querySelector("form");
  if (!form) return;
  var scoresUrl = form.action.replace(/\\/booth$/, "/scores");
  function loadScores(){
    fetch(scoresUrl).then(function(res){ return res.json(); }).then(function(data){
      var ol = document.querySelector("[data-locus-play-scores]");
      if (!ol) return;
      ol.innerHTML = "";
      (data.scores || []).forEach(function(row){
        var li = document.createElement("li");
        li.textContent = (row.handle || "player") + " · " + row.score;
        ol.appendChild(li);
      });
    }).catch(function(){});
  }
  loadScores();
  form.addEventListener("submit", function(ev){
    ev.preventDefault();
    var intent = ev.submitter && ev.submitter.value;
    var store = {};
    try { store = JSON.parse(localStorage.getItem("locus-game") || "{}"); } catch (e) {}
    var stats = window.__locusGame && window.__locusGame.stats ? window.__locusGame.stats() : {};
    var score = stats && stats.score;
    if (intent === "score" && (score == null || !isFinite(Number(score)))) return;
    fetch(form.action, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        note: (form.note && form.note.value || "").trim(),
        handle: (form.handle && form.handle.value || "").trim(),
        tape: store.tape || [],
        seed: window.__locusGameSeed || 0,
        score: score,
        deaths: stats && stats.deaths,
        time: stats && stats.time
      })
    }).then(function(){
      if (form.note) form.note.value = "";
      loadScores();
    }).catch(function(){});
  });
})();
</script>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${form}</body>`);
  return `${html}${form}`;
}
