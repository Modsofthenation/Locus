import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type Dispatch } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GrafanaPane } from "./Grafana";
import { api } from "@/lib/api";
import { Store, initialState, type Action, type UiState } from "@/state/store";
import type { AgentSession, GrafanaDashboardQueryResult } from "@locus/shared";
import { selectValue } from "@/lib/selectControl";

vi.mock("@/lib/api", () => ({
  api: {
    grafanaStatus: vi.fn(),
    grafanaRecents: vi.fn(),
    grafanaDashboards: vi.fn(),
    grafanaDashboard: vi.fn(),
    grafanaDashboardQuery: vi.fn(),
    grafanaQuery: vi.fn(),
    grafanaTrace: vi.fn(),
    grafanaBrief: vi.fn(),
    grafanaInvestigate: vi.fn(),
    grafanaAlerts: vi.fn(),
    grafanaPins: vi.fn(),
    grafanaPin: vi.fn(),
    grafanaUnpin: vi.fn(),
    grafanaTraceHop: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

describe("GrafanaPane", () => {
  let root: Root | undefined;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root?.unmount());
    host.remove();
  });

  function render(state: UiState = { ...initialState, section: "grafana" }) {
    host = document.createElement("div");
    document.body.appendChild(host);
    const dispatch = vi.fn() as unknown as Dispatch<Action>;
    root = createRoot(host);
    act(() => {
      root!.render(
        <Store.Provider value={{ state, dispatch }}>
          <GrafanaPane />
        </Store.Provider>,
      );
    });
    return { dispatch };
  }

  it("asks to add Grafana when the integration is missing", async () => {
    vi.mocked(api.grafanaStatus).mockResolvedValue({ connected: false, datasources: [] });
    vi.mocked(api.grafanaRecents).mockResolvedValue([]);
    vi.mocked(api.grafanaDashboards).mockResolvedValue([]);
    const { dispatch } = render();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toMatch(/Grafana explorer/);
    expect(host.textContent).toMatch(/Add Grafana/);
    const add = [...host.querySelectorAll("button")].find((el) => el.textContent === "Add Grafana");
    act(() => add?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "settings", open: true }),
    );
  });

  it("runs a query, traces a file into a repo, and starts Investigate", async () => {
    vi.mocked(api.grafanaStatus).mockResolvedValue({
      connected: true,
      baseUrl: "https://grafana.example.com",
      datasources: [{ name: "logs", type: "elasticsearch", isDefault: true }],
    });
    vi.mocked(api.grafanaRecents).mockResolvedValue([]);
    vi.mocked(api.grafanaDashboards).mockResolvedValue([
      { uid: "check", title: "Checkout", url: "https://g/d/check" },
    ]);
    vi.mocked(api.grafanaQuery).mockResolvedValue({
      lucene: "logger.level:error",
      explore_url: "https://grafana.example.com/explore",
      from: "now-1h",
      to: "now",
      count: 1,
      histogram: [{ t: 1, count: 3 }],
      logs: [
        {
          timestamp: "2026-10-20T09:00:00.000Z",
          level: "error",
          message: "TimeoutError at src/charge.ts:12",
          source: { service: "billing" },
        },
      ],
      trace: {
        signals: [{ kind: "file", value: "src/charge.ts", line: 12 }],
        links: [
          {
            repoId: "r1",
            repoName: "billing",
            url: "https://github.com/acme/billing",
            path: "src/charge.ts",
            line: 12,
            reason: "file src/charge.ts",
            score: 10,
          },
        ],
        suggestedQueries: ["logger.level:error"],
      },
      links: [
        {
          repoId: "r1",
          repoName: "billing",
          url: "https://github.com/acme/billing",
          path: "src/charge.ts",
          line: 12,
          reason: "file src/charge.ts",
          score: 10,
        },
      ],
    });
    vi.mocked(api.grafanaInvestigate).mockResolvedValue({ sessionId: "s1", created: true });
    const { dispatch } = render();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Checkout");
    const form = host.querySelector(".grafana-toolbar") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.grafanaQuery).toHaveBeenCalledWith(
      expect.objectContaining({ query: "logger.level:error", from: "now-1h", enrich: true }),
    );
    expect(host.textContent).toMatch(/TimeoutError/);
    expect(host.textContent).toMatch(/billing/);
    expect(host.textContent).toMatch(/charge\.ts/);
    expect(host.querySelector(".grafana-source-json")).toBeTruthy();
    expect(host.querySelector(".grafana-fields")?.textContent).toMatch(/billing/);
    expect(host.querySelector("[data-testid='grafana-brief']")?.textContent).toMatch(
      /TimeoutError|log/i,
    );
    const openRepo = [...host.querySelectorAll(".grafana-links button")].find((el) =>
      el.textContent?.includes("billing"),
    );
    act(() => openRepo?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(dispatch).toHaveBeenCalledWith({ type: "selectRepo", id: "r1" });
    const investigate = host.querySelector(".grafana-investigate") as HTMLFormElement;
    await act(async () => {
      investigate.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.grafanaInvestigate).toHaveBeenCalledWith(
      expect.objectContaining({ query: "logger.level:error", repoId: "r1" }),
    );
    expect(dispatch).toHaveBeenCalledWith({ type: "select", id: "s1" });
    expect(css).toMatch(/\.grafana-pane \{[\s\S]*?display:\s*flex/);
    expect(css).toMatch(/\.grafana-log-msg mark/);
    expect(css).toMatch(/\.grafana-fields/);
    expect(css).toMatch(/\.grafana-dash-grid \{[\s\S]*?grid-template-columns:\s*repeat\(24/);
  });

  it("lays dashboard tags out as chips and keeps pin actions beside titles", async () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    vi.mocked(api.grafanaStatus).mockResolvedValue({
      connected: true,
      baseUrl: "https://grafana.example.com",
      datasources: [{ name: "logs", type: "elasticsearch", isDefault: true }],
    });
    vi.mocked(api.grafanaRecents).mockResolvedValue([
      {
        id: "q1",
        query: "logger.level:error",
        from: "now-1h",
        to: "now",
        at: "2026-10-21T00:00:00.000Z",
        count: 10000,
      },
    ]);
    vi.mocked(api.grafanaDashboards).mockResolvedValue([
      {
        uid: "cw",
        title: "CloudWatch logs",
        folderTitle: "Test",
        tags: ["cloudwatch", "monitoringartist", "postgres"],
      },
      { uid: "pg", title: "Postgres", folderTitle: "Test", tags: ["postgres", "database"] },
      { uid: "bb", title: "Blackbox", tags: ["blackbox", "prometheus"] },
    ]);
    vi.mocked(api.grafanaAlerts).mockResolvedValue([]);
    vi.mocked(api.grafanaPins).mockResolvedValue([]);
    render();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const recent = host.querySelector(".grafana-rail section ul button") as HTMLElement;
    const pin = host.querySelector(".grafana-pin") as HTMLElement;
    const tag = host.querySelector(".grafana-tags .btn") as HTMLElement;
    const row = host.querySelector(".grafana-dash-row") as HTMLElement;
    const pane = host.querySelector(".grafana-pane") as HTMLElement;
    expect(tag.textContent).toBe("All");
    expect(host.querySelectorAll(".grafana-tags .btn").length).toBeGreaterThan(3);
    expect(getComputedStyle(recent).width).toBe("100%");
    expect(getComputedStyle(pin).width).toBe("auto");
    expect(getComputedStyle(tag).width).toBe("auto");
    expect(getComputedStyle(tag).flex).toContain("0 0 auto");
    expect(getComputedStyle(row).flexDirection).toBe("row");
    expect(getComputedStyle(host.querySelector(".grafana-tags")!).flexWrap).toBe("wrap");
    expect(getComputedStyle(host.querySelector(".grafana-dash-row .muted")!).whiteSpace).toBe(
      "nowrap",
    );
    expect(pane.classList.contains("grafana-empty")).toBe(false);
    expect(css).toMatch(/\.grafana-pane:not\(\.grafana-empty\)\s*\{[^}]*background:\s*var\(--bg\)/);
    expect(css).toMatch(/\.grafana-rail \.grafana-pin\s*\{[^}]*width:\s*auto/);
    expect(css).toMatch(/\.grafana-tags \.btn\s*\{[^}]*width:\s*auto/);
    style.remove();
  });

  it("opens a dashboard in the pane instead of a new tab", async () => {
    vi.mocked(api.grafanaStatus).mockResolvedValue({
      connected: true,
      baseUrl: "https://grafana.example.com",
      datasources: [{ name: "logs", type: "elasticsearch", isDefault: true }],
    });
    vi.mocked(api.grafanaRecents).mockResolvedValue([]);
    vi.mocked(api.grafanaDashboards).mockResolvedValue([
      { uid: "check", title: "Checkout", url: "https://g/d/check", tags: ["prod"] },
    ]);
    vi.mocked(api.grafanaDashboardQuery).mockResolvedValue({
      uid: "check",
      title: "Checkout",
      url: "https://grafana.example.com/d/check/checkout",
      from: "now-6h",
      to: "now",
      panels: [
        {
          id: 2,
          title: "Error rate",
          type: "timeseries",
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          queries: ["rate(http_errors[5m])"],
          series: [
            {
              name: "checkout",
              points: [
                { t: 1_000, value: 1 },
                { t: 2_000, value: 4 },
              ],
            },
          ],
        },
        {
          id: 3,
          title: "Notes",
          type: "text",
          gridPos: { x: 12, y: 0, w: 12, h: 4 },
          queries: [],
          text: "Watch checkout timeouts.",
        },
        {
          id: 4,
          title: "Error logs",
          type: "logs",
          gridPos: { x: 0, y: 8, w: 24, h: 8 },
          queries: ["logger.level:error"],
          logs: [{ timestamp: "2026-10-20T09:00:00.000Z", message: "TimeoutError" }],
        },
      ],
    });
    render();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const dashBtn = [...host.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Checkout"),
    );
    expect(host.querySelector("a[href='https://g/d/check']")).toBeNull();
    await act(async () => {
      dashBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.grafanaDashboardQuery).toHaveBeenCalledWith("check", {});
    expect(host.querySelector("[data-testid='grafana-dashboard']")?.textContent).toMatch(
      /Error rate/,
    );
    expect(host.querySelector("[aria-label='Refresh']")).toBeTruthy();
    expect(host.textContent).toContain("Watch checkout timeouts.");
    expect(host.textContent).toContain("TimeoutError");
    const investigatePanel = [...host.querySelectorAll("button")].find(
      (el) => el.textContent === "Investigate",
    );
    vi.mocked(api.grafanaInvestigate).mockResolvedValue({ sessionId: "s-panel", created: true });
    await act(async () => {
      investigatePanel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.grafanaInvestigate).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "rate(http_errors[5m])",
        note: expect.stringContaining("Error rate"),
        panelType: "timeseries",
      }),
    );
    expect([...host.querySelectorAll("button")].some((el) => el.textContent === "Open query")).toBe(
      true,
    );
    const queryLogs = [...host.querySelectorAll("button")].find(
      (el) => el.textContent === "Query logs",
    );
    vi.mocked(api.grafanaQuery).mockResolvedValue({
      lucene: "logger.level:error",
      explore_url: "https://grafana.example.com/explore",
      from: "now-6h",
      to: "now",
      count: 1,
      logs: [{ message: "TimeoutError" }],
      trace: { signals: [], links: [], suggestedQueries: [] },
      links: [],
    });
    await act(async () => {
      queryLogs?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.grafanaQuery).toHaveBeenCalledWith(
      expect.objectContaining({ query: "logger.level:error" }),
    );
  });

  it("shows a dashboard skeleton when opening or swapping boards", async () => {
    vi.mocked(api.grafanaStatus).mockResolvedValue({
      connected: true,
      baseUrl: "https://grafana.example.com",
      datasources: [{ name: "logs", type: "elasticsearch", isDefault: true }],
    });
    vi.mocked(api.grafanaRecents).mockResolvedValue([]);
    vi.mocked(api.grafanaDashboards).mockResolvedValue([
      { uid: "check", title: "Checkout", tags: ["prod"] },
      { uid: "bill", title: "Billing", tags: ["prod"] },
    ]);
    vi.mocked(api.grafanaAlerts).mockResolvedValue([]);
    vi.mocked(api.grafanaPins).mockResolvedValue([]);
    let resolveCheck: (value: GrafanaDashboardQueryResult) => void = () => {};
    let resolveBill: (value: GrafanaDashboardQueryResult) => void = () => {};
    const checkBoard = {
      uid: "check",
      title: "Checkout",
      url: "https://grafana.example.com/d/check",
      from: "now-6h",
      to: "now",
      panels: [
        {
          id: 2,
          title: "Error rate",
          type: "timeseries",
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          queries: ["up"],
          series: [{ name: "checkout", points: [{ t: 1, value: 1 }] }],
        },
      ],
    };
    const billBoard = {
      uid: "bill",
      title: "Billing",
      url: "https://grafana.example.com/d/bill",
      from: "now-6h",
      to: "now",
      panels: [
        {
          id: 9,
          title: "Charge latency",
          type: "timeseries",
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          queries: ["charge_latency"],
          series: [{ name: "billing", points: [{ t: 1, value: 4 }] }],
        },
      ],
    };
    vi.mocked(api.grafanaDashboardQuery).mockImplementation((uid: string) => {
      if (uid === "check")
        return new Promise((resolve) => {
          resolveCheck = resolve;
        });
      if (uid === "bill")
        return new Promise((resolve) => {
          resolveBill = resolve;
        });
      return Promise.reject(new Error(`unexpected uid ${uid}`));
    });
    render();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const checkoutBtn = [...host.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Checkout"),
    );
    await act(async () => {
      checkoutBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    const loading = host.querySelector("[data-testid='grafana-dashboard']") as HTMLElement;
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(loading.getAttribute("aria-label")).toBe("Loading dashboard");
    expect(host.querySelectorAll(".grafana-dash-skel-panel").length).toBe(3);
    expect(host.querySelector(".grafana-dash-title")?.textContent).toBe("Checkout");
    expect(host.textContent).not.toContain("Error rate");

    await act(async () => {
      resolveCheck(checkBoard);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      host.querySelector("[data-testid='grafana-dashboard']")?.getAttribute("aria-busy"),
    ).toBeNull();
    expect(host.textContent).toContain("Error rate");

    const billingBtn = [...host.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Billing"),
    );
    await act(async () => {
      billingBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='grafana-dashboard']")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(host.querySelector(".grafana-dash-title")?.textContent).toBe("Billing");
    expect(host.textContent).not.toContain("Error rate");
    expect(host.textContent).not.toContain("Charge latency");

    await act(async () => {
      resolveBill(billBoard);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      host.querySelector("[data-testid='grafana-dashboard']")?.getAttribute("aria-busy"),
    ).toBeNull();
    expect(host.textContent).toContain("Charge latency");
    expect(host.textContent).not.toContain("Error rate");
  });

  it("ignores a slower dashboard query after a swap", async () => {
    vi.mocked(api.grafanaStatus).mockResolvedValue({
      connected: true,
      baseUrl: "https://grafana.example.com",
      datasources: [{ name: "logs", type: "elasticsearch", isDefault: true }],
    });
    vi.mocked(api.grafanaRecents).mockResolvedValue([]);
    vi.mocked(api.grafanaDashboards).mockResolvedValue([
      { uid: "check", title: "Checkout" },
      { uid: "bill", title: "Billing" },
    ]);
    vi.mocked(api.grafanaAlerts).mockResolvedValue([]);
    vi.mocked(api.grafanaPins).mockResolvedValue([]);
    let resolveCheck: (value: GrafanaDashboardQueryResult) => void = () => {};
    let resolveBill: (value: GrafanaDashboardQueryResult) => void = () => {};
    vi.mocked(api.grafanaDashboardQuery).mockImplementation((uid: string) => {
      if (uid === "check")
        return new Promise((resolve) => {
          resolveCheck = resolve;
        });
      return new Promise((resolve) => {
        resolveBill = resolve;
      });
    });
    render();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const checkoutBtn = [...host.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Checkout"),
    );
    const billingBtn = [...host.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Billing"),
    );
    await act(async () => {
      checkoutBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      billingBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      resolveCheck({
        uid: "check",
        title: "Checkout",
        from: "now-1h",
        to: "now",
        panels: [
          {
            id: 2,
            title: "Error rate",
            type: "stat",
            gridPos: { x: 0, y: 0, w: 8, h: 4 },
            queries: [],
            stat: { value: "1" },
          },
        ],
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='grafana-dashboard']")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(host.textContent).not.toContain("Error rate");
    await act(async () => {
      resolveBill({
        uid: "bill",
        title: "Billing",
        from: "now-1h",
        to: "now",
        panels: [
          {
            id: 9,
            title: "Charge latency",
            type: "stat",
            gridPos: { x: 0, y: 0, w: 8, h: 4 },
            queries: [],
            stat: { value: "4" },
          },
        ],
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Charge latency");
    expect(host.textContent).not.toContain("Error rate");
  });

  it("shows dashboard variable values and toggles multi options", async () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    vi.mocked(api.grafanaStatus).mockResolvedValue({
      connected: true,
      baseUrl: "https://grafana.example.com",
      datasources: [{ name: "logs", type: "elasticsearch", isDefault: true }],
    });
    vi.mocked(api.grafanaRecents).mockResolvedValue([]);
    vi.mocked(api.grafanaDashboards).mockResolvedValue([
      { uid: "req", title: "Core Request Statistics Copy", tags: ["prod"] },
    ]);
    vi.mocked(api.grafanaAlerts).mockResolvedValue([]);
    vi.mocked(api.grafanaPins).mockResolvedValue([]);
    vi.mocked(api.grafanaDashboardQuery).mockResolvedValue({
      uid: "req",
      title: "Core Request Statistics Copy",
      from: "now-6h",
      to: "now",
      variables: [
        {
          name: "environment",
          label: "Environment",
          type: "custom",
          current: "prod",
          options: [
            { text: "prod", value: "prod" },
            { text: "staging", value: "staging" },
          ],
          multi: false,
          includeAll: false,
        },
        {
          name: "target_groups",
          label: "Target groups",
          type: "query",
          current: "tg-a|tg-b",
          options: [
            { text: "tg-a", value: "tg-a" },
            { text: "tg-b", value: "tg-b" },
            { text: "tg-c", value: "tg-c" },
          ],
          multi: true,
          includeAll: true,
        },
      ],
      panels: [
        {
          id: 2,
          title: "Requests",
          type: "stat",
          gridPos: { x: 0, y: 0, w: 8, h: 4 },
          queries: ["env=$environment"],
          stat: { value: "12" },
        },
      ],
    });
    render();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const dashBtn = [...host.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Core Request Statistics Copy"),
    );
    await act(async () => {
      dashBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    const env = host.querySelector("[aria-label='Environment']") as HTMLElement;
    const groups = host.querySelector(".grafana-var-menu summary") as HTMLElement;
    expect(selectValue(host, "Environment")).toBe("prod");
    expect(getComputedStyle(env).minWidth).toBe("148px");
    expect(getComputedStyle(env).paddingLeft).not.toBe("0px");
    expect(groups.textContent).toBe("2 selected");
    expect(host.querySelector(".grafana-var-name")?.textContent).toBe("Environment");
    await act(async () => {
      groups.click();
    });
    const boxes = [...host.querySelectorAll(".grafana-var-option input")] as HTMLInputElement[];
    expect(boxes.map((el) => el.checked)).toEqual([false, true, true, false]);
    vi.mocked(api.grafanaDashboardQuery).mockClear();
    await act(async () => {
      boxes[3]!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.grafanaDashboardQuery).toHaveBeenCalledWith(
      "req",
      expect.objectContaining({
        variables: expect.objectContaining({ target_groups: "tg-a|tg-b|tg-c" }),
      }),
    );
    style.remove();
  });

  it("keeps dashboard sparkline actions below the series and lets dense points shrink", async () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    vi.mocked(api.grafanaStatus).mockResolvedValue({
      connected: true,
      baseUrl: "https://grafana.example.com",
      datasources: [{ name: "logs", type: "elasticsearch", isDefault: true }],
    });
    vi.mocked(api.grafanaRecents).mockResolvedValue([]);
    vi.mocked(api.grafanaDashboards).mockResolvedValue([
      { uid: "weaver", title: "Weaver", url: "https://g/d/weaver", tags: ["prod"] },
    ]);
    vi.mocked(api.grafanaAlerts).mockResolvedValue([]);
    vi.mocked(api.grafanaPins).mockResolvedValue([]);
    const points = Array.from({ length: 80 }, (_, i) => ({
      t: 1_000 + i * 1_000,
      value: i % 9,
    }));
    vi.mocked(api.grafanaDashboardQuery).mockResolvedValue({
      uid: "weaver",
      title: "Weaver",
      url: "https://grafana.example.com/d/weaver",
      from: "now-6h",
      to: "now",
      panels: [
        {
          id: 2,
          title: "Core Weaver Prod Consumer Count",
          type: "timeseries",
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          queries: ["weaver_digital_renderer_fair"],
          series: [
            { name: "renderer", points: points.map((row) => ({ ...row, value: 0 })) },
            { name: "weaver_digital_renderer_fair", points },
          ],
        },
      ],
    });
    render();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const dashBtn = [...host.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Weaver"),
    );
    await act(async () => {
      dashBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    const panel = host.querySelector(".grafana-dash-panel") as HTMLElement;
    const series = host.querySelector(".grafana-dash-series") as HTMLElement;
    const spark = host.querySelector(".grafana-dash-spark") as HTMLElement;
    const name = host.querySelector(".grafana-dash-spark-name") as HTMLElement;
    const histogram = host.querySelector(".grafana-dash-spark .grafana-histogram") as HTMLElement;
    const bar = host.querySelector(".grafana-dash-spark .grafana-histogram span") as HTMLElement;
    const actions = host.querySelector(".grafana-dash-actions") as HTMLElement;
    const actionBtn = host.querySelector(".grafana-dash-actions .btn") as HTMLElement;
    expect(panel.querySelectorAll(".grafana-dash-spark").length).toBe(2);
    expect(name.textContent).toBe("renderer");
    expect(getComputedStyle(series).overflow).toBe("hidden");
    expect(getComputedStyle(spark).flex).toContain("1 1 0");
    expect(getComputedStyle(spark).position).toBe("relative");
    expect(getComputedStyle(name).position).toBe("absolute");
    expect(getComputedStyle(name).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(name).textOverflow).toBe("ellipsis");
    expect(getComputedStyle(histogram).gap).toBe("0px");
    expect(getComputedStyle(bar).flex).toContain("1 1 0");
    expect(getComputedStyle(bar).minWidth).toBe("0px");
    expect(getComputedStyle(actions).flex).toContain("0 0 auto");
    expect(getComputedStyle(actionBtn).width).toBe("auto");
    expect(getComputedStyle(actionBtn).whiteSpace).toBe("nowrap");
    expect([...actions.querySelectorAll("button")].map((el) => el.textContent)).toEqual([
      "Open query",
      "Investigate",
    ]);
    expect(css).toMatch(/\.grafana-dash-series \{[\s\S]*?overflow:\s*hidden/);
    expect(css).toMatch(/\.grafana-dash-spark-name \{[\s\S]*?text-overflow:\s*ellipsis/);
    expect(css).toMatch(/\.grafana-dash-actions \{[\s\S]*?flex:\s*0 0 auto/);
    expect(css).toMatch(
      /\.grafana-dash-spark \.grafana-histogram span,[\s\S]*?\.grafana-dash-spark \.grafana-histogram button \{[\s\S]*?min-width:\s*0/,
    );
    style.remove();
  });

  it("renders highlighted terms as marks and structured fields instead of raw tags", async () => {
    vi.mocked(api.grafanaStatus).mockResolvedValue({
      connected: true,
      baseUrl: "https://grafana.example.com",
      datasources: [{ name: "logs", type: "elasticsearch", isDefault: true }],
    });
    vi.mocked(api.grafanaRecents).mockResolvedValue([]);
    vi.mocked(api.grafanaDashboards).mockResolvedValue([]);
    vi.mocked(api.grafanaQuery).mockResolvedValue({
      lucene: "logger.level:error",
      explore_url: "https://grafana.example.com/explore",
      from: "now-1h",
      to: "now",
      count: 10000,
      histogram: [{ t: 1, count: 3 }],
      logs: [
        {
          timestamp: "2026-10-20T07:37:12.000Z",
          level: "error",
          message: "@HIGHLIGHT@error@/HIGHLIGHT@",
          source: {
            task_name: "workers.tasks.queue.flush.flush_a",
            hostname: "e7c182fc85e0",
            task_id: "7d8a8226f1cbec3818b4478557a981ed",
            tags: ["application logs", "beats_input_raw_event"],
          },
        },
        {
          timestamp: "2026-10-20T07:37:11.000Z",
          level: "error",
          message: "payment @HIGHLIGHT@timeout@/HIGHLIGHT@",
          source: { service: "billing" },
        },
      ],
      trace: { signals: [], links: [], suggestedQueries: ["logger.level:error"] },
      links: [],
    });
    render();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const form = host.querySelector(".grafana-toolbar") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).not.toContain("@HIGHLIGHT@");
    expect(host.textContent).toMatch(/10,000 hits|10000 hits/);
    expect(host.textContent).toContain("workers.tasks.queue.flush.flush_a");
    expect(host.querySelector(".grafana-log-msg mark")?.textContent).toBe("timeout");
    expect(host.querySelector(".grafana-fields dt")?.textContent).toBe("task_name");
    expect(host.querySelector(".grafana-source-json")).toBeTruthy();
    expect(host.querySelector(".grafana-links")).toBeNull();
  });

  it("opens a firing alert, pins a dashboard, and jumps to a file line", async () => {
    vi.mocked(api.grafanaStatus).mockResolvedValue({
      connected: true,
      baseUrl: "https://grafana.example.com",
      datasources: [{ name: "logs", type: "elasticsearch", isDefault: true }],
    });
    vi.mocked(api.grafanaRecents).mockResolvedValue([]);
    vi.mocked(api.grafanaDashboards).mockResolvedValue([
      { uid: "check", title: "Checkout", folderTitle: "Prod", tags: ["prod"] },
    ]);
    vi.mocked(api.grafanaAlerts).mockResolvedValue([
      {
        fingerprint: "abc",
        name: "HighErrorRate",
        state: "firing",
        summary: "errors up",
        labels: { service: "billing" },
        dashboardUid: "check",
        startsAt: "2026-10-21T12:00:00.000Z",
      },
    ]);
    vi.mocked(api.grafanaPins).mockResolvedValue([]);
    vi.mocked(api.grafanaPin).mockResolvedValue([
      { uid: "check", title: "Checkout", at: "2026-10-21T00:00:00.000Z" },
    ]);
    vi.mocked(api.grafanaDashboardQuery).mockResolvedValue({
      uid: "check",
      title: "Checkout",
      from: "2026-10-21T11:45:00.000Z",
      to: "now",
      variables: [
        {
          name: "service",
          label: "Service",
          type: "custom",
          current: "billing",
          options: [{ text: "billing", value: "billing" }],
          multi: false,
          includeAll: false,
        },
      ],
      annotations: [
        {
          id: 9,
          time: 1_000,
          text: "deploy 9f3c1ab",
          tags: ["deploy"],
          panelId: 2,
          signals: [{ kind: "sha", value: "9f3c1ab" }],
        },
      ],
      panels: [
        {
          id: 2,
          title: "Error rate",
          type: "timeseries",
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          queries: ["up"],
          series: [
            {
              name: "errors",
              points: [
                { t: 1_000, value: 2 },
                { t: 2_000, value: 4 },
              ],
            },
          ],
        },
      ],
    });
    vi.mocked(api.grafanaQuery).mockResolvedValue({
      lucene: "logger.level:error",
      explore_url: "https://grafana.example.com/explore",
      from: "now-1h",
      to: "now",
      count: 1,
      histogram: [
        { t: 1_000, count: 2 },
        { t: 2_000, count: 1 },
      ],
      logs: [{ timestamp: "2026-10-21T12:00:00.000Z", level: "error", message: "TimeoutError" }],
      trace: {
        signals: [{ kind: "trace", value: "abc123def456" }],
        links: [
          {
            repoId: "r1",
            repoName: "billing",
            url: "https://github.com/acme/billing",
            path: "src/charge.ts",
            line: 12,
            reason: "file src/charge.ts:12",
            score: 14,
          },
        ],
        suggestedQueries: [],
      },
      traceHop: {
        traceId: "abc123def456",
        datasource: "Tempo",
        spans: [
          { traceId: "abc123def456", service: "billing", operation: "charge", durationMs: 12 },
        ],
        links: [],
      },
      links: [
        {
          repoId: "r1",
          repoName: "billing",
          url: "https://github.com/acme/billing",
          path: "src/charge.ts",
          line: 12,
          reason: "file src/charge.ts:12",
          score: 14,
        },
      ],
    });
    const { dispatch } = render({
      ...initialState,
      section: "grafana",
      sessions: [
        {
          id: "sess",
          title: "billing",
          repoId: "r1",
          archived: false,
          runtime: "host",
        } as AgentSession,
      ],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("HighErrorRate");
    expect(host.textContent).toContain("Prod");
    const alert = [...host.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("HighErrorRate"),
    );
    await act(async () => {
      alert?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.grafanaDashboardQuery).toHaveBeenCalledWith(
      "check",
      expect.objectContaining({ from: "2026-10-21T11:45:00.000Z", to: "now" }),
    );
    vi.mocked(api.grafanaInvestigate).mockResolvedValue({ sessionId: "s-up", created: true });
    const investigatePanel = [...host.querySelectorAll("button")].find(
      (el) => el.textContent === "Investigate",
    );
    await act(async () => {
      investigatePanel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.grafanaInvestigate).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "up",
        panelType: "timeseries",
        links: undefined,
        repoId: undefined,
      }),
    );
    expect(host.querySelector("[aria-label='Service']")).toBeTruthy();
    const marker = host.querySelector("[aria-label='deploy 9f3c1ab']");
    expect(marker).toBeTruthy();
    await act(async () => {
      marker?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).toContain("9f3c1ab");
    const pin = [...host.querySelectorAll("button")].find((el) => el.textContent === "Pin");
    await act(async () => {
      pin?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(api.grafanaPin).toHaveBeenCalledWith({ uid: "check", title: "Checkout" });

    const logs = [...host.querySelectorAll("button")].find((el) => el.textContent === "Logs");
    await act(async () => {
      logs?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const form = host.querySelector(".grafana-toolbar") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='grafana-spans']")?.textContent).toMatch(/billing/);
    const openRepo = [...host.querySelectorAll(".grafana-links button")].find((el) =>
      el.textContent?.includes("charge.ts"),
    );
    act(() => openRepo?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(dispatch).toHaveBeenCalledWith({ type: "select", id: "sess" });
    expect(dispatch).toHaveBeenCalledWith({
      type: "openWorkspace",
      open: expect.objectContaining({ sessionId: "sess", path: "src/charge.ts", line: 12 }),
    });
    const dashBtn = [...host.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Checkout"),
    );
    await act(async () => {
      dashBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    vi.mocked(api.grafanaInvestigate).mockClear();
    const again = [...host.querySelectorAll("button")].find(
      (el) => el.textContent === "Investigate",
    );
    await act(async () => {
      again?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.grafanaInvestigate).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "up",
        panelType: "timeseries",
        repoId: undefined,
        links: undefined,
      }),
    );
  });
});
