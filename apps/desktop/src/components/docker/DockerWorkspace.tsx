import { useEffect, useRef, useState } from "react";
import {
  DESIGN_VIEWPORTS,
  isGuestReady,
  isGuestStarting,
  isImageBuildWaiting,
  isDockerBrowserActivity,
  pickSelector,
  sessionPlacement,
  sessionRuntime,
  configuredToolsForRuntime,
  type DesignViewport,
} from "@locus/shared";
import { api, type ShareFile } from "@/lib/api";
import { defaultGoldenName, promptGoldenName } from "@/lib/goldenName";
import { useStore } from "@/state/store";
import { useDeferredCollapse } from "@/lib/useDeferredCollapse";
import { useWorkspaceFullscreen } from "@/lib/useWorkspaceFullscreen";
import { dockerRuntimeLabel } from "@/lib/workspaceTree";
import { IconChevron, IconFolder, IconPanelRight } from "@/components/layout/Icons";
import { MenuItem, OverflowMenu } from "@/components/layout/OverflowMenu";
import { Select } from "@/components/layout/Select";
import { ExpandableLog } from "@/components/chat/ExpandableLog";
import { GuestTimeline, TimelinePreviewLayer } from "@/components/chat/GuestTimeline";
import {
  AgentCanvasPane,
  useAgentCanvasFocus,
  useAgentCanvasOpen,
} from "@/components/workspace/AgentCanvasPane";
import { WorkspaceEditor } from "@/components/workspace/WorkspaceEditor";
import { WorkspaceFullscreenButton } from "@/components/workspace/WorkspaceFullscreenButton";
import { BrowserPane } from "@/components/guest/BrowserPane";
import { DockerStatsPanel, useDockerStats } from "./DockerStatsPanel";
import {
  DOCKER_TERM_SPLIT_DEFAULT,
  DOCKER_TERM_SPLIT_KEY,
  TermGutter,
  useTermSplit,
} from "@/components/workspace/TermSplit";

const VIEWPORTS: Array<{ id: DesignViewport; label: string; width: number }> = DESIGN_VIEWPORTS.map(
  (id) => ({
    id,
    label: id === "desktop" ? "Desktop" : id === "tablet" ? "Tablet" : "Phone",
    width: id === "desktop" ? 1280 : id === "tablet" ? 768 : 390,
  }),
);

type PreviewStatus = { ports: number[]; active?: { port: number; path: string; url: string } };

export const DOCKER_TERM_COLLAPSED_KEY = "locus.dockerTermCollapsed";

