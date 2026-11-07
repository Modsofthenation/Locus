import { emptyGameStudio, type AgentSession, type GameStudioState } from "@locus/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameStudioPanel } from "./GameStudioPanel";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    workspaceFile: vi.fn(async () => undefined),
    saveWorkspaceFile: vi.fn(async () => ({})),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = {
  id: "g1",
  title: "Arcade",
  os: "ubuntu",
  kind: "game",
  runtime: "docker",
  templateId: "t1",
  providerId: "p1",
  model: "mock",
  status: "idle",
  messages: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  designVariants: [{ id: "cruise", name: "Cruise" }],
} as AgentSession;

describe("GameStudioPanel", () => {
  let root: Root | undefined;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
  });

  function render(onStudio: (next: GameStudioState) => void = () => undefined) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <GameStudioPanel
          session={session}
          html="<html><body>Score</body></html>"
          seed={4}
          tape={["ArrowRight@0+40"]}
          stats={{ score: 2, deaths: 1, time: 3 }}
          studio={emptyGameStudio()}
          onStudio={onStudio}
          postGame={() => undefined}
          onPinBuild={async () => "b1"}
          onPlayBuild={async () => undefined}
          onPlaySeed={() => undefined}
          onSplit={async () => undefined}
        />,
      );
    });
  }

  it("pins the current tape as a moment", async () => {
    const onStudio = vi.fn();
    render(onStudio);
    await act(async () => {
      await Promise.resolve();
    });
    const pin = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Pin moment",
    );
    expect(pin).toBeTruthy();
    await act(async () => {
      pin!.click();
    });
    expect(onStudio).toHaveBeenCalled();
    const next = onStudio.mock.calls[0]?.[0] as GameStudioState;
    expect(next.moments[0]?.seed).toBe(4);
    expect(next.moments[0]?.deaths).toBe(1);
    expect(next.moments[0]?.tape).toEqual(["ArrowRight@0+40"]);
  });

  it("shows the release checklist and the pinned build", async () => {
    render();
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector("[aria-label='Release check']")?.textContent).toContain(
      "Playable loop",
    );
    expect(host.textContent).toContain("Play Cruise");
    expect(api.workspaceFile).toHaveBeenCalled();
  });
});
