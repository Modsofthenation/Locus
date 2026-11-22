import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { connect } from "node:net";
import type {
  AndroidAction,
  AndroidEnvironment,
  AndroidJob,
  AndroidProjectInfo,
  AndroidProjectKind,
} from "@locus/shared";

const jobs = new Map<string, { root: string; job: AndroidJob }>();
const busy = new Set<string>();
const booting = new Set<string>();
const emulatorIssues = new Map<string, string>();
const windows = process.platform === "win32";
const binary = (name: string) => name + (windows ? ".exe" : "");

export function command(
  file: string,
  args: string[],
  timeout = 15000,
  env = process.env,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout, maxBuffer: 20 * 1024 * 1024, encoding: "buffer", env },
      (error, out, err) => {
        if (error) reject(new Error(`${file}: ${err.toString().trim() || error.message}`));
        else resolve(out);
      },
    );
  });
}

async function sdkRoot(): Promise<string> {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(homedir(), "Android", "Sdk"),
    join(homedir(), "Library", "Android", "sdk"),
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Android", "Sdk") : undefined,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(join(candidate, "platform-tools", binary("adb")));
      return candidate;
    } catch {
      /* next */
    }
  }
  throw new Error(
    "Android SDK not found. Install Android Studio, Platform Tools and Emulator, then set ANDROID_HOME and restart Locus.",
  );
}

async function adb(args: string[], timeout?: number) {
  return command(join(await sdkRoot(), "platform-tools", binary("adb")), args, timeout);
}

export async function androidEnvironment(): Promise<AndroidEnvironment> {
  const result: AndroidEnvironment = { sdk: null, avds: [], devices: [], issues: [] };
  result.issues.push(...emulatorIssues.values());
  try {
    result.sdk = await sdkRoot();
  } catch (error) {
    result.issues.push(String(error));
    return result;
  }
  const checks = await Promise.allSettled([
    command(join(result.sdk, "emulator", binary("emulator")), ["-list-avds"]),
    adb(["devices"]),
    command("java", ["-version"]),
  ]);
  const avds = checks[0]!;
  if (avds.status === "fulfilled")
    result.avds = avds.value
      .toString()
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  else result.issues.push("Emulator unavailable: install Android Emulator in Android Studio.");
  const devices = checks[1]!;
  if (devices.status === "fulfilled") result.devices = parseDevices(devices.value.toString());
  else result.issues.push(String(devices.reason));
  if (checks[2]!.status === "rejected")
    result.issues.push(
      "Java unavailable: install the JDK required by this project's Android Gradle plugin.",
    );
  if (!result.avds.length)
    result.issues.push(
      "No virtual devices. Create phone, tablet or foldable AVDs in Android Studio → Device Manager.",
    );
  return result;
}

export function parseDevices(output: string): AndroidEnvironment["devices"] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = /^(emulator-\d+)\s+(\S+)/.exec(line);
    return match ? [{ serial: match[1]!, state: match[2]! }] : [];
  });
}

async function requireDevice(serial: string) {
  if (!/^emulator-\d+$/.test(serial)) throw new Error("Select an Android emulator");
  const devices = parseDevices((await adb(["devices"])).toString());
  if (!devices.some((device) => device.serial === serial && device.state === "device"))
    throw new Error("Emulator is offline or still starting. Refresh devices after it boots.");
}

