import { allSplitPaths, parseEditorSplit, type EditorSplit } from "./editorSplit";

const PREFIX = "locus.editorOpenFiles.";
const MAX_PATHS = 80;

export type EditorOpenFiles = {
  paths: string[];
  active: string;
  split?: EditorSplit;
};

export function editorOpenFilesKey(sessionId: string): string {
  return `${PREFIX}${sessionId}`;
}

function cleanPath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const next = path.trim();
  return next ? next : null;
}

export function loadEditorOpenFiles(
  sessionId: string,
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): EditorOpenFiles {
  if (!storage || !sessionId) return { paths: [], active: "" };
  try {
    const parsed = JSON.parse(storage.getItem(editorOpenFilesKey(sessionId)) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") return { paths: [], active: "" };
    const raw = parsed as { paths?: unknown; active?: unknown; split?: unknown };
    if (!Array.isArray(raw.paths)) return { paths: [], active: "" };
    const paths: string[] = [];
    const seen = new Set<string>();
    for (const item of raw.paths) {
      const path = cleanPath(item);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      paths.push(path);
      if (paths.length >= MAX_PATHS) break;
    }
    const split = parseEditorSplit(raw.split);
    if (split) {
      for (const path of [...split.groups[0].paths, ...split.groups[1].paths]) {
        if (seen.has(path) || paths.length >= MAX_PATHS) continue;
        seen.add(path);
        paths.push(path);
      }
    }
    const active = cleanPath(raw.active);
    return {
      paths,
      active: active && seen.has(active) ? active : (paths.at(-1) ?? ""),
      split: split ?? undefined,
    };
  } catch {
    return { paths: [], active: "" };
  }
}

export function saveEditorOpenFiles(
  sessionId: string,
  paths: Iterable<string>,
  active = "",
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined = globalThis.localStorage,
  split?: EditorSplit | null,
): void {
  if (!storage || !sessionId) return;
  const next: string[] = [];
  const seen = new Set<string>();
  for (const item of paths) {
    const path = cleanPath(item);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    next.push(path);
    if (next.length >= MAX_PATHS) break;
  }
  if (split) {
    for (const path of allSplitPaths(split)) {
      if (path && !seen.has(path) && next.length < MAX_PATHS) {
        seen.add(path);
        next.push(path);
      }
    }
  }
  try {
    if (!next.length) {
      storage.removeItem(editorOpenFilesKey(sessionId));
      return;
    }
    const focus = cleanPath(active);
    const payload: EditorOpenFiles = {
      paths: next,
      active: focus && seen.has(focus) ? focus : (next.at(-1) ?? ""),
    };
    if (split) payload.split = split;
    storage.setItem(editorOpenFilesKey(sessionId), JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}
