// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { desktopUiCacheDir, packagedUiDir, resolveLaunch, syncPackagedUi, uiBuildStamp } =
  createRequire(import.meta.url)("./launch.cjs") as {
    desktopUiCacheDir: (home?: string) => string;
    packagedUiDir: (resourcesPath: string, home?: string) => string;
    resolveLaunch: (opts: Record<string, unknown>) => { env: Record<string, string> } | null;
    syncPackagedUi: (opts: { resourcesPath: string; home?: string; version?: string }) => string;
    uiBuildStamp: (version: string | undefined, dir: string) => string;
  };

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("packaged UI cache", () => {
  it("copies the bundled UI onto a host path and reuses it for the same build", () => {
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
    expect(readFileSync(join(dest, ".version"), "utf8")).toMatch(/^0\.15\.0\+[0-9a-f]{16}$/);
    writeFileSync(join(dest, "marker"), "kept");
    const again = syncPackagedUi({
      resourcesPath: join(root, "resources"),
      home,
      version: "0.15.0",
    });
    expect(again).toBe(dest);
    expect(readFileSync(join(dest, "marker"), "utf8")).toBe("kept");
    const upgraded = syncPackagedUi({
      resourcesPath: join(root, "resources"),
      home,
      version: "0.15.1",
    });
    expect(upgraded).toBe(dest);
    expect(existsSync(join(dest, "marker"))).toBe(false);
  });

  it("refreshes the cached UI when a same-version rebuild changes the bundle", () => {
    const root = mkdtempSync(join(tmpdir(), "locus-ui-cache-"));
    dirs.push(root);
    const bundled = join(root, "resources", "ui");
    mkdirSync(bundled, { recursive: true });
    writeFileSync(join(bundled, "index.html"), '<script src="/assets/index-old.js"></script>');
    const home = join(root, "home");
    const opts = { resourcesPath: join(root, "resources"), home, version: "0.18.0" };
    const dest = syncPackagedUi(opts);
    const firstStamp = readFileSync(join(dest, ".version"), "utf8");
    writeFileSync(join(bundled, "index.html"), '<script src="/assets/index-new.js"></script>');
    expect(syncPackagedUi(opts)).toBe(dest);
    expect(readFileSync(join(dest, "index.html"), "utf8")).toContain("index-new.js");
    expect(readFileSync(join(dest, ".version"), "utf8")).not.toBe(firstStamp);
  });

  it("refreshes a cache stamped by an older desktop with only the version", () => {
    const root = mkdtempSync(join(tmpdir(), "locus-ui-cache-"));
    dirs.push(root);
    const bundled = join(root, "resources", "ui");
    mkdirSync(bundled, { recursive: true });
    writeFileSync(join(bundled, "index.html"), "<html>new sidebar</html>");
    const home = join(root, "home");
    const cache = desktopUiCacheDir(home);
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, "index.html"), "<html>old sidebar</html>");
    writeFileSync(join(cache, ".version"), "0.18.0");
    syncPackagedUi({ resourcesPath: join(root, "resources"), home, version: "0.18.0" });
    expect(readFileSync(join(cache, "index.html"), "utf8")).toBe("<html>new sidebar</html>");
  });

  it("stamps builds by version and UI content", () => {
    const root = mkdtempSync(join(tmpdir(), "locus-ui-stamp-"));
    dirs.push(root);
    expect(uiBuildStamp("0.18.0", join(root, "missing"))).toBe("0.18.0");
    writeFileSync(join(root, "index.html"), "a");
    const a = uiBuildStamp("0.18.0", root);
    writeFileSync(join(root, "index.html"), "b");
    expect(uiBuildStamp("0.18.0", root)).not.toBe(a);
    expect(a.startsWith("0.18.0+")).toBe(true);
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
