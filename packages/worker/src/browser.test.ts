import { createServer } from "node:https";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { afterEach, describe, expect, it } from "vitest";
import { MockDockerEngine } from "@locus/hypervisor";
import type { ChromiumDriver } from "@locus/guest-agent";
import type { WebSocket } from "ws";
import { createWorkerApp } from "./app.js";
import { WorkerBrowserDriver } from "./browserDriver.js";
import { WorkerBrowserHub } from "./browserHub.js";
import { attachWorkerBrowser } from "./browserSockets.js";
import { WorkerClient } from "./client.js";
import { WorkerGuestHub } from "./guests.js";
import { createSelfSignedWorkerTls } from "./tls.js";

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  private listeners: Record<string, Array<(data?: unknown) => void>> = {};
  send(data: string) {
    this.sent.push(data);
  }
  on(type: string, fn: (data?: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  emit(type: string, data?: unknown) {
    for (const fn of this.listeners[type] ?? []) fn(data);
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
}

describe("worker browser hub", () => {
  it("fans screencast frames and stops when the last viewer leaves", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-browser-hub-"));
    const engine = new MockDockerEngine(dir);
    const guests = new WorkerGuestHub();
    const onFrames: Array<Parameters<NonNullable<ChromiumDriver["startScreencast"]>>[0]> = [];
    const stopped: string[] = [];
    const vm = await engine.create({ sessionId: "s1", name: "agent", image: "locus/agent" });
    Object.assign(guests.forVm(vm), {
      chromium: () =>
        ({
          handle: async () => ({ ok: true, output: "" }),
          navigate: async () => ({ ok: true, output: "" }),
          startScreencast: async (onFrame) => {
            onFrames.push(onFrame);
          },
          stopScreencast: async () => {
            stopped.push("stop");
          },
          listPages: async () => [{ targetId: "t1", url: "https://example.com", active: true }],
          listDownloads: async () => ["report.csv"],
        }) satisfies ChromiumDriver,
    });
    const hub = new WorkerBrowserHub(guests, engine);
    const ws = new FakeSocket();
    hub.attach(vm.id, ws as unknown as WebSocket);
    await new Promise((r) => setTimeout(r, 30));
    expect(onFrames).toHaveLength(1);
    expect(ws.sent.some((row) => row.includes('"ready":true'))).toBe(true);
    expect(ws.sent.some((row) => row.includes("https://example.com"))).toBe(true);
    expect(ws.sent.some((row) => row.includes("report.csv"))).toBe(true);
    onFrames[0]?.({
      data: "qq==",
      mime: "image/jpeg",
      sessionId: 1,
      metadata: { offsetTop: 0, pageScaleFactor: 1, deviceWidth: 1280, deviceHeight: 800 },
    });
    expect(ws.sent.some((row) => row.includes("qq=="))).toBe(true);
    ws.close();
    await new Promise((r) => setTimeout(r, 20));
    expect(stopped).toEqual(["stop"]);
  });

  it("dispatches operator input and ignores takeover messages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-browser-input-"));
    const engine = new MockDockerEngine(dir);
    const guests = new WorkerGuestHub();
    const inputs: unknown[] = [];
    const vm = await engine.create({ sessionId: "s1", name: "agent", image: "locus/agent" });
    Object.assign(guests.forVm(vm), {
      chromium: () =>
        ({
          handle: async () => ({ ok: true, output: "" }),
          navigate: async () => ({ ok: true, output: "" }),
          startScreencast: async () => undefined,
          stopScreencast: async () => undefined,
          listPages: async () => [],
          dispatchInput: async (event) => {
            inputs.push(event);
          },
        }) satisfies ChromiumDriver,
    });
    const hub = new WorkerBrowserHub(guests, engine);
    const ws = new FakeSocket();
    hub.attach(vm.id, ws as unknown as WebSocket);
    await new Promise((r) => setTimeout(r, 20));
    ws.emit("message", JSON.stringify({ type: "takeover" }));
    ws.emit(
      "message",
      JSON.stringify({ type: "input", kind: "mousePressed", x: 640, y: 400, button: "left" }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(inputs).toEqual([
      { type: "input", kind: "mousePressed", x: 640, y: 400, button: "left" },
    ]);
  });
});

