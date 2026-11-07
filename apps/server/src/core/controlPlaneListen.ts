import { createServer as createNetServer, type Server as NetServer, type Socket } from "node:net";
import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import { isLoopbackHost } from "@locus/shared";

/** TLS handshake records start with content type 0x16 (Handshake). */
export function isTlsHandshakeByte(byte: number): boolean {
  return byte === 0x16;
}

export function allowPlainHttp(peer: string | undefined, tlsEnabled: boolean): boolean {
  if (!tlsEnabled) return true;
  const host = (peer ?? "").replace(/^::ffff:/i, "");
  return !host || isLoopbackHost(host);
}

export function routeProtocol(socket: Socket, http: HttpServer, https?: HttpsServer): void {
  const onReadable = () => {
    const buf = socket.read(1) as Buffer | null;
    if (!buf?.byteLength) {
      socket.once("readable", onReadable);
      return;
    }
    socket.unshift(buf);
    if (https && isTlsHandshakeByte(buf[0]!)) {
      https.emit("connection", socket);
      return;
    }
    if (!allowPlainHttp(socket.remoteAddress, Boolean(https))) {
      socket.destroy();
      return;
    }
    http.emit("connection", socket);
  };
  socket.once("readable", onReadable);
  socket.on("error", () => socket.destroy());
}

/** One TCP port: loopback HTTP plus optional LAN TLS. */
export function createProtocolMux(opts: { http: HttpServer; https?: HttpsServer }): NetServer {
  return createNetServer((socket) => routeProtocol(socket, opts.http, opts.https));
}
