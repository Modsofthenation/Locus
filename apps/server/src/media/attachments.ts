import { lstat, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  MAX_CHAT_ATTACHMENTS,
  PASTE_CHIP_RE,
  qemuPathUnsafe,
  sanitizePasteChipName,
  ASSET_MASK_FILE,
  ASSET_VIEW_FILES,
  ASSET_VIEW_SLOTS,
  cutoutAssetRgba,
  enhanceAssetRgba,
  viewSlotForAssetName,
  type AssetViewSlot,
  type ChatAttachment,
} from "@locus/shared";
import { decodePngRgba, encodePngRgba, isPng } from "./pngRgba.js";
import { requireSafeSessionId, resolveSafeSessionFile } from "../session/sessionPaths.js";
import { sanitizeWorkspaceRel, writeWorkspaceFile } from "../workspace/workspaceFiles.js";

export const MAX_ATTACHMENT_BYTES = 1_500_000;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".html": "text/html",
  ".csv": "text/csv",
};

export interface IncomingAttachment {
  name: string;
  mime: string;
  contentBase64: string;
}

export function attachmentsRoot(dataDir: string): string {
  return join(dataDir, "attachments");
}

export function storedAttachmentsDir(dataDir: string, sessionId: string): string {
  return join(attachmentsRoot(dataDir), requireSafeSessionId(sessionId));
}

export function sanitizeAttachmentName(raw: string): string {
  const leaf = basename(raw.replaceAll("\\", "/"));
  const cleaned = leaf
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return cleaned || "attachment";
}

function extOf(name: string): string {
  const match = name.toLowerCase().match(/(\.[a-z0-9]{1,8})$/);
  return match?.[1] ?? "";
}

export function attachmentMime(name: string, mime?: string): string | undefined {
  const ext = extOf(name);
  const fromName = MIME_BY_EXT[ext];
  if (!fromName) return undefined;
  const offered = (mime ?? "").trim().toLowerCase();
  if (!offered || offered === "application/octet-stream") return fromName;
  if (offered === fromName) return fromName;
  if (ext === ".jpg" && offered === "image/jpg") return fromName;
  if (ext === ".md" && (offered === "text/plain" || offered === "text/x-markdown")) return fromName;
  return undefined;
}

export function parseIncomingAttachments(raw: unknown): IncomingAttachment[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error("attachments must be an array");
  if (raw.length > MAX_CHAT_ATTACHMENTS)
    throw new Error(`At most ${MAX_CHAT_ATTACHMENTS} attachments`);
  return raw.map((row, index) => {
    if (!row || typeof row !== "object") throw new Error(`Invalid attachment at ${index + 1}`);
    const value = row as Record<string, unknown>;
    const name = typeof value.name === "string" ? sanitizeAttachmentName(value.name) : "";
    const contentBase64 =
      typeof value.contentBase64 === "string" ? value.contentBase64.replace(/\s/g, "") : "";
    if (!name || !contentBase64) throw new Error(`Invalid attachment at ${index + 1}`);
    const mime = attachmentMime(name, typeof value.mime === "string" ? value.mime : undefined);
    if (!mime) throw new Error(`Unsupported attachment type: ${name}`);
    return { name, mime, contentBase64 };
  });
}

export function attachmentDest(dataDir: string, sessionId: string, filename: string): string {
  return resolveSafeSessionFile(
    attachmentsRoot(dataDir),
    sessionId,
    filename,
    "Invalid attachment filename",
  );
}

export async function persistChatAttachments(
  dataDir: string,
  sessionId: string,
  incoming: IncomingAttachment[],
  workspaceRoot?: string,
): Promise<ChatAttachment[]> {
  const out: ChatAttachment[] = [];
  const used = new Set<string>();
  for (const item of incoming) {
    let bytes: Buffer;
    try {
      bytes = Buffer.from(item.contentBase64, "base64");
    } catch {
      throw new Error(`Invalid attachment data: ${item.name}`);
    }
    if (!bytes.length) throw new Error(`Empty attachment: ${item.name}`);
    const cap = item.mime.startsWith("image/") ? MAX_IMAGE_BYTES : MAX_ATTACHMENT_BYTES;
    if (bytes.length > cap) throw new Error(`Attachment too large: ${item.name}`);
    let storedName = item.name;
    let n = 1;
    while (used.has(storedName)) {
      const ext = extOf(item.name);
      const stem = item.name.slice(0, item.name.length - ext.length) || "attachment";
      storedName = `${stem}-${n}${ext}`;
      n += 1;
    }
    used.add(storedName);
    const dest = attachmentDest(dataDir, sessionId, storedName);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
    if (workspaceRoot) {
      await writeWorkspaceBytes(
        workspaceRoot,
        `.locus-attachments/${storedName}`,
        bytes,
        item.mime,
      );
    }
    out.push({ name: item.name, mime: item.mime, bytes: bytes.length, storedName });
  }
  return out;
}

