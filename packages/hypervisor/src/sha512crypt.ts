import { createHash, randomBytes } from "node:crypto";

const ITOA64 = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const DEFAULT_ROUNDS = 5000;

function sha512(...parts: Buffer[]): Buffer {
  const hash = createHash("sha512");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function b64From24bit(b2: number, b1: number, b0: number, n: number): string {
  let w = (b2 << 16) | (b1 << 8) | b0;
  let out = "";
  for (let i = 0; i < n; i++) {
    out += ITOA64[w & 63];
    w >>= 6;
  }
  return out;
}

function encodeDigest(digest: Buffer): string {
  const c = [...digest];
  return (
    b64From24bit(c[0]!, c[21]!, c[42]!, 4) +
    b64From24bit(c[22]!, c[43]!, c[1]!, 4) +
    b64From24bit(c[44]!, c[2]!, c[23]!, 4) +
    b64From24bit(c[3]!, c[24]!, c[45]!, 4) +
    b64From24bit(c[25]!, c[46]!, c[4]!, 4) +
    b64From24bit(c[47]!, c[5]!, c[26]!, 4) +
    b64From24bit(c[6]!, c[27]!, c[48]!, 4) +
    b64From24bit(c[28]!, c[49]!, c[7]!, 4) +
    b64From24bit(c[50]!, c[8]!, c[29]!, 4) +
    b64From24bit(c[9]!, c[30]!, c[51]!, 4) +
    b64From24bit(c[31]!, c[52]!, c[10]!, 4) +
    b64From24bit(c[53]!, c[11]!, c[32]!, 4) +
    b64From24bit(c[12]!, c[33]!, c[54]!, 4) +
    b64From24bit(c[34]!, c[55]!, c[13]!, 4) +
    b64From24bit(c[56]!, c[14]!, c[35]!, 4) +
    b64From24bit(c[15]!, c[36]!, c[57]!, 4) +
    b64From24bit(c[37]!, c[58]!, c[16]!, 4) +
    b64From24bit(c[59]!, c[17]!, c[38]!, 4) +
    b64From24bit(c[18]!, c[39]!, c[60]!, 4) +
    b64From24bit(c[40]!, c[61]!, c[19]!, 4) +
    b64From24bit(c[62]!, c[20]!, c[41]!, 4) +
    b64From24bit(0, 0, c[63]!, 2)
  );
}

function repeatToLength(chunk: Buffer, length: number): Buffer {
  const out = Buffer.alloc(length);
  for (let offset = 0; offset < length; offset += chunk.length) {
    chunk.copy(out, offset, 0, Math.min(chunk.length, length - offset));
  }
  return out;
}

/** SHA-512 crypt (`$6$`) as used by `openssl passwd -6`. */
export function sha512Crypt(
  password: string,
  salt = randomCryptSalt(),
  rounds = DEFAULT_ROUNDS,
): string {
  const key = Buffer.from(password, "utf8");
  const saltBuf = Buffer.from(salt.slice(0, 16), "utf8");

  const digestB = sha512(key, saltBuf, key);

  const digestACtx = createHash("sha512");
  digestACtx.update(key);
  digestACtx.update(saltBuf);
  for (let remaining = key.length; remaining > 0; remaining -= 64) {
    digestACtx.update(digestB.subarray(0, Math.min(64, remaining)));
  }
  for (let i = key.length; i > 0; i >>= 1) {
    digestACtx.update(i & 1 ? digestB : key);
  }
  let digestC = digestACtx.digest();

  const pCtx = createHash("sha512");
  for (let i = 0; i < key.length; i++) pCtx.update(key);
  const p = repeatToLength(pCtx.digest(), key.length);

  const sCtx = createHash("sha512");
  for (let i = 0; i < 16 + digestC[0]!; i++) sCtx.update(saltBuf);
  const s = repeatToLength(sCtx.digest(), saltBuf.length);

  for (let i = 0; i < rounds; i++) {
    const ctx = createHash("sha512");
    ctx.update(i & 1 ? p : digestC);
    if (i % 3) ctx.update(s);
    if (i % 7) ctx.update(p);
    ctx.update(i & 1 ? digestC : p);
    digestC = ctx.digest();
  }

  return `$6$${saltBuf.toString("utf8")}$${encodeDigest(digestC)}`;
}

export function randomCryptSalt(length = 8): string {
  const bytes = randomBytes(length);
  let salt = "";
  for (const byte of bytes) salt += ITOA64[byte % 64];
  return salt;
}
