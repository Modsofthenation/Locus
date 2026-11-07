import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@locus/shared";
import { CompareBanner } from "./CompareBanner";
import { api } from "@/lib/api";
import { Store, initialState, type Action } from "@/state/store";

vi.mock("@/lib/api", () => ({
  api: {
    patchSession: vi.fn(),
    abortChat: vi.fn(async () => ({ ok: true })),
    stopVm: vi.fn(async () => ({})),
    mergeWorker: vi.fn(),
    workerDiffs: vi.fn(async () => []),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const a: AgentSession = {
  id: "a",
  title: "Fix login",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  providerId: "p",
  model: "grok-4",
  status: "idle",
  compare: { groupId: "g", role: "A", peerId: "b" },
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

const b: AgentSession = {
  ...a,
  id: "b",
  title: "Fix login · B",
  model: "gpt-4.1",
  compare: { groupId: "g", role: "B", peerId: "a" },
};

describe("CompareBanner", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("switches to B and keeps A by archiving B", async () => {
    const actions: Action[] = [];
    vi.mocked(api.patchSession).mockImplementation(async (id, patch) => {
      const base = id === "a" ? a : b;
      return {
        ...base,
        archived: patch.archived ?? base.archived,
        compare: patch.compare === null ? undefined : (patch.compare ?? base.compare),
      };
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider
        value={{
          state: { ...initialState, sessions: [a, b], selectedId: "a" },
          dispatch: (action) => {
            actions.push(action);
          },
        }}
      >
        <CompareBanner session={a} />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
    expect(host.textContent).toContain("A · grok-4");
    expect(host.textContent).toContain("B · gpt-4.1");

    const switchB = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("B ·"),
    );
    act(() => {
      switchB!.click();
    });
    expect(actions.some((action) => action.type === "select" && action.id === "b")).toBe(true);

    const keepA = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Keep A");
    await act(async () => {
      keepA!.click();
      await Promise.resolve();
    });
    expect(api.patchSession).toHaveBeenCalledWith("b", { archived: true, compare: null });
    expect(api.patchSession).toHaveBeenCalledWith("a", { compare: null });
    expect(actions.some((action) => action.type === "select" && action.id === "a")).toBe(true);
  });

  it("keeps one worker and archives the rest", async () => {
    const link = { groupId: "g", kind: "workers" as const, memberIds: ["w1", "w2", "w3"] };
    const w1: AgentSession = { ...a, id: "w1", title: "Fix · 1", compare: { ...link, role: "1" } };
    const w2: AgentSession = { ...a, id: "w2", title: "Fix · 2", compare: { ...link, role: "2" } };
    const w3: AgentSession = { ...a, id: "w3", title: "Fix · 3", compare: { ...link, role: "3" } };
    vi.mocked(api.patchSession).mockImplementation(async (id, patch) => {
      const base = [w1, w2, w3].find((row) => row.id === id)!;
      return {
        ...base,
        archived: patch.archived ?? base.archived,
        compare: patch.compare === null ? undefined : (patch.compare ?? base.compare),
      };
    });
    const actions: Action[] = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider
        value={{
          state: { ...initialState, selectedId: w2.id, sessions: [w1, w2, w3] },
          dispatch: (action) => {
            actions.push(action);
          },
        }}
      >
        <CompareBanner session={w2} />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
    expect(host.textContent).toContain("Workers");
    expect(host.textContent).toContain("Keep 2");
    const keep = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Keep 2");
    await act(async () => {
      keep!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.patchSession).toHaveBeenCalledWith("w1", { archived: true, compare: null });
    expect(api.patchSession).toHaveBeenCalledWith("w3", { archived: true, compare: null });
    expect(api.patchSession).toHaveBeenCalledWith("w2", { compare: null });
    expect(actions.some((action) => action.type === "select" && action.id === "w2")).toBe(true);
  });

  it("shows live worker status on the parent and a back link on a child", async () => {
    const link = {
      groupId: "g",
      kind: "workers" as const,
      memberIds: ["w1", "w2"],
    };
    const parent: AgentSession = {
      ...a,
      id: "p1",
      title: "Fix login",
      compare: { ...link, role: "parent" },
    };
    const w1: AgentSession = {
      ...a,
      id: "w1",
      title: "Fix · 1",
      status: "running",
      compare: { ...link, role: "1", parentId: "p1" },
    };
    const w2: AgentSession = {
      ...a,
      id: "w2",
      title: "Fix · 2",
      needsHuman: "Approve git_push",
      compare: { ...link, role: "2", parentId: "p1" },
    };
    const actions: Action[] = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, selectedId: parent.id, sessions: [parent, w1, w2] },
            dispatch: (action) => {
              actions.push(action);
            },
          }}
        >
          <CompareBanner session={parent} />
        </Store.Provider>,
      );
    });
    expect(host.textContent).toContain("Workers");
    expect(host.textContent).toMatch(/running/);
    expect(host.textContent).toMatch(/needs you/);
    expect(host.textContent).toContain("Diffs");
    expect(host.textContent).not.toContain("Keep");

    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, selectedId: w1.id, sessions: [parent, w1, w2] },
            dispatch: (action) => {
              actions.push(action);
            },
          }}
        >
          <CompareBanner session={w1} />
        </Store.Provider>,
      );
    });
    const parentBtn = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Parent",
    );
    expect(parentBtn).toBeTruthy();
    act(() => {
      parentBtn!.click();
    });
    expect(actions.some((action) => action.type === "select" && action.id === "p1")).toBe(true);
  });
});
