export const PALETTE_RECENTS_KEY = "locus.palette.recents";
const MAX_RECENTS = 8;

export function loadPaletteRecents(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): string[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(PALETTE_RECENTS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is string => typeof row === "string" && row.trim().length > 0)
      .map((row) => row.trim())
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function rememberPaletteRecent(
  id: string,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage,
): string[] {
  const clean = id.trim();
  if (!clean || !storage) return loadPaletteRecents(storage);
  const next = [clean, ...loadPaletteRecents(storage).filter((row) => row !== clean)].slice(
    0,
    MAX_RECENTS,
  );
  try {
    storage.setItem(PALETTE_RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}
