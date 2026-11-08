#!/usr/bin/env node
/**
 * Download a GitHub Release asset through the API (release-assets.githubusercontent.com)
 * instead of github.com/repo/releases/download, which 504s from GitHub Actions.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse as parsePath } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseUrl, format as formatUrl } from "node:url";
import { resolve } from "node:path";

const USER_AGENT = "locus-prefetch-github-release-asset";
const API_VERSION = "2022-11-28";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

/** Checksums copied from electron-builder 26.18.0 toolset modules. */
export const BUILDER_BINARIES = {
  "7zip-linux-x64.tar.gz": {
    tag: "7zip@1.0.0",
    sha256: "d151bb44b2a9d9bfc52813ce4cac042916394a0ab8a56bd5d221a5dc9ef8d5d7",
  },
  "7zip-linux-arm64.tar.gz": {
    tag: "7zip@1.0.0",
    sha256: "5aff5034206b78f8261249ceb922b5c7e04c9bdb733784d8f5b6df9732cf1f79",
  },
  "7zip-darwin-arm64.tar.gz": {
    tag: "7zip@1.0.0",
    sha256: "496a341abe210aae1a25bc202ee97f6de6c76a3dc80f91d96616be05502d72c1",
  },
  "7zip-darwin-x86_64.tar.gz": {
    tag: "7zip@1.0.0",
    sha256: "496a341abe210aae1a25bc202ee97f6de6c76a3dc80f91d96616be05502d72c1",
  },
  "7zip-win-x64.tar.gz": {
    tag: "7zip@1.0.0",
    sha256: "be071f15bd6da2f78fe81c6ddef2009b0c4d8a51f36b780cb806c7e6df95e1b3",
  },
  "appimage-12.0.1.7z": {
    tag: "appimage-12.0.1",
    sha256: "d12ff7eb8f1d1ec4652ca5237a7fbdca33acc0c758045636feca62dc6ecb8ec4",
  },
  "icons-bundle.tar.gz": {
    tag: "icons@1.2.3",
    sha256: "4e5bb546c9d3ab0c2bbacc22857467bf415f742a34c2be9dd138779d2fc066f9",
  },
  "nsis-3.0.4.1.7z": {
    tag: "nsis-3.0.4.1",
    sha256: "9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa",
  },
  "nsis-resources-3.4.1.7z": {
    tag: "nsis-resources-3.4.1",
    sha256: "593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103",
  },
  "winCodeSign-2.6.0.7z": {
    tag: "winCodeSign-2.6.0",
    sha256: "cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4",
  },
};

export function builderCacheRoot(env = process.env, platform = process.platform) {
  const override = env.ELECTRON_BUILDER_CACHE?.trim();
  if (override && parsePath(override).root) return override;
  if (platform === "darwin") return join(homedir(), "Library", "Caches", "electron-builder");
  if (platform === "win32") {
    const local = env.LOCALAPPDATA?.trim();
    return join(local || join(homedir(), "AppData", "Local"), "electron-builder", "Cache");
  }
  const xdg = env.XDG_CACHE_HOME;
  return xdg && parsePath(xdg).root
    ? join(xdg, "electron-builder")
    : join(homedir(), ".cache", "electron-builder");
}

/**
 * @electron/get 3 / electron-builder `defaultElectronGetCacheRoot`.
 * Seeding SHASUMS256.txt here lets electron-builder inject inline checksums so
 * @electron/get does not re-download SHASUMS256.txt from github.com (cacheMode Bypass).
 */
export function electronCacheRoot(env = process.env, platform = process.platform) {
  if (platform === "darwin") return join(homedir(), "Library", "Caches", "electron");
  if (platform === "win32") {
    const local = env.LOCALAPPDATA?.trim();
    return join(local || join(homedir(), "AppData", "Local"), "electron", "Cache");
  }
  const xdg = env.XDG_CACHE_HOME;
  return xdg && parsePath(xdg).root ? join(xdg, "electron") : join(homedir(), ".cache", "electron");
}

export function sevenZipFilename(platform = process.platform, arch = process.arch) {
  if (platform === "darwin")
    return arch === "arm64" ? "7zip-darwin-arm64.tar.gz" : "7zip-darwin-x86_64.tar.gz";
  if (platform === "win32") return "7zip-win-x64.tar.gz";
  return arch === "arm64" ? "7zip-linux-arm64.tar.gz" : "7zip-linux-x64.tar.gz";
}

