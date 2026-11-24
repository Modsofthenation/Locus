import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { customThemeFromInput, type AiProvider, type CustomTheme } from "@locus/shared";
import { AppearanceSettings } from "./AppearanceSettings";
import { api } from "@/lib/api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AppearanceSettings", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("groups See all themes by family", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <AppearanceSettings
          theme="ember"
          savedTheme="ember"
          editorFontSize={13}
          formatOnSave
          showMinimap
          onSelect={() => undefined}
          onEditor={() => undefined}
        />,
      );
    });
    expect(host.querySelector("[data-testid='theme-family-dark']")).toBeNull();
    const seeAll = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.startsWith("See all"),
    );
    expect(seeAll).toBeTruthy();
    await act(async () => {
      seeAll!.click();
    });
    expect(host.querySelector("[data-testid='theme-family-dark']")?.textContent).toContain("Dark");
    expect(host.querySelector("[data-testid='theme-family-light']")?.textContent).toContain(
      "Light",
    );
    expect(host.querySelector("[data-testid='theme-family-contrast']")?.textContent).toContain(
      "Contrast",
    );
    expect(host.querySelector("[data-testid='theme-family-gradient']")?.textContent).toContain(
      "Gradient",
    );
  });

  it("puts product mode first with what each mode includes, and uses switches for on/off prefs", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onEditor = vi.fn();
    await act(async () => {
      root.render(
        <AppearanceSettings
          theme="ember"
          savedTheme="ember"
          productMode="developer"
          editorFontSize={13}
          formatOnSave
          showMinimap={false}
          onSelect={() => undefined}
          onEditor={onEditor}
        />,
      );
    });
    const main = host.querySelector(".appearance-main")!;
    expect(main.firstElementChild?.classList.contains("appearance-product-mode")).toBe(true);
    const developer = host.querySelector("[data-testid='appearance-product-mode-developer']");
    expect(developer?.getAttribute("aria-checked")).toBe("true");
    expect(developer?.textContent).toContain("Codebase");
    expect(
      host.querySelector("[data-testid='appearance-product-mode-swarm']")?.textContent,
    ).toMatch(/Teammates/);
    expect(host.querySelector(".appearance-editor-prefs input[type='checkbox']")).toBeNull();
    const minimap = host.querySelector("[data-testid='appearance-minimap']") as HTMLButtonElement;
    expect(minimap.getAttribute("role")).toBe("switch");
    expect(minimap.getAttribute("aria-checked")).toBe("false");
    await act(async () => {
      minimap.click();
    });
    expect(onEditor).toHaveBeenCalledWith({ showMinimap: true });
  });

  const neon = customThemeFromInput(
    {
      id: "custom-neon-rain",
      name: "Neon Rain",
      scheme: "dark",
      colors: { bg: "#05060a", text: "#e6f1ff", accent: "#ff2a6d" },
      layout: { background: "grid" },
      origin: "ai",
    },
    { now: "2026-01-01T00:00:00.000Z" },
  );

  const openai = {
    id: "p-openai",
    name: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "••••",
    models: ["gpt-4.1", "gpt-4.1-mini"],
    defaultModel: "gpt-4.1",
    enabled: true,
    extraHeaders: {},
  } as AiProvider;
  const cliAgent = {
    ...openai,
    id: "p-cli",
    name: "My CLI",
    kind: "cli-agent",
    baseUrl: "cli-agent://local",
  } as AiProvider;
  const cursorCloud = {
    ...openai,
    id: "p-cursor",
    name: "Cursor Cloud",
    kind: "cursor",
    baseUrl: "https://api.cursor.com",
  } as AiProvider;

  function mount(props: {
    customThemes: CustomTheme[];
    providers?: AiProvider[];
    onCustomThemes?: (themes: CustomTheme[], select?: string) => void;
    onSelect?: (id: string) => void;
    theme?: string;
  }) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    return act(async () => {
      root.render(
        <AppearanceSettings
          theme={props.theme ?? "ember"}
          savedTheme={props.theme ?? "ember"}
          customThemes={props.customThemes}
          providers={props.providers ?? [openai]}
          editorFontSize={13}
          formatOnSave
          showMinimap
          onSelect={props.onSelect ?? (() => undefined)}
          onCustomThemes={props.onCustomThemes ?? (() => undefined)}
          onEditor={() => undefined}
        />,
      );
    });
  }

  const button = (text: string) =>
    [...host.querySelectorAll("button")].find((btn) => btn.textContent?.trim() === text);

  it("lists generated themes under their own filter and applies them", async () => {
    const onSelect = vi.fn();
    await mount({ customThemes: [neon], onSelect });
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-testid='theme-filter-generated']")!.click();
    });
    expect(host.querySelector("[data-testid='theme-filter-generated']")?.textContent).toBe(
      "✦ Generated1",
    );
    const thumb = host.querySelector(".theme-thumb[data-theme='custom-neon-rain']");
    expect(thumb?.hasAttribute("data-theme-custom")).toBe(true);
    expect(host.textContent).toContain("Made by Locus");
    await act(async () => {
      (thumb!.closest("button") as HTMLButtonElement).click();
    });
    expect(onSelect).toHaveBeenCalledWith("custom-neon-rain");
  });

  it("shows an empty state, then builds and saves a new theme", async () => {
    const onCustomThemes = vi.fn();
    await mount({ customThemes: [], onCustomThemes });
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-testid='theme-filter-generated']")!.click();
    });
    expect(host.querySelector("[data-testid='theme-generated-empty']")).not.toBeNull();
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-testid='theme-new']")!.click();
    });
    expect(host.querySelector("[data-testid='theme-editor']")).not.toBeNull();
    expect(host.querySelector("[data-testid='theme-preview']")?.getAttribute("data-theme")).toBe(
      "custom-my-theme",
    );
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-testid='theme-editor-save']")!.click();
    });
    const [themes, select] = onCustomThemes.mock.calls[0]!;
    expect(themes).toHaveLength(1);
    expect(themes[0].id).toBe("custom-my-theme");
    expect(select).toBe("custom-my-theme");
  });

  it("deletes the applied generated theme and falls back to the default", async () => {
    const onCustomThemes = vi.fn();
    await mount({ customThemes: [neon], onCustomThemes, theme: neon.id });
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[aria-label='Edit Neon Rain']")!.click();
    });
    await act(async () => {
      button("Delete")!.click();
    });
    expect(onCustomThemes).toHaveBeenCalledWith([], "ember");
  });

  it("generates a theme from a description and opens it for review", async () => {
    const spy = vi.spyOn(api, "generateTheme").mockResolvedValue({ theme: neon });
    await mount({ customThemes: [neon] });
    // Only the Generated tab offers the composer.
    expect(host.querySelector("[data-testid='theme-generate-input']")).toBeNull();
    expect(host.querySelector("[data-testid='theme-new']")).toBeNull();
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-testid='theme-filter-generated']")!.click();
    });
    const input = host.querySelector<HTMLTextAreaElement>("[data-testid='theme-generate-input']")!;
    expect(input.tagName).toBe("TEXTAREA");
    expect(input.closest(".empty-composer")).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(input, "rainy neon city");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Enter sends, like every other composer.
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(spy).toHaveBeenCalledWith("rainy neon city", {
      providerId: "p-openai",
      model: "gpt-4.1",
    });
    // A second copy gets a fresh id instead of overwriting the saved one.
    expect(host.querySelector("[data-testid='theme-preview']")?.getAttribute("data-theme")).toBe(
      "custom-neon-rain-2",
    );
    spy.mockRestore();
  });

  it("offers CLI agents too, defaulting to an API provider", async () => {
    await mount({ customThemes: [], providers: [cliAgent, cursorCloud, openai] });
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-testid='theme-filter-generated']")!.click();
    });
    const bar = host.querySelector(".theme-composer .composer-toolbar-end")!;
    expect(bar.textContent).toContain("OpenAI");
    expect(host.querySelector("[data-testid='theme-no-provider']")).toBeNull();
  });

  it("lets a CLI agent generate when it is the only provider", async () => {
    await mount({ customThemes: [], providers: [cliAgent] });
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-testid='theme-filter-generated']")!.click();
    });
    const bar = host.querySelector(".theme-composer .composer-toolbar-end")!;
    expect(bar.textContent).toContain("My CLI");
    expect(host.querySelector("[data-testid='theme-no-provider']")).toBeNull();
  });

  it("explains how to enable Generate when no provider can answer", async () => {
    await mount({ customThemes: [], providers: [cursorCloud] });
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-testid='theme-filter-generated']")!.click();
    });
    expect(host.querySelector("[data-testid='theme-no-provider']")?.textContent).toMatch(
      /Settings → Providers/,
    );
    expect(host.querySelector<HTMLButtonElement>(".theme-composer .composer-send")!.disabled).toBe(
      true,
    );
    // Building by hand still works.
    expect(host.querySelector("[data-testid='theme-new']")).not.toBeNull();
  });

  it("shuffles to a random theme within the current filter, never the current one", async () => {
    const onSelect = vi.fn();
    await mount({ customThemes: [neon], onSelect });
    const shuffle = host.querySelector<HTMLButtonElement>("[data-testid='theme-shuffle']")!;
    expect(shuffle.disabled).toBe(false);
    const random = vi.spyOn(Math, "random");
    for (const value of [0, 0.5, 0.999]) {
      random.mockReturnValueOnce(value);
      await act(async () => shuffle.click());
    }
    random.mockRestore();
    expect(onSelect).toHaveBeenCalledTimes(3);
    for (const [id] of onSelect.mock.calls) expect(id).not.toBe("ember");

    // Under the Generated filter the pool is just the generated themes.
    onSelect.mockClear();
    await act(async () =>
      host.querySelector<HTMLButtonElement>("[data-testid='theme-filter-generated']")!.click(),
    );
    await act(async () => shuffle.click());
    expect(onSelect).toHaveBeenCalledWith(neon.id);
  });

  it("searches every theme by name or description", async () => {
    await mount({ customThemes: [neon] });
    const search = host.querySelector<HTMLInputElement>("[data-testid='theme-search']")!;
    const type = async (value: string) =>
      act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(search, value);
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await type("neon rain");
    const names = [...host.querySelectorAll(".theme-card h3")].map((el) => el.textContent);
    expect(names).toEqual(["Neon Rain"]);
    await type("zzz-nothing");
    expect(host.querySelector("[data-testid='theme-search-empty']")).not.toBeNull();
  });

  it("shows the previewed theme's summary and swatches", async () => {
    await mount({ customThemes: [] });
    const details = host.querySelector("[data-testid='theme-details']");
    expect(details?.textContent).toMatch(/peach/i);
    expect(details?.querySelectorAll(".theme-details-swatches span")).toHaveLength(4);
    const labels = [...(details?.querySelectorAll(".theme-details-swatches span") ?? [])].map(
      (swatch) => swatch.getAttribute("title"),
    );
    expect(labels[0]).toMatch(/^Background · #/);
    expect(labels[2]).toMatch(/^Accent · #/);
    expect(details?.querySelector(".theme-details-swatches span")?.getAttribute("aria-label")).toBe(
      labels[0],
    );
  });
});
