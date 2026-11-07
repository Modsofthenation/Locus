import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { SearchField } from "./SearchField";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SearchField", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders a search icon inside the input wrap", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<SearchField className="search" placeholder="Search agents" />);
    });
    expect(host.querySelector(".search-wrap .search-icon svg")).toBeTruthy();
    expect(host.querySelector("input.search")?.getAttribute("placeholder")).toBe("Search agents");
    expect(host.querySelector("kbd")).toBeNull();
  });

  it("shows an optional shortcut hint", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<SearchField className="search" placeholder="Search containers" shortcut="⌘K" />);
    });
    expect(host.querySelector("kbd")?.textContent).toBe("⌘K");
  });
});
