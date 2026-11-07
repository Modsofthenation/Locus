const PREFIX = "locus.explorerExpanded.";
const MAX_PATHS = 400;

export function explorerExpandedKey(sessionId: string): string {
  return `${PREFIX}${sessionId}`;
}

export function loadExplorerExpanded(
  sessionId: string,
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): Set<string> {
  if (!storage || !sessionId) return new Set();
  try {
    const parsed = JSON.parse(storage.getItem(explorerExpandedKey(sessionId)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return new Set();
    const paths = parsed
      .filter((path): path is string => typeof path === "string" && path.trim().length > 0)
      .map((path) => path.trim())
      .slice(0, MAX_PATHS);
    return new Set(paths);
  } catch {
    return new Set();
  }
}

export function saveExplorerExpanded(
  sessionId: string,
  expanded: Iterable<string>,
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined = globalThis.localStorage,
): void {
  if (!storage || !sessionId) return;
  const paths = [...expanded]
    .map((path) => path.trim())
    .filter(Boolean)
    .slice(0, MAX_PATHS);
  try {
    if (!paths.length) {
      storage.removeItem(explorerExpandedKey(sessionId));
      return;
    }
    storage.setItem(explorerExpandedKey(sessionId), JSON.stringify(paths));
  } catch {
    /* quota / private mode */
  }
}
