import { randomBytes, randomUUID } from "node:crypto";
import { hostname as osHostname } from "node:os";
import { join, sep } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { Hono } from "hono";
import type { ComputerUseToolName, VmInstance } from "@locus/shared";
import {
  isGuestReady,
  isWindows,
  parsePreviewPort,
  WORKER_PROTOCOL,
  type WorkerHealth,
} from "@locus/shared";
import type { CreateContainerRequest, DockerEngine } from "@locus/hypervisor";
import { startAllowlistProxy, type AllowlistProxy } from "@locus/hypervisor";
import { allowedWorkerCursorCliCommand, spawnWorkerCursorCli } from "./cursorCli.js";
import {
  startWorkerLoopbackMcp,
  writeWorkerLocusMcpConfig,
  WORKER_CLI_MCP_EVENT,
  WORKER_CLI_MCP_TIMEOUT_MS,
  type WorkerLoopbackMcpReply,
} from "./loopbackMcp.js";
import {
  packDirectory,
  unpackDirectory,
  safeWorkerSessionId,
  MAX_WORKER_ARCHIVE_BYTES,
} from "./archive.js";
import { WorkerGuestHub } from "./guests.js";
import { serveWorkerPreview, workerPreviewPath } from "./previewProxy.js";
import { workerTokenMatches } from "./token.js";
import {
  listWorkerWorkspace,
  readWorkerWorkspaceBytes,
  readWorkerWorkspaceFile,
  writeWorkerWorkspaceFile,
  mkdirWorkerWorkspace,
  deleteWorkerWorkspacePath,
} from "./workspaceFs.js";
import { resolveWorkerHostDir } from "./hostDir.js";

export interface WorkerAppOptions {
  engine: DockerEngine;
  token: string;
  name?: string;
  hostname?: string;
  guests?: WorkerGuestHub;
  /** Worker home (`LOCUS_WORKER_HOME`). Needed for host-share dirs. */
  dataDir?: string;
  /** In-memory host-runtime guests. Shared with the browser hub in `main.ts`. */
  hostGuests?: Map<string, VmInstance>;
  onGuestDeleted?: (id: string) => void;
  /** Host-runtime guests run `sh -lc` on this machine. Off unless LOCUS_WORKER_ALLOW_HOST=1. */
  allowHostRuntime?: boolean;
}

