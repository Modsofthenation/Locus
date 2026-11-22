import { describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ProviderUsage } from "@locus/shared";
import { formatResetsIn, formatUsageAmount, ProviderUsagePanel } from "./ProviderUsagePanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-11-13T12:00:00.000Z");

function row(patch: Partial<ProviderUsage>): ProviderUsage {
  return {
    providerId: "codex-cli",
    providerName: "Codex CLI",
    kind: "codex-cli",
    ok: true,
    source: "oauth",
    windows: [],
    fetchedAt: new Date(NOW).toISOString(),
    ...patch,
  };
}

async function mount(load: () => Promise<{ usage: ProviderUsage[] }>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root: Root | undefined;
  await act(async () => {
    root = createRoot(host);
    root.render(<ProviderUsagePanel load={load} now={() => NOW} />);
  });
  return {
    host,
    unmount: () => {
      act(() => root?.unmount());
      host.remove();
    },
  };
}

describe("ProviderUsagePanel", () => {
  it("renders a meter per usage window with reset time", async () => {
    const load = vi.fn(async () => ({
      usage: [
        row({
          plan: "Pro",
          windows: [
            {
              id: "five_hour",
              label: "5-hour",
              usedPercent: 92,
              resetsAt: "2026-11-13T14:30:00.000Z",
            },
          ],
        }),
        row({
          providerId: "kiro-cli",
          providerName: "Kiro CLI",
          kind: "kiro-cli",
          ok: false,
          message: "Kiro CLI is not signed in. Run `kiro-cli login`.",
        }),
      ],
    }));
    const view = await mount(load);
    const codex = view.host.querySelector("[data-testid='provider-usage-codex-cli']");
    expect(codex?.textContent).toContain("Pro");
    expect(codex?.textContent).toContain("92% used");
    expect(codex?.textContent).toContain("Resets in 2h 30m");
    expect(codex?.querySelector(".provider-usage-bar.high")).toBeTruthy();
    expect(
      view.host.querySelector("[data-testid='provider-usage-kiro-cli']")?.textContent,
    ).toContain("kiro-cli login");
    view.unmount();
  });

  it("stays hidden when no CLI reports usage or the request fails", async () => {
    const empty = await mount(async () => ({ usage: [] }));
    expect(empty.host.querySelector("[data-testid='provider-usage']")).toBeNull();
    empty.unmount();
    const failed = await mount(async () => {
      throw new Error("offline");
    });
    expect(failed.host.querySelector("[data-testid='provider-usage']")).toBeNull();
    failed.unmount();
  });

  it("forces a refresh from the button", async () => {
    const load = vi.fn(async () => ({ usage: [row({ windows: [] })] }));
    const view = await mount(load);
    const button = view.host.querySelector("button");
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(load).toHaveBeenLastCalledWith({ refresh: true });
    view.unmount();
  });
});

describe("usage formatting", () => {
  it("formats amounts by unit", () => {
    expect(formatUsageAmount({ id: "m", label: "m", used: 12.34, limit: 20, unit: "usd" })).toBe(
      "$12.34 of $20.00",
    );
    expect(
      formatUsageAmount({ id: "m", label: "m", used: 500, limit: 1000, unit: "credits" }),
    ).toBe("500 of 1000 credits");
  });

  it("formats reset countdowns", () => {
    expect(formatResetsIn("2026-11-13T12:20:00.000Z", NOW)).toBe("Resets in 20m");
    expect(formatResetsIn("2026-11-20T12:00:00.000Z", NOW)).toBe("Resets in 7d");
    expect(formatResetsIn("2026-11-14T12:00:00.000Z", NOW, true)).toBe("Expires in 24h");
  });
});
