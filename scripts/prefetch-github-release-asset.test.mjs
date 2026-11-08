import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import {
  builderArtifactsFor,
  builderCacheRoot,
  builderDestPath,
  downloadGithubReleaseAsset,
  electronCacheRoot,
  electronGetCacheSubdir,
  electronShasumsCachePath,
  electronZipCachePath,
  electronZipFileName,
  parseChecksumFile,
  prefetchElectronArtifacts,
  readElectronVersion,
  sevenZipFilename,
} from "./prefetch-github-release-asset.mjs";

describe("builderArtifactsFor", () => {
  it("includes 7zip, icons, and AppImage tools on linux x64", () => {
    const files = builderArtifactsFor("linux", "x64").map((row) => row.file);
    assert.deepEqual(files, ["7zip-linux-x64.tar.gz", "icons-bundle.tar.gz", "appimage-12.0.1.7z"]);
  });

  it("includes NSIS and winCodeSign on Windows", () => {
    const files = builderArtifactsFor("win32", "x64").map((row) => row.file);
    assert.ok(files.includes("nsis-3.0.4.1.7z"));
    assert.ok(files.includes("winCodeSign-2.6.0.7z"));
    assert.equal(sevenZipFilename("win32", "x64"), "7zip-win-x64.tar.gz");
  });

  it("picks darwin arm64 7zip on Apple silicon", () => {
    assert.equal(sevenZipFilename("darwin", "arm64"), "7zip-darwin-arm64.tar.gz");
  });
});

describe("builderCacheRoot", () => {
  it("honors an absolute ELECTRON_BUILDER_CACHE", () => {
    assert.equal(builderCacheRoot({ ELECTRON_BUILDER_CACHE: "/tmp/eb" }, "linux"), "/tmp/eb");
  });

  it("writes each archive under <cache>/<tag>/<file>", () => {
    assert.equal(
      builderDestPath("7zip@1.0.0", "7zip-linux-x64.tar.gz", "/tmp/eb"),
      "/tmp/eb/7zip@1.0.0/7zip-linux-x64.tar.gz",
    );
  });
});

