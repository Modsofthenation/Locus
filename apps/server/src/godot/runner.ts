import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { GODOT_SCENE_INSPECTOR } from "./inspector.js";

export type GodotAction = "inspect" | "import" | "smoke" | "export" | "create-scene";
export type GodotTarget = "web" | "linux" | "windows" | "macos";
export interface GodotJob {
  id: string;
  sessionId: string;
  action: GodotAction;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt?: string;
  message?: string;
  exitCode?: number;
  log?: string;
  data?: unknown;
  webReady?: boolean;
}
type InternalJob = GodotJob & { folder: string };
const jobs = new Map<string, InternalJob>();
const busy = new Set<string>();
const restored = new Set<string>();
const actions: GodotAction[] = ["inspect", "import", "smoke", "export", "create-scene"];
const targets: GodotTarget[] = ["web", "linux", "windows", "macos"];
const logLimit = 24000;
const maxJobs = 100;

/** Do not allow a project-owned symlink to redirect generated job writes. */
export async function safeRunsDirectory(root: string): Promise<string> {
  let current = root;
  for (const name of [".locus-godot", "runs"]) {
    current = join(current, name);
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (info?.isSymbolicLink() || (info && !info.isDirectory())) {
      throw new Error("Godot job output path must be a real directory inside the project");
    }
    if (!info) await mkdir(current);
    if ((await realpath(current)) !== resolve(current)) {
      throw new Error("Godot job output directory resolves outside the project");
    }
  }
  return current;
}

export function isGodotAction(value: unknown): value is GodotAction {
  return typeof value === "string" && actions.includes(value as GodotAction);
}
export function isGodotTarget(value: unknown): value is GodotTarget {
  return typeof value === "string" && targets.includes(value as GodotTarget);
}
export function safeGodotWebPath(rel: string): boolean {
  if (!rel || rel.length > 512 || rel.includes("\\") || rel.startsWith("/")) return false;
  const parts = rel.split("/");
  if (!parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== "." && part !== ".."))
    return false;
  return parts.length === 1 || parts[0] === "assets" || parts[0] === "lib";
}
export function godotJob(id: string, sessionId: string): GodotJob | undefined {
  const row = jobs.get(id);
  if (!row || row.sessionId !== sessionId) return undefined;
  const { folder: _folder, ...publicRow } = row;
  return publicRow;
}
export function latestGodotJob(sessionId: string): GodotJob | undefined {
  const row = [...jobs.values()].reverse().find((entry) => entry.sessionId === sessionId);
  return row ? godotJob(row.id, sessionId) : undefined;
}
export function latestGodotWebJob(sessionId: string): GodotJob | undefined {
  const row = [...jobs.values()]
    .reverse()
    .find(
      (entry) => entry.sessionId === sessionId && entry.status === "succeeded" && entry.webReady,
    );
  return row ? godotJob(row.id, sessionId) : undefined;
}

export async function validateGodotProject(
  selected: string,
): Promise<{ root: string; config: string }> {
  const parent = await realpath(selected);
  let root = parent;
  if (!existsSync(join(parent, "project.godot"))) {
    const candidates: string[] = [];
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const path = join(parent, entry.name);
      if (existsSync(join(path, "project.godot"))) candidates.push(path);
    }
    if (candidates.length === 1) root = await realpath(candidates[0]!);
    else if (candidates.length > 1)
      throw new Error("Multiple Godot projects found. Select a specific Godot project directory.");
  }
  const config = await readFile(join(root, "project.godot"), "utf8").catch(() => "");
  if (!config || !/^\s*config_version\s*=\s*5\s*$/m.test(config)) {
    throw new Error(
      "Select a Godot 4 project folder containing a valid project.godot. Godot 3 projects are not supported by this workflow.",
    );
  }
  return { root, config };
}

