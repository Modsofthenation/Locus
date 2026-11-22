import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GODOT_SCENE_INSPECTOR } from "./inspector.js";
import {
  isGodotAction,
  isGodotTarget,
  latestGodotJob,
  latestGodotWebJob,
  godotWebAsset,
  restoreGodotJobs,
  safeGodotWebPath,
  safeRunsDirectory,
  validateGodotProject,
} from "./runner.js";

const temp: string[] = [];
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "locus-godot-test-"));
  temp.push(root);
  return root;
}
async function project(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "project.godot"),
    'config_version=5\n\n[application]\nconfig/name="Test"\n',
  );
}
afterEach(async () => {
  await Promise.all(temp.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Godot project validation", () => {
  it("accepts a Godot 4 project", async () => {
    const root = await fixture();
    await project(root);
    expect((await validateGodotProject(root)).root).toBe(root);
  });
  it("finds a single child project selected through a Host parent", async () => {
    const root = await fixture();
    await project(join(root, "Platformer"));
    expect((await validateGodotProject(root)).root).toBe(join(root, "Platformer"));
  });
  it("refuses to choose between multiple Godot projects", async () => {
    const root = await fixture();
    await project(join(root, "One"));
    await project(join(root, "Two"));
    await expect(validateGodotProject(root)).rejects.toThrow("Multiple Godot projects");
  });
  it("rejects invalid projects", async () => {
    const root = await fixture();
    await expect(validateGodotProject(root)).rejects.toThrow("valid project.godot");
    await writeFile(join(root, "project.godot"), "config_version=3\n\n[application]\n");
    await expect(validateGodotProject(root)).rejects.toThrow("Godot 4 project");
  });
});
describe("Godot editor operations and web assets", () => {
  it("rejects symlink redirects for generated jobs", async () => {
    if (process.platform === "win32") return;
    const root = await fixture();
    await project(root);
    const outside = await fixture();
    await symlink(outside, join(root, ".locus-godot"));
    await expect(safeRunsDirectory(root)).rejects.toThrow("real directory");
  });

  it("uses real folders within the selected project for job outputs", async () => {
    const root = await fixture();
    await project(root);
    expect(await safeRunsDirectory(root)).toBe(join(root, ".locus-godot", "runs"));
  });
  it("limits Godot inspector recursion and avoids symlinked scene folders", () => {
    expect(GODOT_SCENE_INSPECTOR).toContain("depth > 24");
    expect(GODOT_SCENE_INSPECTOR).toContain("paths.size() < 500");
    expect(GODOT_SCENE_INSPECTOR).toContain("dir.is_link(path)");
  });

  it("allowlists actions and export targets", () => {
    for (const action of ["inspect", "import", "smoke", "create-scene", "export"])
      expect(isGodotAction(action)).toBe(true);
    expect(isGodotAction("exec")).toBe(false);
    for (const target of ["web", "linux", "windows", "macos"])
      expect(isGodotTarget(target)).toBe(true);
    expect(isGodotTarget("delete")).toBe(false);
  });
  it("only serves safe relative paths for generated Web export content", () => {
    for (const valid of ["index.html", "index.js", "index.wasm", "index.pck", "assets/splash.png"])
      expect(safeGodotWebPath(valid)).toBe(true);
    for (const bad of [
      "../secret",
      ".git/config",
      "assets/../../project.godot",
      "/etc/passwd",
      "assets//other.png",
      "assets/./test.png",
      "assets\\secret",
      "assets/%2e%2e/config",
    ])
      expect(safeGodotWebPath(bad)).toBe(false);
  });
  it("never serves a symlinked Web output directory from persisted metadata", async () => {
    if (process.platform === "win32") return;
    const root = await fixture();
    await project(root);
    const elsewhere = await fixture();
    await writeFile(join(elsewhere, "index.html"), "<h1>not from project</h1>");
    const id = "44444444-4444-4444-8444-444444444444";
    const sessionId = "godot-symlink-security-test";
    const folder = join(root, ".locus-godot", "runs", id);
    await mkdir(folder, { recursive: true });
    await symlink(elsewhere, join(folder, "Web"));
    await writeFile(
      join(folder, "job.json"),
      JSON.stringify({
        id,
        sessionId,
        action: "export",
        status: "succeeded",
        webReady: true,
        startedAt: "2026-11-15T00:00:00.000Z",
        finishedAt: "2026-11-15T00:01:00.000Z",
      }),
    );
    await restoreGodotJobs(root, sessionId);
    expect(await godotWebAsset(id, sessionId, "index.html")).toBeUndefined();
  });
  it("restores session-scoped completed Web exports after a restart", async () => {
    const root = await fixture();
    await project(root);
    const id = "33333333-3333-4333-8333-333333333333";
    const sessionId = "godot-restoration-test";
    const path = join(root, ".locus-godot", "runs", id);
    await mkdir(path, { recursive: true });
    await writeFile(
      join(path, "job.json"),
      JSON.stringify({
        id,
        sessionId,
        action: "export",
        status: "succeeded",
        webReady: true,
        startedAt: "2026-11-15T00:00:00.000Z",
        finishedAt: "2026-11-15T00:01:00.000Z",
      }),
    );
    await restoreGodotJobs(root, sessionId);
    expect(latestGodotJob(sessionId)?.id).toBe(id);
    expect(latestGodotWebJob(sessionId)?.id).toBe(id);
    expect(latestGodotJob("other-session")).toBeUndefined();
  });
  it("provides an isolated Godot SceneTree inspector", () => {
    expect(GODOT_SCENE_INSPECTOR).toContain("extends SceneTree");
    expect(GODOT_SCENE_INSPECTOR).toContain("PackedScene");
    expect(GODOT_SCENE_INSPECTOR).toContain("scenes.json");
  });
});
