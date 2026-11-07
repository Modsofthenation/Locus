import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { Hub } from "./hub.js";
import { attachSockets } from "./sockets.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((fn) => fn()));
});

describe("defaultPty", () => {
  it("pipes stdio and hides the Windows console so Electron keeps keyboard input", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "sockets.ts"), "utf8");
    expect(src).toContain('stdio: ["pipe", "pipe", "pipe"]');
    expect(src).toContain("windowsHide: true");
  });
});

describe("display websocket", () => {
  it("pipes RFB bytes between the client and the VNC TCP port", async () => {
    const tcp = createNetServer((c) => {
      c.write(Buffer.from("RFB 003.008\n"));
      c.on("data", (d) => c.write(Buffer.concat([Buffer.from("echo:"), Buffer.from(d)])));
    });
    await listen(tcp);
    closers.push(() => closeServer(tcp));
    const vncPort = (tcp.address() as AddressInfo).port;

    const http = createHttpServer();
    attachSockets({
      server: http,
      hub: new Hub(),
      displays: {
        get: (id) =>
          id === "vm-1" ? { display: { host: "127.0.0.1", port: vncPort } } : undefined,
      },
      onCommand: () => undefined,
    });
    await listen(http);
    closers.push(() => closeServer(http));
    const port = (http.address() as AddressInfo).port;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/display/vm-1`);
    closers.push(async () => {
      ws.close();
    });
    const greeting = await waitMessage(ws);
    expect(greeting.toString()).toContain("RFB 003.008");
    ws.send(Buffer.from("hello"));
    const echoed = await waitMessage(ws);
    expect(echoed.toString()).toBe("echo:hello");
  });

  it("closes when the VM has no display", async () => {
    const http = createHttpServer();
    attachSockets({
      server: http,
      hub: new Hub(),
      displays: { get: () => undefined },
      onCommand: () => undefined,
    });
    await listen(http);
    closers.push(() => closeServer(http));
    const port = (http.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/display/missing`);
    const code = await new Promise<number>((resolve, reject) => {
      ws.on("close", (c) => resolve(c));
      ws.on("error", reject);
    });
    expect(code).toBe(1011);
  });

  it("refuses to proxy a non-loopback display host", async () => {
    const http = createHttpServer();
    attachSockets({
      server: http,
      hub: new Hub(),
      displays: {
        get: () => ({ display: { host: "8.8.8.8", port: 5900 } }),
      },
      onCommand: () => undefined,
    });
    await listen(http);
    closers.push(() => closeServer(http));
    const port = (http.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/display/vm-1`);
    const code = await new Promise<number>((resolve, reject) => {
      ws.on("close", (c) => resolve(c));
      ws.on("error", reject);
    });
    expect(code).toBe(1011);
  });

  it("destroys upgrades from a non-loopback Origin", async () => {
    const http = createHttpServer();
    attachSockets({
      server: http,
      hub: new Hub(),
      displays: { get: () => undefined },
      onCommand: () => undefined,
    });
    await listen(http);
    closers.push(() => closeServer(http));
    const port = (http.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: "https://evil.example" });
    const outcome = await new Promise<string>((resolve) => {
      ws.on("open", () => resolve("open"));
      ws.on("unexpected-response", () => resolve("rejected"));
      ws.on("error", () => resolve("error"));
      ws.on("close", () => resolve("close"));
    });
    expect(outcome).not.toBe("open");
  });

  it("broadcasts control-plane events to /ws clients", async () => {
    const http = createHttpServer();
    const hub = new Hub();
    attachSockets({
      server: http,
      hub,
      displays: { get: () => undefined },
      onCommand: () => undefined,
      heartbeatMs: 40,
    });
    await listen(http);
    closers.push(() => closeServer(http));
    const port = (http.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: "http://127.0.0.1" });
    closers.push(async () => {
      ws.close();
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    hub.broadcast({ type: "session.deleted", id: "s1" });
    const payload = JSON.parse((await waitMessage(ws)).toString()) as { type: string; id: string };
    expect(payload).toEqual({ type: "session.deleted", id: "s1" });
  });

  it("pipes a guest PTY over /ws/terminal", async () => {
    const http = createHttpServer();
    attachSockets({
      server: http,
      hub: new Hub(),
      displays: {
        get: (id) =>
          id === "vm-1" ? { ssh: { host: "127.0.0.1", port: 22, username: "locus" } } : undefined,
      },
      onCommand: () => undefined,
      pty: () =>
        spawn(process.execPath, [
          "-e",
          "process.stdin.on('data', (d) => process.stdout.write(d)); setTimeout(() => {}, 5000)",
        ]),
    });
    await listen(http);
    closers.push(() => closeServer(http));
    const port = (http.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal/vm-1`);
    closers.push(async () => {
      ws.close();
    });
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });
    ws.send(Buffer.from("hi"));
    const echoed = await waitMessage(ws);
    expect(echoed.toString()).toBe("hi");
  });

  it("closes a terminal socket when SSH is missing", async () => {
    const http = createHttpServer();
    attachSockets({
      server: http,
      hub: new Hub(),
      displays: { get: () => undefined },
      onCommand: () => undefined,
    });
    await listen(http);
    closers.push(() => closeServer(http));
    const port = (http.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal/missing`);
    const code = await new Promise<number>((resolve, reject) => {
      ws.on("close", (c) => resolve(c));
      ws.on("error", reject);
    });
    expect(code).toBe(1011);
  });

  it("pipes a host workspace shell over /ws/workspace-terminal", async () => {
    const http = createHttpServer();
    attachSockets({
      server: http,
      hub: new Hub(),
      displays: { get: () => undefined },
      onCommand: () => undefined,
      workspaceShell: {
        root: async (id) => (id === "s1" ? "/tmp" : undefined),
        spawn: () =>
          spawn(process.execPath, [
            "-e",
            "process.stdout.write('ready'); process.stdin.on('data', (d) => process.stdout.write(d)); setTimeout(() => {}, 5000)",
          ]),
      },
    });
    await listen(http);
    closers.push(() => closeServer(http));
    const port = (http.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/workspace-terminal/s1`);
    closers.push(async () => {
      ws.close();
    });
    const first = waitMessage(ws);
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });
    expect((await first).toString()).toBe("ready");
    ws.send(Buffer.from("pwd"));
    const echoed = await waitMessage(ws);
    expect(echoed.toString()).toBe("pwd");
  });

  it("keeps a workspace shell alive when its terminal reconnects", async () => {
    const http = createHttpServer();
    let spawns = 0;
    attachSockets({
      server: http,
      hub: new Hub(),
      displays: { get: () => undefined },
      onCommand: () => undefined,
      workspaceShell: {
        root: async (id) => (id === "s1" ? process.cwd() : undefined),
        cooked: false,
        spawn: () => {
          spawns += 1;
          return spawn(process.execPath, [
            "-e",
            "let n=0; process.stdout.write('ready'); process.stdin.on('data', (d) => { const s=String(d); if(s==='inc') process.stdout.write('inc:'+(++n)); if(s==='read') process.stdout.write('read:'+n); }); setTimeout(() => {}, 5000)",
          ]);
        },
      },
    });
    await listen(http);
    closers.push(() => closeServer(http));
    const port = (http.address() as AddressInfo).port;
    const url = `ws://127.0.0.1:${port}/ws/workspace-terminal/s1?terminal=1`;

    const first = new WebSocket(url);
    const ready = waitForMessage(first, (text) => text === "ready");
    await waitOpen(first);
    await ready;
    const incremented = waitMessage(first);
    first.send(Buffer.from("inc"));
    expect((await incremented).toString()).toBe("inc:1");
    await closeWebSocket(first);

    const second = new WebSocket(url);
    const replayed = waitForMessage(second, (text) => text === "inc:1");
    closers.push(async () => {
      second.close();
    });
    await waitOpen(second);
    expect(await replayed).toBe("inc:1");
    const read = waitForMessage(second, (text) => text === "read:1");
    second.send(Buffer.from("read"));
    expect(await read).toBe("read:1");
    expect(spawns).toBe(1);
  });

  it("line-cooks Windows workspace input so CR submits and keystrokes echo", async () => {
    const http = createHttpServer();
    attachSockets({
      server: http,
      hub: new Hub(),
      displays: { get: () => undefined },
      onCommand: () => undefined,
      workspaceShell: {
        root: async (id) => (id === "s1" ? "/tmp" : undefined),
        cooked: true,
        spawn: () =>
          spawn(process.execPath, [
            "-e",
            "process.stdout.write('ready'); process.stdin.on('data', (d) => process.stdout.write('OUT:' + d)); setTimeout(() => {}, 5000)",
          ]),
      },
    });
    await listen(http);
    closers.push(() => closeServer(http));
    const port = (http.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/workspace-terminal/s1`);
    closers.push(async () => {
      ws.close();
    });
    const got: string[] = [];
    ws.on("message", (data) => {
      got.push(toBuffer(data).toString());
    });
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && !got.includes("ready")) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(got).toContain("ready");
    ws.send(Buffer.from("pwd\r"));
    while (Date.now() < deadline && !(got.includes("pwd\r\n") && got.includes("OUT:pwd\n"))) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(got).toContain("pwd\r\n");
    expect(got).toContain("OUT:pwd\n");
  });

  it("closes a workspace terminal when the session has no host folder", async () => {
    const http = createHttpServer();
    attachSockets({
      server: http,
      hub: new Hub(),
      displays: { get: () => undefined },
      onCommand: () => undefined,
      workspaceShell: { root: async () => undefined },
    });
    await listen(http);
    closers.push(() => closeServer(http));
    const port = (http.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/workspace-terminal/missing`);
    const code = await new Promise<number>((resolve, reject) => {
      ws.on("close", (c) => resolve(c));
      ws.on("error", reject);
    });
    expect(code).toBe(1011);
  });

  it("closes a browser socket when no attach hook is registered", async () => {
    const http = createHttpServer();
    attachSockets({
      server: http,
      hub: new Hub(),
      displays: { get: () => undefined },
      onCommand: () => undefined,
    });
    await listen(http);
    closers.push(() => closeServer(http));
    const port = (http.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/browser/s1`);
    const code = await new Promise<number>((resolve, reject) => {
      ws.on("close", (c) => resolve(c));
      ws.on("error", reject);
    });
    expect(code).toBe(1011);
  });

  it("hands /ws/browser to the attach hook", async () => {
    const http = createHttpServer();
    const attached: string[] = [];
    attachSockets({
      server: http,
      hub: new Hub(),
      displays: { get: () => undefined },
      onCommand: () => undefined,
      browsers: {
        attach: (sessionId, ws) => {
          attached.push(sessionId);
          ws.send(JSON.stringify({ type: "status", controller: "agent", ready: true }));
        },
      },
    });
    await listen(http);
    closers.push(() => closeServer(http));
    const port = (http.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/browser/sess-1`);
    closers.push(async () => {
      ws.close();
    });
    const payload = JSON.parse((await waitMessage(ws)).toString()) as {
      type: string;
      controller: string;
    };
    expect(attached).toEqual(["sess-1"]);
    expect(payload).toEqual({ type: "status", controller: "agent", ready: true });
  });

  it("destroys /ws/chrome-extension without a matching token", async () => {
    const http = createHttpServer();
    attachSockets({
      server: http,
      hub: new Hub(),
      displays: { get: () => undefined },
      onCommand: () => undefined,
      chromeExtension: {
        attach: () => undefined,
        token: () => "cx_secret",
      },
    });
    await listen(http);
    closers.push(() => closeServer(http));
    const port = (http.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/chrome-extension`);
    const outcome = await new Promise<string>((resolve) => {
      ws.on("open", () => resolve("open"));
      ws.on("unexpected-response", () => resolve("rejected"));
      ws.on("error", () => resolve("error"));
      ws.on("close", () => resolve("close"));
    });
    expect(outcome).not.toBe("open");
  });

  it("destroys /ws/chrome-extension when the token shares a prefix but diverges", async () => {
    const http = createHttpServer();
    attachSockets({
      server: http,
      hub: new Hub(),
      displays: { get: () => undefined },
      onCommand: () => undefined,
      chromeExtension: {
        attach: () => undefined,
        token: () => "cx_aabbccddeeff00112233445566778899",
      },
    });
    await listen(http);
    closers.push(() => closeServer(http));
    const port = (http.address() as AddressInfo).port;
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws/chrome-extension?token=cx_aabbccddeeff0011223344556677889X`,
    );
    const outcome = await new Promise<string>((resolve) => {
      ws.on("open", () => resolve("open"));
      ws.on("unexpected-response", () => resolve("rejected"));
      ws.on("error", () => resolve("error"));
      ws.on("close", () => resolve("close"));
    });
    expect(outcome).not.toBe("open");
  });

  it("hands /ws/chrome-extension to the attach hook with a matching token", async () => {
    const http = createHttpServer();
    const attached: string[] = [];
    attachSockets({
      server: http,
      hub: new Hub(),
      displays: { get: () => undefined },
      onCommand: () => undefined,
      chromeExtension: {
        attach: (ws, token) => {
          attached.push(token ?? "");
          ws.send(JSON.stringify({ type: "hello", ok: true }));
        },
        token: () => "cx_secret",
      },
    });
    await listen(http);
    closers.push(() => closeServer(http));
    const port = (http.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/chrome-extension?token=cx_secret`);
    closers.push(async () => {
      ws.close();
    });
    const payload = JSON.parse((await waitMessage(ws)).toString()) as { type: string; ok: boolean };
    expect(attached).toEqual(["cx_secret"]);
    expect(payload).toEqual({ type: "hello", ok: true });
  });
});

function listen(server: {
  listen: (port: number, host: string, cb: () => void) => void;
}): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function closeServer(server: { close: (cb: (err?: Error) => void) => void }): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function waitMessage(ws: WebSocket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => resolve(toBuffer(data)));
    ws.once("error", reject);
  });
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

function closeWebSocket(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.once("close", () => resolve());
    ws.close();
  });
}

function waitForMessage(ws: WebSocket, accept: (text: string) => boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      const text = toBuffer(data).toString();
      if (!accept(text)) return;
      cleanup();
      resolve(text);
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      ws.off("message", onMessage);
      ws.off("error", onError);
    };
    ws.on("message", onMessage);
    ws.on("error", onError);
  });
}

function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}
