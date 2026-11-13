const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  safeStorage,
  session,
} = require("electron");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { join } = require("node:path");
const { installAmbient } = require("./ambient.cjs");
const { installCloseGuard, senderIsWindow } = require("./close-guard.cjs");
const {
  controlPlaneKeepAlive,
  desktopServerRecordPath,
  detachChild,
  forgetDesktopServer,
  pidAlive,
  probeControlPlane,
  processHasOwner,
  readDesktopServer,
  rememberDesktopServer,
  serverQuitAction,
  stopAdoptedProcess,
} = require("./keep-alive.cjs");
const {
  controlPlaneNeedsRespawn,
  controlPlaneStartAction,
  restartDelayMs,
} = require("./control-plane.cjs");
const { desktopCliInvocation } = require("./cli-argv.cjs");
const { resolveLaunch, syncPackagedUi, uiBuildStamp } = require("./launch.cjs");
const { loadUrlWithRetry, waitForUrl, waitUntilUrlDown } = require("./net-wait.cjs");
const { locusHome, wrapMasterKey } = require("./vault-key.cjs");
const { planUpdateInstall, swapAppImage } = require("./update-install.cjs");
const { dropWindowsApplicationMenu, installWindowsInputGuard } = require("./windows-input.cjs");
const { applyZoomLevel, zoomAction } = require("./zoom.cjs");

const CANVAS_PREVIEW_HOST = "locus-canvas.localhost";
const CONTROL_PLANE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' ws://127.0.0.1:* ws://localhost:* ws://[::1]:* wss://127.0.0.1:* wss://localhost:* wss://[::1]:*; frame-src 'self' blob: http://127.0.0.1:* http://localhost:* http://[::1]:* http://locus-canvas.localhost:*; media-src 'self' blob:; worker-src 'self' blob:; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'self'";

function isControlPlaneNavigation(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    return (
      host === "127.0.0.1" || host === "localhost" || host === "::1" || host === CANVAS_PREVIEW_HOST
    );
  } catch {
    return false;
  }
}

const dev = process.argv.includes("--dev");
const uiUrl = process.env.LOCUS_UI_URL ?? (dev ? "http://127.0.0.1:5173" : "http://127.0.0.1:7420");
const appIcon = join(__dirname, "..", "buildResources", "icon.png");
const desktopCli = desktopCliInvocation(process.argv, { packaged: app.isPackaged });
if (desktopCli) {
  process.stdout.write(`${desktopCli.message}\n`);
  process.exit(0);
}

// Windows taskbar / jump lists use this id; keep it aligned with package.json build.appId.
if (process.platform === "win32") {
  app.setAppUserModelId("dev.locus.desktop");
}

// Must run before app ready. OS DNS often cannot resolve *.localhost, which
// left HTTP canvases as a blank iframe.
app.commandLine.appendSwitch("host-resolver-rules", `MAP ${CANVAS_PREVIEW_HOST} 127.0.0.1`);

function isCanvasPreviewUrl(url) {
  try {
    return new URL(url).hostname === CANVAS_PREVIEW_HOST;
  } catch {
    return false;
  }
}

let child;
let ownsServer = false;
let adoptedPid;
let adoptedOwner;
/** Version + UI fingerprint of this install; unset in --dev (Vite serves the UI). */
let desktopBuild;
let quitPhase = "idle";
let mainWindow;
let restartTimer;
let restartAttempt = 0;
let healthTimer;
let healthFails = 0;
const desktopOwner = randomUUID();
const HEALTH_URL = "http://127.0.0.1:7420/api/health";
const KEEP_ALIVE_URL = "http://127.0.0.1:7420/api/projects/keep-alive";
const closeGuard = installCloseGuard({
  app,
  ipcMain,
  getWindow: () => mainWindow,
});
installAmbient({
  electron: require("electron"),
  ipcMain,
  getWindow: () => mainWindow,
  icon: appIcon,
  senderOk: (event) => senderIsWindow(event, () => mainWindow),
});
/** Set by restart-for-update / restart-after-restore: stop the plane even with Keep running. */
let forceStopServer = false;

function restartApp(opts = {}) {
  forceStopServer = true;
  app.relaunch(opts.execPath ? { execPath: opts.execPath } : undefined);
  app.quit();
}

ipcMain.handle("locus:restart-app", (event) => {
  if (!senderIsWindow(event, () => mainWindow)) return { ok: false };
  restartApp();
  return { ok: true };
});

