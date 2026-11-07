export const SIDEBAR_PREFS_KEY = "locus.sidebarPrefs";
export const MOBILE_AGENT_FILTER_KEY = "locus.mobileAgentFilter";

export type MobileAgentFilterPref = "all" | "needs" | "running" | "unseen";

export interface SidebarPrefs {
  showArchived: boolean;
  runningOnly: boolean;
  showHiddenTeammates: boolean;
  queries: Partial<Record<string, string>>;
}

const FILTERS: readonly MobileAgentFilterPref[] = ["all", "needs", "running", "unseen"];

export function loadSidebarPrefs(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): SidebarPrefs {
  const fallback: SidebarPrefs = {
    showArchived: false,
    runningOnly: false,
    showHiddenTeammates: false,
    queries: {},
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
    return {
      showArchived: parsed.showArchived === true,
      runningOnly: parsed.runningOnly === true,
      showHiddenTeammates: parsed.showHiddenTeammates === true,
      queries,
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
  };
  storage.setItem(SIDEBAR_PREFS_KEY, JSON.stringify(next));
}

export function loadMobileAgentFilter(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): MobileAgentFilterPref {
  if (!storage) return "all";
  try {
    const raw = storage.getItem(MOBILE_AGENT_FILTER_KEY);
    return raw && (FILTERS as readonly string[]).includes(raw)
      ? (raw as MobileAgentFilterPref)
      : "all";
  } catch {
    return "all";
  }
}

export function saveMobileAgentFilter(
  filter: MobileAgentFilterPref,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  try {
    storage.setItem(MOBILE_AGENT_FILTER_KEY, filter);
  } catch {
    /* quota / private mode */
  }
}
