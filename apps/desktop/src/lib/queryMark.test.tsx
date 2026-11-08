import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { HighlightQuery } from "./queryMark";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("HighlightQuery", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("marks the query inside the text", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<HighlightQuery text="Settings · OpenAI" query="open" />);
    });
    expect(host.querySelector("mark")?.textContent).toBe("Open");
    expect(host.textContent).toBe("Settings · OpenAI");
  });
});
