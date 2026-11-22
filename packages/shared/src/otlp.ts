/**
 * Minimal OTLP/HTTP payload builders (JSON and protobuf) for spans and metrics.
 *
 * Hand-rolled on purpose: Locus exports two signals from one in-process trace stream, and the
 * official SDK (sdk-trace-base + sdk-metrics + two exporters + protobuf runtime) adds a large
 * dependency tree to the Electron server bundle for features we do not use (context propagation,
 * auto-instrumentation, views). These builders follow opentelemetry-proto v1 field numbers.
 */

export type OtlpAttrValue = string | number | boolean;
export type OtlpAttributes = Record<string, OtlpAttrValue | undefined>;

export const OTLP_SPAN_KIND_INTERNAL = 1;
export const OTLP_STATUS_UNSET = 0;
export const OTLP_STATUS_OK = 1;
export const OTLP_STATUS_ERROR = 2;
/** Delta temporality: each export carries only what happened since the previous one. */
export const OTLP_TEMPORALITY_DELTA = 1;

export interface OtlpSpanInput {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startMs: number;
  endMs: number;
  attributes: OtlpAttributes;
  status?: { code: number; message?: string };
  events?: Array<{ name: string; atMs: number; attributes?: OtlpAttributes }>;
}

export type OtlpMetricInput =
  | {
      kind: "sum";
      name: string;
      unit: string;
      description: string;
      isInt: boolean;
      points: Array<{ attributes: OtlpAttributes; value: number; startMs: number; endMs: number }>;
    }
  | {
      kind: "histogram";
      name: string;
      unit: string;
      description: string;
      bounds: number[];
      points: Array<{
        attributes: OtlpAttributes;
        count: number;
        sum: number;
        min: number;
        max: number;
        bucketCounts: number[];
        startMs: number;
        endMs: number;
      }>;
    };

export interface OtlpScope {
  name: string;
  version?: string;
}

type JsonAnyValue =
  { stringValue: string } | { boolValue: boolean } | { intValue: string } | { doubleValue: number };

export interface JsonKeyValue {
  key: string;
  value: JsonAnyValue;
}

export function msToUnixNano(ms: number): string {
  const whole = Math.max(0, Math.round(ms));
  return whole === 0 ? "0" : `${whole}000000`;
}

