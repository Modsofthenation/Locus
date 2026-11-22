import { describe, expect, it } from "vitest";
import { TOOL_SCHEMAS, toolsForRuntime } from "./models/tools.js";

describe("Unity native Host tools", () => {
  it("exposes Editor operation and results only on the Host runtime", () => {
    const host = toolsForRuntime("ubuntu", "host").map((tool) => tool.name);
    const docker = toolsForRuntime("ubuntu", "docker").map((tool) => tool.name);
    expect(host).toContain("unity_editor");
    expect(host).toContain("unity_result");
    expect(docker).not.toContain("unity_editor");
    expect(docker).not.toContain("unity_result");
  });

  it("requires a declared operation and supports bounded polling", () => {
    expect(TOOL_SCHEMAS.unity_editor.required).toEqual(["action"]);
    const action = TOOL_SCHEMAS.unity_editor.properties.action;
    expect(action).toBeDefined();
    expect(action!.enum).toContain("build");
    expect(TOOL_SCHEMAS.unity_result.properties).toHaveProperty("waitMs");
  });
});
