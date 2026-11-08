import { describe, expect, it } from "vitest";
import { assessSetup, type AgentSession } from "@locus/shared";
import {
  capabilityTodos,
  chatNudgeForSession,
  featurePaletteItems,
  orderPaletteForBrowse,
  shouldShowFeatureChecklist,
  tryNextContext,
} from "./discoverability";
import type { PaletteItem } from "./palette";

function session(
  partial: Partial<AgentSession> & Pick<AgentSession, "id" | "title">,
): AgentSession {
  return {
    os: "ubuntu",
    templateId: "ubuntu-24.04",
    providerId: "p",
    model: "grok-4",
    status: "idle",
    vmId: "v1",
    messages: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...partial,
  };
}

const readySetup = assessSetup({
  hypervisorKind: "qemu",
  qemuFound: true,
  linuxImageReady: true,
  dockerFound: true,
  hasProvider: true,
  hasGoldenImage: false,
  setupCompleted: true,
});

describe("capabilityTodos", () => {
  it("marks completed capabilities from app state", () => {
    const todos = capabilityTodos({
      automations: [{ id: "a1" } as never],
      projects: [],
      brain: {
        id: "b",
        title: "Brain",
        nodeCount: 0,
        edgeCount: 0,
        memoryCount: 0,
        updatedAt: "",
        empty: true,
      },
      slackStatus: { connected: false, socket: "down" },
      mcpServerCount: 0,
    });
    expect(todos.find((t) => t.id === "automation")?.done).toBe(true);
    expect(todos.find((t) => t.id === "brain")?.done).toBe(false);
    expect(todos.find((t) => t.id === "project")?.done).toBe(false);
  });
});

describe("shouldShowFeatureChecklist", () => {
  it("hides while finish-setup still has open todos", () => {
    expect(
      shouldShowFeatureChecklist({
        setup: assessSetup({
          hypervisorKind: "qemu",
          qemuFound: true,
          linuxImageReady: true,
          dockerFound: true,
          hasProvider: false,
          hasGoldenImage: false,
          setupCompleted: true,
        }),
        setupHintDismissed: false,
        featureDismissed: false,
        automations: [],
        projects: [],
        brain: null,
        slackStatus: null,
        mcpServerCount: 0,
      }),
    ).toBe(false);
  });

  it("shows when setup is complete and capabilities remain", () => {
    expect(
      shouldShowFeatureChecklist({
        setup: readySetup,
        setupHintDismissed: false,
        featureDismissed: false,
        automations: [],
        projects: [],
        brain: null,
        slackStatus: null,
        mcpServerCount: 0,
      }),
    ).toBe(true);
  });
});

describe("featurePaletteItems", () => {
  it("includes searchable synonyms for buried features", () => {
    const items = featurePaletteItems();
    expect(items.some((i) => i.id === "feature:mcp")).toBe(true);
    expect(items.find((i) => i.id === "feature:memory")?.keywords).toMatch(/brain/);
    expect(items.find((i) => i.id === "feature:webhooks")?.keywords).toMatch(/webhook/);
    expect(items.find((i) => i.id === "feature:chrome")?.keywords).toMatch(/extension/);
  });
});

describe("orderPaletteForBrowse", () => {
  it("lifts underused sections into Recents", () => {
    const items: PaletteItem[] = [
      {
        id: "new-agent",
        title: "New agent",
        hint: "",
        group: "Agents",
        keywords: "new",
      },
      {
        id: "section:brain",
        title: "Brain",
        hint: "",
        group: "Brain",
        keywords: "brain",
      },
      {
        id: "section:project",
        title: "Projects",
        hint: "",
        group: "Project",
        keywords: "project",
      },
    ];
    const ordered = orderPaletteForBrowse(
      items,
      tryNextContext({
        automations: [],
        projects: [],
        boards: [],
        repos: [],
        brain: {
          id: "b",
          title: "Brain",
          nodeCount: 0,
          edgeCount: 0,
          memoryCount: 0,
          updatedAt: "",
          empty: true,
        },
        slackStatus: null,
        mcpServerCount: 0,
      }),
    );
    expect(ordered[0]?.group).toBe("Recents");
    expect(ordered[0]?.id).toBe("section:brain");
  });
});

describe("chatNudgeForSession", () => {
  it("suggests compare after two assistant turns", () => {
    const current = session({
      id: "a",
      title: "Fix",
      messages: [
        {
          id: "u1",
          role: "user",
          content: "fix it",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
        {
          id: "a1",
          role: "assistant",
          content: "done",
          createdAt: "2020-01-01T00:00:01.000Z",
        },
        {
          id: "u2",
          role: "user",
          content: "again",
          createdAt: "2020-01-01T00:00:02.000Z",
        },
        {
          id: "a2",
          role: "assistant",
          content: "ok",
          createdAt: "2020-01-01T00:00:03.000Z",
        },
      ],
    });
    const nudge = chatNudgeForSession({
      session: current,
      sessions: [current],
      hasAutomations: true,
      dismissed: () => false,
    });
    expect(nudge?.id).toBe("compare");
  });

  it("stays quiet after a single assistant turn", () => {
    const current = session({
      id: "a",
      title: "Fix",
      messages: [
        {
          id: "u1",
          role: "user",
          content: "fix it",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
        {
          id: "a1",
          role: "assistant",
          content: "done",
          createdAt: "2020-01-01T00:00:01.000Z",
        },
      ],
    });
    const nudge = chatNudgeForSession({
      session: current,
      sessions: [current],
      hasAutomations: false,
      dismissed: () => false,
    });
    expect(nudge).toBeNull();
  });
});
