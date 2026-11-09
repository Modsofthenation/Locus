import type { GuestOs, VmInstance, WorkerBackend } from "@locus/shared";
import { WORKER_PLANE_HEADER } from "@locus/shared";
import type { CreateContainerRequest } from "@locus/hypervisor";
import type { ChromiumDriver, GuestRuntime, ToolRequest, ToolResult } from "@locus/guest-agent";
import { isWorkerHealth, parseWorkerFingerprint } from "@locus/shared";
import { WorkerBrowserDriver } from "./browserDriver.js";
import { packDirectory } from "./archive.js";
import { pinnedHttpsFetch, pinnedHttpsWebSocket } from "./tls.js";
import type { WebSocket } from "ws";

const HEALTH_TIMEOUT_MS = 8_000;

export class WorkerClient {
  readonly kind = "docker" as const;
  planeId?: string;
  private cache = new Map<string, VmInstance>();
  private resolvedFingerprint?: string;
  private observedFingerprint?: string;

  constructor(
    readonly backend: WorkerBackend,
    private readonly fetchFn?: typeof fetch,
    private readonly wsConnect?: (
      id: string,
      onMessage: (raw: string) => void,
    ) => Promise<WebSocket>,
  ) {
    this.resolvedFingerprint = parseWorkerFingerprint(backend.fingerprint);
  }

  private url(path: string): string {
    return `${this.backend.url.replace(/\/+$/, "")}${path}`;
  }

