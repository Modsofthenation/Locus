import { describe, expect, it } from "vitest";
import { imageBuildDoneNote } from "./imageBuildProgress.js";
import type { PlanStepStatus } from "./plan.js";
import {
  applyCheckpointWorkingState,
  canClearChat,
  clearSessionConversation,
  compareSessionsForList,
  DOCKER_BOOT_NOTE,
  DOCKER_READY_NOTE,
  isGuestReadyNote,
  isGuestStartNote,
  isSessionWorking,
  isWaitingOnGuestStart,
  sessionListStamp,
  supersededGuestLifecycleIds,
  snapshotCheckpointWorkingState,
  VM_BOOT_NOTE,
  type AgentSession,
} from "./session.js";
import type { TaskItem } from "./workingState.js";

describe("checkpoint working state", () => {
  it("copies scratchpad, task list, and plan onto a snapshot", () => {
    const taskList = [{ id: "t1", text: "land prune", status: "in_progress" as const }];
    const plan = {
      items: [
        { id: "p1", text: "Inspect", status: "running" as const },
        { id: "p2", text: "Patch", status: "pending" as const },
      ],
      phase: "accepted" as const,
      files: ["src/a.ts"],
      risks: ["auth"],
    };
    expect(
      snapshotCheckpointWorkingState({
        scratchpad: "before the turn",
        taskList,
        plan,
      }),
    ).toEqual({
      scratchpad: "before the turn",
      taskList: [{ id: "t1", text: "land prune", status: "in_progress" }],
      plan: {
        items: [
          { id: "p1", text: "Inspect", status: "running" },
          { id: "p2", text: "Patch", status: "pending" },
        ],
        phase: "accepted",
        files: ["src/a.ts"],
        risks: ["auth"],
      },
    });
  });

  it("clones nested rows so later edits do not rewrite the checkpoint", () => {
    const taskList: TaskItem[] = [{ id: "t1", text: "land prune", status: "in_progress" }];
    const plan = {
      items: [{ id: "p1", text: "Inspect", status: "running" as PlanStepStatus }],
      files: ["src/a.ts"],
      risks: ["auth"],
    };
    const snap = snapshotCheckpointWorkingState({ scratchpad: "notes", taskList, plan });
    taskList[0]!.status = "done";
    taskList[0]!.text = "changed";
    plan.items[0]!.status = "done";
    plan.files![0] = "src/b.ts";
    plan.risks![0] = "other";
    expect(snap.taskList?.[0]).toEqual({ id: "t1", text: "land prune", status: "in_progress" });
    expect(snap.plan?.items[0]).toEqual({ id: "p1", text: "Inspect", status: "running" });
    expect(snap.plan?.files).toEqual(["src/a.ts"]);
    expect(snap.plan?.risks).toEqual(["auth"]);
  });

  it("omits missing working state from the snapshot", () => {
    expect(snapshotCheckpointWorkingState({})).toEqual({});
  });

  it("restores working state from a checkpoint", () => {
    const session = {
      scratchpad: "after",
      taskList: [{ id: "t1", text: "changed", status: "done" as const }],
      plan: { items: [{ id: "p1", text: "Inspect", status: "done" as const }] },
    };
    applyCheckpointWorkingState(session, {
      scratchpad: "before the turn",
      taskList: [{ id: "t1", text: "land prune", status: "in_progress" }],
      plan: {
        items: [
          { id: "p1", text: "Inspect", status: "running" },
          { id: "p2", text: "Patch", status: "pending" },
        ],
        phase: "accepted",
      },
    });
    expect(session.scratchpad).toBe("before the turn");
    expect(session.taskList?.[0]?.status).toBe("in_progress");
    expect(session.plan?.items.map((item) => item.status)).toEqual(["running", "pending"]);
  });

  it("clears working state when the checkpoint lacked it", () => {
    const session = {
      scratchpad: "after the turn",
      taskList: [{ id: "t1", text: "changed", status: "done" as const }],
      plan: { items: [{ id: "p1", text: "Inspect", status: "done" as const }] },
    };
    applyCheckpointWorkingState(session, {});
    expect(session.scratchpad).toBeUndefined();
    expect(session.taskList).toBeUndefined();
    expect(session.plan).toBeUndefined();
  });
});

