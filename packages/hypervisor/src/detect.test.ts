import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { qmpReady } from "./detect.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

function serveQmp(chunks: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer((sock) => {
      sock.on("data", () => {
        /* capabilities command — ignored besides keeping the socket open */
      });
      for (const chunk of chunks) sock.write(chunk);
    });
    servers.push(server);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("expected TCP address"));
        return;
      }
      resolve(addr.port);
    });
  });
}

describe("qmpReady", () => {
  it("does not treat a QMP greeting as KVM success", async () => {
    const port = await serveQmp(['{"QMP": {"version": {"qemu": {"major": 8}}}}\r\n']);
    await expect(qmpReady(port, 700)).resolves.toBe(false);
  });

  it("accepts a qmp_capabilities return", async () => {
    const port = await serveQmp([
      '{"QMP": {"version": {"qemu": {"major": 8}}}}\r\n{"return": {}}\r\n',
    ]);
    await expect(qmpReady(port, 1000)).resolves.toBe(true);
  });
});
