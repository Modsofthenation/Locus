import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advanceBootProgress,
  beginBootProgress,
  failBootProgress,
  finishBootProgress,
} from "@locus/shared";
import { BootStepsCard } from "./BootStepsCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("BootStepsCard", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  function render(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(node);
    });
  }

  function state(id: string): string | null | undefined {
    return host.querySelector(`[data-testid="boot-step-${id}"]`)?.getAttribute("data-state");
  }

  it("shows done/active/pending with elapsed time and the estimate on the active step", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    let progress = beginBootProgress({
      kind: "docker",
      key: "docker:ubuntu",
      at: 50_000,
      history: { "docker:ubuntu": { start: [40_000] } },
    });
    progress = advanceBootProgress(progress, "start", 90_000);
    render(<BootStepsCard progress={progress} />);
    expect(host.textContent).toContain("Starting container");
    expect(state("pull")).toBe("done");
    expect(state("start")).toBe("active");
    expect(state("setup")).toBe("pending");
    expect(state("ready")).toBe("pending");
    expect(host.querySelector('[data-testid="boot-step-pull"]')?.textContent).toContain("40s");
    expect(host.querySelector('[data-testid="boot-step-start"]')?.textContent).toContain(
      "10s · usually ~40s",
    );
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(host.querySelector('[data-testid="boot-step-start"]')?.textContent).toContain(
      "15s · usually ~40s",
    );
    expect(host.querySelector('[data-testid="boot-steps-retry"]')).toBeNull();
  });

  it("hides skipped steps", () => {
    let progress = beginBootProgress({ kind: "vm", key: "vm", at: 0, repo: true });
    progress = advanceBootProgress(progress, "connect", 10);
    progress = finishBootProgress(progress, 20);
    render(<BootStepsCard progress={progress} />);
    expect(state("boot")).toBeUndefined();
    expect(state("ready")).toBe("done");
  });

  it("names the failed step, shows its error, and offers Retry", () => {
    const onRetry = vi.fn();
    let progress = beginBootProgress({ kind: "vm", key: "vm", at: 0 });
    progress = advanceBootProgress(progress, "boot", 10);
    progress = failBootProgress(progress, "QEMU exited with code 1", 20);
    render(<BootStepsCard progress={progress} onRetry={onRetry} />);
    expect(host.textContent).toContain("Start failed");
    expect(state("boot")).toBe("error");
    expect(host.querySelector('[data-testid="boot-step-error"]')?.textContent).toBe(
      "QEMU exited with code 1",
    );
    const retry = host.querySelector<HTMLButtonElement>('[data-testid="boot-steps-retry"]');
    expect(retry?.textContent).toBe("Retry");
    act(() => retry?.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
