import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  explorerRevealCommand,
  looksAbsoluteHostPath,
  resolveRevealFolder,
  revealWorkspaceFolder,
  spawnExplorer,
} from "./revealWorkspace.js";

describe("looksAbsoluteHostPath", () => {
  it("treats host abs paths as absolute and keeps guest /workspace relative", () => {
    expect(looksAbsoluteHostPath("/tmp/proj/src/app.ts")).toBe(true);
    expect(looksAbsoluteHostPath("C:\\Users\\locus\\.locus\\host-workspaces\\id\\index.js")).toBe(
      true,
    );
    expect(looksAbsoluteHostPath("/workspace/src/app.ts")).toBe(false);
    expect(looksAbsoluteHostPath("/workspace")).toBe(false);
    expect(looksAbsoluteHostPath("src/app.ts")).toBe(false);
  });
});

describe("explorerRevealCommand", () => {
  it("picks File Explorer, Finder, or the Linux file manager", () => {
    expect(explorerRevealCommand("/tmp/proj", "win32")).toEqual({
      command: "explorer.exe",
      args: ["/tmp/proj"],
    });
    expect(explorerRevealCommand("/tmp/proj", "darwin")).toEqual({
      command: "open",
      args: ["/tmp/proj"],
    });
    expect(explorerRevealCommand("/tmp/proj", "linux")).toEqual({
      command: "xdg-open",
      args: ["/tmp/proj"],
    });
  });
});

describe("resolveRevealFolder", () => {
  it("opens the containing folder for files inside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "locus-reveal-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "app.ts"), "export const n = 1;\n");
    expect(await resolveRevealFolder(root, "src/app.ts")).toBe(join(root, "src"));
    expect(await resolveRevealFolder(root, "/workspace/src/app.ts")).toBe(join(root, "src"));
    expect(await resolveRevealFolder(root, join(root, "src", "app.ts"))).toBe(join(root, "src"));
    expect(await resolveRevealFolder(root, "src")).toBe(join(root, "src"));
  });

  it("falls back to an existing parent and rejects escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "locus-reveal-miss-"));
    await mkdir(join(root, "src"));
    expect(await resolveRevealFolder(root, "src/gone.ts")).toBe(join(root, "src"));
    expect(await resolveRevealFolder(root, "missing/file.ts")).toBe(root);
    await expect(resolveRevealFolder(root, "../secret")).rejects.toThrow(/outside/);
    await expect(resolveRevealFolder(root, "/etc/passwd")).rejects.toThrow(/outside/);
  });
});

describe("spawnExplorer", () => {
  it("skips spawn during tests unless a spawn fn is forced", () => {
    const spawn = vi.fn(() => ({ on: vi.fn(), unref: vi.fn() }));
    expect(spawnExplorer("/tmp/proj")).toMatchObject({
      command: process.platform === "darwin" ? "open" : "xdg-open",
      skipped: true,
    });
    expect(spawn).not.toHaveBeenCalled();
    const forced = spawnExplorer("/tmp/proj", {
      skip: false,
      platform: "linux",
      spawn: spawn as unknown as typeof import("node:child_process").spawn,
    });
    expect(forced).toEqual({ command: "xdg-open", args: ["/tmp/proj"], skipped: false });
    expect(spawn).toHaveBeenCalledWith("xdg-open", ["/tmp/proj"], {
      detached: true,
      stdio: "ignore",
    });
  });
});

describe("revealWorkspaceFolder", () => {
  it("returns the folder and does not spawn under Vitest", async () => {
    const root = await mkdtemp(join(tmpdir(), "locus-reveal-api-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "app.ts"), "ok\n");
    const spawn = vi.fn();
    await expect(revealWorkspaceFolder(root, "src/app.ts", { spawn })).resolves.toEqual({
      path: join(root, "src"),
    });
    expect(spawn).not.toHaveBeenCalled();
  });
});
