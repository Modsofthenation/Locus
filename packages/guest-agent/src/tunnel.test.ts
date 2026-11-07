import { createConnection } from "node:net";
import { describe, expect, it } from "vitest";
import { guestLoopbackRelayScript, listenGuestLoopbackTunnel } from "./tunnel.js";

describe("guest loopback tunnel", () => {
  it("relays a specific guest loopback port and never advertises 0.0.0.0", () => {
    const script = guestLoopbackRelayScript(3999);
    expect(script).toContain("PORT=3999");
    expect(script).toContain("127.0.0.1");
    expect(script).not.toContain("0.0.0.0");
    expect(() => guestLoopbackRelayScript(0)).toThrow(/Invalid guest port/);
  });

  it("binds the host side to loopback", async () => {
    const tunnel = await listenGuestLoopbackTunnel("unused-container", 3999);
    expect(tunnel.host).toBe("127.0.0.1");
    expect(tunnel.port).toBeGreaterThan(0);
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: tunnel.host, port: tunnel.port });
      socket.on("connect", () => {
        socket.end();
        resolve();
      });
      socket.on("error", reject);
    });
    tunnel.close();
  });
});
