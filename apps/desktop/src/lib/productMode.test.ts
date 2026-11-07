import { describe, expect, it } from "vitest";
import { applyProductModeSideEffects, swarmShellKeepsSection } from "./productMode";
import type { Action } from "@/state/store";

describe("applyProductModeSideEffects", () => {
  it("opens the teammate creation surface when entering Locus Swarm", () => {
    const actions: Action[] = [];
    const dispatch = (action: Action) => {
      actions.push(action);
    };
    applyProductModeSideEffects("swarm", "developer", dispatch, {
      vmCollapsed: true,
      sidebarCollapsed: false,
    });
    expect(actions).toEqual([
      { type: "section", section: "agents" },
      { type: "select", id: null },
      { type: "toggleVmPane" },
    ]);
  });

  it("expands a collapsed sidebar when entering Locus Swarm", () => {
    const actions: Action[] = [];
    applyProductModeSideEffects("swarm", "developer", (action) => actions.push(action), {
      vmCollapsed: false,
      sidebarCollapsed: true,
    });
    expect(actions).toEqual([
      { type: "section", section: "agents" },
      { type: "select", id: null },
      { type: "toggleSidebar" },
    ]);
  });

  it("keeps an already-open computer pane when entering Locus Swarm", () => {
    const actions: Action[] = [];
    applyProductModeSideEffects("swarm", "developer", (action) => actions.push(action), {
      vmCollapsed: false,
    });
    expect(actions).toEqual([
      { type: "section", section: "agents" },
      { type: "select", id: null },
    ]);
  });

  it("keeps teammates, teams, and settings in the Swarm shell", () => {
    expect(swarmShellKeepsSection("agents")).toBe(true);
    expect(swarmShellKeepsSection("project")).toBe(true);
    expect(swarmShellKeepsSection("settings")).toBe(true);
    expect(swarmShellKeepsSection("automations")).toBe(false);
    expect(swarmShellKeepsSection("brain")).toBe(false);
    expect(swarmShellKeepsSection("design")).toBe(false);
  });

  it("is a no-op when the mode did not change", () => {
    const actions: Action[] = [];
    applyProductModeSideEffects("swarm", "swarm", (action) => actions.push(action), {
      vmCollapsed: false,
    });
    expect(actions).toEqual([]);
  });
});
