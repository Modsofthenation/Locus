import { useEffect, useState } from "react";
import {
  OTLP_PROTOCOLS,
  formatDailySpendHint,
  isOtlpProtocol,
  type DailyBudgetStatus,
  type LocusConfig,
  type TelemetrySettings,
} from "@locus/shared";
import { api } from "@/lib/api";
import { askPrompt } from "@/lib/dialog";
import { SettingsToggleRow } from "./SettingsBits";

export function headerLines(headers?: Record<string, string>): string {
  return Object.entries(headers ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

export function parseHeaderLines(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (key) out[key] = line.slice(idx + 1).trim();
  }
  return Object.keys(out).length ? out : undefined;
}

function numberOrUndefined(raw: string): number | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Settings → Advanced → Budgets, Telemetry, and Audit log. */
export function ControlsSettings(props: {
  draft: LocusConfig;
  setDraft: (next: LocusConfig) => void;
}) {
  const { draft, setDraft } = props;
  const telemetry: TelemetrySettings = draft.telemetry ?? {};
  const budgets = draft.budgets ?? {};
  const [status, setStatus] = useState<DailyBudgetStatus | null>(null);
  const [budgetMsg, setBudgetMsg] = useState<string | null>(null);
  const [headersText, setHeadersText] = useState(() => headerLines(telemetry.headers));
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [auditMsg, setAuditMsg] = useState<string | null>(null);

  useEffect(() => {
    void Promise.resolve()
      .then(() => api.budgets())
      .then((row) => setStatus(row.status))
      .catch(() => undefined);
  }, []);

  const setTelemetry = (next: Partial<TelemetrySettings>) =>
    setDraft({ ...draft, telemetry: { ...telemetry, ...next } });
  const setBudget = (next: Partial<NonNullable<LocusConfig["budgets"]>>) =>
    setDraft({ ...draft, budgets: { ...budgets, ...next } });

  async function override() {
    const reason = await askPrompt("Reason for raising today's cap (written to the audit log)");
    if (!reason?.trim()) return;
    try {
      const row = await api.budgetOverride({ scope: "global", reason: reason.trim() });
      setStatus(row.status);
      setBudgetMsg("Override recorded until local midnight.");
    } catch (err) {
      setBudgetMsg(err instanceof Error ? err.message : "Override failed");
    }
  }

  async function testTelemetry() {
    setTestMsg("Sending…");
    try {
      const result = await api.telemetryTest({
        ...telemetry,
        headers: parseHeaderLines(headersText),
      });
      setTestMsg(result.ok ? "Collector accepted an empty export." : `Failed: ${result.error}`);
    } catch (err) {
      setTestMsg(err instanceof Error ? err.message : "Test failed");
    }
  }

  async function verifyAudit() {
    setAuditMsg("Verifying…");
    try {
      const result = await api.auditVerify();
      setAuditMsg(
        result.ok
          ? `Chain OK: ${result.records} records in ${result.files} file(s).`
          : `Broken at ${result.firstBroken?.file} line ${result.firstBroken?.line}: ${result.firstBroken?.reason}`,
      );
    } catch (err) {
      setAuditMsg(err instanceof Error ? err.message : "Verify failed");
    }
  }

  const spend = formatDailySpendHint(status ?? undefined);

  return (
    <>
      <details className="advanced" open id="settings-advanced-budgets">
        <summary>Budgets</summary>
        <p className="scrim-note" data-testid="daily-spend">
          {spend ??
            (status
              ? `Today $${status.spentUsd.toFixed(2)} · ${status.spentTokens.toLocaleString("en-US")} tokens (no daily cap)`
              : "Daily caps stop every agent before its next model call once today's spend reaches them.")}
        </p>
        <div className="grid-2">
          <div className="field">
            <label>Daily spend cap (USD)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="unlimited"
              value={budgets.dailyUsd ?? ""}
              data-testid="budget-dailyUsd"
              onChange={(e) => setBudget({ dailyUsd: numberOrUndefined(e.target.value) })}
            />
            <p className="hint">All agents and automations, local calendar day.</p>
          </div>
          <div className="field">
            <label>Daily token cap</label>
            <input
              type="number"
              min={0}
              step="1000"
              placeholder="unlimited"
              value={budgets.dailyTokens ?? ""}
              onChange={(e) => setBudget({ dailyTokens: numberOrUndefined(e.target.value) })}
            />
            <p className="hint">
              Per-automation and per-project caps: <code>locus budget set --automation id</code>.
            </p>
          </div>
        </div>
        {status && (status.capUsd != null || status.capTokens != null) ? (
          <div className="field">
            <button type="button" className="btn" onClick={() => void override()}>
              Override for today…
            </button>
            {budgetMsg ? <p className="hint">{budgetMsg}</p> : null}
          </div>
        ) : null}
      </details>
      <details className="advanced" id="settings-advanced-telemetry">
        <summary>Telemetry (OpenTelemetry)</summary>
        <p className="scrim-note">
          Off by default. Exports turn and tool spans plus token, cost, tool-call, publish-gate, and
          approval-wait metrics over OTLP/HTTP. Prompts, replies, tool arguments, and file contents
          are not sent unless you include content.
        </p>
        <SettingsToggleRow
          label="Export to an OTLP collector"
          on={telemetry.enabled === true}
          testId="telemetry-enabled"
          onChange={(next) => setTelemetry({ enabled: next })}
        />
        <div className="grid-2">
          <div className="field">
            <label>Endpoint</label>
            <input
              value={telemetry.endpoint ?? ""}
              placeholder="http://127.0.0.1:4318"
              onChange={(e) => setTelemetry({ endpoint: e.target.value.trim() || undefined })}
            />
            <p className="hint">
              Base URL; <code>/v1/traces</code> and <code>/v1/metrics</code> are appended.
            </p>
          </div>
          <div className="field">
            <label>Protocol</label>
            <select
              value={telemetry.protocol ?? "http/json"}
              onChange={(e) =>
                setTelemetry({
                  protocol: isOtlpProtocol(e.target.value) ? e.target.value : undefined,
                })
              }
            >
              {OTLP_PROTOCOLS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Service name</label>
            <input
              value={telemetry.serviceName ?? ""}
              placeholder="locus"
              onChange={(e) => setTelemetry({ serviceName: e.target.value.trim() || undefined })}
            />
          </div>
          <div className="field">
            <label>Trace sample ratio (0–1)</label>
            <input
              type="number"
              min={0}
              max={1}
              step="0.05"
              placeholder="1"
              value={telemetry.sampleRatio ?? ""}
              onChange={(e) =>
                setTelemetry({
                  sampleRatio: e.target.value.trim() ? Number(e.target.value) : undefined,
                })
              }
            />
            <p className="hint">Metrics are never sampled.</p>
          </div>
        </div>
        <div className="field">
          <label>Headers</label>
          <textarea
            rows={2}
            value={headersText}
            placeholder="x-honeycomb-team: …"
            onChange={(e) => {
              setHeadersText(e.target.value);
              setTelemetry({ headers: parseHeaderLines(e.target.value) });
            }}
          />
          <p className="hint">One per line. Values are stored in the encrypted vault.</p>
        </div>
        <SettingsToggleRow
          label="Include prompt and tool output previews"
          hint="Off by default. Sends clipped prompt text, blocked-action messages, and tool output to the collector."
          on={telemetry.includeContent === true}
          testId="telemetry-includeContent"
          onChange={(next) => setTelemetry({ includeContent: next || undefined })}
        />
        <div className="field">
          <button type="button" className="btn" onClick={() => void testTelemetry()}>
            Test endpoint
          </button>
          {testMsg ? <p className="hint">{testMsg}</p> : null}
        </div>
      </details>
      <details className="advanced" id="settings-advanced-audit">
        <summary>Audit log</summary>
        <p className="scrim-note">
          Approvals, denials, blocked actions, push / PR / merge, policy, budget, and credential
          changes are appended to a hash-chained log under <code>~/.locus/audit</code>. Export with{" "}
          <code>locus audit export</code>.
        </p>
        <div className="field">
          <button type="button" className="btn" onClick={() => void verifyAudit()}>
            Verify audit log
          </button>
          {auditMsg ? <p className="hint">{auditMsg}</p> : null}
        </div>
      </details>
    </>
  );
}
