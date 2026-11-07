import { isAssetSession, isDesignSession, isGameSession, type SessionKind } from "./session.js";
import { sessionDisplayName } from "./persona.js";
import { ASSET_CLIPS, ASSET_SOURCE_FILE } from "./assetCanvas.js";
import { UNUSED_LINKED_ASSETS_PREFIX } from "../selfCorrect.js";

export const ASSET_PACK_DIR = ".locus-asset";
export const ASSET_PACK_MANIFEST = `${ASSET_PACK_DIR}/manifest.json`;
export const ASSET_PACK_PREVIEW = `${ASSET_PACK_DIR}/preview.png`;
export const LINKED_ASSETS_DIR = "vendor/assets";
export const LINKED_ASSETS_INDEX = `${LINKED_ASSETS_DIR}/index.json`;

export const ASSET_PACK_KINDS = ["sprite", "sheet", "mesh", "rigged"] as const;
export type AssetPackKind = (typeof ASSET_PACK_KINDS)[number];

export const ASSET_PACK_FILE_ROLES = [
  "preview",
  "source",
  "source-side",
  "source-back",
  "sheet",
  "model",
  "stl",
  "texture",
] as const;
export type AssetPackFileRole = (typeof ASSET_PACK_FILE_ROLES)[number];

export const MAX_LINKED_ASSETS = 8;
export const MAX_UNUSED_LINKED_ASSET_NUDGES = 2;
export const MAX_ASSET_PACK_FILE_BYTES = 25 * 1024 * 1024;

export type AssetPackFile = {
  name: string;
  role: AssetPackFileRole;
  mime: string;
};

export type AssetPackManifest = {
  version: 1;
  sessionId: string;
  title: string;
  slug: string;
  kind: AssetPackKind;
  clips: string[];
  files: AssetPackFile[];
  styleName?: string;
  frameWidth?: number;
  frameHeight?: number;
  columns?: number;
  rows?: number;
  units?: "m" | "mm";
  updatedAt: string;
};

export type AssetPackSummary = {
  slug: string;
  kind: AssetPackKind;
  title: string;
  updatedAt: string;
  files: string[];
  clips?: string[];
};

export type SessionAssetRef = {
  sessionId: string;
  slug: string;
  title?: string;
  kind?: AssetPackKind;
  packMtime?: number;
};

export type AssetMentionItem = {
  id: string;
  token: string;
  label: string;
  hint: string;
  kind?: AssetPackKind;
  previewUrl?: string;
};

export type LinkedAssetPrompt = {
  slug: string;
  title: string;
  kind: AssetPackKind;
  dir: string;
  files: AssetPackFile[];
  clips: string[];
  frameWidth?: number;
  frameHeight?: number;
  columns?: number;
  rows?: number;
};

const ASSET_MENTION = /(?:^|[\s(])@asset:([A-Za-z0-9_-]+)/g;

export function isAssetPackKind(value: unknown): value is AssetPackKind {
  return typeof value === "string" && (ASSET_PACK_KINDS as readonly string[]).includes(value);
}

export function isAssetPackFileRole(value: unknown): value is AssetPackFileRole {
  return typeof value === "string" && (ASSET_PACK_FILE_ROLES as readonly string[]).includes(value);
}

export function slugifyAssetTitle(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/^untitled asset$/i, "asset")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "asset";
}

export function uniqueAssetSlug(title: string, sessionId: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((row) => row.toLowerCase()));
  const base = slugifyAssetTitle(title) || "asset";
  if (!used.has(base)) return base;
  const short =
    sessionId
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 4)
      .toLowerCase() || "x";
  const withId = `${base}-${short}`.slice(0, 48);
  if (!used.has(withId)) return withId;
  let n = 2;
  while (used.has(`${withId}-${n}`)) n += 1;
  return `${withId}-${n}`;
}

export function assetMentionToken(slug: string): string {
  const clean = slug.replace(/^@?asset:/i, "").trim();
  return `asset:${clean}`;
}

