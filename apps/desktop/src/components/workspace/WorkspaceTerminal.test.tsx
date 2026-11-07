import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceTerminal,
  focusWorkspaceTerminal,
  restoreIdeTypingFocus,
} from "./WorkspaceTerminal";

type FakeTerm = {
  options: { disableStdin?: boolean };
  textarea?: HTMLTextAreaElement;
  blurred: number;
  focused: number;
  dispose: () => void;
  blur: () => void;
  focus: () => void;
};

const terminals: FakeTerm[] = [];

vi.mock("@/lib/api", () => ({
  workspaceTerminalWsUrl: () => "ws://127.0.0.1/workspace-pty/s1",
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: { disableStdin?: boolean };
    textarea?: HTMLTextAreaElement;
    blurred = 0;
    focused = 0;
    constructor(opts?: { disableStdin?: boolean }) {
      this.options = { disableStdin: Boolean(opts?.disableStdin) };
      terminals.push(this);
    }
    loadAddon() {}
    open(node: HTMLElement) {
      const ta = document.createElement("textarea");
      ta.dataset.testid = "xterm-helper";
      ta.readOnly = true;
      ta.style.left = "-9999em";
      node.appendChild(ta);
      this.textarea = ta;
      ta.focus();
    }
    write() {}
    writeln() {}
    dispose() {}
    blur() {
      this.blurred += 1;
    }
    focus() {
      this.focused += 1;
      this.textarea?.focus();
    }
    onData() {
      return { dispose() {} };
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeWebSocket {
  binaryType = "arraybuffer";
  readyState = 1;
  send() {}
  close() {}
}

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

describe("WorkspaceTerminal", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;
  const previousWs = globalThis.WebSocket;
  const previousRo = globalThis.ResizeObserver;

  afterEach(() => {
    const current = root;
    if (current) act(() => current.unmount());
    host?.remove();
    terminals.length = 0;
    globalThis.WebSocket = previousWs;
    globalThis.ResizeObserver = previousRo;
    host = undefined;
    root = undefined;
  });

  async function render(active = true) {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(<WorkspaceTerminal sessionId="s1" active={active} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("enables stdin while the pane is active", async () => {
    await render(true);
    expect(terminals).toHaveLength(1);
    expect(terminals[0]?.options.disableStdin).toBe(false);
    expect(terminals[0]?.focused).toBeGreaterThan(0);
    expect(
      host!.querySelector("[data-testid='workspace-terminal']")?.getAttribute("tabindex"),
    ).toBe("0");
  });

  it("focuses the helper textarea when you click the pane", async () => {
    await render(true);
    const pane = host!.querySelector("[data-testid='workspace-terminal']") as HTMLDivElement;
    const helper = host!.querySelector("textarea") as HTMLTextAreaElement;
    helper.blur();
    const focused = terminals[0]!.focused;
    act(() => {
      pane.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(terminals[0]?.focused).toBeGreaterThan(focused);
    expect(document.activeElement).toBe(helper);
    expect(helper.readOnly).toBe(false);
    expect(helper.style.left).toBe("0px");
  });

  it("keeps the xterm helper textarea on-screen so Windows Electron can focus it", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../index.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.pty-host \.xterm-helper-textarea \{[\s\S]*?left:\s*0 !important;[\s\S]*?z-index:\s*10 !important;/,
    );
  });

  it("does not pad the xterm parent so FitAddon cannot clip the last row", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../index.css"),
      "utf8",
    );
    const host = css.match(/^\.pty-host \{[^}]+\}/m)?.[0];
    const frame = css.match(/^\.pty-frame \{[^}]+\}/m)?.[0];
    expect(host).toBeTruthy();
    expect(frame).toBeTruthy();
    expect(host).not.toMatch(/padding\s*:/);
    expect(host).not.toMatch(/margin\s*:/);
    expect(host).toMatch(/overflow:\s*hidden/);
    expect(frame).toMatch(/padding:\s*var\(--space-2\);/);
  });

  it("lets the host term pane shrink inside overflow-hidden ancestors", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../index.css"),
      "utf8",
    );
    const term = css.match(
      /\.host-workspace \.docker-desktop\.has-term \.host-term \{[^}]+\}/,
    )?.[0];
    const desktop = css.match(/^\.host-workspace \.desktop \{[^}]+\}/m)?.[0];
    expect(term).toMatch(/min-height:\s*0/);
    expect(desktop).toMatch(/margin:\s*0/);
  });

  it("repositions a readonly helper textarea before focusing", () => {
    const ta = document.createElement("textarea");
    ta.readOnly = true;
    ta.style.left = "-9999em";
    document.body.appendChild(ta);
    const term = {
      options: { disableStdin: false },
      textarea: ta,
      focus() {
        ta.focus();
      },
    };
    expect(focusWorkspaceTerminal(term as Parameters<typeof focusWorkspaceTerminal>[0])).toBe(true);
    expect(ta.readOnly).toBe(false);
    expect(ta.style.left).toBe("0px");
    expect(document.activeElement).toBe(ta);
    ta.remove();
  });

  it("blurs and disables stdin when the pane is hidden so keys reach the editor", async () => {
    await render(true);
    const helper = host!.querySelector("textarea") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(helper);
    act(() => {
      root!.render(<WorkspaceTerminal sessionId="s1" active={false} />);
    });
    expect(terminals[0]?.options.disableStdin).toBe(true);
    expect(terminals[0]?.blurred).toBeGreaterThan(0);
    expect(document.activeElement).not.toBe(helper);
    expect(host!.querySelector("[data-active='0']")).toBeTruthy();
  });

  it("restores the editor caret ahead of the composer", () => {
    const box = document.createElement("div");
    box.innerHTML =
      '<div class="workspace-code"><textarea></textarea></div><div class="composer"><textarea></textarea></div>';
    document.body.appendChild(box);
    const editor = box.querySelector(".workspace-code textarea") as HTMLTextAreaElement;
    const composer = box.querySelector(".composer textarea") as HTMLTextAreaElement;
    composer.focus();
    expect(restoreIdeTypingFocus(box)).toBe(true);
    expect(document.activeElement).toBe(editor);
    box.remove();
  });

  it("falls through to the composer when the editor is disabled", () => {
    const box = document.createElement("div");
    box.innerHTML =
      '<div class="workspace-code"><textarea disabled></textarea></div><div class="composer"><textarea></textarea></div>';
    document.body.appendChild(box);
    const composer = box.querySelector(".composer textarea") as HTMLTextAreaElement;
    expect(restoreIdeTypingFocus(box)).toBe(true);
    expect(document.activeElement).toBe(composer);
    box.remove();
  });
});
