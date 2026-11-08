import {
  DESIGN_RECIPES,
  UBUNTU_DEFAULT_HARDWARE,
  builtinDesignSystems,
  DEFAULT_DESIGN_TYPOGRAPHY,
  defaultNetworking,
  type AgentSession,
  type DesignSystem,
  type LinkedRepo,
  type LocusConfig,
} from "@locus/shared";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignEmpty } from "./DesignEmpty";
import { api } from "@/lib/api";
import { Store, initialState, type Action } from "@/state/store";
import { selectValue, setSelectValue } from "@/lib/selectControl";

vi.mock("@/lib/api", () => ({
  api: {
    workersStatus: vi.fn(async () => []),
    createSession: vi.fn(),
    chat: vi.fn(),
    repoBranches: vi.fn(async () => ({ branches: ["main", "feat"], defaultBranch: "main" })),
  },
}));

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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  id: "d1",
  title: "Landing page",
  kind: "design",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  runtime: "docker",
  dockerImage: "ubuntu:24.04",
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

describe("DesignEmpty", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.removeItem("locus.lastAgent");
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.localStorage.removeItem("locus.lastAgent");
  });

  function render(
    dispatch: (action: Action) => void = () => undefined,
    extra: Partial<typeof initialState> = {},
  ) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider
        value={{ state: { ...initialState, config, section: "design", ...extra }, dispatch }}
      >
        <DesignEmpty />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
  }

  function openLook() {
    act(() => {
      (host.querySelector('[aria-label="Look"]') as HTMLElement).click();
    });
  }

  it("prefills a landing-page recipe and creates a design session", async () => {
    vi.mocked(api.createSession).mockResolvedValue(created);
    vi.mocked(api.chat).mockResolvedValue({ ok: true });
    render();
    expect(host.querySelector(".empty.design-start")).toBeTruthy();
    expect(host.querySelector(".eyebrow")).toBeNull();
    expect(host.querySelector(".empty-hero h2")?.textContent).toBe("What should we design?");
    expect(host.querySelector("[data-testid='locus-mascot']")?.getAttribute("data-pose")).toBe(
      "idle",
    );
    expect(
      host.querySelector('[aria-label="Agent runtime"] [aria-selected="true"]')?.textContent,
    ).toBe("Docker");
    expect(host.querySelector("[data-testid='launch-workspace']")).toBeTruthy();
    expect(host.textContent).toContain("Landing page");
    expect(host.textContent).toContain("Slide deck");
    expect(host.textContent).toContain("Or start from");
    expect(host.querySelector(".recipe-grid.pills")).toBeTruthy();
    expect(host.querySelector(".recipe-grid.pills kbd")?.textContent).toBe("L");
    expect(host.querySelector(".recipe-tile")).toBeNull();
    expect(host.querySelector("[aria-label='Look']")).toBeTruthy();
    openLook();
    expect(host.querySelector("[aria-label='Color palette']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Design system']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Repository']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Assets']")).toBeNull();
    expect(host.querySelector(".composer-repo-placeholder")?.textContent).toBe("No repo context");
    expect(host.querySelector(".palette-presets")).toBeNull();
    act(() => {
      (host.querySelector(".palette-swatch-row") as HTMLButtonElement).click();
    });
    expect(host.textContent).toContain("Ink");
    const landing = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Landing page"),
    );
    act(() => {
      landing!.click();
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.value).toContain("marketing landing page");
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.getAttribute("aria-label") === "Create design",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "design",
        runtime: "docker",
        title: "Landing page",
        playbook: DESIGN_RECIPES[0]?.playbook,
        allowedTools: DESIGN_RECIPES[0]?.allowedTools,
        palette: expect.objectContaining({ primary: expect.stringMatching(/^#/) }),
        prompt: textarea.value,
      }),
    );
    expect(api.chat).not.toHaveBeenCalled();
  });

  it("already has a Landing page starter and does not duplicate a sample landing pill", () => {
    render();
    const landing = [...host.querySelectorAll(".recipe-grid.pills button")].filter((btn) =>
      btn.textContent?.includes("Landing page"),
    );
    expect(landing).toHaveLength(1);
    expect(host.textContent).not.toMatch(/Try a sample landing page/i);
  });

  it("attaches a linked repo when creating a design", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue(created);
    render(undefined, { repos: [linkedRepo] });
    const picker = host.querySelector("[aria-label='Repository']") as HTMLButtonElement;
    expect(picker.title).toMatch(/design context/i);
    expect(host.querySelector(".composer-repo-placeholder")?.textContent).toBe("No repo context");
    await pickComposerRepoBranch(host, "acme/app", "main");
    expect(host.querySelector(".composer-repo-chip-name")?.textContent).toBe("app");
    expect(host.querySelector(".composer-repo-chip-ref")?.textContent).toBe("main");
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.getAttribute("aria-label") === "Create design",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "design",
        repoId: "r1",
        repo: expect.objectContaining({
          url: "https://github.com/acme/app.git",
          ref: "main",
        }),
      }),
    );
  });

  it("checks out the selected branch from the design composer", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.repoBranches).mockClear();
    vi.mocked(api.repoBranches).mockResolvedValue({
      branches: ["main", "feat"],
      defaultBranch: "main",
    });
    vi.mocked(api.createSession).mockResolvedValue(created);
    render(undefined, { repos: [linkedRepo] });
    await pickComposerRepoBranch(host, "acme/app", "feat");
    expect(api.repoBranches).toHaveBeenCalledWith("r1");
    expect(host.querySelector(".composer-repo-chip-ref")?.textContent).toBe("feat");
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.getAttribute("aria-label") === "Create design",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "design",
        repoId: "r1",
        repo: expect.objectContaining({ ref: "feat" }),
      }),
    );
  });

  it("restores Host runtime from the last design session", () => {
    window.localStorage.setItem(
      "locus.lastAgent",
      JSON.stringify({
        os: "ubuntu",
        runtime: "host",
        hostDir: "/tmp/design-project",
      }),
    );
    render();
    expect(
      host.querySelector('[aria-label="Agent runtime"] [aria-selected="true"]')?.textContent,
    ).toBe("Host");
    expect(host.querySelector("[data-testid='launch-workspace']")?.textContent).toContain(
      "/tmp/design-project",
    );
  });

  it("creates a host design session from the runtime toggle", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue({
      ...created,
      runtime: "host",
      dockerImage: undefined,
      status: "idle",
    });
    render();
    act(() => {
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Host")!.click();
    });
    expect(
      host.querySelector('[aria-label="Agent runtime"] [aria-selected="true"]')?.textContent,
    ).toBe("Host");
    expect(host.querySelector("[data-testid='launch-workspace']")?.textContent).toMatch(
      /Private folder|Workspace/,
    );
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.getAttribute("aria-label") === "Create design",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "design",
        runtime: "host",
        startVm: false,
      }),
    );
    expect(vi.mocked(api.createSession).mock.calls.at(-1)?.[0]?.dockerImage).toBeFalsy();
  });

  it("sends placement worker when a LAN worker is selected", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue(created);
    render(undefined, {
      config: {
        ...config,
        workers: [{ id: "w1", name: "Studio PC", url: "http://192.168.1.8:7421" }],
      },
    });
    expect(host.textContent).toContain("This machine");
    expect(host.textContent).toContain("Studio PC");
    const where = [...host.querySelectorAll("button")].find(
      (btn) => btn.getAttribute("data-worker-id") === "w1",
    );
    expect(where).toBeTruthy();
    act(() => {
      where!.click();
    });
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.getAttribute("aria-label") === "Create design",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "design",
        runtime: "docker",
        placement: "worker",
        backendId: "w1",
      }),
    );
  });

  it("applies a starter from its shortcut when the prompt is not focused", () => {
    render();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain(
      "marketing landing page",
    );
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      textarea.focus();
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    });
    expect(textarea.value).toContain("marketing landing page");
    expect(textarea.value).not.toContain("product dashboard");
  });

  it("keeps a chosen design system when the catalog refreshes", async () => {
    const starters = builtinDesignSystems();
    const first = starters[0]!;
    const second = starters[1]!;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const state = { ...initialState, config, section: "design" as const };
    await act(async () => {
      root.render(
        <Store.Provider value={{ state, dispatch: () => undefined }}>
          <DesignEmpty />
        </Store.Provider>,
      );
    });
    act(() => {
      (host.querySelector('[aria-label="Look"]') as HTMLElement).click();
    });
    act(() => {
      setSelectValue(host, "Design system", second.id);
    });
    expect(selectValue(host, "Design system")).toBe(second.id);
    await act(async () => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...state,
              designSystems: [{ ...first, id: "stored-ink", name: "Stored" }],
            },
            dispatch: () => undefined,
          }}
        >
          <DesignEmpty />
        </Store.Provider>,
      );
    });
    act(() => {
      (host.querySelector('[aria-label="Look"]') as HTMLElement).click();
    });
    expect(selectValue(host, "Design system")).toBe(second.id);
  });

  it("surfaces kit starting points next to Landing / Dashboard", async () => {
    const kit: DesignSystem = {
      ...builtinDesignSystems()[0]!,
      id: "kit-frontyard",
      name: "Frontyard",
      kit: { fileCount: 8, bytes: 1200 },
      startingPoints: [
        { id: "open-tickets", title: "Open tickets", kind: "start" },
        { id: "hero", title: "Hero", kind: "ui_kit" },
      ],
      typography: { ...DEFAULT_DESIGN_TYPOGRAPHY },
    };
    vi.mocked(api.createSession).mockResolvedValue(created);
    render(undefined, {
      designSystems: [kit],
      config: { ...config, defaultDesignSystemId: kit.id },
    });
    expect(host.querySelector("[aria-label='Kit starting points']")).toBeTruthy();
    const tickets = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Open tickets"),
    );
    expect(tickets).toBeTruthy();
    act(() => {
      tickets!.click();
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.value).toContain("Open tickets");
    expect(textarea.value).toContain("do not invent a generic landing page");
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.getAttribute("aria-label") === "Create design",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "design",
        title: "Open tickets",
        prompt: textarea.value,
      }),
    );
  });

  it("keeps model and Send on the composer footer", () => {
    render();
    const composer = host.querySelector(".empty-composer") as HTMLDivElement;
    const textarea = composer.querySelector("textarea") as HTMLTextAreaElement;
    const bar = composer.querySelector(".empty-composer-bar") as HTMLDivElement;
    expect(textarea.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar.querySelector("[aria-label='Look']")).toBeTruthy();
    expect(bar.querySelector(".composer-toolbar-end .model-picker")).toBeTruthy();
    expect(bar.querySelector(".composer-toolbar-end .composer-send")).toBeTruthy();
    expect(bar.querySelector(".composer-send-label")?.textContent).toBe("Send");
  });

  it("attaches a pasted image on the new-design composer", async () => {
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.createSession).mockResolvedValue(created);
    if (typeof URL.createObjectURL !== "function") {
      URL.createObjectURL = () => "blob:clip";
      URL.revokeObjectURL = () => undefined;
    }
    render();
    expect(host.querySelector("button.composer-add")).toBeTruthy();
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
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.getAttribute("aria-label") === "Create design",
    );
    await act(async () => {
      create!.click();
      await vi.waitFor(() => {
        expect(api.createSession).toHaveBeenCalled();
      });
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "design",
        attachments: [expect.objectContaining({ name: "clip.png", mime: "image/png" })],
      }),
    );
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
});

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

describe("design Where label", () => {
  it("centers Where above This machine on the design start screen", () => {
    expect(css).toMatch(
      /\.empty\.design-start \.where-picker,\s*\.empty\.design-start \.launch-env-bar \.where-picker \{\s*align-items:\s*center;/,
    );
    expect(css).toMatch(
      /\.empty\.design-start \.where-label,\s*\.empty\.design-start \.launch-env-bar \.where-label \{\s*text-align:\s*center;/,
    );
  });
});
