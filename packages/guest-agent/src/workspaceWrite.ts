import { chmod, stat, unlink, writeFile } from "node:fs/promises";

/**
 * Docker apply_patch unlinks then recreates, which drops +x.
 * Restore any previous execute bit after the write.
 */
export async function writeFileKeepExec(
  path: string,
  content: string,
  opts?: { replace?: boolean },
): Promise<void> {
  let exec = false;
  try {
    exec = Boolean((await stat(path)).mode & 0o111);
  } catch {
    /* new file */
  }
  if (opts?.replace) await unlink(path).catch(() => undefined);
  await writeFile(path, content);
  if (exec) await chmod(path, 0o755);
}
