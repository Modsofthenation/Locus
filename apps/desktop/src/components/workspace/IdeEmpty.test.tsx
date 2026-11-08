import {
  UBUNTU_DEFAULT_HARDWARE,
  defaultNetworking,
  type AgentSession,
  type LinkedRepo,
  type LocusConfig,
} from "@locus/shared";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdeEmpty } from "./IdeEmpty";
import { api } from "@/lib/api";
import { Store, initialState, type Action } from "@/state/store";

vi.mock("@/lib/api", () => ({
  api: {
    createSession: vi.fn(),
    browseHost: vi.fn(),
    importRepos: vi.fn(),
    linkRepo: vi.fn(),
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
  forges: [
    {
      id: "gh",
      kind: "github",
      name: "GitHub",
      token: "ghp_test",
      apiBaseUrl: "https://api.github.com",
    },
  ],
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
  id: "h1",
  title: "app",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  runtime: "host",
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

describe("IdeEmpty", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.localStorage.removeItem("locus.lastAgent");
    window.localStorage.removeItem("locus.ideRecents");
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
        value={{ state: { ...initialState, config, section: "ide", ...extra }, dispatch }}
      >
        <IdeEmpty />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
  }

  it("shows the IDE home with mascot, Open folder, and Clone repo", () => {
    render();
    expect(host.querySelector("[data-testid='ide-start']")).toBeTruthy();
    expect(host.querySelector("[data-testid='locus-mascot']")).toBeTruthy();
    expect(host.querySelector(".empty-hero h2")?.textContent).toBe("IDE");
    expect(host.textContent).toContain("Open folder");
    expect(host.textContent).toContain("Clone repo");
    expect(host.querySelector("[data-testid='ide-clone-panel']")).toBeNull();
  });

  it("lists recent folders from local storage", () => {
    window.localStorage.setItem(
      "locus.ideRecents",
      JSON.stringify([{ path: "/tmp/recent-app", title: "recent-app", at: 1 }]),
    );
    render();
    expect(host.querySelector("[data-testid='ide-recents']")?.textContent).toContain("recent-app");
  });

  it("opens a browsed folder as a host workspace", async () => {
    const actions: Action[] = [];
    vi.mocked(api.browseHost).mockResolvedValue({
      path: "/home/me/src/app",
      parent: "/home/me/src",
      entries: [],
    });
    vi.mocked(api.createSession).mockResolvedValue({
      ...created,
      title: "app",
      hostDir: "/home/me/src/app",
    });
    render((action) => actions.push(action));
    const openFolder = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Open folder",
    );
    await act(async () => {
      openFolder!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const dialog = document.querySelector("[data-testid='host-folder-picker']") as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.querySelector("#host-folder-title")?.textContent).toBe("Open folder");
    expect((dialog.querySelector("[aria-label='Folder path']") as HTMLInputElement).value).toBe(
      "/home/me/src/app",
    );
    const use = [...dialog.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Open folder",
    );
    await act(async () => {
      use!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "app",
        kind: "ide",
        runtime: "host",
        startVm: false,
        vision: "off",
        hostDir: "/home/me/src/app",
      }),
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "session" }),
        { type: "select", id: "h1" },
      ]),
    );
  });

  it("clones a linked repo from current Git integrations", async () => {
    const actions: Action[] = [];
    vi.mocked(api.createSession).mockResolvedValue({
      ...created,
      title: "app",
      repoId: "r1",
    });
    render((action) => actions.push(action), { repos: [linkedRepo] });
    const clone = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Clone repo",
    );
    act(() => {
      clone!.click();
    });
    expect(host.querySelector("[data-testid='ide-clone-panel']")).toBeTruthy();
    expect(host.textContent).toContain("From your integrations");
    expect(host.textContent).toContain("acme/app");
    const repoBtn = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("acme/app"),
    );
    await act(async () => {
      repoBtn!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "ide",
        runtime: "host",
        startVm: false,
        repoId: "r1",
      }),
    );
    expect(actions).toContainEqual({ type: "select", id: "h1" });
  });

  it("clones a pasted repository URL into the host workspace", async () => {
    vi.mocked(api.createSession).mockResolvedValue(created);
    render();
    act(() => {
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Clone repo")!.click();
    });
    const url = host.querySelector("[aria-label='Repository URL']") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(url, "https://github.com/acme/web");
      url.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Clone");
    await act(async () => {
      submit!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "ide",
        runtime: "host",
        repo: {
          forge: "github",
          url: "https://github.com/acme/web.git",
        },
      }),
    );
  });

  it("imports GitHub repos from Clone repo into a searchable picker", async () => {
    vi.mocked(api.importRepos).mockResolvedValueOnce({
      accounts: [
        {
          accountId: "gh",
          accountName: "GitHub",
          kind: "github",
          repos: [
            {
              forge: "github",
              accountId: "gh",
              accountName: "GitHub",
              owner: "acme",
              name: "web",
              url: "https://github.com/acme/web.git",
              private: true,
            },
          ],
        },
      ],
    });
    vi.mocked(api.linkRepo).mockResolvedValue({
      ...linkedRepo,
      id: "r2",
      name: "acme/web",
      checkout: { forge: "github", url: "https://github.com/acme/web.git" },
    });
    const actions: Action[] = [];
    render((action) => actions.push(action));
    act(() => {
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Clone repo")!.click();
    });
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((btn) => btn.textContent === "Import from Git")!
        .click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='import-accounts']")).toBeTruthy();
    expect(host.querySelector("[aria-label='acme/web']")).toBeTruthy();
    expect(host.querySelector(".import-private")?.textContent).toMatch(/private/);
    act(() => {
      (host.querySelector("[aria-label='acme/web']") as HTMLInputElement).click();
    });
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((btn) => btn.textContent === "Link selected (1)")!
        .click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.linkRepo).toHaveBeenCalledWith({
      url: "https://github.com/acme/web.git",
      accountId: "gh",
    });
    expect(actions).toContainEqual(
      expect.objectContaining({ type: "repo", repo: expect.objectContaining({ id: "r2" }) }),
    );
  });
});
