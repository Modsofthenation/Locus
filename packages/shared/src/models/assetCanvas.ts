import { parsePlaywrightSteps } from "./playwrightCanvas.js";
import type { DesignTune } from "./designTune.js";
import { formatAssetBuildBrief, resolveAssetBuild, type AssetBuild } from "./assetBuild.js";
import { withAssetStylePrompt, type AssetStyleLook } from "./assetStyle.js";
import {
  canvasHtmlUnchanged,
  looksLikeStudioChangeRequest,
  stripHostStudioChrome,
} from "./gameCanvas.js";
import { looksHostFallbackCanvas } from "./hostFallback.js";

/** Canvas-relative albedo for the first attached photo. */
export const ASSET_SOURCE_FILE = "source.png";
export const ASSET_SIDE_SOURCE_FILE = "source-side.png";
export const ASSET_BACK_SOURCE_FILE = "source-back.png";

export const ASSET_POSE_KEYS = ["head", "arms", "legs", "twist"] as const;
export type AssetPoseKey = (typeof ASSET_POSE_KEYS)[number];

export const ASSET_POSE_DEFAULTS: Record<
  AssetPoseKey,
  { min: number; max: number; value: number }
> = {
  head: { min: -45, max: 45, value: 0 },
  arms: { min: -80, max: 80, value: 0 },
  legs: { min: -60, max: 60, value: 0 },
  twist: { min: -45, max: 45, value: 0 },
};

export const ASSET_ZOOM_MIN = 0.25;
export const ASSET_ZOOM_MAX = 4;
export const ASSET_ZOOM_DEFAULT = 1;
export const ASSET_ZOOM_IN = 1.08;
export const ASSET_ZOOM_OUT = 0.92;
/** Mesh/rig/sprite targets. The WebGL/stage backdrop stays 1× and fills the iframe. */
export const ASSET_ZOOM_TARGET_SELECTOR = "[data-locus-asset-model], #rig, #model";
/** Renderer / stage nodes that must fill the iframe and never shrink with zoom. */
export const ASSET_STAGE_FILL_SELECTOR =
  "canvas, #stage, #view, #viewport, [data-locus-asset-stage]";
const ASSET_STAGE_FILL_CSS =
  "html,body{margin:0!important;width:100%!important;height:100%!important;min-height:100%!important;overflow:hidden!important}" +
  "canvas,#stage,#view,#viewport,[data-locus-asset-stage]{position:fixed!important;inset:0!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;scale:1!important;zoom:1!important;z-index:0}";

export function clampAssetZoom(value: number): number {
  if (!Number.isFinite(value)) return ASSET_ZOOM_DEFAULT;
  return Math.min(ASSET_ZOOM_MAX, Math.max(ASSET_ZOOM_MIN, value));
}

export function stepAssetZoom(current: number, direction: "in" | "out"): number {
  return clampAssetZoom(current * (direction === "in" ? ASSET_ZOOM_IN : ASSET_ZOOM_OUT));
}

export function formatAssetZoom(zoom: number): string {
  return `${Math.round(clampAssetZoom(zoom) * 100)}%`;
}

export const ASSET_EXPORT_FORMATS = ["png", "glb", "stl", "textures"] as const;
export type AssetExportFormat = (typeof ASSET_EXPORT_FORMATS)[number];

export const ASSET_EXPORT_PHASES = ["save", "start", "prepare", "build", "done", "error"] as const;
export type AssetExportPhase = (typeof ASSET_EXPORT_PHASES)[number];

export const ASSET_EXPORT_LABELS: Record<AssetExportFormat, string> = {
  png: "PNG",
  glb: "GLB",
  stl: "STL",
  textures: "textures",
};

export const ASSET_EXPORT_EXTENSIONS: Record<AssetExportFormat, string> = {
  png: "png",
  glb: "glb",
  stl: "stl",
  textures: "zip",
};

export const ASSET_EXPORT_MIME: Record<AssetExportFormat, string> = {
  png: "image/png",
  glb: "model/gltf-binary",
  stl: "model/stl",
  textures: "application/zip",
};

/** Keep the success modal visible briefly so the bar can reach 100%. */
export const ASSET_EXPORT_DONE_MS = 800;
/** Studio exporters are agent-defined and may hang on a thenable. */
export const ASSET_EXPORT_TIMEOUT_MS = 30_000;

export const ASSET_EXPORT_MISSING_FILE = "Export finished but no file was produced.";

export type AssetExportJob = {
  format: AssetExportFormat;
  phase: AssetExportPhase;
  percent: number;
  error?: string;
  filename?: string;
  folder?: string;
};

export type AssetExportProgress = AssetExportJob & {
  type: "locus-asset-export-progress";
};

export type AssetExportFile = {
  type: "locus-asset-export-file";
  format: AssetExportFormat;
  filename: string;
  mime?: string;
  base64: string;
};

export function isAssetExportFormat(value: unknown): value is AssetExportFormat {
  return typeof value === "string" && (ASSET_EXPORT_FORMATS as readonly string[]).includes(value);
}

export function isAssetExportPhase(value: unknown): value is AssetExportPhase {
  return typeof value === "string" && (ASSET_EXPORT_PHASES as readonly string[]).includes(value);
}

export function formatAssetExportTitle(format: AssetExportFormat): string {
  return `Export ${ASSET_EXPORT_LABELS[format]}`;
}

export function assetExportStem(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "asset"
  );
}

export function assetExportFileName(title: string, format: AssetExportFormat): string {
  return `${assetExportStem(title)}.${ASSET_EXPORT_EXTENSIONS[format]}`;
}

export function withAssetExportExtension(name: string, format: AssetExportFormat): string {
  const ext = ASSET_EXPORT_EXTENSIONS[format];
  const base = name.trim().split(/[/\\]/).pop()?.trim() || assetExportStem("asset");
  const withoutKnown = base.replace(new RegExp(`\\.${ext}$`, "i"), "");
  const stem = withoutKnown.replace(/\.[^.]+$/, "").trim() || withoutKnown.trim() || "asset";
  return `${stem}.${ext}`;
}

export function assetExportPhaseCopy(
  job: Pick<AssetExportJob, "format" | "phase" | "error">,
): string {
  const label = ASSET_EXPORT_LABELS[job.format];
  if (job.phase === "save") return "Choose a file name and folder.";
  if (job.phase === "error") return job.error?.trim() || `Could not export ${label}`;
  if (job.phase === "done") return `${label} export ready`;
  if (job.phase === "build") return `Building ${label}…`;
  return `Preparing ${label}…`;
}

export function assetExportMissingMessage(format: AssetExportFormat): string {
  return `This studio has no ${ASSET_EXPORT_LABELS[format]} exporter yet.`;
}

export function parseAssetExportProgress(data: unknown): AssetExportProgress | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (row.type !== "locus-asset-export-progress") return null;
  if (!isAssetExportFormat(row.format)) return null;
  const phase: AssetExportPhase =
    isAssetExportPhase(row.phase) && row.phase !== "save" ? row.phase : "start";
  const raw = Number(row.percent);
  const percent = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
  const error = typeof row.error === "string" && row.error.trim() ? row.error.trim() : undefined;
  const filename =
    typeof row.filename === "string" && row.filename.trim() ? row.filename.trim() : undefined;
  return {
    type: "locus-asset-export-progress",
    format: row.format,
    phase,
    percent,
    ...(error ? { error } : {}),
    ...(filename ? { filename } : {}),
  };
}

