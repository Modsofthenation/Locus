import { summarizeLogBlob } from "@locus/shared";
import { DOCKER_DOWN_AGENT_MESSAGE, plainJobError } from "@/lib/automations";

export function ExpandableLog(props: { text: string; compact?: boolean; danger?: boolean }) {
  // Known infrastructure errors (Docker down) read as one plain sentence; the
  // raw text stays one click away.
  const plain = plainJobError(props.text);
  // Agents can't change runtime, so the job wording ("switch to Host") would
  // promise something this chat can't do. The thread callout offers a Host copy.
  const { summary, detail } = plain
    ? {
        summary: plain.cause === "docker" ? DOCKER_DOWN_AGENT_MESSAGE : plain.summary,
        detail: plain.detail,
      }
    : summarizeLogBlob(props.text);
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
