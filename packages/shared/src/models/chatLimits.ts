export const MAX_CHAT_CHARS = 120_000;
export const MAX_CHAT_ATTACHMENTS = 8;
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;
/** Non-image attachments are capped much lower; they ride along inside the transcript. */
export const MAX_CHAT_FILE_BYTES = 1_500_000;

export function chatTextTooLong(text: string): boolean {
  return text.length > MAX_CHAT_CHARS;
}

export function chatInputError(text: string, attachmentCount = 0): string | undefined {
  if (chatTextTooLong(text)) {
    return `Message is too long (max ${MAX_CHAT_CHARS.toLocaleString("en-US")} characters)`;
  }
  if (attachmentCount > MAX_CHAT_ATTACHMENTS) {
    return `At most ${MAX_CHAT_ATTACHMENTS} attachments`;
  }
  return undefined;
}

/** Per-file byte cap matching the server: images get more headroom than other files. */
export function chatAttachmentByteCap(mime?: string): number {
  return mime?.startsWith("image/") ? MAX_CHAT_IMAGE_BYTES : MAX_CHAT_FILE_BYTES;
}

/**
 * First oversize attachment, if any. Checked when a file is picked so a 40 MB
 * screenshot fails immediately instead of after upload.
 */
export function firstOversizeAttachment(
  files: Array<{ name: string; size?: number; type?: string }>,
): string | undefined {
  for (const file of files) {
    const cap = chatAttachmentByteCap(file.type);
    if (typeof file.size === "number" && file.size > cap) {
      return `${file.name} is too large (max ${Math.round(cap / (1024 * 1024))} MB)`;
    }
  }
  return undefined;
}
