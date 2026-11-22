import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { BLENDER_BRIDGE_SCRIPT } from "./script.js";

export const BLENDER_ACTIONS = [
  "inspect",
  "validate",
  "render",
  "export",
  "create",
  "script",
] as const;
export type BlenderAction = (typeof BLENDER_ACTIONS)[number];
export const BLENDER_EXPORT_FORMATS = ["glb", "fbx", "obj", "stl"] as const;
export type BlenderExportFormat = (typeof BLENDER_EXPORT_FORMATS)[number];
export interface BlenderJob {
  id: string;
  sessionId: string;
  action: BlenderAction;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt?: string;
  message?: string;
  exitCode?: number;
  log?: string;
  data?: unknown;
  image?: boolean;
}
type StoredJob = BlenderJob & { folder: string };
const jobs = new Map<string, StoredJob>();
const restored = new Set<string>();
const busy = new Set<string>();
const MAX_LOG = 24000;
const MAX_JOBS = 100;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isBlenderAction(value: unknown): value is BlenderAction {
  return typeof value === "string" && BLENDER_ACTIONS.includes(value as BlenderAction);
}
export function isBlenderExportFormat(value: unknown): value is BlenderExportFormat {
  return typeof value === "string" && BLENDER_EXPORT_FORMATS.includes(value as BlenderExportFormat);
}
export function safeBlendRelative(value: unknown, suffix: ".blend" | ".py"): value is string {
  return (
    typeof value === "string" &&
    value.length > suffix.length &&
    value.length <= 240 &&
    value.endsWith(suffix) &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    value
      .split("/")
      .every(
        (piece) =>
          /^[a-zA-Z0-9_. -]+$/.test(piece) &&
          !piece.startsWith(".") &&
          !piece.endsWith(".") &&
          piece.trim() === piece,
      )
  );
}
export async function safeProjectPath(
  root: string,
  rel: string,
  existing: boolean,
): Promise<string> {
  const base = await realpath(root);
  const path = resolve(base, rel);
  if (!path.startsWith(base + sep))
    throw new Error("Path must be inside the selected Blender workspace");
  let cursor = base;
  for (const part of relative(base, path).split(sep)) {
    cursor = join(cursor, part);
    const entry = await lstat(cursor).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (entry?.isSymbolicLink()) throw new Error("Blender path cannot contain symbolic links");
    if (cursor !== path && entry && !entry.isDirectory())
      throw new Error("Blender parent is not a directory");
    if (cursor === path && entry && !entry.isFile())
      throw new Error("Blender target is not a file");
    if (existing && !entry) throw new Error("Blender file does not exist: " + rel);
  }
  return path;
}

/** Create only missing parent directories; refuse symlink redirection at each step. */
export async function ensureBlenderParents(root: string, rel: string): Promise<void> {
  const base = await realpath(root);
  const parts = rel.split("/").slice(0, -1);
  let current = base;
  for (const part of parts) {
    current = join(current, part);
    try {
      await mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const info = await lstat(current);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(current)) !== resolve(current)
    ) {
      throw new Error("Blender output parent must be a real workspace directory");
    }
  }
}

