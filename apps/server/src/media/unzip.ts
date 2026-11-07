import {
  MAX_DESIGN_IMPORT_BYTES,
  formatDesignImportBytes,
  isDesignKitPath,
  isSkippedZipImportPath,
  kitImportRank,
  zipImportRank,
} from "@locus/shared";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const MAX_ZIP_BYTES = MAX_DESIGN_IMPORT_BYTES;
const MAX_ENTRY_BYTES = 512 * 1024;
const MAX_UNCOMPRESSED = 2 * 1024 * 1024;
const MAX_FILES = 96;
const MAX_CD_ENTRIES = 8192;
const MAX_KIT_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_KIT_BYTES = 32 * 1024 * 1024;
const MAX_KIT_FILES = 128;
const TEXT_FILE = /\.(html?|css|json|md|txt)$/i;

export interface ZipTextFile {
  name: string;
  text: string;
}

export interface ZipKitFile {
  name: string;
  data: Buffer;
}

function assertZipSize(buf: Buffer): void {
  if (buf.length > MAX_ZIP_BYTES) {
    throw new Error(
      `Zip is too large (${formatDesignImportBytes(buf.length)}; max ${formatDesignImportBytes(MAX_ZIP_BYTES)}). Remove source uploads or nested archives and try again.`,
    );
  }
  if (buf.length < 22) throw new Error("Not a zip file");
}

function listZipEntries(buf: Buffer): ZipCandidate[] {
  assertZipSize(buf);
  const eocd = findEocd(buf);
  let disk = buf.readUInt16LE(eocd + 4);
  let entriesTotal = buf.readUInt16LE(eocd + 10);
  let cdSize = buf.readUInt32LE(eocd + 12);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  if (disk !== 0 || entriesTotal === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const zip64 = readZip64Eocd(buf, eocd);
    disk = zip64.disk;
    entriesTotal = zip64.entriesTotal;
    cdSize = zip64.cdSize;
    cdOffset = zip64.cdOffset;
  }
  if (cdOffset + cdSize > buf.length) throw new Error("Zip is corrupt");
  const candidates: ZipCandidate[] = [];
  let offset = cdOffset;
  const end = cdOffset + cdSize;
  let scanned = 0;
  while (offset + 46 <= end) {
    if (scanned >= MAX_CD_ENTRIES) throw new Error("Zip has too many files");
    scanned += 1;
    if (buf.readUInt32LE(offset) !== CENTRAL_SIG) break;
    const flags = buf.readUInt16LE(offset + 8);
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf
      .subarray(offset + 46, offset + 46 + nameLen)
      .toString("utf8")
      .replaceAll("\\", "/");
    offset += 46 + nameLen + extraLen + commentLen;
    candidates.push({ name, flags, method, compressedSize, uncompressedSize, localOffset });
  }
  return candidates;
}

export function unzipTextFiles(buf: Buffer): ZipTextFile[] {
  const candidates = listZipEntries(buf).filter((entry) =>
    shouldReadEntry(entry.name, entry.flags, entry.method, entry.uncompressedSize),
  );
  candidates.sort(
    (a, b) => zipImportRank(a.name) - zipImportRank(b.name) || a.name.localeCompare(b.name),
  );
  const out: ZipTextFile[] = [];
  let total = 0;
  for (const entry of candidates) {
    if (out.length >= MAX_FILES) break;
    if (total + entry.uncompressedSize > MAX_UNCOMPRESSED) continue;
    const data = readLocalFile(
      buf,
      entry.localOffset,
      entry.method,
      entry.compressedSize,
      entry.uncompressedSize,
      MAX_ENTRY_BYTES,
    );
    total += data.length;
    if (total > MAX_UNCOMPRESSED) break;
    out.push({ name: entry.name, text: data.toString("utf8") });
  }
  if (!out.length) throw new Error("Zip has no design system files");
  return out;
}

export function unzipKitFiles(buf: Buffer): ZipKitFile[] {
  const candidates = listZipEntries(buf).filter((entry) =>
    shouldReadKitEntry(entry.name, entry.flags, entry.method, entry.uncompressedSize),
  );
  candidates.sort(
    (a, b) => kitImportRank(a.name) - kitImportRank(b.name) || a.name.localeCompare(b.name),
  );
  const out: ZipKitFile[] = [];
  let total = 0;
  for (const entry of candidates) {
    if (out.length >= MAX_KIT_FILES) break;
    if (total + entry.uncompressedSize > MAX_KIT_BYTES) continue;
    const data = readLocalFile(
      buf,
      entry.localOffset,
      entry.method,
      entry.compressedSize,
      entry.uncompressedSize,
      MAX_KIT_ENTRY_BYTES,
    );
    total += data.length;
    if (total > MAX_KIT_BYTES) break;
    out.push({ name: entry.name, data });
  }
  return out;
}

