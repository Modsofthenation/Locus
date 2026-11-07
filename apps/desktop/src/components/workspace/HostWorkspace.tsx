import { useEffect, useRef, useState } from "react";
import { useStore } from "@/state/store";
import { useDeferredCollapse } from "@/lib/useDeferredCollapse";
import { api } from "@/lib/api";
import { useWorkspaceFullscreen } from "@/lib/useWorkspaceFullscreen";
import { IconChevron, IconFolder, IconPanelRight, IconPlus } from "@/components/layout/Icons";
import { AgentCanvasPane, useAgentCanvasFocus, useAgentCanvasOpen } from "./AgentCanvasPane";
import { WorkspaceEditor } from "./WorkspaceEditor";
import { WorkspaceFullscreenButton } from "./WorkspaceFullscreenButton";
import { BrowserPane } from "@/components/guest/BrowserPane";
import {
  WorkspaceTerminal,
  WORKSPACE_TERMINAL_EVENT,
  WORKSPACE_TERMINAL_NEW_EVENT,
  WORKSPACE_TERMINAL_RUN_EVENT,
  restoreIdeTypingFocus,
} from "./WorkspaceTerminal";
import {
  HOST_TERM_SPLIT_DEFAULT,
  HOST_TERM_SPLIT_KEY,
  TermGutter,
  useTermSplit,
} from "./TermSplit";

export const HOST_TERM_COLLAPSED_KEY = "locus.hostTermCollapsed";

type TermTab = { id: number; cwd?: string; run?: string };
type PreviewStatus = { ports: number[]; active?: { port: number; path: string; url: string } };

export function loadHostTermCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(HOST_TERM_COLLAPSED_KEY);
    if (raw == null || raw.trim() === "") return true;
    return raw === "1" || raw === "true";
  } catch {
    return true;
  }
}

function saveHostTermCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(HOST_TERM_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}

