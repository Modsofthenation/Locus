import type { ProductMode } from "@locus/shared";
import type { UiSection } from "@/state/store";

/** Daily coding surfaces — always on the icon rail. */
export const PRIMARY_RAIL_SECTIONS = [
  "agents",
  "design",
  "ide",
  "codebase",
  "automations",
] as const;
/** Secondary surfaces — behind the More overflow. */
export const MORE_RAIL_SECTIONS = [
  "games",
  "assets",
  "board",
  "project",
  "brain",
  "slack",
  "grafana",
  "docker",
] as const;

export const SWARM_PRIMARY_RAIL_SECTIONS = ["agents", "project"] as const;
export const SWARM_MORE_RAIL_SECTIONS = [
  "design",
  "games",
  "assets",
  "ide",
  "automations",
  "board",
  "codebase",
  "brain",
  "slack",
  "grafana",
  "docker",
] as const;

export type PrimaryRailSection = (typeof PRIMARY_RAIL_SECTIONS)[number];
export type MoreRailSection = (typeof MORE_RAIL_SECTIONS)[number];

export function primaryRailSections(mode: ProductMode = "developer"): readonly UiSection[] {
  return mode === "swarm" ? SWARM_PRIMARY_RAIL_SECTIONS : PRIMARY_RAIL_SECTIONS;
}

/** Sections listed in the rail More menu. */
export function moreRailSections(mode: ProductMode = "developer"): readonly UiSection[] {
  return mode === "swarm" ? SWARM_MORE_RAIL_SECTIONS : MORE_RAIL_SECTIONS;
}

export function isMoreRailSection(section: UiSection, mode: ProductMode = "developer"): boolean {
  return (moreRailSections(mode) as readonly string[]).includes(section);
}
