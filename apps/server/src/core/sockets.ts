import type { IncomingMessage, Server as HttpServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { createConnection } from "node:net";
import {
  isChromeExtensionOrigin,
  isLoopbackHost,
  type PhoneRemote,
  type ServerCommand,
} from "@locus/shared";
import { containedPath } from "@locus/guest-agent";
import { WebSocket, WebSocketServer } from "ws";
import type { Hub } from "./hub.js";
import {
  allowPhoneAccess,
  normalizePeer,
  tokenFromHeaders,
  tokensMatch,
} from "../runtime/phoneRemote.js";
import { phoneAuthLimiter } from "./rateLimit.js";
import {
  createWindowsCookedLine,
  parsePtyResize,
  resizeHostShell,
  spawnHostShell,
} from "../workspace/hostShell.js";
import { sanitizeWorkspaceRel } from "../workspace/workspaceFiles.js";

export interface DisplaySource {
  get(id: string):
    | {
        display?: { host: string; port: number };
        ssh?: { host: string; port: number; username: string; identityFile?: string };
      }
    | undefined;
}

export type PtyFactory = (ssh: {
  host: string;
  port: number;
  username: string;
  identityFile?: string;
}) => ChildProcess;

export function defaultPty(ssh: {
  host: string;
  port: number;
  username: string;
  identityFile?: string;
}): ChildProcess {
  const args = [
    "-tt",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "LogLevel=ERROR",
    "-p",
    String(ssh.port),
  ];
  if (ssh.identityFile) args.push("-i", ssh.identityFile);
  args.push(`${ssh.username}@${ssh.host}`);
  return spawn("ssh", args, {
    env: { ...process.env, TERM: "xterm-256color" },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

export type HostShellFactory = (cwd: string) => ChildProcess;

type WorkspaceShellSource = {
  root: (sessionId: string) => Promise<string | undefined>;
  spawn?: HostShellFactory;
  cooked?: boolean;
  idleMs?: number;
};

type WorkspaceTerminalSession = {
  key: string;
  child: ChildProcess;
  clients: Set<WebSocket>;
  history: Buffer[];
  historyBytes: number;
  cooked?: ReturnType<typeof createWindowsCookedLine>;
  idleTimer?: NodeJS.Timeout;
  closed: boolean;
};

const WORKSPACE_TERMINAL_IDLE_MS = 30 * 60_000;
const WORKSPACE_TERMINAL_HISTORY_BYTES = 1024 * 1024;

class WorkspaceTerminalPool {
  private readonly sessions = new Map<string, WorkspaceTerminalSession>();
  private readonly pending = new Map<string, Promise<WorkspaceTerminalSession | undefined>>();
  private disposed = false;

  constructor(private readonly source?: WorkspaceShellSource) {}

  async attach(
    ws: WebSocket,
    sessionId: string,
    terminalId: string,
    cwdRel: string,
  ): Promise<void> {
    if (!sessionId.trim() || !this.source?.root) {
      ws.close(1011, "no workspace");
      return;
    }
    const clean = sanitizeWorkspaceRel(cwdRel);
    const key = `${sessionId}\0${terminalId}\0${clean}`;
    let entry = this.sessions.get(key);
    if (!entry) {
      let creating = this.pending.get(key);
      if (!creating) {
        creating = this.create(key, sessionId, clean).finally(() => this.pending.delete(key));
        this.pending.set(key, creating);
      }
      entry = await creating;
    }
    if (!entry) {
      if (ws.readyState === WebSocket.OPEN) ws.close(1011, "no workspace");
      return;
    }
    if (ws.readyState !== WebSocket.OPEN) {
      this.scheduleIdle(entry);
      return;
    }
    this.connect(entry, ws);
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.sessions.values()) this.disposeEntry(entry);
    this.sessions.clear();
  }

  private async create(
    key: string,
    sessionId: string,
    cleanCwd: string,
  ): Promise<WorkspaceTerminalSession | undefined> {
    const source = this.source;
    if (!source) return undefined;
    const root = await source.root(sessionId).catch(() => undefined);
    if (!root) return undefined;
    const cwd = cleanCwd ? ((await containedPath(root, join(root, cleanCwd))) ?? root) : root;
    try {
      const info = await lstat(cwd);
      if (!info.isDirectory()) return undefined;
    } catch {
      return undefined;
    }
    let child: ChildProcess;
    try {
      child = (source.spawn ?? spawnHostShell)(cwd);
    } catch {
      return undefined;
    }
    if (this.disposed) {
      child.kill("SIGTERM");
      return undefined;
    }
    const cooked = source.cooked ?? process.platform === "win32";
    const entry: WorkspaceTerminalSession = {
      key,
      child,
      clients: new Set(),
      history: [],
      historyBytes: 0,
      cooked: cooked ? createWindowsCookedLine() : undefined,
      closed: false,
    };
    this.sessions.set(key, entry);
    const output = (chunk: Buffer | string) => this.publish(entry, Buffer.from(chunk));
    child.stdout?.on("data", output);
    child.stderr?.on("data", output);
    child.on("error", () => this.finish(entry, 1011, "shell failed"));
    child.on("close", () => this.finish(entry));
    return entry;
  }

  private connect(entry: WorkspaceTerminalSession, ws: WebSocket): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
    entry.clients.add(ws);
    for (const chunk of entry.history) {
      if (ws.readyState !== WebSocket.OPEN) break;
      ws.send(chunk);
    }
    ws.on("message", (data) => {
      const size = parsePtyResize(data);
      if (size) {
        resizeHostShell(entry.child.pid, size.cols, size.rows);
        return;
      }
      if (!entry.child.stdin || entry.child.killed) return;
      const raw = toBuffer(data);
      if (!entry.cooked) {
        entry.child.stdin.write(raw);
        return;
      }
      const next = entry.cooked.feed(raw);
      if (next.echo) this.publish(entry, Buffer.from(next.echo));
      if (next.toChild) entry.child.stdin.write(next.toChild);
    });
    let detached = false;
    const detach = () => {
      if (detached) return;
      detached = true;
      entry.clients.delete(ws);
      this.scheduleIdle(entry);
    };
    ws.on("close", detach);
    ws.on("error", detach);
  }

  private publish(entry: WorkspaceTerminalSession, chunk: Buffer): void {
    if (entry.closed || !chunk.length) return;
    const saved = Buffer.from(chunk);
    entry.history.push(saved);
    entry.historyBytes += saved.length;
    while (entry.historyBytes > WORKSPACE_TERMINAL_HISTORY_BYTES && entry.history.length) {
      const first = entry.history[0]!;
      const overflow = entry.historyBytes - WORKSPACE_TERMINAL_HISTORY_BYTES;
      if (first.length <= overflow) {
        entry.history.shift();
        entry.historyBytes -= first.length;
      } else {
        entry.history[0] = first.subarray(overflow);
        entry.historyBytes -= overflow;
      }
    }
    for (const client of entry.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(chunk);
    }
  }

  private scheduleIdle(entry: WorkspaceTerminalSession): void {
    if (entry.closed || entry.clients.size || entry.idleTimer) return;
    const idleMs = this.source?.idleMs ?? WORKSPACE_TERMINAL_IDLE_MS;
    if (idleMs <= 0) {
      this.disposeEntry(entry);
      return;
    }
    entry.idleTimer = setTimeout(() => this.disposeEntry(entry), idleMs);
    entry.idleTimer.unref?.();
  }

  private finish(entry: WorkspaceTerminalSession, code?: number, reason?: string): void {
    if (entry.closed) return;
    entry.closed = true;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    this.sessions.delete(entry.key);
    for (const client of entry.clients) {
      if (client.readyState === WebSocket.OPEN) client.close(code, reason);
    }
    entry.clients.clear();
  }

  private disposeEntry(entry: WorkspaceTerminalSession): void {
    if (entry.closed) return;
    this.finish(entry, 1001, "terminal expired");
    if (!entry.child.killed) entry.child.kill("SIGTERM");
  }
}

export function attachSockets(opts: {
  server: HttpServer;
  hub: Hub;
  displays: DisplaySource;
  onCommand: (cmd: ServerCommand) => Promise<void> | void;
  pty?: PtyFactory;
  heartbeatMs?: number;
  phoneRemote?: () => PhoneRemote | undefined;
  browsers?: { attach: (sessionId: string, ws: WebSocket) => void };
  chromeExtension?: {
    attach: (ws: WebSocket, token: string | undefined) => void;
    token?: () => string | undefined;
  };
  workspaceShell?: WorkspaceShellSource;
}): void {
  const events = new WebSocketServer({ noServer: true });
  const display = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const terminal = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const workspace = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const browser = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const chromeExtension = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const pty = opts.pty ?? defaultPty;
  const heartbeatMs = opts.heartbeatMs ?? 20_000;
  const workspaceTerminals = new WorkspaceTerminalPool(opts.workspaceShell);
  opts.server.on("close", () => workspaceTerminals.dispose());

  opts.server.on("upgrade", (req, socket, head) => {
    const originHeader = req.headers.origin;
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    const peer =
      "remoteAddress" in socket ? (socket as { remoteAddress?: string }).remoteAddress : undefined;
    const pathname = pathnameOf(req);
    if (pathname === "/ws/chrome-extension") {
      const loopbackPeer = !peer || isLoopbackHost(normalizePeer(peer) ?? "");
      let originOk = !origin || isChromeExtensionOrigin(origin);
      if (origin && !originOk) {
        try {
          originOk = isLoopbackHost(new URL(origin).hostname);
        } catch {
          originOk = false;
        }
      }
      const token = tokenFromHeaders(req.headers, req.url);
      const expected = opts.chromeExtension?.token?.();
      if (
        !loopbackPeer ||
        !originOk ||
        !opts.chromeExtension?.attach ||
        !expected ||
        !tokensMatch(token, expected)
      ) {
        socket.destroy();
        return;
      }
      chromeExtension.handleUpgrade(req, socket, head, (ws) => {
        opts.chromeExtension?.attach(ws, token);
      });
      return;
    }
    if (
      !allowPhoneAccess({
        peer,
        origin,
        token: tokenFromHeaders(req.headers, req.url),
        remote: opts.phoneRemote?.(),
        method: req.method,
        path: pathname,
      })
    ) {
      const host = normalizePeer(peer);
      if (host && !isLoopbackHost(host) && !phoneAuthLimiter.allow(host)) {
        socket.end("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
      }
      socket.destroy();
      return;
    }
    if (pathname === "/ws") {
      events.handleUpgrade(req, socket, head, (ws) => {
        events.emit("connection", ws, req);
      });
      return;
    }
    const displayMatch = /^\/ws\/display\/([^/]+)$/.exec(pathname);
    if (displayMatch?.[1]) {
      const vmId = decodeURIComponent(displayMatch[1]);
      display.handleUpgrade(req, socket, head, (ws) => {
        bindDisplay(ws, vmId, opts.displays);
      });
      return;
    }
    const termMatch = /^\/ws\/terminal\/([^/]+)$/.exec(pathname);
    if (termMatch?.[1]) {
      const vmId = decodeURIComponent(termMatch[1]);
      terminal.handleUpgrade(req, socket, head, (ws) => {
        bindTerminal(ws, vmId, opts.displays, pty);
      });
      return;
    }
    const workspaceMatch = /^\/ws\/workspace-terminal\/([^/]+)$/.exec(pathname);
    if (workspaceMatch?.[1]) {
      const sessionId = decodeURIComponent(workspaceMatch[1]);
      const cwd = cwdQuery(req.url);
      const terminalId = terminalQuery(req.url);
      workspace.handleUpgrade(req, socket, head, (ws) => {
        bindWorkspaceTerminal(ws, sessionId, workspaceTerminals, terminalId, cwd);
      });
      return;
    }
    const browserMatch = /^\/ws\/browser\/([^/]+)$/.exec(pathname);
    if (browserMatch?.[1]) {
      const sessionId = decodeURIComponent(browserMatch[1]);
      browser.handleUpgrade(req, socket, head, (ws) => {
        bindBrowser(ws, sessionId, opts.browsers);
      });
      return;
    }
    socket.destroy();
  });

  events.on("connection", (ws) => {
    const alive = ws as WebSocket & { isAlive?: boolean };
    alive.isAlive = true;
    alive.on("pong", () => {
      alive.isAlive = true;
    });
    opts.hub.add(ws);
    ws.on("message", (raw) => {
      try {
        const cmd = JSON.parse(String(raw)) as ServerCommand;
        void opts.onCommand(cmd);
      } catch (err) {
        console.warn("bad ws message", err);
      }
    });
  });

  if (heartbeatMs > 0) {
    const heartbeat = setInterval(() => {
      for (const client of events.clients) {
        const alive = client as WebSocket & { isAlive?: boolean };
        if (alive.isAlive === false) {
          alive.terminate();
          continue;
        }
        alive.isAlive = false;
        alive.ping();
      }
    }, heartbeatMs);
    heartbeat.unref?.();
    opts.server.on("close", () => clearInterval(heartbeat));
  }
}

export function bindDisplay(ws: WebSocket, vmId: string, displays: DisplaySource): void {
  const endpoint = displays.get(vmId)?.display;
  if (!endpoint?.host || !endpoint.port || !isLoopback(endpoint.host)) {
    ws.close(1011, "no display");
    return;
  }
  pipeVnc(ws, endpoint.host, endpoint.port);
}

export function bindBrowser(
  ws: WebSocket,
  sessionId: string,
  browsers?: { attach: (sessionId: string, ws: WebSocket) => void },
): void {
  if (!sessionId.trim() || !browsers?.attach) {
    ws.close(1011, "no browser");
    return;
  }
  browsers.attach(sessionId, ws);
}

export function bindTerminal(
  ws: WebSocket,
  vmId: string,
  displays: DisplaySource,
  pty: PtyFactory,
): void {
  const ssh = displays.get(vmId)?.ssh;
  if (!ssh?.host || !ssh.port || !ssh.username || !isLoopback(ssh.host)) {
    ws.close(1011, "no ssh");
    return;
  }
  let child: ChildProcess;
  try {
    child = pty(ssh);
  } catch {
    ws.close(1011, "pty failed");
    return;
  }
  pipeChildPty(ws, child);
}

function bindWorkspaceTerminal(
  ws: WebSocket,
  sessionId: string,
  terminals: WorkspaceTerminalPool,
  terminalId = "default",
  cwdRel = "",
): void {
  void terminals.attach(ws, sessionId, terminalId, cwdRel);
}

function cwdQuery(url?: string): string {
  try {
    return new URL(url ?? "", "http://127.0.0.1").searchParams.get("cwd") ?? "";
  } catch {
    return "";
  }
}

function terminalQuery(url?: string): string {
  try {
    const value = new URL(url ?? "", "http://127.0.0.1").searchParams.get("terminal") ?? "";
    return /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : "default";
  } catch {
    return "default";
  }
}

function pipeChildPty(
  ws: WebSocket,
  child: ChildProcess,
  cooked?: { feed(raw: Buffer | string): { toChild: string; echo: string } },
): void {
  child.stdout?.on("data", (buf: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(buf);
  });
  child.stderr?.on("data", (buf: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(buf);
  });
  child.on("error", () => {
    if (ws.readyState === WebSocket.OPEN) ws.close(1011, "ssh unreachable");
  });
  child.on("close", () => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });
  ws.on("message", (data) => {
    const size = parsePtyResize(data);
    if (size) {
      resizeHostShell(child.pid, size.cols, size.rows);
      return;
    }
    if (!child.stdin || child.killed) return;
    const raw = toBuffer(data);
    if (!cooked) {
      child.stdin.write(raw);
      return;
    }
    const next = cooked.feed(raw);
    if (next.echo && ws.readyState === WebSocket.OPEN) ws.send(next.echo);
    if (next.toChild) child.stdin.write(next.toChild);
  });
  ws.on("close", () => {
    child.kill("SIGTERM");
  });
  ws.on("error", () => {
    child.kill("SIGTERM");
  });
}

export function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export function pipeVnc(ws: WebSocket, host: string, port: number): void {
  const tcp = createConnection({ host, port });
  tcp.on("data", (buf) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(buf);
  });
  tcp.on("error", () => {
    if (ws.readyState === WebSocket.OPEN) ws.close(1011, "display unreachable");
  });
  tcp.on("close", () => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });
  ws.on("message", (data) => {
    if (tcp.destroyed) return;
    tcp.write(toBuffer(data));
  });
  ws.on("close", () => tcp.destroy());
  ws.on("error", () => tcp.destroy());
}

function pathnameOf(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  } catch {
    return "/";
  }
}

function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}
