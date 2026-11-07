import { useEffect, useMemo, useRef, useState } from "react";
import {
  layerForPath,
  patchFilesForLayer,
  preMergeAttention,
  shortLoadPath,
  type ChangeCohort,
  type ChangeLayer,
  type ChangeRange,
  type ChangeStack,
  type ChangeStackRevision,
  type PatchFile,
  type PreMergeBoard,
  type PreMergeRow,
} from "@locus/shared";
import { PatchCard, type DiffLineRef } from "@/components/chat/PatchCard";
import { SearchField } from "@/components/layout/SearchField";
import { MermaidDiagram } from "./MermaidDiagram";

export function ChangeStackPanel(props: {
  stack: ChangeStack | null;
  stale: boolean;
  busy: boolean;
  pullFiles: PatchFile[];
  pullHeadSha: string;
  selected?: DiffLineRef | null;
  commentBody: string;
  focused: boolean;
  compact?: boolean;
  summarizing?: boolean;
  revisions?: ChangeStackRevision[];
  viewingSha?: string;
  onViewRevision?: (sha: string) => void;
  onCommentBody: (value: string) => void;
  onSelectLine: (ref: DiffLineRef) => void;
  onComment: () => void;
  onClearComment: () => void;
  onUpdate: () => void;
  onJumpToFile: (path: string) => void;
  onOpenInIde: (focus: { path: string; line?: number }) => void;
  /** Set while Open PR in IDE is cloning or checking out, so IDE actions show that wait. */
  openingLabel?: string;
  onToggleFocus: () => void;
  layout?: import("@locus/shared").DiffLayout;
  viewedPaths?: ReadonlySet<string>;
  onLayoutChange?: (layout: import("@locus/shared").DiffLayout) => void;
  onToggleViewed?: (path: string, viewed: boolean) => void;
  /** Pull blockers shown before layer 1. Chat diffs omit this and open on the first layer. */
  preMerge?: PreMergeBoard | null;
  /** Cohort clicks pass a layer id so the stack opens on that layer instead of the overview. */
  focusLayerId?: string | null;
  /** Bumps when the operator opens the Stack tab or a cohort, so the view follows that click. */
  openToken?: number;
}) {
  const stack = props.stack;
  const layers = useMemo(() => flattenLayers(stack), [stack]);
  const showOverview = Boolean(props.preMerge);
  const [view, setView] = useState<"overview" | "layer">(
    showOverview && !props.focusLayerId ? "overview" : "layer",
  );
  const [layerId, setLayerId] = useState(props.focusLayerId || layers[0]?.layer.id || "");
  const [allFiles, setAllFiles] = useState(false);
  const [filter, setFilter] = useState("");
  const [activeRange, setActiveRange] = useState<string | null>(null);
  const diffRef = useRef<HTMLDivElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const pendingCommentFocus = useRef(false);
  const rangeListRef = useRef<HTMLUListElement>(null);
  const seenOpen = useRef(props.openToken);

  useEffect(() => {
    if (!layers.some((row) => row.layer.id === layerId)) {
      setLayerId(layers[0]?.layer.id ?? "");
    }
  }, [layers, layerId]);

  useEffect(() => {
    if (props.openToken === seenOpen.current) return;
    seenOpen.current = props.openToken;
    if (props.focusLayerId && layers.some((row) => row.layer.id === props.focusLayerId)) {
      setView("layer");
      setAllFiles(false);
      setActiveRange(null);
      setLayerId(props.focusLayerId);
      return;
    }
    if (showOverview) setView("overview");
  }, [props.openToken, props.focusLayerId, layers, showOverview]);

  const current = layers.find((row) => row.layer.id === layerId) ?? layers[0];
  const layerIndex = Math.max(
    0,
    layers.findIndex((row) => row.layer.id === (current?.layer.id ?? layerId)),
  );
  const nextLayer = layers[layerIndex + 1];
  const scoped = useMemo(
    () => (current ? patchFilesForLayer(props.pullFiles, current.layer) : []),
    [props.pullFiles, current],
  );

  const onToggleFocus = props.onToggleFocus;
  const compact = props.compact === true;
  const atOverview = showOverview && view === "overview";

  function showLayer(id: string) {
    setView("layer");
    setAllFiles(false);
    setActiveRange(null);
    setLayerId(id);
    props.onClearComment();
  }

  function step(delta: number) {
    const slots: Array<{ kind: "overview" } | { kind: "layer"; id: string }> = [];
    if (showOverview) slots.push({ kind: "overview" });
    for (const row of layers) slots.push({ kind: "layer", id: row.layer.id });
    if (!slots.length) return;
    const index =
      view === "overview"
        ? 0
        : Math.max(
            0,
            slots.findIndex((row) => row.kind === "layer" && row.id === layerId),
          );
    const next = slots[(index + delta + slots.length) % slots.length];
    if (!next) return;
    setAllFiles(false);
    setActiveRange(null);
    props.onClearComment();
    if (next.kind === "overview") setView("overview");
    else showLayer(next.id);
  }

  const stepRef = useRef(step);
  stepRef.current = step;

  useEffect(() => {
    if (compact) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.closest("input, textarea, select") || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "j" || event.key === "J") {
        event.preventDefault();
        stepRef.current(1);
      } else if (event.key === "k" || event.key === "K") {
        event.preventDefault();
        stepRef.current(-1);
      } else if (event.key === "z" || event.key === "Z") {
        event.preventDefault();
        onToggleFocus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggleFocus, compact]);

  useEffect(() => {
    const root = diffRef.current;
    if (!root || !current || typeof IntersectionObserver === "undefined") return;
    const nodes = [...root.querySelectorAll<HTMLElement>(".patch-hunk-wrap")];
    if (!nodes.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const start = Number((visible.target as HTMLElement).dataset.hunkStart);
        const path = (visible.target as HTMLElement).dataset.hunkPath;
        const match = current.layer.ranges.find(
          (range) => range.startLine === start && (!path || range.path === path),
        );
        if (match) setActiveRange(rangeKey(match));
      },
      { root, threshold: 0.35 },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [current, scoped]);

  function selectRange(range: ChangeRange, opts?: { comment?: boolean }) {
    setActiveRange(rangeKey(range));
    if (opts?.comment) pendingCommentFocus.current = true;
    props.onSelectLine({
      path: range.path,
      line: range.startLine,
      side: range.side,
    });
    const root = diffRef.current;
    const pathSel = `[data-hunk-path=${JSON.stringify(range.path)}]`;
    const hunk = root?.querySelector<HTMLElement>(
      `.patch-hunk-wrap${pathSel}[data-hunk-start="${range.startLine}"], .patch-hunk-wrap${pathSel}[data-hunk-old-start="${range.startLine}"]`,
    );
    hunk?.scrollIntoView?.({ block: "nearest" });
  }

  useEffect(() => {
    if (!pendingCommentFocus.current) return;
    pendingCommentFocus.current = false;
    commentRef.current?.focus();
  }, [props.selected]);

  useEffect(() => {
    if (!activeRange) return;
    const row = rangeListRef.current?.querySelector<HTMLElement>(
      `[data-range-key=${JSON.stringify(activeRange)}]`,
    );
    row?.scrollIntoView?.({ block: "nearest" });
  }, [activeRange]);

  if (!stack) {
    return (
      <div className={`pr-stack${compact ? " compact" : ""}`} data-testid="pr-stack">
        <p className="hint">Change stack appears once the pull files are loaded.</p>
      </div>
    );
  }

  const paths = stack.files.map((file) => file.path);
  const filteredFiles = stack.files.filter((file) =>
    file.path.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const revisions = props.revisions ?? [];
  const viewingSha = props.viewingSha || stack.headSha;
  const readOnly = props.stale || compact;

  const diagram = current?.layer.diagram?.mermaid ? current.layer.diagram : null;

  return (
    <div
      className={`pr-stack${props.focused ? " focused" : ""}${compact ? " compact" : ""}`}
      data-testid="pr-stack"
    >
      {compact ? null : (
        <div className="pr-stack-toolbar">
          {props.stale ? (
            <div className="pr-stack-stale" role="status">
              <span>
                Snapshot is from {stack.headSha.slice(0, 8) || "an older head"}. Head is{" "}
                {props.pullHeadSha.slice(0, 8) || "updated"}. Commenting needs the latest snapshot.
              </span>
              <button className="btn" disabled={props.busy} onClick={props.onUpdate}>
                Update
              </button>
            </div>
          ) : null}
          <div className="pr-stack-rev">
            {revisions.length ? (
              <label>
                Snapshot
                <select
                  aria-label="Change stack snapshot"
                  data-testid="pr-stack-revision"
                  value={viewingSha}
                  disabled={props.busy}
                  onChange={(event) => props.onViewRevision?.(event.target.value)}
                >
                  {revisions.map((row) => (
                    <option key={row.headSha} value={row.headSha}>
                      {row.headSha.slice(0, 8)}
                      {row.current ? " · current" : ""}
                      {row.source === "heuristic+model" ? " · summaries" : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="hint">{stack.headSha.slice(0, 8)}</span>
            )}
            {props.summarizing ? (
              <span className="hint" data-testid="pr-stack-summarizing">
                Writing summaries…
              </span>
            ) : stack.source === "heuristic+model" ? (
              <span className="hint">Model summaries</span>
            ) : (
              <span className="hint">Heuristic</span>
            )}
            {!atOverview && layers.length > 1 ? (
              <span className="hint" data-testid="pr-stack-progress">
                {layerIndex + 1} / {layers.length}
              </span>
            ) : null}
            <span className="pr-stack-keys hint">J / K layers · Z focus</span>
          </div>
        </div>
      )}
      <aside className="pr-stack-nav" hidden={props.focused} aria-label="Change stack layers">
        <div className="workspace-tree-head">
          <strong>STACK</strong>
          {!atOverview && layers.length > 1 ? (
            <span className="hint">
              {layerIndex + 1} / {layers.length}
            </span>
          ) : null}
        </div>
        <div className="pr-stack-nav-scroll">
          {showOverview && props.preMerge ? (
            <button
              type="button"
              className={`pr-stack-all ${atOverview ? "active" : ""}`}
              data-testid="pr-stack-premerge-nav"
              aria-pressed={atOverview}
              onClick={() => {
                setView("overview");
                setAllFiles(false);
                setActiveRange(null);
                props.onClearComment();
              }}
            >
              Overview
              <span className="hint">{preMergeAttention(props.preMerge)}</span>
            </button>
          ) : null}
          {stack.cohorts.map((cohort, index) => (
            <CohortNav
              key={cohort.id}
              cohort={cohort}
              index={index}
              activeId={atOverview ? "" : layerId}
              onSelect={showLayer}
            />
          ))}
          {compact ? null : (
            <button
              type="button"
              className={`pr-stack-all ${allFiles ? "active" : ""}`}
              aria-pressed={allFiles}
              onClick={() => setAllFiles((value) => !value)}
            >
              All files
              <span className="hint">{stack.files.length}</span>
            </button>
          )}
          {allFiles && !compact ? (
            <>
              <SearchField
                className="workspace-filter"
                wrapClassName="workspace-filter-wrap"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter files..."
                aria-label="Filter stack files"
              />
              <ul className="pr-stack-files">
                {filteredFiles.map((file) => (
                  <li key={`${file.layerId}:${file.path}`}>
                    <button
                      type="button"
                      className={current?.layer.id === file.layerId ? "on" : undefined}
                      title={file.path}
                      onClick={() => {
                        const loc = layerForPath(stack, file.path);
                        showLayer(loc?.layerId ?? file.layerId);
                      }}
                    >
                      <span className="patch-path">{shortLoadPath(file.path, paths)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </aside>
      <div className="pr-stack-diff" ref={diffRef}>
        {atOverview && props.preMerge ? (
          <PreMergeOverview
            board={props.preMerge}
            nextLabel={layers[0] ? layerLabel(layers[0].layer) : undefined}
            onNext={layers[0] ? () => step(1) : undefined}
            onOpenLayer={showLayer}
            onOpenInIde={props.onOpenInIde}
            openingLabel={props.openingLabel}
          />
        ) : current ? (
          <>
            <header className="pr-stack-diff-head">
              <div>
                <p className="eyebrow">
                  {current.cohort.title} · {current.layer.title}
                  {layers.length > 1 ? ` · ${layerIndex + 1} of ${layers.length}` : ""}
                </p>
                <h3>{layerLabel(current.layer)}</h3>
              </div>
              <div className="pr-stack-diff-meta">
                <span className="hint">
                  {current.layer.fileCount} file{current.layer.fileCount === 1 ? "" : "s"}
                  {current.layer.commentCount
                    ? ` · ${current.layer.commentCount} comment${
                        current.layer.commentCount === 1 ? "" : "s"
                      }`
                    : ""}
                </span>
                {compact || (layers.length < 2 && !showOverview) ? null : (
                  <div className="pr-stack-step">
                    <button
                      type="button"
                      className="btn small ghost"
                      disabled={layerIndex === 0 && !showOverview}
                      onClick={() => step(-1)}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="btn small ghost"
                      data-testid="pr-stack-next"
                      disabled={!nextLayer}
                      onClick={() => step(1)}
                    >
                      Next
                      {nextLayer ? ` · ${layerLabel(nextLayer.layer)}` : ""}
                    </button>
                  </div>
                )}
              </div>
            </header>
            {diagram ? (
              <MermaidDiagram
                source={diagram.mermaid}
                kind={diagram.kind}
                caption={compact ? undefined : current.layer.intent || current.layer.title}
              />
            ) : null}
            {scoped.length ? (
              <div className="pr-stack-diff-files" data-testid="pr-stack-diff-files">
                <PatchCard
                  files={scoped}
                  density={props.compact ? "chat" : "review"}
                  selected={readOnly ? null : props.selected}
                  onLineSelect={readOnly ? undefined : props.onSelectLine}
                  layout={props.layout}
                  viewedPaths={props.viewedPaths}
                  onLayoutChange={props.onLayoutChange}
                  onToggleViewed={readOnly ? undefined : props.onToggleViewed}
                  onOpenSymbol={(path, line) => props.onOpenInIde({ path, line })}
                />
              </div>
            ) : (
              <div className="pr-stack-empty">
                <p className="hint">No textual diff in this layer.</p>
                {compact || !nextLayer ? null : (
                  <button
                    type="button"
                    className="btn"
                    data-testid="pr-stack-empty-next"
                    onClick={() => step(1)}
                  >
                    Next · {layerLabel(nextLayer.layer)}
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="hint">No reviewable layers in this pull request.</p>
        )}
      </div>
      <aside className="pr-stack-rail" hidden={props.focused} aria-label="Range summaries">
        <div className="workspace-tree-head">
          <strong>{atOverview ? "PRE-MERGE" : "RANGES"}</strong>
        </div>
        {atOverview ? (
          <p className="hint">Open a row to jump into its layer or the IDE.</p>
        ) : current && current.layer.ranges.length ? (
          <ul className="pr-stack-ranges" ref={rangeListRef}>
            {current.layer.ranges.map((range) => {
              const key = rangeKey(range);
              const selected = rangeIsActive(range, activeRange, props.selected);
              return (
                <li key={key} data-range-key={key}>
                  <button
                    type="button"
                    className={selected ? "active" : undefined}
                    onClick={() => selectRange(range)}
                  >
                    <span className="pr-stack-range-summary">{range.summary}</span>
                    <span className="patch-path" title={range.path}>
                      {shortLoadPath(range.path, paths)}:{range.startLine}–{range.endLine}
                    </span>
                  </button>
                  {compact ? null : (
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn small ghost"
                        disabled={readOnly || props.busy}
                        onClick={() => selectRange(range, { comment: true })}
                      >
                        Comment
                      </button>
                      <button
                        type="button"
                        className="btn small ghost"
                        onClick={() => props.onJumpToFile(range.path)}
                      >
                        Files
                      </button>
                      <button
                        type="button"
                        className="btn small ghost"
                        disabled={Boolean(props.openingLabel)}
                        onClick={() =>
                          props.onOpenInIde({ path: range.path, line: range.startLine })
                        }
                      >
                        {props.openingLabel ?? "IDE"}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="hint">No ranges in this layer.</p>
        )}
        {compact || atOverview ? null : props.selected && !readOnly ? (
          <section className="pr-inline-comment">
            <header>
              <span>
                Commenting on {props.selected.path}:{props.selected.line} (
                {props.selected.side === "LEFT" ? "old" : "new"})
              </span>
              <button type="button" className="btn small ghost" onClick={props.onClearComment}>
                Clear
              </button>
            </header>
            <textarea
              ref={commentRef}
              value={props.commentBody}
              onChange={(e) => props.onCommentBody(e.target.value)}
              rows={3}
              aria-label="Range comment"
              placeholder="Comment on this range…"
            />
            <button
              className="btn"
              disabled={props.busy || !props.commentBody.trim()}
              onClick={props.onComment}
            >
              Comment
            </button>
          </section>
        ) : (
          <p className="hint">
            {compact ? "Layer summaries for this turn." : "Comment posts to the forge."}
          </p>
        )}
      </aside>
    </div>
  );
}

function PreMergeOverview(props: {
  board: PreMergeBoard;
  nextLabel?: string;
  onNext?: () => void;
  onOpenLayer: (layerId: string) => void;
  onOpenInIde: (focus: { path: string; line?: number }) => void;
  openingLabel?: string;
}) {
  const sections: Array<{ title: string; rows: PreMergeRow[]; empty: string }> = [
    { title: "Failing checks", rows: props.board.failingChecks, empty: "No failing checks." },
    { title: "Open comments", rows: props.board.openComments, empty: "No open comments." },
    { title: "Conflicts", rows: props.board.conflicts, empty: "No conflict markers." },
    {
      title: "High-risk load path",
      rows: props.board.highRiskFiles,
      empty: "No high-risk files.",
    },
  ];

  function openRow(row: PreMergeRow) {
    if (row.layerId) {
      props.onOpenLayer(row.layerId);
      return;
    }
    if (row.path)
      props.onOpenInIde({ path: row.path, line: row.side === "LEFT" ? undefined : row.line });
  }

  return (
    <div className="pr-premerge" data-testid="pr-premerge">
      <header className="pr-stack-diff-head">
        <div>
          <p className="eyebrow">Before layer 1</p>
          <h3>Pre-merge</h3>
        </div>
        {props.onNext ? (
          <div className="pr-stack-step">
            <button
              type="button"
              className="btn small ghost"
              data-testid="pr-stack-next"
              onClick={props.onNext}
            >
              Next{props.nextLabel ? ` · ${props.nextLabel}` : ""}
            </button>
          </div>
        ) : null}
      </header>
      <div className="pr-premerge-sections">
        {sections.map((section) => (
          <section key={section.title}>
            <h4>
              {section.title}
              <span className="hint">{section.rows.length}</span>
            </h4>
            {section.rows.length === 0 ? (
              <p className="hint">{section.empty}</p>
            ) : (
              <ul>
                {section.rows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      disabled={!row.layerId && !row.path}
                      onClick={() => openRow(row)}
                    >
                      <span>{row.title}</span>
                      <span className="hint">{row.detail}</span>
                    </button>
                    {row.path ? (
                      <button
                        type="button"
                        className="btn small ghost"
                        disabled={Boolean(props.openingLabel)}
                        onClick={() =>
                          props.onOpenInIde({
                            path: row.path!,
                            line: row.side === "LEFT" ? undefined : row.line,
                          })
                        }
                      >
                        {props.openingLabel ?? "Open in IDE"}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function CohortNav(props: {
  cohort: ChangeCohort;
  index: number;
  activeId: string;
  onSelect: (layerId: string) => void;
}) {
  return (
    <div className="pr-stack-cohort">
      <p className="pr-stack-cohort-title">
        {props.index + 1}. {props.cohort.title}
      </p>
      {props.cohort.summary ? (
        <p className="pr-stack-cohort-summary">{props.cohort.summary}</p>
      ) : null}
      <ul>
        {props.cohort.layers.map((layer, index) => (
          <li key={layer.id}>
            <button
              type="button"
              className={props.activeId === layer.id ? "active" : undefined}
              onClick={() => props.onSelect(layer.id)}
            >
              <span>
                {layerLabel(layer)}
                <span className="pr-stack-layer-index">Layer {index + 1}</span>
              </span>
              <span className="hint">
                {layer.fileCount}
                {layer.commentCount ? ` · ${layer.commentCount}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function layerLabel(layer: ChangeLayer): string {
  const raw = (layer.intent || layer.title).trim();
  if (!raw) return layer.title;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function rangeIsActive(
  range: ChangeRange,
  active: string | null,
  selected?: DiffLineRef | null,
): boolean {
  if (active && active === rangeKey(range)) return true;
  if (!selected || selected.path !== range.path || selected.side !== range.side) return false;
  return selected.line >= range.startLine && selected.line <= range.endLine;
}

function flattenLayers(
  stack: ChangeStack | null,
): Array<{ cohort: ChangeCohort; layer: ChangeLayer }> {
  if (!stack) return [];
  return stack.cohorts.flatMap((cohort) => cohort.layers.map((layer) => ({ cohort, layer })));
}

function rangeKey(range: ChangeRange): string {
  return `${range.path}:${range.side}:${range.startLine}`;
}
