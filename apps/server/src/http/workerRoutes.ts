import type { Hono } from "hono";
import type { LocusConfig } from "@locus/shared";
import {
  isLoopbackHost,
  isMaskedSecret,
  normalizeWorkerUrl,
  parseWorkerAddBlob,
  parseWorkerFingerprint,
  workerBackendError,
  workerKind,
} from "@locus/shared";
import { WorkerClient } from "@locus/worker";
import { isLocalOperator } from "../core/localguard.js";
import { redactConfig } from "../core/redact.js";
import type { JsonStore } from "../core/store.js";
import type { SessionService } from "../session/sessions.js";
import type { HostCapabilities } from "@locus/hypervisor";

export function registerWorkerRoutes(
  app: Hono,
  opts: {
    store: JsonStore;
    sessions: SessionService;
    onConfigSaved?: (config: LocusConfig) => Promise<HostCapabilities | void>;
    peerAddress?: (c: import("hono").Context) => string | undefined;
  },
): void {
  async function probeWorkerHealth(url: string, token: string, fingerprint?: string) {
    const client = new WorkerClient(
      { id: "probe", name: "probe", url, token, fingerprint },
      opts.sessions.fetchFn === fetch
        ? undefined
        : (input, init) => opts.sessions.fetchFn(input, init),
    );
    return client.health();
  }

  app.post("/api/workers/test", async (c) => {
    if (!isLocalOperator(c, opts.peerAddress)) {
      return c.json({ error: "Worker probes are desktop-only" }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      url?: string;
      token?: string;
      fingerprint?: string;
    };
    const url = normalizeWorkerUrl(typeof body.url === "string" ? body.url : "");
    if (!url) return c.json({ error: "Worker URL must be http or https" }, 400);
    const config = await opts.store.loadConfig();
    const match = (config.workers ?? []).find((row) => normalizeWorkerUrl(row.url) === url);
    let token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token || isMaskedSecret(token)) token = match?.token?.trim() ?? "";
    if (!token) return c.json({ error: "Worker token is required" }, 400);
    const fingerprint =
      parseWorkerFingerprint(body.fingerprint) ?? parseWorkerFingerprint(match?.fingerprint);
    try {
      return c.json(await probeWorkerHealth(url, token, fingerprint));
    } catch {
      return c.json({ error: "Unreachable" }, 400);
    }
  });

  app.post("/api/workers", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      blob?: string;
      url?: string;
      token?: string;
      fingerprint?: string;
      name?: string;
    };
    const parsed =
      typeof body.blob === "string" && body.blob.trim() ? parseWorkerAddBlob(body.blob) : undefined;
    const url = normalizeWorkerUrl(parsed?.url ?? (typeof body.url === "string" ? body.url : ""));
    if (!url) {
      return c.json(
        { error: "Paste a locus-worker add line (or a worker URL, token, and fingerprint)" },
        400,
      );
    }
    const config = await opts.store.loadConfig();
    const match = (config.workers ?? []).find((row) => normalizeWorkerUrl(row.url) === url);
    let token = parsed?.token?.trim() || (typeof body.token === "string" ? body.token.trim() : "");
    if (!token || isMaskedSecret(token)) token = match?.token?.trim() ?? "";
    if (!token) {
      return c.json(
        {
          error:
            "Worker token is required. First start of locus-worker prints it once in the add line.",
        },
        400,
      );
    }
    const fingerprint =
      parsed?.fingerprint ??
      parseWorkerFingerprint(typeof body.fingerprint === "string" ? body.fingerprint : undefined) ??
      parseWorkerFingerprint(match?.fingerprint);
    let workerHost = "";
    try {
      workerHost = new URL(url).hostname;
    } catch {
      workerHost = "";
    }
    if (!isLoopbackHost(workerHost) && !fingerprint) {
      return c.json(
        {
          error:
            "TLS fingerprint is required. Test connection, match the worker printout, then paste the fingerprint before Save.",
        },
        400,
      );
    }
    let health: Awaited<ReturnType<typeof probeWorkerHealth>>;
    try {
      health = await probeWorkerHealth(url, token, fingerprint);
    } catch {
      return c.json({ error: "Unreachable" }, 400);
    }
    const name =
      (typeof body.name === "string" ? body.name.trim() : "") ||
      parsed?.name?.trim() ||
      health.name?.trim() ||
      health.hostname?.trim() ||
      match?.name ||
      `Worker ${(config.workers ?? []).length + 1}`;
    const pinned = fingerprint ?? health.fingerprint;
    const worker = match
      ? {
          ...match,
          name,
          url,
          token,
          ...(pinned ? { fingerprint: pinned } : {}),
        }
      : {
          id: crypto.randomUUID(),
          name,
          url,
          token,
          ...(pinned ? { fingerprint: pinned } : {}),
        };
    const error = workerBackendError(worker);
    if (error) return c.json({ error }, 400);
    config.workers = match
      ? (config.workers ?? []).map((row) => (row.id === match.id ? worker : row))
      : [...(config.workers ?? []), worker];
    await opts.store.saveConfig(config);
    if (opts.onConfigSaved) await opts.onConfigSaved(config);
    return c.json({
      worker: redactConfig(config).workers?.find((row) => row.id === worker.id),
      config: redactConfig(config),
    });
  });

  app.get("/api/workers/status", async (c) => {
    const config = await opts.store.loadConfig();
    const rows = await Promise.all(
      (config.workers ?? []).map(async (row) => {
        if (workerKind(row) === "fargate" || !row.url) {
          return { id: row.id, live: false as const, skipped: true as const };
        }
        const token = row.token?.trim();
        if (!token) {
          return { id: row.id, live: false as const, error: "Worker token is required" };
        }
        try {
          const health = await probeWorkerHealth(row.url, token, row.fingerprint);
          return {
            id: row.id,
            live: true as const,
            hostname: health.hostname,
            name: health.name,
          };
        } catch {
          return {
            id: row.id,
            live: false as const,
            error: "Unreachable",
          };
        }
      }),
    );
    return c.json(rows);
  });
}
