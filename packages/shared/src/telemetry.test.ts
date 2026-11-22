import { describe, expect, it } from "vitest";
import {
  buildOtlpMetricsJson,
  buildOtlpTraceJson,
  encodeOtlpMetricsProto,
  encodeOtlpTraceProto,
  msToUnixNano,
  otlpAttributes,
} from "./otlp.js";
import { TelemetryAssembler, blockedReasonCategory, sampleBucket } from "./telemetryAssembler.js";
import {
  otlpSignalUrl,
  parseTelemetrySettings,
  resolveTelemetrySettings,
  telemetryEndpointError,
} from "./models/controls.js";
import type { TraceEvent } from "./trace.js";

const SECRET_PROMPT = "PLEASE-REFACTOR-THE-SECRET-BILLING-MODULE";
const FILE_BODY = "export const apiKey = 'top-secret-file-contents';";

function counterHex(): (bytes: number) => string {
  let n = 0;
  return (bytes) => {
    n += 1;
    return n.toString(16).padStart(bytes * 2, "0");
  };
}

function scriptedTurn(): TraceEvent[] {
  const s = "sess-1";
  const turnId = "turn-1";
  return [
    {
      t: "2026-11-14T10:00:00.000Z",
      kind: "turn.start",
      sessionId: s,
      turnId,
      detail: SECRET_PROMPT,
    },
    {
      t: "2026-11-14T10:00:01.000Z",
      kind: "tool.call",
      sessionId: s,
      turnId,
      id: "c1",
      name: "file_write",
      args: { path: "src/billing.ts", content: FILE_BODY },
    },
    {
      t: "2026-11-14T10:00:01.250Z",
      kind: "tool.result",
      sessionId: s,
      turnId,
      id: "c1",
      name: "file_write",
      ok: true,
      detail: FILE_BODY,
    },
    {
      t: "2026-11-14T10:00:02.000Z",
      kind: "tool.call",
      sessionId: s,
      turnId,
      id: "c2",
      name: "git_push",
      args: { branch: "locus/fix" },
    },
    {
      t: "2026-11-14T10:00:12.000Z",
      kind: "approval",
      sessionId: s,
      id: "c2",
      name: "denied",
      args: { tool: "git_push", by: "operator", persist: false },
    },
    {
      t: "2026-11-14T10:00:12.100Z",
      kind: "blocked",
      sessionId: s,
      name: "git_push",
      ok: false,
      detail: `Refusing force-push of ${SECRET_PROMPT}`,
    },
    {
      t: "2026-11-14T10:00:12.200Z",
      kind: "tool.result",
      sessionId: s,
      turnId,
      id: "c2",
      name: "git_push",
      ok: false,
      detail: "Harness blocked git_push/git_pr: tests failed",
    },
    { t: "2026-11-14T10:00:20.000Z", kind: "turn.end", sessionId: s, turnId, ms: 20_000 },
  ];
}

function assembler(includeContent = false, sampleRatio = 1) {
  return new TelemetryAssembler({
    includeContent,
    sampleRatio,
    randomHex: counterHex(),
    meta: () => ({
      model: "claude-sonnet-4-5",
      providerId: "anthropic",
      providerKind: "anthropic",
      runtime: "docker",
      kind: "agent",
    }),
  });
}

function runScript(asm: TelemetryAssembler) {
  for (const event of scriptedTurn()) {
    asm.ingest(event);
    if (event.kind === "tool.call" && event.id === "c1") {
      asm.usage({
        sessionId: "sess-1",
        atMs: Date.parse(event.t),
        inputTokens: 1200,
        outputTokens: 300,
        usd: 0.0081,
      });
    }
  }
}

