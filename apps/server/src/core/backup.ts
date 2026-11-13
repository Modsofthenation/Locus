/**
 * Back up and restore the Locus data directory (`~/.locus`).
 *
 * A backup is one passphrase-encrypted file:
 *
 *   LOCUSBAK1\n
 *   {"format":1,"kdf":"scrypt",...}\n      (header: salt, iv, scrypt cost)
 *   AES-256-GCM( gzip( records ) )
 *   16-byte GCM tag
 *
 * Each record is a 4-byte big-endian header length, a JSON header, then `size` bytes.
 * The vault is not copied as `secrets.enc` (that file is bound to this machine's master
 * key or OS keychain). Its decrypted contents travel as a `vault` record inside the
 * encrypted archive and are re-encrypted with the target machine's key on restore.
 *
 * Restore never edits live state. It extracts into `.restore-staging`, re-encrypts the
 * vault, rewrites old data-dir paths, then writes `restore-pending.json`. The next control
 * plane start calls `applyPendingRestore` before anything loads: the current files move
 * to `.before-restore-<stamp>/` and the staged tree takes their place.
 */
import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from "node:crypto";
import {
  closeSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
  openSync,
  symlinkSync,
  writeSync,
} from "node:fs";
import {
  appendFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import {
  emptySecrets,
  loadOrCreateMasterKey,
  readVaultFile,
  writeVaultFile,
  type SecretBundle,
} from "./vault.js";

export const BACKUP_MAGIC = "LOCUSBAK1\n";
export const BACKUP_EXTENSION = ".locusbak";
export const RESTORE_STAGING_DIR = ".restore-staging";
export const RESTORE_MARKER = "restore-pending.json";
export const RESTORE_FAILED_MARKER = "restore-failed.json";
const BEFORE_RESTORE_PREFIX = ".before-restore-";
const MIN_PASSPHRASE = 8;
const TAG_BYTES = 16;
const SCRYPT = { N: 1 << 15, r: 8, p: 1 };

/** Never in a backup: machine-bound keys, restore bookkeeping, caches and downloads. */
const ALWAYS_EXCLUDED = new Set([
  "master.key",
  "master.key.safe",
  "master.salt",
  "secrets.enc",
  RESTORE_STAGING_DIR,
  RESTORE_MARKER,
  RESTORE_FAILED_MARKER,
  "updates",
  "logs",
  "indexes",
  "host-chrome",
  "worker-mirrors",
]);
/** Large VM files. Opt in with `includeDisks`. */
const DISK_DIRS = ["disks", "images", "media", "vm-trees"];
/** Dependency folders anywhere in the tree. They are rebuilt by `npm install` / `pip`. */
const NESTED_EXCLUDED = new Set(["node_modules", ".venv"]);
/**
 * Kept in place on restore. Keys stay bound to this machine; the browser profile and
 * downloads are local. Disk folders are kept only when the backup did not include them.
 */
const KEEP_ON_RESTORE = new Set([
  "master.key",
  "master.key.safe",
  "master.salt",
  "host-chrome",
  "updates",
  RESTORE_STAGING_DIR,
  RESTORE_MARKER,
  RESTORE_FAILED_MARKER,
]);

export interface BackupManifest {
  format: 1;
  appVersion?: string;
  createdAt: string;
  platform: string;
  /** Absolute data directory on the machine that made the backup. */
  dataDir: string;
  includeDisks: boolean;
  files: number;
  bytes: number;
  /** Paths that could not be read (permissions, vanished mid-backup). */
  skipped: string[];
}

export interface BackupResult {
  path: string;
  manifest: BackupManifest;
  sizeBytes: number;
}

export interface RestoreStageResult {
  manifest: BackupManifest;
  files: number;
  restartRequired: true;
}

export interface RestoreApplyResult {
  applied: boolean;
  movedAsideTo?: string;
  error?: string;
}

interface Header {
  format: 1;
  kdf: "scrypt";
  salt: string;
  iv: string;
  N: number;
  r: number;
  p: number;
}

type RecordHeader =
  | { type: "manifest"; size: number }
  | { type: "vault"; size: number }
  | { type: "dir"; path: string; mode?: number; size: 0 }
  | { type: "file"; path: string; mode?: number; size: number }
  | { type: "symlink"; path: string; target: string; size: 0 };

export function assertPassphrase(passphrase: unknown): string {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE) {
    throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
  }
  return passphrase;
}

