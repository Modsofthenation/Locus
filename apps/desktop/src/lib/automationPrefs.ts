import type { AutomationListSort } from "@/lib/automations";

export const AUTOMATION_SIDEBAR_PREFS_KEY = "locus.automationSidebar";
export const AUTOMATION_DETAIL_PREFS_KEY = "locus.automationDetail";

export type AutomationJobFilter =
  "all" | "paused" | "failing" | "running" | "over-cap" | "needs-you";

export interface AutomationSidebarPrefs {
  filter: AutomationJobFilter;
  sort: AutomationListSort;
  /** Global fleet activity strip open/closed. Undefined = never set (auto-open on recent failure). */
  fleetOpen?: boolean;
}

export interface AutomationDetailPref {
  promptExpanded?: boolean;
  chipsExpanded?: boolean;
}

const FILTERS: readonly AutomationJobFilter[] = [
  "all",
  "paused",
  "failing",
  "running",
  "over-cap",
  "needs-you",
];
const SORTS: readonly AutomationListSort[] = ["priority", "schedule"];

function isFilter(value: unknown): value is AutomationJobFilter {
  return typeof value === "string" && (FILTERS as readonly string[]).includes(value);
}

function isSort(value: unknown): value is AutomationListSort {
  return typeof value === "string" && (SORTS as readonly string[]).includes(value);
}

export function loadAutomationSidebarPrefs(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): AutomationSidebarPrefs {
  const fallback: AutomationSidebarPrefs = { filter: "all", sort: "priority" };
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(AUTOMATION_SIDEBAR_PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AutomationSidebarPrefs>;
    return {
      filter: isFilter(parsed.filter) ? parsed.filter : "all",
      sort: isSort(parsed.sort) ? parsed.sort : "priority",
      ...(typeof parsed.fleetOpen === "boolean" ? { fleetOpen: parsed.fleetOpen } : {}),
    };
  } catch {
    return fallback;
  }
}

export function saveAutomationSidebarPrefs(
  prefs: Partial<AutomationSidebarPrefs>,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  const current = loadAutomationSidebarPrefs(storage);
  const next: AutomationSidebarPrefs = {
    filter: prefs.filter !== undefined && isFilter(prefs.filter) ? prefs.filter : current.filter,
    sort: prefs.sort !== undefined && isSort(prefs.sort) ? prefs.sort : current.sort,
  };
  if ("fleetOpen" in prefs) {
    if (typeof prefs.fleetOpen === "boolean") next.fleetOpen = prefs.fleetOpen;
  } else if (typeof current.fleetOpen === "boolean") {
    next.fleetOpen = current.fleetOpen;
  }
  storage.setItem(AUTOMATION_SIDEBAR_PREFS_KEY, JSON.stringify(next));
}

export function loadAutomationDetailPrefs(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): Record<string, AutomationDetailPref> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(AUTOMATION_DETAIL_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, AutomationDetailPref>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveAutomationDetailPref(
  id: string,
  patch: AutomationDetailPref,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage,
): void {
  if (!storage || !id) return;
  const all = loadAutomationDetailPrefs(storage);
  all[id] = { ...all[id], ...patch };
  storage.setItem(AUTOMATION_DETAIL_PREFS_KEY, JSON.stringify(all));
}

export function automationDetailPrefFor(
  id: string,
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): AutomationDetailPref {
  return loadAutomationDetailPrefs(storage)[id] ?? {};
}
