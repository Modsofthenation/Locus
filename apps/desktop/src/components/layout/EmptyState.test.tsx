import {
  UBUNTU_DEFAULT_HARDWARE,
  defaultNetworking,
  FIRST_TASKS,
  recipeById,
  type AgentSession,
  type LinkedRepo,
  type LocusConfig,
} from "@locus/shared";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmptyState } from "./EmptyState";
import { NewSessionModal } from "@/components/chat/NewSession";
import { Sidebar } from "./Sidebar";
import { FINISH_SETUP_DISMISSED_KEY } from "@/components/settings/FinishSetupChecklist";
import { api } from "@/lib/api";
import { Store, initialState, reducer, type Action, type UiState } from "@/state/store";
import { selectValue, setSelectValue } from "@/lib/selectControl";

vi.mock("@/lib/api", () => ({
  api: {
    images: vi.fn(async () => []),
    workersStatus: vi.fn(async () => []),
    createSession: vi.fn(),
    chat: vi.fn(),
    browseHost: vi.fn(),
    saveConfig: vi.fn(async (config) => config),
    repoBranches: vi.fn(async () => ({ branches: ["main", "feat"], defaultBranch: "main" })),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function pickComposerRepoBranch(host: HTMLElement, repoName: string, branch: string) {
  const picker = host.querySelector("[aria-label='Repository']") as HTMLButtonElement;
  if (!host.querySelector("[role='listbox']")) {
    act(() => {
      picker.click();
    });
  }
  if (host.querySelector("[role='listbox']")?.getAttribute("aria-label") === "Branches") {
    act(() => {
      (host.querySelector("[aria-label='Back to repositories']") as HTMLButtonElement).click();
    });
  }
  const option = [...host.querySelectorAll("[role='option']")].find((row) =>
    row.textContent?.includes(repoName),
  ) as HTMLButtonElement;
  act(() => {
    option.click();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const branchOpt = [...host.querySelectorAll("[role='option']")].find((row) =>
    row.textContent?.includes(branch),
  ) as HTMLButtonElement;
  act(() => {
    branchOpt.click();
  });
}

function pasteClipboardFiles(target: Element, files: File[]) {
  const items = files.map((file) => ({
    kind: "file",
    type: file.type,
    getAsFile: () => file,
  }));
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      items,
      files,
      getData: () => "",
    },
  });
  target.dispatchEvent(event);
  return event;
}

function pasteClipboardText(target: Element, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
      files: [],
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
  });
  target.dispatchEvent(event);
  return event;
}

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

const created: AgentSession = {
  id: "s1",
  title: "Review",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  runtime: "docker",
  dockerImage: "node:22-bookworm",
  providerId: "p1",
  model: "gpt-4.1",
  status: "idle",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

const linkedRepo: LinkedRepo = {
  id: "r1",
  name: "acme/app",
  checkout: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

describe("EmptyState recipes", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    window.localStorage.removeItem("locus.lastAgent");
    window.localStorage.removeItem("locus.ideRecents");
    window.localStorage.removeItem(FINISH_SETUP_DISMISSED_KEY);
    act(() => root.unmount());
    host.remove();
  });

  function render(
    dispatch: (action: Action) => void = () => undefined,
    extra: Partial<UiState> = {},
  ) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider
        value={{
          state: {
            ...initialState,
            config,
            dockerKind: "docker",
            hypervisorKind: "qemu",
            ...extra,
          },
          dispatch,
        }}
      >
        <EmptyState />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
  }

  it("hides installer QA without a Windows ISO and prefills a Docker recipe", async () => {
    const actions: Action[] = [];
    vi.mocked(api.createSession).mockResolvedValue(created);
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    render((action) => {
      actions.push(action);
    });
    expect(host.querySelector(".empty.agent-start")).toBeTruthy();
    expect(host.querySelector(".eyebrow")).toBeNull();
    expect(host.querySelector(".empty-card h2")?.textContent).toBe("What should we talk about?");
    expect(
      host.querySelector('[aria-label="Agent runtime"] [aria-selected="true"]')?.textContent,
    ).toBe("Host");
    const dockerTab = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Docker",
    );
    act(() => {
      dockerTab!.click();
    });
    expect(host.querySelector(".empty-card h2")?.textContent).toBe("What should we talk about?");
    expect(host.textContent).toContain("PR reviewer");
    expect(host.textContent).toContain("Repo fixer");
    expect(host.textContent).toContain("Setup environment");
    expect(host.textContent).toContain("Web QA");
    expect(host.textContent).toContain("Ops loop");
    expect(host.textContent).not.toContain("Installer QA");
    expect(host.querySelector(".recipe-grid.pills")).toBeTruthy();
    expect(host.querySelector(".docker-image-field")).toBeNull();
    const mascot = host.querySelector("[data-testid='locus-mascot']");
    expect(mascot?.getAttribute("data-pose")).toBe("idle");
    expect(mascot?.getAttribute("data-follow-cursor")).toBe("true");
    expect(mascot?.getAttribute("width")).toBe("48");

    const reviewer = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("PR reviewer"),
    );
    act(() => {
      reviewer!.click();
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.value).toContain("Review the current branch");

    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Create agent",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "docker",
        dockerImage: "locus/agent:0.1",
        playbook: recipeById("pr-reviewer")?.playbook,
        allowedTools: recipeById("pr-reviewer")?.allowedTools,
        kind: "review",
        prompt: textarea.value,
      }),
    );
    expect(api.createSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ network: expect.anything() }),
    );
    expect(api.chat).not.toHaveBeenCalled();

    const more = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "More options",
    );
    act(() => {
      more!.click();
    });
    const advanced = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Full form",
    );
    act(() => {
      advanced!.click();
    });
    expect(
      actions.some(
        (action) =>
          action.type === "new" && action.playbook === recipeById("pr-reviewer")?.playbook,
      ),
    ).toBe(true);
  });

  it("defaults to Docker when the engine is present", () => {
    render(() => undefined, {
      setup: {
        hypervisorKind: "qemu",
        qemuFound: true,
        qemuHint: "",
        kvmLabel: "",
        linuxImageReady: true,
        dockerFound: true,
        hasProvider: true,
        hasGoldenImage: false,
        setupCompleted: true,
        ready: true,
        needsWizard: false,
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
    expect(
      host.querySelector('[aria-label="Agent runtime"] [aria-selected="true"]')?.textContent,
    ).toBe("Docker");
  });

  it("fills the composer from a first-task pill when there are no agent sessions", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue(created);
    render();
    expect(host.querySelector("[aria-label='Try a first task']")).toBeTruthy();
    const pill = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("hello.txt"),
    );
    expect(pill).toBeTruthy();
    act(() => {
      pill!.click();
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      FIRST_TASKS[0]?.prompt,
    );
    expect(pill!.getAttribute("aria-pressed")).toBe("true");
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Start chat",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: FIRST_TASKS[0]?.prompt, runtime: "host" }),
    );
  });

  it("shows a guided first-task card after setup until skip or fill", async () => {
    render(undefined, { config: { ...config, setupFirstTask: "pending" } });
    expect(host.querySelector("[data-testid='first-task-card']")).toBeTruthy();
    const fill = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Fill the composer"),
    );
    await act(async () => {
      fill!.click();
      await Promise.resolve();
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toMatch(/hello\.txt/);
    expect(api.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ setupFirstTask: "done" }),
    );
  });

  it("hides the first-task pill after a couple of agent sessions", () => {
    render(undefined, { sessions: [created, { ...created, id: "s2" }] });
    expect(host.querySelector("[aria-label='Try a first task']")).toBeNull();
    expect(host.textContent).not.toContain("hello.txt");
  });

  it("hides the first-task pill until a provider is enabled", () => {
    render(undefined, {
      config: { ...config, providers: [{ ...config.providers[0]!, enabled: false }] },
    });
    expect(host.querySelector("[aria-label='Try a first task']")).toBeNull();
  });

  it("creates a host chat without a VM or container", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.chat).mockClear();
    vi.mocked(api.createSession).mockResolvedValue({
      ...created,
      runtime: "host",
      status: "idle",
      dockerImage: undefined,
    });
    render();
    const hostTab = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Host");
    act(() => {
      hostTab!.click();
    });
    expect(host.textContent).toContain("Choose how it runs, then the folder it can touch");
    expect(host.textContent).not.toContain("PR reviewer");
    expect(host.querySelector(".docker-image-field")).toBeNull();
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Hello host");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Start chat",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "host",
        startVm: false,
        vision: "off",
        prompt: "Hello host",
      }),
    );
    expect(vi.mocked(api.createSession).mock.calls.at(-1)?.[0]).not.toMatchObject({ kind: "ide" });
  });

  it("sends a chosen host workspace folder when creating a host chat", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue({
      ...created,
      runtime: "host",
      status: "idle",
      dockerImage: undefined,
      hostDir: "/tmp/my-project",
    });
    window.localStorage.setItem(
      "locus.ideRecents",
      JSON.stringify([{ path: "/tmp/my-project", title: "my-project", at: Date.now() }]),
    );
    render();
    const hostTab = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Host");
    act(() => {
      hostTab!.click();
    });
    expect(host.querySelector("[data-testid='launch-workspace']")).not.toBeNull();
    act(() => {
      host
        .querySelector("[data-testid='launch-workspace-toggle']")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      host
        .querySelector("[data-testid='launch-workspace-option-host:/tmp/my-project']")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Start chat",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "host",
        hostDir: "/tmp/my-project",
      }),
    );
  });

  it("does not send a stale hostDir when Private folder is selected", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue({
      ...created,
      runtime: "host",
      status: "idle",
      dockerImage: undefined,
    });
    window.localStorage.setItem(
      "locus.lastAgent",
      JSON.stringify({ os: "ubuntu", runtime: "host", hostDir: "/tmp/stale-project" }),
    );
    window.localStorage.setItem(
      "locus.ideRecents",
      JSON.stringify([{ path: "/tmp/stale-project", title: "stale-project", at: Date.now() }]),
    );
    render();
    const hostTab = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Host");
    act(() => {
      hostTab!.click();
    });
    act(() => {
      host
        .querySelector("[data-testid='launch-workspace-toggle']")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      host
        .querySelector("[data-testid='launch-workspace-option-private']")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Start chat",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const payload = vi.mocked(api.createSession).mock.calls.at(-1)?.[0];
    expect(payload).toEqual(
      expect.objectContaining({
        runtime: "host",
      }),
    );
    expect(payload?.hostDir).toBeFalsy();
  });

  it("picks a host workspace folder from the folder modal", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.browseHost).mockResolvedValue({
      path: "/home/me/src/app",
      parent: "/home/me/src",
      entries: [],
    });
    vi.mocked(api.createSession).mockResolvedValue({
      ...created,
      runtime: "host",
      status: "idle",
      dockerImage: undefined,
      hostDir: "/home/me/src/app",
    });
    render();
    const hostTab = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Host");
    act(() => {
      hostTab!.click();
    });
    const browse = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Open folder",
    );
    await act(async () => {
      browse!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const dialog = document.querySelector("[data-testid='host-folder-picker']") as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.querySelector("#host-folder-title")?.textContent).toBe("Workspace folder");
    expect((dialog.querySelector("[aria-label='Folder path']") as HTMLInputElement).value).toBe(
      "/home/me/src/app",
    );
    await act(async () => {
      [...dialog.querySelectorAll("button")]
        .find((btn) => btn.textContent === "Select folder")!
        .click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector("[data-testid='host-folder-picker']")).toBeNull();
    expect(host.querySelector("[data-testid='launch-workspace']")?.textContent).toContain(
      "/home/me/src/app",
    );
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Start chat",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "host",
        hostDir: "/home/me/src/app",
      }),
    );
  });

  it("shows the attach button and sends picked files with createSession", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue(created);
    render();
    const attach = host.querySelector("button.composer-add") as HTMLButtonElement;
    expect(attach).not.toBeNull();
    expect(attach.getAttribute("aria-label")).toMatch(
      /Copied into \/workspace\/\.locus-attachments/,
    );
    expect(attach.getAttribute("aria-label")).not.toMatch(/Vision is off/);
    expect(host.querySelector(".composer-attach")).toBeNull();
    const dockerTab = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Docker",
    );
    act(() => {
      dockerTab!.click();
    });
    expect(
      (host.querySelector("button.composer-add") as HTMLButtonElement).getAttribute("aria-label"),
    ).toMatch(/Vision is off/);
    const vmTab = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "VM");
    act(() => {
      vmTab!.click();
    });
    expect(
      (host.querySelector("button.composer-add") as HTMLButtonElement).getAttribute("aria-label"),
    ).not.toMatch(/Vision is off/);
    act(() => {
      dockerTab!.click();
    });
    const input = host.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    await act(async () => {
      Object.defineProperty(input, "files", { value: [file] as unknown as FileList });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(host.querySelector(".composer-attach")?.textContent).toContain("note.txt");
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Use this");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Create agent",
    );
    await act(async () => {
      create!.click();
      await vi.waitFor(() => {
        expect(api.createSession).toHaveBeenCalled();
      });
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Use this",
        attachments: [{ name: "note.txt", mime: "text/plain", contentBase64: btoa("hello") }],
      }),
    );
  });

  it("rejects an oversize attachment at pick time", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue(created);
    render();
    const input = host.querySelector("input[type='file']") as HTMLInputElement;
    const oversize = new File(["x"], "big.png", { type: "image/png" });
    Object.defineProperty(oversize, "size", { value: 11 * 1024 * 1024 });
    await act(async () => {
      Object.defineProperty(input, "files", { value: [oversize] as unknown as FileList });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(host.textContent).toContain("too large");
    expect(host.querySelector(".composer-attach")).toBeNull();
  });

  it("attaches a file when creating a host chat", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue(created);
    render();
    const hostTab = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Host");
    act(() => {
      hostTab!.click();
    });
    const attach = host.querySelector("button.composer-add") as HTMLButtonElement;
    expect(attach).not.toBeNull();
    expect(attach.getAttribute("aria-label")).toMatch(
      /Copied into \/workspace\/\.locus-attachments/,
    );
    const input = host.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["hello"], "brief.txt", { type: "text/plain" });
    await act(async () => {
      Object.defineProperty(input, "files", { value: [file] as unknown as FileList });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(host.querySelector(".composer-attach")?.textContent).toContain("brief.txt");
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Use this");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Start chat",
    );
    await act(async () => {
      create!.click();
      await vi.waitFor(() => {
        expect(api.createSession).toHaveBeenCalled();
      });
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "host",
        prompt: "Use this",
        attachments: [{ name: "brief.txt", mime: "text/plain", contentBase64: btoa("hello") }],
      }),
    );
  });

  it("keeps attach, repo, and model on one footer row under the prompt", () => {
    render();
    const composer = host.querySelector(".empty-composer") as HTMLDivElement;
    const textarea = composer.querySelector("textarea") as HTMLTextAreaElement;
    const bar = composer.querySelector(".empty-composer-bar") as HTMLDivElement;
    expect(composer.querySelector(".empty-composer-head")).toBeNull();
    expect(bar).toBeTruthy();
    expect(textarea.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar.querySelector(".composer-add")).toBeTruthy();
    expect(bar.querySelector("[aria-label='Repository']")).toBeTruthy();
    expect(bar.querySelector(".composer-toolbar-end .model-picker")).toBeTruthy();
  });

  it("lets a new agent choose Codex reasoning effort before creation", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue({
      ...created,
      providerId: "codex-cli",
      model: "gpt-6-astra",
      reasoningEffort: "xhigh",
    });
    render(undefined, {
      config: {
        ...config,
        providers: [
          {
            id: "codex-cli",
            name: "Codex CLI",
            kind: "codex-cli",
            baseUrl: "codex-cli://local",
            models: ["gpt-6-astra"],
            defaultModel: "gpt-6-astra",
            enabled: true,
            extraHeaders: {},
          },
        ],
      },
    });

    const options = host.querySelector('[aria-label="Model options"]') as HTMLButtonElement;
    expect(options).toBeTruthy();
    act(() => options.click());
    const xhigh = [...host.querySelectorAll("[role='menuitem']")].find(
      (item) => item.textContent === "XHigh",
    ) as HTMLButtonElement;
    expect(xhigh).toBeTruthy();
    act(() => xhigh.click());

    const create = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Start chat",
    );
    await act(async () => {
      create!.click();
      await vi.waitFor(() => expect(api.createSession).toHaveBeenCalled());
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "codex-cli",
        model: "gpt-6-astra",
        reasoningEffort: "xhigh",
      }),
    );
  });

  it("inserts a pasted image as a chip in the new-agent composer", () => {
    render();
    const composer = host.querySelector(".empty-composer") as HTMLDivElement;
    const image = new File([new Uint8Array([137, 80, 78, 71])], "clip.png", { type: "image/png" });
    act(() => {
      pasteClipboardFiles(composer, [image]);
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "[[paste:clip.png]] ",
    );
    expect(host.querySelector("[data-testid=composer-paste-chip]")?.textContent).toContain(
      "clip.png",
    );
    expect(host.querySelector(".composer-attach")).toBeNull();
  });

  it("inserts a pasted text block as a chip at the caret", () => {
    render();
    const composer = host.querySelector(".empty-composer") as HTMLDivElement;
    act(() => {
      pasteClipboardText(composer, "alpha\nbeta\ngamma");
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "[[paste:Clipboard.txt]] ",
    );
    expect(host.querySelector("[data-testid=composer-paste-chip]")?.textContent).toContain(
      "Clipboard.txt",
    );
    expect(host.querySelector(".composer-attach")).toBeNull();
  });

  it("rejects an oversize pasted image in the new-agent composer", () => {
    render();
    const composer = host.querySelector(".empty-composer") as HTMLDivElement;
    const oversize = new File(["x"], "huge.png", { type: "image/png" });
    Object.defineProperty(oversize, "size", { value: 11 * 1024 * 1024 });
    act(() => {
      pasteClipboardFiles(composer, [oversize]);
    });
    expect(host.textContent).toContain("too large");
    expect(host.querySelector(".composer-attach")).toBeNull();
  });

  it("inserts a pasted image chip when creating a host chat", () => {
    render();
    const hostTab = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Host");
    act(() => {
      hostTab!.click();
    });
    const composer = host.querySelector(".empty-composer") as HTMLDivElement;
    const image = new File([new Uint8Array([1])], "clip.png", { type: "image/png" });
    act(() => {
      pasteClipboardFiles(composer, [image]);
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "[[paste:clip.png]] ",
    );
    expect(host.querySelector(".composer-attach")).toBeNull();
  });

  it("defaults the composer to No repo and can attach a linked repo", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue(created);
    const actions: Action[] = [];
    render(
      (action) => {
        actions.push(action);
      },
      { repos: [linkedRepo] },
    );
    const picker = host.querySelector("[aria-label='Repository']") as HTMLButtonElement;
    expect(picker).not.toBeNull();
    expect(host.querySelector(".composer-repo-placeholder")?.textContent).toBe("No repo");

    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Start chat",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ repoId: expect.anything() }),
    );

    await pickComposerRepoBranch(host, "acme/app", "main");
    vi.mocked(api.createSession).mockClear();
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ repoId: "r1", branchLock: true }),
    );

    const more = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "More options",
    );
    act(() => {
      more!.click();
    });
    const branchLock = host.querySelector('[aria-label="Branch lock"]') as HTMLButtonElement;
    expect(branchLock.getAttribute("aria-checked")).toBe("true");
    act(() => {
      branchLock.click();
    });
    expect(branchLock.getAttribute("aria-checked")).toBe("false");
    await pickComposerRepoBranch(host, "acme/app", "feat");
    vi.mocked(api.createSession).mockClear();
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: "r1",
        repo: expect.objectContaining({ ref: "feat" }),
      }),
    );
    expect(api.createSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ branchLock: true }),
    );

    const advanced = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Full form",
    );
    act(() => {
      advanced!.click();
    });
    expect(
      actions.some(
        (action) =>
          action.type === "new" &&
          action.repoId === "r1" &&
          action.repoUrl?.includes("acme/app") &&
          action.repoRef === "feat",
      ),
    ).toBe(true);
  });

  it("checks out the selected branch from the create composer", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue(created);
    vi.mocked(api.repoBranches).mockClear();
    vi.mocked(api.repoBranches).mockResolvedValue({
      branches: ["main", "feat"],
      defaultBranch: "main",
    });
    const actions: Action[] = [];
    render(
      (action) => {
        actions.push(action);
      },
      { repos: [linkedRepo] },
    );
    const picker = host.querySelector("[aria-label='Repository']") as HTMLButtonElement;
    act(() => {
      picker.click();
    });
    const option = [...host.querySelectorAll("[role='option']")].find((row) =>
      row.textContent?.includes("acme/app"),
    ) as HTMLButtonElement;
    act(() => {
      option.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.repoBranches).toHaveBeenCalledWith("r1");
    expect(host.querySelector("[aria-label='Branch']")).toBeNull();
    expect(host.querySelector("[role='listbox']")?.getAttribute("aria-label")).toBe("Branches");
    const feat = [...host.querySelectorAll("[role='option']")].find((row) =>
      row.textContent?.includes("feat"),
    ) as HTMLButtonElement;
    expect(feat).toBeTruthy();
    act(() => {
      feat.click();
    });
    expect(host.querySelector(".composer-repo-chip-ref")?.textContent).toBe("feat");
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Start chat",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: "r1",
        repo: expect.objectContaining({
          url: "https://github.com/acme/app.git",
          ref: "feat",
        }),
      }),
    );
    const more = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "More options",
    );
    act(() => {
      more!.click();
    });
    const advanced = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Full form",
    );
    act(() => {
      advanced!.click();
    });
    expect(actions.some((action) => action.type === "new" && action.repoRef === "feat")).toBe(true);
  });

  it("can attach a second linked repo as extraRepoIds", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue(created);
    const lib: LinkedRepo = {
      ...linkedRepo,
      id: "r2",
      name: "acme/lib",
      checkout: { forge: "github", url: "https://github.com/acme/lib.git" },
    };
    render(undefined, { repos: [linkedRepo, lib] });
    await pickComposerRepoBranch(host, "acme/app", "feat");
    await pickComposerRepoBranch(host, "acme/lib", "main");
    expect(host.querySelector("[aria-label='Remove acme/app']")).not.toBeNull();
    expect(host.querySelector("[aria-label='Remove acme/lib']")).not.toBeNull();
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Start chat",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: "r1",
        extraRepoIds: ["r2"],
        repo: expect.objectContaining({ url: "https://github.com/acme/app.git", ref: "feat" }),
        extraRepos: [
          expect.objectContaining({ url: "https://github.com/acme/lib.git", ref: "main" }),
        ],
      }),
    );
  });

  it("can remove a selected repo from the create composer", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue(created);
    const lib: LinkedRepo = {
      ...linkedRepo,
      id: "r2",
      name: "acme/lib",
      checkout: { forge: "github", url: "https://github.com/acme/lib.git" },
    };
    render(undefined, { repos: [linkedRepo, lib] });
    await pickComposerRepoBranch(host, "acme/app", "main");
    await pickComposerRepoBranch(host, "acme/lib", "main");
    act(() => {
      (host.querySelector("[aria-label='Remove acme/lib']") as HTMLButtonElement).click();
    });
    expect(host.querySelector("[aria-label='Remove acme/lib']")).toBeNull();
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Start chat",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(expect.objectContaining({ repoId: "r1" }));
    expect(vi.mocked(api.createSession).mock.calls[0]?.[0]).not.toHaveProperty("extraRepoIds");
  });

  it("deep-links Add a GitHub token to Settings → Git when no forge is connected", () => {
    const actions: Action[] = [];
    render((action) => {
      actions.push(action);
    });
    const add = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Add a GitHub token",
    );
    expect(add).toBeTruthy();
    act(() => {
      add!.click();
    });
    expect(actions).toEqual([
      { type: "settings", open: true },
      { type: "settingsTab", tab: "git" },
    ]);
  });

  it("hides Add a GitHub token once a forge token is present", () => {
    render(undefined, {
      config: {
        ...config,
        forges: [
          {
            id: "gh1",
            kind: "github",
            name: "GitHub",
            apiBaseUrl: "https://api.github.com",
            token: "ghp_test",
          },
        ],
      },
    });
    expect(host.textContent).not.toContain("Add a GitHub token");
  });

  it("attaches a new swarm teammate to the active team", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue(created);
    render(() => undefined, {
      config: { ...config, productMode: "swarm" },
      selectedProjectId: "team-1",
      projects: [
        {
          id: "team-1",
          title: "Platform",
          teamName: "Platform",
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T00:00:00.000Z",
          memberCount: 1,
          surface: "swarm",
        },
      ],
    });
    const create = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Create teammate"),
    );
    expect(create).toBeTruthy();
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ surface: "swarm", projectId: "team-1" }),
    );
  });
});

