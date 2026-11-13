const { contextBridge, ipcRenderer } = require("electron");

// Keep these channel names in sync with electron/close-guard.cjs.
// Sandboxed preloads cannot require sibling files.
const SET_GUARD = "locus:set-close-guard";
const CLOSE_REQUESTED = "locus:close-requested";
const CLOSE_ACK = "locus:close-ack";
const CONFIRM_CLOSE = "locus:confirm-close";
// Keep these in sync with electron/ambient.cjs.
const AMBIENT_STATUS = "locus:ambient-status";
const AMBIENT_NOTIFY = "locus:ambient-notify";
const AMBIENT_ACTION = "locus:ambient-action";

contextBridge.exposeInMainWorld("locusDesktop", {
  setCloseGuard(armed) {
    ipcRenderer.send(SET_GUARD, Boolean(armed));
  },
  onCloseRequested(callback) {
    const listener = () => callback();
    ipcRenderer.on(CLOSE_REQUESTED, listener);
    return () => ipcRenderer.removeListener(CLOSE_REQUESTED, listener);
  },
  ackClosePrompt() {
    ipcRenderer.send(CLOSE_ACK);
  },
  confirmClose() {
    ipcRenderer.send(CONFIRM_CLOSE);
  },
  /** Install a verified update from <LOCUS_HOME>/updates (AppImage swap, NSIS, or open). */
  installUpdate(path) {
    return ipcRenderer.invoke("locus:install-update", String(path));
  },
  /** Quit and relaunch, stopping the control plane even when Keep running is on. */
  restartApp() {
    return ipcRenderer.invoke("locus:restart-app");
  },
  /** Tray menu and dock/taskbar badge: how many agents run and how many need you. */
  setAmbientStatus(status) {
    ipcRenderer.send(AMBIENT_STATUS, {
      running: Number(status?.running) || 0,
      needsYou: Number(status?.needsYou) || 0,
    });
  },
  /** System notification that opens the chat; on macOS it can Approve / Deny too. */
  notify(request) {
    ipcRenderer.send(AMBIENT_NOTIFY, {
      title: String(request?.title ?? ""),
      body: String(request?.body ?? ""),
      sessionId: request?.sessionId ? String(request.sessionId) : undefined,
      callId: request?.callId ? String(request.callId) : undefined,
      approvable: Boolean(request?.approvable),
    });
  },
  /** Clicks on the tray menu or a notification: open, inbox, approve, deny. */
  onAmbientAction(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(AMBIENT_ACTION, listener);
    return () => ipcRenderer.removeListener(AMBIENT_ACTION, listener);
  },
});
