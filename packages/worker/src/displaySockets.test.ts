import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { pipeVnc } from "./displaySockets.js";

class FakeWs {
  readyState: number = WebSocket.OPEN;
  sent: Buffer[] = [];
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  send(data: Buffer | string) {
    this.sent.push(Buffer.from(data));
  }

  close() {
    this.readyState = WebSocket.CLOSED;
  }

  on(event: string, fn: (...args: unknown[]) => void) {
    const rows = this.listeners.get(event) ?? [];
    rows.push(fn);
    this.listeners.set(event, rows);
  }

  emit(event: string, ...args: unknown[]) {
    for (const fn of this.listeners.get(event) ?? []) fn(...args);
  }
}

describe("worker VNC pipe", () => {
  it("copies bytes between a websocket and loopback VNC", async () => {
    const tcp = createServer((socket) => {
      socket.on("data", (buf) => {
        socket.write(Buffer.concat([Buffer.from("RFB "), Buffer.from(buf)]));
      });
    });
    await new Promise<void>((resolve) => tcp.listen(0, "127.0.0.1", resolve));
    const port = (tcp.address() as { port: number }).port;
    const ws = new FakeWs();
    pipeVnc(ws as unknown as WebSocket, "127.0.0.1", port);
    await new Promise((r) => setTimeout(r, 40));
    ws.emit("message", Buffer.from("hello"));
    await new Promise((r) => setTimeout(r, 40));
    expect(Buffer.concat(ws.sent).toString()).toContain("RFB");
    expect(Buffer.concat(ws.sent).toString()).toContain("hello");
    ws.emit("close");
    await new Promise<void>((resolve) => tcp.close(() => resolve()));
  });
});
