import { act, type Dispatch } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, BoardDocument } from "@locus/shared";
import { BoardPane } from "./BoardPane";
import { Store, initialState, type Action } from "@/state/store";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    board: vi.fn(),
    patchBoard: vi.fn(),
    boardChat: vi.fn(),
    session: vi.fn(),
    addBoardComment: vi.fn(),
    resolveBoardComment: vi.fn(),
    repoPulls: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/components/chat/ChatPane", () => ({
  ChatPane: () => <div data-testid="chat-pane" />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.PointerEvent !== "function") {
  class PointerEventPolyfill extends MouseEvent {
    constructor(type: string, init: MouseEventInit = {}) {
      super(type, init);
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as typeof PointerEvent;
}

if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = function () {};
  HTMLElement.prototype.releasePointerCapture = function () {};
}

const board: BoardDocument = {
  id: "b1",
  title: "Architecture",
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
  starter: "architecture",
  objects: [
    { id: "f1", type: "frame", x: 40, y: 40, w: 400, h: 240, text: "Context" },
    { id: "s1", type: "sticky", x: 60, y: 80, w: 160, h: 140, text: "API gateway", color: "amber" },
  ],
  comments: [],
};

const chat: AgentSession = {
  id: "chat-1",
  title: "Architecture",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  providerId: "p",
  model: "grok-4",
  status: "idle",
  kind: "board",
  runtime: "host",
  boardId: "b1",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

describe("BoardPane", () => {
  let host: HTMLDivElement;
  let root: Root;
  let dispatched: Action[] = [];

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render() {
    dispatched = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const dispatch = ((action: Action) => {
      dispatched.push(action);
    }) as Dispatch<Action>;
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              section: "board",
              selectedBoardId: "b1",
              boardDocuments: { b1: board },
              vmCollapsed: true,
            },
            dispatch,
          }}
        >
          <BoardPane />
        </Store.Provider>,
      );
    });
  }

  it("sends the selected sticky to board chat from Ask Locus", async () => {
    vi.mocked(api.boardChat).mockResolvedValue({
      board: { ...board, chatSessionId: "chat-1" },
      sessionId: "chat-1",
    });
    vi.mocked(api.session).mockResolvedValue(chat);
    render();
    const stage = host.querySelector(".board-stage") as HTMLDivElement;
    stage.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        toJSON() {},
      }) as DOMRect;
    act(() => {
      stage.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 120,
          clientY: 160,
          pointerId: 1,
          button: 0,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: 120, clientY: 160, pointerId: 1 }),
      );
    });
    const ask = host.querySelector(
      '.board-overlay-bar [aria-label="Ask Locus"]',
    ) as HTMLButtonElement | null;
    expect(ask).toBeTruthy();
    await act(async () => {
      ask!.click();
    });
    expect(api.boardChat).toHaveBeenCalled();
    const prompt = vi.mocked(api.boardChat).mock.calls[0]?.[1];
    expect(prompt).toMatch(/API gateway/);
    expect(dispatched.some((row) => row.type === "toggleVmPane")).toBe(true);
    expect(dispatched.some((row) => row.type === "select" && row.id === "chat-1")).toBe(true);
  });
});
