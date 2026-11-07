import { describe, expect, it } from "vitest";
import {
  approvalTimeoutMs,
  automationChatLimit,
  guestBootTimeoutMs,
  promptQueueLimit,
  anyDesktopNotifyEnabled,
  desktopNotifyAllowed,
  desktopNotifyEnabled,
  editorFontSize,
  inQuietHours,
  parseDesktopNotifyPrefs,
  parseFormatOnSave,
  parseShowMinimap,
  parseDiffLayout,
  parseChatDensity,
  parseNotifyPref,
  parseQuietTime,
} from "./config.js";

describe("editor prefs", () => {
  it("clamps font size and defaults format-on-save to on", () => {
    expect(editorFontSize(undefined)).toBe(12);
    expect(editorFontSize(9)).toBe(10);
    expect(editorFontSize(22)).toBe(20);
    expect(editorFontSize(14.4)).toBe(14);
    expect(parseFormatOnSave(undefined)).toBe(true);
    expect(parseFormatOnSave(false)).toBe(false);
    expect(parseFormatOnSave(true)).toBe(true);
    expect(parseShowMinimap(undefined)).toBe(true);
    expect(parseShowMinimap(false)).toBe(false);
    expect(parseDiffLayout(undefined)).toBe("unified");
    expect(parseDiffLayout("split")).toBe("split");
    expect(parseDiffLayout("wide")).toBe("unified");
    expect(parseChatDensity(undefined)).toBe("compact");
    expect(parseChatDensity("comfortable")).toBe("comfortable");
    expect(parseChatDensity("compact")).toBe("compact");
    expect(parseChatDensity("dense")).toBe("dense");
    expect(parseChatDensity("roomy")).toBe("compact");
  });
});

describe("desktop notify prefs", () => {
  it("defaults missing and junk values to on", () => {
    expect(parseNotifyPref(undefined)).toBe(true);
    expect(parseNotifyPref(true)).toBe(true);
    expect(parseNotifyPref(null)).toBe(true);
    expect(parseNotifyPref("false")).toBe(true);
    expect(parseNotifyPref(0)).toBe(true);
    expect(parseNotifyPref(false)).toBe(false);
  });

  it("parses a raw config object with defaults true", () => {
    expect(parseDesktopNotifyPrefs(undefined)).toEqual({
      notifyAgents: true,
      notifyNeedsYou: true,
      notifySlack: true,
      notifyAutomations: true,
      notifyAutomationsFailedOnly: false,
    });
    expect(parseDesktopNotifyPrefs({ notifySlack: false, notifyAgents: "yes" })).toEqual({
      notifyAgents: true,
      notifyNeedsYou: true,
      notifySlack: false,
      notifyAutomations: true,
      notifyAutomationsFailedOnly: false,
    });
    expect(
      parseDesktopNotifyPrefs({ notifyAutomationsFailedOnly: true }).notifyAutomationsFailedOnly,
    ).toBe(true);
  });

  it("gates each source and any-enabled", () => {
    expect(desktopNotifyEnabled(undefined, "agents")).toBe(true);
    expect(desktopNotifyEnabled({ notifyAgents: false }, "agents")).toBe(false);
    expect(desktopNotifyEnabled({ notifyAgents: false }, "slack")).toBe(true);
    expect(anyDesktopNotifyEnabled(undefined)).toBe(true);
    expect(
      anyDesktopNotifyEnabled({
        notifyAgents: false,
        notifyNeedsYou: false,
        notifySlack: false,
        notifyAutomations: false,
      }),
    ).toBe(false);
    expect(
      anyDesktopNotifyEnabled({
        notifyAgents: false,
        notifyNeedsYou: false,
        notifySlack: true,
        notifyAutomations: false,
      }),
    ).toBe(true);
  });

  it("parses quiet hours and wraps overnight", () => {
    expect(parseQuietTime("9:05")).toBe("09:05");
    expect(parseQuietTime("22:00")).toBe("22:00");
    expect(parseQuietTime("25:00")).toBeUndefined();
    expect(parseQuietTime("nope")).toBeUndefined();
    expect(parseDesktopNotifyPrefs({ notifyQuietStart: "22:00", notifyQuietEnd: "8:00" })).toEqual({
      notifyAgents: true,
      notifyNeedsYou: true,
      notifySlack: true,
      notifyAutomations: true,
      notifyAutomationsFailedOnly: false,
      notifyQuietStart: "22:00",
      notifyQuietEnd: "08:00",
    });
    expect(parseDesktopNotifyPrefs({ notifyQuietStart: "22:00" }).notifyQuietStart).toBeUndefined();
    const evening = new Date(2026, 7, 31, 23, 0);
    const morning = new Date(2026, 8, 1, 7, 30);
    const noon = new Date(2026, 8, 1, 12, 0);
    expect(inQuietHours(evening, "22:00", "08:00")).toBe(true);
    expect(inQuietHours(morning, "22:00", "08:00")).toBe(true);
    expect(inQuietHours(noon, "22:00", "08:00")).toBe(false);
    expect(inQuietHours(noon, "12:00", "13:00")).toBe(true);
    expect(inQuietHours(noon, "12:00", "12:00")).toBe(false);
    expect(
      desktopNotifyAllowed(
        { notifyQuietStart: "22:00", notifyQuietEnd: "08:00" },
        "agents",
        evening,
      ),
    ).toBe(false);
    expect(desktopNotifyAllowed({ notifyAgents: false }, "agents", noon)).toBe(false);
    expect(
      desktopNotifyAllowed({ notifyQuietStart: "22:00", notifyQuietEnd: "08:00" }, "agents", noon),
    ).toBe(true);
  });
});

describe("advanced limit helpers", () => {
  it("clamps boot, approval, queue, and automation-chat limits", () => {
    expect(guestBootTimeoutMs(undefined)).toBe(15 * 60_000);
    expect(guestBootTimeoutMs(1_000)).toBe(15 * 60_000);
    expect(guestBootTimeoutMs(45_000)).toBe(45_000);
    expect(guestBootTimeoutMs(2 * 60 * 60_000)).toBe(60 * 60_000);
    expect(approvalTimeoutMs(undefined)).toBe(30 * 60_000);
    expect(approvalTimeoutMs(10_000)).toBe(30 * 60_000);
    expect(approvalTimeoutMs(120_000)).toBe(120_000);
    expect(promptQueueLimit(undefined)).toBe(32);
    expect(promptQueueLimit(0)).toBe(32);
    expect(promptQueueLimit(8)).toBe(8);
    expect(promptQueueLimit(999)).toBe(256);
    expect(automationChatLimit(undefined)).toBe(60);
    expect(automationChatLimit(3)).toBe(3);
    expect(automationChatLimit(900)).toBe(500);
  });
});
