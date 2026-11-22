import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

export type UnrealAction = "inspect" | "compile" | "test" | "package" | "python";
export type UnrealTarget = "windows" | "linux" | "macos";
export interface UnrealJob {
  id: string;
  sessionId: string;
  action: UnrealAction;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt?: string;
  message?: string;
  exitCode?: number;
  engine?: string;
  log?: string;
  data?: unknown;
}
type InternalJob = UnrealJob & { folder: string };

const jobs = new Map<string, InternalJob>();
const busy = new Set<string>();
const restored = new Set<string>();
const actions: UnrealAction[] = ["inspect", "compile", "test", "package", "python"];
const targets: UnrealTarget[] = ["windows", "linux", "macos"];
const logLimit = 24000;
const maxJobs = 100;
/** UAT/UBT platform names for each Locus build target. */
const PLATFORM: Record<UnrealTarget, string> = { windows: "Win64", linux: "Linux", macos: "Mac" };
/** Lines that mean an Unreal build, cook or commandlet actually failed. */
const ERROR_LINE =
  /\berror (?:C\d{4}|LNK\d{4}|CS\d{4})\b|: (?:fatal )?error:|LogBlueprint: Error|LogCompile: Error|BUILD FAILED|AutomationTool exiting with ExitCode=[1-9]|Commandlet->Main return this error code: [1-9]/i;

export function isUnrealAction(value: unknown): value is UnrealAction {
  return typeof value === "string" && actions.includes(value as UnrealAction);
}
export function isUnrealTarget(value: unknown): value is UnrealTarget {
  return typeof value === "string" && targets.includes(value as UnrealTarget);
}
/** Automation test filters go into a console command line; keep them inert. */
export function isSafeTestFilter(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Za-z0-9_.+ -]{1,200}$/.test(value) && !/^\s|\s$/.test(value)
  );
}

export function unrealJob(id: string, sessionId: string): UnrealJob | undefined {
  const row = jobs.get(id);
  if (!row || row.sessionId !== sessionId) return undefined;
  const { folder: _folder, ...publicRow } = row;
  return publicRow;
}
export function latestUnrealJob(sessionId: string): UnrealJob | undefined {
  const row = [...jobs.values()].reverse().find((entry) => entry.sessionId === sessionId);
  return row ? unrealJob(row.id, sessionId) : undefined;
}

export interface UnrealProject {
  /** Canonical project directory (contains the .uproject). */
  root: string;
  uproject: string;
  name: string;
  /** EngineAssociation: "5.4" for launcher builds, a GUID for source builds, "" for in-tree. */
  association: string;
  descriptor: {
    Modules?: Array<{ Name?: string; Type?: string; LoadingPhase?: string }>;
    Plugins?: Array<{ Name?: string; Enabled?: boolean }>;
    [key: string]: unknown;
  };
}

async function findUproject(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".uproject"))
    .map((entry) => join(folder, entry.name));
}

/** Resolve the session's Unreal project: the folder itself, or exactly one child project. */
export async function validateUnrealProject(selected: string): Promise<UnrealProject> {
  const parent = await realpath(selected);
  let files = await findUproject(parent);
  if (!files.length) {
    const nested: string[] = [];
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      nested.push(...(await findUproject(join(parent, entry.name))));
    }
    if (nested.length > 1)
      throw new Error(
        "Multiple Unreal projects found. Select a specific project directory as your Host workspace.",
      );
    files = nested;
  }
  if (files.length > 1)
    throw new Error("More than one .uproject file in this folder. Keep exactly one per project.");
  if (!files.length)
    throw new Error("Select an Unreal Engine project folder containing a .uproject file.");
  const uproject = await realpath(files[0]!);
  const root = resolve(uproject, "..");
  let descriptor: UnrealProject["descriptor"];
  try {
    descriptor = JSON.parse(
      (await readFile(uproject, "utf8")).replace(/^\uFEFF/, ""),
    ) as UnrealProject["descriptor"];
  } catch {
    throw new Error(basename(uproject) + " is not valid JSON.");
  }
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor))
    throw new Error(basename(uproject) + " is not a valid Unreal project descriptor.");
  const association =
    typeof descriptor.EngineAssociation === "string" ? descriptor.EngineAssociation.trim() : "";
  return {
    root,
    uproject,
    name: basename(uproject).replace(/\.uproject$/i, ""),
    association,
    descriptor,
  };
}

