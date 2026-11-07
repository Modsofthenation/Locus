import { createSign, generateKeyPairSync, randomBytes, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import https from "node:https";
import { isIP } from "node:net";
import { join } from "node:path";
import type { TLSSocket } from "node:tls";
import type { WebSocket } from "ws";
import { parseWorkerFingerprint } from "@locus/shared";

export interface WorkerTlsMaterial {
  key: string;
  cert: string;
  fingerprint: string;
  created: boolean;
}

export function certFingerprint(derOrPem: Buffer | string): string {
  const cert = new X509Certificate(derOrPem);
  return `sha256:${cert.fingerprint256.replace(/:/g, "").toLowerCase()}`;
}

export async function loadOrCreateWorkerTls(dataDir: string): Promise<WorkerTlsMaterial> {
  const envCert = process.env.LOCUS_WORKER_TLS_CERT?.trim();
  const envKey = process.env.LOCUS_WORKER_TLS_KEY?.trim();
  if (envCert && envKey) {
    const cert = await readFile(envCert, "utf8");
    const key = await readFile(envKey, "utf8");
    return { key, cert, fingerprint: certFingerprint(cert), created: false };
  }
  const dir = join(dataDir, "tls");
  const certPath = join(dir, "cert.pem");
  const keyPath = join(dir, "key.pem");
  try {
    const cert = await readFile(certPath, "utf8");
    const key = await readFile(keyPath, "utf8");
    if (cert.includes("BEGIN CERTIFICATE") && key.includes("BEGIN")) {
      return { key, cert, fingerprint: certFingerprint(cert), created: false };
    }
  } catch {
    /* create */
  }
  const pair = createSelfSignedWorkerTls();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(keyPath, pair.key, { encoding: "utf8", mode: 0o600 });
  await writeFile(certPath, pair.cert, { encoding: "utf8", mode: 0o600 });
  await chmod(keyPath, 0o600).catch(() => undefined);
  await chmod(certPath, 0o600).catch(() => undefined);
  return { ...pair, created: true };
}

export function createSelfSignedWorkerTls(): Omit<WorkerTlsMaterial, "created"> {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const now = new Date();
  const notBefore = new Date(now.getTime() - 60_000);
  const notAfter = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 3650);
  const cn = utf8String("locus-worker");
  const name = seq(set(seq(oid("2.5.4.3"), cn)));
  const tbs = seq(
    context(0, intBuf(Buffer.from([0x02]))),
    intBuf(randomBytes(8)),
    seq(oid("1.2.840.113549.1.1.11"), nul()),
    name,
    seq(utcTime(notBefore), utcTime(notAfter)),
    name,
    spki,
  );
  const signer = createSign("SHA256");
  signer.update(tbs);
  signer.end();
  const signature = signer.sign(privateKey);
  const der = seq(tbs, seq(oid("1.2.840.113549.1.1.11"), nul()), bitString(signature));
  const cert = pem("CERTIFICATE", der);
  const key = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  return { key, cert, fingerprint: certFingerprint(cert) };
}

