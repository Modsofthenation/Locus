import { useEffect, useRef, useState } from "react";
import type {
  AgentSession,
  ApprovalExportRow,
  DebugLogDetail,
  SessionEgressSummary,
} from "@locus/shared";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/net";
import { useDialogFocus } from "@/lib/useDialogFocus";
import { DebugLogView, formatBytes, formatWhen } from "@/components/settings/DebugLogView";

export function TraceModal({ session, onClose }: { session: AgentSession; onClose: () => void }) {
  const [detail, setDetail] = useState<DebugLogDetail | null>(null);
  const [egress, setEgress] = useState<SessionEgressSummary | null>(null);
  const [approvals, setApprovals] = useState<ApprovalExportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, onClose, dialogRef);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [next, egressSummary, approvalExport] = await Promise.all([
          api.debugLog("trace", session.id),
          api.sessionEgress?.(session.id)?.catch(() => null) ?? Promise.resolve(null),
          api.sessionApprovals?.(session.id)?.catch(() => ({ approvals: [] })) ??
            Promise.resolve({ approvals: [] }),
        ]);
        if (cancelled) return;
        setDetail(next);
        setEgress(egressSummary);
        setApprovals(approvalExport?.approvals ?? []);
        setMissing(false);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof HttpError && err.status === 404) {
          setDetail(null);
          setMissing(true);
          setError(null);
          return;
        }
        setError(err instanceof Error ? err.message : "Could not read trace");
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session.id]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal trace-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trace-title"
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="trace-title">Trace</h2>
        <p className="modal-lead">
          Raw JSONL events for {session.title}. Tool args already drop secret-like keys.
        </p>
        {detail ? (
          <p className="hint">
            {detail.source.summary} · {formatBytes(detail.source.bytes)} ·{" "}
            {formatWhen(detail.source.mtime)}
          </p>
        ) : null}
        {egress && (egress.hosts.length || egress.denied) ? (
          <p className="hint" data-testid="egress-summary">
            Egress: {egress.hosts.map((row) => `${row.host} (${row.kind})`).join(", ") || "none"} ·{" "}
            {formatBytes(egress.bytesSent)} sent · {egress.denied} denied
          </p>
        ) : null}
        {approvals.length ? (
          <p className="hint" data-testid="approvals-export">
            Approvals:{" "}
            {approvals.map((row) => `${row.tool} ${row.decision} by ${row.by}`).join(" · ")}
          </p>
        ) : null}
        {error ? (
          <p className="scrim-note" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        ) : null}
        {detail ? (
          <DebugLogView detail={detail} onError={setError} />
        ) : missing ? (
          <p className="hint">No trace yet. Send a chat turn to write JSONL for {session.title}.</p>
        ) : error ? null : (
          <p className="hint">Loading trace…</p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
