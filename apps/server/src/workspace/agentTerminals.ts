import type { ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import {
  AGENT_TERMINAL_MAX,
  AGENT_TERMINAL_QUIET_MS,
  AGENT_TERMINAL_SHELL,
  lastTerminalLine,
  looksLikeTerminalPrompt,
  resolveAgentTerminalCommand,
  type AgentTerminalInfo,
  type AgentTerminalStatus,
} from "@locus/shared";
import {
  createWindowsCookedLine,
  parsePtyResize,
  resizeHostShell,
  shellQuote,
  spawnHostShell,
} from "./hostShell.js";

/** Where an agent terminal runs. Host runs in the folder; Docker runs `docker exec -it` in `/workspace`. */
export type AgentTerminalTarget =
  { runtime: "host"; cwd: string } | { runtime: "docker"; containerId: string };

export type AgentTerminalResolution = {
  target?: AgentTerminalTarget;
  /** Why there is no target (VM, worker, stopped container). */
  reason?: string;
  /** Preset id for the session provider's CLI. */
  defaultPreset: string;
};

export type AgentTerminalSpawn = (
  target: AgentTerminalTarget,
  command: string | null,
) => ChildProcess;

/** Needs you hooks: flag when a CLI goes quiet on a prompt, clear on the next keystroke. */
export type AgentTerminalAttention = {
  flag(sessionId: string, line: string): void | Promise<void>;
  clear(sessionId: string): void | Promise<void>;
};

/** The subset of a `ws` WebSocket the registry drives (a fake in tests). */
export type AgentTerminalClient = {
  readonly readyState: number;
  send(data: Buffer | string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (data: Buffer | ArrayBuffer | Buffer[]) => void): unknown;
  on(event: "close" | "error", listener: () => void): unknown;
};

const OPEN = 1;
export const AGENT_TERMINAL_HISTORY_BYTES = 200 * 1024;
const TAIL_CHARS = 4096;

type Entry = {
  key: string;
  sessionId: string;
  id: string;
  label: string;
  command: string | null;
  startedAt: string;
  child: ChildProcess;
  clients: Set<AgentTerminalClient>;
  history: Buffer[];
  historyBytes: number;
  tail: string;
  /** The person submitted a line since the last Needs you, so quiet output can mean "your turn". */
  armed: boolean;
  waiting: boolean;
  quietTimer?: NodeJS.Timeout;
  cooked?: ReturnType<typeof createWindowsCookedLine>;
  closed: boolean;
};

export function defaultAgentTerminalSpawn(
  target: AgentTerminalTarget,
  command: string | null,
): ChildProcess {
  if (target.runtime === "host") {
    return spawnHostShell(target.cwd, { command: command ?? undefined });
  }
  const inner =
    command ?? "if command -v bash >/dev/null 2>&1; then exec bash -l; else exec sh -l; fi";
  const line = [
    "docker exec -it -w /workspace -e TERM=xterm-256color -e COLORTERM=truecolor",
    shellQuote(target.containerId),
    "sh -lc",
    shellQuote(inner),
  ].join(" ");
  return spawnHostShell(homedir(), { command: line });
}

function toBuffer(data: Buffer | ArrayBuffer | Buffer[]): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

/**
 * Session-scoped PTYs for Terminal mode. Processes outlive websocket reconnects (scrollback
 * is replayed), are capped per session, and die on explicit close or session delete.
 */
export class AgentTerminalRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<Entry | string>>();
  private readonly spawnFn: AgentTerminalSpawn;
  private readonly max: number;
  private readonly historyLimit: number;
  private readonly quietMs: number;
  private readonly cooked: boolean;
  private disposed = false;

  constructor(
    private readonly opts: {
      resolve: (sessionId: string) => Promise<AgentTerminalResolution>;
      spawn?: AgentTerminalSpawn;
      attention?: AgentTerminalAttention;
      max?: number;
      historyBytes?: number;
      quietMs?: number;
      /** Windows cmd.exe has no PTY: echo and line-edit on the server. */
      cooked?: boolean;
    },
  ) {
    this.spawnFn = opts.spawn ?? defaultAgentTerminalSpawn;
    this.max = opts.max ?? AGENT_TERMINAL_MAX;
    this.historyLimit = opts.historyBytes ?? AGENT_TERMINAL_HISTORY_BYTES;
    this.quietMs = opts.quietMs ?? AGENT_TERMINAL_QUIET_MS;
    this.cooked = opts.cooked ?? process.platform === "win32";
  }

  list(sessionId: string): AgentTerminalInfo[] {
    const out: AgentTerminalInfo[] = [];
    for (const entry of this.entries.values()) {
      if (entry.sessionId !== sessionId) continue;
      out.push({
        id: entry.id,
        label: entry.label,
        command: entry.command,
        startedAt: entry.startedAt,
        ...(entry.waiting ? { waiting: true } : {}),
      });
    }
    return out;
  }

  async status(sessionId: string): Promise<AgentTerminalStatus> {
    const resolved = await this.opts.resolve(sessionId).catch(() => undefined);
    return {
      available: Boolean(resolved?.target),
      ...(resolved?.target ? {} : { reason: resolved?.reason ?? "Session not found" }),
      defaultPreset: resolved?.defaultPreset ?? AGENT_TERMINAL_SHELL,
      terminals: this.list(sessionId),
    };
  }

  /** Attach a websocket, spawning `command` (preset id or raw line) when the terminal is new. */
  async attach(
    ws: AgentTerminalClient,
    sessionId: string,
    terminalId: string,
    command?: string,
  ): Promise<void> {
    const key = `${sessionId}\0${terminalId}`;
    let entry = this.entries.get(key);
    if (!entry) {
      let creating = this.pending.get(key);
      if (!creating) {
        creating = this.create(key, sessionId, terminalId, command).finally(() =>
          this.pending.delete(key),
        );
        this.pending.set(key, creating);
      }
      const made = await creating;
      if (typeof made === "string") {
        if (ws.readyState === OPEN) ws.close(made === "limit" ? 1013 : 1011, made);
        return;
      }
      entry = made;
    }
    if (ws.readyState !== OPEN || entry.closed) return;
    this.connect(entry, ws);
  }

  /** Kill one terminal. Returns false when it was not running. */
  close(sessionId: string, terminalId: string): boolean {
    const entry = this.entries.get(`${sessionId}\0${terminalId}`);
    if (!entry) return false;
    this.kill(entry, 1000, "closed");
    return true;
  }

  closeSession(sessionId: string): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.sessionId === sessionId) this.kill(entry, 1001, "session deleted");
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of [...this.entries.values()]) this.kill(entry, 1001, "server closing");
  }

  private count(sessionId: string): number {
    let n = 0;
    for (const entry of this.entries.values()) if (entry.sessionId === sessionId) n += 1;
    for (const key of this.pending.keys()) if (key.startsWith(`${sessionId}\0`)) n += 1;
    return n;
  }

  private async create(
    key: string,
    sessionId: string,
    terminalId: string,
    raw?: string,
  ): Promise<Entry | string> {
    // Runs before `pending` records this key, so other in-flight creates count but this one does not.
    if (this.count(sessionId) >= this.max) return "limit";
    const resolved = await this.opts.resolve(sessionId).catch(() => undefined);
    if (!resolved?.target) return resolved?.reason ?? "no workspace";
    const parsed = resolveAgentTerminalCommand(raw, resolved.defaultPreset);
    if (!parsed) return "bad command";
    if (this.disposed) return "server closing";
    let child: ChildProcess;
    try {
      child = this.spawnFn(resolved.target, parsed.command);
    } catch {
      return "spawn failed";
    }
    const entry: Entry = {
      key,
      sessionId,
      id: terminalId,
      label: parsed.label,
      command: parsed.command,
      startedAt: new Date().toISOString(),
      child,
      clients: new Set(),
      history: [],
      historyBytes: 0,
      tail: "",
      armed: false,
      waiting: false,
      cooked: this.cooked ? createWindowsCookedLine() : undefined,
      closed: false,
    };
    this.entries.set(key, entry);
    const output = (chunk: Buffer | string) => this.publish(entry, Buffer.from(chunk), true);
    child.stdout?.on("data", output);
    child.stderr?.on("data", output);
    child.on("error", () => this.finish(entry, 1011, "terminal failed"));
    child.on("close", (code: number | null) => {
      if (!entry.closed) {
        this.publish(
          entry,
          Buffer.from(`\r\n[exited${code == null ? "" : ` ${code}`}]\r\n`),
          false,
        );
      }
      this.finish(entry, 1000, "exited");
    });
    return entry;
  }

  private connect(entry: Entry, ws: AgentTerminalClient): void {
    entry.clients.add(ws);
    for (const chunk of entry.history) {
      if (ws.readyState !== OPEN) break;
      ws.send(chunk);
    }
    ws.on("message", (data) => {
      const size = parsePtyResize(data);
      if (size) {
        resizeHostShell(entry.child.pid, size.cols, size.rows);
        return;
      }
      if (entry.closed || !entry.child.stdin || entry.child.killed) return;
      const buf = toBuffer(data);
      this.onInput(entry, buf);
      if (!entry.cooked) {
        entry.child.stdin.write(buf);
        return;
      }
      const next = entry.cooked.feed(buf);
      if (next.echo) this.publish(entry, Buffer.from(next.echo), false);
      if (next.toChild) entry.child.stdin.write(next.toChild);
    });
    const detach = () => entry.clients.delete(ws);
    ws.on("close", detach);
    ws.on("error", detach);
  }

  private onInput(entry: Entry, buf: Buffer): void {
    if (buf.includes(0x0d) || buf.includes(0x0a)) entry.armed = true;
    if (!entry.waiting) return;
    entry.waiting = false;
    if (!this.sessionWaiting(entry.sessionId)) {
      void Promise.resolve(this.opts.attention?.clear(entry.sessionId)).catch(() => undefined);
    }
  }

  private sessionWaiting(sessionId: string): boolean {
    for (const entry of this.entries.values()) {
      if (entry.sessionId === sessionId && entry.waiting) return true;
    }
    return false;
  }

  private publish(entry: Entry, chunk: Buffer, fromChild: boolean): void {
    if (entry.closed || !chunk.length) return;
    const saved = Buffer.from(chunk);
    entry.history.push(saved);
    entry.historyBytes += saved.length;
    while (entry.historyBytes > this.historyLimit && entry.history.length) {
      const first = entry.history[0]!;
      const overflow = entry.historyBytes - this.historyLimit;
      if (first.length <= overflow) {
        entry.history.shift();
        entry.historyBytes -= first.length;
      } else {
        entry.history[0] = first.subarray(overflow);
        entry.historyBytes -= overflow;
      }
    }
    for (const client of entry.clients) {
      if (client.readyState === OPEN) client.send(chunk);
    }
    if (fromChild) this.watchQuiet(entry, chunk);
  }

  /** A bare shell sits on a prompt all day; only agent CLIs raise Needs you. */
  private watchQuiet(entry: Entry, chunk: Buffer): void {
    if (entry.command == null || !this.opts.attention) return;
    entry.tail = (entry.tail + chunk.toString("utf8")).slice(-TAIL_CHARS);
    if (entry.quietTimer) clearTimeout(entry.quietTimer);
    entry.quietTimer = setTimeout(() => {
      entry.quietTimer = undefined;
      if (entry.closed || entry.waiting || !entry.armed) return;
      if (!looksLikeTerminalPrompt(entry.tail)) return;
      const already = this.sessionWaiting(entry.sessionId);
      entry.waiting = true;
      entry.armed = false;
      if (already) return;
      const line = lastTerminalLine(entry.tail);
      void Promise.resolve(this.opts.attention?.flag(entry.sessionId, line)).catch(() => undefined);
    }, this.quietMs);
    entry.quietTimer.unref?.();
  }

  private kill(entry: Entry, code: number, reason: string): void {
    const child = entry.child;
    this.finish(entry, code, reason);
    if (!child.killed) child.kill("SIGTERM");
  }

  private finish(entry: Entry, code?: number, reason?: string): void {
    if (entry.closed) return;
    const wasWaiting = entry.waiting;
    entry.closed = true;
    entry.waiting = false;
    if (entry.quietTimer) clearTimeout(entry.quietTimer);
    this.entries.delete(entry.key);
    for (const client of entry.clients) {
      if (client.readyState === OPEN) client.close(code, reason);
    }
    entry.clients.clear();
    if (wasWaiting && !this.sessionWaiting(entry.sessionId)) {
      void Promise.resolve(this.opts.attention?.clear(entry.sessionId)).catch(() => undefined);
    }
  }
}
