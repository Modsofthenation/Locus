// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { desktopUiCacheDir, packagedUiDir, resolveLaunch, syncPackagedUi } = createRequire(
  import.meta.url,
)("./launch.cjs") as {
  desktopUiCacheDir: (home?: string) => string;
  packagedUiDir: (resourcesPath: string, home?: string) => string;
  resolveLaunch: (opts: Record<string, unknown>) => { env: Record<string, string> } | null;
  syncPackagedUi: (opts: { resourcesPath: string; home?: string; version?: string }) => string;
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("packaged UI cache", () => {
  it("copies the bundled UI onto a host path and reuses it for the same version", () => {
    const root = mkdtempSync(join(tmpdir(), "locus-ui-cache-"));
    dirs.push(root);
    const bundled = join(root, "resources", "ui");
    mkdirSync(bundled, { recursive: true });
    writeFileSync(join(bundled, "index.html"), "<html>bundle</html>");
    const home = join(root, "home");
    const dest = syncPackagedUi({
      resourcesPath: join(root, "resources"),
      home,
      version: "0.15.0",
    });
    expect(dest).toBe(desktopUiCacheDir(home));
    expect(readFileSync(join(dest, "index.html"), "utf8")).toBe("<html>bundle</html>");
    expect(readFileSync(join(dest, ".version"), "utf8")).toBe("0.15.0");
    writeFileSync(join(bundled, "index.html"), "<html>newer</html>");
    const again = syncPackagedUi({
      resourcesPath: join(root, "resources"),
      home,
      version: "0.15.0",
    });
    expect(again).toBe(dest);
    expect(readFileSync(join(dest, "index.html"), "utf8")).toBe("<html>bundle</html>");
    const upgraded = syncPackagedUi({
      resourcesPath: join(root, "resources"),
      home,
      version: "0.15.1",
    });
    expect(upgraded).toBe(dest);
    expect(readFileSync(join(dest, "index.html"), "utf8")).toBe("<html>newer</html>");
  });

  it("points packaged LOCUS_UI at the host cache when it has index.html", () => {
    const home = mkdtempSync(join(tmpdir(), "locus-launch-home-"));
    dirs.push(home);
    mkdirSync(join(home, "desktop-ui"));
    writeFileSync(join(home, "desktop-ui", "index.html"), "<html></html>");
    const launch = resolveLaunch({
      packaged: true,
      dev: false,
      resourcesPath: "/tmp/Locus.app/Contents/Resources",
      execPath: "/tmp/Locus.app/Contents/MacOS/Locus",
      uiDist: "/unused",
      repoRoot: "/repo",
      platform: "linux",
      home,
    });
    expect(packagedUiDir("/tmp/Locus.app/Contents/Resources", home)).toBe(join(home, "desktop-ui"));
    expect(launch?.env.LOCUS_UI).toBe(join(home, "desktop-ui"));
  });
});
