import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  MenuItem,
  OverflowMenu,
  fixedContainingOrigin,
  placeMenuPop,
  placePointerMenu,
  typeaheadMenuIndex,
  wrapMenuIndex,
} from "./OverflowMenu";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.PointerEvent !== "function") {
  class PointerEventPolyfill extends MouseEvent {
    constructor(type: string, init: MouseEventInit = {}) {
      super(type, init);
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as typeof PointerEvent;
}

describe("placeMenuPop", () => {
  it("opens to the right of a left rail trigger when align is after", () => {
    const placed = placeMenuPop({
      trigger: { top: 80, bottom: 124, left: 6, right: 58 },
      pop: { width: 196, height: 180 },
      viewport: { width: 800, height: 600 },
      align: "after",
    });
    expect(placed.up).toBe(false);
    expect(placed.left).toBe(64);
    expect(placed.top).toBe(80);
  });

  it("opens below when there is room under the trigger", () => {
    const placed = placeMenuPop({
      trigger: { top: 40, bottom: 72, left: 200, right: 232 },
      pop: { width: 196, height: 120 },
      viewport: { width: 800, height: 600 },
      align: "right",
    });
    expect(placed.up).toBe(false);
    expect(placed.top).toBe(78);
    expect(placed.left).toBe(36);
  });

  it("flips upward when the pop would run off the bottom of the window", () => {
    const placed = placeMenuPop({
      trigger: { top: 520, bottom: 552, left: 20, right: 52 },
      pop: { width: 196, height: 180 },
      viewport: { width: 800, height: 600 },
      align: "left",
    });
    expect(placed.up).toBe(true);
    expect(placed.top).toBe(334);
    expect(placed.left).toBe(20);
  });

  it("keeps the context pop above the trigger when prefer is up", () => {
    const placed = placeMenuPop({
      trigger: { top: 420, bottom: 444, left: 200, right: 320 },
      pop: { width: 300, height: 220 },
      viewport: { width: 800, height: 600 },
      align: "right",
      prefer: "up",
    });
    expect(placed.up).toBe(true);
    expect(placed.top).toBe(194);
    expect(placed.left).toBe(20);
  });

  it("opens the context pop to the left of the chip when align is left", () => {
    const placed = placeMenuPop({
      trigger: { top: 420, bottom: 444, left: 200, right: 320 },
      pop: { width: 260, height: 220 },
      viewport: { width: 800, height: 600 },
      align: "left",
      prefer: "up",
    });
    expect(placed.up).toBe(true);
    expect(placed.top).toBe(194);
    expect(placed.left).toBe(200);
  });

  it("slides left so a left-aligned pop stays inside the chat pane", () => {
    const placed = placeMenuPop({
      trigger: { top: 700, bottom: 724, left: 560, right: 680 },
      pop: { width: 260, height: 220 },
      viewport: { width: 1400, height: 800 },
      bounds: { top: 0, left: 300, right: 720, bottom: 800 },
      align: "left",
      prefer: "up",
    });
    expect(placed.left).toBe(452);
    expect(placed.left + 260).toBeLessThanOrEqual(712);
  });

  it("places a pointer menu at the click minus a transformed ancestor", () => {
    const placed = placePointerMenu({
      x: 520,
      y: 180,
      pop: { width: 220, height: 280 },
      viewport: { width: 1400, height: 800 },
      origin: { top: 0, left: 340 },
    });
    expect(placed.left).toBe(180);
    expect(placed.top).toBe(180);
  });

  it("subtracts a transformed ancestor so fixed left matches the trigger", () => {
    const placed = placeMenuPop({
      trigger: { top: 420, bottom: 444, left: 500, right: 620 },
      pop: { width: 260, height: 220 },
      viewport: { width: 1400, height: 800 },
      origin: { top: 0, left: 300 },
      align: "left",
      prefer: "up",
    });
    expect(placed.left).toBe(200);
    expect(placed.top).toBe(194);
  });
});

describe("fixedContainingOrigin", () => {
  it("returns the window origin when no ancestor is transformed", () => {
    const node = document.createElement("div");
    document.body.appendChild(node);
    try {
      expect(fixedContainingOrigin(node)).toMatchObject({ top: 0, left: 0 });
    } finally {
      node.remove();
    }
  });

  it("returns a transformed ancestor's rect", () => {
    const parent = document.createElement("div");
    const child = document.createElement("span");
    parent.appendChild(child);
    document.body.appendChild(parent);
    const orig = window.getComputedStyle;
    window.getComputedStyle = ((el: Element) => {
      if (el === parent) {
        return {
          transform: "translateX(40px)",
          filter: "none",
          perspective: "none",
          backdropFilter: "none",
          contain: "none",
          willChange: "auto",
          getPropertyValue: () => "none",
        } as unknown as CSSStyleDeclaration;
      }
      return orig.call(window, el);
    }) as typeof getComputedStyle;
    parent.getBoundingClientRect = () =>
      ({
        top: 10,
        left: 80,
        width: 400,
        height: 300,
        right: 480,
        bottom: 310,
        x: 80,
        y: 10,
        toJSON() {
          return {};
        },
      }) as DOMRect;
    try {
      expect(fixedContainingOrigin(child)).toEqual({
        top: 10,
        left: 80,
        width: 400,
        height: 300,
      });
    } finally {
      window.getComputedStyle = orig;
      parent.remove();
    }
  });
});

describe("OverflowMenu CSS", () => {
  it("marks the menu as opening upward so bottom-of-window pops are not clipped", () => {
    expect(css).toMatch(/\.menu-pop \{[\s\S]*?top:\s*calc\(100% \+ 6px\)/);
    expect(css).toMatch(
      /\.menu\.up \.menu-pop:not\(\.placed\) \{[\s\S]*?bottom:\s*calc\(100% \+ 6px\)/,
    );
    expect(css).toMatch(/\.menu\.right \.menu-pop:not\(\.placed\) \{[\s\S]*?right:\s*0/);
    expect(css).toMatch(/\.menu \.menu-pop\.placed \{[\s\S]*?position:\s*fixed/);
    expect(css).toMatch(/\.menu \.menu-pop\.placed \{[\s\S]*?inset:\s*auto/);
    expect(css).toMatch(/\.menu \.menu-pop\.placed \{[\s\S]*?width:\s*max-content/);
    expect(css).toMatch(/\.model-picker-more \.menu-pop \{[\s\S]*?min-width:\s*168px/);
    expect(css).toMatch(
      /\.model-picker-more \.menu-pop:not\(\.placed\) \{[\s\S]*?bottom:\s*calc\(100% \+ 6px\)/,
    );
    expect(css).toMatch(/\.context-meter-pop \{[\s\S]*?position:\s*fixed/);
    expect(css).toMatch(/\.context-meter-pop \{[\s\S]*?align-items:\s*stretch/);
    expect(css).toMatch(/\.context-meter \.context-meter-pop\.placed \{[\s\S]*?inset:\s*auto/);
    expect(css).toMatch(
      /\.context-meter-pop li \{[\s\S]*?grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto/,
    );
  });

  it("keeps the trigger from jumping on press so the click is not lost", () => {
    expect(css).toMatch(/\.menu > summary\.btn:active \{[\s\S]*?transform:\s*none/);
    expect(css).toMatch(/\.topbar-actions \{[\s\S]*?overflow:\s*visible/);
  });
});

describe("menu keyboard helpers", () => {
  it("wraps arrow movement and matches typeahead from the next item", () => {
    expect(wrapMenuIndex(0, 3, 1)).toBe(1);
    expect(wrapMenuIndex(2, 3, 1)).toBe(0);
    expect(wrapMenuIndex(0, 3, -1)).toBe(2);
    expect(typeaheadMenuIndex(["Guided", "Supervised", "Autonomous"], "s", 0)).toBe(1);
    expect(typeaheadMenuIndex(["Guided", "Supervised", "Autonomous"], "a", 1)).toBe(2);
    expect(typeaheadMenuIndex(["Guided", "Supervised", "Autonomous"], "g", 0)).toBe(0);
  });
});

describe("OverflowMenu", () => {
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

  function clickTrigger() {
    const trigger = host.querySelector("summary") as HTMLElement;
    act(() => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      trigger.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      trigger.click();
    });
  }

  it("opens the pop from the trigger", () => {
    render(
      <OverflowMenu title="More">
        <MenuItem>Unlink</MenuItem>
      </OverflowMenu>,
    );
    const details = host.querySelector("details.menu") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    clickTrigger();
    expect(details.open).toBe(true);
    expect(host.textContent).toContain("Unlink");
  });

  it("stays open after a pointer press in a flex toolbar and parent rerender", () => {
    function Harness({ label }: { label: string }) {
      return (
        <div style={{ display: "flex" }}>
          <OverflowMenu title="Agent menu" toggleClassName="btn icon ghost">
            <MenuItem>{label}</MenuItem>
          </OverflowMenu>
        </div>
      );
    }
    render(<Harness label="Pin" />);
    clickTrigger();
    expect((host.querySelector("details.menu") as HTMLDetailsElement).open).toBe(true);
    act(() => {
      root.render(<Harness label="Unpin" />);
    });
    expect((host.querySelector("details.menu") as HTMLDetailsElement).open).toBe(true);
    expect(host.textContent).toContain("Unpin");
  });

  it("closes on outside pointerdown, Escape, and choosing an item", () => {
    const onItem = () => undefined;
    render(
      <OverflowMenu title="Agent menu">
        <MenuItem onClick={onItem}>Agent settings</MenuItem>
      </OverflowMenu>,
    );
    const details = () => host.querySelector("details.menu") as HTMLDetailsElement;
    clickTrigger();
    expect(details().open).toBe(true);

    act(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(details().open).toBe(false);

    clickTrigger();
    expect(details().open).toBe(true);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(details().open).toBe(false);

    clickTrigger();
    act(() => {
      (host.querySelector(".menu-item") as HTMLButtonElement).click();
    });
    expect(details().open).toBe(false);
  });

  it("moves through items with arrows, Home/End, and typeahead, then restores focus", () => {
    render(
      <OverflowMenu title="More">
        <MenuItem>Alpha</MenuItem>
        <MenuItem>Bravo</MenuItem>
        <MenuItem>Charlie</MenuItem>
      </OverflowMenu>,
    );
    const trigger = host.querySelector("summary") as HTMLElement;
    act(() => {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect((host.querySelector("details.menu") as HTMLDetailsElement).open).toBe(true);
    expect(document.activeElement?.textContent).toContain("Alpha");

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement?.textContent).toContain("Bravo");

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(document.activeElement?.textContent).toContain("Charlie");

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    expect(document.activeElement?.textContent).toContain("Alpha");

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    });
    expect(document.activeElement?.textContent).toContain("Charlie");

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect((host.querySelector("details.menu") as HTMLDetailsElement).open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("does not widen the placed pop when the chat pane scrolls", () => {
    render(
      <OverflowMenu title="Agent menu">
        <MenuItem>View trace</MenuItem>
      </OverflowMenu>,
    );
    const trigger = host.querySelector("summary") as HTMLElement;
    const menu = host.querySelector(".menu-pop") as HTMLElement;
    trigger.getBoundingClientRect = () =>
      ({
        top: 8,
        bottom: 40,
        left: 760,
        right: 792,
        width: 32,
        height: 32,
        x: 760,
        y: 8,
        toJSON() {
          return {};
        },
      }) as DOMRect;
    let popWidth = 196;
    menu.getBoundingClientRect = () =>
      ({
        top: 46,
        bottom: 246,
        left: 792 - popWidth,
        right: 792,
        width: popWidth,
        height: 200,
        x: 792 - popWidth,
        y: 46,
        toJSON() {
          return {};
        },
      }) as DOMRect;
    clickTrigger();
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    const left = menu.style.left;
    expect(left).toBe("596px");
    popWidth = 420;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(menu.style.left).toBe(left);
  });
});
