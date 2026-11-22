import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectUnrealProject,
  isSafeTestFilter,
  isUnrealAction,
  isUnrealTarget,
  parseInstallIni,
  parseLauncherInstalled,
  resolveProjectScript,
  resolveUnrealEngine,
  restoreUnrealJobs,
  startUnrealJob,
  summariseAutomationReport,
  unrealJob,
  validateUnrealProject,
  windowsArg,
} from "./runner.js";

const temp: string[] = [];
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "locus-unreal-test-"));
  temp.push(root);
  return root;
}
async function project(root: string, extra: Record<string, unknown> = {}): Promise<string> {
  await mkdir(join(root, "Content", "Maps"), { recursive: true });
  await mkdir(join(root, "Config"), { recursive: true });
  await writeFile(
    join(root, "Shooter.uproject"),
    JSON.stringify({
      FileVersion: 3,
      EngineAssociation: "5.4",
      Modules: [{ Name: "Shooter", Type: "Runtime" }],
      Plugins: [{ Name: "PythonScriptPlugin", Enabled: true }],
      ...extra,
    }),
  );
  await writeFile(join(root, "Content", "Maps", "Arena.umap"), "binary");
  await writeFile(
    join(root, "Config", "DefaultEngine.ini"),
    "[/Script/EngineSettings.GameMapsSettings]\nGameDefaultMap=/Game/Maps/Arena.Arena\n",
  );
  return root;
}
/** A fake engine tree whose editor and UAT are shell scripts. */
async function fakeEngine(root: string, editorBody: string): Promise<string> {
  const engine = join(root, "Engine-5.4");
  const bin = join(engine, "Engine", "Binaries", "Linux");
  const batch = join(engine, "Engine", "Build", "BatchFiles");
  await mkdir(bin, { recursive: true });
  await mkdir(join(batch, "Linux"), { recursive: true });
  await writeFile(
    join(engine, "Engine", "Build", "Build.version"),
    JSON.stringify({ MajorVersion: 5, MinorVersion: 4, PatchVersion: 2 }),
  );
  const editor = join(bin, "UnrealEditor-Cmd");
  await writeFile(editor, "#!/bin/sh\n" + editorBody);
  await chmod(editor, 0o755);
  await writeFile(
    join(batch, "RunUAT.sh"),
    '#!/bin/bash\nfor a in "$@"; do case "$a" in -archivedirectory=*) d="${a#*=}";; esac; done\nmkdir -p "$d/Linux" && echo built > "$d/Linux/Shooter.sh"\necho "BUILD SUCCESSFUL"\n',
  );
  return engine;
}
async function settle(id: string, sessionId: string) {
  for (let i = 0; i < 200; i++) {
    const job = unrealJob(id, sessionId);
    if (job && job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("job did not finish");
}

const savedEngine = process.env.LOCUS_UNREAL_ENGINE;
beforeEach(() => {
  delete process.env.LOCUS_UNREAL_ENGINE;
});
afterEach(async () => {
  if (savedEngine === undefined) delete process.env.LOCUS_UNREAL_ENGINE;
  else process.env.LOCUS_UNREAL_ENGINE = savedEngine;
  await Promise.all(temp.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Unreal project validation", () => {
  it("accepts a project folder and a single child project", async () => {
    const root = await fixture();
    await project(join(root, "Shooter"));
    const found = await validateUnrealProject(root);
    expect(found.root).toBe(join(root, "Shooter"));
    expect(found.name).toBe("Shooter");
    expect(found.association).toBe("5.4");
    expect((await validateUnrealProject(join(root, "Shooter"))).uproject).toBe(
      join(root, "Shooter", "Shooter.uproject"),
    );
  });
  it("refuses ambiguous or missing projects", async () => {
    const root = await fixture();
    await expect(validateUnrealProject(root)).rejects.toThrow(".uproject");
    await project(join(root, "One"));
    await project(join(root, "Two"));
    await expect(validateUnrealProject(root)).rejects.toThrow("Multiple Unreal projects");
  });
  it("rejects a malformed descriptor", async () => {
    const root = await fixture();
    await writeFile(join(root, "Bad.uproject"), "{nope");
    await expect(validateUnrealProject(root)).rejects.toThrow("not valid JSON");
  });
});

describe("Unreal argument and input safety", () => {
  it("validates actions, targets and filters", () => {
    expect(isUnrealAction("compile")).toBe(true);
    expect(isUnrealAction("rm")).toBe(false);
    expect(isUnrealTarget("linux")).toBe(true);
    expect(isUnrealTarget("webgl")).toBe(false);
    expect(isSafeTestFilter("Shooter.Gameplay")).toBe(true);
    expect(isSafeTestFilter("x; Quit")).toBe(false);
    expect(isSafeTestFilter('a"b')).toBe(false);
  });
  it("quotes -Key=value arguments the way Unreal parses them on Windows", () => {
    expect(windowsArg("-nullrhi")).toBe("-nullrhi");
    expect(windowsArg("-ExecCmds=Automation RunTests X; Quit")).toBe(
      '-ExecCmds="Automation RunTests X; Quit"',
    );
    expect(windowsArg("C:\\My Games\\Shooter.uproject")).toBe('"C:\\My Games\\Shooter.uproject"');
    expect(() => windowsArg('a"b')).toThrow();
  });
  it("keeps Python scripts inside the project", async () => {
    const root = await project(await fixture());
    await mkdir(join(root, "Content", "Python"), { recursive: true });
    await writeFile(join(root, "Content", "Python", "level.py"), "print('hi')\n");
    expect(await resolveProjectScript(root, "Content/Python/level.py")).toBe(
      join(root, "Content", "Python", "level.py"),
    );
    await expect(resolveProjectScript(root, "../evil.py")).rejects.toThrow();
    await expect(resolveProjectScript(root, "/etc/x.py")).rejects.toThrow();
    await expect(resolveProjectScript(root, "Content/Python/missing.py")).rejects.toThrow(
      "not found",
    );
  });
});

describe("Unreal engine discovery", () => {
  it("parses Epic install manifests", () => {
    expect(parseInstallIni("[Installations]\n{ABC}=/src/UE5\n[Other]\nx=y\n")).toEqual({
      "{ABC}": "/src/UE5",
    });
    expect(
      parseLauncherInstalled(
        JSON.stringify({
          InstallationList: [
            { InstallLocation: "C:\\Epic\\UE_5.4", AppName: "UE_5.4" },
            { InstallLocation: "C:\\Fortnite", AppName: "Fortnite" },
          ],
        }),
      ),
    ).toEqual({ "5.4": "C:\\Epic\\UE_5.4" });
  });
  it("uses LOCUS_UNREAL_ENGINE and reports its version", async () => {
    if (process.platform !== "linux") return;
    const root = await fixture();
    const engine = await fakeEngine(root, "exit 0\n");
    process.env.LOCUS_UNREAL_ENGINE = engine;
    const found = await resolveUnrealEngine(
      await validateUnrealProject(await project(join(root, "P"))),
    );
    expect(found.version).toBe("5.4.2");
    expect(found.editor).toContain("UnrealEditor-Cmd");
    process.env.LOCUS_UNREAL_ENGINE = "relative/path";
    await expect(resolveUnrealEngine(await validateUnrealProject(join(root, "P")))).rejects.toThrow(
      "absolute engine root",
    );
  });
});

describe("Unreal reports", () => {
  it("summarises automation results", () => {
    const summary = summariseAutomationReport(
      "\uFEFF" +
        JSON.stringify({
          succeeded: 3,
          succeededWithWarnings: 0,
          failed: 1,
          notRun: 0,
          tests: [
            { fullTestPath: "Shooter.Ok", state: "Success", entries: [] },
            {
              fullTestPath: "Shooter.Ammo",
              state: "Fail",
              entries: [{ event: { type: "Error", message: "Expected 30, got 0" } }],
            },
          ],
        }),
    );
    expect(summary.failed).toBe(1);
    expect(summary.failures).toEqual([{ test: "Shooter.Ammo", errors: ["Expected 30, got 0"] }]);
  });
  it("inspects maps, modules and plugins without an engine", async () => {
    const root = await project(await fixture());
    const report = await inspectUnrealProject(await validateUnrealProject(root));
    expect(report.maps).toEqual(["/Game/Maps/Arena"]);
    expect(report.kind).toBe("Blueprint-only");
    expect(report.pythonScripting).toBe(true);
    expect(report.gameDefaultMap).toBe("/Game/Maps/Arena.Arena");
    expect((report.engine as { error?: string }).error).toContain("No Unreal Engine install");
  });
});

describe.runIf(process.platform === "linux")("Unreal jobs against a fake engine", () => {
  it("compiles Blueprints, runs tests, packages and restores jobs after restart", async () => {
    const root = await fixture();
    const proj = await project(join(root, "Shooter"));
    // Writes an automation report when -ReportExportPath is passed.
    process.env.LOCUS_UNREAL_ENGINE = await fakeEngine(
      root,
      'for a in "$@"; do case "$a" in -ReportExportPath=*) d="${a#*=}";; esac; done\n' +
        'if [ -n "$d" ]; then echo \'{"succeeded":2,"succeededWithWarnings":0,"failed":0,"notRun":0,"tests":[]}\' > "$d/index.json"; fi\n' +
        'echo "LogInit: args $*"\nexit 0\n',
    );
    const compile = await startUnrealJob({ root, sessionId: "s1", action: "compile" });
    const compiled = await settle(compile.id, "s1");
    expect(compiled.message).toBe("Unreal compile completed successfully");
    expect(compiled.log).toContain("-run=CompileAllBlueprints");

    const test = await settle(
      (await startUnrealJob({ root, sessionId: "s1", action: "test", filter: "Shooter.Core" })).id,
      "s1",
    );
    expect(test.status).toBe("succeeded");
    expect(test.data).toMatchObject({ filter: "Shooter.Core", succeeded: 2 });

    const pkg = await settle(
      (await startUnrealJob({ root, sessionId: "s1", action: "package", target: "linux" })).id,
      "s1",
    );
    expect(pkg.status).toBe("succeeded");
    expect(pkg.data).toMatchObject({ platform: "Linux", contents: ["Linux"] });

    const saved = JSON.parse(
      await readFile(join(proj, ".locus-unreal", "runs", pkg.id, "job.json"), "utf8"),
    ) as { status: string };
    expect(saved.status).toBe("succeeded");
    await restoreUnrealJobs(root, "s2");
    expect(unrealJob(pkg.id, "s2")).toBeUndefined();
  });

  it("fails on Blueprint errors and on missing tests", async () => {
    const root = await fixture();
    await project(root);
    process.env.LOCUS_UNREAL_ENGINE = await fakeEngine(
      root,
      'echo "LogBlueprint: Error: [Compiler] Accessed None in BP_Gun"\nexit 1\n',
    );
    const compiled = await settle(
      (await startUnrealJob({ root, sessionId: "s3", action: "compile" })).id,
      "s3",
    );
    expect(compiled.status).toBe("failed");
    expect(compiled.message).toContain("BP_Gun");
    await expect(
      startUnrealJob({ root, sessionId: "s3", action: "package", target: "webgl" as never }),
    ).rejects.toThrow("package target");
    await expect(
      startUnrealJob({ root, sessionId: "s3", action: "python", script: "Content/Python/x.py" }),
    ).rejects.toThrow("not found");
  });

  it("requires PythonScriptPlugin for editor scripts", async () => {
    const root = await fixture();
    await project(root, { Plugins: [] });
    await mkdir(join(root, "Content", "Python"), { recursive: true });
    await writeFile(join(root, "Content", "Python", "x.py"), "pass\n");
    process.env.LOCUS_UNREAL_ENGINE = await fakeEngine(root, "exit 0\n");
    await expect(
      startUnrealJob({ root, sessionId: "s4", action: "python", script: "Content/Python/x.py" }),
    ).rejects.toThrow("PythonScriptPlugin");
  });
});
