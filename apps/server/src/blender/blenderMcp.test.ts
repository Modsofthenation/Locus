import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionService } from "../session/sessions.js";
import { blenderMcpTools, executeBlenderMcp, isBlenderMcpTool } from "./blenderMcp.js";

describe("Blender MCP", () => {
  let projectRoot = "";
  beforeAll(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "locus-blender-mcp-"));
  });
  afterAll(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("advertises scoped operations and bounded result polling", () => {
    const tools = blenderMcpTools();
    expect(tools.map((tool) => tool.name)).toEqual(["blender_editor", "blender_result"]);
    expect(tools[0]?.inputSchema.required).toEqual(["action", "file"]);
    expect(tools[1]?.inputSchema.properties).toHaveProperty("waitMs");
    expect((tools[0]?.inputSchema.properties.action as { enum: string[] }).enum).not.toContain(
      "script",
    );
    expect(isBlenderMcpTool("blender_editor")).toBe(true);
    expect(isBlenderMcpTool("blender_result")).toBe(true);
    expect(isBlenderMcpTool("shell")).toBe(false);
  });
  it("rejects sessions that are not local Host Blender work", async () => {
    const sessions = {
      blenderProjectRoot: vi.fn().mockRejectedValue(new Error("Not a Host Blender workflow")),
    } as unknown as SessionService;
    const result = await executeBlenderMcp(sessions, "unrelated", "blender_editor", {
      action: "inspect",
      file: "scene.blend",
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("Host Blender workflow");
  });
  it("requires interactive operator confirmation for project scripts", async () => {
    const sessions = {
      blenderProjectRoot: async () => projectRoot,
    } as unknown as SessionService;
    const result = await executeBlenderMcp(sessions, "test", "blender_editor", {
      action: "script",
      file: "model.blend",
      script: "edit.py",
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("explicit confirmation");
  });
  it("rejects unsupported operations before launching", async () => {
    const sessions = {
      blenderProjectRoot: async () => projectRoot,
    } as unknown as SessionService;
    expect(
      (
        await executeBlenderMcp(sessions, "test", "blender_editor", {
          action: "shell",
          file: "scene.blend",
        })
      ).ok,
    ).toBe(false);
  });
});
