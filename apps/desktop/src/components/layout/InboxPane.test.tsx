import { act, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, Automation, AutomationRun } from "@locus/shared";
import { Store, initialState, reducer, type Action, type UiState } from "@/state/store";
import { api } from "@/lib/api";
import { InboxPane } from "./InboxPane";

const waiting = {
  id: "s1",
  title: "Review checkout",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  providerId: "p",
  model: "m",
  status: "idle",
  vmId: "v1",
  needsHuman: "Approve git_push",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
} as unknown as AgentSession;

describe("InboxPane", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(api, "modelUsage").mockResolvedValue({ models: [] });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  /** Runs the real reducer so focus changes (J/K, Prev/Next) re-render. */
  function renderLive(state: UiState) {
    const seen = vi.fn();
    function Live() {
      const [live, dispatch] = useReducer(reducer, state);
      const spy = (action: Action) => {
        seen(action);
        dispatch(action);
      };
      return (
        <Store.Provider value={{ state: live, dispatch: spy }}>
          <InboxPane />
        </Store.Provider>
      );
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<Live />);
    });
    return seen;
  }

  function render(state: UiState, dispatch = vi.fn()) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider value={{ state, dispatch }}>
          <InboxPane />
        </Store.Provider>,
      );
    });
    return dispatch;
  }

  it("says all caught up when nothing waits", () => {
    render({ ...initialState, inboxOpen: true });
    expect(host.querySelector(".empty-hero h2")?.textContent).toBe("All caught up");
    expect(host.querySelector("[data-testid='inbox-next']")).toBeNull();
  });

  it("previews the next item and opens its target", () => {
    const dispatch = render({ ...initialState, inboxOpen: true, sessions: [waiting] });
    expect(host.querySelector(".inbox-decision-head h2")?.textContent).toBe("1 item needs you");
    const next = host.querySelector("[data-testid='inbox-next']");
    expect(next?.textContent).toContain("Review checkout");
    expect(next?.querySelector(".inbox-next-kind")?.textContent).toBe("Question");
    act(() => {
      (next?.querySelector("button") as HTMLButtonElement).click();
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "select", id: "s1" });
    expect(dispatch).toHaveBeenCalledWith({ type: "inbox", open: false });
  });

  const approval = {
    ...waiting,
    id: "s2",
    title: "Run checks",
    needsHuman: undefined,
    runtime: "docker",
    messages: [
      {
        id: "m1",
        role: "assistant",
        content: "Running the suite to confirm.",
        createdAt: "2020-01-01T00:00:00.000Z",
        toolCalls: [
          {
            id: "c1",
            name: "exec",
            arguments: { command: "npm test" },
            startedAt: "2020-01-01T00:00:00.000Z",
            approval: "needed",
          },
        ],
      },
    ],
  } as unknown as AgentSession;

  it("shows the command and reason for an approval and decides it in place", async () => {
    const spy = vi.spyOn(api, "resolveApproval").mockResolvedValue(approval);
    const dispatch = render({ ...initialState, inboxOpen: true, sessions: [approval] });
    expect(host.querySelector("[data-testid='inbox-command']")?.textContent).toBe("npm test");
    expect(host.querySelector("[data-testid='inbox-why']")?.textContent).toBe(
      "Running the suite to confirm.",
    );
    expect(host.textContent).toContain("Docker container");
    await act(async () => {
      (host.querySelector("[data-testid='inbox-approve']") as HTMLButtonElement).click();
    });
    expect(spy).toHaveBeenCalledWith("s2", "c1", "approved", undefined, undefined);
    expect(dispatch).toHaveBeenCalledWith({ type: "session", session: approval });
    spy.mockRestore();
  });

  it("moves with J/K and denies with D", async () => {
    const spy = vi.spyOn(api, "resolveApproval").mockResolvedValue(approval);
    renderLive({ ...initialState, inboxOpen: true, sessions: [waiting, approval] });
    expect(host.querySelector("[data-testid='inbox-stepper']")?.textContent).toContain("1 of 2");
    expect(host.querySelector("[data-testid='inbox-next']")?.textContent).toContain(
      "Review checkout",
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    });
    expect(host.querySelector("[data-testid='inbox-next']")?.textContent).toContain("Run checks");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
    });
    expect(spy).toHaveBeenCalledWith("s2", "c1", "denied", undefined, undefined);
    spy.mockRestore();
  });

  it("shows active agents, review chats, and counts beside the decision card", () => {
    const working = {
      ...waiting,
      id: "s3",
      title: "Fix flaky test",
      status: "running",
      needsHuman: undefined,
    } as AgentSession;
    const review = {
      ...waiting,
      id: "s4",
      title: "Review #12",
      kind: "review",
      status: "running",
      needsHuman: undefined,
    } as AgentSession;
    const dispatch = render({
      ...initialState,
      inboxOpen: true,
      sessions: [waiting, working, review],
    });
    const stats = host.querySelector("[data-testid='dash-stats']")?.textContent ?? "";
    expect(stats).toContain("1Needs you");
    expect(stats).toContain("1Active agents");
    expect(stats).toContain("1Reviews running");
    const active = host.querySelector("[data-testid='dash-active']");
    expect(active?.textContent).toContain("Fix flaky test");
    expect(active?.textContent).not.toContain("Review #12");
    expect(host.querySelector("[data-testid='dash-reviewers']")?.textContent).toContain(
      "Review #12",
    );
    act(() => {
      (active?.querySelector("button.dash-line") as HTMLButtonElement).click();
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "select", id: "s3" });
    expect(dispatch).toHaveBeenCalledWith({ type: "inbox", open: false });
  });

  it("labels approvals and shows waiting chats as Needs you under Recent", () => {
    render({ ...initialState, inboxOpen: true, sessions: [approval] });
    expect(host.querySelector(".inbox-next-kind")?.textContent).toBe("Approval");
    expect(host.textContent).toContain("Risk");
    expect(host.textContent).not.toContain("Why ask");
    const recent = host.querySelector("[data-testid='dash-recent']");
    expect(recent?.textContent).toContain("Run checks");
    expect(recent?.textContent).toContain("Needs you");
    expect(recent?.textContent).not.toContain("Idle");
    expect(recent?.querySelector(".dot.needs-you")).toBeTruthy();
  });

  it("jumps to a panel from its stat tile", () => {
    render({ ...initialState, inboxOpen: true, sessions: [waiting] });
    const tile = host.querySelector("[aria-controls='dash-active']") as HTMLButtonElement;
    expect(tile.tagName).toBe("BUTTON");
    act(() => tile.click());
    expect(document.activeElement?.id).toBe("dash-active");
  });

  it("folds active agents past five into a link to Agents and labels running counts", () => {
    const busy = Array.from(
      { length: 7 },
      (_, i) =>
        ({
          ...waiting,
          id: `w${i}`,
          title: `Busy ${i}`,
          status: "running",
          needsHuman: undefined,
        }) as AgentSession,
    );
    const dispatch = render({ ...initialState, inboxOpen: true, sessions: busy });
    const active = host.querySelector("[data-testid='dash-active']");
    expect(active?.querySelectorAll("button.dash-line")).toHaveLength(5);
    const more = host.querySelector("[data-testid='dash-active-more']") as HTMLButtonElement;
    expect(more.textContent).toBe("+2 more in Agents");
    act(() => more.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "section", section: "agents" });
    expect(host.querySelector("[data-testid='dash-jobs'] .dash-panel-count")).toBeNull();
  });

  it("shows why a job failed, opens that run, and counts only executing jobs as running", () => {
    const job = {
      id: "nightly",
      name: "Nightly build",
      enabled: true,
    } as Automation;
    const failed: AutomationRun = {
      id: "failed-run",
      automationId: job.id,
      status: "failed",
      trigger: "schedule",
      error: "Cannot connect to the Docker daemon",
      startedAt: "2026-11-21T10:00:00Z",
      finishedAt: "2026-11-21T10:01:00Z",
    };
    const dispatch = render({
      ...initialState,
      automations: [job],
      runs: [failed, { ...failed, id: "queued", automationId: "other", status: "queued" }],
    });
    expect(host.querySelector("[aria-controls='dash-jobs']")?.textContent).toContain(
      "0Jobs running1 queued · 1 failing",
    );
    expect(host.querySelector(".dash-queue")?.textContent).toContain("Docker isn't running");
    const view = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "View run",
    );
    expect(view).toBeDefined();
    act(() => view!.click());
    expect(dispatch).toHaveBeenCalledWith({
      type: "selectAutomation",
      id: job.id,
      runId: failed.id,
    });
  });
});
