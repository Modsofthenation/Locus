import type { AgentSession, SessionPreviewStatus, VmInstance } from "@locus/shared";
import {
  isGuestReady,
  isPreviewTargetHost,
  parsePreviewPort,
  pickPreviewPort,
  previewProxyPath,
  sanitizePreviewPath,
  sessionRuntime,
  uniquePreviewPorts,
  withPickHook,
} from "@locus/shared";
import { dockerWorkspaceDir, type DockerEngine } from "@locus/hypervisor";
import type { ToolResult } from "@locus/guest-agent";
import type { WorkerClient } from "@locus/worker";
import type { Hub } from "../core/hub.js";
import type { JsonStore } from "../core/store.js";
import { listHostHttpPorts } from "../workspace/hostPreview.js";
import { withBaseHref, type PreviewTarget } from "../runtime/preview.js";

const PREVIEW_RUNTIME_ERROR =
  "Live HTTP preview is for Docker and Host agents. Use the VM desktop or a forwarded port instead.";

export type SessionPreviewPorts = {
  require: (sessionId: string) => Promise<AgentSession>;
  getMachine: (id: string) => VmInstance | undefined;
  isWorker: (session: { placement?: AgentSession["placement"] }) => boolean;
  requireWorker: (session: AgentSession) => Promise<WorkerClient>;
  docker: Pick<DockerEngine, "listListeningPorts" | "inspectAddress" | "noteListeningPorts">;
  store: JsonStore;
  hub: Hub;
};

/** Session preview status, target resolution, worker proxy, and the preview tool. */
export class SessionPreview {
  constructor(private readonly ports: SessionPreviewPorts) {}

  async status(sessionId: string): Promise<SessionPreviewStatus> {
    const session = await this.ports.require(sessionId);
    const runtime = sessionRuntime(session);
    if (runtime === "host") {
      const scanned = await listHostHttpPorts();
      const ports = uniquePreviewPorts([...scanned, session.preview?.port ?? 0]);
      const path = sanitizePreviewPath(session.preview?.path);
      const port = pickPreviewPort(ports, session.preview?.port);
      return {
        ports,
        active: port ? { port, path, url: previewProxyPath(sessionId, port, path) } : undefined,
      };
    }
    if (runtime !== "docker") throw new Error(PREVIEW_RUNTIME_ERROR);
    const vm = session.vmId ? this.ports.getMachine(session.vmId) : undefined;
    if (!isGuestReady(vm?.status)) return { ports: [] };
    let scanned: number[] = [];
    if (this.ports.isWorker(session) && session.vmId) {
      try {
        const client = await this.ports.requireWorker(session);
        scanned = await client.listListeningPorts(session.vmId);
      } catch {
        scanned = [];
      }
    } else {
      scanned =
        vm && this.ports.docker.listListeningPorts
          ? await this.ports.docker.listListeningPorts(vm.id)
          : [];
    }
    const ports = uniquePreviewPorts([...scanned, session.preview?.port ?? 0]);
    const path = sanitizePreviewPath(session.preview?.path);
    const port = pickPreviewPort(ports, session.preview?.port);
    return {
      ports,
      active: port ? { port, path, url: previewProxyPath(sessionId, port, path) } : undefined,
    };
  }

  async target(sessionId: string, rawPort: number): Promise<PreviewTarget> {
    const session = await this.ports.require(sessionId);
    const runtime = sessionRuntime(session);
    const port = parsePreviewPort(rawPort);
    if (!port) throw new Error("Invalid preview port");
    if (runtime === "host") {
      const status = await this.status(sessionId);
      if (!status.ports.includes(port) && session.preview?.port !== port) {
        throw new Error("That port is not listening on this machine");
      }
      return { kind: "http", host: "127.0.0.1", port };
    }
    if (runtime !== "docker") throw new Error(PREVIEW_RUNTIME_ERROR);
    const status = await this.status(sessionId);
    if (!status.ports.includes(port) && session.preview?.port !== port) {
      throw new Error("That port is not listening in the container");
    }
    if (this.ports.isWorker(session)) return { kind: "worker" };
    const vm = session.vmId ? this.ports.getMachine(session.vmId) : undefined;
    const host =
      vm && this.ports.docker.inspectAddress
        ? await this.ports.docker.inspectAddress(vm.id)
        : undefined;
    if (host && isPreviewTargetHost(host)) return { kind: "http", host, port };
    const root = vm?.diskPath?.trim() || dockerWorkspaceDir(this.ports.store.dataDir, session.id);
    return { kind: "static", root };
  }