export function otlpAttributes(attrs: OtlpAttributes): JsonKeyValue[] {
  const out: JsonKeyValue[] = [];
  for (const key of Object.keys(attrs).sort()) {
    const value = attrs[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string") out.push({ key, value: { stringValue: value } });
    else if (typeof value === "boolean") out.push({ key, value: { boolValue: value } });
    else if (Number.isInteger(value)) out.push({ key, value: { intValue: String(value) } });
    else if (Number.isFinite(value)) out.push({ key, value: { doubleValue: value } });
  }
  return out;
}

export function buildOtlpTraceJson(input: {
  resource: OtlpAttributes;
  scope: OtlpScope;
  spans: OtlpSpanInput[];
}) {
  return {
    resourceSpans: [
      {
        resource: { attributes: otlpAttributes(input.resource) },
        scopeSpans: [
          {
            scope: { name: input.scope.name, version: input.scope.version ?? "" },
            spans: input.spans.map((span) => ({
              traceId: span.traceId,
              spanId: span.spanId,
              ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
              name: span.name,
              kind: OTLP_SPAN_KIND_INTERNAL,
              startTimeUnixNano: msToUnixNano(span.startMs),
              endTimeUnixNano: msToUnixNano(Math.max(span.endMs, span.startMs)),
              attributes: otlpAttributes(span.attributes),
              ...(span.events?.length
                ? {
                    events: span.events.map((event) => ({
                      timeUnixNano: msToUnixNano(event.atMs),
                      name: event.name,
                      attributes: otlpAttributes(event.attributes ?? {}),
                    })),
                  }
                : {}),
              status: {
                code: span.status?.code ?? OTLP_STATUS_UNSET,
                ...(span.status?.message ? { message: span.status.message } : {}),
              },
            })),
          },
        ],
      },
    ],
  };
}

export type OtlpTraceJson = ReturnType<typeof buildOtlpTraceJson>;

export function buildOtlpMetricsJson(input: {
  resource: OtlpAttributes;
  scope: OtlpScope;
  metrics: OtlpMetricInput[];
}) {
  return {
    resourceMetrics: [
      {
        resource: { attributes: otlpAttributes(input.resource) },
        scopeMetrics: [
          {
            scope: { name: input.scope.name, version: input.scope.version ?? "" },
            metrics: input.metrics.map((metric) =>
              metric.kind === "sum"
                ? {
                    name: metric.name,
                    unit: metric.unit,
                    description: metric.description,
                    sum: {
                      aggregationTemporality: OTLP_TEMPORALITY_DELTA,
                      isMonotonic: true,
                      dataPoints: metric.points.map((point) => ({
                        attributes: otlpAttributes(point.attributes),
                        startTimeUnixNano: msToUnixNano(point.startMs),
                        timeUnixNano: msToUnixNano(point.endMs),
                        ...(metric.isInt
                          ? { asInt: String(Math.round(point.value)) }
                          : { asDouble: point.value }),
                      })),
                    },
                  }
                : {
                    name: metric.name,
                    unit: metric.unit,
                    description: metric.description,
                    histogram: {
                      aggregationTemporality: OTLP_TEMPORALITY_DELTA,
                      dataPoints: metric.points.map((point) => ({
                        attributes: otlpAttributes(point.attributes),
                        startTimeUnixNano: msToUnixNano(point.startMs),
                        timeUnixNano: msToUnixNano(point.endMs),
                        count: String(point.count),
                        sum: point.sum,
                        bucketCounts: point.bucketCounts.map(String),
                        explicitBounds: metric.bounds,
                        min: point.min,
                        max: point.max,
                      })),
                    },
                  },
            ),
          },
        ],
      },
    ],
  };
}

export type OtlpMetricsJson = ReturnType<typeof buildOtlpMetricsJson>;

// ---------------------------------------------------------------------------------------------
// Protobuf encoding (proto3 wire format) for the same shapes.
// ---------------------------------------------------------------------------------------------

class ProtoWriter {
  private chunks: number[] = [];

  bytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }

  private varint(value: bigint): void {
    let v = BigInt.asUintN(64, value);
    while (v >= 0x80n) {
      this.chunks.push(Number((v & 0x7fn) | 0x80n));
      v >>= 7n;
    }
    this.chunks.push(Number(v));
  }

  private tag(field: number, wire: number): void {
    this.varint(BigInt((field << 3) | wire));
  }

  uint(field: number, value: number | bigint, always = false): void {
    const v = typeof value === "bigint" ? value : BigInt(Math.round(value));
    if (v === 0n && !always) return;
    this.tag(field, 0);
    this.varint(v);
  }

  bool(field: number, value: boolean, always = false): void {
    if (!value && !always) return;
    this.tag(field, 0);
    this.varint(value ? 1n : 0n);
  }

  fixed64(field: number, value: bigint): void {
    if (value === 0n) return;
    this.fixed64Always(field, value);
  }

  fixed64Always(field: number, value: bigint): void {
    this.tag(field, 1);
    this.raw64(value);
  }

  private raw64(value: bigint): void {
    let v = BigInt.asUintN(64, value);
    for (let i = 0; i < 8; i++) {
      this.chunks.push(Number(v & 0xffn));
      v >>= 8n;
    }
  }

  private rawDouble(value: number): void {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setFloat64(0, value, true);
    for (let i = 0; i < 8; i++) this.chunks.push(buf.getUint8(i));
  }

  double(field: number, value: number, always = false): void {
    if (!always && value === 0) return;
    this.tag(field, 1);
    this.rawDouble(value);
  }

  string(field: number, value: string): void {
    if (!value) return;
    this.bytesField(field, new TextEncoder().encode(value));
  }

  bytesField(field: number, value: Uint8Array): void {
    if (!value.length) return;
    this.tag(field, 2);
    this.varint(BigInt(value.length));
    for (const byte of value) this.chunks.push(byte);
  }

  message(field: number, build: (w: ProtoWriter) => void, always = false): void {
    const inner = new ProtoWriter();
    build(inner);
    const bytes = inner.bytes();
    if (!bytes.length && !always) return;
    this.tag(field, 2);
    this.varint(BigInt(bytes.length));
    for (const byte of bytes) this.chunks.push(byte);
  }

  packedFixed64(field: number, values: bigint[]): void {
    if (!values.length) return;
    const inner = new ProtoWriter();
    for (const value of values) inner.raw64(value);
    this.bytesField(field, inner.bytes());
  }

  packedDouble(field: number, values: number[]): void {
    if (!values.length) return;
    const inner = new ProtoWriter();
    for (const value of values) inner.rawDouble(value);
    this.bytesField(field, inner.bytes());
  }
}

function hexBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function writeKeyValues(w: ProtoWriter, field: number, attrs: JsonKeyValue[]): void {
  for (const kv of attrs) {
    w.message(
      field,
      (kvw) => {
        kvw.string(1, kv.key);
        kvw.message(
          2,
          (vw) => {
            const value = kv.value;
            if ("stringValue" in value) vw.string(1, value.stringValue);
            // oneof members are encoded even when they hold the default value.
            else if ("boolValue" in value) vw.bool(2, value.boolValue, true);
            else if ("intValue" in value) vw.uint(3, BigInt(value.intValue), true);
            else vw.double(4, value.doubleValue, true);
          },
          true,
        );
      },
      true,
    );
  }
}

