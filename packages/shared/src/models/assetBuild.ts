import { ASSET_PHOTO_RECONSTRUCT_PROMPT, assetPhotoContourCount } from "./assetReconstruct.js";

/** Operator generation knobs for Assets studios (Meshy-like, local-first). */

export const ASSET_TOPOLOGY_MODES = ["high-detail", "smart"] as const;
export type AssetTopologyMode = (typeof ASSET_TOPOLOGY_MODES)[number];

export const ASSET_QUALITY_TIERS = ["standard", "flagship"] as const;
export type AssetQualityTier = (typeof ASSET_QUALITY_TIERS)[number];

export const ASSET_RESOLUTIONS = ["standard", "2x", "4x"] as const;
export type AssetResolution = (typeof ASSET_RESOLUTIONS)[number];

export const ASSET_REST_POSES = ["a-pose", "t-pose", "custom"] as const;
export type AssetRestPose = (typeof ASSET_REST_POSES)[number];

export const ASSET_POLY_BUDGETS = ["2k", "8k", "20k"] as const;
export type AssetPolyBudget = (typeof ASSET_POLY_BUDGETS)[number];

export const ASSET_POLY_BUDGET_FACES: Record<AssetPolyBudget, number> = {
  "2k": 2000,
  "8k": 8000,
  "20k": 20_000,
};

export interface AssetBuild {
  topology: AssetTopologyMode;
  quality: AssetQualityTier;
  resolution: AssetResolution;
  restPose: AssetRestPose;
  polyBudget: AssetPolyBudget;
  texture: boolean;
  split: boolean;
  multiView: boolean;
  enhance: boolean;
  printable: boolean;
}

export const ASSET_BUILD_DEFAULTS: AssetBuild = {
  topology: "smart",
  quality: "standard",
  resolution: "standard",
  restPose: "a-pose",
  polyBudget: "8k",
  texture: true,
  split: false,
  multiView: false,
  enhance: true,
  printable: false,
};

const TOPOLOGY_ALIASES: Record<string, AssetTopologyMode> = {
  "high-detail": "high-detail",
  highdetail: "high-detail",
  detail: "high-detail",
  dense: "high-detail",
  smart: "smart",
  "smart-topology": "smart",
  retopo: "smart",
};

const QUALITY_ALIASES: Record<string, AssetQualityTier> = {
  standard: "standard",
  preview: "standard",
  flagship: "flagship",
  precise: "flagship",
  precision: "flagship",
  highest: "flagship",
};

const RESOLUTION_ALIASES: Record<string, AssetResolution> = {
  standard: "standard",
  "1x": "standard",
  "1k": "standard",
  "2x": "2x",
  "ultra-2x": "2x",
  ultra2x: "2x",
  "2k": "2x",
  "4x": "4x",
  "ultra-4x": "4x",
  ultra4x: "4x",
  "4k": "4x",
};

const REST_POSE_ALIASES: Record<string, AssetRestPose> = {
  "a-pose": "a-pose",
  apose: "a-pose",
  a: "a-pose",
  "t-pose": "t-pose",
  tpose: "t-pose",
  t: "t-pose",
  custom: "custom",
};

const POLY_BUDGET_ALIASES: Record<string, AssetPolyBudget> = {
  "2k": "2k",
  "2000": "2k",
  low: "2k",
  "8k": "8k",
  "8000": "8k",
  mid: "8k",
  "20k": "20k",
  "20000": "20k",
  high: "20k",
};

function pickAlias<T extends string>(value: unknown, aliases: Record<string, T>): T | undefined {
  if (typeof value !== "string") return undefined;
  return aliases[value.trim().toLowerCase().replaceAll(" ", "-")];
}

function pickBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value !== "string") return undefined;
  const raw = value.trim().toLowerCase();
  if (raw === "true" || raw === "on" || raw === "yes" || raw === "1") return true;
  if (raw === "false" || raw === "off" || raw === "no" || raw === "0") return false;
  return undefined;
}

export function parseAssetBuild(value: unknown): AssetBuild | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const next: AssetBuild = { ...ASSET_BUILD_DEFAULTS };
  let touched = false;
  const topology = pickAlias(row.topology, TOPOLOGY_ALIASES);
  if (topology) {
    next.topology = topology;
    touched = true;
  }
  const quality = pickAlias(row.quality, QUALITY_ALIASES);
  if (quality) {
    next.quality = quality;
    touched = true;
  }
  const resolution = pickAlias(row.resolution, RESOLUTION_ALIASES);
  if (resolution) {
    next.resolution = resolution;
    touched = true;
  }
  const restPose = pickAlias(row.restPose ?? row.pose ?? row.rest_pose, REST_POSE_ALIASES);
  if (restPose) {
    next.restPose = restPose;
    touched = true;
  }
  const polyBudget = pickAlias(
    row.polyBudget ?? row.poly_budget ?? row.faces ?? row.budget,
    POLY_BUDGET_ALIASES,
  );
  if (polyBudget) {
    next.polyBudget = polyBudget;
    touched = true;
  }
  const texture = pickBool(row.texture);
  if (texture != null) {
    next.texture = texture;
    touched = true;
  }
  const split = pickBool(row.split);
  if (split != null) {
    next.split = split;
    touched = true;
  }
  const multiView = pickBool(row.multiView ?? row.multiview ?? row.multi_view);
  if (multiView != null) {
    next.multiView = multiView;
    touched = true;
  }
  const enhance = pickBool(row.enhance ?? row.imageEnhancement ?? row.enhancement);
  if (enhance != null) {
    next.enhance = enhance;
    touched = true;
  }
  const printable = pickBool(row.printable ?? row.printability);
  if (printable != null) {
    next.printable = printable;
    touched = true;
  }
  return touched ? next : undefined;
}