ipcMain.handle("locus:install-update", async (event, file) => {
  if (!senderIsWindow(event, () => mainWindow)) return { ok: false, error: "Not allowed" };
  const plan = planUpdateInstall({
    file,
    updatesDir: join(locusHome(), "updates"),
    platform: process.platform,
    appImage: process.env.APPIMAGE,
  });
  try {
    if (plan.kind === "reject") return { ok: false, error: plan.reason };
    if (plan.kind === "appimage") {
      swapAppImage(plan.source, plan.target);
      restartApp({ execPath: plan.target });
      return { ok: true, action: "relaunching" };
    }
    if (plan.kind === "windows") {
      spawn(plan.source, [], { detached: true, stdio: "ignore", windowsHide: false }).unref();
      forceStopServer = true;
      app.quit();
      return { ok: true, action: "installer" };
    }
    const error = await shell.openPath(plan.source);
    return error ? { ok: false, error } : { ok: true, action: "opened" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

async function ensureServer() {
  const recordPath = desktopServerRecordPath();
  const up = await probeControlPlane(fetch, HEALTH_URL, 400);
  const uiUp = up ? await probeControlPlane(fetch, uiUrl, 400) : false;
  const record = await readDesktopServer(recordPath);
  const owned = Boolean(record && processHasOwner(record.pid, record.owner));
  // A kept-alive plane from an older build would keep serving its old server
  // code (and, packaged, the old UI); restart it when the build changed.
  const stale = Boolean(desktopBuild && record && record.build !== desktopBuild);
  const action = controlPlaneStartAction({ healthUp: up, uiUp, owned, stale });
  if (action === "adopt") {
    if (owned) {
      adoptedPid = record.pid;
      adoptedOwner = record.owner;
    }
    return;
  }
  if (action === "restart") {
    stopAdoptedProcess(record.pid);
    await forgetDesktopServer(recordPath);
    await waitUntilUrlDown(HEALTH_URL);
  } else if (action === "leave") {
    return;
  } else if (record) {
    await forgetDesktopServer(recordPath);
  }
  await startServer();
  if (child) ownsServer = true;
}

function watchChild(proc) {
  if (!proc) return;
  proc.on("exit", (code, signal) => {
    if (child !== proc) return;
    child = undefined;
    ownsServer = false;
    console.error(`Locus control plane exited (${code ?? signal ?? "unknown"})`);
    if (quitPhase !== "idle") return;
    scheduleRestart();
  });
  proc.on("error", (err) => {
    console.error("Locus control plane spawn failed:", err);
    if (child === proc) {
      child = undefined;
      ownsServer = false;
    }
    if (quitPhase !== "idle") return;
    scheduleRestart();
  });
}

function scheduleRestart() {
  if (quitPhase !== "idle" || restartTimer) return;
  const delay = restartDelayMs(restartAttempt);
  restartAttempt += 1;
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    void reviveServer();
  }, delay);
}

async function reviveServer() {
  if (quitPhase !== "idle") return;
  const up = await probeControlPlane(fetch, HEALTH_URL, 400);
  if (up) {
    restartAttempt = 0;
    healthFails = 0;
    return;
  }
  dropDeadHandles();
  await startServer();
  if (child) ownsServer = true;
}

function dropDeadHandles() {
  if (child) {
    stopServer();
    child = undefined;
    ownsServer = false;
  }
  if (adoptedPid) {
    if (adoptedOwner && processHasOwner(adoptedPid, adoptedOwner)) {
      stopAdoptedProcess(adoptedPid);
    }
    adoptedPid = undefined;
    adoptedOwner = undefined;
  }
}

function processStillAlive() {
  if (child?.pid && pidAlive(child.pid)) return true;
  if (adoptedPid && pidAlive(adoptedPid)) return true;
  return false;
}

function startHealthWatch() {
  if (healthTimer) return;
  healthTimer = setInterval(() => {
    if (quitPhase !== "idle") return;
    void checkControlPlane();
  }, 4_000);
  healthTimer.unref?.();
}

async function checkControlPlane() {
  if (quitPhase !== "idle") return;
  const up = await probeControlPlane(fetch, HEALTH_URL, 1_500);
  if (up) {
    healthFails = 0;
    restartAttempt = 0;
    return;
  }
  healthFails += 1;
  if (
    !controlPlaneNeedsRespawn({
      quitting: quitPhase !== "idle",
      healthUp: false,
      processAlive: processStillAlive(),
      failCount: healthFails,
    })
  ) {
    return;
  }
  healthFails = 0;
  dropDeadHandles();
  scheduleRestart();
}

async function startServer() {
  const launch = resolveLaunch({
    packaged: app.isPackaged,
    dev,
    resourcesPath: process.resourcesPath,
    execPath: process.execPath,
    uiDist: join(__dirname, "..", "dist"),
    repoRoot: join(__dirname, "..", "..", ".."),
  });
  if (!launch) return;
  const vaultEnv = await wrapMasterKey(safeStorage, { unlinkPlaintext: app.isPackaged });
  // Quit may have started, or another start won, while the key was unwrapped.
  if (quitPhase !== "idle" || child) return;
  child = spawn(launch.command, launch.args, {
    stdio: launch.stdio,
    env: {
      ...process.env,
      ...launch.env,
      ...vaultEnv,
      LOCUS_DESKTOP_OWNER: desktopOwner,
    },
    cwd: launch.cwd,
    shell: launch.shell,
    detached: launch.detached,
    windowsHide: launch.windowsHide,
    windowsVerbatimArguments: launch.windowsVerbatimArguments === true,
  });
  watchChild(child);
}

async function releaseServer() {
  const recordPath = desktopServerRecordPath();
  const keepAlive = forceStopServer ? false : await controlPlaneKeepAlive(fetch, KEEP_ALIVE_URL);
  const action = serverQuitAction({ ownsChild: ownsServer, keepAlive, adoptedPid });
  if (action === "detach") {
    if (child && child.pid) {
      await rememberDesktopServer(recordPath, {
        pid: child.pid,
        owner: desktopOwner,
        build: desktopBuild,
      });
    }
    detachChild(child);
    ownsServer = false;
    child = undefined;
    return;
  }
  if (action === "stop") {
    stopServer();
    await forgetDesktopServer(recordPath);
    return;
  }
  if (action === "stop-adopted") {
    if (processHasOwner(adoptedPid, adoptedOwner)) stopAdoptedProcess(adoptedPid);
    adoptedPid = undefined;
    adoptedOwner = undefined;
    await forgetDesktopServer(recordPath);
  }
}

function stopServer() {
  if (!child || child.killed) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill();
    }
  }
}