/** Copy stored chat files onto a workspace so Docker/VM/worker agents can open the prompt paths. */
export type WorkspaceAttachmentWriter = (rel: string, bytes: Buffer, mime: string) => Promise<void>;

function attachmentWriter(
  workspaceRoot?: string,
  writeBytes?: WorkspaceAttachmentWriter,
): WorkspaceAttachmentWriter | undefined {
  if (writeBytes) return writeBytes;
  if (workspaceRoot) {
    return (rel, bytes, mime) => writeWorkspaceBytes(workspaceRoot, rel, bytes, mime);
  }
  return undefined;
}

export async function materializeStoredAttachments(
  dataDir: string,
  sessionId: string,
  workspaceRoot?: string,
  writeBytes?: WorkspaceAttachmentWriter,
): Promise<string | undefined> {
  const src = storedAttachmentsDir(dataDir, sessionId);
  let names: string[];
  try {
    names = await readdir(src);
  } catch {
    return undefined;
  }
  if (!names.length) return undefined;
  const put = attachmentWriter(workspaceRoot, writeBytes);
  if (put) {
    for (const name of names) {
      if (!name || name === "." || name === ".." || qemuPathUnsafe(name) || name.includes("/"))
        continue;
      const dest = join(src, name);
      const info = await lstat(dest).catch(() => undefined);
      if (!info?.isFile()) continue;
      const bytes = await readFile(dest);
      const mime = attachmentMime(name) ?? "application/octet-stream";
      await put(`.locus-attachments/${name}`, bytes, mime);
    }
  }
  return src;
}

const MAX_ENHANCE_PIXELS = 1024 * 1024;

/** Copy attached photos to `source.png` / `source-side.png` / `source-back.png`. */
export async function landAssetSourceImage(
  dataDir: string,
  sessionId: string,
  workspaceRoot?: string,
  opts?: { enhance?: boolean; writeBytes?: WorkspaceAttachmentWriter },
): Promise<boolean> {
  const put = attachmentWriter(workspaceRoot, opts?.writeBytes);
  if (!put) return false;
  const src = storedAttachmentsDir(dataDir, sessionId);
  let names: string[];
  try {
    names = await readdir(src);
  } catch {
    return false;
  }
  const images = names.filter(
    (name) =>
      name &&
      name !== "." &&
      name !== ".." &&
      !qemuPathUnsafe(name) &&
      !name.includes("/") &&
      /\.(png|jpe?g|webp|gif)$/i.test(name),
  );
  if (!images.length) return false;
  const taken = new Set<AssetViewSlot>();
  let wrote = false;
  for (let i = 0; i < images.length; i++) {
    const image = images[i]!;
    let slot = viewSlotForAssetName(image, i, images.length);
    if (taken.has(slot)) {
      const next = ASSET_VIEW_SLOTS.find((id) => !taken.has(id));
      if (!next) continue;
      slot = next;
    }
    taken.add(slot);
    const dest = join(src, image);
    const info = await lstat(dest).catch(() => undefined);
    if (!info?.isFile()) continue;
    let bytes = await readFile(dest);
    if (!bytes.length) continue;
    let mime = attachmentMime(image) ?? "image/png";
    if (opts?.enhance !== false && slot === "front") {
      const enhanced = enhanceLandedPhoto(bytes);
      if (enhanced) {
        bytes = Buffer.from(enhanced.photo);
        mime = "image/png";
        await put(ASSET_MASK_FILE, enhanced.mask, "image/png");
      }
    }
    await put(ASSET_VIEW_FILES[slot], bytes, mime);
    wrote = true;
  }
  return wrote;
}

export function attachmentPromptNote(attachments: ChatAttachment[]): string {
  if (!attachments.length) return "";
  const lines = attachments.map(
    (item) =>
      `- ${item.name} (${item.mime}, ${item.bytes} bytes) at /workspace/.locus-attachments/${item.storedName}`,
  );
  return `Attached files:\n${lines.join("\n")}`;
}

function attachmentInlineNote(
  item: ChatAttachment,
  around?: { before?: string; after?: string },
): string {
  const note = `${item.name} at /workspace/.locus-attachments/${item.storedName}`;
  const lead = around?.before && !/\s/.test(around.before) ? "\n" : "";
  const trail = around?.after && !/\s/.test(around.after) ? "\n" : "";
  return `${lead}${note}${trail}`;
}

