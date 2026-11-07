import { describe, expect, it } from "vitest";
import type { BrainEdge, BrainNode } from "@locus/shared";
import {
  BRAIN_GRAPH_FIT_MAX_ZOOM,
  BRAIN_GRAPH_MIN_ZOOM,
  BRAIN_GRAPH_NODE_WIDTH,
  allBrainGraphFamilies,
  brainEdgePath,
  brainGraphFamilyFor,
  brainGraphLayoutUsesColumns,
  clampBrainGraphZoom,
  defaultBrainGraphDetail,
  fitBrainGraphCamera,
  inspectBrainNode,
  isolateBrainPathIds,
  layoutBrainGraph,
  neighborIds,
  parseBrainEvidence,
  searchBrainNodes,
  shortBrainGraphLabel,
  visibleBrainGraph,
} from "./brainGraph";

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

function edge(
  from: string,
  to: string,
  type: BrainEdge["type"] = "CALLS",
  confidence: BrainEdge["confidence"] = "high",
): BrainEdge {
  return {
    id: `${from}->${to}`,
    type,
    from,
    to,
    confidence,
    createdBy: "test",
    createdAt: "2020-01-01T00:00:00.000Z",
  };
}

const service = node({
  id: "service:billing",
  type: "Service",
  name: "billing-gateway",
  description: "Owns charge APIs",
  evidence: "https://github.com/acme/billing:apps/billing/src/app.ts:12",
});
const api = node({ id: "apiendpoint:charge", type: "APIEndpoint", name: "POST /v1/charge" });
const note = node({ id: "note:scratch", type: "Note", name: "scratch" });
const handler = node({ id: "handler:charge", type: "Handler", name: "chargeHandler" });
const nodes = [service, api, note, handler];
const edges = [
  edge("service:billing", "apiendpoint:charge", "OWNS"),
  edge("apiendpoint:charge", "handler:charge", "HANDLED_BY"),
  edge("note:scratch", "service:billing", "ANNOTATES", "low"),
];

describe("visibleBrainGraph", () => {
  it("overview hides notes and concepts", () => {
    const g = visibleBrainGraph(nodes, edges, {
      detail: "overview",
      families: allBrainGraphFamilies(),
    });
    expect(g.nodes.map((n) => n.id).sort()).toEqual([
      "apiendpoint:charge",
      "handler:charge",
      "service:billing",
    ]);
    expect(g.edges.some((e) => e.from === "note:scratch")).toBe(false);
  });

  it("neighborhood keeps both directions", () => {
    const g = visibleBrainGraph(nodes, edges, {
      detail: "full",
      families: allBrainGraphFamilies(),
      focusId: "service:billing",
      neighborhoodOnly: true,
    });
    expect(g.nodes.map((n) => n.id).sort()).toEqual([
      "apiendpoint:charge",
      "note:scratch",
      "service:billing",
    ]);
  });

  it("family chips drop other groups", () => {
    const g = visibleBrainGraph(nodes, edges, {
      detail: "full",
      families: new Set(["apis"]),
    });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["apiendpoint:charge", "handler:charge"]);
    expect(g.edges.map((e) => `${e.from}->${e.to}`)).toEqual([
      "apiendpoint:charge->handler:charge",
    ]);
  });
});

describe("search and isolate", () => {
  it("searches name, type, and evidence", () => {
    expect(searchBrainNodes(nodes, "charge").map((n) => n.id)).toEqual([
      "service:billing",
      "apiendpoint:charge",
      "handler:charge",
    ]);
    expect(searchBrainNodes(nodes, "POST /v1")[0]?.id).toBe("apiendpoint:charge");
    expect(searchBrainNodes(nodes, "owns charge")[0]?.id).toBe("service:billing");
  });

  it("isolates the path from a service to API sinks", () => {
    const iso = isolateBrainPathIds(nodes, edges, "service:billing");
    expect([...iso.nodeIds].sort()).toEqual(["apiendpoint:charge", "service:billing"]);
    expect([...iso.edgeIds]).toEqual(["service:billing->apiendpoint:charge"]);
  });

  it("returns empty keep sets when the isolate source is gone", () => {
    const iso = isolateBrainPathIds(nodes, edges, "service:missing");
    expect(iso.nodeIds.size).toBe(0);
    expect(iso.edgeIds.size).toBe(0);
  });

  it("walks neighbors in both directions", () => {
    expect([...neighborIds("apiendpoint:charge", edges)].sort()).toEqual([
      "apiendpoint:charge",
      "handler:charge",
      "service:billing",
    ]);
  });
});

