import { describe, expect, it } from "vitest";
import {
  LAUNCH_TARGETS,
  NATIVE_ENGINES,
  nativeProjectPrompt,
  nativeReadiness,
  targetForSurface,
} from "./launchTargets";

describe("launchTargets", () => {
  it("lists engines per surface", () => {
    expect(LAUNCH_TARGETS.game.map((row) => row.id)).toEqual(["web", "unity", "godot", "unreal"]);
    expect(LAUNCH_TARGETS.assets.map((row) => row.id)).toEqual(["web", "blender"]);
    expect(targetForSurface("assets", "unity")).toBe("web");
    expect(targetForSurface("design", "blender")).toBe("web");
    expect(targetForSurface("game", "godot")).toBe("godot");
  });

  it("routes each engine to its own workflow prompt", () => {
    const input = { action: "create" as const, request: "x", projectPath: "/p" };
    expect(nativeProjectPrompt("unity", input)).toContain("Unity");
    expect(nativeProjectPrompt("godot", input)).toContain("LOCUS_GODOT_WORKFLOW");
    expect(nativeProjectPrompt("blender", input)).toContain("LOCUS_BLENDER_WORKFLOW");
    expect(nativeProjectPrompt("unreal", input)).toContain("LOCUS_UNREAL_WORKFLOW");
    expect(NATIVE_ENGINES.unity.playbook).toBe("LOCUS_UNITY_WORKFLOW");
    expect(NATIVE_ENGINES.unreal.playbook).toBe("LOCUS_UNREAL_WORKFLOW");
  });

  it("names the first missing requirement", () => {
    const base = {
      engine: "godot" as const,
      action: "edit" as const,
      runtime: "host" as const,
      remote: false,
      hostAllowed: true,
    };
    expect(nativeReadiness({ ...base, hostAllowed: false }).blocker).toMatch(/policy/);
    expect(nativeReadiness({ ...base, remote: true }).blocker).toMatch(/Local/);
    expect(nativeReadiness({ ...base, runtime: "docker" }).blocker).toMatch(/Host runtime/);
    expect(nativeReadiness(base).blocker).toMatch(/Godot project folder/);
    const ready = nativeReadiness({ ...base, hostDir: "/games/demo" });
    expect(ready.blocker).toBeNull();
    expect(ready.checks.every((row) => row.ok)).toBe(true);
  });
});
