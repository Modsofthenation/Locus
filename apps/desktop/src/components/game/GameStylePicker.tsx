import { resolveGameStyle, type GameStyle } from "@locus/shared";
import { useStore } from "@/state/store";

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
        <select
          aria-label="Game style"
          title="Game style"
          value={value}
          onChange={(event) => {
            const id = event.target.value;
            props.onChange(id ? resolveGameStyle(id, stored) : undefined);
          }}
        >
          <option value="">No style</option>
          {stored.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
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
