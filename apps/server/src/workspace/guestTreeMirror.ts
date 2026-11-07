import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { unpackDirectory } from "@locus/worker";
import { sanitizeWorkspaceRel } from "./workspaceFiles.js";

export function workerMirrorDir(dataDir: string, sessionId: string): string {
  return join(dataDir, "worker-mirrors", sessionId);
}

export function vmTreeDir(dataDir: string, sessionId: string): string {
  return join(dataDir, "vm-trees", sessionId);
}

export async function unpackWorkerMirror(dest: string, archive: Buffer): Promise<void> {
  await mkdir(dest, { recursive: true });
  await unpackDirectory(archive, dest);
}

export async function writeGuestFiles(
  dest: string,
  files: Array<{ path: string; content: string }>,
): Promise<void> {
  await mkdir(dest, { recursive: true });
  for (const file of files) {
    const rel = sanitizeWorkspaceRel(file.path.replace(/^\/workspace\/?/, ""));
    if (!rel) continue;
    const abs = join(dest, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, file.content);
  }
}

/** Source files only; skip vendor trees. Cap matches the host indexer. */
export const VM_TREE_FIND =
  "find /workspace -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.py' -o -name '*.go' -o -name '*.rs' -o -name '*.java' -o -name '*.rb' -o -name '*.php' -o -name '*.c' -o -name '*.h' -o -name '*.cc' -o -name '*.cpp' -o -name '*.cs' -o -name '*.swift' -o -name '*.kt' -o -name '*.vue' \\) ! -path '*/node_modules/*' ! -path '*/.git/*' ! -path '*/.locus-chrome/*' 2>/dev/null | head -n 400";
