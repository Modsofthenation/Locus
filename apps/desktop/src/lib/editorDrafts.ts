const PREFIX = "locus.ideDrafts.";
const MAX_FILES = 12;
const MAX_BYTES = 200_000;

export function draftStorageKey(sessionId: string): string {
  return `${PREFIX}${sessionId}`;
}

export function loadEditorDrafts(
  sessionId: string,
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): Record<string, string> {
  if (!storage || !sessionId) return {};
  try {
    const parsed = JSON.parse(storage.getItem(draftStorageKey(sessionId)) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [path, content] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof content === "string" && path.trim()) out[path] = content;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveEditorDrafts(
  sessionId: string,
  drafts: Record<string, string>,
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined = globalThis.localStorage,
): void {
  if (!storage || !sessionId) return;
  const entries = Object.entries(drafts)
    .filter(([, content]) => content.length <= MAX_BYTES)
    .slice(0, MAX_FILES);
  if (!entries.length) {
    try {
      storage.removeItem(draftStorageKey(sessionId));
    } catch {
      /* quota / private mode */
    }
    return;
  }
  try {
    storage.setItem(draftStorageKey(sessionId), JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* quota / private mode */
  }
}
