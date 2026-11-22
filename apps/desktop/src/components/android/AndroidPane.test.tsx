import { act, useReducer, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, AndroidProjectInfo, LocusConfig } from "@locus/shared";
import { AndroidPane } from "./AndroidPane";
import { rememberAndroidReturn } from "./androidNav";
import { Topbar } from "@/components/layout/Topbar";
import {
  Store,
  initialState,
  reducer,
  sectionForSession,
  type Action,
  type UiState,
} from "@/state/store";
import { api } from "@/lib/api";
import { androidApi } from "./androidApi";

vi.mock("@/lib/api", () => ({
  api: {
    createSession: vi.fn(),
    patchSession: vi.fn(() => new Promise(() => undefined)),
    browseHost: vi.fn(async (path?: string) => ({
      path: path || "/home/you",
      parent: null,
      entries: [{ name: "RnApp", path: "/home/you/RnApp" }],
    })),
  },
}));
vi.mock("./androidApi", () => ({
  androidBase: () => "/android",
  androidApi: {
    environment: vi.fn(),
    job: vi.fn(),
    project: vi.fn(),
    stopMetro: vi.fn(),
    run: vi.fn(),
    boot: vi.fn(),
    input: vi.fn(),
    screen: vi.fn(),
  },
}));
vi.mock("@/components/chat/ChatPane", () => ({ ChatPane: () => <div>Agent chat</div> }));
vi.mock("@/components/workspace/WorkspaceBody", () => ({
  WorkspaceBody: (props: { chat: ReactNode; preview: ReactNode }) => (
    <>
      {props.chat}
      {props.preview}
    </>
  ),
}));
vi.mock("@/components/settings/ModelPicker", () => ({
  ModelPicker: () => <div>Model picker</div>,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session: AgentSession = {
  id: "a1",
  title: "Habits",
  os: "ubuntu",
  templateId: "host",
  runtime: "host",
  providerId: "p1",
  model: "m1",
  playbook: "LOCUS_ANDROID_WORKFLOW",
  status: "idle",
  messages: [],
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
const config = {
  providers: [{ id: "p1", kind: "openai", enabled: true, defaultModel: "m1", models: ["m1"] }],
  templates: [],
} as unknown as LocusConfig;

describe("Android workspace", () => {
  let root: Root;
  let host: HTMLDivElement;
  let actions: Action[];
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
    localStorage.clear();
    rememberAndroidReturn(null);
  });
  async function render(
    selected = false,
    project?: AndroidProjectInfo,
    environment: Awaited<ReturnType<typeof androidApi.environment>> = {
      sdk: null,
      avds: [],
      devices: [],
      issues: ["Install SDK"],
    },
  ) {
    actions = [];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    vi.mocked(androidApi.environment).mockResolvedValue(environment);
    vi.mocked(androidApi.job).mockResolvedValue({ job: null });
    vi.mocked(androidApi.project).mockResolvedValue(
      project ?? { kind: null, expo: false, applicationId: null, metro: null, issue: null },
    );
    await act(async () =>
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              section: "android",
              config,
              sessions: selected ? [session] : [],
              selectedId: selected ? session.id : null,
            },
            dispatch: (action) => actions.push(action),
          }}
        >
          <AndroidPane />
        </Store.Provider>,
      ),
    );
  }
  function button(text: string) {
    return [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(text))!;
  }
  it("routes Android sessions back to their own workspace", async () => {
    await render();
    expect(sectionForSession(session)).toBe("android");
  });
  it("creates a Host project with the native Android playbook and first prompt", async () => {
    await render();
    vi.mocked(api.createSession).mockResolvedValue(session);
    const folder = host.querySelector("input[required]")!;
    const request = host.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(folder, "/workspace/habits");
      folder.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        request,
        "A habit tracker",
      );
      request.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "host",
        placement: "local",
        hostDir: "/workspace/habits",
        startVm: false,
        playbook: expect.stringContaining("LOCUS_ANDROID_WORKFLOW"),
        prompt: expect.stringContaining("A habit tracker"),
      }),
    );
    expect(actions).toContainEqual({ type: "select", id: "a1" });
  });
  it("shows missing SDK setup and disables run and device tests without an emulator", async () => {
    await render(true);
    expect(host.textContent).toContain("Install SDK");
    expect(button("Build & run").disabled).toBe(true);
    expect(button("Device tests").disabled).toBe(true);
    expect(host.textContent).toContain("Agent chat");
  });
  it("reports backend build failure instead of presenting a successful artifact", async () => {
    await render(true);
    vi.mocked(androidApi.run).mockRejectedValue(new Error("Gradle wrapper not found"));
    await act(async () => button("Build APK").click());
    expect(androidApi.run).toHaveBeenCalledWith("a1", "build", "", "");
    expect(host.querySelector("[role='alert']")?.textContent).toContain("Gradle wrapper not found");
    expect(host.textContent).not.toContain("Download debug APK");
  });
  it("creates a React Native project with a React Native first prompt", async () => {
    await render();
    vi.mocked(api.createSession).mockResolvedValue(session);
    const option = [...host.querySelectorAll("label")].find((label) =>
      label.textContent?.includes("New React Native app"),
    )!;
    await act(async () => option.querySelector("input")!.click());
    const folder = host.querySelector("input[required]")!;
    const request = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        folder,
        "/workspace/rn",
      );
      folder.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        request,
        "A todo list",
      );
      request.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        playbook: expect.stringContaining("React Native"),
        prompt: expect.stringContaining("React Native (TypeScript)"),
      }),
    );
  });
  it("prefills the detected applicationId and labels React Native projects", async () => {
    await render(true, {
      kind: "react-native",
      expo: true,
      applicationId: "com.example.rn",
      metro: { managed: false, log: "" },
      issue: null,
    });
    expect(host.textContent).toContain("React Native · Expo");
    const input = host.querySelector<HTMLInputElement>("input[placeholder='com.example.myapp']")!;
    expect(input.value).toBe("com.example.rn");
  });
  it("opens a folder picker for an existing project and fills the folder", async () => {
    await render();
    const option = [...host.querySelectorAll("label")].find((label) =>
      label.textContent?.includes("Open existing project"),
    )!;
    await act(async () => option.querySelector("input")!.click());
    await act(async () => button("Browse…").click());
    const picker = document.querySelector("[data-testid='host-folder-picker']")!;
    expect(picker.textContent).toContain("Open Android project");
    const entry = [...picker.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("RnApp"),
    )!;
    await act(async () => entry.click());
    const open = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Open this project",
    )!;
    await act(async () => open.click());
    expect(host.querySelector<HTMLInputElement>("#android-folder")!.value).toBe("/home/you/RnApp");
    expect(document.querySelector("[data-testid='host-folder-picker']")).toBeNull();
  });
  it("shows device status once and disables device controls without a device", async () => {
    await render(true);
    expect(host.textContent).toContain("No device");
    expect(host.textContent).not.toContain("No device connected");
    for (const label of ["Back", "Home", "Recent apps", "Send text", "Rotate", "Pause"]) {
      expect(button(label).disabled, label).toBe(true);
    }
    expect(
      host.querySelector<HTMLInputElement>("[aria-label='Type into Android device']")!.disabled,
    ).toBe(true);
    // Rotate / Pause / Zoom share the tab row instead of a separate canvas toolbar.
    expect(host.querySelector(".android-tabs [aria-label='Canvas zoom']")).toBeTruthy();
  });
  it("explains how to create a virtual device when none are installed and offers Refresh", async () => {
    await render(true, undefined, { sdk: "/sdk", avds: [], devices: [], issues: [] });
    expect(host.textContent).toContain("No virtual devices found");
    expect(host.textContent).toContain("Device Manager");
    expect(host.textContent).not.toContain("Pick a virtual device above");
    expect(host.querySelector("[aria-label='Virtual device profile']")).toBeNull();
    const calls = vi.mocked(androidApi.environment).mock.calls.length;
    await act(async () => button("Refresh devices").click());
    expect(vi.mocked(androidApi.environment).mock.calls.length).toBe(calls + 1);
  });
  it("keeps the virtual device picker when AVDs are installed", async () => {
    await render(true, undefined, { sdk: "/sdk", avds: ["Pixel_8"], devices: [], issues: [] });
    expect(host.querySelector("[aria-label='Virtual device profile']")).toBeTruthy();
    expect(host.textContent).toContain("Pick a virtual device above");
    expect(host.textContent).not.toContain("No virtual devices found");
  });
  it("has no separate project bar; the topbar owns the picker and New project / Back", async () => {
    actions = [];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    vi.mocked(androidApi.environment).mockResolvedValue({
      sdk: "/sdk",
      avds: [],
      devices: [],
      issues: [],
    });
    vi.mocked(androidApi.job).mockResolvedValue({ job: null });
    vi.mocked(androidApi.project).mockResolvedValue({
      kind: null,
      expo: false,
      applicationId: null,
      metro: null,
      issue: null,
    });
    const current = { ...session, id: "t1" };
    const other = { ...session, id: "t2", title: "Recipes" };
    function Shell() {
      const [state, dispatch] = useReducer(
        (current: UiState, action: Action) => {
          actions.push(action);
          return reducer(current, action);
        },
        {
          ...initialState,
          section: "android",
          config,
          sessions: [current, other],
          selectedId: current.id,
          vmCollapsed: true,
        } satisfies UiState,
      );
      return (
        <Store.Provider value={{ state, dispatch }}>
          <Topbar />
          <AndroidPane />
        </Store.Provider>
      );
    }
    await act(async () => root.render(<Shell />));
    expect(host.querySelector(".android-project-bar")).toBeNull();
    expect(host.querySelector("select[aria-label='Android project']")).toBeNull();
    expect(host.querySelector<HTMLInputElement>(".topbar .session-title")!.value).toBe("Habits");
    // Opening a project shows its device panel, and the topbar can hide it again.
    expect(actions).toContainEqual({ type: "showVmPane" });
    expect(host.querySelector("[data-testid='topbar-panel-toggle']")).toBeTruthy();
    expect(host.querySelector("[data-testid='android-project-menu']")).toBeTruthy();
    await act(async () => button("+ New project").click());
    expect(actions).toContainEqual({ type: "select", id: null });
    expect(host.querySelector("form")).toBeTruthy();
    expect(host.querySelector(".topbar h2")!.textContent).toBe("New Android project");
    await act(async () => button("Back to Habits").click());
    expect(actions).toContainEqual({ type: "select", id: "t1" });
    expect(host.querySelector<HTMLInputElement>(".topbar .session-title")!.value).toBe("Habits");
    expect(button("Back to Habits")).toBeUndefined();
  });
});
