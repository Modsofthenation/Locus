import type { LocusConfig, ProductMode } from "@locus/shared";

export type SettingsTab =
  | "providers"
  | "appearance"
  | "notifications"
  | "machines"
  | "workers"
  | "environments"
  | "git"
  | "integrations"
  | "mcp"
  | "skills"
  | "benchmark"
  | "phone"
  | "chrome"
  | "advanced"
  | "about";

export const SETTINGS_NAV_GROUPS: { label: string; items: SettingsTab[] }[] = [
  { label: "Models", items: ["providers", "mcp", "skills", "benchmark"] },
  { label: "Workspace", items: ["machines", "workers", "environments", "git", "integrations"] },
  {
    label: "System",
    items: ["appearance", "notifications", "phone", "chrome", "advanced", "about"],
  },
];

/** Swarm-facing settings — providers, light system prefs, and Advanced limits. */
export const SWARM_SETTINGS_NAV_GROUPS: { label: string; items: SettingsTab[] }[] = [
  { label: "Swarm", items: ["providers", "appearance", "notifications", "advanced", "about"] },
];

export const DEFAULT_SWARM_SETTINGS_TAB: SettingsTab = "appearance";

export function settingsNavGroupsForMode(
  mode: ProductMode = "developer",
): { label: string; items: SettingsTab[] }[] {
  return mode === "swarm" ? SWARM_SETTINGS_NAV_GROUPS : SETTINGS_NAV_GROUPS;
}

export function isSwarmSettingsTab(tab: SettingsTab): boolean {
  return SWARM_SETTINGS_NAV_GROUPS.some((group) => group.items.includes(tab));
}

export function settingsNavLabel(tab: SettingsTab): string {
  if (tab === "mcp") return "MCP";
  if (tab === "chrome") return "Chrome";
  return tab[0]!.toUpperCase() + tab.slice(1);
}

export function settingsNavCount(
  tab: SettingsTab,
  config: LocusConfig | null | undefined,
): number | undefined {
  if (!config) return undefined;
  if (tab === "providers") return config.providers?.length;
  if (tab === "mcp") return (config.mcpServers ?? []).length;
  if (tab === "skills") return (config.skills ?? []).length;
  if (tab === "workers") return (config.workers ?? []).length;
  if (tab === "environments") return (config.namedEnvironments ?? []).length;
  return undefined;
}

export function settingsNavTabs(mode: ProductMode = "developer"): SettingsTab[] {
  return settingsNavGroupsForMode(mode).flatMap((group) => group.items);
}

export type SettingsSearchHit = {
  tab: SettingsTab;
  id?: string;
  label: string;
};

function matchesQuery(text: string, query: string): boolean {
  return text.toLowerCase().includes(query);
}

/** Tab names plus provider / MCP / skill / worker / environment / forge / integration titles. */
export function settingsSearchHits(
  config: LocusConfig | null | undefined,
  query: string,
  mode: ProductMode = "developer",
): SettingsSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SettingsSearchHit[] = [];
  const seen = new Set<string>();
  function add(hit: SettingsSearchHit) {
    const key = `${hit.tab}:${hit.id ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(hit);
  }
  for (const group of settingsNavGroupsForMode(mode)) {
    for (const tab of group.items) {
      const label = settingsNavLabel(tab);
      if (matchesQuery(label, q) || matchesQuery(tab, q) || matchesQuery(group.label, q)) {
        add({ tab, label });
      }
    }
  }
  if (!config) return hits;
  for (const row of config.providers) {
    if (matchesQuery(row.name, q) || matchesQuery(row.kind, q)) {
      add({ tab: "providers", id: row.id, label: row.name });
    }
  }
  if (mode === "swarm") return hits;
  for (const row of config.mcpServers ?? []) {
    if (
      matchesQuery(row.name, q) ||
      matchesQuery(row.command, q) ||
      matchesQuery(row.url ?? "", q)
    ) {
      add({ tab: "mcp", id: row.id, label: row.name });
    }
  }
  for (const row of config.skills ?? []) {
    if (matchesQuery(row.name, q) || matchesQuery(row.title, q)) {
      add({ tab: "skills", id: row.id, label: row.title || row.name });
    }
  }
  for (const row of config.templates) {
    if (matchesQuery(row.name, q) || matchesQuery(row.os, q)) {
      add({ tab: "machines", id: row.id, label: row.name });
    }
  }
  for (const row of config.workers ?? []) {
    if (matchesQuery(row.name, q) || matchesQuery(row.url, q)) {
      add({ tab: "workers", id: row.id, label: row.name });
    }
  }
  for (const row of config.namedEnvironments ?? []) {
    if (matchesQuery(row.name, q)) {
      add({ tab: "environments", id: row.id, label: row.name });
    }
  }
  for (const row of config.forges) {
    if (matchesQuery(row.name, q) || matchesQuery(row.kind, q) || matchesQuery(row.apiBaseUrl, q)) {
      add({ tab: "git", id: row.id, label: row.name });
    }
  }
  for (const row of config.integrations ?? []) {
    if (matchesQuery(row.name, q) || matchesQuery(row.kind, q)) {
      add({ tab: "integrations", id: row.id, label: row.name });
    }
  }
  return hits;
}
