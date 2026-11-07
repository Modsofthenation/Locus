import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceStage } from "./WorkspaceStage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function nextFrames(count = 2): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => {
      if (left <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => step(left - 1));
    };
    step(count);
  });
}

describe("WorkspaceStage", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(node);
    });
  }

  it("does not animate the first paint of a section", () => {
    render(
      <WorkspaceStage section="agents" enter={null}>
        agents
      </WorkspaceStage>,
    );
    const stage = host.querySelector(".workspace-stage") as HTMLElement;
    expect(stage.dataset.section).toBe("agents");
    expect(stage.dataset.enter).toBeUndefined();
    expect(stage.classList.contains("is-entering")).toBe(false);
  });

  it("starts a forward enter after the next frames so CSS can run", async () => {
    render(
      <WorkspaceStage section="design" enter="forward">
        design
      </WorkspaceStage>,
    );
    const stage = host.querySelector(".workspace-stage") as HTMLElement;
    expect(stage.dataset.enter).toBe("forward");
    expect(stage.classList.contains("is-entering")).toBe(false);
    await act(async () => {
      await nextFrames(2);
    });
    expect(stage.classList.contains("is-entering")).toBe(true);
  });
});