/** Do not allow a project-owned symlink to redirect generated job writes. */
async function safeRunsDirectory(root: string): Promise<string> {
  let current = root;
  for (const name of [".locus-unreal", "runs"]) {
    current = join(current, name);
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (info?.isSymbolicLink() || (info && !info.isDirectory()))
      throw new Error("Unreal job output path must be a real directory inside the project");
    if (!info) await mkdir(current);
    if ((await realpath(current)) !== resolve(current))
      throw new Error("Unreal job output directory resolves outside the project");
  }
  return current;
}

function hostPlatform(): "Win64" | "Linux" | "Mac" {
  return process.platform === "win32" ? "Win64" : process.platform === "darwin" ? "Mac" : "Linux";
}

export interface UnrealEngine {
  root: string;
  version: string;
  editor: string;
  buildScript: string;
  uatScript: string;
}

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isFile() === true;
}

/** Engine version from Engine/Build/Build.version, e.g. "5.4.2". */
async function engineVersion(engineRoot: string): Promise<string | undefined> {
  try {
    const raw = JSON.parse(
      (await readFile(join(engineRoot, "Engine", "Build", "Build.version"), "utf8")).replace(
        /^\uFEFF/,
        "",
      ),
    ) as { MajorVersion?: number; MinorVersion?: number; PatchVersion?: number };
    if (typeof raw.MajorVersion !== "number" || typeof raw.MinorVersion !== "number")
      return undefined;
    return [raw.MajorVersion, raw.MinorVersion, raw.PatchVersion ?? 0].join(".");
  } catch {
    return undefined;
  }
}

async function engineAt(engineRoot: string): Promise<UnrealEngine | undefined> {
  const platform = hostPlatform();
  const bin = join(engineRoot, "Engine", "Binaries", platform);
  const exe = platform === "Win64" ? ".exe" : "";
  const editors = [
    join(bin, "UnrealEditor-Cmd" + exe),
    ...(platform === "Mac"
      ? [join(bin, "UnrealEditor.app", "Contents", "MacOS", "UnrealEditor")]
      : [join(bin, "UnrealEditor" + exe)]),
    join(bin, "UE4Editor-Cmd" + exe),
    ...(platform === "Mac"
      ? [join(bin, "UE4Editor.app", "Contents", "MacOS", "UE4Editor")]
      : [join(bin, "UE4Editor" + exe)]),
  ];
  let editor: string | undefined;
  for (const candidate of editors)
    if (await isFile(candidate)) {
      editor = candidate;
      break;
    }
  const version = await engineVersion(engineRoot);
  if (!editor || !version) return undefined;
  const batch = join(engineRoot, "Engine", "Build", "BatchFiles");
  return {
    root: engineRoot,
    version,
    editor,
    buildScript:
      platform === "Win64"
        ? join(batch, "Build.bat")
        : join(batch, platform === "Mac" ? "Mac" : "Linux", "Build.sh"),
    uatScript: join(batch, platform === "Win64" ? "RunUAT.bat" : "RunUAT.sh"),
  };
}

/** Parse [Installations] GUID=path pairs from Epic's Install.ini (Linux / macOS source builds). */
export function parseInstallIni(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      section = header[1]!;
      continue;
    }
    if (section !== "Installations") continue;
    const pair = /^([^=]+)=(.*)$/.exec(line);
    if (pair) out[pair[1]!.trim()] = pair[2]!.trim();
  }
  return out;
}

/** Map "UE_5.4"-style AppNames to install folders from the Epic launcher manifest. */
export function parseLauncherInstalled(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const data = JSON.parse(text.replace(/^\uFEFF/, "")) as {
      InstallationList?: Array<{ InstallLocation?: unknown; AppName?: unknown }>;
    };
    for (const row of data.InstallationList ?? []) {
      const match =
        typeof row.AppName === "string" ? /^UE_(\d+\.\d+)$/.exec(row.AppName) : undefined;
      if (match && typeof row.InstallLocation === "string") out[match[1]!] = row.InstallLocation;
    }
  } catch {
    /* not a launcher manifest */
  }
  return out;
}

