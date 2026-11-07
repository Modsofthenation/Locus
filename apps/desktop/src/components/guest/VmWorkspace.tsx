import { useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import {
  guestLabel,
  isGuestReady,
  isHumanDriving,
  isWindows,
  latestGoldenImage,
  partitionBootLog,
  sessionRuntime,
  toolsForOs,
  integrationReady,
  type GoldenImage,
} from "@locus/shared";
import { api, terminalWsUrl, type ShareFile } from "@/lib/api";
import { fitPty } from "@/lib/ptyFit";
import { defaultGoldenName, promptGoldenName } from "@/lib/goldenName";
import { pullGuestClipboard, pushGuestClipboard } from "@/lib/clipboard";
import { sshConnectCommand } from "@/lib/guestConnect";
import { scaleClick } from "@/lib/pointer";
import { useStore } from "@/state/store";
import { useDeferredCollapse } from "@/lib/useDeferredCollapse";
import {
  IconClipboard,
  IconClose,
  IconCopy,
  IconFolder,
  IconMore,
  IconPanelRight,
} from "@/components/layout/Icons";
import { MenuItem, MenuSep, OverflowMenu } from "@/components/layout/OverflowMenu";
import { VncPane } from "./VncPane";
import { DesktopOverlay } from "@/components/layout/DesktopOverlay";
import { ExpandableLog } from "@/components/chat/ExpandableLog";
import { DockerWorkspace } from "@/components/docker/DockerWorkspace";
import { GuestTimeline, TimelinePreviewLayer } from "@/components/chat/GuestTimeline";
import {
  AgentCanvasPane,
  useAgentCanvasFocus,
  useAgentCanvasOpen,
} from "@/components/workspace/AgentCanvasPane";
import { WorkspaceEditor } from "@/components/workspace/WorkspaceEditor";
import { WorkspaceFullscreenButton } from "@/components/workspace/WorkspaceFullscreenButton";
import { useWorkspaceFullscreen } from "@/lib/useWorkspaceFullscreen";

const VNC_STATUSES = new Set(["booting", "installing", "ready", "running", "paused"]);

export function VmWorkspace(props: { embedded?: boolean } = {}) {
  const { state, dispatch } = useStore();
  const showRail = useDeferredCollapse(state.vmCollapsed) && !props.embedded;
  const filesFs = useWorkspaceFullscreen();
  const session = state.sessions.find((s) => s.id === state.selectedId);
  const [view, setView] = useState<"desktop" | "files" | "preview" | "canvas">("desktop");
  const canvasFocus = useAgentCanvasFocus(session?.id, session?.agentCanvases);
  const [fileCount, setFileCount] = useState(0);
  const vm =
    state.vms.find((v) => v.id === session?.vmId) ??
    state.vms.find((v) => v.sessionId === session?.id);
  const [line, setLine] = useState("");
  const [log, setLog] = useState<string[]>([
    "Guest terminal — commands run inside the VM, not on your host.",
  ]);
  const [shot, setShot] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [vncFailed, setVncFailed] = useState(false);
  const [pty, setPty] = useState(false);
  const [savingImage, setSavingImage] = useState(false);
  const [images, setImages] = useState<GoldenImage[]>([]);
  const [dismissSaveHint, setDismissSaveHint] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const capturedImage = useRef(false);
  const [copied, setCopied] = useState(false);
  const [clipNote, setClipNote] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [bootLog, setBootLog] = useState("");
  const [shareFiles, setShareFiles] = useState<ShareFile[]>([]);
  const liveOff = useRef(false);
  const ptyOff = useRef(false);
  const logsOff = useRef(false);
  const logPane = useRef<HTMLDivElement>(null);
  const sessionId = session?.id;
  const os = session?.os;
  const workspaceOpen =
    sessionId && state.workspaceOpen?.sessionId === sessionId ? state.workspaceOpen : null;
  const driving = Boolean(session && isHumanDriving(session));
  const useVnc =
    live &&
    state.hypervisorKind === "qemu" &&
    !vncFailed &&
    Boolean(vm?.id) &&
    VNC_STATUSES.has(vm?.status ?? "");

  async function run(name: string, args: Record<string, unknown>, quiet = false) {
    if (!sessionId) return null;
    try {
      const result = await api.execTool(sessionId, name, args);
      if (!quiet) setLog((rows) => [...rows, `$ ${name}`, result.output].slice(-80));
      if (result.screenshotBase64) setShot(result.screenshotBase64);
      return result;
    } catch (err) {
      if (!quiet)
        setLog((rows) => [...rows, `error: ${err instanceof Error ? err.message : "failed"}`]);
      return null;
    }
  }

  useEffect(() => {
    if (!live || !sessionId || useVnc) return;
    let cancelled = false;
    async function tick() {
      if (cancelled || !sessionId) return;
      await run("screenshot", {}, true);
    }
    void tick();
    const id = setInterval(() => void tick(), 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [live, sessionId, useVnc]);

  useEffect(() => {
    setVncFailed(false);
  }, [vm?.id, live]);

  useEffect(() => {
    liveOff.current = false;
    ptyOff.current = false;
    logsOff.current = false;
    setBootLog("");
  }, [vm?.id]);

  useEffect(() => {
    if (liveOff.current) return;
    if (vm && VNC_STATUSES.has(vm.status)) setLive(true);
    if (!vm || vm.status === "stopped" || vm.status === "error") setLive(false);
  }, [vm?.id, vm?.status]);

  useEffect(() => {
    if (ptyOff.current) return;
    if (vm && (vm.status === "running" || vm.status === "ready")) setPty(true);
    if (!vm || vm.status === "stopped" || vm.status === "error") setPty(false);
  }, [vm?.id, vm?.status]);

  useEffect(() => {
    if (logsOff.current) return;
    if (vm && (vm.status === "creating" || vm.status === "booting" || vm.status === "installing")) {
      setShowLogs(true);
    }
  }, [vm?.id, vm?.status]);

  useEffect(() => {
    if (!showLogs || !sessionId) return;
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
  }, [showLogs, sessionId]);

  useEffect(() => {
    logPane.current?.scrollTo(0, logPane.current.scrollHeight);
  }, [bootLog]);

  useEffect(() => {
    setView("desktop");
    setFileCount(0);
  }, [sessionId]);

  useEffect(() => {
    if (!workspaceOpen?.follow) return;
    setView("files");
  }, [workspaceOpen]);

  useEffect(() => {
    setDismissSaveHint(false);
    setSaveError(null);
    capturedImage.current = false;
    let cancelled = false;
    void api
      .images()
      .then((rows) => {
        if (!cancelled && !capturedImage.current) setImages(rows);
      })
      .catch(() => {
        if (!cancelled && !capturedImage.current) setImages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

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

  useAgentCanvasOpen(canvasFocus, () => {
    setView("canvas");
    if (state.vmCollapsed) dispatch({ type: "showVmPane" });
  });

  if (!session || !os) return null;
  if (sessionRuntime(session) === "docker") return <DockerWorkspace />;
  const tools = toolsForOs(os).filter((t) => integrationReady(t.name, state.config?.integrations));
  const hasGolden = Boolean(latestGoldenImage(images, os));
  const suggestGolden =
    !dismissSaveHint &&
    !session.imageId &&
    !hasGolden &&
    (vm?.status === "running" || vm?.status === "ready");

  async function saveImage() {
    if (!sessionId) return;
    const name = promptGoldenName(defaultGoldenName(session?.title));
    if (!name) return;
    setSavingImage(true);
    setSaveError(null);
    try {
      const image = await api.captureImage(sessionId, name);
      capturedImage.current = true;
      setImages((rows) => [image, ...rows.filter((row) => row.id !== image.id)]);
      setLog((rows) =>
        [...rows, "saved golden image — new agents will boot a copy by default"].slice(-80),
      );
      setDismissSaveHint(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "save failed";
      setSaveError(message);
      setLog((rows) => [...rows, `error: ${message}`].slice(-80));
    } finally {
      setSavingImage(false);
    }
  }

  function submit() {
    if (!line.trim()) return;
    const command = line;
    setLine("");
    void run(os && isWindows(os) ? "powershell" : "exec", { command });
  }

  function onDesktopClick(ev: React.MouseEvent<HTMLImageElement>) {
    const rect = ev.currentTarget.getBoundingClientRect();
    const { x, y } = scaleClick(ev.clientX, ev.clientY, rect, { width: 1920, height: 1080 });
    void (async () => {
      await run("mouse_move", { x, y }, true);
      await run("mouse_click", { button: 1, x, y });
    })();
  }

  async function copySsh() {
    if (!vm?.ssh) return;
    await navigator.clipboard.writeText(sshConnectCommand(vm.ssh));
    setCopied(true);
    flashClip("SSH copied");
    setTimeout(() => setCopied(false), 1500);
  }

  function flashClip(note: string) {
    setClipNote(note);
    setTimeout(() => setClipNote(null), 1500);
  }

  async function copyFromGuest() {
    try {
      await pullGuestClipboard(
        (name, args) => run(name, args, true),
        (text) => navigator.clipboard.writeText(text),
      );
      flashClip("Copied");
    } catch (err) {
      setLog((rows) =>
        [...rows, `clipboard: ${err instanceof Error ? err.message : "copy failed"}`].slice(-80),
      );
    }
  }

  async function pasteToGuest() {
    try {
      await pushGuestClipboard(
        () => navigator.clipboard.readText(),
        (name, args) => run(name, args, true),
      );
      flashClip("Pasted");
    } catch (err) {
      setLog((rows) =>
        [...rows, `clipboard: ${err instanceof Error ? err.message : "paste failed"}`].slice(-80),
      );
    }
  }

  async function onDropFiles(files: FileList | File[]) {
    for (const file of [...files]) {
      try {
        const result = await api.uploadShare(file, sessionId);
        setLog((rows) => [...rows, `dropped ${file.name} → ${result.guestPath}`].slice(-80));
      } catch (err) {
        setLog((rows) =>
          [...rows, `drop failed: ${err instanceof Error ? err.message : "upload failed"}`].slice(
            -80,
          ),
        );
      }
    }
    await refreshShare();
  }

  async function refreshShare() {
    try {
      const { files } = await api.shareFiles(sessionId);
      setShareFiles(files);
    } catch {
      setShareFiles([]);
    }
  }

  const vmStatus = vm?.status ?? "stopped";
  const machineLabel = driving ? "driving" : vm ? vmStatus : "no machine";

  if (showRail) {
    return (
      <aside className="vm-pane rail">
        <button
          type="button"
          className="vm-rail-toggle"
          title="Expand guest"
          onClick={() => dispatch({ type: "toggleVmPane" })}
        >
          <IconPanelRight />
          <span className={`dot ${statusDot(vm ? vmStatus : undefined)}`} />
          <span className="vm-rail-label">{os ? guestLabel(os) : "Guest"}</span>
        </button>
      </aside>
    );
  }

  const showingCanvas = view === "canvas" && Boolean(session.agentCanvases?.length);
  const showingFiles = view === "files";
  const showingPreview = view === "preview";
  const guestReady = isGuestReady(vm?.status);

  return (
    <aside
      className={`vm-pane${showingFiles || showingPreview ? " docker-ide" : ""}${filesFs.className ? ` ${filesFs.className}` : ""}`}
    >
      <div className="vm-toolbar">
        <span className="vm-status">
          {showingFiles ? (
            <>
              <IconFolder />
              <span className="docker-crumb">
                <strong>Workspace</strong>
                <span>vm</span>
                <span className="docker-crumb-path">
                  {guestReady ? "guest SSH" : "vm-trees mirror"}
                </span>
              </span>
            </>
          ) : (
            <>
              <span className={`dot ${statusDot(vm ? vmStatus : undefined)}`} />
              <span className="vm-status-copy">
                <strong>{showingPreview ? "Preview" : os ? guestLabel(os) : "Guest"}</strong>
                <span className="meta">
                  {showingPreview ? "not a mapped host port" : machineLabel}
                </span>
              </span>
            </>
          )}
        </span>
        <div className="docker-ide-tabs">
          <button
            type="button"
            className={`btn small ghost ${showingFiles ? "on" : ""}`}
            aria-pressed={showingFiles}
            title="Guest files over SSH when ready, otherwise the laptop vm-trees mirror"
            onClick={() => setView("files")}
          >
            Files
          </button>
          <button
            type="button"
            className={`btn small ghost ${showingPreview ? "on" : ""}`}
            aria-pressed={showingPreview}
            title="QEMU guests do not publish mapped host ports like Docker"
            onClick={() => setView("preview")}
          >
            Preview
          </button>
          {session.agentCanvases?.length ? (
            <button
              type="button"
              className={`btn small ghost ${showingCanvas ? "on" : ""}`}
              aria-pressed={showingCanvas}
              title="Canvas the agent built beside this chat"
              onClick={() => setView("canvas")}
            >
              Canvas
            </button>
          ) : null}
          <button
            type="button"
            className={`btn small ghost ${view === "desktop" ? "on" : ""}`}
            aria-pressed={view === "desktop"}
            title="Live guest desktop"
            onClick={() => setView("desktop")}
          >
            Desktop
          </button>
        </div>
        <div className="vm-toolbar-actions">
          {view === "desktop" ? (
            <button
              type="button"
              className={`btn chip ${live ? "on" : ""}`}
              aria-pressed={live}
              title={live ? "Stop live display" : "Start live display"}
              onClick={() =>
                setLive((v) => {
                  const next = !v;
                  liveOff.current = !next;
                  return next;
                })
              }
            >
              <span className={`live-dot ${live ? "on" : ""}`} />
              Live
            </button>
          ) : null}
          {view === "desktop" ? <span className="toolbar-split" /> : null}
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
            onOpen={() => void refreshShare()}
          >
            <div className="share-pop">
              <div className="share-head">
                Host share
                <span className="meta">
                  {os && isWindows(os)
                    ? "Windows guests see these at C:\\host"
                    : "Linux guests see these at /mnt/host"}
                </span>
              </div>
              {shareFiles.length === 0 ? (
                <p className="hint">No files yet. Drop onto the desktop to copy them in.</p>
              ) : (
                shareFiles.map((file) => (
                  <div key={file.name} className="share-row">
                    <span>
                      <span className="title-text">{file.name}</span>
                      <span className="meta">
                        {formatSize(file.size)} · {file.guestPath}
                      </span>
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
          <span className="btn-group">
            <button
              type="button"
              className="btn icon ghost"
              title="Copy from guest"
              disabled={!sessionId}
              onClick={() => void copyFromGuest()}
            >
              <IconCopy />
            </button>
            <button
              type="button"
              className="btn icon ghost"
              title="Paste into guest"
              disabled={!sessionId}
              onClick={() => void pasteToGuest()}
            >
              <IconClipboard />
            </button>
          </span>
          <OverflowMenu label={<IconMore />} title="Guest actions" toggleClassName="btn icon ghost">
            <MenuItem onClick={() => void run("screenshot", {})}>Capture desktop</MenuItem>
            <MenuItem disabled={!vm || savingImage} onClick={() => void saveImage()}>
              {savingImage ? "Saving image…" : "Save golden image"}
            </MenuItem>
            <MenuSep />
            <MenuItem
              disabled={!vm}
              onClick={() =>
                setPty((v) => {
                  const next = !v;
                  ptyOff.current = !next;
                  return next;
                })
              }
            >
              {pty ? "Use command box" : "Use SSH terminal"}
            </MenuItem>
            <MenuItem disabled={!vm?.ssh} onClick={() => void copySsh()}>
              {copied ? "SSH copied" : "Copy SSH"}
            </MenuItem>
          </OverflowMenu>
          {showingFiles ? (
            <span className="docker-ide-meta">
              {fileCount.toLocaleString()} file{fileCount === 1 ? "" : "s"}
            </span>
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
              title="Collapse guest"
              onClick={() => dispatch({ type: "toggleVmPane" })}
            >
              <IconPanelRight />
            </button>
          )}
        </div>
      </div>
      <GuestTimeline session={session}>
        <div
          className={`desktop ${dropping ? "drop-target" : ""} ${showingFiles ? "docker-desktop has-editor" : ""} ${showingPreview ? "docker-desktop" : ""} ${showingCanvas ? "docker-desktop has-canvas" : ""}`}
          data-testid="desktop-pane"
          onDragEnter={(e) => {
            e.preventDefault();
            setDropping(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropping(false);
            void onDropFiles(e.dataTransfer.files);
          }}
        >
          {showingCanvas && sessionId && session.agentCanvases ? (
            <div className="agent-canvas-host">
              <AgentCanvasPane
                sessionId={sessionId}
                canvases={session.agentCanvases}
                focus={canvasFocus}
              />
            </div>
          ) : showingFiles && sessionId ? (
            <div className="workspace-editor-slot vm-files-slot">
              <p className="hint vm-files-banner">
                {guestReady
                  ? "Files read the guest over SSH. The laptop vm-trees copy can lag if SSH is down."
                  : "The guest is not ready, so Files shows the laptop vm-trees mirror (it can lag). Start the machine for live SSH."}{" "}
                Live Preview and parallel workers stay Docker/Host.
              </p>
              <WorkspaceEditor
                sessionId={sessionId}
                onFileCount={setFileCount}
                visible={showingFiles}
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
          ) : showingPreview ? (
            <>
              <div className="wallpaper" />
              <div className="chrome">
                <h3>No mapped preview port</h3>
                <div className="spec">
                  {`GUEST ${os ? guestLabel(os) : "VM"}`}
                  {vm?.ssh ? `\nSSH ${vm.ssh.username}@${vm.ssh.host}:${vm.ssh.port}` : ""}
                </div>
                <p className="scrim-note">
                  Docker and Host agents scan listening ports and show them here. QEMU guests do not
                  publish mapped host ports — open the app on the live desktop, or SSH in.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="wallpaper" />
              {driving ? (
                <div className="golden-toast">
                  <span>
                    You&apos;re driving the guest. Use the live desktop, then send a chat message to
                    hand it back.
                  </span>
                  <button
                    type="button"
                    className="btn small primary"
                    onClick={() => sessionId && void api.handback(sessionId)}
                  >
                    Hand back
                  </button>
                </div>
              ) : suggestGolden ? (
                <div className="golden-toast">
                  <span>
                    {saveError
                      ? `Could not save the golden image. ${saveError}`
                      : `Save a golden image to skip the next ${guestLabel(os)} install.`}
                  </span>
                  <span className="row">
                    <button
                      type="button"
                      className="btn small primary"
                      disabled={savingImage}
                      onClick={() => void saveImage()}
                    >
                      {savingImage ? "Saving…" : saveError ? "Retry" : "Save"}
                    </button>
                    <button
                      type="button"
                      className="btn icon ghost"
                      title="Dismiss"
                      aria-label="Dismiss"
                      onClick={() => setDismissSaveHint(true)}
                    >
                      <IconClose />
                    </button>
                  </span>
                </div>
              ) : null}
              {useVnc && vm ? (
                <VncPane vmId={vm.id} onFail={() => setVncFailed(true)} />
              ) : shot ? (
                <img
                  alt="Guest desktop"
                  src={`data:image/png;base64,${shot}`}
                  onClick={onDesktopClick}
                  style={{
                    position: "absolute",
                    inset: 12,
                    width: "calc(100% - 24px)",
                    height: "calc(100% - 24px)",
                    objectFit: "contain",
                    borderRadius: 10,
                    cursor: "crosshair",
                  }}
                />
              ) : (
                <div className="chrome">
                  <h3>{vm ? vm.name : "Machine offline"}</h3>
                  <div className="spec">
                    {vm?.display
                      ? `${vm.display.protocol.toUpperCase()} ${vm.display.host}:${vm.display.port}`
                      : "Attach an ISO or cloud image in Settings → Machines, then start."}
                    {vm?.ssh ? `\nSSH ${vm.ssh.username}@${vm.ssh.host}:${vm.ssh.port}` : ""}
                    {vm?.rdp ? `\nRDP ${vm.rdp.username}@${vm.rdp.host}:${vm.rdp.port}` : ""}
                    {session.repo ? `\nREPO ${session.repo.url}` : "\nREPO none"}
                    {`\nTOOLS ${tools
                      .map((t) => t.name)
                      .slice(0, 8)
                      .join(" · ")}`}
                  </div>
                  <p className="scrim-note">
                    {state.hypervisorKind === "qemu"
                      ? `The guest display streams here while the machine is running. Drop files onto this pane to copy them into ${os && isWindows(os) ? "C:\\host" : "/mnt/host"}.`
                      : `The guest framebuffer streams here while the machine is running. Drop files onto this pane to copy them into ${os && isWindows(os) ? "C:\\host" : "/mnt/host"}.`}
                  </p>
                </div>
              )}
            </>
          )}
          {state.overlay && state.overlay.sessionId === sessionId ? (
            <DesktopOverlay overlay={state.overlay} />
          ) : null}
          <TimelinePreviewLayer />
        </div>
      </GuestTimeline>
      <div className="term">
        <div className="term-tabs">
          <button
            className={!showLogs ? "active" : ""}
            onClick={() => {
              logsOff.current = true;
              setShowLogs(false);
            }}
          >
            Terminal
          </button>
          <button
            className={showLogs ? "active" : ""}
            disabled={!vm}
            onClick={() => {
              logsOff.current = false;
              setShowLogs(true);
            }}
          >
            Boot log
          </button>
          {clipNote && <span className="hint">{clipNote}</span>}
        </div>
        {showLogs ? (
          <div ref={logPane} className="boot-log">
            {bootLog.trim()
              ? partitionBootLog(bootLog).map((part, i) =>
                  part.detail ? (
                    <ExpandableLog key={i} text={part.detail} />
                  ) : (
                    <div key={i}>{part.summary}</div>
                  ),
                )
              : "Waiting for QEMU and guest serial…"}
          </div>
        ) : pty && vm ? (
          <GuestPty vmId={vm.id} />
        ) : (
          <div className="term-body">
            {log.map((row, i) => (
              <div key={i}>{row}</div>
            ))}
            <div>
              <span className="prompt">{os && isWindows(os) ? "PS C:\\>" : "locus@guest:~$"}</span>{" "}
              <input
                value={line}
                onChange={(e) => setLine(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder="run a command in the guest"
              />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function GuestPty({ vmId }: { vmId: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let cancelled = false;
    let term: Terminal | undefined;
    let ws: WebSocket | undefined;
    let dataSub: { dispose(): void } | undefined;
    let ro: ResizeObserver | undefined;

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/xterm/css/xterm.css"),
      ]);
      if (cancelled || host.current !== node) return;
      const css = getComputedStyle(document.documentElement);
      const session = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontSize: 12,
        lineHeight: 1,
        fontFamily:
          css.getPropertyValue("--mono").trim() || '"IBM Plex Mono", ui-monospace, monospace',
        theme: {
          background: css.getPropertyValue("--term").trim() || "#08090c",
          foreground: css.getPropertyValue("--term-fg").trim() || "#c6d0c9",
          cursor: css.getPropertyValue("--accent").trim() || "#e7b07a",
        },
      });
      if (cancelled) {
        session.dispose();
        return;
      }
      term = session;
      const fit = new FitAddon();
      session.loadAddon(fit);
      session.open(node);
      const scheduleSize = () => {
        requestAnimationFrame(() => requestAnimationFrame(() => fitPty(fit, session)));
      };
      scheduleSize();
      session.write("Connecting to guest SSH…\r\n");
      ws = new WebSocket(terminalWsUrl(vmId));
      ws.binaryType = "arraybuffer";
      ws.onmessage = (ev) => {
        const chunk =
          typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
        session.write(chunk);
      };
      ws.onerror = () => session.writeln("\r\n[pty error]");
      ws.onclose = () => session.writeln("\r\n[disconnected]");
      dataSub = session.onData((data) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(data);
      });
      ro = new ResizeObserver(() => scheduleSize());
      ro.observe(node);
      if (node.parentElement) ro.observe(node.parentElement);
      void document.fonts?.ready.then(() => {
        if (!cancelled) scheduleSize();
      });
    })();

    return () => {
      cancelled = true;
      dataSub?.dispose();
      ro?.disconnect();
      ws?.close();
      term?.dispose();
    };
  }, [vmId]);

  return (
    <div className="pty-frame">
      <div ref={host} className="pty-host" />
    </div>
  );
}

function statusDot(status?: string): string {
  if (!status) return "stopped";
  if (status === "running" || status === "ready") return "running";
  if (status === "error") return "error";
  if (status === "paused") return "paused";
  if (status === "stopped") return "stopped";
  return "provisioning";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