export function HostWorkspace(props: { embedded?: boolean } = {}) {
  const { state, dispatch } = useStore();
  const showRail = useDeferredCollapse(state.vmCollapsed) && !props.embedded;
  const filesFs = useWorkspaceFullscreen();
  const session = state.sessions.find((s) => s.id === state.selectedId);
  const sessionId = session?.id;
  const workspaceOpen = state.workspaceOpen;
  const ide = state.section === "ide";
  const [termCollapsed, setTermCollapsed] = useState(() => loadHostTermCollapsed());
  const [termStarted, setTermStarted] = useState(() => !loadHostTermCollapsed());
  const termSplit = useTermSplit(HOST_TERM_SPLIT_KEY, HOST_TERM_SPLIT_DEFAULT, termCollapsed);
  const [terms, setTerms] = useState<TermTab[]>([{ id: 1 }]);
  const [activeTerm, setActiveTerm] = useState(1);
  const nextTerm = useRef(2);
  const [previewOn, setPreviewOn] = useState(false);
  const [preview, setPreview] = useState<PreviewStatus>({ ports: [] });
  const [view, setView] = useState<"files" | "browser" | "canvas">("files");
  const canvasFocus = useAgentCanvasFocus(sessionId, session?.agentCanvases);
  const termWasExpanded = useRef(!termCollapsed);

  useEffect(() => {
    saveHostTermCollapsed(termCollapsed);
  }, [termCollapsed]);

  useEffect(() => {
    const collapsing = termCollapsed && termWasExpanded.current;
    termWasExpanded.current = !termCollapsed;
    if (collapsing) restoreIdeTypingFocus();
  }, [termCollapsed]);

  useEffect(() => {
    if (!termCollapsed) setTermStarted(true);
  }, [termCollapsed]);

  useEffect(() => {
    setTerms([{ id: 1 }]);
    setActiveTerm(1);
    nextTerm.current = 2;
    setPreviewOn(false);
    setPreview({ ports: [] });
    setView("files");
  }, [sessionId]);

  useAgentCanvasOpen(canvasFocus, () => {
    setPreviewOn(false);
    setView("canvas");
    if (state.vmCollapsed) dispatch({ type: "showVmPane" });
  });

  useEffect(() => {
    if (!sessionId) return;
    const previewId = sessionId;
    let cancelled = false;
    async function tick() {
      try {
        const next = await api.sessionPreview(previewId);
        if (!cancelled) setPreview(next);
      } catch {
        if (!cancelled) setPreview({ ports: [] });
      }
    }
    void tick();
    const id = setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sessionId]);

  useEffect(() => {
    function addTerm(partial?: Partial<TermTab>) {
      const id = nextTerm.current;
      nextTerm.current += 1;
      setTerms((current) => [...current, { id, ...partial }]);
      setActiveTerm(id);
      setTermCollapsed(false);
    }
    function onKey(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta || event.altKey || event.shiftKey) return;
      if (event.key !== "`" && event.key !== "Backquote") return;
      if (document.querySelector(".modal")) return;
      event.preventDefault();
      setTermCollapsed((current) => !current);
    }
    function onToggle() {
      setTermCollapsed((current) => !current);
    }
    function onNew() {
      addTerm();
    }
    function onRun(event: Event) {
      const command = (event as CustomEvent<{ command?: string }>).detail?.command;
      addTerm(command ? { run: command } : undefined);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(WORKSPACE_TERMINAL_EVENT, onToggle);
    window.addEventListener(WORKSPACE_TERMINAL_NEW_EVENT, onNew);
    window.addEventListener(WORKSPACE_TERMINAL_RUN_EVENT, onRun);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(WORKSPACE_TERMINAL_EVENT, onToggle);
      window.removeEventListener(WORKSPACE_TERMINAL_NEW_EVENT, onNew);
      window.removeEventListener(WORKSPACE_TERMINAL_RUN_EVENT, onRun);
    };
  }, []);

  if (!sessionId) return null;
  if (!ide && showRail) {
    return (
      <aside className="vm-pane rail">
        <button
          type="button"
          className="vm-rail-toggle"
          title="Files"
          onClick={() => dispatch({ type: "toggleVmPane" })}
        >
          <IconFolder />
          <span className="vm-rail-label">Files</span>
        </button>
      </aside>
    );
  }

  const active = preview.active;
  const showingBrowser = view === "browser";
  const showingPreview = previewOn && Boolean(active) && view === "files";

  return (
    <aside
      className={`vm-pane host-workspace${showingPreview || showingBrowser ? " preview-pane" : ""}${filesFs.className ? ` ${filesFs.className}` : ""}`}
    >
      <div className="vm-toolbar docker-ide">
        <div className="docker-ide-tabs">
          <button
            type="button"
            className={`btn small ghost ${view === "files" ? "on" : ""}`}
            aria-pressed={view === "files"}
            onClick={() => setView("files")}
          >
            Files
          </button>
          <button
            type="button"
            className={`btn small ghost ${showingBrowser ? "on" : ""}`}
            aria-pressed={showingBrowser}
            title="Isolated Chrome the agent drives (not your real profile)"
            onClick={() => {
              setView((current) => (current === "browser" ? "files" : "browser"));
              setPreviewOn(false);
            }}
          >
            Browser
          </button>
          {session?.agentCanvases?.length ? (
            <button
              type="button"
              className={`btn small ghost ${view === "canvas" ? "on" : ""}`}
              aria-pressed={view === "canvas"}
              title="Canvas the agent built beside this chat"
              onClick={() => {
                setPreviewOn(false);
                setView("canvas");
              }}
            >
              Canvas
            </button>
          ) : null}
          <button
            type="button"
            className={`btn small ghost ${termCollapsed ? "" : "on"}`}
            aria-pressed={!termCollapsed}
            title="Terminal"
            onClick={() => setTermCollapsed((current) => !current)}
          >
            Terminal
          </button>
          <button
            type="button"
            className="btn small ghost"
            title="Hide preview, browser, and terminal"
            onClick={() => {
              setView("files");
              setPreviewOn(false);
              setTermCollapsed(true);
            }}
          >
            Focus editor
          </button>
          <button
            type="button"
            className={`btn small ghost ${previewOn ? "on" : ""}`}
            aria-pressed={previewOn}
            title="Preview"
            disabled={!active}
            onClick={() => {
              setView("files");
              setPreviewOn((on) => !on);
            }}
          >
            Preview{active ? ` :${active.port}` : ""}
          </button>
        </div>
        <div className="vm-toolbar-actions">
          {showingPreview && preview.ports.length > 1 ? (
            <select
              className="preview-port"
              aria-label="Preview port"
              value={active?.port}
              onChange={(e) => {
                const port = Number(e.target.value);
                if (!sessionId || !Number.isInteger(port)) return;
                void api
                  .patchSession(sessionId, { preview: { port, path: active?.path } })
                  .then((updated) => {
                    dispatch({ type: "session", session: updated });
                  });
              }}
            >
              {preview.ports.map((port) => (
                <option key={port} value={port}>
                  :{port}
                </option>
              ))}
            </select>
          ) : null}
          <WorkspaceFullscreenButton
            isFullscreen={filesFs.isFullscreen}
            onToggle={filesFs.toggle}
          />
          {ide || filesFs.isFullscreen ? null : (
            <button
              type="button"
              className="btn icon ghost"
              title="Collapse files"
              onClick={() => dispatch({ type: "toggleVmPane" })}
            >
              <IconPanelRight />
            </button>
          )}
        </div>
      </div>
      <div
        ref={termSplit.root}
        className={`desktop docker-desktop has-editor has-term${termCollapsed ? " term-collapsed" : ""}${showingPreview || showingBrowser || view === "canvas" ? " has-preview" : ""}${view === "canvas" ? " has-canvas" : ""}${termSplit.dragging ? " term-resizing" : ""}`}
        style={{ gridTemplateRows: termSplit.gridTemplateRows }}
      >
        <div className="host-workspace-main">
          <div className="workspace-editor-slot">
            <WorkspaceEditor
              sessionId={sessionId}
              openPath={workspaceOpen?.path}
              openLine={workspaceOpen?.line}
              openAt={workspaceOpen?.at}
              follow={workspaceOpen?.follow}
              onOpened={() => dispatch({ type: "openWorkspace", open: null })}
              onAskAgent={(text) => dispatch({ type: "compose", text })}
              onFocusPath={(path) => dispatch({ type: "workspaceFocus", sessionId, path })}
              onPromoted={(next) => {
                dispatch({ type: "session", session: next });
                dispatch({ type: "select", id: next.id });
              }}
              onOpenPull={(info) => {
                dispatch({ type: "selectRepo", id: info.repoId });
                dispatch({ type: "selectPull", number: info.number });
              }}
            />
          </div>
          {view === "canvas" && sessionId && session?.agentCanvases?.length ? (
            <div className="design-stage docker-preview-stage host-preview agent-canvas-host">
              <AgentCanvasPane
                sessionId={sessionId}
                canvases={session.agentCanvases}
                focus={canvasFocus}
              />
            </div>
          ) : null}
          {showingBrowser && sessionId ? (
            <div className="design-stage docker-preview-stage host-preview">
              <BrowserPane
                sessionId={sessionId}
                overlay={state.overlay}
                browserControl={session.browserControl}
              />
            </div>
          ) : showingPreview && active ? (
            <div className="design-stage docker-preview-stage host-preview">
              <iframe
                title={`Host preview :${active.port}`}
                sandbox="allow-scripts allow-forms allow-modals"
                src={api.previewHttpUrl(sessionId, active.port, active.path)}
              />
            </div>
          ) : null}
        </div>
        <TermGutter
          collapsed={termCollapsed}
          frac={termSplit.frac}
          onPointerDown={termSplit.onGutterDown}
          onKeyDown={termSplit.onGutterKey}
        />
        <div className={`term docker-term host-term${termCollapsed ? " collapsed" : ""}`}>
          <div
            className="term-tabs"
            onPointerDown={termCollapsed ? undefined : termSplit.onHandleDown}
          >
            {terms.map((tab, index) => (
              <button
                key={tab.id}
                type="button"
                className={tab.id === activeTerm ? "active" : ""}
                aria-pressed={tab.id === activeTerm}
                onClick={() => setActiveTerm(tab.id)}
              >
                {index === 0 ? "Terminal" : `Term ${index + 1}`}
                {index > 0 ? (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Close term ${index + 1}`}
                    title="Close"
                    onClick={(event) => {
                      event.stopPropagation();
                      setTerms((current) => {
                        const next = current.filter((row) => row.id !== tab.id);
                        if (tab.id === activeTerm) {
                          const fallback = next[Math.max(0, index - 1)] ?? next[0];
                          if (fallback) setActiveTerm(fallback.id);
                        }
                        return next.length ? next : current;
                      });
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      event.stopPropagation();
                      (event.currentTarget as HTMLSpanElement).click();
                    }}
                  >
                    ×
                  </span>
                ) : null}
              </button>
            ))}
            <button
              type="button"
              className="btn icon ghost small"
              title="New terminal"
              aria-label="New terminal"
              onClick={() => {
                const id = nextTerm.current;
                nextTerm.current += 1;
                setTerms((current) => [...current, { id }]);
                setActiveTerm(id);
                setTermCollapsed(false);
              }}
            >
              <IconPlus />
            </button>
            <span className="hint">Ctrl/Cmd+`</span>
            <button
              type="button"
              className="term-collapse"
              title={termCollapsed ? "Expand terminal" : "Collapse terminal"}
              aria-label={termCollapsed ? "Expand terminal" : "Collapse terminal"}
              aria-expanded={!termCollapsed}
              onClick={() => setTermCollapsed((current) => !current)}
            >
              <IconChevron expanded={!termCollapsed} />
            </button>
          </div>
          {termStarted
            ? terms.map((tab) => (
                <div
                  key={tab.id}
                  className="host-term-pane"
                  hidden={termCollapsed || tab.id !== activeTerm}
                >
                  <WorkspaceTerminal
                    sessionId={sessionId}
                    terminalId={String(tab.id)}
                    cwd={tab.cwd}
                    run={tab.run}
                    active={!termCollapsed && tab.id === activeTerm}
                  />
                </div>
              ))
            : null}
        </div>
      </div>
    </aside>
  );
}
