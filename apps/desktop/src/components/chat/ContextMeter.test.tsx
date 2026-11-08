import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTEXT_POP_WIDTH, ContextMeter, contextPopWidth, placeContextPop } from "./ContextMeter";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function rect(box: { top: number; left: number; width: number; height: number }): DOMRect {
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  return {
    x: box.left,
    y: box.top,
    top: box.top,
    left: box.left,
    right,
    bottom,
    width: box.width,
    height: box.height,
    toJSON() {
      return {};
    },
  } as DOMRect;
}

describe("contextPopWidth", () => {
  it("keeps the card width on a normal viewport", () => {
    expect(contextPopWidth(800)).toBe(CONTEXT_POP_WIDTH);
  });

  it("shrinks so the card stays on a narrow viewport", () => {
    expect(contextPopWidth(200)).toBe(184);
    expect(contextPopWidth(0)).toBe(CONTEXT_POP_WIDTH);
  });
});

describe("placeContextPop", () => {
  const viewport = { width: 1400, height: 800 };
  const pane = { top: 0, left: 300, right: 720, bottom: 800, width: 420 };

  it("aligns to the chip when the card fits in the chat pane", () => {
    const placed = placeContextPop({
      trigger: { top: 700, bottom: 724, left: 360, right: 480 },
      popHeight: 220,
      viewport,
      pane,
    });
    expect(placed.width).toBe(CONTEXT_POP_WIDTH);
    expect(placed.left).toBe(360);
    expect(placed.up).toBe(true);
  });

  it("shifts left when the divider would let the card spill into preview", () => {
    const placed = placeContextPop({
      trigger: { top: 700, bottom: 724, left: 560, right: 680 },
      popHeight: 220,
      viewport,
      pane,
    });
    expect(placed.left).toBe(452);
    expect(placed.left + placed.width).toBeLessThanOrEqual(pane.right - 8);
  });

  it("follows a narrower pane after the divider moves", () => {
    const wide = placeContextPop({
      trigger: { top: 700, bottom: 724, left: 400, right: 520 },
      popHeight: 220,
      viewport,
      pane: { top: 0, left: 300, right: 900, bottom: 800, width: 600 },
    });
    expect(wide.left).toBe(400);

    const narrow = placeContextPop({
      trigger: { top: 700, bottom: 724, left: 400, right: 520 },
      popHeight: 220,
      viewport,
      pane: { top: 0, left: 300, right: 620, bottom: 800, width: 320 },
    });
    expect(narrow.left).toBe(352);
    expect(narrow.left + narrow.width).toBeLessThanOrEqual(612);
    expect(narrow.left).not.toBe(wide.left);
  });

  it("converts viewport coords when a transformed ancestor owns fixed layout", () => {
    const placed = placeContextPop({
      trigger: { top: 700, bottom: 724, left: 500, right: 620 },
      popHeight: 220,
      viewport,
      pane: { top: 0, left: 300, right: 1000, bottom: 800, width: 700 },
      origin: { top: 0, left: 300 },
    });
    expect(placed.left).toBe(200);
  });
});

