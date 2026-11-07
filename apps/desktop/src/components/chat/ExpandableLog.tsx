import { summarizeLogBlob } from "@locus/shared";

export function ExpandableLog(props: { text: string; compact?: boolean; danger?: boolean }) {
  const { summary, detail } = summarizeLogBlob(props.text);
  if (!detail) {
    if (props.compact) {
      return (
        <span className={`log-blob-summary ${props.danger ? "danger" : ""}`} title={summary}>
          {summary}
        </span>
      );
    }
    return <div className="bubble">{summary}</div>;
  }

  return (
    <details
      className={`log-blob ${props.compact ? "compact" : ""} ${props.danger ? "danger" : ""}`}
    >
      <summary title={props.compact ? summary : undefined}>
        <span>{summary}</span>
      </summary>
      <pre>{detail}</pre>
    </details>
  );
}
