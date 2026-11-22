import { describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@locus/shared";
import type { ToolRequest } from "@locus/guest-agent";
import {
  executeEarlyControlPlaneTool,
  executeLateControlPlaneTool,
  type ControlPlaneToolPorts,
} from "./controlPlaneTools.js";

const session = { id: "s1", allowedTools: ["file_read", "file_write"] } as AgentSession;

function ports(overrides: Partial<ControlPlaneToolPorts> = {}): ControlPlaneToolPorts {
  return {
    fetchFn: vi.fn() as unknown as typeof fetch,
    executeRuntimeTool: vi.fn(),
    executeSwarmTeamTool: vi.fn(),
    executeReadSkill: vi.fn(),
    executeManagePlugin: vi.fn(),
    executeMcpMeta: vi.fn(),
    mcp: { call: vi.fn() },
    integrations: {} as ControlPlaneToolPorts["integrations"],
    ...overrides,
  };
}

describe("control-plane tool dispatch", () => {
  it("loads skills before the allowlist gate", async () => {
    const executeReadSkill = vi.fn(async () => ({
      ok: true,
      output: "Use the Ops research skill.",
    }));
    const result = await executeEarlyControlPlaneTool(
      ports({ executeReadSkill }),
      session,
      { name: "read_skill" as ToolRequest["name"], args: { name: "ops-research" } },
      undefined,
      (_name, output) => output,
    );
    expect(result).toEqual({ ok: true, output: "Use the Ops research skill." });
    expect(executeReadSkill).toHaveBeenCalledWith(session, { name: "ops-research" });
    expect(
      await executeLateControlPlaneTool(
        ports({ executeReadSkill }),
        session,
        { name: "read_skill" as ToolRequest["name"], args: { name: "ops-research" } },
        undefined,
        (_name, output) => output,
        {} as never,
      ),
    ).toBeUndefined();
  });
});

describe("manage_theme dispatch", () => {
  const req = { name: "manage_theme" as ToolRequest["name"], args: { action: "list" } };
  it("runs after the access gate for interactive sessions", async () => {
    const executeManageTheme = vi.fn(async () => ({
      ok: true,
      output: "No generated themes yet.",
    }));
    const result = await executeLateControlPlaneTool(
      ports({ executeManageTheme }),
      session,
      req,
      undefined,
      (_name, output) => output,
      {} as never,
    );
    expect(result).toEqual({ ok: true, output: "No generated themes yet." });
    expect(executeManageTheme).toHaveBeenCalledWith({ action: "list" });
  });

  it("is refused inside automations", async () => {
    const executeManageTheme = vi.fn();
    await expect(
      executeLateControlPlaneTool(
        ports({ executeManageTheme }),
        { ...session, automationId: "a1" } as AgentSession,
        req,
        undefined,
        (_name, output) => output,
        {} as never,
      ),
    ).rejects.toThrow(/not available to automations/);
    expect(executeManageTheme).not.toHaveBeenCalled();
  });
});