/** Workspace-relative image to show for an Assets studio (pack preview, then source/sheet). */
export function assetPreviewRel(files?: string[]): string {
  const names = (files ?? []).map((file) => file.replace(/^.*\//, ""));
  const has = (name: string) => names.some((file) => file.toLowerCase() === name);
  if (has("preview.png")) return `${ASSET_PACK_DIR}/preview.png`;
  if (has("sheet.png")) return `${ASSET_PACK_DIR}/sheet.png`;
  if (has("source.png")) return `${ASSET_PACK_DIR}/source.png`;
  const raster = names.find((file) => /\.(png|jpe?g|webp)$/i.test(file));
  if (raster) return `${ASSET_PACK_DIR}/${raster}`;
  return ASSET_SOURCE_FILE;
}

export function assetPreviewUrl(
  sessionId: string,
  pack?: { files?: string[]; updatedAt?: string },
): string {
  const id = sessionId.trim();
  if (!id) return "";
  const rel = assetPreviewRel(pack?.files);
  const url = `/api/sessions/${encodeURIComponent(id)}/canvas-files/${rel}`;
  const stamp = pack?.updatedAt ? Date.parse(pack.updatedAt) : NaN;
  return Number.isFinite(stamp) && stamp > 0 ? `${url}?t=${stamp}` : url;
}

export function parseAssetMentions(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(ASSET_MENTION.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const slug = (match[1] ?? "").trim();
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return out;
}

export function insertAssetMention(
  text: string,
  cursor: number,
  slug: string,
  query?: { start: number; query: string } | null,
): { text: string; cursor: number } {
  const token = assetMentionToken(slug);
  if (!token.endsWith(":") && token.length <= "asset:".length) return { text, cursor };
  const insert = `@${token} `;
  const start = query?.start ?? cursor;
  const end = query ? Math.max(cursor, start + 1 + query.query.length) : cursor;
  const next = `${text.slice(0, start)}${insert}${text.slice(end)}`;
  return { text: next, cursor: start + insert.length };
}

export function parseAssetPackFile(raw: unknown): AssetPackFile | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name.replace(/^\/+/, "").trim() : "";
  if (!name || name.includes("..") || name.startsWith("/") || name.includes("\\")) return null;
  if (!isAssetPackFileRole(row.role)) return null;
  const mime =
    typeof row.mime === "string" && row.mime.trim() ? row.mime.trim() : mimeForAssetRole(row.role);
  return { name, role: row.role, mime };
}

export function parseAssetPackManifest(raw: unknown): AssetPackManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const sessionId = typeof row.sessionId === "string" ? row.sessionId.trim() : "";
  const slug = typeof row.slug === "string" ? slugifyAssetTitle(row.slug) : "";
  if (!sessionId || !slug || !isAssetPackKind(row.kind)) return null;
  const files = Array.isArray(row.files)
    ? row.files.map(parseAssetPackFile).filter((file): file is AssetPackFile => Boolean(file))
    : [];
  const clips = Array.isArray(row.clips)
    ? row.clips
        .filter((clip): clip is string => typeof clip === "string" && clip.trim().length > 0)
        .map((clip) => clip.trim())
    : [];
  const title = typeof row.title === "string" && row.title.trim() ? row.title.trim() : slug;
  const units = row.units === "mm" || row.units === "m" ? row.units : undefined;
  const num = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
  };
  return {
    version: 1,
    sessionId,
    title,
    slug,
    kind: row.kind,
    clips,
    files,
    styleName:
      typeof row.styleName === "string" && row.styleName.trim() ? row.styleName.trim() : undefined,
    frameWidth: num(row.frameWidth),
    frameHeight: num(row.frameHeight),
    columns: num(row.columns),
    rows: num(row.rows),
    units,
    updatedAt:
      typeof row.updatedAt === "string" && row.updatedAt.trim()
        ? row.updatedAt.trim()
        : new Date().toISOString(),
  };
}

export function parseAssetPackSummary(raw: unknown): AssetPackSummary | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const slug = typeof row.slug === "string" ? slugifyAssetTitle(row.slug) : "";
  if (!slug || !isAssetPackKind(row.kind)) return undefined;
  const files = Array.isArray(row.files)
    ? row.files.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    : [];
  const clips = Array.isArray(row.clips)
    ? row.clips.filter((clip): clip is string => typeof clip === "string" && clip.trim().length > 0)
    : undefined;
  return {
    slug,
    kind: row.kind,
    title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : slug,
    updatedAt:
      typeof row.updatedAt === "string" && row.updatedAt.trim()
        ? row.updatedAt.trim()
        : new Date().toISOString(),
    files,
    ...(clips?.length ? { clips } : {}),
  };
}

