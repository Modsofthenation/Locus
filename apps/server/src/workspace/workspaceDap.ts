import { createConnection, type Socket } from "node:net";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { basename } from "node:path";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

export type DapStackFrame = {
  id: number;
  name: string;
  path: string;
  line: number;
};

export type DapVariable = { name: string; value: string };

export type DapPauseInfo = {
  stack: DapStackFrame[];
  variables: DapVariable[];
};

/**
 * Minimal Debug Adapter Protocol client over TCP (debugpy --listen).
 * Framing matches LSP Content-Length packets.
 */
export class DapClient {
  private seq = 0;
  private buf = Buffer.alloc(0);
  private pending = new Map<number, Pending>();
  private socket: Socket | undefined;
  private onStopped: ((info: DapPauseInfo) => void) | undefined;
  private onContinued: (() => void) | undefined;
  private threadId = 1;

  static async connect(host: string, port: number, timeoutMs = 8_000): Promise<DapClient> {
    const client = new DapClient();
    await client.open(host, port, timeoutMs);
    return client;
  }

  onPause(handler: (info: DapPauseInfo) => void): void {
    this.onStopped = handler;
  }

  onResume(handler: () => void): void {
    this.onContinued = handler;
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientID: "locus",
      clientName: "Locus",
      adapterID: "python",
      pathFormat: "path",
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsVariablePaging: false,
    });
  }

  async attach(): Promise<void> {
    await this.request("attach", {});
  }

  async setBreakpoints(path: string, lines: number[]): Promise<void> {
    await this.request("setBreakpoints", {
      source: { path },
      breakpoints: lines.map((line) => ({ line })),
    });
  }

  async configurationDone(): Promise<void> {
    await this.request("configurationDone", {});
  }

  async continue(): Promise<void> {
    await this.request("continue", { threadId: this.threadId });
  }

  async stepOver(): Promise<void> {
    await this.request("next", { threadId: this.threadId });
  }

  async stepInto(): Promise<void> {
    await this.request("stepIn", { threadId: this.threadId });
  }

  async stepOut(): Promise<void> {
    await this.request("stepOut", { threadId: this.threadId });
  }

  async disconnect(): Promise<void> {
    try {
      await this.request("disconnect", { terminateDebuggee: true }, 3_000);
    } catch {
      /* ignore */
    }
    this.close();
  }

  close(): void {
    try {
      this.socket?.destroy();
    } catch {
      /* ignore */
    }
    this.socket = undefined;
    this.failAll(new Error("DAP closed"));
  }

  private open(host: string, port: number, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("DAP connect timed out"));
      }, timeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        this.socket = socket;
        socket.on("data", (chunk: Buffer | string) =>
          this.onData(typeof chunk === "string" ? Buffer.from(chunk) : chunk),
        );
        socket.on("error", (err) =>
          this.failAll(err instanceof Error ? err : new Error(String(err))),
        );
        socket.on("close", () => this.failAll(new Error("DAP socket closed")));
        resolve();
      });
      socket.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private async request(
    command: string,
    args: Record<string, unknown>,
    timeoutMs = 12_000,
  ): Promise<unknown> {
    const seq = ++this.seq;
    this.send({ seq, type: "request", command, arguments: args });
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`${command} timed out`));
      }, timeoutMs);
      this.pending.set(seq, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  private send(payload: unknown): void {
    if (!this.socket) throw new Error("DAP is not connected");
    const json = JSON.stringify(payload);
    this.socket.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const headerEnd = this.buf.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buf.subarray(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buf = this.buf.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buf.length < start + length) return;
      const body = this.buf.subarray(start, start + length).toString("utf8");
      this.buf = this.buf.subarray(start + length);
      try {
        this.onMessage(JSON.parse(body) as Record<string, unknown>);
      } catch {
        /* skip */
      }
    }
  }

  private onMessage(msg: Record<string, unknown>): void {
    if (msg.type === "response" && typeof msg.request_seq === "number") {
      const pending = this.pending.get(msg.request_seq);
      if (!pending) return;
      this.pending.delete(msg.request_seq);
      if (msg.success === false) {
        const message =
          typeof msg.message === "string"
            ? msg.message
            : ((msg.body as { error?: { format?: string } } | undefined)?.error?.format ??
              "DAP error");
        pending.reject(new Error(message));
      } else pending.resolve(msg.body);
      return;
    }
    if (msg.type === "event") {
      const event = String(msg.event ?? "");
      const body = (msg.body ?? {}) as Record<string, unknown>;
      if (event === "stopped") {
        if (typeof body.threadId === "number") this.threadId = body.threadId;
        void this.collectPause().then((info) => this.onStopped?.(info));
      }
      if (event === "continued") this.onContinued?.();
      if (event === "terminated" || event === "exited") this.onContinued?.();
    }
  }

  private async collectPause(): Promise<DapPauseInfo> {
    const stack: DapStackFrame[] = [];
    const variables: DapVariable[] = [];
    try {
      const frames = (await this.request("stackTrace", {
        threadId: this.threadId,
        startFrame: 0,
        levels: 24,
      })) as {
        stackFrames?: Array<{
          id?: number;
          name?: string;
          line?: number;
          source?: { path?: string };
        }>;
      };
      for (const frame of frames.stackFrames ?? []) {
        stack.push({
          id: frame.id ?? stack.length,
          name: frame.name || "(anonymous)",
          path: frame.source?.path ?? "",
          line: frame.line ?? 0,
        });
      }
      const top = frames.stackFrames?.[0];
      if (top?.id != null) {
        const scopes = (await this.request("scopes", { frameId: top.id })) as {
          scopes?: Array<{ variablesReference?: number; name?: string }>;
        };
        const local =
          scopes.scopes?.find((row) => /local/i.test(row.name ?? "")) ?? scopes.scopes?.[0];
        if (local?.variablesReference) {
          const vars = (await this.request("variables", {
            variablesReference: local.variablesReference,
          })) as { variables?: Array<{ name?: string; value?: string }> };
          for (const row of vars.variables ?? []) {
            if (!row.name) continue;
            variables.push({ name: row.name, value: String(row.value ?? "") });
            if (variables.length >= 40) break;
          }
        }
      }
    } catch {
      /* best-effort pause info */
    }
    return { stack, variables };
  }

  private failAll(err: Error): void {
    for (const pending of this.pending.values()) pending.reject(err);
    this.pending.clear();
  }
}

