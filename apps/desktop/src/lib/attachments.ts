import { uniquePasteChipName } from "@locus/shared";

const PASTE_IMAGE_TYPE = /^image\/(png|jpe?g|gif|webp)$/i;
const PASTE_IMAGE_NAME = /\.(png|jpe?g|gif|webp)$/i;

export type ClipboardFiles = {
  items?: ArrayLike<{
    kind?: string;
    type?: string;
    getAsFile?: () => File | null;
  } | null>;
  files?: ArrayLike<File | null | undefined>;
  getData?: (type: string) => string;
};

/** Long or multi-line pastes become a chip, not raw composer text. */
export const PASTE_TEXT_CHIP_MIN_CHARS = 2000;
export const PASTE_TEXT_CHIP_MIN_LINES = 3;
export const CLIPBOARD_FILENAME = "Clipboard.txt";

function isPasteableImage(file: File): boolean {
  const type = file.type.toLowerCase();
  if (PASTE_IMAGE_TYPE.test(type)) return true;
  if (type && !type.startsWith("image/")) return false;
  return PASTE_IMAGE_NAME.test(file.name);
}

export function isImageFile(file: File): boolean {
  return isPasteableImage(file);
}

function namedPastedImage(file: File): File {
  if (file.name.trim()) return file;
  const type = file.type.toLowerCase();
  const ext =
    type === "image/jpeg" || type === "image/jpg"
      ? "jpg"
      : type === "image/gif"
        ? "gif"
        : type === "image/webp"
          ? "webp"
          : "png";
  return new File([file], `pasted-image.${ext}`, {
    type: file.type || `image/${ext === "jpg" ? "jpeg" : ext}`,
    lastModified: file.lastModified,
  });
}

/** Files from a drag-and-drop (screenshots, logs, PDFs). */
export function filesFromDataTransfer(
  data: { files?: ArrayLike<File | null | undefined> } | null | undefined,
): File[] {
  if (!data?.files) return [];
  const out: File[] = [];
  for (let i = 0; i < data.files.length; i++) {
    const file = data.files[i];
    if (file) out.push(file);
  }
  return out;
}

export function pastedTextLineCount(text: string): number {
  if (!text) return 0;
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (!body) return 0;
  let lines = 1;
  for (let i = 0; i < body.length; i++) if (body.charCodeAt(i) === 10) lines++;
  return lines;
}

export function shouldAttachPastedText(text: string): boolean {
  if (!text) return false;
  if (text.length >= PASTE_TEXT_CHIP_MIN_CHARS) return true;
  return pastedTextLineCount(text) >= PASTE_TEXT_CHIP_MIN_LINES;
}

export function isPastedTextFile(file: File): boolean {
  return /^Clipboard(?: \d+)?\.txt$/i.test(file.name);
}

export function clipboardChipLabel(text: string): string {
  const n = pastedTextLineCount(text);
  const unit = n === 1 ? "line" : "lines";
  return `@Clipboard (${n} ${unit})`;
}

function uniqueClipboardName(usedNames: string[]): string {
  return uniquePasteChipName(CLIPBOARD_FILENAME, usedNames);
}

export function pastedTextFile(text: string, usedNames: string[] = []): File {
  return new File([text], uniqueClipboardName(usedNames), { type: "text/plain" });
}

/** Image files from a paste event (screenshot copy, browser "Copy image", Finder). */
export function imageFilesFromClipboard(data: ClipboardFiles | null | undefined): File[] {
  if (!data) return [];
  const out: File[] = [];
  const add = (file: File | null | undefined) => {
    if (!file || !isPasteableImage(file)) return;
    out.push(namedPastedImage(file));
  };
  const items = data.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || item.kind !== "file") continue;
      add(item.getAsFile?.() ?? null);
    }
  }
  if (!out.length && data.files) {
    for (let i = 0; i < data.files.length; i++) add(data.files[i]);
  }
  return out;
}

function withUniquePasteName(file: File, usedNames: string[]): File {
  const name = uniquePasteChipName(file.name, usedNames);
  if (name === file.name) return file;
  return new File([file], name, { type: file.type, lastModified: file.lastModified });
}

/** Screenshot images, or substantial pasted text as an @Clipboard chip. */
export function composerFilesFromClipboard(
  data: ClipboardFiles | null | undefined,
  usedNames: string[] = [],
): File[] {
  const images = imageFilesFromClipboard(data);
  if (images.length) {
    const used = [...usedNames];
    return images.map((file) => {
      const next = withUniquePasteName(file, used);
      used.push(next.name);
      return next;
    });
  }
  const text = data?.getData?.("text/plain") ?? "";
  if (!shouldAttachPastedText(text)) return [];
  return [pastedTextFile(text, usedNames)];
}

/** Read picked files into the base64 attachment payload the API expects. */
export async function filesToAttachments(
  files: File[],
): Promise<Array<{ name: string; mime?: string; contentBase64: string }>> {
  return Promise.all(
    files.slice(0, 4).map(
      (file) =>
        new Promise<{ name: string; mime?: string; contentBase64: string }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
          reader.onload = () => {
            const result = typeof reader.result === "string" ? reader.result : "";
            const comma = result.indexOf(",");
            const contentBase64 = comma >= 0 ? result.slice(comma + 1) : result;
            resolve({ name: file.name, mime: file.type || undefined, contentBase64 });
          };
          reader.readAsDataURL(file);
        }),
    ),
  );
}
