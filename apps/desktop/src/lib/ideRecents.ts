export type IdeRecent = { path: string; title: string; at: number };

export const IDE_RECENTS_KEY = "locus.ideRecents";
const MAX_RECENTS = 8;

export function loadIdeRecents(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): IdeRecent[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(IDE_RECENTS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is IdeRecent => {
        if (!row || typeof row !== "object") return false;
        const item = row as Partial<IdeRecent>;
        return typeof item.path === "string" && item.path.trim().length > 0;
      })
      .map((row) => ({
        path: row.path.trim(),
        title:
          typeof row.title === "string" && row.title.trim()
            ? row.title.trim()
            : folderName(row.path),
        at: typeof row.at === "number" ? row.at : 0,
      }))
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function rememberIdeRecent(
  path: string,
  title?: string,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage,
): IdeRecent[] {
  const clean = path.trim();
  if (!clean || !storage) return loadIdeRecents(storage);
  const next: IdeRecent[] = [
    {
      path: clean,
      title: (title ?? folderName(clean)).trim() || folderName(clean),
      at: Date.now(),
    },
    ...loadIdeRecents(storage).filter((row) => row.path !== clean),
  ].slice(0, MAX_RECENTS);
  try {
    storage.setItem(IDE_RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}

export function folderName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) || "Workspace";
}
