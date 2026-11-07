import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blockedWorkerHostDirReason, resolveWorkerHostDir } from "./hostDir.js";

describe("worker hostDir jail", () => {
  it("defaults under dataDir/host-workspaces without applying the dataDir refuse", () => {
    const dataDir = join(tmpdir(), "locus-worker-data");
    expect(resolveWorkerHostDir(undefined, dataDir, "s1")).toBe(
      join(dataDir, "host-workspaces", "s1"),
    );
    expect(resolveWorkerHostDir("  ", dataDir, "s1")).toBe(join(dataDir, "host-workspaces", "s1"));
  });

  it("refuses root, home, secrets, relative paths, and the worker dataDir", () => {
    const dataDir = join(tmpdir(), "locus-worker-data");
    expect(() => resolveWorkerHostDir("relative/path", dataDir, "s1")).toThrow(/absolute path/);
    expect(() => resolveWorkerHostDir("/", dataDir, "s1")).toThrow(/filesystem root/);
    expect(() => resolveWorkerHostDir(homedir(), dataDir, "s1")).toThrow(/home directory/);
    expect(blockedWorkerHostDirReason(join(homedir(), ".ssh"))).toMatch(/\.ssh/);
    expect(blockedWorkerHostDirReason(dataDir, dataDir)).toMatch(/data directory/);
    expect(() => resolveWorkerHostDir(dataDir, dataDir, "s1")).toThrow(/data directory/);
  });
});
