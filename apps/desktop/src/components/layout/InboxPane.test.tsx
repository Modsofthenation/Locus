import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@locus/shared";
import { Store, initialState, type UiState } from "@/state/store";
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
});
