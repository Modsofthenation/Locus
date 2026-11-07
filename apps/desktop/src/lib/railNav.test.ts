import { describe, expect, it } from "vitest";
import {
  isMoreRailSection,
  MORE_RAIL_SECTIONS,
  PRIMARY_RAIL_SECTIONS,
  primaryRailSections,
  moreRailSections,
} from "./railNav";

describe("railNav", () => {
  it("keeps daily surfaces above the Automations separator and the rest below", () => {
    expect([...PRIMARY_RAIL_SECTIONS]).toEqual([
      "agents",
      "design",
      "games",
      "assets",
      "ide",
      "automations",
    ]);
    expect([...MORE_RAIL_SECTIONS]).toEqual([
      "board",
      "project",
      "codebase",
      "brain",
      "slack",
      "grafana",
      "docker",
    ]);
    expect(isMoreRailSection("slack")).toBe(true);
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
