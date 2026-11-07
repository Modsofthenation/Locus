const DESKTOP_CLI_MESSAGE =
  "Locus desktop is the GUI, not a CLI. --help, --version, and subcommands do not apply to this binary and would open another app window. Use the HTTP API on http://127.0.0.1:7420, or the package CLI (`npm run locus`).";

function isElectronHelperProcess(argv) {
  return (argv || []).some((arg) => String(arg).startsWith("--type="));
}

/** User-facing args after Electron's executable / app path and desktop-only flags. */
function desktopUserArgs(argv, opts = {}) {
  const packaged = opts.packaged === true;
  const list = Array.isArray(argv) ? argv.map(String) : [];
  const start = packaged ? 1 : Math.min(2, list.length);
  return list.slice(start).filter((arg) => arg !== "--dev" && !arg.startsWith("--type="));
}

/**
 * Packaged `locus --help` / `locus secrets` is the Electron GUI (same
 * executableName as the CLI). Chromium helper processes and `electron . --dev`
 * must still boot the window.
 */
function desktopCliInvocation(argv, opts = {}) {
  if (isElectronHelperProcess(argv)) return null;
  const user = desktopUserArgs(argv, opts);
  if (!user.length) return null;
  if (user.some((arg) => arg === "--help" || arg === "-h")) {
    return { kind: "help", message: DESKTOP_CLI_MESSAGE };
  }
  if (user.some((arg) => arg === "--version" || arg === "-v")) {
    return { kind: "version", message: DESKTOP_CLI_MESSAGE };
  }
  if (user.some((arg) => !arg.startsWith("-"))) {
    return { kind: "command", message: DESKTOP_CLI_MESSAGE };
  }
  return null;
}

module.exports = {
  DESKTOP_CLI_MESSAGE,
  isElectronHelperProcess,
  desktopUserArgs,
  desktopCliInvocation,
};
