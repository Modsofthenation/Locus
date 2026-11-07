import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { attachSerialLog } from "./serial.js";

function listen(
  port = 0,
): Promise<{ port: number; close: () => Promise<void>; write: (data: string) => void }> {
  const server = createServer();
  const sockets: import("node:net").Socket[] = [];
  server.on("connection", (s) => sockets.push(s));
  return new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no port"));
        return;
      }
      resolve({
        port: addr.port,
        write: (data: string) => {
          for (const s of sockets) s.write(data);
        },
        close: () =>
          new Promise((res, rej) => {
            for (const s of sockets) s.destroy();
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
    server.on("error", reject);
  });
}

describe("attachSerialLog", () => {
  it("appends guest serial bytes and stops when aborted", async () => {
    const listener = await listen();
    const chunks: string[] = [];
    const abort = new AbortController();
    attachSerialLog({
      port: listener.port,
      onData: (c) => chunks.push(c),
      signal: abort.signal,
      retryMs: 20,
    });
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline && chunks.length === 0) {
      listener.write("cloud-init: waiting\n");
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(chunks.join("")).toContain("cloud-init: waiting");
    abort.abort();
    await listener.close();
  });

  it("retries until the serial port is listening", async () => {
    const abort = new AbortController();
    const chunks: string[] = [];
    const reserved = await listen();
    const port = reserved.port;
    await reserved.close();
    attachSerialLog({ port, onData: (c) => chunks.push(c), signal: abort.signal, retryMs: 20 });
    await new Promise((r) => setTimeout(r, 40));
    const listener = await listen(port);
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline && chunks.length === 0) {
      listener.write("ttyS0 ready\n");
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(chunks.join("")).toContain("ttyS0 ready");
    abort.abort();
    await listener.close();
  });
});
