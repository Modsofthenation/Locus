import { describe, expect, it } from "vitest";
import {
  isMoreRailSection,
  MORE_RAIL_SECTIONS,
  PRIMARY_RAIL_SECTIONS,
  primaryRailSections,
  moreRailSections,
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
});
