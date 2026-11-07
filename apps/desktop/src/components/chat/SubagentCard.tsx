import {
  formatTokenCount,
  formatSubagentKind,
  subagentStatusLabel,
  type SubagentLive,
} from "@locus/shared";
import { IconAgents, IconChevron } from "@/components/layout/Icons";

export function SubagentCard({
  agent,
  onOpen,
}: {
  agent: SubagentLive;
  onOpen: (agent: SubagentLive) => void;
}) {
  const spend =
    (agent.inputTokens ?? 0) + (agent.outputTokens ?? 0) > 0
      ? `${formatTokenCount((agent.inputTokens ?? 0) + (agent.outputTokens ?? 0))} tok`
      : "";
  const preview = agent.lastLine?.trim() ?? "";
  return (
    <button
      type="button"
      className="subagent-card"
      data-testid="subagent-card"
      data-status={agent.status}
      onClick={() => onOpen(agent)}
    >
      <span className="subagent-card-icon" aria-hidden>
        <IconAgents />
      </span>
      <span className="subagent-card-copy">
        <strong>{agent.task}</strong>
        <span className="subagent-card-meta">
          {formatSubagentKind(agent.kind ?? "explore")}
          {" · "}
          {subagentStatusLabel(agent.status)}
          {spend ? ` · ${spend}` : ""}
          {preview ? ` · ${preview}` : ""}
        </span>
      </span>
      <IconChevron />
    </button>
  );
}

export function SubagentFold({
  agents,
  onOpen,
}: {
  agents?: SubagentLive[];
  onOpen: (agent: SubagentLive) => void;
}) {
  if (!agents?.length) return null;
  return (
    <div className="subagent-fold" data-testid="subagent-fold">
      {agents.map((row) => (
        <SubagentCard key={row.id} agent={row} onOpen={onOpen} />
      ))}
    </div>
  );
}
