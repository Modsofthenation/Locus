import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { PLAYWRIGHT_CHROME_MISSING } from "@locus/shared";
import type { CdpEndpoint } from "./chromium.js";

export type HostChromeHandle = {
  endpoint: CdpEndpoint;
  close: () => void;
};

export type HostChromeLookup = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  exists?: (path: string) => boolean;
  readdir?: (dir: string) => string[];
};

function pathApi(platform: NodeJS.Platform) {
  return platform === "win32" ? win32 : posix;
}

function unique(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const item = value?.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function homeDir(env: NodeJS.ProcessEnv, home?: string): string {
  return env.HOME?.trim() || env.USERPROFILE?.trim() || home || homedir();
}

function pathDirs(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const sep = platform === "win32" ? ";" : ":";
  return (env.PATH ?? env.Path ?? "")
    .split(sep)
    .map((dir) => dir.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}

function listDir(dir: string, readdir: (path: string) => string[]): string[] {
  try {
    return readdir(dir);
  } catch {
    return [];
  }
}

function envBins(env: NodeJS.ProcessEnv): string[] {
  return unique([env.CHROME_PATH, env.PUPPETEER_EXECUTABLE_PATH]);
}

function windowsInstallBins(
  join: (...parts: string[]) => string,
  env: NodeJS.ProcessEnv,
  home: string,
): string[] {
  const pf = env.ProgramFiles?.trim() || "C:\\Program Files";
  const pf86 = env["ProgramFiles(x86)"]?.trim() || "C:\\Program Files (x86)";
  const local = env.LOCALAPPDATA?.trim() || join(home, "AppData", "Local");
  return [
    join(pf, "Google", "Chrome", "Application", "chrome.exe"),
    join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
    join(local, "Google", "Chrome", "Application", "chrome.exe"),
    join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(local, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(pf, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    join(pf86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    join(local, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    join(local, "Chromium", "Application", "chrome.exe"),
    join(local, "Google", "Chrome SxS", "Application", "chrome.exe"),
  ];
}

function darwinInstallBins(join: (...parts: string[]) => string, home: string): string[] {
  const apps = ["/Applications", join(home, "Applications")];
  const names: Array<[string, string]> = [
    ["Google Chrome.app", "Google Chrome"],
    ["Microsoft Edge.app", "Microsoft Edge"],
    ["Brave Browser.app", "Brave Browser"],
    ["Chromium.app", "Chromium"],
    ["Google Chrome Canary.app", "Google Chrome Canary"],
  ];
  return apps.flatMap((root) =>
    names.map(([app, bin]) => join(root, app, "Contents", "MacOS", bin)),
  );
}

function linuxInstallBins(): string[] {
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/opt/google/chrome/chrome",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/opt/microsoft/msedge/msedge",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/usr/bin/brave-browser",
    "/snap/bin/brave",
    "/snap/bin/google-chrome",
  ];
}

function pathBasenames(platform: NodeJS.Platform): string[] {
  if (platform === "win32") return ["chrome.exe", "msedge.exe", "brave.exe", "chromium.exe"];
  if (platform === "darwin") return ["google-chrome", "chromium", "microsoft-edge", "brave"];
  return [
    "google-chrome",
    "google-chrome-stable",
    "microsoft-edge",
    "microsoft-edge-stable",
    "chromium",
    "chromium-browser",
    "brave-browser",
    "chrome",
  ];
}

function pathBins(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  join: (...parts: string[]) => string,
): string[] {
  const dirs = pathDirs(platform, env);
  return dirs.flatMap((dir) => pathBasenames(platform).map((name) => join(dir, name)));
}

function playwrightCacheRoots(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
  join: (...parts: string[]) => string,
): string[] {
  const override = env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  if (override && override !== "0") return [override];
  if (platform === "win32") {
    const local = env.LOCALAPPDATA?.trim() || join(home, "AppData", "Local");
    return [join(local, "ms-playwright")];
  }
  if (platform === "darwin") return [join(home, "Library", "Caches", "ms-playwright")];
  return [join(home, ".cache", "ms-playwright"), "/ms-playwright"];
}

function playwrightChromeBins(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
  join: (...parts: string[]) => string,
  readdir: (dir: string) => string[],
): string[] {
  const bins: string[] = [];
  for (const root of playwrightCacheRoots(platform, env, home, join)) {
    const names = listDir(root, readdir)
      .filter((name) => name.startsWith("chromium-") && !name.includes("headless"))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const name of names) {
      const dir = join(root, name);
      if (platform === "win32") {
        bins.push(join(dir, "chrome-win", "chrome.exe"));
      } else if (platform === "darwin") {
        bins.push(join(dir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"));
        bins.push(join(dir, "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"));
      } else {
        bins.push(join(dir, "chrome-linux", "chrome"));
        bins.push(join(dir, "chrome-linux64", "chrome"));
      }
    }
  }
  return bins;
}

function wellKnownBins(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
  join: (...parts: string[]) => string,
): string[] {
  if (platform === "win32") return windowsInstallBins(join, env, home);
  if (platform === "darwin") return darwinInstallBins(join, home);
  return linuxInstallBins();
}

/** Absolute browser binaries to try. `LOCUS_CHROME` is exclusive when set. */
export function hostChromeCandidates(opts: HostChromeLookup = {}): string[] {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const join = pathApi(platform).join;
  const home = homeDir(env, opts.home);
  const readdir = opts.readdir ?? ((dir) => readdirSync(dir));
  const override = env.LOCUS_CHROME?.trim();
  if (override) return [override];
  return unique([
    ...envBins(env),
    ...wellKnownBins(platform, env, home, join),
    ...pathBins(platform, env, join),
    ...playwrightChromeBins(platform, env, home, join, readdir),
  ]);
}

export function resolveHostChromeBin(opts: HostChromeLookup = {}): string | undefined {
  const exists = opts.exists ?? existsSync;
  for (const candidate of hostChromeCandidates(opts)) {
    if (exists(candidate)) return candidate;
  }
  return undefined;
}

function waitDevtoolsUrl(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Host Chrome did not start DevTools")), 8_000);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const match = text.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        child.stderr.off("data", onData);
        child.stdout.off("data", onData);
        resolve(match[1]!);
      }
    };
    child.stderr.on("data", onData);
    child.stdout.on("data", onData);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Host Chrome exited (${code ?? "unknown"})`));
    });
  });
}

export async function launchHostChrome(profileDir: string): Promise<HostChromeHandle> {
  const bin = resolveHostChromeBin();
  if (!bin) throw new Error(PLAYWRIGHT_CHROME_MISSING);
  mkdirSync(profileDir, { recursive: true });
  const child = spawn(
    bin,
    [
      `--user-data-dir=${profileDir}`,
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--window-size=1280,800",
      "about:blank",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  ) as ChildProcessWithoutNullStreams;
  const url = await waitDevtoolsUrl(child);
  const parsed = new URL(url);
  return {
    endpoint: { host: "127.0.0.1", port: Number(parsed.port) },
    close: () => {
      child.kill();
    },
  };
}
