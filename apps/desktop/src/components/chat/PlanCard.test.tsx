import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@locus/shared";
import { PlanCard } from "./PlanCard";
import { api } from "@/lib/api";
import { Store, initialState } from "@/state/store";

vi.mock("@/lib/api", () => ({
  api: {
    patchSession: vi.fn(),
    chat: vi.fn(),
    board: vi.fn(),
    upsertBoardObjects: vi.fn(),
    pinBoardPlan: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session: AgentSession = {
  id: "s1",
  title: "Test",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  providerId: "p",
  model: "grok-4",
  status: "idle",
  plan: {
    items: [
      { id: "p1", text: "Inspect", status: "pending" },
      { id: "p2", text: "Patch", status: "pending" },
      { id: "p3", text: "Test", status: "pending" },
    ],
  },
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

describe("PlanCard", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.mocked(api.patchSession).mockReset();
    vi.mocked(api.chat).mockReset();
    vi.mocked(api.board).mockReset();
    vi.mocked(api.pinBoardPlan).mockReset();
  });

  function render(row: AgentSession = session) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider
        value={{ state: { ...initialState, sessions: [row] }, dispatch: () => undefined }}
      >
        <PlanCard session={row} />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
  }

  it("keeps the outline and starts a run from the first step", async () => {
    vi.mocked(api.patchSession).mockResolvedValue(session);
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    render();
    expect((host.querySelector("input[type='text']") as HTMLInputElement).value).toBe("Inspect");
    const run = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Run");
    await act(async () => {
      run!.click();
      await Promise.resolve();
    });
    expect(api.patchSession).toHaveBeenCalledWith("s1", {
      plan: {
        phase: "accepted",
        items: [
          { id: "p1", text: "Inspect", status: "running" },
          { id: "p2", text: "Patch", status: "pending" },
          { id: "p3", text: "Test", status: "pending" },
        ],
      },
    });
    expect(api.chat).toHaveBeenCalledWith("s1", expect.stringContaining("1. Inspect"));
    expect(api.chat).toHaveBeenCalledWith("s1", expect.stringContaining("Execute this plan."));
  });

  it("skips a step from its checkbox", async () => {
    vi.mocked(api.patchSession).mockResolvedValue(session);
    render();
    const includeFirst = host.querySelector(
      "input[aria-label='Include step 1']",
    ) as HTMLInputElement;
    await act(async () => {
      includeFirst.click();
      await Promise.resolve();
    });
    expect(api.patchSession).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({
        plan: expect.objectContaining({
          items: expect.arrayContaining([{ id: "p1", text: "Inspect", status: "skipped" }]),
        }),
      }),
    );
    expect(api.chat).not.toHaveBeenCalled();
  });

  it("shows files and risks on the card", () => {
    render({
      ...session,
      plan: {
        items: [{ id: "p1", text: "Inspect", status: "pending" }],
        files: ["src/auth.ts"],
        risks: ["session cookies stay valid"],
      },
    });
    expect(host.querySelector("[data-testid='plan-files']")?.textContent).toContain("src/auth.ts");
    expect(host.querySelector("[data-testid='plan-risks']")?.textContent).toContain(
      "session cookies stay valid",
    );
  });

  it("runs from a later step", async () => {
    vi.mocked(api.patchSession).mockResolvedValue(session);
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    render();
    const fromTwo = host.querySelector("[data-testid='plan-from-2']") as HTMLButtonElement;
    await act(async () => {
      fromTwo.click();
      await Promise.resolve();
    });
    expect(api.patchSession).toHaveBeenCalledWith("s1", {
      plan: {
        phase: "accepted",
        items: [
          { id: "p1", text: "Inspect", status: "skipped" },
          { id: "p2", text: "Patch", status: "running" },
          { id: "p3", text: "Test", status: "pending" },
        ],
      },
    });
    expect(api.chat).toHaveBeenCalledWith("s1", expect.stringContaining("starting at step 2"));
    expect(api.chat).toHaveBeenCalledWith("s1", expect.stringContaining("2. Patch"));
  });

  it("locks skip checkboxes while a turn is running", () => {
    render({ ...session, status: "running" });
    expect(
      (host.querySelector("input[aria-label='Include step 1']") as HTMLInputElement).disabled,
    ).toBe(true);
    expect((host.querySelector("[data-testid='plan-from-1']") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("accepts a proposed plan without starting a turn", async () => {
    vi.mocked(api.patchSession).mockResolvedValue(session);
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    render({ ...session, plan: { ...session.plan!, phase: "proposed" } });
    expect(host.textContent).toMatch(/Proposed plan/);
    const accept = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Accept");
    await act(async () => {
      accept!.click();
      await Promise.resolve();
    });
    expect(api.patchSession).toHaveBeenCalledWith("s1", {
      plan: {
        phase: "accepted",
        items: [
          { id: "p1", text: "Inspect", status: "pending" },
          { id: "p2", text: "Patch", status: "pending" },
          { id: "p3", text: "Test", status: "pending" },
        ],
      },
    });
    expect(api.chat).not.toHaveBeenCalled();
  });

  it("asks which frame to pin onto when the board has more than one", async () => {
    const board = {
      id: "b1",
      title: "Kanban",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      starter: "kanban" as const,
      objects: [
        { id: "todo", type: "frame" as const, x: 0, y: 0, w: 200, h: 200, text: "To do" },
        { id: "doing", type: "frame" as const, x: 240, y: 0, w: 200, h: 200, text: "Doing" },
      ],
      comments: [],
    };
    vi.mocked(api.pinBoardPlan).mockResolvedValue(board);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              sessions: [session],
              selectedBoardId: "b1",
              boards: [
                {
                  id: "b1",
                  title: "Kanban",
                  createdAt: board.createdAt,
                  updatedAt: board.updatedAt,
                  objectCount: 2,
                  frameCount: 2,
                  archived: false,
                },
              ],
              boardDocuments: { b1: board },
            },
            dispatch: () => undefined,
          }}
        >
          <PlanCard session={session} />
        </Store.Provider>,
      );
    });
    const pin = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Pin to Board",
    );
    await act(async () => {
      pin!.click();
      await Promise.resolve();
    });
    expect(api.pinBoardPlan).not.toHaveBeenCalled();
    expect(host.querySelector("[data-testid='plan-pin-frames']")?.textContent).toContain("Doing");
    const doing = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Doing");
    await act(async () => {
      doing!.click();
      await Promise.resolve();
    });
    expect(api.pinBoardPlan).toHaveBeenCalledWith("b1", "doing", "s1");
  });
});
