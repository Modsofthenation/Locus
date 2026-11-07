import { randomUUID } from "node:crypto";
import {
  MAX_DESIGN_IMPORT_JSON_BYTES,
  MAX_DESIGN_SYSTEMS,
  builtinDesignSystems,
  claudeDesignImportHint,
  extractDesignSystemDraft,
  extractDesignSystemDraftFromFiles,
  isBuiltinDesignSystemId,
  isClaudeDesignManifest,
  materializeDesignSystem,
  mergeStartingPoints,
  parseDesignSystemFile,
  startingPointsFromKitPaths,
  type DesignSystem,
  type DesignSystemDraft,
} from "@locus/shared";
import type { JsonStore } from "../core/store.js";
import { unzipKitFiles, unzipTextFiles } from "../media/unzip.js";
import { removeDesignKit, saveDesignKit } from "./designKits.js";

export function listDesignSystemCatalog(stored: DesignSystem[]) {
  return { systems: stored, builtins: builtinDesignSystems() };
}

export function createStoredDesignSystem(
  draft: DesignSystemDraft,
  at = new Date().toISOString(),
): DesignSystem {
  const system = materializeDesignSystem(draft, {
    id: randomUUID(),
    createdAt: at,
    updatedAt: at,
    fallbackName: "Untitled system",
  });
  if (!system) throw new Error("Design system needs a name and a full color palette");
  return system;
}

export function patchStoredDesignSystem(
  current: DesignSystem,
  draft: DesignSystemDraft,
  at = new Date().toISOString(),
): DesignSystem {
  const next = materializeDesignSystem(
    {
      name: draft.name ?? current.name,
      summary: draft.summary ?? current.summary,
      palette: draft.palette ?? current.palette,
      typography: draft.typography ?? current.typography,
      radiusPx: draft.radiusPx ?? current.radiusPx,
      spacePx: draft.spacePx ?? current.spacePx,
      guidelines: draft.guidelines === undefined ? current.guidelines : draft.guidelines,
      tokens: draft.tokens ?? current.tokens,
      startingPoints: draft.startingPoints ?? current.startingPoints,
    },
    { id: current.id, createdAt: current.createdAt, updatedAt: at, fallbackName: current.name },
  );
  if (!next) throw new Error("Invalid design system");
  return {
    ...next,
    kit: current.kit,
    tokens: next.tokens ?? current.tokens,
    startingPoints: next.startingPoints ?? current.startingPoints,
  };
}

export async function addDesignSystem(
  store: JsonStore,
  draft: DesignSystemDraft,
): Promise<DesignSystem> {
  const items = await store.loadDesignSystems();
  if (items.length >= MAX_DESIGN_SYSTEMS)
    throw new Error(`At most ${MAX_DESIGN_SYSTEMS} design systems`);
  const system = createStoredDesignSystem({ ...draft, kit: undefined });
  await store.replaceDesignSystem(system);
  return system;
}

export async function importDesignSystem(
  store: JsonStore,
  input: {
    text?: string;
    filename?: string;
    body?: unknown;
    zipBase64?: string;
    zipBytes?: Buffer;
  },
): Promise<DesignSystem> {
  const draft = draftFromImport(input);
  if (!draft.name && input.filename) {
    draft.name = input.filename
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .trim();
  }
  const system = await addDesignSystem(store, draft);
  const zip = input.zipBytes?.length
    ? input.zipBytes
    : typeof input.zipBase64 === "string" && input.zipBase64.trim()
      ? Buffer.from(input.zipBase64.replace(/\s/g, ""), "base64")
      : undefined;
  if (!zip?.length) return system;
  let kitFiles: ReturnType<typeof unzipKitFiles>;
  try {
    kitFiles = unzipKitFiles(zip);
  } catch {
    return system;
  }
  if (!kitFiles.length) return system;
  const kit = await saveDesignKit(store.dataDir, system.id, kitFiles);
  if (!kit) return system;
  const fromKit = startingPointsFromKitPaths(kitFiles.map((file) => file.name));
  const withKit = {
    ...system,
    kit,
    startingPoints: mergeStartingPoints(system.startingPoints, fromKit),
  };
  await store.replaceDesignSystem(withKit);
  return withKit;
}

function draftFromZip(buf: Buffer, filename: string): DesignSystemDraft {
  const files = unzipTextFiles(buf);
  const draft = extractDesignSystemDraftFromFiles(files, filename);
  if (draft) return draft;
  const manifest = files.find((file) => /_ds_manifest\.json$/i.test(file.name))?.text;
  throw new Error(
    claudeDesignImportHint(manifest, filename) ?? "Could not read a design system from that zip",
  );
}

function draftFromImport(input: {
  text?: string;
  filename?: string;
  body?: unknown;
  zipBase64?: string;
  zipBytes?: Buffer;
}): DesignSystemDraft {
  const filename = input.filename ?? "";
  if (input.zipBytes && input.zipBytes.length) {
    return draftFromZip(input.zipBytes, filename);
  }
  if (typeof input.zipBase64 === "string" && input.zipBase64.trim()) {
    if (input.zipBase64.length > MAX_DESIGN_IMPORT_JSON_BYTES) throw new Error("Zip is too large");
    return draftFromZip(Buffer.from(input.zipBase64.replace(/\s/g, ""), "base64"), filename);
  }
  if (typeof input.text === "string" && input.text.trim()) {
    if (input.text.length > MAX_DESIGN_IMPORT_JSON_BYTES) {
      throw new Error(
        "Import is too large. Upload the .zip as a file instead of encoding it as JSON.",
      );
    }
    const draft = extractDesignSystemDraft(input.text, filename);
    if (draft) return draft;
    throw new Error(
      claudeDesignImportHint(input.text, filename) ??
        "Could not read a design system from that file",
    );
  }
  const fromFile = parseDesignSystemFile(input.body);
  if (fromFile) return fromFile;
  if (isClaudeDesignManifest(input.body)) {
    const draft = extractDesignSystemDraft(JSON.stringify(input.body), filename);
    if (draft) return draft;
    throw new Error(
      claudeDesignImportHint(undefined, filename || "_ds_manifest.json") ??
        "Could not read a design system from that file",
    );
  }
  throw new Error("Could not read a design system from that file");
}

export async function updateDesignSystem(
  store: JsonStore,
  id: string,
  draft: DesignSystemDraft,
): Promise<DesignSystem> {
  if (isBuiltinDesignSystemId(id))
    throw new Error("Starter palettes are built in. Save a copy to edit.");
  const current = (await store.loadDesignSystems()).find((row) => row.id === id);
  if (!current) throw new Error("Design system not found");
  const next = patchStoredDesignSystem(current, draft);
  await store.replaceDesignSystem(next);
  return next;
}

export async function removeDesignSystem(store: JsonStore, id: string): Promise<void> {
  if (isBuiltinDesignSystemId(id)) throw new Error("Starter palettes are built in");
  const current = (await store.loadDesignSystems()).find((row) => row.id === id);
  if (!current) throw new Error("Design system not found");
  await store.deleteDesignSystem(id);
  await removeDesignKit(store.dataDir, id);
  const config = await store.loadConfig();
  if (config.defaultDesignSystemId === id) {
    await store.saveConfig({ ...config, defaultDesignSystemId: undefined });
  }
}
