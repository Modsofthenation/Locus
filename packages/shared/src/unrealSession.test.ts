import { describe, expect, it } from "vitest";
import { isGameSession, isUnrealProjectSession } from "./models/session.js";
import { TOOL_SCHEMAS, isControlPlaneToolName, toolsForRuntime } from "./models/tools.js";

describe("Unreal Engine Games integration", () => {
  it("classifies Unreal coding sessions without using the HTML canvas", () => {
    const unreal = { kind: undefined, runtime: "host", playbook: "LOCUS_UNREAL_WORKFLOW" } as const;
    expect(isUnrealProjectSession(unreal)).toBe(true);
    expect(isGameSession(unreal)).toBe(false);
    expect(isUnrealProjectSession({ ...unreal, runtime: "docker" })).toBe(false);
    expect(isUnrealProjectSession({ ...unreal, kind: "game" })).toBe(false);
    expect(isUnrealProjectSession({ ...unreal, playbook: "LOCUS_UNITY_WORKFLOW" })).toBe(false);
  });

  it("exposes Unreal tools only on the Host runtime and keeps them on the control plane", () => {
    const host = toolsForRuntime("ubuntu", "host").map((tool) => tool.name);
    const docker = toolsForRuntime("ubuntu", "docker").map((tool) => tool.name);
    expect(host).toEqual(expect.arrayContaining(["unreal_editor", "unreal_result"]));
    expect(docker).not.toContain("unreal_editor");
    expect(docker).not.toContain("unreal_result");
    expect(isControlPlaneToolName("unreal_editor")).toBe(true);
    expect(TOOL_SCHEMAS.unreal_editor.required).toEqual(["action"]);
    expect(TOOL_SCHEMAS.unreal_editor.properties.action!.enum).toContain("package");
    expect(TOOL_SCHEMAS.unreal_result.properties).toHaveProperty("waitMs");
  });
});