describe("ContextMeter", () => {
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

  it("hides the chip when occupancy is still 0%", () => {
    render(
      <ContextMeter
        session={{
          model: "grok-4",
          context: {
            window: 128_000,
            used: 0,
            reserved: 0,
            charsPerToken: 4,
            measured: false,
            parts: [],
          },
        }}
      />,
    );
    expect(host.querySelector("[aria-label='Context usage']")).toBeNull();
  });

  it("opens a card with a stable width and unclipped token counts", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    render(
      <ContextMeter
        session={{
          model: "x-preview-f-free",
          context: {
            window: 128_000,
            used: 5_000,
            reserved: 32_768,
            charsPerToken: 4,
            measured: false,
            parts: [
              { id: "system", label: "System prompt", tokens: 416 },
              { id: "tools", label: "Tools", tokens: 163 },
              { id: "rules", label: "Rules", tokens: 1 },
              { id: "repo", label: "Repo map", tokens: 4_400 },
              { id: "conversation", label: "Conversation", tokens: 20 },
            ],
          },
        }}
        kind="opencode"
      />,
    );

    const chip = host.querySelector("[aria-label='Context usage']") as HTMLButtonElement;
    chip.getBoundingClientRect = () => rect({ top: 400, left: 200, width: 120, height: 24 });

    const orig = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this === chip) return rect({ top: 400, left: 200, width: 120, height: 24 });
      return rect({ top: 200, left: 200, width: 40, height: 80 });
    };

    try {
      act(() => {
        chip.click();
      });

      const pop = host.querySelector("[aria-label='Context breakdown']") as HTMLDivElement;
      expect(pop).toBeTruthy();
      expect(pop.style.width).toBe(`${CONTEXT_POP_WIDTH}px`);
      expect(pop.style.minWidth).toBe(`${CONTEXT_POP_WIDTH}px`);
      expect(pop.style.right).toBe("auto");
      expect(pop.style.bottom).toBe("auto");
      expect(pop.style.position).toBe("fixed");
      expect(pop.classList.contains("placed")).toBe(true);
      expect(parseFloat(pop.style.left)).toBe(200);
      expect(pop.querySelector(".context-meter-pop-head")?.textContent).toMatch(/Context/);
      expect(pop.textContent).toMatch(/4% Full/);
      expect(pop.textContent).toMatch(/~5k \/ 128k/);
      const rows = [...pop.querySelectorAll("li")].map((row) => row.textContent);
      expect(rows.some((text) => text?.includes("System prompt") && text.includes("416"))).toBe(
        true,
      );
      expect(rows.some((text) => text?.includes("Repo map") && text.includes("4.4k"))).toBe(true);
      expect(pop.querySelector(".context-meter-part-tokens")?.textContent).toBe("416");
    } finally {
      Element.prototype.getBoundingClientRect = orig;
    }
  });

  it("keeps the card in the chat column when the chip sits near the divider", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    render(
      <div className="chat">
        <ContextMeter
          session={{
            model: "x-preview-f-free",
            context: {
              window: 128_000,
              used: 5_000,
              reserved: 32_768,
              charsPerToken: 4,
              measured: false,
              parts: [{ id: "conversation", label: "Conversation", tokens: 5_000 }],
            },
          }}
        />
      </div>,
    );

    const chat = host.querySelector(".chat") as HTMLDivElement;
    const chip = host.querySelector("[aria-label='Context usage']") as HTMLButtonElement;
    let pane = { top: 0, left: 300, width: 420, height: 800 };
    let chipBox = { top: 700, left: 560, width: 120, height: 24 };
    chat.getBoundingClientRect = () => rect(pane);
    chip.getBoundingClientRect = () => rect(chipBox);

    act(() => {
      chip.click();
    });

    const pop = host.querySelector("[aria-label='Context breakdown']") as HTMLDivElement;
    expect(parseFloat(pop.style.left)).toBe(452);

    pane = { top: 0, left: 300, width: 600, height: 800 };
    chipBox = { top: 700, left: 400, width: 120, height: 24 };
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(parseFloat(pop.style.left)).toBe(400);
  });

  it("does not show Cursor CLI occupancy above the model window", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    render(
      <ContextMeter
        session={{
          model: "cursor-grok-4.6",
          context: {
            window: 256_000,
            used: 275_312,
            reserved: 0,
            charsPerToken: 4,
            measured: true,
            cachedInputTokens: 636_000,
            parts: [{ id: "conversation", label: "Conversation", tokens: 275_312 }],
          },
        }}
        kind="cursor-cli"
      />,
    );
    const chip = host.querySelector("[aria-label='Context usage']") as HTMLButtonElement;
    expect(chip.textContent).toMatch(/100% context/);
    chip.getBoundingClientRect = () => rect({ top: 400, left: 200, width: 120, height: 24 });
    act(() => {
      chip.click();
    });
    const pop = host.querySelector("[aria-label='Context breakdown']") as HTMLDivElement;
    expect(pop.textContent).toMatch(/100% Full/);
    expect(pop.textContent).toMatch(/256k \/ 256k/);
    expect(pop.textContent).not.toMatch(/275k/);
    expect(pop.textContent).toMatch(/Cache 256k/);
    expect(pop.textContent).toMatch(/Conversation/);
    expect(pop.textContent).toMatch(/256k/);
  });

  it("shows the last compact boundary on the card", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    render(
      <ContextMeter
        session={{
          model: "grok-4",
          lastCompact: {
            dropped: 8,
            beforeTokens: 12_000,
            afterTokens: 4_000,
            source: "heuristic",
          },
          context: {
            window: 128_000,
            used: 4_000,
            reserved: 0,
            charsPerToken: 4,
            measured: false,
            parts: [{ id: "conversation", label: "Conversation", tokens: 4_000 }],
          },
        }}
      />,
    );
    const chip = host.querySelector("[aria-label='Context usage']") as HTMLButtonElement;
    act(() => {
      chip.click();
    });
    expect(host.querySelector("[data-testid=context-compact]")?.textContent).toBe(
      "Compacted 8 messages · 12000 → 4000 tokens (heuristic)",
    );
  });

  it("shows provider cache hits from session usage when occupancy has none", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    render(
      <ContextMeter
        session={{
          model: "grok-4",
          usage: { inputTokens: 8_200, outputTokens: 400, cachedInputTokens: 4_100 },
          context: {
            window: 128_000,
            used: 8_200,
            reserved: 0,
            charsPerToken: 4,
            measured: true,
            parts: [{ id: "conversation", label: "Conversation", tokens: 8_200 }],
          },
        }}
      />,
    );
    const chip = host.querySelector("[aria-label='Context usage']") as HTMLButtonElement;
    act(() => {
      chip.click();
    });
    expect(host.querySelector("[data-testid=context-cache]")?.textContent).toBe("Cache 4.1k");
  });

  it("offers Clear chat from the breakdown when the thread can be wiped", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    const onClear = vi.fn();
    render(
      <ContextMeter
        session={{
          model: "grok-4",
          context: {
            window: 128_000,
            used: 4_000,
            reserved: 0,
            charsPerToken: 4,
            measured: false,
            parts: [{ id: "conversation", label: "Conversation", tokens: 4_000 }],
          },
        }}
        canClear
        onClear={onClear}
      />,
    );
    const chip = host.querySelector("[aria-label='Context usage']") as HTMLButtonElement;
    act(() => {
      chip.click();
    });
    const clear = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Clear chat"),
    ) as HTMLButtonElement;
    expect(clear).toBeTruthy();
    act(() => {
      clear.click();
    });
    expect(onClear).toHaveBeenCalled();
  });
});
