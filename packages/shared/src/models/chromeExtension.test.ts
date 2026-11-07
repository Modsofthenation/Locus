import { describe, expect, it } from "vitest";
import {
  formatChromeExtensionToken,
  formatLiveChrome,
  generateChromeExtensionToken,
  isChromeExtensionApiPath,
  isChromeExtensionOrigin,
  isLiveChromeRestrictedUrl,
  parseChromeExtensionClientMessage,
  parseChromeExtensionServerMessage,
  sessionLiveChrome,
} from "./chromeExtension.js";

describe("chrome extension protocol", () => {
  it("formats and mints pairing tokens", () => {
    expect(generateChromeExtensionToken(() => "aabbccddeeff00112233445566778899")).toBe(
      "cx_aabbccddeeff00112233445566778899",
    );
    expect(formatChromeExtensionToken("cx_aabbccddeeff0011")).toBe("AABB-CCDD-EEFF-0011");
  });

  it("accepts chrome-extension origins and API paths only", () => {
    expect(isChromeExtensionOrigin("chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef")).toBe(
      true,
    );
    expect(isChromeExtensionOrigin("http://127.0.0.1:7420")).toBe(false);
    expect(isChromeExtensionOrigin("https://evil.example")).toBe(false);
    expect(isChromeExtensionApiPath("/api/chrome-extension")).toBe(true);
    expect(isChromeExtensionApiPath("/api/chrome-extension/rotate")).toBe(true);
    expect(isChromeExtensionApiPath("/ws/chrome-extension")).toBe(true);
    expect(isChromeExtensionApiPath("/api/health")).toBe(false);
    expect(isChromeExtensionApiPath("/ws/browser/s1")).toBe(false);
  });

  it("enables live Chrome only for local host agents", () => {
    expect(sessionLiveChrome({})).toBe(false);
    expect(sessionLiveChrome({ liveChrome: true })).toBe(false);
    expect(sessionLiveChrome({ liveChrome: true, runtime: "docker" })).toBe(false);
    expect(sessionLiveChrome({ liveChrome: true, runtime: "host", placement: "worker" })).toBe(
      false,
    );
    expect(sessionLiveChrome({ liveChrome: true, runtime: "host" })).toBe(true);
    expect(formatLiveChrome(true)).toBe("On");
    expect(formatLiveChrome(false)).toBe("Off");
  });

  it("blocks privileged browser URLs", () => {
    expect(isLiveChromeRestrictedUrl("https://example.com")).toBe(false);
    expect(isLiveChromeRestrictedUrl("chrome://settings")).toBe(true);
    expect(isLiveChromeRestrictedUrl("edge://extensions")).toBe(true);
    expect(isLiveChromeRestrictedUrl("chrome-extension://abc/popup.html")).toBe(true);
    expect(isLiveChromeRestrictedUrl("about:blank")).toBe(true);
  });

  it("parses extension socket envelopes", () => {
    expect(parseChromeExtensionClientMessage(`{"type":"hello","token":"cx_ab"}`)).toEqual({
      type: "hello",
      token: "cx_ab",
    });
    expect(parseChromeExtensionClientMessage(`{"type":"nope"}`)).toBeUndefined();
    expect(parseChromeExtensionServerMessage(`{"type":"hello-ok"}`)).toEqual({ type: "hello-ok" });
    expect(
      parseChromeExtensionServerMessage(`{"type":"command","id":"1","name":"browser_tabs"}`),
    ).toMatchObject({ type: "command", id: "1", name: "browser_tabs" });
  });
});
