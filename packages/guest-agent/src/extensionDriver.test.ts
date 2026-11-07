import { describe, expect, it } from "vitest";
import { LIVE_CHROME_DISCONNECTED, LIVE_CHROME_UNSUPPORTED } from "@locus/shared";
import { ExtensionChromiumDriver, extensionFrameFromMessage } from "./extensionDriver.js";

describe("ExtensionChromiumDriver", () => {
  it("fails closed when the extension is disconnected", async () => {
    const driver = new ExtensionChromiumDriver({
      connected: () => false,
      call: async () => ({ ok: true, output: "nope" }),
      listTabs: async () => [],
      startScreencast: async () => undefined,
      stopScreencast: async () => undefined,
      dispatchInput: async () => undefined,
    });
    expect((await driver.handle({ name: "browser_snapshot", args: {} })).output).toBe(
      LIVE_CHROME_DISCONNECTED,
    );
    expect(await driver.listPages()).toEqual([]);
  });

  it("refuses PDF/trace/download and forwards the rest", async () => {
    const calls: string[] = [];
    const driver = new ExtensionChromiumDriver({
      connected: () => true,
      call: async (req) => {
        calls.push(req.name);
        return { ok: true, output: req.name };
      },
      listTabs: async () => [{ targetId: "1", url: "https://example.com", active: true }],
      startScreencast: async () => undefined,
      stopScreencast: async () => undefined,
      dispatchInput: async () => undefined,
    });
    expect((await driver.handle({ name: "browser_pdf", args: {} })).output).toBe(
      LIVE_CHROME_UNSUPPORTED,
    );
    expect((await driver.handle({ name: "browser_snapshot", args: {} })).ok).toBe(true);
    expect(calls).toEqual(["browser_snapshot"]);
    expect((await driver.listPages())[0]?.url).toBe("https://example.com");
  });

  it("maps screencast frames", () => {
    const frame = extensionFrameFromMessage({
      data: "abc",
      metadata: { deviceWidth: 800, deviceHeight: 600 },
    });
    expect(frame?.metadata.deviceWidth).toBe(800);
    expect(extensionFrameFromMessage({ data: "" })).toBeUndefined();
  });
});
