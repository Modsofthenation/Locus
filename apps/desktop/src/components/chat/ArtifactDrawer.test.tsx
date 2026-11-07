import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@locus/shared";
import { ArtifactDrawer } from "./ArtifactDrawer";
import { api } from "@/lib/api";
import { Store, initialState, type Action } from "@/state/store";

vi.mock("@/lib/api", () => ({
  api: {
    checkpointDiff: vi.fn(),
    revealWorkspace: vi.fn(async () => ({ path: "/tmp" })),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const patch = [
  "diff --git a/a.ts b/a.ts",
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
].join("\n");

const session: AgentSession = {
  id: "s1",
  title: "Test",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  providerId: "p",
  model: "grok-4",
  status: "idle",
  messages: [
    {
      id: "t1",
      role: "tool",
      content: "clicked",
      createdAt: "2020-01-01T00:00:00.000Z",
      screenshotName: "t1.png",
    },
    {
      id: "t3",
      role: "tool",
      content: "patched",
      createdAt: "2020-01-01T00:00:02.000Z",
      toolCalls: [
        {
          id: "c3",
          name: "apply_patch",
          arguments: { patch },
          startedAt: "2020-01-01T00:00:02.000Z",
        },
      ],
    },
  ],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

describe("ArtifactDrawer", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.mocked(api.checkpointDiff).mockReset();
  });

  it("opens the tray and seeks the timeline from a screenshot", () => {
    const actions: Action[] = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider
        value={{
          state: { ...initialState, sessions: [session], selectedId: "s1" },
          dispatch: (action) => {
            actions.push(action);
          },
        }}
      >
        <ArtifactDrawer session={session} />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
    const toggle = host.querySelector(".artifact-toggle") as HTMLButtonElement;
    expect(toggle.textContent).toContain("1 shot");
    expect(toggle.textContent).toContain("1 patch");
    expect(host.querySelector(".artifact-track")).toBeNull();
    act(() => {
      toggle.click();
    });
    expect(host.querySelector(".artifact-track")).toBeTruthy();
    const shot = [...host.querySelectorAll("button")].find(
      (btn) => btn.title === "Preview on the guest timeline",
    );
    act(() => {
      shot!.click();
    });
    expect(actions).toContainEqual({
      type: "seekTimeline",
      seek: { sessionId: "s1", stopId: "t1" },
    });
  });

  it("lists turn diffs and loads the unified patch", async () => {
    vi.mocked(api.checkpointDiff).mockResolvedValue({
      diff: " 1 file changed, 1 insertion(+)\n\n+new",
    });
    const withGit: AgentSession = {
      ...session,
      checkpoints: [
        {
          id: "cp0",
          messageCount: 1,
          createdAt: "2020-01-01T00:00:00.000Z",
          gitRef: "refs/locus/checkpoints/cp0",
        },
        {
          id: "cp1",
          messageCount: 2,
          createdAt: "2020-01-01T00:00:02.000Z",
          gitRef: "refs/locus/checkpoints/cp1",
        },
      ],
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, sessions: [withGit], selectedId: "s1" },
            dispatch: () => undefined,
          }}
        >
          <ArtifactDrawer session={withGit} />
        </Store.Provider>,
      );
    });
    const toggle = host.querySelector(".artifact-toggle") as HTMLButtonElement;
    expect(toggle.textContent).toContain("1 turn diff");
    act(() => {
      toggle.click();
    });
    const card = [...host.querySelectorAll("button")].find(
      (btn) => btn.title === "Git diff for this turn",
    );
    expect(card).toBeTruthy();
    await act(async () => {
      card!.click();
      await Promise.resolve();
    });
    expect(api.checkpointDiff).toHaveBeenCalledWith("s1", "cp1");
    expect(host.querySelector("[data-testid='checkpoint-diff']")?.textContent).toContain(
      "1 file changed",
    );
  });
});
