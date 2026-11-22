/** Team controls: OpenTelemetry export and daily spend caps. Both are opt-in. */

export const OTLP_PROTOCOLS = ["http/json", "http/protobuf"] as const;
export type OtlpProtocol = (typeof OTLP_PROTOCOLS)[number];

export interface TelemetrySettings {
  /** Master switch. Default off. */
  enabled?: boolean;
  /** OTLP/HTTP base URL, e.g. `http://127.0.0.1:4318`. `/v1/traces` and `/v1/metrics` are appended. */
  endpoint?: string;
  /** Default `http/json`. */
  protocol?: OtlpProtocol;
  /** Extra request headers (API keys). Values are vaulted in `secrets.enc`. */
  headers?: Record<string, string>;
  /** `service.name` resource attribute. Default `locus`. */
  serviceName?: string;
  /** Fraction of turns whose spans are exported (0–1). Default 1. Metrics are never sampled. */
  sampleRatio?: number;
  /** Export turn/tool spans. Default true when enabled. */
  traces?: boolean;
  /** Export token / cost / tool / approval metrics. Default true when enabled. */
  metrics?: boolean;
  /**
   * Attach prompt text, blocked-action messages, and tool output previews to spans.
   * Default false. Never on unless the operator sets it.
   */
  includeContent?: boolean;
}

export interface ResolvedTelemetrySettings {
  enabled: boolean;
  endpoint: string;
  protocol: OtlpProtocol;
  headers: Record<string, string>;
  serviceName: string;
  sampleRatio: number;
  traces: boolean;
  metrics: boolean;
  includeContent: boolean;
}

export const DEFAULT_TELEMETRY_SERVICE = "locus";

export function isOtlpProtocol(value: unknown): value is OtlpProtocol {
  return value === "http/json" || value === "http/protobuf";
}

function cleanHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = key.trim();
    if (!name || !/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) continue;
    if (typeof value !== "string") continue;
    out[name] = value.trim();
  }
  return out;
}

/** Normalize stored telemetry settings. Unknown or malformed fields fall back to safe defaults. */
export function parseTelemetrySettings(raw: unknown): TelemetrySettings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const endpoint = typeof value.endpoint === "string" ? value.endpoint.trim() : "";
  const serviceName = typeof value.serviceName === "string" ? value.serviceName.trim() : "";
  const ratio =
    typeof value.sampleRatio === "number" && Number.isFinite(value.sampleRatio)
      ? Math.min(1, Math.max(0, value.sampleRatio))
      : undefined;
  const headers = cleanHeaders(value.headers);
  return {
    enabled: value.enabled === true,
    endpoint: endpoint || undefined,
    protocol: isOtlpProtocol(value.protocol) ? value.protocol : undefined,
    headers: Object.keys(headers).length ? headers : undefined,
    serviceName: serviceName || undefined,
    sampleRatio: ratio,
    traces: value.traces === false ? false : undefined,
    metrics: value.metrics === false ? false : undefined,
    includeContent: value.includeContent === true ? true : undefined,
  };
}

export function resolveTelemetrySettings(raw?: TelemetrySettings): ResolvedTelemetrySettings {
  const parsed = parseTelemetrySettings(raw) ?? {};
  const endpoint = parsed.endpoint ?? "";
  return {
    enabled: Boolean(parsed.enabled && endpoint && !telemetryEndpointError(endpoint)),
    endpoint,
    protocol: parsed.protocol ?? "http/json",
    headers: parsed.headers ?? {},
    serviceName: parsed.serviceName ?? DEFAULT_TELEMETRY_SERVICE,
    sampleRatio: parsed.sampleRatio ?? 1,
    traces: parsed.traces !== false,
    metrics: parsed.metrics !== false,
    includeContent: parsed.includeContent === true,
  };
}

export function telemetryEndpointError(endpoint: string | undefined): string | undefined {
  const text = endpoint?.trim() ?? "";
  if (!text) return undefined;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "Telemetry endpoint must be an http(s) URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Telemetry endpoint must be an http(s) URL";
  }
  if (url.username || url.password) {
    return "Put collector credentials in telemetry headers, not the URL";
  }
  return undefined;
}

/** `/v1/traces` or `/v1/metrics` under the base endpoint. A full signal URL is kept as-is. */
export function otlpSignalUrl(endpoint: string, signal: "traces" | "metrics"): string {
  const base = endpoint.trim().replace(/\/+$/, "");
  if (/\/v1\/(traces|metrics|logs)$/.test(base)) {
    return base.replace(/\/v1\/(traces|metrics|logs)$/, `/v1/${signal}`);
  }
  return `${base}/v1/${signal}`;
}

export interface BudgetCap {
  /** USD per local calendar day. */
  dailyUsd?: number;
  /** Input + output tokens per local calendar day. */
  dailyTokens?: number;
}

export interface BudgetSettings extends BudgetCap {
  /** Per-automation daily caps keyed by automation id. */
  automations?: Record<string, BudgetCap>;
  /** Per-project daily caps keyed by project id. */
  projects?: Record<string, BudgetCap>;
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function parseBudgetCap(raw: unknown): BudgetCap | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const dailyUsd = positive(value.dailyUsd);
  const tokens = positive(value.dailyTokens);
  const dailyTokens = tokens == null ? undefined : Math.round(tokens);
  if (dailyUsd == null && dailyTokens == null) return undefined;
  return { dailyUsd, dailyTokens };
}

function parseCapMap(raw: unknown): Record<string, BudgetCap> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, BudgetCap> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = id.trim();
    const cap = parseBudgetCap(value);
    if (key && cap) out[key] = cap;
  }
  return Object.keys(out).length ? out : undefined;
}

export function parseBudgetSettings(raw: unknown): BudgetSettings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const global = parseBudgetCap(value) ?? {};
  const automations = parseCapMap(value.automations);
  const projects = parseCapMap(value.projects);
  if (global.dailyUsd == null && global.dailyTokens == null && !automations && !projects) {
    return undefined;
  }
  return { ...global, automations, projects };
}

export function hasAnyBudgetCap(settings?: BudgetSettings): boolean {
  return Boolean(parseBudgetSettings(settings));
}
