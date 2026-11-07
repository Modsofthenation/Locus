import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserPane } from "./BrowserPane";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeWebSocket {
  static OPEN = 1;
  static last: FakeWebSocket | null = null;
  readyState = 1;
  sent: string[] = [];
  private listeners: Record<string, Array<(data?: unknown) => void>> = {};
  constructor(_url: string) {
    FakeWebSocket.last = this;
    queueMicrotask(() => this.emit("open"));
  }
  addEventListener(type: string, fn: (data?: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  emit(type: string, data?: unknown) {
    for (const fn of this.listeners[type] ?? []) fn(data);
  }
}

vi.mock("@/lib/api", () => ({
  browserWsUrl: (id: string) => `ws://browser.test/ws/browser/${id}`,
}));

describe("BrowserPane", () => {
  let host: HTMLDivElement;
  let root: Root;
  const previousWs = globalThis.WebSocket;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    globalThis.WebSocket = previousWs;
    FakeWebSocket.last = null;
    vi.restoreAllMocks();
  });

  function render(watch = false) {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = <BrowserPane sessionId="s1" overlay={null} watch={watch} />;
    act(() => {
      root.render(node);
    });
  }

  it("shows a restricted-jail chip and download names from the live stream", async () => {
    render();
    const ws = FakeWebSocket.last;
    expect(ws).toBeTruthy();
    act(() => {
      ws!.emit("message", {
        data: JSON.stringify({
          type: "status",
          controller: "agent",
          ready: true,
          jail: "restricted",
          deniedHost: "evil.example",
        }),
      });
      ws!.emit("message", {
        data: JSON.stringify({ type: "downloads", files: ["report.csv"] }),
      });
    });
    expect(host.textContent).toMatch(/Blocked evil.example/);
    expect(host.textContent).not.toMatch(/Your Chrome/);
    expect(host.textContent).toMatch(/report.csv/);
    const download = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("report.csv"),
    );
    expect(download).toBeTruthy();
    act(() => {
      download!.click();
    });
    expect(
      ws!.sent.some((row) => row.includes("open-download") && row.includes("report.csv")),
    ).toBe(true);
  });

  it("opens persisted downloads with a same-origin <a download> click, not window.open", async () => {
    const clicks: string[] = [];
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag.toLowerCase() === "a") {
        el.click = () => {
          clicks.push(`${el.getAttribute("download")}|${el.getAttribute("href")}`);
        };
      }
      return el;
    });
    const open = vi.spyOn(window, "open");
    render();
    const ws = FakeWebSocket.last;
    act(() => {
      ws!.emit("message", {
        data: JSON.stringify({
          type: "downloads",
          files: ["report.csv"],
          opened: "report.csv",
        }),
      });
    });
    expect(open).not.toHaveBeenCalled();
    expect(clicks).toEqual(["report.csv|/api/sessions/s1/artifacts/report.csv?kind=download"]);
  });

  it("watch mode hides takeover and ignores operator input", async () => {
    render(true);
    expect(host.textContent).toMatch(/Watch/);
    expect(host.textContent).not.toMatch(/Take over browser/);
    const ws = FakeWebSocket.last;
    act(() => {
      ws!.emit("message", {
        data: JSON.stringify({ type: "status", controller: "operator", ready: true }),
      });
      ws!.emit("message", {
        data: JSON.stringify({
          type: "frame",
          mime: "image/jpeg",
          data: "QQ==",
          metadata: { deviceWidth: 1280, deviceHeight: 800 },
        }),
      });
    });
    expect(host.textContent).not.toMatch(/Take over browser/);
    expect(host.textContent).not.toMatch(/Hand back/);
    const frame = host.querySelector(".browser-frame");
    expect(frame).toBeTruthy();
    act(() => {
      frame!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10 }),
      );
    });
    expect(ws!.sent.some((row) => row.includes("input") || row.includes("takeover"))).toBe(false);
  });

  it("labels the pane when the stream is the operator's real Chrome", async () => {
    render();
    const ws = FakeWebSocket.last;
    act(() => {
      ws!.emit("message", {
        data: JSON.stringify({
          type: "status",
          controller: "agent",
          ready: true,
          source: "extension",
        }),
      });
    });
    expect(host.textContent).toMatch(/Your Chrome/);
  });
});