export function parseAssetExportFile(data: unknown): AssetExportFile | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (row.type !== "locus-asset-export-file") return null;
  if (!isAssetExportFormat(row.format)) return null;
  const base64 = typeof row.base64 === "string" ? row.base64.replace(/\s/g, "") : "";
  if (!base64) return null;
  const filename =
    typeof row.filename === "string" && row.filename.trim()
      ? row.filename.trim()
      : assetExportFileName("asset", row.format);
  const mime = typeof row.mime === "string" && row.mime.trim() ? row.mime.trim() : undefined;
  return {
    type: "locus-asset-export-file",
    format: row.format,
    filename,
    base64,
    ...(mime ? { mime } : {}),
  };
}

export type AssetExportBytes = {
  type: "locus-asset-export-bytes";
  format: AssetExportFormat;
  mime: string;
  filename: string;
  contentBase64: string;
};

export function parseAssetExportBytes(data: unknown): AssetExportBytes | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (row.type !== "locus-asset-export-bytes") return null;
  if (!isAssetExportFormat(row.format)) return null;
  const contentBase64 =
    typeof row.contentBase64 === "string" ? row.contentBase64.replace(/\s/g, "") : "";
  if (!contentBase64) return null;
  const mime =
    typeof row.mime === "string" && row.mime.trim()
      ? row.mime.trim()
      : row.format === "glb"
        ? "model/gltf-binary"
        : row.format === "stl"
          ? "model/stl"
          : row.format === "textures"
            ? "application/zip"
            : "image/png";
  const filename =
    typeof row.filename === "string" && row.filename.trim()
      ? row.filename.trim()
      : `asset.${row.format === "textures" ? "zip" : row.format}`;
  return { type: "locus-asset-export-bytes", format: row.format, mime, filename, contentBase64 };
}

export interface AssetKit {
  id: string;
  title: string;
  blurb: string;
  files: Record<string, string>;
}

export const ASSET_KITS: AssetKit[] = [
  {
    id: "sprite-pack",
    title: "Sprite pack",
    blurb: "2D cutouts, tiles, and a sprite-sheet grid.",
    files: {
      "ASSET.md": `# Sprite pack

Draw on a pixel grid. Keep the palette to the :root colors. Export PNG frames under /workspace/vendor/sprites.
For photo cutouts, import cutoutRgba / reconstructFromPhoto from ./vendor/reconstruct.js — punch out the backdrop and keep the subject only.
`,
      "vendor/tokens.css": `:root {
  --tile: 16px;
  --head: 0;
  --arms: 0;
  --legs: 0;
  --twist: 0;
}
`,
    },
  },
  {
    id: "three-mesh",
    title: "Three.js mesh",
    blurb: "Vendored ES-module stub for image-to-3D and orbit.",
    files: {
      "ASSET.md": `# Three.js mesh

Vendor Three as an ES module under /workspace/vendor/three.module.js (or npm in a later Promote).
Relative photos and ./vendor/reconstruct.js already serve over canvas-files HTTP — do not call preview.
Punch out ./source.png with reconstructFromPhoto, extrude a silhouette hull, and map albedo only onto the subject. Not a photo billboard.
`,
      "vendor/README.md": [
        "Put three.module.js (and addons) here. index.html should:",
        "",
        "```html",
        '<script type="module">',
        '  import * as THREE from "./vendor/three.module.js";',
        "</script>",
        "```",
        "",
        "Import reconstructFromPhoto from ./vendor/reconstruct.js for photo hulls.",
        "",
      ].join("\n"),
    },
  },
  {
    id: "rig-kit",
    title: "Rig kit",
    blurb: "Humanoid / quadruped bones, pose CSS vars, and clip names.",
    files: {
      "ASSET.md": `# Rig kit

Expose window.__locusAsset = { mode, wireframe, orbit, zoom, camera, grid, material, lights, units, pose, play, pause, exportGlb, exportPng, exportStl, exportTextures, stats }.
zoom() scales the mesh/rig only (honor --zoom), never the page, HUD, canvas, or backdrop. The renderer fills the iframe at every zoom.
Honor --head --arms --legs --twist. Add a grasp/hold socket (hand or mouth) for pickup and carry.
Clips: idle, walk, jump, pickup, carry, attack; plus attack-heavy and attack-ranged when the character fights.
`,
      "vendor/rig.js": `export const CLIPS = ["idle", "walk", "jump", "pickup", "carry", "attack", "attack-heavy", "attack-ranged"];
export function poseFromCss() {
  const s = getComputedStyle(document.documentElement);
  return {
    head: Number(s.getPropertyValue("--head")) || 0,
    arms: Number(s.getPropertyValue("--arms")) || 0,
    legs: Number(s.getPropertyValue("--legs")) || 0,
    twist: Number(s.getPropertyValue("--twist")) || 0,
  };
}
`,
    },
  },
];

export function resolveAssetKit(id: string | undefined): AssetKit | undefined {
  const raw = id?.trim();
  if (!raw) return undefined;
  return ASSET_KITS.find((row) => row.id === raw);
}

export function poseFromTune(tune?: DesignTune): Record<AssetPoseKey, number> {
  return {
    head: tune?.head ?? ASSET_POSE_DEFAULTS.head.value,
    arms: tune?.arms ?? ASSET_POSE_DEFAULTS.arms.value,
    legs: tune?.legs ?? ASSET_POSE_DEFAULTS.legs.value,
    twist: tune?.twist ?? ASSET_POSE_DEFAULTS.twist.value,
  };
}

export function tuneFromPose(pose: Record<AssetPoseKey, number>, extra?: DesignTune): DesignTune {
  return {
    ...extra,
    head: pose.head,
    arms: pose.arms,
    legs: pose.legs,
    twist: pose.twist,
  };
}

export const ASSET_POSE_PRESETS = {
  idle: { head: 0, arms: 0, legs: 0, twist: 0 },
  walk: { head: 6, arms: 28, legs: 18, twist: 8 },
  jump: { head: -8, arms: -42, legs: -22, twist: 0 },
  pickup: { head: 18, arms: 48, legs: 32, twist: 6 },
  carry: { head: 4, arms: -22, legs: 8, twist: 0 },
  attack: { head: 10, arms: 52, legs: 12, twist: 18 },
  "attack-heavy": { head: 14, arms: 72, legs: 22, twist: 28 },
  "attack-ranged": { head: 4, arms: -36, legs: 8, twist: -12 },
} as const;
export type AssetPosePreset = keyof typeof ASSET_POSE_PRESETS;

export const ASSET_CLIPS = [
  "idle",
  "walk",
  "jump",
  "pickup",
  "carry",
  "attack",
  "attack-heavy",
  "attack-ranged",
] as const;
export type AssetClip = (typeof ASSET_CLIPS)[number];

/** Core locomotion / interact clips every character rig should ship. */
export const ASSET_CORE_CLIPS = ["idle", "walk", "jump", "pickup", "carry", "attack"] as const;

/** Extra combat swings — only when the subject fights. */
export const ASSET_ATTACK_VARIANT_CLIPS = ["attack-heavy", "attack-ranged"] as const;

