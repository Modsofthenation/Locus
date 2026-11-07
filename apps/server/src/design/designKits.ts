import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { canonicalKitRel, skillFromKitFile, type DesignSystemKit } from "@locus/shared";
import { containedPath } from "@locus/guest-agent";
import { writeWorkspaceBytes } from "../workspace/workspaceFiles.js";
import type { ZipKitFile } from "../media/unzip.js";

const KIT_ID = /^[0-9a-f-]{8,}$/i;

export function designKitDir(dataDir: string, id: string): string {
  if (!KIT_ID.test(id)) throw new Error("Invalid design system id");
  const dest = join(dataDir, "design-kits", id);
  const rel = relative(resolve(dataDir), resolve(dest));
  if (!rel || rel.startsWith("..") || rel.split(sep).includes(".."))
    throw new Error("Invalid design system id");
  return dest;
}

export async function saveDesignKit(
  dataDir: string,
  id: string,
  files: ZipKitFile[],
): Promise<DesignSystemKit | undefined> {
  if (!files.length) return undefined;
  const root = designKitDir(dataDir, id);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true, mode: 0o700 });
  let bytes = 0;
  let skill: ReturnType<typeof skillFromKitFile>;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const rel = sanitizeKitRel(file.name);
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    const dest = underKitRoot(root, rel);
    if (!dest) continue;
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, file.data);
    bytes += file.data.length;
    names.push(rel);
    if (!skill && /\.md$/i.test(rel)) {
      const markdown = file.data.toString("utf8");
      skill = skillFromKitFile(file.name, markdown) ?? skillFromKitFile(rel, markdown);
    }
  }
  if (!names.length) {
    await rm(root, { recursive: true, force: true });
    return undefined;
  }
  const meta: DesignSystemKit = {
    fileCount: names.length,
    bytes,
    skillName: skill?.name,
    skillTitle: skill?.title,
  };
  await writeFile(join(root, "kit.json"), JSON.stringify({ ...meta, files: names }, null, 2));
  return meta;
}

export async function copyDesignKitToWorkspace(
  dataDir: string,
  systemId: string,
  workspaceRoot: string,
  put?: (rel: string, data: Buffer) => Promise<void>,
): Promise<DesignSystemKit | undefined> {
  // Palette-only / named systems are not file kits. Throwing here aborted Design
  // create after kit writes started retrying instead of swallowing.
  if (!KIT_ID.test(systemId)) return undefined;
  const root = designKitDir(dataDir, systemId);
  let listed: string[] = [];
  let meta: DesignSystemKit | undefined;
  try {
    const raw = JSON.parse(await readFile(join(root, "kit.json"), "utf8")) as {
      files?: unknown;
    } & DesignSystemKit;
    listed = Array.isArray(raw.files)
      ? raw.files.filter((name): name is string => typeof name === "string")
      : [];
    meta = {
      fileCount: listed.length,
      bytes: typeof raw.bytes === "number" ? raw.bytes : 0,
      skillName: typeof raw.skillName === "string" ? raw.skillName : undefined,
      skillTitle: typeof raw.skillTitle === "string" ? raw.skillTitle : undefined,
    };
  } catch {
    return undefined;
  }
  for (const name of listed) {
    const rel = sanitizeKitRel(name);
    if (!rel) continue;
    let data: Buffer | undefined;
    try {
      data = await readKitBytes(root, rel);
    } catch {
      continue;
    }
    if (!data) continue;
    if (put) await put(rel, data);
    else await writeWorkspaceBytes(workspaceRoot, rel, data);
  }
  if (meta?.skillName) {
    const skillRel = listed
      .map((name) => sanitizeKitRel(name))
      .find((name) => name && /(?:^|\/)skill\/[^/]+\/skill\.md$/i.test(name));
    if (skillRel) {
      let markdown: Buffer | undefined;
      try {
        markdown = await readKitBytes(root, skillRel);
      } catch {
        markdown = undefined;
      }
      if (markdown) {
        if (put) await put(`.locus/skills/${meta.skillName}.md`, markdown);
        else
          await writeWorkspaceBytes(workspaceRoot, `.locus/skills/${meta.skillName}.md`, markdown);
      }
    }
  }
  return meta;
}

export async function removeDesignKit(dataDir: string, id: string): Promise<void> {
  try {
    await rm(designKitDir(dataDir, id), { recursive: true, force: true });
  } catch {
    /* already gone */
  }
}

function sanitizeKitRel(raw: string): string | undefined {
  const n = raw.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!n || n.endsWith("/") || n.includes("\0")) return undefined;
  if (n.split("/").some((part) => part === "." || part === "..")) return undefined;
  const canon = canonicalKitRel(n);
  if (!canon || canon === "kit.json") return undefined;
  return canon.slice(0, 240);
}

function underKitRoot(root: string, rel: string): string | undefined {
  const dest = resolve(root, rel);
  const relToRoot = relative(resolve(root), dest);
  if (!relToRoot || relToRoot.startsWith("..") || relToRoot.split(sep).includes(".."))
    return undefined;
  return dest;
}

async function readKitBytes(root: string, rel: string): Promise<Buffer | undefined> {
  const dest = underKitRoot(root, rel);
  if (!dest) return undefined;
  try {
    const info = await lstat(dest);
    if (info.isSymbolicLink() || !info.isFile()) return undefined;
    const real = await containedPath(root, dest);
    if (!real) return undefined;
    return await readFile(real);
  } catch {
    return undefined;
  }
}