app
  .whenReady()
  .then(async () => {
    if (app.isPackaged) {
      try {
        syncPackagedUi({ resourcesPath: process.resourcesPath, version: app.getVersion() });
      } catch (err) {
        console.error("Locus UI cache copy failed:", err);
      }
    }
    if (!dev) {
      const builtUi = app.isPackaged
        ? join(process.resourcesPath, "ui")
        : join(__dirname, "..", "dist");
      desktopBuild = uiBuildStamp(app.getVersion(), builtUi);
    }
    await ensureServer();
    if (!dev) startHealthWatch();
    await waitForUrl(uiUrl);
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      if (isCanvasPreviewUrl(details.url)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      const headers = { ...details.responseHeaders };
      if (!headers["content-security-policy"] && !headers["Content-Security-Policy"]) {
        headers["Content-Security-Policy"] = [CONTROL_PLANE_CSP];
      }
      callback({ responseHeaders: headers });
    });
    dropWindowsApplicationMenu(Menu);
    const win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 640,
      backgroundColor: "#0b0d10",
      title: "Locus",
      icon: appIcon,
      autoHideMenuBar: process.platform !== "win32",
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    mainWindow = win;
    if (process.platform === "darwin" && app.dock) {
      app.dock.setIcon(appIcon);
    }
    installWindowsInputGuard(win);
    win.on("close", (event) => {
      closeGuard.onCloseAttempt(event);
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https:") || url.startsWith("http:")) {
        void shell.openExternal(url);
      }
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, url) => {
      if (!isControlPlaneNavigation(url)) event.preventDefault();
    });
    win.webContents.on("will-redirect", (event, url) => {
      if (!isControlPlaneNavigation(url)) event.preventDefault();
    });
    win.webContents.on("before-input-event", (event, input) => {
      const action = zoomAction(input);
      if (!action) return;
      event.preventDefault();
      win.webContents.setZoomLevel(applyZoomLevel(win.webContents.getZoomLevel(), action));
    });
    await loadUrlWithRetry(win, uiUrl);
  })
  .catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(err);
    try {
      dialog.showErrorBox("Locus failed to start", message);
    } catch {
      /* dialog may be unavailable during early quit */
    }
    app.quit();
  });

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", (event) => {
  if (closeGuard.onCloseAttempt(event)) return;
  if (quitPhase === "quitting") return;
  if (quitPhase === "releasing") {
    event.preventDefault();
    return;
  }
  if (!ownsServer && !adoptedPid) return;
  event.preventDefault();
  quitPhase = "releasing";
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = undefined;
  }
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = undefined;
  }
  void (async () => {
    try {
      await releaseServer();
    } finally {
      quitPhase = "quitting";
      app.quit();
    }
  })();
});
