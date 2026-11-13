// Ambient status while Locus is in the background: a tray icon whose menu shows
// running / needs-you counts, the dock or taskbar badge, and system notifications
// that open the right chat (or, on macOS, Approve / Deny from the notification).
// Keep channel names in sync with preload.cjs (sandboxed preloads cannot require this file).

const STATUS = "locus:ambient-status";
const NOTIFY = "locus:ambient-notify";
const ACTION = "locus:ambient-action";

function clampCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 999) : 0;
}

/** Normalise the renderer's status payload. */
function parseStatus(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  return { running: clampCount(value.running), needsYou: clampCount(value.needsYou) };
}

/** Tray tooltip plus the two summary rows at the top of its menu. */
function trayCopy(status) {
  const { running, needsYou } = parseStatus(status);
  const needs =
    needsYou === 0 ? "Nothing needs you" : `${needsYou} need${needsYou === 1 ? "s" : ""} you`;
  const run = running === 0 ? "No agents running" : `${running} running`;
  const tooltip =
    running === 0 && needsYou === 0
      ? "Locus"
      : `Locus — ${[needsYou ? needs : "", running ? run : ""].filter(Boolean).join(" · ")}`;
  return { tooltip, needs, run };
}

/** Validate a notification request from the renderer. Returns undefined to drop it. */
function parseNotify(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const title = typeof raw.title === "string" ? raw.title.slice(0, 200) : "";
  if (!title.trim()) return undefined;
  const body = typeof raw.body === "string" ? raw.body.slice(0, 400) : "";
  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId.slice(0, 200) : undefined;
  const callId = typeof raw.callId === "string" ? raw.callId.slice(0, 200) : undefined;
  return {
    title,
    body,
    sessionId,
    callId,
    approvable: Boolean(raw.approvable && sessionId && callId),
  };
}

/** Notification action buttons. Electron only renders them on macOS. */
function notificationActions(request, platform) {
  if (!request.approvable || platform !== "darwin") return [];
  return [
    { type: "button", text: "Approve" },
    { type: "button", text: "Deny" },
  ];
}

function actionForIndex(index) {
  if (index === 0) return "approve";
  if (index === 1) return "deny";
  return "open";
}

/**
 * Wire tray, badge and notifications. `electron` is the module (injected for tests);
 * `getWindow` returns the main BrowserWindow; `icon` is a path to the app icon.
 */
function installAmbient({
  electron,
  ipcMain,
  getWindow,
  icon,
  platform = process.platform,
  senderOk,
}) {
  const { app, Menu, Notification, Tray, nativeImage } = electron;
  let tray;
  let status = { running: 0, needsYou: 0 };
  // Keep live Notification objects referenced, or GC drops their click handlers.
  const live = new Set();

  function showWindow() {
    const win = getWindow();
    if (!win || win.isDestroyed()) return undefined;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return win;
  }

  function send(payload, show = true) {
    const win = show ? showWindow() : getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(ACTION, payload);
  }

  function rebuildMenu() {
    if (!tray) return;
    const copy = trayCopy(status);
    tray.setToolTip(copy.tooltip);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: copy.needs, enabled: status.needsYou > 0, click: () => send({ action: "inbox" }) },
        { label: copy.run, enabled: false },
        { type: "separator" },
        { label: "Show Locus", click: () => showWindow() },
        { label: "Quit Locus", click: () => app.quit() },
      ]),
    );
  }

  function ensureTray() {
    if (tray || !Tray) return;
    try {
      let image = nativeImage.createFromPath(icon);
      if (!image.isEmpty()) image = image.resize({ width: 16, height: 16 });
      tray = new Tray(image);
      tray.on("click", () => showWindow());
      rebuildMenu();
    } catch {
      // Some Linux desktops have no status area; the badge and notifications still work.
      tray = undefined;
    }
  }

  ipcMain.on(STATUS, (event, raw) => {
    if (senderOk && !senderOk(event)) return;
    status = parseStatus(raw);
    ensureTray();
    rebuildMenu();
    try {
      if (typeof app.setBadgeCount === "function") app.setBadgeCount(status.needsYou);
    } catch {
      /* badge unsupported on this desktop */
    }
  });

  ipcMain.on(NOTIFY, (event, raw) => {
    if (senderOk && !senderOk(event)) return;
    const request = parseNotify(raw);
    if (!request || !Notification || !Notification.isSupported()) return;
    const note = new Notification({
      title: request.title,
      body: request.body,
      actions: notificationActions(request, platform),
    });
    live.add(note);
    const forget = () => live.delete(note);
    const target = { sessionId: request.sessionId, callId: request.callId };
    note.on("click", () => {
      forget();
      send({ action: "open", ...target });
    });
    note.on("action", (_event, index) => {
      forget();
      const action = actionForIndex(index);
      // Approve / Deny resolve in the background; only "open" brings the window up.
      send({ action, ...target }, action === "open");
    });
    note.on("close", forget);
    note.show();
  });

  return {
    destroy() {
      tray?.destroy();
      tray = undefined;
    },
  };
}

module.exports = {
  ACTION,
  NOTIFY,
  STATUS,
  actionForIndex,
  installAmbient,
  notificationActions,
  parseNotify,
  parseStatus,
  trayCopy,
};