describe("electron cache seeding", () => {
  it("puts Windows Electron under %LOCALAPPDATA%\\electron\\Cache, not electron-builder", () => {
    assert.equal(
      electronCacheRoot({ LOCALAPPDATA: "C:\\Users\\runneradmin\\AppData\\Local" }, "win32"),
      join("C:\\Users\\runneradmin\\AppData\\Local", "electron", "Cache"),
    );
  });

  it("names the zip the way @electron/get 3 validates SHASUMS256.txt", () => {
    assert.equal(electronZipFileName("45.2.2", "win32", "x64"), "electron-v45.2.2-win32-x64.zip");
    assert.equal(readElectronVersion({ build: { electronVersion: "45.2.2" } }), "45.2.2");
  });

  it("hashes the release directory the same way @electron/get 3 Cache.getCacheDirectory does", () => {
    assert.equal(
      electronGetCacheSubdir(
        "https://github.com/electron/electron/releases/download/v45.2.2/electron-v45.2.2-win32-x64.zip",
      ),
      "1ab0cf2cf1468b148f12015f260a50382295af0f5c29efd300dd4c4938b51db7",
    );
    assert.equal(
      electronZipCachePath("45.2.2", "win32", "x64", "/tmp/electron"),
      join(
        "/tmp/electron",
        "1ab0cf2cf1468b148f12015f260a50382295af0f5c29efd300dd4c4938b51db7",
        "electron-v45.2.2-win32-x64.zip",
      ),
    );
    assert.equal(
      electronShasumsCachePath("45.2.2", "/tmp/electron"),
      join("/tmp/electron", "SHASUMS256.txt-45.2.2"),
    );
  });

  it("parses official SHASUMS256.txt lines", () => {
    const checksums = parseChecksumFile(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa *electron-v45.2.2-win32-x64.zip\n",
    );
    assert.equal(
      checksums["electron-v45.2.2-win32-x64.zip"],
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  it("seeds SHASUMS256.txt then the zip through the GitHub API", async () => {
    const zip = Buffer.from("electron-zip");
    const sha256 = createHash("sha256").update(zip).digest("hex");
    const shasums = `${sha256} *electron-v45.2.2-win32-x64.zip\n`;
    const cacheRoot = await mkdtemp(join(tmpdir(), "electron-cache-"));
    const urls = [];
    const fetchFn = async (url, init) => {
      urls.push({ url, accept: init.headers.Accept });
      if (String(url).includes("/releases/tags/")) {
        return {
          ok: true,
          json: async () => ({
            assets: [
              { name: "SHASUMS256.txt", url: "https://api.github.com/assets/shasums" },
              { name: "electron-v45.2.2-win32-x64.zip", url: "https://api.github.com/assets/zip" },
            ],
          }),
        };
      }
      if (String(url).endsWith("/shasums")) {
        return { ok: true, arrayBuffer: async () => Buffer.from(shasums) };
      }
      return { ok: true, arrayBuffer: async () => zip };
    };
    const result = await prefetchElectronArtifacts({
      env: {},
      platform: "win32",
      arch: "x64",
      version: "45.2.2",
      cacheRoot,
      token: "t",
      fetchFn,
    });
    assert.equal(result.version, "45.2.2");
    assert.equal(await readFile(result.shasums.dest, "utf8"), shasums);
    assert.equal(await readFile(result.zip.dest, "utf8"), zip.toString());
    assert.ok(urls.some((row) => row.accept === "application/octet-stream"));
  });
});

describe("downloadGithubReleaseAsset", () => {
  it("follows the API asset URL and verifies sha256", async () => {
    const payload = Buffer.from("locus-bin");
    const sha256 = createHash("sha256").update(payload).digest("hex");
    const dest = join(await mkdtemp(join(tmpdir(), "prefetch-")), "out.bin");
    const urls = [];
    const fetchFn = async (url, init) => {
      urls.push({ url, accept: init.headers.Accept });
      if (String(url).includes("/releases/tags/")) {
        return {
          ok: true,
          json: async () => ({
            assets: [{ name: "tool.tar.gz", url: "https://api.github.com/assets/1" }],
          }),
        };
      }
      return {
        ok: true,
        arrayBuffer: async () => payload,
      };
    };
    const result = await downloadGithubReleaseAsset({
      owner: "electron-userland",
      repo: "electron-builder-binaries",
      tag: "7zip@1.0.0",
      file: "tool.tar.gz",
      sha256,
      dest,
      token: "t",
      attempts: 1,
      fetchFn,
    });
    assert.equal(result.bytes, payload.length);
    assert.equal(await readFile(dest, "utf8"), "locus-bin");
    assert.equal(urls[0].accept, "application/vnd.github+json");
    assert.equal(urls[1].accept, "application/octet-stream");
    assert.match(urls[0].url, /7zip%401\.0\.0/);
  });

  it("retries a 504 then succeeds", async () => {
    const payload = Buffer.from("ok");
    const sha256 = createHash("sha256").update(payload).digest("hex");
    const dest = join(await mkdtemp(join(tmpdir(), "prefetch-")), "out.bin");
    let n = 0;
    const fetchFn = async (url) => {
      if (String(url).includes("/releases/tags/")) {
        return {
          ok: true,
          json: async () => ({
            assets: [{ name: "tool.tar.gz", url: "https://api.github.com/assets/1" }],
          }),
        };
      }
      n += 1;
      if (n === 1) return { ok: false, status: 504, arrayBuffer: async () => new ArrayBuffer(0) };
      return { ok: true, arrayBuffer: async () => payload };
    };
    const sleeps = [];
    await downloadGithubReleaseAsset({
      owner: "o",
      repo: "r",
      tag: "t",
      file: "tool.tar.gz",
      sha256,
      dest,
      token: "t",
      attempts: 3,
      delayMs: 5,
      fetchFn,
      sleeper: async (ms) => {
        sleeps.push(ms);
      },
    });
    assert.equal(n, 2);
    assert.deepEqual(sleeps, [5]);
    assert.equal(await readFile(dest, "utf8"), "ok");
  });

  it("reuses a dest whose sha256 already matches", async () => {
    const payload = Buffer.from("already-there");
    const sha256 = createHash("sha256").update(payload).digest("hex");
    const dest = join(await mkdtemp(join(tmpdir(), "prefetch-")), "out.bin");
    await downloadGithubReleaseAsset({
      owner: "o",
      repo: "r",
      tag: "t",
      file: "tool.tar.gz",
      sha256,
      dest,
      token: "t",
      attempts: 1,
      fetchFn: async (url) => {
        if (String(url).includes("/releases/tags/")) {
          return {
            ok: true,
            json: async () => ({
              assets: [{ name: "tool.tar.gz", url: "https://api.github.com/assets/1" }],
            }),
          };
        }
        return { ok: true, arrayBuffer: async () => payload };
      },
    });
    let downloads = 0;
    const result = await downloadGithubReleaseAsset({
      owner: "o",
      repo: "r",
      tag: "t",
      file: "tool.tar.gz",
      sha256,
      dest,
      token: "t",
      attempts: 1,
      fetchFn: async () => {
        downloads += 1;
        throw new Error("should not download");
      },
    });
    assert.equal(downloads, 0);
    assert.equal(result.cached, true);
    assert.equal(await readFile(dest, "utf8"), "already-there");
  });
});
