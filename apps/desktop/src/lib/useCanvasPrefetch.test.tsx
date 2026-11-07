import { StrictMode, act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@locus/shared";
import { api } from "./api";
import { useCanvasPrefetch } from "./useCanvasPrefetch";

vi.mock("./api", () => ({
  api: {
    canvas: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = (id: string, htmlStamp = "2020-01-01T00:00:00.000Z"): AgentSession => ({
  id,
  title: id,
  kind: "design",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  runtime: "docker",
  providerId: "p",
  model: "grok-4",
  status: "idle",
  vmId: `v-${id}`,
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: htmlStamp,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Harness(props: {
  enabled: boolean;
  designs: AgentSession[];
  seed?: Record<string, string>;
}) {
  const [html, setHtml] = useState<Record<string, string>>(props.seed ?? {});
  useCanvasPrefetch(props.enabled, props.designs, html, (action) => {
    setHtml((prev) => ({ ...prev, [action.sessionId]: action.html }));
  });
  return (
    <ul>
      {props.designs.map((row) => (
        <li key={row.id} data-id={row.id}>
          {html[row.id] ?? ""}
        </li>
      ))}
    </ul>
  );
}

describe("useCanvasPrefetch", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    const current = root;
    if (current) act(() => current.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
    vi.mocked(api.canvas).mockReset();
  });

  function render(node: ReactNode, wrapStrict = false) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(wrapStrict ? <StrictMode>{node}</StrictMode> : node);
    });
  }

  function pendingById() {
    const pending = new Map<
      string,
      ReturnType<typeof deferred<{ html: string | null; path: string }>>
    >();
    vi.mocked(api.canvas).mockImplementation((id: string) => {
      const next = deferred<{ html: string | null; path: string }>();
      pending.set(id, next);
      return next.promise;
    });
    return pending;
  }

  it("applies every in-flight canvas after the first one lands in state", async () => {
    const pending = pendingById();
    const designs = [session("d1"), session("d2"), session("d3")];
    render(<Harness enabled designs={designs} />);
    expect([...pending.keys()].sort()).toEqual(["d1", "d2", "d3"]);

    await act(async () => {
      pending.get("d1")!.resolve({
        html: "<html><body><h1>One</h1></body></html>",
        path: "/workspace/index.html",
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host!.querySelector('[data-id="d1"]')?.textContent).toContain("One");
    expect(host!.querySelector('[data-id="d2"]')?.textContent).toBe("");

    await act(async () => {
      pending.get("d2")!.resolve({
        html: "<html><body><h1>Two</h1></body></html>",
        path: "/workspace/index.html",
      });
      pending.get("d3")!.resolve({
        html: "<html><body><h1>Three</h1></body></html>",
        path: "/workspace/index.html",
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host!.querySelector('[data-id="d1"]')?.textContent).toContain("One");
    expect(host!.querySelector('[data-id="d2"]')?.textContent).toContain("Two");
    expect(host!.querySelector('[data-id="d3"]')?.textContent).toContain("Three");
  });

  it("still applies first-pass fetches after React Strict Mode remounts", async () => {
    const pending = pendingById();
    render(<Harness enabled designs={[session("d1"), session("d2")]} />, true);
    await act(async () => {
      pending.get("d1")!.resolve({
        html: "<html><body><h1>One</h1></body></html>",
        path: "/workspace/index.html",
      });
      pending.get("d2")!.resolve({
        html: "<html><body><h1>Two</h1></body></html>",
        path: "/workspace/index.html",
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host!.querySelector('[data-id="d1"]')?.textContent).toContain("One");
    expect(host!.querySelector('[data-id="d2"]')?.textContent).toContain("Two");
  });

  it("skips designs that already have cached html", async () => {
    const pending = pendingById();
    render(
      <Harness
        enabled
        designs={[session("d1")]}
        seed={{ d1: "<html><body><h1>Live</h1></body></html>" }}
      />,
    );
    expect(api.canvas).not.toHaveBeenCalled();
    expect(host!.querySelector('[data-id="d1"]')?.textContent).toContain("Live");
    expect(pending.size).toBe(0);
  });

  it("does not fetch when prefetch is disabled", () => {
    pendingById();
    render(<Harness enabled={false} designs={[session("d1"), session("d2")]} />);
    expect(api.canvas).not.toHaveBeenCalled();
  });

  it("retries a failed fetch the next time the catalog changes", async () => {
    const pending = pendingById();
    const first = [session("d1", "2020-01-01T00:00:00.000Z")];
    render(<Harness enabled designs={first} />);
    await act(async () => {
      pending.get("d1")!.reject(new Error("offline"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host!.querySelector('[data-id="d1"]')?.textContent).toBe("");

    pending.clear();
    vi.mocked(api.canvas).mockClear();
    const later = pendingById();
    const next = [session("d1", "2020-01-02T00:00:00.000Z")];
    act(() => {
      root!.render(<Harness enabled designs={next} />);
    });
    expect(api.canvas).toHaveBeenCalledWith("d1");
    await act(async () => {
      later.get("d1")!.resolve({
        html: "<html><body><h1>Retry</h1></body></html>",
        path: "/workspace/index.html",
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host!.querySelector('[data-id="d1"]')?.textContent).toContain("Retry");
  });
});
