import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrashScreen, ErrorBoundary } from "./CrashScreen";
import type { CrashError } from "@/lib/crash";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

describe("CrashScreen", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  function render(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(node);
    });
  }

  it("fills the viewport with a sad mascot, traces, and Restart", () => {
    const onRestart = vi.fn();
    const errors: CrashError[] = [
      {
        id: "c1",
        title: "pane exploded",
        stack: "Error: pane exploded\n    at ChatPane (ChatPane.tsx:12:3)",
      },
      { id: "c2", title: "follow-on", stack: "Error: follow-on\n    at store.ts:4:1" },
    ];
    render(
      <CrashScreen errors={errors} componentStack={"in ChatPane\nin App"} onRestart={onRestart} />,
    );

    const screen = host.querySelector("[data-testid='crash-screen']");
    expect(screen?.getAttribute("role")).toBe("alert");
    expect(host.querySelector("[data-testid='locus-mascot']")?.getAttribute("data-pose")).toBe(
      "sad",
    );
    expect(host.textContent).toContain("The UI crashed");
    expect(host.querySelector(".crash-screen-error")?.textContent).toBe("pane exploded");

    const first = host.querySelector("[data-testid='crash-stack']") as HTMLDetailsElement;
    const extra = host.querySelector("[data-testid='crash-stack-2']") as HTMLDetailsElement;
    const component = host.querySelector(
      "[data-testid='crash-component-stack']",
    ) as HTMLDetailsElement;
    expect(first.open).toBe(false);
    expect(extra.querySelector("summary")?.textContent).toContain("follow-on");
    act(() => {
      first.querySelector("summary")?.click();
    });
    expect(first.open).toBe(true);
    expect(first.querySelector("pre")?.textContent).toContain("ChatPane.tsx:12:3");
    expect(component.querySelector("pre")?.textContent).toContain("in ChatPane");

    const restart = host.querySelector("[data-testid='crash-restart']") as HTMLButtonElement;
    expect(restart.textContent).toMatch(/Restart/);
    act(() => {
      restart.click();
    });
    expect(onRestart).toHaveBeenCalledTimes(1);

    expect(css).toMatch(/\.crash-screen\s*\{[\s\S]*?position:\s*fixed/);
    expect(css).toMatch(/\.crash-screen\s*\{[\s\S]*?inset:\s*0/);
    expect(css).toMatch(/\.crash-screen\s*\{[\s\S]*?place-items:\s*center/);
    expect(css).toMatch(/\.crash-screen \.mascot\s*\{[\s\S]*?max-width:\s*min\(48vh, 280px\)/);
  });

  it("labels a single stack as Stack trace", () => {
    render(
      <CrashScreen
        errors={[{ id: "c1", title: "only", stack: "Error: only" }]}
        onRestart={() => undefined}
      />,
    );
    expect(host.querySelector("[data-testid='crash-stack'] summary")?.textContent).toMatch(
      /Stack trace/,
    );
    expect(host.querySelector("[data-testid='crash-component-stack']")).toBeNull();
  });
});

describe("ErrorBoundary", () => {
  let host: HTMLDivElement;
  let root: Root;
  let consoleError: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    consoleError.mockRestore();
    vi.restoreAllMocks();
  });

  function render(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    act(() => {
      root.render(node);
    });
  }

  function Boom(): ReactNode {
    throw new Error("render died");
  }

  it("replaces a throwing tree with the crash screen", () => {
    const onRestart = vi.fn();
    render(
      <ErrorBoundary onRestart={onRestart}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(host.querySelector("[data-testid='crash-screen']")).toBeTruthy();
    expect(host.querySelector("[data-testid='locus-mascot']")?.getAttribute("data-pose")).toBe(
      "sad",
    );
    expect(host.textContent).toContain("render died");
    expect(host.querySelector("[data-testid='crash-stack'] pre")?.textContent).toContain(
      "render died",
    );
    const component = host.querySelector("[data-testid='crash-component-stack'] pre");
    expect(component?.textContent).toMatch(/Boom/);
    act(() => {
      (host.querySelector("[data-testid='crash-restart']") as HTMLButtonElement).click();
    });
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("shows the crash screen for an uncaught window error", () => {
    render(
      <ErrorBoundary onRestart={() => undefined}>
        <div data-testid="ok">fine</div>
      </ErrorBoundary>,
    );
    expect(host.querySelector("[data-testid='ok']")).toBeTruthy();
    const err = new Error("action blew up");
    err.stack = "Error: action blew up\n    at onClick (App.tsx:9:1)";
    act(() => {
      window.dispatchEvent(
        new ErrorEvent("error", { error: err, message: "Uncaught Error: action blew up" }),
      );
    });
    expect(host.querySelector("[data-testid='crash-screen']")).toBeTruthy();
    expect(host.textContent).toContain("action blew up");
    expect(host.querySelector("[data-testid='crash-stack'] pre")?.textContent).toContain(
      "App.tsx:9:1",
    );
  });
});
