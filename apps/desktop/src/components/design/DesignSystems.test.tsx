import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PALETTE_PRESETS, type LocusConfig } from "@locus/shared";
import { DesignSystemsModal, contrastRatio } from "./DesignSystems";
import { api } from "@/lib/api";
import { Store, initialState, type Action } from "@/state/store";
import { UBUNTU_DEFAULT_HARDWARE, defaultNetworking } from "@locus/shared";

vi.mock("@/lib/api", () => ({
  api: {
    createDesignSystem: vi.fn(),
    importDesignSystem: vi.fn(),
    patchDesignSystem: vi.fn(),
    deleteDesignSystem: vi.fn(),
    setDefaultDesignSystem: vi.fn(),
    designSystems: vi.fn(),
    patchSession: vi.fn(),
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

describe("DesignSystemsModal", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.mocked(api.importDesignSystem).mockReset();
    vi.mocked(api.designSystems).mockReset();
    vi.mocked(api.createDesignSystem).mockReset();
  });

  it("creates a system from the editor and can export JSON", async () => {
    vi.mocked(api.createDesignSystem).mockResolvedValue({
      id: "sys1",
      name: "Acme",
      summary: "",
      palette: PALETTE_PRESETS[0]!.colors,
      typography: {
        sans: "ui-sans-serif, system-ui, sans-serif",
        display: "ui-sans-serif, system-ui, sans-serif",
        mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        basePx: 16,
      },
      radiusPx: 12,
      spacePx: 8,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    vi.mocked(api.designSystems).mockResolvedValue({
      systems: [
        {
          id: "sys1",
          name: "Acme",
          summary: "",
          palette: PALETTE_PRESETS[0]!.colors,
          typography: {
            sans: "ui-sans-serif, system-ui, sans-serif",
            display: "ui-sans-serif, system-ui, sans-serif",
            mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            basePx: 16,
          },
          radiusPx: 12,
          spacePx: 8,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      builtins: [],
    });
    const dispatched: Action[] = [];
    let currentState = { ...initialState, config, designSystemsOpen: true };
    function dispatch(action: Action) {
      dispatched.push(action);
      if (action.type === "designSystemList") {
        currentState = { ...currentState, designSystems: action.systems };
      }
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider value={{ state: currentState, dispatch }}>
        <DesignSystemsModal />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
    expect(host.textContent).toContain("Design systems");
    expect(host.textContent).toContain("Import");
    expect(host.textContent).toContain("Export");
    expect(host.querySelector("input[type=file]")?.getAttribute("accept")).toContain(".zip");
    expect(host.textContent).toContain("A specimen of the system");
    expect(host.textContent).toContain("Morning print queue");
    expect(host.textContent).toContain("New task");
    expect(host.textContent).toContain("Starters");
    expect(host.textContent).toContain("Ink");
    expect(host.textContent).toContain("Midnight");
    expect(host.textContent).toContain("Parchment");
    expect(host.querySelector(".ds-new")?.textContent).toMatch(/New system/);
    const name = [...host.querySelectorAll("input")].find(
      (el) => el.getAttribute("placeholder") === "Acme brand",
    ) as HTMLInputElement;
    act(() => {
      name.value = "Acme";
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
    expect(api.createDesignSystem).toHaveBeenCalled();
    expect(dispatched.some((row) => row.type === "designSystemList")).toBe(true);
    act(() => {
      root.render(
        <Store.Provider value={{ state: currentState, dispatch }}>
          <DesignSystemsModal />
        </Store.Provider>,
      );
    });
    expect(host.textContent).toContain("Saved");
    expect(host.textContent).toContain("Acme");
    expect(host.querySelectorAll(".ds-nav-item")).toHaveLength(1 + PALETTE_PRESETS.length);
  });

  it("shows a loading overlay while a large zip import is in flight", async () => {
    let release: (value: Awaited<ReturnType<typeof api.importDesignSystem>>) => void = () =>
      undefined;
    vi.mocked(api.importDesignSystem).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    vi.mocked(api.designSystems).mockResolvedValue({ systems: [], builtins: [] });
    const dispatched: Action[] = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, config, designSystemsOpen: true },
            dispatch: (action) => dispatched.push(action),
          }}
        >
          <DesignSystemsModal />
        </Store.Provider>,
      );
    });
    const input = host.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File([new Uint8Array(8 * 1024 * 1024)], "Harbor_Design_System.zip", {
      type: "application/zip",
    });
    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: { 0: file, length: 1, item: (i: number) => (i === 0 ? file : null) },
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(host.querySelector("[data-testid=ds-import-overlay]")?.textContent).toMatch(
      /Importing Harbor_Design_System\.zip/,
    );
    expect(host.textContent).toMatch(/8\.0 MB/);
    expect(host.textContent).toMatch(/Source uploads/);
    expect(
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Importing…"),
    ).toBeTruthy();
    await act(async () => {
      release({
        id: "sys-import",
        name: "Harbor",
        summary: "",
        palette: PALETTE_PRESETS[0]!.colors,
        typography: {
          sans: "ui-sans-serif, system-ui, sans-serif",
          display: "ui-sans-serif, system-ui, sans-serif",
          mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          basePx: 16,
        },
        radiusPx: 12,
        spacePx: 8,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      await Promise.resolve();
    });
  });

  it("rejects an oversized zip in the UI before uploading", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, config, designSystemsOpen: true },
            dispatch: () => undefined,
          }}
        >
          <DesignSystemsModal />
        </Store.Provider>,
      );
    });
    const input = host.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["x"], "huge.zip", { type: "application/zip" });
    Object.defineProperty(file, "size", { value: 129 * 1024 * 1024 });
    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: { 0: file, length: 1, item: (i: number) => (i === 0 ? file : null) },
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(api.importDesignSystem).not.toHaveBeenCalled();
    expect(host.textContent).toMatch(/too large/i);
  });

  it("asks before deleting a saved system", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
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
              designSystemsOpen: true,
              designSystems: [
                {
                  id: "sys1",
                  name: "Acme",
                  summary: "",
                  palette: PALETTE_PRESETS[0]!.colors,
                  typography: {
                    sans: "ui-sans-serif, system-ui, sans-serif",
                    display: "ui-sans-serif, system-ui, sans-serif",
                    mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                    basePx: 16,
                  },
                  radiusPx: 12,
                  spacePx: 8,
                  createdAt: "2026-01-01T00:00:00.000Z",
                  updatedAt: "2026-01-01T00:00:00.000Z",
                },
              ],
            },
            dispatch: () => undefined,
          }}
        >
          <DesignSystemsModal />
        </Store.Provider>,
      );
    });
    const remove = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Delete");
    act(() => {
      remove!.click();
    });
    expect(confirm).toHaveBeenCalled();
    expect(api.deleteDesignSystem).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("reports contrast for text on the system background", () => {
    expect(contrastRatio("#f4f1ea", "#111114")).toBeGreaterThan(4.5);
    expect(contrastRatio("#111114", "#111114")).toBeLessThan(4.5);
  });
});