async function windowsRegistryBuild(guid: string): Promise<string | undefined> {
  if (process.platform !== "win32" || !/^\{?[0-9A-Fa-f-]{32,36}\}?$/.test(guid)) return undefined;
  return new Promise((resolveValue) => {
    const child = spawn(
      "reg",
      ["query", "HKCU\\Software\\Epic Games\\Unreal Engine\\Builds", "/v", guid],
      { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    let text = "";
    child.stdout?.on("data", (data: Buffer) => (text += data.toString("utf8")));
    child.once("error", () => resolveValue(undefined));
    child.once("close", () => {
      const match = /REG_SZ\s+(.+)$/m.exec(text);
      resolveValue(match?.[1]?.trim());
    });
  });
}

/**
 * Find the Unreal Engine install that matches the project's EngineAssociation.
 * Opening a project in a different engine version offers to convert its assets,
 * so automatic discovery never falls back to a mismatching version.
 */
export async function resolveUnrealEngine(project: UnrealProject): Promise<UnrealEngine> {
  const explicit = process.env.LOCUS_UNREAL_ENGINE?.trim();
  if (explicit) {
    const engine = isAbsolute(explicit) ? await engineAt(explicit) : undefined;
    if (!engine)
      throw new Error(
        "LOCUS_UNREAL_ENGINE must be the absolute engine root (the folder that contains Engine/Binaries).",
      );
    return engine;
  }
  const association = project.association;
  const candidates: string[] = [];
  const home = homedir();
  const versioned = /^\d+\.\d+$/.test(association);
  if (!association) {
    // Projects stored inside a source engine tree have an empty association.
    let current = project.root;
    for (let depth = 0; depth < 4; depth++) {
      current = resolve(current, "..");
      candidates.push(current);
    }
  } else if (versioned) {
    const manifests =
      process.platform === "win32"
        ? [
            join(
              process.env.PROGRAMDATA ?? "C:\\ProgramData",
              "Epic",
              "UnrealEngineLauncher",
              "LauncherInstalled.dat",
            ),
          ]
        : process.platform === "darwin"
          ? [
              join(
                home,
                "Library",
                "Application Support",
                "Epic",
                "UnrealEngineLauncher",
                "LauncherInstalled.dat",
              ),
            ]
          : [];
    for (const manifest of manifests) {
      const found = parseLauncherInstalled(await readFile(manifest, "utf8").catch(() => ""));
      if (found[association]) candidates.push(found[association]!);
    }
    const folder = "UE_" + association;
    if (process.platform === "win32") {
      for (const base of [process.env.ProgramFiles ?? "C:\\Program Files", "C:\\Program Files"])
        candidates.push(join(base, "Epic Games", folder));
    } else if (process.platform === "darwin") {
      candidates.push(join("/Users/Shared/Epic Games", folder));
    } else {
      candidates.push(
        join(home, "UnrealEngine", folder),
        join(home, folder),
        join("/opt/unreal-engine", folder),
        join(home, "UnrealEngine"),
        "/opt/unreal-engine",
      );
    }
  } else {
    const ini =
      process.platform === "darwin"
        ? join(home, "Library", "Application Support", "Epic", "UnrealEngine", "Install.ini")
        : join(home, ".config", "Epic", "UnrealEngine", "Install.ini");
    const installs = parseInstallIni(await readFile(ini, "utf8").catch(() => ""));
    const key = Object.keys(installs).find(
      (id) =>
        id.replace(/[{}]/g, "").toLowerCase() === association.replace(/[{}]/g, "").toLowerCase(),
    );
    if (key) candidates.push(installs[key]!);
    const registry = await windowsRegistryBuild(association);
    if (registry) candidates.push(registry);
  }
  for (const candidate of candidates) {
    if (!isAbsolute(candidate)) continue;
    const engine = await engineAt(candidate);
    if (!engine) continue;
    if (versioned && !(engine.version + ".").startsWith(association + ".")) continue;
    return { ...engine, root: await realpath(engine.root) };
  }
  throw new Error(
    "No Unreal Engine install found for EngineAssociation " +
      JSON.stringify(association) +
      ". Install that version (Epic Games Launcher, or a source build registered with the engine), or set LOCUS_UNREAL_ENGINE to its root folder.",
  );
}

/**
 * Unreal reads `-Key=value` by looking for a quote right after `=`, so values
 * with spaces must be written `-Key="a b"`, not `"-Key=a b"` (Node's default).
 */
export function windowsArg(arg: string): string {
  if (/["\r\n\0]/.test(arg)) throw new Error("Unreal arguments cannot contain quotes or newlines");
  if (!/[\s&|<>^()]/.test(arg)) return arg;
  const eq = arg.startsWith("-") ? arg.indexOf("=") : -1;
  return eq > 0 ? arg.slice(0, eq + 1) + '"' + arg.slice(eq + 1) + '"' : '"' + arg + '"';
}

function spawnSpec(
  executable: string,
  args: string[],
): { file: string; args: string[]; verbatim: boolean } {
  if (process.platform === "win32") {
    const line = [executable, ...args].map(windowsArg);
    if (/\.(bat|cmd)$/i.test(executable)) {
      // Batch files run through cmd.exe, which expands %VAR% even in quotes.
      if ([executable, ...args].some((part) => /[%!]/.test(part)))
        throw new Error("Unreal project and engine paths cannot contain % or ! on Windows");
      line[0] = '"' + executable + '"';
      return {
        file: process.env.ComSpec ?? "cmd.exe",
        args: ["/d", "/s", "/c", '"' + line.join(" ") + '"'],
        verbatim: true,
      };
    }
    return { file: executable, args: line.slice(1), verbatim: true };
  }
  // Engine shell scripts are bash scripts; do not depend on their exec bit.
  if (executable.endsWith(".sh"))
    return { file: "bash", args: [executable, ...args], verbatim: false };
  return { file: executable, args, verbatim: false };
}

async function runProcess(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  logFile: string,
): Promise<{ code: number; log: string }> {
  const spec = spawnSpec(executable, args);
  return new Promise((resolveRun, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let timedOut = false;
    const child = spawn(spec.file, spec.args, {
      cwd,
      env: process.env,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: spec.verbatim,
      stdio: ["ignore", "pipe", "pipe"],
      // A separate process group lets termination reach UBT / shader workers.
      detached: process.platform !== "win32",
    });
    const capture = (data: Buffer) => {
      chunks.push(data);
      length += data.length;
      while (length > logLimit * 8 && chunks.length > 1) length -= chunks.shift()!.length;
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
    const clearTimers = () => {
      clearTimeout(timer);
      if (escalation) clearTimeout(escalation);
    };
    child.once("error", (error) => {
      clearTimers();
      reject(error);
    });
    child.once("close", (code) => {
      clearTimers();
      const log = Buffer.concat(chunks).toString("utf8");
      void writeFile(logFile, log, { flag: "a" }).catch(() => undefined);
      if (timedOut)
        reject(
          new Error(
            "Unreal process timed out after " + Math.round(timeoutMs / 60_000) + " minutes",
          ),
        );
      else resolveRun({ code: code ?? -1, log });
    });
  });
}

/** Read-only project survey; works without an engine installed. */
export async function inspectUnrealProject(
  project: UnrealProject,
): Promise<Record<string, unknown>> {
  const maps: string[] = [];
  const walk = async (dir: string, depth: number) => {
    if (depth > 12 || maps.length >= 500) return;
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".umap"))
        maps.push(
          "/Game/" +
            relative(join(project.root, "Content"), path)
              .split(sep)
              .join("/")
              .replace(/\.umap$/i, ""),
        );
    }
  };
  await walk(join(project.root, "Content"), 0);
  maps.sort();
  const source = join(project.root, "Source");
  const sourceFiles = await readdir(source).catch((): string[] => []);
  const targetFiles = sourceFiles.filter((file) => file.endsWith(".Target.cs"));
  const plugins: string[] = [];
  for (const entry of await readdir(join(project.root, "Plugins"), { withFileTypes: true }).catch(
    () => [],
  )) {
    if (
      entry.isDirectory() &&
      existsSync(join(project.root, "Plugins", entry.name, entry.name + ".uplugin"))
    )
      plugins.push(entry.name);
  }
  const engineIni = await readFile(join(project.root, "Config", "DefaultEngine.ini"), "utf8").catch(
    () => "",
  );
  const iniValue = (key: string) =>
    new RegExp("^\\s*" + key + "\\s*=\\s*(.+)$", "m").exec(engineIni)?.[1]?.trim();
  let engine: Record<string, unknown>;
  try {
    const found = await resolveUnrealEngine(project);
    engine = { root: found.root, version: found.version, editor: found.editor };
  } catch (error) {
    engine = { error: error instanceof Error ? error.message : String(error) };
  }
  return {
    project: project.name,
    uproject: project.uproject,
    engineAssociation: project.association,
    engine,
    kind: targetFiles.length ? "C++" : "Blueprint-only",
    modules: (project.descriptor.Modules ?? []).map((module) => ({
      name: module.Name,
      type: module.Type,
    })),
    targets: targetFiles.map((file) => file.replace(/\.Target\.cs$/, "")),
    enabledPlugins: (project.descriptor.Plugins ?? [])
      .filter((plugin) => plugin.Enabled !== false && plugin.Name)
      .map((plugin) => plugin.Name),
    projectPlugins: plugins,
    pythonScripting: pythonEnabled(project),
    gameDefaultMap: iniValue("GameDefaultMap"),
    editorStartupMap: iniValue("EditorStartupMap"),
    maps,
  };
}

function pythonEnabled(project: UnrealProject): boolean {
  return (project.descriptor.Plugins ?? []).some(
    (plugin) => plugin.Name === "PythonScriptPlugin" && plugin.Enabled !== false,
  );
}

/** Resolve a project-relative .py file; it must stay inside the project. */
export async function resolveProjectScript(root: string, script: string): Promise<string> {
  if (
    !script ||
    script.length > 300 ||
    isAbsolute(script) ||
    script.includes("\\") ||
    !/^[A-Za-z0-9_./ -]+\.py$/.test(script) ||
    script.split("/").some((part) => part === ".." || part === ".")
  )
    throw new Error(
      "script must be a project-relative .py path, e.g. Content/Python/build_level.py",
    );
  const path = await realpath(resolve(root, script)).catch(() => undefined);
  if (!path || !path.startsWith(root + sep) || !(await isFile(path)))
    throw new Error("Python script not found inside the project: " + script);
  return path;
}

export async function restoreUnrealJobs(selected: string, sessionId: string): Promise<void> {
  if (restored.has(sessionId)) return;
  const { root } = await validateUnrealProject(selected);
  const folder = join(root, ".locus-unreal", "runs");
  const actual = await realpath(folder).catch(() => undefined);
  if (actual && actual !== resolve(folder))
    throw new Error("Unreal job directory must not be a symbolic link");
  const rows = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const completed: InternalJob[] = [];
  for (const row of rows.slice(-2000)) {
    if (!row.isDirectory() || !/^[0-9a-f-]{36}$/i.test(row.name)) continue;
    const sub = join(folder, row.name);
    try {
      const data = JSON.parse(await readFile(join(sub, "job.json"), "utf8")) as UnrealJob;
      if (
        data.id !== row.name ||
        data.sessionId !== sessionId ||
        !isUnrealAction(data.action) ||
        !["failed", "succeeded"].includes(data.status) ||
        typeof data.startedAt !== "string" ||
        typeof data.finishedAt !== "string"
      )
        continue;
      completed.push({ ...data, folder: sub });
    } catch {
      /* skip incomplete job state */
    }
  }
  completed.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const item of completed) if (!jobs.has(item.id)) jobs.set(item.id, item);
  restored.add(sessionId);
}

function failIfErrors(label: string, result: { code: number; log: string }): void {
  const lines = result.log.split(/\r?\n/).filter((line) => ERROR_LINE.test(line));
  if (result.code !== 0 || lines.length)
    throw new Error(
      label + " failed: " + (lines.slice(-6).join("\n") || "exit code " + result.code),
    );
}

/** Summarise Unreal's automation report (Saved report index.json). */
export function summariseAutomationReport(raw: string): {
  succeeded: number;
  succeededWithWarnings: number;
  failed: number;
  notRun: number;
  failures: Array<{ test: string; errors: string[] }>;
} {
  const report = JSON.parse(raw.replace(/^\uFEFF/, "")) as {
    succeeded?: number;
    succeededWithWarnings?: number;
    failed?: number;
    notRun?: number;
    tests?: Array<{
      fullTestPath?: string;
      testDisplayName?: string;
      state?: string;
      entries?: Array<{ event?: { type?: string; message?: string } }>;
    }>;
  };
  return {
    succeeded: report.succeeded ?? 0,
    succeededWithWarnings: report.succeededWithWarnings ?? 0,
    failed: report.failed ?? 0,
    notRun: report.notRun ?? 0,
    failures: (report.tests ?? [])
      .filter((test) => test.state === "Fail")
      .slice(0, 30)
      .map((test) => ({
        test: test.fullTestPath ?? test.testDisplayName ?? "(unnamed)",
        errors: (test.entries ?? [])
          .filter((entry) => entry.event?.type === "Error")
          .map((entry) => entry.event?.message ?? "")
          .slice(0, 5),
      })),
  };
}

export async function startUnrealJob(input: {
  root: string;
  sessionId: string;
  action: UnrealAction;
  target?: UnrealTarget;
  filter?: string;
  script?: string;
}): Promise<UnrealJob> {
  const project = await validateUnrealProject(input.root);
  const { root } = project;
  if (busy.has(root)) throw new Error("An Unreal operation is already running for this project.");
  if (input.action === "package" && !isUnrealTarget(input.target))
    throw new Error("Choose a package target: windows, linux or macos.");
  if (input.action === "test" && input.filter !== undefined && !isSafeTestFilter(input.filter))
    throw new Error("Test filter may only contain letters, numbers, spaces, . _ + and -.");
  const script =
    input.action === "python" ? await resolveProjectScript(root, input.script ?? "") : undefined;
  if (input.action === "python" && !pythonEnabled(project))
    throw new Error(
      "Enable the PythonScriptPlugin in " +
        basename(project.uproject) +
        ' ("Plugins": [{ "Name": "PythonScriptPlugin", "Enabled": true }]) before running editor Python scripts.',
    );
  // inspect is read-only and reports a missing engine instead of failing.
  const engine = input.action === "inspect" ? undefined : await resolveUnrealEngine(project);
  const id = randomUUID();
  busy.add(root);
  let folder: string;
  try {
    folder = join(await safeRunsDirectory(root), id);
    await mkdir(folder, { mode: 0o700 });
  } catch (error) {
    busy.delete(root);
    throw error;
  }
  const job: InternalJob = {
    id,
    folder,
    sessionId: input.sessionId,
    action: input.action,
    status: "running",
    startedAt: new Date().toISOString(),
    ...(engine ? { engine: engine.root } : {}),
    message: "Running Unreal " + input.action + (engine ? " (engine " + engine.version + ")" : ""),
  };
  jobs.set(id, job);
  const logFile = join(folder, "unreal.log");
  const logs: string[] = [];
  const run = async (executable: string, args: string[], timeoutMs: number) => {
    const result = await runProcess(executable, args, root, timeoutMs, logFile);
    logs.push(result.log);
    job.exitCode = result.code;
    return result;
  };
  // Commandlet / headless editor flags shared by compile, test and python.
  const headless = [
    "-unattended",
    "-nullrhi",
    "-nosplash",
    "-nosound",
    "-NoP4",
    "-stdout",
    "-FullStdOutLogOutput",
  ];
  void (async () => {
    try {
      if (input.action === "inspect") {
        job.data = await inspectUnrealProject(project);
      } else if (input.action === "compile") {
        const sourceFiles = await readdir(join(root, "Source")).catch((): string[] => []);
        const editorTarget = sourceFiles
          .find((file) => file.endsWith("Editor.Target.cs"))
          ?.replace(/\.Target\.cs$/, "");
        if (editorTarget) {
          failIfErrors(
            "C++ build",
            await run(
              engine!.buildScript,
              [
                editorTarget,
                hostPlatform(),
                "Development",
                "-Project=" + project.uproject,
                "-WaitMutex",
                "-NoHotReloadFromIDE",
              ],
              60 * 60_000,
            ),
          );
        } else if (sourceFiles.some((file) => file.endsWith(".Target.cs"))) {
          throw new Error("Source/ has no *Editor.Target.cs; add an editor target to build C++.");
        }
        failIfErrors(
          "Blueprint compile",
          await run(
            engine!.editor,
            [project.uproject, "-run=CompileAllBlueprints", ...headless],
            30 * 60_000,
          ),
        );
        job.data = { cpp: Boolean(editorTarget), editorTarget, blueprints: "compiled" };
      } else if (input.action === "test") {
        const filter = input.filter ?? project.name;
        const reportDir = join(folder, "Tests");
        await mkdir(reportDir);
        const result = await run(
          engine!.editor,
          [
            project.uproject,
            "-ExecCmds=Automation RunTests " + filter + "; Quit",
            "-TestExit=Automation Test Queue Empty",
            "-ReportExportPath=" + reportDir,
            ...headless,
          ],
          45 * 60_000,
        );
        const raw = await readFile(join(reportDir, "index.json"), "utf8").catch(() => "");
        if (!raw) {
          failIfErrors("Automation tests", result);
          throw new Error("Unreal did not write an automation report (no tests ran?)");
        }
        const summary = summariseAutomationReport(raw);
        job.data = { filter, ...summary };
        if (summary.failed > 0)
          throw new Error(summary.failed + " Unreal automation test(s) failed");
        if (summary.succeeded + summary.succeededWithWarnings < 1)
          throw new Error(
            'No automation tests matched "' + filter + '". Pass a filter matching your test names.',
          );
      } else if (input.action === "package") {
        const archive = join(folder, "Package");
        await mkdir(archive);
        const platform = PLATFORM[input.target!];
        failIfErrors(
          "Package",
          await run(
            engine!.uatScript,
            [
              "BuildCookRun",
              "-project=" + project.uproject,
              "-noP4",
              "-platform=" + platform,
              "-clientconfig=Development",
              "-build",
              "-cook",
              "-stage",
              "-pak",
              "-archive",
              "-archivedirectory=" + archive,
              "-unattended",
              "-utf8output",
            ],
            120 * 60_000,
          ),
        );
        const produced = await readdir(archive).catch((): string[] => []);
        if (!produced.length) throw new Error("Unreal packaging produced no archived build");
        job.data = { target: input.target, platform, output: archive, contents: produced };
      } else {
        failIfErrors(
          "Python script",
          await run(
            engine!.editor,
            [project.uproject, "-run=pythonscript", "-script=" + script!, ...headless],
            30 * 60_000,
          ),
        );
        job.data = { script: relative(root, script!).split(sep).join("/") };
      }
      job.status = "succeeded";
      job.message = "Unreal " + input.action + " completed successfully";
    } catch (error) {
      job.status = "failed";
      job.message = error instanceof Error ? error.message : String(error);
    } finally {
      job.log = (logs.join("\n\n") || job.message || "").slice(-logLimit);
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
        for (const session of new Set([...jobs.values()].map((row) => row.sessionId))) {
          const latest = latestUnrealJob(session);
          if (latest) keep.add(latest.id);
        }
        for (const [key, item] of jobs) {
          if (jobs.size <= maxJobs) break;
          if (item.status !== "running" && !keep.has(key)) jobs.delete(key);
        }
      }
    }
  })();
  return unrealJob(id, input.sessionId)!;
}