describe("EmptyState mock engine", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    window.localStorage.removeItem("locus.lastAgent");
    window.localStorage.removeItem(FINISH_SETUP_DISMISSED_KEY);
    act(() => root.unmount());
    host.remove();
  });

  function render(
    extra: Partial<UiState> = {},
    dispatch: (action: Action) => void = () => undefined,
  ) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              config,
              dockerKind: "mock",
              hypervisorKind: "mock",
              ...extra,
            },
            dispatch,
          }}
        >
          <EmptyState />
        </Store.Provider>,
      );
    });
  }

  it("blocks Create agent on a mock Docker engine and offers Host", () => {
    const actions: Action[] = [];
    render({}, (action) => {
      actions.push(action);
    });
    const dockerTab = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Docker",
    );
    act(() => {
      dockerTab!.click();
    });
    expect(host.textContent).toContain("Agents cannot run on a mock engine");
    expect(host.textContent).not.toContain("Using a mock Docker engine until the Docker CLI");
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Create agent",
    ) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    const more = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "More options",
    ) as HTMLButtonElement;
    expect(more.disabled).toBe(true);
    const install = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Install Docker",
    );
    const finish = [...host.querySelectorAll(".setup-callout button")].find(
      (btn) => btn.textContent === "Finish setup",
    );
    expect(install).toBeTruthy();
    expect(finish).toBeTruthy();
    act(() => {
      install!.click();
    });
    expect(actions.some((action) => action.type === "setupOpen" && action.open)).toBe(true);

    act(() => {
      [...host.querySelectorAll("button")]
        .find((btn) => btn.textContent === "Use Host instead")!
        .click();
    });
    expect(host.textContent).not.toContain("Agents cannot run on a mock engine");
    const start = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Start chat",
    ) as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    expect(
      (
        [...host.querySelectorAll("button")].find(
          (btn) => btn.textContent === "More options",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("shows a Finish setup checklist after Skip for now", () => {
    const actions: Action[] = [];
    render(
      {
        setup: {
          hypervisorKind: "mock",
          qemuFound: false,
          qemuHint: "",
          kvmLabel: "",
          linuxImageReady: false,
          dockerFound: false,
          hasProvider: false,
          hasGoldenImage: false,
          setupCompleted: true,
          ready: false,
          needsWizard: false,
          hostOs: { platform: "linux", label: "Linux" },
          qemuInstall: {
            method: "apt",
            displayCommand: "",
            canInstall: false,
            packages: [],
            manualHint: "",
          },
        },
      },
      (action) => {
        actions.push(action);
      },
    );
    expect(host.querySelector("[data-testid='finish-setup-checklist']")).toBeTruthy();
    expect(host.textContent).toContain("Finish setup · Provider");
    expect(host.textContent).not.toContain("You skipped the wizard");
    expect(host.textContent).not.toContain("To do · Provider");
    expect(host.textContent).not.toContain("Optional · Docker");
    expect(host.textContent).not.toContain("Optional · VM desktop");
    expect(host.textContent).not.toContain("Optional · GitHub token");
    expect(host.textContent).not.toContain("Use Host instead");
    expect(host.querySelectorAll(".setup-callout")).toHaveLength(0);
    act(() => {
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Continue")!.click();
    });
    expect(actions.some((action) => action.type === "setupOpen" && action.open)).toBe(true);
  });

  it("lets you dismiss the Finish setup hint", () => {
    render({
      setup: {
        hypervisorKind: "mock",
        qemuFound: false,
        qemuHint: "",
        kvmLabel: "",
        linuxImageReady: false,
        dockerFound: false,
        hasProvider: false,
        hasGoldenImage: false,
        setupCompleted: true,
        ready: false,
        needsWizard: false,
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
    expect(host.querySelector("[data-testid='finish-setup-checklist']")).toBeTruthy();
    act(() => {
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Dismiss")!.click();
    });
    expect(host.querySelector("[data-testid='finish-setup-checklist']")).toBeNull();
    expect(window.localStorage.getItem(FINISH_SETUP_DISMISSED_KEY)).toBe("1");
    expect(host.textContent).not.toContain("No provider key is enabled");
    expect(host.textContent).not.toContain("Add a GitHub token");
    const dockerTab = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Docker",
    );
    act(() => {
      dockerTab!.click();
    });
    expect(host.textContent).toContain("Agents cannot run on a mock engine");
  });

  it("blocks Create agent on a mock hypervisor for VM runtime", () => {
    const actions: Action[] = [];
    render({}, (action) => {
      actions.push(action);
    });
    const vmTab = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "VM");
    act(() => {
      vmTab!.click();
    });
    expect(host.textContent).toContain("VM agents cannot run on a mock hypervisor");
    expect(host.textContent).not.toContain("Using a mock hypervisor until QEMU");
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Create agent",
    ) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    const install = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Install QEMU",
    );
    expect(install).toBeTruthy();
    act(() => {
      install!.click();
    });
    expect(actions.some((action) => action.type === "setupOpen" && action.open)).toBe(true);
  });

  it("still creates on a worker when local Docker is mock", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue(created);
    render({
      config: {
        ...config,
        workers: [{ id: "w1", name: "Studio PC", url: "http://192.168.1.8:7421" }],
      },
    });
    const dockerTab = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Docker",
    );
    act(() => {
      dockerTab!.click();
    });
    expect(host.textContent).toContain("Agents cannot run on a mock engine");
    const where = [...host.querySelectorAll("button")].find(
      (btn) => btn.getAttribute("data-worker-id") === "w1",
    ) as HTMLButtonElement;
    act(() => {
      where.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).not.toContain("Agents cannot run on a mock engine");
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Create agent",
    ) as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    await act(async () => {
      create.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        placement: "worker",
        backendId: "w1",
        runtime: "docker",
      }),
    );
  });
});

