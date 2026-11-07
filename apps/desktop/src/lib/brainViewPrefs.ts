import { isBrainGraphLayoutId, type BrainGraphLayoutId } from "./brainGraph";

/** Host-global: Brain is one shared document, not per Host checkout. */
export const BRAIN_VIEW_PREFS_KEY = "locus.brainView";

export type BrainSegment = "graph" | "memories" | "inbox" | "activity";

export interface BrainViewPrefs {
  segment: BrainSegment;
  /** Indexed checkout key, or null for All. */
  repoKey: string | null;
  layout: BrainGraphLayoutId;
}

const SEGMENTS: readonly BrainSegment[] = ["graph", "memories", "inbox", "activity"];

export function isBrainSegment(value: unknown): value is BrainSegment {
  return typeof value === "string" && (SEGMENTS as readonly string[]).includes(value);
}

export function loadBrainViewPrefs(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): BrainViewPrefs {
  const fallback: BrainViewPrefs = { segment: "graph", repoKey: null, layout: "layers" };
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(BRAIN_VIEW_PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<BrainViewPrefs>;
    return {
      segment: isBrainSegment(parsed.segment) ? parsed.segment : "graph",
      repoKey:
        typeof parsed.repoKey === "string" && parsed.repoKey.trim() ? parsed.repoKey.trim() : null,
      layout: isBrainGraphLayoutId(parsed.layout) ? parsed.layout : "layers",
    };
  } catch {
    return fallback;
  }
}

export function saveBrainViewPrefs(
  prefs: BrainViewPrefs,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
): void {
  storage?.setItem(BRAIN_VIEW_PREFS_KEY, JSON.stringify(prefs));
}

/** Open Brain on the correction inbox the next time the pane mounts. */
export function rememberBrainInbox(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage,
): void {
  saveBrainViewPrefs({ ...loadBrainViewPrefs(storage), segment: "inbox" }, storage);
}
