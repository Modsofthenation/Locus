import { useEffect, useRef } from "react";
import type { Terminal } from "@xterm/xterm";
import { workspaceTerminalWsUrl } from "@/lib/api";
import { fitPty } from "@/lib/ptyFit";

export const WORKSPACE_TERMINAL_EVENT = "locus:workspace-terminal";
export const WORKSPACE_TERMINAL_RUN_EVENT = "locus:workspace-terminal-run";
export const WORKSPACE_TERMINAL_NEW_EVENT = "locus:workspace-terminal-new";

export function requestWorkspaceTerminal(): void {
  window.dispatchEvent(new Event(WORKSPACE_TERMINAL_EVENT));
}

export function requestWorkspaceTerminalRun(command: string): void {
  window.dispatchEvent(new CustomEvent(WORKSPACE_TERMINAL_RUN_EVENT, { detail: { command } }));
}

export function requestWorkspaceTerminalNew(): void {
  window.dispatchEvent(new Event(WORKSPACE_TERMINAL_NEW_EVENT));
}

function releaseTerminalFocus(host: HTMLElement | null, term?: Terminal) {
  term?.blur();
  const active = document.activeElement;
  if (active instanceof HTMLElement && host?.contains(active)) active.blur();
}

/** Windows Electron cannot focus xterm's off-screen helper textarea
 *  (`left: -9999em` inside overflow:hidden), so keys never reach onData. */
export function focusWorkspaceTerminal(term?: Terminal): boolean {
  if (!term || term.options.disableStdin) return false;
  const ta = term.textarea;
  if (ta) {
    ta.style.left = "0px";
    ta.style.top = "0px";
    ta.style.width = "8px";
    ta.style.height = "16px";
    ta.style.opacity = "0";
    ta.style.zIndex = "10";
    ta.removeAttribute("disabled");
    ta.readOnly = false;
  }
  term.focus();
  return true;
}

/** After the PTY loses focus, put the caret back in the file or chat composer. */
export function restoreIdeTypingFocus(root: ParentNode = document): boolean {
  const editor = root.querySelector(".workspace-code textarea:not(:disabled)");
  const composer = root.querySelector(".ide-chat textarea, .composer textarea");
  const target = (editor ?? composer) as HTMLTextAreaElement | null;
  if (!target) return false;
  target.focus();
  return true;
}

export function WorkspaceTerminal({
  sessionId,
  terminalId,
  cwd,
  run,
  active = true,
}: {
  sessionId: string;
  terminalId?: string;
  cwd?: string;
  run?: string;
  active?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | undefined>(undefined);
  const activeRef = useRef(active);
  activeRef.current = active;

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
        disableStdin: !activeRef.current,
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
      termRef.current = session;
      const fit = new FitAddon();
      session.loadAddon(fit);
      session.open(node);
      const sendSize = () => {
        fitPty(fit, session);
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: session.cols, rows: session.rows }));
        }
      };
      const scheduleSize = () => {
        requestAnimationFrame(() => requestAnimationFrame(sendSize));
      };
      scheduleSize();
      if (activeRef.current) focusWorkspaceTerminal(session);
      else releaseTerminalFocus(node, session);
      session.write("Connecting to workspace…\r\n");
      ws = new WebSocket(workspaceTerminalWsUrl(sessionId, location, cwd, terminalId));
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        scheduleSize();
        if (run && ws?.readyState === WebSocket.OPEN) {
          ws.send(run.endsWith("\n") ? run : `${run}\n`);
        }
      };
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
      const pane = node.closest(".term");
      if (pane && pane !== node.parentElement) ro.observe(pane);
      void document.fonts?.ready.then(() => {
        if (!cancelled) scheduleSize();
      });
    })();

    return () => {
      cancelled = true;
      dataSub?.dispose();
      ro?.disconnect();
      ws?.close();
      releaseTerminalFocus(node, term);
      termRef.current = undefined;
      term?.dispose();
    };
  }, [sessionId, terminalId, cwd, run]);

  useEffect(() => {
    const session = termRef.current;
    if (!session) return;
    session.options.disableStdin = !active;
    if (!active) releaseTerminalFocus(host.current, session);
    else focusWorkspaceTerminal(session);
  }, [active]);

  return (
    <div className="pty-frame">
      <div
        ref={host}
        className="pty-host"
        tabIndex={active ? 0 : -1}
        data-testid="workspace-terminal"
        data-active={active ? "1" : "0"}
        onMouseDown={() => {
          if (activeRef.current) focusWorkspaceTerminal(termRef.current);
        }}
      />
    </div>
  );
}
