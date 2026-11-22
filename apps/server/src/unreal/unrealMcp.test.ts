import { describe, expect, it, vi } from "vitest";
import type { SessionService } from "../session/sessions.js";
import { executeUnrealMcp, isUnrealMcpTool, unrealMcpTools } from "./unrealMcp.js";

describe("Unreal MCP", () => {
  it("advertises scoped Host operation and result-polling tools", () => {
    const tools = unrealMcpTools();
    expect(tools.map((tool) => tool.name)).toEqual(["unreal_editor", "unreal_result"]);
    expect(tools[0]?.inputSchema.required).toEqual(["action"]);
    expect(tools[1]?.inputSchema.properties).toHaveProperty("waitMs");
    expect(isUnrealMcpTool("unreal_editor")).toBe(true);
    expect(isUnrealMcpTool("unreal_result")).toBe(true);
    expect(isUnrealMcpTool("godot_editor")).toBe(false);
  });
  it("refuses sessions that are not Host Unreal workflows", async () => {
    const sessions = {
      unrealProjectRoot: vi
        .fn()
        .mockRejectedValue(new Error("This session is not a local Host Unreal workflow")),
    } as unknown as SessionService;
    const output = await executeUnrealMcp(sessions, "x", "unreal_editor", { action: "compile" });
    expect(output.ok).toBe(false);
    expect(output.output).toContain("Host Unreal workflow");
  });
  it("rejects unsupported operations, targets and unsafe filters", async () => {
    const sessions = { unrealProjectRoot: async () => "/nonexistent" } as unknown as SessionService;
    for (const args of [
      { action: "delete" },
      { action: "package", target: "webgl" },
      { action: "test", filter: "x; Quit" },
    ]) {
      expect((await executeUnrealMcp(sessions, "demo", "unreal_editor", args)).ok).toBe(false);
    }
  });
});