export function createWorkerApp(opts: WorkerAppOptions): Hono {
  const guests =
    opts.guests ??
    new WorkerGuestHub({ liveDocker: Boolean(opts.engine.liveEngine), dataDir: opts.dataDir });
  guests.setLiveDocker(Boolean(opts.engine.liveEngine));
  const hostGuests = opts.hostGuests ?? new Map<string, VmInstance>();
  const getGuest = (id: string) => hostGuests.get(id) ?? opts.engine.get(id);
  const listGuests = () => [...hostGuests.values(), ...opts.engine.list()];
  const app = new Hono();
  const jailProxies = new Map<string, AllowlistProxy>();
  const cliMcpPending = new Map<
    string,
    Map<
      string,
      {
        resolve: (reply: WorkerLoopbackMcpReply) => void;
        reject: (err: Error) => void;
      }
    >
  >();

  app.use("/*", async (c, next) => {
    if (c.req.path === "/health") return next();
    const header = c.req.header("authorization") ?? "";
    const provided = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    if (!workerTokenMatches(provided, opts.token)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  });

  app.get("/health", (c) => {
    const body: WorkerHealth = {
      ok: true,
      service: "locus-worker",
      protocol: WORKER_PROTOCOL,
    };
    return c.json(body);
  });

  app.get("/v1/info", (c) => {
    return c.json({
      ok: true,
      service: "locus-worker",
      protocol: WORKER_PROTOCOL,
      name: opts.name,
      hostname: opts.hostname ?? osHostname(),
      docker: opts.engine.kind,
      guests: listGuests().length,
    });
  });

  app.post("/v1/guests", async (c) => {
    const body = (await c.req.json()) as CreateContainerRequest;
    if (body.runtime === "host") {
      try {
        if (!opts.allowHostRuntime) {
          throw new Error(
            "Host-runtime guests are disabled on this worker. Set LOCUS_WORKER_ALLOW_HOST=1 to opt in.",
          );
        }
        if (!opts.dataDir) throw new Error("Worker data directory is missing");
        const sessionId = safeWorkerSessionId(body.sessionId);
        if (!sessionId) throw new Error("Invalid session id");
        const hostDir = resolveWorkerHostDir(body.hostDir, opts.dataDir, sessionId);
        await mkdir(hostDir, { recursive: true });
        const now = new Date().toISOString();
        const os = body.os && !isWindows(body.os) ? body.os : "ubuntu";
        const vm: VmInstance = {
          id: randomUUID(),
          sessionId,
          templateId: body.templateId || "host",
          os,
          name: body.name || sessionId,
          status: "running",
          diskPath: hostDir,
          runtime: "host",
          dockerImage: "host",
          createdAt: now,
          updatedAt: now,
        };
        hostGuests.set(vm.id, vm);
        return c.json(vm, 201);
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : "Failed" }, 400);
      }
    }
    let proxy: AllowlistProxy | undefined;
    try {
      const req: CreateContainerRequest = {
        ...body,
        hostSharePath: undefined,
        workspaceSeed: undefined,
        hostShare: undefined,
      };
      if (body.hostShare) {
        if (!opts.dataDir) throw new Error("Worker data directory is missing");
        const sessionId = safeWorkerSessionId(body.sessionId);
        if (!sessionId) throw new Error("Invalid session id");
        const shareDir = join(opts.dataDir, "host-shares", sessionId);
        await mkdir(shareDir, { recursive: true });
        req.hostSharePath = shareDir;
      }
      if (req.network === "restricted") {
        // host.docker.internal (host-gateway) must reach this from the guest.
        // Random port; do not publish that port. Cloud SG should allow 7421 only.
        // Bind 0.0.0.0 so the docker bridge can connect; require proxy basic auth
        // so a LAN scan of the ephemeral port cannot use the CONNECT tunnel.
        const proxyAuth = randomBytes(16).toString("hex");
        proxy = await startAllowlistProxy(req.allowHosts ?? [], 0, undefined, "0.0.0.0", proxyAuth);
        req.proxyPort = proxy.port;
        req.proxyAuth = proxyAuth;
      }
      const vm = await opts.engine.create(req);
      if (proxy) jailProxies.set(vm.id, proxy);
      return c.json(vm, 201);
    } catch (err) {
      proxy?.close();
      return c.json({ error: err instanceof Error ? err.message : "Failed" }, 400);
    }
  });

  app.get("/v1/guests", (c) => c.json(listGuests()));

  app.get("/v1/guests/:id", (c) => {
    const vm = getGuest(c.req.param("id"));
    if (!vm) return c.json({ error: "Not found" }, 404);
    return c.json(vm);
  });

  app.post("/v1/guests/:id/start", async (c) => {
    const id = c.req.param("id");
    const host = hostGuests.get(id);
    if (host) {
      host.status = "running";
      host.updatedAt = new Date().toISOString();
      return c.json(host);
    }
    try {
      let vm = await opts.engine.start(id);
      vm = await waitReady(opts.engine, vm.id);
      return c.json(vm);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed" }, 400);
    }
  });

  app.post("/v1/guests/:id/stop", async (c) => {
    const id = c.req.param("id");
    const host = hostGuests.get(id);
    if (host) {
      host.status = "stopped";
      host.updatedAt = new Date().toISOString();
      return c.json(host);
    }
    try {
      return c.json(await opts.engine.stop(id));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed" }, 400);
    }
  });

  app.delete("/v1/guests/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const vm = getGuest(id);
      guests.drop(id);
      jailProxies.get(id)?.close();
      jailProxies.delete(id);
      opts.onGuestDeleted?.(id);
      const host = hostGuests.get(id);
      if (host) {
        hostGuests.delete(id);
        const sessionId = safeWorkerSessionId(host.sessionId);
        if (opts.dataDir && sessionId && isDefaultHostWorkspace(opts.dataDir, host.diskPath)) {
          await rm(host.diskPath, { recursive: true, force: true }).catch(() => undefined);
        }
        return c.json({ ok: true });
      }
      await opts.engine.destroy(id);
      const sessionId = safeWorkerSessionId(vm?.sessionId);
      if (opts.dataDir && sessionId) {
        await rm(join(opts.dataDir, "host-shares", sessionId), {
          recursive: true,
          force: true,
        }).catch(() => undefined);
      }
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed" }, 400);
    }
  });

  app.get("/v1/guests/:id/logs", (c) => {
    const id = c.req.param("id");
    if (!getGuest(id)) return c.json({ error: "Not found" }, 404);
    const host = hostGuests.get(id);
    if (host) return c.json({ logs: "" });
    return c.json({ logs: opts.engine.logs(id) });
  });

  app.post("/v1/guests/:id/tools", async (c) => {
    const id = c.req.param("id");
    const vm = getGuest(id);
    if (!vm) return c.json({ error: "Not found" }, 404);
    const body = (await c.req.json()) as { name?: string; args?: Record<string, unknown> };
    if (!body.name) return c.json({ error: "Tool name is required" }, 400);
    try {
      const result = await guests.forVm(vm).execute({
        name: body.name as ComputerUseToolName,
        args: body.args ?? {},
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed" }, 400);
    }
  });

  app.get("/v1/guests/:id/ports", async (c) => {
    const id = c.req.param("id");
    if (!getGuest(id)) return c.json({ error: "Not found" }, 404);
    const ports = opts.engine.listListeningPorts ? await opts.engine.listListeningPorts(id) : [];
    return c.json({ ports });
  });

  app.post("/v1/guests/:id/ports", async (c) => {
    const id = c.req.param("id");
    if (!getGuest(id)) return c.json({ error: "Not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { ports?: unknown };
    const ports = Array.isArray(body.ports)
      ? body.ports.map((row) => parsePreviewPort(row)).filter((row): row is number => !!row)
      : [];
    opts.engine.noteListeningPorts?.(id, ports);
    const listed = opts.engine.listListeningPorts
      ? await opts.engine.listListeningPorts(id)
      : ports;
    return c.json({ ports: listed });
  });

  app.get("/v1/guests/:id/workspace", async (c) => {
    const vm = getGuest(c.req.param("id"));
    if (!vm) return c.json({ error: "Not found" }, 404);
    const root = vm.diskPath?.trim();
    if (!root) return c.json({ error: "No workspace on this worker guest" }, 404);
    const entries = await listWorkerWorkspace(root, c.req.query("path") ?? "");
    return c.json({ entries });
  });

  app.get("/v1/guests/:id/workspace/file", async (c) => {
    const vm = getGuest(c.req.param("id"));
    if (!vm) return c.json({ error: "Not found" }, 404);
    const root = vm.diskPath?.trim();
    if (!root) return c.json({ error: "No workspace on this worker guest" }, 404);
    try {
      const file = await readWorkerWorkspaceFile(root, c.req.query("path") ?? "");
      if (!file) return c.json({ error: "File not found" }, 404);
      return c.json(file);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed" }, 400);
    }
  });

  app.get("/v1/guests/:id/workspace/raw", async (c) => {
    const vm = getGuest(c.req.param("id"));
    if (!vm) return c.json({ error: "Not found" }, 404);
    const root = vm.diskPath?.trim();
    if (!root) return c.json({ error: "No workspace on this worker guest" }, 404);
    try {
      const file = await readWorkerWorkspaceBytes(root, c.req.query("path") ?? "");
      if (!file) return c.json({ error: "File not found" }, 404);
      return c.body(Uint8Array.from(file.bytes), 200, {
        "content-type": file.mime,
        "content-disposition": `inline; filename="${file.path.split("/").pop() ?? "file"}"`,
        "cache-control": "no-store",
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed" }, 400);
    }
  });

  app.put("/v1/guests/:id/workspace/file", async (c) => {
    const vm = getGuest(c.req.param("id"));
    if (!vm) return c.json({ error: "Not found" }, 404);
    const root = vm.diskPath?.trim();
    if (!root) return c.json({ error: "No workspace on this worker guest" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      path?: string;
      content?: string;
      encoding?: string;
    };
    try {
      const raw = body.content ?? "";
      const payload = body.encoding === "base64" ? Buffer.from(raw, "base64") : raw;
      return c.json(await writeWorkerWorkspaceFile(root, body.path ?? "", payload));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed" }, 400);
    }
  });

  app.post("/v1/guests/:id/workspace/mkdir", async (c) => {
    const vm = getGuest(c.req.param("id"));
    if (!vm) return c.json({ error: "Not found" }, 404);
    const root = vm.diskPath?.trim();
    if (!root) return c.json({ error: "No workspace on this worker guest" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { path?: string };
    try {
      return c.json(await mkdirWorkerWorkspace(root, body.path ?? ""), 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed" }, 400);
    }
  });

  app.delete("/v1/guests/:id/workspace/file", async (c) => {
    const vm = getGuest(c.req.param("id"));
    if (!vm) return c.json({ error: "Not found" }, 404);
    const root = vm.diskPath?.trim();
    if (!root) return c.json({ error: "No workspace on this worker guest" }, 404);
    try {
      return c.json(await deleteWorkerWorkspacePath(root, c.req.query("path") ?? ""));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed";
      return c.json({ error: message }, message.includes("not found") ? 404 : 400);
    }
  });

  const putArchive = async (c: import("hono").Context, dest: string | undefined) => {
    if (!dest) return c.json({ error: "No destination on this worker guest" }, 404);
    const buf = Buffer.from(await c.req.arrayBuffer());
    if (buf.length > MAX_WORKER_ARCHIVE_BYTES) {
      return c.json({ error: "Archive is too large" }, 413);
    }
    try {
      await unpackDirectory(buf, dest);
      return c.json({ ok: true, bytes: buf.length });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed" }, 400);
    }
  };

  app.put("/v1/guests/:id/workspace-seed", async (c) => {
    const vm = getGuest(c.req.param("id"));
    if (!vm) return c.json({ error: "Not found" }, 404);
    return putArchive(c, vm.diskPath?.trim());
  });

  app.get("/v1/guests/:id/workspace.tgz", async (c) => {
    const vm = getGuest(c.req.param("id"));
    if (!vm) return c.json({ error: "Not found" }, 404);
    const root = vm.diskPath?.trim();
    if (!root) return c.json({ error: "No workspace on this worker guest" }, 404);
    try {
      const buf = await packDirectory(root);
      return c.body(Uint8Array.from(buf), 200, {
        "content-type": "application/gzip",
        "content-disposition": "attachment; filename=workspace.tgz",
        "cache-control": "no-store",
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed" }, 400);
    }
  });

  app.put("/v1/guests/:id/host-share", async (c) => {
    const vm = getGuest(c.req.param("id"));
    if (!vm) return c.json({ error: "Not found" }, 404);
    const sessionId = safeWorkerSessionId(vm.sessionId);
    if (!opts.dataDir || !sessionId) {
      return c.json({ error: "Guest was not created with a host share" }, 400);
    }
    return putArchive(c, join(opts.dataDir, "host-shares", sessionId));
  });

  const proxyPreview = async (c: import("hono").Context) => {
    const id = c.req.param("id") ?? "";
    const port = c.req.param("port") ?? "";
    const parsed = parsePreviewPort(Number(port));
    if (!parsed) return c.json({ error: "Invalid preview port" }, 400);
    if (!getGuest(id)) return c.json({ error: "Not found" }, 404);
    const url = new URL(c.req.url);
    const body =
      c.req.method === "GET" || c.req.method === "HEAD"
        ? null
        : await c.req.arrayBuffer().catch(() => null);
    return serveWorkerPreview({
      engine: opts.engine,
      id,
      port: parsed,
      path: workerPreviewPath(c.req.path, port),
      search: url.search,
      method: c.req.method,
      headers: c.req.raw.headers,
      body,
    });
  };
  app.all("/v1/guests/:id/preview/:port", proxyPreview);
  app.all("/v1/guests/:id/preview/:port/*", proxyPreview);

  app.post("/v1/guests/:id/cursor-cli", async (c) => {
    const vm = getGuest(c.req.param("id"));
    if (!vm) return c.json({ error: "Not found" }, 404);
    const workspace = vm.diskPath?.trim();
    if (!workspace) return c.json({ error: "No workspace on this worker guest" }, 404);
    const sessionId = vm.sessionId?.trim();
    if (!sessionId) return c.json({ error: "No session on this worker guest" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      command?: string;
      args?: unknown;
      apiKey?: string;
    };
    const command = typeof body.command === "string" ? body.command.trim() : "";
    const args = Array.isArray(body.args)
      ? body.args.filter((row): row is string => typeof row === "string")
      : [];
    if (!command) return c.json({ error: "Cursor CLI command is required" }, 400);
    if (!allowedWorkerCursorCliCommand(command)) {
      return c.json({ error: "Cursor CLI command is not allowed" }, 400);
    }
    const guestId = vm.id;
    const pending = new Map<
      string,
      {
        resolve: (reply: WorkerLoopbackMcpReply) => void;
        reject: (err: Error) => void;
      }
    >();
    cliMcpPending.set(guestId, pending);
    const encoder = new TextEncoder();
    let closed = false;
    let killCli: (() => void) | undefined;
    let closeMcp: (() => Promise<void>) | undefined;
    const failPending = (err: Error) => {
      for (const slot of pending.values()) slot.reject(err);
      pending.clear();
    };
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enqueueLine = (obj: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
          } catch {
            closed = true;
          }
        };
        try {
          const mcp = await startWorkerLoopbackMcp({
            sessionId,
            onRequest: (req) =>
              new Promise<WorkerLoopbackMcpReply>((resolve, reject) => {
                if (closed) {
                  reject(new Error("Cursor CLI MCP stream closed"));
                  return;
                }
                const timer = setTimeout(() => {
                  pending.delete(req.id);
                  reject(new Error("Control plane MCP reply timed out"));
                }, WORKER_CLI_MCP_TIMEOUT_MS);
                pending.set(req.id, {
                  resolve: (reply) => {
                    clearTimeout(timer);
                    resolve(reply);
                  },
                  reject: (err) => {
                    clearTimeout(timer);
                    reject(err);
                  },
                });
                enqueueLine({
                  type: WORKER_CLI_MCP_EVENT,
                  id: req.id,
                  path: req.path,
                  body: req.body,
                });
              }),
          });
          closeMcp = mcp.close;
          await writeWorkerLocusMcpConfig(workspace, mcp.sessionUrl);
          const spawned = spawnWorkerCursorCli(
            {
              command,
              args,
              apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
              gitMcpUrl: mcp.sessionUrl,
            },
            workspace,
            c.req.raw.signal,
          );
          killCli = spawned.kill;
          const reader = spawned.stream.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (closed) break;
              if (value) controller.enqueue(value);
            }
          } finally {
            try {
              await reader.cancel();
            } catch {
              /* ignore */
            }
          }
        } catch (err) {
          enqueueLine({
            type: "error",
            message: err instanceof Error ? err.message : "Worker Cursor CLI MCP failed",
          });
        } finally {
          closed = true;
          failPending(new Error("Cursor CLI MCP stream closed"));
          cliMcpPending.delete(guestId);
          await closeMcp?.().catch(() => undefined);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      },
      cancel() {
        closed = true;
        killCli?.();
        failPending(new Error("Cursor CLI MCP stream closed"));
        cliMcpPending.delete(guestId);
        void closeMcp?.().catch(() => undefined);
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  });

  app.post("/v1/guests/:id/cursor-cli/mcp-reply", async (c) => {
    const pending = cliMcpPending.get(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as {
      id?: unknown;
      status?: unknown;
      body?: unknown;
    };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const slot = id ? pending?.get(id) : undefined;
    if (!slot) return c.json({ error: "Unknown MCP request" }, 404);
    pending?.delete(id);
    const status =
      typeof body.status === "number" && Number.isInteger(body.status) ? body.status : 200;
    slot.resolve({ status, body: body.body });
    return c.json({ ok: true });
  });

  return app;
}

async function waitReady(engine: DockerEngine, id: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const vm = engine.get(id);
    if (!vm) throw new Error("Guest disappeared");
    if (isGuestReady(vm.status) || vm.status === "error" || vm.status === "stopped") return vm;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const last = engine.get(id);
  if (!last) throw new Error("Guest disappeared");
  return last;
}

function isDefaultHostWorkspace(dataDir: string, diskPath: string): boolean {
  const prefix = join(dataDir, "host-workspaces") + sep;
  const normalized = diskPath.endsWith(sep) ? diskPath : `${diskPath}${sep}`;
  return normalized.startsWith(prefix);
}