function deriveKey(passphrase: string, salt: Buffer, cost = SCRYPT): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    scryptCb(
      passphrase,
      salt,
      32,
      { N: cost.N, r: cost.r, p: cost.p, maxmem: 128 * cost.N * cost.r * 2 },
      (err, key) => (err ? reject(err) : resolvePromise(key)),
    );
  });
}

export function defaultBackupPath(now = new Date(), home = homedir()): string {
  const stamp = now.toISOString().replace(/[:]/g, "").replace(/\..+$/, "").replace("T", "-");
  return join(home, `locus-backup-${stamp}${BACKUP_EXTENSION}`);
}

/** True when a top-level entry of the data dir belongs in a backup. */
export function includeTopLevel(name: string, includeDisks: boolean): boolean {
  if (ALWAYS_EXCLUDED.has(name)) return false;
  if (name.startsWith(BEFORE_RESTORE_PREFIX)) return false;
  if (!includeDisks && DISK_DIRS.includes(name)) return false;
  return true;
}

interface WalkEntry {
  rel: string;
  abs: string;
  kind: "dir" | "file" | "symlink";
  size: number;
  mode: number;
}

async function walk(
  root: string,
  includeDisks: boolean,
  skipped: string[],
  outPath: string,
): Promise<WalkEntry[]> {
  const out: WalkEntry[] = [];
  const outAbs = resolve(outPath);
  async function visit(abs: string, rel: string, depth: number): Promise<void> {
    let names: string[];
    try {
      names = await readdir(abs);
    } catch {
      skipped.push(rel || ".");
      return;
    }
    names.sort();
    for (const name of names) {
      if (depth === 0 && !includeTopLevel(name, includeDisks)) continue;
      if (NESTED_EXCLUDED.has(name)) continue;
      const childAbs = join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      if (resolve(childAbs) === outAbs) continue;
      let info;
      try {
        info = await lstat(childAbs);
      } catch {
        skipped.push(childRel);
        continue;
      }
      if (info.isSymbolicLink()) {
        out.push({ rel: childRel, abs: childAbs, kind: "symlink", size: 0, mode: info.mode });
      } else if (info.isDirectory()) {
        out.push({ rel: childRel, abs: childAbs, kind: "dir", size: 0, mode: info.mode });
        await visit(childAbs, childRel, depth + 1);
      } else if (info.isFile()) {
        out.push({ rel: childRel, abs: childAbs, kind: "file", size: info.size, mode: info.mode });
      }
      // Sockets, FIFOs and devices are skipped silently.
    }
  }
  await visit(root, "", 0);
  return out;
}

function recordBytes(header: RecordHeader): Buffer {
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(json.length, 0);
  return Buffer.concat([len, json]);
}

async function* streamFileExactly(abs: string, size: number): AsyncGenerator<Buffer> {
  let sent = 0;
  if (size > 0) {
    const stream = createReadStream(abs, { start: 0, end: size - 1 });
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      const room = size - sent;
      const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
      sent += piece.length;
      yield piece;
      if (sent >= size) break;
    }
  }
  // The file shrank while we read it: pad so the record stays well formed.
  while (sent < size) {
    const pad = Buffer.alloc(Math.min(64 * 1024, size - sent));
    sent += pad.length;
    yield pad;
  }
}

