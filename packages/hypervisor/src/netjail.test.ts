import { createConnection, createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startAllowlistProxy } from "./netjail.js";

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
});

describe("allowlist proxy", () => {
  it("tunnels CONNECT to an allowed host and rejects others", async () => {
    const echo = createServer((socket) => socket.pipe(socket));
    const echoPort = await listen(echo);
    cleanup.push(() => echo.close());
    const proxy = await startAllowlistProxy(["127.0.0.1"]);
    cleanup.push(proxy.close);

    const ok = await request(proxy.port, `CONNECT 127.0.0.1:${echoPort} HTTP/1.1\r\n\r\n`, "ping");
    expect(ok).toContain("200");
    expect(ok).toContain("ping");

    const denied = await request(proxy.port, "CONNECT evil.example:443 HTTP/1.1\r\n\r\n");
    expect(denied).toContain("403");
  });

  it("reports allow and deny attempts to the egress watcher", async () => {
    const seen: Array<{ host: string; allowed: boolean; bytesSent?: number }> = [];
    const proxy = await startAllowlistProxy(["127.0.0.1"], 0, (attempt) => {
      seen.push({ host: attempt.host, allowed: attempt.allowed, bytesSent: attempt.bytesSent });
    });
    cleanup.push(proxy.close);
    await request(proxy.port, "CONNECT evil.example:443 HTTP/1.1\r\n\r\n");
    expect(seen).toEqual([{ host: "evil.example", allowed: false, bytesSent: 0 }]);
  });

  it("binds 0.0.0.0 so host.docker.internal can reach the proxy", async () => {
    const proxy = await startAllowlistProxy(["127.0.0.1"], 0, undefined, "0.0.0.0");
    cleanup.push(proxy.close);
    const denied = await request(proxy.port, "CONNECT evil.example:443 HTTP/1.1\r\n\r\n");
    expect(denied).toContain("403");
  });

  it("drops CONNECT requests whose headers never terminate", async () => {
    const proxy = await startAllowlistProxy(["127.0.0.1"]);
    cleanup.push(proxy.close);
    const oversized = "CONNECT evil.example:443 HTTP/1.1\r\nX-Pad: " + "a".repeat(20_000);
    const reply = await request(proxy.port, oversized);
    expect(reply).toBe("");
  });

  it("rejects CONNECT without proxy auth when a token is set", async () => {
    const proxy = await startAllowlistProxy(
      ["127.0.0.1"],
      0,
      undefined,
      "127.0.0.1",
      "secret-token",
    );
    cleanup.push(proxy.close);
    const unauthorized = await request(proxy.port, "CONNECT 127.0.0.1:9 HTTP/1.1\r\n\r\n");
    expect(unauthorized).toContain("407");
    const auth = Buffer.from("locus:secret-token").toString("base64");
    const denied = await request(
      proxy.port,
      `CONNECT evil.example:443 HTTP/1.1\r\nProxy-Authorization: Basic ${auth}\r\n\r\n`,
    );
    expect(denied).toContain("403");
  });
});

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function request(port: number, head: string, body?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (value: string) => {
      if (done) return;
      done = true;
      socket.end();
      resolve(value);
    };
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(head);
    });
    const chunks: Buffer[] = [];
    socket.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString("utf8");
      if (
        text.includes("403") ||
        text.includes("407") ||
        text.includes("ping") ||
        text.includes("Connection established")
      ) {
        if (body && text.includes("200") && !text.includes(body)) {
          socket.write(body);
          return;
        }
        finish(text);
      }
    });
    socket.on("close", () => finish(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
    socket.setTimeout(2000, () => {
      socket.destroy();
      if (!done) reject(new Error("proxy request timed out"));
    });
  });
}
