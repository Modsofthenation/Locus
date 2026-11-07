import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SECTOR = 2048;

export interface IsoFile {
  name: string;
  data: Buffer;
}

export async function writeDirectoryIso(
  dir: string,
  outPath: string,
  volumeId: string,
): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: IsoFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    files.push({ name: entry.name, data: await readFile(join(dir, entry.name)) });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(outPath, buildJolietIso(files, volumeId));
  return outPath;
}

export function buildJolietIso(files: IsoFile[], volumeId: string): Buffer {
  const now = new Date();
  const isoRootLba = 23;
  const jolietRootLba = 24;
  let nextLba = 25;
  const contents = files.map((file) => {
    const lba = nextLba;
    nextLba += Math.max(1, Math.ceil(file.data.length / SECTOR) || 1);
    return { file, lba, size: file.data.length };
  });
  const volumeSize = nextLba;

  const isoRoot = buildDirectory(contents, isoRootLba, now, isoName);
  const jolietRoot = buildDirectory(contents, jolietRootLba, now, jolietName);
  const isoPathLe = pathTable("le", isoRootLba);
  const isoPathBe = pathTable("be", isoRootLba);
  const jolietPathLe = pathTable("le", jolietRootLba);
  const jolietPathBe = pathTable("be", jolietRootLba);

  const image = Buffer.alloc(volumeSize * SECTOR);
  writeVolumeDescriptor(image, 16, {
    type: 1,
    volumeId: isoVolumeId(volumeId),
    volumeSize,
    pathTableSize: isoPathLe.length,
    pathTableLe: 19,
    pathTableBe: 20,
    rootLba: isoRootLba,
    rootSize: isoRoot.length,
    now,
  });
  writeVolumeDescriptor(image, 17, {
    type: 2,
    volumeId: jolietVolumeId(volumeId),
    volumeSize,
    pathTableSize: jolietPathLe.length,
    pathTableLe: 21,
    pathTableBe: 22,
    rootLba: jolietRootLba,
    rootSize: jolietRoot.length,
    now,
    joliet: true,
  });
  image[18 * SECTOR] = 255;
  image.set(Buffer.from("CD001\x01"), 18 * SECTOR + 1);

  isoPathLe.copy(image, 19 * SECTOR);
  isoPathBe.copy(image, 20 * SECTOR);
  jolietPathLe.copy(image, 21 * SECTOR);
  jolietPathBe.copy(image, 22 * SECTOR);
  isoRoot.copy(image, isoRootLba * SECTOR);
  jolietRoot.copy(image, jolietRootLba * SECTOR);
  for (const entry of contents) {
    entry.file.data.copy(image, entry.lba * SECTOR);
  }
  return image;
}

export function readJolietFiles(image: Buffer): { volumeId: string; files: IsoFile[] } {
  const svd = image.subarray(17 * SECTOR, 18 * SECTOR);
  if (svd[0] !== 2) throw new Error("Missing Joliet volume descriptor");
  const volumeId = decodeUtf16Be(svd.subarray(40, 72)).trim();
  const rootLba = svd.readUInt32LE(158);
  const rootSize = svd.readUInt32LE(166);
  const root = image.subarray(rootLba * SECTOR, rootLba * SECTOR + rootSize);
  const files: IsoFile[] = [];
  let offset = 0;
  while (offset < root.length) {
    const recLen = root[offset] ?? 0;
    if (recLen === 0) break;
    const flags = root[offset + 25] ?? 0;
    const nameLen = root[offset + 32] ?? 0;
    const extent = root.readUInt32LE(offset + 2);
    const size = root.readUInt32LE(offset + 10);
    const rawName = root.subarray(offset + 33, offset + 33 + nameLen);
    offset += recLen;
    if (flags & 2) continue;
    const name = stripVersion(decodeUtf16Be(rawName));
    files.push({
      name,
      data: Buffer.from(image.subarray(extent * SECTOR, extent * SECTOR + size)),
    });
  }
  return { volumeId, files };
}

function buildDirectory(
  contents: { file: IsoFile; lba: number; size: number }[],
  selfLba: number,
  now: Date,
  encodeName: (name: string) => Buffer,
): Buffer {
  const fileRecords = contents.map((entry) =>
    dirRecord({
      extent: entry.lba,
      size: entry.size,
      flags: 0,
      name: encodeName(entry.file.name),
      now,
    }),
  );
  const used = 68 + fileRecords.reduce((sum, rec) => sum + rec.length, 0);
  const dirSize = Math.max(SECTOR, Math.ceil(used / SECTOR) * SECTOR);
  const records = [
    dirRecord({ extent: selfLba, size: dirSize, flags: 2, name: Buffer.from([0]), now }),
    dirRecord({ extent: selfLba, size: dirSize, flags: 2, name: Buffer.from([1]), now }),
    ...fileRecords,
  ];
  const buf = Buffer.alloc(dirSize);
  let offset = 0;
  for (const rec of records) {
    rec.copy(buf, offset);
    offset += rec.length;
  }
  return buf;
}