function writeScope(w: ProtoWriter, scope: { name: string; version: string }): void {
  w.message(1, (sw) => {
    sw.string(1, scope.name);
    sw.string(2, scope.version);
  });
}

export function encodeOtlpTraceProto(payload: OtlpTraceJson): Uint8Array {
  const w = new ProtoWriter();
  for (const rs of payload.resourceSpans) {
    w.message(
      1,
      (rw) => {
        rw.message(1, (res) => writeKeyValues(res, 1, rs.resource.attributes));
        for (const ss of rs.scopeSpans) {
          rw.message(
            2,
            (sw) => {
              writeScope(sw, ss.scope);
              for (const span of ss.spans) {
                sw.message(
                  2,
                  (pw) => {
                    pw.bytesField(1, hexBytes(span.traceId));
                    pw.bytesField(2, hexBytes(span.spanId));
                    if ("parentSpanId" in span && span.parentSpanId) {
                      pw.bytesField(4, hexBytes(span.parentSpanId));
                    }
                    pw.string(5, span.name);
                    pw.uint(6, span.kind);
                    pw.fixed64(7, BigInt(span.startTimeUnixNano));
                    pw.fixed64(8, BigInt(span.endTimeUnixNano));
                    writeKeyValues(pw, 9, span.attributes);
                    if ("events" in span && span.events) {
                      for (const event of span.events) {
                        pw.message(
                          11,
                          (ew) => {
                            ew.fixed64(1, BigInt(event.timeUnixNano));
                            ew.string(2, event.name);
                            writeKeyValues(ew, 3, event.attributes);
                          },
                          true,
                        );
                      }
                    }
                    pw.message(15, (stw) => {
                      if (span.status.message) stw.string(2, span.status.message);
                      stw.uint(3, span.status.code);
                    });
                  },
                  true,
                );
              }
            },
            true,
          );
        }
      },
      true,
    );
  }
  return w.bytes();
}

export function encodeOtlpMetricsProto(payload: OtlpMetricsJson): Uint8Array {
  const w = new ProtoWriter();
  for (const rm of payload.resourceMetrics) {
    w.message(
      1,
      (rw) => {
        rw.message(1, (res) => writeKeyValues(res, 1, rm.resource.attributes));
        for (const sm of rm.scopeMetrics) {
          rw.message(
            2,
            (sw) => {
              writeScope(sw, sm.scope);
              for (const metric of sm.metrics) {
                sw.message(
                  2,
                  (mw) => {
                    mw.string(1, metric.name);
                    mw.string(2, metric.description);
                    mw.string(3, metric.unit);
                    if ("sum" in metric && metric.sum) {
                      mw.message(
                        7,
                        (sumw) => {
                          for (const point of metric.sum.dataPoints) {
                            sumw.message(
                              1,
                              (pw) => {
                                pw.fixed64(2, BigInt(point.startTimeUnixNano));
                                pw.fixed64(3, BigInt(point.timeUnixNano));
                                if ("asDouble" in point && typeof point.asDouble === "number") {
                                  pw.double(4, point.asDouble, true);
                                }
                                if ("asInt" in point && typeof point.asInt === "string") {
                                  // sfixed64; oneof, so a zero is still written.
                                  pw.fixed64Always(6, BigInt(point.asInt));
                                }
                                writeKeyValues(pw, 7, point.attributes);
                              },
                              true,
                            );
                          }
                          sumw.uint(2, metric.sum.aggregationTemporality);
                          sumw.bool(3, metric.sum.isMonotonic);
                        },
                        true,
                      );
                    }
                    if ("histogram" in metric && metric.histogram) {
                      mw.message(
                        9,
                        (hw) => {
                          for (const point of metric.histogram.dataPoints) {
                            hw.message(
                              1,
                              (pw) => {
                                pw.fixed64(2, BigInt(point.startTimeUnixNano));
                                pw.fixed64(3, BigInt(point.timeUnixNano));
                                pw.fixed64(4, BigInt(point.count));
                                pw.double(5, point.sum, true);
                                pw.packedFixed64(
                                  6,
                                  point.bucketCounts.map((c) => BigInt(c)),
                                );
                                pw.packedDouble(7, point.explicitBounds);
                                writeKeyValues(pw, 9, point.attributes);
                                pw.double(11, point.min, true);
                                pw.double(12, point.max, true);
                              },
                              true,
                            );
                          }
                          hw.uint(2, metric.histogram.aggregationTemporality);
                        },
                        true,
                      );
                    }
                  },
                  true,
                );
              }
            },
            true,
          );
        }
      },
      true,
    );
  }
  return w.bytes();
}
