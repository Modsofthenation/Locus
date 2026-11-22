import type { TraceEvent } from "./trace.js";
import {
  OTLP_STATUS_ERROR,
  OTLP_STATUS_OK,
  type OtlpAttributes,
  type OtlpMetricInput,
  type OtlpSpanInput,
} from "./otlp.js";

/** Non-content facts about a session that label spans and metrics. */
export interface TelemetrySessionMeta {
  model?: string;
  providerId?: string;
  providerKind?: string;
  runtime?: string;
  kind?: string;
  automationId?: string;
  projectId?: string;
}

export interface TelemetryUsageEvent {
  sessionId: string;
  atMs: number;
  inputTokens: number;
  outputTokens: number;
  usd?: number;
  model?: string;
  providerId?: string;
}

export interface TelemetryAssemblerOptions {
  includeContent: boolean;
  sampleRatio: number;
  meta: (sessionId: string) => TelemetrySessionMeta | undefined;
  randomHex: (bytes: number) => string;
  maxQueuedSpans?: number;
}

/** Approval wait buckets in ms: 1s, 5s, 30s, 1m, 5m, 15m, 30m, 1h. */
export const APPROVAL_WAIT_BOUNDS_MS = [
  1_000, 5_000, 30_000, 60_000, 300_000, 900_000, 1_800_000, 3_600_000,
];

const PUBLISH_TOOLS = new Set(["git_push", "git_pr", "git_pr_merge"]);
const CONTENT_CHARS = 512;

interface OpenTurn {
  sessionId: string;
  turnId?: string;
  traceId: string;
  spanId: string;
  startMs: number;
  sampled: boolean;
  meta: TelemetrySessionMeta;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  toolCalls: number;
  toolFailures: number;
  approvals: number;
  blocked: number;
  error: boolean;
  events: NonNullable<OtlpSpanInput["events"]>;
  prompt?: string;
}

interface OpenTool {
  turn?: OpenTurn;
  spanId: string;
  name: string;
  callId: string;
  startMs: number;
  attrs: OtlpAttributes;
  events: NonNullable<OtlpSpanInput["events"]>;
}

interface SumCell {
  attrs: OtlpAttributes;
  value: number;
}

interface HistCell {
  attrs: OtlpAttributes;
  count: number;
  sum: number;
  min: number;
  max: number;
  buckets: number[];
}

const SUM_DEFS: Record<string, { unit: string; description: string; isInt: boolean }> = {
  "locus.tokens.input": {
    unit: "{token}",
    description: "Input tokens reported by the provider",
    isInt: true,
  },
  "locus.tokens.output": {
    unit: "{token}",
    description: "Output tokens reported by the provider",
    isInt: true,
  },
  "locus.cost.usd": {
    unit: "USD",
    description: "Estimated LLM spend from published or override rates",
    isInt: false,
  },
  "locus.tool.calls": { unit: "{call}", description: "Agent tool calls finished", isInt: true },
  "locus.blocked.actions": {
    unit: "{action}",
    description: "Tool calls refused by a harness wall or policy",
    isInt: true,
  },
  "locus.publish_gate.failures": {
    unit: "{failure}",
    description: "git_push / git_pr / merge attempts refused by the publish gate",
    isInt: true,
  },
  "locus.turns": { unit: "{turn}", description: "Agent turns finished", isInt: true },
};

function attrKey(name: string, attrs: OtlpAttributes): string {
  return `${name}|${Object.keys(attrs)
    .sort()
    .map((key) => `${key}=${String(attrs[key] ?? "")}`)
    .join(",")}`;
}

