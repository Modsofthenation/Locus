import {
  memo,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useContext,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  formatFileComment,
  hasConflictMarkers,
  matchGitDest,
  offsetsToLines,
  resolveConflictMarkers,
  workspaceRelFromToolPath,
} from "@locus/shared";
import { createPortal } from "react-dom";
import {
  api,
  type WorkspaceBlameLine,
  type WorkspaceDiagnostic,
  type WorkspaceDebugState,
  type WorkspaceEntry,
  type WorkspaceFileChange,
  type WorkspaceGitStatus,
  type WorkspaceHighlight,
  type WorkspaceIndexStatus,
  type WorkspaceLocation,
  type WorkspaceOutlineItem,
  type WorkspaceSignatureHelp,
} from "@/lib/api";
import { formatMarkdown } from "@/lib/markdown";
import { askConfirm, askPrompt } from "@/lib/dialog";
import { showUndoNotice } from "@/lib/notice";
import { BusyButton } from "@/components/layout/Skeleton";
import { Tooltip } from "@/components/layout/Tooltip";
import { WorkspaceEditorTabs } from "./WorkspaceEditorTabs";
import { matchModKey } from "@/lib/shortcuts";
import { useDialogFocus } from "@/lib/useDialogFocus";
import { isUnreachableError, UNREACHABLE_ERROR } from "@/lib/net";
import { loadEditorDrafts, saveEditorDrafts } from "@/lib/editorDrafts";
import { loadEditorOpenFiles, saveEditorOpenFiles } from "@/lib/editorOpenFiles";
import {
  forgetWorkspaceFiles,
  loadWorkspaceFile,
  peekWorkspaceFile,
  rememberWorkspaceFile,
} from "@/lib/workspaceFileCache";
import {
  activateInGroup,
  clampEditorSplit,
  closeInGroup,
  closeOthersInFocused,
  closeSavedInFocused,
  EDITOR_SPLIT_DEFAULT,
  EDITOR_SPLIT_MAX,
  EDITOR_SPLIT_MIN,
  editorSplitColumns,
  joinEditor,
  openInFocused,
  otherPath,
  remapSplitPath,
  splitEditor,
  type EditorSplit,
} from "@/lib/editorSplit";
import { loadExplorerExpanded, saveExplorerExpanded } from "@/lib/explorerExpanded";
import { requestWorkspaceTerminalRun } from "./WorkspaceTerminal";
import {
  fixedContainingOrigin,
  MenuItem,
  MenuSep,
  OverflowMenu,
  placePointerMenu,
} from "@/components/layout/OverflowMenu";
import {
  highlightSource,
  highlightVisible,
  languageFromPath,
  visibleHighlightSlice,
  type HighlightDoc,
} from "@/lib/highlight";
import {
  EDITOR_LINE_PX,
  EDITOR_PAD_PX,
  EDITOR_CHAR_PX,
  EDITOR_VIEW_FALLBACK,
  diagsInView,
  editorScrollHeight,
  editorViewRange,
  lineOffsetInView,
  markHeightPx,
  marksInView,
  overlayTranslateY,
  inlineAiAnchorTop,
  inlineAiSelectionRects,
  shouldUpdateEditorView,
  gutterNumberText,
  wrapLineHeightsFromLines,
  wrapVisualAt,
  visualPrefix,
  logicalIndexAtVisual,
} from "@/lib/editorView";
import { EditorMinimap } from "./EditorMinimap";
import { EditorInlineAi, type InlineAiMode } from "./EditorInlineAi";
import {
  applyEnter,
  applyTab,
  detectIndent,
  findMatches,
  offsetAtLine,
  offsetAtLineCol,
  offsetToLineCol,
  replaceAllMatches,
  replaceMatch,
  suggestedChildPath,
  toggleComment,
} from "@/lib/editorEdit";
import { EditHistory, remapWorkspacePath } from "@/lib/editorHistory";
import {
  applyCompletion,
  caretOffset,
  completeAt,
  fromRemoteCompletion,
  harvestWords,
  mergeCompletions,
  shouldAutoComplete,
  type CompletionItem,
} from "@/lib/editorComplete";
import {
  detectProjectKind,
  languageForFile,
  runHintForProject,
  testCommandForDiagnostic,
} from "@/lib/projectKind";
import {
  buildWorkspaceTree,
  countWorkspaceTreeNodes,
  dirsNeedingWorkspaceListing,
  filterWorkspaceTree,
  flattenVisibleWorkspaceRows,
  languageLabel,
  rollupChangeStats,
  sameWorkspaceChanges,
  sameWorkspaceEntries,
  withExpandedWorkspaceListings,
  workspaceEntriesForMode,
  pruneHotWorkspaceDocs,
  WORKSPACE_FILTER_MAX_NODES,
  type WorkspaceFlatRow,
  type WorkspaceTreeNode,
} from "@/lib/workspaceTree";
import { listWindowRange, shouldUpdateListWindow, type ListWindow } from "@/lib/listWindow";
import {
  CANVAS_PREVIEW_SANDBOX,
  changeHunkCount,
  collapseLineDiff,
  isWorkspaceBinaryPreviewPath,
  isWorkspaceHtmlPath,
  isWorkspaceImagePath,
  isWorkspaceMarkdownPath,
  isWorkspaceSvgPath,
  lineChangeMarksFromText,
  lineDiff,
  revertNthChangeHunk,
  sumWorkspaceChanges,
  type DockerContainer,
  type LineDiffRow,
} from "@locus/shared";
import {
  IconChevron,
  IconClose,
  IconFolder,
  IconMore,
  IconPlus,
  IconRefresh,
} from "@/components/layout/Icons";
import { SearchField } from "@/components/layout/SearchField";
import { canvasFrameSrc, useCanvasFrameHtml } from "@/lib/canvasFrame";
import {
  requestWorkspaceGoto,
  requestWorkspaceGotoSymbol,
  requestWorkspaceSearch,
  requestWorkspaceSplit,
  WorkspaceFileSearch,
  WorkspaceQuickOpen,
  WORKSPACE_FORMAT_EVENT,
  WORKSPACE_GIT_EVENT,
  WORKSPACE_GOTO_EVENT,
  WORKSPACE_GOTO_SYMBOL_EVENT,
  WORKSPACE_REINDEX_EVENT,
  WORKSPACE_SEARCH_EVENT,
  WORKSPACE_SPLIT_EVENT,
} from "./WorkspaceQuickOpen";
import {
  WORKSPACE_OPEN_PR_EVENT,
  consumeWorkspaceOpenPr,
  type WorkspaceOpenPrDetail,
  type WorkspacePrCommentMark,
} from "@/lib/workspaceOpenPr";
import { WorkspaceGitPane } from "./WorkspaceGitPane";
import { WorkspaceCompanion } from "./WorkspaceCompanion";
import { DockerExplorer } from "@/components/docker/DockerExplorer";
import { useDockerStats } from "@/components/docker/DockerStatsPanel";
import { dockerStatusLabel } from "@/lib/docker";
import {
  applyEditorPrefs,
  editorFontSizePx,
  editorFormatOnSave,
  editorShowMinimap,
} from "@/lib/theme";
import { Store } from "@/state/store";

type OpenDoc = {
  path: string;
  content: string;
  original: string;
  baseline?: string;
  kind?: "text" | "image" | "pdf";
  htmlView?: "source" | "browser";
  cold?: boolean;
};

function stubOpenDoc(path: string): OpenDoc {
  if (isWorkspaceBinaryPreviewPath(path)) {
    return {
      path,
      content: "",
      original: "",
      kind: isWorkspaceImagePath(path) ? "image" : "pdf",
    };
  }
  return {
    path,
    content: "",
    original: "",
    kind: "text",
    cold: true,
    htmlView: defaultsToPreview(path) ? "browser" : undefined,
  };
}

function defaultsToPreview(path: string): boolean {
  return isWorkspaceMarkdownPath(path) || isWorkspaceSvgPath(path);
}

function previewHtmlView(
  path: string,
  line?: number,
  current?: OpenDoc["htmlView"],
): OpenDoc["htmlView"] {
  if (!defaultsToPreview(path)) return current;
  if (line != null && line >= 1) return "source";
  return current ?? "browser";
}