  async proxyWorker(
    sessionId: string,
    rawPort: string,
    req: {
      path: string;
      url: string;
      method: string;
      headers: Headers;
      arrayBuffer: () => Promise<ArrayBuffer>;
    },
  ): Promise<Response> {
    const session = await this.ports.require(sessionId);
    if (!this.ports.isWorker(session) || !session.vmId) {
      throw new Error("Preview tunnels stay on this machine");
    }
    const port = parsePreviewPort(Number(rawPort));
    if (!port) throw new Error("Invalid preview port");
    const client = await this.ports.requireWorker(session);
    const url = new URL(req.url, "http://127.0.0.1");
    const pick = url.searchParams.get("locus_pick") === "1";
    url.searchParams.delete("locus_pick");
    const prefix = `/preview-http/${rawPort}`;
    const idx = req.path.indexOf(prefix);
    const rest = idx >= 0 ? req.path.slice(idx + prefix.length) : "";
    const path = sanitizePreviewPath(rest || "/");
    const body =
      req.method === "GET" || req.method === "HEAD"
        ? null
        : await req.arrayBuffer().catch(() => null);
    const upstream = await client.proxyPreview({
      id: session.vmId,
      port,
      path,
      search: url.search,
      method: req.method,
      headers: req.headers,
      body,
    });
    const proxyPrefix = `/api/sessions/${encodeURIComponent(sessionId)}/preview-http/${port}`;
    const headers = new Headers();
    upstream.headers.forEach((value, key) => {
      const name = key.toLowerCase();
      if (
        name === "connection" ||
        name === "keep-alive" ||
        name === "proxy-authenticate" ||
        name === "proxy-authorization" ||
        name === "te" ||
        name === "trailer" ||
        name === "transfer-encoding" ||
        name === "upgrade" ||
        name === "content-length" ||
        name === "content-encoding"
      ) {
        return;
      }
      if (name === "location" && value.startsWith("/")) {
        headers.set(key, `${proxyPrefix.replace(/\/$/, "")}${value}`);
        return;
      }
      headers.set(key, value);
    });
    headers.set("cache-control", "no-store");
    const type = (upstream.headers.get("content-type") ?? "").toLowerCase();
    if (type.includes("text/html")) {
      let html = await upstream.text();
      html = withBaseHref(html, proxyPrefix);
      if (pick) html = withPickHook(html);
      return new Response(html, { status: upstream.status, headers });
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  async open(
    session: AgentSession,
    vm: VmInstance,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    if (sessionRuntime(session) !== "docker") {
      return { ok: false, output: "preview is only available on Docker agents" };
    }
    const port = parsePreviewPort(args.port);
    if (!port) return { ok: false, output: "port is required (a listening HTTP port, not SSH)" };
    const path = sanitizePreviewPath(typeof args.path === "string" ? args.path : "/");
    if (this.ports.isWorker(session)) {
      try {
        const client = await this.ports.requireWorker(session);
        await client.noteListeningPorts(vm.id, [port]);
      } catch {
        /* session.preview still drives the tab */
      }
    } else {
      this.ports.docker.noteListeningPorts?.(vm.id, [port]);
    }
    const updated = await this.ports.store.mutateSession(session.id, (current) => {
      current.preview = path === "/" ? { port } : { port, path };
    });
    if (updated) this.ports.hub.broadcast({ type: "session.updated", session: updated });
    return {
      ok: true,
      output: `Previewing :${port}${path} in the guest pane (Desktop / Tablet / Phone). Bind the server to 0.0.0.0.`,
    };
  }
}
