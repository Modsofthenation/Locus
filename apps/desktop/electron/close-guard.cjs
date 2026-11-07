const CHANNELS = {
  setGuard: "locus:set-close-guard",
  closeRequested: "locus:close-requested",
  closeAck: "locus:close-ack",
  confirmClose: "locus:confirm-close",
};

const PROMPT_TIMEOUT_MS = 2000;

function windowCanPrompt(win) {
  if (!win || typeof win.isDestroyed !== "function" || win.isDestroyed()) return false;
  const contents = win.webContents;
  if (!contents || typeof contents.isDestroyed !== "function" || contents.isDestroyed()) {
    return false;
  }
  return true;
}

function senderIsWindow(event, getWindow) {
  const win = getWindow();
  if (!windowCanPrompt(win) || !event) return false;
  return event.sender === win.webContents;
}

function installCloseGuard({ app, ipcMain, getWindow, promptTimeoutMs = PROMPT_TIMEOUT_MS }) {
  let allowClose = false;
  let armed = false;
  let promptTimer = null;

  function clearPromptTimer() {
    if (!promptTimer) return;
    clearTimeout(promptTimer);
    promptTimer = null;
  }

  ipcMain.on(CHANNELS.setGuard, (event, value) => {
    if (!senderIsWindow(event, getWindow)) return;
    armed = Boolean(value);
  });

  ipcMain.on(CHANNELS.closeAck, (event) => {
    if (!senderIsWindow(event, getWindow)) return;
    clearPromptTimer();
  });

  ipcMain.on(CHANNELS.confirmClose, (event) => {
    if (!senderIsWindow(event, getWindow)) return;
    clearPromptTimer();
    allowClose = true;
    app.quit();
  });

  function onCloseAttempt(event) {
    if (allowClose || !armed) return false;
    const win = getWindow();
    if (!windowCanPrompt(win)) return false;
    event.preventDefault();
    win.webContents.send(CHANNELS.closeRequested);
    if (!promptTimer) {
      promptTimer = setTimeout(() => {
        promptTimer = null;
        allowClose = true;
        app.quit();
      }, promptTimeoutMs);
    }
    return true;
  }

  return {
    onCloseAttempt,
    isArmed: () => armed,
    isAllowed: () => allowClose,
  };
}

module.exports = {
  CHANNELS,
  PROMPT_TIMEOUT_MS,
  installCloseGuard,
  windowCanPrompt,
  senderIsWindow,
};
