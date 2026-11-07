import { afterEach, describe, expect, it } from "vitest";
import {
  SWARM_ROSTER_PREFS_KEY,
  addSwarmRosterSection,
  hideSwarmSession,
  loadSwarmRosterPrefs,
  moveSwarmSessionToSection,
  saveSwarmRosterPrefs,
  showSwarmSession,
} from "./swarmRosterPrefs";

describe("swarmRosterPrefs", () => {
  afterEach(() => {
    localStorage.removeItem(SWARM_ROSTER_PREFS_KEY);
  });

  it("loads empty prefs when missing or corrupt", () => {
    expect(loadSwarmRosterPrefs()).toEqual({ hiddenSessionIds: [], sections: [] });
    localStorage.setItem(SWARM_ROSTER_PREFS_KEY, "{not-json");
    expect(loadSwarmRosterPrefs()).toEqual({ hiddenSessionIds: [], sections: [] });
    localStorage.setItem(SWARM_ROSTER_PREFS_KEY, JSON.stringify({ hiddenSessionIds: "x" }));
    expect(loadSwarmRosterPrefs()).toEqual({ hiddenSessionIds: [], sections: [] });
  });

  it("persists hide/show and sections", () => {
    let prefs = hideSwarmSession(loadSwarmRosterPrefs(), "s1");
    prefs = addSwarmRosterSection(prefs, "Ops", "s2");
    saveSwarmRosterPrefs(prefs);
    const loaded = loadSwarmRosterPrefs();
    expect(loaded.hiddenSessionIds).toEqual(["s1"]);
    expect(loaded.sections).toHaveLength(1);
    expect(loaded.sections[0]?.name).toBe("Ops");
    expect(loaded.sections[0]?.sessionIds).toEqual(["s2"]);

    const restored = showSwarmSession(loaded, "s1");
    expect(restored.hiddenSessionIds).toEqual([]);
    const moved = moveSwarmSessionToSection(restored, "s2", null);
    expect(moved.sections[0]?.sessionIds).toEqual([]);
  });
});