/** Write an encrypted backup of `dataDir` to `outPath`. */
export async function createBackup(opts: {
  dataDir: string;
  passphrase: string;
  outPath?: string;
  includeDisks?: boolean;
  appVersion?: string;
  now?: Date;
}): Promise<BackupResult> {
  const passphrase = assertPassphrase(opts.passphrase);
  const dataDir = resolve(opts.dataDir);
  const includeDisks = Boolean(opts.includeDisks);
  const outPath = resolve(opts.outPath?.trim() || defaultBackupPath(opts.now));
  if (!outPath.endsWith(BACKUP_EXTENSION)) {
    throw new Error(`Backup file names end in ${BACKUP_EXTENSION}.`);
  }
  const key = await loadOrCreateMasterKey(dataDir);
  const secrets = (await readVaultFile(dataDir, key)) ?? emptySecrets();
  const skipped: string[] = [];
  const entries = await walk(dataDir, includeDisks, skipped, outPath);
  const files = entries.filter((e) => e.kind === "file");
  const manifest: BackupManifest = {
    format: 1,
    appVersion: opts.appVersion,
    createdAt: (opts.now ?? new Date()).toISOString(),
    platform: process.platform,
    dataDir,
    includeDisks,
    files: files.length,
    bytes: files.reduce((sum, e) => sum + e.size, 0),
    skipped,
  };

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const header: Header = {
    format: 1,
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ...SCRYPT,
  };
  const cipher = createCipheriv("aes-256-gcm", await deriveKey(passphrase, salt), iv);

  async function* records(): AsyncGenerator<Buffer> {
    const manifestBytes = Buffer.from(JSON.stringify(manifest), "utf8");
    yield recordBytes({ type: "manifest", size: manifestBytes.length });
    yield manifestBytes;
    const vaultBytes = Buffer.from(JSON.stringify(secrets), "utf8");
    yield recordBytes({ type: "vault", size: vaultBytes.length });
    yield vaultBytes;
    for (const entry of entries) {
      if (entry.kind === "dir") {
        yield recordBytes({ type: "dir", path: entry.rel, mode: entry.mode & 0o777, size: 0 });
      } else if (entry.kind === "symlink") {
        let target: string;
        try {
          target = await readlink(entry.abs);
        } catch {
          skipped.push(entry.rel);
          continue;
        }
        yield recordBytes({ type: "symlink", path: entry.rel, target, size: 0 });
      } else {
        // Fail early on unreadable files so the record count stays honest.
        try {
          const handle = await open(entry.abs, "r");
          await handle.close();
        } catch {
          skipped.push(entry.rel);
          continue;
        }
        yield recordBytes({
          type: "file",
          path: entry.rel,
          mode: entry.mode & 0o777,
          size: entry.size,
        });
        yield* streamFileExactly(entry.abs, entry.size);
      }
    }
  }

  await mkdir(dirname(outPath), { recursive: true });
  const tmpPath = `${outPath}.partial`;
  await writeFile(tmpPath, `${BACKUP_MAGIC}${JSON.stringify(header)}\n`, { mode: 0o600 });
  try {
    await pipeline(
      Readable.from(records()),
      createGzip({ level: 6 }),
      cipher,
      createWriteStream(tmpPath, { flags: "a", mode: 0o600 }),
    );
    await appendFile(tmpPath, cipher.getAuthTag());
    await rename(tmpPath, outPath);
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw err;
  }
  const sizeBytes = (await stat(outPath)).size;
  return { path: outPath, manifest, sizeBytes };
}

