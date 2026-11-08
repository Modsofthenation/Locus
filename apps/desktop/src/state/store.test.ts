import { describe, expect, it } from "vitest";
import {
  initialState,
  openSettings,
  reducer,
  sectionEnter,
  sectionQuery,
  sessionFitsSection,
  type Action,
} from "./store";
import type { AgentSession } from "@locus/shared";
import { formatWhen } from "@/components/automations/Automations";

const session = (id: string, title: string): AgentSession => ({
  id,
  title,
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  providerId: "p",
  model: "grok-4",
  status: "idle",
  messages: [{ id: "m1", role: "assistant", content: "hi", createdAt: "2020-01-01T00:00:00.000Z" }],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
});

describe("reducer", () => {
  it("tracks product mode transitions for the shell loader", () => {
    const state = reducer(initialState, {
      type: "productModeTransition",
      transition: { from: "developer", to: "swarm" },
    });
    expect(state.productModeTransition).toEqual({ from: "developer", to: "swarm" });
    expect(
      reducer(state, { type: "productModeTransition", transition: null }).productModeTransition,
    ).toBe(null);
  });

  it("keeps a full transcript when a list-view snapshot arrives", () => {
    const full = {
      ...session("a", "One"),
      messages: [
        {
          id: "m1",
          role: "assistant" as const,
          content: "full tool dump ".repeat(40),
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    };
    let state = reducer(initialState, { type: "session", session: full });
    state = reducer(state, {
      type: "sessions",
      sessions: [
        {
          ...full,
          title: "Renamed",
          listView: true,
          messages: [
            {
              id: "m1",
              role: "assistant",
              content: "full tool dump …",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
    });
    expect(state.sessions[0]?.title).toBe("Renamed");
    expect(state.sessions[0]?.listView).toBeUndefined();
    expect(state.sessions[0]?.messages[0]?.content).toBe(full.messages[0]?.content);
  });

  it("keeps listView when a list snapshot adds newer message ids", () => {
    const full = {
      ...session("a", "One"),
      messages: [
        {
          id: "m1",
          role: "assistant" as const,
          content: "full tool dump ".repeat(40),
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    };
    let state = reducer(initialState, { type: "session", session: full });
    state = reducer(state, {
      type: "sessions",
      sessions: [
        {
          ...full,
          title: "Renamed",
          updatedAt: "2020-01-01T00:01:00.000Z",
          listView: true,
          messages: [
            {
              id: "m1",
              role: "assistant",
              content: "full tool dump …",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
            {
              id: "m2",
              role: "user",
              content: "follow up",
              createdAt: "2020-01-01T00:01:00.000Z",
            },
          ],
        },
      ],
    });
    expect(state.sessions[0]?.title).toBe("Renamed");
    expect(state.sessions[0]?.listView).toBe(true);
    expect(state.sessions[0]?.messages.map((row) => row.id)).toEqual(["m1", "m2"]);
    expect(state.sessions[0]?.messages[0]?.content).toBe(full.messages[0]?.content);
  });

  it("keeps fuller nested subagent transcripts across a list snapshot", () => {
    const full = {
      ...session("a", "One"),
      subagents: [
        {
          id: "sa1",
          task: "look",
          status: "done" as const,
          messages: [
            {
              id: "s1",
              role: "assistant" as const,
              content: "nested dump ".repeat(40),
              createdAt: "2020-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
    };
    let state = reducer(initialState, { type: "session", session: full });
    state = reducer(state, {
      type: "sessions",
      sessions: [
        {
          ...full,
          listView: true,
          subagents: [
            {
              id: "sa1",
              task: "look",
              status: "done" as const,
              messages: [
                {
                  id: "s1",
                  role: "assistant" as const,
                  content: "nested dump …",
                  createdAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(state.sessions[0]?.listView).toBeUndefined();
    expect(state.sessions[0]?.subagents?.[0]?.messages?.[0]?.content).toBe(
      full.subagents[0]?.messages[0]?.content,
    );
  });

  it("replaces a list-view snapshot with the full session payload", () => {
    const slim = {
      ...session("a", "One"),
      listView: true,
      messages: [
        {
          id: "m1",
          role: "assistant" as const,
          content: "full tool dump …",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    };
    const full = {
      ...session("a", "One"),
      messages: [
        {
          id: "m1",
          role: "assistant" as const,
          content: "full tool dump ".repeat(40),
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    };
    let state = reducer(initialState, { type: "session", session: slim });
    expect(state.sessions[0]?.listView).toBe(true);
    state = reducer(state, { type: "session", session: full });
    expect(state.sessions[0]?.listView).toBeUndefined();
    expect(state.sessions[0]?.messages[0]?.content).toBe(full.messages[0]?.content);
  });

  it("selects and streams deltas", () => {
    let state = reducer(initialState, { type: "session", session: session("a", "One") });
    state = reducer(state, { type: "select", id: "a" });
    expect(state.selectedId).toBe("a");
    state = reducer(state, { type: "delta", sessionId: "a", messageId: "m1", delta: " there" });
    expect(state.sessions[0]?.messages[0]?.content).toBe("hi there");
    state = reducer(state, {
      type: "session",
      session: {
        ...session("a", "One"),
        messages: [
          { id: "m1", role: "assistant", content: "hi", createdAt: "2020-01-01T00:00:00.000Z" },
        ],
      },
    });
    expect(state.sessions[0]?.messages[0]?.content).toBe("hi there");
  });

  it("appends chat.message events without duplicating ids", () => {
    let state = reducer(initialState, { type: "session", session: session("a", "One") });
    state = reducer(state, {
      type: "message",
      sessionId: "a",
      message: { id: "u1", role: "user", content: "hello", createdAt: "2020-01-01T00:00:02.000Z" },
    });
    expect(state.sessions[0]?.messages.map((row) => row.id)).toEqual(["m1", "u1"]);
    state = reducer(state, {
      type: "message",
      sessionId: "a",
      message: { id: "u1", role: "user", content: "hello", createdAt: "2020-01-01T00:00:02.000Z" },
    });
    expect(state.sessions[0]?.messages).toHaveLength(2);
  });

  it("stores live thinking snippets until a delta arrives", () => {
    let state = reducer(initialState, {
      type: "thinking",
      sessionId: "a",
      snippet: "plan the page",
    });
    expect(state.thinking.a).toBe("plan the page");
    state = reducer(state, { type: "session", session: session("a", "One") });
    state = reducer(state, { type: "delta", sessionId: "a", messageId: "m1", delta: " there" });
    expect(state.thinking.a).toBeUndefined();
  });

  it("clears live thinking even if the delta message is missing", () => {
    let state = reducer(initialState, { type: "session", session: session("a", "One") });
    state = reducer(state, { type: "thinking", sessionId: "a", snippet: "plan" });
    state = reducer(state, { type: "delta", sessionId: "a", messageId: "missing", delta: "x" });
    expect(state.thinking.a).toBeUndefined();
    expect(state.sessions[0]?.messages[0]?.content).toBe("hi");
  });

  it("patches a streaming delta without rewriting earlier messages", () => {
    const messages = Array.from({ length: 40 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `row ${i}`,
      createdAt: "2020-01-01T00:00:00.000Z",
    }));
    let state = reducer(initialState, {
      type: "session",
      session: { ...session("a", "One"), messages },
    });
    const before = state.sessions[0]!.messages;
    state = reducer(state, { type: "delta", sessionId: "a", messageId: "m39", delta: "!" });
    const after = state.sessions[0]!.messages;
    expect(after[39]?.content).toBe("row 39!");
    expect(after[0]).toBe(before[0]);
    expect(after[38]).toBe(before[38]);
    expect(after[39]).not.toBe(before[39]);
  });

  it("appends thinking deltas onto the assistant message", () => {
    let state = reducer(initialState, { type: "session", session: session("a", "One") });
    state = reducer(state, {
      type: "thinkingDelta",
      sessionId: "a",
      messageId: "m1",
      delta: "plan ",
    });
    state = reducer(state, {
      type: "thinkingDelta",
      sessionId: "a",
      messageId: "m1",
      delta: "the page",
    });
    expect(state.sessions[0]?.messages[0]?.thinking).toBe("plan the page");
    state = reducer(state, {
      type: "session",
      session: {
        ...session("a", "One"),
        messages: [
          { id: "m1", role: "assistant", content: "hi", createdAt: "2020-01-01T00:00:00.000Z" },
        ],
      },
    });
    expect(state.sessions[0]?.messages[0]?.thinking).toBe("plan the page");
  });

  it("stores live clone progress until it is cleared", () => {
    let state = reducer(initialState, {
      type: "cloneProgress",
      sessionId: "a",
      progress: { percent: 36, phase: "Receiving objects" },
    });
    expect(state.cloneProgress.a).toEqual({ percent: 36, phase: "Receiving objects" });
    state = reducer(state, { type: "cloneProgress", sessionId: "a", progress: null });
    expect(state.cloneProgress.a).toBeUndefined();
  });

  it("stores live image build progress until it is cleared", () => {
    let state = reducer(initialState, {
      type: "imageProgress",
      sessionId: "a",
      progress: { percent: 30, phase: "RUN apt-get update", step: 2, total: 6 },
    });
    expect(state.imageProgress.a).toEqual({
      percent: 30,
      phase: "RUN apt-get update",
      step: 2,
      total: 6,
    });
    state = reducer(state, { type: "imageProgress", sessionId: "a", progress: null });
    expect(state.imageProgress.a).toBeUndefined();
  });

  it("stores live QEMU install progress until it is cleared", () => {
    let state = reducer(initialState, {
      type: "qemuInstall",
      progress: { percent: 40, phase: "Installing QEMU", log: "apt-get install" },
    });
    expect(state.qemuInstall).toEqual({
      percent: 40,
      phase: "Installing QEMU",
      log: "apt-get install",
    });
    state = reducer(state, { type: "qemuInstall", progress: null });
    expect(state.qemuInstall).toBeNull();
  });

  it("stores streamed canvas html per session", () => {
    let state = reducer(initialState, { type: "canvas", sessionId: "d1", html: "<h1>Draft</h1>" });
    expect(state.canvasHtml.d1).toBe("<h1>Draft</h1>");
    state = reducer(state, { type: "canvas", sessionId: "d1", html: "<h1>Draft deck</h1>" });
    expect(state.canvasHtml.d1).toBe("<h1>Draft deck</h1>");
    state = reducer(state, { type: "deleted", id: "d1" });
    expect(state.canvasHtml.d1).toBeUndefined();
  });

  it("stores last playtest shot and drops it with the session", () => {
    let state = reducer(initialState, { type: "gameShot", sessionId: "g1", image: "aaaa" });
    expect(state.gameShots.g1).toBe("aaaa");
    state = reducer(state, { type: "gameShot", sessionId: "g1", image: "bbbb" });
    expect(state.gameShots.g1).toBe("bbbb");
    state = reducer(state, { type: "gameShot", sessionId: "g1", image: null });
    expect(state.gameShots.g1).toBeUndefined();
    state = reducer(state, { type: "gameShot", sessionId: "g1", image: "cccc" });
    state = reducer(state, { type: "deleted", id: "g1" });
    expect(state.gameShots.g1).toBeUndefined();
  });

  it("keeps streamed deltas when a sessions resync is older", () => {
    let state = reducer(initialState, { type: "session", session: session("a", "One") });
    state = reducer(state, { type: "delta", sessionId: "a", messageId: "m1", delta: " there" });
    state = reducer(state, {
      type: "sessions",
      sessions: [
        {
          ...session("a", "One"),
          messages: [
            { id: "m1", role: "assistant", content: "hi", createdAt: "2020-01-01T00:00:00.000Z" },
          ],
        },
      ],
    });
    expect(state.sessions[0]?.messages[0]?.content).toBe("hi there");
  });

  it("drops deleted sessions", () => {
    let state = reducer(initialState, { type: "session", session: session("a", "One") });
    state = reducer(state, { type: "thinking", sessionId: "a", snippet: "plan the page" });
    state = reducer(state, { type: "select", id: "a" });
    state = reducer(state, { type: "deleted", id: "a" });
    expect(state.sessions).toHaveLength(0);
    expect(state.selectedId).toBeNull();
    expect(state.thinking.a).toBeUndefined();
  });

  it("deselects an agent without opening the new-agent modal", () => {
    let state = reducer(initialState, { type: "session", session: session("a", "One") });
    state = reducer(state, { type: "select", id: "a" });
    state = reducer(state, { type: "select", id: null });
    expect(state.section).toBe("agents");
    expect(state.selectedId).toBeNull();
    expect(state.newOpen).toBe(false);
  });

  it("collapses the agent list and the guest pane independently", () => {
    let state = reducer(initialState, { type: "toggleSidebar" });
    expect(state.collapsed).toBe(true);
    expect(state.vmCollapsed).toBe(true);
    state = reducer(state, { type: "toggleVmPane" });
    expect(state.collapsed).toBe(true);
    expect(state.vmCollapsed).toBe(false);
    state = reducer(state, { type: "toggleSidebar" });
    state = reducer(state, { type: "toggleVmPane" });
    expect(state.collapsed).toBe(false);
    expect(state.vmCollapsed).toBe(true);
  });

  it("marks unread until the session is selected", () => {
    let state = reducer(initialState, { type: "session", session: session("a", "One") });
    state = reducer(state, { type: "session", session: session("b", "Two") });
    state = reducer(state, { type: "select", id: "a" });
    state = reducer(state, { type: "unread", id: "b" });
    expect(state.unreadIds).toEqual(["b"]);
    state = reducer(state, { type: "unread", id: "b" });
    expect(state.unreadIds).toEqual(["b"]);
    state = reducer(state, { type: "select", id: "b" });
    expect(state.unreadIds).toEqual([]);
    state = reducer(state, { type: "unread", id: "a" });
    state = reducer(state, { type: "deleted", id: "a" });
    expect(state.unreadIds).toEqual([]);
  });

  it("snapshots last seen when you leave a chat and forgets it on delete", () => {
    const a = session("a", "One");
    const b = {
      ...session("b", "Two"),
      messages: [
        { id: "u1", role: "user" as const, content: "hi", createdAt: "2020-01-01T00:00:00.000Z" },
        {
          id: "a1",
          role: "assistant" as const,
          content: "hello",
          createdAt: "2020-01-01T00:00:01.000Z",
        },
      ],
    };
    let state = reducer(initialState, { type: "session", session: a });
    state = reducer(state, { type: "session", session: b });
    state = reducer(state, { type: "select", id: "b" });
    expect(state.lastSeenMessageIds).toEqual({});
    state = reducer(state, { type: "select", id: "a" });
    expect(state.lastSeenMessageIds).toEqual({ b: "a1" });
    expect(state.chatNewVisit).toEqual({ sessionId: "a" });
    state = reducer(state, { type: "settings", open: true });
    expect(state.lastSeenMessageIds).toEqual({ b: "a1", a: "m1" });
    expect(state.chatNewVisit).toBeNull();
    state = reducer(state, { type: "deleted", id: "b" });
    expect(state.lastSeenMessageIds).toEqual({ a: "m1" });
  });

  it("freezes the New marker for the visit so live messages do not move it", () => {
    const a = session("a", "One");
    const b = {
      ...session("b", "Two"),
      messages: [
        { id: "u1", role: "user" as const, content: "hi", createdAt: "2020-01-01T00:00:00.000Z" },
        {
          id: "a1",
          role: "assistant" as const,
          content: "hello",
          createdAt: "2020-01-01T00:00:01.000Z",
        },
      ],
    };
    let state = reducer(initialState, { type: "session", session: b });
    state = reducer(state, { type: "select", id: "b" });
    expect(state.chatNewVisit).toEqual({ sessionId: "b" });
    state = reducer(state, {
      type: "message",
      sessionId: "b",
      message: {
        id: "a2",
        role: "assistant",
        content: "live",
        createdAt: "2020-01-01T00:00:02.000Z",
      },
    });
    expect(state.chatNewVisit).toEqual({ sessionId: "b" });
    state = reducer(state, { type: "session", session: a });
    state = reducer(state, { type: "select", id: "a" });
    expect(state.lastSeenMessageIds.b).toBe("a2");
    expect(state.chatNewVisit).toEqual({ sessionId: "a" });
    state = reducer(state, {
      type: "message",
      sessionId: "b",
      message: {
        id: "a3",
        role: "assistant",
        content: "while away",
        createdAt: "2020-01-01T00:00:03.000Z",
      },
    });
    state = reducer(state, { type: "select", id: "b" });
    expect(state.chatNewVisit).toEqual({ sessionId: "b", markerId: "a3" });
    state = reducer(state, { type: "settings", open: true });
    expect(state.chatNewVisit).toBeNull();
    state = reducer(state, { type: "settings", open: false });
    expect(state.chatNewVisit).toEqual({ sessionId: "b" });
  });

  it("tracks automations, run history, and jumping to a chat", () => {
    const automation = {
      id: "auto-1",
      name: "Nightly",
      enabled: true,
      prompt: "lint",
      os: "ubuntu" as const,
      templateId: "ubuntu-24.04",
      providerId: "p",
      model: "grok-4",
      startVm: true,
      schedule: { kind: "daily" as const, hour: 9, minute: 0 },
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    let state = reducer(initialState, { type: "automation", automation });
    state = reducer(state, { type: "selectAutomation", id: "auto-1" });
    expect(state.section).toBe("automations");
    expect(state.selectedAutomationId).toBe("auto-1");
    state = reducer(state, {
      type: "run",
      run: {
        id: "r1",
        automationId: "auto-1",
        sessionId: "a",
        status: "succeeded",
        trigger: "manual",
        startedAt: "2020-01-02T00:00:00.000Z",
        finishedAt: "2020-01-02T00:01:00.000Z",
      },
    });
    expect(state.runs[0]?.id).toBe("r1");
    state = reducer(state, { type: "select", id: "a" });
    expect(state.section).toBe("agents");
    expect(state.selectedId).toBe("a");
    state = reducer(state, { type: "automationDeleted", id: "auto-1" });
    expect(state.automations).toHaveLength(0);
    expect(state.runs).toHaveLength(0);
  });

  it("opens a new automation with a starter", () => {
    const state = reducer(initialState, {
      type: "newAutomation",
      open: true,
      starterId: "nightly",
    });
    expect(state.newAutomationOpen).toBe(true);
    expect(state.automationStarterId).toBe("nightly");
    expect(state.editingAutomationId).toBeNull();
  });

  it("marks automation runs unread until the automation is selected", () => {
    const automation = {
      id: "auto-1",
      name: "Nightly",
      enabled: true,
      prompt: "lint",
      os: "ubuntu" as const,
      templateId: "ubuntu-24.04",
      providerId: "p",
      model: "grok-4",
      startVm: true,
      schedule: { kind: "daily" as const, hour: 9, minute: 0 },
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    let state = reducer(initialState, { type: "automation", automation });
    state = reducer(state, { type: "select", id: "a" });
    state = reducer(state, { type: "unreadAutomation", id: "auto-1" });
    expect(state.unreadAutomationIds).toEqual(["auto-1"]);
    state = reducer(state, { type: "unreadAutomation", id: "auto-1" });
    expect(state.unreadAutomationIds).toEqual(["auto-1"]);
    state = reducer(state, { type: "selectAutomation", id: "auto-1" });
    expect(state.unreadAutomationIds).toEqual([]);
    state = reducer(state, { type: "unreadAutomation", id: "auto-1" });
    state = reducer(state, { type: "automationDeleted", id: "auto-1" });
    expect(state.unreadAutomationIds).toEqual([]);
  });

  it("opens the setup wizard when hydrate reports needsWizard", () => {
    const state = reducer(initialState, {
      type: "hydrate",
      config: {
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
      },
      sessions: [],
      vms: [],
      setup: {
        hypervisorKind: "mock",
        qemuFound: false,
        qemuHint: "sudo apt install qemu-system-x86 qemu-utils ovmf swtpm",
        kvmLabel: "KVM not present — guests will use TCG (slower)",
        linuxImageReady: false,
        dockerFound: false,
        hasProvider: false,
        hasGoldenImage: false,
        setupCompleted: false,
        ready: false,
        needsWizard: true,
        hostOs: { platform: "linux", label: "Linux" },
        qemuInstall: {
          method: "apt",
          displayCommand: "sudo apt install qemu-system-x86 qemu-utils ovmf swtpm",
          canInstall: true,
          packages: ["qemu-system-x86", "qemu-utils", "ovmf", "swtpm"],
          manualHint: "sudo apt install qemu-system-x86 qemu-utils ovmf swtpm",
        },
      },
    });
    expect(state.setupOpen).toBe(true);
    expect(state.setup?.needsWizard).toBe(true);
  });

  it("clears sessions and selections on reset", () => {
    let state = reducer(initialState, { type: "session", session: session("a", "One") });
    state = reducer(state, { type: "select", id: "a" });
    state = reducer(state, { type: "settings", open: true });
    state = reducer(state, {
      type: "reset",
      config: {
        theme: "ember",
        providers: [],
        templates: [],
        hardwareProfiles: [],
        forges: [],
        advanced: {
          dataDir: "/tmp/locus",
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
      },
      setup: {
        hypervisorKind: "mock",
        qemuFound: false,
        qemuHint: "",
        kvmLabel: "",
        linuxImageReady: false,
        dockerFound: false,
        hasProvider: false,
        hasGoldenImage: false,
        setupCompleted: false,
        ready: false,
        needsWizard: true,
        hostOs: { platform: "linux", label: "Linux" },
        qemuInstall: {
          method: "apt",
          displayCommand: "",
          canInstall: false,
          packages: [],
          manualHint: "",
        },
      },
    });
    expect(state.sessions).toEqual([]);
    expect(state.selectedId).toBeNull();
    expect(state.section).toBe("agents");
    expect(state.setupOpen).toBe(true);
    expect(state.connected).toBe(true);
  });

  it("switches hypervisorKind when setup reports QEMU", () => {
    const setup = {
      hypervisorKind: "qemu" as const,
      qemuFound: true,
      qemuHint: "brew install qemu",
      kvmLabel: "KVM not present — guests will use TCG (slower)",
      linuxImageReady: true,
      dockerFound: true,
      hasProvider: true,
      hasGoldenImage: false,
      setupCompleted: false,
      ready: true,
      needsWizard: false,
      hostOs: { platform: "darwin" as const, label: "macOS" },
      qemuInstall: {
        method: "brew" as const,
        displayCommand: "brew install qemu",
        canInstall: true,
        packages: ["qemu"],
        manualHint: "brew install qemu",
      },
    };
    const state = reducer(initialState, { type: "setup", setup });
    expect(state.hypervisorKind).toBe("qemu");
    expect(state.dockerKind).toBe("docker");
    expect(state.setup?.hostOs.label).toBe("macOS");
  });

  it("opens and closes the session settings sheet", () => {
    let state = reducer(initialState, { type: "sessionSettings", open: true });
    expect(state.sessionSettingsOpen).toBe(true);
    state = reducer(state, { type: "sessionSettings", open: false });
    expect(state.sessionSettingsOpen).toBe(false);
  });

  it("prefills new-agent OS and prompt", () => {
    const state = reducer(initialState, {
      type: "new",
      open: true,
      os: "debian",
      prompt: "lint the repo",
    });
    expect(state.newOpen).toBe(true);
    expect(state.newOs).toBe("debian");
    expect(state.newPrompt).toBe("lint the repo");
    const docker = reducer(initialState, {
      type: "new",
      open: true,
      os: "ubuntu",
      runtime: "docker",
      dockerImage: "python:3.12-bookworm",
      prompt: "install pytest",
    });
    expect(docker.newRuntime).toBe("docker");
    expect(docker.newDockerImage).toBe("python:3.12-bookworm");
    const host = reducer(initialState, {
      type: "new",
      open: true,
      runtime: "host",
      hostDir: "/tmp/app",
    });
    expect(host.newRuntime).toBe("host");
    expect(host.newHostDir).toBe("/tmp/app");
    const recipe = reducer(initialState, {
      type: "new",
      open: true,
      os: "ubuntu",
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      prompt: "review the PR",
      instructions: "Stay on the branch",
      playbook: "Read git_diff first",
      allowedTools: ["exec", "git_diff"],
    });
    expect(recipe.newPlaybook).toBe("Read git_diff first");
    expect(recipe.newAllowedTools).toEqual(["exec", "git_diff"]);
    const review = reducer(initialState, {
      type: "new",
      open: true,
      kind: "review",
    });
    expect(review.newKind).toBe("review");
    const closed = reducer(recipe, { type: "new", open: false });
    expect(closed.newPlaybook).toBe("");
    expect(closed.newAllowedTools).toEqual([]);
  });

  it("sorts pinned sessions first", () => {
    let state = reducer(initialState, {
      type: "session",
      session: { ...session("a", "Old"), updatedAt: "2026-08-02T00:00:00.000Z" },
    });
    state = reducer(state, {
      type: "session",
      session: { ...session("b", "Pinned"), pinned: true, updatedAt: "2026-08-01T00:00:00.000Z" },
    });
    expect(state.sessions.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("does not reshuffle two running chats when agent ticks bump updatedAt", () => {
    const first = {
      ...session("a", "First"),
      messages: [
        { id: "ua", role: "user" as const, content: "one", createdAt: "2026-09-09T10:00:00.000Z" },
      ],
      updatedAt: "2026-09-09T10:00:00.000Z",
    };
    const second = {
      ...session("b", "Second"),
      messages: [
        { id: "ub", role: "user" as const, content: "two", createdAt: "2026-09-09T10:05:00.000Z" },
      ],
      updatedAt: "2026-09-09T10:05:00.000Z",
    };
    let state = reducer(initialState, { type: "session", session: first });
    state = reducer(state, { type: "session", session: second });
    expect(state.sessions.map((s) => s.id)).toEqual(["b", "a"]);
    state = reducer(state, {
      type: "session",
      session: { ...first, status: "running", updatedAt: "2026-09-09T10:06:00.000Z" },
    });
    expect(state.sessions.map((s) => s.id)).toEqual(["b", "a"]);
    state = reducer(state, {
      type: "sessions",
      sessions: [
        { ...first, status: "running", updatedAt: "2026-09-09T10:08:00.000Z" },
        { ...second, status: "running", updatedAt: "2026-09-09T10:07:00.000Z" },
      ],
    });
    expect(state.sessions.map((s) => s.id)).toEqual(["b", "a"]);
    state = reducer(state, {
      type: "message",
      sessionId: "a",
      message: {
        id: "ua2",
        role: "user",
        content: "again",
        createdAt: "2026-09-09T10:09:00.000Z",
      },
    });
    expect(state.sessions.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("stores a live desktop overlay", () => {
    const overlay = { sessionId: "a", name: "mouse_click", x: 10, y: 20 };
    const state = reducer(initialState, { type: "overlay", overlay });
    expect(state.overlay).toEqual(overlay);
  });

  it("seeks the guest timeline from the artifact drawer", () => {
    const seek = { sessionId: "a", stopId: "t1" };
    const state = reducer(initialState, { type: "seekTimeline", seek });
    expect(state.timelineSeek).toEqual(seek);
    expect(reducer(state, { type: "seekTimeline", seek: null }).timelineSeek).toBeNull();
  });

  it("opens replay from the command palette", () => {
    expect(reducer(initialState, { type: "replay", open: true }).replayOpen).toBe(true);
    expect(
      reducer({ ...initialState, replayOpen: true }, { type: "replay", open: false }).replayOpen,
    ).toBe(false);
  });

  it("opens compare from chat or the palette", () => {
    expect(reducer(initialState, { type: "compare", open: true }).compareOpen).toBe(true);
    expect(
      reducer({ ...initialState, compareOpen: true }, { type: "compare", open: false }).compareOpen,
    ).toBe(false);
  });

  it("picks a matching session when switching sidebar sections", () => {
    let state = reducer(initialState, { type: "session", session: session("a", "Agent") });
    state = reducer(state, {
      type: "session",
      session: { ...session("d1", "Landing"), kind: "design", runtime: "docker" },
    });
    state = reducer(state, { type: "select", id: "d1" });
    expect(state.section).toBe("design");
    expect(state.selectedId).toBe("d1");
    state = reducer(state, { type: "section", section: "agents" });
    expect(state.section).toBe("agents");
    expect(state.selectedId).toBe("a");
    state = reducer(state, { type: "section", section: "design" });
    expect(state.section).toBe("design");
    expect(state.selectedId).toBe("d1");
    state = reducer(state, {
      type: "session",
      session: { ...session("g1", "Arcade"), kind: "game", runtime: "docker" },
    });
    state = reducer(state, { type: "section", section: "games" });
    expect(state.section).toBe("games");
    expect(state.selectedId).toBe("g1");
    state = reducer(state, {
      type: "session",
      session: { ...session("as1", "Hero mesh"), kind: "assets", runtime: "docker" },
    });
    state = reducer(state, { type: "section", section: "assets" });
    expect(state.section).toBe("assets");
    expect(state.selectedId).toBe("as1");
    state = reducer(state, {
      type: "session",
      session: { ...session("h1", "Local app"), kind: "ide", runtime: "host" },
    });
    state = reducer(state, { type: "section", section: "ide" });
    expect(state.section).toBe("ide");
    expect(state.selectedId).toBe("h1");
    state = reducer(state, { type: "section", section: "agents" });
    expect(state.section).toBe("agents");
    expect(state.selectedId).toBe("a");
    state = reducer(state, { type: "section", section: "automations" });
    expect(state.section).toBe("automations");
    expect(state.selectedId).toBe("a");
    state = reducer(state, { type: "section", section: "codebase" });
    expect(state.section).toBe("codebase");
    expect(state.selectedId).toBe("a");
    state = reducer(state, { type: "section", section: "slack" });
    expect(state.section).toBe("slack");
    expect(state.selectedId).toBe("a");
    state = reducer(state, { type: "section", section: "docker" });
    expect(state.section).toBe("docker");
    expect(state.selectedId).toBe("a");
    state = reducer(state, { type: "select", id: null });
    state = reducer(state, { type: "section", section: "agents" });
    expect(state.selectedId).toBe("a");
  });

  it("opens settings as a workspace section and restores the previous section", () => {
    let state = reducer(initialState, { type: "section", section: "docker" });
    state = reducer(state, { type: "settings", open: true });
    expect(state.section).toBe("settings");
    expect(state.settingsReturnSection).toBe("docker");
    expect(state.selectedId).toBeNull();
    state = reducer(state, { type: "settingsTab", tab: "appearance" });
    expect(state.settingsTab).toBe("appearance");
    state = reducer(state, { type: "settings", open: true });
    expect(state.section).toBe("settings");
    expect(state.settingsReturnSection).toBe("docker");
    state = reducer(state, { type: "settings", open: false });
    expect(state.section).toBe("docker");
    expect(state.settingsTab).toBe("appearance");
  });

  it("openSettings dispatches settings then an optional tab", () => {
    const actions: Action[] = [];
    const dispatch = (action: Action) => {
      actions.push(action);
    };
    openSettings(dispatch, "git");
    expect(actions).toEqual([
      { type: "settings", open: true },
      { type: "settingsTab", tab: "git" },
    ]);
    actions.length = 0;
    openSettings(dispatch);
    expect(actions).toEqual([{ type: "settings", open: true }]);
    actions.length = 0;
    openSettings(dispatch, "integrations");
    expect(actions).toEqual([
      { type: "settings", open: true },
      { type: "settingsTab", tab: "integrations" },
    ]);
  });

  it("keeps sidebar search queries per section", () => {
    let state = reducer(initialState, { type: "query", query: "agent-term" });
    expect(sectionQuery(state)).toBe("agent-term");
    state = reducer(state, { type: "section", section: "slack" });
    expect(sectionQuery(state)).toBe("");
    expect(state.queries.agents).toBe("agent-term");
    state = reducer(state, { type: "query", query: "eng" });
    expect(sectionQuery(state)).toBe("eng");
    expect(state.queries.agents).toBe("agent-term");
    state = reducer(state, { type: "section", section: "agents" });
    expect(sectionQuery(state)).toBe("agent-term");
    state = reducer(state, { type: "section", section: "slack" });
    expect(sectionQuery(state)).toBe("eng");
  });

  it("points workspace enter toward the destination section", () => {
    expect(sectionEnter("agents", "agents")).toBeNull();
    expect(sectionEnter("agents", "design")).toBe("forward");
    expect(sectionEnter("agents", "ide")).toBe("forward");
    expect(sectionEnter("agents", "codebase")).toBe("forward");
    expect(sectionEnter("agents", "docker")).toBe("forward");
    expect(sectionEnter("agents", "automations")).toBe("forward");
    expect(sectionEnter("design", "ide")).toBe("forward");
    expect(sectionEnter("design", "games")).toBe("forward");
    expect(sectionEnter("games", "assets")).toBe("forward");
    expect(sectionEnter("assets", "games")).toBe("back");
    expect(sectionEnter("design", "board")).toBe("forward");
    expect(sectionEnter("games", "design")).toBe("back");
    expect(sectionEnter("board", "ide")).toBe("forward");
    expect(sectionEnter("ide", "board")).toBe("back");
    expect(sectionEnter("board", "design")).toBe("back");
    expect(sectionEnter("design", "codebase")).toBe("forward");
    expect(sectionEnter("ide", "codebase")).toBe("forward");
    expect(sectionEnter("design", "docker")).toBe("forward");
    expect(sectionEnter("design", "automations")).toBe("forward");
    expect(sectionEnter("codebase", "slack")).toBe("forward");
    expect(sectionEnter("slack", "docker")).toBe("forward");
    expect(sectionEnter("codebase", "docker")).toBe("forward");
    expect(sectionEnter("codebase", "automations")).toBe("forward");
    expect(sectionEnter("docker", "automations")).toBe("forward");
    expect(sectionEnter("automations", "docker")).toBe("back");
    expect(sectionEnter("automations", "slack")).toBe("back");
    expect(sectionEnter("automations", "codebase")).toBe("back");
    expect(sectionEnter("automations", "ide")).toBe("back");
    expect(sectionEnter("automations", "design")).toBe("back");
    expect(sectionEnter("codebase", "ide")).toBe("back");
    expect(sectionEnter("codebase", "agents")).toBe("back");
    expect(sectionEnter("ide", "agents")).toBe("back");
    expect(sectionEnter("design", "agents")).toBe("back");
    expect(sectionEnter("automations", "agents")).toBe("back");
    expect(sectionEnter("agents", "settings")).toBe("forward");
    expect(sectionEnter("settings", "agents")).toBe("back");
  });

  it("selects Docker containers without changing the agent", () => {
    let state = reducer(initialState, { type: "session", session: session("a", "Agent") });
    state = reducer(state, { type: "select", id: "a" });
    state = reducer(state, {
      type: "containers",
      containers: [
        {
          id: "c1",
          name: "web",
          image: "nginx:alpine",
          state: "running",
          status: "Up",
          createdAt: "2020-01-01T00:00:00.000Z",
          locus: false,
        },
      ],
    });
    expect(state.selectedContainerId).toBe("c1");
    state = reducer(state, { type: "selectContainer", id: "c1" });
    expect(state.section).toBe("docker");
    expect(state.selectedId).toBe("a");
    expect(state.selectedContainerId).toBe("c1");
    state = reducer(state, { type: "dockerView", view: "swarm" });
    expect(state.dockerView).toBe("swarm");
    state = reducer(state, { type: "selectSwarmService", id: "svc-1" });
    expect(state.selectedSwarmServiceId).toBe("svc-1");
    expect(state.dockerView).toBe("swarm");
    state = reducer(state, { type: "selectContainer", id: "c1" });
    expect(state.dockerView).toBe("containers");
    expect(state.selectedSwarmServiceId).toBeNull();
  });

  it("opens design sessions in the design section and prefills the composer", () => {
    let state = reducer(initialState, {
      type: "session",
      session: { ...session("d1", "Landing"), kind: "design", runtime: "docker" },
    });
    state = reducer(state, { type: "select", id: "d1" });
    expect(state.section).toBe("design");
    expect(state.selectedId).toBe("d1");
    state = reducer(state, { type: "compose", text: "On h1: " });
    expect(state.composerDraft).toBe("On h1: ");
    state = reducer(state, { type: "findChat", open: true });
    expect(state.findChatOpen).toBe(true);
    state = reducer(state, {
      type: "openWorkspace",
      open: { sessionId: "d1", path: "src/auth.ts", line: 40, follow: true, at: 1 },
    });
    expect(state.workspaceOpen).toMatchObject({ path: "src/auth.ts", line: 40 });
    state = reducer(state, { type: "openWorkspace", open: null });
    expect(state.workspaceOpen).toBeNull();
    state = reducer(state, { type: "workspaceFocus", sessionId: "d1", path: "src/app.ts" });
    expect(state.workspaceFocus).toEqual({ sessionId: "d1", path: "src/app.ts" });
    state = reducer(state, { type: "workspaceFocus", sessionId: "d1", path: null });
    expect(state.workspaceFocus).toBeNull();
    state = reducer(state, { type: "select", id: null });
    expect(state.section).toBe("design");
    expect(state.selectedId).toBeNull();
    state = reducer(state, {
      type: "hydrate",
      config: initialState.config ?? {
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
      },
      sessions: [
        { ...session("d1", "Landing"), kind: "design", runtime: "docker" },
        session("a", "Agent"),
      ],
      vms: [],
    });
    expect(state.selectedId).toBe("d1");
  });

  it("opens boards as a sessionless catalog", () => {
    let state = reducer(initialState, {
      type: "boards",
      boards: [
        {
          id: "b1",
          title: "Sprint",
          updatedAt: "2020-01-02T00:00:00.000Z",
          createdAt: "2020-01-01T00:00:00.000Z",
          objectCount: 4,
          frameCount: 1,
          starter: "sprint",
        },
      ],
    });
    state = reducer(state, { type: "selectBoard", id: "b1" });
    expect(state.section).toBe("board");
    expect(state.selectedBoardId).toBe("b1");
    expect(state.vmCollapsed).toBe(true);
    state = reducer(state, {
      type: "board",
      board: {
        id: "b1",
        title: "Sprint",
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-02T00:00:00.000Z",
        objects: [],
        comments: [],
        starter: "sprint",
        chatSessionId: "chat-1",
      },
    });
    expect(state.selectedId).toBe("chat-1");
    expect(state.boardDocuments.b1?.chatSessionId).toBe("chat-1");
    state = reducer(state, {
      type: "board",
      board: {
        id: "b1",
        title: "Sprint",
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-02T00:00:00.000Z",
        objects: [{ id: "s1", type: "sticky", x: 0, y: 0, w: 80, h: 80, text: "Note" }],
        comments: [
          {
            id: "c1",
            objectId: "s1",
            body: "Name the owner",
            author: "agent",
            createdAt: "2020-01-02T00:00:00.000Z",
          },
        ],
        starter: "sprint",
        chatSessionId: "chat-1",
      },
    });
    expect(state.boards.find((row) => row.id === "b1")?.pendingComments?.[0]?.body).toBe(
      "Name the owner",
    );
    state = reducer(state, { type: "selectBoard", id: "b1", objectId: "s1" });
    expect(state.boardFocusObjectId).toBe("s1");
    state = reducer(state, { type: "selectBoard", id: "b1" });
    expect(state.boardFocusObjectId).toBeNull();
    state = reducer(state, { type: "section", section: "agents" });
    const selectedBefore = state.selectedId;
    state = reducer(state, {
      type: "board",
      board: {
        id: "b1",
        title: "Sprint renamed",
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-03T00:00:00.000Z",
        objects: [],
        comments: [],
        chatSessionId: "chat-2",
      },
    });
    expect(state.section).toBe("agents");
    expect(state.selectedId).toBe(selectedBefore);
    expect(state.selectedId).not.toBe("chat-2");
    state = reducer(state, { type: "boardDeleted", id: "b1" });
    expect(state.boards).toEqual([]);
    expect(state.selectedBoardId).toBeNull();
    expect(state.boardDocuments.b1).toBeUndefined();
  });

  it("opens projects as a sessionless catalog", () => {
    let state = reducer(initialState, {
      type: "projects",
      projects: [
        {
          id: "p1",
          title: "Auth",
          updatedAt: "2020-01-02T00:00:00.000Z",
          createdAt: "2020-01-01T00:00:00.000Z",
          starter: "feature",
          memberCount: 1,
        },
      ],
    });
    state = reducer(state, { type: "selectProject", id: "p1" });
    expect(state.section).toBe("project");
    expect(state.selectedProjectId).toBe("p1");
    expect(state.vmCollapsed).toBe(false);
    state = reducer(state, {
      type: "project",
      project: {
        id: "p1",
        title: "Auth",
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-02T00:00:00.000Z",
        recipeId: "feature",
        memberIds: ["m1"],
        maxConcurrentMembers: 4,
        coordinatorSessionId: "chat-p1",
      },
    });
    expect(state.projectDocuments.p1?.coordinatorSessionId).toBe("chat-p1");
    expect(state.selectedId).toBe("chat-p1");
    state = reducer(state, { type: "projectDeleted", id: "p1" });
    expect(state.projects).toEqual([]);
    expect(state.selectedProjectId).toBeNull();
    expect(state.projectDocuments.p1).toBeUndefined();
  });

  it("keeps the selected teammate when a project document is patched", () => {
    let state = reducer(initialState, {
      type: "projects",
      projects: [
        {
          id: "p1",
          title: "Auth",
          updatedAt: "2020-01-02T00:00:00.000Z",
          createdAt: "2020-01-01T00:00:00.000Z",
          starter: "feature",
          memberCount: 1,
        },
      ],
    });
    state = reducer(state, { type: "selectProject", id: "p1" });
    state = reducer(state, {
      type: "project",
      project: {
        id: "p1",
        title: "Auth",
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-02T00:00:00.000Z",
        recipeId: "feature",
        memberIds: ["m1"],
        maxConcurrentMembers: 4,
        coordinatorSessionId: "chat-p1",
      },
    });
    state = reducer(state, { type: "select", id: "m1" });
    expect(state.selectedId).toBe("m1");
    state = reducer(state, {
      type: "project",
      project: {
        id: "p1",
        title: "Auth",
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-03T00:00:00.000Z",
        recipeId: "feature",
        memberIds: ["m1"],
        maxConcurrentMembers: 4,
        coordinatorSessionId: "chat-p1",
        paused: true,
      },
    });
    expect(state.selectedId).toBe("m1");
  });

  it("maps coordinator chats onto the Project section", () => {
    let state = reducer(initialState, {
      type: "session",
      session: {
        ...session("c1", "Project coordinator"),
        kind: "project",
        runtime: "host",
        projectId: "p1",
      },
    });
    state = reducer(state, { type: "select", id: "c1" });
    expect(state.section).toBe("project");
    expect(state.selectedProjectId).toBe("p1");
  });

  it("keeps project members on Agents", () => {
    let state = reducer(initialState, {
      type: "session",
      session: {
        ...session("m1", "Auth slice"),
        projectId: "p1",
      },
    });
    state = reducer(state, { type: "select", id: "m1" });
    expect(state.section).toBe("agents");
    expect(sessionFitsSection(state.sessions[0], "agents")).toBe(true);
    expect(sessionFitsSection(state.sessions[0], "project")).toBe(false);
  });

  it("stays on Project when selecting a member while already in project section", () => {
    let state = reducer(initialState, {
      type: "session",
      session: {
        ...session("m1", "Auth slice"),
        projectId: "p1",
      },
    });
    state = reducer(state, { type: "selectProject", id: "p1" });
    expect(state.section).toBe("project");
    state = reducer(state, { type: "select", id: "m1" });
    expect(state.section).toBe("project");
    expect(state.selectedProjectId).toBe("p1");
    expect(state.selectedId).toBe("m1");
  });

  it("maps board chats onto the Board section", () => {
    let state = reducer(initialState, {
      type: "session",
      session: { ...session("c1", "Board chat"), kind: "board", runtime: "host", boardId: "b1" },
    });
    state = reducer(state, { type: "select", id: "c1" });
    expect(state.section).toBe("board");
    expect(state.selectedBoardId).toBe("b1");
  });

  it("opens IDE workspaces in the IDE section", () => {
    let state = reducer(initialState, {
      type: "session",
      session: { ...session("h1", "Local app"), kind: "ide", runtime: "host" },
    });
    state = reducer(state, { type: "select", id: "h1" });
    expect(state.section).toBe("ide");
    expect(state.selectedId).toBe("h1");
    state = reducer(state, { type: "select", id: null });
    expect(state.section).toBe("ide");
    expect(state.selectedId).toBeNull();
  });

  it("keeps host agents on the Agents section", () => {
    let state = reducer(initialState, {
      type: "session",
      session: { ...session("h1", "Local app"), runtime: "host" },
    });
    state = reducer(state, { type: "select", id: "h1" });
    expect(state.section).toBe("agents");
    expect(state.selectedId).toBe("h1");
  });

  it("hydrates onto IDE when the only chats are IDE workspaces", () => {
    const state = reducer(initialState, {
      type: "hydrate",
      config: {
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
      },
      sessions: [{ ...session("h1", "Local app"), kind: "ide", runtime: "host" }],
      vms: [],
    });
    expect(state.section).toBe("ide");
    expect(state.selectedId).toBe("h1");
  });

  it("hydrates onto Agents when the only chats are host agents", () => {
    const state = reducer(initialState, {
      type: "hydrate",
      config: {
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
      },
      sessions: [{ ...session("h1", "Local app"), runtime: "host" }],
      vms: [],
    });
    expect(state.section).toBe("agents");
    expect(state.selectedId).toBe("h1");
  });

  it("keeps Slack teamName when a socket status event omits it", () => {
    let state = reducer(initialState, {
      type: "slackStatus",
      status: {
        connected: true,
        socket: "down",
        teamId: "T_MOCK",
        teamName: "Locus Dev",
        userId: "U_YOU",
        userName: "you",
      },
    });
    state = reducer(state, {
      type: "slackStatus",
      status: { connected: true, socket: "up", teamId: "T_MOCK", userId: "U_YOU" },
    });
    expect(state.slackStatus).toMatchObject({
      connected: true,
      socket: "up",
      teamName: "Locus Dev",
      userName: "you",
    });
  });

  it("marks the Slack catalog loaded after conversations arrive", () => {
    expect(initialState.slackCatalogLoaded).toBe(false);
    const loaded = reducer(initialState, {
      type: "slackConversations",
      conversations: [{ id: "C_ENG", name: "eng", kind: "channel" }],
    });
    expect(loaded.slackCatalogLoaded).toBe(true);
    expect(loaded.slackConversations).toHaveLength(1);
    const probed = reducer(initialState, { type: "slackCatalogLoaded" });
    expect(probed.slackCatalogLoaded).toBe(true);
    expect(probed.slackConversations).toEqual([]);
  });

  it("keeps a valid Slack channel when the catalog refreshes", () => {
    let state = reducer(initialState, { type: "selectSlackChannel", id: "C_ENG" });
    state = reducer(state, {
      type: "slackConversations",
      conversations: [
        { id: "C_OPS", name: "ops", kind: "channel" },
        { id: "C_ENG", name: "eng", kind: "channel" },
      ],
    });
    expect(state.selectedSlackChannelId).toBe("C_ENG");
  });

  it("opens Slack Activity without dropping the selected channel", () => {
    let state = reducer(initialState, { type: "selectSlackChannel", id: "C_ENG" });
    state = reducer(state, {
      type: "slackActivity",
      items: [
        {
          id: "C_ENG:1",
          kind: "mention",
          channelId: "C_ENG",
          ts: "1.0",
          text: "hey",
          userName: "alice",
        },
      ],
    });
    state = reducer(state, { type: "selectSlackActivity" });
    expect(state.slackActivityOpen).toBe(true);
    expect(state.slackActivityUnseen).toBe(false);
    expect(state.section).toBe("slack");
    expect(state.selectedSlackChannelId).toBe("C_ENG");
    state = reducer(state, { type: "selectSlackChannel", id: "C_OPS" });
    expect(state.slackActivityOpen).toBe(false);
    expect(state.selectedSlackChannelId).toBe("C_OPS");
  });

  it("keeps the Activity unread badge until Activity opens or unseen is cleared", () => {
    let state = reducer(initialState, {
      type: "slackActivity",
      items: [
        {
          id: "C_ENG:1",
          kind: "mention",
          channelId: "C_ENG",
          ts: "1.0",
          text: "hey",
          userName: "alice",
        },
      ],
      unseen: true,
    });
    expect(state.slackActivityUnseen).toBe(true);
    state = reducer(state, { type: "slackActivity", items: state.slackActivity });
    expect(state.slackActivityUnseen).toBe(true);
    state = reducer(state, { type: "slackActivity", items: [], unseen: false });
    expect(state.slackActivityUnseen).toBe(false);
    expect(state.slackActivity).toEqual([]);
  });

  it("does not auto-select the first Slack channel from a catalog refresh", () => {
    const state = reducer(initialState, {
      type: "slackConversations",
      conversations: [
        { id: "C_OPS", name: "ops", kind: "channel" },
        { id: "C_ENG", name: "eng", kind: "channel" },
      ],
    });
    expect(state.selectedSlackChannelId).toBeNull();
    expect(state.slackConversations.map((row) => row.id)).toEqual(["C_OPS", "C_ENG"]);
  });

  it("updates an existing Slack conversation in place", () => {
    let state = reducer(initialState, {
      type: "slackConversations",
      conversations: [
        { id: "C_OPS", name: "ops", kind: "channel" },
        { id: "C_ENG", name: "eng", kind: "channel" },
      ],
    });
    state = reducer(state, {
      type: "slackChannel",
      conversation: { id: "C_ENG", name: "eng", kind: "channel", unread: true },
    });
    expect(state.slackConversations.map((row) => row.id)).toEqual(["C_OPS", "C_ENG"]);
    expect(state.slackConversations[1]?.unread).toBe(true);
  });

  it("drops deleted Slack messages and clears unread DMs from Activity", () => {
    let state = reducer(initialState, {
      type: "slackConversations",
      conversations: [{ id: "D_BOB", name: "bob", kind: "im", unread: true }],
    });
    state = reducer(state, {
      type: "selectSlackChannel",
      id: "D_BOB",
    });
    state = reducer(state, {
      type: "slackMessages",
      messages: [
        { ts: "1.0", channelId: "D_BOB", text: "keep" },
        { ts: "1.1", channelId: "D_BOB", text: "gone" },
      ],
    });
    state = reducer(state, {
      type: "slackActivity",
      items: [
        {
          id: "unread:D_BOB",
          kind: "dm",
          channelId: "D_BOB",
          ts: "1.1",
          text: "Unread direct message",
        },
      ],
    });
    state = reducer(state, {
      type: "slackMessage",
      message: { ts: "1.1", channelId: "D_BOB", text: "", subtype: "message_deleted" },
    });
    expect(state.slackMessages.map((row) => row.ts)).toEqual(["1.0"]);
    state = reducer(state, {
      type: "slackChannel",
      conversation: { id: "D_BOB", name: "bob", kind: "im", unread: false },
    });
    expect(state.slackConversations[0]?.unread).toBe(false);
    expect(state.slackActivity).toEqual([]);
  });
});

describe("formatWhen", () => {
  it("formats timestamps and blanks missing values", () => {
    expect(formatWhen()).toBe("—");
    expect(formatWhen("not-a-date")).toBe("—");
    expect(formatWhen("2026-08-17T12:00:00.000Z")).not.toBe("—");
  });
});
