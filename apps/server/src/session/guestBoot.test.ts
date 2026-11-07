import { describe, expect, it, vi } from "vitest";
import type { AgentSession, VmInstance } from "@locus/shared";
import { GuestBoot, type GuestBootPorts } from "./guestBoot.js";

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
    ...partial,
  } as AgentSession;
}

function vm(status: VmInstance["status"]): VmInstance {
  return { id: "vm1", status, name: "g", os: "ubuntu", createdAt: "2026-01-01" } as VmInstance;
}

function ports(overrides: Partial<GuestBootPorts> = {}): GuestBootPorts {
  const row = session();
  return {
    require: async () => row,
    get: async () => row,
    sessionNeedsGuest: () => true,
    isWorkerHost: () => false,
    isWorkerSession: () => false,
    runStartVm: async () => vm("running"),
    ensureDocker: async () => vm("creating"),
    ensureWorkerHost: async () => vm("creating"),
    getMachine: () => undefined,
    workerClient: () => undefined,
    onVmStatus: async () => undefined,
    resumeIgnoredStartPrompt: async () => undefined,
    bootTimeoutMs: async () => 15 * 60_000,
    store: { mutateSession: async () => row } as unknown as GuestBootPorts["store"],
    hub: { broadcast: () => undefined } as unknown as GuestBootPorts["hub"],
    ...overrides,
  };
}

describe("GuestBoot", () => {
  it("dedupes inflight startVm", async () => {
    let starts = 0;
    let release!: (value: VmInstance) => void;
    const pending = new Promise<VmInstance>((resolve) => {
      release = resolve;
    });
    const boot = new GuestBoot(
      ports({
        runStartVm: async () => {
          starts += 1;
          return pending;
        },
      }),
    );
    const first = boot.startVm("s1");
    const second = boot.startVm("s1");
    expect(boot.hasInflight("s1")).toBe(true);
    expect(starts).toBe(1);
    release(vm("running"));
    await expect(first).resolves.toMatchObject({ status: "running" });
    await expect(second).resolves.toMatchObject({ status: "running" });
    expect(boot.hasInflight("s1")).toBe(false);
  });

  it("returns immediately when the Guest is already ready", async () => {
    const startVm = vi.fn();
    const boot = new GuestBoot(
      ports({
        get: async () => session({ vmId: "vm1" }),
        getMachine: () => vm("running"),
        runStartVm: startVm,
      }),
    );
    await boot.startGuestIfNeeded("s1");
    expect(startVm).not.toHaveBeenCalled();
  });

  it("failBoot when startGuestIfNeeded throws", async () => {
    const fail = new Error("no docker");
    const mutateSession = vi.fn(async (_id: string, fn: (current: AgentSession) => void) => {
      const row = session();
      fn(row);
      return row;
    });
    const boot = new GuestBoot(
      ports({
        runStartVm: async () => {
          throw fail;
        },
        store: { mutateSession } as unknown as GuestBootPorts["store"],
      }),
    );
    await boot.startGuestIfNeeded("s1");
    expect(mutateSession).toHaveBeenCalled();
  });

  it("fire-and-forget Docker boot when waitUntilStarted is false", async () => {
    const ensureDocker = vi.fn(async () => vm("creating"));
    let release!: (value: VmInstance) => void;
    const pending = new Promise<VmInstance>((resolve) => {
      release = resolve;
    });
    const boot = new GuestBoot(
      ports({
        ensureDocker,
        runStartVm: async () => pending,
      }),
    );
    await boot.bootGuest("s1", false);
    expect(ensureDocker).toHaveBeenCalledWith("s1");
    expect(boot.hasInflight("s1")).toBe(true);
    release(vm("running"));
    await pending;
  });
});
