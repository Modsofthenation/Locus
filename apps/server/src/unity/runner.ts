import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { UNITY_EDITOR_SCRIPT } from "./editorScript.js";

export type UnityAction = "inspect" | "compile" | "playtest" | "capture" | "build" | "create-scene";
export interface UnityJob {
  id: string;
  sessionId: string;
  action: UnityAction;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  message?: string;
  editor?: string;
  log?: string;
  data?: unknown;
  screenshot?: boolean;
  webglReady?: boolean;
}
type JobInternal = UnityJob & { screenshotPath?: string; outputDir: string };
const JOBS = new Map<string, JobInternal>();
const BUSY = new Set<string>();
const ACTIONS: UnityAction[] = [
  "inspect",
  "compile",
  "playtest",
  "capture",
  "build",
  "create-scene",
];
const MAX_LOG_CHARS = 20000;
const MAX_JOBS = 100;
const RESTORED = new Set<string>();

/** Recover completed Unity operations and previews after restarting Locus. */
export async function restoreUnityJobs(selectedRoot: string, sessionId: string): Promise<void> {
  if (RESTORED.has(sessionId)) return;
  const { root } = await validateUnityProject(selectedRoot);
  const runs = join(root, ".locus-unity", "runs");
  const entries = await readdir(runs, { withFileTypes: true }).catch(() => []);
  const restored: JobInternal[] = [];
  for (const entry of entries.slice(-2000)) {
    if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/i.test(entry.name)) continue;
    const folder = join(runs, entry.name);
    let saved: Partial<UnityJob>;
    try {
      saved = JSON.parse(await readFile(join(folder, "job.json"), "utf8")) as Partial<UnityJob>;
    } catch {
      continue;
    }
    if (
      saved.id !== entry.name ||
      saved.sessionId !== sessionId ||
      !isUnityAction(saved.action) ||
      !["succeeded", "failed"].includes(saved.status ?? "") ||
      typeof saved.startedAt !== "string" ||
      typeof saved.finishedAt !== "string"
    )
      continue;
    restored.push({
      id: saved.id,
      sessionId,
      action: saved.action,
      status: saved.status!,
      startedAt: saved.startedAt,
      finishedAt: saved.finishedAt,
      exitCode: saved.exitCode,
      message: saved.message,
      editor: saved.editor,
      log: saved.log,
      data: saved.data,
      screenshot: saved.screenshot,
      webglReady: saved.webglReady,
      outputDir: folder,
      screenshotPath: saved.screenshot ? join(folder, "scene.png") : undefined,
    });
  }
  restored.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const job of restored) if (!JOBS.has(job.id)) JOBS.set(job.id, job);
  RESTORED.add(sessionId);
}

export function isUnityAction(action: unknown): action is UnityAction {
  return typeof action === "string" && ACTIONS.includes(action as UnityAction);
}
export function unityJob(id: string, sessionId: string): UnityJob | undefined {
  const job = JOBS.get(id);
  if (!job || job.sessionId !== sessionId) return undefined;
  const { screenshotPath: _screenshotPath, outputDir: _outputDir, ...publicJob } = job;
  return publicJob;
}
/** Most recent run in this session, useful for agents after a tool turn. */
export function latestUnityJob(sessionId: string): UnityJob | undefined {
  const latest = [...JOBS.values()].reverse().find((job) => job.sessionId === sessionId);
  return latest ? unityJob(latest.id, sessionId) : undefined;
}

/** Serves only Unity-generated WebGL build output from a successful job. */
export function latestUnityWebglJob(sessionId: string): UnityJob | undefined {
  const found = [...JOBS.values()]
    .reverse()
    .find((job) => job.sessionId === sessionId && job.status === "succeeded" && job.webglReady);
  return found ? unityJob(found.id, sessionId) : undefined;
}

export function isSafeUnityWebglPath(rel: string): boolean {
  const parts = rel.split("/");
  return (
    rel.length > 0 &&
    rel.length <= 512 &&
    !rel.includes("\\") &&
    parts.every(
      (segment) => /^[A-Za-z0-9_.-]+$/.test(segment) && segment !== "." && segment !== "..",
    ) &&
    (rel === "index.html" || ["Build", "TemplateData", "StreamingAssets"].includes(parts[0] ?? ""))
  );
}