async function godotExecutable(config: string, root: string): Promise<string> {
  const hasCSharp =
    /^\[dotnet\]/m.test(config) || (await readdir(root)).some((file) => file.endsWith(".csproj"));
  const paths = [
    ...(process.env.LOCUS_GODOT_PATH ? [process.env.LOCUS_GODOT_PATH] : []),
    ...(process.platform === "win32"
      ? ["godot.exe", "godot4.exe", "Godot_v4.exe"]
      : ["godot4", "godot", "Godot"]),
  ];
  const candidates = paths.flatMap((name) => {
    if (isAbsolute(name)) return [name];
    return (process.env.PATH ?? "")
      .split(process.platform === "win32" ? ";" : ":")
      .map((dir) => join(dir, name));
  });
  let foundNonDotnet = false;
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) {
        const path = await realpath(candidate);
        const version = await runProcess(path, ["--version"], process.cwd(), {}, 15_000);
        if (version.code === 0 && /^4\./m.test(version.log.trim())) {
          if (hasCSharp && !version.log.toLowerCase().includes("mono")) {
            foundNonDotnet = true;
            // An explicitly configured binary is authoritative; discovery may
            // continue to look for an installed .NET Godot executable.
            if (process.env.LOCUS_GODOT_PATH === candidate) {
              throw new Error(
                "This C# project needs a .NET-enabled Godot build. Set LOCUS_GODOT_PATH to that executable.",
              );
            }
            continue;
          }
          return path;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes(".NET-enabled")) throw error;
    }
  }
  if (foundNonDotnet)
    throw new Error(
      "Only non-.NET Godot 4 was found; this C# project needs a .NET-enabled Godot executable.",
    );
  throw new Error(
    "Godot 4 executable not found. Install Godot 4 and put godot4 on PATH or set LOCUS_GODOT_PATH.",
  );
}

async function runProcess(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ code: number; log: string }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let timedOut = false;
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const capture = (data: Buffer) => {
      chunks.push(data);
      length += data.length;
      while (length > logLimit * 3 && chunks.length > 1) length -= chunks.shift()!.length;
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    const killTree = (signal: NodeJS.Signals) => {
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          shell: false,
          windowsHide: true,
          stdio: "ignore",
        });
        killer.on("error", () => child.kill(signal));
      } else if (child.pid) {
        try {
          process.kill(-child.pid, signal);
        } catch {
          child.kill(signal);
        }
      } else child.kill(signal);
    };
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree("SIGTERM");
      escalation = setTimeout(() => killTree("SIGKILL"), 10_000);
    }, timeoutMs);
    function clearTimers() {
      clearTimeout(timer);
      if (escalation) clearTimeout(escalation);
    }
    child.once("error", (err) => {
      clearTimers();
      reject(err);
    });
    child.once("close", (code) => {
      clearTimers();
      const log = Buffer.concat(chunks).toString("utf8").slice(-logLimit);
      if (timedOut) {
        reject(
          new Error(
            "Godot process timed out after " + Math.round(timeoutMs / 1000) + " seconds: " + log,
          ),
        );
      } else {
        resolve({ code: code ?? -1, log });
      }
    });
  });
}

export async function restoreGodotJobs(selected: string, sessionId: string): Promise<void> {
  if (restored.has(sessionId)) return;
  const { root } = await validateGodotProject(selected);
  const folder = join(root, ".locus-godot", "runs");
  // This directory is controlled by a project agent, but must not be a
  // symlink into another part of the Host filesystem.
  const actualFolder = await realpath(folder).catch(() => undefined);
  if (actualFolder && actualFolder !== resolve(folder)) {
    throw new Error("Godot job directory must not be a symbolic link");
  }
  const rows = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const completed: InternalJob[] = [];
  for (const row of rows.slice(-2000)) {
    if (!row.isDirectory() || !/^[0-9a-f-]{36}$/i.test(row.name)) continue;
    const sub = join(folder, row.name);
    try {
      const data = JSON.parse(await readFile(join(sub, "job.json"), "utf8")) as GodotJob;
      if (
        data.id !== row.name ||
        data.sessionId !== sessionId ||
        !isGodotAction(data.action) ||
        !["failed", "succeeded"].includes(data.status) ||
        typeof data.startedAt !== "string" ||
        typeof data.finishedAt !== "string"
      )
        continue;
      completed.push({ ...data, folder: sub });
    } catch {
      /* skip incomplete or invalid job state */
    }
  }
  completed.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const item of completed) if (!jobs.has(item.id)) jobs.set(item.id, item);
  restored.add(sessionId);
}