function loadDockerTermCollapsed(): boolean {
  try {
    return localStorage.getItem(DOCKER_TERM_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveDockerTermCollapsed(value: boolean) {
  try {
    localStorage.setItem(DOCKER_TERM_COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function DockerWorkspace() {
  const { state, dispatch } = useStore();
  const showRail = useDeferredCollapse(state.vmCollapsed);
  const filesFs = useWorkspaceFullscreen();
  const session = state.sessions.find((s) => s.id === state.selectedId);
  const vm =
    state.vms.find((v) => v.id === session?.vmId) ??
    state.vms.find((v) => v.sessionId === session?.id);
  const [line, setLine] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [fileCount, setFileCount] = useState(0);
  const [termTab, setTermTab] = useState<"shell" | "logs" | "stats">("shell");
  const [termCollapsed, setTermCollapsed] = useState(() => loadDockerTermCollapsed());
  const termSplit = useTermSplit(DOCKER_TERM_SPLIT_KEY, DOCKER_TERM_SPLIT_DEFAULT, termCollapsed);
  const [bootLog, setBootLog] = useState("");
  const [shareFiles, setShareFiles] = useState<ShareFile[]>([]);
  const [savingImage, setSavingImage] = useState(false);
  const [preview, setPreview] = useState<PreviewStatus>({ ports: [] });
  const [viewport, setViewport] = useState<DesignViewport>("desktop");
  const [view, setView] = useState<"files" | "browser" | "canvas">("files");
  const canvasFocus = useAgentCanvasFocus(session?.id, session?.agentCanvases);
  const [commenting, setCommenting] = useState(false);
  const operatorPickedView = useRef(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const logsOff = useRef(false);
  const logPane = useRef<HTMLDivElement>(null);
  const sessionId = session?.id;

  useEffect(() => {
    setPreview({ ports: [] });
    setViewport("desktop");
    setView("files");
    setCommenting(false);
    operatorPickedView.current = false;
    setFileCount(0);
    setLog([]);
  }, [sessionId]);

  useAgentCanvasOpen(canvasFocus, () => {
    operatorPickedView.current = true;
    setView("canvas");
    if (state.vmCollapsed) dispatch({ type: "showVmPane" });
  });

  async function run(command: string) {
    if (!sessionId) return;
    try {
      const result = await api.execTool(sessionId, "exec", { command });
      setLog((rows) => [...rows, `$ ${command}`, result.output].slice(-80));
    } catch (err) {
      setLog((rows) => [...rows, `error: ${err instanceof Error ? err.message : "failed"}`]);
    }
  }

  useEffect(() => {
    logsOff.current = false;
    setBootLog("");
  }, [vm?.id]);

  useEffect(() => {
    saveDockerTermCollapsed(termCollapsed);
  }, [termCollapsed]);

  function showTermTab(tab: "shell" | "logs" | "stats") {
    logsOff.current = tab !== "logs";
    setTermTab(tab);
    setTermCollapsed(false);
  }

  useEffect(() => {
    if (logsOff.current) return;
    if (vm && isGuestStarting(vm.status)) setTermTab("logs");
  }, [vm?.id, vm?.status]);

  useEffect(() => {
    if (!sessionId || termCollapsed) return;
    if (isGuestReady(vm?.status)) {
      if (termTab !== "logs") return;
    } else if (!isGuestStarting(vm?.status)) {
      return;
    }
    let cancelled = false;
    async function tick() {
      if (!sessionId) return;
      try {
        const { text } = await api.vmLogs(sessionId);
        if (!cancelled) setBootLog(text);
      } catch {
        /* ignore */
      }
    }
    void tick();
    const id = setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [termTab, termCollapsed, sessionId, vm?.status]);

  const statsId = vm?.id ?? sessionId;
  const { stats, error: statsError } = useDockerStats(
    statsId,
    termTab === "stats" && !termCollapsed && isGuestReady(vm?.status),
  );

  useEffect(() => {
    logPane.current?.scrollTo?.(0, logPane.current.scrollHeight);
  }, [bootLog, log]);

  useEffect(() => {
    let cancelled = false;
    void api
      .shareFiles(sessionId)
      .then(({ files }) => {
        if (!cancelled) setShareFiles(files);
      })
      .catch(() => {
        if (!cancelled) setShareFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    if (!isGuestReady(vm?.status)) {
      setPreview({ ports: [] });
      return;
    }
    let cancelled = false;
    async function tick() {
      if (!sessionId) return;
      try {
        const next = await api.sessionPreview(sessionId);
        if (!cancelled) setPreview(next);
      } catch {
        if (!cancelled) setPreview({ ports: [] });
      }
    }
    void tick();
    const id = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sessionId, session?.preview?.port, session?.messages.length, vm?.status]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!commenting || !sessionId) return;
      if (frame.current?.contentWindow && event.source !== frame.current.contentWindow) return;
      const data = event.data as {
        type?: string;
        tag?: string;
        text?: string;
        id?: string;
        className?: string;
      };
      if (data?.type !== "locus-design-pick" || typeof data.tag !== "string") return;
      void api
        .designComment(sessionId, {
          selector: pickSelector({ tag: data.tag, id: data.id, className: data.className }),
          text: data.text || undefined,
          viewport,
        })
        .then((updated) => {
          dispatch({ type: "session", session: updated });
          setCommenting(false);
        })
        .catch(() => undefined);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [commenting, dispatch, sessionId, viewport]);

  useEffect(() => {
    const overlay = state.overlay;
    if (!overlay || overlay.sessionId !== sessionId) return;
    if (operatorPickedView.current) return;
    if (!isDockerBrowserActivity(overlay.name)) return;
    setView("browser");
  }, [state.overlay, sessionId]);

  const workspaceOpen =
    sessionId && state.workspaceOpen?.sessionId === sessionId ? state.workspaceOpen : null;

  useEffect(() => {
    if (!workspaceOpen?.follow) return;
    if (!operatorPickedView.current || view === "files") setView("files");
  }, [workspaceOpen, view]);

  if (!session || sessionRuntime(session) !== "docker") return null;
  const tools = configuredToolsForRuntime(session.os, "docker", state.config?.integrations);
  const vmStatus = vm?.status ?? "stopped";
  const image = session.dockerImage ?? vm?.dockerImage ?? "container";
  const guestReady = isGuestReady(vm?.status);
  const starting = isGuestStarting(vm?.status);
  const building = isImageBuildWaiting(state.imageProgress[session.id]);
  const active = preview.active;
  const live = Boolean(active) && guestReady;
  const width = VIEWPORTS.find((item) => item.id === viewport)?.width ?? 1280;
  const showingCanvas = view === "canvas" && Boolean(session.agentCanvases?.length);
  const showingBrowser = guestReady && view === "browser";
  const showingFiles = guestReady && !showingBrowser && !showingCanvas;
  const showingPreview = guestReady && live && !showingBrowser && !showingCanvas;
  const showTerm = guestReady || starting;

  if (showRail) {
    return (
      <aside className="vm-pane rail">
        <button
          type="button"
          className="vm-rail-toggle"
          title="Expand container"
          onClick={() => dispatch({ type: "toggleVmPane" })}
        >
          <IconPanelRight />
          <span
            className={`dot ${vmStatus === "running" || vmStatus === "ready" ? "idle" : vmStatus}`}
          />
          <span className="vm-rail-label">Docker</span>
        </button>
      </aside>
    );
  }

  const runtime = dockerRuntimeLabel(image);
  const filesTab = (
    <button
      type="button"
      className={`btn small ghost ${showingFiles ? "on" : ""}`}
      aria-pressed={showingFiles}
      title="Host editor for the bind-mounted /workspace"
      onClick={() => {
        operatorPickedView.current = true;
        setCommenting(false);
        setView("files");
      }}
    >
      Files
    </button>
  );
  const previewTab = live ? (
    <button
      type="button"
      className={`btn small ghost ${showingPreview ? "on" : ""}`}
      aria-pressed={showingPreview}
      title="Live app preview stacked under Files"
      onClick={() => {
        operatorPickedView.current = true;
        setCommenting(false);
        setView("files");
      }}
    >
      Preview
    </button>
  ) : null;
  const canvasTab = session.agentCanvases?.length ? (
    <button
      type="button"
      className={`btn small ghost ${showingCanvas ? "on" : ""}`}
      aria-pressed={showingCanvas}
      title="Canvas the agent built beside this chat"
      onClick={() => {
        operatorPickedView.current = true;
        setCommenting(false);
        setView("canvas");
      }}
    >
      Canvas
    </button>
  ) : null;
  const browserTab = guestReady ? (
    <button
      type="button"
      className={`btn small ghost ${showingBrowser ? "on" : ""}`}
      aria-pressed={showingBrowser}
      title="Guest Chromium the agent drives"
      onClick={() => {
        operatorPickedView.current = true;
        setCommenting(false);
        setView("browser");
      }}
    >
      Browser
    </button>
  ) : null;
  const toolsMenu = (
    <OverflowMenu label="Tools" title="Container tools" toggleClassName="btn ghost small">
      {tools.map((t) => (
        <MenuItem key={t.name} disabled>
          {t.name}
        </MenuItem>
      ))}
      <MenuItem
        disabled={!vm || savingImage}
        onClick={() => {
          if (!sessionId) return;
          void (async () => {
            const name = await promptGoldenName(defaultGoldenName(session.title, "workspace"));
            if (!name) return;
            setSavingImage(true);
            void api
              .captureImage(sessionId, name)
              .then(() => setLog((rows) => [...rows, `saved ${name}`].slice(-80)))
              .finally(() => setSavingImage(false));
          })();
        }}
      >
        {savingImage ? "Saving image…" : "Save workspace image"}
      </MenuItem>
    </OverflowMenu>
  );

  return (
    <aside
      className={`vm-pane docker-ide ${showingPreview || showingBrowser ? "preview-pane" : ""}${filesFs.className ? ` ${filesFs.className}` : ""}`}
    >
      <div className="vm-toolbar">
        <span className="vm-status">
          {showingFiles ? (
            <>
              <IconFolder />
              <span className="docker-crumb">
                <strong>Workspace</strong>
                <span>docker</span>
                <span className="docker-crumb-path">/workspace</span>
                {live ? <span className="docker-crumb-path">:{active?.port}</span> : null}
              </span>
            </>
          ) : showingBrowser ? (
            <>
              <span
                className={`dot ${vmStatus === "running" || vmStatus === "ready" ? "idle" : vmStatus}`}
              />
              <span className="vm-status-copy">
                <strong>Browser</strong>
                <span className="meta">guest Chromium</span>
              </span>
            </>
          ) : (
            <>
              <span
                className={`dot ${vmStatus === "running" || vmStatus === "ready" ? "idle" : vmStatus}`}
              />
              <span className="vm-status-copy">
                <strong>{live ? `Preview :${active?.port}` : image}</strong>
                <span className="meta">
                  {live ? active?.path || "/" : vm ? vmStatus : "no container"}
                </span>
              </span>
            </>
          )}
        </span>
        <div className="docker-ide-tabs">
          {canvasTab}
          {guestReady ? (
            <>
              {filesTab}
              {previewTab}
              {browserTab}
              {toolsMenu}
            </>
          ) : null}
        </div>
        <div className="vm-toolbar-actions">
          {showingPreview ? (
            <>
              {preview.ports.length > 1 ? (
                <Select
                  className="preview-port"
                  compact
                  ariaLabel="Preview port"
                  value={String(active?.port ?? "")}
                  options={preview.ports.map((port) => ({
                    value: String(port),
                    label: `:${port}`,
                  }))}
                  onChange={(value) => {
                    const port = Number(value);
                    if (!sessionId || !Number.isInteger(port)) return;
                    void api
                      .patchSession(sessionId, { preview: { port, path: active?.path } })
                      .then((updated) => {
                        dispatch({ type: "session", session: updated });
                      });
                  }}
                />
              ) : null}
              <div className="viewport-toggle" role="group" aria-label="Viewport">
                {VIEWPORTS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`btn small ghost ${viewport === item.id ? "on" : ""}`}
                    aria-pressed={viewport === item.id}
                    onClick={() => setViewport(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={`btn small ghost ${commenting ? "on" : ""}`}
                aria-pressed={commenting}
                title="Click an element, then describe the change in chat"
                onClick={() => setCommenting((v) => !v)}
              >
                Comment
              </button>
            </>
          ) : null}
          {showingFiles ? (
            <span className="docker-ide-meta">
              {fileCount.toLocaleString()} file{fileCount === 1 ? "" : "s"}
              {runtime ? ` / ${runtime}` : ""}
            </span>
          ) : null}
          {guestReady ? (
            <OverflowMenu
              label={
                <span className="icon-badge-wrap">
                  <IconFolder />
                  {shareFiles.length > 0 && <span className="icon-badge">{shareFiles.length}</span>}
                </span>
              }
              title="Host files"
              toggleClassName="btn icon ghost"
              wide
            >
              <div className="share-pop">
                <div className="share-head">
                  Host share
                  <span className="meta">Mounted read-only at /mnt/host when Docker is real</span>
                </div>
                {shareFiles.length === 0 ? (
                  <p className="hint">
                    No files yet. Workspace is /workspace inside the container.
                  </p>
                ) : (
                  shareFiles.map((file) => (
                    <div key={file.name} className="share-row">
                      <span>
                        <span className="title-text">{file.name}</span>
                        <span className="meta">{file.guestPath}</span>
                      </span>
                      <a
                        className="btn small ghost"
                        href={api.shareFileUrl(file.name)}
                        download={file.name}
                      >
                        Download
                      </a>
                    </div>
                  ))
                )}
              </div>
            </OverflowMenu>
          ) : null}
          {showingFiles ? (
            <WorkspaceFullscreenButton
              isFullscreen={filesFs.isFullscreen}
              onToggle={filesFs.toggle}
            />
          ) : null}
          {filesFs.isFullscreen ? null : (
            <button
              type="button"
              className="btn icon ghost"
              title="Collapse container"
              onClick={() => dispatch({ type: "toggleVmPane" })}
            >
              <IconPanelRight />
            </button>
          )}
        </div>
      </div>
      <div
        ref={termSplit.root}
        className={`docker-term-split${showTerm && termCollapsed ? " term-collapsed" : ""}${showTerm && termSplit.dragging ? " term-resizing" : ""}`}
        style={{
          gridTemplateRows: showTerm ? termSplit.gridTemplateRows : "minmax(0, 1fr)",
        }}
      >
        <div className="docker-term-main">
          <GuestTimeline session={session}>
            <div
              className={`desktop docker-desktop ${showingPreview ? "has-preview" : ""} ${showingFiles ? "has-editor" : ""} ${showingBrowser ? "has-browser" : ""} ${showingCanvas ? "has-canvas" : ""}`}
            >
              {sessionId ? (
                <div className="workspace-editor-slot" hidden={!showingFiles}>
                  <WorkspaceEditor
                    sessionId={sessionId}
                    onFileCount={setFileCount}
                    visible={showingFiles}
                    remote={sessionPlacement(session) === "worker"}
                    openPath={showingFiles ? workspaceOpen?.path : undefined}
                    openLine={showingFiles ? workspaceOpen?.line : undefined}
                    openAt={showingFiles ? workspaceOpen?.at : undefined}
                    follow={showingFiles ? workspaceOpen?.follow : undefined}
                    onOpened={() => dispatch({ type: "openWorkspace", open: null })}
                    onAskAgent={(text) => dispatch({ type: "compose", text })}
                    onFocusPath={(path) => dispatch({ type: "workspaceFocus", sessionId, path })}
                    onOpenPull={(info) => {
                      dispatch({ type: "selectRepo", id: info.repoId });
                      dispatch({ type: "selectPull", number: info.number });
                    }}
                  />
                </div>
              ) : null}
              {showingCanvas && sessionId && session.agentCanvases ? (
                <div className="design-stage docker-preview-stage agent-canvas-host">
                  <AgentCanvasPane
                    sessionId={sessionId}
                    canvases={session.agentCanvases}
                    focus={canvasFocus}
                  />
                </div>
              ) : null}
              {showingBrowser && sessionId ? (
                <BrowserPane
                  sessionId={sessionId}
                  overlay={state.overlay}
                  browserControl={session.browserControl}
                />
              ) : null}
              {showingPreview && active ? (
                <div
                  className={`design-stage docker-preview-stage ${commenting ? "commenting" : ""}`}
                >
                  <div
                    className="design-frame"
                    data-viewport={viewport}
                    style={{ width: Math.min(width, 1600) }}
                  >
                    <iframe
                      ref={frame}
                      key={`${active.port}-${commenting ? "pick" : "view"}`}
                      title={`App preview :${active.port}`}
                      sandbox="allow-scripts allow-forms allow-modals"
                      src={`${api.previewHttpUrl(session.id, active.port, active.path)}${commenting ? "?locus_pick=1" : ""}`}
                    />
                  </div>
                </div>
              ) : null}
              {!showingBrowser && !showingFiles && !showingPreview && !showingCanvas ? (
                <>
                  <div className="wallpaper" />
                  <div className="chrome">
                    <h3>{vm ? vm.name : "Container offline"}</h3>
                    <div className="spec">
                      {`IMAGE ${image}`}
                      {vm?.containerId ? `\nCONTAINER ${vm.containerId}` : ""}
                      {session.repo ? `\nREPO ${session.repo.url}` : "\nREPO none"}
                      {`\nWORKSPACE /workspace`}
                    </div>
                    <p className="scrim-note">
                      {building
                        ? "Building the agent image (first start). This can take several minutes — live docker output is in Logs."
                        : starting
                          ? "Container is starting. Boot logs show below. Preview and the shell appear once it is up."
                          : guestReady
                            ? "Start a web app on 0.0.0.0 (vite, next, python -m http.server). Listening ports show here as a live preview."
                            : "Start the container to use preview, the shell, and container tools."}
                    </p>
                  </div>
                </>
              ) : null}
              <TimelinePreviewLayer />
            </div>
          </GuestTimeline>
        </div>
        {showTerm ? (
          <>
            <TermGutter
              collapsed={termCollapsed}
              frac={termSplit.frac}
              onPointerDown={termSplit.onGutterDown}
              onKeyDown={termSplit.onGutterKey}
            />
            <div className={`term docker-term${termCollapsed ? " collapsed" : ""}`}>
              <div
                className="term-tabs"
                onPointerDown={termCollapsed ? undefined : termSplit.onHandleDown}
              >
                {guestReady ? (
                  <button
                    type="button"
                    className={termTab === "shell" ? "active" : ""}
                    aria-pressed={termTab === "shell"}
                    onClick={() => showTermTab("shell")}
                  >
                    SHELL
                  </button>
                ) : null}
                <button
                  type="button"
                  className={termTab === "logs" || !guestReady ? "active" : ""}
                  aria-pressed={termTab === "logs" || !guestReady}
                  onClick={() => showTermTab("logs")}
                >
                  LOGS
                </button>
                {guestReady ? (
                  <>
                    <span className="hint">
                      {termTab === "stats"
                        ? "CPU, memory, and I/O from docker stats"
                        : termTab === "shell"
                          ? "turn 1 • runs in container, not on host."
                          : "commands run inside the container, not on your host"}
                    </span>
                    <button
                      type="button"
                      className={`tab-end ${termTab === "stats" ? "active" : ""}`}
                      aria-pressed={termTab === "stats"}
                      onClick={() => showTermTab("stats")}
                    >
                      STATS
                    </button>
                  </>
                ) : (
                  <span className="hint">container start log</span>
                )}
                <button
                  type="button"
                  className="term-collapse"
                  title={termCollapsed ? "Expand shell" : "Collapse shell"}
                  aria-label={termCollapsed ? "Expand shell" : "Collapse shell"}
                  aria-expanded={!termCollapsed}
                  onClick={() => setTermCollapsed((value) => !value)}
                >
                  <IconChevron expanded={!termCollapsed} />
                </button>
              </div>
              {termCollapsed ? null : termTab === "logs" || !guestReady ? (
                <div className="term-log" ref={logPane}>
                  <ExpandableLog text={bootLog || "No container logs yet."} />
                </div>
              ) : termTab === "stats" ? (
                <DockerStatsPanel stats={stats} error={statsError} />
              ) : (
                <div className="term-log" ref={logPane}>
                  {log.map((row, i) => (
                    <ShellRow key={`${i}-${row.slice(0, 12)}`} row={row} />
                  ))}
                  <form
                    className="term-input"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const command = line.trim();
                      if (!command) return;
                      setLine("");
                      void run(command);
                    }}
                  >
                    <span className="term-cwd">-&gt; /workspace</span>
                    <input
                      value={line}
                      onChange={(e) => setLine(e.target.value)}
                      aria-label="Container command"
                      disabled={!vm || (vm.status !== "running" && vm.status !== "ready")}
                    />
                  </form>
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}

function ShellRow({ row }: { row: string }) {
  if (row.startsWith("$ ")) {
    return (
      <pre className="term-cmd">
        <span className="prompt">$</span> {row.slice(2)}
      </pre>
    );
  }
  const ok = /✓|\bpassed\b/i.test(row);
  return (
    <pre className={ok ? "term-ok" : row.startsWith("error:") ? "term-err" : undefined}>{row}</pre>
  );
}
