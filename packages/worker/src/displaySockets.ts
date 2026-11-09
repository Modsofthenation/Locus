import type { IncomingMessage } from "node:http";
import { createConnection } from "node:net";
import type { Duplex } from "node:stream";
import type { VmInstance } from "@locus/shared";
import { WebSocket, WebSocketServer } from "ws";
import { guestVisibleToPlane, parseWorkerPlaneId, WORKER_PLANE_HEADER } from "@locus/shared";
import { workerTokenMatches } from "./token.js";

export type WorkerUpgradeServer = {
  on(
    event: "upgrade",
    listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): unknown;
};

export function attachWorkerDisplay(
  server: WorkerUpgradeServer,
  opts: {
    token: string;
    lookupGuest: (id: string) => VmInstance | undefined;
  },
): void {
  const display = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  server.on("upgrade", (req, socket, head) => {
    const pathname = pathnameOf(req);
    const match = /^\/v1\/guests\/([^/]+)\/display$/.exec(pathname);
    if (!match?.[1]) return;
    const provided = bearer(req);
    if (!workerTokenMatches(provided, opts.token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const vmId = decodeURIComponent(match[1]);
    const vm = opts.lookupGuest(vmId);
    const plane = parseWorkerPlaneId(header(req, WORKER_PLANE_HEADER));
    if (!vm || !guestVisibleToPlane(vm, plane)) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const host = vm.display?.host?.trim();
    const port = vm.display?.port;
    if (!host || !port || (host !== "127.0.0.1" && host !== "::1" && host !== "localhost")) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    display.handleUpgrade(req, socket, head, (ws) => {
      pipeVnc(ws, host, port);
    });
  });
}

export function pipeVnc(ws: WebSocket, host: string, port: number): void {
  const tcp = createConnection({ host, port });
  tcp.on("data", (buf) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(buf);
  });
  tcp.on("error", () => {
    if (ws.readyState === WebSocket.OPEN) ws.close(1011, "display unreachable");
  });
  tcp.on("close", () => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });
  ws.on("message", (data) => {
    if (tcp.destroyed) return;
    tcp.write(toBuffer(data));
  });
  ws.on("close", () => tcp.destroy());
  ws.on("error", () => tcp.destroy());
}

function bearer(req: IncomingMessage): string {
  const headerValue = req.headers.authorization ?? "";
  return headerValue.toLowerCase().startsWith("bearer ") ? headerValue.slice(7).trim() : "";
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function pathnameOf(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? "/", "https://worker.local").pathname;
  } catch {
    return "/";
  }
}

function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}
