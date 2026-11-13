import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Plan =
  | { kind: "reject"; reason: string }
  | { kind: "appimage"; source: string; target: string }
  | { kind: "windows"; source: string }
  | { kind: "open"; source: string };

const { planUpdateInstall, swapAppImage } = createRequire(import.meta.url)(
  "./update-install.cjs",
) as {
  planUpdateInstall: (opts: {
    file: unknown;
    updatesDir: string;
    platform: string;
    appImage?: string;
  }) => Plan;
  swapAppImage: (source: string, target: string) => string;
};

describe("planUpdateInstall", () => {
  const updatesDir = join(tmpdir(), "locus-home", "updates");

  it("refuses files outside the updates folder", () => {
    expect(
      planUpdateInstall({
        file: "/tmp/evil.AppImage",
        updatesDir,
        platform: "linux",
        appImage: "/a",
      }),
    ).toMatchObject({ kind: "reject" });
    expect(
      planUpdateInstall({ file: join(updatesDir, "..", "x.exe"), updatesDir, platform: "win32" }),
    ).toMatchObject({ kind: "reject" });
    expect(planUpdateInstall({ file: 7, updatesDir, platform: "linux" })).toMatchObject({
      kind: "reject",
    });
  });

  it("swaps a running AppImage on Linux", () => {
    const file = join(updatesDir, "Locus-0.21.0.AppImage");
    expect(
      planUpdateInstall({ file, updatesDir, platform: "linux", appImage: "/opt/Locus.AppImage" }),
    ).toEqual({ kind: "appimage", source: file, target: "/opt/Locus.AppImage" });
  });

  it("opens the file when not running from an AppImage", () => {
    const file = join(updatesDir, "Locus-0.21.0.AppImage");
    expect(planUpdateInstall({ file, updatesDir, platform: "linux" })).toEqual({
      kind: "open",
      source: file,
    });
    const deb = join(updatesDir, "Locus-0.21.0-amd64.deb");
    expect(
      planUpdateInstall({ file: deb, updatesDir, platform: "linux", appImage: "/a" }).kind,
    ).toBe("open");
  });

  it("runs the NSIS installer on Windows and opens a dmg on macOS", () => {
    const exe = join(updatesDir, "Locus Setup 0.21.0.exe");
    expect(planUpdateInstall({ file: exe, updatesDir, platform: "win32" })).toEqual({
      kind: "windows",
      source: exe,
    });
    const dmg = join(updatesDir, "Locus-0.21.0.dmg");
    expect(planUpdateInstall({ file: dmg, updatesDir, platform: "darwin" }).kind).toBe("open");
  });
});

describe("swapAppImage", () => {
  it("replaces the target with an executable copy", () => {
    const dir = mkdtempSync(join(tmpdir(), "locus-appimage-"));
    const source = join(dir, "new.AppImage");
    const target = join(dir, "Locus.AppImage");
    writeFileSync(source, "new build");
    writeFileSync(target, "old build");
    swapAppImage(source, target);
    expect(readFileSync(target, "utf8")).toBe("new build");
    if (process.platform !== "win32") expect(statSync(target).mode & 0o111).not.toBe(0);
    expect(existsSync(join(dir, ".Locus.AppImage.update"))).toBe(false);
  });

  it("fails without touching the target when the download is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "locus-appimage-"));
    const target = join(dir, "Locus.AppImage");
    writeFileSync(target, "old build");
    expect(() => swapAppImage(join(dir, "missing.AppImage"), target)).toThrow(/missing/);
    expect(readFileSync(target, "utf8")).toBe("old build");
  });
});
