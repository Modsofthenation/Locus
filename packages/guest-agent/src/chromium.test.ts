import { createConnection } from "node:net";
import { describe, expect, it } from "vitest";
import {
  CDP_READY_PROBE,
  CDP_RELAY_SCRIPT,
  CdpChromiumDriver,
  CHROMIUM_REMOTE_ADDRESS,
  ENSURE_BROWSER,
  SCREENCAST_PARAMS,
  boxCenter,
  describeCdpError,
  formatAccessibilitySnapshot,
  isBrowserUrl,
  listenCdpTunnel,
  normalizeSnapshotRef,
  parseBrowserPages,
  parseMappedPort,
  rewriteCdpWs,
} from "./chromium.js";
import { DockerGuestRuntime } from "./docker.js";

describe("accessibility snapshot helpers", () => {
  it("assigns refs to interactive named nodes and finds a box center", () => {
    const { text, refs } = formatAccessibilitySnapshot([
      { ignored: false, role: { value: "RootWebArea" }, backendDOMNodeId: 1 },
      {
        ignored: false,
        role: { value: "button" },
        name: { value: "Submit" },
        backendDOMNodeId: 42,
      },
      { ignored: false, role: { value: "link" }, name: { value: "More" }, backendDOMNodeId: 7 },
    ]);
    expect(text).toBe('@e1 button "Submit"\n@e2 link "More"');
    expect(refs.get("@e1")?.backendDOMNodeId).toBe(42);
    expect(normalizeSnapshotRef("e12")).toBe("@e12");
    expect(normalizeSnapshotRef("@e12")).toBe("@e12");
    expect(boxCenter([100, 50, 200, 50, 200, 90, 100, 90])).toEqual({ x: 150, y: 70 });
  });
});

describe("browser URL helpers", () => {
  it("treats a bare http(s) URL as a Chromium navigation", () => {
    expect(isBrowserUrl("https://example.com")).toBe(true);
    expect(isBrowserUrl(" http://127.0.0.1:3000/ ")).toBe(true);
    expect(isBrowserUrl("curl https://example.com")).toBe(false);
    expect(isBrowserUrl("https://example.com && rm")).toBe(false);
  });

  it("rewrites CDP websocket hosts onto the loopback tunnel", () => {
    expect(CHROMIUM_REMOTE_ADDRESS).toBe("127.0.0.1");
    expect(CDP_RELAY_SCRIPT).toContain("127.0.0.1");
    expect(CDP_RELAY_SCRIPT).not.toContain("0.0.0.0");
    expect(parseMappedPort("49152\n")).toBe(49152);
    expect(parseMappedPort("nope")).toBeUndefined();
    expect(rewriteCdpWs("ws://127.0.0.1:9222/devtools/page/1", "127.0.0.1", 49152)).toBe(
      "ws://127.0.0.1:49152/devtools/page/1",
    );
  });
});

