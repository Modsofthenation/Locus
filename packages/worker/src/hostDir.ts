import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const SECRET_HOME_DIRS = [".ssh", ".gnupg", ".aws", ".kube", ".locus"];

/** Empty `hostDir` stays under `dataDir/host-workspaces/<session>`. A typed path is jailed. */
export function resolveWorkerHostDir(
  requested: string | undefined,
  dataDir: string,
  sessionId: string,
): string {
  const trimmed = requested?.trim();
  if (!trimmed) return join(dataDir, "host-workspaces", sessionId);
  if (!isAbsolute(trimmed)) throw new Error("Folder must be an absolute path");
  const blocked = blockedWorkerHostDirReason(trimmed, dataDir);
  if (blocked) throw new Error(blocked);
  return trimmed;
}

export function blockedWorkerHostDirReason(abs: string, dataDir?: string): string | undefined {
  const real = resolve(abs);
  if (dirname(real) === real) return "Folder cannot be the filesystem root";
  const home = resolve(homedir());
  if (real === home) return "Folder cannot be your home directory";
  for (const name of SECRET_HOME_DIRS) {
    const root = join(home, name);
    if (insideOrSame(root, real)) return `Folder cannot be ${root}`;
  }
  if (dataDir && insideOrSame(dataDir, real)) {
    return "Folder cannot be the Locus data directory";
  }
}

function insideOrSame(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !rel.split(sep).includes(".."));
}
