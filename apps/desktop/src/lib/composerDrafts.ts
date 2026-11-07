const PREFIX = "locus.composerDraft.";
const MAX_CHARS = 20_000;

type LiveComposerDraft = { text: string; files: File[] };
const liveComposerDrafts = new Map<string, LiveComposerDraft>();

export function readLiveComposerDraft(id: string | undefined): LiveComposerDraft {
  if (!id) return { text: "", files: [] };
  const mem = liveComposerDrafts.get(id);
  if (mem) return { text: mem.text, files: [...mem.files] };
  return { text: loadComposerDraft(id), files: [] };
}

export function writeLiveComposerDraft(
  id: string | undefined,
  current: LiveComposerDraft,
  empty: "keep" | "clear",
): void {
  if (!id) return;
  if (current.text || current.files.length) {
    liveComposerDrafts.set(id, { text: current.text, files: [...current.files] });
    saveComposerDraft(id, current.text);
    return;
  }
  if (empty === "keep") return;
  liveComposerDrafts.delete(id);
  clearComposerDraft(id);
}

export function resetComposerDrafts(): void {
  liveComposerDrafts.clear();
  clearAllComposerDrafts();
}

export function composerDraftKey(sessionId: string): string {
  return `${PREFIX}${sessionId}`;
}

export function loadComposerDraft(
  sessionId: string,
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): string {
  if (!storage || !sessionId) return "";
  try {
    const raw = storage.getItem(composerDraftKey(sessionId));
    return typeof raw === "string" ? raw.slice(0, MAX_CHARS) : "";
  } catch {
    return "";
  }
}

export function saveComposerDraft(
  sessionId: string,
  text: string,
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined = globalThis.localStorage,
): void {
  if (!storage || !sessionId) return;
  try {
    const trimmed = text.slice(0, MAX_CHARS);
    if (!trimmed.trim()) {
      storage.removeItem(composerDraftKey(sessionId));
      return;
    }
    storage.setItem(composerDraftKey(sessionId), trimmed);
  } catch {
    /* quota / private mode */
  }
}

export function clearComposerDraft(
  sessionId: string,
  storage: Pick<Storage, "removeItem"> | undefined = globalThis.localStorage,
): void {
  if (!storage || !sessionId) return;
  try {
    storage.removeItem(composerDraftKey(sessionId));
  } catch {
    /* quota / private mode */
  }
}

export function clearAllComposerDrafts(
  storage: Pick<Storage, "length" | "key" | "removeItem"> | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    /* ignore */
  }
}
