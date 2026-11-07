import { describe, expect, it } from "vitest";
import { api, browserWsUrl, displayWsUrl, terminalWsUrl, workspaceTerminalWsUrl } from "./api";
import { sshConnectCommand } from "./guestConnect";
import { scaleClick } from "./pointer";

describe("scaleClick", () => {
  it("maps the image box onto guest screen coordinates", () => {
    expect(
      scaleClick(
        50,
        25,
        { left: 0, top: 0, width: 100, height: 50 },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({ x: 960, y: 540 });
  });
});

describe("displayWsUrl", () => {
  it("builds a same-origin VNC websocket URL", () => {
    expect(displayWsUrl("abc", { protocol: "http:", host: "127.0.0.1:5173" })).toBe(
      "ws://127.0.0.1:5173/ws/display/abc",
    );
    expect(displayWsUrl("abc", { protocol: "https:", host: "locus.local" })).toBe(
      "wss://locus.local/ws/display/abc",
    );
    expect(browserWsUrl("sess-1", { protocol: "http:", host: "127.0.0.1:5173" })).toBe(
      "ws://127.0.0.1:5173/ws/browser/sess-1",
    );
    expect(terminalWsUrl("abc", { protocol: "http:", host: "127.0.0.1:5173" })).toBe(
      "ws://127.0.0.1:5173/ws/terminal/abc",
    );
    expect(workspaceTerminalWsUrl("s1", { protocol: "http:", host: "127.0.0.1:5173" })).toBe(
      "ws://127.0.0.1:5173/ws/workspace-terminal/s1",
    );
    expect(
      workspaceTerminalWsUrl(
        "s1",
        { protocol: "http:", host: "127.0.0.1:5173" },
        "packages/app",
        "2",
      ),
    ).toBe("ws://127.0.0.1:5173/ws/workspace-terminal/s1?cwd=packages%2Fapp&terminal=2");
    expect(api.shareFileUrl("hello.txt")).toBe("/api/share/files/hello.txt");
    expect(api.shareFileUrl("a b.txt")).toBe("/api/share/files/a%20b.txt");
  });
});

describe("sshConnectCommand", () => {
  it("formats an ssh command from the guest endpoint", () => {
    expect(sshConnectCommand({ username: "locus", host: "127.0.0.1", port: 2222 })).toBe(
      "ssh -p 2222 locus@127.0.0.1",
    );
  });
});
