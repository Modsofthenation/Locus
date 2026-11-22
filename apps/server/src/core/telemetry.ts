import { randomBytes } from "node:crypto";
import {
  TelemetryAssembler,
  buildOtlpMetricsJson,
  buildOtlpTraceJson,
  encodeOtlpMetricsProto,
  encodeOtlpTraceProto,
  otlpSignalUrl,
  resolveTelemetrySettings,
  type OtlpAttributes,
  type ResolvedTelemetrySettings,
  type TelemetrySessionMeta,
  type TelemetrySettings,
  type TraceEvent,
} from "@locus/shared";
import type { UsageRecorded } from "./budgets.js";

const SPAN_BATCH = 512;
const SEND_TIMEOUT_MS = 5_000;

export interface TelemetryStats {
  enabled: boolean;
  endpoint?: string;
  protocol?: string;
  exportedSpans: number;
  exportedMetricBatches: number;
  droppedSpans: number;
  failedRequests: number;
  lastError?: string;
  lastExportAt?: string;
}

/**
 * Opt-in OTLP/HTTP exporter fed by the session trace stream and the budget ledger's usage events.
 * Batches on a timer, drops a batch when the collector fails, and never awaits the network on a
 * turn's path. Prompt/response text, tool arguments, and file contents are not exported unless
 * `telemetry.includeContent` is set.
 */
export class TelemetryExporter {
  private settings: ResolvedTelemetrySettings = resolveTelemetrySettings(undefined);
  private assembler: TelemetryAssembler | undefined;
  private readonly meta = new Map<string, TelemetrySessionMeta>();
  private chain: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | undefined;
  private flushing: Promise<void> | undefined;
  private readonly stats: Omit<TelemetryStats, "enabled" | "endpoint" | "protocol"> = {
    exportedSpans: 0,
    exportedMetricBatches: 0,
    droppedSpans: 0,
    failedRequests: 0,
  };

  constructor(
    private readonly opts: {
      resolveMeta: (sessionId: string) => Promise<TelemetrySessionMeta | undefined>;
      fetchFn?: typeof fetch;
      flushIntervalMs?: number;
      serviceVersion?: string;
    },
  ) {}

  configure(raw?: TelemetrySettings): void {
    const next = resolveTelemetrySettings(raw);
    const changed = JSON.stringify(next) !== JSON.stringify(this.settings);
    this.settings = next;
    if (!next.enabled) {
      this.stop();
      this.assembler = undefined;
      this.meta.clear();
      return;
    }
    if (changed || !this.assembler) {
      this.assembler = new TelemetryAssembler({
        includeContent: next.includeContent,
        sampleRatio: next.sampleRatio,
        meta: (sessionId) => this.meta.get(sessionId),
        randomHex: (bytes) => randomBytes(bytes).toString("hex"),
      });
    }
    if (!this.timer) {
      this.timer = setInterval(() => void this.flush(), this.opts.flushIntervalMs ?? 5_000);
      this.timer.unref?.();
    }
  }

  status(): TelemetryStats {
    return {
      enabled: this.settings.enabled,
      endpoint: this.settings.enabled ? this.settings.endpoint : undefined,
      protocol: this.settings.enabled ? this.settings.protocol : undefined,
      ...this.stats,
      droppedSpans: this.stats.droppedSpans + (this.assembler?.droppedSpans ?? 0),
    };
  }

  onTrace(event: TraceEvent): void {
    const assembler = this.assembler;
    if (!assembler) return;
    this.chain = this.chain
      .then(async () => {
        if (event.kind === "turn.start") {
          const meta = await this.opts.resolveMeta(event.sessionId).catch(() => undefined);
          if (meta) this.meta.set(event.sessionId, meta);
          if (this.meta.size > 2048) {
            const first = this.meta.keys().next().value;
            if (first) this.meta.delete(first);
          }
        }
        assembler.ingest(event);
        if (assembler.queuedSpans >= SPAN_BATCH) void this.flush();
      })
      .catch(() => undefined);
  }

