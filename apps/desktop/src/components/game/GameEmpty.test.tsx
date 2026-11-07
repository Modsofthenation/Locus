import { GAME_RECIPES, type AgentSession, type LocusConfig } from "@locus/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEmpty } from "./GameEmpty";
import { api } from "@/lib/api";
import { Store, initialState } from "@/state/store";

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
  id: "g1",
  title: "Arcade",
  os: "ubuntu",
  kind: "game",
  runtime: "docker",
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

describe("GameEmpty", () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.removeItem("locus.lastAgent");
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.localStorage.removeItem("locus.lastAgent");
  });

  it("creates a game session from the Arcade starter", async () => {
    vi.mocked(api.createSession).mockResolvedValue(created);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, config, section: "games" },
            dispatch: () => undefined,
          }}
        >
          <GameEmpty />
        </Store.Provider>,
      );
    });
    expect(host.textContent).toMatch(/What should we play/);
    expect(host.querySelector("[aria-label='New game']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Look']")).toBeNull();
    expect(host.querySelector("[aria-label='Color palette']")).toBeNull();
    expect(host.querySelector("[aria-label='Style']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Game style']")).toBeTruthy();
    expect(host.textContent).toContain("Arcade");
    expect(host.textContent).toContain("Twin-stick");
    expect(host.textContent).toContain("Match-3");
    expect(host.textContent).toContain("Trivia");
    expect(host.textContent).toContain("Tower defense");
    expect(host.textContent).toContain("Racing");
    expect(host.textContent).toContain("Maze");
    expect(host.textContent).toContain("Juice");
    expect(host.textContent).toContain("Speedrun");
    expect(host.textContent).toContain("Roguelike");
    expect(host.textContent).toContain("Endless drive");
    expect(host.textContent).toContain("Vegas match-3");
    expect(host.querySelector("[aria-label='Game shape']")).toBeTruthy();
    expect(host.textContent).toContain("2D");
    expect(host.textContent).toContain("3D");
    expect(host.textContent).toContain("Hotseat");
    expect(host.querySelector("[aria-label='Game kit']")).toBeTruthy();
    expect(host.textContent).toContain("Pixel pack");
    expect(
      host.querySelector('[aria-label="Agent runtime"] [aria-selected="true"]')?.textContent,
    ).toBe("Docker");
    const kit = host.querySelector("[aria-label='Game kit']") as HTMLSelectElement;
    act(() => {
      kit.value = "pixel-pack";
      kit.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const arcade = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Arcade"),
    );
    act(() => {
      arcade!.click();
    });
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.getAttribute("aria-label") === "Create game",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "game",
        runtime: "docker",
        title: "Arcade",
        designSystemId: "pixel-pack",
        playbook: GAME_RECIPES[0]?.playbook,
        allowedTools: GAME_RECIPES[0]?.allowedTools,
      }),
    );
    expect(vi.mocked(api.createSession).mock.calls[0]?.[0]).not.toHaveProperty("palette");
  });

  it("sets the Three kit from the 3D chip and appends hotseat to the prompt", async () => {
    vi.mocked(api.createSession).mockResolvedValue(created);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, config, section: "games" },
            dispatch: () => undefined,
          }}
        >
          <GameEmpty />
        </Store.Provider>,
      );
    });
    const three = [...host.querySelectorAll("[aria-label='Game shape'] button")].find(
      (btn) => btn.textContent === "3D",
    ) as HTMLButtonElement | undefined;
    const seat = [...host.querySelectorAll("[aria-label='Game shape'] button")].find(
      (btn) => btn.textContent === "Hotseat",
    ) as HTMLButtonElement | undefined;
    act(() => {
      three!.click();
      seat!.click();
    });
    expect((host.querySelector("[aria-label='Game kit']") as HTMLSelectElement).value).toBe(
      "three-starter",
    );
    const remix = [...host.querySelectorAll("[aria-label='Remix a sentence'] button")].find(
      (btn) => btn.textContent === "Vegas match-3",
    ) as HTMLButtonElement | undefined;
    act(() => {
      remix!.click();
    });
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.getAttribute("aria-label") === "Create game",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "game",
        designSystemId: "three-starter",
        prompt: expect.stringMatching(/hotseat/i),
      }),
    );
    expect(vi.mocked(api.createSession).mock.calls[0]?.[0].prompt).toMatch(/casino icons/);
  });

  it("lets the composer reference an existing Assets studio", async () => {
    vi.mocked(api.createSession).mockResolvedValue(created);
    const asset = {
      ...created,
      id: "as1",
      title: "Hero mesh",
      kind: "assets",
    } as AgentSession;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, config, section: "games", sessions: [asset] },
            dispatch: () => undefined,
          }}
        >
          <GameEmpty />
        </Store.Provider>,
      );
    });
    expect(host.querySelector("[aria-label='Assets']")).toBeTruthy();
    expect(host.textContent).toContain("No asset");
    act(() => {
      (host.querySelector("[aria-label='Assets']") as HTMLButtonElement).click();
    });
    const option = [...host.querySelectorAll("[role='option']")].find((row) =>
      row.textContent?.includes("Hero mesh"),
    );
    expect(option?.querySelector("[data-testid='asset-preview']")?.getAttribute("src")).toBe(
      "/api/sessions/as1/canvas-files/source.png",
    );
    act(() => {
      (option as HTMLButtonElement).click();
    });
    expect(
      host.querySelector(".composer-repo-chip [data-testid='asset-preview']")?.getAttribute("src"),
    ).toBe("/api/sessions/as1/canvas-files/source.png");
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.getAttribute("aria-label") === "Create game",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "game",
        assetIds: ["as1"],
      }),
    );
  });

  it("inserts an @asset mention from the game composer", async () => {
    vi.mocked(api.createSession).mockResolvedValue(created);
    const asset = {
      ...created,
      id: "as1",
      title: "Hero mesh",
      kind: "assets",
    } as AgentSession;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, config, section: "games", sessions: [asset] },
            dispatch: () => undefined,
          }}
        >
          <GameEmpty />
        </Store.Provider>,
      );
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "@");
      textarea.selectionStart = textarea.selectionEnd = 1;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const menu = host.querySelector("[data-testid='asset-mention-menu']");
    expect(menu).toBeTruthy();
    expect(menu?.textContent).toContain("@asset:hero-mesh");
    expect(menu?.querySelector("[data-testid='asset-preview']")?.getAttribute("src")).toBe(
      "/api/sessions/as1/canvas-files/source.png",
    );
    act(() => {
      (menu!.querySelector("button") as HTMLButtonElement).click();
    });
    expect(textarea.value).toBe("@asset:hero-mesh ");
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.getAttribute("aria-label") === "Create game",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "game",
        assetIds: ["as1"],
        prompt: "@asset:hero-mesh",
      }),
    );
  });
});