describe("clear session conversation", () => {
  function session(overrides: Partial<AgentSession> = {}): AgentSession {
    return {
      id: "s1",
      title: "Fix login",
      os: "ubuntu",
      templateId: "ubuntu-24.04",
      providerId: "p",
      model: "grok-4",
      status: "idle",
      messages: [],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("is a no-op candidate when the thread is already empty", () => {
    expect(canClearChat(session())).toBe(false);
  });

  it("clears chat and model context and keeps selected repos", () => {
    const row = session({
      repoId: "r1",
      repo: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
      extraRepoIds: ["r2"],
      extraRepos: [{ forge: "github", url: "https://github.com/acme/lib.git", dest: "lib" }],
      instructions: "ship it",
      playbook: "do the work",
      vmId: "v1",
      messages: [{ id: "u1", role: "user", content: "hi", createdAt: "t" }],
      scratchpad: "notes",
      taskList: [{ id: "t1", text: "land it", status: "in_progress" }],
      plan: { items: [{ id: "p1", text: "Inspect", status: "running" }] },
      queue: [{ id: "q1", text: "next" }],
      lastCompact: { dropped: 2, beforeTokens: 9_000, afterTokens: 3_000, source: "heuristic" },
      context: {
        window: 128_000,
        used: 4_000,
        reserved: 0,
        charsPerToken: 4,
        measured: false,
        parts: [{ id: "conversation", label: "Conversation", tokens: 4_000 }],
      },
      usage: { inputTokens: 100, outputTokens: 20 },
      inspectedFiles: ["src/a.ts"],
      subagents: [{ id: "a1", task: "look", status: "done" }],
      cursorCli: { sessionId: "cli-1" },
      claudeCode: { sessionId: "claude-1" },
      cursorCloud: { agentId: "cloud-1" },
      compare: { groupId: "g1", role: "A", peerId: "s2" },
      needsHuman: "Approve this",
      error: "boom",
      checkpoint: { id: "c1", messageCount: 0, createdAt: "t" },
      charsPerToken: 3.5,
    });
    expect(canClearChat(row)).toBe(true);
    clearSessionConversation(row);
    expect(canClearChat(row)).toBe(false);
    expect(row.messages).toEqual([]);
    expect(row.scratchpad).toBeUndefined();
    expect(row.taskList).toBeUndefined();
    expect(row.plan).toBeUndefined();
    expect(row.queue).toBeUndefined();
    expect(row.lastCompact).toBeUndefined();
    expect(row.context).toBeUndefined();
    expect(row.usage).toBeUndefined();
    expect(row.inspectedFiles).toBeUndefined();
    expect(row.subagents).toBeUndefined();
    expect(row.cursorCli).toBeUndefined();
    expect(row.claudeCode).toBeUndefined();
    expect(row.cursorCloud).toBeUndefined();
    expect(row.compare).toBeUndefined();
    expect(row.needsHuman).toBeUndefined();
    expect(row.error).toBeUndefined();
    expect(row.checkpoint).toBeUndefined();
    expect(row.repoId).toBe("r1");
    expect(row.repo).toEqual({
      forge: "github",
      url: "https://github.com/acme/app.git",
      ref: "main",
    });
    expect(row.extraRepoIds).toEqual(["r2"]);
    expect(row.extraRepos).toEqual([
      { forge: "github", url: "https://github.com/acme/lib.git", dest: "lib" },
    ]);
    expect(row.instructions).toBe("ship it");
    expect(row.playbook).toBe("do the work");
    expect(row.vmId).toBe("v1");
    expect(row.title).toBe("Fix login");
    expect(row.charsPerToken).toBe(3.5);
  });
});

describe("session working and guest-start notes", () => {
  it("treats running and provisioning as working", () => {
    expect(isSessionWorking("running")).toBe(true);
    expect(isSessionWorking("provisioning")).toBe(true);
    expect(isSessionWorking("idle")).toBe(false);
    expect(isSessionWorking("draft")).toBe(false);
  });

  it("matches docker and VM boot notes, including the image-build handoff", () => {
    expect(isGuestStartNote(DOCKER_BOOT_NOTE)).toBe(true);
    expect(isGuestStartNote(VM_BOOT_NOTE)).toBe(true);
    expect(isGuestStartNote(imageBuildDoneNote())).toBe(true);
    expect(isGuestStartNote(DOCKER_READY_NOTE)).toBe(false);
    expect(isGuestReadyNote(DOCKER_READY_NOTE)).toBe(true);
    expect(isGuestReadyNote(DOCKER_BOOT_NOTE)).toBe(false);
  });

  it("hides superseded consecutive guest boot notes", () => {
    const hide = supersededGuestLifecycleIds([
      { id: "a", role: "system", content: DOCKER_BOOT_NOTE },
      { id: "b", role: "system", content: DOCKER_BOOT_NOTE },
      { id: "c", role: "system", content: DOCKER_READY_NOTE },
      { id: "d", role: "assistant", content: "hi" },
      { id: "e", role: "system", content: VM_BOOT_NOTE },
    ]);
    expect([...hide]).toEqual(["a", "b"]);
  });

  it("stays waiting while the last activity after the user prompt is a start note", () => {
    expect(
      isWaitingOnGuestStart([
        { role: "user", content: "Design a landing page" },
        { role: "system", content: DOCKER_BOOT_NOTE },
      ]),
    ).toBe(true);
    expect(
      isWaitingOnGuestStart([
        { role: "user", content: "Design a landing page" },
        { role: "system", content: DOCKER_BOOT_NOTE },
        { role: "assistant", content: "" },
      ]),
    ).toBe(true);
    expect(
      isWaitingOnGuestStart([
        { role: "user", content: "Design a landing page" },
        { role: "system", content: DOCKER_BOOT_NOTE },
        { role: "system", content: DOCKER_READY_NOTE },
      ]),
    ).toBe(false);
    expect(
      isWaitingOnGuestStart([
        { role: "user", content: "Design a landing page" },
        { role: "system", content: DOCKER_BOOT_NOTE },
        { role: "assistant", content: "Here is a draft." },
      ]),
    ).toBe(false);
    expect(isWaitingOnGuestStart([{ role: "system", content: DOCKER_BOOT_NOTE }])).toBe(false);
  });
});

describe("compareSessionsForList", () => {
  function row(
    id: string,
    opts: {
      pinned?: boolean;
      createdAt?: string;
      updatedAt?: string;
      userAt?: string;
      hiddenUserAt?: string;
    } = {},
  ) {
    const createdAt = opts.createdAt ?? "2026-01-01T00:00:00.000Z";
    const messages: AgentSession["messages"] = [];
    if (opts.userAt) {
      messages.push({
        id: `${id}-u`,
        role: "user",
        content: "hi",
        createdAt: opts.userAt,
      });
    }
    if (opts.hiddenUserAt) {
      messages.push({
        id: `${id}-h`,
        role: "user",
        content: "nudge",
        hidden: true,
        createdAt: opts.hiddenUserAt,
      });
    }
    return {
      id,
      pinned: opts.pinned,
      messages,
      createdAt,
      updatedAt: opts.updatedAt ?? createdAt,
    };
  }

  it("uses the last visible user prompt, not agent updatedAt", () => {
    const prompted = row("a", {
      userAt: "2026-09-09T10:00:00.000Z",
      updatedAt: "2026-09-09T10:00:00.000Z",
    });
    const ticked = {
      ...prompted,
      updatedAt: "2026-09-09T11:00:00.000Z",
    };
    expect(sessionListStamp(prompted)).toBe("2026-09-09T10:00:00.000Z");
    expect(sessionListStamp(ticked)).toBe("2026-09-09T10:00:00.000Z");
  });

  it("ignores hidden user messages when ranking the list", () => {
    expect(
      sessionListStamp(
        row("a", {
          userAt: "2026-09-09T10:00:00.000Z",
          hiddenUserAt: "2026-09-09T11:00:00.000Z",
          updatedAt: "2026-09-09T11:00:00.000Z",
        }),
      ),
    ).toBe("2026-09-09T10:00:00.000Z");
  });

  it("keeps pinned chats first and does not reorder two running chats by ticks", () => {
    const first = row("a", {
      userAt: "2026-09-09T10:00:00.000Z",
      updatedAt: "2026-09-09T12:00:00.000Z",
    });
    const second = row("b", {
      userAt: "2026-09-09T10:05:00.000Z",
      updatedAt: "2026-09-09T11:00:00.000Z",
    });
    const pinned = row("p", {
      pinned: true,
      userAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    expect([first, second, pinned].sort(compareSessionsForList).map((s) => s.id)).toEqual([
      "p",
      "b",
      "a",
    ]);
  });
});

describe("isWaitingOnGuestStart after a failed start", () => {
  it("stops waiting once the thread records that the container never became ready", () => {
    expect(
      isWaitingOnGuestStart([
        { role: "user", content: "go" },
        { role: "system", content: "Starting the container." },
        {
          role: "system",
          content: "The container did not become ready, so this turn did not run.",
        },
      ]),
    ).toBe(false);
  });
});
