import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chromeExtensionInstallDir,
  chromeExtensionSourceDirs,
  electronResourcesPath,
  syncChromeExtensionFiles,
} from "./chromeExtensionInstall.js";

describe("chrome extension install copy", () => {
  it("lists packaged and repo source folders", () => {
    const dirs = chromeExtensionSourceDirs({
      cwd: "/repo",
      resourcesPath: "/app/Resources",
      moduleDir: "/repo/apps/server/src/runtime",
    });
    expect(dirs).toContain("/app/Resources/chrome-extension");
    expect(dirs).toContain("/repo/apps/chrome-extension");
  });

  it("reads Electron process.resourcesPath when present", () => {
    expect(electronResourcesPath({} as NodeJS.Process)).toBeUndefined();
    expect(
      electronResourcesPath({ resourcesPath: "/app/Resources" } as NodeJS.Process & {
        resourcesPath: string;
      }),
    ).toBe("/app/Resources");
  });

  it("copies the unpacked extension into the data dir", async () => {
    const root = await mkdtemp(join(tmpdir(), "locus-cx-"));
    const src = join(root, "apps/chrome-extension");
    await mkdir(join(src, "icons"), { recursive: true });
    await writeFile(join(src, "manifest.json"), `{"manifest_version":3,"name":"Locus"}\n`);
    await writeFile(join(src, "background.js"), "void 0;\n");
    const dataDir = join(root, "data");
    const dest = await syncChromeExtensionFiles(dataDir, { cwd: root, moduleDir: src });
    expect(dest).toBe(chromeExtensionInstallDir(dataDir));
    expect(await readFile(join(dest, "manifest.json"), "utf8")).toMatch(/Locus/);
  });
});
