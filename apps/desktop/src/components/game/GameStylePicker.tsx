import { resolveGameStyle, type GameStyle } from "@locus/shared";
import { useStore } from "@/state/store";
import { Select } from "@/components/layout/Select";

export function GameStylePicker(props: {
  selectedId?: string;
  onChange: (style: GameStyle | undefined) => void;
  compact?: boolean;
  manage?: boolean;
}) {
  const { state, dispatch } = useStore();
  const stored = state.gameStyles;
  const selected = resolveGameStyle(props.selectedId, stored);
  const value = selected?.id ?? "";

  return (
    <div className={`design-system-picker${props.compact ? " compact" : ""}`}>
      {!props.compact ? <div className="field-label">Game style</div> : null}
      <div className="design-system-picker-row">
        <Select
          ariaLabel="Game style"
          value={value}
          options={[
            { value: "", label: "No style" },
            ...stored.map((row) => ({ value: row.id, label: row.name })),
          ]}
          onChange={(id) => props.onChange(id ? resolveGameStyle(id, stored) : undefined)}
        />
        {props.manage !== false ? (
          <button
            type="button"
            className="btn small ghost"
            title="Create or save game styles"
            onClick={() => dispatch({ type: "gameStyles", open: true })}
          >
            Manage
          </button>
        ) : null}
      </div>
    </div>
  );
}
