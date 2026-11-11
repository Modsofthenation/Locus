import { describe, expect, it } from "vitest";
import {
  isLockedRailSection,
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
  it("keeps five daily surfaces on the rail and the rest behind More", () => {
    expect([...PRIMARY_RAIL_SECTIONS]).toEqual([
      "agents",
      "design",
      "ide",
      "codebase",
      "automations",
    ]);
    expect([...MORE_RAIL_SECTIONS]).toEqual([
      "games",
      "assets",
      "board",
      "project",
      "brain",
      "slack",
      "grafana",
      "docker",
    ]);
    expect(isMoreRailSection("slack")).toBe(true);
    expect(isMoreRailSection("games")).toBe(true);
    expect(isMoreRailSection("codebase")).toBe(false);
    expect(isMoreRailSection("automations")).toBe(false);
    expect(isMoreRailSection("agents")).toBe(false);
    expect(isMoreRailSection("settings")).toBe(false);
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
    const withoutDesign = unpinRailSection("developer", undefined, "design");
    expect(withoutDesign).not.toContain("design");
    expect(resolveRailSections("developer", withoutDesign).more[0]).toBe("design");
    expect(unpinRailSection("developer", withoutDesign, "agents")).toContain("agents");
    expect(resolveRailSections("swarm").primary).toEqual(["agents", "project"]);
    expect(unpinRailSection("swarm", undefined, "project")).toContain("project");
  });

  it("keeps pin order and can move a non-locked icon", () => {
    const pinned = pinRailSection("developer", undefined, "games");
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
    expect(railShortcutTargets("developer")).toEqual([
      "inbox",
      "agents",
      "design",
      "ide",
      "codebase",
      "automations",
    ]);
  });
});
