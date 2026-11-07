import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { BrainDocument, BrainMemory, BrainMemoryKind } from "@locus/shared";
import {
  BRAIN_MEMORY_KINDS,
  brainIndexedRepoKey,
  brainIndexedRepoLabel,
  emptyBrain,
  filterBrainActivity,
  filterBrainGraph,
  filterBrainMemories,
  openBrainCorrections,
  shortRepoName,
} from "@locus/shared";
import { api } from "@/lib/api";
import { useStore } from "@/state/store";
import { Mascot } from "@/components/layout/Mascot";
import { IconFolder } from "@/components/layout/Icons";
import { FeatureHintRow } from "@/components/layout/FeatureHint";
import { SECTION_FEATURE_HINTS } from "@/lib/discoverability";
import { HostFolderPicker } from "@/components/workspace/HostFolderField";
import { loadBrainViewPrefs, saveBrainViewPrefs, type BrainSegment } from "@/lib/brainViewPrefs";
import { type BrainGraphLayoutId } from "@/lib/brainGraph";
import { BrainGraph } from "./BrainGraph";

export { layoutBrainGraph, shortBrainGraphLabel } from "@/lib/brainGraph";

export function BrainPane() {
  const { state, dispatch } = useStore();
  const initialPrefs = useMemo(() => loadBrainViewPrefs(), []);
  const [doc, setDoc] = useState<BrainDocument | null>(null);
  const [path, setPath] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [note, setNote] = useState("");
  const [query, setQuery] = useState(state.queries.brain ?? "");
  const [hits, setHits] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState("");
  const [segment, setSegment] = useState<BrainSegment>(initialPrefs.segment);
  /** `null` = all indexed checkouts. */
  const [repoKey, setRepoKey] = useState<string | null>(initialPrefs.repoKey);
  const [layout, setLayout] = useState<BrainGraphLayoutId>(initialPrefs.layout);
  const [kindFilter, setKindFilter] = useState<BrainMemoryKind | null>(null);
  const [ambientOnly, setAmbientOnly] = useState(false);
  const [expandedMemoryId, setExpandedMemoryId] = useState<string | null>(null);
  const paused = state.config?.brain?.ingestPaused === true;

  useEffect(() => {
    let cancelled = false;
    void api
      .brain()
      .then((next) => {
        if (cancelled) return;
        setDoc(next);
        dispatch({ type: "brain", brain: next });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the brain");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!state.brain?.updatedAt || !doc) return;
    if (state.brain.updatedAt === doc.updatedAt) return;
    void api
      .brain()
      .then(setDoc)
      .catch(() => undefined);
  }, [state.brain?.updatedAt, doc]);

  useEffect(() => {
    saveBrainViewPrefs({ segment, repoKey, layout });
  }, [segment, repoKey, layout]);

  useEffect(() => {
    if (repoKey == null || !doc) return;
    if (doc.repos.some((row) => brainIndexedRepoKey(row) === repoKey)) return;
    setRepoKey(null);
  }, [doc, repoKey]);

  async function run(kind: string, fn: () => Promise<void>): Promise<void> {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  function onBuild(e: FormEvent): void {
    e.preventDefault();
    void run("build", async () => {
      const next = await api.brainBuild({ path: path.trim() || undefined });
      setDoc(next);
      dispatch({ type: "brain", brain: next });
      setOutput(next.output ?? "");
    });
  }

  function onRemember(e: FormEvent): void {
    e.preventDefault();
    const text = note.trim();
    if (!text) return;
    void run("remember", async () => {
      const indexed =
        repoKey == null || !doc
          ? null
          : (doc.repos.find((row) => brainIndexedRepoKey(row) === repoKey) ?? null);
      const scope = indexed?.url?.trim() || indexed?.path?.trim() || undefined;
      const next = await api.brainRemember(text, scope);
      setDoc(next);
      dispatch({ type: "brain", brain: next });
      setNote("");
      setOutput(next.output ?? "");
    });
  }

  function onSearch(e: FormEvent): void {
    e.preventDefault();
    const q = query.trim();
    void run("search", async () => {
      if (!q) {
        setHits("");
        return;
      }
      const next = await api.brainSearch(q);
      setHits(next.output);
    });
  }

  const brain = doc ?? emptyBrain();
  const empty = brain.nodes.length === 0 && brain.memories.length === 0;
  const scopedRepo =
    repoKey == null
      ? null
      : (brain.repos.find((row) => brainIndexedRepoKey(row) === repoKey) ?? null);

  const graph = useMemo(() => filterBrainGraph(brain, scopedRepo), [brain, scopedRepo]);
  const memories = useMemo(() => {
    let rows = filterBrainMemories(brain.memories, scopedRepo);
    if (kindFilter) rows = rows.filter((row) => row.kind === kindFilter);
    if (ambientOnly) rows = rows.filter((row) => row.ambient);
    return rows;
  }, [brain.memories, scopedRepo, kindFilter, ambientOnly]);
  const activity = useMemo(
    () => filterBrainActivity(brain.activity, scopedRepo),
    [brain.activity, scopedRepo],
  );
  const scopedMemoryCount = useMemo(
    () => filterBrainMemories(brain.memories, scopedRepo).length,
    [brain.memories, scopedRepo],
  );
  const inbox = openBrainCorrections(brain);
  const showEmptyHero = empty && segment === "graph";

  function selectRepo(next: string | null): void {
    setRepoKey(next);
    setExpandedMemoryId(null);
  }

  return (
    <div className={`brain-pane${empty ? " brain-empty" : ""}`}>
      <div className={`brain-body${showEmptyHero ? " brain-body-center" : ""}`}>
        <div className={showEmptyHero ? "brain-start" : "brain-filled"}>
          {showEmptyHero ? (
            <div className="empty-card">
              <Mascot pose="idle" />
              <h2>Brain</h2>
              <p>
                Index a repo folder to learn services and APIs. Remember durable conclusions. Coding
                agents orient on this automatically — grep still wins for the tree.
              </p>
              <FeatureHintRow hint={SECTION_FEATURE_HINTS.brain!} />
            </div>
          ) : null}

          {brain.repos.length ? (
            <div className="brain-graph-scopes" role="tablist" aria-label="Brain repo filter">
              <button
                type="button"
                role="tab"
                className={`brain-graph-scope${repoKey == null ? " on" : ""}`}
                aria-selected={repoKey == null}
                onClick={() => selectRepo(null)}
              >
                All
              </button>
              {brain.repos.map((row) => {
                const key = brainIndexedRepoKey(row);
                const on = repoKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    className={`brain-graph-scope${on ? " on" : ""}`}
                    aria-selected={on}
                    title={row.url || row.path || key}
                    onClick={() => selectRepo(key)}
                  >
                    {brainIndexedRepoLabel(row)}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="brain-segments" role="tablist" aria-label="Brain section">
            {(
              [
                ["graph", "Graph"],
                ["memories", "Memories"],
                ["inbox", inbox.length ? `Inbox (${inbox.length})` : "Inbox"],
                ["activity", "Activity"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`brain-tab-${id}`}
                className={`brain-segment${segment === id ? " on" : ""}`}
                aria-selected={segment === id}
                aria-controls={`brain-panel-${id}`}
                onClick={() => setSegment(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {error ? <p className="error-row">{error}</p> : null}
          {output ? <p className="brain-output">{output}</p> : null}

          {segment === "graph" ? (
            <div
              className="brain-segment-panel"
              role="tabpanel"
              id="brain-panel-graph"
              aria-labelledby="brain-tab-graph"
            >
              {!empty ? (
                <div className="brain-stats">
                  <div className="brain-stat">
                    <strong>{graph.nodes.length}</strong>
                    <span>nodes</span>
                  </div>
                  <div className="brain-stat">
                    <strong>{graph.edges.length}</strong>
                    <span>edges</span>
                  </div>
                  <div className="brain-stat">
                    <strong>{scopedMemoryCount}</strong>
                    <span>memories</span>
                  </div>
                  <div className="brain-stat">
                    <strong>{scopedRepo ? 1 : brain.repos.length}</strong>
                    <span>indexed repos</span>
                  </div>
                </div>
              ) : null}

              <div className="brain-actions">
                <button
                  className="btn"
                  type="button"
                  disabled={busy === "export"}
                  onClick={() =>
                    void run("export", async () => {
                      const next = await api.brainExport();
                      setDoc(next);
                      setOutput(next.path ? `Exported to ${next.path}` : "Exported.");
                    })
                  }
                >
                  {busy === "export" ? "Exporting…" : "Export"}
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={busy === "ingest"}
                  onClick={() =>
                    void run("ingest", async () => {
                      const next = await api.brainIngest(!paused);
                      setDoc(next);
                      if (next.brain && state.config) {
                        dispatch({
                          type: "config",
                          config: { ...state.config, brain: next.brain },
                        });
                      }
                      setOutput(paused ? "Ingest resumed." : "Ingest paused.");
                    })
                  }
                >
                  {busy === "ingest" ? "Saving…" : paused ? "Resume ingest" : "Pause ingest"}
                </button>
              </div>

              <form className="brain-toolbar" onSubmit={onBuild}>
                <label>
                  Repo folder
                  <div className="host-folder-row">
                    <span className="host-folder-icon" aria-hidden>
                      <IconFolder />
                    </span>
                    <input
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                      placeholder="/path/to/repo"
                      spellCheck={false}
                      aria-label="Repo folder to index"
                    />
                    <button type="button" className="btn ghost" onClick={() => setPickerOpen(true)}>
                      Browse
                    </button>
                  </div>
                </label>
                <button className="btn primary" type="submit" disabled={busy === "build"}>
                  {busy === "build" ? "Building…" : "Build"}
                </button>
              </form>

              {brain.nodes.length ? (
                graph.nodes.length ? (
                  <BrainGraph
                    nodes={graph.nodes}
                    edges={graph.edges}
                    layout={layout}
                    onLayout={setLayout}
                  />
                ) : (
                  <p className="hint">
                    No tagged claims for this checkout yet. Re-index the folder to attach scope
                    tags.
                  </p>
                )
              ) : null}
            </div>
          ) : null}

          {segment === "memories" ? (
            <div
              className="brain-segment-panel"
              role="tabpanel"
              id="brain-panel-memories"
              aria-labelledby="brain-tab-memories"
            >
              <form className="brain-toolbar" onSubmit={onRemember}>
                <label>
                  Remember
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="we never bill from the worker"
                    aria-label="Fact to remember"
                    disabled={paused}
                  />
                </label>
                <button
                  className="btn"
                  type="submit"
                  disabled={busy === "remember" || !note.trim() || paused}
                >
                  {busy === "remember" ? "Saving…" : "Remember"}
                </button>
              </form>

              <form className="brain-toolbar" onSubmit={onSearch}>
                <label>
                  Search whole brain
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="charge API, health check, never bill"
                    aria-label="Search the whole brain"
                  />
                </label>
                <button className="btn" type="submit" disabled={busy === "search"}>
                  {busy === "search" ? "Searching…" : "Search"}
                </button>
              </form>

              {hits ? <pre className="brain-search-out">{hits}</pre> : null}

              <div className="brain-memory-filters" aria-label="Memory filters">
                <div className="brain-graph-scopes" role="tablist" aria-label="Memory kind">
                  <button
                    type="button"
                    role="tab"
                    className={`brain-graph-scope${kindFilter == null ? " on" : ""}`}
                    aria-selected={kindFilter == null}
                    onClick={() => setKindFilter(null)}
                  >
                    All kinds
                  </button>
                  {BRAIN_MEMORY_KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      role="tab"
                      className={`brain-graph-scope${kindFilter === kind ? " on" : ""}`}
                      aria-selected={kindFilter === kind}
                      onClick={() => setKindFilter(kind)}
                    >
                      {kind}
                    </button>
                  ))}
                </div>
                <label className="brain-ambient-toggle">
                  <input
                    type="checkbox"
                    checked={ambientOnly}
                    onChange={(e) => setAmbientOnly(e.target.checked)}
                  />
                  Ambient only
                </label>
              </div>

              {memories.length ? (
                <ul className="brain-memory-list">
                  {memories.slice(0, 40).map((row) => (
                    <MemoryRow
                      key={row.id}
                      row={row}
                      showRepo={repoKey == null}
                      expanded={expandedMemoryId === row.id}
                      onToggle={() =>
                        setExpandedMemoryId((cur) => (cur === row.id ? null : row.id))
                      }
                    />
                  ))}
                </ul>
              ) : (
                <p className="hint">No memories in this filter.</p>
              )}
            </div>
          ) : null}

          {segment === "inbox" ? (
            <div
              className="brain-segment-panel"
              role="tabpanel"
              id="brain-panel-inbox"
              aria-labelledby="brain-tab-inbox"
            >
              <p className="hint">
                Agents flag wrong claims with <code>correct_graph</code>. Accept lowers confidence
                and contradicts the memory; Dismiss leaves the graph as-is.
              </p>
              {inbox.length ? (
                <ul className="brain-memory-list" data-testid="brain-inbox">
                  {inbox.map((row) => (
                    <li key={row.id} className="brain-activity-item">
                      <span className="brain-activity-kind">{row.nodeId || row.memoryId}</span>
                      <span className="brain-activity-text" title={row.reason}>
                        {row.reason}
                      </span>
                      <span className="brain-pop-actions">
                        <button
                          type="button"
                          className="btn small primary"
                          disabled={busy === `accept:${row.id}`}
                          onClick={() =>
                            void run(`accept:${row.id}`, async () => {
                              const next = await api.brainCorrect({
                                id: row.id,
                                action: "accepted",
                              });
                              setDoc(next);
                              dispatch({ type: "brain", brain: next });
                              setOutput(next.output ?? "");
                            })
                          }
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="btn small ghost"
                          disabled={busy === `dismiss:${row.id}`}
                          onClick={() =>
                            void run(`dismiss:${row.id}`, async () => {
                              const next = await api.brainCorrect({
                                id: row.id,
                                action: "dismissed",
                              });
                              setDoc(next);
                              dispatch({ type: "brain", brain: next });
                              setOutput(next.output ?? "");
                            })
                          }
                        >
                          Dismiss
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hint">Inbox is empty.</p>
              )}
            </div>
          ) : null}

          {segment === "activity" ? (
            <div
              className="brain-segment-panel"
              role="tabpanel"
              id="brain-panel-activity"
              aria-labelledby="brain-tab-activity"
            >
              {activity.length ? (
                <div className="brain-activity" data-testid="brain-activity">
                  {activity.slice(0, 40).map((row) => (
                    <div key={row.id} className="brain-activity-item">
                      <span className="brain-activity-kind">{row.kind}</span>
                      <span className="brain-activity-text" title={row.text}>
                        {row.text}
                      </span>
                      <span className="brain-activity-ts">{formatBrainRelativeTime(row.at)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="hint">
                  {scopedRepo
                    ? "No activity attributed to this checkout yet."
                    : "No brain activity yet."}
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <HostFolderPicker
        open={pickerOpen}
        initialPath={path}
        title="Repo folder"
        confirmLabel="Select folder"
        lead="Choose a repo folder on this machine to index into the brain."
        onClose={() => setPickerOpen(false)}
        onPick={setPath}
      />
    </div>
  );
}

function MemoryRow(props: {
  row: BrainMemory;
  showRepo: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { row, showRepo, expanded, onToggle } = props;
  const repoLabel = row.repo
    ? /^https?:\/\//i.test(row.repo)
      ? shortRepoName(row.repo)
      : row.repo
    : null;

  return (
    <li className={`brain-memory-row${expanded ? " open" : ""}`}>
      <button
        type="button"
        className="brain-memory-summary"
        aria-expanded={expanded}
        aria-controls={`brain-memory-detail-${row.id}`}
        onClick={onToggle}
      >
        <span className={`brain-memory-kind kind-${row.kind}`}>{row.kind}</span>
        <span className="brain-memory-claim">{row.claim}</span>
        {row.ambient ? <span className="brain-memory-ambient">ambient</span> : null}
        {showRepo && repoLabel ? (
          <span className="brain-memory-repo" title={row.repo}>
            {repoLabel}
          </span>
        ) : null}
        <span className="brain-memory-time">{formatBrainRelativeTime(row.createdAt)}</span>
      </button>
      {expanded ? (
        <div className="brain-memory-detail" id={`brain-memory-detail-${row.id}`}>
          <p className="brain-memory-full">{row.claim}</p>
          <div className="brain-memory-meta">
            <span>source · {row.source}</span>
            <span>
              evidence · {row.evidenceCount}
              {row.contradictionCount ? ` · contradictions · ${row.contradictionCount}` : ""}
            </span>
            <span>{row.createdAt}</span>
            {row.sessionId ? <span>session · {row.sessionId}</span> : null}
          </div>
          <div className="brain-memory-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={() => void navigator.clipboard?.writeText(row.id)}
            >
              Copy id
            </button>
            {row.repo ? (
              <button type="button" className="btn ghost" onClick={() => openBrainRepo(row.repo!)}>
                {/^https?:\/\//i.test(row.repo) ? "Open repo" : "Copy path"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function openBrainRepo(repo: string): void {
  if (/^https?:\/\//i.test(repo)) {
    window.open(repo, "_blank", "noopener,noreferrer");
    return;
  }
  void navigator.clipboard?.writeText(repo);
}

/** Relative time for brain lists; falls back to ISO date after a week. */
export function formatBrainRelativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 45) return "just now";
  if (sec < 3600) {
    const n = Math.max(1, Math.floor(sec / 60));
    return `${n} ${n === 1 ? "minute" : "minutes"} ago`;
  }
  if (sec < 86400) {
    const n = Math.floor(sec / 3600);
    return `${n} ${n === 1 ? "hour" : "hours"} ago`;
  }
  if (sec < 86400 * 7) {
    const n = Math.floor(sec / 86400);
    return `${n} ${n === 1 ? "day" : "days"} ago`;
  }
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
