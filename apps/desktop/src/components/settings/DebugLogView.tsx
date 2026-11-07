import { useMemo, useState } from "react";
import {
  evalCaseFromTrace,
  parseDebugLogId,
  type DebugLogDetail,
  type TraceKind,
} from "@locus/shared";
import { api } from "@/lib/api";
import { MenuItem, OverflowMenu } from "@/components/layout/OverflowMenu";

function displayedText(detail: DebugLogDetail, eventKind: string): string {
  if (eventKind === "all" || !detail.events?.length) return detail.text;
  return detail.events
    .filter((event) => event.kind === eventKind)
    .map((event) => JSON.stringify(event))
    .join("\n");
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function DebugLogView({
  detail,
  onError,
}: {
  detail: DebugLogDetail;
  onError?: (message: string | null) => void;
}) {
  const [eventKind, setEventKind] = useState("all");
  const [copied, setCopied] = useState(false);
  const [evalSaved, setEvalSaved] = useState<string | null>(null);

  const eventKinds = useMemo(() => {
    const kinds = new Set<TraceKind>();
    for (const event of detail.events ?? []) kinds.add(event.kind);
    return [...kinds];
  }, [detail]);

  const text = displayedText(detail, eventKind);

  async function copyEval() {
    if (!detail.events?.length) return;
    try {
      await navigator.clipboard.writeText(
        `${JSON.stringify(evalCaseFromTrace(detail.events), null, 2)}\n`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard may be unavailable */
    }
  }

  async function saveEval() {
    const parsed = parseDebugLogId(detail.source.id);
    if (!parsed || parsed.kind !== "trace") return;
    try {
      const saved = await api.saveTraceEval(parsed.kind, parsed.key);
      setEvalSaved(saved.path);
      onError?.(null);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Could not save eval");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(detail.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard may be unavailable */
    }
  }

  return (
    <div className="debug-log-body">
      <div className="debug-log-meta">
        <code title={detail.source.path}>{detail.source.path}</code>
        <div className="debug-log-actions">
          <button type="button" className="btn small ghost" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy raw"}
          </button>
          {detail.source.kind === "trace" ? (
            <OverflowMenu title="Trace actions">
              <MenuItem onClick={() => void copyEval()}>Copy eval</MenuItem>
              <MenuItem onClick={() => void saveEval()}>
                {evalSaved ? "Saved eval" : "Save as eval"}
              </MenuItem>
            </OverflowMenu>
          ) : null}
        </div>
      </div>
      {detail.truncated ? (
        <p className="hint">Showing the last {formatBytes(detail.text.length)} of this file.</p>
      ) : null}
      {eventKinds.length > 1 ? (
        <div className="debug-log-chips" aria-label="Trace event kind">
          <button
            type="button"
            className={eventKind === "all" ? "active" : ""}
            onClick={() => setEventKind("all")}
          >
            All events
          </button>
          {eventKinds.map((item) => (
            <button
              key={item}
              type="button"
              className={eventKind === item ? "active" : ""}
              onClick={() => setEventKind(item)}
            >
              {item}
            </button>
          ))}
        </div>
      ) : null}
      <pre className="debug-log-raw">{text || "(empty)"}</pre>
    </div>
  );
}
