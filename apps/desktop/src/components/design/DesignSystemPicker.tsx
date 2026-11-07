import { builtinDesignSystems, resolveDesignSystem, type DesignSystem } from "@locus/shared";
import { useStore } from "@/state/store";

export function DesignSystemPicker(props: {
  selectedId?: string;
  onChange: (system: DesignSystem | undefined) => void;
  compact?: boolean;
  manage?: boolean;
}) {
  const { state, dispatch } = useStore();
  const stored = state.designSystems;
  const builtins = builtinDesignSystems();
  const selected = resolveDesignSystem(props.selectedId, stored);
  const value = selected?.id ?? "";

  return (
    <div className={`design-system-picker${props.compact ? " compact" : ""}`}>
      {!props.compact ? <div className="field-label">Design system</div> : null}
      <div className="design-system-picker-row">
        <select
          aria-label="Design system"
          title="Design system"
          value={value}
          onChange={(event) => {
            const id = event.target.value;
            props.onChange(id ? resolveDesignSystem(id, stored) : undefined);
          }}
        >
          <option value="">None</option>
          {stored.length ? (
            <optgroup label="My systems">
              {stored.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label="Starters">
            {builtins.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </optgroup>
        </select>
        {props.manage !== false ? (
          <button
            type="button"
            className="btn small ghost"
            title="Create, import, or export design systems"
            onClick={() => dispatch({ type: "designSystems", open: true })}
          >
            Manage
          </button>
        ) : null}
      </div>
    </div>
  );
}