export function resolvePythonBin(): string {
  return process.env.LOCUS_PYTHON?.trim() || (process.platform === "win32" ? "python" : "python3");
}

export function parseDebugpyListen(text: string): { host: string; port: number } | undefined {
  const labeled = text.match(
    /Listening for debug(?:py)? clients?.*?((?:127\.0\.0\.1|::1|localhost)):(\d+)/i,
  );
  const fallback = text.match(/\b(127\.0\.0\.1|::1):(\d+)\b/);
  const match = labeled ?? fallback;
  if (!match?.[1] || !match[2]) return undefined;
  const host = match[1] === "localhost" ? "127.0.0.1" : match[1];
  return { host, port: Number(match[2]) };
}

export async function startDebugpy(
  cwd: string,
  programAbs: string,
): Promise<{ child: ChildProcessWithoutNullStreams; host: string; port: number }> {
  const python = resolvePythonBin();
  const child = spawn(
    python,
    ["-m", "debugpy", "--listen", "127.0.0.1:0", "--wait-for-client", programAbs],
    {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  ) as ChildProcessWithoutNullStreams;
  const endpoint = await listenOrKillDebugpy(child);
  return { child, host: endpoint.host, port: endpoint.port };
}

export async function listenOrKillDebugpy(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = 10_000,
): Promise<{ host: string; port: number }> {
  try {
    return await waitDebugpyListen(child, timeoutMs);
  } catch (err) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    throw err;
  }
}

export function waitDebugpyListen(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = 10_000,
): Promise<{ host: string; port: number }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stderr.off("data", onData);
      child.stdout.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error("debugpy did not start listening"))),
      timeoutMs,
    );
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const endpoint = parseDebugpyListen(text);
      if (endpoint) {
        finish(() => resolve(endpoint));
        return;
      }
      if (/No module named ['"]?debugpy['"]?/i.test(text)) {
        finish(() =>
          reject(
            new Error(
              "Python debugger needs debugpy (pip install debugpy). Or set LOCUS_PYTHON to an env that has it.",
            ),
          ),
        );
      }
    };
    const onError = (err: Error) => finish(() => reject(err));
    const onExit = (code: number | null) => {
      finish(() =>
        reject(
          new Error(
            code === 1
              ? `debugpy exited — install with: ${resolvePythonBin()} -m pip install debugpy`
              : `debugpy exited (${code ?? "unknown"})`,
          ),
        ),
      );
    };
    child.stderr.on("data", onData);
    child.stdout.on("data", onData);
    child.on("error", onError);
    child.on("exit", onExit);
  });
}

export function programBasename(abs: string): string {
  return basename(abs);
}