export function builderArtifactsFor(platform = process.platform, arch = process.arch) {
  const files = [sevenZipFilename(platform, arch), "icons-bundle.tar.gz"];
  if (platform === "linux") files.push("appimage-12.0.1.7z");
  if (platform === "win32")
    files.push("nsis-3.0.4.1.7z", "nsis-resources-3.4.1.7z", "winCodeSign-2.6.0.7z");
  return files.map((file) => {
    const meta = BUILDER_BINARIES[file];
    return { file, tag: meta.tag, sha256: meta.sha256 };
  });
}

export function builderDestPath(tag, file, cacheRoot = builderCacheRoot()) {
  return join(cacheRoot, tag, file);
}

export function readElectronVersion(pkg) {
  const raw =
    pkg?.build?.electronVersion ?? pkg?.devDependencies?.electron ?? pkg?.dependencies?.electron;
  if (!raw) throw new Error("electron version not found in package.json");
  const version = String(raw).replace(/^[^\d]*/, "");
  if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error(`invalid electron version: ${raw}`);
  return version;
}

export function electronZipFileName(version, platform = process.platform, arch = process.arch) {
  return `electron-v${version}-${platform}-${arch}.zip`;
}

export function electronReleaseUrl(version, file) {
  return `https://github.com/electron/electron/releases/download/v${version}/${file}`;
}

/**
 * Mirror of @electron/get 3.1.0 Cache.getCacheDirectory — the zip is stored at
 * `<electronCache>/<sha256(strippedUrl)>/<filename>`.
 */
export function electronGetCacheSubdir(downloadUrl) {
  const parsed = parseUrl(downloadUrl);
  const { search: _search, hash: _hash, pathname, ...rest } = parsed;
  const strippedUrl = formatUrl({
    ...rest,
    pathname: dirname(pathname || "electron"),
  });
  return createHash("sha256").update(strippedUrl).digest("hex");
}

export function electronZipCachePath(
  version,
  platform = process.platform,
  arch = process.arch,
  cacheRoot = electronCacheRoot(),
) {
  const file = electronZipFileName(version, platform, arch);
  const subdir = electronGetCacheSubdir(electronReleaseUrl(version, file));
  return join(cacheRoot, subdir, file);
}

export function electronShasumsCachePath(version, cacheRoot = electronCacheRoot()) {
  return join(cacheRoot, `SHASUMS256.txt-${version}`);
}

