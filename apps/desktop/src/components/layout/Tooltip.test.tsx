import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Tooltip } from "./Tooltip";

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
});