async function readHeader(path: string): Promise<{ header: Header; offset: number; size: number }> {
  const size = (await stat(path)).size;
  const handle = await open(path, "r");
  try {
    const buf = Buffer.alloc(Math.min(4096, size));
    await handle.read(buf, 0, buf.length, 0);
    const magic = buf.subarray(0, BACKUP_MAGIC.length).toString("utf8");
    if (magic !== BACKUP_MAGIC) throw new Error("Not a Locus backup file.");
    const nl = buf.indexOf(0x0a, BACKUP_MAGIC.length);
    if (nl < 0) throw new Error("The backup header is damaged.");
    const header = JSON.parse(buf.subarray(BACKUP_MAGIC.length, nl).toString("utf8")) as Header;
    if (header.format !== 1 || header.kdf !== "scrypt") {
      throw new Error("This backup was made by a newer Locus. Update Locus, then restore.");
    }
    const offset = nl + 1;
    if (size < offset + TAG_BYTES) throw new Error("The backup file is truncated.");
    return { header, offset, size };
  } finally {
    await handle.close();
  }
}

/** Resolve a record path under `root`, refusing anything that escapes it. */
export function safeJoin(root: string, rel: string): string {
  if (!rel || isAbsolute(rel) || rel.includes("\0"))
    throw new Error(`Unsafe path in backup: ${rel}`);
  const parts = rel.split("/");
  if (parts.some((p) => p === ".." || p === "")) throw new Error(`Unsafe path in backup: ${rel}`);
  const abs = resolve(root, normalize(parts.join(sep)));
  const back = relative(root, abs);
  if (!back || back.startsWith("..") || isAbsolute(back)) {
    throw new Error(`Unsafe path in backup: ${rel}`);
  }
  return abs;
}

/**
 * Stream-parse the decrypted, gunzipped record stream. Files go straight to disk under
 * `destDir`; manifest and vault records are collected in memory.
 */
class RecordExtractor extends Writable {
  manifest?: BackupManifest;
  vault?: SecretBundle;
  files = 0;
  private buf: Buffer = Buffer.alloc(0);
  private current?: RecordHeader;
  private remaining = 0;
  private fd?: number;
  private meta: Buffer[] = [];

  constructor(private readonly destDir: string) {
    super();
  }

  override _write(chunk: Buffer, _enc: BufferEncoding, done: (err?: Error | null) => void): void {
    try {
      this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
      this.drain();
      done();
    } catch (err) {
      this.closeFd();
      done(err as Error);
    }
  }

  override _final(done: (err?: Error | null) => void): void {
    if (this.current || this.buf.length) {
      this.closeFd();
      done(new Error("The backup ended in the middle of a file."));
      return;
    }
    done();
  }

  private closeFd(): void {
    if (this.fd != null) {
      closeSync(this.fd);
      this.fd = undefined;
    }
  }

  private drain(): void {
    for (;;) {
      if (!this.current) {
        if (this.buf.length < 4) return;
        const len = this.buf.readUInt32BE(0);
        if (len > 1 << 20) throw new Error("The backup has a damaged record.");
        if (this.buf.length < 4 + len) return;
        const header = JSON.parse(this.buf.subarray(4, 4 + len).toString("utf8")) as RecordHeader;
        this.buf = this.buf.subarray(4 + len);
        this.beginRecord(header);
        continue;
      }
      if (this.remaining > 0) {
        if (!this.buf.length) return;
        const take = Math.min(this.remaining, this.buf.length);
        const piece = this.buf.subarray(0, take);
        this.buf = this.buf.subarray(take);
        this.remaining -= take;
        if (this.fd != null) writeSync(this.fd, piece);
        else this.meta.push(piece);
      }
      if (this.remaining === 0) this.finishRecord();
    }
  }

  private beginRecord(header: RecordHeader): void {
    this.current = header;
    this.remaining = header.size;
    this.meta = [];
    if (header.type === "dir") {
      mkdirSync(safeJoin(this.destDir, header.path), { recursive: true, mode: 0o700 });
    } else if (header.type === "symlink") {
      const abs = safeJoin(this.destDir, header.path);
      mkdirSync(dirname(abs), { recursive: true, mode: 0o700 });
      try {
        symlinkSync(header.target, abs);
      } catch {
        /* Windows without symlink rights: skip the link. */
      }
    } else if (header.type === "file") {
      const abs = safeJoin(this.destDir, header.path);
      mkdirSync(dirname(abs), { recursive: true, mode: 0o700 });
      this.fd = openSync(abs, "w", (header.mode ?? 0o600) & 0o777 || 0o600);
      this.files += 1;
    }
  }

