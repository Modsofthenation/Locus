import { describe, expect, it } from "vitest";
import { isBlenderProjectSession, isAssetSession } from "./models/session.js";
import { TOOL_SCHEMAS, toolsForRuntime } from "./models/tools.js";

describe("Native Blender Asset Builder integration", () => {
  it("routes local Host Blender coding sessions to Assets", () => {
    const session = {
      kind: undefined,
      runtime: "host",
      playbook: "LOCUS_BLENDER_WORKFLOW",
    } as const;
    expect(isBlenderProjectSession(session)).toBe(true);
    expect(isAssetSession(session)).toBe(false);
    expect(isBlenderProjectSession({ ...session, runtime: "docker" })).toBe(false);
    expect(isBlenderProjectSession({ ...session, playbook: "ordinary agent" })).toBe(false);
  });
  it("exposes Blender tools only on the Host runtime", () => {
    const host = toolsForRuntime("ubuntu", "host").map((tool) => tool.name);
    const docker = toolsForRuntime("ubuntu", "docker").map((tool) => tool.name);
    expect(host).toContain("blender_editor");
    expect(host).toContain("blender_result");
    expect(docker).not.toContain("blender_editor");
    expect(docker).not.toContain("blender_result");
  });
  it("disallows automated script execution and constrains tool schemas", () => {
    expect(TOOL_SCHEMAS.blender_editor.required).toEqual(["action", "file"]);
    const action = TOOL_SCHEMAS.blender_editor.properties.action;
    expect(action).toBeDefined();
    expect(action!.enum).toContain("render");
    expect(action!.enum).not.toContain("script");
    expect(TOOL_SCHEMAS.blender_result.properties).toHaveProperty("waitMs");
  });
});
