import { describe, expect, it } from "vitest";
import { isGodotProjectSession, isGameSession } from "./models/session.js";
import { toolsForRuntime } from "./models/tools.js";

describe("Godot Games integration", () => {
  it("classifies Godot coding sessions without incorrectly using the HTML canvas", () => {
    const godot = { kind: undefined, runtime: "host", playbook: "LOCUS_GODOT_WORKFLOW" } as const;
    expect(isGodotProjectSession(godot)).toBe(true);
    expect(isGameSession(godot)).toBe(false);
    expect(isGodotProjectSession({ ...godot, runtime: "docker" })).toBe(false);
    expect(isGodotProjectSession({ ...godot, playbook: "ordinary agent" })).toBe(false);
  });
  it("makes Godot tools available to Host agents but not Docker agents", () => {
    const host = toolsForRuntime("ubuntu", "host").map((tool) => tool.name);
    const docker = toolsForRuntime("ubuntu", "docker").map((tool) => tool.name);
    expect(host).toContain("godot_editor");
    expect(host).toContain("godot_result");
    expect(docker).not.toContain("godot_editor");
    expect(docker).not.toContain("godot_result");
  });
});
