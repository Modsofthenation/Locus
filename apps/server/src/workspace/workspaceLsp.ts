import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { pathToFileURL } from "node:url";

export type LspPosition = { line: number; character: number };
export type LspRange = { start: LspPosition; end: LspPosition };

export type LspTextEdit = {
  range: LspRange;
  newText: string;
};

export type LspDiagnostic = {
  range: LspRange;
  message: string;
  severity?: number;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

export class LspClient {
  private seq = 0;
  private buf = Buffer.alloc(0);
  private pending = new Map<number, Pending>();
  private diagnostics = new Map<string, LspDiagnostic[]>();
  private ready: Promise<void>;
  private initOptions: Record<string, unknown> | undefined;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.child.stderr?.on("data", () => undefined);
    this.child.on("error", (err) => this.failAll(err));
    this.child.on("exit", () => this.failAll(new Error("language server exited")));
    this.ready = Promise.resolve();
  }

  static spawn(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): LspClient {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    return new LspClient(child);
  }

  async initialize(
    root: string,
    initializationOptions?: Record<string, unknown>,
  ): Promise<unknown> {
    this.initOptions = initializationOptions;
    const rootUri = pathToFileURL(root).href;
    const result = await this.request("initialize", {
      processId: process.pid,
      rootUri,
      rootPath: root,
      capabilities: {
        textDocument: {
          synchronization: { didSave: true, dynamicRegistration: false },
          completion: {
            completionItem: {
              snippetSupport: true,
              resolveSupport: { properties: ["additionalTextEdits", "detail"] },
            },
          },
          hover: {},
          definition: {},
          references: {},
          rename: {},
          codeAction: {},
          publishDiagnostics: {},
          signatureHelp: {},
          formatting: {},
        },
        workspace: { configuration: true },
      },
      initializationOptions,
      workspaceFolders: [{ uri: rootUri, name: "workspace" }],
    });
    this.notify("initialized", {});
    return result;
  }

  didOpen(uri: string, languageId: string, text: string, version = 1): void {
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId, version, text },
    });
  }

  didChange(uri: string, text: string, version: number): void {
    this.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  diagnosticsFor(uri: string): LspDiagnostic[] {
    return this.diagnostics.get(uri) ?? [];
  }

  async request(method: string, params: unknown, timeoutMs = 12_000): Promise<unknown> {
    const id = ++this.seq;
    this.send({ jsonrpc: "2.0", id, method, params });
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
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

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  async shutdown(): Promise<void> {
    try {
      await this.request("shutdown", null, 3_000);
      this.notify("exit", null);
    } catch {
      /* ignore */
    }
    this.kill();
  }

  kill(): void {
    try {
      this.child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    this.failAll(new Error("language server closed"));
  }

  private send(payload: unknown): void {
    const json = JSON.stringify(payload);
    const packet = Buffer.from(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
    this.child.stdin.write(packet);
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
        /* skip malformed */
      }
    }
  }

  private onMessage(msg: Record<string, unknown>): void {
    if (typeof msg.id === "number" && this.pending.has(msg.id)) {
      const pending = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) {
        const err = msg.error as { message?: string };
        pending.reject(new Error(err.message ?? "LSP error"));
      } else pending.resolve(msg.result);
      return;
    }
    if (msg.method === "textDocument/publishDiagnostics") {
      const params = msg.params as { uri?: string; diagnostics?: LspDiagnostic[] };
      if (params?.uri) this.diagnostics.set(params.uri, params.diagnostics ?? []);
    }
    if (typeof msg.id === "number" && typeof msg.method === "string") {
      if (msg.method === "workspace/configuration") {
        const items = (msg.params as { items?: Array<{ section?: string }> } | undefined)
          ?.items ?? [{}];
        const result = items.map((item) => this.configFor(item.section));
        this.send({ jsonrpc: "2.0", id: msg.id, result });
        return;
      }
      this.send({ jsonrpc: "2.0", id: msg.id, result: null });
    }
  }

  private configFor(section?: string): unknown {
    const opts = this.initOptions ?? {};
    if (!section) return opts;
    if (Object.prototype.hasOwnProperty.call(opts, section)) return opts[section];
    return {};
  }

  private failAll(err: Error): void {
    for (const pending of this.pending.values()) pending.reject(err);
    this.pending.clear();
  }

  get started(): Promise<void> {
    return this.ready;
  }
}