export async function godotWebAsset(
  id: string,
  sessionId: string,
  path: string,
): Promise<{ file: string; size: number; mime: string } | undefined> {
  const job = jobs.get(id);
  if (
    !job ||
    job.sessionId !== sessionId ||
    job.status !== "succeeded" ||
    !job.webReady ||
    !safeGodotWebPath(path)
  )
    return undefined;
  // Reject symlinked job/build directories: persisted job metadata lives
  // inside a project that agents can edit, so Web must never resolve elsewhere.
  const expectedJobFolder = resolve(job.folder);
  const actualJobFolder = await realpath(job.folder).catch(() => undefined);
  if (actualJobFolder !== expectedJobFolder) return undefined;
  const expectedWebRoot = resolve(expectedJobFolder, "Web");
  const root = await realpath(expectedWebRoot).catch(() => undefined);
  if (root !== expectedWebRoot) return undefined;
  const destination = resolve(root, path);
  if (!destination.startsWith(root + sep)) return undefined;
  try {
    const file = await realpath(destination);
    if (!file.startsWith(root + sep)) return undefined;
    const data = await stat(file);
    if (!data.isFile() || data.size > 350 * 1024 * 1024) return undefined;
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const mime =
      (
        {
          html: "text/html; charset=utf-8",
          js: "text/javascript; charset=utf-8",
          css: "text/css; charset=utf-8",
          json: "application/json",
          wasm: "application/wasm",
          pck: "application/octet-stream",
          png: "image/png",
          jpg: "image/jpeg",
          svg: "image/svg+xml",
          ico: "image/x-icon",
          webp: "image/webp",
          woff: "font/woff",
          woff2: "font/woff2",
        } as Record<string, string>
      )[ext] ?? "application/octet-stream";
    return { file, size: data.size, mime };
  } catch {
    return undefined;
  }
}

