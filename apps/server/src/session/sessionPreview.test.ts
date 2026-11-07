import { describe, expect, it } from "vitest";
import type { AgentSession, VmInstance } from "@locus/shared";
import { SessionPreview, type SessionPreviewPorts } from "./sessionPreview.js";

function session(partial: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    title: "Agent",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    status: "idle",
    os: "ubuntu",
    templateId: "docker",
    runtime: "docker",
    vmId: "vm1",
    ...partial,
  } as AgentSession;
}

function ports(overrides: Partial<SessionPreviewPorts> = {}): SessionPreviewPorts {
  return {
    require: async () => session(),
    getMachine: () =>
      ({
        id: "vm1",
        status: "creating",
        name: "g",
        os: "ubuntu",
        createdAt: "2026-01-01",
      }) as VmInstance,
    isWorker: () => false,
    requireWorker: async () => {
      throw new Error("no worker");
    },
    docker: {},
    store: {
      dataDir: "/tmp/locus-test",
      mutateSession: async () => session(),
    } as unknown as SessionPreviewPorts["store"],
    hub: { broadcast: () => undefined } as unknown as SessionPreviewPorts["hub"],
    ...overrides,
  };
}

describe("SessionPreview", () => {
  it("returns empty ports while the Guest is not ready", async () => {
    const preview = new SessionPreview(ports());
    await expect(preview.status("s1")).resolves.toEqual({ ports: [] });
  });

  it("refuses preview on a VM runtime", async () => {
    const preview = new SessionPreview(
      ports({
        require: async () => session({ runtime: "vm", templateId: "qemu" }),
      }),
    );
    await expect(preview.status("s1")).rejects.toThrow(/Docker and Host/);
  });
});
