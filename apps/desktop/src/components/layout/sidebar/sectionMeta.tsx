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
  IconReview,
  IconStack,
} from "../Icons";
import type { UiSection } from "@/state/store";

export type SectionMeta = { label: string; description: string; icon: ReactNode };

export const SECTION_META: Record<Exclude<UiSection, "settings">, SectionMeta> = {
  agents: { label: "Agents", description: "Start and resume agent chats", icon: <IconAgents /> },
  design: { label: "Design", description: "Prototype interfaces", icon: <IconPalette /> },
  games: { label: "Games", description: "Build and playtest games", icon: <IconGamepad /> },
  assets: { label: "Assets", description: "Create art and 3D models", icon: <IconCube /> },
  android: { label: "Android", description: "Build and test apps", icon: <IconFrame /> },
  ide: { label: "IDE", description: "Edit files in a workspace", icon: <IconFolder /> },
  board: { label: "Board", description: "Map ideas and tasks", icon: <IconFrame /> },
  project: { label: "Projects", description: "Coordinate a group of agents", icon: <IconStack /> },
  codebase: {
    label: "Codebase",
    description: "Browse repos, pull requests, and issues",
    icon: <IconRepo />,
  },
  reviews: {
    label: "Reviews",
    description: "Track reviews and manage Slack reviewers",
    icon: <IconReview />,
  },
  brain: { label: "Brain", description: "Explore shared agent knowledge", icon: <IconBrain /> },
  slack: { label: "Slack", description: "Read messages and threads", icon: <IconHash /> },
  grafana: { label: "Grafana", description: "Explore logs and dashboards", icon: <IconGrafana /> },
  docker: {
    label: "Docker",
    description: "Manage local containers and services",
    icon: <IconContainer />,
  },
  automations: {
    label: "Jobs",
    description: "Run agents on a schedule or trigger",
    icon: <IconClock />,
  },
};

export function sectionMetaFor(
  mode: ReturnType<typeof parseProductMode>,
): Record<Exclude<UiSection, "settings">, SectionMeta> {
  if (mode !== "swarm") return SECTION_META;
  return {
    ...SECTION_META,
    agents: {
      label: "Teammates",
      description: "Start and resume teammate chats",
      icon: <IconAgents />,
    },
    project: { label: "Teams", description: "Work with groups of teammates", icon: <IconStack /> },
    automations: {
      label: "Routines",
      description: "Run teammates on a schedule or trigger",
      icon: <IconClock />,
    },
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
  if (section === "android") return "Search Android projects";
  if (section === "board") return "Search boards";
  if (section === "project") {
    return mode === "swarm" ? "Search teams" : "Search projects";
  }
  if (section === "design") return "Search designs";
  if (section === "games") return "Search games";
  if (section === "assets") return "Search assets";
  if (section === "ide") return "Search workspaces";
  if (section === "codebase") return "Search repos";
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
