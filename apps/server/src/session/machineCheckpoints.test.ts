import { describe, expect, it, vi } from "vitest";
import { restoreMachineCheckpoint, snapshotMachineCheckpoint } from "./checkpoint.js";

describe("snapshotMachineCheckpoint", () => {
  it("snapshots a docker workspace without pausing QEMU", async () => {
    const snapshotWorkspace = vi.fn(async () => undefined);
    const snapshotDisk = vi.fn(async () => undefined);
    const pause = vi.fn(async () => ({}) as never);
    const ok = await snapshotMachineCheckpoint({
      docker: true,
      running: true,
      vmId: "vm1",
      destPath: "/ckpt",
      dockerEngine: { snapshotWorkspace },
      hypervisor: { snapshotDisk, pause },
    });
    expect(ok).toBe(true);
    expect(snapshotWorkspace).toHaveBeenCalledWith("vm1", "/ckpt");
    expect(pause).not.toHaveBeenCalled();
    expect(snapshotDisk).not.toHaveBeenCalled();
  });

  it("pauses a running QEMU guest around the disk snapshot", async () => {
    const snapshotDisk = vi.fn(async () => undefined);
    const pause = vi.fn(async () => ({}) as never);
    const resume = vi.fn(async () => ({}) as never);
    const ok = await snapshotMachineCheckpoint({
      docker: false,
      running: true,
      vmId: "vm1",
      destPath: "/ckpt.qcow2",
      dockerEngine: {},
      hypervisor: { snapshotRequiresPause: true, snapshotDisk, pause, resume },
    });
    expect(ok).toBe(true);
    expect(pause).toHaveBeenCalledWith("vm1");
    expect(snapshotDisk).toHaveBeenCalledWith("vm1", "/ckpt.qcow2");
    expect(resume).toHaveBeenCalledWith("vm1");
  });

  it("resumes a running QEMU guest when the disk snapshot fails", async () => {
    const pause = vi.fn(async () => ({}) as never);
    const resume = vi.fn(async () => ({}) as never);
    const ok = await snapshotMachineCheckpoint({
      docker: false,
      running: true,
      vmId: "vm1",
      destPath: "/ckpt.qcow2",
      dockerEngine: {},
      hypervisor: {
        snapshotRequiresPause: true,
        snapshotDisk: async () => {
          throw new Error("qcow2 busy");
        },
        pause,
        resume,
      },
    });
    expect(ok).toBe(false);
    expect(pause).toHaveBeenCalledWith("vm1");
    expect(resume).toHaveBeenCalledWith("vm1");
  });

  it("does not pause when snapshotRequiresPause is omitted", async () => {
    const snapshotDisk = vi.fn(async () => undefined);
    const pause = vi.fn(async () => ({}) as never);
    const ok = await snapshotMachineCheckpoint({
      docker: false,
      running: true,
      vmId: "vm1",
      destPath: "/ckpt.qcow2",
      dockerEngine: {},
      hypervisor: { snapshotDisk, pause },
    });
    expect(ok).toBe(true);
    expect(pause).not.toHaveBeenCalled();
    expect(snapshotDisk).toHaveBeenCalledWith("vm1", "/ckpt.qcow2");
  });
});

describe("restoreMachineCheckpoint", () => {
  it("stops a live docker guest, restores the workspace, then starts it", async () => {
    const restoreWorkspace = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const start = vi.fn(async () => undefined);
    await restoreMachineCheckpoint({
      docker: true,
      running: true,
      vmId: "vm1",
      srcPath: "/ckpt",
      dockerEngine: { restoreWorkspace },
      hypervisor: { restoreRequiresStop: true },
      stop,
      start,
    });
    expect(stop).toHaveBeenCalled();
    expect(restoreWorkspace).toHaveBeenCalledWith("vm1", "/ckpt");
    expect(start).toHaveBeenCalled();
  });

  it("restores a mock disk in place without stop when restoreRequiresStop is omitted", async () => {
    const restoreDisk = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const start = vi.fn(async () => undefined);
    await restoreMachineCheckpoint({
      docker: false,
      running: true,
      vmId: "vm1",
      srcPath: "/ckpt.qcow2",
      dockerEngine: {},
      hypervisor: { restoreDisk },
      stop,
      start,
    });
    expect(stop).not.toHaveBeenCalled();
    expect(restoreDisk).toHaveBeenCalledWith("vm1", "/ckpt.qcow2");
    expect(start).not.toHaveBeenCalled();
  });

  it("stops a live QEMU guest when restoreRequiresStop is set", async () => {
    const restoreDisk = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const start = vi.fn(async () => undefined);
    await restoreMachineCheckpoint({
      docker: false,
      running: true,
      vmId: "vm1",
      srcPath: "/ckpt.qcow2",
      dockerEngine: {},
      hypervisor: { restoreDisk, restoreRequiresStop: true },
      stop,
      start,
    });
    expect(stop).toHaveBeenCalled();
    expect(restoreDisk).toHaveBeenCalledWith("vm1", "/ckpt.qcow2");
    expect(start).toHaveBeenCalled();
  });
});
