const { chmodSync, copyFileSync, existsSync, renameSync, rmSync, statSync } = require("node:fs");
const { basename, dirname, join, relative, resolve, isAbsolute } = require("node:path");

/**
 * Decide how to install a verified update the control plane downloaded into
 * `<LOCUS_HOME>/updates/`.
 *
 * - Linux AppImage: replace the running AppImage file and relaunch.
 * - Windows NSIS: run the installer, then quit so it can replace the app.
 * - Everything else (dmg, deb, rpm, dev builds): open the file with the system handler.
 */
function planUpdateInstall({ file, updatesDir, platform, appImage }) {
  if (typeof file !== "string" || !file) return { kind: "reject", reason: "No installer path" };
  const abs = resolve(file);
  const rel = relative(resolve(updatesDir), abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    return { kind: "reject", reason: "Installer is not in the Locus updates folder" };
  }
  const name = basename(abs);
  if (platform === "linux" && appImage && /\.AppImage$/i.test(name)) {
    return { kind: "appimage", source: abs, target: resolve(appImage) };
  }
  if (platform === "win32" && /\.exe$/i.test(name)) {
    return { kind: "windows", source: abs };
  }
  return { kind: "open", source: abs };
}

/**
 * Copy the new AppImage beside the running one, then rename it over the original.
 * A rename on the same filesystem is atomic, so a crash leaves either version intact.
 */
function swapAppImage(
  source,
  target,
  fs = { chmodSync, copyFileSync, existsSync, renameSync, rmSync, statSync },
) {
  if (!fs.existsSync(source)) throw new Error("The downloaded AppImage is missing");
  const staged = join(dirname(target), `.${basename(target)}.update`);
  try {
    fs.copyFileSync(source, staged);
    fs.chmodSync(staged, 0o755);
    fs.renameSync(staged, target);
  } catch (err) {
    try {
      fs.rmSync(staged, { force: true });
    } catch {
      /* best effort */
    }
    throw err;
  }
  return target;
}

module.exports = { planUpdateInstall, swapAppImage };