describe("TelemetryAssembler", () => {
  it("builds a turn span with tool child spans and metrics", () => {
    const asm = assembler();
    runScript(asm);
    const spans = asm.drainSpans();
    const turn = spans.find((span) => span.name === "invoke_agent locus")!;
    expect(turn).toBeDefined();
    expect(turn.attributes["locus.session.id"]).toBe("sess-1");
    expect(turn.attributes["gen_ai.request.model"]).toBe("claude-sonnet-4-5");
    expect(turn.attributes["locus.runtime"]).toBe("docker");
    expect(turn.attributes["gen_ai.usage.input_tokens"]).toBe(1200);
    expect(turn.attributes["locus.tool_calls"]).toBe(2);
    const tools = spans.filter((span) => span.parentSpanId === turn.spanId);
    expect(tools.map((span) => span.attributes["gen_ai.tool.name"]).sort()).toEqual([
      "file_write",
      "git_push",
    ]);
    const push = tools.find((span) => span.attributes["gen_ai.tool.name"] === "git_push")!;
    expect(push.attributes["locus.tool.ok"]).toBe(false);
    expect(push.attributes["locus.blocked.reason"]).toBe("force_push");
    expect(push.attributes["locus.approval.decision"]).toBe("denied");
    expect(push.attributes["locus.approval.wait_ms"]).toBe(10_000);
    const write = tools.find((span) => span.attributes["gen_ai.tool.name"] === "file_write")!;
    expect(write.attributes["locus.tool.duration_ms"]).toBe(250);

    const metrics = asm.drainMetrics(Date.parse("2026-11-14T10:01:00.000Z"));
    const names = metrics.map((metric) => metric.name).sort();
    expect(names).toEqual(
      expect.arrayContaining([
        "locus.tokens.input",
        "locus.tokens.output",
        "locus.cost.usd",
        "locus.tool.calls",
        "locus.publish_gate.failures",
        "locus.approval.wait",
        "locus.blocked.actions",
        "locus.turns",
      ]),
    );
    const gate = metrics.find((metric) => metric.name === "locus.publish_gate.failures");
    expect(gate?.kind === "sum" && gate.points.reduce((n, p) => n + p.value, 0)).toBe(2);
    // Delta temporality: a second drain is empty.
    expect(asm.drainMetrics(Date.parse("2026-11-14T10:02:00.000Z"))).toEqual([]);
  });

  it("never leaks prompt, tool args, or file contents by default", () => {
    const asm = assembler(false);
    runScript(asm);
    const traces = buildOtlpTraceJson({
      resource: { "service.name": "locus" },
      scope: { name: "locus" },
      spans: asm.drainSpans(),
    });
    const metrics = buildOtlpMetricsJson({
      resource: { "service.name": "locus" },
      scope: { name: "locus" },
      metrics: asm.drainMetrics(Date.now()),
    });
    const text = JSON.stringify(traces) + JSON.stringify(metrics);
    expect(text).not.toContain(SECRET_PROMPT);
    expect(text).not.toContain("top-secret-file-contents");
    expect(text).not.toContain("src/billing.ts");
    expect(text).not.toContain("tests failed");
    const proto = Buffer.from(encodeOtlpTraceProto(traces)).toString("latin1");
    expect(proto).not.toContain(SECRET_PROMPT);
    expect(proto).toContain("invoke_agent locus");
  });

  it("includes clipped content only when includeContent is set", () => {
    const asm = assembler(true);
    runScript(asm);
    const text = JSON.stringify(asm.drainSpans());
    expect(text).toContain(SECRET_PROMPT);
    expect(text).toContain("locus.tool.output");
  });

  it("drops spans for unsampled turns but still counts metrics", () => {
    const asm = assembler(false, 0);
    runScript(asm);
    expect(asm.drainSpans()).toEqual([]);
    expect(asm.drainMetrics(Date.now()).some((m) => m.name === "locus.tool.calls")).toBe(true);
  });

  it("caps the span queue and counts drops", () => {
    const asm = new TelemetryAssembler({
      includeContent: false,
      sampleRatio: 1,
      randomHex: counterHex(),
      meta: () => undefined,
      maxQueuedSpans: 3,
    });
    for (let i = 0; i < 5; i++) {
      asm.ingest({ t: new Date(1000 * i).toISOString(), kind: "turn.start", sessionId: `s${i}` });
      asm.ingest({ t: new Date(1000 * i + 1).toISOString(), kind: "turn.end", sessionId: `s${i}` });
    }
    expect(asm.queuedSpans).toBe(3);
    expect(asm.droppedSpans).toBe(2);
  });

  it("samples deterministically per turn", () => {
    expect(sampleBucket("turn-a")).toBe(sampleBucket("turn-a"));
    expect(sampleBucket("turn-a")).toBeGreaterThanOrEqual(0);
    expect(sampleBucket("turn-a")).toBeLessThan(1);
  });

  it("categorizes blocked reasons without the raw message", () => {
    expect(blockedReasonCategory("Refusing to push to main")).toBe("protected_branch");
    expect(blockedReasonCategory("Budget reached: daily spend cap")).toBe("budget");
    expect(blockedReasonCategory("cannot read .env")).toBe("credential");
  });
});

