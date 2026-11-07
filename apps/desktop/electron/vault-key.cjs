const { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");
const { randomBytes } = require("node:crypto");

function locusHome() {
  return process.env.LOCUS_HOME || join(homedir(), ".locus");
}

function wrapMasterKey(safeStorage, opts = {}) {
  if (process.env.LOCUS_MASTER_KEY?.trim())
    return { LOCUS_MASTER_KEY: process.env.LOCUS_MASTER_KEY.trim() };
  if (!safeStorage?.isEncryptionAvailable?.()) return {};
  const dir = locusHome();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const wrapped = join(dir, "master.key.safe");
  const raw = join(dir, "master.key");
  try {
    if (existsSync(wrapped)) {
      const key = safeStorage.decryptString(readFileSync(wrapped));
      unlinkPlaintextKey(raw, opts.unlinkPlaintext);
      return { LOCUS_MASTER_KEY: key };
    }
    let key;
    if (existsSync(raw)) {
      key = readFileSync(raw, "utf8").trim();
    } else {
      key = randomBytes(32).toString("hex");
      writeFileSync(raw, `${key}\n`, { encoding: "utf8", mode: 0o600 });
    }
    writeFileSync(wrapped, safeStorage.encryptString(key), { mode: 0o600 });
    unlinkPlaintextKey(raw, opts.unlinkPlaintext);
    return { LOCUS_MASTER_KEY: key };
  } catch {
    return {};
  }
}

function unlinkPlaintextKey(raw, enabled) {
  if (!enabled || !existsSync(raw)) return;
  try {
    unlinkSync(raw);
  } catch {
    /* keep going with the wrapped key */
  }
}

module.exports = { wrapMasterKey, locusHome };