/** Serve only the output of a successful scoped Unity WebGL build. */
export async function unityWebglAsset(
  id: string,
  sessionId: string,
  requested: string,
): Promise<{ path: string; size: number; mime: string } | undefined> {
  const job = JOBS.get(id);
  if (!job || job.sessionId !== sessionId || job.status !== "succeeded" || !job.webglReady)
    return undefined;
  const rel = requested || "index.html";
  if (!isSafeUnityWebglPath(rel)) return undefined;
  const root = await realpath(join(job.outputDir, "WebGL")).catch(() => undefined);
  if (!root) return undefined;
  const path = resolve(root, rel);
  if (!path.startsWith(root + sep)) return undefined;
  try {
    const canonical = await realpath(path);
    if (!canonical.startsWith(root + sep)) return undefined;
    const size = await stat(canonical);
    if (!size.isFile() || size.size > 350 * 1024 * 1024) return undefined;
    const ext = rel.split(".").pop()?.toLowerCase() ?? "";
    const mime =
      (
        {
          html: "text/html; charset=utf-8",
          js: "text/javascript; charset=utf-8",
          css: "text/css; charset=utf-8",
          json: "application/json",
          wasm: "application/wasm",
          data: "application/octet-stream",
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          svg: "image/svg+xml",
          ico: "image/x-icon",
          txt: "text/plain; charset=utf-8",
          webp: "image/webp",
          mp4: "video/mp4",
          woff: "font/woff",
          woff2: "font/woff2",
        } as Record<string, string>
      )[ext] ?? "application/octet-stream";
    return { path: canonical, size: size.size, mime };
  } catch {
    return undefined;
  }
}

export async function unityScreenshot(id: string, sessionId: string): Promise<Buffer | undefined> {
  const job = JOBS.get(id);
  if (!job || job.sessionId !== sessionId || !job.screenshotPath) return undefined;
  try {
    return await readFile(job.screenshotPath);
  } catch {
    return undefined;
  }
}

