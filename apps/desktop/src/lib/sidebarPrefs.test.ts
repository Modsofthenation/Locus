import { afterEach, describe, expect, it } from "vitest";
import {
  loadMobileAgentFilter,
  loadSidebarPrefs,
  MOBILE_AGENT_FILTER_KEY,
  saveMobileAgentFilter,
  saveSidebarPrefs,
  SIDEBAR_PREFS_KEY,
  SIDEBAR_WIDTH_DEFAULT,
} from "./sidebarPrefs";

describe("sidebarPrefs", () => {
  afterEach(() => {
    localStorage.removeItem(SIDEBAR_PREFS_KEY);
    localStorage.removeItem(MOBILE_AGENT_FILTER_KEY);
  });

  it("persists archived / running / hidden teammate filters", () => {
    saveSidebarPrefs({ showArchived: true, runningOnly: true, queries: { agents: "fix" } });
    expect(loadSidebarPrefs()).toEqual({
      showArchived: true,
      runningOnly: true,
      showHiddenTeammates: false,
      queries: { agents: "fix" },
      width: SIDEBAR_WIDTH_DEFAULT,
      listFilter: "all",
      groupBy: "day",
    });
  });

  it("persists width, rail pins, list filter, and grouping", () => {
    saveSidebarPrefs({
      width: 412,
      pinnedSections: ["agents", "games", "docker"],
      listFilter: "needs",
      groupBy: "repo",
    });
    expect(loadSidebarPrefs()).toMatchObject({
      width: 412,
      pinnedSections: ["agents", "games", "docker"],
      listFilter: "needs",
      groupBy: "repo",
    });
  });

  it("clamps width and ignores unknown filters", () => {
    localStorage.setItem(
      SIDEBAR_PREFS_KEY,
      JSON.stringify({ width: 900, listFilter: "nope", groupBy: "color" }),
    );
    expect(loadSidebarPrefs()).toMatchObject({
      width: 480,
      listFilter: "all",
      groupBy: "day",
    });
  });

  it("persists the phone agent chip filter", () => {
    saveMobileAgentFilter("needs");
    expect(loadMobileAgentFilter()).toBe("needs");
    expect(loadSidebarPrefs().listFilter).toBe("needs");
  });

  it("shares the desktop list filter with the phone when the phone key is empty", () => {
    saveSidebarPrefs({ listFilter: "running" });
    localStorage.removeItem(MOBILE_AGENT_FILTER_KEY);
    expect(loadMobileAgentFilter()).toBe("running");
  });
});
