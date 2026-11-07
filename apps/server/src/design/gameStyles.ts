import { randomUUID } from "node:crypto";
import {
  MAX_DESIGN_IMPORT_JSON_BYTES,
  MAX_GAME_STYLES,
  materializeGameStyle,
  parseGameStyleFile,
  type GameStyle,
  type GameStyleDraft,
} from "@locus/shared";
import type { JsonStore } from "../core/store.js";

export function listGameStyleCatalog(stored: GameStyle[]) {
  return { styles: stored };
}

export function createStoredGameStyle(
  draft: GameStyleDraft,
  at = new Date().toISOString(),
): GameStyle {
  const style = materializeGameStyle(draft, {
    id: randomUUID(),
    createdAt: at,
    updatedAt: at,
    fallbackName: "Untitled style",
  });
  if (!style) throw new Error("Game style needs a name");
  return style;
}

export function patchStoredGameStyle(
  current: GameStyle,
  draft: GameStyleDraft,
  at = new Date().toISOString(),
): GameStyle {
  const next = materializeGameStyle(
    {
      name: draft.name ?? current.name,
      summary: draft.summary ?? current.summary,
      guidelines: draft.guidelines === undefined ? current.guidelines : draft.guidelines,
      palette: draft.palette ?? current.palette,
      tilePx: draft.tilePx ?? current.tilePx,
      hud: draft.hud ?? current.hud,
      juice: draft.juice ?? current.juice,
      sourceSessionId: draft.sourceSessionId ?? current.sourceSessionId,
    },
    { id: current.id, createdAt: current.createdAt, updatedAt: at, fallbackName: current.name },
  );
  if (!next) throw new Error("Invalid game style");
  return next;
}

export async function addGameStyle(store: JsonStore, draft: GameStyleDraft): Promise<GameStyle> {
  const items = await store.loadGameStyles();
  if (items.length >= MAX_GAME_STYLES) throw new Error(`At most ${MAX_GAME_STYLES} game styles`);
  const style = createStoredGameStyle(draft);
  await store.replaceGameStyle(style);
  return style;
}

export async function importGameStyle(
  store: JsonStore,
  input: { text?: string; filename?: string; body?: unknown },
): Promise<GameStyle> {
  const draft = draftFromImport(input);
  if (!draft.name && input.filename) {
    draft.name = input.filename
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .trim();
  }
  return addGameStyle(store, draft);
}

function draftFromImport(input: {
  text?: string;
  filename?: string;
  body?: unknown;
}): GameStyleDraft {
  if (typeof input.text === "string" && input.text.trim()) {
    if (input.text.length > MAX_DESIGN_IMPORT_JSON_BYTES) {
      throw new Error("Import is too large. Upload a smaller JSON file.");
    }
    try {
      const parsed = parseGameStyleFile(JSON.parse(input.text) as unknown);
      if (parsed) return parsed;
    } catch {
      /* fall through */
    }
    throw new Error("Could not read a game style from that file");
  }
  const fromFile = parseGameStyleFile(input.body);
  if (fromFile) return fromFile;
  throw new Error("Could not read a game style from that file");
}

export async function updateGameStyle(
  store: JsonStore,
  id: string,
  draft: GameStyleDraft,
): Promise<GameStyle> {
  const current = (await store.loadGameStyles()).find((row) => row.id === id);
  if (!current) throw new Error("Game style not found");
  const next = patchStoredGameStyle(current, draft);
  await store.replaceGameStyle(next);
  return next;
}

export async function removeGameStyle(store: JsonStore, id: string): Promise<void> {
  const current = (await store.loadGameStyles()).find((row) => row.id === id);
  if (!current) throw new Error("Game style not found");
  await store.deleteGameStyle(id);
  const config = await store.loadConfig();
  if (config.defaultGameStyleId === id) {
    await store.saveConfig({ ...config, defaultGameStyleId: undefined });
  }
}
