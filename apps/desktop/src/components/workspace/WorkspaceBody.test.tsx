import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STACKED_WORKSPACE_QUERY } from "@/lib/useStackedWorkspace";
import {
  CHAT_SPLIT_DEFAULT,
  CHAT_SPLIT_KEY,
  COLLAPSED_BODY_COLUMNS,
  COLLAPSED_BODY_ROWS,
  DESIGN_SPLIT_KEY,
  IDE_SPLIT_DEFAULT,
  IDE_SPLIT_KEY,
  SINGLE_BODY_TRACK,
  WorkspaceBody,
  stackedBodyRows,
} from "./WorkspaceBody";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.PointerEvent !== "function") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as typeof PointerEvent;
}

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");
const originalMatchMedia = window.matchMedia;

function stubStackedMedia(matches: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: query === STACKED_WORKSPACE_QUERY ? matches : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;
}

describe("WorkspaceBody", () => {
  let host: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    localStorage.removeItem(CHAT_SPLIT_KEY);
    localStorage.removeItem(DESIGN_SPLIT_KEY);
    localStorage.removeItem(IDE_SPLIT_KEY);
    stubStackedMedia(false);
    host = document.createElement("div");
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    const current = root;
    if (current) act(() => current.unmount());
    host.remove();
    root = undefined;
  });

  function render(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    const next = createRoot(host);
    root = next;
    act(() => {
      next.render(node);
    });
  }

  function bodyEl(): HTMLElement {
    const body = host.querySelector(".body") as HTMLElement;
    body.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: 600,
        right: 1000,
        width: 1000,
        height: 600,
        toJSON() {
          return {};
        },
      }) as DOMRect;
    return body;
  }

  it("exposes a draggable gutter between chat and preview", () => {
    render(
      <WorkspaceBody
        variant="agent"
        collapsed={false}
        chat={<section className="chat">chat</section>}
        preview={<aside className="vm-pane">preview</aside>}
      />,
    );
    const gutter = host.querySelector(".body-gutter") as HTMLDivElement;
    expect(gutter).toBeTruthy();
    expect(gutter.getAttribute("role")).toBe("separator");
    expect(host.querySelector("#files-pane.body-files")).toBeTruthy();
    expect(gutter.getAttribute("aria-label")).toBe("Resize chat and preview");
    expect((host.querySelector(".body") as HTMLElement).style.gridTemplateColumns).toMatch(
      new RegExp(`^minmax\\(0, ${CHAT_SPLIT_DEFAULT}fr\\)`),
    );
  });

  it("resizes chat vs preview from the gutter and remembers the split", () => {
    render(
      <WorkspaceBody
        variant="agent"
        collapsed={false}
        chat={<section className="chat">chat</section>}
        preview={<aside className="vm-pane">preview</aside>}
      />,
    );
    const gutter = host.querySelector(".body-gutter") as HTMLDivElement;
    bodyEl();
    act(() => {
      gutter.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 550, pointerId: 1 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 650, pointerId: 1 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: 650, pointerId: 1 }),
      );
    });
    expect((host.querySelector(".body") as HTMLElement).style.gridTemplateColumns).toMatch(
      /^minmax\(0, 0\.65fr\)/,
    );
    expect(localStorage.getItem(CHAT_SPLIT_KEY)).toBe("0.65");
  });

  it("keeps a zero-width gutter when the preview is collapsed and drops it for host-only chat", () => {
    render(
      <WorkspaceBody
        variant="agent"
        collapsed
        chat={<section className="chat">chat</section>}
        preview={<aside className="vm-pane rail">rail</aside>}
      />,
    );
    const gutter = host.querySelector(".body-gutter") as HTMLDivElement;
    expect(gutter).toBeTruthy();
    expect(gutter.getAttribute("aria-hidden")).toBe("true");
    expect(gutter.tabIndex).toBe(-1);
    expect((host.querySelector(".body") as HTMLElement).classList.contains("vm-collapsed")).toBe(
      true,
    );
    expect((host.querySelector(".body") as HTMLElement).style.gridTemplateColumns).toBe(
      COLLAPSED_BODY_COLUMNS,
    );
    act(() => {
      root!.render(
        <WorkspaceBody
          variant="host"
          collapsed={false}
          chat={<section className="chat">chat</section>}
          preview={null}
        />,
      );
    });
    expect(host.querySelector(".body-gutter")).toBeNull();
    expect((host.querySelector(".body") as HTMLElement).classList.contains("host-chat")).toBe(true);
  });

  it("moves the split with arrow keys", () => {
    render(
      <WorkspaceBody
        variant="design"
        collapsed={false}
        chat={<section className="chat">chat</section>}
        preview={<aside className="vm-pane">canvas</aside>}
      />,
    );
    const gutter = host.querySelector(".body-gutter") as HTMLDivElement;
    act(() => {
      gutter.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    });
    expect((host.querySelector(".body") as HTMLElement).style.gridTemplateColumns).toMatch(
      /^minmax\(0, 0\.43fr\)/,
    );
    expect(localStorage.getItem(DESIGN_SPLIT_KEY)).toBe("0.43");
  });

  it("marks the gutter and stacks the panes in CSS so narrow windows stay usable", () => {
    expect(css).toMatch(/\.body-gutter \{[\s\S]*?cursor:\s*col-resize/);
    expect(css).toMatch(/\.body\.resizing iframe \{[\s\S]*?pointer-events:\s*none/);
    expect(css).toMatch(/\.body \{[\s\S]*?transition:\s*grid-template-columns var\(--dur-slow\)/);
    expect(css).toMatch(
      /\.body\.vm-collapsed \{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) 0px minmax\(44px, 0fr\)/,
    );
    expect(css).toMatch(
      /\.body\.ide \{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1\.25fr\) 6px minmax\(0,\s*0\.75fr\)/,
    );
    expect(css).toMatch(/\.body\.resizing \{[\s\S]*?transition:\s*none/);
    expect(css).toMatch(
      /\.body-stacked \{[\s\S]*?transition:\s*grid-template-rows var\(--dur-slow\)/,
    );
    expect(css).toMatch(/\.body-stacked \.body-gutter \{[\s\S]*?cursor:\s*row-resize/);
    expect(css).toMatch(
      /\.body-stacked \.vm-pane\.rail \{[\s\S]*?border-top:\s*2px solid var\(--line-strong\)/,
    );
    expect(css).toMatch(/\.body-stacked \.vm-toolbar \{[\s\S]*?flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.body-stacked\.vm-collapsed \.body-files[\s\S]*?min-height:\s*48px/);
    expect(css).toMatch(/\.body \{[\s\S]*?min-width:\s*0/);
    expect(css).toMatch(
      /\.body \{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1\.15fr\) 6px minmax\(0,\s*0\.95fr\)/,
    );
    expect(css).toMatch(/\.vm-pane \{[\s\S]*?width:\s*100%/);
    expect(css).toMatch(
      /@media \(max-width: 760px\) \{[\s\S]*?\.side-main \{[\s\S]*?position:\s*absolute/,
    );
  });

  it("puts the editor first and chat on the right in the IDE layout", () => {
    render(
      <WorkspaceBody
        variant="ide"
        collapsed={false}
        chat={<section className="chat">chat</section>}
        preview={<aside className="vm-pane">editor</aside>}
      />,
    );
    const body = host.querySelector(".body") as HTMLElement;
    expect(body.classList.contains("ide")).toBe(true);
    expect(body.firstElementChild?.className).toMatch(/body-files/);
    expect(body.firstElementChild?.firstElementChild?.className).toMatch(/vm-pane/);
    expect(body.lastElementChild?.className).toMatch(/chat/);
    expect(host.querySelector(".body-gutter")?.getAttribute("aria-label")).toBe(
      "Resize editor and chat",
    );
    expect(body.style.gridTemplateColumns).toMatch(
      new RegExp(`^minmax\\(0, ${IDE_SPLIT_DEFAULT}fr\\)`),
    );
  });

  it("remembers the IDE split separately from agent chat", () => {
    render(
      <WorkspaceBody
        variant="ide"
        collapsed={false}
        chat={<section className="chat">chat</section>}
        preview={<aside className="vm-pane">editor</aside>}
      />,
    );
    const gutter = host.querySelector(".body-gutter") as HTMLDivElement;
    bodyEl();
    act(() => {
      gutter.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 620, pointerId: 1 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 520, pointerId: 1 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: 520, pointerId: 1 }),
      );
    });
    expect((host.querySelector(".body") as HTMLElement).style.gridTemplateColumns).toMatch(
      /^minmax\(0, 0\.52fr\)/,
    );
    expect(localStorage.getItem(IDE_SPLIT_KEY)).toBe("0.52");
    expect(localStorage.getItem(CHAT_SPLIT_KEY)).toBeNull();
  });

  it("collapses IDE chat to the right-hand rail", () => {
    render(
      <WorkspaceBody
        variant="ide"
        collapsed
        chat={<aside className="vm-pane rail">chat rail</aside>}
        preview={<aside className="vm-pane">editor</aside>}
      />,
    );
    const body = host.querySelector(".body") as HTMLElement;
    expect(body.firstElementChild?.textContent).toBe("editor");
    expect(body.lastElementChild?.textContent).toBe("chat rail");
    expect(body.style.gridTemplateColumns).toBe(COLLAPSED_BODY_COLUMNS);
  });

  it("puts files and canvas in a bottom pane on portrait or narrow screens", () => {
    stubStackedMedia(true);
    render(
      <WorkspaceBody
        variant="agent"
        collapsed={false}
        chat={<section className="chat">chat</section>}
        preview={<aside className="vm-pane">files</aside>}
      />,
    );
    const body = host.querySelector(".body") as HTMLElement;
    expect(body.classList.contains("body-stacked")).toBe(true);
    expect(body.style.gridTemplateColumns).toBe(SINGLE_BODY_TRACK);
    expect(body.style.gridTemplateRows).toMatch(
      new RegExp(`^minmax\\(0, ${CHAT_SPLIT_DEFAULT}fr\\)`),
    );
    expect(host.querySelector(".body-gutter")?.getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("collapses the stacked files pane to a bottom rail", () => {
    stubStackedMedia(true);
    render(
      <WorkspaceBody
        variant="agent"
        collapsed
        chat={<section className="chat">chat</section>}
        preview={<aside className="vm-pane rail">Files</aside>}
      />,
    );
    const body = host.querySelector(".body") as HTMLElement;
    expect(body.classList.contains("body-stacked")).toBe(true);
    expect(body.style.gridTemplateColumns).toBe(SINGLE_BODY_TRACK);
    expect(body.style.gridTemplateRows).toBe(COLLAPSED_BODY_ROWS);
  });

  it("uses a pixel bottom track so the stacked rail can expand", () => {
    expect(stackedBodyRows(0.55, true, 800)).toBe(COLLAPSED_BODY_ROWS);
    expect(stackedBodyRows(0.55, false, 800)).toBe("minmax(0, 1fr) 6px 357px");
    expect(stackedBodyRows(0.55, false, 0)).toMatch(/^minmax\(0, 0\.55fr\)/);
  });

  it("resizes the stacked split from the horizontal gutter", () => {
    stubStackedMedia(true);
    render(
      <WorkspaceBody
        variant="design"
        collapsed={false}
        chat={<section className="chat">chat</section>}
        preview={<aside className="vm-pane">canvas</aside>}
      />,
    );
    const gutter = host.querySelector(".body-gutter") as HTMLDivElement;
    bodyEl();
    act(() => {
      gutter.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 400,
          clientY: 240,
          pointerId: 1,
        }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 400,
          clientY: 360,
          pointerId: 1,
        }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: 400, clientY: 360, pointerId: 1 }),
      );
    });
    expect((host.querySelector(".body") as HTMLElement).style.gridTemplateRows).toMatch(
      /^minmax\(0, 0\.6fr\)/,
    );
    expect(localStorage.getItem(DESIGN_SPLIT_KEY)).toBe("0.6");
  });

  it("moves the stacked split with arrow keys", () => {
    stubStackedMedia(true);
    render(
      <WorkspaceBody
        variant="agent"
        collapsed={false}
        chat={<section className="chat">chat</section>}
        preview={<aside className="vm-pane">files</aside>}
      />,
    );
    const gutter = host.querySelector(".body-gutter") as HTMLDivElement;
    act(() => {
      gutter.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });
    expect((host.querySelector(".body") as HTMLElement).style.gridTemplateRows).toMatch(
      /^minmax\(0, 0\.58fr\)/,
    );
    expect(localStorage.getItem(CHAT_SPLIT_KEY)).toBe("0.58");
  });
});
