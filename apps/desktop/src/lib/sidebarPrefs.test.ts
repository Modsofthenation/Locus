import { afterEach, describe, expect, it } from "vitest";
import {
  loadMobileAgentFilter,
  loadSidebarPrefs,
  MOBILE_AGENT_FILTER_KEY,
  saveMobileAgentFilter,
  saveSidebarPrefs,
  SIDEBAR_PREFS_KEY,
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
    });
  });

  it("persists the phone agent chip filter", () => {
    saveMobileAgentFilter("needs");
    expect(loadMobileAgentFilter()).toBe("needs");
  });
});