  private finishRecord(): void {
    const header = this.current!;
    this.closeFd();
    if (header.type === "manifest") {
      this.manifest = JSON.parse(Buffer.concat(this.meta).toString("utf8")) as BackupManifest;
    } else if (header.type === "vault") {
      this.vault = {
        ...emptySecrets(),
        ...(JSON.parse(Buffer.concat(this.meta).toString("utf8")) as Partial<SecretBundle>),
      };
    }
    this.meta = [];
    this.current = undefined;
  }
}

function friendlyDecryptError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    /unable to authenticate|incorrect header check|invalid (stored block|distance)|unknown compression|unexpected end/i.test(
      msg,
    )
  ) {
    return new Error("Wrong passphrase, or the backup file is damaged.");
  }
  return err instanceof Error ? err : new Error(msg);
}

/** Decrypt and extract a backup into `destDir`. The GCM tag is checked before returning. */
export async function extractBackup(opts: {
  path: string;
  passphrase: string;
  destDir: string;
}): Promise<{ manifest: BackupManifest; vault: SecretBundle; files: number }> {
  const passphrase = assertPassphrase(opts.passphrase);
  const { header, offset, size } = await readHeader(opts.path);
  const handle = await open(opts.path, "r");
  const tag = Buffer.alloc(TAG_BYTES);
  try {
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally {
    await handle.close();
  }
  const key = await deriveKey(passphrase, Buffer.from(header.salt, "base64"), header);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
  decipher.setAuthTag(tag);
  await mkdir(opts.destDir, { recursive: true, mode: 0o700 });
  const extractor = new RecordExtractor(opts.destDir);
  const end = size - TAG_BYTES - 1;
  try {
    await pipeline(
      end >= offset ? createReadStream(opts.path, { start: offset, end }) : Readable.from([]),
      decipher,
      createGunzip(),
      extractor,
    );
  } catch (err) {
    throw friendlyDecryptError(err);
  }
  if (!extractor.manifest) throw new Error("The backup has no manifest.");
  return {
    manifest: extractor.manifest,
    vault: extractor.vault ?? emptySecrets(),
    files: extractor.files,
  };
}

/** Read only the manifest (still decrypts the archive to verify it). */
export async function inspectBackup(opts: {
  path: string;
  passphrase: string;
  scratchDir: string;
}): Promise<BackupManifest> {
  const dest = join(opts.scratchDir, `inspect-${Date.now()}`);
  try {
    return (await extractBackup({ ...opts, destDir: dest })).manifest;
  } finally {
    await rm(dest, { recursive: true, force: true }).catch(() => undefined);
  }
}

function jsonEscaped(path: string): string {
  return JSON.stringify(path).slice(1, -1);
}

/**
 * Point absolute paths from the source machine's data dir at this one.
 * Only JSON state files are rewritten; workspaces and repos are user content.
 */
export async function rewriteDataDirPaths(
  root: string,
  fromDir: string,
  toDir: string,
): Promise<number> {
  if (resolve(fromDir) === resolve(toDir)) return 0;
  const from = jsonEscaped(fromDir.replace(/[\\/]+$/, ""));
  const to = jsonEscaped(toDir.replace(/[\\/]+$/, ""));
  const skipDirs = new Set(["docker-workspaces", "repos", "share", "disks", "images", "media"]);
  let changed = 0;
  async function visit(abs: string, depth: number): Promise<void> {
    let names: string[];
    try {
      names = await readdir(abs);
    } catch {
      return;
    }
    for (const name of names) {
      if (depth === 0 && skipDirs.has(name)) continue;
      const child = join(abs, name);
      const info = await lstat(child).catch(() => undefined);
      if (!info) continue;
      if (info.isDirectory()) {
        await visit(child, depth + 1);
      } else if (
        info.isFile() &&
        (name.endsWith(".json") || name.endsWith(".jsonl")) &&
        info.size < 64 * 1024 * 1024
      ) {
        const raw = await readFile(child, "utf8");
        if (!raw.includes(from)) continue;
        await writeFile(child, raw.split(from).join(to), { mode: info.mode & 0o777 });
        changed += 1;
      }
    }
  }
  await visit(root, 0);
  return changed;
}

/**
 * Decrypt a backup into `<dataDir>/.restore-staging`, re-encrypt its vault with this
 * machine's master key, and mark it for the next start. Live state is untouched.
 */
export async function stageRestore(opts: {
  dataDir: string;
  path: string;
  passphrase: string;
}): Promise<RestoreStageResult> {
  const dataDir = resolve(opts.dataDir);
  const staging = join(dataDir, RESTORE_STAGING_DIR);
  await rm(join(dataDir, RESTORE_MARKER), { force: true });
  await rm(staging, { recursive: true, force: true });
  try {
    const { manifest, vault, files } = await extractBackup({
      path: opts.path,
      passphrase: opts.passphrase,
      destDir: staging,
    });
    const key = await loadOrCreateMasterKey(dataDir);
    await writeVaultFile(staging, key, vault);
    await rewriteDataDirPaths(staging, manifest.dataDir, dataDir);
    await writeFile(
      join(dataDir, RESTORE_MARKER),
      `${JSON.stringify({ stagedAt: new Date().toISOString(), from: opts.path, manifest }, null, 2)}\n`,
      { mode: 0o600 },
    );
    return { manifest, files, restartRequired: true };
  } catch (err) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

export async function pendingRestore(
  dataDir: string,
): Promise<{ stagedAt: string; from: string; manifest: BackupManifest } | undefined> {
  try {
    return JSON.parse(await readFile(join(dataDir, RESTORE_MARKER), "utf8"));
  } catch {
    return undefined;
  }
}

export async function cancelPendingRestore(dataDir: string): Promise<void> {
  await rm(join(dataDir, RESTORE_MARKER), { force: true });
  await rm(join(dataDir, RESTORE_STAGING_DIR), { recursive: true, force: true });
}

/**
 * Swap a staged restore into place. Call before the store or any service loads.
 * The previous files are kept under `.before-restore-<stamp>/`.
 */
export async function applyPendingRestore(
  dataDir: string,
  now = new Date(),
): Promise<RestoreApplyResult> {
  const root = resolve(dataDir);
  const marker = await pendingRestore(root);
  if (!marker) return { applied: false };
  const staging = join(root, RESTORE_STAGING_DIR);
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const aside = join(root, `${BEFORE_RESTORE_PREFIX}${stamp}`);
  try {
    const stagedNames = new Set(await readdir(staging));
    const keep = new Set(KEEP_ON_RESTORE);
    if (!marker.manifest.includeDisks) for (const d of DISK_DIRS) keep.add(d);
    await mkdir(aside, { recursive: true, mode: 0o700 });
    for (const name of await readdir(root)) {
      if (name.startsWith(BEFORE_RESTORE_PREFIX)) continue;
      if (keep.has(name) && !stagedNames.has(name)) continue;
      if (KEEP_ON_RESTORE.has(name)) continue;
      await rename(join(root, name), join(aside, name));
    }
    for (const name of stagedNames) {
      await rename(join(staging, name), join(root, name));
    }
    await rm(staging, { recursive: true, force: true });
    await rm(join(root, RESTORE_MARKER), { force: true });
    return { applied: true, movedAsideTo: aside };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Do not retry on every start. The old files are under `aside`.
    await rename(join(root, RESTORE_MARKER), join(root, RESTORE_FAILED_MARKER)).catch(
      () => undefined,
    );
    return { applied: false, movedAsideTo: aside, error: message };
  }
}
