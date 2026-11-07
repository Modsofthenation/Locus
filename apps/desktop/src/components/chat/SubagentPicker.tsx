import {
  SUBAGENT_KINDS,
  formatSubagentKind,
  subagentKindHint,
  type SubagentKind,
} from "@locus/shared";

export function SubagentPicker(props: {
  value: SubagentKind;
  onChange: (kind: SubagentKind) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label="Default subagent"
      className={props.compact ? "subagent-select" : undefined}
      disabled={props.disabled}
      value={props.value}
      title="Default child agent for spawn_agent. Asking for another kind in chat overrides this turn."
      onChange={(e) => props.onChange(e.target.value as SubagentKind)}
    >
      {SUBAGENT_KINDS.map((kind) => (
        <option key={kind} value={kind}>
          {props.compact
            ? formatSubagentKind(kind)
            : `${formatSubagentKind(kind)} — ${subagentKindHint(kind)}`}
        </option>
      ))}
    </select>
  );
}
