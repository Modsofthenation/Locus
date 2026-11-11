import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type Dispatch, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, Automation, LocusConfig } from "@locus/shared";
import { UBUNTU_DEFAULT_HARDWARE, defaultNetworking } from "@locus/shared";
import { AutomationsPane } from "./Automations";
import { api } from "@/lib/api";
import { Store, initialState, type Action, type UiState } from "@/state/store";

vi.mock("@/lib/api", () => ({
  api: {
    patchAutomation: vi.fn(),
    runAutomation: vi.fn(),
    deleteAutomation: vi.fn(),
    cloneAutomation: vi.fn(),
    testAutomationWebhook: vi.fn(),
    session: vi.fn(),
    abortChat: vi.fn(),
    stopAutomation: vi.fn(),
    automationRuns: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

const config: LocusConfig = {
  theme: "ember",
  providers: [
    {
      id: "p1",
      name: "OpenAI",
      kind: "openai",
      baseUrl: "https://api.openai.com/v1",
      models: ["gpt-4.1"],
      defaultModel: "gpt-4.1",
      enabled: true,
      extraHeaders: {},
    },
  ],
  templates: [
    {
      id: "ubuntu-24.04",
      name: "Ubuntu 24.04 LTS",
      os: "ubuntu",
      description: "Desktop Ubuntu guest",
      isoPath: "/iso/ubuntu.img",
      hardware: { ...UBUNTU_DEFAULT_HARDWARE },
      networking: defaultNetworking("ubuntu", 0),
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    },
  ],
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

const item: Automation = {
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
  persistMemory: true,
  memories: [
    {
      id: "m1",
      text: "Uses Vite",
      createdAt: "2026-08-17T12:00:00.000Z",
    },
  ],
  schedule: { kind: "interval", everyMinutes: 30 },
  createdAt: "2026-08-17T12:00:00.000Z",
  updatedAt: "2026-08-17T12:00:00.000Z",
};

describe("AutomationsPane memory editor", () => {
  let host: HTMLDivElement;
  let root: Root;
  let dispatch: ReturnType<typeof vi.fn>;
  let mounted = false;

  afterEach(() => {
    if (mounted) {
      act(() => root.unmount());
      host.remove();
      mounted = false;
    }
    vi.clearAllMocks();
  });

  function render(automation: Automation = item, extra: Partial<UiState> = {}) {
    vi.mocked(api.automationRuns).mockResolvedValue([]);
    host = document.createElement("div");
    document.body.appendChild(host);
    const style = document.createElement("style");
    style.textContent = css;
    host.appendChild(style);
    root = createRoot(host);
    dispatch = vi.fn();
    const state: UiState = {
      ...initialState,
      section: "automations",
      config,
      automations: [automation],
      selectedAutomationId: automation.id,
      ...extra,
    };
    const node: ReactNode = (
      <Store.Provider value={{ state, dispatch: dispatch as unknown as Dispatch<Action> }}>
        <AutomationsPane />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
    mounted = true;
  }

  it("lists saved facts and can add, edit, and remove them", async () => {
    vi.mocked(api.patchAutomation).mockImplementation(async (_id, input) => ({
      ...item,
      persistMemory: input.persistMemory ?? item.persistMemory,
      memories: input.memories === null ? undefined : (input.memories ?? item.memories),
    }));
    render();
    const card = host.querySelector("[data-testid='auto-memory']") as HTMLElement;
    expect(card.textContent).toContain("Uses Vite");
    expect(card.textContent).toContain("1/40");
    expect(css).toMatch(/\.auto-memory \{/);

    const addBox = host.querySelector(".auto-memory-add textarea") as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(addBox, "Last green SHA is abc123");
      addBox.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const add = [...card.querySelectorAll("button")].find((el) => el.textContent === "Add fact");
      add?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.patchAutomation).toHaveBeenCalledWith(
      "auto-1",
      expect.objectContaining({
        memories: expect.arrayContaining([
          expect.objectContaining({ text: "Uses Vite" }),
          expect.objectContaining({ text: "Last green SHA is abc123" }),
        ]),
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "automation",
        automation: expect.objectContaining({
          memories: expect.arrayContaining([
            expect.objectContaining({ text: "Last green SHA is abc123" }),
          ]),
        }),
      }),
    );

    await act(async () => {
      const edit = [...card.querySelectorAll("button")].find((el) => el.textContent === "Edit");
      edit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const editBox = host.querySelector('.auto-memory-item textarea[aria-label="Edit fact"]') as
      HTMLTextAreaElement | undefined;
    expect(editBox?.value).toBe("Uses Vite");
    await act(async () => {
      if (!editBox) throw new Error("missing edit box");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(editBox, "Uses Vite and React");
      editBox.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const save = [...card.querySelectorAll("button")].find((el) => el.textContent === "Save");
      save?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.patchAutomation).toHaveBeenCalledWith(
      "auto-1",
      expect.objectContaining({
        memories: [expect.objectContaining({ id: "m1", text: "Uses Vite and React" })],
      }),
    );

    await act(async () => {
      const remove = [...card.querySelectorAll("button")].find((el) => el.textContent === "Remove");
      remove?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.patchAutomation).toHaveBeenCalledWith("auto-1", { memories: [] });
  });

  it("shows leftover facts when memory is off and can enable it", async () => {
    vi.mocked(api.patchAutomation).mockResolvedValue({ ...item, persistMemory: true });
    render({ ...item, persistMemory: undefined });
    const card = host.querySelector("[data-testid='auto-memory']") as HTMLElement;
    expect(card.textContent).toContain("Memory is off");
    expect(card.textContent).toContain("Uses Vite");
    await act(async () => {
      const enable = [...host.querySelectorAll("button")].find(
        (el) => el.textContent === "Enable memory",
      );
      enable?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.patchAutomation).toHaveBeenCalledWith(
      "auto-1",
      expect.objectContaining({ persistMemory: true }),
    );
  });

  it("collapses Memory when persist is off and the list is empty", () => {
    render({ ...item, persistMemory: false, memories: [] });
    const card = host.querySelector("[data-testid='auto-memory']") as HTMLElement;
    expect(card.classList.contains("collapsed")).toBe(true);
    expect(card.textContent).toContain("Off");
    expect(card.textContent).toContain("Enable memory");
    expect(card.textContent).not.toContain("No saved facts yet");
    expect(card.querySelector("[data-testid='auto-memory-empty']")).toBeNull();
    expect(css).toMatch(/\.auto-memory\.collapsed/);
  });

  it("copies and inline-edits the prompt on the pane", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.mocked(api.patchAutomation).mockResolvedValue({
      ...item,
      prompt: "check the build twice",
    });
    render();
    const card = host.querySelector("[data-testid='auto-prompt']") as HTMLElement;
    expect(card.textContent).toContain("check the build");
    const copy = [...card.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Copy"),
    );
    await act(async () => {
      copy?.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("check the build");
    const edit = [...card.querySelectorAll("button")].find(
      (el) => el.textContent === "Edit prompt",
    );
    await act(async () => {
      edit?.click();
    });
    const box = host.querySelector('textarea[aria-label="Edit prompt"]') as HTMLTextAreaElement;
    expect(box.value).toBe("check the build");
    expect(box.rows).toBe(12);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "check the build twice");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...card.querySelectorAll("button")].find((el) => el.textContent === "Save");
    await act(async () => {
      save?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.patchAutomation).toHaveBeenCalledWith("auto-1", {
      prompt: "check the build twice",
    });
  });

  it("confirms delete in a modal instead of window.confirm", async () => {
    vi.mocked(api.deleteAutomation).mockResolvedValue(undefined);
    render();
    const del = [...host.querySelectorAll("button")].find((el) => el.textContent === "Delete");
    await act(async () => {
      del?.click();
    });
    const modal = host.querySelector("[data-testid='auto-delete-confirm']");
    expect(modal?.textContent).toContain("This cannot be undone.");
    const confirm = [...modal!.querySelectorAll("button")].find(
      (el) => el.textContent === "Delete",
    );
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.deleteAutomation).toHaveBeenCalledWith("auto-1");
    expect(dispatch).toHaveBeenCalledWith({ type: "automationDeleted", id: "auto-1" });
  });

  it("refuses to add a secret-looking fact", async () => {
    render();
    const addBox = host.querySelector(".auto-memory-add textarea") as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(addBox, "token: sk-live-abcdefghijklmnopqrstuvwxyz");
      addBox.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const add = [...host.querySelectorAll("button")].find((el) => el.textContent === "Add fact");
      add?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(api.patchAutomation).not.toHaveBeenCalled();
    expect(host.textContent).toMatch(/Refusing to store a secret/);
  });

  it("shows the environment name, last fact, and Compare on a finished run", () => {
    const session: AgentSession = {
      id: "s-run",
      title: "Overnight",
      os: "ubuntu",
      templateId: "ubuntu-24.04",
      providerId: "p1",
      model: "gpt-4.1",
      status: "idle",
      messages: [
        {
          id: "u1",
          role: "user",
          content: "check grafana",
          createdAt: "2026-08-29T02:00:00.000Z",
        },
        {
          id: "a1",
          role: "assistant",
          content: "still down",
          screenshotName: "shot.png",
          createdAt: "2026-08-29T02:01:00.000Z",
        },
        {
          id: "u2",
          role: "user",
          content: "try again",
          createdAt: "2026-08-29T02:02:00.000Z",
        },
        {
          id: "a2",
          role: "assistant",
          content: "still down",
          createdAt: "2026-08-29T02:03:00.000Z",
        },
      ],
      createdAt: "2026-08-29T02:00:00.000Z",
      updatedAt: "2026-08-29T02:01:00.000Z",
    };
    render(
      {
        ...item,
        namedEnvironmentId: "env-1",
        lastRunAt: "2026-08-29T02:00:00.000Z",
      },
      {
        config: {
          ...config,
          namedEnvironments: [
            {
              id: "env-1",
              name: "restricted-oncall",
              runtime: "docker",
              os: "ubuntu",
              dockerImage: "locus/agent",
              network: "restricted",
              createdAt: "2026-08-29T00:00:00.000Z",
              updatedAt: "2026-08-29T00:00:00.000Z",
            },
          ],
        },
        sessions: [session],
        runs: [
          {
            id: "run-1",
            automationId: item.id,
            sessionId: session.id,
            status: "succeeded",
            trigger: "schedule",
            startedAt: "2026-08-29T02:00:00.000Z",
            finishedAt: "2026-08-29T02:05:00.000Z",
          },
        ],
      },
    );
    expect(host.querySelector("[data-testid='auto-chips']")?.textContent).toContain("Enabled");
    const moreChips = [...host.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("details"),
    );
    act(() => {
      moreChips?.click();
    });
    expect(host.querySelector("[data-testid='auto-chips']")?.textContent).toContain(
      "restricted-oncall",
    );
    expect(host.querySelector("[data-testid='auto-memory']")?.textContent).toContain("Uses Vite");
    expect(host.querySelector("[data-testid='auto-memory']")?.textContent).toContain("Turn off");
    expect(host.querySelector(".auto-sub")).toBeNull();
    expect(host.querySelector('[aria-label="I don\'t trust this"]')).toBeTruthy();
    const compare = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Compare models",
    );
    act(() => {
      compare!.click();
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "compare", open: true });
  });

  it("keeps Duplicate, Settings, Delete in the pane head and leaves Run now to the topbar", () => {
    render();
    const headLabels = [...host.querySelectorAll(".auto-head button")].map((el) =>
      el.textContent?.trim(),
    );
    expect(headLabels).toEqual(expect.arrayContaining(["Duplicate", "Settings", "Delete"]));
    expect(headLabels).not.toContain("Run now");
    expect(host.querySelector("[data-testid='auto-pane-run-now']")).toBeNull();
    const empty = host.querySelector("[data-testid='auto-runs-empty-cta']");
    expect(empty?.textContent).toMatch(/No runs yet/);
    expect(empty?.querySelector("button")).toBeNull();
    expect(host.querySelector("[data-testid='auto-chips']")?.textContent).toMatch(/Enabled/);
    expect(host.querySelector("h2")).toBeNull();
  });

  it("shows a Docker socket failure as one plain sentence with Show details", () => {
    const raw =
      "failed to connect to the docker API at unix:///var/run/docker.sock; check if the path is correct and if the daemon is running: dial unix /var/run/docker.sock: connect: no such file or directory";
    render(
      { ...item, runtime: "docker", dockerImage: "ubuntu:24.04" },
      {
        runs: [
          {
            id: "run-docker",
            automationId: item.id,
            status: "failed",
            trigger: "manual",
            error: raw,
            startedAt: "2026-08-29T02:00:00.000Z",
            finishedAt: "2026-08-29T02:00:01.000Z",
          },
        ],
      },
    );
    const plain = host.querySelector("[data-testid='run-error-plain']");
    expect(plain?.querySelector("p")?.textContent).toBe(
      "Docker isn't running — switch to Host or start Docker",
    );
    const details = plain?.querySelector("details");
    expect(details?.querySelector("summary")?.textContent).toBe("Show details");
    expect(details?.querySelector("pre")?.textContent).toBe(raw);
    expect(details?.open).toBe(false);
  });

  it("shows starter pills when there are no jobs", () => {
    render(item, { automations: [], selectedAutomationId: null });
    expect(host.querySelector("[data-testid='auto-starters']")?.textContent).toContain(
      "Nightly tests",
    );
    expect(host.querySelector("[data-testid='auto-starters']")?.textContent).toContain(
      "Slack ops webhook",
    );
    const nightly = [...host.querySelectorAll("button")].find(
      (el) => el.textContent === "Nightly tests",
    );
    act(() => {
      nightly?.click();
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "newAutomation",
      open: true,
      starterId: "nightly",
    });
  });

  it("duplicates the open job and labels local clock times", async () => {
    vi.mocked(api.cloneAutomation).mockResolvedValue({
      ...item,
      id: "auto-2",
      name: "Nightly copy",
    });
    render({ ...item, schedule: { kind: "daily", hour: 2, minute: 0 } });
    const more = [...host.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("details"),
    );
    act(() => {
      more?.click();
    });
    expect(host.querySelector("[data-testid='auto-chips']")?.textContent).toMatch(/Local time \(/);
    const clone = [...host.querySelectorAll("button")].find((el) => el.textContent === "Duplicate");
    await act(async () => {
      clone?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.cloneAutomation).toHaveBeenCalledWith("auto-1");
    expect(dispatch).toHaveBeenCalledWith({
      type: "automation",
      automation: expect.objectContaining({ id: "auto-2" }),
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "selectAutomation", id: "auto-2" });
  });

  it("selects the first automation when the list has jobs but none is open", () => {
    render(item, { selectedAutomationId: null });
    expect(dispatch).toHaveBeenCalledWith({ type: "selectAutomation", id: item.id });
  });

  it("copies webhook URL and curl, and rotates the secret", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.mocked(api.patchAutomation).mockResolvedValue({
      ...item,
      schedule: { kind: "webhook" },
      webhookSecret: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    render(
      {
        ...item,
        schedule: { kind: "webhook" },
        webhookSecret: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      {
        config: {
          ...config,
          advanced: { ...config.advanced, webhookBaseUrl: "https://funnel.example" },
        },
      },
    );
    const card = host.querySelector("[data-testid='auto-hook']") as HTMLElement;
    expect(card.textContent).toContain("https://funnel.example/api/hooks/automations/auto-1");
    expect(card.textContent).toContain("Funnel / webhook base");
    expect(card.textContent).toContain("••••");
    const copyUrl = [...card.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Copy URL"),
    );
    await act(async () => {
      copyUrl?.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("https://funnel.example/api/hooks/automations/auto-1");
    const rotate = [...card.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Rotate secret"),
    );
    await act(async () => {
      rotate?.click();
    });
    const rotateModal = host.querySelector("[data-testid='auto-rotate-confirm']");
    expect(rotateModal?.textContent).toContain("Existing callers need the new value");
    const rotateConfirm = [...rotateModal!.querySelectorAll("button")].find(
      (el) => el.textContent === "Rotate secret",
    );
    await act(async () => {
      rotateConfirm?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.patchAutomation).toHaveBeenCalledWith("auto-1", { rotateWebhookSecret: true });
    vi.mocked(api.testAutomationWebhook).mockResolvedValue({
      id: "run-test",
      automationId: "auto-1",
      status: "skipped",
      trigger: "webhook",
      error: "Test POST accepted. No agent run.",
      startedAt: "2026-09-01T00:00:00.000Z",
      finishedAt: "2026-09-01T00:00:00.000Z",
    });
    const sendTest = [...card.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Simulate trigger"),
    );
    await act(async () => {
      sendTest?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.testAutomationWebhook).toHaveBeenCalledWith("auto-1");
    expect(dispatch).toHaveBeenCalledWith({
      type: "run",
      run: expect.objectContaining({ id: "run-test", status: "skipped" }),
    });
    expect(card.textContent).toMatch(/Recorded a test skip/);
  });

  it("shows next fire, last agent status, and spend, ignoring a later test skip", () => {
    render(
      {
        ...item,
        maxUsd: 20,
        nextRunAt: "2026-09-07T09:00:00.000Z",
        schedule: { kind: "daily", hour: 9, minute: 0 },
      },
      {
        sessions: [
          {
            id: "s-run",
            title: "Nightly",
            os: "ubuntu",
            templateId: "ubuntu-24.04",
            providerId: "p1",
            model: "gpt-4.1",
            status: "idle",
            messages: [],
            usage: { inputTokens: 1_000_000, outputTokens: 0 },
            createdAt: "2026-08-29T02:00:00.000Z",
            updatedAt: "2026-08-29T02:05:00.000Z",
          },
        ],
        runs: [
          {
            id: "run-fail",
            automationId: item.id,
            sessionId: "s-run",
            status: "failed",
            trigger: "schedule",
            error: "tests failed",
            startedAt: "2026-08-29T02:00:00.000Z",
            finishedAt: "2026-08-29T02:05:00.000Z",
          },
          {
            id: "run-test",
            automationId: item.id,
            status: "skipped",
            trigger: "webhook",
            error: "Test POST accepted. No agent run.",
            startedAt: "2026-08-29T03:00:00.000Z",
            finishedAt: "2026-08-29T03:00:00.000Z",
          },
        ],
      },
    );
    const chips = host.querySelector("[data-testid='auto-chips']")?.textContent ?? "";
    expect(chips).toMatch(/Next /);
    expect(chips).toContain("Last failed");
    expect(chips).not.toContain("Last skipped");
    expect(chips).toContain("$2.00 / $20.00");
    const failedTab = [...host.querySelectorAll('[aria-label="Filter runs"] button')].find(
      (el) => el.textContent === "Failed",
    );
    expect(failedTab?.getAttribute("aria-selected")).toBe("true");
    const allTab = [...host.querySelectorAll('[aria-label="Filter runs"] button')].find(
      (el) => el.textContent === "All",
    ) as HTMLButtonElement | undefined;
    act(() => {
      allTab?.click();
    });
    expect(host.querySelector(".status-chip.test")?.textContent).toBe("test");
  });

  it("collapses long prompts until expanded", () => {
    const prompt = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join("\n");
    render({ ...item, prompt });
    const card = host.querySelector("[data-testid='auto-prompt']") as HTMLElement;
    expect(card.classList.contains("collapsed")).toBe(true);
    expect(css).toMatch(/\.auto-prompt\.collapsed p \{[\s\S]*?white-space:\s*normal/);
    const expand = [...card.querySelectorAll("button")].find((el) => el.textContent === "Expand");
    act(() => {
      expand?.click();
    });
    expect(card.classList.contains("collapsed")).toBe(false);
  });

  it("surfaces prompt save errors", async () => {
    vi.mocked(api.patchAutomation).mockRejectedValue(new Error("prompt too long"));
    render();
    const card = host.querySelector("[data-testid='auto-prompt']") as HTMLElement;
    const edit = [...card.querySelectorAll("button")].find(
      (el) => el.textContent === "Edit prompt",
    );
    await act(async () => {
      edit?.click();
    });
    const box = host.querySelector('textarea[aria-label="Edit prompt"]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "new prompt text");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...card.querySelectorAll("button")].find((el) => el.textContent === "Save");
    await act(async () => {
      save?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(card.textContent).toContain("prompt too long");
  });

  it("shows duration, skip reason, Run again, and richer run filters", async () => {
    vi.mocked(api.runAutomation).mockResolvedValue({} as never);
    render(item, {
      runs: [
        {
          id: "run-ok",
          automationId: item.id,
          sessionId: "s-run",
          status: "succeeded",
          trigger: "schedule",
          startedAt: "2026-08-29T02:00:00.000Z",
          finishedAt: "2026-08-29T02:05:00.000Z",
        },
        {
          id: "run-skip",
          automationId: item.id,
          status: "skipped",
          trigger: "schedule",
          error: "A run is already in progress",
          startedAt: "2026-08-29T02:01:00.000Z",
          finishedAt: "2026-08-29T02:01:00.000Z",
        },
      ],
      sessions: [
        {
          id: "s-run",
          title: "Nightly",
          os: "ubuntu",
          templateId: "ubuntu-24.04",
          providerId: "p1",
          model: "gpt-4.1",
          status: "idle",
          messages: [
            {
              id: "a1",
              role: "assistant",
              content: "build is green",
              createdAt: "2026-08-29T02:04:00.000Z",
            },
          ],
          createdAt: "2026-08-29T02:00:00.000Z",
          updatedAt: "2026-08-29T02:05:00.000Z",
        },
      ],
    });
    expect(host.textContent).toContain("5m");
    expect(host.textContent).toContain("A run is already in progress");
    expect(host.textContent).toContain("build is green");
    const filterLabels = [...host.querySelectorAll('[aria-label="Filter runs"] button')].map(
      (el) => el.textContent,
    );
    expect(filterLabels).toEqual(
      expect.arrayContaining(["All", "Running", "Succeeded", "Failed", "Skipped", "Test"]),
    );
    const retry = [...host.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Run again"),
    );
    await act(async () => {
      retry?.click();
      await Promise.resolve();
    });
    expect(api.runAutomation).toHaveBeenCalledWith("auto-1", { runId: "run-ok" });
    const skippedTab = [...host.querySelectorAll('[aria-label="Filter runs"] button')].find(
      (el) => el.textContent === "Skipped",
    ) as HTMLButtonElement | undefined;
    act(() => {
      skippedTab?.click();
    });
    expect(host.textContent).toContain("A run is already in progress");
    expect(host.textContent).not.toContain("build is green");
  });

  it("shows schedule mini editor and saves interval changes", async () => {
    vi.mocked(api.patchAutomation).mockResolvedValue({
      ...item,
      schedule: { kind: "interval", everyMinutes: 45 },
    });
    render();
    const card = host.querySelector("[data-testid='auto-schedule-edit']") as HTMLElement;
    expect(card.textContent).toContain("Every 30 minutes");
    const edit = [...card.querySelectorAll("button")].find((el) => el.textContent === "Edit");
    await act(async () => {
      edit?.click();
    });
    const minutes = card.querySelector('input[type="number"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(minutes, "45");
      minutes.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...card.querySelectorAll("button")].find((el) => el.textContent === "Save");
    await act(async () => {
      save?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.patchAutomation).toHaveBeenCalledWith("auto-1", {
      schedule: { kind: "interval", everyMinutes: 45 },
    });
  });

  it("edits an adaptive window from the detail pane", async () => {
    const adaptive: Automation = {
      ...item,
      schedule: {
        kind: "adaptive",
        startHour: 9,
        startMinute: 0,
        endHour: 17,
        endMinute: 0,
        everyMinutes: 60,
        otherwiseEveryMinutes: 180,
      },
    };
    vi.mocked(api.patchAutomation).mockResolvedValue({
      ...adaptive,
      schedule: {
        kind: "adaptive",
        startHour: 9,
        startMinute: 0,
        endHour: 17,
        endMinute: 0,
        everyMinutes: 15,
        otherwiseEveryMinutes: 180,
      },
    });
    render(adaptive);
    const card = host.querySelector("[data-testid='auto-schedule-edit']") as HTMLElement;
    expect(card.textContent).toContain("09:00");
    const edit = [...card.querySelectorAll("button")].find((el) => el.textContent === "Edit");
    await act(async () => {
      edit?.click();
    });
    expect(card.textContent).toContain("Minutes during window");
    const minutes = [...card.querySelectorAll('input[type="number"]')][0] as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(minutes, "15");
      minutes.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...card.querySelectorAll("button")].find((el) => el.textContent === "Save");
    await act(async () => {
      save?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.patchAutomation).toHaveBeenCalledWith(
      "auto-1",
      expect.objectContaining({
        schedule: expect.objectContaining({ kind: "adaptive", everyMinutes: 15 }),
      }),
    );
  });

  it("shows chat retention and opens the latest automation chat", () => {
    render(item, {
      sessions: [
        {
          id: "s-old",
          title: "Older",
          os: "ubuntu",
          templateId: "ubuntu-24.04",
          providerId: "p1",
          model: "gpt-4.1",
          status: "idle",
          messages: [],
          automationId: item.id,
          createdAt: "2026-08-28T02:00:00.000Z",
          updatedAt: "2026-08-28T02:00:00.000Z",
        },
        {
          id: "s-new",
          title: "Newer",
          os: "ubuntu",
          templateId: "ubuntu-24.04",
          providerId: "p1",
          model: "gpt-4.1",
          status: "idle",
          messages: [],
          automationId: item.id,
          createdAt: "2026-08-29T02:00:00.000Z",
          updatedAt: "2026-08-29T03:00:00.000Z",
        },
      ],
    });
    const retention = host.querySelector("[data-testid='auto-chat-retention']");
    expect(retention?.textContent).toMatch(/2 \/ 60 chats kept/);
    const openLatest = [...retention!.querySelectorAll("button")].find(
      (el) => el.textContent === "Open latest chat",
    );
    act(() => {
      openLatest?.click();
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "select", id: "s-new" });
  });

  it("paginates run history with Load more", () => {
    const runs = Array.from({ length: 26 }, (_, i) => ({
      id: `run-${i}`,
      automationId: item.id,
      status: "succeeded" as const,
      trigger: "schedule" as const,
      startedAt: `2026-08-${String(30 - Math.floor(i / 24)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00.000Z`,
      finishedAt: `2026-08-${String(30 - Math.floor(i / 24)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:01:00.000Z`,
    }));
    render(item, { runs });
    expect(host.querySelectorAll(".run-table tbody tr")).toHaveLength(25);
    const more = host.querySelector("[data-testid='auto-runs-load-more']");
    expect(more).toBeTruthy();
    act(() => {
      more?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelectorAll(".run-table tbody tr")).toHaveLength(26);
    expect(host.querySelector("[data-testid='auto-runs-load-more']")).toBeNull();
  });

  it("shows duplicate errors inline instead of alert", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    vi.mocked(api.cloneAutomation).mockRejectedValue(new Error("clone blocked"));
    render();
    const clone = [...host.querySelectorAll("button")].find((el) => el.textContent === "Duplicate");
    await act(async () => {
      clone?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(alert).not.toHaveBeenCalled();
    expect(host.querySelector("[data-testid='auto-pane-error']")?.textContent).toContain(
      "clone blocked",
    );
    alert.mockRestore();
  });

  it("filters runs when clicking the Last failed chip", () => {
    render(
      {
        ...item,
        lastRunAt: "2026-08-29T02:00:00.000Z",
      },
      {
        runs: [
          {
            id: "run-fail",
            automationId: item.id,
            sessionId: "s-run",
            status: "failed",
            trigger: "schedule",
            error: "boom",
            startedAt: "2026-08-29T02:00:00.000Z",
            finishedAt: "2026-08-29T02:05:00.000Z",
          },
          {
            id: "run-ok",
            automationId: item.id,
            sessionId: "s-ok",
            status: "succeeded",
            trigger: "schedule",
            startedAt: "2026-08-28T02:00:00.000Z",
            finishedAt: "2026-08-28T02:05:00.000Z",
          },
        ],
        sessions: [
          {
            id: "s-run",
            title: "Fail",
            os: "ubuntu",
            templateId: "ubuntu-24.04",
            providerId: "p1",
            model: "gpt-4.1",
            status: "idle",
            messages: [],
            createdAt: "2026-08-29T02:00:00.000Z",
            updatedAt: "2026-08-29T02:05:00.000Z",
          },
          {
            id: "s-ok",
            title: "Ok",
            os: "ubuntu",
            templateId: "ubuntu-24.04",
            providerId: "p1",
            model: "gpt-4.1",
            status: "idle",
            messages: [],
            createdAt: "2026-08-28T02:00:00.000Z",
            updatedAt: "2026-08-28T02:05:00.000Z",
          },
        ],
      },
    );
    const allTab = [...host.querySelectorAll('[aria-label="Filter runs"] button')].find(
      (el) => el.textContent === "All",
    ) as HTMLButtonElement | undefined;
    act(() => {
      allTab?.click();
    });
    expect(host.querySelectorAll(".run-table tbody tr")).toHaveLength(2);
    const failedChip = [...host.querySelectorAll("[data-testid='auto-chips'] button")].find((el) =>
      el.textContent?.startsWith("Last failed"),
    ) as HTMLButtonElement | undefined;
    act(() => {
      failedChip?.click();
    });
    const failedTab = [...host.querySelectorAll('[aria-label="Filter runs"] button')].find(
      (el) => el.textContent === "Failed",
    );
    expect(failedTab?.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelectorAll(".run-table tbody tr")).toHaveLength(1);
  });
});
