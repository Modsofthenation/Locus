import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  CHROMIUM_VIEWPORT,
  isDockerBrowserActivity,
  mapCanvasToDevice,
  parseBrowserServerMessage,
  type BrowserClientMessage,
  type BrowserController,
  type BrowserTab,
  type SessionControl,
  type ToolOverlay,
} from "@locus/shared";
import { browserWsUrl } from "@/lib/api";
import { DesktopOverlay } from "@/components/layout/DesktopOverlay";

export function BrowserPane({
  sessionId,
  overlay,
  browserControl,
  watch = false,
}: {
  sessionId: string;
  overlay: ToolOverlay | null;
  browserControl?: SessionControl;
  /** When true, hide Take over / Hand back (tests). Phone uses the full pane. */
  watch?: boolean;
}) {
  const [url, setUrl] = useState("about:blank");
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [downloads, setDownloads] = useState<string[]>([]);
  const [deniedHost, setDeniedHost] = useState<string | null>(null);
  const [source, setSource] = useState<"isolated" | "extension" | undefined>(undefined);
  const [frame, setFrame] = useState<{ mime: string; data: string } | null>(null);
  const [viewport, setViewport] = useState(CHROMIUM_VIEWPORT);
  const [error, setError] = useState<string | null>(null);
  const [controller, setController] = useState<BrowserController>(
    browserControl === "human" ? "operator" : "agent",
  );
  const socketRef = useRef<WebSocket | null>(null);
  const frameRef = useRef<HTMLImageElement>(null);
  const driving = !watch && controller === "operator";

  useEffect(() => {
    setController(browserControl === "human" ? "operator" : "agent");
  }, [browserControl]);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      if (stopped) return;
      try {
        socket = new WebSocket(browserWsUrl(sessionId));
        socketRef.current = socket;
      } catch {
        timer = setTimeout(open, 1500);
        return;
      }
      socket.addEventListener("message", (event) => {
        const message = parseBrowserServerMessage(String(event.data));
        if (!message) return;
        if (message.type === "frame") {
          setFrame({ mime: message.mime, data: message.data });
          setViewport({
            width: message.metadata.deviceWidth || CHROMIUM_VIEWPORT.width,
            height: message.metadata.deviceHeight || CHROMIUM_VIEWPORT.height,
          });
          setError(null);
          return;
        }
        if (message.type === "tabs") {
          setTabs(message.tabs);
          if (message.url) setUrl(message.url);
          return;
        }
        if (message.type === "downloads") {
          setDownloads(message.files);
          if (message.opened) clickDownload(sessionId, message.opened);
          return;
        }
        if (message.type === "status") {
          setController(message.controller);
          if (message.deniedHost !== undefined) setDeniedHost(message.deniedHost);
          if (message.source) setSource(message.source);
          if (message.error) setError(message.error);
          else if (message.ready) setError(null);
        }
      });
      socket.addEventListener("close", () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (stopped) return;
        timer = setTimeout(open, 1500);
      });
    };
    open();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      socket?.close();
      socketRef.current = null;
    };
  }, [sessionId]);

  function send(message: BrowserClientMessage): void {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  function point(event: ReactMouseEvent<HTMLElement>): { x: number; y: number } {
    const node = frameRef.current ?? event.currentTarget;
    return mapCanvasToDevice(event.clientX, event.clientY, node.getBoundingClientRect(), viewport);
  }

  const showOverlay =
    overlay && overlay.sessionId === sessionId && isDockerBrowserActivity(overlay.name);
  const listed = tabs.length
    ? tabs
    : [{ targetId: "blank", url: "about:blank", title: "New tab", active: true }];
  const active = listed.find((tab) => tab.active) ?? listed[0];

  return (
    <div className={`browser-pane ${driving ? "driving" : ""}`}>
      <div className="browser-chrome">
        <div className="browser-tabs" role="tablist" aria-label="Browser tabs">
          {listed.map((tab) => (
            <button
              key={tab.targetId}
              type="button"
              role="tab"
              aria-selected={tab.active || tab.targetId === active?.targetId}
              className={`browser-tab ${tab.active || tab.targetId === active?.targetId ? "on" : ""}`}
              title={tab.url}
              onClick={() => send({ type: "tab", action: "select", targetId: tab.targetId })}
            >
              {tabTitle(tab)}
            </button>
          ))}
          {driving ? (
            <button
              type="button"
              className="browser-tab browser-tab-new"
              title="New tab"
              onClick={() => send({ type: "tab", action: "new", url: "about:blank" })}
            >
              +
            </button>
          ) : null}
        </div>
        <div className="browser-urlbar">
          <span className="browser-scheme">{schemeLabel(url)}</span>
          <input
            readOnly={!driving}
            value={displayUrl(url)}
            aria-label="Page URL"
            onChange={(event) => {
              if (!driving) return;
              const next = event.target.value.trim();
              setUrl(next.includes("://") || next === "about:blank" ? next : `https://${next}`);
            }}
            onKeyDown={(event) => {
              if (!driving || event.key !== "Enter") return;
              const next = url.trim() || "about:blank";
              send({ type: "navigate", url: next });
            }}
          />
          <span className={`browser-chip ${driving ? "you" : ""}`}>
            {driving ? "You" : "Agent"}
          </span>
          {source === "extension" ? (
            <span
              className="browser-chip"
              title="Driving the Chrome tabs already open on this machine"
            >
              Your Chrome
            </span>
          ) : null}
          {deniedHost ? (
            <span className="browser-chip denied" title="Restricted jail blocked this host">
              Blocked {deniedHost}
            </span>
          ) : null}
          {watch ? (
            <span className="browser-chip">Watch</span>
          ) : driving ? (
            <button
              type="button"
              className="btn small ghost"
              onClick={() => send({ type: "handback" })}
            >
              Hand back
            </button>
          ) : (
            <button
              type="button"
              className="btn small ghost"
              title="Drive this page without aborting chat"
              onClick={() => send({ type: "takeover" })}
            >
              Take over browser
            </button>
          )}
        </div>
        {downloads.length ? (
          <div className="browser-downloads" aria-label="Downloads">
            {downloads.map((name) => (
              <button
                key={name}
                type="button"
                className="browser-download"
                title={`Open ${name}`}
                onClick={() => send({ type: "open-download", name })}
              >
                {name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div
        className="browser-stage"
        tabIndex={driving ? 0 : undefined}
        onKeyDown={(event) => {
          if (!driving) return;
          if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            send({ type: "input", kind: "insertText", text: event.key });
            return;
          }
          send({ type: "input", kind: "keyDown", key: event.key });
        }}
        onKeyUp={(event) => {
          if (!driving || event.key.length === 1) return;
          send({ type: "input", kind: "keyUp", key: event.key });
        }}
      >
        {frame ? (
          <img
            ref={frameRef}
            className="browser-frame"
            alt={url && url !== "about:blank" ? `Page at ${url}` : "Browser screencast"}
            draggable={false}
            src={`data:${frame.mime};base64,${frame.data}`}
            onMouseMove={(event) => {
              if (!driving) return;
              const { x, y } = point(event);
              send({ type: "input", kind: "mouseMoved", x, y });
            }}
            onMouseDown={(event) => {
              if (!driving) return;
              event.preventDefault();
              const { x, y } = point(event);
              send({
                type: "input",
                kind: "mousePressed",
                x,
                y,
                button: mouseButton(event.button),
                clickCount: event.detail || 1,
              });
            }}
            onMouseUp={(event) => {
              if (!driving) return;
              const { x, y } = point(event);
              send({
                type: "input",
                kind: "mouseReleased",
                x,
                y,
                button: mouseButton(event.button),
                clickCount: event.detail || 1,
              });
            }}
            onWheel={(event) => {
              if (!driving) return;
              event.preventDefault();
              const { x, y } = point(event);
              send({
                type: "input",
                kind: "mouseWheel",
                x,
                y,
                deltaX: event.deltaX,
                deltaY: event.deltaY,
              });
            }}
            onContextMenu={(event) => {
              if (driving) event.preventDefault();
            }}
          />
        ) : (
          <div className="browser-empty">
            <h3>{source === "extension" ? "Your Chrome" : "Agent browser"}</h3>
            <p className="scrim-note">
              {error
                ? error
                : source === "extension" && !frame
                  ? "Waiting for the Chrome extension. Pair it in Settings → Chrome, then keep this agent on Use my Chrome."
                  : !frame && !error
                    ? "Connecting to the guest browser…"
                    : watch
                      ? "Watch the guest Chromium here. Click a tab to switch. Takeover stays on the desktop."
                      : driving
                        ? "Click the page to type. Esc hands back."
                        : "Watch the guest Chromium here. Take over the page for logins without aborting chat."}
            </p>
          </div>
        )}
        {showOverlay && overlay ? <DesktopOverlay overlay={overlay} screen={viewport} /> : null}
      </div>
    </div>
  );
}

/** Same-origin artifact click — `window.open` after a WS event is swallowed by popup blockers. */
function clickDownload(sessionId: string, name: string): void {
  const href = `/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(name)}?kind=download`;
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function mouseButton(button: number): "left" | "middle" | "right" {
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "left";
}

function tabTitle(tab: BrowserTab): string {
  const title = tab.title?.trim();
  if (title) return title.slice(0, 32);
  try {
    return new URL(tab.url).hostname || "Tab";
  } catch {
    return "Tab";
  }
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "");
}

function schemeLabel(url: string): string {
  if (url.startsWith("https://")) return "https";
  if (url.startsWith("http://")) return "http";
  return "—";
}
