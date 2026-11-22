import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiProvider } from "@locus/shared";

const apiMock = vi.hoisted(() => ({
  benchmarkCases: vi.fn(),
  benchmarkRuns: vi.fn(),
  startBenchmark: vi.fn(),
  cancelBenchmark: vi.fn(),
  benchmarkHistory: vi.fn(async () => ({ rows: [] as unknown[] })),
  compareBenchmarks: vi.fn(),
  backup: vi.fn(),
  inspectBackup: vi.fn(),
  restoreStatus: vi.fn(),
  stageRestore: vi.fn(),
  cancelRestore: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));

import { BenchmarkSettings } from "./BenchmarkSettings";
import { BackupSettings } from "./BackupSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const provider = {
  id: "openai",
  name: "OpenAI",
  kind: "openai",
  baseUrl: "",
  models: ["gpt-a", "gpt-b"],
  defaultModel: "gpt-a",
  enabled: true,
  extraHeaders: {},
} as unknown as AiProvider;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function setInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("BenchmarkSettings", () => {
  it("starts a run for the picked model and shows the summary", async () => {
    apiMock.benchmarkCases.mockResolvedValue({
      cases: [
        { id: "fix-add", title: "Fix a one-line bug", prompt: "" },
        { id: "off-by-one", title: "Find an off-by-one", prompt: "" },
      ],
    });
    apiMock.benchmarkRuns.mockResolvedValue({ runs: [] });
    apiMock.startBenchmark.mockImplementation(async (body) => ({
      id: "bench-1",
      createdAt: "2026-11-12T00:00:00Z",
      status: "done",
      targets: body.targets,
      caseIds: body.caseIds,
      repeat: 1,
      results: [
        {
          caseId: "fix-add",
          target: body.targets[0],
          attempt: 1,
          status: "passed",
          durationMs: 4000,
        },
      ],
      summary: [
        {
          target: body.targets[0],
          passed: 1,
          total: 1,
          passRate: 1,
          usd: 0.02,
          medianMs: 4000,
          tokens: 10,
        },
      ],
    }));
    act(() => root.render(<BenchmarkSettings providers={[provider]} />));
    await flush();
    const start = host.querySelector<HTMLButtonElement>("[data-testid='benchmark-start']")!;
    expect(start.disabled).toBe(true);
    act(() => {
      host.querySelector<HTMLInputElement>("[data-testid='benchmark-provider-openai']")!.click();
    });
    expect(start.disabled).toBe(false);
    expect(start.textContent).toBe("Run 2 cases");
    await act(async () => start.click());
    await flush();
    expect(apiMock.startBenchmark).toHaveBeenCalledWith({
      targets: [{ providerId: "openai", model: "gpt-a" }],
      caseIds: ["fix-add", "off-by-one"],
      repeat: 1,
    });
    const run = host.querySelector("[data-testid='benchmark-run']")!;
    expect(run.textContent).toContain("openai/gpt-a");
    expect(run.textContent).toContain("1/1 · 100%");
    expect(run.textContent).toContain("$0.02");
  });

  it("shows run history per harness and compares two runs", async () => {
    const target = { providerId: "openai", model: "gpt-a" };
    const run = (id: string, createdAt: string) => ({
      id,
      createdAt,
      status: "done",
      targets: [target],
      caseIds: ["fix-add"],
      repeat: 1,
      results: [],
      summary: [],
      harness: { locusVersion: "0.20.0", configHash: "abc", key: `0.20.0.${id}` },
    });
    apiMock.benchmarkCases.mockResolvedValue({ cases: [] });
    apiMock.benchmarkRuns.mockResolvedValue({
      runs: [run("r2", "2026-11-13T00:00:00Z"), run("r1", "2026-11-12T00:00:00Z")],
    });
    apiMock.benchmarkHistory.mockResolvedValue({
      rows: [
        {
          providerId: "openai",
          model: "gpt-a",
          harnessVersion: "0.20.0+abc1234.deadbeef",
          runs: 2,
          runIds: ["r1", "r2"],
          cases: 4,
          passed: 3,
          passRate: 0.75,
          usdPerCase: 0.01,
          medianMs: 3000,
          tokens: 0,
          firstAt: "2026-11-12T00:00:00Z",
          lastAt: "2026-11-13T00:00:00Z",
        },
      ],
    });
    apiMock.compareBenchmarks.mockResolvedValue({
      a: { id: "r1", harnessVersion: "h1", passRate: 1, cases: 2 },
      b: { id: "r2", harnessVersion: "h2", passRate: 0.5, cases: 2 },
      rows: [
        { caseId: "fix-add", target: "openai/gpt-a", before: 1, after: 0, change: "broke" },
        {
          caseId: "off-by-one",
          target: "openai/gpt-a",
          before: 1,
          after: 1,
          change: "still-passing",
        },
      ],
      fixed: 0,
      broke: 1,
    });
    act(() => root.render(<BenchmarkSettings providers={[provider]} />));
    await flush();
    const history = host.querySelector("[data-testid='benchmark-history']")!;
    expect(history.textContent).toContain("0.20.0+abc1234.deadbeef");
    expect(history.textContent).toContain("3/4 · 75%");

    const panel = host.querySelector("[data-testid='benchmark-compare']")!;
    const go = panel.querySelector<HTMLButtonElement>("[data-testid='benchmark-compare-go']")!;
    expect(go.disabled).toBe(true);
    const [before, after] = panel.querySelectorAll("select");
    const pick = (el: HTMLSelectElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    act(() => {
      pick(before!, "r1");
      pick(after!, "r2");
    });
    expect(go.disabled).toBe(false);
    await act(async () => go.click());
    await flush();
    expect(apiMock.compareBenchmarks).toHaveBeenCalledWith("r1", "r2");
    expect(panel.textContent).toContain("0 fixed · 1 broke");
    expect(panel.querySelector("tr[data-change='broke']")?.textContent).toContain("fix-add");
    expect(panel.textContent).not.toContain("off-by-one");
  });
});

describe("BackupSettings", () => {
  it("needs matching passphrases before backing up", async () => {
    apiMock.restoreStatus.mockResolvedValue({ pending: null });
    apiMock.backup.mockResolvedValue({
      path: "/home/me/b.locusbak",
      sizeBytes: 4096,
      manifest: { files: 3, bytes: 9000, includeDisks: false, skipped: [] },
    });
    act(() => root.render(<BackupSettings />));
    await flush();
    const [pass, pass2] = host.querySelectorAll<HTMLInputElement>("input[type='password']");
    const start = host.querySelector<HTMLButtonElement>("[data-testid='backup-start']")!;
    act(() => {
      setInput(pass!, "correct horse");
      setInput(pass2!, "correct hors");
    });
    expect(start.disabled).toBe(true);
    expect(host.textContent).toContain("do not match");
    act(() => setInput(pass2!, "correct horse"));
    expect(start.disabled).toBe(false);
    await act(async () => start.click());
    await flush();
    expect(apiMock.backup).toHaveBeenCalledWith(
      expect.objectContaining({ passphrase: "correct horse", includeDisks: false }),
    );
    expect(host.textContent).toContain("/home/me/b.locusbak");
  });

  it("shows a staged restore with a cancel action", async () => {
    apiMock.restoreStatus.mockResolvedValue({
      pending: { stagedAt: "2026-11-12T00:00:00Z", from: "/tmp/b.locusbak" },
    });
    apiMock.cancelRestore.mockResolvedValue({ ok: true });
    act(() => root.render(<BackupSettings />));
    await flush();
    const pending = host.querySelector("[data-testid='restore-pending']")!;
    expect(pending.textContent).toContain("/tmp/b.locusbak");
    const cancel = [...pending.querySelectorAll("button")].find(
      (b) => b.textContent === "Cancel restore",
    )!;
    await act(async () => cancel.click());
    await flush();
    expect(apiMock.cancelRestore).toHaveBeenCalled();
    expect(host.querySelector("[data-testid='restore-pending']")).toBeNull();
  });
});