describe("EmptyState worker placement", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    window.localStorage.removeItem("locus.lastAgent");
    act(() => root.unmount());
    host.remove();
  });

  it("sends placement worker when a LAN worker is selected", async () => {
    window.localStorage.removeItem("locus.lastAgent");
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue(created);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              config: {
                ...config,
                workers: [{ id: "w1", name: "Studio PC", url: "http://192.168.1.8:7421" }],
              },
            },
            dispatch: () => undefined,
          }}
        >
          <EmptyState />
        </Store.Provider>,
      );
    });
    expect(host.textContent).toContain("This machine");
    expect(host.textContent).toContain("Studio PC");
    const where = [...host.querySelectorAll("button")].find(
      (btn) => btn.getAttribute("data-worker-id") === "w1",
    ) as HTMLButtonElement | undefined;
    act(() => {
      where!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).toContain("The host workspace runs on Studio PC");
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Start chat",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        placement: "worker",
        backendId: "w1",
        runtime: "host",
      }),
    );
  });

  it("does not attach a remembered Docker worker to the Host default", async () => {
    window.localStorage.setItem(
      "locus.lastAgent",
      JSON.stringify({
        os: "ubuntu",
        runtime: "docker",
        placement: "worker",
        backendId: "w1",
        dockerImage: "locus/agent",
      }),
    );
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue({ ...created, runtime: "host" });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              config: {
                ...config,
                workers: [{ id: "w1", name: "Studio PC", url: "http://192.168.1.8:7421" }],
              },
            },
            dispatch: () => undefined,
          }}
        >
          <EmptyState />
        </Store.Provider>,
      );
    });
    expect(
      host.querySelector('[aria-label="Agent runtime"] [aria-selected="true"]')?.textContent,
    ).toBe("Host");
    expect(host.textContent).not.toContain("The host workspace runs on Studio PC");
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Start chat",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "host",
        startVm: false,
      }),
    );
    expect(vi.mocked(api.createSession).mock.calls.at(-1)?.[0]).not.toMatchObject({
      placement: "worker",
    });
    expect(vi.mocked(api.createSession).mock.calls.at(-1)?.[0].backendId).toBeUndefined();
  });

  it("restores a remembered worker when switching Host default to Docker", async () => {
    window.localStorage.setItem(
      "locus.lastAgent",
      JSON.stringify({
        os: "ubuntu",
        runtime: "docker",
        placement: "worker",
        backendId: "w1",
        dockerImage: "locus/agent",
      }),
    );
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue(created);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              dockerKind: "docker",
              config: {
                ...config,
                workers: [{ id: "w1", name: "Studio PC", url: "http://192.168.1.8:7421" }],
              },
            },
            dispatch: () => undefined,
          }}
        >
          <EmptyState />
        </Store.Provider>,
      );
    });
    const dockerTab = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Docker",
    ) as HTMLButtonElement;
    act(() => {
      dockerTab.click();
    });
    expect(host.textContent).toContain("The container runs on Studio PC");
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Create agent",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        placement: "worker",
        backendId: "w1",
        runtime: "docker",
        startVm: true,
      }),
    );
  });

  it("keeps a remembered Host worker on the Host default", async () => {
    window.localStorage.setItem(
      "locus.lastAgent",
      JSON.stringify({
        os: "ubuntu",
        runtime: "host",
        placement: "worker",
        backendId: "w1",
      }),
    );
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue({ ...created, runtime: "host" });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              config: {
                ...config,
                workers: [{ id: "w1", name: "Studio PC", url: "http://192.168.1.8:7421" }],
              },
            },
            dispatch: () => undefined,
          }}
        >
          <EmptyState />
        </Store.Provider>,
      );
    });
    expect(host.textContent).toContain("The host workspace runs on Studio PC");
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Start chat",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        placement: "worker",
        backendId: "w1",
        runtime: "host",
        startVm: true,
      }),
    );
  });

  it("labels a cloud worker and mentions destroy-on-stop", () => {
    window.localStorage.removeItem("locus.lastAgent");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              config: {
                ...config,
                workers: [
                  {
                    id: "c1",
                    name: "Box",
                    url: "https://10.0.0.8:7421",
                    kind: "cloud",
                  },
                ],
              },
            },
            dispatch: () => undefined,
          }}
        >
          <EmptyState />
        </Store.Provider>,
      );
    });
    const where = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Box · cloud",
    ) as HTMLButtonElement | undefined;
    expect(where).toBeTruthy();
    act(() => {
      where!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).toContain("The host workspace runs on Box · cloud");
    expect(host.textContent).toContain("Stop destroys the guest");
  });
});

