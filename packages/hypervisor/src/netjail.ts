import { timingSafeEqual } from "node:crypto";
import { createServer, connect, type Server, type Socket } from "node:net";
import { hostAllowed } from "@locus/shared";

export interface AllowlistProxy {
  port: number;
  close: () => void;
}

export interface EgressAttempt {
  host: string;
  port: number;
  allowed: boolean;
  bytesSent?: number;
}

export async function startAllowlistProxy(
  allow: string[],
  listenPort = 0,
  onEgress?: (attempt: EgressAttempt) => void,
  listenHost = "127.0.0.1",
  authToken?: string,
): Promise<AllowlistProxy> {
  const server = createServer((socket) => {
    handleClient(socket, allow, onEgress, authToken).catch(() => {
      socket.destroy();
    });
  });
  const port = await listen(server, listenPort, listenHost);
  return {
    port,
    close: () => {
      server.close();
    },
  };
}

async function handleClient(
  socket: Socket,
  allow: string[],
  onEgress?: (attempt: EgressAttempt) => void,
  authToken?: string,
): Promise<void> {
  const header = await readHeaders(socket);
  if (!header) {
    socket.destroy();
    return;
  }
  if (authToken && !proxyAuthorized(header.head, authToken)) {
    socket.end(
      'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="locus"\r\nConnection: close\r\n\r\n',
    );
    return;
  }
  const target = targetFromRequest(header.head);
  const allowed = Boolean(target && hostAllowed(target.host, allow));
  if (!target || !allowed) {
    if (target) onEgress?.({ host: target.host, port: target.port, allowed: false, bytesSent: 0 });
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    return;
  }
  const upstream = connect({ host: target.host, port: target.port });
  await new Promise<void>((resolve, reject) => {
    upstream.once("connect", () => resolve());
    upstream.once("error", reject);
  });
  let bytesSent = header.rest.length;
  if (header.connect) {
    socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
    if (header.rest.length) upstream.write(header.rest);
  } else {
    const headBuf = Buffer.from(`${header.head}\r\n\r\n`, "utf8");
    bytesSent += headBuf.length;
    upstream.write(Buffer.concat([headBuf, header.rest]));
  }
  socket.on("data", (chunk: Buffer) => {
    bytesSent += chunk.length;
    if (!upstream.destroyed) upstream.write(chunk);
  });
  upstream.pipe(socket);
  const finish = () =>
    onEgress?.({ host: target.host, port: target.port, allowed: true, bytesSent });
  socket.once("close", finish);
  socket.on("error", () => upstream.destroy());
  upstream.on("error", () => socket.destroy());
}

function targetFromRequest(
  head: string,
): { host: string; port: number; connect: boolean } | undefined {
  const first = head.split("\r\n")[0] ?? "";
  const connect = first.match(/^CONNECT\s+([^:\s]+):(\d+)/i);
  if (connect?.[1] && connect[2]) {
    return { host: connect[1], port: Number(connect[2]), connect: true };
  }
  const hostLine = head.match(/^Host:\s*([^\r\n]+)/im)?.[1]?.trim();
  if (!hostLine) return undefined;
  const [host, portRaw] = hostLine.split(":");
  if (!host) return undefined;
  const port = portRaw ? Number(portRaw) : first.startsWith("CONNECT") ? 443 : 80;
  return { host, port: Number.isFinite(port) && port > 0 ? port : 80, connect: false };
}

function proxyAuthorized(head: string, token: string): boolean {
  const header = head.match(/^Proxy-Authorization:\s*(.+)$/im)?.[1]?.trim();
  if (!header) return false;
  if (!header.toLowerCase().startsWith("basic ")) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  } catch {
    return false;
  }
  const idx = decoded.indexOf(":");
  const pass = idx >= 0 ? decoded.slice(idx + 1) : decoded;
  const left = Buffer.from(pass);
  const right = Buffer.from(token);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const MAX_HEADER_BYTES = 16_384;
const HEADER_TIMEOUT_MS = 5_000;

function readHeaders(
  socket: Socket,
): Promise<{ head: string; rest: Buffer; connect: boolean } | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const finish = (value: { head: string; rest: Buffer; connect: boolean } | undefined) => {
      clearTimeout(timer);
      socket.off("data", onData);
      resolve(value);
    };
    const onData = (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_HEADER_BYTES) {
        finish(undefined);
        return;
      }
      chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      const idx = buf.indexOf("\r\n\r\n");
      if (idx < 0) return;
      const head = buf.subarray(0, idx).toString("utf8");
      finish({
        head,
        rest: buf.subarray(idx + 4),
        connect: /^\s*CONNECT\s/i.test(head),
      });
    };
    const timer = setTimeout(() => finish(undefined), HEADER_TIMEOUT_MS);
    socket.on("data", onData);
    socket.once("error", () => finish(undefined));
    socket.once("end", () => finish(undefined));
  });
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Proxy did not bind a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}