interface ZipCandidate {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

export function zipStore(files: Record<string, string | Buffer>): Buffer {
  const records: Array<{
    name: Buffer;
    data: Buffer;
    crc: number;
    offset: number;
    compressed: Buffer;
    method: number;
  }> = [];
  const chunks: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name.replaceAll("\\", "/"), "utf8");
    const data = typeof text === "string" ? Buffer.from(text, "utf8") : text;
    const compressed = data.length > 512 * 1024 ? data : deflateRawSync(data);
    const useDeflate = compressed !== data && compressed.length < data.length;
    const payload = useDeflate ? compressed : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, payload);
    records.push({
      name: nameBuf,
      data,
      crc,
      offset,
      compressed: payload,
      method: useDeflate ? 8 : 0,
    });
    offset += local.length + nameBuf.length + payload.length;
  }
  const cdStart = offset;
  for (const rec of records) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(rec.method, 10);
    central.writeUInt32LE(rec.crc, 16);
    central.writeUInt32LE(rec.compressed.length, 20);
    central.writeUInt32LE(rec.data.length, 24);
    central.writeUInt16LE(rec.name.length, 28);
    central.writeUInt32LE(rec.offset, 42);
    chunks.push(central, rec.name);
    offset += central.length + rec.name.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(records.length, 8);
  eocd.writeUInt16LE(records.length, 10);
  eocd.writeUInt32LE(offset - cdStart, 12);
  eocd.writeUInt32LE(cdStart, 16);
  chunks.push(eocd);
  return Buffer.concat(chunks);
}

function isUnsafeZipPath(name: string): boolean {
  const n = name.replaceAll("\\", "/");
  if (!n || n.endsWith("/")) return true;
  if (n.startsWith("/") || n.startsWith("//")) return true;
  if (/^[A-Za-z]:/.test(n)) return true;
  if (n.split("/").some((part) => part === ".." || part === ".")) return true;
  return false;
}

function shouldReadEntry(
  name: string,
  flags: number,
  method: number,
  uncompressedSize: number,
): boolean {
  if (isUnsafeZipPath(name)) return false;
  if (isSkippedZipImportPath(name)) return false;
  if (flags & 0x1) return false;
  if (method !== 0 && method !== 8) return false;
  if (
    !Number.isInteger(uncompressedSize) ||
    uncompressedSize <= 0 ||
    uncompressedSize > MAX_ENTRY_BYTES
  )
    return false;
  if (!TEXT_FILE.test(name)) return false;
  return true;
}

function shouldReadKitEntry(
  name: string,
  flags: number,
  method: number,
  uncompressedSize: number,
): boolean {
  if (isUnsafeZipPath(name)) return false;
  if (!isDesignKitPath(name)) return false;
  if (flags & 0x1) return false;
  if (method !== 0 && method !== 8) return false;
  if (
    !Number.isInteger(uncompressedSize) ||
    uncompressedSize <= 0 ||
    uncompressedSize > MAX_KIT_ENTRY_BYTES
  ) {
    return false;
  }
  return true;
}

function readLocalFile(
  buf: Buffer,
  localOffset: number,
  method: number,
  compressedSize: number,
  uncompressedSize: number,
  maxBytes: number,
): Buffer {
  if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_SIG) {
    throw new Error("Zip is corrupt");
  }
  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLen + extraLen;
  const end = start + compressedSize;
  if (end > buf.length) throw new Error("Zip is corrupt");
  const payload = buf.subarray(start, end);
  const inflateCap = Math.min(uncompressedSize, maxBytes);
  if (inflateCap <= 0) throw new Error("Zip is corrupt");
  if (method === 0) {
    if (payload.length !== uncompressedSize || payload.length > maxBytes) {
      throw new Error("Zip is corrupt");
    }
    return Buffer.from(payload);
  }
  try {
    return inflateRawSync(payload, { maxOutputLength: inflateCap });
  } catch {
    throw new Error("Zip is too large");
  }
}

function readZip64Eocd(
  buf: Buffer,
  eocd: number,
): { disk: number; entriesTotal: number; cdSize: number; cdOffset: number } {
  const locator = eocd - 20;
  if (locator < 0 || buf.readUInt32LE(locator) !== ZIP64_LOCATOR_SIG) {
    throw new Error(
      "Zip64 archives need a Zip64 end record. Re-export as a smaller zip, or disable Zip64 in the exporter.",
    );
  }
  const offset = Number(buf.readBigUInt64LE(locator + 8));
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 56 > buf.length) {
    throw new Error("Zip64 archive is too large to import");
  }
  if (buf.readUInt32LE(offset) !== ZIP64_EOCD_SIG) throw new Error("Zip64 archive is corrupt");
  const disk = buf.readUInt32LE(offset + 16);
  const entriesTotal = Number(buf.readBigUInt64LE(offset + 32));
  const cdSize = Number(buf.readBigUInt64LE(offset + 40));
  const cdOffset = Number(buf.readBigUInt64LE(offset + 48));
  if (
    disk !== 0 ||
    !Number.isSafeInteger(entriesTotal) ||
    !Number.isSafeInteger(cdSize) ||
    !Number.isSafeInteger(cdOffset)
  ) {
    throw new Error("Multi-disk Zip64 archives are not supported");
  }
  return { disk, entriesTotal, cdSize, cdOffset };
}

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) !== EOCD_SIG) continue;
    const commentLen = buf.readUInt16LE(i + 20);
    if (i + 22 + commentLen === buf.length) return i;
  }
  throw new Error("Not a zip file");
}

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return ~crc >>> 0;
}

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c >>> 0;
}
