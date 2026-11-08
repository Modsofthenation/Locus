import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BusyButton, ErrorBanner, InlineError, Skeleton } from "./Skeleton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Skeleton and InlineError", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders placeholder lines and a retryable alert", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onRetry = vi.fn();
    await act(async () => {
      root.render(
        <>
          <Skeleton lines={2} />
          <InlineError message="Could not load Grafana" onRetry={onRetry} />
        </>,
      );
    });
    expect(
      host.querySelector("[data-testid='ui-skeleton']")?.querySelectorAll(".skeleton"),
    ).toHaveLength(2);
    expect(host.querySelector("[data-testid='inline-error']")?.textContent).toContain(
      "Could not load Grafana",
    );
    await act(async () => {
      host
        .querySelector("[data-testid='inline-error'] button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders a pane error banner and a busy button", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onRetry = vi.fn();
    await act(async () => {
      root.render(
        <>
          <ErrorBanner message="Could not load board" onRetry={onRetry} />
          <BusyButton className="btn" busy busyLabel="Saving…">
            Save
          </BusyButton>
        </>,
      );
    });
    expect(host.querySelector("[data-testid='error-banner']")?.textContent).toContain(
      "Could not load board",
    );
    await act(async () => {
      host
        .querySelector("[data-testid='error-banner'] button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRetry).toHaveBeenCalledOnce();
    const busy = host.querySelector("button[aria-busy='true']");
    expect(busy?.textContent).toContain("Saving…");
    expect(busy).toHaveProperty("disabled", true);
  });
});
