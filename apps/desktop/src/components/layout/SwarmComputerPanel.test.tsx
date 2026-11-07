import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SwarmComputerPanel } from "./SwarmComputerPanel";
import { Store, initialState, type UiState } from "@/state/store";
import type { AgentSession, Automation, LocusConfig } from "@locus/shared";

vi.mock("@/lib/api", () => ({
  api: {
    takeover: vi.fn(),
    handback: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function session(partial: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    title: "Inbox Manager",
    status: "idle",
    runtime: "host",
    model: "composer",
    os: "ubuntu",
    templateId: "host",
    providerId: "p",
    messages: [
      {
        id: "m1",
        role: "assistant",
        content: "All caught up",
        createdAt: "2026-09-14T10:00:00.000Z",
      },
    ],
    createdAt: "2026-09-14T09:00:00.000Z",
    updatedAt: "2026-09-14T10:00:00.000Z",
    persona: { displayName: "Inbox Manager", hubRole: "Inbox" },
    ...partial,
  } as AgentSession;
}

function routine(): Automation {
  return {
    id: "a1",
    name: "Morning sweep",
    enabled: true,
    prompt: "Sweep",
    os: "ubuntu",
    templateId: "host",
    providerId: "p",
    model: "composer",
    startVm: false,
    schedule: { kind: "daily", hour: 6, minute: 0 },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("SwarmComputerPanel", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  function mount(state: Partial<UiState> = {}) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider
        value={{
          state: {
            ...initialState,
            connected: true,
            vmCollapsed: false,
            selectedId: "s1",
            sessions: [session()],
            config: { productMode: "swarm" } as LocusConfig,
            automations: [routine()],
            ...state,
          },
          dispatch: vi.fn(),
        }}
      >
        <SwarmComputerPanel screen={<div data-testid="embedded-screen">screen</div>} />
      </Store.Provider>
    );
    act(() => root.render(node));
  }

  it("renders computer summary, open-screen, and routines in Locus Swarm", () => {
    mount();
    expect(host.querySelector('[data-testid="hub-computer-panel"]')).toBeTruthy();
    expect(host.textContent).toContain("Inbox Manager's computer");
    expect(host.querySelector('[data-testid="hub-computer-status"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="hub-open-screen"]')).toBeTruthy();
    expect(host.textContent).toContain("Morning sweep");
    expect(host.querySelector('[data-testid="embedded-screen"]')).toBeNull();
  });

  it("falls through to the screen when not in Locus Swarm", () => {
    mount({
      config: { productMode: "developer" } as LocusConfig,
    });
    expect(host.querySelector('[data-testid="embedded-screen"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="hub-computer-panel"]')).toBeNull();
  });
});
