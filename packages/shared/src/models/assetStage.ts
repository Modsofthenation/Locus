import {
  ASSET_BACK_SOURCE_FILE,
  ASSET_CLIPS,
  ASSET_CORE_CLIPS,
  ASSET_ITERATE_CHIPS,
  ASSET_POSE_PRESETS,
  ASSET_SIDE_SOURCE_FILE,
  ASSET_SOURCE_FILE,
  looksWiredAsset,
  type AssetClip,
  type AssetIterateChipId,
  type AssetPosePreset,
  type AssetStudioStats,
} from "./assetCanvas.js";
import { formatAssetBuildLines, type AssetBuild } from "./assetBuild.js";
import { withAssetStylePrompt, type AssetStyleLook } from "./assetStyle.js";

export const ASSET_CAMERA_VIEWS = ["front", "side", "top", "reset"] as const;
export type AssetCameraView = (typeof ASSET_CAMERA_VIEWS)[number];

export const ASSET_MATERIALS = ["studio", "clay", "albedo"] as const;
export type AssetMaterial = (typeof ASSET_MATERIALS)[number];

export const ASSET_LIGHTS = ["default", "key", "rim"] as const;
export type AssetLights = (typeof ASSET_LIGHTS)[number];

export const ASSET_UNITS = ["m", "mm"] as const;
export type AssetUnits = (typeof ASSET_UNITS)[number];

export const ASSET_BACKGROUNDS = ["grey", "checkered", "photo"] as const;
export type AssetBackground = (typeof ASSET_BACKGROUNDS)[number];

export const ASSET_CLIP_SPEEDS = [0.25, 0.5, 1, 2] as const;
export type AssetClipSpeed = (typeof ASSET_CLIP_SPEEDS)[number];

export const ASSET_ISOLATE_PARTS = ["all", "body", "props"] as const;
export type AssetIsolatePart = (typeof ASSET_ISOLATE_PARTS)[number];

export const ASSET_LIVE_VARIANT_ID = "live";
export const ASSET_UNDO_VARIANT_ID = "undo";

export const ASSET_VIEW_SLOTS = ["front", "side", "back"] as const;
export type AssetViewSlot = (typeof ASSET_VIEW_SLOTS)[number];

export const ASSET_VIEW_FILES: Record<AssetViewSlot, string> = {
  front: ASSET_SOURCE_FILE,
  side: ASSET_SIDE_SOURCE_FILE,
  back: ASSET_BACK_SOURCE_FILE,
};

export const ASSET_PIPELINE_STAGES = ["silhouette", "hull", "texture", "rig"] as const;
export type AssetPipelineStage = (typeof ASSET_PIPELINE_STAGES)[number];

export const ASSET_SUBJECT_KINDS = ["character", "prop", "sprite"] as const;
export type AssetSubjectKind = (typeof ASSET_SUBJECT_KINDS)[number];

export function formatAssetCameraLabel(view: AssetCameraView): string {
  if (view === "reset") return "Reset";
  return view.slice(0, 1).toUpperCase() + view.slice(1);
}

export function formatAssetCameraHint(view: AssetCameraView): string {
  if (view === "front") return "Look at the mesh from the front";
  if (view === "side") return "Look at the mesh from the side";
  if (view === "top") return "Look at the mesh from above";
  return "Reset camera orientation without changing zoom";
}

export function formatAssetMaterialLabel(id: AssetMaterial): string {
  if (id === "clay") return "Clay";
  if (id === "albedo") return "Albedo";
  return "Studio";
}

export function formatAssetMaterialHint(id: AssetMaterial): string {
  if (id === "clay") return "Clay preview — hide textures to judge form";
  if (id === "albedo") return "Show the source photo as albedo";
  return "Studio shaded look";
}

export function formatAssetLightsLabel(id: AssetLights): string {
  if (id === "key") return "Key";
  if (id === "rim") return "Rim";
  return "Default";
}

export function formatAssetLightsHint(id: AssetLights): string {
  if (id === "key") return "Strong key light from one side";
  if (id === "rim") return "Rim / backlight to separate the silhouette";
  return "Default three-point lights";
}

export function formatAssetUnitsLabel(units: AssetUnits): string {
  return units === "mm" ? "mm" : "m";
}