function dirRecord(opts: {
  extent: number;
  size: number;
  flags: number;
  name: Buffer;
  now: Date;
}): Buffer {
  let recLen = 33 + opts.name.length;
  if (recLen % 2) recLen += 1;
  const rec = Buffer.alloc(recLen);
  rec[0] = recLen;
  writeBoth32(rec, 2, opts.extent);
  writeBoth32(rec, 10, opts.size);
  rec[18] = opts.now.getUTCFullYear() - 1900;
  rec[19] = opts.now.getUTCMonth() + 1;
  rec[20] = opts.now.getUTCDate();
  rec[21] = opts.now.getUTCHours();
  rec[22] = opts.now.getUTCMinutes();
  rec[23] = opts.now.getUTCSeconds();
  rec[25] = opts.flags;
  writeBoth16(rec, 28, 1);
  rec[32] = opts.name.length;
  opts.name.copy(rec, 33);
  return rec;
}

function pathTable(endian: "le" | "be", rootLba: number): Buffer {
  const buf = Buffer.alloc(10);
  buf[0] = 1;
  if (endian === "le") {
    buf.writeUInt32LE(rootLba, 2);
    buf.writeUInt16LE(1, 6);
  } else {
    buf.writeUInt32BE(rootLba, 2);
    buf.writeUInt16BE(1, 6);
  }
  return buf;
}

function writeVolumeDescriptor(
  image: Buffer,
  sector: number,
  opts: {
    type: number;
    volumeId: Buffer;
    volumeSize: number;
    pathTableSize: number;
    pathTableLe: number;
    pathTableBe: number;
    rootLba: number;
    rootSize: number;
    now: Date;
    joliet?: boolean;
  },
): void {
  const d = image.subarray(sector * SECTOR, (sector + 1) * SECTOR);
  d.fill(0);
  d.fill(0x20, 8, 72);
  d.fill(0x20, 190, 813);
  d[0] = opts.type;
  Buffer.from("CD001\x01").copy(d, 1);
  opts.volumeId.copy(d, 40);
  writeBoth32(d, 80, opts.volumeSize);
  if (opts.joliet) Buffer.from("%/E").copy(d, 88);
  writeBoth16(d, 120, 1);
  writeBoth16(d, 124, 1);
  writeBoth16(d, 128, SECTOR);
  writeBoth32(d, 132, opts.pathTableSize);
  d.writeUInt32LE(opts.pathTableLe, 140);
  d.writeUInt32BE(opts.pathTableBe, 148);
  const root = dirRecord({
    extent: opts.rootLba,
    size: opts.rootSize,
    flags: 2,
    name: Buffer.from([0]),
    now: opts.now,
  });
  root.copy(d, 156);
  asciiPad("LOCUS", 128).copy(d, 574);
  const stamp = volumeDate(opts.now);
  stamp.copy(d, 813);
  stamp.copy(d, 830);
  Buffer.alloc(17, "0").copy(d, 847);
  Buffer.alloc(17, "0").copy(d, 864);
  d[829] = 0;
  d[846] = 0;
  d[863] = 0;
  d[880] = 0;
  d[881] = 1;
}

function isoName(name: string): Buffer {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .slice(0, 30);
  return Buffer.from(`${base}.;1`);
}

function jolietName(name: string): Buffer {
  return encodeUtf16Be(`${name};1`);
}

function isoVolumeId(id: string): Buffer {
  return asciiPad(
    id
      .replace(/[^A-Za-z0-9_]/g, "_")
      .toUpperCase()
      .slice(0, 32),
    32,
  );
}

function jolietVolumeId(id: string): Buffer {
  const encoded = encodeUtf16Be(id.slice(0, 16));
  const buf = Buffer.alloc(32);
  for (let i = 0; i < 32; i += 2) {
    buf[i] = 0;
    buf[i + 1] = 0x20;
  }
  encoded.copy(buf);
  return buf;
}

function asciiPad(value: string, size: number): Buffer {
  const buf = Buffer.alloc(size, 0x20);
  Buffer.from(value).copy(buf, 0, 0, size);
  return buf;
}

function volumeDate(now: Date): Buffer {
  const y = String(now.getUTCFullYear()).padStart(4, "0");
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  const s = String(now.getUTCSeconds()).padStart(2, "0");
  return Buffer.from(`${y}${mo}${d}${h}${mi}${s}00`);
}

function encodeUtf16Be(value: string): Buffer {
  const buf = Buffer.alloc(value.length * 2);
  for (let i = 0; i < value.length; i += 1) {
    buf.writeUInt16BE(value.charCodeAt(i), i * 2);
  }
  return buf;
}

function decodeUtf16Be(buf: Buffer): string {
  let out = "";
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const code = buf.readUInt16BE(i);
    if (code) out += String.fromCharCode(code);
  }
  return out;
}

function stripVersion(name: string): string {
  return name.replace(/;1$/, "").replace(/\.$/, "");
}

function writeBoth16(buf: Buffer, offset: number, value: number): void {
  buf.writeUInt16LE(value, offset);
  buf.writeUInt16BE(value, offset + 2);
}

function writeBoth32(buf: Buffer, offset: number, value: number): void {
  buf.writeUInt32LE(value, offset);
  buf.writeUInt32BE(value, offset + 4);
}
