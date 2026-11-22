import { describe, expect, it } from "vitest";
import { computerKey, windowsSendKey, x11Key } from "./keyboard.js";
import { toolNeedsApproval } from "./tools.js";
import { parseBrowserClientMessage } from "./browser.js";
import { stickyAllowEntry, parseApprovalPolicy } from "./approval.js";
import { mergeApprovalPolicy } from "./autonomy.js";

describe("computer keyboard and effect permissions", () => {
  it("validates operator input and preserves keyboard modifiers", () => {
    expect(
      parseBrowserClientMessage(
        JSON.stringify({ type: "input", kind: "keyDown", key: "a", code: "KeyA", modifiers: 2 }),
      ),
    ).toMatchObject({ modifiers: 2 });
    for (const message of [
      { type: "input", kind: "Runtime.evaluate" },
      { type: "input", kind: "keyDown", key: { script: "bad" } },
      { type: "input", kind: "mouseMoved", x: "1" },
      { type: "input", kind: "keyDown", key: "a", modifiers: 16 },
    ])
      expect(parseBrowserClientMessage(JSON.stringify(message))).toBeUndefined();
  });
  it("translates shortcuts consistently without treating text as keys", () => {
    expect(computerKey("CTRL+Shift+A")).toEqual({
      key: "A",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      modifiers: 10,
    });
    expect(computerKey("ctrl+ArrowLeft").key).toBe("ArrowLeft");
    expect(x11Key("ctrl+Enter")).toBe("ctrl+Return");
    expect(windowsSendKey("ctrl+a")).toBe("^a");
    expect(windowsSendKey("alt+F4")).toBe("%{F4}");
    expect(windowsSendKey("{ENTER}")).toBe("{ENTER}");
  });
  it("requires scoped authorization for external GUI effects", () => {
    expect(stickyAllowEntry("browser_action", { effect: "submit" })).toBe(
      "browser_action(effect:submit)",
    );
    const strict = mergeApprovalPolicy(
      {},
      parseApprovalPolicy({
        confirmComputerActions: true,
        autoAllow: ["browser_action(effect:submit)"],
      }),
    );
    expect(toolNeedsApproval("browser_action", strict, { effect: "submit" })).toBe(false);
    expect(toolNeedsApproval("browser_action", strict, { effect: "local" })).toBe(true);
    expect(toolNeedsApproval("key", strict, { key: "Enter" })).toBe(true);
    expect(toolNeedsApproval("browser_snapshot", strict, {})).toBe(false);
    expect(toolNeedsApproval("browser_tabs", strict, { action: "list" })).toBe(false);
    expect(toolNeedsApproval("browser_tabs", strict, { action: "new" })).toBe(true);
    expect(toolNeedsApproval("browser_navigate", strict, { url: "https://example.com" })).toBe(
      true,
    );
    expect(toolNeedsApproval("exec", strict, { command: "https://example.com" })).toBe(true);
    expect(toolNeedsApproval("browser_action", {}, { action: "fill", effect: "local" })).toBe(
      false,
    );
    expect(
      toolNeedsApproval("browser_action", { autoAllow: ["browser_action"] }, { effect: "submit" }),
    ).toBe(true);
    expect(
      toolNeedsApproval(
        "browser_action",
        { autoAllow: ["browser_action(effect:submit)"] },
        { effect: "submit" },
      ),
    ).toBe(false);
    expect(
      toolNeedsApproval(
        "browser_action",
        { autoAllow: ["browser_action(effect:submit)"] },
        { effect: "destructive" },
      ),
    ).toBe(true);
    expect(toolNeedsApproval("key", { autoAllow: ["install"] }, { effect: "upload" })).toBe(true);
  });
});
