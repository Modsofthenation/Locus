import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@locus/shared";
import { Store, initialState, type UiState } from "@/state/store";
import { api } from "@/lib/api";
import { InboxPane } from "./InboxPane";

const waiting = {
  id: "s1",
  title: "Review checkout",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  providerId: "p",
  model: "m",
  status: "idle",
  vmId: "v1",
  needsHuman: "Approve git_push",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
} as unknown as AgentSession;

describe("InboxPane", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(state: UiState, dispatch = vi.fn()) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider value={{ state, dispatch }}>
          <InboxPane />
        </Store.Provider>,
      );
    });
    return dispatch;
  }

  it("says all caught up when nothing waits", () => {
    render({ ...initialState, inboxOpen: true });
    expect(host.querySelector(".empty-hero h2")?.textContent).toBe("All caught up");
    expect(host.querySelector("[data-testid='inbox-next']")).toBeNull();
  });

  it("previews the next item and opens its target", () => {
    const dispatch = render({ ...initialState, inboxOpen: true, sessions: [waiting] });
    expect(host.querySelector(".empty-hero h2")?.textContent).toBe("1 item needs you");
    const next = host.querySelector("[data-testid='inbox-next']");
    expect(next?.textContent).toContain("Review checkout");
    expect(next?.textContent).toContain("Agent");
    act(() => {
      (next?.querySelector("button") as HTMLButtonElement).click();
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "select", id: "s1" });
    expect(dispatch).toHaveBeenCalledWith({ type: "inbox", open: false });
  });

  const approval = {
    ...waiting,
    id: "s2",
    title: "Run checks",
    needsHuman: undefined,
    runtime: "docker",
    messages: [
      {
        id: "m1",
        role: "assistant",
        content: "Running the suite to confirm.",
        createdAt: "2020-01-01T00:00:00.000Z",
        toolCalls: [
          {
            id: "c1",
            name: "exec",
            arguments: { command: "npm test" },
            startedAt: "2020-01-01T00:00:00.000Z",
            approval: "needed",
          },
        ],
      },
    ],
  } as unknown as AgentSession;

  it("shows the command and reason for an approval and decides it in place", async () => {
    const spy = vi.spyOn(api, "resolveApproval").mockResolvedValue(approval);
    const dispatch = render({ ...initialState, inboxOpen: true, sessions: [approval] });
    expect(host.querySelector("[data-testid='inbox-command']")?.textContent).toBe("npm test");
    expect(host.querySelector("[data-testid='inbox-why']")?.textContent).toBe(
      "Running the suite to confirm.",
    );
    expect(host.textContent).toContain("Docker container");
    await act(async () => {
      (host.querySelector("[data-testid='inbox-approve']") as HTMLButtonElement).click();
    });
    expect(spy).toHaveBeenCalledWith("s2", "c1", "approved", undefined, undefined);
    expect(dispatch).toHaveBeenCalledWith({ type: "session", session: approval });
    spy.mockRestore();
  });

  it("moves with J/K and denies with D", async () => {
    const spy = vi.spyOn(api, "resolveApproval").mockResolvedValue(approval);
    render({ ...initialState, inboxOpen: true, sessions: [waiting, approval] });
    expect(host.querySelector("[data-testid='inbox-stepper']")?.textContent).toContain("1 of 2");
    expect(host.querySelector("[data-testid='inbox-next']")?.textContent).toContain(
      "Review checkout",
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    });
    expect(host.querySelector("[data-testid='inbox-next']")?.textContent).toContain("Run checks");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
    });
    expect(spy).toHaveBeenCalledWith("s2", "c1", "denied", undefined, undefined);
    spy.mockRestore();
  });
});
