import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { BrainEdge, BrainNode } from "@locus/shared";
import { Select } from "@/components/layout/Select";
import {
  BRAIN_GRAPH_FAMILIES,
  BRAIN_GRAPH_LAYOUTS,
  BRAIN_GRAPH_NODE_HEIGHT,
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
  isLowConfidenceEdge,
  layoutBrainGraph,
  layoutBrainGraphBounds,
  presentBrainGraphFamilies,
  searchBrainNodes,
  shortBrainGraphLabel,
  visibleBrainGraph,
  type BrainGraphDetail,
  type BrainGraphFamilyId,
  type BrainGraphLayoutId,
  type BrainNodeInspection,
} from "@/lib/brainGraph";

export function BrainGraph(props: {
  nodes: BrainNode[];
  edges: BrainEdge[];
  layout: BrainGraphLayoutId;
  onLayout: (id: BrainGraphLayoutId) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BrainGraphDetail | null>(null);
  const [families, setFamilies] = useState<Set<BrainGraphFamilyId>>(() => allBrainGraphFamilies());
  const [neighborhoodOnly, setNeighborhoodOnly] = useState(false);
  const [isolateSource, setIsolateSource] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hitsOpen, setHitsOpen] = useState(false);
  const [camera, setCamera] = useState({ x: 0, y: 0, z: 1 });
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const fittedKey = useRef("");

  const nodeIds = useMemo(() => new Set(props.nodes.map((n) => n.id)), [props.nodes]);
  const isolateActive = Boolean(isolateSource && nodeIds.has(isolateSource));
  const level = detail ?? defaultBrainGraphDetail(props.nodes.length);
  const isolated = useMemo(
    () =>
      isolateActive && isolateSource
        ? isolateBrainPathIds(props.nodes, props.edges, isolateSource)
        : null,
    [props.nodes, props.edges, isolateActive, isolateSource],
  );
  const scopedNodes = isolated
    ? props.nodes.filter((n) => isolated.nodeIds.has(n.id))
    : props.nodes;
  const scopedEdges = isolated
    ? props.edges.filter((e) => isolated.edgeIds.has(e.id))
    : props.edges;
  const neighborhoodFocus = neighborhoodOnly ? selectedId : null;
  const visible = useMemo(
    () =>
      visibleBrainGraph(scopedNodes, scopedEdges, {
        detail: level,
        families,
        focusId: neighborhoodFocus,
        neighborhoodOnly: Boolean(neighborhoodFocus),
      }),
    [scopedNodes, scopedEdges, level, families, neighborhoodFocus],
  );
  const packed = useMemo(
    () => layoutBrainGraph(visible.nodes, visible.edges, props.layout),
    [visible.nodes, visible.edges, props.layout],
  );
  const pos = useMemo(
    () => new Map(packed.nodes.map((row) => [row.id, { x: row.x, y: row.y }])),
    [packed.nodes],
  );
  const topologyKey = `${props.layout}|${visible.nodes.map((n) => n.id).join("\0")}|${visible.edges.map((e) => e.id).join("\0")}`;
  const selected = selectedId ? (props.nodes.find((n) => n.id === selectedId) ?? null) : null;
  const inspection = useMemo(
    () => (selected ? inspectBrainNode(selected, props.nodes, props.edges) : null),
    [selected, props.nodes, props.edges],
  );
  const presentFamilies = useMemo(() => presentBrainGraphFamilies(props.nodes), [props.nodes]);
  const hits = useMemo(() => searchBrainNodes(props.nodes, query), [props.nodes, query]);
  const columns = brainGraphLayoutUsesColumns(props.layout);
  const neighbors = selectedId ? visible.neighborIds : new Set<string>();
  const hidden = props.nodes.length - visible.nodes.length;
  const bounds = layoutBrainGraphBounds(pos);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (fittedKey.current === topologyKey) return;
    const rect = stage.getBoundingClientRect();
    setCamera(
      fitBrainGraphCamera(
        { width: packed.width, height: packed.height },
        { width: Math.max(1, rect.width), height: Math.max(1, rect.height) },
      ),
    );
    fittedKey.current = topologyKey;
  }, [topologyKey, packed.width, packed.height]);

  useEffect(() => {
    const missing = (id: string | null) => Boolean(id && !nodeIds.has(id));
    if (missing(selectedId)) {
      setSelectedId(null);
      setNeighborhoodOnly(false);
    }
    if (missing(isolateSource)) setIsolateSource(null);
    if (missing(pinnedId)) setPinnedId(null);
  }, [nodeIds, selectedId, isolateSource, pinnedId]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onNativeWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = event.deltaY < 0 ? 1.08 : 0.92;
      const origin = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setCamera((cur) => {
        const z = clampBrainGraphZoom(cur.z * factor);
        const wx = (origin.x - cur.x) / cur.z;
        const wy = (origin.y - cur.y) / cur.z;
        return { z, x: origin.x - wx * z, y: origin.y - wy * z };
      });
    };
    el.addEventListener("wheel", onNativeWheel, { passive: false });
    return () => el.removeEventListener("wheel", onNativeWheel);
  }, []);

  function select(id: string | null): void {
    setSelectedId(id);
    if (!id) setNeighborhoodOnly(false);
  }

  function clearSelection(): void {
    if (pinnedId && pinnedId === selectedId) return;
    setPinnedId(null);
    select(null);
  }

  function toggleFamily(id: BrainGraphFamilyId): void {
    setFamilies((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        const stillVisible = scopedNodes.some((n) => next.has(brainGraphFamilyFor(n.type)));
        if (!stillVisible) return current;
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function zoomAt(factor: number): void {
    setCamera((cur) => ({
      ...cur,
      z: clampBrainGraphZoom(cur.z * factor),
    }));
  }

  function fitView(): void {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    setCamera(
      fitBrainGraphCamera(
        { width: packed.width, height: packed.height },
        { width: Math.max(1, rect.width), height: Math.max(1, rect.height) },
      ),
    );
    fittedKey.current = topologyKey;
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>): void {
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest("[data-node-id]")) return;
    drag.current = { x: event.clientX, y: event.clientY, cx: camera.x, cy: camera.y };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>): void {
    if (!drag.current) return;
    const start = drag.current;
    setCamera((cur) => ({
      x: start.cx + (event.clientX - start.x),
      y: start.cy + (event.clientY - start.y),
      z: cur.z,
    }));
  }

  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>): void {
    if (!drag.current) return;
    const moved =
      Math.abs(event.clientX - drag.current.x) > 3 || Math.abs(event.clientY - drag.current.y) > 3;
    drag.current = null;
    if (!moved) clearSelection();
  }

  return (
    <div className="brain-graph-host">
      <div className="brain-graph-toolbar" data-testid="brain-graph-toolbar">
        <div className="brain-graph-seg" aria-label="Graph detail">
          <button
            type="button"
            className={level === "overview" ? "on" : ""}
            aria-pressed={level === "overview"}
            data-testid="brain-graph-detail-overview"
            onClick={() => setDetail("overview")}
          >
            Overview
          </button>
          <button
            type="button"
            className={level === "full" ? "on" : ""}
            aria-pressed={level === "full"}
            data-testid="brain-graph-detail-full"
            onClick={() => setDetail("full")}
          >
            Full
          </button>
        </div>
        <div className="brain-graph-seg" aria-label="Graph families">
          {BRAIN_GRAPH_FAMILIES.filter((family) => presentFamilies.has(family.id)).map((family) => (
            <button
              key={family.id}
              type="button"
              className={families.has(family.id) ? "on" : ""}
              aria-pressed={families.has(family.id)}
              data-testid={`brain-graph-family-${family.id}`}
              onClick={() => toggleFamily(family.id)}
            >
              {family.label}
            </button>
          ))}
        </div>
        <label className="brain-graph-layout">
          Layout
          <Select
            compact
            testId="brain-graph-layout"
            ariaLabel="Graph layout algorithm"
            value={props.layout}
            options={BRAIN_GRAPH_LAYOUTS.map((row) => ({
              value: row.id,
              label: row.label,
            }))}
            onChange={(value) => {
              const next = BRAIN_GRAPH_LAYOUTS.find((row) => row.id === value)?.id;
              if (next) props.onLayout(next);
            }}
          />
        </label>
        <button
          type="button"
          className={`brain-graph-chip${neighborhoodOnly ? " on" : ""}`}
          data-testid="brain-graph-neighborhood"
          disabled={!selectedId}
          onClick={() => setNeighborhoodOnly((v) => !v)}
        >
          {neighborhoodOnly ? "Neighborhood" : "Focus neighbors"}
        </button>
        {isolateActive ? (
          <button
            type="button"
            className="brain-graph-chip on"
            data-testid="brain-graph-isolate-clear"
            onClick={() => setIsolateSource(null)}
          >
            Path isolate
          </button>
        ) : null}
        <label className="brain-graph-search">
          <input
            data-testid="brain-graph-search"
            placeholder="Find a node"
            aria-label="Search nodes"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHitsOpen(true);
            }}
            onFocus={() => setHitsOpen(true)}
            onBlur={() => window.setTimeout(() => setHitsOpen(false), 150)}
          />
          {hitsOpen && query.trim() && hits.length ? (
            <ul className="brain-graph-search-hits" data-testid="brain-graph-search-hits">
              {hits.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      select(n.id);
                      setQuery("");
                      setHitsOpen(false);
                    }}
                  >
                    {n.name}
                    <span>{n.type}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </label>
        <span className="brain-graph-count">
          {visible.nodes.length} nodes · {visible.edges.length} edges
          {hidden ? ` · ${hidden} hidden` : ""}
        </span>
      </div>
      <div className="brain-graph-stage" ref={stageRef}>
        <svg
          ref={svgRef}
          className="brain-graph"
          role="img"
          aria-label="Brain graph"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <defs>
            <marker
              id="brain-graph-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="brain-graph-arrow" />
            </marker>
          </defs>
          <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.z})`}>
            {visible.edges.map((edge) => {
              const from = pos.get(edge.from);
              const to = pos.get(edge.to);
              if (!from || !to) return null;
              const incident = selectedId === edge.from || selectedId === edge.to;
              const dim = Boolean(selectedId) && neighborhoodOnly && !incident;
              return (
                <g
                  key={edge.id}
                  className={dim ? "brain-graph-edge-wrap dim" : "brain-graph-edge-wrap"}
                >
                  <path
                    d={brainEdgePath(from, to, columns)}
                    className={`brain-graph-edge${isLowConfidenceEdge(edge) ? " inferred" : ""}${incident ? " on" : ""}`}
                    markerEnd="url(#brain-graph-arrow)"
                  />
                  {incident ? (
                    <text
                      className="brain-graph-edge-label"
                      x={(from.x + to.x + BRAIN_GRAPH_NODE_WIDTH) / 2}
                      y={(from.y + to.y + BRAIN_GRAPH_NODE_HEIGHT) / 2 - 6}
                      textAnchor="middle"
                    >
                      {edge.type.replaceAll("_", " ")}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {packed.nodes.map((row) => {
              const selected = selectedId === row.id;
              const dim =
                Boolean(selectedId) &&
                neighborhoodOnly &&
                !neighbors.has(row.id) &&
                row.id !== selectedId;
              return (
                <g
                  key={row.id}
                  data-node-id={row.id}
                  className={`brain-graph-card type-${row.type}${selected ? " selected" : ""}${dim ? " dim" : ""}`}
                  transform={`translate(${row.x} ${row.y})`}
                  onClick={(event) => {
                    event.stopPropagation();
                    select(row.id);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <title>{`${row.type} · ${row.name}\n${row.evidence ?? ""}`}</title>
                  <rect width={BRAIN_GRAPH_NODE_WIDTH} height={BRAIN_GRAPH_NODE_HEIGHT} rx={8} />
                  <text className="brain-graph-card-type" x={12} y={18}>
                    {row.type}
                  </text>
                  <text className="brain-graph-card-name" x={12} y={38}>
                    {shortBrainGraphLabel(row.name, selected ? 26 : 22)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        <div className="brain-graph-zoom" aria-label="Graph zoom">
          <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => zoomAt(0.92)}>
            −
          </button>
          <span>{Math.round(camera.z * 100)}%</span>
          <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => zoomAt(1.08)}>
            +
          </button>
          <button
            type="button"
            title="Fit view"
            aria-label="Fit view"
            data-testid="brain-graph-fit"
            onClick={fitView}
          >
            Fit
          </button>
        </div>
        {packed.nodes.length > 8 ? (
          <BrainGraphMinimap
            nodes={packed.nodes}
            width={bounds.width}
            height={bounds.height}
            camera={camera}
            stage={stageRef}
            onPan={(x, y) => setCamera((cur) => ({ ...cur, x, y }))}
          />
        ) : null}
        {inspection ? (
          <BrainGraphInspector
            info={inspection}
            pinned={pinnedId === inspection.id}
            isolateOn={isolateSource === inspection.id}
            onClose={() => {
              setPinnedId(null);
              select(null);
            }}
            onSelect={select}
            onPin={() => setPinnedId(pinnedId === inspection.id ? null : inspection.id)}
            onIsolate={() =>
              setIsolateSource((cur) => (cur === inspection.id ? null : inspection.id))
            }
          />
        ) : null}
      </div>
    </div>
  );
}

function BrainGraphMinimap(props: {
  nodes: Array<BrainNode & { x: number; y: number }>;
  width: number;
  height: number;
  camera: { x: number; y: number; z: number };
  stage: RefObject<HTMLDivElement | null>;
  onPan: (x: number, y: number) => void;
}) {
  const mw = 168;
  const mh = 108;
  const stage = props.stage.current;
  const vw = stage ? stage.clientWidth / props.camera.z : 240;
  const vh = stage ? stage.clientHeight / props.camera.z : 160;
  const vx = -props.camera.x / props.camera.z;
  const vy = -props.camera.y / props.camera.z;

  return (
    <svg
      className="brain-graph-minimap"
      viewBox={`0 0 ${props.width} ${props.height}`}
      width={mw}
      height={mh}
      aria-label="Brain graph overview"
      data-testid="brain-graph-minimap"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * props.width;
        const y = ((event.clientY - rect.top) / rect.height) * props.height;
        const z = props.camera.z;
        const host = props.stage.current;
        if (!host) return;
        props.onPan(host.clientWidth / 2 - x * z, host.clientHeight / 2 - y * z);
      }}
    >
      {props.nodes.map((n) => (
        <rect
          key={n.id}
          x={n.x}
          y={n.y}
          width={BRAIN_GRAPH_NODE_WIDTH}
          height={BRAIN_GRAPH_NODE_HEIGHT}
          rx={6}
          className={`brain-graph-mini type-${n.type}`}
        />
      ))}
      <rect x={vx} y={vy} width={vw} height={vh} className="brain-graph-mini-view" />
    </svg>
  );
}

function BrainGraphInspector(props: {
  info: BrainNodeInspection;
  pinned: boolean;
  isolateOn: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onPin: () => void;
  onIsolate: () => void;
}) {
  const { info, onClose } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="brain-inspector" data-testid="brain-graph-inspector">
      <div className="brain-inspector-head">
        <div className="brain-inspector-type">{info.typeLabel}</div>
        <div className="brain-inspector-roles">
          {info.roles.map((role) => (
            <span key={role} className="brain-inspector-chip">
              {role}
            </span>
          ))}
        </div>
        <button
          type="button"
          className="brain-inspector-close"
          aria-label="Close inspector"
          data-testid="brain-graph-inspector-close"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="brain-inspector-name">{info.name}</div>
      <p className="brain-inspector-purpose" data-testid="brain-graph-inspector-purpose">
        {info.purpose}
      </p>
      <div className="brain-inspector-meta">{info.id}</div>
      <div className="brain-inspector-meta">layer · {info.layer}</div>
      <div className="brain-inspector-meta" data-testid="brain-graph-inspector-degree">
        {info.degreeIn} in · {info.degreeOut} out
      </div>
      {info.pathSummary ? (
        <p className="brain-inspector-path" data-testid="brain-graph-inspector-path">
          {info.pathSummary}
        </p>
      ) : null}
      {info.facts.length ? (
        <dl className="brain-inspector-facts" data-testid="brain-graph-inspector-facts">
          {info.facts.map((fact) => (
            <div key={fact.key} className="brain-inspector-fact">
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <InspectorLinks
        title="Inputs"
        testId="brain-graph-inspector-inputs"
        links={info.inputs}
        extra={info.extraInputs}
        empty="Nothing in this graph points here."
        onSelect={props.onSelect}
      />
      <InspectorLinks
        title="Outputs"
        testId="brain-graph-inspector-outputs"
        links={info.outputs}
        extra={info.extraOutputs}
        empty="This claim does not point at anything in this graph."
        onSelect={props.onSelect}
      />
      <div className="brain-inspector-actions">
        <button
          type="button"
          className={props.isolateOn ? "btn primary" : "btn"}
          data-testid="brain-graph-isolate"
          title="Hide nodes that are not on a path from here to an API or contract."
          onClick={props.onIsolate}
        >
          Isolate path to sinks
        </button>
        <button
          type="button"
          className={props.pinned ? "btn primary" : "btn"}
          data-testid="brain-graph-pin"
          onClick={props.onPin}
        >
          {props.pinned ? "Unpin" : "Pin"}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => void navigator.clipboard?.writeText(info.id)}
        >
          Copy id
        </button>
        {info.evidence ? (
          <button
            type="button"
            className="btn ghost"
            onClick={() => void navigator.clipboard?.writeText(info.evidence!)}
          >
            Copy evidence
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function InspectorLinks(props: {
  title: string;
  testId: string;
  links: BrainNodeInspection["inputs"];
  extra: number;
  empty: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="brain-inspector-section" data-testid={props.testId}>
      <h3>
        {props.title}
        <span className="count">{props.links.length + props.extra}</span>
      </h3>
      {props.links.length ? (
        <ul>
          {props.links.map((link, i) => (
            <li key={`${link.edgeType}:${link.id}:${i}`}>
              <button
                type="button"
                className="brain-inspector-link"
                onClick={() => props.onSelect(link.id)}
              >
                <span className="brain-inspector-link-name">{link.name}</span>
                <span className="brain-inspector-link-meta">
                  {link.type ? `${link.type} · ` : ""}
                  {link.edgeLabel}
                  {link.inferred ? " · inferred" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">{props.empty}</p>
      )}
      {props.extra ? <p className="hint">+{props.extra} more</p> : null}
    </section>
  );
}
