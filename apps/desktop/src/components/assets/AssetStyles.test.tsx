import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, LocusConfig } from "@locus/shared";
import { AssetStylesModal } from "./AssetStyles";
import { api } from "@/lib/api";
import { Store, initialState, type Action, type UiState } from "@/state/store";
import { UBUNTU_DEFAULT_HARDWARE, defaultNetworking } from "@locus/shared";

vi.mock("@/lib/api", () => ({
  api: {
    createAssetStyle: vi.fn(),
    patchAssetStyle: vi.fn(),
    deleteAssetStyle: vi.fn(),
    setDefaultAssetStyle: vi.fn(),
    assetStyles: vi.fn(),
    patchSession: vi.fn(),
    saveAssetStyleFromSession: vi.fn(),
    workspaceFile: vi.fn(),
    canvas: vi.fn(),
    session: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config: LocusConfig = {
  theme: "ember",
  providers: [],
  templates: [
    {
      id: "ubuntu-24.04",
      name: "Ubuntu",
      os: "ubuntu",
      description: "",
      isoPath: "/iso",
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

const assetSession: AgentSession = {
  id: "as1",
  title: "Clay swan",
  kind: "assets",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  runtime: "docker",
  dockerImage: "ubuntu:24.04",
  providerId: "p",
  model: "grok-4",
  status: "idle",
  vmId: "v1",
  messages: [
    {
      id: "m1",
      role: "user",
      content: "A chunky terracotta swan with cream grout",
      createdAt: "2020-01-01T00:00:00.000Z",
    },
  ],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

describe("AssetStylesModal", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.mocked(api.createAssetStyle).mockReset();
    vi.mocked(api.assetStyles).mockReset();
    vi.mocked(api.saveAssetStyleFromSession).mockReset();
    vi.mocked(api.workspaceFile).mockReset();
    vi.mocked(api.canvas).mockReset();
    vi.mocked(api.session).mockReset();
  });

  it("creates a style from the editor", async () => {
    vi.mocked(api.createAssetStyle).mockResolvedValue({
      id: "st1",
      name: "Clay hero",
      summary: "Chunky terracotta",
      guidelines: "Rounded silhouettes.",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    vi.mocked(api.assetStyles).mockResolvedValue({
      styles: [
        {
          id: "st1",
          name: "Clay hero",
          summary: "Chunky terracotta",
          guidelines: "Rounded silhouettes.",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      defaultId: undefined,
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    let currentState = { ...initialState, config, assetStylesOpen: true };
    const dispatch = (action: Action) => {
      if (action.type === "assetStyleList") {
        currentState = { ...currentState, assetStyles: action.styles };
      }
    };
    const node: ReactNode = (
      <Store.Provider value={{ state: currentState, dispatch }}>
        <AssetStylesModal />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
    expect(host.textContent).toMatch(/Asset styles/);
    expect(host.textContent).toMatch(/Reusable art direction/);
    const name = [...host.querySelectorAll("input")].find(
      (el) => el.getAttribute("placeholder") === "Clay hero",
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(name, "Clay hero");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Save copy",
    );
    await act(async () => {
      save!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createAssetStyle).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Clay hero" }),
    );
  });

  it("fills a new draft from the live studio look", async () => {
    vi.mocked(api.workspaceFile).mockResolvedValue({
      content: "# Clay swan\n\n## Mode\n\n3D mesh with orbit, texture, and optional rig.\n",
      path: "ASSET.md",
      mtime: "2026-01-01T00:00:00.000Z",
    });
    vi.mocked(api.canvas).mockResolvedValue({
      html: `<html data-locus-material="clay"><style>:root{--primary:#c45c26;--accent:#f3e6c8}</style>
<img src="./source.png" /><script>THREE.MeshStandardMaterial</script></html>`,
      path: "/workspace/index.html",
      mtime: "2026-01-01T00:00:00.000Z",
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const currentState = {
      ...initialState,
      config,
      assetStylesOpen: true,
      selectedId: assetSession.id,
      sessions: [assetSession],
    };
    act(() => {
      root.render(
        (
          <Store.Provider value={{ state: currentState, dispatch: () => undefined }}>
            <AssetStylesModal />
          </Store.Provider>
        ) as ReactNode,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const name = [...host.querySelectorAll("input")].find(
      (el) => el.getAttribute("placeholder") === "Clay hero",
    ) as HTMLInputElement;
    const summary = [...host.querySelectorAll("input")].find(
      (el) => el.getAttribute("placeholder") === "Chunky terracotta, cream grout",
    ) as HTMLInputElement;
    expect(name.value).toBe("Clay swan style");
    expect(summary.value).toMatch(/terracotta swan/);
    expect(host.querySelector("textarea")?.value).toMatch(/source\.png/);
    expect(host.querySelector("textarea")?.value).not.toMatch(
      /3D mesh with orbit, texture, and optional rig/,
    );
  });

  it("saves from this studio without sending another style's copy", async () => {
    const other = {
      id: "st-other",
      name: "Voxel dusk",
      summary: "Blocky night palette",
      guidelines: "Minecraft-like cubes.",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const saved = {
      id: "st1",
      name: "Clay swan style",
      summary: "A chunky terracotta swan with cream grout",
      guidelines: "Rounded clay body.",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    vi.mocked(api.saveAssetStyleFromSession).mockResolvedValue(saved);
    vi.mocked(api.assetStyles).mockResolvedValue({ styles: [other, saved], defaultId: undefined });
    vi.mocked(api.session).mockResolvedValue({ ...assetSession, assetStyleId: "st1" });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    let currentState: UiState = {
      ...initialState,
      config,
      assetStylesOpen: true,
      selectedId: assetSession.id,
      sessions: [{ ...assetSession, assetStyleId: "st-other" }],
      assetStyles: [other],
    };
    const dispatch = (action: Action) => {
      if (action.type === "assetStyleList") {
        currentState = { ...currentState, assetStyles: action.styles };
      }
      if (action.type === "session") {
        currentState = {
          ...currentState,
          sessions: currentState.sessions.map((row) =>
            row.id === action.session.id ? action.session : row,
          ),
        };
      }
    };
    act(() => {
      root.render(
        (
          <Store.Provider value={{ state: currentState, dispatch }}>
            <AssetStylesModal />
          </Store.Provider>
        ) as ReactNode,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      (
        [...host.querySelectorAll("input")].find(
          (el) => el.getAttribute("placeholder") === "Clay hero",
        ) as HTMLInputElement
      ).value,
    ).toBe("Voxel dusk");
    const saveFromStudio = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Save from this studio",
    );
    await act(async () => {
      saveFromStudio!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.saveAssetStyleFromSession).toHaveBeenCalledWith("as1", {
      name: undefined,
    });
    expect(api.saveAssetStyleFromSession).not.toHaveBeenCalledWith(
      "as1",
      expect.objectContaining({ summary: "Blocky night palette" }),
    );
  });
});
