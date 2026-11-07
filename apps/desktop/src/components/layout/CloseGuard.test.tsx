import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@locus/shared";
import { CloseGuard } from "./CloseGuard";
import { Store, initialState, type UiState } from "@/state/store";
import type { LocusDesktopBridge } from "@/lib/closeGuard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function session(status: AgentSession["status"], title = "Nightly review"): AgentSession {
  return {
    id: title,
    title,
    os: "ubuntu",
    templateId: "ubuntu-24.04",
    runtime: "host",
    providerId: "p",
    model: "grok-4",
    status,
    messages: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
}

describe("CloseGuard", () => {
  let host: HTMLDivElement;
  let root: Root;
  let desktop: LocusDesktopBridge;
  let closeRequested: (() => void) | undefined;

  afterEach(() => {
    try {
      act(() => root.unmount());
    } catch {
      /* already unmounted in a test */
    }
    host.remove();
    delete window.locusDesktop;
    vi.restoreAllMocks();
  });

  async function render(sessions: AgentSession[]) {
    desktop = {
      setCloseGuard: vi.fn(),
      onCloseRequested: vi.fn((callback) => {
        closeRequested = callback;
        return () => {
          if (closeRequested === callback) closeRequested = undefined;
        };
      }),
      ackClosePrompt: vi.fn(),
      confirmClose: vi.fn(),
    };
    window.locusDesktop = desktop;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const state: UiState = { ...initialState, sessions };
    await act(async () => {
      root.render(
        <Store.Provider value={{ state, dispatch: () => undefined }}>
          <CloseGuard />
        </Store.Provider>,
      );
    });
  }

  it("arms the Electron close guard while an agent is running", async () => {
    await render([session("running")]);
    expect(desktop.setCloseGuard).toHaveBeenCalledWith(true);
    expect(desktop.onCloseRequested).toHaveBeenCalledOnce();
  });

  it("leaves the guard off when every agent is idle", async () => {
    await render([session("idle")]);
    expect(desktop.setCloseGuard).toHaveBeenCalledWith(false);
  });

  it("shows the confirm modal on close, then cancel keeps the app open", async () => {
    await render([session("running", "Fix login")]);
    await act(async () => {
      closeRequested?.();
    });
    expect(host.querySelector("[data-testid='close-confirm-modal']")).toBeTruthy();
    expect(host.textContent).toContain("There is currently an active agent");
    expect(desktop.confirmClose).not.toHaveBeenCalled();
    await act(async () => {
      const cancel = [...host.querySelectorAll("button")].find(
        (row) => row.textContent === "Cancel",
      );
      cancel?.click();
    });
    expect(host.querySelector("[data-testid='close-confirm-modal']")).toBeNull();
    expect(desktop.confirmClose).not.toHaveBeenCalled();
  });

  it("confirms close from the modal", async () => {
    await render([session("provisioning")]);
    await act(async () => {
      closeRequested?.();
    });
    await act(async () => {
      const close = [...host.querySelectorAll("button")].find((row) => row.textContent === "Close");
      close?.click();
    });
    expect(desktop.confirmClose).toHaveBeenCalledOnce();
    expect(host.querySelector("[data-testid='close-confirm-modal']")).toBeNull();
  });

  it("closes immediately when no agent is active", async () => {
    await render([session("idle")]);
    await act(async () => {
      closeRequested?.();
    });
    expect(host.querySelector("[data-testid='close-confirm-modal']")).toBeNull();
    expect(desktop.ackClosePrompt).toHaveBeenCalledOnce();
    expect(desktop.confirmClose).toHaveBeenCalledOnce();
  });

  it("acks the prompt when the modal opens so main does not fail-open", async () => {
    await render([session("running")]);
    await act(async () => {
      closeRequested?.();
    });
    expect(desktop.ackClosePrompt).toHaveBeenCalledOnce();
    expect(desktop.confirmClose).not.toHaveBeenCalled();
  });

  it("disarms the guard on unmount so a reload cannot pin close", async () => {
    await render([session("running")]);
    await act(async () => {
      root.unmount();
    });
    expect(desktop.setCloseGuard).toHaveBeenLastCalledWith(false);
  });
});
