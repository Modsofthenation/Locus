import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function isPng(bytes: Buffer): boolean {
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIG);
}

export function decodePngRgba(
  bytes: Buffer,
): { width: number; height: number; data: Uint8ClampedArray } | undefined {
  if (!isPng(bytes)) return undefined;
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (offset + 12 + length > bytes.length) return undefined;
    if (type === "IHDR") {
      if (data.length < 13) return undefined;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return undefined;
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (!width || !height || bitDepth !== 8) return undefined;
  if (colorType !== 2 && colorType !== 6 && colorType !== 0 && colorType !== 4) return undefined;
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  let inflated: Buffer;
  try {
    inflated = inflateSync(Buffer.concat(idat));
  } catch {
    return undefined;
  }
  const stride = width * channels;
  const expected = (stride + 1) * height;
  if (inflated.length < expected) return undefined;
  const raw = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)]!;
    const row = inflated.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = raw.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? raw.subarray((y - 1) * stride, y * stride) : undefined;
    unfilter(filter, row, out, prev, channels);
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (colorType === 6) {
      data.set(raw.subarray(i * 4, i * 4 + 4), i * 4);
    } else if (colorType === 2) {
      data[i * 4] = raw[i * 3]!;
      data[i * 4 + 1] = raw[i * 3 + 1]!;
      data[i * 4 + 2] = raw[i * 3 + 2]!;
      data[i * 4 + 3] = 255;
    } else if (colorType === 4) {
      data[i * 4] = raw[i * 2]!;
      data[i * 4 + 1] = raw[i * 2]!;
      data[i * 4 + 2] = raw[i * 2]!;
      data[i * 4 + 3] = raw[i * 2 + 1]!;
    } else {
      data[i * 4] = raw[i]!;
      data[i * 4 + 1] = raw[i]!;
      data[i * 4 + 2] = raw[i]!;
      data[i * 4 + 3] = 255;
    }
  }
  return { width, height, data };
}

export function encodePngRgba(width: number, height: number, data: ArrayLike<number>): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = data[y * stride + x]!;
  }
  const idat = deflateSync(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

function unfilter(
  filter: number,
  row: Buffer,
  out: Uint8Array,
  prev: Uint8Array | undefined,
  bpp: number,
): void {
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? out[i - bpp]! : 0;
    const b = prev ? prev[i]! : 0;
    const c = prev && i >= bpp ? prev[i - bpp]! : 0;
    let val = row[i]!;
    if (filter === 1) val = (val + a) & 255;
    else if (filter === 2) val = (val + b) & 255;
    else if (filter === 3) val = (val + ((a + b) >> 1)) & 255;
    else if (filter === 4) val = (val + paeth(a, b, c)) & 255;
    else if (filter !== 0) val = row[i]!;
    out[i] = val;
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
