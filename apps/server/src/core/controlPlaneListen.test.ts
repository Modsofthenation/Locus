import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createSelfSignedWorkerTls, pinnedHttpsFetch } from "@locus/worker";
import { createProtocolMux, isTlsHandshakeByte, allowPlainHttp } from "./controlPlaneListen.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe("control plane protocol mux", () => {
  it("treats 0x16 as a TLS handshake", () => {
    expect(isTlsHandshakeByte(0x16)).toBe(true);
    expect(isTlsHandshakeByte("G".charCodeAt(0))).toBe(false);
  });

  it("keeps loopback HTTP when TLS is on and rejects LAN cleartext", () => {
    expect(allowPlainHttp("127.0.0.1", true)).toBe(true);
    expect(allowPlainHttp("::1", true)).toBe(true);
    expect(allowPlainHttp("::ffff:127.0.0.1", true)).toBe(true);
    expect(allowPlainHttp("192.168.0.20", true)).toBe(false);
    expect(allowPlainHttp("192.168.0.20", false)).toBe(true);
  });

  it("serves HTTP and HTTPS on the same port", async () => {
    const tls = createSelfSignedWorkerTls();
    const http = createHttpServer((_req, res) => {
      res.end("http-ok");
    });
    const https = createHttpsServer({ key: tls.key, cert: tls.cert }, (_req, res) => {
      res.end("https-ok");
    });
    const mux = createProtocolMux({ http, https });
    const port = await listen(mux);
    cleanup.push(
      () =>
        new Promise((resolve, reject) => {
          mux.close((err) => (err ? reject(err) : resolve()));
        }),
    );

    const plain = await fetch(`http://127.0.0.1:${port}/`);
    expect(await plain.text()).toBe("http-ok");

    const pinned = await pinnedHttpsFetch(`https://127.0.0.1:${port}/`, {}, tls.fingerprint);
    expect(await pinned.response.text()).toBe("https-ok");
    expect(pinned.fingerprint).toBe(tls.fingerprint);
  });
});

function listen(server: ReturnType<typeof createProtocolMux>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}
