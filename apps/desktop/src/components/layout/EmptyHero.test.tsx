import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyHero, EmptyHint, EmptyListNote } from "./EmptyHero";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("empty states", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders the compact hint and list note", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <>
          <EmptyHero title="Board" lead="A local planning canvas." />
          <EmptyHint title="No plugins yet." lead="Ask an agent to add one." />
          <EmptyListNote>No matching agents</EmptyListNote>
        </>,
      );
    });
    expect(host.querySelector(".empty-hero h2")?.textContent).toBe("Board");
    expect(host.querySelector(".empty-hint-title")?.textContent).toBe("No plugins yet.");
    expect(host.querySelector(".empty-list-body")?.textContent).toBe("No matching agents");
  });
});
