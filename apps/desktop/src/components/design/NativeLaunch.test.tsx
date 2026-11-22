import type { AgentSession, LocusConfig } from "@locus/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEmpty } from "@/components/game/GameEmpty";
import { AssetEmpty } from "@/components/assets/AssetEmpty";
import { api } from "@/lib/api";
import { Store, initialState, type UiSection } from "@/state/store";

vi.mock("@/lib/api", () => ({
  api: {
    workersStatus: vi.fn(async () => []),
    createSession: vi.fn(),
    chat: vi.fn(),
    repoBranches: vi.fn(async () => ({ branches: ["main"], defaultBranch: "main" })),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const created = {
  id: "n1",
  title: "Project",
  os: "ubuntu",
  kind: "agent",
  runtime: "host",
  templateId: "t1",
  providerId: "p1",
  model: "mock",
  status: "idle",
  messages: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as AgentSession;

const config = {
  providers: [{ id: "p1", kind: "openai", defaultModel: "mock", models: ["mock"] }],
  templates: [{ id: "t1", os: "ubuntu" }],
  workers: [],
} as unknown as LocusConfig;

const LAST_AGENT = "locus.lastAgent";

function target(id: string) {
  return document.querySelector(`.launch-target-option[data-target='${id}']`) as HTMLButtonElement;
}

function send() {
  return document.querySelector(".composer-send") as HTMLButtonElement;
}

function click(el: Element | null) {
  act(() => {
    (el as HTMLElement).click();
  });
}

function type(value: string) {
  const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("native engine launch (Games / Assets)", () => {
  let host: HTMLElement;
  let root: Root;

  function mount(section: UiSection, node: React.ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{ state: { ...initialState, config, section }, dispatch: () => undefined }}
        >
          {node}
        </Store.Provider>,
      );
    });
  }

  beforeEach(() => {
    window.localStorage.removeItem(LAST_AGENT);
    vi.mocked(api.createSession).mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.localStorage.removeItem(LAST_AGENT);
  });

  it("offers Web, Unity, Godot and Unreal as a single Build with choice", () => {
    mount("games", <GameEmpty />);
    const options = [...host.querySelectorAll(".launch-target-option")].map((el) =>
      el.getAttribute("data-target"),
    );
    expect(options).toEqual(["web", "unity", "godot", "unreal"]);
    expect(target("web").getAttribute("aria-checked")).toBe("true");
    // Web game keeps its shape chips; no native setup yet.
    expect(host.querySelector("[aria-label='Game shape']")).toBeTruthy();
    expect(host.querySelector("[data-testid='native-setup']")).toBeNull();
  });

  it("explains why Send is blocked until a Host folder is chosen", () => {
    mount("games", <GameEmpty />);
    click(target("unity"));
    expect(host.textContent).toMatch(/What should we build in Unity/);
    expect(host.querySelector("[aria-label='Game shape']")).toBeNull();
    expect(host.querySelector("[data-testid='native-setup']")).toBeTruthy();
    const blocker = host.querySelector("[data-testid='native-setup-blocker']");
    expect(blocker?.textContent).toMatch(/Choose a folder/);
    expect(send().disabled).toBe(true);
    expect(send().title).toBe(blocker?.textContent);
    // Kit / style / asset don't apply to a Unity project.
    expect(host.querySelector("[data-testid='composer-add-kit']")).toBeNull();
    expect(host.querySelector("[data-testid='composer-add-style']")).toBeNull();
    expect(host.querySelector("[data-testid='composer-add-asset']")).toBeNull();
  });

  it("creates a Unity agent session in the remembered Host folder", async () => {
    window.localStorage.setItem(
      LAST_AGENT,
      JSON.stringify({ runtime: "host", hostDir: "/home/me/games" }),
    );
    vi.mocked(api.createSession).mockResolvedValue(created);
    mount("games", <GameEmpty />);
    click(target("unity"));
    expect(host.querySelector("[data-testid='native-setup-blocker']")).toBeNull();
    expect(send().disabled).toBe(false);
    expect(send().getAttribute("aria-label")).toBe("Create Unity project");
    type("A marble maze");
    await act(async () => {
      send().click();
    });
    const body = vi.mocked(api.createSession).mock.calls[0]![0];
    expect(body.kind).toBe("agent");
    expect(body.runtime).toBe("host");
    expect(body.hostDir).toBe("/home/me/games");
    expect(body.playbook).toBe("LOCUS_UNITY_WORKFLOW");
    expect(body.prompt).toContain("CREATE NEW PROJECT");
    expect(body.prompt).toContain("User request: A marble maze");
    expect(body.designSystemId).toBeUndefined();
    expect(body.gameStyleId).toBeUndefined();
  });

  it("Godot starters follow the create / open choice and fill the prompt", () => {
    mount("games", <GameEmpty />);
    click(target("godot"));
    expect(host.querySelector("[aria-label='Godot starters']")?.textContent).toContain(
      "2D platformer",
    );
    const edit = [...host.querySelectorAll(".native-setup-actions button")].find(
      (el) => el.textContent === "Open existing",
    );
    click(edit!);
    expect(host.textContent).toContain("contains project.godot");
    const starter = [...host.querySelectorAll("[aria-label='Godot starters'] button")].find(
      (el) => el.textContent === "Fix import errors",
    );
    click(starter!);
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toMatch(
      /headless import/,
    );
  });

  it("creates an Unreal agent session with the Unreal workflow", async () => {
    window.localStorage.setItem(
      LAST_AGENT,
      JSON.stringify({ runtime: "host", hostDir: "/home/me/unreal" }),
    );
    vi.mocked(api.createSession).mockResolvedValue(created);
    mount("games", <GameEmpty />);
    click(target("unreal"));
    expect(host.textContent).toMatch(/What should we build in Unreal/);
    expect(send().getAttribute("aria-label")).toBe("Create Unreal project");
    type("A grappling hook prototype");
    await act(async () => {
      send().click();
    });
    const body = vi.mocked(api.createSession).mock.calls[0]![0];
    expect(body.runtime).toBe("host");
    expect(body.playbook).toBe("LOCUS_UNREAL_WORKFLOW");
    expect(body.prompt).toContain("LOCUS_UNREAL_WORKFLOW");
    expect(body.prompt).toContain("User request: A grappling hook prototype");
  });

  it("switching back to Web restores the previous runtime", () => {
    mount("games", <GameEmpty />);
    const runtimeBefore = host.querySelector(".runtime-toggle button.active")?.textContent;
    click(target("godot"));
    click(target("web"));
    expect(host.querySelector(".runtime-toggle button.active")?.textContent).toBe(runtimeBefore);
    expect(host.querySelector("[aria-label='Game shape']")).toBeTruthy();
  });

  it("Blender shows the Host folder picker without opening More options", async () => {
    window.localStorage.setItem(
      LAST_AGENT,
      JSON.stringify({ runtime: "host", hostDir: "/home/me/models" }),
    );
    vi.mocked(api.createSession).mockResolvedValue(created);
    mount("assets", <AssetEmpty />);
    expect(host.querySelector("[data-testid='launch-workspace']")).toBeNull();
    click(target("blender"));
    expect(host.querySelector("[data-testid='launch-workspace']")).toBeTruthy();
    expect(host.querySelector("[data-testid='launch-kicker-badge']")?.textContent).toBe(
      "Blender project folder",
    );
    await act(async () => {
      send().click();
    });
    const body = vi.mocked(api.createSession).mock.calls[0]![0];
    expect(body.playbook).toBe("LOCUS_BLENDER_WORKFLOW");
    expect(body.hostDir).toBe("/home/me/models");
    expect(body.assetBuild).toBeUndefined();
  });
});
