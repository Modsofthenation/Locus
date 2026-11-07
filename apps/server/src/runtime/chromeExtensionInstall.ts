import { cp, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILES = [
  "manifest.json",
  "background.js",
  "content.js",
  "popup.html",
  "popup.js",
  "banner.css",
  "README.md",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

export function chromeExtensionInstallDir(dataDir: string): string {
  return join(dataDir.replace(/[/\\]+$/, ""), "chrome-extension");
}

export function electronResourcesPath(proc: NodeJS.Process = process): string | undefined {
  const value = (proc as NodeJS.Process & { resourcesPath?: unknown }).resourcesPath;
  return typeof value === "string" && value ? value : undefined;
}

export function chromeExtensionSourceDirs(
  opts: {
    cwd?: string;
    resourcesPath?: string;
    moduleDir?: string;
  } = {},
): string[] {
  const cwd = opts.cwd ?? process.cwd();
  const moduleDir = opts.moduleDir ?? dirname(fileURLToPath(import.meta.url));
  return [
    opts.resourcesPath ? join(opts.resourcesPath, "chrome-extension") : "",
    join(moduleDir, "../../../../apps/chrome-extension"),
    join(cwd, "apps/chrome-extension"),
  ].filter(Boolean);
}

export async function syncChromeExtensionFiles(
  dataDir: string,
  opts: { cwd?: string; resourcesPath?: string; moduleDir?: string } = {},
): Promise<string> {
  const dest = chromeExtensionInstallDir(dataDir);
  await mkdir(dest, { recursive: true });
  await mkdir(join(dest, "icons"), { recursive: true });
  const sources = chromeExtensionSourceDirs(opts);
  let src: string | undefined;
  for (const dir of sources) {
    try {
      const info = await stat(join(dir, "manifest.json"));
      if (info.isFile()) {
        src = dir;
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (!src) return dest;
  for (const file of FILES) {
    try {
      await cp(join(src, file), join(dest, file));
    } catch {
      /* optional icon may be missing in tests */
    }
  }
  return dest;
}
