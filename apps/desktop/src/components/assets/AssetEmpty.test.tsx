import { ASSET_RECIPES, type AgentSession, type LocusConfig } from "@locus/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetEmpty } from "./AssetEmpty";
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
  id: "a1",
  title: "Image to 3D",
  os: "ubuntu",
  kind: "assets",
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

describe("AssetEmpty", () => {
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

  it("creates an assets session from the Image to 3D starter", async () => {
    vi.mocked(api.createSession).mockResolvedValue(created);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, config, section: "assets" },
            dispatch: () => undefined,
          }}
        >
          <AssetEmpty />
        </Store.Provider>,
      );
    });
    expect(host.textContent).toMatch(/Drop a photo to reconstruct/);
    expect(host.querySelector("[aria-label='Source photos']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Front']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Side']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Back']")).toBeTruthy();
    expect(host.querySelector("[aria-label='New asset']")).toBeTruthy();
    expect(host.textContent).not.toMatch(/Choose Host or Docker/);
    expect(host.querySelector("[data-testid='launch-workspace-toggle']")).toBeNull();
    expect(host.querySelector("[aria-label='Look']")).toBeNull();
    expect(host.querySelector("[aria-label='Color palette']")).toBeNull();
    expect(host.querySelector("[aria-label='Style']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Asset style']")).toBeTruthy();
    expect(host.textContent).toContain("Image to 3D");
    expect(host.textContent).toContain("Rig");
    expect(host.textContent).toContain("Walk cycle");
    expect(host.textContent).toContain("Hold");
    expect(host.textContent).toContain("Attacks");
    expect(host.querySelector("[aria-label='Build']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Build settings']")).toBeTruthy();
    expect(host.textContent).toContain("Smart topology");
    expect(host.textContent).toContain("Flagship");
    expect(host.textContent).toContain("Ultra 4x");
    expect(host.textContent).toContain("A-Pose");
    expect(host.textContent).toContain("Printability");
    expect(host.querySelector("[aria-label='Asset kit']")).toBeTruthy();
    expect(host.textContent).toContain("Sprite pack");
    const kit = host.querySelector("[aria-label='Asset kit']") as HTMLSelectElement;
    act(() => {
      kit.value = "rig-kit";
      kit.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const starter = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Image to 3D"),
    );
    act(() => {
      starter!.click();
    });
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.getAttribute("aria-label") === "Create asset",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "assets",
        runtime: "docker",
        title: "Image to 3D",
        designSystemId: "rig-kit",
        playbook: ASSET_RECIPES[0]?.playbook,
        allowedTools: ASSET_RECIPES[0]?.allowedTools,
        assetBuild: {
          topology: "smart",
          quality: "standard",
          resolution: "standard",
          restPose: "a-pose",
          polyBudget: "8k",
          texture: true,
          split: false,
          multiView: false,
          enhance: true,
          printable: false,
        },
      }),
    );
    expect(vi.mocked(api.createSession).mock.calls[0]?.[0]).not.toHaveProperty("palette");
  });

  it("hides 3D-only build knobs on a Cutout starter", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, config, section: "assets" },
            dispatch: () => undefined,
          }}
        >
          <AssetEmpty />
        </Store.Provider>,
      );
    });
    const cutout = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Cutout"),
    );
    act(() => {
      cutout!.click();
    });
    expect(host.textContent).toContain("Smart topology");
    expect(host.textContent).toContain("Texture");
    expect(host.textContent).not.toContain("A-Pose");
    expect(host.textContent).not.toContain("Printability");
    expect(host.textContent).not.toContain("8k faces");
  });

  it("applies a saved asset style when creating a studio", async () => {
    vi.mocked(api.createSession).mockResolvedValue(created);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const style = {
      id: "st1",
      name: "Clay hero",
      summary: "Chunky terracotta",
      guidelines: "Rounded silhouettes.",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, config, section: "assets", assetStyles: [style] },
            dispatch: () => undefined,
          }}
        >
          <AssetEmpty />
        </Store.Provider>,
      );
    });
    const picker = host.querySelector("[aria-label='Asset style']") as HTMLSelectElement;
    expect(picker).toBeTruthy();
    expect(picker.textContent).toContain("Clay hero");
    act(() => {
      picker.value = "st1";
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const starter = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Image to 3D"),
    );
    act(() => {
      starter!.click();
    });
    const create = [...host.querySelectorAll("button")].find(
      (btn) => btn.getAttribute("aria-label") === "Create asset",
    );
    await act(async () => {
      create!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "assets",
        assetStyleId: "st1",
      }),
    );
  });
});
