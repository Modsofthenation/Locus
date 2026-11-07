import { describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { LIVE_CHROME_DISCONNECTED } from "@locus/shared";
import { ChromeExtensionHub } from "./chromeExtensionHub.js";

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

async function listen(): Promise<WebSocketServer> {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
  return wss;
}

function portOf(wss: WebSocketServer): number {
  return (wss.address() as AddressInfo).port;
}

describe("ChromeExtensionHub", () => {
  it("rejects a missing pairing token", async () => {
    const hub = new ChromeExtensionHub(() => "cx_secret");
    const wss = await listen();
    const closed = new Promise<number>((resolve) => {
      wss.on("connection", (ws) => {
        hub.attach(ws, "bad");
        ws.on("close", (code) => resolve(code));
      });
    });
    const client = new WebSocket(`ws://127.0.0.1:${portOf(wss)}`);
    await waitOpen(client);
    expect(await closed).toBe(1008);
    client.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  it("relays a browser tool to the extension and returns the result", async () => {
    const hub = new ChromeExtensionHub(() => "cx_secret");
    hub.setLiveChrome("s1", true);
    const wss = await listen();
    const ready = new Promise<WebSocket>((resolve) => {
      wss.on("connection", (ws) => {
        hub.attach(ws, "cx_secret");
        resolve(ws);
      });
    });
    const client = new WebSocket(`ws://127.0.0.1:${portOf(wss)}`);
    client.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as { type?: string; id?: string };
      if (msg.type === "command" && msg.id) {
        client.send(
          JSON.stringify({
            type: "result",
            id: msg.id,
            ok: true,
            output: "@e1 button Submit",
          }),
        );
      }
    });
    await waitOpen(client);
    await ready;
    const driver = hub.driverFor("s1");
    expect(driver).toBeTruthy();
    const result = await driver!.handle({ name: "browser_snapshot", args: {} });
    expect(result).toEqual({ ok: true, output: "@e1 button Submit" });
    client.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  it("does not hand a driver to sessions that have not opted in", () => {
    const hub = new ChromeExtensionHub(() => "cx_secret");
    expect(hub.driverFor("s1")).toBeUndefined();
    hub.setLiveChrome("s1", true);
    expect(hub.driverFor("s1")).toBeTruthy();
    hub.setLiveChrome("s1", false);
    expect(hub.driverFor("s1")).toBeUndefined();
  });

  it("reports disconnected when no extension is attached", async () => {
    const hub = new ChromeExtensionHub(() => "cx_secret");
    hub.setLiveChrome("s1", true);
    const result = await hub.driverFor("s1")!.handle({ name: "browser_tabs", args: {} });
    expect(result.output).toBe(LIVE_CHROME_DISCONNECTED);
  });
});