export function parseSessionAssetRef(raw: unknown): SessionAssetRef | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const sessionId = typeof row.sessionId === "string" ? row.sessionId.trim() : "";
  const slug = typeof row.slug === "string" ? slugifyAssetTitle(row.slug) : "";
  if (!sessionId || !slug) return null;
  const packMtime = Number(row.packMtime);
  return {
    sessionId,
    slug,
    title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : undefined,
    kind: isAssetPackKind(row.kind) ? row.kind : undefined,
    packMtime: Number.isFinite(packMtime) ? packMtime : undefined,
  };
}

export function parseLinkedAssetPrompt(raw: unknown): LinkedAssetPrompt | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const slug = typeof row.slug === "string" ? slugifyAssetTitle(row.slug) : "";
  if (!slug) return null;
  const files = Array.isArray(row.files)
    ? row.files.map(parseAssetPackFile).filter((file): file is AssetPackFile => Boolean(file))
    : [];
  const clips = Array.isArray(row.clips)
    ? row.clips.filter((clip): clip is string => typeof clip === "string" && clip.trim().length > 0)
    : [];
  const num = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
  };
  return {
    slug,
    title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : slug,
    kind: isAssetPackKind(row.kind) ? row.kind : "sprite",
    dir:
      typeof row.dir === "string" && row.dir.trim()
        ? row.dir.replace(/^\/+/, "").trim()
        : linkedAssetDir(slug),
    files,
    clips,
    frameWidth: num(row.frameWidth),
    frameHeight: num(row.frameHeight),
    columns: num(row.columns),
    rows: num(row.rows),
  };
}

export function parseSessionAssetRefs(raw: unknown): SessionAssetRef[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SessionAssetRef[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const ref = parseSessionAssetRef(row);
    if (!ref || seen.has(ref.sessionId)) continue;
    seen.add(ref.sessionId);
    out.push(ref);
    if (out.length >= MAX_LINKED_ASSETS) break;
  }
  return out;
}

export function parseAssetRefIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const row of raw) {
    const id = typeof row === "string" ? row.trim() : "";
    if (id && !out.includes(id)) out.push(id);
    if (out.length >= MAX_LINKED_ASSETS) break;
  }
  return out;
}

export function summarizeAssetPack(manifest: AssetPackManifest): AssetPackSummary {
  return {
    slug: manifest.slug,
    kind: manifest.kind,
    title: manifest.title,
    updatedAt: manifest.updatedAt,
    files: manifest.files.map((file) => file.name),
    ...(manifest.clips.length ? { clips: manifest.clips } : {}),
  };
}

export function mimeForAssetRole(role: AssetPackFileRole): string {
  if (role === "model") return "model/gltf-binary";
  if (role === "stl") return "model/stl";
  if (role === "texture") return "image/png";
  return "image/png";
}