  private guestPath(id: string, rest = ""): string {
    return `/v1/guests/${encodeURIComponent(id)}${rest}`;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.backend.token ?? ""}`,
      "content-type": "application/json",
      ...(this.planeId ? { [WORKER_PLANE_HEADER]: this.planeId } : {}),
    };
  }

  private pin(): string | undefined {
    return this.resolvedFingerprint ?? parseWorkerFingerprint(this.backend.fingerprint);
  }

  private async request(url: string, init: RequestInit, tofu = false): Promise<Response> {
    if (
      !url.startsWith("https:") &&
      !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/i.test(url)
    ) {
      throw new Error("Worker URL must be https");
    }
    const pin = this.pin();
    if (!pin && !tofu && url.startsWith("https:")) {
      throw new Error("Test connection in Settings → Workers to pin this worker's TLS fingerprint");
    }
    if (this.fetchFn) return this.fetchFn(url, init);
    try {
      const result = await pinnedHttpsFetch(url, init, pin);
      if (tofu) this.observedFingerprint = result.fingerprint;
      else this.resolvedFingerprint = result.fingerprint;
      return result.response;
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new Error("Worker did not respond within 8s");
      }
      throw err;
    }
  }

  async health(): Promise<{
    ok: true;
    docker?: "mock" | "docker";
    hostname?: string;
    name?: string;
    fingerprint?: string;
  }> {
    let res: Response;
    try {
      res = await this.request(
        this.url("/v1/info"),
        {
          headers: this.headers(),
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        },
        true,
      );
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new Error("Worker did not respond within 8s");
      }
      throw err;
    }
    const body = (await res.json()) as unknown;
    if (!res.ok || !isWorkerHealth(body)) {
      throw new Error(errorMessage(body, "Worker health check failed"));
    }
    return { ...body, fingerprint: this.pin() ?? this.observedFingerprint };
  }

  async create(req: CreateContainerRequest): Promise<VmInstance> {
    const vm = await this.json<VmInstance>("POST", "/v1/guests", req, 201);
    this.remember(vm);
    return vm;
  }

  async start(id: string): Promise<VmInstance> {
    const vm = await this.json<VmInstance>("POST", this.guestPath(id, "/start"));
    this.remember(vm);
    return vm;
  }

  async stop(id: string): Promise<VmInstance> {
    const vm = await this.json<VmInstance>("POST", this.guestPath(id, "/stop"));
    this.remember(vm);
    return vm;
  }

  async destroy(id: string): Promise<void> {
    await this.json<{ ok: boolean }>("DELETE", this.guestPath(id));
    this.cache.delete(id);
  }

  async execute(id: string, req: ToolRequest, signal?: AbortSignal): Promise<ToolResult> {
    return this.json<ToolResult>(
      "POST",
      this.guestPath(id, "/tools"),
      { name: req.name, args: req.args },
      200,
      signal,
    );
  }

  async listListeningPorts(id: string): Promise<number[]> {
    const body = await this.json<{ ports?: number[] }>("GET", this.guestPath(id, "/ports"));
    return Array.isArray(body.ports) ? body.ports : [];
  }

  async noteListeningPorts(id: string, ports: number[]): Promise<number[]> {
    const body = await this.json<{ ports?: number[] }>("POST", this.guestPath(id, "/ports"), {
      ports,
    });
    return Array.isArray(body.ports) ? body.ports : ports;
  }

  async listWorkspace(
    id: string,
    rel?: string,
  ): Promise<{ name: string; path: string; type: "file" | "dir"; size?: number }[]> {
    const q = rel?.trim() ? `?path=${encodeURIComponent(rel.trim())}` : "";
    const body = await this.json<{
      entries?: { name: string; path: string; type: "file" | "dir"; size?: number }[];
    }>("GET", this.guestPath(id, `/workspace${q}`));
    return Array.isArray(body.entries) ? body.entries : [];
  }

  async readWorkspace(
    id: string,
    rel: string,
  ): Promise<{ path: string; content: string; mtime: string }> {
    return this.json("GET", this.guestPath(id, `/workspace/file?path=${encodeURIComponent(rel)}`));
  }

  async readWorkspaceRaw(
    id: string,
    rel: string,
  ): Promise<{ path: string; bytes: Buffer; mime: string; mtime: string }> {
    const res = await this.request(
      this.url(this.guestPath(id, `/workspace/raw?path=${encodeURIComponent(rel)}`)),
      {
        method: "GET",
        headers: this.headers(),
      },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || `Worker GET workspace/raw failed (${res.status})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      path: rel,
      bytes: buf,
      mime: res.headers.get("content-type") || "application/octet-stream",
      mtime: new Date().toISOString(),
    };
  }

  async writeWorkspace(
    id: string,
    rel: string,
    content: string,
    encoding?: "utf8" | "base64",
  ): Promise<{ path: string; mtime: string }> {
    return this.json("PUT", this.guestPath(id, "/workspace/file"), {
      path: rel,
      content,
      ...(encoding && encoding !== "utf8" ? { encoding } : {}),
    });
  }

  async mkdirWorkspace(id: string, rel: string): Promise<{ path: string }> {
    return this.json("POST", this.guestPath(id, "/workspace/mkdir"), { path: rel });
  }

  async deleteWorkspace(id: string, rel: string): Promise<{ path: string }> {
    return this.json(
      "DELETE",
      this.guestPath(id, `/workspace/file?path=${encodeURIComponent(rel)}`),
    );
  }

  async hasGoldenDisk(imageId: string): Promise<{ path: string; bytes: number } | undefined> {
    try {
      const body = await this.json<{ path?: string; bytes?: number }>(
        "GET",
        `/v1/images/${encodeURIComponent(imageId)}`,
      );
      if (typeof body.path === "string" && body.path && typeof body.bytes === "number") {
        return { path: body.path, bytes: body.bytes };
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  async uploadGoldenDisk(
    imageId: string,
    filePath: string,
  ): Promise<{ path: string; bytes: number }> {
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(filePath);
    const res = await this.request(this.url(`/v1/images/${encodeURIComponent(imageId)}`), {
      method: "PUT",
      headers: {
        authorization: `Bearer ${this.backend.token ?? ""}`,
        "content-type": "application/octet-stream",
        ...(this.planeId ? { [WORKER_PLANE_HEADER]: this.planeId } : {}),
      },
      body: buf,
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      path?: string;
      bytes?: number;
    };
    if (!res.ok) throw new Error(data.error || `Worker golden disk upload failed (${res.status})`);
    return { path: data.path ?? "", bytes: data.bytes ?? buf.length };
  }

  async uploadTree(id: string, kind: "workspace-seed" | "host-share", dir: string): Promise<void> {
    const archive = await packDirectory(dir);
    const res = await this.request(this.url(this.guestPath(id, `/${kind}`)), {
      method: "PUT",
      headers: {
        authorization: `Bearer ${this.backend.token ?? ""}`,
        "content-type": "application/gzip",
      },
      body: archive,
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || `Worker ${kind} upload failed (${res.status})`);
    }
  }

  async downloadWorkspace(id: string): Promise<Buffer> {
    const res = await this.request(this.url(this.guestPath(id, "/workspace.tgz")), {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || `Worker workspace download failed (${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async proxyPreview(opts: {
    id: string;
    port: number;
    path: string;
    search: string;
    method: string;
    headers: Headers;
    body?: ArrayBuffer | null;
  }): Promise<Response> {
    const suffix = opts.path === "/" ? "/" : opts.path;
    const headers = new Headers();
    opts.headers.forEach((value, key) => {
      const name = key.toLowerCase();
      if (
        name === "authorization" ||
        name === "cookie" ||
        name === "host" ||
        name === "content-length"
      ) {
        return;
      }
      headers.set(key, value);
    });
    headers.set("authorization", `Bearer ${this.backend.token ?? ""}`);
    const res = await this.request(
      this.url(this.guestPath(opts.id, `/preview/${opts.port}${suffix}${opts.search}`)),
      {
        method: opts.method,
        headers,
        body: opts.body && opts.method !== "GET" && opts.method !== "HEAD" ? opts.body : undefined,
      },
    );
    return res;
  }

  async streamCursorCli(
    id: string,
    input: { command: string; args: string[]; apiKey?: string },
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const res = await this.request(this.url(this.guestPath(id, "/cursor-cli")), {
      method: "POST",
      headers: this.headers(),
      signal,
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || `Worker cursor-cli failed (${res.status})`);
    }
    if (!res.body) throw new Error("Worker cursor-cli produced no stream");
    return res.body;
  }

  async replyCursorCliMcp(
    id: string,
    input: { id: string; status: number; body?: unknown },
  ): Promise<void> {
    await this.json("POST", this.guestPath(id, "/cursor-cli/mcp-reply"), {
      id: input.id,
      status: input.status,
      body: input.body ?? null,
    });
  }

  async logs(id: string): Promise<string> {
    const body = await this.json<{ logs?: string }>("GET", this.guestPath(id, "/logs"));
    return body.logs ?? "";
  }

  async refresh(id: string): Promise<VmInstance | undefined> {
    try {
      const vm = await this.json<VmInstance>("GET", this.guestPath(id));
      this.remember(vm);
      return vm;
    } catch {
      return this.cache.get(id);
    }
  }

  get(id: string): VmInstance | undefined {
    return this.cache.get(id);
  }

  list(): VmInstance[] {
    return [...this.cache.values()];
  }

  async listGuests(): Promise<VmInstance[]> {
    const rows = await this.json<VmInstance[]>("GET", "/v1/guests");
    if (!Array.isArray(rows)) return this.list();
    const ids = new Set(rows.map((row) => row.id));
    for (const id of this.cache.keys()) {
      if (!ids.has(id)) this.cache.delete(id);
    }
    for (const vm of rows) this.remember(vm);
    return this.list();
  }

  guestRuntime(id: string, os: GuestOs): GuestRuntime {
    return new WorkerGuestRuntime(this, id, os);
  }

  browserDriver(id: string): WorkerBrowserDriver {
    return new WorkerBrowserDriver(this, id);
  }

  async openDisplaySocket(
    id: string,
    onMessage: (raw: Buffer | string) => void,
  ): Promise<WebSocket> {
    const path = this.guestPath(id, "/display");
    const wsUrl = this.url(path)
      .replace(/^https:/, "wss:")
      .replace(/^http:/, "ws:");
    return pinnedHttpsWebSocket(wsUrl, {
      headers: this.headers(),
      fingerprint: this.pin(),
      binary: true,
      onMessage,
    });
  }

  async openBrowserSocket(id: string, onMessage: (raw: string) => void): Promise<WebSocket> {
    if (this.wsConnect) return this.wsConnect(id, onMessage);
    const path = this.guestPath(id, "/browser");
    const wsUrl = this.url(path)
      .replace(/^https:/, "wss:")
      .replace(/^http:/, "ws:");
    return pinnedHttpsWebSocket(wsUrl, {
      headers: this.headers(),
      fingerprint: this.pin(),
      onMessage: (raw) => onMessage(String(raw)),
    });
  }

  private remember(vm: VmInstance): void {
    this.cache.set(vm.id, {
      ...vm,
      backendId: this.backend.id,
      diskPath: "",
      display: vm.display ? { ...vm.display, host: "" } : undefined,
    });
  }

  private async json<T>(
    method: string,
    path: string,
    body?: unknown,
    ok = 200,
    signal?: AbortSignal,
  ): Promise<T> {
    const res = await this.request(this.url(path), {
      method,
      headers: this.headers(),
      signal,
      body:
        body === undefined || method === "GET" || method === "DELETE"
          ? undefined
          : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (res.status !== ok && (res.status < 200 || res.status >= 300)) {
      throw new Error(data.error || `Worker ${method} ${path} failed (${res.status})`);
    }
    return data;
  }
}

export class WorkerGuestRuntime implements GuestRuntime {
  private browser?: ChromiumDriver;

  constructor(
    private readonly client: WorkerClient,
    private readonly vmId: string,
    readonly os: GuestOs,
  ) {}

  execute(req: ToolRequest, signal?: AbortSignal): Promise<ToolResult> {
    return this.client.execute(this.vmId, req, signal);
  }

  async syncHostDirToGuest(_hostDir: string, _guestDir: string): Promise<void> {}

  async prepareHostWorkspace(): Promise<void> {}

  chromium(): ChromiumDriver {
    this.browser ??= this.client.browserDriver(this.vmId);
    return this.browser;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return fallback;
}
