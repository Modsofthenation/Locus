import { describe, expect, it, vi } from "vitest";
import {
  addRailSignal,
  markRailHintDone,
  noteRailSignal,
  onRailSignal,
  railPinSuggestion,
  railUsageSignals,
  type RailUsage,
} from "./railSuggest";

const idle: RailUsage = {
  designs: false,
  automations: false,
  grafanaToken: false,
  dockerFound: false,
  dockerAgents: false,
};

describe("railSuggest", () => {
  it("turns state signals into sections", () => {
    expect(railUsageSignals(idle)).toEqual([]);
    expect(railUsageSignals({ ...idle, designs: true, automations: true })).toEqual([
      "design",
      "automations",
    ]);
    expect(railUsageSignals({ ...idle, grafanaToken: true })).toEqual(["grafana"]);
    // Docker needs both the engine and a Docker agent.
    expect(railUsageSignals({ ...idle, dockerFound: true })).toEqual([]);
    expect(railUsageSignals({ ...idle, dockerAgents: true })).toEqual([]);
    expect(railUsageSignals({ ...idle, dockerFound: true, dockerAgents: true })).toEqual([
      "docker",
    ]);
  });

  it("suggests the first unpinned, unanswered More section", () => {
    const base = { mode: "developer" as const, pinned: ["agents", "codebase"] as const, done: [] };
    expect(railPinSuggestion({ ...base, signals: [] })).toBeNull();
    expect(railPinSuggestion({ ...base, signals: ["design", "grafana"] })).toBe("design");
    expect(
      railPinSuggestion({ ...base, pinned: ["agents", "codebase", "design"], signals: ["design"] }),
    ).toBeNull();
    expect(railPinSuggestion({ ...base, done: ["design"], signals: ["design", "grafana"] })).toBe(
      "grafana",
    );
    // Locked or non-More sections never get a suggestion.
    expect(railPinSuggestion({ ...base, signals: ["agents", "codebase", "settings"] })).toBeNull();
  });

  it("stays quiet in Swarm, which hides the rail", () => {
    expect(
      railPinSuggestion({
        mode: "swarm",
        pinned: ["agents", "project"],
        done: [],
        signals: ["ide"],
      }),
    ).toBeNull();
  });

  it("records answers and event signals once", () => {
    expect(markRailHintDone([], "ide")).toEqual(["ide"]);
    expect(markRailHintDone(["ide"], "ide")).toEqual(["ide"]);
    expect(addRailSignal(["board"], "board")).toEqual(["board"]);
    expect(addRailSignal(["board"], "project")).toEqual(["board", "project"]);
  });

  it("delivers noted signals to listeners until they unsubscribe", () => {
    const listener = vi.fn();
    const off = onRailSignal(listener);
    noteRailSignal("ide");
    expect(listener).toHaveBeenCalledWith("ide");
    off();
    noteRailSignal("board");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