export function formatAssetBackgroundLabel(id: AssetBackground): string {
  if (id === "checkered") return "Checkered";
  if (id === "photo") return "Photo";
  return "Grey";
}

export function formatAssetBackgroundHint(id: AssetBackground): string {
  if (id === "checkered") return "Checkered backdrop to read silhouette and scale";
  if (id === "photo") return "Use the source photo as the backdrop";
  return "Neutral grey backdrop";
}

export function formatAssetClipSpeedLabel(speed: AssetClipSpeed): string {
  if (speed === 1) return "1×";
  if (speed === 2) return "2×";
  if (speed === 0.5) return "0.5×";
  return "0.25×";
}

export function formatAssetClipSpeedHint(speed: AssetClipSpeed): string {
  return `Play the clip at ${formatAssetClipSpeedLabel(speed)}`;
}

export function formatAssetIsolateLabel(part: AssetIsolatePart): string {
  if (part === "body") return "Body";
  if (part === "props") return "Props";
  return "All";
}

export function formatAssetIsolateHint(part: AssetIsolatePart): string {
  if (part === "body") return "Show only the body mesh";
  if (part === "props") return "Show only props / held items";
  return "Show every part";
}

export function formatAssetViewSlotLabel(slot: AssetViewSlot): string {
  if (slot === "side") return "Side";
  if (slot === "back") return "Back";
  return "Front";
}