export function resolveAssetBuild(value?: AssetBuild | null): AssetBuild {
  return parseAssetBuild(value) ?? { ...ASSET_BUILD_DEFAULTS };
}

export function assetBuildEquals(a: AssetBuild, b: AssetBuild): boolean {
  return (
    a.topology === b.topology &&
    a.quality === b.quality &&
    a.resolution === b.resolution &&
    a.restPose === b.restPose &&
    a.polyBudget === b.polyBudget &&
    a.texture === b.texture &&
    a.split === b.split &&
    a.multiView === b.multiView &&
    a.enhance === b.enhance &&
    a.printable === b.printable
  );
}

export function formatAssetTopologyLabel(mode: AssetTopologyMode): string {
  return mode === "high-detail" ? "High detail" : "Smart topology";
}

export function formatAssetQualityLabel(tier: AssetQualityTier): string {
  return tier === "flagship" ? "Flagship" : "Standard";
}

export function formatAssetResolutionLabel(resolution: AssetResolution): string {
  if (resolution === "4x") return "Ultra 4x";
  if (resolution === "2x") return "Ultra 2x";
  return "Standard";
}

export function formatAssetRestPoseLabel(pose: AssetRestPose): string {
  if (pose === "t-pose") return "T-Pose";
  if (pose === "custom") return "Custom";
  return "A-Pose";
}

export function formatAssetRestPosePrompt(pose: AssetRestPose): string {
  const rest =
    pose === "t-pose"
      ? "T-Pose (arms out)"
      : pose === "custom"
        ? "Custom (honor pose CSS vars as the bind pose)"
        : "A-Pose (arms slightly down)";
  return (
    `Rest pose is ${rest}. ` +
    "On a character, honor --head --arms --legs --twist around that bind pose. " +
    "On a prop, keep it upright in its natural rest orientation and do not invent a skeleton."
  );
}

export function formatAssetPolyBudgetLabel(budget: AssetPolyBudget): string {
  return `${budget} faces`;
}

export function assetPolyBudgetFaces(budget: AssetPolyBudget): number {
  return ASSET_POLY_BUDGET_FACES[budget];
}

export function assetFaceCount(
  stats?: { faces?: number; tris?: number } | null,
): number | undefined {
  if (stats?.faces != null) return stats.faces;
  if (stats?.tris != null) return stats.tris;
  return undefined;
}

export function assetFacesOverBudget(
  stats: { faces?: number; tris?: number } | null | undefined,
  budget: AssetPolyBudget,
): boolean {
  const faces = assetFaceCount(stats);
  return faces != null && faces > assetPolyBudgetFaces(budget);
}

export function resolveAppliedAssetBuild(
  session?: {
    assetBuild?: AssetBuild | null;
    assetAppliedBuild?: AssetBuild | null;
  } | null,
): AssetBuild {
  return resolveAssetBuild(session?.assetAppliedBuild ?? session?.assetBuild);
}

export function formatAssetBuildLabel(build: AssetBuild): string {
  const parts = [formatAssetTopologyLabel(build.topology), formatAssetQualityLabel(build.quality)];
  if (build.resolution !== "standard") parts.push(formatAssetResolutionLabel(build.resolution));
  return parts.join(" · ");
}

function onOff(on: boolean): string {
  return on ? "on" : "off";
}

export function formatAssetBuildLines(build: AssetBuild): string[] {
  return [
    `Topology: ${formatAssetTopologyLabel(build.topology)}`,
    `Quality: ${formatAssetQualityLabel(build.quality)}`,
    `Resolution: ${formatAssetResolutionLabel(build.resolution)}`,
    `Rest pose: ${formatAssetRestPoseLabel(build.restPose)}`,
    `Poly budget: ${formatAssetPolyBudgetLabel(build.polyBudget)}`,
    `Texture: ${onOff(build.texture)}`,
    `Split: ${onOff(build.split)}`,
    `Multi-view: ${onOff(build.multiView)}`,
    `Image enhancement: ${onOff(build.enhance)}`,
    `Printability: ${onOff(build.printable)}`,
  ];
}

export function formatAssetBuildBrief(build: AssetBuild): string {
  return ["## Build", "", ...formatAssetBuildLines(build).map((line) => `- ${line}`), ""].join(
    "\n",
  );
}

