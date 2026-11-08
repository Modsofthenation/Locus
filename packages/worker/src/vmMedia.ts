import { access } from "node:fs/promises";
import { join } from "node:path";
import { cloudImageFor, hostCloudImageArch, type VmTemplate } from "@locus/shared";

/** Prefer a path that exists on this worker; fall back to `LOCUS_WORKER_HOME/media`. */
export async function resolveWorkerVmTemplate(
  dataDir: string | undefined,
  template: VmTemplate,
): Promise<VmTemplate> {
  const iso = template.isoPath.trim();
  if (iso && (await pathExists(iso))) return template;
  if (!dataDir) return template;
  const cloud = cloudImageFor(template.os, hostCloudImageArch());
  if (!cloud) return template;
  const local = join(dataDir, "media", cloud.filename);
  if (await pathExists(local)) return { ...template, isoPath: local };
  return template;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