export function assetCanvasFileUrl(sessionId: string, file: string): string {
  const rel = file.replace(/^\.\//, "").replace(/^\/+/, "");
  return `/api/sessions/${encodeURIComponent(sessionId)}/canvas-files/${rel}`;
}

export function parseAssetCameraView(value: unknown): AssetCameraView | undefined {
  return ASSET_CAMERA_VIEWS.find((id) => id === value);
}

export function parseAssetMaterial(value: unknown): AssetMaterial | undefined {
  return ASSET_MATERIALS.find((id) => id === value);
}

export function parseAssetLights(value: unknown): AssetLights | undefined {
  return ASSET_LIGHTS.find((id) => id === value);
}

export function parseAssetUnits(value: unknown): AssetUnits | undefined {
  if (value === "meter" || value === "meters" || value === "m") return "m";
  if (value === "millimeter" || value === "millimeters" || value === "mm") return "mm";
  return undefined;
}

export function inferAssetPipeline(
  html?: string | null,
  stats?: AssetStudioStats,
): AssetPipelineStage {
  const text = html?.trim() ?? "";
  if (!text) return "silhouette";
  const wired = looksWiredAsset(text) || (stats?.verts != null && stats.verts > 0);
  if (!wired) return "silhouette";
  const textured =
    stats?.mode === "3d" &&
    (/albedo|pbr|roughness|metallic|source\.png|map.*(?:color|diffuse)|texImage2D/i.test(text) ||
      Boolean(stats && "verts" in stats && /texture/i.test(text)));
  const hasTexture = /albedo|pbr|roughness|metallic|\.map\b|source\.png/i.test(text);
  const hasRig =
    /\bdata-tune=/.test(text) &&
    /__locusAsset[\s\S]{0,500}\bplay\b|clips?\s*[:=]|rig|bone|skeleton/i.test(text);
  if (hasRig) return "rig";
  if (hasTexture || textured) return "texture";
  return "hull";
}

export function formatAssetPipelineLabel(stage: AssetPipelineStage, working = false): string {
  const labels: Record<AssetPipelineStage, string> = {
    silhouette: "Silhouette",
    hull: "Hull",
    texture: "Texture",
    rig: "Rig",
  };
  if (!working) return labels[stage];
  if (stage === "silhouette") return "Tracing silhouette…";
  if (stage === "hull") return "Building hull…";
  if (stage === "texture") return "Mapping texture…";
  return "Adding rig…";
}

export function inferAssetSubject(input: {
  html?: string | null;
  title?: string;
  recipeId?: string;
}): AssetSubjectKind {
  const html = input.html ?? "";
  const title = (input.title ?? "").toLowerCase();
  const recipe = (input.recipeId ?? "").toLowerCase();
  if (
    recipe === "cutout" ||
    recipe === "sprite-sheet" ||
    recipe === "sprite-pack" ||
    /data-locus-asset-mode=["']2d["']|\bmode\s*[:=]\s*["']2d["']/i.test(html)
  ) {
    if (!looksWiredAsset(html)) return "sprite";
  }
  if (
    recipe === "attacks" ||
    recipe === "walk-cycle" ||
    recipe === "hold" ||
    recipe === "rig" ||
    recipe === "image-to-3d" ||
    recipe === "text-to-3d"
  ) {
    if (recipe === "attacks" || recipe === "walk-cycle" || recipe === "hold" || recipe === "rig") {
      return "character";
    }
  }
  if (/\b(sprite|tileset|cutout|sticker)\b/.test(title) && !looksWiredAsset(html)) return "sprite";
  if (
    /\b(prop|vase|vehicle|car|chair|sword|crown|tile|weapon|rock|crate)\b/.test(title) &&
    !/\b(hero|character|fighter|person|human|goose|swan|bird|animal)\b/.test(title)
  ) {
    return "prop";
  }
  if (/\bdata-tune=/.test(html) && /play\s*\(|clips|rig|bone/i.test(html)) return "character";
  if (looksWiredAsset(html) && !/\bdata-tune=/.test(html) && !/\bplay\s*\(/.test(html)) {
    return "prop";
  }
  if (/\bdata-tune=/.test(html)) return "character";
  return looksWiredAsset(html) ? "prop" : "character";
}

export function assetShowsPose(kind: AssetSubjectKind, html?: string | null): boolean {
  if (kind === "sprite") return false;
  if (kind === "prop") return /\bdata-tune=/.test(html ?? "");
  return /\bdata-tune=/.test(html ?? "") || /--head|--arms|--legs|--twist/.test(html ?? "");
}

export function assetShowsClips(kind: AssetSubjectKind, html?: string | null): boolean {
  if (kind === "sprite") return /sprite|clip|play\s*\(/i.test(html ?? "");
  if (kind === "prop") return /__locusAsset[\s\S]{0,400}\bplay\b/.test(html ?? "");
  return true;
}

export function assetShowsStage3d(kind: AssetSubjectKind): boolean {
  return kind !== "sprite";
}

export function assetVisibleIterateChips(kind: AssetSubjectKind): AssetIterateChipId[] {
  if (kind === "sprite") return ["texture", "low-poly"];
  return ASSET_ITERATE_CHIPS.map((chip) => chip.id);
}

export function assetLooksLikeFighter(input: {
  html?: string | null;
  title?: string;
  recipeId?: string;
}): boolean {
  const recipe = (input.recipeId ?? "").toLowerCase();
  if (recipe === "attacks") return true;
  const blob = `${input.html ?? ""}\n${input.title ?? ""}`;
  return /attack-heavy|attack-ranged|\bfights\b|\bcombat\b|\bwarrior\b|\bfighter\b/i.test(blob);
}

export function assetVisibleClips(input: {
  html?: string | null;
  title?: string;
  recipeId?: string;
}): readonly AssetClip[] {
  const kind = inferAssetSubject(input);
  if (kind === "prop" || kind === "sprite") {
    if (!assetShowsClips(kind, input.html)) return [];
    return ["idle"];
  }
  if (assetLooksLikeFighter(input)) return ASSET_CLIPS;
  return ASSET_CORE_CLIPS;
}

export function assetVisiblePosePresets(input: {
  html?: string | null;
  title?: string;
  recipeId?: string;
}): AssetPosePreset[] {
  if (!assetShowsPose(inferAssetSubject(input), input.html)) return [];
  if (assetLooksLikeFighter(input)) return Object.keys(ASSET_POSE_PRESETS) as AssetPosePreset[];
  return ASSET_CORE_CLIPS.filter((id) => id in ASSET_POSE_PRESETS) as AssetPosePreset[];
}

const SLOT_NAME: Record<AssetViewSlot, RegExp> = {
  front: /front|source|albedo|canonical/i,
  side: /side|left|right|profile/i,
  back: /back|rear|behind/i,
};

export function viewSlotForAssetName(name: string, index = 0, total = 1): AssetViewSlot {
  const file = name.trim();
  if (SLOT_NAME.side.test(file) && !SLOT_NAME.front.test(file)) return "side";
  if (SLOT_NAME.back.test(file)) return "back";
  if (SLOT_NAME.front.test(file)) return "front";
  if (file.toLowerCase() === ASSET_VIEW_FILES.side.toLowerCase()) return "side";
  if (file.toLowerCase() === ASSET_VIEW_FILES.back.toLowerCase()) return "back";
  if (file.toLowerCase() === ASSET_VIEW_FILES.front.toLowerCase()) return "front";
  if (index === 1 && total >= 2) return "side";
  if (index >= 2 && total >= 3) return "back";
  return "front";
}

export function namedAssetViewFile(
  file: { name: string; type?: string; lastModified?: number } & Blob,
  slot: AssetViewSlot,
): File {
  const type = "type" in file && file.type ? file.type : "image/png";
  return new File([file], ASSET_VIEW_FILES[slot], {
    type,
    lastModified:
      "lastModified" in file && typeof file.lastModified === "number"
        ? file.lastModified
        : Date.now(),
  });
}

export function generateAssetPrompt(
  build: AssetBuild,
  hasCanvas: boolean,
  style?: AssetStyleLook | null,
): string {
  const head = hasCanvas
    ? "Generate from the current operator build settings. Patch /workspace/index.html in place. Do not change the subject."
    : [
        "Generate the first viewable studio now.",
        "Pipeline in this write: punch out ./source.png (and ./source-side.png / ./source-back.png when present) with ./vendor/reconstruct.js → a silhouette hull → a wired mesh with orbit and albedo on the subject only (Canvas 2D hull or vendored Three — CSS preserve-3d is not a mesh) → texture if Texture is on.",
        "Close </html> in the same write. Write ASSET.md after the first paint, not before.",
        "Skip the rig until the hull is on the canvas, unless the brief is a character that needs pose on first paint.",
        "Keep exportGlb / exportPng / exportStl / exportTextures / stats.",
      ].join(" ");
  return withAssetStylePrompt(
    [
      head,
      "Honor the Build settings already in the system prompt and ASSET.md ## Build — do not wait for this message to repeat them:",
      ...formatAssetBuildLines(build).map((line) => `- ${line}`),
    ].join("\n"),
    style,
  );
}

export function dropAssetPhotoPrompt(slot: AssetViewSlot, hasCanvas: boolean): string {
  const file = ASSET_VIEW_FILES[slot];
  const view = formatAssetViewSlotLabel(slot).toLowerCase();
  if (!hasCanvas) {
    return [
      `Use this ${view} photo as the source. It is already at ./${file} (landed by the host).`,
      "Generate the first viewable hull from the silhouette with ./vendor/reconstruct.js. Punch out the backdrop and map albedo only onto the subject. Do not file_read the PNG.",
    ].join(" ");
  }
  if (slot === "front") {
    return [
      "New source photo dropped on the live studio.",
      `It is already at ./${file}. Retarget albedo / silhouette from it with ./vendor/reconstruct.js.`,
      "Punch out the new backdrop. Do not change topology unless the silhouette changed. Do not invent a second subject.",
    ].join(" ");
  }
  return [
    `This is a ${view} view of the same subject.`,
    `It is already at ./${file}. Honor multi-view: the photos are one character, not two.`,
    "Patch the hull to match this angle. Do not file_read the PNG.",
  ].join(" ");
}

export function formatAssetMeshHealth(stats?: AssetStudioStats): string {
  if (!stats) return "—";
  const holes = stats.holes;
  const nonManifold = stats.nonManifold;
  const open = stats.openEdges;
  if (holes == null && nonManifold == null && open == null) {
    return stats.printable === true ? "Clean" : "—";
  }
  const bits: string[] = [];
  if (holes) bits.push(`${holes} hole${holes === 1 ? "" : "s"}`);
  if (nonManifold) bits.push(`${nonManifold} non-manifold`);
  if (open) bits.push(`${open} open`);
  return bits.length ? bits.join(", ") : "Clean";
}

export function assetWorkingChip(input: {
  html?: string | null;
  stats?: AssetStudioStats;
  working?: boolean;
  guestComingUp?: boolean;
  building?: boolean;
}): string {
  if (input.building) return "Building image…";
  if (input.guestComingUp) return "Starting container…";
  if (!input.working) return "";
  const stage = inferAssetPipeline(input.html, input.stats);
  if (!input.html?.trim()) return "Tracing silhouette…";
  return formatAssetPipelineLabel(stage, true);
}
