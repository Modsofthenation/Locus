import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@locus/shared";
import { GuestTimeline, TimelinePreviewLayer, screenshotSrc } from "./GuestTimeline";
import { api } from "@/lib/api";
import { Store, initialState, type Action, type UiState } from "@/state/store";

vi.mock("@/lib/api", () => ({
  api: {
    rewind: vi.fn(),
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
  messages: [
    { id: "u1", role: "user", content: "click the button", createdAt: "2020-01-01T00:00:00.000Z" },
    {
      id: "t1",
      role: "tool",
      content: "clicked",
      createdAt: "2020-01-01T00:00:01.000Z",
      screenshotName: "t1.png",
      toolCalls: [
        {
          id: "c1",
          name: "mouse_click",
          arguments: { x: 10, y: 20 },
          startedAt: "2020-01-01T00:00:01.000Z",
        },
      ],
    },
  ],
  checkpoints: [{ id: "cp1", messageCount: 0, createdAt: "2020-01-01T00:00:00.000Z" }],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

describe("GuestTimeline", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.mocked(api.rewind).mockReset();
  });

  function render(
    current: AgentSession,
    state: UiState = initialState,
    dispatch: (action: Action) => void = () => undefined,
  ) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider value={{ state, dispatch }}>
        <GuestTimeline session={current}>
          <div data-testid="desktop">
            <TimelinePreviewLayer />
          </div>
        </GuestTimeline>
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
  }

  it("hides the filmstrip when there is nothing to scrub", () => {
    render({ ...session, messages: [], checkpoints: undefined, checkpoint: undefined });
    expect(host.querySelector("[data-testid='guest-timeline']")).toBeNull();
  });

  it("previews a screenshot and restores that checkpoint", async () => {
    vi.mocked(api.rewind).mockResolvedValue({ ...session, messages: [], checkpoints: undefined });
    render(session);
    const timeline = host.querySelector("[data-testid='guest-timeline']");
    expect(timeline).toBeTruthy();
    expect(host.querySelector("[data-testid='timeline-preview']")).toBeNull();

    const shot = [...host.querySelectorAll("button")].find((btn) =>
      btn.title.includes("restore point"),
    );
    expect(shot).toBeTruthy();
    act(() => {
      shot!.click();
    });
    const preview = host.querySelector("[data-testid='timeline-preview']");
    expect(preview).toBeTruthy();
    expect(preview?.textContent).toMatch(/Preview · Tool · mouse_click/);
    expect(preview?.querySelector("img")?.getAttribute("src")).toBe(
      "/api/sessions/s1/screenshots/t1.png",
    );

    const restore = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Restore",
    );
    await act(async () => {
      restore!.click();
      await Promise.resolve();
    });
    expect(api.rewind).toHaveBeenCalledWith("s1", "cp1");
    expect(host.querySelector("[data-testid='timeline-preview']")).toBeNull();
  });

  it("returns to Now from a preview", () => {
    render(session);
    const shot = [...host.querySelectorAll("button")].find((btn) =>
      btn.title.includes("restore point"),
    );
    act(() => {
      shot!.click();
    });
    expect(host.querySelector("[data-testid='timeline-preview']")).toBeTruthy();
    const now = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Now");
    act(() => {
      now!.click();
    });
    expect(host.querySelector("[data-testid='timeline-preview']")).toBeNull();
  });

  it("seeks a stop from the artifact drawer", () => {
    const actions: Action[] = [];
    render(
      session,
      { ...initialState, timelineSeek: { sessionId: "s1", stopId: "t1" } },
      (action) => {
        actions.push(action);
      },
    );
    expect(host.querySelector("[data-testid='timeline-preview']")).toBeTruthy();
    expect(actions).toContainEqual({ type: "seekTimeline", seek: null });
  });
});

describe("screenshotSrc", () => {
  it("prefers inline bytes then the session screenshot URL", () => {
    expect(screenshotSrc("s1", { screenshotBase64: "abc" })).toBe("data:image/png;base64,abc");
    expect(screenshotSrc("s1", { screenshotName: "shot.png" })).toBe(
      "/api/sessions/s1/screenshots/shot.png",
    );
    expect(screenshotSrc("s1", {})).toBeUndefined();
  });
});
