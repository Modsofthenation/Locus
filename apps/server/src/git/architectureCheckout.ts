import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { dockerWorkspaceDir, sessionHostWorkspace } from "@locus/hypervisor";
import {
  ARCHITECTURE_SOURCE_EXTENSIONS,
  isLoadPathNoisePath,
  isRepoMapSkipDir,
  sessionRuntime,
  type AgentSession,
  type ArchSourceFile,
} from "@locus/shared";

const SOURCE_EXT = new Set<string>(ARCHITECTURE_SOURCE_EXTENSIONS);

const MAX_WALK = 2000;
const MAX_READ = 250;
const MAX_FILE_BYTES = 48_000;

export interface ArchitectureRoot {
  root: string;
  sessionId: string;
  runtime: "host" | "docker";
  label: string;
  /** Set when the checkout is an IDE / host folder the agent should edit in place. */
  hostDir?: string;
}

export async function resolveArchitectureRoot(
  dataDir: string,
  sessions: AgentSession[],
  repoId: string,
): Promise<ArchitectureRoot | undefined> {
  const candidates = sessions
    .filter((session) => session.repoId === repoId && !session.archived)
    .flatMap((session) => {
      const row = candidateRoot(dataDir, session);
      return row ? [{ ...row, updatedAt: session.updatedAt }] : [];
    })
    .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));
  for (const candidate of candidates) {
    try {
      const info = await lstat(candidate.root);
      if (!info.isDirectory()) continue;
    } catch {
      continue;
    }
    if (!(await checkoutHasReadableSource(candidate.root))) continue;
    return {
      root: candidate.root,
      sessionId: candidate.sessionId,
      runtime: candidate.runtime,
      label: candidate.label,
      hostDir: candidate.hostDir,
    };
  }
  return undefined;
}

export async function readArchitectureSources(
  root: string,
): Promise<{ files: ArchSourceFile[]; truncated: boolean }> {
  let rootReal: string;
  try {
    rootReal = await realpath(root);
  } catch {
    return { files: [], truncated: false };
  }
  const found: string[] = [];
  let truncated = false;
  await walk(rootReal, rootReal, "", found, () => {
    truncated = true;
  });
  found.sort();
  if (found.length > MAX_READ) truncated = true;
  const picked = found.slice(0, MAX_READ);
  const files: ArchSourceFile[] = [];
  for (const path of picked) {
    const abs = join(rootReal, ...path.split("/"));
    const ready = await sourceReadiness(rootReal, abs);
    if (ready.kind === "oversize") {
      truncated = true;
      continue;
    }
    if (ready.kind !== "ok") continue;
    try {
      files.push({ path, text: await readFile(ready.real, "utf8") });
    } catch {
      continue;
    }
  }
  return { files, truncated };
}

/** Same walk and size cap as a full read, without loading file bodies. */
async function checkoutHasReadableSource(root: string): Promise<boolean> {
  let rootReal: string;
  try {
    rootReal = await realpath(root);
  } catch {
    return false;
  }
  const found: string[] = [];
  await walk(rootReal, rootReal, "", found, () => undefined);
  found.sort();
  for (const path of found.slice(0, MAX_READ)) {
    const abs = join(rootReal, ...path.split("/"));
    if ((await sourceReadiness(rootReal, abs)).kind === "ok") return true;
  }
  return false;
}

async function sourceReadiness(
  rootReal: string,
  abs: string,
): Promise<{ kind: "ok"; real: string } | { kind: "oversize" | "skip" }> {
  try {
    const info = await lstat(abs);
    if (info.isSymbolicLink() || !info.isFile()) return { kind: "skip" };
    if (info.size > MAX_FILE_BYTES) return { kind: "oversize" };
    const real = await realpath(abs);
    if (!insideRoot(rootReal, real)) return { kind: "skip" };
    return { kind: "ok", real };
  } catch {
    return { kind: "skip" };
  }
}

function candidateRoot(
  dataDir: string,
  session: AgentSession,
): (ArchitectureRoot & { score: number }) | undefined {
  const runtime = sessionRuntime(session);
  if (runtime !== "host" && runtime !== "docker") return undefined;
  const root =
    runtime === "host"
      ? sessionHostWorkspace(dataDir, session)
      : dockerWorkspaceDir(dataDir, session.id);
  const hostDir = runtime === "host" ? session.hostDir?.trim() || undefined : undefined;
  const score = hostDir ? (session.kind === "ide" ? 4 : 3) : runtime === "host" ? 2 : 1;
  return {
    root,
    sessionId: session.id,
    runtime,
    label: session.title || session.id,
    hostDir,
    score,
  };
}

async function walk(
  rootReal: string,
  abs: string,
  rel: string,
  found: string[],
  onCap: () => void,
): Promise<void> {
  if (found.length >= MAX_WALK) {
    onCap();
    return;
  }
  let entries;
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (found.length >= MAX_WALK) {
      onCap();
      return;
    }
    if (entry.isSymbolicLink() || isRepoMapSkipDir(entry.name)) continue;
    const childAbs = join(abs, entry.name);
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walk(rootReal, childAbs, childRel, found, onCap);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isArchitectureSource(childRel, entry.name)) continue;
    if (!insideRoot(rootReal, childAbs)) continue;
    found.push(childRel);
  }
}

function isArchitectureSource(rel: string, name: string): boolean {
  if (isLoadPathNoisePath(rel) || rel.endsWith(".d.ts")) return false;
  return SOURCE_EXT.has(extension(name));
}

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

function insideRoot(rootReal: string, candidate: string): boolean {
  if (!isAbsolute(candidate)) return false;
  const rel = relative(rootReal, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.split(sep).includes(".."));
}
