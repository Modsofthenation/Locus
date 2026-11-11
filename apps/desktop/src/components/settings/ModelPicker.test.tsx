import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_PROVIDERS, builtinProviderKey, type AiProvider } from "@locus/shared";
import { CodexReasoningPicker, ModelPicker, composerModelLabel } from "./ModelPicker";
import {
  selectOptionLabels,
  selectOptionValues,
  selectValue,
  setSelectValue,
} from "@/lib/selectControl";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const providers: AiProvider[] = BUILTIN_PROVIDERS.map((p) => ({
  ...p,
  id: builtinProviderKey(p),
  apiKey: "",
}));

describe("ModelPicker", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(node);
    });
  }

  it("shows projected in/out costs across providers that offer the selected model", () => {
    render(
      <ModelPicker
        providers={providers}
        providerId="openai"
        model="gpt-4.1"
        onChange={() => undefined}
      />,
    );
    expect(host.textContent).toMatch(/\$2 in · \$8 out \/1M/);
    const fullOptions = selectOptionLabels(host, "Model");
    expect(fullOptions).toEqual(
      expect.arrayContaining([expect.stringContaining("gpt-4.1 · $2 in · $8 out /1M")]),
    );
    expect(fullOptions.every((text) => text?.includes(" · $"))).toBe(true);
    expect(host.querySelector(".model-cost-table")?.textContent).toMatch(/OpenAI/);
    expect(host.querySelector(".model-cost-table")?.textContent).toMatch(/OpenRouter/);
    expect(host.querySelector(".model-cost-table")?.textContent).toMatch(/openai\/gpt-4\.1/);
    expect(host.textContent).toMatch(/Approx\. published \$\/1M tokens \(2026-08\)/i);
  });

  it("gives the composer chip and the topbar one model label that flags an off provider", () => {
    expect(composerModelLabel(providers, "missing", "big-pickle")).toEqual({
      label: "big-pickle · No provider",
      off: true,
    });
    expect(composerModelLabel(providers, "", "")).toEqual({ label: "No provider", off: true });
    const on = providers.map((p) => (p.id === "openai" ? { ...p, enabled: true } : p));
    expect(composerModelLabel(on, "openai", "gpt-4.1")).toEqual({
      label: "OpenAI · gpt-4.1",
      off: false,
    });
    expect(composerModelLabel(providers, "openai", "gpt-4.1").label).toBe("OpenAI (off) · gpt-4.1");
  });

  it("labels empty compact pickers instead of rendering blank selects", () => {
    render(
      <ModelPicker
        compact
        providers={providers.map((p) => ({ ...p, enabled: false }))}
        providerId=""
        model=""
        onChange={() => undefined}
      />,
    );
    expect(
      host.querySelector("[aria-label='Model'] .model-picker-combined-label")?.textContent,
    ).toBe("No provider");
  });

  it("does not add a placeholder when the selected provider is listed", () => {
    render(
      <ModelPicker
        compact
        providers={providers}
        providerId="openai"
        model="gpt-4.1"
        onChange={() => undefined}
      />,
    );
    expect(
      host.querySelector("[aria-label='Model'] .model-picker-combined-label")?.textContent,
    ).toBe("OpenAI (off) · gpt-4.1");
    act(() => {
      host
        .querySelector("[aria-label='Model']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const disabled = [...host.querySelectorAll("[role='menuitem']")].some(
      (el) => (el as HTMLButtonElement).disabled,
    );
    expect(disabled).toBe(false);
  });

  it("does not show Fast or thinking for OpenAI", () => {
    render(
      <ModelPicker
        providers={providers}
        providerId="openai"
        model="gpt-4.1"
        onChange={() => undefined}
      />,
    );
    expect(host.querySelector('[aria-label="Fast"]')).toBeNull();
    expect(host.querySelector('[aria-label="Thinking"]')).toBeNull();
  });

  it("shows only the reasoning levels supported by the selected Codex model", () => {
    const codex = providers.find((p) => p.id === "codex-cli")!;
    render(<CodexReasoningPicker provider={codex} model="gpt-5.5" onChange={() => undefined} />);
    expect(selectOptionValues(host, "Reasoning effort")).toEqual([
      "",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(host.textContent).toContain("Controls how much reasoning Codex uses for this model.");
  });

  it("toggles Fast on Composer 2 for Cursor CLI", () => {
    const changes: { providerId: string; model: string }[] = [];
    render(
      <ModelPicker
        providers={providers}
        providerId="cursor-cli"
        model="composer-2"
        onChange={(next) => changes.push(next)}
      />,
    );
    expect(selectOptionValues(host, "Model")).toEqual([
      "composer-2",
      "auto",
      "claude-sonnet-4-5",
      "gpt-5",
    ]);
    expect(host.querySelector('[aria-label="Thinking"]')).toBeNull();
    expect(selectValue(host, "Fast")).toBe("off");
    act(() => {
      setSelectValue(host, "Fast", "fast");
    });
    expect(changes).toEqual([{ providerId: "cursor-cli", model: "composer-2-fast" }]);
  });

  it("sets Claude thinking and GPT effort plus Fast", () => {
    const changes: { providerId: string; model: string }[] = [];
    render(
      <ModelPicker
        providers={providers}
        providerId="cursor-cli"
        model="claude-sonnet-4-5"
        onChange={(next) => changes.push(next)}
      />,
    );
    expect(host.querySelector('[aria-label="Fast"]')).toBeNull();
    expect(selectOptionLabels(host, "Thinking")).toEqual(["Off", "Thinking", "High"]);
    act(() => {
      setSelectValue(host, "Thinking", "thinking");
    });
    expect(changes.at(-1)).toEqual({
      providerId: "cursor-cli",
      model: "claude-sonnet-4-5-thinking",
    });

    act(() => {
      root.render(
        <ModelPicker
          providers={providers}
          providerId="cursor-cli"
          model="gpt-5"
          onChange={(next) => changes.push(next)}
        />,
      );
    });
    expect(selectOptionLabels(host, "Thinking")).toEqual([
      "None",
      "Low",
      "Medium",
      "High",
      "Extra-high",
    ]);
    act(() => {
      setSelectValue(host, "Thinking", "xhigh");
    });
    expect(changes.at(-1)).toEqual({ providerId: "cursor-cli", model: "gpt-5-xhigh" });

    act(() => {
      root.render(
        <ModelPicker
          providers={providers}
          providerId="cursor-cli"
          model="gpt-5-xhigh"
          onChange={(next) => changes.push(next)}
        />,
      );
    });
    act(() => {
      setSelectValue(host, "Fast", "fast");
    });
    expect(changes.at(-1)).toEqual({ providerId: "cursor-cli", model: "gpt-5-xhigh-fast" });
  });

  it("sets Grok 4.6 effort and Fast for Cursor CLI", () => {
    const changes: { providerId: string; model: string }[] = [];
    const cursor = providers.find((p) => p.id === "cursor-cli")!;
    const withGrok: AiProvider[] = [
      ...providers.filter((p) => p.id !== "cursor-cli"),
      {
        ...cursor,
        models: ["composer-2", "cursor-grok-4.6-high-fast", "cursor-grok-4.6-low", "auto"],
        defaultModel: "composer-2",
      },
    ];
    render(
      <ModelPicker
        providers={withGrok}
        providerId="cursor-cli"
        model="cursor-grok-4.6"
        onChange={(next) => changes.push(next)}
      />,
    );
    expect(selectValue(host, "Model")).toBe("cursor-grok-4.6");
    expect(selectOptionLabels(host, "Thinking")).toEqual(["Low", "Medium", "High", "Extra-high"]);
    expect(selectValue(host, "Thinking")).toBe("high");
    expect(selectValue(host, "Fast")).toBe("off");
    act(() => {
      setSelectValue(host, "Thinking", "low");
    });
    expect(changes.at(-1)).toEqual({ providerId: "cursor-cli", model: "cursor-grok-4.6-low" });
    act(() => {
      root.render(
        <ModelPicker
          providers={withGrok}
          providerId="cursor-cli"
          model="cursor-grok-4.6-high"
          onChange={(next) => changes.push(next)}
        />,
      );
    });
    act(() => {
      setSelectValue(host, "Fast", "fast");
    });
    expect(changes.at(-1)).toEqual({
      providerId: "cursor-cli",
      model: "cursor-grok-4.6-high-fast",
    });
  });

  it("shows a compact Fast toggle in the model options menu and keeps variant slugs out of the model list", () => {
    const changes: { providerId: string; model: string }[] = [];
    const cursor = providers.find((p) => p.id === "cursor-cli")!;
    const withVariants: AiProvider[] = [
      ...providers.filter((p) => p.id !== "cursor-cli"),
      { ...cursor, models: ["composer-2", "composer-2-fast", "auto"] },
    ];
    render(
      <ModelPicker
        compact
        providers={withVariants}
        providerId="cursor-cli"
        model="composer-2-fast"
        onChange={(next) => changes.push(next)}
      />,
    );
    expect(host.querySelector(".model-picker-combined-label")?.textContent).toMatch(/composer-2/);
    act(() => {
      host
        .querySelector("[aria-label='Model']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const modelItems = [...host.querySelectorAll(".model-picker-combined [role='menuitem']")].map(
      (el) => el.textContent,
    );
    expect(modelItems).toEqual(expect.arrayContaining(["composer-2", "auto"]));
    expect(modelItems).not.toContain("composer-2-fast");
    act(() => {
      (host.querySelector('[aria-label="Model options"]') as HTMLElement).click();
    });
    const fast = host.querySelector('button[aria-label="Fast"]') as HTMLButtonElement;
    expect(fast).toBeTruthy();
    expect(fast.getAttribute("aria-checked")).toBe("true");
    expect(fast.querySelector(".settings-switch.on")).toBeTruthy();
    act(() => {
      fast.click();
    });
    expect(changes).toEqual([{ providerId: "cursor-cli", model: "composer-2" }]);
  });

  it("puts compact thinking levels in the model options menu", () => {
    const changes: { providerId: string; model: string }[] = [];
    const cursor = providers.find((p) => p.id === "cursor-cli")!;
    const withGrok: AiProvider[] = [
      ...providers.filter((p) => p.id !== "cursor-cli"),
      {
        ...cursor,
        models: ["cursor-grok-4.6", "cursor-grok-4.6-high", "auto"],
        defaultModel: "cursor-grok-4.6",
      },
    ];
    render(
      <ModelPicker
        compact
        providers={withGrok}
        providerId="cursor-cli"
        model="cursor-grok-4.6-high"
        onChange={(next) => changes.push(next)}
      />,
    );
    expect(host.querySelector('select[aria-label="Thinking"]')).toBeNull();
    act(() => {
      (host.querySelector('[aria-label="Model options"]') as HTMLElement).click();
    });
    const high = [...host.querySelectorAll("[role='menuitem']")].find(
      (el) => el.textContent === "High",
    ) as HTMLButtonElement;
    const low = [...host.querySelectorAll("[role='menuitem']")].find(
      (el) => el.textContent === "Low",
    ) as HTMLButtonElement;
    expect(high.getAttribute("aria-current")).toBe("true");
    act(() => {
      low.click();
    });
    expect(changes).toEqual([{ providerId: "cursor-cli", model: "cursor-grok-4.6-low" }]);
  });

  it("allows Codex effort selection from the compact composer menu", () => {
    const efforts: string[] = [];
    const codex = providers.find((p) => p.id === "codex-cli")!;
    render(
      <ModelPicker
        compact
        providers={providers}
        providerId={codex.id}
        model="gpt-5.5"
        reasoningEffort="high"
        onReasoningEffortChange={(value) => efforts.push(value ?? "auto")}
        onChange={() => undefined}
      />,
    );
    act(() => {
      (host.querySelector('[aria-label="Model options"]') as HTMLElement).click();
    });
    const xhigh = [...host.querySelectorAll("[role='menuitem']")].find(
      (el) => el.textContent === "XHigh",
    ) as HTMLButtonElement;
    const high = [...host.querySelectorAll("[role='menuitem']")].find(
      (el) => el.textContent === "High",
    ) as HTMLButtonElement;
    expect(high.getAttribute("aria-current")).toBe("true");
    act(() => {
      xhigh.click();
    });
    expect(efforts).toEqual(["xhigh"]);
  });

  it("hides the compact model options menu when Fast and thinking do not apply", () => {
    render(
      <ModelPicker
        compact
        providers={providers}
        providerId="cursor-cli"
        model="auto"
        onChange={() => undefined}
      />,
    );
    expect(host.querySelector('[aria-label="Model options"]')).toBeNull();
    expect(host.querySelector(".model-picker-more")).toBeNull();
    expect(host.querySelector(".model-picker-combined")).toBeTruthy();
  });

  it("opens compact model options above the composer footer", () => {
    render(
      <ModelPicker
        compact
        providers={providers}
        providerId="cursor-cli"
        model="composer-2"
        onChange={() => undefined}
      />,
    );
    act(() => {
      (host.querySelector('[aria-label="Model options"]') as HTMLElement).click();
    });
    const menu = host.querySelector("details.model-picker-more") as HTMLDetailsElement;
    expect(menu.open).toBe(true);
    expect(menu.className).toMatch(/\bup\b/);
    const fast = host.querySelector('button[aria-label="Fast"]') as HTMLButtonElement;
    expect(fast?.textContent).toMatch(/Fast/);
    expect(fast?.getAttribute("aria-checked")).toBe("false");
    expect(fast?.querySelector(".settings-switch:not(.on)")).toBeTruthy();
  });

  it("hides the rate chip in compact mode", () => {
    render(
      <ModelPicker
        compact
        providers={providers}
        providerId="anthropic"
        model="claude-sonnet-4-5"
        onChange={() => undefined}
      />,
    );
    expect(host.querySelector(".model-picker-combined-label")?.textContent).toBe(
      "Anthropic (off) · claude-sonnet-4-5",
    );
    act(() => {
      host
        .querySelector("[aria-label='Model']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(
      [...host.querySelectorAll(".model-picker-combined [role='menuitem']")].map(
        (el) => el.textContent,
      ),
    ).toEqual(expect.arrayContaining(["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"]));
    expect(host.querySelector(".model-cost-chip")).toBeNull();
    expect(host.querySelector('[aria-label="Model options"]')).toBeNull();
    expect(host.querySelector(".model-cost-table")).toBeNull();
    expect(host.textContent).not.toMatch(/Compare providers/);
  });
});
