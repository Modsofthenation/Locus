import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, lazy, Suspense, useCallback, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BootReveal, BootScreen } from "./BootScreen";
import { Store, initialState, type UiState } from "@/state/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("BootScreen", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(state: UiState = initialState) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider value={{ state, dispatch: () => undefined }}>
        <BootScreen />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
  }

  it("fills the viewport with the thinking mascot until presets load", () => {
    render();
    const screen = host.querySelector("[data-testid='boot-screen']");
    expect(screen?.getAttribute("role")).toBe("status");
    expect(screen?.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector("[data-testid='locus-mascot']")?.getAttribute("data-pose")).toBe(
      "think",
    );
    expect(host.querySelector("[data-testid='locus-mascot']")?.getAttribute("aria-label")).toBe(
      "Locus is loading",
    );
    expect(host.textContent).toContain("Loading…");
    expect(host.querySelector(".app")).toBeNull();
    expect(css).toMatch(/\.boot-screen\s*\{[\s\S]*?position:\s*fixed/);
    expect(css).toMatch(/\.boot-screen\s*\{[\s\S]*?inset:\s*0/);
    expect(css).toMatch(/\.boot-screen\s*\{[\s\S]*?place-items:\s*center/);
  });

  it("shows a rest pose and the error when boot fails", () => {
    render({ ...initialState, error: "offline" });
    const screen = host.querySelector("[data-testid='boot-screen']");
    expect(screen?.getAttribute("aria-busy")).toBe("false");
    expect(host.querySelector("[data-testid='locus-mascot']")?.getAttribute("data-pose")).toBe(
      "rest",
    );
    expect(host.querySelector(".boot-screen-error")?.textContent).toBe("offline");
  });

  it("offers Retry when boot failed", () => {
    const onRetry = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{ state: { ...initialState, error: "offline" }, dispatch: () => undefined }}
        >
          <BootScreen onRetry={onRetry} />
        </Store.Provider>,
      );
    });
    const retry = host.querySelector("[data-testid='boot-retry']") as HTMLButtonElement;
    expect(retry?.textContent).toMatch(/Retry/);
    act(() => {
      retry.click();
    });
    expect(onRetry).toHaveBeenCalled();
  });

  it("keeps the mascot up until a lazy child actually paints", async () => {
    const pending = deferred<{ default: () => ReactNode }>();
    const Child = lazy(() => pending.promise);

    function Harness() {
      const [ready, setReady] = useState(false);
      const onReady = useCallback(() => setReady(true), []);
      return (
        <Store.Provider value={{ state: initialState, dispatch: () => undefined }}>
          {ready ? null : <BootScreen />}
          <Suspense fallback={null}>
            <BootReveal onReady={onReady}>
              <Child />
            </BootReveal>
          </Suspense>
        </Store.Provider>
      );
    }

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<Harness />);
    });

    expect(host.querySelector("[data-testid='boot-screen']")).toBeTruthy();
    expect(host.querySelector("[data-testid='lazy-ready']")).toBeNull();

    await act(async () => {
      pending.resolve({
        default: () => <div data-testid="lazy-ready">ready</div>,
      });
      await pending.promise;
    });

    expect(host.querySelector("[data-testid='lazy-ready']")).toBeTruthy();
    expect(host.querySelector("[data-testid='boot-screen']")).toBeNull();
  });
});