export async function validateBlenderWorkspace(selected: string): Promise<string> {
  const root = await realpath(selected);
  if (!(await stat(root)).isDirectory()) throw new Error("Blender workspace must be a directory");
  return root;
}
async function executable(): Promise<string> {
  const configured = process.env.LOCUS_BLENDER_PATH;
  const names = configured
    ? [configured]
    : process.platform === "win32"
      ? ["blender.exe"]
      : ["blender"];
  for (const name of names) {
    const candidates = isAbsolute(name)
      ? [name]
      : (process.env.PATH ?? "")
          .split(process.platform === "win32" ? ";" : ":")
          .filter(Boolean)
          .map((dir) => join(dir, name));
    for (const candidate of candidates) {
      try {
        if ((await stat(candidate)).isFile()) return await realpath(candidate);
      } catch {
        /* continue */
      }
    }
  }
  throw new Error(
    "Blender executable unavailable. Install Blender and set LOCUS_BLENDER_PATH or add blender to PATH.",
  );
}
async function safeRunsDir(root: string): Promise<string> {
  let parent = root;
  for (const part of [".locus-blender", "runs"]) {
    parent = join(parent, part);
    const entry = await lstat(parent).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (entry && !entry.isDirectory())
      throw new Error("Blender job directory must be a real directory");
    if (!entry) await mkdir(parent);
    if ((await realpath(parent)) !== resolve(parent))
      throw new Error("Blender job directory contains a symbolic link");
  }
  return parent;
}
function publicJob(job: StoredJob): BlenderJob {
  const { folder: _folder, ...result } = job;
  return result;
}
export function blenderJob(id: string, sessionId: string): BlenderJob | undefined {
  const job = jobs.get(id);
  return job && job.sessionId === sessionId ? publicJob(job) : undefined;
}
export function latestBlenderJob(sessionId: string): BlenderJob | undefined {
  const job = [...jobs.values()].reverse().find((row) => row.sessionId === sessionId);
  return job ? publicJob(job) : undefined;
}
export async function restoreBlenderJobs(selected: string, sessionId: string): Promise<void> {
  if (restored.has(sessionId)) return;
  const root = await validateBlenderWorkspace(selected);
  const path = join(root, ".locus-blender", "runs");
  const actual = await realpath(path).catch(() => undefined);
  if (actual && actual !== resolve(path))
    throw new Error("Blender run directory cannot be a symlink");
  const children = await readdir(path, { withFileTypes: true }).catch(() => []);
  const recovered: StoredJob[] = [];
  for (const child of children.slice(-2000)) {
    if (!child.isDirectory() || !uuid.test(child.name)) continue;
    const folder = join(path, child.name);
    try {
      const row = JSON.parse(await readFile(join(folder, "job.json"), "utf8")) as BlenderJob;
      if (
        row.id !== child.name ||
        row.sessionId !== sessionId ||
        !isBlenderAction(row.action) ||
        !["failed", "succeeded"].includes(row.status) ||
        typeof row.startedAt !== "string"
      )
        continue;
      recovered.push({ ...row, folder });
    } catch {
      /* ignore invalid or unfinished metadata */
    }
  }
  recovered.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const row of recovered) if (!jobs.has(row.id)) jobs.set(row.id, row);
  restored.add(sessionId);
}
export async function blenderImage(id: string, sessionId: string): Promise<Buffer | undefined> {
  const job = jobs.get(id);
  if (!job || job.sessionId !== sessionId || job.status !== "succeeded" || !job.image)
    return undefined;
  const dir = await realpath(job.folder).catch(() => undefined);
  if (dir !== resolve(job.folder)) return undefined;
  const file = join(dir, "preview.png");
  if ((await realpath(file).catch(() => undefined)) !== file) return undefined;
  if (((await stat(file).catch(() => undefined))?.size ?? 0) > 20 * 1024 * 1024) return undefined;
  return readFile(file).catch(() => undefined);
}

/** Only successful, session-scoped exports from the generated output folder can be downloaded. */
export async function blenderExport(
  id: string,
  sessionId: string,
): Promise<
  | {
      file: string;
      name: string;
      size: number;
      mime: string;
    }
  | undefined
> {
  const job = jobs.get(id);
  if (!job || job.sessionId !== sessionId || job.action !== "export" || job.status !== "succeeded")
    return undefined;
  const filename = (job.data as { export?: unknown } | undefined)?.export;
  if (typeof filename !== "string" || !/^asset\.(glb|fbx|obj|stl)$/.test(filename))
    return undefined;
  const folder = await realpath(job.folder).catch(() => undefined);
  if (folder !== resolve(job.folder)) return undefined;
  const file = join(folder, filename);
  if ((await realpath(file).catch(() => undefined)) !== file) return undefined;
  const info = await stat(file).catch(() => undefined);
  if (!info?.isFile() || info.size > 250 * 1024 * 1024) return undefined;
  const mime = filename.endsWith(".glb")
    ? "model/gltf-binary"
    : filename.endsWith(".obj") || filename.endsWith(".stl")
      ? "application/octet-stream"
      : "application/octet-stream";
  return { file, name: filename, size: info.size, mime };
}

