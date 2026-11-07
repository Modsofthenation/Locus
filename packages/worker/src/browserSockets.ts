import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { DockerEngine } from "@locus/hypervisor";
import type { VmInstance } from "@locus/shared";
import { WebSocketServer } from "ws";
import type { WorkerBrowserHub } from "./browserHub.js";
import type { WorkerGuestHub } from "./guests.js";
import { workerTokenMatches } from "./token.js";

export type WorkerUpgradeServer = {
  on(
    event: "upgrade",
    listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): unknown;
};

export function attachWorkerBrowser(
  server: WorkerUpgradeServer,
  opts: {
    token: string;
    engine: DockerEngine;
    guests: WorkerGuestHub;
    browsers: WorkerBrowserHub;
    lookupGuest?: (id: string) => VmInstance | undefined;
  },
): void {
  const browser = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  server.on("upgrade", (req, socket, head) => {
    const pathname = pathnameOf(req);
    const match = /^\/v1\/guests\/([^/]+)\/browser$/.exec(pathname);
    if (!match?.[1]) {
      socket.destroy();
      return;
    }
    const provided = bearer(req);
    if (!workerTokenMatches(provided, opts.token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const vmId = decodeURIComponent(match[1]);
    if (!opts.lookupGuest?.(vmId) && !opts.engine.get(vmId)) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    browser.handleUpgrade(req, socket, head, (ws) => {
      opts.browsers.attach(vmId, ws);
    });
  });
}

function bearer(req: IncomingMessage): string {
  const header = req.headers.authorization ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function pathnameOf(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? "/", "https://worker.local").pathname;
  } catch {
    return "/";
  }
}
