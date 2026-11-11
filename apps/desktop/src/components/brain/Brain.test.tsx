import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type Dispatch } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyBrain, type BrainDocument, type BrainNode } from "@locus/shared";
import { BrainPane, layoutBrainGraph, shortBrainGraphLabel } from "./Brain";
import { api } from "@/lib/api";
import { BRAIN_VIEW_PREFS_KEY } from "@/lib/brainViewPrefs";
import { Store, initialState, type Action, type UiState } from "@/state/store";

vi.mock("@/lib/api", () => ({
  api: {
    brain: vi.fn(),
    brainBuild: vi.fn(),
    brainRemember: vi.fn(),
    brainSearch: vi.fn(),
    brainExport: vi.fn(),
    brainIngest: vi.fn(),
    brainCorrect: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

function sample(): BrainDocument {
  const doc = emptyBrain();
  return {
    ...doc,
    nodes: [
      {
        id: "service:billing-gateway",
        type: "Service",
        name: "billing-gateway",
        description: "Owns charge APIs",
        evidence: "apps/billing/src/app.ts:12",
        repo: "https://github.com/acme/billing",
        createdBy: "indexer:test",
        updatedBy: "indexer:test",
        createdAt: doc.updatedAt,
        updatedAt: doc.updatedAt,
      },
      {
        id: "apiendpoint:charge",
        type: "APIEndpoint",
        name: "POST /v1/charge",
        evidence: "apps/billing/src/routes.ts:4",
        repo: "https://github.com/acme/billing",
        createdBy: "indexer:test",
        updatedBy: "indexer:test",
        createdAt: doc.updatedAt,
        updatedAt: doc.updatedAt,
      },
      {
        id: "service:payments",
        type: "Service",
        name: "payments",
        evidence: "apps/payments/src/app.ts:1",
        repo: "/tmp/payments",
        createdBy: "indexer:test",
        updatedBy: "indexer:test",
        createdAt: doc.updatedAt,
        updatedAt: doc.updatedAt,
      },
    ],
    edges: [
      {
        id: "e-owns-charge",
        type: "OWNS",
        from: "service:billing-gateway",
        to: "apiendpoint:charge",
        createdBy: "indexer:test",
        createdAt: doc.updatedAt,
      },
    ],
    repos: [
      {
        url: "https://github.com/acme/billing",
        path: "/tmp/billing",
        indexedAt: doc.updatedAt,
      },
      {
        path: "/tmp/payments",
        indexedAt: doc.updatedAt,
      },
    ],
    memories: [
      {
        id: "m1",
        claim: "we never bill from the worker",
        kind: "gotcha",
        source: "user_stated",
        ambient: true,
        evidenceCount: 1,
        contradictionCount: 0,
        repo: "https://github.com/acme/billing",
        createdAt: doc.updatedAt,
      },
      {
        id: "m2",
        claim: "payments keep idempotency keys",
        kind: "convention",
        source: "agent",
        ambient: false,
        evidenceCount: 0,
        contradictionCount: 0,
        repo: "/tmp/payments",
        createdAt: doc.updatedAt,
      },
    ],
    activity: [
      {
        id: "a1",
        kind: "index",
        text: "Indexed billing",
        at: doc.updatedAt,
        repo: "https://github.com/acme/billing",
      },
      {
        id: "a2",
        kind: "remember",
        text: "Legacy unscoped event",
        at: doc.updatedAt,
      },
    ],
    corrections: [
      {
        id: "fix:abc",
        nodeId: "service:billing-gateway",
        claim: "billing-gateway",
        reason: "Auth owns this, not billing",
        status: "open",
        actor: "agent",
        createdAt: doc.updatedAt,
      },
    ],
  };
}

function clickTab(host: HTMLElement, label: string): void {
  const tab = [...host.querySelectorAll('[role="tab"]')].find((btn) => btn.textContent === label);
  expect(tab).toBeTruthy();
  act(() => {
    tab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("BrainPane", () => {
  let root: Root | undefined;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root?.unmount());
    host.remove();
    localStorage.removeItem(BRAIN_VIEW_PREFS_KEY);
  });

  function render(state: UiState = { ...initialState, section: "brain" }) {
    host = document.createElement("div");
    document.body.appendChild(host);
    const dispatch = vi.fn() as unknown as Dispatch<Action>;
    root = createRoot(host);
    act(() => {
      root!.render(
        <Store.Provider value={{ state, dispatch }}>
          <BrainPane />
        </Store.Provider>,
      );
    });
    return { dispatch };
  }

  it("shows the empty card then lists nodes after load", async () => {
    vi.mocked(api.brain).mockResolvedValue(sample());
    render();
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector(".brain-pane")).toBeTruthy();
    expect(host.textContent).toContain("billing-gateway");
    expect(host.querySelector('[aria-label="Brain section"]')).toBeTruthy();
    clickTab(host, "Memories");
    expect(host.textContent).toContain("we never bill from the worker");
    expect(css).toMatch(/\.brain-pane \{[\s\S]*?display:\s*flex/);
    expect(css).toMatch(/\.brain-body-center \{[\s\S]*?place-items:\s*center/);
    expect(css).toMatch(/\.brain-segments \{/);
    expect(css).toMatch(/\.brain-memory-summary \{/);
    expect(css).toMatch(/\.brain-graph-toolbar \{/);
    expect(css).toMatch(/\.brain-inspector \{/);
    expect(css).toMatch(/\.brain-graph-card-name \{/);
  });

  it("centers the empty start and offers a folder browse control", async () => {
    vi.mocked(api.brain).mockResolvedValue(emptyBrain());
    render();
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector(".brain-pane.brain-empty")).toBeTruthy();
    expect(host.querySelector(".brain-body-center .brain-start")).toBeTruthy();
    expect([...host.querySelectorAll("button")].some((btn) => btn.textContent === "Browse")).toBe(
      true,
    );
  });

  it("hides data actions and the extra index banner until the brain has data", async () => {
    vi.mocked(api.brain).mockResolvedValue(emptyBrain());
    render();
    await act(async () => {
      await Promise.resolve();
    });
    const labels = [...host.querySelectorAll("button")].map((btn) => btn.textContent);
    expect(labels).not.toContain("Export");
    expect(labels).not.toContain("Pause ingest");
    expect(labels).not.toContain("Index folder");
    expect(host.querySelector("[data-testid='feature-hint-brain-memory']")).toBeNull();
    // The Repo folder + Build form is the one index entry point.
    expect(labels).toContain("Build");
    expect(labels).toContain("Review");
    expect(labels).not.toContain("Inbox");
  });

  it("shows Export and Pause ingest once the brain has data", async () => {
    vi.mocked(api.brain).mockResolvedValue(sample());
    render();
    await act(async () => {
      await Promise.resolve();
    });
    const labels = [...host.querySelectorAll("button")].map((btn) => btn.textContent);
    expect(labels).toContain("Export");
    expect(labels).toContain("Pause ingest");
  });

  it("searches the brain from the Memories segment", async () => {
    vi.mocked(api.brain).mockResolvedValue(sample());
    vi.mocked(api.brainSearch).mockResolvedValue({ output: "- Service service:billing-gateway" });
    render();
    await act(async () => {
      await Promise.resolve();
    });
    clickTab(host, "Memories");
    const input = host.querySelector(
      'input[aria-label="Search the whole brain"]',
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "billing");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const forms = [...host.querySelectorAll("form")];
      const search = forms.find((form) =>
        form.querySelector('input[aria-label="Search the whole brain"]'),
      );
      search?.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(api.brainSearch).toHaveBeenCalledWith("billing");
    expect(host.querySelector(".brain-search-out")?.textContent).toContain("billing-gateway");
  });

  it("accepts a graph correction from Inbox", async () => {
    const loaded = sample();
    vi.mocked(api.brain).mockResolvedValue(loaded);
    vi.mocked(api.brainCorrect).mockResolvedValue({
      ...loaded,
      corrections: loaded.corrections?.map((row) => ({ ...row, status: "accepted" as const })),
      output: "Accepted fix:abc.",
    });
    render();
    await act(async () => {
      await Promise.resolve();
    });
    clickTab(host, "Review (1)");
    expect(host.querySelector("[data-testid='brain-inbox']")?.textContent).toMatch(
      /Auth owns this/,
    );
    await act(async () => {
      const accept = [...host.querySelectorAll("button")].find(
        (btn) => btn.textContent === "Accept",
      );
      accept?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(api.brainCorrect).toHaveBeenCalledWith({ id: "fix:abc", action: "accepted" });
  });

  it("passes the selected repo when remembering", async () => {
    vi.mocked(api.brain).mockResolvedValue(sample());
    vi.mocked(api.brainRemember).mockResolvedValue({
      ...sample(),
      output: "Remembered.",
    });
    render();
    await act(async () => {
      await Promise.resolve();
    });
    const billing = [...host.querySelectorAll(".brain-graph-scope")].find(
      (btn) => btn.textContent === "billing",
    );
    act(() => {
      billing?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    clickTab(host, "Memories");
    const textarea = host.querySelector(
      'textarea[aria-label="Fact to remember"]',
    ) as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setter.call(textarea, "scoped remember claim");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const form = [...host.querySelectorAll("form")].find((row) =>
        row.querySelector('textarea[aria-label="Fact to remember"]'),
      );
      form
        ?.querySelector('button[type="submit"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(api.brainRemember).toHaveBeenCalledWith(
      "scoped remember claim",
      "https://github.com/acme/billing",
    );
  });

  it("shows scoped graph stats under a repo chip", async () => {
    vi.mocked(api.brain).mockResolvedValue(sample());
    render();
    await act(async () => {
      await Promise.resolve();
    });
    const payments = [...host.querySelectorAll(".brain-graph-scope")].find(
      (btn) => btn.textContent === "payments",
    );
    act(() => {
      payments?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const stats = [...host.querySelectorAll(".brain-stat")].map((row) => row.textContent);
    expect(stats.some((text) => text === "1nodes")).toBe(true);
    expect(stats.some((text) => text === "1memories")).toBe(true);
    expect(stats.some((text) => text === "1indexed repos")).toBe(true);
  });

  it("inspects a selected claim with purpose, edges, and graph controls", async () => {
    vi.mocked(api.brain).mockResolvedValue(sample());
    render();
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='brain-graph-toolbar']")).toBeTruthy();
    expect(host.querySelector("[data-testid='brain-graph-layout']")).toBeTruthy();
    const card = host.querySelector('[data-node-id="service:billing-gateway"]');
    expect(card).toBeTruthy();
    act(() => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const inspector = host.querySelector("[data-testid='brain-graph-inspector']");
    expect(inspector).toBeTruthy();
    expect(inspector?.textContent).toContain("Owns charge APIs");
    expect(inspector?.textContent).toMatch(/published|process or package/i);
    expect(
      host.querySelector("[data-testid='brain-graph-inspector-outputs']")?.textContent,
    ).toContain("POST /v1/charge");
    expect(
      host.querySelector("[data-testid='brain-graph-inspector-degree']")?.textContent,
    ).toContain("1 out");
    const isolate = host.querySelector("[data-testid='brain-graph-isolate']") as HTMLButtonElement;
    act(() => {
      isolate.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector("[data-testid='brain-graph-isolate-clear']")).toBeTruthy();
    expect(host.querySelector('[data-node-id="service:payments"]')).toBeNull();
    expect(host.querySelector('[data-node-id="apiendpoint:charge"]')).toBeTruthy();
  });

  it("drops a stale path isolate when the repo scope no longer contains that node", async () => {
    vi.mocked(api.brain).mockResolvedValue(sample());
    render();
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      host
        .querySelector('[data-node-id="service:billing-gateway"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      host
        .querySelector("[data-testid='brain-graph-isolate']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector("[data-testid='brain-graph-isolate-clear']")).toBeTruthy();
    const payments = [...host.querySelectorAll(".brain-graph-scope")].find(
      (btn) => btn.textContent === "payments",
    );
    act(() => {
      payments?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector("[data-testid='brain-graph-isolate-clear']")).toBeNull();
    expect(host.querySelector('[data-node-id="service:payments"]')).toBeTruthy();
  });

  it("lets a pane click close the inspector after pinning a different node", async () => {
    vi.mocked(api.brain).mockResolvedValue(sample());
    render();
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      host
        .querySelector('[data-node-id="service:billing-gateway"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      host
        .querySelector("[data-testid='brain-graph-pin']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector("[data-testid='brain-graph-pin']")?.textContent).toBe("Unpin");
    act(() => {
      host
        .querySelector('[data-node-id="service:payments"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector("[data-testid='brain-graph-pin']")?.textContent).toBe("Pin");
    const svg = host.querySelector(".brain-graph") as SVGSVGElement;
    act(() => {
      svg.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 4, clientY: 4 }),
      );
      svg.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: 4, clientY: 4 }),
      );
    });
    expect(host.querySelector("[data-testid='brain-graph-inspector']")).toBeNull();
  });

  it("keeps at least one present family visible", async () => {
    vi.mocked(api.brain).mockResolvedValue(sample());
    render();
    await act(async () => {
      await Promise.resolve();
    });
    const services = host.querySelector("[data-testid='brain-graph-family-services']");
    const apis = host.querySelector("[data-testid='brain-graph-family-apis']");
    expect(services).toBeTruthy();
    expect(apis).toBeTruthy();
    act(() => {
      services?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector('[data-node-id="service:billing-gateway"]')).toBeNull();
    expect(host.querySelector('[data-node-id="apiendpoint:charge"]')).toBeTruthy();
    act(() => {
      apis?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector('[data-node-id="apiendpoint:charge"]')).toBeTruthy();
    expect(apis?.getAttribute("aria-pressed")).toBe("true");
  });

  it("filters graph, memories, and activity by shared repo scope", async () => {
    vi.mocked(api.brain).mockResolvedValue(sample());
    render();
    await act(async () => {
      await Promise.resolve();
    });
    const scopes = host.querySelector('[aria-label="Brain repo filter"]');
    expect(scopes).toBeTruthy();
    expect(scopes?.textContent).toContain("All");
    expect(scopes?.textContent).toContain("billing");
    expect(scopes?.textContent).toContain("payments");
    expect(host.textContent).toContain("billing-gateway");
    expect(host.textContent).toContain("payments");
    const payments = [...host.querySelectorAll(".brain-graph-scope")].find(
      (btn) => btn.textContent === "payments",
    );
    expect(payments).toBeTruthy();
    act(() => {
      payments?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector(".brain-graph")?.textContent).toContain("payments");
    expect(host.querySelector(".brain-graph")?.textContent).not.toContain("billing-gateway");

    clickTab(host, "Memories");
    expect(host.textContent).toContain("payments keep idempotency keys");
    expect(host.textContent).not.toContain("we never bill from the worker");

    clickTab(host, "Activity");
    expect(host.querySelector("[data-testid='brain-activity']")).toBeNull();
    expect(host.textContent).toContain("No activity attributed to this checkout yet.");

    const billing = [...host.querySelectorAll(".brain-graph-scope")].find(
      (btn) => btn.textContent === "billing",
    );
    act(() => {
      billing?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector("[data-testid='brain-activity']")?.textContent).toContain(
      "Indexed billing",
    );
    expect(host.querySelector("[data-testid='brain-activity']")?.textContent).not.toContain(
      "Legacy unscoped event",
    );
  });

  it("expands a memory row and filters by kind / ambient", async () => {
    vi.mocked(api.brain).mockResolvedValue(sample());
    render();
    await act(async () => {
      await Promise.resolve();
    });
    clickTab(host, "Memories");
    expect(host.querySelectorAll(".brain-memory-row")).toHaveLength(2);
    const gotcha = [...host.querySelectorAll(".brain-graph-scope")].find(
      (btn) => btn.textContent === "gotcha",
    );
    act(() => {
      gotcha?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelectorAll(".brain-memory-row")).toHaveLength(1);
    expect(host.textContent).toContain("we never bill from the worker");

    const summary = host.querySelector(".brain-memory-summary") as HTMLButtonElement;
    act(() => {
      summary.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector(".brain-memory-detail")).toBeTruthy();
    expect(host.textContent).toContain("source · user_stated");
    expect(host.textContent).toContain("Copy id");

    const ambient = host.querySelector(".brain-ambient-toggle input") as HTMLInputElement;
    act(() => {
      ambient.click();
    });
    expect(ambient.checked).toBe(true);
    expect(host.querySelectorAll(".brain-memory-row")).toHaveLength(1);

    act(() => {
      [...host.querySelectorAll('[aria-label="Memory kind"] .brain-graph-scope')]
        .find((btn) => btn.textContent === "convention")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).toContain("No memories in this filter.");
  });

  it("restores the last Brain segment and repo scope from localStorage", async () => {
    localStorage.setItem(
      BRAIN_VIEW_PREFS_KEY,
      JSON.stringify({
        segment: "activity",
        repoKey: "https://github.com/acme/billing",
      }),
    );
    vi.mocked(api.brain).mockResolvedValue(sample());
    render();
    await act(async () => {
      await Promise.resolve();
    });
    const billing = [
      ...host.querySelectorAll('[aria-label="Brain repo filter"] .brain-graph-scope'),
    ].find((btn) => btn.textContent === "billing");
    expect(billing?.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector("[data-testid='brain-activity']")?.textContent).toContain(
      "Indexed billing",
    );
    expect(host.querySelector("[data-testid='brain-activity']")?.textContent).not.toContain(
      "Legacy unscoped event",
    );
  });
});

describe("brain graph layout", () => {
  function node(partial: Partial<BrainNode> & Pick<BrainNode, "id" | "type" | "name">): BrainNode {
    return {
      evidence: "src/app.ts:1",
      createdBy: "test",
      updatedBy: "test",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      ...partial,
    };
  }

  it("shortens route labels and lays APIs in a later column than services", () => {
    expect(shortBrainGraphLabel("GET /api/v1/health/check", 14)).toMatch(/^GET \//);
    expect(shortBrainGraphLabel("GET /api/v1/health/check", 14).length).toBeLessThanOrEqual(14);
    expect(shortBrainGraphLabel("@locus/cli", 14)).toBe("@locus/cli");

    const service = node({ id: "service:cli", type: "Service", name: "@locus/cli" });
    const endpoints = Array.from({ length: 8 }, (_, i) =>
      node({
        id: `api:${i}`,
        type: "APIEndpoint",
        name: `GET /api/route-${i}/details`,
      }),
    );
    const packed = layoutBrainGraph([service, ...endpoints]);
    expect(packed.nodes).toHaveLength(9);
    const svc = packed.nodes.find((row) => row.type === "Service")!;
    const xs = packed.nodes.filter((row) => row.type === "APIEndpoint").map((row) => row.x);
    const ys = new Set(
      packed.nodes.filter((row) => row.type === "APIEndpoint").map((row) => row.y),
    );
    expect(ys.size).toBeGreaterThan(1);
    expect(Math.min(...xs)).toBeGreaterThan(svc.x);
    expect(packed.height).toBeGreaterThan(280);
  });
});
