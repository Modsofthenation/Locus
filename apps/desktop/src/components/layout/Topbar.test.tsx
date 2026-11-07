import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Topbar } from "./Topbar";
import { Store, initialState } from "@/state/store";
import { api } from "@/lib/api";
import { exportSessionChat } from "@/lib/chatExport";

vi.mock("@/lib/api", () => ({
  api: {
    debugLog: vi.fn(async () => {
      throw new Error("no trace");
    }),
    sessionEgress: vi.fn(async () => ({
      sessionId: "",
      hosts: [],
      bytesSent: 0,
      allowed: 0,
      denied: 0,
    })),
    sessionApprovals: vi.fn(async () => ({ approvals: [] })),
    captureImage: vi.fn(),
    saveEnvironment: vi.fn(),
    clearChat: vi.fn(),
    dockerContainerAction: vi.fn(),
    dockerContainers: vi.fn(),
    runAutomation: vi.fn(),
    stopAutomation: vi.fn(),
    patchAutomation: vi.fn(),
    patchBoard: vi.fn(),
    deleteBoard: vi.fn(),
    duplicateBoard: vi.fn(),
    duplicateProject: vi.fn(),
    fork: vi.fn(),
    boardChat: vi.fn(),
    exportBoard: vi.fn(),
    session: vi.fn(),
  },
}));

