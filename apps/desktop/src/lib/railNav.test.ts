import { describe, expect, it } from "vitest";
import {
  effectiveRailPins,
  isLockedRailSection,
  LEGACY_PRIMARY_RAIL_SECTIONS,
  isMoreRailSection,
  MORE_RAIL_SECTIONS,
  PRIMARY_RAIL_SECTIONS,
  moveRailSection,
  pinRailSection,
  primaryRailSections,
  moreRailSections,
  railShortcutTargets,
  reorderRailSections,
  resolveRailSections,
  unpinRailSection,
} from "./railNav";

describe("railNav", () => {
  it("pins Agents and Codebase by default and puts the rest behind More", () => {
    expect([...PRIMARY_RAIL_SECTIONS]).toEqual(["agents", "codebase"]);
    expect([...MORE_RAIL_SECTIONS]).toEqual([
      "design",
      "games",
      "assets",
      "android",
      "ide",
      "automations",
      "board",
      "project",
      "brain",
      "slack",
      "grafana",
      "docker",
    ]);
    expect(isMoreRailSection("slack")).toBe(true);
    expect(isMoreRailSection("design")).toBe(true);
    expect(isMoreRailSection("automations")).toBe(true);
    expect(isMoreRailSection("codebase")).toBe(false);
    expect(isMoreRailSection("agents")).toBe(false);
    expect(isMoreRailSection("settings")).toBe(false);
  });

  it("keeps the old five-icon rail for legacy installs with no saved pins", () => {
    expect(effectiveRailPins("developer", undefined, "current")).toBeUndefined();
    expect(effectiveRailPins("developer", undefined, "legacy")).toEqual([
      ...LEGACY_PRIMARY_RAIL_SECTIONS,
    ]);
    const legacy = effectiveRailPins("developer", undefined, "legacy");
    expect(resolveRailSections("developer", legacy).primary).toEqual([
      "agents",
      "design",
      "ide",
      "codebase",
      "automations",
    ]);
    expect(resolveRailSections("developer", legacy).more).toEqual([
      "games",
      "assets",
      "android",
      "board",
      "project",
      "brain",
      "slack",
      "grafana",
      "docker",
    ]);
    expect(railShortcutTargets("developer", legacy)).toEqual([
      "inbox",
      "agents",
      "design",
      "ide",
      "codebase",
      "automations",
    ]);
    // Saved pins always win, and Swarm keeps its own default.
    expect(effectiveRailPins("developer", ["agents", "games"], "legacy")).toEqual([
      "agents",
      "games",
    ]);
    expect(effectiveRailPins("swarm", undefined, "legacy")).toBeUndefined();
  });

  it("promotes Teams in Locus Swarm and leaves Routines and Brain off the primary rail", () => {
    expect([...primaryRailSections("swarm")]).toEqual(["agents", "project"]);
    expect(isMoreRailSection("design", "swarm")).toBe(true);
    expect(isMoreRailSection("games", "swarm")).toBe(true);
    expect(isMoreRailSection("assets", "swarm")).toBe(true);
    expect(isMoreRailSection("project", "swarm")).toBe(false);
    expect(isMoreRailSection("automations", "swarm")).toBe(true);
    expect(isMoreRailSection("brain", "swarm")).toBe(true);
    expect(moreRailSections("swarm")).toContain("docker");
  });

  it("pins optional surfaces onto the rail and refuses to unpin the home section", () => {
    expect(resolveRailSections("developer").primary).toEqual([...PRIMARY_RAIL_SECTIONS]);
    expect(isLockedRailSection("agents")).toBe(true);
    expect(isLockedRailSection("design")).toBe(false);
    const withGames = pinRailSection("developer", undefined, "games");
    expect(withGames).toContain("games");
    expect(resolveRailSections("developer", withGames).more).not.toContain("games");
    const withoutDesign = unpinRailSection("developer", LEGACY_PRIMARY_RAIL_SECTIONS, "design");
    expect(withoutDesign).not.toContain("design");
    expect(resolveRailSections("developer", withoutDesign).more[0]).toBe("design");
    expect(unpinRailSection("developer", withoutDesign, "agents")).toContain("agents");
    expect(resolveRailSections("swarm").primary).toEqual(["agents", "project"]);
    expect(unpinRailSection("swarm", undefined, "project")).toContain("project");
  });

  it("keeps pin order and can move a non-locked icon", () => {
    const pinned = pinRailSection("developer", LEGACY_PRIMARY_RAIL_SECTIONS, "games");
    expect(pinned.at(-1)).toBe("games");
    const moved = moveRailSection("developer", pinned, "games", -1);
    expect(moved.at(-2)).toBe("games");
    expect(moved.at(-1)).toBe("automations");
    expect(reorderRailSections("developer", moved, "games", "design")).toEqual([
      "agents",
      "games",
      "design",
      "ide",
      "codebase",
      "automations",
    ]);
    expect(moveRailSection("developer", pinned, "agents", 1)).toEqual(
      resolveRailSections("developer", pinned).primary,
    );
    expect(railShortcutTargets("developer")).toEqual(["inbox", "agents", "codebase"]);
    expect(pinRailSection("developer", undefined, "design")).toEqual([
      "agents",
      "codebase",
      "design",
    ]);
  });
});
