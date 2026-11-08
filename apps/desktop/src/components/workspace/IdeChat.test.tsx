import { act, useReducer, type Dispatch, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdeChat } from "./IdeChat";
import { Store, initialState, reducer, type Action, type UiState } from "@/state/store";

vi.mock("@/components/chat/ChatPane", () => ({
  ChatPane: () => <section className="chat">thread</section>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("IdeChat", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(state: UiState) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    function Harness({ children }: { children: ReactNode }) {
      const [current, dispatch] = useReducer(reducer, state);
      return (
        <Store.Provider value={{ state: current, dispatch: dispatch as Dispatch<Action> }}>
          {children}
        </Store.Provider>
      );
    }
    act(() => {
      root.render(
        <Harness>
          <IdeChat />
        </Harness>,
      );
    });
  }

  it("renders chat on the right with a collapse control", () => {
    render({ ...initialState, section: "ide", vmCollapsed: false });
    expect(host.querySelector(".ide-chat")).toBeTruthy();
    expect(host.querySelector(".chat")?.textContent).toBe("thread");
    expect(host.querySelector('[title="Collapse chat"]')).toBeTruthy();
  });

  it("renders a chat rail when the pane is collapsed", () => {
    render({ ...initialState, section: "ide", vmCollapsed: true });
    expect(host.querySelector(".ide-chat-rail")).toBeTruthy();
    expect(host.querySelector('[title="Chat"]')).toBeTruthy();
    expect(host.querySelector(".chat")).toBeNull();
  });
});