export function formatAssetClipLabel(clip: string): string {
  return clip.replaceAll("-", " ");
}

export const ASSET_CLIP_LINE =
  "Clips: idle, walk, jump, pickup, carry, attack; plus attack-heavy and attack-ranged when the character fights.";

export interface AssetPoseRange {
  key: AssetPoseKey;
  min: number;
  max: number;
}

/** Read `data-tune="head:-45-45,arms:-80-80"` from the studio canvas. */
export function parseCanvasPoseAttrs(html: string): AssetPoseRange[] {
  const match = html.match(/\bdata-tune\s*=\s*["']([^"']+)["']/i);
  const found = new Map<AssetPoseKey, AssetPoseRange>();
  if (match?.[1]) {
    for (const part of match[1].split(",")) {
      const item = part.trim().match(/^([a-z-]+)\s*:\s*(-?\d+)\s*-\s*(-?\d+)$/i);
      if (!item) continue;
      const key = item[1]!.toLowerCase();
      if (!ASSET_POSE_KEYS.includes(key as AssetPoseKey)) continue;
      const min = Number(item[2]);
      const max = Number(item[3]);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) continue;
      const bounds = ASSET_POSE_DEFAULTS[key as AssetPoseKey];
      found.set(key as AssetPoseKey, {
        key: key as AssetPoseKey,
        min: Math.max(bounds.min, Math.round(min)),
        max: Math.min(bounds.max, Math.round(max)),
      });
    }
  }
  return ASSET_POSE_KEYS.map(
    (key) =>
      found.get(key) ?? {
        key,
        min: ASSET_POSE_DEFAULTS[key].min,
        max: ASSET_POSE_DEFAULTS[key].max,
      },
  );
}

export const ASSET_BRIEF_PATH = "ASSET.md";

export function livingAssetBrief(input: {
  title?: string;
  mode?: "2d" | "3d";
  source?: string;
  notes?: string[];
  style?: { name: string; summary?: string; guidelines?: string };
  build?: AssetBuild | null;
}): string {
  const parts = [
    `# ${input.title?.trim() || "Asset brief"}`,
    "",
    "## Mode",
    "",
    input.mode === "2d"
      ? "2D sprites, tiles, or a cutout sheet."
      : "3D mesh with orbit, texture, and optional rig.",
    "",
    "## Source",
    "",
    input.source?.trim() ||
      "Use ./source.png as the front view, ./source-side.png and ./source-back.png when present, or attached photos in /workspace/.locus-attachments. Punch out the backdrop; map albedo onto the subject only (./vendor/reconstruct.js). Otherwise invent from the prompt.",
    "",
    "## Rig",
    "",
    `Humanoid or quadruped. Honor --head --arms --legs --twist. Grasp/hold socket for pickup and carry. ${ASSET_CLIP_LINE}`,
  ];
  if (input.style?.name.trim()) {
    parts.push("", "## Style", "", `Saved style: ${input.style.name.trim()}.`);
    if (input.style.summary?.trim()) parts.push(input.style.summary.trim());
    if (input.style.guidelines?.trim()) parts.push("", input.style.guidelines.trim());
  }
  parts.push("", formatAssetBuildBrief(resolveAssetBuild(input.build)).trimEnd());
  parts.push(
    "",
    "## Export",
    "",
    "PNG / sprite sheet for 2D. GLB / STL / texture-set via window.__locusAsset.exportGlb, exportStl, exportTextures for 3D. No CDNs.",
  );
  if (input.notes?.length) {
    parts.push("", "## Notes", "");
    for (const note of input.notes) parts.push(`- ${note}`);
  }
  parts.push("");
  return parts.join("\n");
}

export function exploreAssetDirectionsPrompt(
  hasCanvas: boolean,
  style?: AssetStyleLook | null,
): string {
  const goal = hasCanvas
    ? "Explore three distinct asset directions of the current studio."
    : "Explore three distinct asset directions for this brief.";
  return withAssetStylePrompt(
    [
      goal,
      "Write three complete, self-contained HTML studios:",
      "- /workspace/.locus-variants/direction-1.html",
      "- /workspace/.locus-variants/direction-2.html",
      "- /workspace/.locus-variants/direction-3.html",
      "Each direction should change topology, texture, or rig — not just the palette. Keep orbit, pose CSS vars, and window.__locusAsset. Use file_write for each complete HTML document. Do not write /workspace/index.html until all three files exist. Then copy the strongest to /workspace/index.html.",
    ].join("\n"),
    style,
  );
}

export const ASSET_ITERATE_CHIPS = [
  { id: "retopo", title: "Retopo", blurb: "Cleaner hull, fewer intersecting faces." },
  { id: "texture", title: "Texture", blurb: "Map the source image as albedo; add simple PBR." },
  { id: "rig", title: "Rig", blurb: "Auto-rig humanoid or quadruped bones and pose sliders." },
  {
    id: "animate",
    title: "Animate",
    blurb: "Idle, walk, jump, pickup, carry, and attack clips — extra attacks when it fights.",
  },
  { id: "low-poly", title: "Low poly", blurb: "Drop poly count for real-time / game use." },
  { id: "split", title: "Split", blurb: "Separate logical parts as sibling meshes." },
  {
    id: "print",
    title: "Printability",
    blurb: "Watertight manifold with a flat printable base.",
  },
] as const;
export type AssetIterateChipId = (typeof ASSET_ITERATE_CHIPS)[number]["id"];

export const ASSET_ITERATE_UNCHANGED_NEEDS_HUMAN =
  "3D asset canvas was not changed for this request. Needs a human.";

/** Retopo/Texture/Rig chips and ASSET.md apply asks that never patched. */
export function looksLikeAssetIterateRequest(text?: string | null): boolean {
  const prompt = text?.trim() ?? "";
  if (!prompt) return false;
  if (/^Apply this ASSET\.md brief/m.test(prompt)) return true;
  return ASSET_ITERATE_CHIPS.some((chip) => prompt.includes(`${chip.title} pass.`));
}