function runBlender(
  binary: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number; log: string }> {
  return new Promise((res, reject) => {
    const child = spawn(binary, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: { ...process.env, BLENDER_USER_SCRIPTS: "", BLENDER_USER_CONFIG: "" },
    });
    let log = "";
    let timedOut = false;
    const collect = (data: Buffer) => {
      log = (log + data.toString("utf8")).slice(-MAX_LOG);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const stop = (signal: NodeJS.Signals) => {
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          shell: false,
          stdio: "ignore",
          windowsHide: true,
        });
        killer.once("error", () => child.kill(signal));
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
      stop("SIGTERM");
      escalation = setTimeout(() => stop("SIGKILL"), 10000);
    }, timeoutMs);
    const clear = () => {
      clearTimeout(timer);
      if (escalation) clearTimeout(escalation);
    };
    child.once("error", (err) => {
      clear();
      reject(err);
    });
    child.once("close", (code) => {
      clear();
      if (timedOut) reject(new Error("Blender timed out: " + log.slice(-3000)));
      else res({ code: code ?? -1, log });
    });
  });
}
export async function startBlenderJob(input: {
  root: string;
  sessionId: string;
  action: BlenderAction;
  file?: string;
  format?: BlenderExportFormat;
  script?: string;
}): Promise<BlenderJob> {
  const root = await validateBlenderWorkspace(input.root);
  if (busy.has(root)) throw new Error("A Blender job is already running in this workspace");
  if (input.action !== "create" && !safeBlendRelative(input.file, ".blend"))
    throw new Error("Select a project-relative .blend file");
  if (input.action === "create" && !safeBlendRelative(input.file, ".blend"))
    throw new Error("New Blender file must be a project-relative .blend file");
  if (input.action === "export" && !isBlenderExportFormat(input.format))
    throw new Error("Select an export format: glb, fbx, obj or stl");
  if (input.action === "script" && !safeBlendRelative(input.script, ".py"))
    throw new Error("Select a project-relative .py script");
  // Reserve the workspace before any asynchronous validation to prevent two
  // simultaneous requests launching Blender against the same .blend file.
  busy.add(root);
  let folder: string;
  let binary: string;
  let file: string;
  let script: string | undefined;
  try {
    file = await safeProjectPath(root, input.file!, input.action !== "create");
    if (input.action === "create") {
      await ensureBlenderParents(root, input.file!);
      await safeProjectPath(root, input.file!, false);
      if (
        await lstat(file).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        })
      )
        throw new Error("Refusing to overwrite an existing Blender file");
    }
    script =
      input.action === "script" ? await safeProjectPath(root, input.script!, true) : undefined;
    binary = await executable();
    const runs = await safeRunsDir(root);
    folder = join(runs, randomUUID());
    await mkdir(folder, { mode: 0o700 });
  } catch (error) {
    busy.delete(root);
    throw error;
  }
  const job: StoredJob = {
    id: basename(folder),
    folder,
    sessionId: input.sessionId,
    action: input.action,
    status: "running",
    startedAt: new Date().toISOString(),
    message: "Running Blender " + input.action,
  };
  jobs.set(job.id, job);
  void (async () => {
    try {
      const bridge = join(folder, "bridge.py");
      const config = join(folder, "request.json");
      await writeFile(bridge, BLENDER_BRIDGE_SCRIPT, { flag: "wx" });
      const stagingFile = join(folder, "new.blend");
      await writeFile(
        config,
        JSON.stringify({
          action: input.action,
          file: input.action === "create" ? stagingFile : file,
          format: input.format,
          script,
          output: folder,
        }),
      );
      const args = ["--background", "--factory-startup", "--disable-autoexec"];
      if (input.action !== "create") args.push(file);
      args.push("--python", bridge, "--", config);
      const result = await runBlender(
        binary,
        args,
        root,
        input.action === "render" ? 10 * 60_000 : 5 * 60_000,
      );
      job.exitCode = result.code;
      job.log = result.log;
      const reportPath = join(folder, "report.json");
      const report = JSON.parse(await readFile(reportPath, "utf8").catch(() => "{}")) as {
        error?: string;
        [key: string]: unknown;
      };
      if (result.code !== 0 || report.error)
        throw new Error(String(report.error ?? "Blender exited with code " + result.code));
      if (!(await stat(reportPath).catch(() => undefined))?.isFile())
        throw new Error("Blender did not produce a result report");
      if (input.action === "create") {
        // Publish only once Blender succeeded. COPYFILE_EXCL closes the race
        // between initial existence validation and writing the real file.
        await safeProjectPath(root, input.file!, false);
        await copyFile(stagingFile, file, constants.COPYFILE_EXCL);
        report.file = file;
      }
      job.data = report;
      job.image =
        input.action === "render" &&
        (await stat(join(folder, "preview.png")).catch(() => undefined))?.isFile() === true;
      job.status = "succeeded";
      job.message = "Blender " + input.action + " completed";
    } catch (error) {
      job.status = "failed";
      job.message = error instanceof Error ? error.message : String(error);
    } finally {
      job.finishedAt = new Date().toISOString();
      await writeFile(join(folder, "job.json"), JSON.stringify(publicJob(job))).catch(
        () => undefined,
      );
      busy.delete(root);
      while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value!);
    }
  })();
  return publicJob(job);
}