async function editorPath(explicit?: string, expectedVersion?: string): Promise<string> {
  const candidates: string[] = [];
  if (explicit?.trim()) candidates.push(explicit.trim());
  if (process.env.LOCUS_UNITY_EDITOR?.trim())
    candidates.push(process.env.LOCUS_UNITY_EDITOR.trim());
  const path = process.env.PATH ?? "";
  const names = process.platform === "win32" ? ["Unity.exe"] : ["Unity"];
  for (const folder of path.split(process.platform === "win32" ? ";" : ":")) {
    for (const name of names) candidates.push(join(folder, name));
  }
  if (process.platform === "darwin")
    candidates.push("/Applications/Unity/Hub/Editor/Unity.app/Contents/MacOS/Unity");
  // A Unity Hub installation is not an Editor installation. Resolve only real Editor executables.
  const hubRoots =
    process.platform === "win32"
      ? ["C:\\Program Files\\Unity\\Hub\\Editor"]
      : process.platform === "darwin"
        ? ["/Applications/Unity/Hub/Editor"]
        : [join(process.env.HOME ?? "", "Unity/Hub/Editor"), "/opt/unity/Editor"];
  for (const root of hubRoots) {
    try {
      const versions = (await readdir(root)).sort().reverse();
      for (const version of versions) {
        candidates.push(
          join(
            root,
            version,
            process.platform === "win32"
              ? "Editor/Unity.exe"
              : process.platform === "darwin"
                ? "Unity.app/Contents/MacOS/Unity"
                : "Editor/Unity",
          ),
        );
      }
    } catch {
      /* not installed here */
    }
  }
  const preferred = expectedVersion
    ? candidates.filter((candidate) =>
        candidate.replaceAll("\\", "/").includes("/" + expectedVersion + "/"),
      )
    : [];
  for (const candidate of [...preferred, ...candidates]) {
    if (!isAbsolute(candidate)) continue;
    // A known Unity Hub Editor with a different version could upgrade existing
    // serialized assets. Do not pick it as an automatic fallback.
    const versionFromPath = candidate.match(
      /(?:^|[\\/])(\d{4}\.\d+\.\d+[a-z]\d+)(?:[\\/]|$)/i,
    )?.[1];
    const explicitlyConfigured = Boolean(
      candidate === explicit?.trim() || candidate === process.env.LOCUS_UNITY_EDITOR?.trim(),
    );
    // For auto-discovery, refuse an unversioned or mismatching binary. Unity
    // may upgrade serialized project assets simply by opening the project.
    if (expectedVersion && !explicitlyConfigured && versionFromPath !== expectedVersion) continue;
    try {
      if ((await stat(candidate)).isFile()) return await realpath(candidate);
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "No matching Unity Editor found for project version " +
      (expectedVersion ?? "(unknown)") +
      ". Install the exact project version in Unity Hub, or explicitly configure LOCUS_UNITY_EDITOR.",
  );
}

export async function validateUnityProject(
  root: string,
): Promise<{ root: string; unityVersion: string }> {
  const selected = await realpath(root);
  // New projects are created as children of the selected Host workspace.
  // Discover one level down only; never guess when there is more than one project.
  let project = selected;
  if (!existsSync(join(project, "ProjectSettings", "ProjectVersion.txt"))) {
    const candidates: string[] = [];
    for (const entry of await readdir(selected, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(selected, entry.name);
      if (existsSync(join(path, "ProjectSettings", "ProjectVersion.txt"))) candidates.push(path);
    }
    if (candidates.length === 1) project = await realpath(candidates[0]!);
    else if (candidates.length > 1)
      throw new Error(
        "Multiple Unity projects found. Select a specific project directory as your Host workspace.",
      );
  }
  const [assets, manifest, version] = await Promise.all([
    stat(join(project, "Assets")).catch(() => undefined),
    stat(join(project, "Packages", "manifest.json")).catch(() => undefined),
    readFile(join(project, "ProjectSettings", "ProjectVersion.txt"), "utf8").catch(() => ""),
  ]);
  if (!assets?.isDirectory() || !manifest?.isFile() || !version) {
    throw new Error(
      "Select a Unity project folder containing Assets/, Packages/manifest.json and ProjectSettings/ProjectVersion.txt.",
    );
  }
  const match = /^m_EditorVersion:\s*(\d{4}\.\d+\.\d+[a-z]\d+)\s*$/im.exec(version);
  if (!match)
    throw new Error("Unity ProjectVersion.txt does not contain a valid Unity Editor version.");
  return { root: project, unityVersion: match[1]! };
}

async function prepareBridge(root: string): Promise<() => Promise<void>> {
  // Never overwrite existing project source or its .meta GUID. Unity will create the
  // temporary script's .meta on import; remove both only if we created them.
  const folder = join(root, "Assets", "Editor");
  const file = join(folder, "LocusUnityAutomation.cs");
  const meta = file + ".meta";
  if (existsSync(file) || existsSync(meta)) {
    throw new Error(
      "Unity bridge file already exists. Move or rename Assets/Editor/LocusUnityAutomation.cs before retrying.",
    );
  }
  await mkdir(folder, { recursive: true });
  await writeFile(file, UNITY_EDITOR_SCRIPT, { encoding: "utf8", flag: "wx" });
  return async () => {
    await rm(file, { force: true });
    await rm(meta, { force: true });
  };
}

async function runEditor(
  editor: string,
  root: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  logPath: string,
  timeoutMs = 15 * 60 * 1000,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(
      editor,
      [
        "-batchmode",
        ...(args.includes("-runTests") ? [] : ["-quit"]),
        "-projectPath",
        root,
        "-logFile",
        logPath,
        ...args,
      ],
      {
        cwd: root,
        shell: false,
        windowsHide: true,
        env,
        stdio: "ignore",
        // A separate process group lets termination reach Unity's build children.
        detached: process.platform !== "win32",
      },
    );
    const killTree = (signal: NodeJS.Signals) => {
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          shell: false,
          windowsHide: true,
          stdio: "ignore",
        });
        killer.once("error", () => child.kill(signal));
        return;
      }
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          /* fall back to the direct child */
        }
      }
      child.kill(signal);
    };
    let timedOut = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      killTree("SIGTERM");
      // Wait for actual process termination before clearing the project lock
      // and removing the temporary Editor script. Never settle on timer expiry.
      escalation = setTimeout(() => killTree("SIGKILL"), 10_000);
    }, timeoutMs);
    function clear() {
      clearTimeout(timeout);
      if (escalation) clearTimeout(escalation);
    }
    child.once("error", (error) => {
      clear();
      reject(error);
    });
    child.once("close", (code, signal) => {
      clear();
      if (timedOut)
        reject(
          new Error(
            "Unity Editor timed out after " +
              Math.round(timeoutMs / 60_000) +
              " minutes and was terminated",
          ),
        );
      else if (signal) reject(new Error("Unity Editor terminated: " + signal));
      else resolve(code ?? -1);
    });
  });
}

