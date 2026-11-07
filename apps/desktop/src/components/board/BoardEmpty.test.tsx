import { act, type Dispatch } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardEmpty } from "./BoardEmpty";
import { api } from "@/lib/api";
import { Store, initialState, type Action } from "@/state/store";
import type { BoardDocument, LocusConfig } from "@locus/shared";

vi.mock("@/lib/api", () => ({
  api: {
    createBoard: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config: LocusConfig = {
  theme: "ember",
  providers: [],
  templates: [],
  hardwareProfiles: [],
  forges: [],
  advanced: {
    dataDir: "/tmp",
    qemuBinary: "qemu-system-x86_64",
    swtpmBinary: "swtpm",
    ovmfCodePath: "",
    ovmfVarsPath: "",
    maxConcurrentVms: 4,
    defaultAcceleratorAuto: true,
    logLevel: "info",
    bindHost: "127.0.0.1",
    bindPort: 7420,
    openBrowserOnStart: true,
    hostSharePath: "",
  },
};

const created: BoardDocument = {
  id: "b1",
  title: "Architecture",
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
  objects: [],
  comments: [],
  starter: "architecture",
};

describe("BoardEmpty", () => {
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
        <Store.Provider value={{ state: { ...initialState, config }, dispatch }}>
          <BoardEmpty />
        </Store.Provider>,
      );
    });
  }

  it("creates a board from a starter pill", async () => {
    vi.mocked(api.createBoard).mockResolvedValue(created);
    render();
    const pill = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Architecture"),
    );
    expect(pill).toBeTruthy();
    await act(async () => {
      pill!.click();
    });
    expect(api.createBoard).toHaveBeenCalledWith({
      starter: "architecture",
      prompt: undefined,
    });
    expect(dispatched).toEqual([
      { type: "board", board: created },
      { type: "selectBoard", id: "b1" },
    ]);
  });

  it("lists Retro among the starter pills", () => {
    render();
    const labels = [...host.querySelectorAll(".recipe-grid.pills h3")].map((el) => el.textContent);
    expect(labels).toEqual([
      "Architecture",
      "Sprint",
      "Kanban",
      "Retro",
      "RCA",
      "Research",
      "Blank",
    ]);
  });

  it("uses the same primary New board chrome as New agent and New design", () => {
    render();
    const send = host.querySelector(".composer-send") as HTMLButtonElement;
    expect(send.className).toContain("btn");
    expect(send.className).toContain("primary");
    expect(send.getAttribute("aria-label")).toBe("New board");
    expect(send.textContent).toMatch(/New board/);
  });
});
