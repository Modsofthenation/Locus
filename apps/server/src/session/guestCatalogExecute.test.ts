import { describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@locus/shared";
import { executeGuestCatalogTool, type GuestCatalogExecutePorts } from "./guestCatalogExecute.js";

function session(partial: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    title: "t",
    kind: "coding",
    os: "ubuntu",
    runtime: "docker",
    status: "idle",
    createdAt: "",
    updatedAt: "",
    messages: [],
    ...partial,
  } as AgentSession;
}

function ports(overrides: Partial<GuestCatalogExecutePorts> = {}): GuestCatalogExecutePorts {
  return {
    tryIndexedGrep: async () => undefined,
    forge: {
      forge: {} as GuestCatalogExecutePorts["forge"]["forge"],
      attachPull: async () => undefined,
      requireForge: async () => ({ ok: false, output: "no" }),
      resolveGitHeadBranch: async () => undefined,
      loadLoadPathNotes: async () => [],
    },
    isWorkerSession: () => false,
    executeHostTool: async () => ({ ok: true, output: "host" }),
    getMachine: () => undefined,
    guests: {
      forVm: () => ({ os: "ubuntu", execute: async () => ({ ok: true, output: "guest" }) }),
    },
    aborts: new Map(),
    injectForgeGitArgs: async (_session, req) => req,
    broadcastToolOverlay: () => undefined,
    snapshotFileUndo: async () => undefined,
    settleExecutedTool: async (_session, _req, result) => result,
    persistRecording: async (_id, _vm, result) => result,
    persistArtifact: async (_id, result) => result,
    mutatePreview: async () => undefined,
    openPreview: async () => ({ ok: true, output: "preview" }),
    publishToolResult: async (_id, _req, result) => result,
    ...overrides,
  } as GuestCatalogExecutePorts;
}

describe("guest catalog execute", () => {
  it("rejects tools outside the Runtime catalog", async () => {
    await expect(
      executeGuestCatalogTool(
        ports(),
        session(),
        { name: "board_list", args: {} },
        undefined,
        (name, output) => output,
        {} as never,
      ),
    ).rejects.toThrow(/not available for this agent/);
  });

  it("asks to start the container before Docker guest tools", async () => {
    await expect(
      executeGuestCatalogTool(
        ports(),
        session({ runtime: "docker" }),
        { name: "exec", args: { command: "true" } },
        undefined,
        (name, output) => output,
        {} as never,
      ),
    ).rejects.toThrow(/Start the container/);
  });

  it("runs Host catalog tools through the Host adapter", async () => {
    const executeHostTool = vi.fn(async () => ({ ok: true, output: "host-exec" }));
    const result = await executeGuestCatalogTool(
      ports({ executeHostTool }),
      session({ runtime: "host" }),
      { name: "exec", args: { command: "true" } },
      undefined,
      (name, output) => output,
      {} as never,
    );
    expect(result.output).toBe("host-exec");
    expect(executeHostTool).toHaveBeenCalledOnce();
  });
});