/** A change request that left the studio identical to turn start cannot ship. Empty canvases skip. */
export function assetIterateUnchangedNeedsHuman(input: {
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
  return ASSET_ITERATE_UNCHANGED_NEEDS_HUMAN;
}

export function iterateAssetPrompt(
  id: AssetIterateChipId,
  ctx: { pose: Record<AssetPoseKey, number>; title?: string; style?: AssetStyleLook | null },
): string {
  const chip = ASSET_ITERATE_CHIPS.find((row) => row.id === id);
  const jobs: Record<AssetIterateChipId, string> = {
    retopo: "Clean the current mesh or sprite silhouette. Do not change the subject.",
    texture:
      "Texture pass only: map attached photos or the current albedo onto the mesh/sprites. Add simple roughness/metallic if 3D.",
    rig: "Add or fix a humanoid or quadruped rig with a grasp/hold socket (hand or mouth) for pickup and carry. Honor --head --arms --legs --twist and window.__locusAsset.pose / play.",
    animate:
      "Add idle, walk, jump, pickup, carry, and attack clips. Pickup is a one-shot reach-and-grab; carry is a looping hold or carried gait. When the character fights, also add attack-heavy and attack-ranged — skip extras on props, vehicles, or non-combat subjects. Play them via window.__locusAsset.play(clip).",
    "low-poly": "Reduce poly count or sprite complexity. Keep the silhouette readable.",
    split:
      "Split the current mesh into logical parts (body vs props, wings, crown) as sibling meshes that still orbit together. Do not change the subject.",
    print:
      "Printability pass: make the mesh watertight, manifold, no holes or intersecting faces, grounded on a flat base with printable thickness. Show printable in window.__locusAsset.stats.",
  };
  return withAssetStylePrompt(
    [
      `${chip?.title ?? id} pass. ${jobs[id]}`,
      `Honor pose CSS vars (head ${ctx.pose.head}, arms ${ctx.pose.arms}, legs ${ctx.pose.legs}, twist ${ctx.pose.twist}).`,
      "Read ASSET.md first. Keep window.__locusAsset including exportGlb / exportPng / exportStl / exportTextures / stats / speed / scrub / isolate / background.",
      "Patch /workspace/index.html with apply_patch. Do not start a new subject. Queue later iterate chips; do not wipe the studio.",
    ].join("\n"),
    ctx.style,
  );
}

export function applyAssetBriefPrompt(brief: string): string {
  return [
    "Apply this ASSET.md brief to the live studio. Patch /workspace/index.html to match the mode, source image, and rig. Keep orbit and pose working.",
    "",
    brief.trim() || livingAssetBrief({}),
  ].join("\n");
}

export function keepPosePrompt(pose: Record<AssetPoseKey, number>): string {
  return [
    "Keep these operator pose knobs as source of truth. Write them into ASSET.md and honor the CSS vars on the next edit. Do not reset them.",
    `head=${pose.head} arms=${pose.arms} legs=${pose.legs} twist=${pose.twist}`,
  ].join("\n");
}

export function withAssetPoseCss(html: string, tune?: DesignTune): string {
  const pose = poseFromTune(tune);
  const css = [
    ":root {",
    `  --head: ${pose.head};`,
    `  --arms: ${pose.arms};`,
    `  --legs: ${pose.legs};`,
    `  --twist: ${pose.twist};`,
    "}",
  ].join("\n");
  const tag = `<style data-locus-asset-pose>${css}</style>`;
  if (html.includes("data-locus-asset-pose")) {
    return html.replace(/<style data-locus-asset-pose>[\s\S]*?<\/style>/i, tag);
  }
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${tag}</head>`);
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, (open) => `${open}${tag}`);
  return `${tag}${html}`;
}

const ASSET_CHROME_HOOK = `<script data-locus-asset-chrome>
(function(){
  function api(){ return window.__locusAsset || {}; }
  function setVar(name, val){ document.documentElement.style.setProperty(name, String(val)); }
  var zoom = ${ASSET_ZOOM_DEFAULT};
  function clampZoom(z){
    z = Number(z);
    if (!isFinite(z)) return ${ASSET_ZOOM_DEFAULT};
    if (z < ${ASSET_ZOOM_MIN}) return ${ASSET_ZOOM_MIN};
    if (z > ${ASSET_ZOOM_MAX}) return ${ASSET_ZOOM_MAX};
    return z;
  }
  function freezePageZoom(){
    document.documentElement.style.zoom = "1";
    if (document.body) document.body.style.zoom = "1";
  }
  function isChromeNode(el){
    if (!el) return true;
    var id = el.id || "";
    if (id === "hud" || id === "hint" || id === "ui") return true;
    var tag = el.tagName;
    return tag === "SCRIPT" || tag === "STYLE" || tag === "LINK" || tag === "META";
  }
  function isStageNode(el){
    if (!el) return false;
    var id = (el.id || "").toLowerCase();
    var tag = el.tagName;
    if (tag === "CANVAS") return true;
    return id === "stage" || id === "view" || id === "viewport" || id === "webgl";
  }
  function modelEl(){
    var el = document.querySelector(${JSON.stringify(ASSET_ZOOM_TARGET_SELECTOR)});
    return el && !isStageNode(el) ? el : null;
  }
  function scaleModel(z){
    var el = modelEl();
    if (el) { el.style.scale = String(z); return true; }
    var scaled = false;
    var kids = document.body ? document.body.children : [];
    for (var i = 0; i < kids.length; i++) {
      if (isChromeNode(kids[i]) || isStageNode(kids[i])) continue;
      kids[i].style.scale = String(z);
      scaled = true;
    }
    return scaled;
  }
  function pinStage(){
    freezePageZoom();
    if (typeof document.querySelectorAll !== "function") return;
    var nodes = document.querySelectorAll(${JSON.stringify(ASSET_STAGE_FILL_SELECTOR)});
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].style.scale = "1";
      nodes[i].style.zoom = "1";
    }
    try { window.dispatchEvent(new Event("resize")); } catch (e) {}
  }
  function setZoom(z, fromParent){
    z = clampZoom(z);
    if (z !== zoom) {
      zoom = z;
      setVar("--zoom", z);
      freezePageZoom();
      var scaled = scaleModel(z);
      if (!scaled && typeof api().zoom === "function") {
        api().zoom(z);
        freezePageZoom();
      }
      if (!fromParent) {
        try { parent.postMessage({ type: "locus-asset-zoom-changed", scale: z }, "*"); } catch (e) {}
      }
    }
    pinStage();
  }
  function setWire(on){
    document.documentElement.classList.toggle("locus-wireframe", !!on);
    if (typeof api().wireframe === "function") api().wireframe(!!on);
  }
  function setOrbit(on){
    document.documentElement.classList.toggle("locus-orbit", !!on);
    if (typeof api().orbit === "function") api().orbit(!!on);
  }
  function setCamera(view){
    view = view || "reset";
    document.documentElement.setAttribute("data-locus-camera", view);
    if (typeof api().camera === "function") api().camera(view);
  }
  function setGrid(on){
    document.documentElement.classList.toggle("locus-grid", !!on);
    if (typeof api().grid === "function") api().grid(!!on);
  }
  function setMaterial(id){
    id = id || "studio";
    document.documentElement.setAttribute("data-locus-material", id);
    if (typeof api().material === "function") api().material(id);
  }
  function setLights(id){
    id = id || "default";
    document.documentElement.setAttribute("data-locus-lights", id);
    if (typeof api().lights === "function") api().lights(id);
  }
  function setUnits(u){
    u = u || "m";
    document.documentElement.setAttribute("data-locus-units", u);
    setVar("--units", u);
    if (typeof api().units === "function") api().units(u);
  }
  function setBackground(id){
    id = id || "grey";
    document.documentElement.setAttribute("data-locus-bg", id);
    if (document.body) {
      document.body.style.backgroundImage = id === "photo" ? "url('./source.png')" : "";
      document.body.style.backgroundSize = id === "photo" ? "cover" : "";
    }
    if (typeof api().background === "function") api().background(id);
  }
  function isolate(part){
    part = part || "all";
    document.documentElement.setAttribute("data-locus-isolate", part);
    if (typeof api().isolate === "function") api().isolate(part);
  }
  function setSpeed(rate){
    rate = Number(rate);
    if (!isFinite(rate) || rate <= 0) rate = 1;
    setVar("--clip-speed", rate);
    if (typeof api().speed === "function") api().speed(rate);
  }
  function setScrub(t){
    t = Number(t);
    if (!isFinite(t)) t = 0;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    setVar("--clip-t", t);
    if (typeof api().scrub === "function") api().scrub(t);
  }
  function ensureStageCss(){
    if (typeof document === "undefined" || typeof document.createElement !== "function") return;
    if (document.getElementById && document.getElementById("locus-asset-stage-css")) return;
    var s = document.createElement("style");
    s.id = "locus-asset-stage-css";
    s.textContent = "html.locus-grid body::after{content:'';position:fixed;inset:auto 0 0 0;height:42%;background:linear-gradient(to top,rgba(255,255,255,.1),transparent),repeating-linear-gradient(90deg,rgba(255,255,255,.14) 0 1px,transparent 1px 32px),repeating-linear-gradient(0deg,rgba(255,255,255,.14) 0 1px,transparent 1px 32px);pointer-events:none;z-index:1;transform:perspective(420px) rotateX(68deg);transform-origin:bottom center}html[data-locus-material='clay'] [data-locus-asset-model],html[data-locus-material='clay'] #rig,html[data-locus-material='clay'] #model,html[data-locus-material='clay'] canvas{filter:grayscale(1) contrast(.92) brightness(1.04)}html[data-locus-material='studio'] [data-locus-asset-model],html[data-locus-material='studio'] #rig,html[data-locus-material='studio'] #model{filter:contrast(1.05) saturate(1.04)}html[data-locus-lights='key'] body{filter:brightness(1.1)}html[data-locus-lights='rim'] [data-locus-asset-model],html[data-locus-lights='rim'] #rig,html[data-locus-lights='rim'] #model{filter:drop-shadow(-8px 0 10px rgba(180,210,255,.55)) drop-shadow(8px 0 8px rgba(40,20,10,.35))}html[data-locus-camera='front'] [data-locus-asset-model],html[data-locus-camera='front'] #rig{rotate: y 0deg}html[data-locus-camera='side'] [data-locus-asset-model],html[data-locus-camera='side'] #rig{rotate: y 80deg}html[data-locus-camera='top'] [data-locus-asset-model],html[data-locus-camera='top'] #rig{rotate: x -78deg}html[data-locus-bg='grey'] body{background:#8a8a8a}html[data-locus-bg='checkered'] body{background:repeating-conic-gradient(#c8c8c8 0% 25%,#eee 0% 50%) 0 0/24px 24px}html[data-locus-bg='photo'] body{background-color:#1a1a1a;background-position:center;background-repeat:no-repeat}html[data-locus-isolate]:not([data-locus-isolate='all']) [data-locus-part]{opacity:.18}html[data-locus-isolate='body'] [data-locus-part='body']{opacity:1}html[data-locus-isolate='props'] [data-locus-part='props']{opacity:1}#hud,#hint,#ui{display:none!important}" + ${JSON.stringify(ASSET_STAGE_FILL_CSS)};
    var host = document.head || document.documentElement;
    if (host && host.appendChild) host.appendChild(s);
  }
  var EXPORT_LABELS = ${JSON.stringify(ASSET_EXPORT_LABELS)};
  var EXPORT_MIME = ${JSON.stringify(ASSET_EXPORT_MIME)};
  function exportProgress(format, phase, percent, error){
    try {
      parent.postMessage({
        type: "locus-asset-export-progress",
        format: format || "glb",
        phase: phase,
        percent: percent,
        error: error || undefined
      }, "*");
    } catch (e) {}
  }
  function exporterFor(format){
    if (format === "png") return api().exportPng;
    if (format === "stl") return api().exportStl;
    if (format === "textures") return api().exportTextures;
    return api().exportGlb;
  }
  function bytesToBase64(bytes){
    var binary = "";
    var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (var i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
    return btoa(binary);
  }
  function hrefToBase64(href, done, fail){
    if (typeof href === "string" && href.indexOf("data:") === 0) {
      var comma = href.indexOf(",");
      done(comma >= 0 ? href.slice(comma + 1) : href);
      return;
    }
    if (typeof fetch !== "function") { fail(new Error("Could not read export")); return; }
    fetch(href).then(function(res){ return res.arrayBuffer(); }).then(function(buf){
      done(bytesToBase64(new Uint8Array(buf)));
    }, fail);
  }
  function payloadToFile(payload, filename, format, done, fail){
    if (!payload) { done(null); return; }
    if (typeof payload === "object" && typeof payload.base64 === "string" && payload.base64) {
      done({
        filename: payload.filename || filename,
        mime: payload.mime || EXPORT_MIME[format],
        base64: String(payload.base64).replace(/\\s/g, "")
      });
      return;
    }
    if (typeof payload === "string") {
      if (payload.indexOf("data:") === 0) {
        var comma = payload.indexOf(",");
        var header = comma >= 0 ? payload.slice(5, comma) : "";
        var mime = header.split(";")[0] || EXPORT_MIME[format];
        done({ filename: filename, mime: mime, base64: comma >= 0 ? payload.slice(comma + 1) : payload });
        return;
      }
      try {
        done({
          filename: filename,
          mime: EXPORT_MIME[format],
          base64: btoa(unescape(encodeURIComponent(payload)))
        });
      } catch (err) { fail(err); }
      return;
    }
    if (typeof ArrayBuffer !== "undefined" && payload instanceof ArrayBuffer) {
      done({ filename: filename, mime: EXPORT_MIME[format], base64: bytesToBase64(new Uint8Array(payload)) });
      return;
    }
    if (payload && payload.buffer && typeof ArrayBuffer !== "undefined" && payload.buffer instanceof ArrayBuffer) {
      done({ filename: filename, mime: EXPORT_MIME[format], base64: bytesToBase64(payload) });
      return;
    }
    if (payload && typeof payload.arrayBuffer === "function") {
      payload.arrayBuffer().then(function(buf){
        done({
          filename: payload.name || filename,
          mime: payload.type || EXPORT_MIME[format],
          base64: bytesToBase64(new Uint8Array(buf))
        });
      }, fail);
      return;
    }
    if (payload && typeof payload.href === "string") {
      hrefToBase64(payload.href, function(base64){
        done({ filename: payload.download || filename, mime: EXPORT_MIME[format], base64: base64 });
      }, fail);
      return;
    }
    done(null);
  }
  function interceptExportDownloads(captured, filename){
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
      return function(){};
    }
    var origCreate = document.createElement.bind(document);
    var proto = typeof HTMLAnchorElement !== "undefined" ? HTMLAnchorElement.prototype : null;
    var origClick = proto && typeof proto.click === "function" ? proto.click : null;
    function capture(el){
      if (!el) return false;
      var hasDownload = (el.getAttribute && el.getAttribute("download") != null) || el.download;
      if (!hasDownload) return false;
      if (filename) {
        if (el.setAttribute) el.setAttribute("download", filename);
        el.download = filename;
      }
      captured.push({ href: el.href, download: el.download || filename });
      return true;
    }
    document.createElement = function(tag){
      var el = origCreate(tag);
      if (String(tag).toLowerCase() === "a" && el && typeof el.click === "function") {
        var native = el.click.bind(el);
        el.click = function(){
          if (capture(el)) return;
          return native();
        };
      }
      return el;
    };
    if (origClick && proto) {
      proto.click = function(){
        if (capture(this)) return;
        return origClick.call(this);
      };
    }
    return function(){
      document.createElement = origCreate;
      if (origClick && proto) proto.click = origClick;
    };
  }
  function postExportBytes(format, b64, mime, filename){
    if (!b64) return;
    try {
      parent.postMessage({
        type: "locus-asset-export-bytes",
        format: format || "png",
        mime: mime || EXPORT_MIME[format] || "application/octet-stream",
        filename: filename || ("asset." + (format === "textures" ? "zip" : (format || "bin"))),
        contentBase64: String(b64)
      }, "*");
    } catch (e) {}
  }
  function captureExportValue(format, value){
    if (!value) return;
    if (typeof value === "string") {
      if (value.indexOf("data:") === 0) {
        var comma = value.indexOf(",");
        var header = comma >= 0 ? value.slice(5, comma) : "";
        var mime = header.split(";")[0] || EXPORT_MIME[format];
        postExportBytes(format, comma >= 0 ? value.slice(comma + 1) : "", mime);
        return;
      }
      if (value.length > 80) postExportBytes(format, value);
      return;
    }
    if (typeof Blob !== "undefined" && typeof FileReader === "function" && value instanceof Blob) {
      var reader = new FileReader();
      reader.onload = function(){ captureExportValue(format, String(reader.result || "")); };
      reader.readAsDataURL(value);
      return;
    }
    if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) {
      var bytes = new Uint8Array(value);
      var bin = "";
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      try { postExportBytes(format, btoa(bin)); } catch (e) {}
    }
  }
  function postExportFile(format, file){
    if (!file || !file.base64) return;
    try {
      parent.postMessage({
        type: "locus-asset-export-file",
        format: format,
        filename: file.filename,
        mime: file.mime || EXPORT_MIME[format],
        base64: file.base64
      }, "*");
    } catch (e) {}
    postExportBytes(format, file.base64, file.mime || EXPORT_MIME[format], file.filename);
  }
  function exportAsset(format, filename){
    format = format || "glb";
    filename = filename || ("asset." + (format === "textures" ? "zip" : format));
    var fn = exporterFor(format);
    if (typeof fn !== "function") {
      var label = EXPORT_LABELS[format] || String(format);
      exportProgress(format, "error", 0, "This studio has no " + label + " exporter yet.");
      return;
    }
    exportProgress(format, "start", 8);
    exportProgress(format, "prepare", 28);
    var captured = [];
    var restoreIntercept = interceptExportDownloads(captured, filename);
    var restored = false;
    function restore(){
      if (restored) return;
      restored = true;
      restoreIntercept();
    }
    function fail(err){
      restore();
      exportProgress(format, "error", 62, String(err && err.message ? err.message : err));
    }
    function finish(result){
      payloadToFile(result, filename, format, function(file){
        if (file || !captured.length) {
          restore();
          if (file) postExportFile(format, file);
          exportProgress(format, "done", 100);
          return;
        }
        payloadToFile(captured[captured.length - 1], filename, format, function(capturedFile){
          restore();
          if (capturedFile) postExportFile(format, capturedFile);
          exportProgress(format, "done", 100);
        }, fail);
      }, fail);
    }
    var result;
    try { result = fn(filename); }
    catch (err) {
      restore();
      exportProgress(format, "error", 28, String(err && err.message ? err.message : err));
      return;
    }
    exportProgress(format, "build", 62);
    if (result && typeof result.then === "function") {
      result.then(finish, fail);
      return;
    }
    finish(result);
  }
  function capturePack(){
    function afterPng(){
      var glb = exporterFor("glb");
      if (typeof glb !== "function") return;
      try {
        var result = glb();
        if (result && typeof result.then === "function") {
          result.then(function(value){ captureExportValue("glb", value); }, function(){});
          return;
        }
        captureExportValue("glb", result);
      } catch (e) {}
    }
    var png = exporterFor("png");
    var captured = false;
    if (typeof png === "function") {
      try {
        var result = png();
        if (result && typeof result.then === "function") {
          result.then(function(value){ captureExportValue("png", value); afterPng(); }, function(){ afterPng(); });
          return;
        }
        captureExportValue("png", result);
        captured = true;
      } catch (e) {}
    }
    if (!captured) {
      try {
        var canvas = document.querySelector("canvas");
        if (canvas && typeof canvas.toDataURL === "function") {
          captureExportValue("png", canvas.toDataURL("image/png"));
        }
      } catch (e) {}
    }
    afterPng();
  }
  window.addEventListener("message", function(ev){
    var data = ev.data || {};
    if (!data || typeof data.type !== "string") return;
    if (data.type === "locus-asset-wireframe") setWire(!!data.on);
    if (data.type === "locus-asset-orbit") setOrbit(data.on !== false);
    if (data.type === "locus-asset-zoom") setZoom(data.scale != null ? data.scale : zoom, true);
    if (data.type === "locus-asset-camera") setCamera(data.view || "reset");
    if (data.type === "locus-asset-grid") setGrid(!!data.on);
    if (data.type === "locus-asset-material") setMaterial(data.id || "studio");
    if (data.type === "locus-asset-lights") setLights(data.id || "default");
    if (data.type === "locus-asset-units") setUnits(data.units || "m");
    if (data.type === "locus-asset-background") setBackground(data.id || "grey");
    if (data.type === "locus-asset-isolate") isolate(data.part || "all");
    if (data.type === "locus-asset-speed") setSpeed(data.rate);
    if (data.type === "locus-asset-scrub") setScrub(data.t);
    if (data.type === "locus-asset-play") {
      if (typeof api().play === "function") api().play(data.clip || "idle");
    }
    if (data.type === "locus-asset-pause") {
      if (typeof api().pause === "function") api().pause();
    }
    if (data.type === "locus-asset-pose" && data.pose) {
      if (data.pose.head != null) setVar("--head", data.pose.head);
      if (data.pose.arms != null) setVar("--arms", data.pose.arms);
      if (data.pose.legs != null) setVar("--legs", data.pose.legs);
      if (data.pose.twist != null) setVar("--twist", data.pose.twist);
      if (typeof api().pose === "function") api().pose(data.pose);
    }
    if (data.type === "locus-asset-mode") {
      document.documentElement.setAttribute("data-locus-asset-mode", data.mode || "3d");
      if (typeof api().mode === "function") api().mode(data.mode || "3d");
    }
    if (data.type === "locus-asset-export") exportAsset(data.format || "glb", data.filename);
    if (data.type === "locus-asset-pack-capture") capturePack();
    if (data.type === "locus-asset-stats-request") {
      var raw = api().stats;
      var stats = typeof raw === "function" ? raw() : raw;
      try { parent.postMessage({ type: "locus-asset-stats", stats: stats || null }, "*"); } catch (e) {}
    }
  });
  window.addEventListener("wheel", function(ev){
    ev.preventDefault();
    setZoom(zoom * (ev.deltaY < 0 ? ${ASSET_ZOOM_IN} : ${ASSET_ZOOM_OUT}), false);
  }, { passive: false });
  ensureStageCss();
  pinStage();
})();
</script>`;

export function withAssetChromeHook(html: string): string {
  if (html.includes("data-locus-asset-chrome")) {
    return html.replace(/<script data-locus-asset-chrome>[\s\S]*?<\/script>/i, ASSET_CHROME_HOOK);
  }
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${ASSET_CHROME_HOOK}</body>`);
  return `${html}${ASSET_CHROME_HOOK}`;
}

