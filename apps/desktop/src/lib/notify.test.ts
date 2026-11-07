import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isFinishedAutomationRun,
  notifyTurnDone,
  shouldMarkAutomationUnread,
  shouldMarkUnread,
  shouldNotifyAutomationRun,
  shouldNotifyNeedsYou,
  shouldNotifyTurn,
} from "./notify";

describe("turn-done notifications", () => {
  it("marks unread only when another session is selected", () => {
    expect(shouldMarkUnread("a", "b")).toBe(true);
    expect(shouldMarkUnread("a", "a")).toBe(false);
    expect(shouldMarkUnread("a", null)).toBe(true);
  });

  it("notifies when the window is hidden or another session is selected", () => {
    expect(shouldNotifyTurn("a", "a", false)).toBe(false);
    expect(shouldNotifyTurn("a", "a", true)).toBe(true);
    expect(shouldNotifyTurn("a", "b", false)).toBe(true);
    expect(shouldNotifyTurn("a", null, false)).toBe(true);
  });

  it("stays silent when the agent-turns pref is off", () => {
    expect(shouldNotifyTurn("a", "b", true, false)).toBe(false);
    expect(shouldNotifyTurn("a", "a", true, false)).toBe(false);
    expect(shouldNotifyTurn("a", "b", true, true)).toBe(true);
  });

  it("notifies a new gate the same way as a finished turn", () => {
    expect(shouldNotifyNeedsYou("a", "a", false)).toBe(false);
    expect(shouldNotifyNeedsYou("a", "a", true)).toBe(true);
    expect(shouldNotifyNeedsYou("a", "b", false)).toBe(true);
    expect(shouldNotifyNeedsYou("a", null, false)).toBe(true);
    expect(shouldNotifyNeedsYou("a", "b", true, false)).toBe(false);
  });
});

describe("automation-run notifications", () => {
  it("treats succeeded, failed, and skipped as finished", () => {
    expect(isFinishedAutomationRun("running")).toBe(false);
    expect(isFinishedAutomationRun("queued")).toBe(false);
    expect(isFinishedAutomationRun("succeeded")).toBe(true);
    expect(isFinishedAutomationRun("failed")).toBe(true);
    expect(isFinishedAutomationRun("skipped")).toBe(true);
  });

  it("marks unread unless that automation is already open", () => {
    expect(shouldMarkAutomationUnread("a", "a", "automations")).toBe(false);
    expect(shouldMarkAutomationUnread("a", "a", "agents")).toBe(true);
    expect(shouldMarkAutomationUnread("a", "b", "automations")).toBe(true);
    expect(shouldMarkAutomationUnread("a", null, "automations")).toBe(true);
  });

  it("notifies when the window is hidden or another automation is selected", () => {
    expect(shouldNotifyAutomationRun("a", "a", "automations", false)).toBe(false);
    expect(shouldNotifyAutomationRun("a", "a", "automations", true)).toBe(true);
    expect(shouldNotifyAutomationRun("a", "a", "agents", false)).toBe(true);
    expect(shouldNotifyAutomationRun("a", "b", "automations", false)).toBe(true);
    expect(shouldNotifyAutomationRun("a", "b", "automations", true, false)).toBe(false);
  });
});

describe("notifyTurnDone permission", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubNotification(permission: NotificationPermission) {
    const requestPermission = vi.fn(async () => "granted" as NotificationPermission);
    const NotificationMock = vi.fn();
    Object.assign(NotificationMock, { permission, requestPermission });
    vi.stubGlobal("Notification", NotificationMock);
    return { requestPermission, NotificationMock };
  }

  it("does not request permission when the source is muted", () => {
    const { requestPermission, NotificationMock } = stubNotification("default");
    notifyTurnDone("Agent", "Turn finished", false);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(NotificationMock).not.toHaveBeenCalled();
  });

  it("does not request permission when every source would be skipped", () => {
    const { requestPermission } = stubNotification("default");
    notifyTurnDone("Agent", "Turn finished", false);
    notifyTurnDone("Needs you", "Needs you", false);
    notifyTurnDone("Slack", "mention", false);
    notifyTurnDone("Automation", "Run succeeded", false);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("requests permission on the first needed notify", () => {
    const { requestPermission } = stubNotification("default");
    notifyTurnDone("Agent");
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("shows immediately when permission is already granted", () => {
    const { requestPermission, NotificationMock } = stubNotification("granted");
    notifyTurnDone("Agent", "Turn finished");
    expect(requestPermission).not.toHaveBeenCalled();
    expect(NotificationMock).toHaveBeenCalledWith("Agent", {
      body: "Turn finished",
      silent: false,
    });
  });
});
