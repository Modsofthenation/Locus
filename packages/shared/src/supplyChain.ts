const INSTALL_RE =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|update|ci)\b|\bnpx\b|\bnpm\s+run\s+(?:preinstall|install|postinstall|preuninstall|postuninstall|prepare)\b|\bpip(?:3)?\s+install\b|\bpython(?:3)?\s+-m\s+pip\s+install\b|\buv\s+pip\s+install\b|\bcargo\s+install\b|\bgem\s+install\b|\bcomposer\s+require\b|\bgo\s+install\b|\b(?:apt-get|apt|apk|dnf|yum|brew)\s+(?:install|add)\b/i;

const IGNORE_SCRIPTS = /--ignore-scripts\b/;

const LIFECYCLE = new Set([
  "preinstall",
  "install",
  "postinstall",
  "preuninstall",
  "postuninstall",
  "prepare",
]);
const LIFECYCLE_KEY = /"(preinstall|install|postinstall|preuninstall|postuninstall|prepare)"\s*:/;

/** Package installs can run postinstall scripts; those wait for Approve / Deny unless scripts are skipped. */
export function riskyInstallCommand(command: string): boolean {
  const cmd = command.trim();
  if (!INSTALL_RE.test(cmd)) return false;
  if (IGNORE_SCRIPTS.test(cmd)) return false;
  return true;
}

export function installCommandsNeedApproval(commands: string[]): boolean {
  return commands.some(riskyInstallCommand);
}

export function packageJsonHasLifecycleScripts(content: string): boolean {
  try {
    const json = JSON.parse(content) as { scripts?: Record<string, unknown> };
    if (!json.scripts || typeof json.scripts !== "object" || Array.isArray(json.scripts))
      return false;
    return Object.keys(json.scripts).some((key) => LIFECYCLE.has(key));
  } catch {
    return LIFECYCLE_KEY.test(content);
  }
}

export function packageJsonLifecycleRisk(path: string, content: string): boolean {
  const leaf = path.replace(/\\/g, "/").split("/").pop() ?? "";
  if (leaf.toLowerCase() !== "package.json") return false;
  return packageJsonHasLifecycleScripts(content);
}

export function patchTouchesLifecycleScripts(patch: string): boolean {
  return patch.split(/\r?\n/).some((line) => {
    if (!line.startsWith("+") || line.startsWith("+++")) return false;
    return LIFECYCLE_KEY.test(line);
  });
}
