import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { ChromiumDriver } from "@locus/guest-agent";
import type { AgentSession, VmInstance } from "@locus/shared";
import { BrowserStreams } from "./browserStream.js";
import { GuestHub } from "../core/guests.js";

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

describe("BrowserStreams", () => {
  it("fans screencast frames to viewers and stops when the last one leaves", async () => {
    const onFrames: Array<Parameters<NonNullable<ChromiumDriver["startScreencast"]>>[0]> = [];
    const stopped: string[] = [];
    const vm: VmInstance = {
      id: "v1",
      sessionId: "s1",
      templateId: "docker",
      os: "ubuntu",
      name: "c",
      status: "ready",
      runtime: "docker",
      dockerImage: "locus/agent",
      containerId: "abc",
      diskPath: "/tmp/ws",
      createdAt: "",
      updatedAt: "",
    };
    const session: AgentSession = {
      id: "s1",
      title: "t",
      os: "ubuntu",
      templateId: "docker",
      runtime: "docker",
      providerId: "p",
      model: "m",
      status: "idle",
      vmId: "v1",
      messages: [],
      createdAt: "",
      updatedAt: "",
    };
    const guests = new GuestHub();
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
        }) satisfies ChromiumDriver,
    });
    const streams = new BrowserStreams(guests, async () => ({ session, vm }));
    const ws = new FakeSocket();
    streams.attach("s1", ws as unknown as WebSocket);
    await new Promise((r) => setTimeout(r, 30));
    expect(onFrames).toHaveLength(1);
    expect(ws.sent.some((row) => row.includes('"ready":true'))).toBe(true);
    expect(ws.sent.some((row) => row.includes("https://example.com"))).toBe(true);
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

  it("starts one screencast when two viewers attach at once", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: string[] = [];
    const vm: VmInstance = {
      id: "v1",
      sessionId: "s1",
      templateId: "docker",
      os: "ubuntu",
      name: "c",
      status: "ready",
      runtime: "docker",
      dockerImage: "locus/agent",
      containerId: "abc",
      diskPath: "/tmp/ws",
      createdAt: "",
      updatedAt: "",
    };
    const session: AgentSession = {
      id: "s1",
      title: "t",
      os: "ubuntu",
      templateId: "docker",
      runtime: "docker",
      providerId: "p",
      model: "m",
      status: "idle",
      vmId: "v1",
      messages: [],
      createdAt: "",
      updatedAt: "",
    };
    const guests = new GuestHub();
    Object.assign(guests.forVm(vm), {
      chromium: () =>
        ({
          handle: async () => ({ ok: true, output: "" }),
          navigate: async () => ({ ok: true, output: "" }),
          startScreencast: async () => {
            started.push("start");
          },
          stopScreencast: async () => undefined,
          listPages: async () => [],
        }) satisfies ChromiumDriver,
    });
    const streams = new BrowserStreams(guests, async () => {
      await gate;
      return { session, vm };
    });
    streams.attach("s1", new FakeSocket() as unknown as WebSocket);
    streams.attach("s1", new FakeSocket() as unknown as WebSocket);
    await new Promise((r) => setTimeout(r, 20));
    expect(started).toEqual([]);
    release();
    await new Promise((r) => setTimeout(r, 30));
    expect(started).toEqual(["start"]);
  });

  it("keeps the socket open when Chromium is unavailable", async () => {
    const vm: VmInstance = {
      id: "v1",
      sessionId: "s1",
      templateId: "docker",
      os: "ubuntu",
      name: "c",
      status: "ready",
      runtime: "docker",
      dockerImage: "locus/agent",
      containerId: "abc",
      diskPath: "/tmp/ws",
      createdAt: "",
      updatedAt: "",
    };
    const session: AgentSession = {
      id: "s1",
      title: "t",
      os: "ubuntu",
      templateId: "docker",
      runtime: "docker",
      providerId: "p",
      model: "m",
      status: "idle",
      vmId: "v1",
      messages: [],
      createdAt: "",
      updatedAt: "",
    };
    const streams = new BrowserStreams(new GuestHub(), async () => ({
      session,
      vm,
    }));
    const ws = new FakeSocket();
    streams.attach("s1", ws as unknown as WebSocket);
    await new Promise((r) => setTimeout(r, 30));
    expect(ws.readyState).toBe(1);
    expect(ws.sent.some((row) => row.includes("real Docker engine"))).toBe(true);
  });

  it("ignores input while the agent has the lock and dispatches after takeover", async () => {
    const inputs: unknown[] = [];
    const vm: VmInstance = {
      id: "v1",
      sessionId: "s1",
      templateId: "docker",
      os: "ubuntu",
      name: "c",
      status: "ready",
      runtime: "docker",
      dockerImage: "locus/agent",
      containerId: "abc",
      diskPath: "/tmp/ws",
      createdAt: "",
      updatedAt: "",
    };
    const session: AgentSession = {
      id: "s1",
      title: "t",
      os: "ubuntu",
      templateId: "docker",
      runtime: "docker",
      providerId: "p",
      model: "m",
      status: "idle",
      vmId: "v1",
      messages: [],
      createdAt: "",
      updatedAt: "",
    };
    const guests = new GuestHub();
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
    const streams = new BrowserStreams(guests, async () => ({ session, vm }));
    const ws = new FakeSocket();
    streams.attach("s1", ws as unknown as WebSocket);
    await new Promise((r) => setTimeout(r, 20));
    ws.emit(
      "message",
      JSON.stringify({ type: "input", kind: "mousePressed", x: 640, y: 400, button: "left" }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(inputs).toEqual([]);
    session.browserControl = "human";
    ws.emit(
      "message",
      JSON.stringify({ type: "input", kind: "mousePressed", x: 640, y: 400, button: "left" }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(inputs).toEqual([
      { type: "input", kind: "mousePressed", x: 640, y: 400, button: "left" },
    ]);
  });

  it("flags a restricted-jail URL and lists Chromium downloads", async () => {
    const vm: VmInstance = {
      id: "v1",
      sessionId: "s1",
      templateId: "docker",
      os: "ubuntu",
      name: "c",
      status: "ready",
      runtime: "docker",
      dockerImage: "locus/agent",
      containerId: "abc",
      diskPath: "/tmp/ws",
      createdAt: "",
      updatedAt: "",
    };
    const session: AgentSession = {
      id: "s1",
      title: "t",
      os: "ubuntu",
      templateId: "docker",
      runtime: "docker",
      network: "restricted",
      providerId: "p",
      model: "m",
      status: "idle",
      vmId: "v1",
      messages: [],
      createdAt: "",
      updatedAt: "",
    };
    const guests = new GuestHub();
    Object.assign(guests.forVm(vm), {
      chromium: () =>
        ({
          handle: async () => ({ ok: true, output: "" }),
          navigate: async () => ({ ok: true, output: "" }),
          startScreencast: async () => undefined,
          stopScreencast: async () => undefined,
          listPages: async () => [
            { targetId: "t1", url: "https://evil.example/login", title: "Login", active: true },
          ],
          listDownloads: async () => ["report.csv"],
        }) satisfies ChromiumDriver,
    });
    const streams = new BrowserStreams(guests, async () => ({ session, vm }), {
      takeover: async () => undefined,
      handback: async () => undefined,
      allowHosts: async () => ["github.com"],
    });
    const ws = new FakeSocket();
    streams.attach("s1", ws as unknown as WebSocket);
    await new Promise((r) => setTimeout(r, 40));
    expect(ws.sent.some((row) => row.includes("evil.example"))).toBe(true);
    expect(ws.sent.some((row) => row.includes("deniedHost"))).toBe(true);
    expect(ws.sent.some((row) => row.includes("report.csv"))).toBe(true);
    expect(ws.sent.some((row) => row.includes('"type":"downloads"'))).toBe(true);
  });
});
