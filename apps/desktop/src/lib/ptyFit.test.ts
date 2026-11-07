import { describe, expect, it } from "vitest";
import { fitPty, ptyRowsForHost, ptyVisibleHeight } from "./ptyFit";

function mockBox(el: HTMLElement, height: number, top = 0) {
  el.getBoundingClientRect = () =>
    ({
      x: 0,
      y: top,
      top,
      bottom: top + height,
      left: 0,
      right: 100,
      width: 100,
      height,
      toJSON() {},
    }) as DOMRect;
}

describe("ptyRowsForHost", () => {
  it("fits whole cells into the visible host", () => {
    expect(ptyRowsForHost(167, 15.4)).toBe(10);
    expect(ptyRowsForHost(146, 14)).toBe(10);
  });

  it("keeps an exact fit", () => {
    expect(ptyRowsForHost(154, 14)).toBe(11);
    expect(ptyRowsForHost(180, 15)).toBe(12);
  });

  it("keeps at least one row", () => {
    expect(ptyRowsForHost(10, 15)).toBe(1);
    expect(ptyRowsForHost(180, 0)).toBe(1);
  });
});

describe("ptyVisibleHeight", () => {
  it("intersects the host with an overflow-clip ancestor", () => {
    const outer = document.createElement("div");
    outer.style.overflow = "hidden";
    mockBox(outer, 140);
    const host = document.createElement("div");
    host.className = "pty-host";
    mockBox(host, 167);
    outer.appendChild(host);
    document.body.appendChild(outer);
    expect(ptyVisibleHeight(host)).toBe(140);
    outer.remove();
  });
});

describe("fitPty", () => {
  it("leaves rows alone when the canvas already fits the pty host", () => {
    const host = document.createElement("div");
    host.className = "pty-host";
    mockBox(host, 154);
    const termEl = document.createElement("div");
    mockBox(termEl, 154);
    const screen = document.createElement("div");
    screen.className = "xterm-screen";
    const paint = document.createElement("canvas");
    mockBox(paint, 154);
    screen.appendChild(paint);
    termEl.appendChild(screen);
    host.appendChild(termEl);
    document.body.appendChild(host);
    const term = {
      cols: 80,
      rows: 11,
      element: termEl,
      resize() {
        throw new Error("should not resize");
      },
    };
    fitPty({ fit() {} }, term);
    expect(term.rows).toBe(11);
    host.remove();
  });

  it("resizes down when the canvas sticks out of the pty host", () => {
    const host = document.createElement("div");
    host.className = "pty-host";
    mockBox(host, 146);
    const termEl = document.createElement("div");
    mockBox(termEl, 146);
    const screen = document.createElement("div");
    screen.className = "xterm-screen";
    const paint = document.createElement("canvas");
    mockBox(paint, 154);
    screen.appendChild(paint);
    termEl.appendChild(screen);
    host.appendChild(termEl);
    document.body.appendChild(host);
    const term = {
      cols: 80,
      rows: 11,
      element: termEl,
      resizedTo: undefined as number | undefined,
      resize(_cols: number, rows: number) {
        this.resizedTo = rows;
        this.rows = rows;
        mockBox(paint, rows * 14);
      },
    };
    fitPty({ fit() {} }, term);
    expect(term.resizedTo).toBe(10);
    host.remove();
  });

  it("does not collapse to one row before the host has a height", () => {
    const host = document.createElement("div");
    host.className = "pty-host";
    mockBox(host, 0);
    const termEl = document.createElement("div");
    mockBox(termEl, 0);
    const screen = document.createElement("div");
    screen.className = "xterm-screen";
    const paint = document.createElement("canvas");
    mockBox(paint, 154);
    screen.appendChild(paint);
    termEl.appendChild(screen);
    host.appendChild(termEl);
    document.body.appendChild(host);
    const term = {
      cols: 80,
      rows: 11,
      element: termEl,
      resize() {
        throw new Error("should not resize");
      },
    };
    fitPty({ fit() {} }, term);
    expect(term.rows).toBe(11);
    host.remove();
  });

  it("skips fit while the pane is hidden or collapsed", () => {
    const pane = document.createElement("div");
    pane.hidden = true;
    const host = document.createElement("div");
    host.className = "pty-host";
    mockBox(host, 167);
    const termEl = document.createElement("div");
    mockBox(termEl, 167);
    host.appendChild(termEl);
    pane.appendChild(host);
    document.body.appendChild(pane);
    const term = {
      cols: 80,
      rows: 24,
      element: termEl,
      resize() {
        throw new Error("should not resize");
      },
    };
    fitPty(
      {
        fit() {
          throw new Error("should not fit");
        },
      },
      term,
    );
    expect(term.rows).toBe(24);
    pane.remove();
  });

  it("drops a row when an overflow ancestor clips the host", () => {
    const outer = document.createElement("div");
    outer.style.overflow = "hidden";
    mockBox(outer, 140);
    const host = document.createElement("div");
    host.className = "pty-host";
    mockBox(host, 167);
    const termEl = document.createElement("div");
    mockBox(termEl, 167);
    const screen = document.createElement("div");
    screen.className = "xterm-screen";
    const rowsEl = document.createElement("div");
    rowsEl.className = "xterm-rows";
    mockBox(rowsEl, 154);
    screen.appendChild(rowsEl);
    termEl.appendChild(screen);
    host.appendChild(termEl);
    outer.appendChild(host);
    document.body.appendChild(outer);
    const term = {
      cols: 80,
      rows: 10,
      element: termEl,
      resizedTo: undefined as number | undefined,
      resize(_cols: number, rows: number) {
        this.resizedTo = rows;
        this.rows = rows;
        mockBox(rowsEl, rows * 15.4);
      },
    };
    fitPty({ fit() {} }, term);
    expect(term.resizedTo).toBe(9);
    outer.remove();
  });
});