describe("worker browser driver", () => {
  it("waits for ready, fans frames, and sends input over the socket", async () => {
    let onMessage: ((raw: string) => void) | undefined;
    const sent: string[] = [];
    const fakeWs = {
      readyState: 1,
      send: (data: string) => sent.push(data),
      on: (type: string, fn: () => void) => {
        if (type === "close") fakeWs.closeFn = fn;
      },
      close: () => undefined,
      closeFn: undefined as (() => void) | undefined,
    };
    const executed: Array<{ name: string; args: Record<string, unknown> }> = [];
    const driver = new WorkerBrowserDriver(
      {
        execute: async (id, req) => {
          executed.push({ name: req.name, args: req.args });
          return { ok: true, output: id };
        },
        openBrowserSocket: async (_id, handler) => {
          onMessage = handler;
          queueMicrotask(() =>
            handler(JSON.stringify({ type: "status", controller: "agent", ready: true })),
          );
          return fakeWs as unknown as WebSocket;
        },
      },
      "vm-1",
    );
    const frames: string[] = [];
    await driver.startScreencast((frame) => frames.push(frame.data));
    onMessage?.(
      JSON.stringify({
        type: "frame",
        mime: "image/jpeg",
        data: "qq==",
        metadata: { deviceWidth: 1280, deviceHeight: 800 },
      }),
    );
    onMessage?.(
      JSON.stringify({
        type: "tabs",
        tabs: [{ targetId: "t1", url: "https://example.com", active: true }],
      }),
    );
    expect(frames).toEqual(["qq=="]);
    expect(await driver.listPages()).toEqual([
      { targetId: "t1", url: "https://example.com", active: true },
    ]);
    await driver.dispatchInput({ type: "input", kind: "mouseMoved", x: 10, y: 20 });
    expect(sent.some((row) => row.includes("mouseMoved"))).toBe(true);
    await driver.copyDownload("report.csv");
    expect(executed).toEqual([
      { name: "browser_download", args: { action: "get", filename: "report.csv" } },
    ]);
  });
});

describe("worker browser WSS", () => {
  it("proxies screencast over a pinned worker WebSocket", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-browser-wss-"));
    const tls = createSelfSignedWorkerTls();
    const engine = new MockDockerEngine(dir);
    const guests = new WorkerGuestHub();
    const browsers = new WorkerBrowserHub(guests, engine);
    const app = createWorkerApp({
      engine,
      token: "secret",
      guests,
      onGuestDeleted: (id) => browsers.drop(id),
    });
    const { port, close, server } = await listenHttps(app, tls);
    cleanup.push(close);
    attachWorkerBrowser(server, { token: "secret", engine, guests, browsers });

    const created = await new WorkerClient({
      id: "w1",
      name: "studio",
      url: `https://127.0.0.1:${port}`,
      token: "secret",
      fingerprint: tls.fingerprint,
    }).create({ sessionId: "s1", name: "agent", image: "locus/agent" });

    const onFrames: Array<Parameters<NonNullable<ChromiumDriver["startScreencast"]>>[0]> = [];
    const inputs: unknown[] = [];
    Object.assign(guests.forVm(engine.get(created.id)!), {
      chromium: () =>
        ({
          handle: async () => ({ ok: true, output: "" }),
          navigate: async () => ({ ok: true, output: "" }),
          startScreencast: async (onFrame) => {
            onFrames.push(onFrame);
          },
          stopScreencast: async () => undefined,
          listPages: async () => [{ targetId: "t1", url: "https://example.com", active: true }],
          dispatchInput: async (event) => {
            inputs.push(event);
          },
        }) satisfies ChromiumDriver,
    });

    const client = new WorkerClient({
      id: "w1",
      name: "studio",
      url: `https://127.0.0.1:${port}`,
      token: "secret",
      fingerprint: tls.fingerprint,
    });
    const driver = client.browserDriver(created.id);
    try {
      const frames: string[] = [];
      await driver.startScreencast((frame) => frames.push(frame.data));
      expect(onFrames).toHaveLength(1);
      onFrames[0]?.({
        data: "qq==",
        mime: "image/jpeg",
        sessionId: 1,
        metadata: { offsetTop: 0, pageScaleFactor: 1, deviceWidth: 1280, deviceHeight: 800 },
      });
      await new Promise((r) => setTimeout(r, 30));
      expect(frames).toEqual(["qq=="]);
      expect((await driver.listPages())[0]?.url).toBe("https://example.com");
      await driver.dispatchInput({
        type: "input",
        kind: "mousePressed",
        x: 640,
        y: 400,
        button: "left",
      });
      await new Promise((r) => setTimeout(r, 30));
      expect(inputs).toEqual([
        { type: "input", kind: "mousePressed", x: 640, y: 400, button: "left" },
      ]);

      const wrong = new WorkerClient({
        id: "w1",
        name: "studio",
        url: `https://127.0.0.1:${port}`,
        token: "secret",
        fingerprint: "sha256:" + "ab".repeat(32),
      });
      await expect(
        wrong.browserDriver(created.id).startScreencast(() => undefined),
      ).rejects.toThrow(/fingerprint mismatch/i);
    } finally {
      await driver.stopScreencast();
    }
  });
});

function listenHttps(
  app: ReturnType<typeof createWorkerApp>,
  tls: { key: string; cert: string },
): Promise<{
  port: number;
  close: () => Promise<void>;
  server: ReturnType<typeof serve>;
}> {
  return new Promise((resolve, reject) => {
    const server = serve(
      {
        fetch: app.fetch,
        hostname: "127.0.0.1",
        port: 0,
        createServer,
        serverOptions: { key: tls.key, cert: tls.cert },
      },
      (info) => {
        resolve({
          port: info.port,
          server,
          close: () =>
            new Promise((done) => {
              const http = server as { closeAllConnections?: () => void };
              http.closeAllConnections?.();
              const timer = setTimeout(done, 500);
              server.close(() => {
                clearTimeout(timer);
                done();
              });
            }),
        });
      },
    );
    server.on("error", reject);
  });
}