function attachmentMatchesChip(item: ChatAttachment, name: string): boolean {
  return (
    item.name === name ||
    item.storedName === name ||
    sanitizePasteChipName(item.name) === name ||
    sanitizePasteChipName(item.storedName) === name
  );
}

/** Put clipboard chips at their caret tokens; leftover +/drop files stay a trailing list. */
export function applyAttachmentPromptNote(content: string, attachments: ChatAttachment[]): string {
  const unused = [...attachments];
  const replaced = content.replace(
    new RegExp(PASTE_CHIP_RE.source, "g"),
    (full, name: string, offset: number) => {
      const index = unused.findIndex((item) => attachmentMatchesChip(item, name));
      if (index < 0) return full;
      const item = unused[index]!;
      unused.splice(index, 1);
      return attachmentInlineNote(item, {
        before: offset > 0 ? content[offset - 1] : " ",
        after: content[offset + full.length] ?? " ",
      });
    },
  );
  const note = attachmentPromptNote(unused);
  const body = replaced.trim();
  if (note) return body ? `${body}\n\n${note}` : note;
  return body;
}

export function firstImageBase64(incoming: IncomingAttachment[]): string | undefined {
  const image = incoming.find((item) => item.mime.startsWith("image/"));
  return image?.contentBase64;
}

export function firstImageAttachment(attachments: ChatAttachment[]): ChatAttachment | undefined {
  return attachments.find((item) => item.mime.startsWith("image/"));
}

export async function storedImageBase64(
  dataDir: string,
  sessionId: string,
  attachments: ChatAttachment[],
): Promise<{ base64: string; mime: string } | undefined> {
  const image = firstImageAttachment(attachments);
  if (!image) return undefined;
  try {
    const buf = await readFile(attachmentDest(dataDir, sessionId, image.storedName));
    if (!buf.length) return undefined;
    return { base64: buf.toString("base64"), mime: image.mime };
  } catch {
    return undefined;
  }
}

function enhanceLandedPhoto(bytes: Buffer): { photo: Buffer; mask: Buffer } | undefined {
  if (!isPng(bytes)) return undefined;
  const decoded = decodePngRgba(bytes);
  if (!decoded || decoded.width * decoded.height > MAX_ENHANCE_PIXELS) return undefined;
  enhanceAssetRgba(decoded.data, decoded.width, decoded.height);
  const cut = cutoutAssetRgba(decoded.data, decoded.width, decoded.height);
  if (cut.confidence !== "high") return undefined;
  const mask = new Uint8ClampedArray(decoded.width * decoded.height * 4);
  for (let i = 0; i < decoded.width * decoded.height; i++) {
    const a = decoded.data[i * 4 + 3]!;
    mask[i * 4] = a;
    mask[i * 4 + 1] = a;
    mask[i * 4 + 2] = a;
    mask[i * 4 + 3] = 255;
  }
  return {
    photo: encodePngRgba(decoded.width, decoded.height, decoded.data),
    mask: encodePngRgba(decoded.width, decoded.height, mask),
  };
}

async function writeWorkspaceBytes(
  root: string,
  rel: string,
  bytes: Buffer,
  mime: string,
): Promise<void> {
  const clean = sanitizeWorkspaceRel(rel);
  if (!clean) throw new Error("Invalid attachment filename");
  const dest = resolve(root, clean);
  const relToRoot = relative(resolve(root), dest);
  if (!relToRoot || relToRoot.startsWith("..") || relToRoot.split("/").includes("..")) {
    throw new Error("Invalid attachment filename");
  }
  if (mime.startsWith("text/") || mime === "application/json") {
    await writeWorkspaceFile(root, clean, bytes.toString("utf8"));
    return;
  }
  await mkdir(root, { recursive: true });
  const parent = dirname(dest);
  await mkdir(parent, { recursive: true });
  try {
    const parentInfo = await lstat(parent);
    if (parentInfo.isSymbolicLink()) throw new Error("Refusing to write through a symlink");
  } catch (err) {
    if (err instanceof Error && err.message.includes("symlink")) throw err;
  }
  try {
    const existing = await lstat(dest);
    if (existing.isSymbolicLink()) await unlink(dest);
    else if (!existing.isFile()) throw new Error("Invalid attachment filename");
  } catch (err) {
    if (
      (err as NodeJS.ErrnoException).code !== "ENOENT" &&
      err instanceof Error &&
      err.message.includes("Invalid")
    ) {
      throw err;
    }
  }
  await writeFile(dest, bytes);
}
