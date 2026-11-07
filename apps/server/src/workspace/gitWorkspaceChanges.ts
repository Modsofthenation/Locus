import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  normalizeWorkspaceNewlines,
  repoMapPathSkipped,
  type WorkspaceFileChange,
} from "@locus/shared";
import { parseIgnore, pathIgnored, type IgnoreRule } from "./repoIgnore.js";

const execFileAsync = promisify(execFile);
const MAX_UNTRACKED = 200;
const GIT_ROOT_TTL_MS = 30_000;
const CHANGES_TTL_MS = 2_000;

const gitRootCache = new Map<string, { inside: boolean; at: number }>();
const inflightChanges = new Map<string, Promise<WorkspaceFileChange[]>>();
const changesCache = new Map<string, { at: number; rows: WorkspaceFileChange[] }>();
const inflightBaseline = new Map<string, Promise<string | undefined>>();
let changesGen = 0;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    timeout: 2000,
    maxBuffer: 8_000_000,
    windowsHide: true,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "1",
      GIT_PAGER: "cat",
      PAGER: "cat",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "commit.gpgsign",
      GIT_CONFIG_VALUE_0: "false",
    },
  });
  return stdout;
}

function skipPath(path: string, ignore: IgnoreRule[] = []): boolean {
  if (!path || path.split("/").some((part) => part === "." || part === "..")) return true;
  if (repoMapPathSkipped(path)) return true;
  return ignore.length > 0 && pathIgnored(path, false, ignore);
}

function parseNumstatPath(raw: string): string {
  let path = raw.trim();
  const braced = path.match(/^(.*)\{.* => ([^}]+)\}(.*)$/);
  if (braced) path = `${braced[1]}${braced[2]}${braced[3]}`;
  else {
    const idx = path.lastIndexOf(" => ");
    if (idx !== -1) path = path.slice(idx + 4);
  }
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function parseNumstat(
  stdout: string,
  into: Map<string, WorkspaceFileChange>,
  ignore: IgnoreRule[] = [],
): void {
  for (const line of stdout.split("\n")) {
    const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!match) continue;
    const path = parseNumstatPath(match[3]!);
    if (skipPath(path, ignore)) continue;
    into.set(path, {
      path,
      additions: match[1] === "-" ? 0 : Number(match[1]),
      deletions: match[2] === "-" ? 0 : Number(match[2]),
    });
  }
}

export function resetGitWorkspaceChangesCache(): void {
  gitRootCache.clear();
  inflightChanges.clear();
  changesCache.clear();
  inflightBaseline.clear();
  changesGen += 1;
}

export function invalidateGitWorkspaceChanges(root?: string): void {
  changesGen += 1;
  if (!root) {
    inflightChanges.clear();
    changesCache.clear();
    inflightBaseline.clear();
    return;
  }
  inflightChanges.delete(root);
  changesCache.delete(root);
  const prefix = `${root}\0`;
  for (const key of inflightBaseline.keys()) {
    if (key.startsWith(prefix)) inflightBaseline.delete(key);
  }
}

export function peekGitWorkspaceChanges(root: string): WorkspaceFileChange[] | undefined {
  const hit = changesCache.get(root);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CHANGES_TTL_MS) return undefined;
  return hit.rows;
}

async function isGitWorkTree(root: string): Promise<boolean> {
  const hit = gitRootCache.get(root);
  if (hit && Date.now() - hit.at < GIT_ROOT_TTL_MS) return hit.inside;
  try {
    const inside = (await git(root, ["rev-parse", "--is-inside-work-tree"])).trim() === "true";
    gitRootCache.set(root, { inside, at: Date.now() });
    return inside;
  } catch {
    gitRootCache.set(root, { inside: false, at: Date.now() });
    return false;
  }
}

async function loadLocusIgnore(root: string): Promise<IgnoreRule[]> {
  try {
    return parseIgnore(await readFile(join(root, ".locusignore"), "utf8"));
  } catch {
    return [];
  }
}

async function loadGitWorkspaceChanges(root: string): Promise<WorkspaceFileChange[]> {
  if (!(await isGitWorkTree(root))) return [];

  const ignore = await loadLocusIgnore(root);
  const map = new Map<string, WorkspaceFileChange>();
  try {
    parseNumstat(
      await git(root, ["-c", "core.quotepath=false", "diff", "--numstat", "HEAD"]),
      map,
      ignore,
    );
  } catch {
    try {
      parseNumstat(
        await git(root, ["-c", "core.quotepath=false", "diff", "--numstat"]),
        map,
        ignore,
      );
    } catch {
      /* empty repo or no commits */
    }
  }

  try {
    const others = await git(root, [
      "-c",
      "core.quotepath=false",
      "ls-files",
      "-z",
      "--others",
      "--exclude-standard",
    ]);
    let extra = 0;
    for (const file of others.split("\0")) {
      const path = file.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
      if (skipPath(path, ignore) || map.has(path)) continue;
      extra += 1;
      if (extra > MAX_UNTRACKED) break;
      // Count untracked as one change — do not read file bodies (huge nested clones).
      map.set(path, { path, additions: 1, deletions: 0 });
    }
  } catch {
    /* ignore */
  }

  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export async function gitWorkspaceChanges(root: string): Promise<WorkspaceFileChange[]> {
  const cached = peekGitWorkspaceChanges(root);
  if (cached) return cached;
  const existing = inflightChanges.get(root);
  if (existing) return existing;
  const gen = changesGen;
  const pending = loadGitWorkspaceChanges(root)
    .then((rows) => {
      if (gen === changesGen) changesCache.set(root, { at: Date.now(), rows });
      return rows;
    })
    .finally(() => inflightChanges.delete(root));
  inflightChanges.set(root, pending);
  return pending;
}

async function loadGitWorkspaceBaseline(root: string, path: string): Promise<string | undefined> {
  if (!(await isGitWorkTree(root))) return undefined;
  const dirty = peekGitWorkspaceChanges(root);
  if (dirty && !dirty.some((row) => row.path === path)) return undefined;
  try {
    const text = await git(root, ["-c", "core.quotepath=false", "show", `HEAD:${path}`]);
    if (text.includes("\0")) return undefined;
    return normalizeWorkspaceNewlines(text);
  } catch {
    try {
      const others = await git(root, [
        "-c",
        "core.quotepath=false",
        "ls-files",
        "--others",
        "--exclude-standard",
        "--",
        path,
      ]);
      const listed = others
        .split("\n")
        .map((row) => row.trim().replace(/\\/g, "/"))
        .filter(Boolean);
      if (listed.includes(path)) return "";
    } catch {
      /* ignore */
    }
    return undefined;
  }
}

/** Git HEAD contents for a workspace-relative path, or `""` if the file is untracked. */
export async function gitWorkspaceBaseline(root: string, rel: string): Promise<string | undefined> {
  const path = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (skipPath(path)) return undefined;
  const key = `${root}\0${path}`;
  const existing = inflightBaseline.get(key);
  if (existing) return existing;
  const pending = loadGitWorkspaceBaseline(root, path).finally(() => inflightBaseline.delete(key));
  inflightBaseline.set(key, pending);
  return pending;
}
