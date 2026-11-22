import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { executeUnityMcp, isUnityMcpTool, unityMcpTools } from "./unityMcp.js";
import type { SessionService } from "../session/sessions.js";

describe("Unity MCP", () => {
  let projectRoot = "";
  beforeAll(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "locus-unity-mcp-"));
    // Minimal Unity project layout so job restoration passes and the tests reach input validation.
    await mkdir(join(projectRoot, "Assets"));
    await mkdir(join(projectRoot, "Packages"));
    await mkdir(join(projectRoot, "ProjectSettings"));
    await writeFile(join(projectRoot, "Packages", "manifest.json"), "{}");
    await writeFile(
      join(projectRoot, "ProjectSettings", "ProjectVersion.txt"),
      "m_EditorVersion: 6000.0.23f1\n",
    );
  });
  afterAll(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("advertises Editor run and result polling, with bounded wait", () => {
    const tools = unityMcpTools();
    expect(tools.map((tool) => tool.name)).toEqual(["unity_editor", "unity_result"]);
    expect(tools[0]?.inputSchema.required).toEqual(["action"]);
    expect(tools[1]?.inputSchema.properties).toHaveProperty("waitMs");
    expect(isUnityMcpTool("unity_editor")).toBe(true);
    expect(isUnityMcpTool("unity_result")).toBe(true);
    expect(isUnityMcpTool("exec")).toBe(false);
  });

  it("rejects non-Unity Host sessions before invoking Unity", async () => {
    const sessions = {
      unityProjectRoot: vi
        .fn()
        .mockRejectedValue(new Error("This session was not launched as a Host Unity workflow")),
    } as unknown as SessionService;
    const result = await executeUnityMcp(sessions, "not-unity", "unity_editor", {
      action: "compile",
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("Host Unity workflow");
  });

  it("validates Editor input without starting a process", async () => {
    const sessions = {
      unityProjectRoot: async () => projectRoot,
    } as unknown as SessionService;
    const result = await executeUnityMcp(sessions, "unity-1", "unity_editor", {
      action: "remove-everything",
    });
    expect(result).toEqual({ ok: false, output: "Invalid Unity action" });
  });

  it("does not expose a job from a different session", async () => {
    const sessions = {
      unityProjectRoot: async () => projectRoot,
    } as unknown as SessionService;
    const result = await executeUnityMcp(sessions, "unity-1", "unity_result", {
      jobId: "another-session-job",
    });
    expect(result).toEqual({ ok: false, output: "Unity job not found in this session" });
  });
});
