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
