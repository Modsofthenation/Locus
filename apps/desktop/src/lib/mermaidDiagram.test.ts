import { describe, expect, it } from "vitest";
import { diagramKindLabel, mermaidKindFromSource, mermaidSvg } from "./mermaidDiagram";

function viewBoxSize(svg: string | undefined): { width: number; height: number } {
  const match = svg?.match(/viewBox="0 0 (\d+) (\d+)"/);
  return { width: Number(match?.[1] ?? 0), height: Number(match?.[2] ?? 0) };
}

describe("mermaidSvg", () => {
  it("renders sequence, state, and erd sources to svg", () => {
    const sequence = mermaidSvg("sequenceDiagram\n  Client->>API: GET\n  API-->>Client: json");
    expect(mermaidKindFromSource("sequenceDiagram\n  A->>B: x")).toBe("sequence");
    expect(sequence).toMatch(/<svg/);
    expect(sequence).toMatch(/Client/);
    expect(mermaidSvg("stateDiagram-v2\n  [*] --> draft\n  draft --> open")).toMatch(/draft/);
    expect(mermaidSvg("erDiagram\n  Invoice ||--o{ InvoiceLine : has")).toMatch(/Invoice/);
    expect(mermaidSvg("flowchart LR\n  A-->B")).toBeUndefined();
  });

  it("sizes state flows so node labels stay readable", () => {
    const svg = mermaidSvg(`stateDiagram-v2
  [*] --> arraybuffer
  arraybuffer --> pty_host
  pty_host --> pty_frame
  pty_frame --> react
  react --> resize
  resize --> workspace_terminal`);
    expect(svg).toMatch(/font-size="15"/);
    const size = viewBoxSize(svg);
    expect(size.height).toBeGreaterThanOrEqual(100);
    expect(size.width).toBeGreaterThanOrEqual(560);
    expect(svg).toMatch(/workspace_terminal/);
    const pill = svg!.match(/width="(\d+)"[^>]*>\s*<text[^>]*>workspace_terminal/);
    const pillWidth = Number(pill?.[1] || 0);
    expect(pillWidth).toBeGreaterThanOrEqual(180);
  });

  it("gives sequence diagrams room for participant labels", () => {
    const svg = mermaidSvg("sequenceDiagram\n  Client->>API: GET invoice");
    const size = viewBoxSize(svg);
    expect(size.height).toBeGreaterThanOrEqual(130);
    expect(svg).toMatch(/font-size="15"/);
    expect(svg).toMatch(/width="\d+"/);
    expect(svg).toMatch(/height="\d+"/);
  });

  it("wraps long state flows instead of emitting a single ultra-wide row", () => {
    const svg = mermaidSvg(`stateDiagram-v2
  [*] --> arraybuffer
  arraybuffer --> pty_host
  pty_host --> pty_frame
  pty_frame --> react
  react --> resize
  resize --> workspace_terminal`);
    const size = viewBoxSize(svg);
    expect(size.width).toBeLessThanOrEqual(800);
    expect(size.height).toBeGreaterThanOrEqual(100);
  });

  it("labels diagram kinds for the stack caption", () => {
    expect(diagramKindLabel("state")).toBe("Lifecycle");
    expect(diagramKindLabel("sequence")).toBe("Call flow");
    expect(diagramKindLabel("erd")).toBe("Data model");
  });
});
