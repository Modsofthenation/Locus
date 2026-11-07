import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  STACKED_WORKSPACE_QUERY,
  matchesStackedWorkspace,
  useStackedWorkspace,
} from "./useStackedWorkspace";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalMatchMedia = window.matchMedia;

function stubMatchMedia(state: { matches: boolean }) {
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) => {
    const mq = {
      get matches() {
        return query === STACKED_WORKSPACE_QUERY ? state.matches : false;
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: EventListener) => {
        listeners.add(listener as () => void);
      },
      removeEventListener: (_type: string, listener: EventListener) => {
        listeners.delete(listener as () => void);
      },
      addListener: (listener: () => void) => {
        listeners.add(listener);
      },
      removeListener: (listener: () => void) => {
        listeners.delete(listener);
      },
      dispatchEvent: () => false,
    };
    return mq;
  }) as typeof window.matchMedia;
  return listeners;
}

function Probe(props: { onValue: (value: boolean) => void }) {
  props.onValue(useStackedWorkspace());
  return null;
}

describe("useStackedWorkspace", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    const current = root;
    if (current) act(() => current.unmount());
    host?.remove();
    root = undefined;
    window.matchMedia = originalMatchMedia;
  });

  it("treats portrait or a 900px-wide window as stacked", () => {
    expect(STACKED_WORKSPACE_QUERY).toBe("(max-width: 900px), (orientation: portrait)");
    expect(matchesStackedWorkspace(() => ({ matches: true }))).toBe(true);
    expect(
      matchesStackedWorkspace(() => {
        throw new Error("no matchMedia");
      }),
    ).toBe(false);
  });

  it("follows matchMedia and updates when the viewport changes", () => {
    const state = { matches: true };
    const listeners = stubMatchMedia(state);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const seen: boolean[] = [];
    act(() => {
      root!.render(<Probe onValue={(value) => seen.push(value)} />);
    });
    expect(seen.at(-1)).toBe(true);
    state.matches = false;
    act(() => {
      for (const listener of listeners) listener();
    });
    expect(seen.at(-1)).toBe(false);
  });
});
