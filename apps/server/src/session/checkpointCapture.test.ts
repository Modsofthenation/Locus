import { describe, expect, it, vi } from "vitest";
import type { AgentSession, PlanStepStatus, SessionCheckpoint, TaskItem } from "@locus/shared";
import {
  captureTurnCheckpoint,
  diffTurnCheckpoints,
  dockerCheckpointDest,
  dropCheckpointArtifacts,
  restoreWorkspaceCheckpoint,
  vmCheckpointDest,
} from "./checkpoint.js";

function session(patch: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    title: "One",
    os: "ubuntu",
    templateId: "t",
    providerId: "p",
    model: "m",
    status: "idle",
    messages: [{ id: "u1", role: "user", content: "hi", createdAt: "2020-01-01T00:00:00.000Z" }],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...patch,
  };
}

function ports(overrides: Partial<Parameters<typeof captureTurnCheckpoint>[0]["ports"]> = {}) {
  return {
    writeGitRef: vi.fn(async () => undefined as string | undefined),
    needsFullSnapshot: vi.fn(async () => false),
    snapshotMachine: vi.fn(async () => false),
    deleteGitRef: vi.fn(async () => undefined),
    removePath: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("captureTurnCheckpoint", () => {
  it("records a chat checkpoint when there is no guest", async () => {
    const next = await captureTurnCheckpoint({
      session: session(),
      createdAt: "2020-01-02T00:00:00.000Z",
      id: "c1",
      dataDir: "/data",
      docker: true,
      canSnapshotWorkspace: true,
      canSnapshotDisk: true,
      maxCheckpoints: 8,
      ports: ports(),
    });
    expect(next).toEqual([
      {
        id: "c1",
        messageCount: 1,
        createdAt: "2020-01-02T00:00:00.000Z",
      },
    ]);
  });

  it("keeps a docker git ref and skips the disk copy when the tree is source-only", async () => {
    const p = ports({
      writeGitRef: vi.fn(async () => "refs/locus/checkpoints/c1"),
      needsFullSnapshot: vi.fn(async () => false),
      snapshotMachine: vi.fn(async () => true),
    });
    const next = await captureTurnCheckpoint({
      session: session({ vmId: "vm1" }),
      id: "c1",
      createdAt: "t",
      dataDir: "/data",
      vm: { id: "vm1", status: "ready", diskPath: "/ws" },
      docker: true,
      canSnapshotWorkspace: true,
      canSnapshotDisk: false,
      maxCheckpoints: 8,
      ports: p,
    });
    expect(p.writeGitRef).toHaveBeenCalledWith("/ws", "c1");
    expect(p.snapshotMachine).not.toHaveBeenCalled();
    expect(next[0]?.gitRef).toBe("refs/locus/checkpoints/c1");
    expect(next[0]?.diskPath).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")(
    "takes a docker disk snapshot when git is missing or Chrome is present",
    async () => {
      const p = ports({
        writeGitRef: vi.fn(async () => "refs/locus/checkpoints/c1"),
        needsFullSnapshot: vi.fn(async () => true),
        snapshotMachine: vi.fn(async () => true),
      });
      const next = await captureTurnCheckpoint({
        session: session({ vmId: "vm1" }),
        id: "c1",
        createdAt: "t",
        dataDir: "/data",
        vm: { id: "vm1", status: "ready", diskPath: "/ws" },
        docker: true,
        canSnapshotWorkspace: true,
        canSnapshotDisk: false,
        maxCheckpoints: 8,
        ports: p,
      });
      expect(p.snapshotMachine).toHaveBeenCalledWith({
        docker: true,
        running: true,
        vmId: "vm1",
        destPath: dockerCheckpointDest("/data", "s1", "c1"),
      });
      expect(next[0]?.diskPath).toBe("/data/checkpoints/s1/c1");
    },
  );

  it.skipIf(process.platform === "win32")(
    "snapshots a VM as qcow2 and never writes a git ref",
    async () => {
      const p = ports({
        snapshotMachine: vi.fn(async () => true),
      });
      const next = await captureTurnCheckpoint({
        session: session({ vmId: "vm1", runtime: "vm" }),
        id: "c1",
        createdAt: "t",
        dataDir: "/data",
        vm: { id: "vm1", status: "stopped", diskPath: "/disks/vm1.qcow2" },
        docker: false,
        canSnapshotWorkspace: false,
        canSnapshotDisk: true,
        maxCheckpoints: 8,
        ports: p,
      });
      expect(p.writeGitRef).not.toHaveBeenCalled();
      expect(p.snapshotMachine).toHaveBeenCalledWith({
        docker: false,
        running: false,
        vmId: "vm1",
        destPath: vmCheckpointDest("/data", "s1", "c1"),
      });
      expect(next[0]?.diskPath).toBe("/data/checkpoints/s1/c1.qcow2");
    },
  );

  it("still records the checkpoint when docker snapshot throws", async () => {
    const next = await captureTurnCheckpoint({
      session: session({ vmId: "vm1" }),
      id: "c1",
      createdAt: "t",
      dataDir: "/data",
      vm: { id: "vm1", status: "ready", diskPath: "/ws" },
      docker: true,
      canSnapshotWorkspace: true,
      canSnapshotDisk: false,
      maxCheckpoints: 8,
      ports: ports({
        writeGitRef: vi.fn(async () => {
          throw new Error("git exploded");
        }),
      }),
    });
    expect(next[0]).toMatchObject({ id: "c1", messageCount: 1 });
    expect(next[0]?.gitRef).toBeUndefined();
  });

  it("drops the oldest disk and git ref when over the cap", async () => {
    const old: SessionCheckpoint = {
      id: "old",
      messageCount: 0,
      createdAt: "t0",
      diskPath: "/old-disk",
      gitRef: "refs/locus/checkpoints/old",
    };
    const p = ports();
    const next = await captureTurnCheckpoint({
      session: session({ checkpoints: [old], checkpoint: old }),
      id: "c2",
      createdAt: "t1",
      dataDir: "/data",
      vm: { id: "vm1", status: "ready", diskPath: "/ws" },
      docker: true,
      canSnapshotWorkspace: false,
      canSnapshotDisk: false,
      maxCheckpoints: 1,
      ports: p,
    });
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("c2");
    expect(p.removePath).toHaveBeenCalledWith("/old-disk");
    expect(p.deleteGitRef).toHaveBeenCalledWith("/ws", "refs/locus/checkpoints/old");
  });

  it("stores a clone of scratchpad, task list, and plan", async () => {
    const taskList: TaskItem[] = [{ id: "t1", text: "land prune", status: "in_progress" }];
    const plan = {
      items: [{ id: "p1", text: "Inspect", status: "running" as PlanStepStatus }],
      phase: "accepted" as const,
    };
    const next = await captureTurnCheckpoint({
      session: session({
        scratchpad: "before the turn",
        taskList,
        plan,
      }),
      createdAt: "t",
      id: "c1",
      dataDir: "/data",
      docker: false,
      canSnapshotWorkspace: false,
      canSnapshotDisk: false,
      maxCheckpoints: 8,
      ports: ports(),
    });
    expect(next[0]?.scratchpad).toBe("before the turn");
    expect(next[0]?.taskList).toEqual([{ id: "t1", text: "land prune", status: "in_progress" }]);
    expect(next[0]?.plan?.items.map((item) => item.text)).toEqual(["Inspect"]);
    taskList[0]!.status = "done";
    plan.items[0]!.status = "done";
    expect(next[0]?.taskList?.[0]?.status).toBe("in_progress");
    expect(next[0]?.plan?.items[0]?.status).toBe("running");
  });
});

describe("restoreWorkspaceCheckpoint", () => {
  it("restores disk first and always drops newer artifacts", async () => {
    const restoreDisk = vi.fn(async () => undefined);
    const restoreGit = vi.fn(async () => undefined);
    const dropDropped = vi.fn(async () => undefined);
    await restoreWorkspaceCheckpoint({
      checkpoint: {
        id: "c1",
        messageCount: 1,
        createdAt: "t",
        diskPath: "/disk",
        gitRef: "refs/locus/checkpoints/c1",
      },
      vmId: "vm1",
      workspace: "/ws",
      restoreDisk,
      restoreGit,
      dropDropped,
    });
    expect(restoreDisk).toHaveBeenCalledWith("/disk");
    expect(restoreGit).not.toHaveBeenCalled();
    expect(dropDropped).toHaveBeenCalledOnce();
  });

  it("restores a git ref when there is no disk snapshot", async () => {
    const restoreDisk = vi.fn(async () => undefined);
    const restoreGit = vi.fn(async () => undefined);
    const dropDropped = vi.fn(async () => undefined);
    await restoreWorkspaceCheckpoint({
      checkpoint: {
        id: "c1",
        messageCount: 1,
        createdAt: "t",
        gitRef: "refs/locus/checkpoints/c1",
      },
      workspace: "/ws",
      restoreDisk,
      restoreGit,
      dropDropped,
    });
    expect(restoreGit).toHaveBeenCalledWith("/ws", "refs/locus/checkpoints/c1");
    expect(restoreDisk).not.toHaveBeenCalled();
  });
});

describe("dropCheckpointArtifacts", () => {
  it("removes disk trees and git refs", async () => {
    const p = ports();
    await dropCheckpointArtifacts(
      "/ws",
      [
        {
          id: "c1",
          messageCount: 0,
          createdAt: "t",
          diskPath: "/d",
          gitRef: "refs/locus/checkpoints/c1",
        },
      ],
      p,
    );
    expect(p.removePath).toHaveBeenCalledWith("/d");
    expect(p.deleteGitRef).toHaveBeenCalledWith("/ws", "refs/locus/checkpoints/c1");
  });
});

describe("diffTurnCheckpoints", () => {
  const a: SessionCheckpoint = {
    id: "a",
    messageCount: 1,
    createdAt: "t0",
    gitRef: "refs/locus/checkpoints/a",
  };
  const b: SessionCheckpoint = {
    id: "b",
    messageCount: 2,
    createdAt: "t1",
    gitRef: "refs/locus/checkpoints/b",
  };

  it("diffs the previous git ref against this turn", async () => {
    const diffRefs = vi.fn(async () => "stat");
    await expect(diffTurnCheckpoints([a, b], "b", "/ws", diffRefs)).resolves.toBe("stat");
    expect(diffRefs).toHaveBeenCalledWith(
      "/ws",
      "refs/locus/checkpoints/a",
      "refs/locus/checkpoints/b",
    );
  });

  it("rejects a turn without a pair of git refs", async () => {
    await expect(diffTurnCheckpoints([b], "b", "/ws", async () => "")).rejects.toThrow(
      "No git checkpoint diff for that turn",
    );
  });
});
