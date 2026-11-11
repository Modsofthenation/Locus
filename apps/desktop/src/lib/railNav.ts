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

/** Home surfaces that stay on the rail even when the operator customizes pins. */
export function lockedRailSections(mode: ProductMode = "developer"): readonly UiSection[] {
  return mode === "swarm" ? ["agents", "project"] : ["agents"];
}

export function railCatalog(mode: ProductMode = "developer"): UiSection[] {
  return [...primaryRailSections(mode), ...moreRailSections(mode)];
}

function isRailSection(value: string, mode: ProductMode): value is UiSection {
  return (railCatalog(mode) as string[]).includes(value);
}

/**
 * Split the catalog into pinned rail icons vs More.
 * `pinned` omitted (or empty of known ids) restores the default primary list.
 * Locked home tabs stay first; any extra pins keep the order they were saved in.
 */
export function resolveRailSections(
  mode: ProductMode = "developer",
  pinned?: readonly string[],
): { primary: UiSection[]; more: UiSection[] } {
  const catalog = railCatalog(mode);
  const locked = lockedRailSections(mode);
  const known = (pinned ?? []).filter((id): id is UiSection => isRailSection(id, mode));
  const chosen = known.length ? known : [...primaryRailSections(mode)];
  const seen = new Set<UiSection>();
  const primary: UiSection[] = [];
  for (const id of [...locked, ...chosen]) {
    if (seen.has(id)) continue;
    seen.add(id);
    primary.push(id);
  }
  return {
    primary,
    more: catalog.filter((id) => !seen.has(id)),
  };
}

export function isLockedRailSection(section: UiSection, mode: ProductMode = "developer"): boolean {
  return (lockedRailSections(mode) as readonly string[]).includes(section);
}

export function pinRailSection(
  mode: ProductMode,
  current: readonly string[] | undefined,
  section: UiSection,
): UiSection[] {
  const { primary } = resolveRailSections(mode, current);
  if (primary.includes(section) || !isRailSection(section, mode)) return primary;
  return resolveRailSections(mode, [...primary, section]).primary;
}

export function unpinRailSection(
  mode: ProductMode,
  current: readonly string[] | undefined,
  section: UiSection,
): UiSection[] {
  if (isLockedRailSection(section, mode)) return resolveRailSections(mode, current).primary;
  const { primary } = resolveRailSections(mode, current);
  return resolveRailSections(
    mode,
    primary.filter((id) => id !== section),
  ).primary;
}

/** Inbox plus pinned rail icons, capped at 9 for Alt+1–9. */
export function railShortcutTargets(
  mode: ProductMode = "developer",
  pinned?: readonly string[],
): Array<"inbox" | UiSection> {
  const targets: Array<"inbox" | UiSection> = [
    "inbox",
    ...resolveRailSections(mode, pinned).primary,
  ];
  return targets.slice(0, 9);
}

function movableIndex(
  mode: ProductMode,
  primary: readonly UiSection[],
  section: UiSection,
): number {
  if (isLockedRailSection(section, mode)) return -1;
  return primary.indexOf(section);
}

/** Swap a non-locked pin one slot toward the top or bottom. Locked tabs stay first. */
export function moveRailSection(
  mode: ProductMode,
  current: readonly string[] | undefined,
  section: UiSection,
  delta: -1 | 1,
): UiSection[] {
  const { primary } = resolveRailSections(mode, current);
  const index = movableIndex(mode, primary, section);
  if (index < 0) return primary;
  const floor = lockedRailSections(mode).length;
  const nextIndex = index + delta;
  if (nextIndex < floor || nextIndex >= primary.length) return primary;
  const next = [...primary];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item!);
  return next;
}

/** Drop `section` onto `target` in the pinned list. Locked tabs cannot move or be displaced. */
export function reorderRailSections(
  mode: ProductMode,
  current: readonly string[] | undefined,
  section: UiSection,
  target: UiSection,
): UiSection[] {
  const { primary } = resolveRailSections(mode, current);
  if (section === target) return primary;
  const from = movableIndex(mode, primary, section);
  const to = primary.indexOf(target);
  const floor = lockedRailSections(mode).length;
  if (from < 0 || to < floor) return primary;
  const next = [...primary];
  const [item] = next.splice(from, 1);
  const insert = next.indexOf(target);
  if (insert < 0) return primary;
  next.splice(insert, 0, item!);
  return next;
}