export function assetPackRoleForName(name: string): AssetPackFileRole | undefined {
  const file = name.replace(/^.*\//, "").toLowerCase();
  if (file === "preview.png") return "preview";
  if (file === "source.png") return "source";
  if (file === "source-side.png") return "source-side";
  if (file === "source-back.png") return "source-back";
  if (file === "sheet.png" || file.includes("sheet")) return "sheet";
  if (file.endsWith(".glb")) return "model";
  if (file.endsWith(".stl")) return "stl";
  if (/\.(png|jpe?g|webp)$/.test(file)) return "texture";
  return undefined;
}

export function inferAssetPackKind(input: {
  html?: string | null;
  files: Array<{ name: string; role?: AssetPackFileRole }>;
  clips?: string[];
}): AssetPackKind {
  const hasModel = input.files.some((file) => file.role === "model" || /\.glb$/i.test(file.name));
  const hasSheet = input.files.some((file) => file.role === "sheet" || /sheet/i.test(file.name));
  const clips = input.clips ?? inferAssetClips(input.html);
  if (hasModel) return clips.length ? "rigged" : "mesh";
  if (hasSheet) return "sheet";
  const html = input.html ?? "";
  if (/<canvas\b|three\.module|WebGL/i.test(html) && /3d|mesh|glb/i.test(html)) {
    return clips.length ? "rigged" : "mesh";
  }
  return "sprite";
}

export function inferAssetClips(html?: string | null): string[] {
  const text = html ?? "";
  if (!text) return [];
  return ASSET_CLIPS.filter((clip) => new RegExp(`["']${clip}["']|\\b${clip}\\b`).test(text));
}

export function linkedAssetDir(slug: string): string {
  return `${LINKED_ASSETS_DIR}/${slugifyAssetTitle(slug) || "asset"}`;
}

export function formatLinkedAssetsPrompt(assets: LinkedAssetPrompt[]): string {
  if (!assets.length) return "";
  const blocks = assets.map((asset) => {
    const dir = `/workspace/${asset.dir}`;
    const files =
      asset.files.map((file) => `  - ${file.role}: ${dir}/${file.name}`).join("\n") ||
      "  - (no exported files yet — keep a labeled placeholder, do not invent art)";
    const clipLine = asset.clips.length ? `Clips: ${asset.clips.join(", ")}.` : "";
    const sheet =
      asset.kind === "sheet" && asset.columns && asset.rows
        ? `Sprite sheet ${asset.columns}×${asset.rows} frames${
            asset.frameWidth && asset.frameHeight
              ? ` of ${asset.frameWidth}×${asset.frameHeight}px`
              : ""
          }.`
        : "";
    const load =
      asset.kind === "mesh" || asset.kind === "rigged"
        ? `Load the GLB with the vendored Three GLTFLoader from ${dir}/model.glb (relative). Honor clip names when playing animations.`
        : asset.kind === "sheet"
          ? `Draw frames from the sheet with drawImage. Do not regenerate pixels.`
          : `Use the PNG as the sprite (drawImage / <img src>). Do not redraw it.`;
    return [
      `@asset:${asset.slug} — ${asset.title} (${asset.kind})`,
      files,
      [sheet, clipLine, load].filter(Boolean).join(" "),
    ].join("\n");
  });
  return [
    "Linked operator assets. Prefer these files over generated placeholder art. They live under /workspace/vendor/assets/ and are already served on the live canvas.",
    "Read /workspace/vendor/assets/index.json. Do not copy from other session workspaces.",
    ...blocks,
  ].join("\n");
}

export function upsertLinkedAssetsSection(brief: string, assets: LinkedAssetPrompt[]): string {
  const lines = ["## Linked assets", ""];
  if (!assets.length) {
    lines.push("None.");
  } else {
    for (const asset of assets) {
      const files = asset.files.map((file) => file.name).join(", ") || "no files yet";
      lines.push(
        `- @asset:${asset.slug} (${asset.kind}) — \`${asset.dir}/\` — ${files}${
          asset.clips.length ? ` — clips: ${asset.clips.join(", ")}` : ""
        }`,
      );
    }
    lines.push("", "Load these relative paths from index.html. Do not redraw them.");
  }
  lines.push("");
  const block = `${lines.join("\n")}`;
  const source = brief.replace(/^\uFEFF/, "");
  const range = markdownSectionRange(source, "Linked assets");
  if (range) {
    const suffix = source.slice(range.end);
    return `${source.slice(0, range.start)}${block}${suffix && !suffix.startsWith("\n") ? "\n" : ""}${suffix}`;
  }
  if (/^## Persistence\s*$/m.test(source)) {
    return source.replace(/^## Persistence\s*$/m, `${block}\n## Persistence`);
  }
  const trimmed = source.trimEnd();
  return trimmed ? `${trimmed}\n\n${block}` : block;
}

function markdownSectionRange(
  text: string,
  heading: string,
): { start: number; end: number } | null {
  const match = text.match(new RegExp(`^## ${heading}\\s*$`, "m"));
  if (!match || match.index == null) return null;
  const start = match.index;
  const bodyStart = start + match[0].length;
  const next = text.slice(bodyStart).search(/^## /m);
  return { start, end: next >= 0 ? bodyStart + next : text.length };
}

export function looksLikeUnusedLinkedAssets(
  html: string | null | undefined,
  slugs: string[],
): boolean {
  if (!slugs.length) return false;
  const text = html ?? "";
  if (!text.trim()) return false;
  return slugs.some((slug) => {
    const clean = slugifyAssetTitle(slug);
    if (!clean) return false;
    return !text.includes(`vendor/assets/${clean}`);
  });
}

export function unusedLinkedAssetsNudge(slugs: string[]): string {
  const listed = slugs.map((slug) => `@asset:${slugifyAssetTitle(slug) || slug}`).join(", ");
  return `${UNUSED_LINKED_ASSETS_PREFIX} Load ${listed} from vendor/assets/<slug>/ as listed in vendor/assets/index.json (sprite: drawImage the PNG/sheet; mesh: GLTFLoader on model.glb). Do not redraw or substitute placeholder art. Do not rewrite the whole page if a small patch will do.`;
}

export function canLinkAssetSessions(kind?: SessionKind): boolean {
  return isGameSession({ kind }) || isDesignSession({ kind });
}

export function assetMentionItems(input: {
  session: { id: string; kind?: SessionKind };
  sessions: Array<{
    id: string;
    kind?: SessionKind;
    title: string;
    archived?: boolean;
    assetPack?: AssetPackSummary;
  }>;
}): AssetMentionItem[] {
  if (!canLinkAssetSessions(input.session.kind)) return [];
  const taken = new Set<string>();
  const items: AssetMentionItem[] = [];
  const rows = input.sessions
    .filter((row) => isAssetSession(row) && !row.archived && row.id !== input.session.id)
    .sort((a, b) => sessionDisplayName(a).localeCompare(sessionDisplayName(b)));
  for (const row of rows) {
    const slug = row.assetPack?.slug || uniqueAssetSlug(sessionDisplayName(row), row.id, taken);
    taken.add(slug.toLowerCase());
    const kind = row.assetPack?.kind;
    const files = row.assetPack?.files?.length ? row.assetPack.files.join(", ") : "no pack yet";
    items.push({
      id: row.id,
      token: assetMentionToken(slug),
      label: `@asset:${slug}`,
      hint: [sessionDisplayName(row), kind, files].filter(Boolean).join(" · "),
      kind,
      previewUrl: assetPreviewUrl(row.id, row.assetPack),
    });
  }
  return items;
}

export function filterAssetMentions(items: AssetMentionItem[], query: string): AssetMentionItem[] {
  const q = query
    .replace(/^asset:/i, "")
    .trim()
    .toLowerCase();
  if (!q) return items;
  return items
    .map((item) => ({ item, score: assetMentionScore(item, q) }))
    .filter((row) => row.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.item.label.localeCompare(b.item.label) ||
        a.item.token.localeCompare(b.item.token),
    )
    .map((row) => row.item);
}

function assetMentionScore(item: AssetMentionItem, query: string): number {
  const token = item.token.toLowerCase().replace(/^asset:/, "");
  const label = item.label.toLowerCase();
  const hint = item.hint.toLowerCase();
  if (token === query || label === `@asset:${query}` || item.id.toLowerCase().startsWith(query))
    return 500;
  if (token.startsWith(query) || label.startsWith(`@asset:${query}`)) return 400;
  if (hint.split(/\s+/).some((word) => word.replace(/[^a-z0-9]+/g, "").startsWith(query)))
    return 300;
  if (token.includes(query) || hint.includes(query) || label.includes(query)) return 200;
  return 0;
}

export function resolveAssetMention(
  slug: string,
  sessions: Array<{
    id: string;
    kind?: SessionKind;
    title: string;
    archived?: boolean;
    assetPack?: AssetPackSummary;
  }>,
): { id: string; slug: string } | undefined {
  const q = slug
    .replace(/^asset:/i, "")
    .trim()
    .toLowerCase();
  if (!q) return undefined;
  const assets = sessions.filter((row) => isAssetSession(row) && !row.archived);
  const exact = assets.find(
    (row) =>
      row.assetPack?.slug.toLowerCase() === q ||
      row.id.toLowerCase() === q ||
      row.id.toLowerCase().startsWith(q),
  );
  if (exact) return { id: exact.id, slug: exact.assetPack?.slug || slugifyAssetTitle(exact.title) };
  const titled = assets.find((row) => slugifyAssetTitle(sessionDisplayName(row)) === q);
  if (titled)
    return { id: titled.id, slug: titled.assetPack?.slug || slugifyAssetTitle(titled.title) };
  return undefined;
}