vi.mock("@/lib/chatExport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chatExport")>();
  return { ...actual, exportSessionChat: vi.fn() };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.PointerEvent !== "function") {
  class PointerEventPolyfill extends MouseEvent {
    constructor(type: string, init: MouseEventInit = {}) {
      super(type, init);
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as typeof PointerEvent;
}

describe("Topbar", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("titles the workspace Codebase instead of the last agent", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider
        value={{
          state: {
            ...initialState,
            section: "codebase",
            selectedId: "s1",
            sessions: [
              {
                id: "s1",
                title: "Ubuntu 24.04 agent",
                os: "ubuntu",
                templateId: "ubuntu-24.04",
                providerId: "p",
                model: "grok-4",
                status: "idle",
                messages: [],
                createdAt: "2020-01-01T00:00:00.000Z",
                updatedAt: "2020-01-01T00:00:00.000Z",
              },
            ],
          },
          dispatch: () => undefined,
        }}
      >
        <Topbar />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
    expect(host.querySelector("h2")?.textContent).toBe("Codebase");
  });

  it("skips the model in the agent subtitle when none is set", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              section: "agents",
              selectedId: "s1",
              sessions: [
                {
                  id: "s1",
                  title: "Ubuntu 24.04 agent",
                  os: "ubuntu",
                  templateId: "ubuntu-24.04",
                  providerId: "",
                  model: "",
                  status: "stopped",
                  messages: [],
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
            dispatch: () => undefined,
          }}
        >
          <Topbar />
        </Store.Provider>,
      );
    });
    const meta = host.querySelector(".topbar-meta")?.textContent ?? "";
    expect(meta).toMatch(/^Ubuntu 24\.04 · \S/);
    expect(meta).not.toMatch(/·\s*·/);
  });

  it("says starting instead of the VM running label while a design boot note is live", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              section: "design",
              selectedId: "d1",
              sessions: [
                {
                  id: "d1",
                  title: "Visual webpage",
                  kind: "design",
                  os: "ubuntu",
                  templateId: "ubuntu-24.04",
                  runtime: "docker",
                  providerId: "p",
                  model: "cursor-grok-4.6-high",
                  status: "idle",
                  vmId: "v1",
                  messages: [
                    {
                      id: "u1",
                      role: "user",
                      content: "Put together a visual webpage",
                      createdAt: "2020-01-01T00:00:00.000Z",
                    },
                    {
                      id: "s1",
                      role: "system",
                      content: "Starting the container.",
                      createdAt: "2020-01-01T00:00:01.000Z",
                    },
                  ],
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
              vms: [
                {
                  id: "v1",
                  sessionId: "d1",
                  templateId: "ubuntu-24.04",
                  os: "ubuntu",
                  name: "Design",
                  status: "running",
                  runtime: "docker",
                  diskPath: "/tmp/ws",
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
            dispatch: () => undefined,
          }}
        >
          <Topbar />
        </Store.Provider>,
      );
    });
    expect(host.querySelector(".topbar-meta")?.textContent).toMatch(
      /cursor-grok-4\.6-high · starting/,
    );
    expect(host.querySelector(".topbar-meta")?.textContent).not.toMatch(/ · running/);
    expect(host.querySelector(".dot.provisioning")).toBeTruthy();
  });

  it("keeps starting while a running design still has a live boot note", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              section: "design",
              selectedId: "d1",
              sessions: [
                {
                  id: "d1",
                  title: "Visual webpage",
                  kind: "design",
                  os: "ubuntu",
                  templateId: "ubuntu-24.04",
                  runtime: "docker",
                  providerId: "p",
                  model: "cursor-grok-4.6-high",
                  status: "running",
                  vmId: "v1",
                  messages: [
                    {
                      id: "u1",
                      role: "user",
                      content: "Can you design me a one pager on Locus",
                      createdAt: "2020-01-01T00:00:00.000Z",
                    },
                    {
                      id: "s1",
                      role: "system",
                      content: "Starting the container.",
                      createdAt: "2020-01-01T00:00:01.000Z",
                    },
                  ],
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
              vms: [
                {
                  id: "v1",
                  sessionId: "d1",
                  templateId: "ubuntu-24.04",
                  os: "ubuntu",
                  name: "Design",
                  status: "running",
                  runtime: "docker",
                  diskPath: "/tmp/ws",
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
            dispatch: () => undefined,
          }}
        >
          <Topbar />
        </Store.Provider>,
      );
    });
    expect(host.querySelector(".topbar-meta")?.textContent).toMatch(
      /cursor-grok-4\.6-high · starting/,
    );
    expect(host.querySelector(".topbar-meta")?.textContent).not.toMatch(/ · working/);
    expect(host.querySelector(".dot.provisioning")).toBeTruthy();
  });

  it("titles the workspace Docker instead of the last agent", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider
        value={{
          state: {
            ...initialState,
            section: "docker",
            selectedContainerId: "c1",
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
          },
          dispatch: () => undefined,
        }}
      >
        <Topbar />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
    expect(host.querySelector("h2")?.textContent).toBe("web");
  });

  it("titles the workspace Slack instead of the last agent", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider
        value={{
          state: {
            ...initialState,
            section: "slack",
            selectedSlackChannelId: "C_ENG",
            slackConversations: [{ id: "C_ENG", name: "eng", kind: "channel" }],
          },
          dispatch: () => undefined,
        }}
      >
        <Topbar />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
    expect(host.querySelector("h2")?.textContent).toBe("#eng");
  });

  it("labels a private Slack channel with a lock", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider
        value={{
          state: {
            ...initialState,
            section: "slack",
            selectedSlackChannelId: "G_SHIP",
            slackConversations: [{ id: "G_SHIP", name: "shipyard", kind: "private" }],
          },
          dispatch: () => undefined,
        }}
      >
        <Topbar />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
    expect(host.querySelector("h2")?.textContent).toBe("🔒shipyard");
  });

  it("labels host chats and hides Start", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider
        value={{
          state: {
            ...initialState,
            selectedId: "s1",
            sessions: [
              {
                id: "s1",
                title: "Host chat",
                os: "ubuntu",
                templateId: "host",
                runtime: "host",
                providerId: "p",
                model: "grok-4",
                status: "idle",
                messages: [],
                createdAt: "2020-01-01T00:00:00.000Z",
                updatedAt: "2020-01-01T00:00:00.000Z",
              },
            ],
          },
          dispatch: () => undefined,
        }}
      >
        <Topbar />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
    expect(host.textContent).toContain("Host · grok-4 · idle");
    expect(
      [...host.querySelectorAll("button")].some((btn) => btn.textContent?.includes("Start")),
    ).toBe(false);
  });

  it("keeps an automation chat heading on one title row and returns to the job", () => {
    const dispatch = vi.fn();
    const name = "Nightly CI for the monorepo and docs site health checks";
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              selectedId: "s1",
              automations: [
                {
                  id: "auto-1",
                  name,
                  enabled: true,
                  prompt: "check the build",
                  os: "ubuntu",
                  templateId: "ubuntu-24.04",
                  runtime: "host",
                  providerId: "p",
                  model: "grok-4",
                  startVm: false,
                  persistMemory: false,
                  schedule: { kind: "interval", everyMinutes: 30 },
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
              sessions: [
                {
                  id: "s1",
                  title: `${name} · run 48`,
                  os: "ubuntu",
                  templateId: "host",
                  runtime: "host",
                  providerId: "p",
                  model: "grok-4",
                  status: "idle",
                  automationId: "auto-1",
                  messages: [],
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
            dispatch,
          }}
        >
          <Topbar />
        </Store.Provider>,
      );
    });
    const back = host.querySelector('[data-testid="automation-back"]') as HTMLButtonElement;
    expect(back).toBeTruthy();
    expect(back.title).toBe(name);
    expect(back.textContent).toContain(name);
    expect(back.classList.contains("topbar-automation-back")).toBe(true);
    expect(back.closest(".topbar-title-row")).toBeTruthy();
    expect(host.querySelector(".topbar-title-row .session-title")).toBeTruthy();
    expect(host.querySelector(".topbar-title > .topbar-automation-back")).toBeNull();
    act(() => {
      back.click();
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "selectAutomation", id: "auto-1" });
  });

  it("keeps the agent overflow menu open after clicking the trigger", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              selectedId: "s1",
              sessions: [
                {
                  id: "s1",
                  title: "Host chat",
                  os: "ubuntu",
                  templateId: "host",
                  runtime: "host",
                  providerId: "p",
                  model: "grok-4",
                  status: "idle",
                  messages: [],
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
            dispatch: () => undefined,
          }}
        >
          <Topbar />
        </Store.Provider>,
      );
    });
    const trigger = host.querySelector('[title="Agent menu"]') as HTMLElement;
    expect(trigger).toBeTruthy();
    const details = trigger.closest("details.menu") as HTMLDetailsElement;
    act(() => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      trigger.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      trigger.click();
    });
    expect(details.open).toBe(true);
    expect(details.getAttribute("open")).not.toBeNull();
    expect(host.textContent).toContain("Agent settings");
    expect(host.textContent).toContain("Session");
    expect(host.textContent).toContain("Share");
    expect(host.textContent).not.toContain("Subscriptions");
    expect(host.textContent).toContain("Duplicate");
    expect(host.textContent).toContain("Clear chat");
    expect(host.textContent).toContain("View trace");
    expect(host.textContent).toContain("Export chat as HTML");
    expect(host.textContent).toContain("Export chat as PDF");
    const html = [...host.querySelectorAll(".menu-item")].find((btn) =>
      btn.textContent?.includes("Export chat as HTML"),
    ) as HTMLButtonElement;
    expect(html.disabled).toBe(true);
    expect(host.textContent).not.toContain("Spawn workers");
  });

  it("shows Spawn workers disabled on a QEMU guest", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              selectedId: "s1",
              sessions: [
                {
                  id: "s1",
                  title: "Ubuntu agent",
                  os: "ubuntu",
                  templateId: "ubuntu-24.04",
                  runtime: "vm",
                  providerId: "p",
                  model: "grok-4",
                  status: "idle",
                  vmId: "v1",
                  messages: [
                    {
                      id: "u1",
                      role: "user",
                      content: "do work",
                      createdAt: "2020-01-01T00:00:00.000Z",
                    },
                  ],
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
              vms: [
                {
                  id: "v1",
                  sessionId: "s1",
                  templateId: "ubuntu-24.04",
                  os: "ubuntu",
                  name: "ubuntu",
                  status: "ready",
                  diskPath: "/tmp/disk.qcow2",
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
            dispatch: () => undefined,
          }}
        >
          <Topbar />
        </Store.Provider>,
      );
    });
    const trigger = host.querySelector('[title="Agent menu"]') as HTMLElement;
    act(() => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      trigger.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      trigger.click();
    });
    const item = [...host.querySelectorAll(".menu-item")].find((btn) =>
      btn.textContent?.includes("Spawn workers"),
    ) as HTMLButtonElement;
    expect(item).toBeTruthy();
    expect(item.disabled).toBe(true);
    expect(item.title).toMatch(/Docker/);
  });

  it("opens a trace modal from the agent overflow menu", async () => {
    vi.mocked(api.debugLog).mockResolvedValue({
      source: {
        id: "trace:s1",
        kind: "trace",
        title: "Host chat",
        path: "/tmp/traces/s1.jsonl",
        sessionId: "s1",
        bytes: 20,
        mtime: "2020-01-01T00:00:00.000Z",
        summary: "1 event",
      },
      text: '{"kind":"turn.start"}\n',
      truncated: false,
      events: [{ t: "2020-01-01T00:00:00.000Z", kind: "turn.start", sessionId: "s1" }],
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              selectedId: "s1",
              sessions: [
                {
                  id: "s1",
                  title: "Host chat",
                  os: "ubuntu",
                  templateId: "host",
                  runtime: "host",
                  providerId: "p",
                  model: "grok-4",
                  status: "idle",
                  messages: [],
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
            dispatch: () => undefined,
          }}
        >
          <Topbar />
        </Store.Provider>,
      );
    });
    const trigger = host.querySelector('[title="Agent menu"]') as HTMLElement;
    act(() => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      trigger.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      trigger.click();
    });
    const item = [...host.querySelectorAll(".menu-item")].find((btn) =>
      btn.textContent?.includes("View trace"),
    ) as HTMLButtonElement;
    await act(async () => {
      item.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("#trace-title")?.textContent).toBe("Trace");
    expect(host.querySelector(".debug-log-raw")?.textContent).toContain("turn.start");
    expect(api.debugLog).toHaveBeenCalledWith("trace", "s1");
  });

  it("exports the chat from the agent overflow menu", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const row = {
      id: "s1",
      title: "Host chat",
      os: "ubuntu" as const,
      templateId: "host",
      runtime: "host" as const,
      providerId: "p",
      model: "grok-4",
      status: "idle" as const,
      messages: [
        {
          id: "m1",
          role: "user" as const,
          content: "hello",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, selectedId: "s1", sessions: [row] },
            dispatch: () => undefined,
          }}
        >
          <Topbar />
        </Store.Provider>,
      );
    });
    const trigger = host.querySelector('[title="Agent menu"]') as HTMLElement;
    act(() => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      trigger.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      trigger.click();
    });
    const html = [...host.querySelectorAll(".menu-item")].find((btn) =>
      btn.textContent?.includes("Export chat as HTML"),
    ) as HTMLButtonElement;
    expect(html.disabled).toBe(false);
    act(() => {
      html.click();
    });
    expect(exportSessionChat).toHaveBeenCalledWith(row, "html");
    act(() => {
      trigger.click();
    });
    const pdf = [...host.querySelectorAll(".menu-item")].find((btn) =>
      btn.textContent?.includes("Export chat as PDF"),
    ) as HTMLButtonElement;
    act(() => {
      pdf.click();
    });
    expect(exportSessionChat).toHaveBeenCalledWith(row, "pdf");
  });

  it("saves a named golden image from the agent menu", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("nightly-node");
    vi.mocked(api.captureImage).mockResolvedValue({} as never);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              selectedId: "s1",
              sessions: [
                {
                  id: "s1",
                  title: "Web app",
                  os: "ubuntu",
                  templateId: "ubuntu-24.04",
                  runtime: "docker",
                  dockerImage: "locus/agent",
                  providerId: "p",
                  model: "grok-4",
                  status: "idle",
                  vmId: "v1",
                  messages: [],
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
              vms: [
                {
                  id: "v1",
                  sessionId: "s1",
                  templateId: "ubuntu-24.04",
                  os: "ubuntu",
                  name: "node",
                  status: "ready",
                  runtime: "docker",
                  dockerImage: "locus/agent",
                  diskPath: "/tmp/ws",
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
            dispatch: () => undefined,
          }}
        >
          <Topbar />
        </Store.Provider>,
      );
    });
    const trigger = host.querySelector('[title="Agent menu"]') as HTMLElement;
    act(() => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      trigger.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      trigger.click();
    });
    const item = [...host.querySelectorAll(".menu-item")].find((btn) =>
      btn.textContent?.includes("Save golden image"),
    ) as HTMLButtonElement;
    expect(item.disabled).toBe(false);
    await act(async () => {
      item.click();
      await Promise.resolve();
    });
    expect(window.prompt).toHaveBeenCalledWith("Name this golden image", "Web app image");
    expect(api.captureImage).toHaveBeenCalledWith("s1", "nightly-node");
  });

  it("saves a named environment from a setup session", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("acme-prod");
    vi.mocked(api.saveEnvironment).mockResolvedValue({
      image: { id: "img-1" },
      environment: { id: "env-1", name: "acme-prod" },
      config: { namedEnvironments: [{ id: "env-1", name: "acme-prod" }] },
      repo: { id: "r1", namedEnvironmentId: "env-1" },
    } as never);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              selectedId: "s1",
              sessions: [
                {
                  id: "s1",
                  title: "Setup environment · acme/app",
                  kind: "setup",
                  os: "ubuntu",
                  templateId: "ubuntu-24.04",
                  runtime: "docker",
                  dockerImage: "locus/agent",
                  providerId: "p",
                  model: "grok-4",
                  status: "idle",
                  vmId: "v1",
                  repoId: "r1",
                  messages: [],
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
              vms: [
                {
                  id: "v1",
                  sessionId: "s1",
                  templateId: "ubuntu-24.04",
                  os: "ubuntu",
                  name: "setup",
                  status: "ready",
                  runtime: "docker",
                  dockerImage: "locus/agent",
                  diskPath: "/tmp/ws",
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
            dispatch: () => undefined,
          }}
        >
          <Topbar />
        </Store.Provider>,
      );
    });
    const trigger = host.querySelector('[title="Agent menu"]') as HTMLElement;
    act(() => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      trigger.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      trigger.click();
    });
    const item = [...host.querySelectorAll(".menu-item")].find((btn) =>
      btn.textContent?.includes("Save as environment"),
    ) as HTMLButtonElement;
    expect(item.disabled).toBe(false);
    await act(async () => {
      item.click();
      await Promise.resolve();
    });
    expect(window.prompt).toHaveBeenCalledWith(
      "Name this environment",
      "Setup environment · acme/app env",
    );
    expect(api.saveEnvironment).toHaveBeenCalledWith("s1", "acme-prod");
  });

  it("opens a trace modal from the design overflow menu", async () => {
    vi.mocked(api.debugLog).mockResolvedValue({
      source: {
        id: "trace:d1",
        kind: "trace",
        title: "Landing",
        path: "/tmp/traces/d1.jsonl",
        sessionId: "d1",
        bytes: 20,
        mtime: "2020-01-01T00:00:00.000Z",
        summary: "1 event",
      },
      text: '{"kind":"turn.start"}\n',
      truncated: false,
      events: [{ t: "2020-01-01T00:00:00.000Z", kind: "turn.start", sessionId: "d1" }],
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              section: "design",
              selectedId: "d1",
              sessions: [
                {
                  id: "d1",
                  title: "Landing",
                  kind: "design",
                  os: "ubuntu",
                  templateId: "ubuntu-24.04",
                  runtime: "docker",
                  providerId: "p",
                  model: "grok-4",
                  status: "idle",
                  messages: [],
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
            dispatch: () => undefined,
          }}
        >
          <Topbar />
        </Store.Provider>,
      );
    });
    const trigger = host.querySelector('[title="Design menu"]') as HTMLElement;
    act(() => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      trigger.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      trigger.click();
    });
    expect(host.textContent).toContain("View trace");
    expect(host.textContent).toContain("Export chat as HTML");
    expect(host.textContent).toContain("Session");
    expect(host.textContent).toContain("Share");
    expect(host.textContent).toContain("Advanced");
    expect(host.textContent).toContain("Danger");
    expect(host.textContent).toContain("Clear chat");
    const item = [...host.querySelectorAll(".menu-item")].find((btn) =>
      btn.textContent?.includes("View trace"),
    ) as HTMLButtonElement;
    await act(async () => {
      item.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("#trace-title")?.textContent).toBe("Trace");
    expect(host.querySelector(".debug-log-raw")?.textContent).toContain("turn.start");
    expect(api.debugLog).toHaveBeenCalledWith("trace", "d1");
  });

  it("puts Stop and Restart on the Docker topbar", async () => {
    vi.mocked(api.dockerContainerAction).mockResolvedValue({
      id: "c1",
      name: "web",
      image: "nginx:alpine",
      state: "exited",
      status: "Exited",
      createdAt: "2020-01-01T00:00:00.000Z",
      locus: false,
    });
    vi.mocked(api.dockerContainers).mockResolvedValue({
      kind: "mock",
      containers: [
        {
          id: "c1",
          name: "web",
          image: "nginx:alpine",
          state: "exited",
          status: "Exited",
          createdAt: "2020-01-01T00:00:00.000Z",
          locus: false,
        },
      ],
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              section: "docker",
              selectedContainerId: "c1",
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
            },
            dispatch: () => undefined,
          }}
        >
          <Topbar />
        </Store.Provider>,
      );
    });
    const labels = [...host.querySelectorAll("button")].map((el) => el.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(["Stop", "Restart"]));
    expect(labels).not.toContain("Start");
    const stop = [...host.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Stop"),
    );
    await act(async () => {
      stop!.click();
      await Promise.resolve();
    });
    expect(confirm).toHaveBeenCalled();
    expect(api.dockerContainerAction).toHaveBeenCalledWith("c1", "stop");
  });

  it("starts a stopped container from the Docker topbar", async () => {
    vi.mocked(api.dockerContainerAction).mockResolvedValue({
      id: "c1",
      name: "web",
      image: "nginx:alpine",
      state: "running",
      status: "Up",
      createdAt: "2020-01-01T00:00:00.000Z",
      locus: false,
    });
    vi.mocked(api.dockerContainers).mockResolvedValue({
      kind: "mock",
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
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              section: "docker",
              selectedContainerId: "c1",
              containers: [
                {
                  id: "c1",
                  name: "web",
                  image: "nginx:alpine",
                  state: "exited",
                  status: "Exited",
                  createdAt: "2020-01-01T00:00:00.000Z",
                  locus: false,
                },
              ],
            },
            dispatch: () => undefined,
          }}
        >
          <Topbar />
        </Store.Provider>,
      );
    });
    const start = [...host.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Start"),
    );
    await act(async () => {
      start!.click();
      await Promise.resolve();
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(api.dockerContainerAction).toHaveBeenCalledWith("c1", "start");
  });

  it("runs the selected automation from the topbar", async () => {
    vi.mocked(api.runAutomation).mockResolvedValue({} as never);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              section: "automations",
              selectedAutomationId: "auto-1",
              automations: [
                {
                  id: "auto-1",
                  name: "Nightly",
                  enabled: true,
                  prompt: "check the build",
                  os: "ubuntu",
                  templateId: "ubuntu-24.04",
                  runtime: "host",
                  providerId: "p1",
                  model: "gpt-4.1",
                  startVm: false,
                  persistMemory: false,
                  schedule: { kind: "interval", everyMinutes: 30 },
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
            dispatch: () => undefined,
          }}
        >
          <Topbar />
        </Store.Provider>,
      );
    });
    const run = [...host.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Run now"),
    ) as HTMLButtonElement;
    expect(run.disabled).toBe(false);
    await act(async () => {
      run.click();
      await Promise.resolve();
    });
    expect(api.runAutomation).toHaveBeenCalledWith("auto-1");
  });

  it("pauses the selected automation from the topbar", async () => {
    vi.mocked(api.patchAutomation).mockResolvedValue({} as never);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              section: "automations",
              selectedAutomationId: "auto-1",
              automations: [
                {
                  id: "auto-1",
                  name: "Nightly",
                  enabled: true,
                  prompt: "check the build",
                  os: "ubuntu",
                  templateId: "ubuntu-24.04",
                  runtime: "host",
                  providerId: "p1",
                  model: "gpt-4.1",
                  startVm: false,
                  persistMemory: false,
                  schedule: { kind: "interval", everyMinutes: 30 },
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
            dispatch: () => undefined,
          }}
        >
          <Topbar />
        </Store.Provider>,
      );
    });
    const pause = [...host.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Pause"),
    );
    await act(async () => {
      pause!.click();
      await Promise.resolve();
    });
    expect(api.patchAutomation).toHaveBeenCalledWith("auto-1", { enabled: false });
  });

  it("disables Run now when the automation is paused", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              section: "automations",
              selectedAutomationId: "auto-1",
              automations: [
                {
                  id: "auto-1",
                  name: "Nightly",
                  enabled: false,
                  prompt: "check the build",
                  os: "ubuntu",
                  templateId: "ubuntu-24.04",
                  runtime: "host",
                  providerId: "p1",
                  model: "gpt-4.1",
                  startVm: false,
                  persistMemory: false,
                  schedule: { kind: "interval", everyMinutes: 30 },
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
            dispatch: () => undefined,
          }}
        >
          <Topbar />
        </Store.Provider>,
      );
    });
    const run = [...host.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Run now"),
    ) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
  });

  it("shows Stop while an automation run is queued", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              section: "automations",
              selectedAutomationId: "auto-1",
              automations: [
                {
                  id: "auto-1",
                  name: "Nightly",
                  enabled: true,
                  prompt: "check the build",
                  os: "ubuntu",
                  templateId: "ubuntu-24.04",
                  runtime: "host",
                  providerId: "p1",
                  model: "gpt-4.1",
                  startVm: false,
                  persistMemory: false,
                  schedule: { kind: "interval", everyMinutes: 30 },
                  createdAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
              runs: [
                {
                  id: "run-1",
                  automationId: "auto-1",
                  status: "queued",
                  trigger: "manual",
                  sessionId: "sess-1",
                  startedAt: "2020-01-01T00:00:00.000Z",
                },
              ],
            },
            dispatch: () => undefined,
          }}
        >
          <Topbar />
        </Store.Provider>,
      );
    });
    expect(
      [...host.querySelectorAll("button")].some((el) => el.textContent?.includes("Stop")),
    ).toBe(true);
    expect(
      [...host.querySelectorAll("button")].some((el) => el.textContent?.includes("Run now")),
    ).toBe(false);
  });
});