export async function pinnedHttpsWebSocket(
  url: string,
  opts: {
    headers?: Record<string, string>;
    fingerprint?: string;
    onMessage?: (raw: string) => void;
  },
): Promise<WebSocket> {
  const parsed = new URL(url);
  if (parsed.protocol !== "wss:") {
    throw new Error("Worker URL must be https");
  }
  const want = parseWorkerFingerprint(opts.fingerprint);
  if (!want) {
    throw new Error("Test connection in Settings → Workers to pin this worker's TLS fingerprint");
  }
  const { WebSocket } = await import("ws");
  return new Promise((resolve, reject) => {
    let done = false;
    const ws = new WebSocket(url, {
      rejectUnauthorized: false,
      perMessageDeflate: false,
      headers: opts.headers,
    });
    if (opts.onMessage) {
      ws.on("message", (raw) => opts.onMessage?.(String(raw)));
    }
    const fail = (err: Error) => {
      if (done) return;
      done = true;
      ws.terminate();
      reject(err);
    };
    ws.once("unexpected-response", (_req, res) => {
      fail(new Error(`Worker browser WS failed (${res.statusCode})`));
    });
    ws.once("upgrade", (res) => {
      const tlsSock = res.socket as TLSSocket;
      const raw = tlsSock.getPeerCertificate?.()?.raw as Buffer | undefined;
      const seen = raw ? certFingerprint(raw) : "";
      if (seen !== want) {
        fail(new Error(`Worker TLS fingerprint mismatch (got ${seen})`));
        return;
      }
      if (!seen) {
        fail(new Error("Worker did not present a TLS certificate"));
      }
    });
    ws.once("open", () => {
      if (done) return;
      done = true;
      resolve(ws);
    });
    ws.once("error", (err) => {
      fail(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

export async function pinnedHttpsFetch(
  url: string,
  init: RequestInit | undefined,
  fingerprint?: string,
): Promise<{ response: Response; fingerprint: string }> {
  const parsed = new URL(url);
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = headerRecord(init?.headers);
  const body =
    typeof init?.body === "string" || init?.body instanceof Uint8Array ? init.body : undefined;
  const want = parseWorkerFingerprint(fingerprint);

  return new Promise((resolve, reject) => {
    let seen = "";
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
        signal: init?.signal ?? undefined,
        rejectUnauthorized: false,
        servername: isIP(parsed.hostname) ? undefined : parsed.hostname,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const hdrs = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            hdrs.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
          resolve({
            response: new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 0,
              headers: hdrs,
            }),
            fingerprint: seen,
          });
        });
      },
    );
    req.on("socket", (socket) => {
      const tlsSock = socket as TLSSocket;
      tlsSock.once("secureConnect", () => {
        const cert = tlsSock.getPeerCertificate();
        seen = cert?.raw ? certFingerprint(cert.raw) : "";
        if (want && seen !== want) {
          req.destroy(new Error(`Worker TLS fingerprint mismatch (got ${seen})`));
        }
        if (!seen) req.destroy(new Error("Worker did not present a TLS certificate"));
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function headerRecord(headers?: RequestInit["headers"]): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...(headers as Record<string, string>) };
}

function pem(type: string, der: Buffer): string {
  const lines = der.toString("base64").match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${type}-----\n${lines.join("\n")}\n-----END ${type}-----\n`;
}

function der(tag: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
}

function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x100) return Buffer.from([0x81, n]);
  if (n < 0x10000) return Buffer.from([0x82, (n >> 8) & 0xff, n & 0xff]);
  throw new Error("DER length too large");
}

function seq(...parts: Buffer[]): Buffer {
  return der(0x30, Buffer.concat(parts));
}

function set(...parts: Buffer[]): Buffer {
  return der(0x31, Buffer.concat(parts));
}

function context(n: number, body: Buffer): Buffer {
  return der(0xa0 + n, body);
}

function nul(): Buffer {
  return Buffer.from([0x05, 0x00]);
}

function bitString(body: Buffer): Buffer {
  return der(0x03, Buffer.concat([Buffer.from([0x00]), body]));
}

function utf8String(value: string): Buffer {
  return der(0x0c, Buffer.from(value, "utf8"));
}

function utcTime(date: Date): Buffer {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yy = pad(date.getUTCFullYear() % 100);
  const stamp = `${yy}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  return der(0x17, Buffer.from(stamp));
}

function intBuf(bytes: Buffer): Buffer {
  let value = bytes;
  while (value.length > 1 && value[0] === 0) value = value.subarray(1);
  if (value[0]! & 0x80) value = Buffer.concat([Buffer.from([0x00]), value]);
  return der(0x02, value);
}

function oid(dotted: string): Buffer {
  const parts = dotted.split(".").map(Number);
  const bytes = [40 * (parts[0] ?? 0) + (parts[1] ?? 0)];
  for (const n of parts.slice(2)) {
    if (n < 128) {
      bytes.push(n);
      continue;
    }
    const stack = [n & 0x7f];
    let v = n >>> 7;
    while (v > 0) {
      stack.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    bytes.push(...stack.reverse());
  }
  return der(0x06, Buffer.from(bytes));
}
