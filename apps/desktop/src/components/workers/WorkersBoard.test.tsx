import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, LocusConfig, WorkerBoardRow } from "@locus/shared";
import { OPEN_PR_PROMPT, WorkersBoard } from "./WorkersBoard";
import { api } from "@/lib/api";
import { askConfirm } from "@/lib/dialog";
import { Store, initialState, type Action } from "@/state/store";

vi.mock("@/lib/api", () => ({
  api: {
    workerBoard: vi.fn(),
    workerDiffs: vi.fn(async () => []),
    mergeWorker: vi.fn(),
    discardWorker: vi.fn(async () => ({ ok: true })),
    chat: vi.fn(async () => ({})),
  },
}));
vi.mock("@/lib/dialog", () => ({ askConfirm: vi.fn(async () => true) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base: AgentSession = {
  id: "p",
  title: "Speed up build",
  os: "ubuntu",
  templateId: "host",
  runtime: "host",
  providerId: "claude",
  model: "opus",
  status: "idle",
  compare: { groupId: "g", kind: "workers", role: "parent", memberIds: ["w1", "w2"] },
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};
const w1: AgentSession = {
  ...base,
  id: "w1",
  compare: { groupId: "g", kind: "workers", role: "1", memberIds: ["w1", "w2"], parentId: "p" },
};
const w2: AgentSession = {
  ...w1,
  id: "w2",
  providerId: "codex",
  model: "gpt",
  status: "running",
  compare: { ...w1.compare!, role: "2" },
};

const rows: WorkerBoardRow[] = [
  {
    id: "w1",
    title: "Speed up build · 1",
    role: "1",
    status: "idle",
    providerId: "claude",
    model: "opus",
    branch: "locus/speed-up-build-abc",
    worktreePath: "/data/worktrees/repo-abc",
    stat: { files: 2, insertions: 10, deletions: 3 },
    commits: 1,
    dirty: 0,
  },
  {
    id: "w2",
    title: "Speed up build · 2",
    role: "2",
    status: "running",
    providerId: "codex",
    model: "gpt",
    branch: "locus/speed-up-build-def",
    worktreePath: "/data/worktrees/repo-def",
    stat: { files: 0, insertions: 0, deletions: 0 },
    commits: 0,
    dirty: 0,
  },
];

const config = {
  providers: [
    { id: "claude", name: "Claude Code" },
    { id: "codex", name: "Codex CLI" },
  ],
} as unknown as LocusConfig;

describe("WorkersBoard", () => {
  let host: HTMLDivElement;
  let root: Root;
  let actions: Action[];

  beforeEach(() => {
    vi.mocked(api.workerBoard).mockResolvedValue(rows);
    actions = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  async function render(session: AgentSession = base, onClose = vi.fn()) {
    await act(async () => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, config, sessions: [base, w1, w2], selectedId: session.id },
            dispatch: (action) => actions.push(action),
          }}
        >
          <WorkersBoard session={session} onClose={onClose} />
        </Store.Provider>,
      );
    });
    return onClose;
  }

  const card = (role: string) =>
    document.querySelector(`[aria-label="Agent ${role}"]`) as HTMLElement;
  const button = (el: HTMLElement, label: string) =>
    [...el.querySelectorAll("button")].find((b) => b.textContent === label) as HTMLButtonElement;

  it("lists each agent with provider, branch and diffstat", async () => {
    await render();
    expect(api.workerBoard).toHaveBeenCalledWith("p");
    expect(card("1").textContent).toContain("Claude Code");
    expect(card("1").textContent).toContain("locus/speed-up-build-abc");
    expect(card("1").textContent).toContain("+10");
    expect(card("1").textContent).toContain("1 commits");
    expect(card("2").textContent).toContain("Codex CLI");
    expect(card("2").textContent).toContain("Running");
    expect(document.body.textContent).toContain("separate git worktree");
  });

  it("uses the parent id when opened from a worker", async () => {
    await render(w1);
    expect(api.workerBoard).toHaveBeenCalledWith("p");
  });

  it("merges a finished agent and blocks merging a running one", async () => {
    vi.mocked(api.mergeWorker).mockResolvedValue({ ...base, title: "merged" });
    await render();
    expect(button(card("2"), "Merge").disabled).toBe(true);
    await act(async () => button(card("1"), "Merge").click());
    expect(api.mergeWorker).toHaveBeenCalledWith("p", "w1", { approveRisk: false });
    expect(actions).toContainEqual({ type: "session", session: { ...base, title: "merged" } });
  });

  it("shows merge errors inline", async () => {
    vi.mocked(api.mergeWorker).mockRejectedValue(new Error("Merge conflicts in a.ts"));
    await render();
    await act(async () => button(card("1"), "Merge").click());
    expect(document.body.textContent).toContain("Merge conflicts in a.ts");
  });

  it("asks the agent to open a PR", async () => {
    await render();
    await act(async () => button(card("1"), "Open PR").click());
    expect(api.chat).toHaveBeenCalledWith("w1", OPEN_PR_PROMPT);
  });

  it("discards after confirming", async () => {
    await render();
    await act(async () => button(card("1"), "Discard").click());
    expect(askConfirm).toHaveBeenCalled();
    expect(api.discardWorker).toHaveBeenCalledWith("w1");
    expect(actions).toContainEqual({ type: "deleted", id: "w1" });
  });

  it("keeps the agent when discard is cancelled", async () => {
    vi.mocked(askConfirm).mockResolvedValueOnce(false);
    await render();
    await act(async () => button(card("1"), "Discard").click());
    expect(api.discardWorker).not.toHaveBeenCalled();
  });

  it("opens an agent and closes the board", async () => {
    const onClose = await render();
    await act(async () => button(card("2"), "Open").click());
    expect(actions).toContainEqual({ type: "select", id: "w2" });
    expect(onClose).toHaveBeenCalled();
  });

  it("expands a diff", async () => {
    vi.mocked(api.workerDiffs).mockResolvedValue([
      { id: "w1", role: "1", diff: "diff --git a/x b/x\n+added\n-removed" },
    ]);
    await render();
    await act(async () => button(card("1"), "Diff").click());
    const pre = card("1").querySelector("pre")!;
    expect(pre.querySelector(".is-add")?.textContent).toContain("+added");
    expect(pre.querySelector(".is-del")?.textContent).toContain("-removed");
  });
});