function toMs(t: string | undefined, fallback: number): number {
  if (!t) return fallback;
  const parsed = Date.parse(t);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Stable 0–1 bucket for a turn so sampling does not depend on arrival order. */
export function sampleBucket(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0x1_0000_0000;
}

/** Coarse blocked-action category. The raw message stays local unless includeContent is on. */
export function blockedReasonCategory(detail: string | undefined): string {
  const text = (detail ?? "").toLowerCase();
  if (!text) return "other";
  if (/budget/.test(text)) return "budget";
  if (/force[- ]?push/.test(text)) return "force_push";
  if (/main|master|trunk|default branch|protected/.test(text)) return "protected_branch";
  if (/tests? failed|test suite|npm test/.test(text)) return "tests_failed";
  if (/credential|\.env|secret|private key|printenv|environ/.test(text)) return "credential";
  if (/allowlist|egress|curl|wget|host/.test(text)) return "egress";
  if (/rm -rf|destructive/.test(text)) return "destructive";
  if (/install|postinstall|lifecycle/.test(text)) return "install";
  if (/policy|denied|deny/.test(text)) return "policy";
  return "other";
}

function clipContent(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  return trimmed.length <= CONTENT_CHARS ? trimmed : `${trimmed.slice(0, CONTENT_CHARS - 1)}…`;
}

/**
 * Folds the session trace stream (and usage deltas) into OTLP spans and delta metrics.
 * Pure: no timers, no I/O. The server exporter owns batching and transport.
 */
export class TelemetryAssembler {
  private readonly turns = new Map<string, OpenTurn>();
  private readonly tools = new Map<string, OpenTool>();
  private readonly toolStarts = new Map<string, { atMs: number; name: string }>();
  private spans: OtlpSpanInput[] = [];
  private sums = new Map<string, SumCell & { name: string }>();
  private hists = new Map<string, HistCell>();
  private lastDrainMs: number | undefined;
  droppedSpans = 0;

  constructor(private readonly opts: TelemetryAssemblerOptions) {}

  get queuedSpans(): number {
    return this.spans.length;
  }

  ingest(event: TraceEvent): void {
    const atMs = toMs(event.t, Date.now());
    switch (event.kind) {
      case "turn.start":
        this.startTurn(event, atMs);
        return;
      case "turn.end":
        this.endTurn(event, atMs);
        return;
      case "tool.call":
        this.startTool(event, atMs);
        return;
      case "tool.result":
        this.finishTool(event, atMs);
        return;
      case "approval":
        this.approval(event, atMs);
        return;
      case "blocked":
        this.blocked(event, atMs);
        return;
      case "governor": {
        const turn = this.turns.get(event.sessionId);
        turn?.events.push({
          name: "locus.governor",
          atMs,
          attributes: {
            "locus.governor.level": event.level ?? "warn",
            ...(this.opts.includeContent
              ? { "locus.governor.message": clipContent(event.detail) }
              : {}),
          },
        });
        return;
      }
      case "error": {
        const turn = this.turns.get(event.sessionId);
        if (!turn) return;
        turn.error = true;
        turn.events.push({
          name: "exception",
          atMs,
          attributes: this.opts.includeContent
            ? { "exception.message": clipContent(event.detail) }
            : { "exception.type": "locus.turn_error" },
        });
        return;
      }
      default:
        return;
    }
  }

  usage(event: TelemetryUsageEvent): void {
    const meta = this.opts.meta(event.sessionId) ?? {};
    const attrs: OtlpAttributes = {
      "gen_ai.request.model": event.model ?? meta.model,
      "locus.provider.id": event.providerId ?? meta.providerId,
      "locus.session.kind": meta.kind,
    };
    if (event.inputTokens > 0) this.addSum("locus.tokens.input", attrs, event.inputTokens);
    if (event.outputTokens > 0) this.addSum("locus.tokens.output", attrs, event.outputTokens);
    if (typeof event.usd === "number" && event.usd > 0) {
      this.addSum("locus.cost.usd", attrs, event.usd);
    }
    const turn = this.turns.get(event.sessionId);
    if (turn) {
      turn.inputTokens += Math.max(0, event.inputTokens);
      turn.outputTokens += Math.max(0, event.outputTokens);
      turn.usd += typeof event.usd === "number" && event.usd > 0 ? event.usd : 0;
    }
  }

  drainSpans(max = Number.POSITIVE_INFINITY): OtlpSpanInput[] {
    const out = this.spans.slice(0, max);
    this.spans = this.spans.slice(out.length);
    return out;
  }

  drainMetrics(nowMs: number): OtlpMetricInput[] {
    const startMs = this.lastDrainMs ?? nowMs;
    this.lastDrainMs = nowMs;
    const metrics: OtlpMetricInput[] = [];
    const byName = new Map<string, Array<SumCell>>();
    for (const cell of this.sums.values()) {
      const rows = byName.get(cell.name) ?? [];
      rows.push({ attrs: cell.attrs, value: cell.value });
      byName.set(cell.name, rows);
    }
    for (const [name, rows] of byName) {
      const def = SUM_DEFS[name];
      if (!def) continue;
      metrics.push({
        kind: "sum",
        name,
        unit: def.unit,
        description: def.description,
        isInt: def.isInt,
        points: rows.map((row) => ({
          attributes: row.attrs,
          value: row.value,
          startMs,
          endMs: nowMs,
        })),
      });
    }
    if (this.hists.size) {
      metrics.push({
        kind: "histogram",
        name: "locus.approval.wait",
        unit: "ms",
        description: "Time a tool call waited on Approve / Deny",
        bounds: APPROVAL_WAIT_BOUNDS_MS,
        points: [...this.hists.values()].map((cell) => ({
          attributes: cell.attrs,
          count: cell.count,
          sum: cell.sum,
          min: cell.min,
          max: cell.max,
          bucketCounts: cell.buckets,
          startMs,
          endMs: nowMs,
        })),
      });
    }
    this.sums = new Map();
    this.hists = new Map();
    return metrics;
  }

  private addSum(name: string, attrs: OtlpAttributes, value: number): void {
    const key = attrKey(name, attrs);
    const cell = this.sums.get(key) ?? { name, attrs, value: 0 };
    cell.value += value;
    this.sums.set(key, cell);
  }

  private addWait(attrs: OtlpAttributes, waitMs: number): void {
    const key = attrKey("wait", attrs);
    const cell = this.hists.get(key) ?? {
      attrs,
      count: 0,
      sum: 0,
      min: waitMs,
      max: waitMs,
      buckets: new Array<number>(APPROVAL_WAIT_BOUNDS_MS.length + 1).fill(0),
    };
    cell.count += 1;
    cell.sum += waitMs;
    cell.min = Math.min(cell.min, waitMs);
    cell.max = Math.max(cell.max, waitMs);
    let idx = APPROVAL_WAIT_BOUNDS_MS.findIndex((bound) => waitMs <= bound);
    if (idx < 0) idx = APPROVAL_WAIT_BOUNDS_MS.length;
    cell.buckets[idx] = (cell.buckets[idx] ?? 0) + 1;
    this.hists.set(key, cell);
  }

  private pushSpan(span: OtlpSpanInput): void {
    const max = this.opts.maxQueuedSpans ?? 2048;
    this.spans.push(span);
    if (this.spans.length > max) {
      const drop = this.spans.length - max;
      this.spans.splice(0, drop);
      this.droppedSpans += drop;
    }
  }

  private startTurn(event: TraceEvent, atMs: number): void {
    const previous = this.turns.get(event.sessionId);
    if (previous) this.closeTurn(previous, atMs, { interrupted: true });
    const meta = this.opts.meta(event.sessionId) ?? {};
    const seed = event.turnId || `${event.sessionId}:${event.t}`;
    this.turns.set(event.sessionId, {
      sessionId: event.sessionId,
      turnId: event.turnId,
      traceId: this.opts.randomHex(16),
      spanId: this.opts.randomHex(8),
      startMs: atMs,
      sampled: sampleBucket(seed) < this.opts.sampleRatio,
      meta,
      inputTokens: 0,
      outputTokens: 0,
      usd: 0,
      toolCalls: 0,
      toolFailures: 0,
      approvals: 0,
      blocked: 0,
      error: false,
      events: [],
      prompt: this.opts.includeContent ? clipContent(event.detail) : undefined,
    });
  }

  private endTurn(event: TraceEvent, atMs: number): void {
    const turn = this.turns.get(event.sessionId);
    if (!turn) return;
    if (event.turnId && turn.turnId && event.turnId !== turn.turnId) return;
    if (event.ok === false) turn.error = true;
    this.closeTurn(turn, atMs, {});
  }

  private closeTurn(turn: OpenTurn, atMs: number, opts: { interrupted?: boolean }): void {
    this.turns.delete(turn.sessionId);
    for (const [key, tool] of this.tools) {
      if (tool.turn !== turn) continue;
      this.tools.delete(key);
      this.emitTool(tool, atMs, { ok: undefined, unfinished: true });
    }
    this.addSum(
      "locus.turns",
      {
        "gen_ai.request.model": turn.meta.model,
        "locus.session.kind": turn.meta.kind,
        "locus.runtime": turn.meta.runtime,
      },
      1,
    );
    if (!turn.sampled) return;
    this.pushSpan({
      traceId: turn.traceId,
      spanId: turn.spanId,
      name: "invoke_agent locus",
      startMs: turn.startMs,
      endMs: atMs,
      attributes: {
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.request.model": turn.meta.model,
        "gen_ai.provider.name": turn.meta.providerKind,
        "gen_ai.usage.input_tokens": turn.inputTokens,
        "gen_ai.usage.output_tokens": turn.outputTokens,
        "locus.session.id": turn.sessionId,
        "locus.turn.id": turn.turnId,
        "locus.provider.id": turn.meta.providerId,
        "locus.runtime": turn.meta.runtime,
        "locus.session.kind": turn.meta.kind,
        "locus.automation.id": turn.meta.automationId,
        "locus.project.id": turn.meta.projectId,
        "locus.cost.usd": turn.usd > 0 ? Number(turn.usd.toFixed(6)) : 0,
        "locus.tool_calls": turn.toolCalls,
        "locus.tool_failures": turn.toolFailures,
        "locus.approvals": turn.approvals,
        "locus.blocked": turn.blocked,
        "locus.turn.interrupted": opts.interrupted ? true : undefined,
        "locus.prompt": turn.prompt,
      },
      events: turn.events,
      status: turn.error ? { code: OTLP_STATUS_ERROR } : { code: OTLP_STATUS_OK },
    });
  }

  private startTool(event: TraceEvent, atMs: number): void {
    const name = event.name || "tool";
    const callId = event.id || `${name}-${atMs}`;
    const key = `${event.sessionId}:${callId}`;
    this.toolStarts.set(key, { atMs, name });
    if (this.toolStarts.size > 4096) {
      const first = this.toolStarts.keys().next().value;
      if (first) this.toolStarts.delete(first);
    }
    const turn = this.turns.get(event.sessionId);
    this.tools.set(key, {
      turn,
      spanId: this.opts.randomHex(8),
      name,
      callId,
      startMs: atMs,
      attrs: {},
      events: [],
    });
    if (this.tools.size > 4096) {
      const first = this.tools.keys().next().value;
      if (first) this.tools.delete(first);
    }
  }

  private finishTool(event: TraceEvent, atMs: number): void {
    const name = event.name || "tool";
    const key = `${event.sessionId}:${event.id ?? ""}`;
    const open = this.tools.get(key);
    this.tools.delete(key);
    this.toolStarts.delete(key);
    const ok = event.ok !== false;
    const turn = open?.turn ?? this.turns.get(event.sessionId);
    if (turn) {
      turn.toolCalls += 1;
      if (!ok) turn.toolFailures += 1;
    }
    this.addSum("locus.tool.calls", { "gen_ai.tool.name": name, "locus.tool.ok": ok }, 1);
    if (
      !ok &&
      PUBLISH_TOOLS.has(name) &&
      /harness blocked|tests? failed|refus|blocked/i.test(event.detail ?? "")
    ) {
      this.addSum("locus.publish_gate.failures", { "gen_ai.tool.name": name }, 1);
    }
    const tool = open ?? {
      turn,
      spanId: this.opts.randomHex(8),
      name,
      callId: event.id ?? "",
      startMs: atMs - (event.ms ?? 0),
      attrs: {},
      events: [],
    };
    if (this.opts.includeContent && event.detail) {
      tool.attrs["locus.tool.output"] = clipContent(event.detail);
    }
    this.emitTool(tool, atMs, { ok });
  }

  private emitTool(
    tool: OpenTool,
    atMs: number,
    result: { ok: boolean | undefined; unfinished?: boolean },
  ): void {
    const turn = tool.turn;
    if (!turn?.sampled) return;
    this.pushSpan({
      traceId: turn.traceId,
      spanId: tool.spanId,
      parentSpanId: turn.spanId,
      name: `execute_tool ${tool.name}`,
      startMs: tool.startMs,
      endMs: atMs,
      attributes: {
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": tool.name,
        "gen_ai.tool.call.id": tool.callId,
        "locus.session.id": turn.sessionId,
        "locus.tool.ok": result.ok,
        "locus.tool.duration_ms": Math.max(0, atMs - tool.startMs),
        "locus.tool.unfinished": result.unfinished ? true : undefined,
        ...tool.attrs,
      },
      events: tool.events,
      status:
        result.ok === false
          ? { code: OTLP_STATUS_ERROR }
          : result.ok === true
            ? { code: OTLP_STATUS_OK }
            : undefined,
    });
  }

  private approval(event: TraceEvent, atMs: number): void {
    const tool = (typeof event.args?.tool === "string" && event.args.tool) || event.name || "tool";
    const decision =
      event.name === "denied" || event.name === "cancelled" ? event.name : "approved";
    const key = `${event.sessionId}:${event.id ?? ""}`;
    const started = this.toolStarts.get(key);
    const waitMs = started ? Math.max(0, atMs - started.atMs) : undefined;
    if (waitMs != null) {
      this.addWait({ "gen_ai.tool.name": tool, "locus.approval.decision": decision }, waitMs);
    }
    const turn = this.turns.get(event.sessionId);
    if (turn) turn.approvals += 1;
    const open = this.tools.get(key);
    if (open) {
      open.attrs["locus.approval.decision"] = decision;
      if (waitMs != null) open.attrs["locus.approval.wait_ms"] = waitMs;
      if (event.args?.persist === true) open.attrs["locus.approval.always_allow"] = true;
    }
  }

  private blocked(event: TraceEvent, atMs: number): void {
    const name = event.name || "tool";
    this.addSum("locus.blocked.actions", { "gen_ai.tool.name": name }, 1);
    if (PUBLISH_TOOLS.has(name)) {
      this.addSum("locus.publish_gate.failures", { "gen_ai.tool.name": name }, 1);
    }
    const turn = this.turns.get(event.sessionId);
    if (turn) turn.blocked += 1;
    const reason = blockedReasonCategory(event.detail);
    let open: OpenTool | undefined;
    for (const tool of this.tools.values()) {
      if (tool.turn?.sessionId === event.sessionId && tool.name === name) open = tool;
    }
    const attrs: OtlpAttributes = {
      "locus.blocked": true,
      "locus.blocked.reason": reason,
      ...(this.opts.includeContent ? { "locus.blocked.message": clipContent(event.detail) } : {}),
    };
    if (open) {
      Object.assign(open.attrs, attrs);
      return;
    }
    if (!turn?.sampled) return;
    this.pushSpan({
      traceId: turn.traceId,
      spanId: this.opts.randomHex(8),
      parentSpanId: turn.spanId,
      name: `execute_tool ${name}`,
      startMs: atMs,
      endMs: atMs,
      attributes: {
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": name,
        "locus.session.id": event.sessionId,
        "locus.tool.ok": false,
        ...attrs,
      },
      status: { code: OTLP_STATUS_ERROR },
    });
  }
}