function svgPreviewSrc(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

function copyMarkdownFence(event: ReactMouseEvent) {
  const btn = (event.target as HTMLElement | null)?.closest(".md-copy");
  if (!btn) return;
  const pre = btn.parentElement?.querySelector("pre");
  const text = pre?.textContent ?? "";
  if (!text) return;
  void navigator.clipboard.writeText(text).catch(() => undefined);
}

function upsertOpenDoc(
  current: OpenDoc[],
  next: OpenDoc,
  activePath: string,
  keepPath?: string,
): OpenDoc[] {
  const idx = current.findIndex((doc) => doc.path === next.path);
  const docs =
    idx < 0
      ? [...current, next]
      : current.map((doc, i) =>
          i === idx ? { ...next, htmlView: next.htmlView ?? doc.htmlView } : doc,
        );
  return pruneHotWorkspaceDocs(docs, activePath, keepPath);
}

function wordAtOffset(text: string, offset: number): string {
  const at = Math.max(0, Math.min(offset, text.length));
  const left = text.slice(0, at).match(/[A-Za-z_$][\w$]*$/)?.[0] ?? "";
  const right = text.slice(at).match(/^[\w$]*/)?.[0] ?? "";
  return left + right;
}

const EDITOR_GUTTER_PX = 48;
const HOVER_MOVE_PX = 16;
const HOVER_ABOVE_MIN_PX = 72;
const HOVER_GAP_PX = 6;

function hoverPopupPos(
  line: number,
  character: number,
  scrollTop: number,
  scrollLeft: number,
): { left: number; top: number; above: boolean } {
  const lineTop = EDITOR_PAD_PX + line * EDITOR_LINE_PX - scrollTop;
  const above = lineTop >= HOVER_ABOVE_MIN_PX;
  return {
    left: Math.max(8, EDITOR_PAD_PX + character * EDITOR_CHAR_PX - scrollLeft),
    top: above ? lineTop - HOVER_GAP_PX : lineTop + EDITOR_LINE_PX + HOVER_GAP_PX,
    above,
  };
}

function DiffCounts({ additions, deletions }: { additions: number; deletions: number }) {
  if (!additions && !deletions) return null;
  return (
    <span className="workspace-tree-diff">
      {additions ? <span className="add">+{additions}</span> : null}
      {deletions ? <span className="del">−{deletions}</span> : null}
    </span>
  );
}

/** Owns the explorer filter so typing does not re-render the file editor. */
function WorkspaceExplorerFiles({
  builtTree,
  statsByPath,
  expanded,
  mode,
  activePath,
  treeReady,
  emptyWorkspace,
  indexing,
  gitPane,
  modeButtons,
  scrollRef,
  onToggleDir,
  onOpenFile,
  onPrefetchFile,
  onRemovePath,
  onContextMenu,
}: {
  builtTree: WorkspaceTreeNode[];
  statsByPath: Map<string, WorkspaceFileChange>;
  expanded: Set<string>;
  mode: "all" | "updated" | "git";
  activePath: string;
  treeReady: boolean;
  emptyWorkspace: boolean;
  indexing: ReactNode;
  gitPane: ReactNode;
  modeButtons: ReactNode;
  scrollRef: RefObject<HTMLDivElement | null>;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
  onPrefetchFile?: (path: string) => void;
  onRemovePath: (path: string) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, path: string, dir: boolean) => void;
}) {
  const [filter, setFilter] = useState("");
  const deferredFilter = useDeferredValue(filter);
  const tree = useMemo(
    () => filterWorkspaceTree(builtTree, deferredFilter),
    [builtTree, deferredFilter],
  );
  const filtering = deferredFilter.trim().length > 0 || mode === "updated";
  const truncated =
    deferredFilter.trim().length > 0 && countWorkspaceTreeNodes(tree) >= WORKSPACE_FILTER_MAX_NODES;
  const TREE_ROW_PX = 28;
  const flatRows = useMemo(
    () => flattenVisibleWorkspaceRows(tree, expanded, filtering),
    [tree, expanded, filtering],
  );
  const [treeWin, setTreeWin] = useState<ListWindow>(() =>
    listWindowRange({
      scrollTop: 0,
      clientHeight: 0,
      rowCount: flatRows.length,
      rowPx: TREE_ROW_PX,
    }),
  );

  function syncTreeWindow() {
    const el = scrollRef.current;
    const next = listWindowRange({
      scrollTop: el?.scrollTop ?? 0,
      clientHeight: el?.clientHeight ?? 0,
      rowCount: flatRows.length,
      rowPx: TREE_ROW_PX,
    });
    setTreeWin((current) => (shouldUpdateListWindow(current, next) ? next : current));
  }

  useLayoutEffect(() => {
    syncTreeWindow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatRows.length, expanded, filtering]);

  function renderRow(node: WorkspaceFlatRow): ReactNode {
    const pad = { paddingLeft: 10 + node.depth * 12 };
    const stats = statsByPath.get(node.path);
    if (node.type === "dir") {
      const open = filtering || expanded.has(node.path);
      return (
        <li key={node.path}>
          <button
            type="button"
            className="workspace-tree-row dir"
            data-path={node.path}
            style={pad}
            aria-expanded={open}
            onClick={() => {
              if (!filtering) onToggleDir(node.path);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onContextMenu(event, node.path, true);
            }}
          >
            <span className="workspace-tree-chevron">
              <IconChevron expanded={open} />
            </span>
            <span className="workspace-tree-name">{node.name}</span>
            {stats ? <DiffCounts additions={stats.additions} deletions={stats.deletions} /> : null}
          </button>
        </li>
      );
    }
    return (
      <li key={node.path}>
        <div className={`workspace-tree-row ${activePath === node.path ? "on" : ""}`} style={pad}>
          <button
            type="button"
            data-path={node.path}
            className="workspace-tree-open"
            onClick={() => onOpenFile(node.path)}
            onPointerEnter={() => onPrefetchFile?.(node.path)}
            onMouseEnter={() => onPrefetchFile?.(node.path)}
            onContextMenu={(event) => {
              event.preventDefault();
              onContextMenu(event, node.path, false);
            }}
          >
            <span className="workspace-tree-name">{node.name}</span>
            {stats ? <DiffCounts additions={stats.additions} deletions={stats.deletions} /> : null}
          </button>
          <button
            type="button"
            className="workspace-tree-del"
            title={`Delete ${node.name}`}
            aria-label={`Delete ${node.name}`}
            onClick={() => onRemovePath(node.path)}
          >
            <IconClose />
          </button>
        </div>
      </li>
    );
  }

  const visibleRows = flatRows.slice(treeWin.start, treeWin.end);

  return (
    <>
      <SearchField
        className="workspace-filter"
        wrapClassName="workspace-filter-wrap"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter files..."
        aria-label="Filter files"
      />
      {modeButtons}
      {indexing}
      <div className="workspace-tree-scroll" ref={scrollRef} onScroll={syncTreeWindow}>
        {mode === "git" ? (
          gitPane
        ) : !treeReady ? (
          <div className="workspace-tree-loading" role="status" aria-live="polite">
            <div
              className="workspace-tree-progress indeterminate"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Loading files"
            >
              <span />
            </div>
            <p className="hint">Loading files…</p>
          </div>
        ) : emptyWorkspace ? (
          <p className="hint">Empty workspace. Create a file from chat, or open a folder.</p>
        ) : tree.length === 0 ? (
          <p className="hint">
            {mode === "updated" && !deferredFilter.trim()
              ? "No files updated this session."
              : "No matching files."}
          </p>
        ) : (
          <>
            <div className="list-window-spacer" style={{ height: treeWin.padTop }} />
            <ul>{visibleRows.map((row) => renderRow(row))}</ul>
            <div className="list-window-spacer" style={{ height: treeWin.padBottom }} />
            {truncated ? (
              <p className="hint">
                Showing first {WORKSPACE_FILTER_MAX_NODES} matches. Type more to narrow.
              </p>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

function DiffBody({
  rows,
  lang,
  onRevertHunk,
  onAcceptHunk,
  onAcceptAll,
  onRejectAll,
}: {
  rows: LineDiffRow[];
  lang: string;
  onRevertHunk?: (index: number) => void;
  onAcceptHunk?: (index: number) => void;
  onAcceptAll?: () => void;
  onRejectAll?: () => void;
}) {
  const collapsed = useMemo(() => collapseLineDiff(rows), [rows]);
  const hunkCount = useMemo(() => changeHunkCount(rows), [rows]);
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    setRevealed(new Set());
  }, [rows]);
  return (
    <div className="workspace-diff" role="region" aria-label="Changed lines">
      {hunkCount > 0 ? (
        <div className="workspace-diff-hunks" role="toolbar" aria-label="Change hunks">
          {onAcceptAll ? (
            <button type="button" className="btn small" onClick={onAcceptAll}>
              Accept all
            </button>
          ) : null}
          {onRejectAll ? (
            <button type="button" className="btn small ghost" onClick={onRejectAll}>
              Reject all
            </button>
          ) : null}
          {Array.from({ length: hunkCount }, (_, i) => (
            <span key={i} className="workspace-diff-hunk-actions">
              {onAcceptHunk ? (
                <button type="button" className="btn small ghost" onClick={() => onAcceptHunk(i)}>
                  Accept hunk {i + 1}
                </button>
              ) : null}
              {onRevertHunk ? (
                <button type="button" className="btn small ghost" onClick={() => onRevertHunk(i)}>
                  Reject hunk {i + 1}
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
      {collapsed.map((row, i) => {
        if (row.kind === "omit") {
          if (revealed.has(i)) {
            return row.rows.map((inner, j) => (
              <DiffRow key={`${i}-${j}`} row={inner} lang={lang} />
            ));
          }
          return (
            <div key={i} className="workspace-diff-row omit">
              <span className="workspace-diff-ln old" />
              <span className="workspace-diff-ln new" />
              <span className="workspace-diff-sign" />
              <button
                type="button"
                className="workspace-diff-omit"
                onClick={() =>
                  setRevealed((current) => {
                    const next = new Set(current);
                    next.add(i);
                    return next;
                  })
                }
              >
                {row.rows.length} unchanged {row.rows.length === 1 ? "line" : "lines"}
              </button>
            </div>
          );
        }
        return <DiffRow key={i} row={row} lang={lang} />;
      })}
    </div>
  );
}

function DiffRow({ row, lang }: { row: LineDiffRow; lang: string }) {
  return (
    <div className={`workspace-diff-row ${row.kind}`}>
      <span className="workspace-diff-ln old">{row.kind === "add" ? "" : row.oldLine}</span>
      <span className="workspace-diff-ln new">{row.kind === "del" ? "" : row.newLine}</span>
      <span className="workspace-diff-sign">
        {row.kind === "add" ? "+" : row.kind === "del" ? "−" : " "}
      </span>
      <span
        className="workspace-diff-code"
        dangerouslySetInnerHTML={{
          __html: highlightSource(row.text, lang) || "&nbsp;",
        }}
      />
    </div>
  );
}

async function loadWorkspaceSnapshot(
  sessionId: string,
  expanded: ReadonlySet<string>,
  depth?: number,
) {
  const next = await api.workspaceTree(sessionId, "", depth);
  const entries =
    depth === 1
      ? next.entries
      : await withExpandedWorkspaceListings(next.entries, expanded, async (path) => {
          return (await api.workspaceTree(sessionId, path)).entries;
        });
  return { entries, changes: next.changes ?? [] };
}

export const WorkspaceEditor = memo(function WorkspaceEditor({
  sessionId,
  onFileCount,
  visible = true,
  remote = false,
  openPath,
  openLine,
  openAt,
  follow,
  onOpened,
  onAskAgent,
  onFocusPath,
  onPromoted,
  onOpenPull,
}: {
  sessionId: string;
  onFileCount?: (count: number) => void;
  visible?: boolean;
  remote?: boolean;
  openPath?: string;
  openLine?: number;
  openAt?: number;
  follow?: boolean;
  onOpened?: () => void;
  onAskAgent?: (draft: string) => void;
  onFocusPath?: (path: string | null) => void;
  onPromoted?: (session: import("@locus/shared").AgentSession) => void;
  onOpenPull?: (info: { repoId: string; number: number }) => void;
}) {
  const store = useContext(Store);
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [changes, setChanges] = useState<WorkspaceFileChange[]>([]);
  const [mode, setMode] = useState<"all" | "updated" | "git">("all");
  const [docs, setDocs] = useState<OpenDoc[]>(() =>
    loadEditorOpenFiles(sessionId).paths.map(stubOpenDoc),
  );
  const [activePath, setActivePath] = useState(() => loadEditorOpenFiles(sessionId).active);
  const [split, setSplit] = useState<EditorSplit | null>(
    () => loadEditorOpenFiles(sessionId).split ?? null,
  );
  const [splitDragging, setSplitDragging] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExplorerExpanded(sessionId));
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(true);
  const [askRange, setAskRange] = useState<{ start: number; end: number } | null>(null);
  const [inlineAi, setInlineAi] = useState<{
    start: number;
    end: number;
    busy: boolean;
    error: string | null;
  } | null>(null);
  const inlineAiSeq = useRef(0);
  const inlineAiRef = useRef(inlineAi);
  inlineAiRef.current = inlineAi;
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [fileSearch, setFileSearch] = useState(false);
  const [pendingScroll, setPendingScroll] = useState<{
    path: string;
    line: number;
    nonce: number;
  } | null>(null);
  const scrollNonce = useRef(0);
  const [diagnostics, setDiagnostics] = useState<WorkspaceDiagnostic[]>([]);
  const [hover, setHover] = useState<{
    text: string;
    left: number;
    top: number;
    above: boolean;
    originX: number;
    originY: number;
  } | null>(null);
  const [outline, setOutline] = useState<WorkspaceOutlineItem[]>([]);
  const [git, setGit] = useState<WorkspaceGitStatus | null>(null);
  const [gitDest, setGitDest] = useState<string | undefined>();
  const [commitMsg, setCommitMsg] = useState("");
  const [blame, setBlame] = useState<string | null>(null);
  const [blameLines, setBlameLines] = useState<WorkspaceBlameLine[]>([]);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debug, setDebug] = useState<WorkspaceDebugState | null>(null);
  const [ctxMenu, setCtxMenu] = useState<
    | { kind: "explorer"; x: number; y: number; path: string; dir: boolean }
    | { kind: "editor"; x: number; y: number; start: number; end: number }
    | null
  >(null);
  const ctxMenuNode = useRef<HTMLDivElement>(null);
  const [ctxPlace, setCtxPlace] = useState<{ left: number; top: number } | null>(null);
  const [dockerInspect, setDockerInspect] = useState<DockerContainer | null>(null);
  const dockerInspectStats = useDockerStats(dockerInspect?.id, Boolean(dockerInspect));
  const [branches, setBranches] = useState<string[]>([]);
  const [remotes, setRemotes] = useState<string[]>([]);
  const [wrap, setWrap] = useState(() => {
    try {
      return localStorage.getItem("locus-editor-wrap") === "1";
    } catch {
      return false;
    }
  });
  const [showMinimap, setShowMinimap] = useState(() => editorShowMinimap());
  const [tabSize, setTabSize] = useState(2);
  const [configIndent, setConfigIndent] = useState<string | null>(null);
  const [allProblems, setAllProblems] = useState<WorkspaceDiagnostic[]>([]);
  const [fixes, setFixes] = useState<Array<{
    title: string;
    files: Array<{ path: string; content: string }>;
    fixAll?: boolean;
  }> | null>(null);
  const [nameForm, setNameForm] = useState<{
    kind: "symbol" | "path";
    value: string;
    from?: string;
  } | null>(null);
  const [refs, setRefs] = useState<WorkspaceLocation[] | null>(null);
  const [occurs, setOccurs] = useState<WorkspaceHighlight[]>([]);
  const [pylspMissing, setPylspMissing] = useState(false);
  const [prComments, setPrComments] = useState<WorkspacePrCommentMark[]>([]);
  const [openPrComment, setOpenPrComment] = useState<WorkspacePrCommentMark | null>(null);
  const prCommentRef = useRef<HTMLDivElement>(null);
  useDialogFocus(Boolean(openPrComment), () => setOpenPrComment(null), prCommentRef);
  const [wrapWidth, setWrapWidth] = useState(640);
  const [signature, setSignature] = useState<{
    help: WorkspaceSignatureHelp;
    left: number;
    top: number;
  } | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [indexCount, setIndexCount] = useState<number | null>(null);
  const [indexProgress, setIndexProgress] = useState<WorkspaceIndexStatus | null>(null);
  const [treeReady, setTreeReady] = useState(false);
  const editorPane = useRef<HTMLTextAreaElement>(null);
  const codeBody = useRef<HTMLDivElement>(null);
  const splitRoot = useRef<HTMLDivElement>(null);
  const docsRef = useRef(docs);
  const splitRef = useRef(split);
  const toggleSplitRef = useRef<() => void>(() => {});
  const openSeq = useRef(0);
  const persistOpenFiles = useRef(false);
  const pendingRestoreActive = useRef<string | null>(null);
  docsRef.current = docs;
  splitRef.current = split;
  const treeScroll = useRef<HTMLDivElement>(null);
  const tabsRow = useRef<HTMLDivElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const browserFrame = useRef<HTMLIFrameElement>(null);
  const completeTimer = useRef(0);
  const hoverTimer = useRef(0);
  const completeSeq = useRef(0);
  const hoverSeq = useRef(0);
  const reindexInflight = useRef(false);
  const reindexPoll = useRef(0);
  const extraWordsRef = useRef<string[]>([]);
  const editHistory = useRef(new EditHistory());
  const highlightPrev = useRef<HighlightDoc | null>(null);
  const highlightPath = useRef("");
  const highlightCodeRef = useRef("");
  const viewRef = useRef({ start: 1, end: EDITOR_VIEW_FALLBACK });
  const gutterShift = useRef<HTMLDivElement>(null);
  const highlightShift = useRef<HTMLPreElement>(null);
  const occursShift = useRef<HTMLDivElement>(null);
  const inlineAiShift = useRef<HTMLFormElement>(null);
  const openFileRef = useRef<
    (path: string, line?: number, restore?: boolean, reload?: boolean) => Promise<void>
  >(async () => undefined);
  const scrollRaf = useRef(0);
  const draftTimer = useRef(0);
  const [view, setView] = useState({ start: 1, end: EDITOR_VIEW_FALLBACK });
  const [menu, setMenu] = useState<{
    items: CompletionItem[];
    index: number;
    left: number;
    top: number;
  } | null>(null);
  const active = docs.find((doc) => doc.path === activePath);
  const content = active?.content ?? "";
  const isImage = active?.kind === "image";
  const isPdf = active?.kind === "pdf";
  const isHtml = Boolean(activePath && isWorkspaceHtmlPath(activePath));
  const isMd = Boolean(activePath && isWorkspaceMarkdownPath(activePath));
  const isSvg = Boolean(activePath && isWorkspaceSvgPath(activePath));
  const showBrowser = Boolean(isHtml && active?.htmlView === "browser");
  const showMarkdown = Boolean(isMd && active?.htmlView === "browser");
  const showSvg = Boolean(isSvg && active?.htmlView === "browser");
  const showPanePreview = showBrowser || showMarkdown || showSvg;
  useCanvasFrameHtml(showBrowser ? content : "", browserFrame);
  const dirty = Boolean(active && !isImage && !isPdf && active.content !== active.original);
  const project = useMemo(() => detectProjectKind(entries.map((row) => row.path)), [entries]);
  const lang = languageForFile(activePath, content, project.kind, languageFromPath);
  const indent = useMemo(
    () => configIndent ?? detectIndent(content, lang),
    [configIndent, content, lang],
  );
  const runHint = runHintForProject(project.kind);
  const findHits = useMemo(
    () => (findOpen ? findMatches(content, findQuery) : []),
    [content, findOpen, findQuery],
  );
  if (highlightPath.current !== activePath) {
    highlightPath.current = activePath;
    highlightPrev.current = null;
    highlightCodeRef.current = "";
  }
  const overlay = useMemo(() => {
    const prev = highlightPrev.current;
    const same = highlightCodeRef.current === content && prev?.lang === lang;
    if (same && prev) {
      if (prev.html.length) {
        return { doc: prev, ...visibleHighlightSlice(prev, view.start, view.end) };
      }
      const painted = highlightVisible(content, lang, view.start, view.end, prev, prev.lines);
      highlightPrev.current = painted.doc;
      return painted;
    }
    const painted = highlightVisible(content, lang, view.start, view.end, prev);
    highlightCodeRef.current = content;
    highlightPrev.current = painted.doc;
    return painted;
  }, [content, lang, view.start, view.end]);
  const gutterMarks = useMemo(
    () =>
      isImage || isPdf || active?.baseline === undefined
        ? []
        : lineChangeMarksFromText(active.baseline, content),
    [isImage, isPdf, active?.baseline, content],
  );
  const hasDiffHunks = gutterMarks.length > 0;
  const showDiff = Boolean(hasDiffHunks && !editing && !showPanePreview);
  const diffRows = useMemo(
    () => (showDiff && active?.baseline !== undefined ? lineDiff(active.baseline, content) : null),
    [showDiff, active?.baseline, content],
  );
  const changeByPath = useMemo(() => new Map(changes.map((row) => [row.path, row])), [changes]);
  const statsByPath = useMemo(() => rollupChangeStats(changes), [changes]);
  const treeMode: "all" | "updated" = mode === "updated" ? "updated" : "all";
  const visibleEntries = useMemo(
    () => workspaceEntriesForMode(entries, changes, treeMode),
    [entries, changes, treeMode],
  );
  const builtTree = useMemo(() => buildWorkspaceTree(visibleEntries), [visibleEntries]);
  const totals = useMemo(() => sumWorkspaceChanges(changes), [changes]);
  const lineCount = Math.max(1, overlay.doc.lines.length);
  const wrapHeights = useMemo(
    () =>
      wrap
        ? wrapLineHeightsFromLines(overlay.doc.lines, wrapWidth, EDITOR_CHAR_PX, tabSize)
        : undefined,
    [wrap, overlay.doc.lines, wrapWidth, tabSize],
  );
  const gutterText = useMemo(
    () => gutterNumberText(overlay.padLines + 1, lineCount - overlay.tailLines),
    [overlay.padLines, overlay.tailLines, lineCount],
  );
  const visibleMarks = useMemo(
    () => marksInView(gutterMarks, view.start, view.end),
    [gutterMarks, view.start, view.end],
  );
  const visibleDiags = useMemo(
    () => diagsInView(diagnostics, view.start, view.end),
    [diagnostics, view.start, view.end],
  );
  viewRef.current = view;
  const extraSig = docs
    .filter((doc) => doc.path !== activePath && doc.kind !== "image" && doc.kind !== "pdf")
    .map((doc) => doc.path)
    .join("\0");

  useEffect(() => {
    setMenu(null);
    completeSeq.current += 1;
    window.clearTimeout(completeTimer.current);
    hoverSeq.current += 1;
    window.clearTimeout(hoverTimer.current);
    setHover(null);
    setOpenPrComment(null);
  }, [activePath, sessionId, showDiff, showPanePreview, isImage, isPdf]);

  useEffect(() => {
    const words: string[] = [];
    for (const doc of docs) {
      if (doc.path === activePath || doc.kind === "image" || doc.kind === "pdf") continue;
      words.push(...harvestWords(doc.content).slice(0, 80));
    }
    extraWordsRef.current = words;
    // docs is read for other open tabs; extraSig ignores the active file's keystrokes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, extraSig]);

  useLayoutEffect(() => {
    const pane = codeBody.current;
    if (!pane) return;
    const applyWindow = (scrollTop: number, scrollLeft: number) => {
      const y = overlayTranslateY(viewRef.current.start, scrollTop, wrapHeights);
      if (gutterShift.current) gutterShift.current.style.transform = `translateY(${y}px)`;
      if (highlightShift.current) {
        highlightShift.current.style.transform = `translate(${-scrollLeft}px, ${y}px)`;
      }
      if (occursShift.current) {
        occursShift.current.style.transform = `translate(${-scrollLeft}px, ${y}px)`;
      }
      if (inlineAiShift.current) inlineAiShift.current.style.transform = `translateY(${y}px)`;
      const ta = editorPane.current;
      if (ta && ta.scrollTop !== scrollTop) ta.scrollTop = scrollTop;
    };
    const syncView = () => {
      if (pane.clientHeight <= 0) return;
      const next = editorViewRange(pane.scrollTop, pane.clientHeight, lineCount, wrapHeights);
      setView((cur) => (shouldUpdateEditorView(cur, next) ? next : cur));
    };
    const onPaneScroll = () => {
      hoverSeq.current += 1;
      window.clearTimeout(hoverTimer.current);
      setHover(null);
      applyWindow(pane.scrollTop, editorPane.current?.scrollLeft ?? 0);
      if (scrollRaf.current) return;
      scrollRaf.current = window.requestAnimationFrame(() => {
        scrollRaf.current = 0;
        syncView();
      });
    };
    const ta = editorPane.current;
    const onTaScroll = () => {
      if (!ta) return;
      hoverSeq.current += 1;
      window.clearTimeout(hoverTimer.current);
      setHover(null);
      if (Math.abs(pane.scrollTop - ta.scrollTop) > 0.5) pane.scrollTop = ta.scrollTop;
      applyWindow(pane.scrollTop, ta.scrollLeft);
    };
    applyWindow(pane.scrollTop, ta?.scrollLeft ?? 0);
    syncView();
    pane.addEventListener("scroll", onPaneScroll, { passive: true });
    ta?.addEventListener("scroll", onTaScroll, { passive: true });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(onPaneScroll) : null;
    ro?.observe(pane);
    const main = pane.querySelector(".workspace-code-main");
    const wrapRo =
      typeof ResizeObserver === "function"
        ? new ResizeObserver((entries) => {
            const width = entries[0]?.contentRect.width;
            if (width && width > 40) setWrapWidth(width);
          })
        : null;
    if (ta) wrapRo?.observe(ta);
    else if (main instanceof HTMLElement) wrapRo?.observe(main);
    return () => {
      pane.removeEventListener("scroll", onPaneScroll);
      ta?.removeEventListener("scroll", onTaScroll);
      ro?.disconnect();
      wrapRo?.disconnect();
      window.cancelAnimationFrame(scrollRaf.current);
      scrollRaf.current = 0;
    };
  }, [activePath, lineCount, wrapHeights]);

  useLayoutEffect(() => {
    const pane = codeBody.current;
    if (!pane) return;
    const y = overlayTranslateY(view.start, pane.scrollTop, wrapHeights);
    const t = `translateY(${y}px)`;
    if (gutterShift.current) gutterShift.current.style.transform = t;
    if (highlightShift.current) highlightShift.current.style.transform = t;
    if (occursShift.current) occursShift.current.style.transform = t;
    if (inlineAiShift.current) inlineAiShift.current.style.transform = t;
  }, [view.start, overlay.html, activePath, wrapHeights, inlineAi]);

  useEffect(() => {
    onFocusPath?.(activePath || null);
  }, [activePath, sessionId, onFocusPath]);

  useEffect(() => {
    if (!activePath) return;
    const file = treeScroll.current?.querySelector(`[data-path="${activePath}"]`);
    if (file instanceof HTMLElement) file.scrollIntoView?.({ block: "nearest" });
    const tab = tabsRow.current?.querySelector(".workspace-tab.on");
    if (tab instanceof HTMLElement) tab.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [activePath]);

  useEffect(() => {
    let cancelled = false;
    if (!visible || !treeReady) return;
    if (
      typeof api.workspaceIndex !== "function" &&
      typeof api.workspaceIndexStatus !== "function"
    ) {
      return;
    }
    let started = false;
    async function poll(): Promise<string> {
      try {
        if (typeof api.workspaceIndexStatus === "function") {
          const status = await api.workspaceIndexStatus(sessionId);
          if (cancelled) return status.status;
          setIndexProgress(status);
          if (status.status === "ready") {
            setIndexCount(status.fileCount);
            return "ready";
          }
          if (!started && typeof api.workspaceIndex === "function") {
            started = true;
            void api
              .workspaceIndex(sessionId)
              .then((res) => {
                if (cancelled) return;
                setIndexCount(res.fileCount);
                setIndexProgress({
                  status: "ready",
                  fileCount: res.fileCount,
                  scanned: res.fileCount,
                  builtAt: res.builtAt,
                  truncated: res.truncated,
                  reused: res.reused,
                  read: res.read,
                });
              })
              .catch(() => undefined);
          }
          return status.status;
        }
        if (typeof api.workspaceIndex === "function") {
          const res = await api.workspaceIndex(sessionId);
          if (!cancelled) setIndexCount(res.fileCount);
        }
        return "ready";
      } catch {
        return "idle";
      }
    }
    void poll();
    const id = setInterval(() => {
      void poll().then((status) => {
        if (status === "ready") clearInterval(id);
      });
    }, 400);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sessionId, visible, treeReady]);

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (document.querySelector(".modal")) return;
      if (matchModKey(event, "p")) {
        event.preventDefault();
        setSymbolOpen(false);
        setQuickOpen(true);
        return;
      }
      if (matchModKey(event, "t")) {
        event.preventDefault();
        setQuickOpen(false);
        setSymbolOpen(true);
        return;
      }
      if (matchModKey(event, "f", true)) {
        event.preventDefault();
        setFileSearch(true);
        return;
      }
      if (matchModKey(event, "\\")) {
        event.preventDefault();
        toggleSplitRef.current();
      }
    }
    function onGoto() {
      setSymbolOpen(false);
      setQuickOpen(true);
    }
    function onGotoSymbol() {
      setQuickOpen(false);
      setSymbolOpen(true);
    }
    function onSearch() {
      setFileSearch(true);
    }
    function onReindex() {
      void reindex();
    }
    function onFormat() {
      void formatActive();
    }
    function onGit() {
      setMode("git");
      void loadGit();
    }
    function onSplit() {
      toggleSplitRef.current();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(WORKSPACE_GOTO_EVENT, onGoto);
    window.addEventListener(WORKSPACE_GOTO_SYMBOL_EVENT, onGotoSymbol);
    window.addEventListener(WORKSPACE_SEARCH_EVENT, onSearch);
    window.addEventListener(WORKSPACE_REINDEX_EVENT, onReindex);
    window.addEventListener(WORKSPACE_FORMAT_EVENT, onFormat);
    window.addEventListener(WORKSPACE_GIT_EVENT, onGit);
    window.addEventListener(WORKSPACE_SPLIT_EVENT, onSplit);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(WORKSPACE_GOTO_EVENT, onGoto);
      window.removeEventListener(WORKSPACE_GOTO_SYMBOL_EVENT, onGotoSymbol);
      window.removeEventListener(WORKSPACE_SEARCH_EVENT, onSearch);
      window.removeEventListener(WORKSPACE_REINDEX_EVENT, onReindex);
      window.removeEventListener(WORKSPACE_FORMAT_EVENT, onFormat);
      window.removeEventListener(WORKSPACE_GIT_EVENT, onGit);
      window.removeEventListener(WORKSPACE_SPLIT_EVENT, onSplit);
    };
  }, [sessionId, indexCount]);

  useEffect(() => {
    if (!menu) return;
    function onDown(event: MouseEvent) {
      const node = event.target;
      if (node instanceof Node && document.querySelector(".workspace-complete")?.contains(node)) {
        return;
      }
      setMenu(null);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  function applySnapshot(next: { entries: WorkspaceEntry[]; changes?: WorkspaceFileChange[] }) {
    const nextChanges = next.changes ?? [];
    setEntries((current) => (sameWorkspaceEntries(current, next.entries) ? current : next.entries));
    setChanges((current) => (sameWorkspaceChanges(current, nextChanges) ? current : nextChanges));
  }

  async function refresh() {
    try {
      applySnapshot(await loadWorkspaceSnapshot(sessionId, expandedRef.current));
    } catch (err) {
      setError(
        isUnreachableError(err)
          ? UNREACHABLE_ERROR
          : err instanceof Error
            ? err.message
            : "Could not list /workspace",
      );
    }
  }

  async function reindex() {
    if (reindexInflight.current) return;
    if (typeof api.workspaceIndex !== "function") return;
    reindexInflight.current = true;
    setIndexProgress({ status: "building", fileCount: indexCount ?? 0, scanned: 0 });
    window.clearInterval(reindexPoll.current);
    reindexPoll.current = window.setInterval(() => {
      if (typeof api.workspaceIndexStatus !== "function") return;
      void api
        .workspaceIndexStatus(sessionId)
        .then((status) => {
          setIndexProgress(status);
          if (status.status === "ready") setIndexCount(status.fileCount);
        })
        .catch(() => undefined);
    }, 400);
    try {
      const res = await api.workspaceIndex(sessionId, true);
      setIndexCount(res.fileCount);
      setIndexProgress({
        status: "ready",
        fileCount: res.fileCount,
        scanned: res.fileCount,
        builtAt: res.builtAt,
        truncated: res.truncated,
        reused: res.reused,
        read: res.read,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not index workspace");
      setIndexProgress((current) =>
        current?.status === "building" ? { ...current, status: "idle" } : current,
      );
    } finally {
      window.clearInterval(reindexPoll.current);
      reindexPoll.current = 0;
      reindexInflight.current = false;
    }
  }

  useEffect(() => {
    persistOpenFiles.current = false;
    const saved = loadEditorOpenFiles(sessionId);
    pendingRestoreActive.current = saved.active || null;
    setDocs(saved.paths.map(stubOpenDoc));
    setActivePath(saved.active);
    setSplit(saved.split ?? null);
    setSplitDragging(false);
    setMode("all");
    setChanges([]);
    setEntries([]);
    setExpanded(loadExplorerExpanded(sessionId));
    setEditing(true);
    setError(null);
    setTreeReady(false);
    setIndexCount(null);
    setIndexProgress(null);
    setFindOpen(false);
    setFindQuery("");
    setReplaceQuery("");
    setCursor({ line: 1, col: 1 });
    setView({ start: 1, end: EDITOR_VIEW_FALLBACK });
    highlightPrev.current = null;
    highlightCodeRef.current = "";
    setQuickOpen(false);
    setFileSearch(false);
    setPendingScroll(null);
    setDiagnostics([]);
    setHover(null);
    setOutline([]);
    setGit(null);
    setGitDest(undefined);
    setBranches([]);
    setCommitMsg("");
    setBlame(null);
    setProblemsOpen(false);
    setCtxMenu(null);
    setNameForm(null);
    setRefs(null);
    setSignature(null);
    setDockerInspect(null);
    editHistory.current.clear();
    window.clearInterval(reindexPoll.current);
    reindexPoll.current = 0;
    reindexInflight.current = false;
    window.clearTimeout(draftTimer.current);
    draftTimer.current = 0;
    return () => {
      window.clearInterval(reindexPoll.current);
      reindexPoll.current = 0;
      reindexInflight.current = false;
      hoverSeq.current += 1;
      window.clearTimeout(hoverTimer.current);
    };
  }, [sessionId]);

  useLayoutEffect(() => {
    if (!ctxMenu) {
      setCtxPlace(null);
      return;
    }
    const menu = ctxMenuNode.current;
    if (!menu) return;
    const origin = fixedContainingOrigin(menu);
    const rect = menu.getBoundingClientRect();
    const next = placePointerMenu({
      x: ctxMenu.x,
      y: ctxMenu.y,
      pop: {
        width: rect.width > 0 ? rect.width : 200,
        height: rect.height > 0 ? rect.height : 1,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      origin,
    });
    setCtxPlace((cur) => (cur && cur.left === next.left && cur.top === next.top ? cur : next));
  }, [ctxMenu]);

  useEffect(() => {
    if (!persistOpenFiles.current) {
      persistOpenFiles.current = true;
      return;
    }
    saveEditorOpenFiles(
      sessionId,
      docs.map((doc) => doc.path),
      activePath,
      undefined,
      split,
    );
    // Persist against the session that owns the current tabs, not a sessionId-only change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, activePath, split]);

  useEffect(() => {
    const path = pendingRestoreActive.current;
    if (!path) return;
    if (!docs.some((doc) => doc.path === path)) return;
    pendingRestoreActive.current = null;
    void openFile(path, undefined, true);
    // Restore after the session effect commits tabs; openFile is recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let inflight = false;
    async function tick(depth?: number) {
      if (inflight) return;
      inflight = true;
      try {
        const next = await loadWorkspaceSnapshot(sessionId, expandedRef.current, depth);
        if (!cancelled) {
          applySnapshot(next);
          setTreeReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            isUnreachableError(err)
              ? UNREACHABLE_ERROR
              : err instanceof Error
                ? err.message
                : "Could not list /workspace",
          );
          setTreeReady(true);
        }
      } finally {
        inflight = false;
      }
    }
    void (async () => {
      await tick(1);
      if (!cancelled) await tick();
    })();
    const id = setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sessionId, visible]);

  useEffect(() => {
    const need = dirsNeedingWorkspaceListing(entries, expanded);
    if (need.length === 0) return;
    let cancelled = false;
    void withExpandedWorkspaceListings(entries, expanded, async (path) => {
      return (await api.workspaceTree(sessionId, path)).entries;
    }).then(
      (next) => {
        if (!cancelled) {
          setEntries((current) => (sameWorkspaceEntries(current, next) ? current : next));
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [entries, expanded, sessionId]);

  useEffect(() => {
    onFileCount?.(entries.filter((row) => row.type === "file").length);
  }, [entries, onFileCount]);

  function requestScroll(path: string, line?: number) {
    if (!line || line < 1) return;
    scrollNonce.current += 1;
    setPendingScroll({ path, line, nonce: scrollNonce.current });
  }

  function scrollToLine(line?: number) {
    if (!line || line < 1) return;
    const pane = codeBody.current;
    if (!pane) return;
    pane.scrollTop =
      EDITOR_PAD_PX +
      (wrapHeights ? lineOffsetInView(line, 1, wrapHeights) : (line - 1) * EDITOR_LINE_PX);
    const ta = editorPane.current;
    if (ta) ta.scrollTop = pane.scrollTop;
    const height =
      pane.clientHeight > 0 ? pane.clientHeight : EDITOR_VIEW_FALLBACK * EDITOR_LINE_PX;
    const next = editorViewRange(pane.scrollTop, height, lineCount, wrapHeights);
    viewRef.current = next;
    setView(next);
    const y = overlayTranslateY(next.start, pane.scrollTop, wrapHeights);
    const x = ta?.scrollLeft ?? 0;
    if (gutterShift.current) gutterShift.current.style.transform = `translateY(${y}px)`;
    if (highlightShift.current) {
      highlightShift.current.style.transform = `translate(${-x}px, ${y}px)`;
    }
    if (occursShift.current) {
      occursShift.current.style.transform = `translate(${-x}px, ${y}px)`;
    }
    if (inlineAiShift.current) inlineAiShift.current.style.transform = `translateY(${y}px)`;
    if (!ta) return;
    const start = offsetAtLine(ta.value, line);
    ta.setSelectionRange(start, start);
    setCursor(offsetToLineCol(ta.value, start));
  }

  useLayoutEffect(() => {
    if (!pendingScroll || pendingScroll.path !== activePath) return;
    if (!codeBody.current) return;
    if (showPanePreview) return;
    scrollToLine(pendingScroll.line);
    setPendingScroll(null);
    // content must already be committed so the scroller has the new height.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingScroll, activePath, content, showPanePreview]);

  useEffect(() => {
    if (!openPath) return;
    if (follow) setMode("updated");
    let cancelled = false;
    void openFile(openPath, openLine).then(() => {
      if (cancelled) return;
      onOpened?.();
    });
    return () => {
      cancelled = true;
    };
    // openAt is the nonce so the same path can be followed twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPath, openLine, openAt, follow, sessionId]);

  function noteOpenPath(path: string, group?: 0 | 1) {
    setActivePath(path);
    setSplit((current) => {
      if (!current) return current;
      return group == null ? openInFocused(current, path) : activateInGroup(current, group, path);
    });
  }

  function toggleSplit() {
    const current = splitRef.current;
    if (current) {
      const joined = joinEditor(current);
      setSplit(null);
      setActivePath(joined.active);
      return;
    }
    if (!activePath) return;
    const next = splitEditor(
      docsRef.current.map((doc) => doc.path),
      activePath,
    );
    if (next) setSplit(next);
  }
  toggleSplitRef.current = toggleSplit;

  async function openToSide(path: string) {
    const current = splitRef.current;
    if (current) {
      const side: 0 | 1 = current.focused === 0 ? 1 : 0;
      setSplit(activateInGroup(current, side, path));
    } else {
      const next = splitEditor(
        docsRef.current.map((doc) => doc.path),
        activePath || path,
      );
      if (next) setSplit(activateInGroup(next, 1, path));
    }
    await openFile(path);
  }

  function focusPane(index: 0 | 1) {
    const current = splitRef.current;
    if (!current || current.focused === index) return;
    const path = current.groups[index].active;
    setSplit(activateInGroup(current, index, path));
    setActivePath(path);
    setEditing(true);
    const doc = docsRef.current.find((item) => item.path === path);
    if (doc?.cold) void openFile(path);
    else if (path) expandToFile(path);
  }

  function onSplitGutterDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const origin = event.clientX;
    const start = splitRef.current?.frac ?? EDITOR_SPLIT_DEFAULT;
    const width = splitRoot.current?.getBoundingClientRect().width ?? 0;
    if (width <= 6) return;
    const node = event.currentTarget;
    if (typeof node.setPointerCapture === "function") node.setPointerCapture(event.pointerId);
    setSplitDragging(true);
    function move(ev: PointerEvent) {
      setSplit((current) =>
        current
          ? { ...current, frac: clampEditorSplit(start + (ev.clientX - origin) / width) }
          : current,
      );
    }
    function up() {
      setSplitDragging(false);
      if (typeof node.releasePointerCapture === "function") {
        node.releasePointerCapture(event.pointerId);
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onSplitGutterKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 0.08 : 0.03;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSplit((current) =>
        current ? { ...current, frac: clampEditorSplit(current.frac - step) } : current,
      );
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setSplit((current) =>
        current ? { ...current, frac: clampEditorSplit(current.frac + step) } : current,
      );
    } else if (event.key === "Home") {
      event.preventDefault();
      setSplit((current) => (current ? { ...current, frac: EDITOR_SPLIT_MIN } : current));
    } else if (event.key === "End") {
      event.preventDefault();
      setSplit((current) => (current ? { ...current, frac: EDITOR_SPLIT_MAX } : current));
    }
  }

  async function openFile(nextPath: string, line?: number, restore = false, reload = false) {
    const rel = workspaceRelFromToolPath(nextPath);
    if (rel) nextPath = rel;
    const seq = (openSeq.current += 1);
    const existing = docsRef.current.find((doc) => doc.path === nextPath);
    if (existing && !existing.cold && !reload) {
      const htmlView = previewHtmlView(nextPath, line, existing.htmlView);
      noteOpenPath(nextPath);
      setEditing(true);
      setAskRange(null);
      expandToFile(nextPath);
      if (htmlView !== existing.htmlView) {
        setDocs((current) =>
          current.map((doc) => (doc.path === nextPath ? { ...doc, htmlView } : doc)),
        );
      }
      requestScroll(nextPath, line);
      return;
    }
    setError(null);
    if (isWorkspaceBinaryPreviewPath(nextPath)) {
      const kind: "image" | "pdf" = isWorkspaceImagePath(nextPath) ? "image" : "pdf";
      setDocs((current) => {
        if (current.some((doc) => doc.path === nextPath && !doc.cold)) return current;
        return upsertOpenDoc(
          current,
          { path: nextPath, content: "", original: "", kind },
          nextPath,
          splitRef.current ? otherPath(splitRef.current) : undefined,
        );
      });
      noteOpenPath(nextPath);
      setEditing(true);
      expandToFile(nextPath);
      return;
    }

    const applyBuffer = (file: { path: string; content: string; baseline?: string }) => {
      const drafts = loadEditorDrafts(sessionId);
      const draft = drafts[file.path];
      const change = changeByPath.get(file.path);
      const baseline =
        file.baseline !== undefined
          ? file.baseline
          : change && change.deletions === 0
            ? ""
            : undefined;
      const content =
        !reload && typeof draft === "string" && draft !== file.content ? draft : file.content;
      setDocs((current) => {
        const open = current.find((doc) => doc.path === file.path);
        return upsertOpenDoc(
          current,
          {
            path: file.path,
            content,
            original: file.content,
            baseline,
            kind: "text",
            htmlView: previewHtmlView(file.path, line, open?.htmlView),
          },
          file.path,
          splitRef.current ? otherPath(splitRef.current) : undefined,
        );
      });
    };
    const paint = (file: { path: string; content: string; baseline?: string }) => {
      applyBuffer(file);
      noteOpenPath(file.path);
      setEditing(true);
      setAskRange(null);
      expandToFile(file.path);
      requestScroll(file.path, line);
    };

    const cached = !reload ? peekWorkspaceFile(sessionId, nextPath) : undefined;
    if (cached) {
      paint(cached);
      return;
    }

    setDocs((current) => {
      if (current.some((doc) => doc.path === nextPath)) return current;
      return upsertOpenDoc(
        current,
        stubOpenDoc(nextPath),
        nextPath,
        splitRef.current ? otherPath(splitRef.current) : undefined,
      );
    });
    noteOpenPath(nextPath);
    setEditing(true);
    setAskRange(null);
    expandToFile(nextPath);

    try {
      const file = await loadWorkspaceFile(
        sessionId,
        nextPath,
        () => api.workspaceFile(sessionId, nextPath),
        { reload },
      );
      const stillOpen = docsRef.current.some((doc) => doc.path === file.path);
      if (seq !== openSeq.current) {
        if (stillOpen) applyBuffer(file);
        return;
      }
      paint(file);
    } catch (err) {
      if (restore) {
        setDocs((current) => {
          const next = current.filter((doc) => doc.path !== nextPath);
          const fallback = next.at(-1)?.path ?? "";
          setActivePath((on) => (on === nextPath ? fallback : on));
          setSplit((currentSplit) => {
            if (!currentSplit) return currentSplit;
            const result = closeInGroup(currentSplit, currentSplit.focused, nextPath);
            return result.split;
          });
          if (fallback) pendingRestoreActive.current = fallback;
          return next;
        });
        return;
      }
      setDocs((current) => {
        const open = current.find((doc) => doc.path === nextPath);
        if (!open?.cold) return current;
        const next = current.filter((doc) => doc.path !== nextPath);
        setActivePath((on) => (on === nextPath ? (next.at(-1)?.path ?? "") : on));
        return next;
      });
      if (seq === openSeq.current) {
        setError(
          isUnreachableError(err)
            ? UNREACHABLE_ERROR
            : err instanceof Error
              ? err.message
              : "Could not open file",
        );
      }
    }
  }
  openFileRef.current = openFile;

  useEffect(() => {
    function applyOpenPr(detail: WorkspaceOpenPrDetail) {
      if (!detail || detail.sessionId !== sessionId) return;
      consumeWorkspaceOpenPr(sessionId);
      setPrComments(detail.comments);
      const focus = detail.focus;
      void (async () => {
        const files = detail.files.slice(0, 12);
        const focusPath = focus?.path;
        for (const path of files) {
          if (path === focusPath) continue;
          await openFileRef.current(path, undefined, false, true);
        }
        if (focusPath) {
          await openFileRef.current(focusPath, focus?.line, false, true);
        } else if (files[0]) {
          await openFileRef.current(files[0], undefined, false, true);
        }
      })();
    }
    const pending = consumeWorkspaceOpenPr(sessionId);
    if (pending) applyOpenPr(pending);
    function onOpenPr(event: Event) {
      applyOpenPr((event as CustomEvent<WorkspaceOpenPrDetail>).detail);
    }
    window.addEventListener(WORKSPACE_OPEN_PR_EVENT, onOpenPr);
    return () => window.removeEventListener(WORKSPACE_OPEN_PR_EVENT, onOpenPr);
  }, [sessionId]);

  function toggleHtmlView() {
    if (!active || (!isHtml && !isMd && !isSvg)) return;
    const next = active.htmlView === "browser" ? "source" : "browser";
    if (next === "source") setEditing(true);
    setDocs((current) =>
      current.map((doc) => (doc.path === active.path ? { ...doc, htmlView: next } : doc)),
    );
  }

  useEffect(() => {
    window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      const drafts: Record<string, string> = {};
      for (const doc of docsRef.current) {
        if (doc.kind === "image" || doc.kind === "pdf") continue;
        if (doc.content !== doc.original) drafts[doc.path] = doc.content;
      }
      saveEditorDrafts(sessionId, drafts);
    }, 320);
    return () => window.clearTimeout(draftTimer.current);
  }, [docs, sessionId]);

  useEffect(() => {
    return () => {
      window.clearTimeout(draftTimer.current);
      const drafts: Record<string, string> = {};
      for (const doc of docsRef.current) {
        if (doc.kind === "image" || doc.kind === "pdf") continue;
        if (doc.content !== doc.original) drafts[doc.path] = doc.content;
      }
      saveEditorDrafts(sessionId, drafts);
    };
  }, [sessionId]);

  async function reloadUnmodified(paths?: string[]) {
    const targets = docsRef.current.filter((doc) => {
      if (doc.kind === "image" || doc.kind === "pdf") return false;
      if (doc.content !== doc.original) return false;
      if (paths?.length && !paths.includes(doc.path)) return false;
      return true;
    });
    if (!targets.length) return;
    const updates = await Promise.all(
      targets.map(async (doc) => {
        try {
          const file = await api.workspaceFile(sessionId, doc.path);
          rememberWorkspaceFile(sessionId, file);
          return { path: doc.path, content: file.content };
        } catch {
          return null;
        }
      }),
    );
    setDocs((current) =>
      current.map((doc) => {
        const hit = updates.find((row) => row?.path === doc.path);
        if (!hit || doc.content !== doc.original) return doc;
        return { ...doc, content: hit.content, original: hit.content };
      }),
    );
  }

  useEffect(() => {
    function onChanged(event: Event) {
      const detail = (event as CustomEvent<{ sessionId?: string; paths?: string[] }>).detail;
      if (detail?.sessionId && detail.sessionId !== sessionId) return;
      forgetWorkspaceFiles(sessionId, detail?.paths);
      void refresh();
      void reloadUnmodified(detail?.paths);
      void loadGit();
    }
    window.addEventListener("locus:workspace-changed", onChanged);
    return () => window.removeEventListener("locus:workspace-changed", onChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, gitDest]);

  async function refreshBranches() {
    if (typeof api.workspaceGitBranches !== "function") return;
    try {
      const listed = await api.workspaceGitBranches(sessionId, gitDest);
      setBranches(listed.branches);
      setRemotes(listed.remotes ?? []);
    } catch {
      setBranches([]);
    }
  }

  function applyGit(next: WorkspaceGitStatus) {
    setGit(next);
    if (next.dest) setGitDest(next.dest);
    void refreshBranches();
  }

  function destForRel(rel: string): string | undefined {
    return matchGitDest(rel, git?.dests ?? [])?.dest ?? gitDest ?? git?.dest;
  }

  async function loadGit() {
    if (typeof api.workspaceGit !== "function") return;
    try {
      const next = await api.workspaceGit(sessionId, gitDest);
      setGit(next);
      if (gitDest === undefined && next.dest) setGitDest(next.dest);
    } catch {
      setGit(null);
    }
    await refreshBranches();
  }

  useEffect(() => {
    if (!visible) return;
    void loadGit();
    const id = setInterval(() => void loadGit(), 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, visible, gitDest]);

  useEffect(() => {
    inlineAiSeq.current += 1;
    inlineAiRef.current = null;
    setInlineAi(null);
  }, [activePath]);

  useEffect(() => {
    if (!activePath || isImage || isPdf || showPanePreview) {
      setDiagnostics([]);
      setOutline([]);
      setSignature(null);
      return;
    }
    if (typeof api.workspaceInspect !== "function") return;
    const path = activePath;
    const text = content;
    const timer = window.setTimeout(() => {
      void api
        .workspaceInspect(sessionId, {
          path,
          content: text,
          line: Math.max(0, cursor.line - 1),
          character: Math.max(0, cursor.col - 1),
        })
        .then((res) => {
          if (path !== activePath) return;
          setDiagnostics(res.diagnostics ?? []);
          setOccurs(res.highlights ?? []);
          setPylspMissing(res.pylsp === false);
          const help = res.signature;
          if (!help?.label) {
            setSignature(null);
            return;
          }
          const ta = editorPane.current;
          const offset = ta?.selectionStart ?? 0;
          const pos = caretOffset(text, offset, {
            pad: EDITOR_PAD_PX,
            lineHeight: EDITOR_LINE_PX,
            charWidth: 7.2,
            scrollTop: codeBody.current?.scrollTop ?? 0,
            scrollLeft: codeBody.current?.scrollLeft ?? 0,
          });
          setSignature({
            help,
            left: Math.max(8, Math.min(pos.left, 480)),
            top: pos.top + EDITOR_LINE_PX,
          });
        })
        .catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [sessionId, activePath, content, cursor.line, cursor.col, isImage, isPdf, showPanePreview]);

  useEffect(() => {
    if (!activePath || isImage || isPdf || typeof api.workspaceOutline !== "function") {
      setOutline([]);
      return;
    }
    const path = activePath;
    const text = content;
    const timer = window.setTimeout(() => {
      void api
        .workspaceOutline(sessionId, { path, content: text })
        .then((res) => {
          if (path === activePath) setOutline(res.items ?? []);
        })
        .catch(() => setOutline([]));
    }, 360);
    return () => window.clearTimeout(timer);
  }, [sessionId, activePath, content, isImage, isPdf]);

  useEffect(() => {
    if (!activePath || typeof api.workspaceIndent !== "function") {
      setConfigIndent(null);
      setTabSize(2);
      return;
    }
    const path = activePath;
    void api
      .workspaceIndent(sessionId, path)
      .then((row) => {
        if (path !== activePath) return;
        setConfigIndent(row?.indent ?? null);
        if (row?.tabSize) setTabSize(row.tabSize);
      })
      .catch(() => {
        setConfigIndent(null);
      });
  }, [sessionId, activePath]);

  useEffect(() => {
    if (typeof api.workspaceProblems !== "function") return;
    const files = docs
      .filter((doc) => doc.kind !== "image" && doc.kind !== "pdf" && !doc.cold)
      .slice(0, 24)
      .map((doc) => ({ path: doc.path, content: doc.content }));
    if (!files.length) {
      setAllProblems([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void api
        .workspaceProblems(sessionId, files)
        .then((res) => setAllProblems(res.diagnostics ?? []))
        .catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [sessionId, docs]);

  useEffect(() => {
    if (typeof api.workspaceDebug !== "function") return;
    void api
      .workspaceDebug(sessionId)
      .then((row) => setDebug(row))
      .catch(() => undefined);
  }, [sessionId]);

  async function toggleBreakpoint(line: number) {
    if (!activePath || typeof api.workspaceDebugBreakpoints !== "function") return;
    try {
      setDebug(await api.workspaceDebugBreakpoints(sessionId, { path: activePath, line }));
    } catch {
      /* ignore */
    }
  }

  async function runDebug(
    action: "start" | "continue" | "stepOver" | "stepInto" | "stepOut" | "stop",
  ) {
    try {
      if (action === "start") {
        if (!activePath) return;
        setDebug(await api.workspaceDebugStart(sessionId, activePath));
        return;
      }
      setDebug(await api.workspaceDebugCommand(sessionId, action === "stop" ? "stop" : action));
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!activePath || typeof api.workspaceBlame !== "function") {
      setBlame(null);
      return;
    }
    const path = activePath;
    const line = cursor.line;
    const timer = window.setTimeout(() => {
      void api
        .workspaceBlame(sessionId, path, line)
        .then((row) => {
          if (path !== activePath) return;
          setBlame(row ? `${row.author} ${row.sha.slice(0, 7)}` : null);
        })
        .catch(() => setBlame(null));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [sessionId, activePath, cursor.line]);

  useEffect(() => {
    if (!activePath || typeof api.workspaceBlameFile !== "function") {
      setBlameLines([]);
      return;
    }
    const path = activePath;
    void api
      .workspaceBlameFile(sessionId, path)
      .then((res) => {
        if (path !== activePath) return;
        setBlameLines(res.items ?? []);
      })
      .catch(() => setBlameLines([]));
  }, [sessionId, activePath, git?.files.length, git?.branch]);

  async function applyFormatted(next: string) {
    if (!activePath) return;
    const ta = editorPane.current;
    const at = Math.min(ta?.selectionStart ?? 0, next.length);
    applyEdit({ text: next, start: at, end: at });
  }

  async function formatActive() {
    if (!active || typeof api.workspaceFormat !== "function") return;
    try {
      const res = await api.workspaceFormat(sessionId, {
        path: active.path,
        content: active.content,
      });
      if (res.content !== active.content) applyFormatted(res.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not format");
    }
  }

  async function organizeActive() {
    if (!active || typeof api.workspaceOrganize !== "function") return;
    try {
      const res = await api.workspaceOrganize(sessionId, {
        path: active.path,
        content: active.content,
      });
      if (res.content !== active.content) applyFormatted(res.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not organize imports");
    }
  }

  function editorInspectPos() {
    const ta = editorPane.current;
    if (ta) {
      const loc = offsetToLineCol(ta.value, ta.selectionStart);
      return { line: Math.max(0, loc.line - 1), character: Math.max(0, loc.col - 1) };
    }
    return { line: Math.max(0, cursor.line - 1), character: Math.max(0, cursor.col - 1) };
  }

  async function gotoDefinition() {
    await gotoInspected("definition");
  }

  async function gotoTypeDefinition() {
    await gotoInspected("typeDefinition");
  }

  async function gotoImplementation() {
    await gotoInspected("implementation");
  }

  async function gotoInspected(kind: "definition" | "typeDefinition" | "implementation") {
    if (!active || typeof api.workspaceInspect !== "function") return;
    try {
      const res = await api.workspaceInspect(sessionId, {
        path: active.path,
        content: active.content,
        ...editorInspectPos(),
      });
      const loc = res[kind];
      if (loc) await openFile(loc.path, loc.line + 1);
    } catch {
      /* no location */
    }
  }

  async function renameSymbol() {
    if (!active || typeof api.workspaceRename !== "function") return;
    const ta = editorPane.current;
    setNameForm({
      kind: "symbol",
      value: wordAtOffset(active.content, ta?.selectionStart ?? 0),
    });
  }

  async function submitNameForm() {
    if (!nameForm) return;
    const nextName = nameForm.value.trim();
    if (!nextName) {
      setNameForm(null);
      return;
    }
    if (nameForm.kind === "path") {
      const from = nameForm.from ?? "";
      setNameForm(null);
      await renamePath(from, nextName);
      return;
    }
    if (!active || typeof api.workspaceRename !== "function") {
      setNameForm(null);
      return;
    }
    setNameForm(null);
    try {
      const res = await api.workspaceRename(sessionId, {
        path: active.path,
        content: active.content,
        ...editorInspectPos(),
        newName: nextName,
      });
      const files = res.files ?? [];
      setDocs((current) => {
        let next = current;
        for (const file of files) {
          const open = next.find((doc) => doc.path === file.path);
          if (open) {
            next = next.map((doc) =>
              doc.path === file.path ? { ...doc, content: file.content } : doc,
            );
          }
        }
        return next;
      });
      for (const file of files) {
        const open = docs.find((doc) => doc.path === file.path);
        if (!open) await api.saveWorkspaceFile(sessionId, file.path, file.content);
      }
      if (files.some((file) => file.path === active.path)) {
        const hit = files.find((file) => file.path === active.path);
        if (hit) applyFormatted(hit.content);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename");
    }
  }

  function revertHunk(index: number) {
    if (!active || active.baseline === undefined) return;
    const next = revertNthChangeHunk(active.baseline, active.content, index);
    applyEdit({ text: next, start: 0, end: 0 });
  }

  function rejectAllHunks() {
    if (!active || active.baseline === undefined) return;
    applyEdit({ text: active.baseline, start: 0, end: 0 });
  }

  async function acceptAllHunks() {
    if (!active) return;
    setDocs((current) =>
      current.map((doc) =>
        doc.path === active.path ? { ...doc, original: doc.content, baseline: doc.content } : doc,
      ),
    );
    if (typeof api.workspaceGitStage === "function") {
      try {
        const dest = destForRel(active.path);
        const next = dest
          ? await api.workspaceGitStage(sessionId, [active.path], false, dest)
          : await api.workspaceGitStage(sessionId, [active.path]);
        setGit(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not accept");
      }
    }
  }

  async function acceptHunk(index: number) {
    if (!active || typeof api.workspaceGitHunks !== "function") return;
    try {
      const dest = destForRel(active.path);
      const res = dest
        ? await api.workspaceGitHunks(sessionId, active.path, dest)
        : await api.workspaceGitHunks(sessionId, active.path);
      const hunk = (res.items ?? []).filter((row) => !row.staged)[index];
      if (!hunk) return;
      const next = dest
        ? await api.workspaceGitHunk(sessionId, hunk.patch, false, dest)
        : await api.workspaceGitHunk(sessionId, hunk.patch);
      setGit(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept hunk");
    }
  }

  async function resolveConflicts(side: "ours" | "theirs") {
    if (!active) return;
    if (hasConflictMarkers(active.content)) {
      const next = resolveConflictMarkers(active.content, side);
      applyEdit({ text: next, start: 0, end: 0 });
      try {
        await api.saveWorkspaceFile(sessionId, active.path, next);
      } catch {
        /* buffer still resolved */
      }
      return;
    }
    if (typeof api.workspaceGitConflict !== "function") return;
    try {
      const dest = destForRel(active.path);
      const status = dest
        ? await api.workspaceGitConflict(sessionId, active.path, side, dest)
        : await api.workspaceGitConflict(sessionId, active.path, side);
      setGit(status);
      const file = await api.workspaceFile(sessionId, active.path);
      applyEdit({ text: file.content, start: 0, end: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve conflict");
    }
  }

  async function promoteFolder() {
    if (typeof api.promoteIdeToDocker !== "function") return;
    const runtime = store?.state.dockerKind === "docker" ? "docker" : "host";
    if (
      !(await askConfirm({
        title: runtime === "docker" ? "Create a Docker agent?" : "Create a Host agent?",
        body:
          runtime === "docker"
            ? "Create a Docker agent from this folder?"
            : "Docker is not available. Create a Host agent from this folder?",
        confirmLabel: "Create",
      }))
    ) {
      return;
    }
    setPromoting(true);
    try {
      const session = await api.promoteIdeToDocker(sessionId, runtime);
      onPromoted?.(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not promote this folder");
    } finally {
      setPromoting(false);
    }
  }

  function askAboutFile() {
    if (!active || isImage || isPdf || !onAskAgent) return;
    const range = askRange && askRange.end > askRange.start ? askRange : null;
    const picked = range
      ? offsetsToLines(active.content, range.start, range.end)
      : {
          startLine: 1,
          endLine: Math.max(1, active.content.split("\n").length),
          text: active.content.slice(0, 4_000),
        };
    if (range && !picked.text.trim()) return;
    onAskAgent(
      formatFileComment({
        path: active.path,
        startLine: picked.startLine,
        endLine: picked.endLine,
        text: picked.text,
      }),
    );
  }

  function closeInlineAi() {
    const range = inlineAiRef.current;
    inlineAiSeq.current += 1;
    inlineAiRef.current = null;
    setInlineAi(null);
    const ta = editorPane.current;
    if (!ta) return;
    if (range && range.end > range.start) {
      ta.setSelectionRange(range.start, range.end);
    }
    ta.focus();
    rememberCursor(ta);
  }

  function openInlineAi() {
    const ta = editorPane.current;
    if (!ta || !active || isImage || isPdf) return;
    setMenu(null);
    setCtxMenu(null);
    dismissHover();
    let start = ta.selectionStart;
    let end = ta.selectionEnd;
    if (end <= start && askRange && askRange.end > askRange.start) {
      start = askRange.start;
      end = askRange.end;
      ta.setSelectionRange(start, end);
    }
    const next = { start, end, busy: false, error: null };
    inlineAiRef.current = next;
    inlineAiSeq.current += 1;
    setInlineAi(next);
    if (end > start) setAskRange({ start, end });
    queueMicrotask(() => {
      const editor = editorPane.current;
      if (editor && end > start) editor.setSelectionRange(start, end);
    });
  }

  function inlineAiSelectionMarks() {
    if (!inlineAi || inlineAi.end <= inlineAi.start) return [];
    const from = offsetToLineCol(content, Math.min(inlineAi.start, inlineAi.end));
    const to = offsetToLineCol(content, Math.max(inlineAi.start, inlineAi.end));
    return inlineAiSelectionRects({
      startLine: from.line,
      endLine: to.line,
      startCol: from.col,
      endCol: to.col,
      viewStart: view.start,
      viewEnd: view.end,
      lineText: (line) => overlay.doc.lines[line - 1] ?? "",
      heights: wrapHeights,
      wrapWidth: wrap ? wrapWidth : undefined,
      tabSize,
    });
  }

  async function submitInlineAi(prompt: string, mode: InlineAiMode) {
    if (!inlineAi || !active || isImage || isPdf) return;
    const { start, end } = inlineAi;
    const contentNow =
      docsRef.current.find((doc) => doc.path === active.path)?.content ?? active.content;
    if (mode === "ask") {
      if (!onAskAgent) {
        setInlineAi((cur) => (cur ? { ...cur, error: "Chat is not available" } : cur));
        return;
      }
      const range = end > start ? { start, end } : null;
      const picked = range
        ? offsetsToLines(contentNow, range.start, range.end)
        : {
            startLine: 1,
            endLine: Math.max(1, contentNow.split("\n").length),
            text: contentNow.slice(0, 4_000),
          };
      onAskAgent(
        `${formatFileComment({
          path: active.path,
          startLine: picked.startLine,
          endLine: picked.endLine,
          text: picked.text,
        })}\n\n${prompt}`,
      );
      closeInlineAi();
      return;
    }
    if (typeof api.workspaceInlineEdit !== "function") {
      setInlineAi((cur) => (cur ? { ...cur, error: "Inline edits are not available" } : cur));
      return;
    }
    const seq = ++inlineAiSeq.current;
    setInlineAi((cur) => (cur ? { ...cur, busy: true, error: null } : cur));
    try {
      const res = await api.workspaceInlineEdit(sessionId, {
        path: active.path,
        content: contentNow,
        instruction: prompt,
        start,
        end,
      });
      if (seq !== inlineAiSeq.current) return;
      const from = Math.min(start, end);
      const to = Math.max(start, end);
      const next = contentNow.slice(0, from) + res.text + contentNow.slice(to);
      applyEdit({ text: next, start: from, end: from + res.text.length });
      inlineAiRef.current = null;
      setInlineAi(null);
    } catch (err) {
      if (seq !== inlineAiSeq.current) return;
      setInlineAi((cur) =>
        cur
          ? { ...cur, busy: false, error: err instanceof Error ? err.message : "Could not edit" }
          : cur,
      );
    }
  }

  async function save() {
    if (!active || saving || isImage || isPdf) return;
    setSaving(true);
    setError(null);
    try {
      let text = active.content;
      if (editorFormatOnSave() && typeof api.workspaceFormat === "function") {
        try {
          const formatted = await api.workspaceFormat(sessionId, {
            path: active.path,
            content: text,
          });
          if (formatted.content && formatted.content !== text) {
            text = formatted.content;
            const ta = editorPane.current;
            const at = Math.min(ta?.selectionStart ?? 0, text.length);
            applyEdit({ text, start: at, end: at });
          }
        } catch {
          /* keep unformatted buffer */
        }
      }
      await api.saveWorkspaceFile(sessionId, active.path, text);
      rememberWorkspaceFile(sessionId, {
        path: active.path,
        content: text,
        mtime: new Date().toISOString(),
        baseline: active.baseline,
      });
      setDocs((current) =>
        current.map((doc) =>
          doc.path === active.path ? { ...doc, content: text, original: text } : doc,
        ),
      );
      void loadGit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  function closeTab(path: string, group?: 0 | 1) {
    const snapshot = { docs, activePath, split: splitRef.current };
    const currentSplit = splitRef.current;
    if (currentSplit) {
      const result = closeInGroup(currentSplit, group ?? currentSplit.focused, path);
      if (result.dropBuffer) {
        setDocs((current) => current.filter((item) => item.path !== path));
      }
      setSplit(result.split);
      setActivePath(result.active);
      showUndoNotice(`Closed ${path}`, () => {
        setDocs(snapshot.docs);
        setActivePath(snapshot.activePath);
        setSplit(snapshot.split);
      });
      return;
    }
    const next = docs.filter((item) => item.path !== path);
    setDocs(next);
    if (activePath === path) setActivePath(next.at(-1)?.path ?? "");
    showUndoNotice(`Closed ${path}`, () => {
      setDocs(snapshot.docs);
      setActivePath(snapshot.activePath);
      setSplit(snapshot.split);
    });
  }

  async function saveAll() {
    const dirty = docs.filter(
      (doc) => doc.kind !== "image" && doc.kind !== "pdf" && doc.content !== doc.original,
    );
    for (const doc of dirty) {
      await api.saveWorkspaceFile(sessionId, doc.path, doc.content);
    }
    if (dirty.length) {
      setDocs((current) =>
        current.map((doc) =>
          dirty.some((row) => row.path === doc.path) ? { ...doc, original: doc.content } : doc,
        ),
      );
      void loadGit();
    }
  }

  function closeOthers() {
    if (!activePath) return;
    const snapshot = { docs, activePath, split: splitRef.current };
    const currentSplit = splitRef.current;
    if (currentSplit) {
      setSplit(closeOthersInFocused(currentSplit));
      showUndoNotice("Closed other tabs", () => {
        setDocs(snapshot.docs);
        setActivePath(snapshot.activePath);
        setSplit(snapshot.split);
      });
      return;
    }
    const keep = docs.find((doc) => doc.path === activePath);
    if (!keep) return;
    setDocs([keep]);
    showUndoNotice("Closed other tabs", () => {
      setDocs(snapshot.docs);
      setActivePath(snapshot.activePath);
      setSplit(snapshot.split);
    });
  }

  function closeSaved() {
    const currentSplit = splitRef.current;
    if (currentSplit) {
      const dirty = new Set(
        docs
          .filter(
            (doc) => doc.kind !== "image" && doc.kind !== "pdf" && doc.content !== doc.original,
          )
          .map((doc) => doc.path),
      );
      const result = closeSavedInFocused(currentSplit, dirty);
      if (result.drop.length) {
        setDocs((current) => current.filter((doc) => !result.drop.includes(doc.path)));
      }
      setSplit(result.split);
      setActivePath(result.active);
      return;
    }
    const next = docs.filter((doc) => doc.path === activePath || doc.content !== doc.original);
    setDocs(next);
    if (!next.some((doc) => doc.path === activePath)) setActivePath(next.at(-1)?.path ?? "");
  }

  function toggleWrap() {
    setWrap((current) => {
      const next = !current;
      try {
        localStorage.setItem("locus-editor-wrap", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function toggleMinimap() {
    setShowMinimap((current) => {
      const next = !current;
      applyEditorPrefs(editorFontSizePx(), editorFormatOnSave(), next);
      const config = store?.state.config;
      if (config) {
        void api
          .saveConfig({ ...config, showMinimap: next })
          .then((saved) => store.dispatch({ type: "config", config: saved }))
          .catch(() => undefined);
      }
      return next;
    });
  }

  function rememberCursor(ta: HTMLTextAreaElement) {
    const next = offsetToLineCol(ta.value, ta.selectionStart);
    setCursor((cur) => (cur.line === next.line && cur.col === next.col ? cur : next));
    const pinned = inlineAiRef.current;
    if (pinned && pinned.end > pinned.start) {
      setAskRange((cur) =>
        cur?.start === pinned.start && cur.end === pinned.end
          ? cur
          : { start: pinned.start, end: pinned.end },
      );
      return;
    }
    setAskRange((cur) => {
      if (ta.selectionEnd > ta.selectionStart) {
        if (cur?.start === ta.selectionStart && cur.end === ta.selectionEnd) return cur;
        return { start: ta.selectionStart, end: ta.selectionEnd };
      }
      return cur ? null : cur;
    });
  }

  function placeEditorCaret(
    ta: HTMLTextAreaElement,
    clientX: number,
    clientY: number,
    preserveSelection = false,
  ) {
    const body = codeBody.current;
    if (!body) return;
    const bodyRect = body.getBoundingClientRect();
    if (bodyRect.width <= 0 && bodyRect.height <= 0) {
      rememberCursor(ta);
      return;
    }
    const y = clientY - bodyRect.top + body.scrollTop - EDITOR_PAD_PX;
    const visual = Math.max(0, Math.floor(y / EDITOR_LINE_PX));
    const prefix = wrapHeights ? visualPrefix(wrapHeights) : null;
    const line = prefix ? logicalIndexAtVisual(prefix, visual) : visual;
    const x = clientX - bodyRect.left + body.scrollLeft - EDITOR_PAD_PX - EDITOR_GUTTER_PX;
    const cols = Math.max(1, Math.floor(wrapWidth / EDITOR_CHAR_PX));
    const visualStart = prefix ? (prefix[line] ?? line) : line;
    const wrapRow = wrap && prefix ? Math.max(0, visual - visualStart) : 0;
    const character = Math.max(0, Math.floor(x / EDITOR_CHAR_PX) + wrapRow * cols);
    const offset = offsetAtLineCol(ta.value, line, character);
    const from = Math.min(ta.selectionStart, ta.selectionEnd);
    const to = Math.max(ta.selectionStart, ta.selectionEnd);
    if (!(preserveSelection && to > from && offset >= from && offset <= to)) {
      ta.selectionStart = offset;
      ta.selectionEnd = offset;
    }
    rememberCursor(ta);
  }

  function applyEdit(
    next: { text: string; start: number; end: number },
    source?: "undo" | "redo",
    path = activePath,
  ) {
    if (!path) return;
    if (source !== "undo" && source !== "redo") {
      const doc = docsRef.current.find((item) => item.path === path);
      if (doc && doc.content !== next.text) {
        const ta = editorPane.current;
        editHistory.current.push({
          path,
          text: doc.content,
          start: ta?.selectionStart ?? 0,
          end: ta?.selectionEnd ?? ta?.selectionStart ?? 0,
        });
      }
    }
    if (path !== activePath) setActivePath(path);
    setDocs((current) =>
      current.map((doc) => (doc.path === path ? { ...doc, content: next.text } : doc)),
    );
    setCursor(offsetToLineCol(next.text, next.start));
    queueMicrotask(() => {
      const ta = editorPane.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(next.start, next.end);
    });
  }

  function undoEdit() {
    const snap = editHistory.current.popUndo();
    if (!snap) return;
    const doc = docsRef.current.find((item) => item.path === snap.path);
    const ta = editorPane.current;
    if (doc) {
      editHistory.current.pushRedo({
        path: snap.path,
        text: doc.content,
        start: ta?.selectionStart ?? 0,
        end: ta?.selectionEnd ?? ta?.selectionStart ?? 0,
      });
    }
    applyEdit({ text: snap.text, start: snap.start, end: snap.end }, "undo", snap.path);
  }

  function redoEdit() {
    const snap = editHistory.current.popRedo();
    if (!snap) return;
    const doc = docsRef.current.find((item) => item.path === snap.path);
    const ta = editorPane.current;
    if (doc) {
      editHistory.current.pushUndoKeepRedo({
        path: snap.path,
        text: doc.content,
        start: ta?.selectionStart ?? 0,
        end: ta?.selectionEnd ?? ta?.selectionStart ?? 0,
      });
    }
    applyEdit({ text: snap.text, start: snap.start, end: snap.end }, "redo", snap.path);
  }

  function applyMenuItem(item: CompletionItem) {
    const ta = editorPane.current;
    if (!ta) return;
    setMenu(null);
    applyEdit(applyCompletion(ta.value, ta.selectionStart, item, indent, activePath, lang));
    const extras = (item.additionalEdits ?? []).filter(
      (edit) => edit.path && edit.path !== activePath,
    );
    if (!extras.length) return;
    const grouped = new Map<string, typeof extras>();
    for (const edit of extras) {
      const path = edit.path!;
      const list = grouped.get(path) ?? [];
      list.push(edit);
      grouped.set(path, list);
    }
    setDocs((current) => {
      let next = current;
      for (const [path, list] of grouped) {
        const open = next.find((doc) => doc.path === path);
        if (!open) continue;
        let text = open.content;
        const ordered = [...list].sort(
          (a, b) => b.startLine - a.startLine || b.startCharacter - a.startCharacter,
        );
        for (const edit of ordered) {
          const start = offsetAtLineCol(text, edit.startLine, edit.startCharacter);
          const end = offsetAtLineCol(text, edit.endLine, edit.endCharacter);
          text = text.slice(0, start) + edit.newText + text.slice(end);
        }
        next = next.map((doc) => (doc.path === path ? { ...doc, content: text } : doc));
      }
      return next;
    });
  }

  function scheduleComplete(text: string, offset: number, forced: boolean) {
    if (!activePath || isImage || isPdf || showDiff || showBrowser) return;
    if (!shouldAutoComplete(text, offset, forced, lang)) {
      setMenu(null);
      return;
    }
    window.clearTimeout(completeTimer.current);
    const wait = forced ? 0 : 180;
    const path = activePath;
    const fileLang = lang;
    completeTimer.current = window.setTimeout(() => {
      void runComplete(text, offset, forced, path, fileLang);
    }, wait);
  }

  async function runComplete(
    text: string,
    offset: number,
    forced: boolean,
    path: string,
    fileLang: string,
  ) {
    const seq = (completeSeq.current += 1);
    const local = completeAt({
      text,
      offset,
      lang: fileLang,
      extraWords: extraWordsRef.current,
      indent,
      forced,
    });
    const pos = caretOffset(text, offset, {
      pad: 12,
      lineHeight: 18,
      charWidth: 7.2,
      scrollTop: codeBody.current?.scrollTop ?? 0,
      scrollLeft: codeBody.current?.scrollLeft ?? 0,
    });
    const place = {
      left: Math.max(8, Math.min(pos.left, 480)),
      top: pos.top + 18,
    };
    if (local.length) {
      setMenu({ items: local, index: 0, left: place.left, top: place.top });
    }
    let remote: CompletionItem[] = [];
    try {
      const { line, col } = offsetToLineCol(text, offset);
      const res = await api.workspaceComplete(sessionId, {
        path,
        content: text,
        line: line - 1,
        character: col - 1,
      });
      remote = (res.items ?? []).map(fromRemoteCompletion);
    } catch {
      remote = [];
    }
    if (seq !== completeSeq.current || path !== activePath) return;
    const items = mergeCompletions(remote, local);
    if (!items.length) {
      setMenu(null);
      return;
    }
    setMenu({
      items,
      index: 0,
      left: place.left,
      top: place.top,
    });
  }

  function jumpFind(delta: number) {
    if (!findHits.length) return;
    const next = (findIndex + delta + findHits.length * 8) % findHits.length;
    setFindIndex(next);
    const start = findHits[next] ?? 0;
    applyEdit({ text: content, start, end: start + findQuery.trim().length });
    scrollToLine(offsetToLineCol(content, start).line);
  }

  function openFind() {
    setFindOpen(true);
    const ta = editorPane.current;
    if (ta && ta.selectionEnd > ta.selectionStart) {
      setFindQuery(content.slice(ta.selectionStart, ta.selectionEnd));
    }
    queueMicrotask(() => findInput.current?.focus());
  }

  function parentDir(): string {
    if (!activePath) return "";
    const slash = activePath.lastIndexOf("/");
    return slash < 0 ? "" : activePath.slice(0, slash);
  }

  async function createFile(fromDir?: string) {
    const name = await askPrompt({
      title: "New file",
      value: suggestedChildPath(fromDir ?? parentDir(), "untitled.ts"),
    });
    if (!name) return;
    const path = name.replace(/^\/+/, "").trim();
    if (!path) return;
    setError(null);
    try {
      await api.saveWorkspaceFile(sessionId, path, "");
      await refresh();
      await openFile(path);
      setEditing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create file");
    }
  }

  async function createFolder(fromDir?: string) {
    const name = await askPrompt({
      title: "New folder",
      value: suggestedChildPath(fromDir ?? parentDir(), "src"),
    });
    if (!name) return;
    const path = name.replace(/^\/+/, "").trim();
    if (!path) return;
    setError(null);
    try {
      await api.mkdirWorkspace(sessionId, path);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create folder");
    }
  }

  async function removePath(path: string) {
    if (
      !(await askConfirm({
        title: `Delete ${path}?`,
        body: "This cannot be undone.",
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    setError(null);
    try {
      await api.deleteWorkspaceFile(sessionId, path);
      setDocs((current) => {
        const next = current.filter((item) => item.path !== path);
        setActivePath((on) => (on === path ? (next.at(-1)?.path ?? "") : on));
        return next;
      });
      setSplit((current) => {
        if (!current) return current;
        const left = closeInGroup(current, 0, path);
        if (!left.split) return left.split;
        return closeInGroup(left.split, 1, path).split;
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  async function renamePath(from: string, toRaw: string) {
    if (typeof api.renameWorkspacePath !== "function") return;
    const to = toRaw.replace(/^\/+/, "").trim();
    if (!from || !to || from === to) return;
    setError(null);
    try {
      const res = await api.renameWorkspacePath(sessionId, from, to);
      const dest = res.path;
      setDocs((current) =>
        current.map((doc) => ({ ...doc, path: remapWorkspacePath(doc.path, from, dest) })),
      );
      setActivePath((on) => remapWorkspacePath(on, from, dest));
      setSplit((current) => (current ? remapSplitPath(current, from, dest) : current));
      setExpanded((current) => {
        const next = new Set<string>();
        for (const path of current) next.add(remapWorkspacePath(path, from, dest));
        return commitExpanded(next);
      });
      editHistory.current.remapPaths(from, dest);
      expandToFile(dest);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename");
    }
  }

  async function findReferences() {
    if (!active || typeof api.workspaceReferences !== "function") return;
    try {
      const res = await api.workspaceReferences(sessionId, {
        path: active.path,
        content: active.content,
        ...editorInspectPos(),
      });
      setRefs(res.items ?? []);
    } catch {
      setRefs([]);
    }
  }

  function dismissHover() {
    hoverSeq.current += 1;
    window.clearTimeout(hoverTimer.current);
    setHover(null);
  }

  async function requestFixes() {
    if (!active || typeof api.workspaceFix !== "function") return;
    try {
      const res = await api.workspaceFix(sessionId, {
        path: active.path,
        content: active.content,
        ...editorInspectPos(),
      });
      setFixes(res.items ?? []);
    } catch {
      setFixes([]);
    }
  }

  async function editorCopy() {
    const ta = editorPane.current;
    if (!ta || ta.selectionEnd <= ta.selectionStart) return;
    try {
      await navigator.clipboard.writeText(ta.value.slice(ta.selectionStart, ta.selectionEnd));
    } catch {
      /* clipboard unavailable */
    }
  }

  async function editorCut() {
    const ta = editorPane.current;
    if (!ta || ta.selectionEnd <= ta.selectionStart) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    try {
      await navigator.clipboard.writeText(ta.value.slice(start, end));
    } catch {
      /* still cut locally */
    }
    applyEdit({ text: ta.value.slice(0, start) + ta.value.slice(end), start, end: start });
  }

  async function editorPaste() {
    const ta = editorPane.current;
    if (!ta) return;
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = ta.value.slice(0, start) + text + ta.value.slice(end);
    const at = start + text.length;
    applyEdit({ text: next, start: at, end: at });
  }

  function editorSelectAll() {
    const ta = editorPane.current;
    if (!ta) return;
    ta.select();
    rememberCursor(ta);
  }

  function runEditorAction(action: () => void) {
    if (ctxMenu?.kind === "editor") {
      const ta = editorPane.current;
      if (ta) {
        ta.setSelectionRange(ctxMenu.start, ctxMenu.end);
        rememberCursor(ta);
      }
    }
    setCtxMenu(null);
    action();
  }

  function applyFix(action: { title: string; files: Array<{ path: string; content: string }> }) {
    setFixes(null);
    setDocs((current) => {
      let next = current;
      for (const file of action.files) {
        const open = next.find((doc) => doc.path === file.path);
        if (open) {
          next = next.map((doc) =>
            doc.path === file.path ? { ...doc, content: file.content } : doc,
          );
        }
      }
      return next;
    });
    for (const file of action.files) {
      if (file.path === activePath) applyFormatted(file.content);
      else if (!docs.some((doc) => doc.path === file.path)) {
        void api.saveWorkspaceFile(sessionId, file.path, file.content);
      }
    }
  }

  async function onEditorKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    const ta = e.currentTarget;
    const meta = e.metaKey || e.ctrlKey;
    if (hover && e.key !== "Shift" && e.key !== "Control" && e.key !== "Alt" && e.key !== "Meta") {
      dismissHover();
    }
    if (ctxMenu && e.key === "Escape") {
      e.preventDefault();
      setCtxMenu(null);
      return;
    }
    if (inlineAi && e.key === "Escape") {
      e.preventDefault();
      closeInlineAi();
      return;
    }
    if (matchModKey(e, "k", true)) {
      e.preventDefault();
      e.stopPropagation();
      openInlineAi();
      return;
    }
    if (menu) {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenu(null);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMenu((current) =>
          current ? { ...current, index: (current.index + 1) % current.items.length } : current,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMenu((current) =>
          current
            ? {
                ...current,
                index: (current.index - 1 + current.items.length) % current.items.length,
              }
            : current,
        );
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !meta && !e.altKey)) {
        e.preventDefault();
        const item = menu.items[menu.index];
        if (item) applyMenuItem(item);
        return;
      }
    }
    if (e.ctrlKey && e.key === " ") {
      e.preventDefault();
      scheduleComplete(ta.value, ta.selectionStart, true);
      return;
    }
    if (matchModKey(e, "s")) {
      e.preventDefault();
      e.stopPropagation();
      void save();
      return;
    }
    if (e.key === "Escape" && refs) {
      e.preventDefault();
      setRefs(null);
      return;
    }
    if (e.key === "F12") {
      e.preventDefault();
      if (e.altKey) void gotoTypeDefinition();
      else if (meta) void gotoImplementation();
      else if (e.shiftKey) void findReferences();
      else void gotoDefinition();
      return;
    }
    if (e.key === "F2") {
      e.preventDefault();
      void renameSymbol();
      return;
    }
    if (matchModKey(e, "z", true) || matchModKey(e, "y")) {
      e.preventDefault();
      redoEdit();
      return;
    }
    if (matchModKey(e, "z")) {
      e.preventDefault();
      undoEdit();
      return;
    }
    if (e.altKey && e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      void formatActive();
      return;
    }
    if (e.altKey && e.shiftKey && e.key.toLowerCase() === "o") {
      e.preventDefault();
      void organizeActive();
      return;
    }
    if (matchModKey(e, ".")) {
      e.preventDefault();
      void requestFixes();
      return;
    }
    if (matchModKey(e, "s", true)) {
      e.preventDefault();
      void saveAll();
      return;
    }
    if (matchModKey(e, "w")) {
      e.preventDefault();
      e.stopPropagation();
      void closeTab(activePath);
      return;
    }
    if (matchModKey(e, "f", true)) {
      e.preventDefault();
      e.stopPropagation();
      setFileSearch(true);
      return;
    }
    if (matchModKey(e, "f") || matchModKey(e, "h")) {
      e.preventDefault();
      e.stopPropagation();
      openFind();
      return;
    }
    if (matchModKey(e, "g")) {
      e.preventDefault();
      e.stopPropagation();
      const raw = await askPrompt({ title: "Go to line", value: String(cursor.line) });
      const line = Number.parseInt(raw ?? "", 10);
      if (!Number.isFinite(line) || line < 1) return;
      const start = offsetAtLine(content, line);
      applyEdit({ text: content, start, end: start });
      scrollToLine(line);
      return;
    }
    if (meta && e.key === "/") {
      e.preventDefault();
      applyEdit(toggleComment(content, ta.selectionStart, ta.selectionEnd, lang));
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      applyEdit(applyTab(content, ta.selectionStart, ta.selectionEnd, indent, e.shiftKey));
      return;
    }
    if (e.key === "Enter" && !meta && !e.altKey) {
      e.preventDefault();
      applyEdit(applyEnter(content, ta.selectionStart, indent));
    }
  }

  function commitExpanded(next: Set<string>) {
    saveExplorerExpanded(sessionId, next);
    return next;
  }

  function expandToFile(path: string) {
    const parts = path.split("/");
    if (parts.length < 2) return;
    setExpanded((current) => {
      const next = new Set(current);
      for (let i = 1; i < parts.length; i += 1) next.add(parts.slice(0, i).join("/"));
      return commitExpanded(next);
    });
  }

  function toggleDir(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return commitExpanded(next);
    });
  }

  const emptyWorkspace = treeReady && entries.length === 0 && changes.length === 0;
  const indexing = indexProgress?.status === "building";
  const indexScanned = indexProgress?.scanned ?? 0;
  const indexPct = indexing
    ? Math.max(6, Math.min(92, Math.round((indexScanned / 20_000) * 100)))
    : 0;
  const otherSplitPath = split ? otherPath(split) : "";
  const otherSplitDoc = otherSplitPath
    ? docs.find((doc) => doc.path === otherSplitPath)
    : undefined;
  const splitPercent = split ? Math.round(split.frac * 100) : 50;

  function renderTabs(
    paths: string[],
    selected: string,
    group?: 0 | 1,
    listRef?: RefObject<HTMLDivElement | null>,
  ) {
    return (
      <WorkspaceEditorTabs
        paths={paths}
        selected={selected}
        docs={docs}
        group={group}
        listRef={listRef}
        stubDoc={stubOpenDoc}
        onOpen={(path, cold) => {
          noteOpenPath(path, group);
          setEditing(true);
          if (cold) void openFile(path);
          else expandToFile(path);
        }}
        onClose={(path) => {
          void closeTab(path, group);
        }}
      />
    );
  }

  return (
    <div className="workspace-editor">
      <aside className="workspace-tree">
        <div className="workspace-tree-head">
          <strong>EXPLORER</strong>
          <div className="workspace-tree-actions">
            <Tooltip label="Refresh">
              <button
                type="button"
                className="btn icon ghost workspace-tree-refresh"
                aria-label="Refresh"
                onClick={() => void refresh()}
              >
                <IconRefresh />
              </button>
            </Tooltip>
            <Tooltip label="New file">
              <button
                type="button"
                className="btn icon ghost workspace-tree-refresh"
                aria-label="New file"
                onClick={() => void createFile()}
              >
                <IconPlus />
              </button>
            </Tooltip>
            <Tooltip label="New folder">
              <button
                type="button"
                className="btn icon ghost workspace-tree-refresh"
                aria-label="New folder"
                onClick={() => void createFolder()}
              >
                <IconFolder />
              </button>
            </Tooltip>
          </div>
        </div>
        <WorkspaceExplorerFiles
          key={sessionId}
          builtTree={builtTree}
          statsByPath={statsByPath}
          expanded={expanded}
          mode={mode}
          activePath={activePath}
          treeReady={treeReady}
          emptyWorkspace={emptyWorkspace}
          scrollRef={treeScroll}
          onToggleDir={toggleDir}
          onOpenFile={(path) => void openFile(path)}
          onPrefetchFile={(path) => {
            if (isWorkspaceBinaryPreviewPath(path)) return;
            if (peekWorkspaceFile(sessionId, path)) return;
            const open = docsRef.current.find((doc) => doc.path === path);
            if (open && !open.cold) return;
            void loadWorkspaceFile(sessionId, path, () => api.workspaceFile(sessionId, path));
          }}
          onRemovePath={(path) => void removePath(path)}
          onContextMenu={(event, path, dir) => {
            setCtxMenu({
              kind: "explorer",
              x: event.clientX,
              y: event.clientY,
              path,
              dir,
            });
          }}
          modeButtons={
            <div className="workspace-tree-mode" role="group" aria-label="Explorer files">
              <button
                type="button"
                data-mode="all"
                className={mode === "all" ? "on" : ""}
                aria-pressed={mode === "all"}
                onClick={() => setMode("all")}
              >
                All
              </button>
              <button
                type="button"
                data-mode="updated"
                className={mode === "updated" ? "on" : ""}
                aria-pressed={mode === "updated"}
                onClick={() => setMode("updated")}
              >
                Updated
              </button>
              <button
                type="button"
                data-mode="git"
                className={mode === "git" ? "on" : ""}
                aria-pressed={mode === "git"}
                onClick={() => {
                  setMode("git");
                  void loadGit();
                }}
              >
                Git{git?.files.length ? ` ${git.files.length}` : ""}
              </button>
            </div>
          }
          indexing={
            indexing ? (
              <div className="workspace-tree-index" role="status" aria-live="polite">
                <div
                  className="workspace-tree-progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={indexPct}
                  aria-label="Indexing workspace"
                >
                  <span style={{ width: `${indexPct}%` }} />
                </div>
                <p className="hint">
                  {indexScanned > 0
                    ? `Indexing workspace… ${indexScanned.toLocaleString()} ${
                        indexScanned === 1 ? "file" : "files"
                      }`
                    : "Indexing workspace…"}
                </p>
              </div>
            ) : null
          }
          gitPane={
            git && (git.branch || git.files.length || (git.dests?.length ?? 0) > 1) ? (
              <WorkspaceGitPane
                sessionId={sessionId}
                git={git}
                branches={branches}
                remotes={remotes}
                commitMsg={commitMsg}
                onCommitMsg={setCommitMsg}
                onGit={applyGit}
                onError={setError}
                onOpenFile={(path, line) => void openFile(path, line)}
                onOpenPull={onOpenPull}
                onDestChange={setGitDest}
              />
            ) : (
              <p className="hint">Not a git workspace.</p>
            )
          }
        />
        {store?.state.section === "ide" ? (
          <DockerExplorer
            selectedId={dockerInspect?.id}
            onInspect={(row) => setDockerInspect(row)}
          />
        ) : null}
        <div className="workspace-tree-foot">
          <span>{remote ? "Worker folder" : "This folder"}</span>
          <span className="workspace-tree-foot-meta">
            {totals.additions || totals.deletions ? (
              <DiffCounts additions={totals.additions} deletions={totals.deletions} />
            ) : null}
          </span>
        </div>
      </aside>
      <div
        ref={splitRoot}
        className={`workspace-code${split ? " is-split" : ""}${splitDragging ? " editor-splitting" : ""}`}
        style={
          split
            ? {
                gridTemplateColumns: editorSplitColumns(split.frac),
              }
            : undefined
        }
      >
        <div className="workspace-code-head" style={split ? { gridArea: "meta" } : undefined}>
          {split
            ? null
            : renderTabs(
                docs.map((doc) => doc.path),
                activePath,
                undefined,
                tabsRow,
              )}
          <div className="workspace-code-meta">
            {activePath ? (
              isImage || isPdf ? (
                <>
                  <span>
                    {(activePath.split(".").pop() ?? (isPdf ? "pdf" : "image")).toUpperCase()}
                  </span>
                  <span>Preview</span>
                </>
              ) : (
                <>
                  <span>{isSvg ? "SVG" : languageLabel(lang)}</span>
                  {isHtml || isMd || isSvg ? (
                    <button
                      type="button"
                      className={`workspace-diff-toggle ${showPanePreview ? "on" : ""}`}
                      data-html-view={showPanePreview ? "browser" : "source"}
                      aria-pressed={showPanePreview}
                      onClick={() => toggleHtmlView()}
                    >
                      {showPanePreview ? "Source" : isHtml ? "Browser" : "Preview"}
                    </button>
                  ) : null}
                  {hasDiffHunks && !showPanePreview ? (
                    <button
                      type="button"
                      className={`workspace-diff-toggle ${showDiff ? "on" : ""}`}
                      aria-pressed={showDiff}
                      onClick={() => setEditing((value) => !value)}
                    >
                      {showDiff ? "Edit" : "Diff"}
                    </button>
                  ) : null}
                  <BusyButton
                    type="button"
                    className={`workspace-save ${dirty ? "" : "saved"}`}
                    busy={saving}
                    busyLabel="Saving…"
                    disabled={!dirty}
                    onClick={() => void save()}
                  >
                    {dirty ? "Save" : "Saved"}
                  </BusyButton>
                </>
              )
            ) : (
              <span className="meta">Open a file</span>
            )}
            <OverflowMenu
              className="workspace-editor-more"
              title="More"
              align="right"
              toggleClassName="workspace-diff-toggle"
              label={<IconMore />}
            >
              {activePath && !isImage && !isPdf ? (
                <>
                  <MenuItem
                    disabled={!docs.some((doc) => doc.content !== doc.original)}
                    onClick={() => void saveAll()}
                  >
                    Save all
                  </MenuItem>
                  <MenuItem active={wrap} pressed={wrap} onClick={toggleWrap}>
                    Wrap
                  </MenuItem>
                  <MenuItem
                    active={showMinimap}
                    pressed={showMinimap}
                    testId="editor-minimap-toggle"
                    onClick={toggleMinimap}
                  >
                    Minimap
                  </MenuItem>
                  <MenuSep />
                  <MenuItem onClick={() => void closeOthers()}>Close others</MenuItem>
                  <MenuItem onClick={closeSaved}>Close saved</MenuItem>
                  {onAskAgent ? (
                    <MenuItem onClick={askAboutFile}>
                      {askRange && askRange.end > askRange.start ? "Ask agent" : "Ask about file"}
                    </MenuItem>
                  ) : null}
                  <MenuItem
                    active={findOpen}
                    pressed={findOpen}
                    onClick={() => (findOpen ? setFindOpen(false) : openFind())}
                  >
                    Find
                  </MenuItem>
                  <MenuSep />
                </>
              ) : null}
              {activePath ? (
                <MenuItem
                  active={Boolean(split)}
                  pressed={Boolean(split)}
                  testId="editor-split-toggle"
                  onClick={toggleSplit}
                >
                  {split ? "Join" : "Split"}
                </MenuItem>
              ) : null}
              <MenuItem
                active={fileSearch}
                pressed={fileSearch}
                onClick={() => setFileSearch((open) => !open)}
              >
                Search
              </MenuItem>
            </OverflowMenu>
          </div>
        </div>
        {error ? (
          <p
            className="workspace-code-error"
            role="alert"
            style={split ? { gridArea: "err" } : undefined}
          >
            <span>{error}</span>
            <button type="button" className="btn small ghost" onClick={() => setError(null)}>
              Dismiss
            </button>
          </p>
        ) : null}
        {split ? (
          <>
            <div
              className={`workspace-split-tabs${split.focused === 0 ? " on" : ""}`}
              data-editor-pane="0"
              style={{ gridArea: "tabs0" }}
              onMouseDown={() => focusPane(0)}
            >
              {renderTabs(
                split.groups[0].paths,
                split.groups[0].active,
                0,
                split.focused === 0 ? tabsRow : undefined,
              )}
            </div>
            <div
              className="workspace-split-gutter"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize editor groups"
              aria-valuemin={Math.round(EDITOR_SPLIT_MIN * 100)}
              aria-valuemax={Math.round(EDITOR_SPLIT_MAX * 100)}
              aria-valuenow={splitPercent}
              aria-valuetext={`${splitPercent}% left`}
              tabIndex={0}
              style={{ gridArea: "gutter" }}
              onPointerDown={onSplitGutterDown}
              onKeyDown={onSplitGutterKey}
            />
            <div
              className={`workspace-split-tabs${split.focused === 1 ? " on" : ""}`}
              data-editor-pane="1"
              style={{ gridArea: "tabs1" }}
              onMouseDown={() => focusPane(1)}
            >
              {renderTabs(
                split.groups[1].paths,
                split.groups[1].active,
                1,
                split.focused === 1 ? tabsRow : undefined,
              )}
            </div>
            {otherSplitPath ? (
              <div
                className="workspace-companion-slot"
                style={{ gridArea: split.focused === 0 ? "right" : "left" }}
              >
                <WorkspaceCompanion
                  sessionId={sessionId}
                  path={otherSplitPath}
                  content={otherSplitDoc?.content ?? ""}
                  kind={otherSplitDoc?.kind}
                  onFocus={() => focusPane(split.focused === 0 ? 1 : 0)}
                />
              </div>
            ) : null}
          </>
        ) : null}
        <div
          className="workspace-live"
          style={split ? { gridArea: split.focused === 0 ? "left" : "right" } : undefined}
        >
          {activePath && outline.length ? (
            <nav className="workspace-outline" aria-label="File outline">
              {activePath.split("/").map((part, i, parts) => {
                const folder = parts.slice(0, i + 1).join("/");
                const isLast = i === parts.length - 1;
                return (
                  <span key={`${part}-${i}`}>
                    {i ? " / " : ""}
                    {isLast ? (
                      part
                    ) : (
                      <button
                        type="button"
                        className="workspace-outline-item"
                        onClick={() => {
                          setExpanded((current) => {
                            const next = new Set(current);
                            let acc = "";
                            for (const seg of parts.slice(0, i + 1)) {
                              acc = acc ? `${acc}/${seg}` : seg;
                              next.add(acc);
                            }
                            return next;
                          });
                          setMode("all");
                          void folder;
                        }}
                      >
                        {part}
                      </button>
                    )}
                  </span>
                );
              })}
              <span className="workspace-outline-sep">·</span>
              {outline.slice(0, 12).map((item) => (
                <button
                  key={`${item.name}:${item.line}`}
                  type="button"
                  className="workspace-outline-item"
                  onClick={() => requestScroll(activePath, item.line)}
                >
                  {item.name}
                </button>
              ))}
            </nav>
          ) : null}
          {problemsOpen && (allProblems.length || diagnostics.length) ? (
            <ul className="workspace-problems" aria-label="Problems">
              {(allProblems.length ? allProblems : diagnostics).map((diag, i) => (
                <li key={`${diag.path}:${diag.startLine}:${diag.message}:${i}`}>
                  <button
                    type="button"
                    onClick={() => {
                      if (diag.path && diag.path !== activePath)
                        void openFile(diag.path, diag.startLine + 1);
                      else requestScroll(diag.path || activePath, diag.startLine + 1);
                    }}
                  >
                    {diag.path && diag.path !== activePath ? `${diag.path} · ` : ""}
                    {diag.severity} · {diag.startLine + 1}: {diag.message}
                  </button>
                  {onAskAgent ? (
                    <button
                      type="button"
                      className="btn small ghost workspace-problems-fix"
                      onClick={() =>
                        onAskAgent(
                          `Fix this ${diag.severity} in ${diag.path || activePath}:${diag.startLine + 1}: ${diag.message}`,
                        )
                      }
                    >
                      Fix with agent
                    </button>
                  ) : null}
                  {testCommandForDiagnostic(diag.path || activePath, diag.message, project.kind) ? (
                    <button
                      type="button"
                      className="btn small ghost workspace-problems-fix"
                      onClick={() => {
                        const cmd = testCommandForDiagnostic(
                          diag.path || activePath,
                          diag.message,
                          project.kind,
                        );
                        if (cmd) requestWorkspaceTerminalRun(cmd);
                      }}
                    >
                      Run test
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {debugOpen ? (
            <div className="workspace-debug" aria-label="Debug">
              <div className="workspace-debug-actions">
                <button
                  type="button"
                  className="btn small ghost"
                  disabled={!activePath}
                  onClick={() => void runDebug("start")}
                >
                  Launch
                </button>
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => void runDebug("continue")}
                >
                  Continue
                </button>
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => void runDebug("stepOver")}
                >
                  Step
                </button>
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => void runDebug("stepInto")}
                >
                  Step in
                </button>
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => void runDebug("stop")}
                >
                  Stop
                </button>
                <span className="hint">
                  {debug?.status ?? "idle"}
                  {debug?.program ? ` · ${debug.program}` : ""}
                </span>
              </div>
              {debug?.error ? <p className="hint">{debug.error}</p> : null}
              {debug?.stack.length ? (
                <ul className="workspace-problems" aria-label="Call stack">
                  {debug.stack.map((frame) => (
                    <li key={frame.id}>
                      <button
                        type="button"
                        onClick={() => {
                          const rel = frame.path.replace(/^file:\/\//, "");
                          const path = rel.includes("/workspace/")
                            ? rel.slice(rel.indexOf("/workspace/") + "/workspace/".length)
                            : activePath;
                          if (path) void openFile(path, frame.line);
                        }}
                      >
                        {frame.name} · {frame.line}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {debug?.variables.length ? (
                <ul className="workspace-debug-vars">
                  {debug.variables.map((row) => (
                    <li key={row.name}>
                      {row.name} = {row.value}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {fixes?.length ? (
            <ul className="workspace-problems" aria-label="Quick Fix">
              {fixes.map((action) => (
                <li key={action.title}>
                  <button type="button" onClick={() => applyFix(action)}>
                    {action.fixAll ? `Fix all · ${action.title}` : action.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {refs ? (
            <ul className="workspace-problems" aria-label="References">
              {refs.length ? (
                refs.map((item, i) => (
                  <li key={`${item.path}:${item.line}:${item.character}:${i}`}>
                    <button type="button" onClick={() => void openFile(item.path, item.line + 1)}>
                      {item.path}:{item.line + 1}
                    </button>
                  </li>
                ))
              ) : (
                <li>No references</li>
              )}
            </ul>
          ) : null}
          {nameForm ? (
            <form
              className="workspace-rename"
              onSubmit={(event) => {
                event.preventDefault();
                void submitNameForm();
              }}
            >
              <input
                className="workspace-find-replace"
                value={nameForm.value}
                aria-label={nameForm.kind === "path" ? "Rename path" : "Rename symbol"}
                autoFocus
                onChange={(event) =>
                  setNameForm((current) =>
                    current ? { ...current, value: event.target.value } : current,
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setNameForm(null);
                  }
                }}
              />
              <button type="submit" className="btn small">
                Rename
              </button>
              <button type="button" className="btn small ghost" onClick={() => setNameForm(null)}>
                Cancel
              </button>
            </form>
          ) : null}
          {findOpen && activePath && !isImage && !isPdf && !showPanePreview && !showDiff ? (
            <div className="workspace-find" role="search">
              <SearchField
                ref={findInput}
                className="workspace-find-input"
                wrapClassName="workspace-find-wrap"
                value={findQuery}
                placeholder="Find in file"
                aria-label="Find in file"
                onChange={(event) => {
                  setFindQuery(event.target.value);
                  setFindIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    jumpFind(event.shiftKey ? -1 : 1);
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setFindOpen(false);
                    editorPane.current?.focus();
                  }
                }}
              />
              <input
                className="workspace-find-replace"
                value={replaceQuery}
                placeholder="Replace"
                aria-label="Replace"
                onChange={(event) => setReplaceQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const start = findHits[findIndex];
                    if (start === undefined) return;
                    applyEdit(replaceMatch(content, start, findQuery.trim(), replaceQuery));
                  }
                }}
              />
              <span className="workspace-find-count">
                {findQuery.trim()
                  ? findHits.length
                    ? `${Math.min(findIndex, findHits.length - 1) + 1} of ${findHits.length}`
                    : "No matches"
                  : ""}
              </span>
              <button
                type="button"
                className="btn small ghost"
                disabled={!findHits.length}
                onClick={() => jumpFind(-1)}
              >
                Prev
              </button>
              <button
                type="button"
                className="btn small ghost"
                disabled={!findHits.length}
                onClick={() => jumpFind(1)}
              >
                Next
              </button>
              <button
                type="button"
                className="btn small ghost"
                disabled={!findHits.length}
                onClick={() =>
                  applyEdit(replaceAllMatches(content, findQuery.trim(), replaceQuery))
                }
              >
                All
              </button>
              <button
                type="button"
                className="btn icon ghost small"
                aria-label="Close find"
                onClick={() => setFindOpen(false)}
              >
                <IconClose />
              </button>
            </div>
          ) : null}
          {active &&
          (hasConflictMarkers(content) ||
            git?.files.some((row) => row.path === active.path && row.conflicted)) ? (
            <div className="workspace-conflict-bar" role="status">
              Merge conflict
              <button
                type="button"
                className="btn small ghost"
                onClick={() => void resolveConflicts("ours")}
              >
                Take ours
              </button>
              <button
                type="button"
                className="btn small ghost"
                onClick={() => void resolveConflicts("theirs")}
              >
                Take theirs
              </button>
            </div>
          ) : null}
          <div className="workspace-code-body" ref={codeBody}>
            {isImage && activePath ? (
              <div className="workspace-image">
                <img
                  alt={activePath.split("/").pop() ?? "Screenshot"}
                  src={api.workspaceRawUrl(sessionId, activePath)}
                />
              </div>
            ) : isPdf && activePath ? (
              <iframe
                className="workspace-pdf"
                title={activePath.split("/").pop() ?? "PDF"}
                src={api.workspaceRawUrl(sessionId, activePath)}
              />
            ) : showBrowser ? (
              <iframe
                ref={browserFrame}
                className="workspace-browser"
                title={activePath.split("/").pop() ?? "HTML"}
                sandbox={CANVAS_PREVIEW_SANDBOX}
                src={canvasFrameSrc()}
                data-srcdoc={content}
              />
            ) : showMarkdown ? (
              <div
                className="workspace-markdown pr-md"
                dangerouslySetInnerHTML={{ __html: formatMarkdown(content) || " " }}
                onClick={copyMarkdownFence}
              />
            ) : showSvg ? (
              <div className="workspace-svg workspace-image">
                <img alt={activePath.split("/").pop() ?? "SVG"} src={svgPreviewSrc(content)} />
              </div>
            ) : showDiff && diffRows ? (
              <DiffBody
                rows={diffRows}
                lang={lang}
                onRevertHunk={revertHunk}
                onAcceptHunk={acceptHunk}
                onAcceptAll={() => void acceptAllHunks()}
                onRejectAll={rejectAllHunks}
              />
            ) : (
              <>
                <div
                  className="workspace-editor-sizer"
                  aria-hidden
                  data-editor-sizer
                  style={{ height: editorScrollHeight(lineCount, wrapHeights) }}
                />
                <div
                  className={wrap ? "workspace-editor-window wrap" : "workspace-editor-window"}
                  style={{ tabSize }}
                >
                  {activePath ? (
                    <div
                      className={`workspace-gutter-col${blameLines.length ? " has-blame" : ""}`}
                      onClick={(e) => {
                        if (wrap && wrapHeights) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const line =
                          view.start +
                          Math.floor((e.clientY - rect.top - EDITOR_PAD_PX) / EDITOR_LINE_PX);
                        if (line >= 1 && line <= lineCount) void toggleBreakpoint(line);
                      }}
                    >
                      <div className="workspace-gutter-shift" ref={gutterShift} aria-hidden>
                        {wrap && wrapHeights ? (
                          <div className="workspace-gutter workspace-gutter-wrap">
                            {Array.from(
                              { length: Math.max(0, view.end - view.start + 1) },
                              (_, i) => {
                                const line = view.start + i;
                                if (line > lineCount) return null;
                                return (
                                  <span
                                    key={line}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void toggleBreakpoint(line);
                                    }}
                                    style={{
                                      top:
                                        EDITOR_PAD_PX +
                                        lineOffsetInView(line, view.start, wrapHeights),
                                    }}
                                  >
                                    {line}
                                  </span>
                                );
                              },
                            )}
                          </div>
                        ) : (
                          <pre className="workspace-gutter">{gutterText}</pre>
                        )}
                        {visibleMarks.length ? (
                          <div className="workspace-gutter-marks">
                            {visibleMarks.map((mark) => (
                              <span
                                key={`${mark.kind}:${mark.startLine}`}
                                className={`workspace-gutter-mark ${mark.kind}`}
                                data-gutter-mark={mark.kind}
                                style={{
                                  top:
                                    EDITOR_PAD_PX +
                                    lineOffsetInView(mark.startLine, view.start, wrapHeights),
                                  height:
                                    mark.kind === "del"
                                      ? 2
                                      : markHeightPx(mark.startLine, mark.lineCount, wrapHeights),
                                }}
                              />
                            ))}
                          </div>
                        ) : null}
                        {(debug?.breakpoints ?? []).some(
                          (bp) =>
                            bp.path === activePath && bp.line >= view.start && bp.line < view.end,
                        ) ? (
                          <div className="workspace-gutter-bps">
                            {(debug?.breakpoints ?? [])
                              .filter(
                                (bp) =>
                                  bp.path === activePath &&
                                  bp.line >= view.start &&
                                  bp.line < view.end,
                              )
                              .map((bp) => (
                                <span
                                  key={`${bp.path}:${bp.line}`}
                                  className="workspace-gutter-bp"
                                  title={`Breakpoint ${bp.path}:${bp.line}`}
                                  style={{
                                    top:
                                      EDITOR_PAD_PX +
                                      lineOffsetInView(bp.line, view.start, wrapHeights),
                                  }}
                                />
                              ))}
                          </div>
                        ) : null}
                        {visibleDiags.length ? (
                          <div className="workspace-gutter-diags">
                            {visibleDiags.map((diag, i) => (
                              <span
                                key={`${diag.startLine}:${diag.message}:${i}`}
                                className={`workspace-gutter-diag ${diag.severity}`}
                                title={diag.message}
                                style={{
                                  top:
                                    EDITOR_PAD_PX +
                                    lineOffsetInView(diag.startLine + 1, view.start, wrapHeights),
                                }}
                              />
                            ))}
                          </div>
                        ) : null}
                        {blameLines.length ? (
                          <div className="workspace-gutter-blame" aria-hidden>
                            {blameLines
                              .filter((row) => row.line >= view.start && row.line < view.end)
                              .map((row) => (
                                <span
                                  key={row.line}
                                  title={`${row.author} ${row.sha}`}
                                  style={{
                                    top:
                                      EDITOR_PAD_PX +
                                      lineOffsetInView(row.line, view.start, wrapHeights),
                                  }}
                                >
                                  {(row.author.split(" ")[0] ?? row.author).slice(0, 6)}
                                </span>
                              ))}
                          </div>
                        ) : null}
                        {prComments.some((row) => row.path === activePath) ? (
                          <div className="workspace-gutter-comments">
                            {prComments
                              .filter(
                                (row) =>
                                  row.path === activePath &&
                                  row.line >= view.start &&
                                  row.line <= view.end,
                              )
                              .map((row) => (
                                <button
                                  key={`${row.path}:${row.line}:${row.body.slice(0, 12)}`}
                                  type="button"
                                  className="workspace-gutter-comment"
                                  title={row.author ? `${row.author}: ${row.body}` : row.body}
                                  style={{
                                    top:
                                      EDITOR_PAD_PX +
                                      lineOffsetInView(row.line, view.start, wrapHeights),
                                  }}
                                  onClick={() => setOpenPrComment(row)}
                                >
                                  ●
                                </button>
                              ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <div className="workspace-code-main">
                    {activePath ? (
                      <pre
                        ref={highlightShift}
                        className="workspace-highlight"
                        aria-hidden
                        dangerouslySetInnerHTML={{ __html: overlay.html || " " }}
                      />
                    ) : null}
                    {activePath ? (
                      <div className="workspace-occurs" ref={occursShift} aria-hidden>
                        {occurs
                          .filter(
                            (row) =>
                              row.startLine + 1 >= view.start && row.startLine + 1 <= view.end,
                          )
                          .map((row, i) => {
                            const lineText = overlay.doc.lines[row.startLine] ?? "";
                            const vis = wrap
                              ? wrapVisualAt(
                                  lineText,
                                  row.startCharacter,
                                  wrapWidth,
                                  EDITOR_CHAR_PX,
                                  tabSize,
                                )
                              : { row: 0, col: row.startCharacter };
                            return (
                              <span
                                key={`${row.startLine}:${row.startCharacter}:${i}`}
                                className={`workspace-occur ${row.kind}`}
                                style={{
                                  top:
                                    EDITOR_PAD_PX +
                                    lineOffsetInView(row.startLine + 1, view.start, wrapHeights) +
                                    vis.row * EDITOR_LINE_PX,
                                  left: EDITOR_PAD_PX + vis.col * EDITOR_CHAR_PX,
                                  width: Math.max(
                                    6,
                                    Math.max(1, row.endCharacter - row.startCharacter) *
                                      EDITOR_CHAR_PX,
                                  ),
                                  height: EDITOR_LINE_PX,
                                }}
                              />
                            );
                          })}
                        {inlineAiSelectionMarks().map((rect, i) => (
                          <span
                            key={`inline-ai:${rect.top}:${rect.left}:${i}`}
                            className="workspace-occur inline-ai"
                            data-testid="editor-inline-ai-sel"
                            style={rect}
                          />
                        ))}
                      </div>
                    ) : null}
                    <textarea
                      ref={editorPane}
                      wrap={wrap ? "soft" : "off"}
                      value={content}
                      onChange={(e) => {
                        const next = e.target.value;
                        const prev = docsRef.current.find((doc) => doc.path === activePath);
                        const now = Date.now();
                        if (prev && prev.content !== next) {
                          editHistory.current.recordTyping(
                            {
                              path: activePath,
                              text: prev.content,
                              start: e.currentTarget.selectionStart,
                              end: e.currentTarget.selectionEnd,
                            },
                            activePath,
                            now,
                          );
                        }
                        setDocs((current) => {
                          const idx = current.findIndex((doc) => doc.path === activePath);
                          if (idx < 0) return current;
                          const doc = current[idx]!;
                          if (doc.content === next) return current;
                          const copy = current.slice();
                          copy[idx] = { ...doc, content: next };
                          return copy;
                        });
                        rememberCursor(e.currentTarget);
                        scheduleComplete(next, e.currentTarget.selectionStart, false);
                      }}
                      onSelect={(e) => rememberCursor(e.currentTarget)}
                      onClick={(e) => {
                        rememberCursor(e.currentTarget);
                        if (e.metaKey || e.ctrlKey) void gotoDefinition();
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        dismissHover();
                        setMenu(null);
                        placeEditorCaret(e.currentTarget, e.clientX, e.clientY, true);
                        setCtxMenu({
                          kind: "editor",
                          x: e.clientX,
                          y: e.clientY,
                          start: e.currentTarget.selectionStart,
                          end: e.currentTarget.selectionEnd,
                        });
                      }}
                      onMouseMove={(e) => {
                        if (typeof api.workspaceInspect !== "function" || !activePath) return;
                        const body = codeBody.current;
                        const host = e.currentTarget.parentElement;
                        if (!body || !host) return;
                        const movedFar =
                          !hover ||
                          Math.abs(e.clientX - hover.originX) > HOVER_MOVE_PX ||
                          Math.abs(e.clientY - hover.originY) > HOVER_MOVE_PX;
                        if (hover && movedFar) {
                          hoverSeq.current += 1;
                          setHover(null);
                        }
                        if (!movedFar) return;
                        const bodyRect = body.getBoundingClientRect();
                        const y = e.clientY - bodyRect.top + body.scrollTop - EDITOR_PAD_PX;
                        const line = Math.max(0, Math.floor(y / EDITOR_LINE_PX));
                        const x =
                          e.clientX -
                          bodyRect.left +
                          body.scrollLeft -
                          EDITOR_PAD_PX -
                          EDITOR_GUTTER_PX;
                        const character = Math.max(0, Math.floor(x / EDITOR_CHAR_PX));
                        const originX = e.clientX;
                        const originY = e.clientY;
                        const path = activePath;
                        const text = content;
                        window.clearTimeout(hoverTimer.current);
                        hoverTimer.current = window.setTimeout(() => {
                          const seq = (hoverSeq.current += 1);
                          void api
                            .workspaceInspect(sessionId, {
                              path,
                              content: text,
                              line,
                              character,
                            })
                            .then((res) => {
                              if (seq !== hoverSeq.current) return;
                              if (!res.hover?.text) {
                                setHover(null);
                                return;
                              }
                              const liveBody = codeBody.current ?? body;
                              const pos = hoverPopupPos(
                                res.hover.startLine ?? line,
                                res.hover.startCharacter ?? character,
                                liveBody.scrollTop,
                                liveBody.scrollLeft,
                              );
                              setHover({
                                text: res.hover.text,
                                left: pos.left,
                                top: pos.top,
                                above: pos.above,
                                originX,
                                originY,
                              });
                            })
                            .catch(() => {
                              if (seq !== hoverSeq.current) return;
                              setHover(null);
                            });
                        }, 280);
                      }}
                      onMouseLeave={dismissHover}
                      onMouseOut={dismissHover}
                      onKeyDown={onEditorKey}
                      spellCheck={false}
                      disabled={!activePath}
                      placeholder="Open a file, or press Ctrl/Cmd+P"
                    />
                    {menu ? (
                      <ul
                        className="workspace-complete"
                        role="listbox"
                        aria-label="Completions"
                        style={{ left: menu.left, top: menu.top }}
                      >
                        {menu.items.map((item, i) => (
                          <li key={`${item.kind}:${item.label}:${i}`}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={i === menu.index}
                              className={`workspace-complete-item ${i === menu.index ? "on" : ""}`}
                              onMouseDown={(event) => {
                                event.preventDefault();
                                applyMenuItem(item);
                              }}
                            >
                              <span className="workspace-complete-kind">{item.kind}</span>
                              <span className="workspace-complete-label">{item.label}</span>
                              {item.detail ? (
                                <span className="workspace-complete-detail">{item.detail}</span>
                              ) : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {hover ? (
                      <pre
                        className={`workspace-hover${hover.above ? " above" : ""}`}
                        style={{ left: hover.left, top: hover.top }}
                      >
                        {hover.text}
                      </pre>
                    ) : null}
                    {inlineAi ? (
                      <EditorInlineAi
                        ref={inlineAiShift}
                        top={inlineAiAnchorTop(
                          offsetToLineCol(content, Math.max(inlineAi.start, inlineAi.end)).line,
                          view.start,
                          wrapHeights,
                        )}
                        hasSelection={inlineAi.end > inlineAi.start}
                        busy={inlineAi.busy}
                        error={inlineAi.error}
                        onClose={closeInlineAi}
                        onSubmit={(prompt, mode) => void submitInlineAi(prompt, mode)}
                      />
                    ) : null}
                    {openPrComment ? (
                      <div
                        className="workspace-pr-comment"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Review comment"
                        ref={prCommentRef}
                      >
                        {openPrComment.author ? <strong>{openPrComment.author}</strong> : null}
                        <p>{openPrComment.body}</p>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => setOpenPrComment(null)}
                        >
                          Close
                        </button>
                      </div>
                    ) : null}
                    {signature ? (
                      <div
                        className="workspace-signature"
                        style={{ left: signature.left, top: signature.top }}
                      >
                        <code>{signature.help.label}</code>
                        {signature.help.parameters[signature.help.activeParameter]
                          ?.documentation ? (
                          <p>
                            {
                              signature.help.parameters[signature.help.activeParameter]
                                ?.documentation
                            }
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <EditorMinimap
                    hostRef={codeBody}
                    text={content}
                    lineCount={Math.max(1, content.split("\n").length)}
                    binary={Boolean(isImage || isPdf)}
                    enabled={showMinimap}
                  />
                </div>
              </>
            )}
          </div>
        </div>
        <div
          className="workspace-status"
          aria-label="Editor status"
          style={split ? { gridArea: "stat" } : undefined}
        >
          <div className="workspace-status-start">
            <span className="workspace-status-path" title={activePath || undefined}>
              {activePath || "Open a file to edit"}
            </span>
            {activePath ? (
              <span
                className="workspace-status-cursor"
                title={`Line ${cursor.line}, column ${cursor.col}`}
              >
                Ln {cursor.line}, Col {cursor.col}
              </span>
            ) : null}
            {project.label ? (
              <span className="workspace-status-project" data-project={project.kind}>
                {project.label}
              </span>
            ) : null}
            {activePath ? (
              <span className="workspace-status-indent">
                {indent === "\t" ? "Tabs" : `Spaces: ${indent.length}`}
              </span>
            ) : null}
          </div>
          <div className="workspace-status-end">
            {runHint ? (
              <button
                type="button"
                className="workspace-run-hint workspace-status-run"
                title="Run this command in the workspace terminal"
                onClick={() => requestWorkspaceTerminalRun(runHint)}
              >
                {runHint}
              </button>
            ) : null}
            {indexing ? (
              <span
                className="workspace-status-indexing"
                title="Workspace index for Go to file and chat"
              >
                {indexScanned > 0 ? `Indexing ${indexScanned.toLocaleString()}` : "Indexing…"}
              </span>
            ) : (
              <button
                type="button"
                className="workspace-status-index"
                title="Re-index workspace for Go to file and chat"
                aria-label="Re-index workspace"
                disabled={!treeReady}
                onClick={() => void reindex()}
              >
                {indexCount != null ? (
                  <>
                    <span className="workspace-status-index-prefix">Indexed </span>
                    {indexCount.toLocaleString()}
                  </>
                ) : (
                  "Index workspace"
                )}
              </button>
            )}
            {git?.branch ? (
              <button
                type="button"
                className="workspace-status-index workspace-status-git"
                title={`Git status: ${git.branch}`}
                onClick={() => {
                  setMode("git");
                  void loadGit();
                }}
              >
                {git.branch}
                {git.ahead ? ` ↑${git.ahead}` : ""}
                {git.behind ? ` ↓${git.behind}` : ""}
              </button>
            ) : null}
            {pylspMissing && /\.py$/.test(activePath) ? (
              <span
                className="workspace-status-pylsp"
                title="Install python-lsp-server for completions and Go to Definition"
              >
                Install python-lsp-server
              </span>
            ) : null}
            {blame ? (
              <span className="workspace-status-blame" title={`git blame: ${blame}`}>
                {blame}
              </span>
            ) : null}
            <button
              type="button"
              className="workspace-status-index workspace-status-debug"
              aria-pressed={debugOpen}
              title="Debugger (gutter click toggles breakpoints)"
              onClick={() => setDebugOpen((open) => !open)}
            >
              Debug{debug && debug.status !== "idle" ? ` · ${debug.status}` : ""}
            </button>
            {allProblems.length || diagnostics.length ? (
              <button
                type="button"
                className="workspace-status-index workspace-status-errors"
                aria-pressed={problemsOpen}
                onClick={() => setProblemsOpen((open) => !open)}
              >
                {
                  (allProblems.length ? allProblems : diagnostics).filter(
                    (row) => row.severity === "error",
                  ).length
                }{" "}
                errors
              </button>
            ) : null}
          </div>
          <OverflowMenu
            className="workspace-status-more"
            title="Editor commands"
            align="right"
            prefer="up"
            toggleClassName="workspace-status-index"
            label={<IconMore />}
          >
            <MenuItem onClick={() => requestWorkspaceGoto()}>
              Go to file
              <span>Ctrl+P</span>
            </MenuItem>
            <MenuItem onClick={() => requestWorkspaceGotoSymbol()}>
              Go to symbol
              <span>Ctrl+T</span>
            </MenuItem>
            <MenuItem onClick={() => requestWorkspaceSearch()}>
              Search in files
              <span>Ctrl+Shift+F</span>
            </MenuItem>
            <MenuItem onClick={() => requestWorkspaceSplit()}>
              Split editor
              <span>Ctrl+\</span>
            </MenuItem>
            {onPromoted ? (
              <MenuItem disabled={promoting} onClick={() => void promoteFolder()}>
                {promoting
                  ? "Promoting…"
                  : store?.state.dockerKind === "docker"
                    ? "Promote to Docker"
                    : "Promote to Host"}
              </MenuItem>
            ) : null}
          </OverflowMenu>
        </div>
        {dockerInspect ? (
          <div
            className="workspace-docker-inspect"
            role="region"
            aria-label={`Inspect ${dockerInspect.name}`}
          >
            <div className="workspace-docker-inspect-head">
              <strong>Inspect · {dockerInspect.name}</strong>
              <button
                type="button"
                className="btn icon ghost"
                title="Close inspect"
                aria-label="Close inspect"
                onClick={() => setDockerInspect(null)}
              >
                <IconClose />
              </button>
            </div>
            <dl className="workspace-docker-inspect-meta">
              <div>
                <dt>Image</dt>
                <dd>{dockerInspect.image || "—"}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{dockerStatusLabel(dockerInspect)}</dd>
              </div>
              <div>
                <dt>Id</dt>
                <dd>{dockerInspect.containerId || dockerInspect.id}</dd>
              </div>
              {dockerInspect.sessionTitle ? (
                <div>
                  <dt>Agent</dt>
                  <dd>{dockerInspect.sessionTitle}</dd>
                </div>
              ) : null}
              {dockerInspectStats.stats ? (
                <div>
                  <dt>Resources</dt>
                  <dd>
                    CPU {dockerInspectStats.stats.cpuPercent.toFixed(1)}% ·{" "}
                    {dockerInspectStats.stats.memoryUsage} / {dockerInspectStats.stats.memoryLimit}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}
      </div>
      {ctxMenu
        ? createPortal(
            <>
              <div
                ref={ctxMenuNode}
                className="workspace-ctx"
                style={{ left: ctxPlace?.left ?? ctxMenu.x, top: ctxPlace?.top ?? ctxMenu.y }}
                role="menu"
                aria-label={ctxMenu.kind === "editor" ? "Editor" : "Explorer"}
              >
                {ctxMenu.kind === "explorer" ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        const dir = ctxMenu.dir
                          ? ctxMenu.path
                          : ctxMenu.path.split("/").slice(0, -1).join("/");
                        setCtxMenu(null);
                        void createFile(dir);
                      }}
                    >
                      New file
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        const dir = ctxMenu.dir
                          ? ctxMenu.path
                          : ctxMenu.path.split("/").slice(0, -1).join("/");
                        setCtxMenu(null);
                        void createFolder(dir);
                      }}
                    >
                      New folder
                    </button>
                    {!ctxMenu.dir ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          const path = ctxMenu.path;
                          setCtxMenu(null);
                          void openToSide(path);
                        }}
                      >
                        Open to the side
                      </button>
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        const path = ctxMenu.path;
                        setCtxMenu(null);
                        setNameForm({ kind: "path", value: path, from: path });
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        const path = ctxMenu.path;
                        setCtxMenu(null);
                        void removePath(path);
                      }}
                    >
                      Delete
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runEditorAction(() => void gotoDefinition())}
                    >
                      Go to Definition
                      <span className="workspace-ctx-keys">F12</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runEditorAction(() => void gotoTypeDefinition())}
                    >
                      Go to Type Definition
                      <span className="workspace-ctx-keys">Alt+F12</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runEditorAction(() => void gotoImplementation())}
                    >
                      Go to Implementation
                      <span className="workspace-ctx-keys">Ctrl+F12</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runEditorAction(() => void findReferences())}
                    >
                      Find All References
                      <span className="workspace-ctx-keys">Shift+F12</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runEditorAction(() => void renameSymbol())}
                    >
                      Rename Symbol
                      <span className="workspace-ctx-keys">F2</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runEditorAction(() => void requestFixes())}
                    >
                      Quick Fix
                      <span className="workspace-ctx-keys">Ctrl+.</span>
                    </button>
                    <span className="workspace-ctx-sep" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runEditorAction(() => void formatActive())}
                    >
                      Format Document
                      <span className="workspace-ctx-keys">Shift+Alt+F</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runEditorAction(() => void organizeActive())}
                    >
                      Organize Imports
                      <span className="workspace-ctx-keys">Shift+Alt+O</span>
                    </button>
                    <span className="workspace-ctx-sep" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runEditorAction(() => void editorCut())}
                    >
                      Cut
                      <span className="workspace-ctx-keys">Ctrl+X</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runEditorAction(() => void editorCopy())}
                    >
                      Copy
                      <span className="workspace-ctx-keys">Ctrl+C</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runEditorAction(() => void editorPaste())}
                    >
                      Paste
                      <span className="workspace-ctx-keys">Ctrl+V</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runEditorAction(editorSelectAll)}
                    >
                      Select All
                      <span className="workspace-ctx-keys">Ctrl+A</span>
                    </button>
                  </>
                )}
              </div>
              <button
                type="button"
                className="workspace-ctx-backdrop"
                aria-label="Dismiss menu"
                onClick={() => setCtxMenu(null)}
              />
            </>,
            document.body,
          )
        : null}
      <WorkspaceQuickOpen
        sessionId={sessionId}
        open={quickOpen || symbolOpen}
        mode={symbolOpen ? "symbol" : "file"}
        onClose={() => {
          setQuickOpen(false);
          setSymbolOpen(false);
        }}
        onOpen={(path, line) => void openFile(path, line)}
      />
      <WorkspaceFileSearch
        sessionId={sessionId}
        open={fileSearch}
        onClose={() => setFileSearch(false)}
        onOpen={(path, line) => void openFile(path, line)}
      />
    </div>
  );
});