describe("New agent entry", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("replaces the open agent with the first-run composer instead of a modal", () => {
    window.localStorage.removeItem("locus.lastAgent");
    let state: UiState = {
      ...initialState,
      config,
      selectedId: created.id,
      sessions: [created],
    };

    function AppSlice() {
      return (
        <Store.Provider
          value={{
            state,
            dispatch: (action) => {
              state = reducer(state, action);
              act(() => {
                root.render(<AppSlice />);
              });
            },
          }}
        >
          <Sidebar />
          {state.sessions.find((s) => s.id === state.selectedId) ? (
            <p className="open-agent">{created.title}</p>
          ) : (
            <EmptyState />
          )}
          <NewSessionModal />
        </Store.Provider>
      );
    }

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<AppSlice />);
    });
    expect(host.querySelector(".open-agent")?.textContent).toBe("Review");
    expect(host.querySelector(".empty-card")).toBeNull();

    act(() => {
      (host.querySelector("[aria-label='New agent']") as HTMLButtonElement).click();
    });
    expect(host.querySelector(".open-agent")).toBeNull();
    expect(host.querySelector(".empty.agent-start")).toBeTruthy();
    expect(host.querySelector(".eyebrow")).toBeNull();
    expect(host.querySelector(".empty-card")).toBeTruthy();
    expect(host.querySelector(".empty-card h2")?.textContent).toBe("What should we talk about?");
    expect(
      host.querySelector('[aria-label="Agent runtime"] [aria-selected="true"]')?.textContent,
    ).toBe("Host");
    expect(host.querySelector(".session-item[title='Review']")).toBeTruthy();
    expect(host.querySelector(".modal")).toBeNull();
    expect(host.textContent).not.toContain("New agent machine");
  });
});

