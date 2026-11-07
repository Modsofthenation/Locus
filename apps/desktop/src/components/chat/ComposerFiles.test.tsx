import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComposerAddButton,
  ComposerFileThumbs,
  ComposerTextarea,
  mergeComposerFiles,
} from "./ComposerFiles";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function ensureObjectUrl() {
  if (typeof URL.createObjectURL !== "function") {
    URL.createObjectURL = () => "blob:clip";
    URL.revokeObjectURL = () => undefined;
  }
}

function mockRect(el: HTMLElement, box = { left: 10, top: 10, right: 90, bottom: 26 }) {
  const rect = {
    ...box,
    width: box.right - box.left,
    height: box.bottom - box.top,
    x: box.left,
    y: box.top,
    toJSON: () => ({}),
  } as DOMRect;
  el.getBoundingClientRect = () => rect;
  el.getClientRects = () => [rect] as unknown as DOMRectList;
}

function previewPop() {
  return document.querySelector("[data-testid=composer-paste-preview]");
}

describe("mergeComposerFiles", () => {
  it("caps at four files", () => {
    const a = new File(["a"], "a.png", { type: "image/png" });
    const rows = [a, a, a];
    expect(mergeComposerFiles(rows, [a, a]).length).toBe(4);
  });
});

describe("ComposerFileThumbs", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders an image thumbnail with the filename", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const file = new File([new Uint8Array([137, 80, 78, 71])], "clip.png", { type: "image/png" });
    const onRemove = vi.fn();
    ensureObjectUrl();
    act(() => {
      root.render(<ComposerFileThumbs files={[file]} onRemove={onRemove} />);
    });
    expect(host.querySelector(".composer-attach")).toBeTruthy();
    expect(host.querySelector("img")?.getAttribute("alt")).toBe("clip.png");
    expect(host.querySelector(".composer-thumb")?.textContent).not.toBeNull();
    act(() => {
      (host.querySelector(".composer-thumb") as HTMLButtonElement).click();
    });
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it("shows a file chip for a non-image attachment", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    act(() => {
      root.render(<ComposerFileThumbs files={[file]} onRemove={() => undefined} />);
    });
    expect(host.querySelector(".composer-thumb.is-file")?.textContent).toContain("note.txt");
  });

  it("renders an @Clipboard chip with a line count", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const file = new File(["alpha\nbeta\ngamma"], "Clipboard.txt", { type: "text/plain" });
    await act(async () => {
      root.render(<ComposerFileThumbs files={[file]} onRemove={() => undefined} />);
    });
    expect(host.querySelector(".composer-thumb.is-clipboard")).toBeTruthy();
    await act(async () => {
      await vi.waitFor(() => {
        expect(host.querySelector(".composer-thumb-label")?.textContent).toBe(
          "@Clipboard (3 lines)",
        );
      });
    });
  });

  it("previews clipboard text when hovering the chip", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const file = new File(["alpha\nbeta\ngamma"], "Clipboard.txt", { type: "text/plain" });
    await act(async () => {
      root.render(<ComposerFileThumbs files={[file]} onRemove={() => undefined} />);
    });
    const btn = host.querySelector(".composer-thumb") as HTMLButtonElement;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      btn.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    });
    expect(previewPop()?.querySelector("pre")?.textContent).toContain("alpha");
    expect(previewPop()?.textContent).toContain("Clipboard.txt");
  });

  it("previews a pasted image when hovering the thumbnail", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    ensureObjectUrl();
    const file = new File([new Uint8Array([137, 80, 78, 71])], "clip.png", { type: "image/png" });
    act(() => {
      root.render(<ComposerFileThumbs files={[file]} onRemove={() => undefined} />);
    });
    const btn = host.querySelector(".composer-thumb") as HTMLButtonElement;
    act(() => {
      btn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      btn.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    });
    expect(previewPop()?.querySelector("img")?.getAttribute("alt")).toBe("clip.png");
  });

  it("does not preview a plain file chip", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    act(() => {
      root.render(<ComposerFileThumbs files={[file]} onRemove={() => undefined} />);
    });
    const btn = host.querySelector(".composer-thumb") as HTMLButtonElement;
    act(() => {
      btn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      btn.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    });
    expect(previewPop()).toBeNull();
  });

  it("picks files from the hidden input", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onPick = vi.fn();
    act(() => {
      root.render(
        <ComposerAddButton title="Attach a file" onPick={onPick} onError={() => undefined} />,
      );
    });
    const input = host.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    act(() => {
      Object.defineProperty(input, "files", { value: [file] as unknown as FileList });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onPick).toHaveBeenCalledWith([file]);
  });
});