describe("inspectBrainNode", () => {
  it("explains the node, degrees, and incident edges", () => {
    const info = inspectBrainNode(api, nodes, edges);
    expect(info.purpose).toMatch(/published/i);
    expect(info.roles).toContain("sink");
    expect(info.degreeIn).toBe(1);
    expect(info.degreeOut).toBe(1);
    expect(info.pathSummary).toMatch(/OWNS/);
    expect(info.pathSummary).toMatch(/HANDLED BY/);
    expect(info.inputs[0]?.name).toBe("billing-gateway");
    expect(info.outputs[0]?.name).toBe("chargeHandler");
    expect(info.facts.some((f) => f.key === "evidence")).toBe(true);
  });

  it("parses evidence locations", () => {
    expect(parseBrainEvidence("apps/billing/src/app.ts:12")).toEqual({
      display: "apps/billing/src/app.ts:12",
      path: "apps/billing/src/app.ts",
      line: 12,
    });
    expect(parseBrainEvidence(service.evidence)?.path).toBe("apps/billing/src/app.ts");
  });
});

describe("brain graph layout", () => {
  it("shortens route labels and lays APIs in a later column than services", () => {
    expect(shortBrainGraphLabel("GET /api/v1/health/check", 14)).toMatch(/^GET \//);
    expect(shortBrainGraphLabel("GET /api/v1/health/check", 14).length).toBeLessThanOrEqual(14);
    expect(shortBrainGraphLabel("@locus/cli", 14)).toBe("@locus/cli");

    const endpoints = Array.from({ length: 8 }, (_, i) =>
      node({
        id: `api:${i}`,
        type: "APIEndpoint",
        name: `GET /api/route-${i}/details`,
      }),
    );
    const packed = layoutBrainGraph([service, ...endpoints], []);
    expect(packed.nodes).toHaveLength(9);
    const svc = packed.nodes.find((row) => row.type === "Service")!;
    const apis = packed.nodes.filter((row) => row.type === "APIEndpoint");
    expect(Math.min(...apis.map((row) => row.x))).toBeGreaterThan(svc.x);
    expect(new Set(apis.map((row) => row.y)).size).toBeGreaterThan(1);
    expect(packed.height).toBeGreaterThan(280);
  });

  it("changes node positions across layout algorithms", () => {
    const layered = layoutBrainGraph(nodes, edges, "layers");
    const radial = layoutBrainGraph(nodes, edges, "radial");
    const moved = layered.nodes.some((n, i) => {
      const other = radial.nodes[i]!;
      return n.x !== other.x || n.y !== other.y;
    });
    expect(moved).toBe(true);
    expect(brainGraphLayoutUsesColumns("layers")).toBe(true);
    expect(brainGraphLayoutUsesColumns("radial")).toBe(false);
  });

  it("draws a cubic edge from the right of a source card", () => {
    const path = brainEdgePath({ x: 0, y: 0 }, { x: 300, y: 40 }, true);
    expect(path.startsWith(`M ${BRAIN_GRAPH_NODE_WIDTH}`)).toBe(true);
    expect(path).toContain("C");
  });

  it("fits a camera inside the stage, including oversized maps", () => {
    const cam = fitBrainGraphCamera({ width: 800, height: 400 }, { width: 400, height: 300 });
    expect(cam.z).toBeLessThanOrEqual(BRAIN_GRAPH_FIT_MAX_ZOOM);
    expect(cam.z).toBeGreaterThanOrEqual(BRAIN_GRAPH_MIN_ZOOM);
    const huge = fitBrainGraphCamera({ width: 8000, height: 5000 }, { width: 400, height: 300 });
    expect(huge.z).toBeLessThan(0.25);
    expect(huge.z).toBeGreaterThanOrEqual(BRAIN_GRAPH_MIN_ZOOM);
    expect(clampBrainGraphZoom(0.01)).toBe(BRAIN_GRAPH_MIN_ZOOM);
    expect(clampBrainGraphZoom(9)).toBe(2.4);
  });

  it("maps types to families and defaults large graphs to overview", () => {
    expect(brainGraphFamilyFor("APIEndpoint")).toBe("apis");
    expect(brainGraphFamilyFor("Service")).toBe("services");
    expect(defaultBrainGraphDetail(80)).toBe("overview");
    expect(defaultBrainGraphDetail(12)).toBe("full");
  });
});
