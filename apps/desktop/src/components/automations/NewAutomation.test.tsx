import {
  UBUNTU_DEFAULT_HARDWARE,
  defaultNetworking,
  type Automation,
  type LocusConfig,
} from "@locus/shared";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewAutomationModal } from "./NewAutomation";
import { api } from "@/lib/api";
import { Store, initialState, type Action } from "@/state/store";
import {
  selectOptionLabels,
  selectOptionValues,
  selectValue,
  setSelectValue,
} from "@/lib/selectControl";

vi.mock("@/lib/api", () => ({
  api: {
    images: vi.fn(async () => []),
    createAutomation: vi.fn(),
    patchAutomation: vi.fn(),
    browseHost: vi.fn(),
    saveConfig: vi.fn(async (config) => config),
    workersStatus: vi.fn(async () => []),
    dockerStatus: vi.fn(async () => ({ kind: "mock", available: true })),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const saved: Automation = {
  id: "auto-1",
  name: "Host digest",
  enabled: true,
  prompt: "summarize inbox",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  runtime: "host",
  providerId: "p1",
  model: "gpt-4.1",
  startVm: false,
  schedule: { kind: "daily", hour: 9, minute: 0 },
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

function nameField(container: HTMLElement): HTMLInputElement {
  return [...container.querySelectorAll("input")].find(
    (el) => (el as HTMLInputElement).placeholder === "Nightly tests",
  ) as HTMLInputElement;
}

describe("NewAutomationModal runtimes", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(
    state = { ...initialState, config, newAutomationOpen: true },
    dispatch: (action: Action) => void = () => undefined,
  ) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider value={{ state, dispatch }}>
        <NewAutomationModal />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
  }

  it("offers Host next to Docker and VM and creates a host automation", async () => {
    vi.mocked(api.createAutomation).mockResolvedValue(saved);
    render();
    expect(
      [...host.querySelectorAll('[aria-label="Agent runtime"] [role="tab"]')].map(
        (btn) => btn.textContent,
      ),
    ).toEqual(["Docker", "VM", "Host"]);
    expect(host.querySelector(".docker-image-field")).not.toBeNull();

    const hostTab = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Host");
    act(() => {
      hostTab!.click();
    });
    expect(host.textContent).toContain("host-side tools");
    expect(host.querySelector(".docker-image-field")).toBeNull();
    expect(host.querySelector(".host-folder-field")).not.toBeNull();
    expect(host.textContent).not.toContain("Extra allow hosts");
    expect(host.textContent).toContain("Reuse the last chat for this job");
    expect(host.textContent).toContain("Remember facts between runs");
    expect(host.textContent).toContain("keeps the newest 60 chats");
    expect(host.querySelector("label.check")?.textContent).toContain(
      "Reuse the last chat for this job",
    );
    expect(
      [...host.querySelectorAll("label.check")].some((el) =>
        el.textContent?.includes("Remember facts between runs"),
      ),
    ).toBe(true);

    const name = nameField(host);
    const prompt = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const inputSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      inputSetter.call(name, "Host digest");
      name.dispatchEvent(new Event("input", { bubbles: true }));
      const areaSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      areaSetter.call(prompt, "summarize inbox");
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Create job",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
    });
    expect(api.createAutomation).not.toHaveBeenCalled();
    const hostConfirm = host.querySelector("[data-testid='auto-host-confirm']");
    expect(hostConfirm?.textContent).toContain("security exception");
    const confirm = [...hostConfirm!.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Create on host",
    );
    await act(async () => {
      confirm!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Host digest",
        prompt: "summarize inbox",
        runtime: "host",
        startVm: false,
        dockerImage: undefined,
        persistMemory: false,
      }),
    );
  });

  it("can opt in to remember facts between runs", async () => {
    vi.mocked(api.createAutomation).mockResolvedValue({ ...saved, persistMemory: true });
    render();
    const memoryBox = [...host.querySelectorAll("label")]
      .find((label) => label.textContent?.includes("Remember facts between runs"))
      ?.querySelector("input");
    expect(memoryBox).toBeTruthy();
    act(() => {
      memoryBox!.click();
    });
    const name = nameField(host);
    const prompt = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const inputSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      inputSetter.call(name, "Host digest");
      name.dispatchEvent(new Event("input", { bubbles: true }));
      const areaSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      areaSetter.call(prompt, "summarize inbox");
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Create job",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createAutomation).toHaveBeenCalledWith(
      expect.objectContaining({ persistMemory: true }),
    );
  });

  it("selects VM when editing an automation stored without a runtime", () => {
    const vmJob: Automation = {
      ...saved,
      id: "auto-vm",
      runtime: undefined,
      startVm: true,
      name: "Nightly VM",
    };
    render({
      ...initialState,
      config,
      newAutomationOpen: true,
      automations: [vmJob],
      editingAutomationId: vmJob.id,
    });
    const tabs = [...host.querySelectorAll('[aria-label="Agent runtime"] [role="tab"]')];
    expect(tabs.find((btn) => btn.textContent === "VM")?.getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(host.textContent).toContain("QEMU is the Windows-desktop");
  });

  it("puts When before Then and keeps repo and model in the essentials", () => {
    render();
    const when = host.querySelector("[data-testid='auto-when']");
    const then = host.querySelector("[data-testid='auto-then']");
    expect(when?.textContent).toContain("On a schedule");
    expect(then?.textContent).toContain("Name");
    expect(
      Boolean(
        when && then && when.compareDocumentPosition(then) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(host.textContent).toContain("Schedule");
    expect(host.querySelector("details.advanced > summary")?.textContent).toBe("More options");
    expect(host.textContent).toContain(
      "Named environment, placement, runtime, OS, hardware, jail, spend, autonomy, notify, MCP",
    );
    const envPicker = host.querySelector('[aria-label="Named environment"]') as HTMLElement;
    expect(envPicker).toBeTruthy();
    expect(selectOptionLabels(host, "Named environment").join(" ")).toContain(
      "None — pick runtime below",
    );
    expect(host.querySelector("details.advanced")?.contains(envPicker)).toBe(true);
    expect(
      host
        .querySelector("details.advanced")
        ?.contains(host.querySelector('[aria-label="Agent runtime"]')),
    ).toBe(true);
    const family = host.querySelector("[data-testid='auto-trigger-family']");
    expect([...(family?.querySelectorAll("button") ?? [])].map((el) => el.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("On a schedule"),
        expect.stringContaining("Git push"),
        expect.stringContaining("Webhook"),
      ]),
    );
    const kindValues = selectOptionValues(host, "Schedule");
    expect(kindValues).toEqual(expect.arrayContaining(["cron", "daily", "adaptive"]));
    expect(kindValues).not.toContain("webhook");
    expect(host.textContent).not.toContain("Git ref (optional)");
    expect(host.querySelector("[data-testid='auto-modal-starters']")).toBeNull();
    expect(host.querySelector("h2")?.textContent).toBe("New job");
  });

  it("keeps the spend cap field inside More options next to autonomy", () => {
    render();
    const more = host.querySelector("details.advanced") as HTMLDetailsElement;
    expect(more).toBeTruthy();
    act(() => {
      more.open = true;
      more.querySelector("summary")?.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    const spend = [...more.querySelectorAll("label")].find(
      (row) => row.textContent === "Spend cap (USD)",
    );
    expect(spend).toBeTruthy();
    expect(spend!.closest(".grid-spend")).toBeTruthy();
    expect(spend!.closest(".grid-spend")?.querySelector(".ui-select")).toBeTruthy();
  });

  it("creates an adaptive by-time-of-day schedule", async () => {
    vi.mocked(api.createAutomation).mockResolvedValue({
      ...saved,
      name: "Peak digest",
      schedule: {
        kind: "adaptive",
        startHour: 9,
        startMinute: 0,
        endHour: 17,
        endMinute: 0,
        everyMinutes: 60,
        otherwiseEveryMinutes: 180,
      },
    });
    render();
    expect(selectOptionValues(host, "Schedule")).toContain("adaptive");
    act(() => {
      setSelectValue(host, "Schedule", "adaptive");
    });
    expect(host.textContent).toContain("Faster inside a daily window");
    expect(host.textContent).toContain("Minutes during window");
    expect(host.textContent).toContain("Minutes otherwise");

    const name = nameField(host);
    const prompt = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const inputSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      inputSetter.call(name, "Peak digest");
      name.dispatchEvent(new Event("input", { bubbles: true }));
      const areaSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      areaSetter.call(prompt, "summarize inbox");
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Create job",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Peak digest",
        prompt: "summarize inbox",
        schedule: {
          kind: "adaptive",
          startHour: 9,
          startMinute: 0,
          endHour: 17,
          endMinute: 0,
          everyMinutes: 60,
          otherwiseEveryMinutes: 180,
        },
      }),
    );
  });

  it("loads adaptive window fields when editing", () => {
    const job: Automation = {
      ...saved,
      schedule: {
        kind: "adaptive",
        startHour: 8,
        startMinute: 30,
        endHour: 18,
        endMinute: 0,
        everyMinutes: 30,
        otherwiseEveryMinutes: 120,
      },
    };
    render({
      ...initialState,
      config,
      newAutomationOpen: true,
      automations: [job],
      editingAutomationId: job.id,
    });
    expect(host.textContent).toContain("Minutes during window");
    const times = [...host.querySelectorAll('input[type="time"]')] as HTMLInputElement[];
    expect(times.map((el) => el.value)).toEqual(["08:30", "18:00"]);
    const minuteFields = [...host.querySelectorAll('input[type="number"]')] as HTMLInputElement[];
    expect(minuteFields.map((el) => el.value)).toEqual(["30", "120", "", ""]);
    expect(minuteFields.map((el) => el.getAttribute("aria-label"))).toEqual([
      null,
      null,
      null,
      "Lifetime spend cap",
    ]);
  });

  it("applies a named environment onto reuse, memory, jail, and Where", async () => {
    vi.mocked(api.createAutomation).mockResolvedValue({
      ...saved,
      name: "Overnight",
      namedEnvironmentId: "env-1",
      reuseSession: true,
      persistMemory: true,
      network: "restricted",
    });
    render({
      ...initialState,
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
            recipeId: "ops-loop",
            maxUsd: 20,
            createdAt: "2026-08-29T00:00:00.000Z",
            updatedAt: "2026-08-29T00:00:00.000Z",
          },
        ],
      },
      newAutomationOpen: true,
    });
    act(() => {
      setSelectValue(host, "Named environment", "env-1");
    });
    expect(selectValue(host, "Jail")).toBe("restricted");
    const reuse = [...host.querySelectorAll("label")]
      .find((label) => label.textContent?.includes("Reuse the last machine"))
      ?.querySelector("input") as HTMLInputElement;
    const memory = [...host.querySelectorAll("label")]
      .find((label) => label.textContent?.includes("Remember facts between runs"))
      ?.querySelector("input") as HTMLInputElement;
    expect(reuse.checked).toBe(true);
    expect(memory.checked).toBe(true);
    const name = [...host.querySelectorAll("input")].find(
      (el) => (el as HTMLInputElement).placeholder === "Nightly tests",
    ) as HTMLInputElement;
    const prompt = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const inputSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      inputSetter.call(name, "Overnight");
      name.dispatchEvent(new Event("input", { bubbles: true }));
      const areaSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      areaSetter.call(prompt, "check grafana");
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Create job",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        namedEnvironmentId: "env-1",
        reuseSession: true,
        persistMemory: true,
        network: "restricted",
        maxUsd: 20,
        dockerImage: "locus/agent:0.1",
      }),
    );
  });

  it("keeps notify and MCP allowlist under More options for webhook jobs", () => {
    render();
    const webhook = [...host.querySelectorAll("[data-testid='auto-trigger-family'] button")].find(
      (el) => el.textContent?.includes("Webhook"),
    ) as HTMLButtonElement | undefined;
    act(() => {
      webhook?.click();
    });
    const more = host.querySelector("details.advanced") as HTMLDetailsElement;
    act(() => {
      more.open = true;
      more.querySelector("summary")?.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    expect(host.querySelector("[data-testid='auto-mcp']")).toBeTruthy();
    expect(host.textContent).toContain("Notify webhook");
    expect(host.textContent).toContain("Empty means this job gets no MCP");
  });

  it("sends null when clearing notify, owner, image, and spend on save", async () => {
    vi.mocked(api.patchAutomation).mockResolvedValue(saved);
    const job: Automation = {
      ...saved,
      runtime: "docker",
      dockerImage: "ubuntu:24.04",
      startVm: true,
      notifyWebhook: "https://hooks.example/x",
      notifyChannel: "#ops",
      imageId: "img-1",
      maxUsd: 12,
    };
    render({
      ...initialState,
      config,
      newAutomationOpen: true,
      automations: [job],
      editingAutomationId: job.id,
    });
    const more = host.querySelector("details.advanced") as HTMLDetailsElement;
    act(() => {
      more.open = true;
      more.querySelector("summary")?.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    const notify = [...host.querySelectorAll("input")].find((el) =>
      (el as HTMLInputElement).placeholder?.includes("hooks.slack"),
    ) as HTMLInputElement;
    const channel = [...host.querySelectorAll("input")].find((el) =>
      (el as HTMLInputElement).placeholder?.includes("#ops"),
    ) as HTMLInputElement;
    const spend = [...host.querySelectorAll("input")].find(
      (el) =>
        (el as HTMLInputElement).placeholder === "unlimited" ||
        (el as HTMLInputElement).placeholder === "20",
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(notify, "");
      notify.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(channel, "");
      channel.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(spend, "");
      spend.dispatchEvent(new Event("input", { bubbles: true }));
      setSelectValue(host, "Workspace image", "");
    });
    const save = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Save");
    await act(async () => {
      save!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.patchAutomation).toHaveBeenCalledWith(
      "auto-1",
      expect.objectContaining({
        notifyWebhook: null,
        notifyChannel: null,
        imageId: null,
        maxUsd: null,
      }),
    );
  });

  it("asks before discarding a dirty draft from the backdrop or Escape", async () => {
    const dispatch = vi.fn();
    render({ ...initialState, config, newAutomationOpen: true }, dispatch);
    const name = nameField(host);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(name, "Changed");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (host.querySelector(".modal-backdrop") as HTMLElement).click();
    });
    const discard = host.querySelector("[data-testid='auto-discard-confirm']");
    expect(discard?.textContent).toContain("Unsaved");
    expect(dispatch).not.toHaveBeenCalledWith({ type: "newAutomation", open: false });
    const confirm = [...discard!.querySelectorAll("button")].find(
      (el) => el.textContent === "Discard",
    );
    await act(async () => {
      confirm!.click();
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "newAutomation", open: false });
  });

  it("prefills a starter and labels local clock times", () => {
    render({
      ...initialState,
      config,
      newAutomationOpen: true,
      automationStarterId: "nightly",
    });
    const name = [...host.querySelectorAll("input")].find(
      (el) => (el as HTMLInputElement).placeholder === "Nightly tests",
    ) as HTMLInputElement;
    expect(name.value).toBe("Nightly tests");
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toMatch(/test suite/);
    expect(selectValue(host, "Schedule")).toBe("daily");
    const time = host.querySelector('input[type="time"]') as HTMLInputElement;
    expect(time.value).toBe("02:00");
    expect(host.querySelector("[data-testid='auto-tz-hint']")?.textContent).toMatch(
      /IANA zone.*This machine is UTC/,
    );
  });
  it("warns before save when Docker is selected but the daemon is down", async () => {
    vi.mocked(api.dockerStatus).mockResolvedValueOnce({ kind: "docker", available: false });
    render();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const warn = host.querySelector("[data-testid='auto-editor-docker-down']");
    expect(warn?.textContent).toContain("Docker isn't running — switch to Host or start Docker");
    const labels = [...warn!.querySelectorAll("button")].map((el) => el.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Switch to Host", "Start Docker"]));
    const start = [...warn!.querySelectorAll("button")].find(
      (el) => el.textContent === "Start Docker",
    );
    act(() => start!.click());
    expect(host.querySelector("[data-testid='auto-docker-help']")?.textContent).toContain(
      "systemctl start docker",
    );
    const toHost = [...warn!.querySelectorAll("button")].find(
      (el) => el.textContent === "Switch to Host",
    );
    act(() => toHost!.click());
    expect(host.querySelector("[data-testid='auto-editor-docker-down']")).toBeNull();
    expect(host.textContent).toContain("Reuse the last chat for this job");
  });

  it("warns on a disabled provider and shows the price once", () => {
    const off: LocusConfig = {
      ...config,
      providers: [{ ...config.providers[0]!, name: "OpenCode", enabled: false }],
    };
    render({ ...initialState, config: off, newAutomationOpen: true });
    expect(host.querySelector("[data-testid='auto-provider-off']")?.textContent).toContain(
      "OpenCode is off",
    );
    expect(host.querySelector(".model-cost")).toBeNull();
  });

  it("offers linked repos first instead of a Paste a URL label", () => {
    const repo = {
      id: "r1",
      name: "acme/app",
      checkout: { forge: "github" as const, url: "https://github.com/acme/app.git", ref: "main" },
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    render({ ...initialState, config, newAutomationOpen: true, repos: [repo] });
    const labels = selectOptionLabels(host, "Repository");
    expect(labels[0]).toBe("No repo");
    expect(labels).toEqual(expect.arrayContaining(["Another URL…"]));
    expect(labels.some((label) => label.startsWith("acme/app"))).toBe(true);
    expect(labels).not.toContain("Paste a URL");
    expect(host.querySelector('[aria-label="Repository URL"]')).toBeNull();
    act(() => setSelectValue(host, "Repository", "r1"));
    expect(selectValue(host, "Repository")).toBe("r1");
    act(() => setSelectValue(host, "Repository", "__url"));
    expect(host.querySelector('[aria-label="Repository URL"]')).toBeTruthy();
  });

  it("starts blackout dates empty with a format hint", () => {
    render();
    const blackout = host.querySelector('[aria-label="Blackout dates"]') as HTMLInputElement;
    expect(blackout.value).toBe("");
    expect(blackout.placeholder).toBe("YYYY-MM-DD, comma-separated");
  });
});
