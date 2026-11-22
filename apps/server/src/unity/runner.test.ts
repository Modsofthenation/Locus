import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isSafeUnityWebglPath,
  isUnityAction,
  latestUnityJob,
  latestUnityWebglJob,
  restoreUnityJobs,
  validateUnityProject,
} from "./runner.js";
import { UNITY_EDITOR_SCRIPT } from "./editorScript.js";

const dirs: string[] = [];
async function folder() {
  const path = await mkdtemp(join(tmpdir(), "locus-unity-test-"));
  dirs.push(path);
  return path;
}
async function project(path: string) {
  await mkdir(join(path, "Assets"), { recursive: true });
  await mkdir(join(path, "Packages"), { recursive: true });
  await mkdir(join(path, "ProjectSettings"), { recursive: true });
  await writeFile(join(path, "Packages", "manifest.json"), "{}");
  await writeFile(
    join(path, "ProjectSettings", "ProjectVersion.txt"),
    "m_EditorVersion: 2022.3.40f1\n",
  );
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
describe("Unity project automation", () => {
  it("validates an existing Unity project and detects its version", async () => {
    const root = await folder();
    await project(root);
    expect(await validateUnityProject(root)).toEqual({ root, unityVersion: "2022.3.40f1" });
  });
  it("finds a new project immediately below a selected parent", async () => {
    const root = await folder();
    await project(join(root, "Runner"));
    expect((await validateUnityProject(root)).root).toBe(join(root, "Runner"));
  });
  it("refuses to guess between multiple projects", async () => {
    const root = await folder();
    await project(join(root, "A"));
    await project(join(root, "B"));
    await expect(validateUnityProject(root)).rejects.toThrow("Multiple Unity projects");
  });
  it("rejects unknown Editor versions instead of selecting an arbitrary Unity executable", async () => {
    const root = await folder();
    await project(root);
    await writeFile(join(root, "ProjectSettings", "ProjectVersion.txt"), "unsupported version");
    await expect(validateUnityProject(root)).rejects.toThrow("valid Unity Editor version");
  });

  it("recovers prior WebGL previews and Editor reports from durable job metadata", async () => {
    const root = await folder();
    await project(root);
    const sessionId = "restored-unity-test-session";
    const id = "11111111-1111-4111-8111-111111111111";
    const run = join(root, ".locus-unity", "runs", id);
    await mkdir(run, { recursive: true });
    await writeFile(
      join(run, "job.json"),
      JSON.stringify({
        id,
        sessionId,
        action: "build",
        status: "succeeded",
        startedAt: "2026-10-01T01:00:00Z",
        finishedAt: "2026-10-01T01:01:00Z",
        webglReady: true,
        message: "Unity build completed successfully",
      }),
    );
    await restoreUnityJobs(root, sessionId);
    expect(latestUnityJob(sessionId)?.id).toBe(id);
    expect(latestUnityWebglJob(sessionId)?.id).toBe(id);
    expect(latestUnityJob("different-session")).toBeUndefined();
  });
  it("rejects folders that are not Unity projects", async () => {
    const root = await folder();
    await expect(validateUnityProject(root)).rejects.toThrow("Unity project folder");
  });
  it("supports only declared Unity actions", () => {
    for (const action of ["inspect", "compile", "playtest", "capture", "build", "create-scene"]) {
      expect(isUnityAction(action)).toBe(true);
    }
    expect(isUnityAction("exec")).toBe(false);
  });
  it("allows only scoped WebGL player asset paths", () => {
    expect(isSafeUnityWebglPath("index.html")).toBe(true);
    expect(isSafeUnityWebglPath("Build/Game.wasm")).toBe(true);
    expect(isSafeUnityWebglPath("Build/Game.framework.js")).toBe(true);
    expect(isSafeUnityWebglPath("TemplateData/favicon.ico")).toBe(true);
    expect(isSafeUnityWebglPath("StreamingAssets/data.json")).toBe(true);
    for (const path of [
      "../secrets",
      "Build/../../.git/config",
      ".git/config",
      "Assets/PlayerSettings.asset",
      "Build//file.js",
      "Build/./file.js",
      "Build/other\\\\file.js",
      "/etc/passwd",
    ]) {
      expect(isSafeUnityWebglPath(path)).toBe(false);
    }
  });
  it("includes required Editor methods and avoids arbitrary shell execution", () => {
    expect(UNITY_EDITOR_SCRIPT).toContain("public static void Inspect()");
    expect(UNITY_EDITOR_SCRIPT).toContain("public static void CreateScene()");
    expect(UNITY_EDITOR_SCRIPT).toContain("public static void Capture()");
    expect(UNITY_EDITOR_SCRIPT).toContain("public static void Build()");
  });
});
