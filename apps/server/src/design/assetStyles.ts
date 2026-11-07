import { randomUUID } from "node:crypto";
import {
  MAX_ASSET_STYLES,
  MAX_DESIGN_IMPORT_JSON_BYTES,
  materializeAssetStyle,
  parseAssetStyleFile,
  type AssetStyle,
  type AssetStyleDraft,
} from "@locus/shared";
import type { JsonStore } from "../core/store.js";

export function listAssetStyleCatalog(stored: AssetStyle[]) {
  return { styles: stored };
}

export function createStoredAssetStyle(
  draft: AssetStyleDraft,
  at = new Date().toISOString(),
): AssetStyle {
  const style = materializeAssetStyle(draft, {
    id: randomUUID(),
    createdAt: at,
    updatedAt: at,
    fallbackName: "Untitled style",
  });
  if (!style) throw new Error("Asset style needs a name");
  return style;
}

export function patchStoredAssetStyle(
  current: AssetStyle,
  draft: AssetStyleDraft,
  at = new Date().toISOString(),
): AssetStyle {
  const next = materializeAssetStyle(
    {
      name: draft.name ?? current.name,
      summary: draft.summary ?? current.summary,
      guidelines: draft.guidelines === undefined ? current.guidelines : draft.guidelines,
      palette: draft.palette ?? current.palette,
      sourceSessionId: draft.sourceSessionId ?? current.sourceSessionId,
    },
    { id: current.id, createdAt: current.createdAt, updatedAt: at, fallbackName: current.name },
  );
  if (!next) throw new Error("Invalid asset style");
  return next;
}

export async function addAssetStyle(store: JsonStore, draft: AssetStyleDraft): Promise<AssetStyle> {
  const items = await store.loadAssetStyles();
  if (items.length >= MAX_ASSET_STYLES) throw new Error(`At most ${MAX_ASSET_STYLES} asset styles`);
  const style = createStoredAssetStyle(draft);
  await store.replaceAssetStyle(style);
  return style;
}

export async function importAssetStyle(
  store: JsonStore,
  input: { text?: string; filename?: string; body?: unknown },
): Promise<AssetStyle> {
  const draft = draftFromImport(input);
  if (!draft.name && input.filename) {
    draft.name = input.filename
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .trim();
  }
  return addAssetStyle(store, draft);
}

function draftFromImport(input: {
  text?: string;
  filename?: string;
  body?: unknown;
}): AssetStyleDraft {
  if (typeof input.text === "string" && input.text.trim()) {
    if (input.text.length > MAX_DESIGN_IMPORT_JSON_BYTES) {
      throw new Error("Import is too large. Upload a smaller JSON file.");
    }
    try {
      const parsed = parseAssetStyleFile(JSON.parse(input.text) as unknown);
      if (parsed) return parsed;
    } catch {
      /* fall through */
    }
    throw new Error("Could not read an asset style from that file");
  }
  const fromFile = parseAssetStyleFile(input.body);
  if (fromFile) return fromFile;
  throw new Error("Could not read an asset style from that file");
}

export async function updateAssetStyle(
  store: JsonStore,
  id: string,
  draft: AssetStyleDraft,
): Promise<AssetStyle> {
  const current = (await store.loadAssetStyles()).find((row) => row.id === id);
  if (!current) throw new Error("Asset style not found");
  const next = patchStoredAssetStyle(current, draft);
  await store.replaceAssetStyle(next);
  return next;
}

export async function removeAssetStyle(store: JsonStore, id: string): Promise<void> {
  const current = (await store.loadAssetStyles()).find((row) => row.id === id);
  if (!current) throw new Error("Asset style not found");
  await store.deleteAssetStyle(id);
  const config = await store.loadConfig();
  if (config.defaultAssetStyleId === id) {
    await store.saveConfig({ ...config, defaultAssetStyleId: undefined });
  }
}