describe("EmptyState named environment", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    window.localStorage.removeItem("locus.lastAgent");
    window.localStorage.removeItem(FINISH_SETUP_DISMISSED_KEY);
    act(() => root.unmount());
    host.remove();
  });

  it("keeps jail, spend, and named environments off the quick composer", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider value={{ state: { ...initialState, config }, dispatch: () => undefined }}>
          <EmptyState />
        </Store.Provider>,
      );
    });
    expect(host.querySelector('[aria-label="Named environment"]')).toBeNull();
    expect(host.querySelector('[aria-label="Jail"]')).toBeNull();
    expect(host.querySelector('[aria-label="Spend cap (USD)"]')).toBeNull();
    expect(host.querySelector("[data-testid='composer-more-options']")).toBeNull();
    expect(host.textContent).not.toMatch(
      /Jail, spend cap, and named environments are in More options/,
    );
    expect(host.querySelector("[data-testid='launch-workspace']")).not.toBeNull();

    const more = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "More options",
    );
    act(() => {
      more!.click();
    });
    expect(host.querySelector("[data-testid='composer-more-options']")).not.toBeNull();
    expect(host.querySelector('[aria-label="Jail"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Spend cap (USD)"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Named environment"]')).not.toBeNull();
    expect(
      [...host.querySelectorAll("button")].some((btn) => btn.textContent === "Full form"),
    ).toBe(true);
  });

  it("applies a docker named environment from the launch workspace picker", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue({
      ...created,
      runtime: "docker",
      status: "provisioning",
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const envConfig: LocusConfig = {
      ...config,
      namedEnvironments: [
        {
          id: "env-1",
          name: "restricted-oncall",
          runtime: "docker",
          os: "ubuntu",
          dockerImage: "locus/agent",
          network: "restricted",
          maxUsd: 20,
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
        },
      ],
    };
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, config: envConfig, dockerKind: "docker" },
            dispatch: () => undefined,
          }}
        >
          <EmptyState />
        </Store.Provider>,
      );
    });
    act(() => {
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Docker")!.click();
    });
    act(() => {
      host
        .querySelector("[data-testid='launch-workspace-toggle']")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      host
        .querySelector("[data-testid='launch-workspace-option-env:env-1']")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Create agent",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "docker",
        dockerImage: "locus/agent:0.1",
        network: "restricted",
        maxUsd: 20,
      }),
    );
  });

  it("applies jail, spend, recipe, and Where from a named environment", async () => {
    vi.mocked(api.createSession).mockResolvedValue(created);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const envConfig: LocusConfig = {
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
    };
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, config: envConfig, newOpen: true, dockerKind: "docker" },
            dispatch: () => undefined,
          }}
        >
          <NewSessionModal />
        </Store.Provider>,
      );
    });
    expect(host.querySelector('[aria-label="Named environment"]')).toBeTruthy();
    expect(host.textContent).toContain("Save as environment");
    act(() => {
      setSelectValue(host, "Named environment", "env-1");
    });
    expect(selectValue(host, "Jail")).toBe("restricted");
    expect((host.querySelector('[aria-label="Spend cap (USD)"]') as HTMLInputElement).value).toBe(
      "20",
    );
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Create agent",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "docker",
        dockerImage: "locus/agent:0.1",
        network: "restricted",
        maxUsd: 20,
      }),
    );
  });

  it("Save as environment with a new name does not overwrite the selected box", async () => {
    vi.mocked(api.saveConfig).mockClear();
    vi.mocked(api.saveConfig).mockImplementation(async (next) => next);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const envConfig: LocusConfig = {
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
    };
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, config: envConfig, newOpen: true, dockerKind: "docker" },
            dispatch: () => undefined,
          }}
        >
          <NewSessionModal />
        </Store.Provider>,
      );
    });
    act(() => {
      setSelectValue(host, "Named environment", "env-1");
    });
    act(() => {
      [...host.querySelectorAll("button")]
        .find((btn) => btn.textContent === "Save as environment")!
        .click();
    });
    const name = host.querySelector('[aria-label="Environment name"]') as HTMLInputElement;
    expect(name).toBeTruthy();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        name,
        "staging-qa",
      );
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host
        .querySelector(".env-picker-save")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.saveConfig).toHaveBeenCalled();
    const saved = vi.mocked(api.saveConfig).mock.calls.at(-1)?.[0];
    expect(saved?.namedEnvironments?.map((row) => row.name)).toEqual([
      "restricted-oncall",
      "staging-qa",
    ]);
    expect(saved?.namedEnvironments?.[0]?.id).toBe("env-1");
    expect(saved?.namedEnvironments?.[1]?.id).not.toBe("env-1");
  });
});

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

describe("create screen width", () => {
  it("keeps the new-agent launch column at the mock width", () => {
    expect(css).toMatch(/\.empty\.agent-start \.empty-card \{\s*width:\s*min\(760px,\s*100%\);/);
    expect(css).toMatch(/\.empty\.design-start \.empty-card \{\s*width:\s*min\(760px,\s*100%\);/);
  });

  it("keeps empty composers from wrapping toolbar extras onto a second line", () => {
    expect(css).toMatch(
      /\.empty\.agent-start \.empty-composer-bar,\s*\.empty\.design-start \.empty-composer-bar \{\s*justify-content:\s*flex-start;\s*flex-wrap:\s*nowrap;/,
    );
    expect(css).toMatch(/\.model-picker\.compact \{[\s\S]*?flex-wrap:\s*nowrap;/);
  });
});