  onUsage(event: UsageRecorded): void {
    const assembler = this.assembler;
    if (!assembler) return;
    this.chain = this.chain
      .then(() =>
        assembler.usage({
          sessionId: event.sessionId,
          atMs: event.atMs,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          usd: event.usd,
          model: event.model,
          providerId: event.providerId,
        }),
      )
      .catch(() => undefined);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Export whatever is queued. Safe to call any time; concurrent calls share one flush. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushNow().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }

  private resource(): OtlpAttributes {
    return {
      "service.name": this.settings.serviceName,
      "service.version": this.opts.serviceVersion,
      "telemetry.sdk.name": "locus",
      "telemetry.sdk.language": "nodejs",
      "os.type": process.platform,
    };
  }

  private async flushNow(): Promise<void> {
    await this.chain;
    const assembler = this.assembler;
    const settings = this.settings;
    if (!assembler || !settings.enabled) return;
    const scope = { name: "locus", version: this.opts.serviceVersion };
    if (settings.traces) {
      for (;;) {
        const spans = assembler.drainSpans(SPAN_BATCH);
        if (!spans.length) break;
        const payload = buildOtlpTraceJson({ resource: this.resource(), scope, spans });
        const ok = await this.send(
          "traces",
          settings.protocol === "http/protobuf" ? encodeOtlpTraceProto(payload) : payload,
        );
        if (ok) this.stats.exportedSpans += spans.length;
        else this.stats.droppedSpans += spans.length;
        if (spans.length < SPAN_BATCH) break;
      }
    } else {
      assembler.drainSpans();
    }
    const metrics = assembler.drainMetrics(Date.now());
    if (settings.metrics && metrics.length) {
      const payload = buildOtlpMetricsJson({ resource: this.resource(), scope, metrics });
      const ok = await this.send(
        "metrics",
        settings.protocol === "http/protobuf" ? encodeOtlpMetricsProto(payload) : payload,
      );
      if (ok) this.stats.exportedMetricBatches += 1;
    }
  }

  /** POST one export. Returns false (and drops the batch) on any failure. */
  private async send(signal: "traces" | "metrics", body: unknown): Promise<boolean> {
    const settings = this.settings;
    const fetchFn = this.opts.fetchFn ?? fetch;
    const binary = body instanceof Uint8Array;
    try {
      const res = await fetchFn(otlpSignalUrl(settings.endpoint, signal), {
        method: "POST",
        headers: {
          ...settings.headers,
          "content-type": binary ? "application/x-protobuf" : "application/json",
        },
        body: binary ? (body as Uint8Array) : JSON.stringify(body),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        redirect: "error",
      });
      if (!res.ok) {
        this.stats.failedRequests += 1;
        this.stats.lastError = `${signal}: HTTP ${res.status}`;
        return false;
      }
      this.stats.lastExportAt = new Date().toISOString();
      this.stats.lastError = undefined;
      return true;
    } catch (err) {
      this.stats.failedRequests += 1;
      this.stats.lastError = `${signal}: ${err instanceof Error ? err.message : "request failed"}`;
      return false;
    }
  }

  /** Send an empty metrics export so Settings can check the endpoint and headers. */
  async test(raw?: TelemetrySettings): Promise<{ ok: boolean; error?: string }> {
    const settings = resolveTelemetrySettings({ ...raw, enabled: true });
    if (!settings.endpoint) return { ok: false, error: "Set an endpoint first" };
    const fetchFn = this.opts.fetchFn ?? fetch;
    const payload = buildOtlpMetricsJson({
      resource: { ...this.resource(), "service.name": settings.serviceName },
      scope: { name: "locus", version: this.opts.serviceVersion },
      metrics: [],
    });
    try {
      const binary = settings.protocol === "http/protobuf";
      const res = await fetchFn(otlpSignalUrl(settings.endpoint, "metrics"), {
        method: "POST",
        headers: {
          ...settings.headers,
          "content-type": binary ? "application/x-protobuf" : "application/json",
        },
        body: binary ? encodeOtlpMetricsProto(payload) : JSON.stringify(payload),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        redirect: "error",
      });
      return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "request failed" };
    }
  }
}
