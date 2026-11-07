import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DESIGN_PALETTE,
  DEFAULT_DESIGN_TYPOGRAPHY,
  PALETTE_PRESETS,
  type DesignPalette,
  type DesignSystem,
} from "@locus/shared";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Store, initialState } from "@/state/store";
import { DesignPalettePicker, palettePresetsFromSystems } from "./DesignPalettePicker";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const acmePalette: DesignPalette = {
  bg: "#0a1628",
  surface: "#12233d",
  text: "#f6f7fb",
  muted: "#8b97ab",
  primary: "#3d7cff",
  accent: "#f0b429",
};

const acme: DesignSystem = {
  id: "sys-acme",
  name: "Acme brand",
  summary: "Imported kit",
  palette: acmePalette,
  typography: { ...DEFAULT_DESIGN_TYPOGRAPHY },
  radiusPx: 12,
  spacePx: 8,
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

describe("DesignPalettePicker", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(
    onChange: (palette: DesignPalette) => void = () => undefined,
    opts: { compact?: boolean; systems?: DesignSystem[]; palette?: DesignPalette } = {},
  ) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider
        value={{
          state: { ...initialState, designSystems: opts.systems ?? [] },
          dispatch: () => undefined,
        }}
      >
        <DesignPalettePicker
          palette={{ ...(opts.palette ?? DEFAULT_DESIGN_PALETTE) }}
          onChange={onChange}
          compact={opts.compact}
        />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
  }

  it("applies a named preset", () => {
    const seen: string[] = [];
    render((palette) => seen.push(palette.primary));
    expect(host.textContent).toContain("Ink");
    expect(host.textContent).toContain("Paper");
    expect(host.textContent).toContain("Midnight");
    expect(host.textContent).toContain("Parchment");
    expect(host.querySelectorAll(".palette-preset")).toHaveLength(PALETTE_PRESETS.length);
    const paper = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Paper"),
    );
    act(() => {
      paper!.click();
    });
    expect(seen[0]).toBe(PALETTE_PRESETS.find((p) => p.id === "paper")?.colors.primary);
  });

  it("lists imported design system palettes with the starters", () => {
    const seen: DesignPalette[] = [];
    render((palette) => seen.push(palette), { systems: [acme] });
    expect(host.textContent).toContain("My systems");
    expect(host.textContent).toContain("Acme brand");
    expect(host.textContent).toContain("Starters");
    expect(host.textContent).toContain("Ink");
    const imported = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Acme brand"),
    );
    act(() => {
      imported!.click();
    });
    expect(seen[0]).toEqual(acmePalette);
  });

  it("marks the imported palette selected when colors match", () => {
    render(() => undefined, { systems: [acme], palette: acmePalette });
    const imported = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Acme brand"),
    );
    expect(imported?.className).toContain("on");
    expect(imported?.getAttribute("aria-pressed")).toBe("true");
  });

  it("opens imported palettes from the compact swatch row", () => {
    render(() => undefined, { compact: true, systems: [acme] });
    expect(host.textContent).not.toContain("Acme brand");
    const toggle = host.querySelector(".palette-swatch-row") as HTMLButtonElement;
    act(() => {
      toggle.click();
    });
    expect(host.textContent).toContain("Acme brand");
    expect(host.textContent).toContain("Primary");
    expect(host.querySelectorAll("input[type='color']")).toHaveLength(6);
  });

  it("opens from the compact swatch row", () => {
    render(() => undefined, { compact: true });
    expect(host.textContent).not.toContain("Primary");
    const toggle = host.querySelector(".palette-swatch-row") as HTMLButtonElement;
    act(() => {
      toggle.click();
    });
    expect(host.textContent).toContain("Primary");
    expect(host.querySelectorAll("input[type='color']")).toHaveLength(6);
  });

  it("lets compact role editors shrink instead of overflowing the pop", () => {
    expect(css).toMatch(/\.palette-pop \{[\s\S]*?width:\s*320px/);
    expect(css).toMatch(
      /\.palette-pop \{[\s\S]*?max-width:\s*min\(320px,\s*calc\(100vw - 24px\)\)/,
    );
    expect(css).toMatch(/\.palette-pop \{[\s\S]*?overflow-x:\s*auto/);
    expect(css).toMatch(/\.palette-pop\.placed \{[\s\S]*?position:\s*fixed/);
    expect(css).toMatch(
      /\.palette-roles \{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/,
    );
    expect(css).toMatch(/\.palette-role \{[\s\S]*?min-width:\s*0/);
    expect(css).toMatch(/\.palette-role-inputs \{[\s\S]*?min-width:\s*0/);
    expect(css).toMatch(/\.palette-role-inputs input\[type="text"\] \{[\s\S]*?width:\s*0/);
    expect(css).toMatch(/\.palette-role-inputs input\[type="text"\] \{[\s\S]*?min-width:\s*0/);
    expect(css).toMatch(/\.palette-role-inputs input\[type="color"\] \{[\s\S]*?flex:\s*0 0 28px/);
    expect(css).toMatch(/\.palette-presets \{[\s\S]*?max-height:\s*240px/);
    expect(css).toMatch(/\.palette-preset-group \{[\s\S]*?grid-column:\s*1\s*\/\s*-1/);
  });

  it("pins the compact pop with fixed placement so it can cover the chat", async () => {
    render(() => undefined, { compact: true });
    const toggle = host.querySelector(".palette-swatch-row") as HTMLButtonElement;
    await act(async () => {
      toggle.click();
      await Promise.resolve();
    });
    const menu = host.querySelector(".palette-pop") as HTMLDivElement;
    expect(menu).toBeTruthy();
    expect(menu.classList.contains("placed")).toBe(true);
    expect(menu.style.top).toMatch(/px/);
    expect(menu.style.left).toMatch(/px/);
  });
});

describe("palettePresetsFromSystems", () => {
  it("skips builtins and duplicate palettes", () => {
    const copy: DesignSystem = { ...acme, id: "sys-copy", name: "Copy" };
    const builtin: DesignSystem = {
      ...acme,
      id: "preset:ink",
      name: "Ink",
      palette: { ...DEFAULT_DESIGN_PALETTE },
    };
    expect(palettePresetsFromSystems([builtin, acme, copy])).toEqual([
      { id: "sys-acme", name: "Acme brand", summary: "Imported kit", colors: acmePalette },
    ]);
  });
});