export async function bootAndroid(avd: string) {
  const environment = await androidEnvironment();
  if (!environment.sdk || !environment.avds.includes(avd))
    throw new Error("Select an installed AVD");
  if (booting.has(avd)) throw new Error("This virtual device is already starting");
  booting.add(avd);
  emulatorIssues.delete(avd);
  const child = spawn(
    join(environment.sdk, "emulator", binary("emulator")),
    ["-avd", avd, "-no-window", "-no-audio", "-no-boot-anim"],
    { stdio: "ignore", detached: true },
  );
  child.once("exit", (code) => {
    booting.delete(avd);
    if (code)
      emulatorIssues.set(
        avd,
        `${avd} exited with code ${code}. Check the system image and hardware acceleration in Android Studio Device Manager.`,
      );
  });
  child.once("error", (error) => {
    booting.delete(avd);
    emulatorIssues.set(avd, `${avd}: ${error.message}`);
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
}

export async function stopAndroid(serial: string) {
  await requireDevice(serial);
  await adb(["-s", serial, "emu", "kill"]);
}

export async function androidScreen(serial: string) {
  await requireDevice(serial);
  const png = await adb(["-s", serial, "exec-out", "screencap", "-p"]);
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error("Emulator did not return a PNG screenshot");
  return png;
}

export type AndroidInput =
  | { type: "tap" | "swipe"; x: number; y: number; endX?: number; endY?: number }
  | { type: "key"; key: "back" | "home" | "recent" }
  | { type: "text"; text: string }
  | { type: "rotate"; landscape: boolean };

export function inputCommands(input: AndroidInput): string[][] {
  if (input.type === "key") {
    const keys = { back: "4", home: "3", recent: "187" };
    if (!Object.hasOwn(keys, input.key)) throw new Error("Unsupported key");
    const key = keys[input.key];
    return [["shell", "input", "keyevent", key]];
  }
  if (input.type === "rotate") {
    if (typeof input.landscape !== "boolean") throw new Error("Invalid orientation");
    return [
      ["shell", "settings", "put", "system", "accelerometer_rotation", "0"],
      ["shell", "settings", "put", "system", "user_rotation", input.landscape ? "1" : "0"],
    ];
  }
  if (input.type === "text") {
    // adb shell joins arguments into a remote shell command; restrict metacharacters.
    if (!/^[a-zA-Z0-9 .,@_+-]{1,200}$/.test(input.text))
      throw new Error("Text input supports up to 200 Latin letters, numbers and basic punctuation");
    return [["shell", "input", "text", input.text.replaceAll(" ", "%s")]];
  }
  if (input.type !== "tap" && input.type !== "swipe") throw new Error("Unsupported input");
  const coords =
    input.type === "tap" ? [input.x, input.y] : [input.x, input.y, input.endX, input.endY];
  if (!coords.every((value) => Number.isInteger(value) && value! >= 0 && value! <= 16384))
    throw new Error("Invalid screen coordinates");
  return [
    [
      "shell",
      "input",
      input.type,
      ...coords.map(String),
      ...(input.type === "swipe" ? ["300"] : []),
    ],
  ];
}

export async function androidInput(serial: string, input: AndroidInput) {
  const commands = inputCommands(input);
  await requireDevice(serial);
  for (const args of commands) await adb(["-s", serial, ...args]);
}

export const ANDROID_TASKS = {
  build: ":app:assembleDebug",
  test: ":app:testDebugUnitTest",
  lint: ":app:lintDebug",
  instrument: ":app:connectedDebugAndroidTest",
  run: ":app:assembleDebug",
} as const;
export function isAndroidAction(value: unknown): value is AndroidAction {
  return typeof value === "string" && Object.hasOwn(ANDROID_TASKS, value);
}

async function isFile(path: string) {
  return stat(path)
    .then((s) => s.isFile())
    .catch(() => false);
}

async function isGradleRoot(dir: string) {
  if (!(await isFile(join(dir, windows ? "gradlew.bat" : "gradlew")))) return false;
  return (await isFile(join(dir, "settings.gradle.kts"))) || isFile(join(dir, "settings.gradle"));
}

async function packageJson(root: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function dependsOn(pkg: Record<string, unknown> | null, name: string) {
  if (!pkg) return false;
  return ["dependencies", "devDependencies"].some((field) => {
    const deps = pkg[field];
    return !!deps && typeof deps === "object" && Object.hasOwn(deps, name);
  });
}

export interface AndroidProject {
  /** Canonical workspace root (package.json lives here for React Native). */
  root: string;
  /** Directory containing gradlew and settings.gradle(.kts). */
  gradleRoot: string;
  kind: AndroidProjectKind;
  expo: boolean;
}

/**
 * Accept a native Gradle project at the workspace root, or a React Native / Expo
 * project whose Gradle project lives in android/.
 */
export async function resolveAndroidProject(root: string): Promise<AndroidProject> {
  const canonical = await realpath(root);
  const pkg = await packageJson(canonical);
  const reactNative = dependsOn(pkg, "react-native");
  const expo = dependsOn(pkg, "expo");
  if (reactNative || expo) {
    const gradleRoot = join(canonical, "android");
    if (await isGradleRoot(gradleRoot))
      return {
        root: canonical,
        gradleRoot: await realpath(gradleRoot),
        kind: "react-native",
        expo,
      };
    throw new Error(
      expo
        ? "React Native (Expo) project has no android/ Gradle project yet. Run `npx expo prebuild --platform android` first."
        : "React Native project is missing android/gradlew and android/settings.gradle(.kts).",
    );
  }
  if (await isGradleRoot(canonical))
    return { root: canonical, gradleRoot: canonical, kind: "native", expo: false };
  throw new Error(
    "Select a Gradle project root containing settings.gradle(.kts) and the Gradle wrapper, or a React Native project with an android/ folder",
  );
}

/** Kept for callers that only need the canonical root. */
export async function validateAndroidProject(root: string) {
  return (await resolveAndroidProject(root)).root;
}

const APPLICATION_ID = /\bapplicationId\s*(?:=\s*)?["']([A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+)["']/;
const NAMESPACE = /\bnamespace\s*(?:=\s*)?["']([A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+)["']/;

export async function detectApplicationId(gradleRoot: string): Promise<string | null> {
  for (const file of ["app/build.gradle.kts", "app/build.gradle"]) {
    try {
      const text = await readFile(join(gradleRoot, file), "utf8");
      const match = APPLICATION_ID.exec(text) ?? NAMESPACE.exec(text);
      if (match) return match[1]!;
    } catch {
      /* next */
    }
  }
  return null;
}

export async function androidProjectInfo(root: string): Promise<AndroidProjectInfo> {
  try {
    const project = await resolveAndroidProject(root);
    return {
      kind: project.kind,
      expo: project.expo,
      applicationId: await detectApplicationId(project.gradleRoot),
      metro: project.kind === "react-native" ? metroState(project.root) : null,
      issue: null,
    };
  } catch (error) {
    return {
      kind: null,
      expo: false,
      applicationId: null,
      metro: null,
      issue: error instanceof Error ? error.message : String(error),
    };
  }
}

/* ---------- Metro bundler for React Native debug builds ---------- */

const METRO_PORT = 8081;
const metros = new Map<string, { pid?: number; log: string; exited: boolean }>();

function portOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(500, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function metroState(root: string): AndroidProjectInfo["metro"] {
  const entry = metros.get(root);
  return { managed: !!entry && !entry.exited, log: entry?.log.slice(-4000) ?? "" };
}

function killTree(pid: number) {
  if (windows) {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    killer.on("error", () => undefined);
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

/** Start Metro in the project root unless something already listens on 8081. */
export async function ensureMetro(project: AndroidProject, append: (s: string) => void) {
  if (await portOpen(METRO_PORT)) {
    append(`\nMetro already listening on port ${METRO_PORT}.\n`);
    return;
  }
  const existing = metros.get(project.root);
  if (existing && !existing.exited && existing.pid) killTree(existing.pid);
  // Fixed arguments only; cmd.exe is required for npx.cmd on Windows.
  const cli = project.expo
    ? ["expo", "start", "--port", String(METRO_PORT)]
    : ["react-native", "start", "--port", String(METRO_PORT)];
  const wrapper = windows ? "cmd.exe" : "npx";
  const args = windows ? ["/d", "/c", "npx", ...cli] : cli;
  append(`\nStarting Metro: npx ${cli.join(" ")}\n`);
  const child = spawn(wrapper, args, {
    cwd: project.root,
    env: { ...process.env, BROWSER: "none" },
    detached: !windows,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const entry = { pid: child.pid, log: "", exited: false };
  metros.set(project.root, entry);
  const record = (chunk: Buffer) => {
    entry.log = (entry.log + chunk.toString()).slice(-20000);
  };
  child.stdout?.on("data", record);
  child.stderr?.on("data", record);
  child.once("exit", () => {
    entry.exited = true;
  });
  child.once("error", (error) => {
    entry.exited = true;
    entry.log += `\n${error.message}\n`;
  });
  child.unref();
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (entry.exited)
      throw new Error(`Metro exited before it was ready:\n${entry.log.slice(-2000)}`);
    if (await portOpen(METRO_PORT)) {
      append(`Metro ready on port ${METRO_PORT}.\n`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Metro did not start listening on port 8081 within 60 seconds");
}

export async function stopMetro(root: string) {
  const project = await resolveAndroidProject(root);
  const entry = metros.get(project.root);
  if (!entry || entry.exited || !entry.pid)
    throw new Error("Locus is not running Metro for this project");
  killTree(entry.pid);
  entry.exited = true;
}

export function latestAndroidJob(root: string): AndroidJob | null {
  return [...jobs.values()].reverse().find((entry) => entry.root === root)?.job ?? null;
}

async function apkPath(root: string): Promise<string> {
  const { root: canonical, gradleRoot } = await resolveAndroidProject(root);
  const apk = await realpath(join(gradleRoot, "app/build/outputs/apk/debug/app-debug.apk"));
  const rel = relative(canonical, apk);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error("APK must be inside the project workspace");
  return apk;
}

export async function androidApk(root: string): Promise<Buffer> {
  return readFile(await apkPath(root));
}

export async function startAndroidJob(
  root: string,
  action: AndroidAction,
  serial?: string,
  packageName?: string,
): Promise<AndroidJob> {
  const project = await resolveAndroidProject(root);
  root = project.root;
  if (busy.has(root)) throw new Error("An Android operation is already running in this workspace");
  const sdk = await sdkRoot();
  if (action === "run" || action === "instrument") {
    if (!serial) throw new Error("Select a running emulator first");
    await requireDevice(serial);
  }
  if (action === "run" && (!packageName || !/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(packageName)))
    throw new Error("Enter the app's applicationId, for example com.example.myapp");
  // Recheck after asynchronous validation to serialize competing callers.
  if (busy.has(root)) throw new Error("An Android operation is already running in this workspace");
  busy.add(root);
  const job: AndroidJob = {
    id: randomUUID(),
    action,
    status: "running",
    startedAt: new Date().toISOString(),
    log: "",
  };
  jobs.set(job.id, { root, job });
  while (jobs.size > 100) {
    const finished = [...jobs].find(([, entry]) => entry.job.status !== "running");
    if (!finished) break;
    jobs.delete(finished[0]);
  }
  const env = {
    ...process.env,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
    ...(serial ? { ANDROID_SERIAL: serial } : {}),
  };
  const append = (chunk: Buffer | string) => {
    job.log = (job.log + chunk.toString()).slice(-100000);
  };
  void (async () => {
    try {
      await new Promise<void>((resolve, reject) => {
        // cmd.exe is required for Windows batch wrappers. All task arguments are fixed.
        const wrapper = windows ? "cmd.exe" : "sh";
        const args = windows ? ["/d", "/c", "gradlew.bat"] : ["./gradlew"];
        const child = spawn(
          wrapper,
          [...args, ANDROID_TASKS[action], "--console=plain", "--no-daemon"],
          { cwd: project.gradleRoot, env, detached: !windows },
        );
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          if (windows && child.pid) {
            const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
              stdio: "ignore",
            });
            killer.on("error", () => child.kill("SIGKILL"));
          } else {
            try {
              if (child.pid) process.kill(-child.pid, "SIGKILL");
            } catch {
              child.kill("SIGKILL");
            }
          }
        }, 600000);
        child.stdout.on("data", append);
        child.stderr.on("data", append);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("close", (code) => {
          clearTimeout(timer);
          if (code === 0 && !timedOut) resolve();
          else
            reject(
              new Error(
                timedOut
                  ? "Gradle timed out after 10 minutes"
                  : `Gradle exited with ${code ?? "a signal"}`,
              ),
            );
        });
      });
      if (action === "build" || action === "run") await apkPath(root);
      if (action === "run") {
        await requireDevice(serial!);
        append(await adb(["-s", serial!, "install", "-r", await apkPath(root)], 120000));
        if (project.kind === "react-native") {
          // Debug React Native builds load JavaScript from Metro on the host.
          await ensureMetro(project, append);
          append(await adb(["-s", serial!, "reverse", `tcp:${METRO_PORT}`, `tcp:${METRO_PORT}`]));
        }
        append(
          await adb([
            "-s",
            serial!,
            "shell",
            "monkey",
            "-p",
            packageName!,
            "-c",
            "android.intent.category.LAUNCHER",
            "1",
          ]),
        );
      }
      job.status = "succeeded";
    } catch (error) {
      job.status = "failed";
      append(`\n${String(error)}\n`);
    } finally {
      job.finishedAt = new Date().toISOString();
      busy.delete(root);
    }
  })();
  return job;
}
