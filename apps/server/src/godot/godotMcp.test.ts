import { describe, expect, it, vi } from "vitest";
import type { SessionService } from "../session/sessions.js";
import { executeGodotMcp, godotMcpTools, isGodotMcpTool } from "./godotMcp.js";

describe("Godot MCP", () => {
  it("advertises scoped Host Editor and result-polling actions", () => {
    const tools = godotMcpTools();
    expect(tools.map((tool) => tool.name)).toEqual(["godot_editor", "godot_result"]);
    expect(tools[0]?.inputSchema.required).toEqual(["action"]);
    expect(tools[1]?.inputSchema.properties).toHaveProperty("waitMs");
    expect(isGodotMcpTool("godot_editor")).toBe(true);
    expect(isGodotMcpTool("godot_result")).toBe(true);
    expect(isGodotMcpTool("exec")).toBe(false);
  });
  it("refuses access from other session types", async () => {
    const sessions = {
      godotProjectRoot: vi
        .fn()
        .mockRejectedValue(new Error("This session is not a local Host Godot workflow")),
    } as unknown as SessionService;
    const output = await executeGodotMcp(sessions, "other", "godot_editor", { action: "import" });
    expect(output.ok).toBe(false);
    expect(output.output).toContain("Host Godot workflow");
  });
  it("rejects unsupported operations and targets", async () => {
    const sessions = { godotProjectRoot: async () => "/nonexistent" } as unknown as SessionService;
    const output = await executeGodotMcp(sessions, "demo", "godot_editor", { action: "delete" });
    expect(output.ok).toBe(false);
  });
});