describe("ComposerTextarea paste chips", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function renderBox(value: string, files?: File[]) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<ComposerTextarea value={value} files={files} onChange={() => undefined} />);
    });
    return host.querySelector("textarea") as HTMLTextAreaElement;
  }

  it("snaps a caret that landed inside a paste chip to the nearer edge", () => {
    const ta = renderBox("See [[paste:clip.png]] now");
    act(() => {
      ta.selectionStart = ta.selectionEnd = 10;
      ta.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(ta.selectionStart).toBe(4);
    expect(ta.selectionEnd).toBe(4);
  });

  it("expands a selection that starts inside a paste chip", () => {
    const ta = renderBox("See [[paste:clip.png]] now");
    act(() => {
      ta.selectionStart = 8;
      ta.selectionEnd = 14;
      ta.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(ta.selectionStart).toBe(4);
    expect(ta.selectionEnd).toBe(22);
  });

  it("skips a paste chip as one token with the arrow keys", () => {
    const ta = renderBox("See [[paste:clip.png]] now");
    act(() => {
      ta.selectionStart = ta.selectionEnd = 22;
      ta.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }),
      );
    });
    expect(ta.selectionStart).toBe(4);
    expect(ta.selectionEnd).toBe(4);
    act(() => {
      ta.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });
    expect(ta.selectionStart).toBe(22);
    expect(ta.selectionEnd).toBe(22);
  });

  it("previews clipboard text when hovering an inline paste chip", async () => {
    const file = new File(["alpha\nbeta\ngamma"], "Clipboard.txt", { type: "text/plain" });
    const ta = renderBox("See [[paste:Clipboard.txt]] now", [file]);
    const chip = host.querySelector(".composer-paste-chip") as HTMLElement;
    mockRect(chip);
    await act(async () => {
      ta.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 15, bubbles: true }));
    });
    expect(previewPop()?.querySelector("pre")?.textContent).toContain("beta");
    expect(previewPop()?.textContent).toContain("Clipboard.txt");
  });

  it("previews a pasted image when hovering an inline paste chip", () => {
    ensureObjectUrl();
    const file = new File([new Uint8Array([137, 80, 78, 71])], "clip.png", { type: "image/png" });
    const ta = renderBox("See [[paste:clip.png]] now", [file]);
    const chip = host.querySelector(".composer-paste-chip") as HTMLElement;
    mockRect(chip);
    act(() => {
      ta.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 15, bubbles: true }));
    });
    expect(previewPop()?.querySelector("img")?.getAttribute("alt")).toBe("clip.png");
  });

  it("hides the preview after the pointer leaves the chip", () => {
    vi.useFakeTimers();
    try {
      ensureObjectUrl();
      const file = new File([new Uint8Array([137, 80, 78, 71])], "clip.png", { type: "image/png" });
      const ta = renderBox("See [[paste:clip.png]] now", [file]);
      const chip = host.querySelector(".composer-paste-chip") as HTMLElement;
      mockRect(chip);
      act(() => {
        ta.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 15, bubbles: true }));
      });
      expect(previewPop()).toBeTruthy();
      act(() => {
        ta.dispatchEvent(
          new MouseEvent("mousemove", { clientX: 400, clientY: 400, bubbles: true }),
        );
      });
      expect(previewPop()).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(previewPop()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
