import {
  SUBAGENT_KINDS,
  formatSubagentKind,
  subagentKindHint,
  type SubagentKind,
} from "@locus/shared";
import { Select } from "@/components/layout/Select";

export function SubagentPicker(props: {
  value: SubagentKind;
  onChange: (kind: SubagentKind) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <Select
      ariaLabel="Default subagent"
      className={props.compact ? "subagent-select" : undefined}
      compact={props.compact}
      disabled={props.disabled}
      prefer={props.compact ? "up" : undefined}
      value={props.value}
      options={SUBAGENT_KINDS.map((kind) => ({
        value: kind,
        label: formatSubagentKind(kind),
        hint: props.compact ? undefined : subagentKindHint(kind),
      }))}
      onChange={(kind) => props.onChange(kind as SubagentKind)}
    />
  );
}