describe("CdpChromiumDriver", () => {
  it("probes Chromium readiness over CDP HTTP instead of pgrep", () => {
    expect(CDP_READY_PROBE).toContain("/json/version");
    expect(CDP_READY_PROBE).toContain("curl");
    expect(CDP_READY_PROBE).toContain(`${CHROMIUM_REMOTE_ADDRESS}:9222`);
    expect(CDP_READY_PROBE).not.toContain("pgrep");
  });

  it("stores the Chromium profile on the workspace bind-mount", () => {
    expect(ENSURE_BROWSER).toContain("--user-data-dir=/workspace/.locus-chrome");
    expect(ENSURE_BROWSER).toContain("mkdir -p /workspace/.locus-chrome");
    expect(ENSURE_BROWSER).toContain(".locus-chrome/");
    expect(ENSURE_BROWSER).not.toContain("--user-data-dir=/tmp/locus-chrome");
    expect(ENSURE_BROWSER.indexOf("mkdir -p /workspace/.locus-chrome")).toBeLessThan(
      ENSURE_BROWSER.indexOf("LOCUS_CHROME_READY"),
    );
  });

  it("maps fetch failed to a DevTools-not-reachable hint", () => {
    expect(describeCdpError(new TypeError("fetch failed"))).toMatch(/DevTools is not reachable/i);
    expect(describeCdpError(new TypeError("fetch failed"))).toMatch(/screenshot|browser_tabs/i);
    expect(describeCdpError(new Error("no page"))).toBe("no page");
  });

  it("explains a fetch failed CDP error instead of a raw TypeError", async () => {
    const driver = new CdpChromiumDriver(
      "abc",
      async () => ({ code: 0, stdout: "LOCUS_CHROME_READY\n", stderr: "" }),
      async () => {
        throw new TypeError("fetch failed");
      },
      { endpoint: async () => ({ host: "127.0.0.1", port: 49152 }) },
    );
    const shot = await driver.handle({ name: "screenshot", args: {} });
    expect(shot.ok).toBe(false);
    expect(shot.output).toMatch(/DevTools is not reachable/i);
    expect(shot.output).not.toBe("fetch failed");
  });

  it("fails clearly when the image has no Chromium", async () => {
    const driver = new CdpChromiumDriver("abc", async () => ({
      code: 42,
      stdout: "LOCUS_NO_CHROME\n",
      stderr: "",
    }));
    const shot = await driver.handle({ name: "screenshot", args: {} });
    expect(shot.ok).toBe(false);
    expect(shot.output).toMatch(/locus\/agent/);
    expect(shot.output).not.toMatch(/playwright/i);
  });

  it("screenshots and clicks over CDP on a loopback tunnel", async () => {
    const calls: string[] = [];
    class FakeSocket {
      listeners: Record<string, Array<(data?: unknown) => void>> = {};
      constructor(_url: string) {}
      on(type: string, fn: (data?: unknown) => void) {
        (this.listeners[type] ??= []).push(fn);
        if (type === "open") queueMicrotask(() => fn());
      }
      send(raw: string) {
        const msg = JSON.parse(raw) as { id: number; method: string };
        calls.push(msg.method);
        const result = msg.method === "Page.captureScreenshot" ? { data: "aGVsbG8=" } : {};
        queueMicrotask(() => {
          for (const fn of this.listeners.message ?? []) {
            fn(JSON.stringify({ id: msg.id, result }));
          }
        });
      }
      close() {}
    }
    const inspects: string[] = [];
    const driver = new CdpChromiumDriver(
      "abc",
      async (argv) => {
        inspects.push(argv.join(" "));
        return { code: 0, stdout: "LOCUS_CHROME_READY\n", stderr: "" };
      },
      async (url) => {
        expect(url).toBe("http://127.0.0.1:49152/json/list");
        return {
          json: async () => [
            { type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/1" },
          ],
        } as Response;
      },
      {
        endpoint: async () => ({ host: "127.0.0.1", port: 49152 }),
        wsCtor: FakeSocket,
      },
    );
    const shot = await driver.handle({ name: "screenshot", args: {} });
    expect(shot.ok).toBe(true);
    expect(shot.screenshotBase64).toBe("aGVsbG8=");
    const click = await driver.handle({ name: "mouse_click", args: { x: 10, y: 20 } });
    expect(click.ok).toBe(true);
    expect(calls).toContain("Page.captureScreenshot");
    expect(calls).toContain("Input.dispatchMouseEvent");
    expect(inspects.some((row) => row.includes("IPAddress"))).toBe(false);
    expect(inspects.some((row) => row.includes("2560x1600x24"))).toBe(true);
    expect(inspects.some((row) => row.includes("--force-device-scale-factor=2"))).toBe(true);
    expect(inspects.some((row) => row.includes("--window-size=1280,800"))).toBe(true);
  });

  it("prints a PDF and records a Chrome tracing JSON", async () => {
    class FakeSocket {
      listeners: Record<string, Array<(data?: unknown) => void>> = {};
      constructor(_url: string) {}
      on(type: string, fn: (data?: unknown) => void) {
        (this.listeners[type] ??= []).push(fn);
        if (type === "open") queueMicrotask(() => fn());
      }
      send(raw: string) {
        const msg = JSON.parse(raw) as { id: number; method: string };
        const emit = (payload: unknown) => {
          for (const fn of this.listeners.message ?? []) fn(JSON.stringify(payload));
        };
        if (msg.method === "Page.printToPDF") {
          queueMicrotask(() =>
            emit({ id: msg.id, result: { data: Buffer.from("%PDF-1.4").toString("base64") } }),
          );
          return;
        }
        if (msg.method === "Tracing.end") {
          queueMicrotask(() => {
            emit({ id: msg.id, result: {} });
            emit({ method: "Tracing.tracingComplete", params: { stream: "1" } });
          });
          return;
        }
        if (msg.method === "IO.read") {
          queueMicrotask(() =>
            emit({
              id: msg.id,
              result: {
                data: Buffer.from('{"traceEvents":[]}').toString("base64"),
                eof: true,
                base64Encoded: true,
              },
            }),
          );
          return;
        }
        queueMicrotask(() => emit({ id: msg.id, result: {} }));
      }
      close() {}
    }
    const driver = new CdpChromiumDriver(
      "abc",
      async () => ({ code: 0, stdout: "LOCUS_CHROME_READY\n", stderr: "" }),
      async () =>
        ({
          json: async () => [
            { type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/1" },
          ],
        }) as Response,
      {
        endpoint: async () => ({ host: "127.0.0.1", port: 49152 }),
        wsCtor: FakeSocket,
      },
    );
    const pdf = await driver.handle({ name: "browser_pdf", args: { save_as_filename: "invoice" } });
    expect(pdf.ok).toBe(true);
    expect(pdf.artifactName).toBe("invoice.pdf");
    expect(pdf.artifactKind).toBe("pdf");
    expect(pdf.artifactBase64).toBeTruthy();
    expect((await driver.handle({ name: "browser_trace", args: { action: "start" } })).ok).toBe(
      true,
    );
    const trace = await driver.handle({
      name: "browser_trace",
      args: { action: "stop", save_as_filename: "walk" },
    });
    expect(trace.ok).toBe(true);
    expect(trace.artifactName).toBe("walk.json");
    expect(Buffer.from(trace.artifactBase64 ?? "", "base64").toString("utf8")).toContain(
      "traceEvents",
    );
  });

  it("relaunches Chromium after the container process dies", async () => {
    const scripts: string[] = [];
    const driver = new CdpChromiumDriver(
      "abc",
      async (argv) => {
        const script = argv.at(-1) ?? "";
        scripts.push(script);
        if (script.includes("json/version") && !script.includes("BIN=")) {
          return { code: 1, stdout: "", stderr: "" };
        }
        return { code: 0, stdout: "LOCUS_CHROME_READY\n", stderr: "" };
      },
      async () =>
        ({
          json: async () => [
            { type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/1" },
          ],
        }) as Response,
      {
        endpoint: async () => ({ host: "127.0.0.1", port: 49152 }),
        wsCtor: class {
          on(type: string, fn: (data?: unknown) => void) {
            if (type === "open") queueMicrotask(() => fn());
            if (type === "message") {
              queueMicrotask(() => fn(JSON.stringify({ id: 1, result: { data: "dA==" } })));
            }
          }
          send(_raw: string) {}
          close() {}
        },
      },
    );
    expect((await driver.handle({ name: "screenshot", args: {} })).ok).toBe(true);
    expect((await driver.handle({ name: "screenshot", args: {} })).ok).toBe(true);
    expect(scripts.filter((s) => s.includes("BIN=")).length).toBe(2);
    expect(scripts.some((s) => s.includes("json/version") && !s.includes("BIN="))).toBe(true);
  });

  it("binds the CDP tunnel to loopback", async () => {
    const tunnel = await listenCdpTunnel("unused-container");
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

  it("lists pages and streams screencast frames over a long-lived CDP socket", async () => {
    const calls: string[] = [];
    const paramsByMethod: Record<string, Record<string, unknown>> = {};
    const pages = parseBrowserPages([
      { type: "page", id: "t1", url: "https://example.com", title: "Example" },
      { type: "background_page", id: "x", url: "chrome://ext" },
    ]);
    expect(pages).toEqual([
      { targetId: "t1", url: "https://example.com", title: "Example", active: true },
    ]);

    class FakeSocket {
      listeners: Record<string, Array<(data?: unknown) => void>> = {};
      constructor(_url: string) {}
      on(type: string, fn: (data?: unknown) => void) {
        (this.listeners[type] ??= []).push(fn);
        if (type === "open") queueMicrotask(() => fn());
      }
      send(raw: string) {
        const msg = JSON.parse(raw) as {
          id: number;
          method: string;
          params?: Record<string, unknown>;
        };
        calls.push(msg.method);
        if (msg.params) paramsByMethod[msg.method] = msg.params;
        queueMicrotask(() => {
          for (const fn of this.listeners.message ?? []) {
            fn(JSON.stringify({ id: msg.id, result: {} }));
            if (msg.method === "Page.startScreencast") {
              fn(
                JSON.stringify({
                  method: "Page.screencastFrame",
                  params: {
                    data: "qq==",
                    sessionId: 7,
                    metadata: { deviceWidth: 1280, deviceHeight: 800, offsetTop: 0 },
                  },
                }),
              );
            }
          }
        });
      }
      close() {}
    }

    const driver = new CdpChromiumDriver(
      "abc",
      async () => ({ code: 0, stdout: "LOCUS_CHROME_READY\n", stderr: "" }),
      async (url) => {
        expect(String(url)).toContain("/json/list");
        return {
          json: async () => [
            {
              type: "page",
              id: "t1",
              url: "https://example.com",
              title: "Example",
              webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/1",
            },
          ],
        } as Response;
      },
      {
        endpoint: async () => ({ host: "127.0.0.1", port: 49152 }),
        wsCtor: FakeSocket,
      },
    );
    const listed = await driver.listPages();
    expect(listed[0]?.url).toBe("https://example.com");
    const frame = await new Promise<{ data: string; metadata: { deviceWidth: number } }>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no frame")), 1000);
        void driver
          .startScreencast((next) => {
            clearTimeout(timer);
            resolve(next);
          })
          .catch(reject);
      },
    );
    expect(frame.data).toBe("qq==");
    expect(frame.metadata.deviceWidth).toBe(1280);
    expect(calls).toContain("Page.startScreencast");
    expect(calls).toContain("Emulation.setDeviceMetricsOverride");
    expect(calls).toContain("Page.screencastFrameAck");
    expect(paramsByMethod["Page.startScreencast"]).toEqual(SCREENCAST_PARAMS);
    expect(SCREENCAST_PARAMS.quality).toBe(90);
    expect(SCREENCAST_PARAMS.maxWidth).toBe(2560);
    expect(SCREENCAST_PARAMS.maxHeight).toBe(1600);
    expect(paramsByMethod["Emulation.setDeviceMetricsOverride"]).toMatchObject({
      width: 1280,
      height: 800,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await driver.stopScreencast();
    expect(calls).toContain("Page.stopScreencast");
  });

  it("starts screencast again after the CDP socket closes", async () => {
    const calls: string[] = [];
    const sockets: Array<{ close: () => void }> = [];
    class FakeSocket {
      listeners: Record<string, Array<(data?: unknown) => void>> = {};
      constructor(_url: string) {
        sockets.push(this);
      }
      on(type: string, fn: (data?: unknown) => void) {
        (this.listeners[type] ??= []).push(fn);
        if (type === "open") queueMicrotask(() => fn());
      }
      send(raw: string) {
        const msg = JSON.parse(raw) as { id: number; method: string };
        calls.push(msg.method);
        queueMicrotask(() => {
          for (const fn of this.listeners.message ?? []) {
            fn(JSON.stringify({ id: msg.id, result: {} }));
          }
        });
      }
      close() {
        for (const fn of this.listeners.close ?? []) fn();
      }
    }
    const driver = new CdpChromiumDriver(
      "abc",
      async () => ({ code: 0, stdout: "LOCUS_CHROME_READY\n", stderr: "" }),
      async () =>
        ({
          json: async () => [
            {
              type: "page",
              webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/1",
            },
          ],
        }) as Response,
      {
        endpoint: async () => ({ host: "127.0.0.1", port: 49152 }),
        wsCtor: FakeSocket,
      },
    );
    await driver.startScreencast(() => undefined);
    expect(calls.filter((name) => name === "Page.startScreencast")).toHaveLength(1);
    sockets[0]?.close();
    await driver.startScreencast(() => undefined);
    expect(calls.filter((name) => name === "Page.startScreencast")).toHaveLength(2);
    await driver.stopScreencast();
  });

  it("dispatches operator mouse events over CDP Input", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    class FakeSocket {
      listeners: Record<string, Array<(data?: unknown) => void>> = {};
      on(type: string, fn: (data?: unknown) => void) {
        (this.listeners[type] ??= []).push(fn);
        if (type === "open") queueMicrotask(() => fn());
      }
      send(raw: string) {
        const msg = JSON.parse(raw) as {
          id: number;
          method: string;
          params: Record<string, unknown>;
        };
        calls.push({ method: msg.method, params: msg.params });
        queueMicrotask(() => {
          for (const fn of this.listeners.message ?? []) {
            fn(JSON.stringify({ id: msg.id, result: {} }));
          }
        });
      }
      close() {}
    }
    const driver = new CdpChromiumDriver(
      "abc",
      async () => ({ code: 0, stdout: "LOCUS_CHROME_READY\n", stderr: "" }),
      async () =>
        ({
          json: async () => [
            { type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/1" },
          ],
        }) as Response,
      {
        endpoint: async () => ({ host: "127.0.0.1", port: 49152 }),
        wsCtor: FakeSocket,
      },
    );
    await driver.dispatchInput({
      type: "input",
      kind: "mousePressed",
      x: 640,
      y: 400,
      button: "left",
    });
    expect(
      calls.some((row) => row.method === "Input.dispatchMouseEvent" && row.params.x === 640),
    ).toBe(true);
  });

  it("snapshots an AX tree and clicks a ref at the box center", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    class FakeSocket {
      listeners: Record<string, Array<(data?: unknown) => void>> = {};
      on(type: string, fn: (data?: unknown) => void) {
        (this.listeners[type] ??= []).push(fn);
        if (type === "open") queueMicrotask(() => fn());
      }
      send(raw: string) {
        const msg = JSON.parse(raw) as {
          id: number;
          method: string;
          params: Record<string, unknown>;
        };
        calls.push({ method: msg.method, params: msg.params });
        let result: Record<string, unknown> = {};
        if (msg.method === "Accessibility.getFullAXTree") {
          result = {
            nodes: [
              {
                ignored: false,
                role: { value: "RootWebArea" },
                name: { value: "Example" },
                backendDOMNodeId: 1,
              },
              {
                ignored: true,
                role: { value: "button" },
                name: { value: "Hidden" },
                backendDOMNodeId: 2,
              },
              {
                ignored: false,
                role: { value: "generic" },
                name: { value: "Wrapper" },
                backendDOMNodeId: 3,
              },
              {
                ignored: false,
                role: { value: "button" },
                name: { value: "Submit" },
                backendDOMNodeId: 42,
              },
            ],
          };
        }
        if (msg.method === "DOM.getBoxModel") {
          result = { model: { content: [100, 50, 200, 50, 200, 90, 100, 90] } };
        }
        queueMicrotask(() => {
          for (const fn of this.listeners.message ?? []) {
            fn(JSON.stringify({ id: msg.id, result }));
          }
        });
      }
      close() {}
    }
    const driver = new CdpChromiumDriver(
      "abc",
      async () => ({ code: 0, stdout: "LOCUS_CHROME_READY\n", stderr: "" }),
      async () =>
        ({
          json: async () => [
            { type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/1" },
          ],
        }) as Response,
      {
        endpoint: async () => ({ host: "127.0.0.1", port: 49152 }),
        wsCtor: FakeSocket,
      },
    );
    const tree = await driver.handle({ name: "browser_snapshot", args: {} });
    expect(tree.ok).toBe(true);
    expect(tree.output).toContain('@e1 button "Submit"');
    expect(tree.output).not.toContain("Hidden");
    expect(tree.output).not.toContain("Wrapper");
    const missing = await driver.handle({ name: "browser_click", args: { ref: "@e99" } });
    expect(missing.ok).toBe(false);
    expect(missing.output).toMatch(/Unknown ref @e99/);
    const click = await driver.handle({ name: "browser_click", args: { ref: "@e1" } });
    expect(click.ok).toBe(true);
    expect(click.output).toContain("150,70");
    expect(
      calls.some(
        (row) =>
          row.method === "Input.dispatchMouseEvent" &&
          row.params.type === "mousePressed" &&
          row.params.x === 150 &&
          row.params.y === 70,
      ),
    ).toBe(true);
    const typed = await driver.handle({
      name: "browser_type",
      args: { ref: "e1", text: "hello" },
    });
    expect(typed.ok).toBe(true);
    expect(
      calls.some((row) => row.method === "Input.insertText" && row.params.text === "hello"),
    ).toBe(true);
    const opened = await driver.handle({
      name: "browser_navigate",
      args: { url: "https://example.com" },
    });
    expect(opened.ok).toBe(true);
    expect(opened.output).toBe("opened https://example.com");
    expect(
      calls.some(
        (row) => row.method === "Page.navigate" && row.params.url === "https://example.com",
      ),
    ).toBe(true);
  });
});

describe("DockerGuestRuntime Chromium routing", () => {
  it("opens a URL in Chromium instead of docker exec", async () => {
    const execs: string[][] = [];
    const runtime = new DockerGuestRuntime(
      {
        id: "v1",
        sessionId: "s1",
        templateId: "docker",
        os: "ubuntu",
        name: "c",
        status: "running",
        diskPath: "",
        runtime: "docker",
        dockerImage: "mcr.microsoft.com/playwright:v1.49.1-noble",
        containerId: "abc",
        createdAt: "",
        updatedAt: "",
      },
      async (argv) => {
        execs.push(argv);
        return { code: 0, stdout: "", stderr: "" };
      },
      {
        handle: async () => ({ ok: true, output: "click" }),
        navigate: async (url) => ({ ok: true, output: `opened ${url}` }),
      },
    );
    const opened = await runtime.execute({
      name: "start_process",
      args: { command: "https://app.local" },
    });
    expect(opened.output).toBe("opened https://app.local");
    expect(execs).toEqual([]);
  });
});
