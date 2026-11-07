const { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");

function locusHome(home) {
  return home || process.env.LOCUS_HOME || join(homedir(), ".locus");
}

function desktopUiCacheDir(home) {
  return join(locusHome(home), "desktop-ui");
}

function packagedUiDir(resourcesPath, home) {
  const cache = desktopUiCacheDir(home);
  if (existsSync(join(cache, "index.html"))) return cache;
  return join(resourcesPath, "ui");
}

/** Copy the AppImage/asar UI onto a real disk path so keep-alive servers survive FUSE unmount. */
function syncPackagedUi(opts = {}) {
  const resourcesPath = opts.resourcesPath;
  const version = opts.version == null ? "" : String(opts.version);
  const bundled = join(resourcesPath, "ui");
  const cache = desktopUiCacheDir(opts.home);
  const bundledIndex = join(bundled, "index.html");
  const cacheIndex = join(cache, "index.html");
  if (!existsSync(bundledIndex)) return existsSync(cacheIndex) ? cache : bundled;
  const stamp = join(cache, ".version");
  let stamped = "";
  try {
    stamped = readFileSync(stamp, "utf8").trim();
  } catch {
    stamped = "";
  }
  if (existsSync(cacheIndex) && stamped === version) return cache;
  const tmp = `${cache}.next`;
  rmSync(tmp, { recursive: true, force: true });
  cpSync(bundled, tmp, { recursive: true });
  writeFileSync(join(tmp, ".version"), version);
  rmSync(cache, { recursive: true, force: true });
  renameSync(tmp, cache);
  return cache;
}

/** On Windows, inherited stdin shares the console input handle with the GUI and
 *  keystrokes never reach BrowserWindow. Keep stdout/stderr for server logs. */
function spawnIo(platform) {
  if (platform === "win32") {
    return { stdio: ["ignore", "inherit", "inherit"], windowsHide: true };
  }
  return { stdio: "inherit", windowsHide: false };
}

function resolveLaunch(opts) {
  const {
    packaged,
    dev,
    resourcesPath,
    execPath,
    uiDist,
    repoRoot,
    platform = process.platform,
  } = opts;
  if (dev) return null;
  const io = spawnIo(platform);
  if (packaged) {
    return {
      command: execPath,
      args: [join(resourcesPath, "server", "index.mjs")],
      cwd: resourcesPath,
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        LOCUS_UI: packagedUiDir(resourcesPath, opts.home),
        LOCUS_IMAGES: join(resourcesPath, "images", "agent"),
      },
      detached: platform !== "win32",
      shell: false,
      ...io,
    };
  }
  if (platform === "win32") {
    return {
      command: opts.comSpec || "cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd run start --workspace=@locus/server"],
      cwd: repoRoot,
      env: { LOCUS_UI: uiDist },
      detached: false,
      shell: false,
      windowsVerbatimArguments: true,
      ...io,
    };
  }
  return {
    command: "npm",
    args: ["run", "start", "--workspace=@locus/server"],
    cwd: repoRoot,
    env: { LOCUS_UI: uiDist },
    detached: true,
    shell: false,
    ...io,
  };
}

module.exports = {
  desktopUiCacheDir,
  packagedUiDir,
  resolveLaunch,
  spawnIo,
  syncPackagedUi,
};