export async function startGodotJob(input: {
  root: string;
  sessionId: string;
  action: GodotAction;
  scene?: string;
  target?: GodotTarget;
}): Promise<GodotJob> {
  const { root, config } = await validateGodotProject(input.root);
  const executable = await godotExecutable(config, root);
  if (busy.has(root)) throw new Error("A Godot operation is already running against this project.");
  if (input.action === "export" && !isGodotTarget(input.target)) {
    throw new Error("Select a Godot export target: web, linux, windows or macos.");
  }
  if (
    input.action === "create-scene" &&
    (!input.scene ||
      !/^res:\/\/[A-Za-z0-9_./-]+\.tscn$/.test(input.scene) ||
      input.scene.split("/").includes(".."))
  ) {
    throw new Error("New scene must be a safe res:// path ending with .tscn.");
  }
  const id = randomUUID();
  busy.add(root);
  let folder: string;
  try {
    const runs = await safeRunsDirectory(root);
    folder = join(runs, id);
    await mkdir(folder, { mode: 0o700 });
  } catch (err) {
    busy.delete(root);
    throw err;
  }
  const job: InternalJob = {
    id,
    folder,
    sessionId: input.sessionId,
    action: input.action,
    status: "running",
    startedAt: new Date().toISOString(),
    message: "Running Godot " + input.action,
  };
  jobs.set(id, job);
  void (async () => {
    try {
      const env: NodeJS.ProcessEnv = { LOCUS_GODOT_OUTPUT: folder };
      let args: string[];
      let timeout = 180_000;
      if (input.action === "inspect") {
        const inspector = join(folder, "inspector.gd");
        await writeFile(inspector, GODOT_SCENE_INSPECTOR);
        args = ["--headless", "--path", root, "--script", inspector];
      } else if (input.action === "import") {
        args = ["--headless", "--path", root, "--import"];
        timeout = 300_000;
      } else if (input.action === "smoke") {
        // Godot without a main scene can exit cleanly without exercising gameplay.
        const mainScene = /^\s*run\/main_scene\s*=\s*"([^"]+)"\s*$/m.exec(config)?.[1];
        if (!mainScene)
          throw new Error(
            "Cannot run a smoke test without application/run/main_scene in project.godot",
          );
        if (mainScene.startsWith("res://")) {
          const scene = resolve(root, mainScene.slice("res://".length));
          if (
            !scene.startsWith(root + sep) ||
            !(await stat(scene).catch(() => undefined))?.isFile()
          ) {
            throw new Error("Godot main scene is missing: " + mainScene);
          }
        }
        args = ["--headless", "--path", root, "--quit-after", "120"];
        timeout = 120_000;
      } else if (input.action === "create-scene") {
        const relative = input.scene!.slice("res://".length);
        const path = resolve(root, relative);
        if (!path.startsWith(root + sep) || existsSync(path))
          throw new Error("Refusing to overwrite Godot scene");
        // Reject symlinked parent directories before creating files, so a
        // project-controlled path cannot redirect host writes outside root.
        const parts = relative.split("/");
        let current = root;
        for (const part of parts.slice(0, -1)) {
          current = join(current, part);
          const existing = await lstat(current).catch(() => undefined);
          if (existing?.isSymbolicLink()) throw new Error("Scene path contains a symbolic link");
          if (existing && !existing.isDirectory())
            throw new Error("Scene parent is not a directory");
          if (!existing) await mkdir(current);
        }
        if (existsSync(path)) throw new Error("Refusing to overwrite Godot scene");
        await writeFile(path, '[gd_scene format=3]\n\n[node name="Main" type="Node3D"]\n', {
          flag: "wx",
        });
        job.data = { scene: input.scene };
        args = ["--headless", "--path", root, "--import"];
      } else {
        const presets = await readFile(join(root, "export_presets.cfg"), "utf8").catch(() => "");
        if (!presets)
          throw new Error("Missing export_presets.cfg. Configure a preset in Godot Editor first.");
        const platforms: Record<GodotTarget, string[]> = {
          web: ["Web"],
          linux: ["Linux", "Linux/X11"],
          windows: ["Windows Desktop"],
          macos: ["macOS"],
        };
        const target = input.target!;
        if (target === "web") {
          const files = await readdir(root);
          if (files.some((file) => file.endsWith(".csproj")))
            throw new Error("Godot 4 C# projects cannot be exported to Web. Use a desktop export.");
        }
        // Select by actual platform, not by a hardcoded user-editable preset name.
        const blocks = [...presets.matchAll(/\[preset\.(\d+)\]([^[]*)/g)];
        const candidate = blocks
          .map((match) => {
            const body = match[2] ?? "";
            return {
              index: match[1],
              name: /^name="([^"]+)"$/m.exec(body)?.[1],
              platform: /^platform="([^"]+)"$/m.exec(body)?.[1],
            };
          })
          .find(
            (preset) =>
              preset.name && preset.platform && platforms[target].includes(preset.platform),
          );
        if (!candidate?.name) {
          throw new Error(
            "No Godot export preset for platform " +
              platforms[target].join(" or ") +
              ". Configure an export preset before building.",
          );
        }
        const selectedOptions =
          presets.split("[preset." + candidate.index + ".options]")[1]?.split(/^\[/m)[0] ?? "";
        if (
          target === "web" &&
          /(?:variant\/thread_support|variant\/extensions_support)\s*=\s*true/.test(selectedOptions)
        )
          throw new Error(
            "The selected Godot Web preset must disable threads and extension support for Locus preview.",
          );
        const preset = candidate.name;
        const out =
          target === "web"
            ? join(folder, "Web", "index.html")
            : join(
                folder,
                target === "windows" ? "Game.exe" : target === "macos" ? "Game.zip" : "Game.x86_64",
              );
        await mkdir(resolve(out, ".."), { recursive: true });
        args = ["--headless", "--path", root, "--export-release", preset, out];
        timeout = 15 * 60_000;
      }
      // Fresh asset imports are required before opening scenes or exporting.
      // Otherwise a headless build can silently use stale imported resources.
      let importLog = "";
      if (input.action === "inspect" || input.action === "export") {
        const imported = await runProcess(
          executable,
          ["--headless", "--path", root, "--import"],
          root,
          env,
          300_000,
        );
        importLog = imported.log;
        if (
          imported.code !== 0 ||
          /SCRIPT ERROR:|Parse Error:|ERROR:|Failed to load script/i.test(importLog)
        ) {
          job.log = importLog;
          throw new Error(
            "Godot asset import failed before " + input.action + ": " + importLog.slice(-4000),
          );
        }
      }
      const result = await runProcess(executable, args, root, env, timeout);
      job.exitCode = result.code;
      job.log = [importLog, result.log].filter(Boolean).join("\n\n").slice(-logLimit);
      await writeFile(join(folder, "godot.log"), job.log);
      const errorLines = job.log
        .split("\n")
        .filter((line) =>
          /SCRIPT ERROR:|Parse Error:|ERROR:|Failed to load script|Export failed/i.test(line),
        );
      if (result.code !== 0 || errorLines.length) {
        throw new Error(
          "Godot " +
            input.action +
            " failed: " +
            (errorLines.slice(-4).join("\n") || "exit code " + result.code),
        );
      }
      if (input.action === "inspect") {
        const report = JSON.parse(await readFile(join(folder, "scenes.json"), "utf8")) as {
          scenes?: Array<{ error?: string; path?: string }>;
        };
        job.data = report;
        const failed = report.scenes?.filter((scene) => scene.error);
        if (failed?.length)
          throw new Error(
            "Godot could not inspect " +
              failed.length +
              " scene(s): " +
              failed
                .map((scene) => scene.path)
                .slice(0, 5)
                .join(", "),
          );
      }
      if (input.action === "export") {
        if (input.target !== "web") {
          const binary =
            input.target === "windows"
              ? "Game.exe"
              : input.target === "macos"
                ? "Game.zip"
                : "Game.x86_64";
          if (!(await stat(join(folder, binary)).catch(() => undefined))?.isFile()) {
            throw new Error("Godot export did not produce the expected " + binary + " artifact");
          }
        }
        if (input.target === "web") {
          const webFolder = join(folder, "Web");
          const files = await readdir(webFolder).catch((): string[] => []);
          const required = ["index.html", "index.js", "index.wasm", "index.pck"];
          if (!required.every((name) => files.includes(name))) {
            throw new Error(
              "Godot Web export is incomplete (missing " +
                required.filter((name) => !files.includes(name)).join(", ") +
                ")",
            );
          }
          job.webReady = true;
        }
        job.data = {
          target: input.target,
          output: input.target === "web" ? join(folder, "Web") : folder,
        };
      }
      job.status = "succeeded";
      job.message = "Godot " + input.action + " completed successfully";
    } catch (error) {
      job.status = "failed";
      job.message = error instanceof Error ? error.message : String(error);
      if (!job.log) {
        job.log = job.message.slice(-logLimit);
        try {
          await writeFile(join(folder, "godot.log"), job.log);
        } catch {
          /* keep failure state */
        }
      }
    } finally {
      job.finishedAt = new Date().toISOString();
      try {
        const { folder: _folder, ...publicJob } = job;
        await writeFile(join(folder, "job.json"), JSON.stringify(publicJob, null, 2));
      } catch {
        /* retain the actual job status */
      }
      busy.delete(root);
      if (jobs.size > maxJobs) {
        const keep = new Set<string>();
        for (const session of new Set([...jobs.values()].map((j) => j.sessionId))) {
          const latest = latestGodotJob(session),
            web = latestGodotWebJob(session);
          if (latest) keep.add(latest.id);
          if (web) keep.add(web.id);
        }
        for (const [key, item] of jobs) {
          if (jobs.size <= maxJobs) break;
          if (item.status !== "running" && !keep.has(key)) jobs.delete(key);
        }
      }
    }
  })();
  return godotJob(id, input.sessionId)!;
}
