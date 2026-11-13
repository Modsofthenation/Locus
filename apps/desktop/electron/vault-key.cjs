const { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");
const { randomBytes } = require("node:crypto");

function locusHome() {
  return process.env.LOCUS_HOME || join(homedir(), ".locus");
}

async function wrapMasterKey(safeStorage, opts = {}) {
  if (process.env.LOCUS_MASTER_KEY?.trim())
    return { LOCUS_MASTER_KEY: process.env.LOCUS_MASTER_KEY.trim() };
  if (!(await encryptionAvailable(safeStorage))) return {};
  const dir = locusHome();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const wrapped = join(dir, "master.key.safe");
  const raw = join(dir, "master.key");
  try {
    if (existsSync(wrapped)) {
      const { key, shouldReEncrypt } = await decrypt(safeStorage, readFileSync(wrapped));
      if (shouldReEncrypt) await writeWrapped(safeStorage, wrapped, key);
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
    await writeWrapped(safeStorage, wrapped, key);
    unlinkPlaintextKey(raw, opts.unlinkPlaintext);
    return { LOCUS_MASTER_KEY: key };
  } catch {
    return {};
  }
}

// Electron deprecated the synchronous safeStorage calls; use the async API.
async function encryptionAvailable(safeStorage) {
  try {
    return (await safeStorage?.isAsyncEncryptionAvailable?.()) === true;
  } catch {
    return false;
  }
}

async function decrypt(safeStorage, encrypted) {
  const out = await safeStorage.decryptStringAsync(encrypted);
  if (typeof out === "string") return { key: out, shouldReEncrypt: false };
  return { key: out.result, shouldReEncrypt: out.shouldReEncrypt === true };
}

async function writeWrapped(safeStorage, wrapped, key) {
  const encrypted = await safeStorage.encryptStringAsync(key);
  writeFileSync(wrapped, encrypted, { mode: 0o600 });
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