export async function startUnityJob(input: {
  root: string;
  sessionId: string;
  action: UnityAction;
  editor?: string;
  scene?: string;
  target?: "linux" | "windows" | "macos" | "webgl";
}): Promise<UnityJob> {
  const { root, unityVersion } = await validateUnityProject(input.root);
  if (BUSY.has(root)) throw new Error("A Unity operation is already running for this project.");
  if (existsSync(join(root, "Temp", "UnityLockfile"))) {
    throw new Error(
      "The project appears to be open in Unity Editor. Close it before running a batch operation to protect its AssetDatabase.",
    );
  }
  const editor = await editorPath(
    input.editor,
    unityVersion === "unknown" ? undefined : unityVersion,
  );
  if (
    (input.action === "capture" || input.action === "create-scene") &&
    (!input.scene || !/^Assets\/[^\\]*\.unity$/.test(input.scene) || input.scene.includes(".."))
  ) {
    throw new Error("A valid .unity scene path relative to Assets/ is required for capture.");
  }
  if (
    input.action === "build" &&
    !["linux", "windows", "macos", "webgl"].includes(input.target ?? "")
  ) {
    throw new Error("Choose a supported build target: linux, windows, macos or webgl.");
  }
  const id = randomUUID();
  const outputDir = join(root, ".locus-unity", "runs", id);
  if (BUSY.has(root)) throw new Error("A Unity operation is already running for this project.");
  BUSY.add(root);
  try {
    await mkdir(outputDir, { recursive: true, mode: 0o700 });
  } catch (error) {
    BUSY.delete(root);
    throw error;
  }
  const job: JobInternal = {
    id,
    sessionId: input.sessionId,
    action: input.action,
    status: "running",
    startedAt: new Date().toISOString(),
    outputDir,
    editor,
    message: "Running Unity " + input.action + " (project version " + unityVersion + ")",
  };
  JOBS.set(job.id, job);
  // The request returns immediately; poll the job endpoint for actual status.
  void (async () => {
    let cleanup: (() => Promise<void>) | undefined;
    let successful = false;
    try {
      const args: string[] = [];
      const env: NodeJS.ProcessEnv = { ...process.env, LOCUS_UNITY_OUTPUT: outputDir };
      if (
        input.action === "inspect" ||
        input.action === "capture" ||
        input.action === "build" ||
        input.action === "create-scene"
      ) {
        cleanup = await prepareBridge(root);
        if (input.action === "capture" || input.action === "create-scene")
          env.LOCUS_UNITY_SCENE = input.scene;
        if (input.action === "build") env.LOCUS_UNITY_TARGET = input.target;
        args.push(
          "-executeMethod",
          input.action === "inspect"
            ? "LocusUnityAutomation.Inspect"
            : input.action === "capture"
              ? "LocusUnityAutomation.Capture"
              : input.action === "create-scene"
                ? "LocusUnityAutomation.CreateScene"
                : "LocusUnityAutomation.Build",
        );
      }
      if (input.action === "playtest") {
        args.push(
          "-runTests",
          "-testPlatform",
          "PlayMode",
          "-testResults",
          join(outputDir, "playmode-results.xml"),
        );
      }
      // PlayMode tests and scene captures can require a graphics context.
      if (input.action !== "capture" && input.action !== "playtest") args.push("-nographics");
      const code = await runEditor(
        editor,
        root,
        args,
        env,
        join(outputDir, "editor.log"),
        input.action === "build" && input.target === "webgl" ? 45 * 60 * 1000 : 15 * 60 * 1000,
      );
      job.exitCode = code;
      if (input.action === "inspect") {
        const raw = await readFile(join(outputDir, "scenes.json"), "utf8");
        job.data = JSON.parse(raw) as unknown;
        if ((job.data as { error?: string }).error)
          throw new Error("Unity scene inspection failed");
      }
      if (input.action === "create-scene") {
        job.data = { createdScene: await readFile(join(outputDir, "created-scene.txt"), "utf8") };
      }
      if (input.action === "build") {
        const raw = await readFile(join(outputDir, "build-result.json"), "utf8");
        job.data = { ...(JSON.parse(raw) as Record<string, unknown>), target: input.target };
        if (input.target === "webgl") {
          if (
            !(await stat(join(outputDir, "WebGL", "index.html")).catch(() => undefined))?.isFile()
          )
            throw new Error("Unity WebGL build did not produce index.html");
          job.webglReady = true;
        }
      }
      if (input.action === "playtest") {
        const xml = await readFile(join(outputDir, "playmode-results.xml"), "utf8");
        // Unity Test Runner emits NUnit XML. Treat failed/inconclusive tests as failure.
        const match = /<test-run\b[^>]*\bresult="([^"]+)"/.exec(xml);
        const total = /\btotal="(\d+)"/.exec(xml);
        job.data = {
          result: match?.[1] ?? "Unknown",
          total: Number(total?.[1] ?? "0"),
          report: xml.slice(0, 12000),
        };
        if (match?.[1] !== "Passed" || Number(total?.[1] ?? "0") < 1)
          throw new Error("PlayMode tests did not pass (or no tests were found)");
      }
      if (input.action === "capture") {
        const screenshot = join(outputDir, "scene.png");
        if (!(await stat(screenshot).catch(() => undefined))?.isFile())
          throw new Error("Unity did not produce a screenshot (graphics may be unavailable)");
        job.screenshotPath = screenshot;
        job.screenshot = true;
      }
      if (code !== 0) throw new Error("Unity Editor exited with code " + code);
      // Unity has historically returned status 0 for some script compilation failures.
      const editorLog = await readFile(join(outputDir, "editor.log"), "utf8").catch(() => "");
      if (
        /\berror CS\d{4}\b|Compilation failed|Scripts have compiler errors|Compile errors encountered/i.test(
          editorLog,
        )
      ) {
        throw new Error("Unity script compilation errors detected in Editor.log");
      }
      successful = true;
    } catch (error) {
      job.status = "failed";
      job.message = error instanceof Error ? error.message : String(error);
    } finally {
      try {
        job.log = (await readFile(join(outputDir, "editor.log"), "utf8")).slice(-MAX_LOG_CHARS);
      } catch {
        /* no log */
      }
      try {
        await cleanup?.();
      } catch (error) {
        job.status = "failed";
        job.message = "Could not clean up temporary Unity bridge: " + String(error);
      }
      if (successful && job.status !== "failed") {
        job.status = "succeeded";
        job.message = "Unity " + input.action + " completed successfully.";
      }
      job.finishedAt = new Date().toISOString();
      // Durable job state makes scene inspection and WebGL previews available
      // again after the Locus server is restarted.
      try {
        const { screenshotPath: _image, outputDir: _folder, ...record } = job;
        await writeFile(join(outputDir, "job.json"), JSON.stringify(record, null, 2));
      } catch {
        /* preserve the original job outcome and log */
      }
      BUSY.delete(root);
      if (JOBS.size > MAX_JOBS) {
        // Keep each session's latest playable preview accessible. Drop only
        // superseded in-memory metadata, never the user's build/log artifacts.
        const keep = new Set<string>();
        const sessions = new Set([...JOBS.values()].map((entry) => entry.sessionId));
        for (const sessionId of sessions) {
          const preview = latestUnityWebglJob(sessionId);
          const latest = latestUnityJob(sessionId);
          if (preview) keep.add(preview.id);
          if (latest) keep.add(latest.id);
        }
        for (const [id, old] of JOBS) {
          if (JOBS.size <= MAX_JOBS) break;
          if (old.status !== "running" && !keep.has(id)) JOBS.delete(id);
        }
      }
    }
  })();
  const { screenshotPath: _image, outputDir: _folder, ...publicJob } = job;
  return publicJob;
}
