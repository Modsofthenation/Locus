import {
  applyUnifiedDiff,
  normalizePatchCwd,
  parseUnifiedDiff,
  resolvePatchPath,
} from "@locus/shared";
import type { ToolResult } from "./types.js";

export const PATCH_REQUIRED = "patch is required";

export type PatchAbort = { abort: true };
export type PatchFail = { ok: false; output: string };
export type PatchRead = { content?: string } | PatchAbort | PatchFail;
export type PatchWrite = void | PatchAbort | PatchFail;

function isAbort(value: unknown): value is PatchAbort {
  return Boolean(value && typeof value === "object" && "abort" in value && value.abort === true);
}

function isFail(value: unknown): value is PatchFail {
  return Boolean(value && typeof value === "object" && "ok" in value && value.ok === false);
}

/**
 * Apply a unified diff through a Guest workspace store.
 * Docker/host/SSH/mock adapters supply FS transport; the hunk algorithm stays here.
 * Returning `undefined` means the caller should fall through (Docker bind-mount miss).
 */
export async function applyGuestPatch(input: {
  patch: string;
  requestedCwd: string;
  workspace: string;
  isFile: (path: string) => boolean;
  read: (path: string) => Promise<PatchRead>;
  write: (path: string, content: string) => Promise<PatchWrite>;
  remove: (path: string) => Promise<PatchWrite>;
}): Promise<ToolResult | undefined> {
  if (!input.patch.trim()) return { ok: false, output: PATCH_REQUIRED };
  const guestCwd = normalizePatchCwd(input.requestedCwd, input.workspace, (p) => input.isFile(p));
  const parsed = parseUnifiedDiff(input.patch);
  if (!parsed.length) {
    return {
      ok: false,
      output:
        "patch did not contain any file hunks (need --- a/ +++ b/ or *** Update File, plus @@ hunks; line numbers on @@ are optional)",
    };
  }
  const files = new Map<string, string>();
  for (const file of parsed) {
    const dest = resolvePatchPath(guestCwd, file.path);
    if (file.kind === "add") continue;
    const got = await input.read(dest);
    if (isAbort(got)) return undefined;
    if (isFail(got)) return got;
    if (got.content != null) files.set(dest, got.content);
  }
  try {
    const applied = applyUnifiedDiff(files, input.patch, guestCwd);
    for (const [guest, content] of applied.files) {
      const written = await input.write(guest, content);
      if (isAbort(written)) return undefined;
      if (isFail(written)) return written;
    }
    for (const [guest] of files) {
      if (applied.files.has(guest)) continue;
      const removed = await input.remove(guest);
      if (isAbort(removed)) return undefined;
      if (isFail(removed)) return removed;
    }
    return { ok: true, output: applied.output };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : "patch failed" };
  }
}