describe("OTLP payloads", () => {
  it("encodes attributes with OTLP JSON value types", () => {
    expect(otlpAttributes({ a: "x", b: 2, c: 1.5, d: true, e: undefined })).toEqual([
      { key: "a", value: { stringValue: "x" } },
      { key: "b", value: { intValue: "2" } },
      { key: "c", value: { doubleValue: 1.5 } },
      { key: "d", value: { boolValue: true } },
    ]);
    expect(msToUnixNano(1_700_000_000_123)).toBe("1700000000123000000");
  });

  it("encodes protobuf with the expected field layout", () => {
    const payload = buildOtlpTraceJson({
      resource: { "service.name": "locus" },
      scope: { name: "locus", version: "1" },
      spans: [
        {
          traceId: "0102030405060708090a0b0c0d0e0f10",
          spanId: "0102030405060708",
          name: "t",
          startMs: 1,
          endMs: 2,
          attributes: { n: 0, ok: false },
        },
      ],
    });
    const bytes = encodeOtlpTraceProto(payload);
    // ExportTraceServiceRequest.resource_spans = field 1, wire type 2
    expect(bytes[0]).toBe(0x0a);
    const hex = Buffer.from(bytes).toString("hex");
    // trace_id field 1 length 16
    expect(hex).toContain("0a100102030405060708090a0b0c0d0e0f10");
    // span_id field 2 length 8
    expect(hex).toContain("12080102030405060708");
    // start_time_unix_nano field 7 fixed64 = 1_000_000 ns
    expect(hex).toContain(`39${"40420f0000000000"}`);
    // int attribute 0 is still written (oneof): AnyValue{int_value=0} = 18 00
    expect(hex).toContain("12021800");
    // bool attribute false is still written: AnyValue{bool_value=false} = 10 00
    expect(hex).toContain("12021000");
  });

  it("encodes metrics protobuf", () => {
    const payload = buildOtlpMetricsJson({
      resource: {},
      scope: { name: "locus" },
      metrics: [
        {
          kind: "sum",
          name: "locus.turns",
          unit: "{turn}",
          description: "",
          isInt: true,
          points: [{ attributes: {}, value: 3, startMs: 1, endMs: 2 }],
        },
        {
          kind: "histogram",
          name: "locus.approval.wait",
          unit: "ms",
          description: "",
          bounds: [10],
          points: [
            {
              attributes: {},
              count: 1,
              sum: 5,
              min: 5,
              max: 5,
              bucketCounts: [1, 0],
              startMs: 1,
              endMs: 2,
            },
          ],
        },
      ],
    });
    const bytes = encodeOtlpMetricsProto(payload);
    expect(bytes.length).toBeGreaterThan(20);
    expect(Buffer.from(bytes).toString("latin1")).toContain("locus.approval.wait");
  });
});

describe("telemetry settings", () => {
  it("is off by default and never includes content by default", () => {
    const resolved = resolveTelemetrySettings(undefined);
    expect(resolved.enabled).toBe(false);
    expect(resolved.includeContent).toBe(false);
    expect(resolveTelemetrySettings({ enabled: true }).enabled).toBe(false);
    const on = resolveTelemetrySettings({ enabled: true, endpoint: "http://127.0.0.1:4318" });
    expect(on).toMatchObject({ enabled: true, protocol: "http/json", serviceName: "locus" });
  });

  it("validates endpoints and builds signal URLs", () => {
    expect(telemetryEndpointError("ftp://x")).toBeTruthy();
    expect(telemetryEndpointError("https://user:pw@x")).toBeTruthy();
    expect(otlpSignalUrl("http://c:4318/", "traces")).toBe("http://c:4318/v1/traces");
    expect(otlpSignalUrl("http://c:4318/v1/traces", "metrics")).toBe("http://c:4318/v1/metrics");
    expect(parseTelemetrySettings({ headers: { "bad header": "x", ok: "y" } })?.headers).toEqual({
      ok: "y",
    });
  });
});