const LOCUS_ASSET_API = [
  "mode",
  "wireframe",
  "orbit",
  "zoom",
  "camera",
  "grid",
  "material",
  "lights",
  "units",
  "background",
  "isolate",
  "pose",
  "play",
  "pause",
  "speed",
  "scrub",
  "exportGlb",
  "exportPng",
  "exportStl",
  "exportTextures",
  "stats",
] as const;

export function formatAssetCanvasSnapshot(html?: string | null): string {
  const text = html ?? "";
  const apiBlob = text.match(/__locusAsset[\s\S]{0,800}/)?.[0] ?? "";
  const keys = LOCUS_ASSET_API.filter((key) => new RegExp(`\\b${key}\\b`).test(apiBlob));
  const relativePhoto =
    /\.locus-attachments\/|["'](?:\.\/|\.\.\/)?(?!https?:|data:|blob:)[^"']+\.(?:png|jpe?g|gif|webp)["']/i.test(
      text,
    );
  const pixelRead = /\b(?:getImageData|toDataURL|toBlob|readPixels|texImage2D)\s*\(/.test(text);
  const crossOrigin = /crossOrigin\s*=/.test(text);
  const lines = [
    "Asset canvas snapshot (do not re-read the whole file unless you need a specific range):",
    `- index.html ${text.length} bytes, </html> ${/<\/html>/i.test(text) ? "yes" : "NO"}`,
    `- __locusAsset keys: ${keys.join(", ") || "none found"}`,
    `- relative photo: ${relativePhoto ? "yes" : "no"}`,
    `- pixel read (getImageData): ${pixelRead ? "yes" : "no"}${pixelRead && !crossOrigin ? ", no crossOrigin" : ""}`,
    `- host fallback: ${looksHostFallbackCanvas(text) ? "yes" : "no"}`,
  ];
  if (relativePhoto && pixelRead) {
    lines.push(
      "Relative photos taint getImageData in the unique-origin iframe. Set img.crossOrigin='anonymous' before src; canvas-files HTTP is automatic for relative photos. Catch SecurityError. Do not call preview. Do not file_read PNGs. One playwright shot is enough.",
    );
  } else {
    lines.push(
      "Patch index.html in place. Call playwright once to click a visible control. Do not file_read attached PNGs.",
    );
  }
  return lines.join("\n");
}

export function assetCanvasBrokenPrompt(text: string): boolean {
  return /tainted by cross-origin|the canvas has been tainted|getImageData|SecurityError|cross-origin data/i.test(
    text,
  );
}

export const ASSET_RASTER_READ =
  "This is a binary photo already in the thread and already landed as ./source.png (side/back as ./source-side.png / ./source-back.png; mask as ./source-mask.png when enhancement ran). Do not file_read, re-copy, or Python-decode it (that fills the context window). Load from the canvas with ./vendor/reconstruct.js (reconstructFromPhoto): set img.crossOrigin='anonymous' before src; canvas-files HTTP is automatic for relative photos. Punch out the backdrop. Do not call preview.";

export function isAssetRasterPath(path?: string): boolean {
  const file = (path ?? "").split(/[?#]/)[0] ?? "";
  return /\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(file);
}

export const ASSET_PROMOTE_SCAFFOLDS = ["three-vite", "canvas-vite", "static"] as const;
export type AssetPromoteScaffold = (typeof ASSET_PROMOTE_SCAFFOLDS)[number];

export function formatPromoteAssetBrief(session: {
  title?: string;
  designSystemId?: string;
  assetStyleId?: string;
  assetStyleName?: string;
  assetBuild?: AssetBuild | null;
  designPins?: Array<{ viewport?: string; selector?: string; text?: string }>;
}): string {
  const title = session.title?.trim() || "an asset studio";
  const parts = [
    "# Asset brief",
    "",
    `Promoted from ${title}.`,
    "",
    "## Studio",
    "",
    "Keep the 2D sprite sheet or 3D mesh, orbit, pose CSS vars, and window.__locusAsset.",
    "",
    "## Rig",
    "",
    `Honor --head --arms --legs --twist. Grasp/hold socket for pickup and carry. ${ASSET_CLIP_LINE}`,
    "",
    "## Export",
    "",
    "PNG / sprite sheet for 2D. GLB / STL / texture-set for 3D. No CDNs.",
  ];
  if (session.designSystemId) {
    parts.push("", "## Asset kit", "", `Kit: ${session.designSystemId}`);
  }
  if (session.assetStyleName || session.assetStyleId) {
    parts.push(
      "",
      "## Style",
      "",
      `Saved style: ${session.assetStyleName?.trim() || session.assetStyleId}.`,
    );
  }
  parts.push("", formatAssetBuildBrief(resolveAssetBuild(session.assetBuild)).trimEnd());
  if (session.designPins?.length) {
    parts.push("", "## Comments");
    for (const pin of session.designPins) {
      parts.push(
        `- ${pin.viewport ?? "desktop"} \`${pin.selector ?? ""}\`${pin.text ? `: ${pin.text}` : ""}`,
      );
    }
  }
  parts.push("", "Port this studio into the scaffold. Keep operator comments and the rig.");
  return parts.join("\n");
}

function pascalAssetClip(id: string): string {
  return id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

const ASSET_HUD_EXPECT = new RegExp(
  `^(verts|vertices|tris|triangles|css-?3d|aligned|slices|3d mesh|loading|${ASSET_CLIPS.join("|")})$`,
  "i",
);
const ASSET_CLIP_CLICK = new RegExp(
  `#btn(?:${["Play", ...ASSET_CLIPS.map(pascalAssetClip)].join("|")})\\b|^text=(?:${["play", ...ASSET_CLIPS].join("|")})$`,
  "i",
);

/** True when HTML claims 3D but has no canvas / WebGL / Three mesh. */
export function looksUnwiredAsset(html?: string | null): boolean {
  const text = html?.trim() ?? "";
  if (!text) return false;
  const claims3d = /3d|wire(?:d|frame)|mesh|orbit|\bglb\b|webgl|css-3d|preserve-3d/i.test(text);
  if (!claims3d) return false;
  return !looksWiredAsset(text);
}

export function looksWiredAsset(html?: string | null): boolean {
  const text = html?.trim() ?? "";
  if (!text) return false;
  return (
    /<canvas\b/i.test(text) ||
    /getContext\s*\(\s*['"]webgl/i.test(text) ||
    /\bWebGLRenderingContext\b|\bWebGL2RenderingContext\b/i.test(text) ||
    /three\.module|from\s+['"]\.\/vendor\/three|\bTHREE\./i.test(text)
  );
}

export const MAX_ASSET_SCULPT_NUDGES = 2;

const ASSET_PRIMITIVE_GEO = /\b(?:Box|Sphere|Plane|Cylinder|Capsule)Geometry\b/;
const ASSET_ANY_GEO = /\b[A-Z][A-Za-z]*Geometry\b/;
const ASSET_SCULPT =
  /reconstructFromPhoto|reconstruct\.js|GLTFLoader|\.glb\b|GLBLoader|OBJLoader|FBXLoader|ExtrudeGeometry|LatheGeometry|ShapeGeometry|setAttribute\s*\(\s*['"]position/;

/** Strip host chrome so `source.png` in the operator hook is not counted as a sculpt pass. */
function assetAuthoredHtml(html: string): string {
  return html.replace(/<script[^>]*data-locus-asset-chrome[\s\S]*?<\/script>/gi, "");
}

function looksWebGlStudio(text: string): boolean {
  return (
    /three\.module|from\s+['"]\.\/vendor\/three|\bTHREE\./i.test(text) ||
    /getContext\s*\(\s*['"]webgl/i.test(text) ||
    /\bWebGLRenderingContext\b|\bWebGL2RenderingContext\b/i.test(text)
  );
}

export function looksSculptedAsset(html?: string | null): boolean {
  return ASSET_SCULPT.test(assetAuthoredHtml(html?.trim() ?? ""));
}

/** Wired 3D with no hull: empty Three/WebGL scene or a primitive grey box/billboard. */
export function looksPlaceholderAsset(html?: string | null): boolean {
  const text = assetAuthoredHtml(html?.trim() ?? "");
  if (!looksWiredAsset(text) || !looksWebGlStudio(text)) return false;
  if (looksSculptedAsset(text)) return false;
  if (ASSET_PRIMITIVE_GEO.test(text)) return true;
  if (/\bBufferGeometry\b/.test(text)) return true;
  return !ASSET_ANY_GEO.test(text);
}

export function playwrightArgsFromCall(args?: Record<string, unknown>): Record<string, unknown> {
  if (!args) return {};
  const nested = args.args;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return args;
}

/** HUD `expect_text` / clip-only clicks are not a mesh playtest. */
export function looksLikeHudOnlyAssetPlaytest(input: {
  name?: string;
  arguments?: Record<string, unknown>;
}): boolean {
  const name = (input.name ?? "").replace(/^locus-/, "");
  const nested = typeof input.arguments?.name === "string" ? input.arguments.name : "";
  const tool = typeof input.arguments?.toolName === "string" ? input.arguments.toolName : "";
  if (!/playwright/i.test(name) && !/playwright/i.test(nested) && !/playwright/i.test(tool)) {
    return false;
  }
  const args = playwrightArgsFromCall(input.arguments);
  const steps = parsePlaywrightSteps(args);
  if (!steps.length) return false;
  const hasRealLive = steps.some((step) => {
    if (step.kind === "key" || step.kind === "wait" || step.kind === "fill") return true;
    if (step.kind !== "click") return false;
    return !ASSET_CLIP_CLICK.test(step.locator);
  });
  if (hasRealLive) return false;
  const expects = steps.filter((step) => step.kind === "expect");
  if (expects.length) return expects.every((step) => ASSET_HUD_EXPECT.test(step.text));
  return steps.some((step) => step.kind === "click");
}

export type AssetStudioStats = {
  mode?: string;
  verts?: number;
  tris?: number;
  faces?: number;
  topology?: string;
  printable?: boolean;
  units?: string;
  scale?: number;
  holes?: number;
  nonManifold?: number;
  openEdges?: number;
};

export function parseAssetStudioStats(value: unknown): AssetStudioStats | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const mode = typeof row.mode === "string" ? row.mode.trim().toLowerCase() : undefined;
  const verts = Number(row.verts ?? row.vertices);
  const tris = Number(row.tris ?? row.triangles ?? row.faces);
  const faces = Number(row.faces ?? row.tris ?? row.triangles);
  const topologyRaw = typeof row.topology === "string" ? row.topology.trim().toLowerCase() : "";
  const topology =
    topologyRaw === "triangle" || topologyRaw === "tris" || topologyRaw === "tri"
      ? "triangle"
      : topologyRaw === "quad" || topologyRaw === "quads"
        ? "quad"
        : topologyRaw || undefined;
  const printable =
    typeof row.printable === "boolean"
      ? row.printable
      : typeof row.printability === "boolean"
        ? row.printability
        : undefined;
  const unitsRaw = typeof row.units === "string" ? row.units.trim().toLowerCase() : "";
  const units =
    unitsRaw === "mm" || unitsRaw === "millimeter" || unitsRaw === "millimeters"
      ? "mm"
      : unitsRaw === "m" || unitsRaw === "meter" || unitsRaw === "meters"
        ? "m"
        : unitsRaw || undefined;
  const scale = Number(row.scale);
  const holes = Number(row.holes);
  const nonManifold = Number(row.nonManifold ?? row.non_manifold);
  const openEdges = Number(row.openEdges ?? row.open_edges);
  const stats: AssetStudioStats = {};
  if (mode) stats.mode = mode;
  if (Number.isFinite(verts)) stats.verts = verts;
  if (Number.isFinite(tris)) stats.tris = tris;
  if (Number.isFinite(faces)) stats.faces = faces;
  if (topology) stats.topology = topology;
  if (printable != null) stats.printable = printable;
  if (units) stats.units = units;
  if (Number.isFinite(scale) && scale > 0) stats.scale = scale;
  if (Number.isFinite(holes) && holes >= 0) stats.holes = holes;
  if (Number.isFinite(nonManifold) && nonManifold >= 0) stats.nonManifold = nonManifold;
  if (Number.isFinite(openEdges) && openEdges >= 0) stats.openEdges = openEdges;
  if (
    !stats.mode &&
    stats.verts == null &&
    stats.tris == null &&
    stats.faces == null &&
    !stats.topology &&
    stats.printable == null &&
    !stats.units &&
    stats.scale == null &&
    stats.holes == null &&
    stats.nonManifold == null &&
    stats.openEdges == null
  ) {
    return undefined;
  }
  return stats;
}

export function formatAssetStudioStats(stats: AssetStudioStats): string {
  const parts = ["stats"];
  if (stats.mode) parts.push(`mode=${stats.mode}`);
  if (stats.topology) parts.push(`topology=${stats.topology}`);
  if (stats.verts != null) parts.push(`verts=${stats.verts}`);
  if (stats.tris != null) parts.push(`tris=${stats.tris}`);
  if (stats.faces != null && stats.faces !== stats.tris) parts.push(`faces=${stats.faces}`);
  if (stats.printable != null) parts.push(`printable=${stats.printable ? "yes" : "no"}`);
  if (stats.units) parts.push(`units=${stats.units}`);
  if (stats.scale != null) parts.push(`scale=${stats.scale}`);
  if (stats.holes != null) parts.push(`holes=${stats.holes}`);
  if (stats.nonManifold != null) parts.push(`nonManifold=${stats.nonManifold}`);
  if (stats.openEdges != null) parts.push(`openEdges=${stats.openEdges}`);
  return parts.join(" ");
}

/** Fail Image-to-3D when stats say CSS-3D or an empty mesh. 2D sprite mode is allowed. */
export function assetStudioStatsFailReason(stats: AssetStudioStats): string | undefined {
  const mode = stats.mode ?? "";
  if (mode === "2d") return undefined;
  if (mode && mode !== "3d") return `mode is ${stats.mode}, not 3d`;
  if (stats.verts === 0) return "verts is 0";
  if ((mode === "3d" || !mode) && stats.verts == null) return "verts missing";
  return undefined;
}

export const ASSET_STATS_EVAL = `(() => {
  try {
    const api = window.__locusAsset;
    if (!api) return null;
    const raw = typeof api.stats === "function" ? api.stats() : api.stats;
    if (!raw || typeof raw !== "object") return null;
    return raw;
  } catch {
    return null;
  }
})()`;
