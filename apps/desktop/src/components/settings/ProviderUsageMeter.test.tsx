import type { AiProvider, LocusConfig, ProviderUsage } from "@locus/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import {
  providerUsageSnapshot,
  refreshProviderUsage,
  resetProviderUsageStore,
} from "@/lib/providerUsageStore";
import { Store, initialState } from "@/state/store";
import { ProviderUsageMeter, usageMeterTitle } from "./ProviderUsageMeter";
import { PlanUsageModal } from "./PlanUsageModal";
import { ModelPicker } from "./ModelPicker";
import { paletteItems } from "@/lib/palette";

vi.mock("@/lib/api", () => ({ api: { providerUsage: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-11-15T12:00:00.000Z");

const codex = {
  id: "codex",
  name: "Codex CLI",
  kind: "codex-cli",
  enabled: true,
  models: ["gpt-5"],
  defaultModel: "gpt-5",
} as unknown as AiProvider;
const openai = {
  id: "openai",
  name: "OpenAI",
  kind: "openai",
  enabled: true,
  models: ["gpt-4.1"],
  defaultModel: "gpt-4.1",
} as unknown as AiProvider;

function usage(pct: number): ProviderUsage {
  return {
    providerId: "codex",
    providerName: "Codex CLI",
    kind: "codex-cli",
    ok: true,
    source: "oauth",
    plan: "Plus",
    windows: [
      { id: "five_hour", label: "5-hour", usedPercent: pct, resetsAt: "2026-11-15T14:00:00.000Z" },
      { id: "weekly", label: "Weekly", usedPercent: 12 },
    ],
    fetchedAt: new Date(NOW).toISOString(),
  };
}

describe("plan usage access", () => {
  let host: HTMLElement;
  let root: Root;
  let dispatch: ReturnType<typeof vi.fn>;

  async function mount(node: React.ReactNode, state: Partial<typeof initialState> = {}) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <Store.Provider
          value={{ state: { ...initialState, ...state }, dispatch: dispatch as never }}
        >
          {node}
        </Store.Provider>,
      );
    });
  }

  beforeEach(() => {
    resetProviderUsageStore();
    dispatch = vi.fn();
    vi.mocked(api.providerUsage).mockReset();
  });

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
  });

  it("shares one fetch and skips fresh reloads", async () => {
    vi.mocked(api.providerUsage).mockResolvedValue({ usage: [usage(40)] });
    await Promise.all([refreshProviderUsage(), refreshProviderUsage()]);
    expect(api.providerUsage).toHaveBeenCalledTimes(1);
    await refreshProviderUsage();
    expect(api.providerUsage).toHaveBeenCalledTimes(1);
    await refreshProviderUsage({ force: true });
    expect(api.providerUsage).toHaveBeenLastCalledWith({ refresh: true });
    expect(providerUsageSnapshot().rows?.[0]?.providerId).toBe("codex");
  });

  it("shows the busiest window next to the model and opens the dialog", async () => {
    vi.mocked(api.providerUsage).mockResolvedValue({ usage: [usage(93)] });
    await mount(<ProviderUsageMeter provider={codex} now={() => NOW} />);
    const meter = host.querySelector("[data-testid='usage-meter']") as HTMLButtonElement;
    expect(meter.textContent).toBe("5-hour93%");
    expect(meter.className).toContain("high");
    expect(meter.title).toContain("5-hour: 93% used · resets in 2h");
    act(() => meter.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "planUsage", open: true, providerId: "codex" });
  });

  it("stays hidden for API-key providers and does not fetch", async () => {
    await mount(<ProviderUsageMeter provider={openai} />);
    expect(host.querySelector("[data-testid='usage-meter']")).toBeNull();
    expect(api.providerUsage).not.toHaveBeenCalled();
  });

  it("puts usage on the provider row in the compact model menu", async () => {
    vi.mocked(api.providerUsage).mockResolvedValue({ usage: [usage(55)] });
    await mount(
      <ModelPicker
        compact
        providers={[codex, openai]}
        providerId="codex"
        model="gpt-5"
        onChange={() => undefined}
      />,
    );
    expect(host.querySelector("[data-testid='usage-meter']")?.className).not.toContain("mid");
    act(() => {
      (host.querySelector(".model-picker-combined-toggle") as HTMLButtonElement).click();
    });
    expect(document.body.textContent).toContain("Codex CLI · 55% used");
    const item = [...document.querySelectorAll("button")].find(
      (el) => el.textContent === "Plan usage…",
    );
    act(() => item!.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "planUsage", open: true, providerId: "codex" });
  });

  it("dialog lists the provider in use first", async () => {
    vi.mocked(api.providerUsage).mockResolvedValue({
      usage: [
        { ...usage(10), providerId: "claude", providerName: "Claude Code", kind: "claude-code" },
        usage(70),
      ],
    });
    await mount(<PlanUsageModal />, { planUsage: { providerId: "codex" } });
    const cards = [...document.querySelectorAll(".provider-usage-card")];
    expect(cards[0]?.textContent).toContain("Codex CLI");
    expect(cards[0]?.textContent).toContain("In use");
  });

  it("adds a palette command when a CLI provider is on", () => {
    const config = { providers: [codex, openai] } as unknown as LocusConfig;
    const items = paletteItems({ sessions: [], config });
    expect(items.find((row) => row.id === "plan-usage")?.hint).toBe("Quota left · Codex CLI");
    const none = paletteItems({
      sessions: [],
      config: { providers: [openai] } as unknown as LocusConfig,
    });
    expect(none.some((row) => row.id === "plan-usage")).toBe(false);
  });

  it("formats a multi-line tooltip", () => {
    expect(usageMeterTitle(usage(20), NOW).split("\n")).toEqual([
      "Codex CLI · Plus plan usage",
      "5-hour: 20% used · resets in 2h",
      "Weekly: 12% used",
      "Click for details",
    ]);
  });
});
