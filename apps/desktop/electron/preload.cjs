const { contextBridge, ipcRenderer } = require("electron");

// Keep these channel names in sync with electron/close-guard.cjs.
// Sandboxed preloads cannot require sibling files.
const SET_GUARD = "locus:set-close-guard";
const CLOSE_REQUESTED = "locus:close-requested";
const CLOSE_ACK = "locus:close-ack";
const CONFIRM_CLOSE = "locus:confirm-close";

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
});