export function formatAssetBuildPrompt(build: AssetBuild): string {
  const texture = build.texture
    ? "Map albedo (and simple PBR when 3D) from the source photo."
    : "Skip textures — ship an untextured clay/grey hull.";
  const split = build.split
    ? "Separate logical parts (crown, wings, props) as sibling meshes that still orbit together."
    : "Keep a single connected subject unless the brief names detachable parts.";
  const views = build.multiView
    ? "Treat every attached photo as another view of the same subject (front/side/back). Do not invent a second character."
    : "Use the first attached photo as the canonical view. If ./source-side.png or ./source-back.png exist, still use them for thickness and back albedo of the same subject.";
  const enhance = build.enhance
    ? "Image enhancement is on: before reconstruct, pull contrast, flood-fill the backdrop from the corners, close holes in the cutout, and reconstruct the subject on a transparent silhouette. Prefer ./vendor/reconstruct.js enhanceRgba/cutoutRgba; honor ./source-mask.png when present. Do not reconstruct the backdrop."
    : "Use the source photo as-is — skip extra contrast or backdrop punch-out.";
  const print = build.printable
    ? "3D-print ready: watertight manifold, no holes, no intersecting faces, grounded on a flat base, thickness that can print."
    : "Real-time / game mesh is fine — intersecting internals and open backs are allowed.";
  const topology =
    build.topology === "high-detail"
      ? "High detail: preserve wrinkles, feathers, and silhouette nicks. Denser hull is OK."
      : "Smart topology: clean game-ready faces, even edge flow, fewer intersecting tris.";
  const quality =
    build.quality === "flagship"
      ? "Flagship precision: highest silhouette fidelity, more contour samples, tighter photo match."
      : "Standard quality: readable first draft that still matches the photo silhouette — not a cube or billboard. Then iterate.";
  const resolution =
    build.resolution === "4x"
      ? "Ultra 4x texture maps (roughly 4k albedo)."
      : build.resolution === "2x"
        ? "Ultra 2x texture maps (roughly 2k albedo)."
        : "Standard texture maps (roughly 1k albedo).";
  const poly =
    `Target about ${assetPolyBudgetFaces(build.polyBudget).toLocaleString()} faces (${build.polyBudget}). ` +
    "Show the live count in window.__locusAsset.stats.faces.";
  const pose = formatAssetRestPosePrompt(build.restPose);
  return [
    "Operator build settings for this Assets studio. Honor them on every generation and iterate pass.",
    `- ${topology}`,
    `- ${quality}`,
    `- ${resolution}`,
    `- ${poly}`,
    `- ${pose}`,
    `- ${texture}`,
    `- ${split}`,
    `- ${views}`,
    `- ${enhance}`,
    `- ${print}`,
    `- Photo contour budget: about ${assetPhotoContourCount(build)} outline samples.`,
    ASSET_PHOTO_RECONSTRUCT_PROMPT,
    "Expose window.__locusAsset.stats with mode, topology (triangle|quad), verts, tris/faces, printable (boolean), units (m|mm), scale, holes, nonManifold, and openEdges.",
    "Honor camera (front/side/top/reset), grid, material (studio/clay/albedo), lights (default/key/rim) on window.__locusAsset.",
    "Ship exportGlb, exportPng, exportStl, and exportTextures.",
    "Use ./source.png as the front photo, ./source-side.png and ./source-back.png as extra views when they exist.",
  ].join("\n");
}

export function applyAssetBuildPrompt(build: AssetBuild): string {
  return [
    "Apply these operator build settings to the live studio. Patch /workspace/index.html in place. Do not change the subject.",
    formatAssetBuildPrompt(build),
    "Read ASSET.md first. Keep orbit, pose CSS vars, and window.__locusAsset including exportGlb / exportPng / exportStl / exportTextures / stats.",
  ].join("\n");
}

export function upsertAssetBuildSection(brief: string, build: AssetBuild): string {
  const block = formatAssetBuildBrief(build);
  const source = brief.replace(/^\uFEFF/, "");
  const range = markdownSectionRange(source, "Build");
  if (range) {
    const suffix = source.slice(range.end);
    return `${source.slice(0, range.start)}${block}${suffix && !suffix.startsWith("\n") ? "\n" : ""}${suffix}`;
  }
  if (/^## Export\s*$/m.test(source)) {
    return source.replace(/^## Export\s*$/m, `${block}\n## Export`);
  }
  if (/^## Style\s*$/m.test(source)) {
    return source.replace(/^## Style\s*$/m, `${block}\n## Style`);
  }
  const trimmed = source.trimEnd();
  return trimmed ? `${trimmed}\n\n${block}` : block;
}

function markdownSectionRange(
  text: string,
  heading: string,
): { start: number; bodyStart: number; end: number } | undefined {
  const startRe = new RegExp(`^## ${heading}\\s*$`, "im");
  const start = startRe.exec(text);
  if (!start || start.index === undefined) return undefined;
  const bodyStart = start.index + start[0].length;
  const after = text.slice(bodyStart);
  const next = after.search(/^## /m);
  return {
    start: start.index,
    bodyStart,
    end: next < 0 ? text.length : bodyStart + next,
  };
}
