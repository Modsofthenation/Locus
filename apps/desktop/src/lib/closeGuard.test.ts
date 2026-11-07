import { describe, expect, it } from "vitest";
import {
  activeAgents,
  closeConfirmCopy,
  desktopBridge,
  isActiveAgent,
  shouldConfirmClose,
  type CloseGuardSession,
} from "./closeGuard";

function session(
  status: CloseGuardSession["status"],
  title = "Nightly review",
  subagents?: CloseGuardSession["subagents"],
): CloseGuardSession {
  return { status, title, subagents };
}

describe("isActiveAgent", () => {
  it("treats running and provisioning sessions as active", () => {
    expect(isActiveAgent(session("running"))).toBe(true);
    expect(isActiveAgent(session("provisioning"))).toBe(true);
  });

  it("treats idle sessions with a running sub-agent as active", () => {
    expect(isActiveAgent(session("idle", "Parent", [{ status: "running" }]))).toBe(true);
  });

  it("ignores idle, stopped, draft, and error sessions", () => {
    expect(isActiveAgent(session("idle"))).toBe(false);
    expect(isActiveAgent(session("stopped"))).toBe(false);
    expect(isActiveAgent(session("draft"))).toBe(false);
    expect(isActiveAgent(session("error"))).toBe(false);
    expect(isActiveAgent(session("idle", "Parent", [{ status: "done" }]))).toBe(false);
  });
});

describe("shouldConfirmClose", () => {
  it("is true when any session is active", () => {
    expect(shouldConfirmClose([session("idle"), session("running")])).toBe(true);
    expect(shouldConfirmClose([session("idle")])).toBe(false);
    expect(shouldConfirmClose([])).toBe(false);
  });

  it("lists only the active sessions", () => {
    const running = session("running", "Fix login");
    expect(activeAgents([session("idle", "Quiet"), running])).toEqual([running]);
  });
});

describe("closeConfirmCopy", () => {
  it("uses singular copy for one agent", () => {
    expect(closeConfirmCopy([{ title: "Fix login" }])).toEqual({
      title: "Active agent",
      body: "There is currently an active agent. Are you sure you want to close?",
    });
  });

  it("counts several active agents", () => {
    expect(closeConfirmCopy([{ title: "A" }, { title: "B" }])).toEqual({
      title: "Active agents",
      body: "There are currently 2 active agents. Are you sure you want to close?",
    });
  });
});

describe("desktopBridge", () => {
  it("reads locusDesktop off the window", () => {
    const bridge = {
      setCloseGuard: () => undefined,
      onCloseRequested: () => () => undefined,
      ackClosePrompt: () => undefined,
      confirmClose: () => undefined,
    };
    expect(desktopBridge({ locusDesktop: bridge })).toBe(bridge);
    expect(desktopBridge({})).toBeUndefined();
  });
});
