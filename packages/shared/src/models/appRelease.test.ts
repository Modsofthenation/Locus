import { describe, expect, it } from "vitest";
import {
  LOCUS_GITHUB_REPO,
  LOCUS_RELEASES_API_URL,
  LOCUS_RELEASES_URL,
  compareVersions,
  isNewerVersion,
  parseVersionTag,
  pickReleaseAsset,
} from "./appRelease.js";

describe("app release helpers", () => {
  it("parses v-prefixed tags", () => {
    expect(parseVersionTag("v0.4.2")).toEqual([0, 4, 2]);
    expect(parseVersionTag("0.4.2")).toEqual([0, 4, 2]);
    expect(parseVersionTag("v1.0.0-beta.1")).toEqual([1, 0, 0]);
  });

  it("compares versions and detects a newer release", () => {
    expect(compareVersions("0.4.2", "0.4.2")).toBe(0);
    expect(compareVersions("v0.4.3", "0.4.2")).toBeGreaterThan(0);
    expect(compareVersions("0.4.1", "v0.4.2")).toBeLessThan(0);
    expect(isNewerVersion("v0.5.0", "0.4.2")).toBe(true);
    expect(isNewerVersion("0.4.2", "0.4.2")).toBe(false);
    expect(isNewerVersion("0.4.1", "0.4.2")).toBe(false);
  });

  it("picks the installer asset for this platform", () => {
    const assets = [
      { name: "Locus-0.4.3.AppImage", url: "https://example/linux" },
      { name: "Locus-0.4.3.dmg", url: "https://example/mac" },
      { name: "Locus-0.4.3.exe", url: "https://example/win" },
      { name: "Locus-0.4.3.exe.blockmap", url: "https://example/block" },
    ];
    expect(pickReleaseAsset(assets, "linux")?.url).toBe("https://example/linux");
    expect(pickReleaseAsset(assets, "darwin")?.url).toBe("https://example/mac");
    expect(pickReleaseAsset(assets, "win32")?.url).toBe("https://example/win");
  });

  it("points at the public GitHub releases feed", () => {
    expect(LOCUS_GITHUB_REPO).toBe("Locus");
    expect(LOCUS_RELEASES_URL).toContain("github.com/Modsofthenation/Locus/releases");
    expect(LOCUS_RELEASES_API_URL).toContain("/repos/Modsofthenation/Locus/releases/latest");
  });
});
