import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Tooltip, placeTooltip } from "./Tooltip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Tooltip", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("sets aria-label on an unlabeled control", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Tooltip label="Full screen files">
          <button type="button" className="btn icon ghost">
            FS
          </button>
        </Tooltip>,
      );
    });
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe("Full screen files");
    expect(host.querySelector("[role='tooltip']")?.textContent).toBe("Full screen files");
  });

  it("explains why a disabled control is off", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Tooltip label="Send" disabledReason="Write a message first">
          <button type="button" disabled>
            Send
          </button>
        </Tooltip>,
      );
    });
    expect(host.querySelector("[role='tooltip']")?.textContent).toBe("Write a message first");
    expect(host.querySelector(".ui-tooltip")?.className).toContain("is-disabled");
  });

  it("floats the bubble on hover and drops it on Escape", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Tooltip label="Session list">
          <button type="button">…</button>
        </Tooltip>,
      );
    });
    const wrap = host.querySelector(".ui-tooltip")!;
    act(() => {
      wrap.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    const float = document.body.querySelector(".ui-tooltip-float");
    expect(float?.textContent).toBe("Session list");
    expect(float?.getAttribute("aria-hidden")).toBe("true");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.body.querySelector(".ui-tooltip-float")).toBeNull();
  });

  it("skips the bubble when the trigger already shows the same words", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Tooltip label="More">
          <button type="button">More</button>
        </Tooltip>,
      );
    });
    act(() => {
      host
        .querySelector(".ui-tooltip")!
        .dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    expect(document.body.querySelector(".ui-tooltip-float")).toBeNull();
  });
});

describe("placeTooltip", () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 120, height: 26 };

  it("sits centred above a trigger with room", () => {
    const place = placeTooltip({ top: 400, bottom: 428, left: 500, right: 540 }, size, viewport);
    expect(place).toEqual({ side: "top", top: 368, left: 460 });
  });

  it("flips below a trigger at the top of the window", () => {
    const place = placeTooltip({ top: 4, bottom: 32, left: 500, right: 540 }, size, viewport);
    expect(place.side).toBe("bottom");
    expect(place.top).toBe(38);
  });

  it("stays inside the left and right edges", () => {
    expect(placeTooltip({ top: 400, bottom: 428, left: 0, right: 28 }, size, viewport).left).toBe(
      8,
    );
    expect(
      placeTooltip({ top: 400, bottom: 428, left: 980, right: 1000 }, size, viewport).left,
    ).toBe(872);
  });
});
