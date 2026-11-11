export const SIDEBAR_PREFS_KEY = "locus.sidebarPrefs";
export const MOBILE_AGENT_FILTER_KEY = "locus.mobileAgentFilter";

export const SIDEBAR_WIDTH_MIN = 240;
export const SIDEBAR_WIDTH_MAX = 480;
export const SIDEBAR_WIDTH_DEFAULT = 340;

export type MobileAgentFilterPref = "all" | "needs" | "running" | "unseen";
export type SidebarListFilter = MobileAgentFilterPref;
export type SidebarGroupBy = "day" | "repo" | "status";

export interface SidebarPrefs {
  showArchived: boolean;
  runningOnly: boolean;
  showHiddenTeammates: boolean;
  queries: Partial<Record<string, string>>;
  width: number;
  /** Pinned rail section ids. Omitted means the default primary list. */
  pinnedSections?: string[];
  listFilter: SidebarListFilter;
  groupBy: SidebarGroupBy;
}

const FILTERS: readonly MobileAgentFilterPref[] = ["all", "needs", "running", "unseen"];
const GROUPS: readonly SidebarGroupBy[] = ["day", "repo", "status"];

function clampWidth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)));
}

export function loadSidebarPrefs(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): SidebarPrefs {
  const fallback: SidebarPrefs = {
    showArchived: false,
    runningOnly: false,
    showHiddenTeammates: false,
    queries: {},
    width: SIDEBAR_WIDTH_DEFAULT,
    listFilter: "all",
    groupBy: "day",
  };
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(SIDEBAR_PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SidebarPrefs>;
    const queries =
      parsed.queries && typeof parsed.queries === "object" && !Array.isArray(parsed.queries)
        ? Object.fromEntries(
            Object.entries(parsed.queries).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : {};
    const pinnedSections = Array.isArray(parsed.pinnedSections)
      ? parsed.pinnedSections.filter((id): id is string => typeof id === "string" && id.length > 0)
      : undefined;
    return {
      showArchived: parsed.showArchived === true,
      runningOnly: parsed.runningOnly === true,
      showHiddenTeammates: parsed.showHiddenTeammates === true,
      queries,
      width: clampWidth(parsed.width),
      pinnedSections: pinnedSections?.length ? pinnedSections : undefined,
      listFilter:
        parsed.listFilter && (FILTERS as readonly string[]).includes(parsed.listFilter)
          ? parsed.listFilter
          : "all",
      groupBy:
        parsed.groupBy && (GROUPS as readonly string[]).includes(parsed.groupBy)
          ? parsed.groupBy
          : "day",
    };
  } catch {
    return fallback;
  }
}

export function saveSidebarPrefs(
  prefs: Partial<SidebarPrefs>,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  const current = loadSidebarPrefs(storage);
  const next: SidebarPrefs = {
    showArchived: prefs.showArchived ?? current.showArchived,
    runningOnly: prefs.runningOnly ?? current.runningOnly,
    showHiddenTeammates: prefs.showHiddenTeammates ?? current.showHiddenTeammates,
    queries: prefs.queries ?? current.queries,
    width: clampWidth(prefs.width ?? current.width),
    pinnedSections:
      prefs.pinnedSections !== undefined ? prefs.pinnedSections : current.pinnedSections,
    listFilter: prefs.listFilter ?? current.listFilter,
    groupBy: prefs.groupBy ?? current.groupBy,
  };
  if (!next.pinnedSections?.length) delete next.pinnedSections;
  storage.setItem(SIDEBAR_PREFS_KEY, JSON.stringify(next));
  try {
    storage.setItem(MOBILE_AGENT_FILTER_KEY, next.listFilter);
  } catch {
    /* quota / private mode */
  }
}

export function loadMobileAgentFilter(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): MobileAgentFilterPref {
  if (!storage) return "all";
  try {
    const raw = storage.getItem(MOBILE_AGENT_FILTER_KEY);
    if (raw && (FILTERS as readonly string[]).includes(raw)) {
      return raw as MobileAgentFilterPref;
    }
  } catch {
    /* quota / private mode */
  }
  return loadSidebarPrefs(storage).listFilter;
}

export function saveMobileAgentFilter(
  filter: MobileAgentFilterPref,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  try {
    storage.setItem(MOBILE_AGENT_FILTER_KEY, filter);
  } catch {
    /* quota / private mode */
  }
  saveSidebarPrefs({ listFilter: filter }, storage);
}
