import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  androidApk,
  androidProjectInfo,
  detectApplicationId,
  inputCommands,
  isAndroidAction,
  latestAndroidJob,
  parseDevices,
  resolveAndroidProject,
  startAndroidJob,
  validateAndroidProject,
} from "./runner.js";

const roots: string[] = [];
async function temp() {
  const root = await mkdtemp(join(tmpdir(), "locus-android-test-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Android operations", () => {
  it("lists only emulator devices and preserves offline state", () => {
    expect(
      parseDevices(
        "List of devices attached\nemulator-5554\tdevice\nemulator-5556\toffline\nphysical-phone\tdevice\n",
      ),
    ).toEqual([
      { serial: "emulator-5554", state: "device" },
      { serial: "emulator-5556", state: "offline" },
    ]);
  });
  it("allows fixed actions and rejects arbitrary tasks", () => {
    expect(isAndroidAction("build")).toBe(true);
    for (const action of ["__proto__", "constructor", ":app:arbitrary", null])
      expect(isAndroidAction(action)).toBe(false);
  });
  it("validates input before any adb shell invocation", () => {
    expect(inputCommands({ type: "tap", x: 120, y: 300 })).toEqual([
      ["shell", "input", "tap", "120", "300"],
    ]);
    expect(inputCommands({ type: "swipe", x: 10, y: 20, endX: 40, endY: 80 })).toEqual([
      ["shell", "input", "swipe", "10", "20", "40", "80", "300"],
    ]);
    expect(inputCommands({ type: "text", text: "hello world" })[0]).toEqual([
      "shell",
      "input",
      "text",
      "hello%sworld",
    ]);
    for (const text of ["$(id)", "hi;reboot", "'quoted'", "a\nb", "%s", "", "x".repeat(201)])
      expect(() => inputCommands({ type: "text", text })).toThrow();
    expect(() => inputCommands({ type: "tap", x: -1, y: 4 })).toThrow();
    expect(() => inputCommands({ type: "tap", x: NaN, y: 4 })).toThrow();
    expect(() => inputCommands({ type: "swipe", x: 1, y: 4 })).toThrow();
  });
  it("requires a Gradle project and wrapper", async () => {
    const root = await temp();
    await expect(validateAndroidProject(root)).rejects.toThrow();
    await writeFile(join(root, process.platform === "win32" ? "gradlew.bat" : "gradlew"), "");
    await expect(validateAndroidProject(root)).rejects.toThrow("Gradle project root");
    await writeFile(join(root, "settings.gradle.kts"), 'include(":app")');
    expect(await validateAndroidProject(root)).toBe(root);
  });
  it("accepts React Native projects with the Gradle project in android/", async () => {
    const root = await temp();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { react: "19.0.0", "react-native": "0.80.0" } }),
    );
    await expect(resolveAndroidProject(root)).rejects.toThrow("android/");
    const android = join(root, "android");
    await mkdir(join(android, "app"), { recursive: true });
    await writeFile(join(android, process.platform === "win32" ? "gradlew.bat" : "gradlew"), "");
    await writeFile(join(android, "settings.gradle"), "include ':app'");
    await writeFile(
      join(android, "app/build.gradle"),
      'android {\n  namespace "com.example.rn"\n  defaultConfig {\n    applicationId "com.example.habits"\n  }\n}',
    );
    const project = await resolveAndroidProject(root);
    expect(project).toMatchObject({ root, gradleRoot: android, kind: "react-native", expo: false });
    expect(await validateAndroidProject(root)).toBe(root);
    expect(await androidProjectInfo(root)).toMatchObject({
      kind: "react-native",
      applicationId: "com.example.habits",
      metro: { managed: false },
      issue: null,
    });
  });
  it("tells Expo projects without android/ to run prebuild", async () => {
    const root = await temp();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { expo: "54.0.0", "react-native": "0.81.0" } }),
    );
    expect(await androidProjectInfo(root)).toMatchObject({
      kind: null,
      issue: expect.stringContaining("expo prebuild"),
    });
  });
  it("detects applicationId from Kotlin DSL and falls back to namespace", async () => {
    const root = await temp();
    await mkdir(join(root, "app"));
    await writeFile(
      join(root, "app/build.gradle.kts"),
      'android {\n  namespace = "com.example.ns"\n  defaultConfig { applicationId = "com.example.app" }\n}',
    );
    expect(await detectApplicationId(root)).toBe("com.example.app");
    await writeFile(join(root, "app/build.gradle.kts"), 'android { namespace = "com.example.ns" }');
    expect(await detectApplicationId(root)).toBe("com.example.ns");
    expect(await detectApplicationId(await temp())).toBeNull();
  });
  it.skipIf(process.platform === "win32")(
    "runs Gradle from android/ for React Native projects",
    async () => {
      const root = await temp();
      const sdk = await temp();
      await mkdir(join(sdk, "platform-tools"));
      await writeFile(join(sdk, "platform-tools/adb"), "");
      vi.stubEnv("ANDROID_HOME", sdk);
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ dependencies: { "react-native": "0.80.0" } }),
      );
      const android = join(root, "android");
      await mkdir(join(android, "app/build/outputs/apk/debug"), { recursive: true });
      await writeFile(join(android, "settings.gradle"), "include ':app'");
      await writeFile(join(android, "app/build/outputs/apk/debug/app-debug.apk"), "test APK");
      await writeFile(join(android, "gradlew"), 'echo "cwd=$(pwd) task=$1"\n');
      const job = await startAndroidJob(root, "build");
      await vi.waitFor(() => expect(job.status).toBe("succeeded"));
      expect(job.log).toContain("/android task=:app:assembleDebug");
      expect((await androidApk(root)).toString()).toBe("test APK");
      expect(latestAndroidJob(root)?.id).toBe(job.id);
    },
  );
  it.skipIf(process.platform === "win32")(
    "rejects APK symlinks outside the selected workspace",
    async () => {
      const root = await temp();
      const outside = await temp();
      await writeFile(join(outside, "secret.apk"), "private");
      await writeFile(join(root, "gradlew"), "");
      await writeFile(join(root, "settings.gradle"), "include ':app'");
      const output = join(root, "app/build/outputs/apk/debug");
      await mkdir(output, { recursive: true });
      await symlink(join(outside, "secret.apk"), join(output, "app-debug.apk"));
      await expect(androidApk(root)).rejects.toThrow("inside the project");
    },
  );
  it.skipIf(process.platform === "win32")(
    "executes fixed Gradle tasks and records success, failure and concurrent-operation rejection",
    async () => {
      const root = await temp();
      const sdk = await temp();
      await mkdir(join(sdk, "platform-tools"));
      await writeFile(join(sdk, "platform-tools/adb"), "");
      vi.stubEnv("ANDROID_HOME", sdk);
      await writeFile(join(root, "settings.gradle"), 'include(":app")');
      await mkdir(join(root, "app/build/outputs/apk/debug"), { recursive: true });
      await writeFile(join(root, "app/build/outputs/apk/debug/app-debug.apk"), "test APK");
      await writeFile(
        join(root, "gradlew"),
        'echo "task=$1"\nsleep 0.2\n[ "$1" != ":app:lintDebug" ]\n',
      );
      const first = await startAndroidJob(root, "build");
      await expect(startAndroidJob(root, "test")).rejects.toThrow("already running");
      await vi.waitFor(() => expect(first.status).toBe("succeeded"));
      expect(first.log).toContain("task=:app:assembleDebug");
      expect(latestAndroidJob(root)?.id).toBe(first.id);
      const failed = await startAndroidJob(root, "lint");
      await vi.waitFor(() => expect(failed.status).toBe("failed"));
      expect(failed.log).toContain("Gradle exited with 1");
      expect(latestAndroidJob(await temp())).toBeNull();
    },
  );
});
