import type { ReactNode } from "react";
import { parseProductMode, type ForgeKind, type LinkedRepo } from "@locus/shared";
import {
  IconAgents,
  IconBrain,
  IconClock,
  IconContainer,
  IconCube,
  IconFolder,
  IconFrame,
  IconGamepad,
  IconGrafana,
  IconHash,
  IconPalette,
  IconRepo,
  IconStack,
} from "../Icons";
import type { UiSection } from "@/state/store";

export type SectionMeta = { label: string; railLabel?: string; icon: ReactNode };

export const SECTION_META: Record<Exclude<UiSection, "settings">, SectionMeta> = {
  agents: { label: "Agents", icon: <IconAgents /> },
  design: { label: "Design", icon: <IconPalette /> },
  games: { label: "Games", icon: <IconGamepad /> },
  assets: { label: "Assets", icon: <IconCube /> },
  ide: { label: "IDE", icon: <IconFolder /> },
  board: { label: "Board", icon: <IconFrame /> },
  project: { label: "Projects", icon: <IconStack /> },
  codebase: { label: "Codebase", icon: <IconRepo /> },
  brain: { label: "Brain", icon: <IconBrain /> },
  slack: { label: "Slack", icon: <IconHash /> },
  grafana: { label: "Grafana", icon: <IconGrafana /> },
  docker: { label: "Docker", icon: <IconContainer /> },
  // "Jobs" fits the 72px icon column; the pane, search, and More menu stay Automations.
  automations: { label: "Jobs", railLabel: "Jobs", icon: <IconClock /> },
};

export function sectionMetaFor(
  mode: ReturnType<typeof parseProductMode>,
): Record<Exclude<UiSection, "settings">, SectionMeta> {
  if (mode !== "swarm") return SECTION_META;
  return {
    ...SECTION_META,
    agents: { label: "Teammates", icon: <IconAgents /> },
    project: { label: "Teams", icon: <IconStack /> },
    automations: { label: "Routines", icon: <IconClock /> },
  };
}

export function sectionLabel(
  section: UiSection,
  mode: ReturnType<typeof parseProductMode> = "developer",
): string {
  if (section === "settings") return "Settings";
  return sectionMetaFor(mode)[section]?.label ?? "Agents";
}

export function sectionSearchPlaceholder(
  section: UiSection,
  mode: ReturnType<typeof parseProductMode> = "developer",
): string {
  if (section === "docker") return "Search containers or services";
  if (section === "automations") {
    return mode === "swarm" ? "Search routines" : "Search jobs";
  }
  if (section === "board") return "Search boards";
  if (section === "project") {
    return mode === "swarm" ? "Search teams" : "Search projects";
  }
  if (section === "design") return "Search designs";
  if (section === "games") return "Search games";
  if (section === "assets") return "Search assets";
  if (section === "ide") return "Search workspaces";
  if (section === "codebase") return "Search repos";
  if (section === "brain") return "Search claims";
  if (section === "slack") return "Search channels";
  if (section === "grafana") return "Search queries and dashboards";
  return mode === "swarm" ? "Search teammates" : "Search agents";
}

const FORGE_ORDER: ForgeKind[] = [
  "github",
  "gitlab",
  "bitbucket",
  "gitea",
  "forgejo",
  "azuredevops",
];

export function groupRepos(repos: LinkedRepo[]): Array<{ forge: ForgeKind; repos: LinkedRepo[] }> {
  const buckets = new Map<ForgeKind, LinkedRepo[]>();
  for (const row of repos) {
    const list = buckets.get(row.checkout.forge) ?? [];
    list.push(row);
    buckets.set(row.checkout.forge, list);
  }
  return FORGE_ORDER.filter((forge) => buckets.has(forge)).map((forge) => ({
    forge,
    repos: buckets.get(forge)!,
  }));
}
