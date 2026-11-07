import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentCanvasPane, useAgentCanvasFocus, useAgentCanvasOpen } from "./AgentCanvasPane";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    agentCanvas: vi.fn(),
  },
}));

describe("AgentCanvasPane", () => {
  let root: Root | undefined;
  let host: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  });

  it("renders the canvas document in a sandboxed frame", async () => {
    vi.mocked(api.agentCanvas).mockResolvedValue({
      id: "billing-review",
      title: "Billing review",
      updatedAt: "2026-10-21T00:00:00.000Z",
      html: "<h1>March</h1>",
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <AgentCanvasPane
          sessionId="s1"
          focus={1}
          canvases={[
            {
              id: "billing-review",
              title: "Billing review",
              updatedAt: "2026-10-21T00:00:00.000Z",
            },
          ]}
        />,
      );
    });
    const frame = host.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.title).toBe("Billing review");
    expect(frame?.getAttribute("srcdoc")).toContain("<h1>March</h1>");
    expect(frame?.getAttribute("srcdoc")).toContain("default-src 'none'");
    expect(frame?.getAttribute("srcdoc")).not.toContain("allow-same-origin");
  });

  it("stays on the current view until a canvas is written", async () => {
    const seen: number[] = [];
    function Probe(props: { sessionId?: string; updatedAt: string }) {
      const focus = useAgentCanvasFocus(props.sessionId, [
        { id: "billing-review", title: "Billing review", updatedAt: props.updatedAt },
      ]);
      seen.push(focus);
      return null;
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<Probe sessionId="s1" updatedAt="t1" />);
    });
    expect(seen.at(-1)).toBe(0);
    await act(async () => {
      root?.render(<Probe sessionId="s1" updatedAt="t2" />);
    });
    expect(seen.at(-1)).toBe(1);
    await act(async () => {
      root?.render(<Probe sessionId="s2" updatedAt="t2" />);
    });
    expect(seen.at(-1)).toBe(0);
  });

  it("opens once per canvas write", async () => {
    const open = vi.fn();
    function Probe(props: { focus: number; open: () => void }) {
      useAgentCanvasOpen(props.focus, props.open);
      return null;
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<Probe focus={0} open={open} />);
    });
    expect(open).not.toHaveBeenCalled();
    await act(async () => {
      root?.render(<Probe focus={1} open={open} />);
    });
    expect(open).toHaveBeenCalledTimes(1);
    const next = vi.fn();
    await act(async () => {
      root?.render(<Probe focus={1} open={next} />);
    });
    expect(next).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    await act(async () => {
      root?.render(<Probe focus={0} open={next} />);
    });
    await act(async () => {
      root?.render(<Probe focus={1} open={next} />);
    });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
