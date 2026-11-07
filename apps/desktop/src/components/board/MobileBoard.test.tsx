import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardDocument } from "@locus/shared";
import { MobileBoardView } from "./MobileBoard";
import { Store, initialState } from "@/state/store";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    board: vi.fn(),
    upsertBoardObjects: vi.fn(),
    addBoardComment: vi.fn(),
    runBoardFrame: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const board: BoardDocument = {
  id: "b1",
  title: "Phone",
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
  starter: "blank",
  objects: [
    { id: "f1", type: "frame", x: 40, y: 40, w: 400, h: 240, text: "Now" },
    { id: "s1", type: "sticky", x: 60, y: 80, w: 160, h: 140, text: "Note", color: "amber" },
  ],
  comments: [],
};

describe("MobileBoardView", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.mocked(api.board).mockReset();
    vi.mocked(api.upsertBoardObjects).mockReset();
  });

  async function render() {
    vi.mocked(api.board).mockResolvedValue(board);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <Store.Provider value={{ state: initialState, dispatch: () => undefined }}>
          <MobileBoardView boardId="b1" onBack={() => undefined} />
        </Store.Provider>,
      );
      await Promise.resolve();
    });
  }

  it("zooms and edits sticky text instead of opening comment on Sticky", async () => {
    await render();
    expect(host.querySelector("[data-testid='mobile-board-zoom']")).toBeTruthy();
    const add = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Sticky");
    const created: BoardDocument = {
      ...board,
      objects: [
        ...board.objects,
        { id: "s2", type: "sticky", x: 80, y: 80, w: 160, h: 140, text: "", color: "amber" },
      ],
    };
    vi.mocked(api.upsertBoardObjects).mockResolvedValue(created);
    await act(async () => {
      add!.click();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='mobile-board-sticky']")).toBeTruthy();
    expect(host.querySelector("[data-testid='mobile-board-comment']")).toBeFalsy();
  });
});
