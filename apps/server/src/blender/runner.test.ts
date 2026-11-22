import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  blenderExport,
  blenderJob,
  isBlenderAction,
  isBlenderExportFormat,
  latestBlenderJob,
  ensureBlenderParents,
  restoreBlenderJobs,
  safeBlendRelative,
  safeProjectPath,
  validateBlenderWorkspace,
} from "./runner.js";

const dirs: string[] = [];
async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "locus-blender-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
describe("Blender Host integration", () => {
  it("allows only declared operations and export formats", () => {
    for (const action of ["inspect", "validate", "render", "export", "create", "script"])
      expect(isBlenderAction(action)).toBe(true);
    expect(isBlenderAction("exec")).toBe(false);
    for (const format of ["glb", "fbx", "obj", "stl"])
      expect(isBlenderExportFormat(format)).toBe(true);
    expect(isBlenderExportFormat("blend")).toBe(false);
  });
  it("rejects absolute, parent traversal, Windows and invalid project paths", () => {
    expect(safeBlendRelative("meshes/hero.blend", ".blend")).toBe(true);
    expect(safeBlendRelative("scripts/edit.py", ".py")).toBe(true);
    for (const file of [
      "/tmp/file.blend",
      "../evil.blend",
      "folder/../evil.blend",
      "folder\\evil.blend",
      "folder//evil.blend",
      "bad.txt",
      ".blend",
      "foo/./hero.blend",
    ]) {
      expect(safeBlendRelative(file, ".blend")).toBe(false);
    }
  });
  it("only serves a successful export to the same session and rejects symlinked output", async () => {
    const root = await workspace();
    const id = "22222222-2222-4222-8222-222222222222";
    const output = join(root, ".locus-blender", "runs", id);
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "asset.glb"), Buffer.from("fake-glb"));
    await writeFile(
      join(output, "job.json"),
      JSON.stringify({
        id,
        sessionId: "blender-export-session",
        action: "export",
        status: "succeeded",
        startedAt: "2026-11-15T00:00:00Z",
        finishedAt: "2026-11-15T00:00:01Z",
        data: { export: "asset.glb" },
      }),
    );
    await restoreBlenderJobs(root, "blender-export-session");
    const result = await blenderExport(id, "blender-export-session");
    expect(result?.name).toBe("asset.glb");
    expect(result?.mime).toBe("model/gltf-binary");
    expect(await blenderExport(id, "another-session")).toBeUndefined();
    await rm(join(output, "asset.glb"));
    await symlink(join(root, "job.json"), join(output, "asset.glb"));
    expect(await blenderExport(id, "blender-export-session")).toBeUndefined();
  });
  it("rejects symlinks that lead outside the selected workspace", async () => {
    const root = await workspace();
    const external = await workspace();
    await symlink(external, join(root, "escape"));
    await expect(safeProjectPath(root, "escape/model.blend", false)).rejects.toThrow("symbolic");
    await writeFile(join(root, "model.blend"), "test");
    expect(await safeProjectPath(root, "model.blend", true)).toBe(join(root, "model.blend"));
    await expect(safeProjectPath(root, "missing.blend", true)).rejects.toThrow("does not exist");
  });
  it("creates nested output parents and rejects symlink parents", async () => {
    const root = await workspace();
    await ensureBlenderParents(root, "assets/props/model.blend");
    expect(await safeProjectPath(root, "assets/props/model.blend", false)).toBe(
      join(root, "assets", "props", "model.blend"),
    );
    const other = await workspace();
    await symlink(other, join(root, "redirect"));
    await expect(ensureBlenderParents(root, "redirect/asset.blend")).rejects.toThrow(
      /real workspace directory/,
    );
  });
  it("requires a real local directory", async () => {
    const root = await workspace();
    expect(await validateBlenderWorkspace(root)).toBe(root);
    await expect(validateBlenderWorkspace(join(root, "none"))).rejects.toThrow();
  });
  it("restores only completed same-session results", async () => {
    const root = await workspace();
    const id = "11111111-1111-4111-8111-111111111111";
    const run = join(root, ".locus-blender", "runs", id);
    await mkdir(run, { recursive: true });
    await writeFile(
      join(run, "job.json"),
      JSON.stringify({
        id,
        sessionId: "blender-test",
        action: "inspect",
        status: "succeeded",
        startedAt: "2026-11-15T00:00:00Z",
        finishedAt: "2026-11-15T00:00:01Z",
      }),
    );
    await restoreBlenderJobs(root, "blender-test");
    expect(latestBlenderJob("blender-test")?.id).toBe(id);
    expect(blenderJob(id, "different-session")).toBeUndefined();
  });
});
