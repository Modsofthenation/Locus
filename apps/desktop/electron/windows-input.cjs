/** Windows Electron: Alt and the hidden native menu bar steal keystrokes from
 *  every renderer input (chat, editor, search). Drop the application menu
 *  before creating the window. Electron 43's hookWindowMessage is notify-only
 *  and cannot prevent WM_SYSCOMMAND. Swallow bare Alt in before-input-event
 *  so mnemonic mode cannot arm without a menu. */

function dropWindowsApplicationMenu(Menu, platform = process.platform) {
  if (platform !== "win32" || !Menu || typeof Menu.setApplicationMenu !== "function") {
    return false;
  }
  Menu.setApplicationMenu(null);
  return true;
}

function swallowBareAlt(input) {
  if (!input) return false;
  const key = input.key ?? "";
  const code = input.code ?? "";
  if (key !== "Alt" && code !== "AltLeft" && code !== "AltRight") return false;
  if (input.control || input.meta || input.shift) return false;
  return input.type === "keyDown" || input.type === "keyUp";
}

function installWindowsInputGuard(win, opts = {}) {
  const platform = opts.platform ?? process.platform;
  if (platform !== "win32" || !win) return false;
  if (typeof win.setMenu === "function") win.setMenu(null);
  if (typeof win.setAutoHideMenuBar === "function") win.setAutoHideMenuBar(false);
  if (typeof win.setMenuBarVisibility === "function") win.setMenuBarVisibility(false);
  const contents = win.webContents;
  if (contents && typeof contents.on === "function") {
    contents.on("before-input-event", (event, input) => {
      if (swallowBareAlt(input) && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
    });
  }
  if (typeof win.on === "function") {
    win.on("focus", () => {
      if (!contents || (typeof contents.isDestroyed === "function" && contents.isDestroyed())) {
        return;
      }
      if (typeof contents.focus === "function") contents.focus();
    });
  }
  return true;
}

module.exports = {
  dropWindowsApplicationMenu,
  swallowBareAlt,
  installWindowsInputGuard,
};
