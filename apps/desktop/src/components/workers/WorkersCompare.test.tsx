import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, LocusConfig, WorkerBoardRow } from "@locus/shared";
import { WorkersBoard } from "./WorkersBoard";
import { api } from "@/lib/api";
import { askConfirm } from "@/lib/dialog";
import { Store, initialState, type Action } from "@/state/store";

vi.mock("@/lib/api", () => ({
  api: {
    workerBoard: vi.fn(),
    workerDiffs: vi.fn(async () => []),
    mergeWorker: vi.fn(),
    discardWorker: vi.fn(async () => ({ ok: true })),
    rankWorkers: vi.fn(),
    chat: vi.fn(async () => ({})),
  },
}));
vi.mock("@/lib/dialog", () => ({ askConfirm: vi.fn(async () => true) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const parent: AgentSession = {
  id: "p",
  title: "Fix login",
  os: "ubuntu",
  templateId: "host",
  runtime: "host",
  providerId: "claude",
  model: "opus",
  status: "idle",
  compare: { groupId: "g", kind: "workers", role: "parent", memberIds: ["w1", "w2", "w3"] },
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

function row(id: string, over: Partial<WorkerBoardRow> = {}): WorkerBoardRow {
  return {
    id,
    title: `Fix login · ${id}`,
    role: id.slice(1),
    status: "idle",
    providerId: "claude",
    model: "opus",
    branch: `locus/fix-login-${id}`,
    stat: { files: 1, insertions: 5, deletions: 1 },
    commits: 1,
    dirty: 0,
    ...over,
  };
}

const rows: WorkerBoardRow[] = [
  row("w1", { tests: "pass", usd: 0.42, files: ["src/login.ts", "src/login.test.ts"] }),
  row("w2", { tests: "fail", providerId: "codex", model: "gpt", files: ["src/auth.ts"] }),
  row("w3", { status: "running", stat: { files: 0, insertions: 0, deletions: 0 } }),
];

const config = {
  providers: [
    { id: "claude", name: "Claude Code" },
    { id: "codex", name: "Codex CLI" },
  ],
} as unknown as LocusConfig;

describe("WorkersBoard compare view", () => {
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

  async function render() {
    await act(async () => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, config, sessions: [parent], selectedId: "p" },
            dispatch: (action) => actions.push(action),
          }}
        >
          <WorkersBoard session={parent} initialView="compare" onClose={vi.fn()} />
        </Store.Provider>,
      );
    });
  }

  const col = (role: string) =>
    document.querySelector(`[aria-label="Attempt ${role}"]`) as HTMLElement;
  const button = (el: ParentNode, label: string) =>
    [...el.querySelectorAll("button")].find((b) => b.textContent === label) as HTMLButtonElement;
  const columnOrder = () =>
    [...document.querySelectorAll(".workers-compare-col")].map((el) =>
      el.getAttribute("aria-label"),
    );

  it("shows one column per attempt with tests, cost and changed files", async () => {
    await render();
    expect(columnOrder()).toEqual(["Attempt 1", "Attempt 2", "Attempt 3"]);
    expect(col("1").textContent).toContain("Claude Code");
    expect(col("1").textContent).toContain("Tests pass");
    expect(col("1").textContent).toContain("$0.42");
    expect(col("1").textContent).toContain("src/login.test.ts");
    expect(col("2").textContent).toContain("Codex CLI");
    expect(col("2").textContent).toContain("Tests fail");
    expect(col("3").textContent).toContain("Tests not run");
    expect(col("3").textContent).toContain("Running");
    expect(button(col("3"), "Pick this one").disabled).toBe(true);
  });

  it("switches between board and compare", async () => {
    await render();
    await act(async () => button(document, "Board").click());
    expect(document.querySelector('[aria-label="Agent 1"]')).not.toBeNull();
    expect(col("1")).toBeNull();
    await act(async () => button(document, "Compare").click());
    expect(col("1")).not.toBeNull();
  });

  it("picks one: merges it, then discards the others in one confirm", async () => {
    vi.mocked(api.mergeWorker).mockResolvedValue({ ...parent, title: "merged" });
    await render();
    await act(async () => button(col("1"), "Pick this one").click());
    expect(api.mergeWorker).toHaveBeenCalledWith("p", "w1", { approveRisk: false });
    expect(askConfirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(askConfirm).mock.calls[0]![0]).toMatchObject({
      title: "Discard 2 other attempts?",
    });
    expect(vi.mocked(api.discardWorker).mock.calls.map((c) => c[0])).toEqual(["w2", "w3"]);
    expect(actions).toContainEqual({ type: "deleted", id: "w2" });
    expect(actions).toContainEqual({ type: "deleted", id: "w3" });
  });

  it("keeps the others when discard is declined", async () => {
    vi.mocked(api.mergeWorker).mockResolvedValue(parent);
    vi.mocked(askConfirm).mockResolvedValueOnce(false);
    await render();
    await act(async () => button(col("2"), "Pick this one").click());
    expect(api.mergeWorker).toHaveBeenCalledWith("p", "w2", { approveRisk: false });
    expect(api.discardWorker).not.toHaveBeenCalled();
  });

  it("does not offer discard when the merge fails", async () => {
    vi.mocked(api.mergeWorker).mockRejectedValue(new Error("Merge conflicts in a.ts"));
    await render();
    await act(async () => button(col("1"), "Pick this one").click());
    expect(askConfirm).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Merge conflicts in a.ts");
  });

  it("ranks attempts and reorders columns with badges and reasons", async () => {
    vi.mocked(api.rankWorkers).mockResolvedValue({
      source: "model",
      entries: [
        { id: "w2", rank: 1, reason: "Fixes the root cause" },
        { id: "w1", rank: 2, reason: "Works but adds a flag" },
        { id: "w3", rank: 3, reason: "No changes" },
      ],
    });
    await render();
    await act(async () => button(document, "Rank").click());
    expect(api.rankWorkers).toHaveBeenCalledWith("p");
    expect(columnOrder()).toEqual(["Attempt 2", "Attempt 1", "Attempt 3"]);
    expect(col("2").querySelector(".workers-compare-rank")?.textContent).toBe("#1");
    expect(col("2").textContent).toContain("Fixes the root cause");
    expect(document.body.textContent).toContain("a model broke ties");
  });

  it("labels a heuristic ranking as suggested", async () => {
    vi.mocked(api.rankWorkers).mockResolvedValue({
      source: "heuristic",
      entries: [
        { id: "w1", rank: 1, reason: "Tests pass · 6 lines · $0.42" },
        { id: "w2", rank: 2, reason: "Tests fail · 6 lines" },
        { id: "w3", rank: 3, reason: "No changes" },
      ],
    });
    await render();
    await act(async () => button(document, "Rank").click());
    expect(document.body.textContent).toContain("Suggested");
    expect(col("1").querySelector(".workers-compare-rank")?.textContent).toBe("#1");
  });

  it("shows the diff for one attempt", async () => {
    vi.mocked(api.workerDiffs).mockResolvedValue([
      { id: "w1", role: "1", diff: "diff --git a/x b/x\n+added" },
    ]);
    await render();
    await act(async () => button(col("1"), "Diff").click());
    expect(col("1").querySelector("pre .is-add")?.textContent).toContain("+added");
  });
});
