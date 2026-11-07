import { afterEach, describe, expect, it } from "vitest";
import {
  AUTOMATION_DETAIL_PREFS_KEY,
  AUTOMATION_SIDEBAR_PREFS_KEY,
  automationDetailPrefFor,
  loadAutomationSidebarPrefs,
  saveAutomationDetailPref,
  saveAutomationSidebarPrefs,
} from "./automationPrefs";

describe("automationPrefs", () => {
  afterEach(() => {
    localStorage.removeItem(AUTOMATION_SIDEBAR_PREFS_KEY);
    localStorage.removeItem(AUTOMATION_DETAIL_PREFS_KEY);
  });

  it("persists sidebar filter and sort", () => {
    expect(loadAutomationSidebarPrefs()).toEqual({ filter: "all", sort: "priority" });
    saveAutomationSidebarPrefs({ filter: "failing", sort: "schedule" });
    expect(loadAutomationSidebarPrefs()).toEqual({ filter: "failing", sort: "schedule" });
  });

  it("persists fleetOpen and merges partial sidebar saves", () => {
    saveAutomationSidebarPrefs({ fleetOpen: true });
    expect(loadAutomationSidebarPrefs()).toEqual({
      filter: "all",
      sort: "priority",
      fleetOpen: true,
    });
    saveAutomationSidebarPrefs({ filter: "paused" });
    expect(loadAutomationSidebarPrefs()).toEqual({
      filter: "paused",
      sort: "priority",
      fleetOpen: true,
    });
    saveAutomationSidebarPrefs({ fleetOpen: false });
    expect(loadAutomationSidebarPrefs().fleetOpen).toBe(false);
  });

  it("persists detail expand prefs per job", () => {
    expect(automationDetailPrefFor("a1")).toEqual({});
    saveAutomationDetailPref("a1", { promptExpanded: true });
    saveAutomationDetailPref("a1", { chipsExpanded: true });
    expect(automationDetailPrefFor("a1")).toEqual({
      promptExpanded: true,
      chipsExpanded: true,
    });
    expect(automationDetailPrefFor("a2")).toEqual({});
  });
});
