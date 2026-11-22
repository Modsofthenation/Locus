import type { AiProvider, WorktreeAgentSpec } from "@locus/shared";
import { WORKTREE_AGENTS_MAX } from "@locus/shared";
import { ModelPicker } from "@/components/settings/ModelPicker";

/** Extra parallel agents beside the primary pick: one provider/model (API or CLI) per row. */
export function AgentRows(props: {
  providers: AiProvider[];
  rows: WorktreeAgentSpec[];
  onChange: (rows: WorktreeAgentSpec[]) => void;
  /** Rows already taken by the primary picker, counted toward the cap. */
  reserved?: number;
  max?: number;
  label?: string;
  /** Providers already running elsewhere (e.g. the primary pick); new rows prefer others. */
  taken?: string[];
}) {
  const max = (props.max ?? WORKTREE_AGENTS_MAX) - (props.reserved ?? 0);
  const enabled = props.providers.filter((p) => p.enabled);
  const fallback = enabled[0] ?? props.providers[0];
  const update = (index: number, next: WorktreeAgentSpec) =>
    props.onChange(props.rows.map((row, i) => (i === index ? next : row)));
  return (
    <div className="field agent-rows" role="group" aria-label={props.label ?? "Parallel agents"}>
      {props.rows.map((row, index) => (
        <div className="agent-row" key={index}>
          <span className="agent-row-index">{index + 1 + (props.reserved ?? 0)}</span>
          <ModelPicker
            compact
            providers={props.providers}
            providerId={row.providerId}
            model={row.model}
            onChange={(next) => update(index, { providerId: next.providerId, model: next.model })}
          />
          <button
            type="button"
            className="btn small ghost"
            aria-label={`Remove agent ${index + 1 + (props.reserved ?? 0)}`}
            onClick={() => props.onChange(props.rows.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      {props.rows.length < max && fallback ? (
        <button
          type="button"
          className="btn small"
          onClick={() => {
            // Prefer a provider not already in the list so the default add is a real comparison.
            const used = new Set([
              ...(props.taken ?? []),
              ...props.rows.map((row) => row.providerId),
            ]);
            const next = enabled.find((p) => !used.has(p.id)) ?? fallback;
            props.onChange([
              ...props.rows,
              { providerId: next.id, model: next.defaultModel || next.models[0] || "" },
            ]);
          }}
        >
          + Add agent
        </button>
      ) : null}
    </div>
  );
}