export function parseChecksumFile(content) {
  const checksums = {};
  for (const rawLine of content.split("\n")) {
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(rawLine.trim());
    if (match) checksums[match[2]] = match[1].toLowerCase();
  }
  return checksums;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sha256File(file) {
  const hash = createHash("sha256");
  const stream = createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export async function githubJson(url, token, fetchFn = fetch) {
  const res = await fetchFn(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": API_VERSION,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${url} → HTTP ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

async function writeDownload(res, dest, sha256) {
  await mkdir(dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  const hash = createHash("sha256");
  try {
    if (res.body && typeof res.body.getReader === "function") {
      const hasher = new Transform({
        transform(chunk, _enc, cb) {
          hash.update(chunk);
          cb(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body), hasher, createWriteStream(tmp));
    } else {
      const buf = Buffer.from(await res.arrayBuffer());
      hash.update(buf);
      await writeFile(tmp, buf);
    }
    const actual = hash.digest("hex");
    if (sha256 && actual !== sha256) {
      throw new Error(`checksum mismatch for ${dest}: expected ${sha256}, got ${actual}`);
    }
    await unlink(dest).catch(() => {});
    await rename(tmp, dest);
    const info = await stat(dest);
    return { dest, sha256: actual, bytes: info.size };
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

export async function downloadGithubReleaseAsset(options) {
  const {
    owner,
    repo,
    tag,
    file,
    sha256,
    dest,
    token,
    attempts = 5,
    delayMs = 2000,
    fetchFn = fetch,
    sleeper = sleep,
  } = options;
  if (!token) throw new Error("GITHUB_TOKEN (or GH_TOKEN) is required");
  if (sha256 && (await fileExists(dest))) {
    const actual = await sha256File(dest);
    if (actual === sha256)
      return { dest, sha256: actual, bytes: (await stat(dest)).size, cached: true };
  }
  const releaseUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      const release = await githubJson(releaseUrl, token, fetchFn);
      const asset = (release.assets ?? []).find((row) => row.name === file);
      if (!asset?.url) throw new Error(`no asset ${file} on ${owner}/${repo}@${tag}`);
      const res = await fetchFn(asset.url, {
        headers: {
          Accept: "application/octet-stream",
          Authorization: `Bearer ${token}`,
          "User-Agent": USER_AGENT,
          "X-GitHub-Api-Version": API_VERSION,
        },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`GET ${asset.url} → HTTP ${res.status}`);
      return await writeDownload(res, dest, sha256);
    } catch (err) {
      lastError = err;
      if (i < attempts) {
        console.error(
          `prefetch: ${file} failed (attempt ${i}/${attempts}: ${err.message}); retrying in ${delayMs / 1000}s`,
        );
        await sleeper(delayMs * i);
      }
    }
  }
  throw lastError;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    out[key.slice(2)] = argv[i + 1];
    i += 1;
  }
  return out;
}

async function prefetchBuilderBinaries(env = process.env) {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  const artifacts = builderArtifactsFor();
  for (const row of artifacts) {
    const dest = builderDestPath(row.tag, row.file);
    const result = await downloadGithubReleaseAsset({
      owner: "electron-userland",
      repo: "electron-builder-binaries",
      tag: row.tag,
      file: row.file,
      sha256: row.sha256,
      dest,
      token,
    });
    console.error(
      `prefetch: ${row.file} → ${result.dest} (${result.bytes} bytes${result.cached ? ", cached" : ""})`,
    );
  }
}

export async function prefetchElectronArtifacts(options = {}) {
  const {
    env = process.env,
    platform = process.platform,
    arch = process.arch,
    version,
    cacheRoot: cacheRootOverride,
    token = env.GITHUB_TOKEN || env.GH_TOKEN,
    fetchFn = fetch,
  } = options;
  const electronVersion =
    version ??
    readElectronVersion(
      JSON.parse(await readFile(join(REPO_ROOT, "apps/desktop/package.json"), "utf8")),
    );
  const cacheRoot = cacheRootOverride ?? electronCacheRoot(env, platform);
  const shasumsDest = electronShasumsCachePath(electronVersion, cacheRoot);
  const shasums = await downloadGithubReleaseAsset({
    owner: "electron",
    repo: "electron",
    tag: `v${electronVersion}`,
    file: "SHASUMS256.txt",
    dest: shasumsDest,
    token,
    fetchFn,
  });
  const plainShasums = join(cacheRoot, "SHASUMS256.txt");
  if (plainShasums !== shasumsDest) {
    await mkdir(dirname(plainShasums), { recursive: true });
    await writeFile(plainShasums, await readFile(shasumsDest));
  }
  console.error(`prefetch: SHASUMS256.txt → ${shasums.dest} (${shasums.bytes} bytes)`);
  const zipFile = electronZipFileName(electronVersion, platform, arch);
  const checksums = parseChecksumFile(await readFile(shasumsDest, "utf8"));
  const zipSha = checksums[zipFile];
  if (!zipSha) throw new Error(`SHASUMS256.txt has no entry for ${zipFile}`);
  const zipDest = electronZipCachePath(electronVersion, platform, arch, cacheRoot);
  const zip = await downloadGithubReleaseAsset({
    owner: "electron",
    repo: "electron",
    tag: `v${electronVersion}`,
    file: zipFile,
    sha256: zipSha,
    dest: zipDest,
    token,
    fetchFn,
  });
  console.error(
    `prefetch: ${zipFile} → ${zip.dest} (${zip.bytes} bytes${zip.cached ? ", cached" : ""})`,
  );
  return { shasums, zip, version: electronVersion };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const args = parseArgs(process.argv.slice(2));
  if (args.out) {
    if (!args.owner || !args.repo || !args.tag || !args.file) {
      console.error(
        "usage: prefetch-github-release-asset.mjs --owner <org> --repo <name> --tag <tag> --file <name> --out <path> [--sha256 <hex>]",
      );
      process.exit(2);
    }
    await downloadGithubReleaseAsset({
      owner: args.owner,
      repo: args.repo,
      tag: args.tag,
      file: args.file,
      sha256: args.sha256,
      dest: args.out,
      token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    });
  } else {
    await prefetchElectronArtifacts();
    await prefetchBuilderBinaries();
  }
}
