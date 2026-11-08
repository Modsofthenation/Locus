import { builtinDesignSystems, resolveDesignSystem, type DesignSystem } from "@locus/shared";
import { useStore } from "@/state/store";
import { Select } from "@/components/layout/Select";

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
        <Select
          ariaLabel="Design system"
          value={value}
          options={[
            { value: "", label: "None" },
            ...stored.map((row) => ({
              value: row.id,
              label: row.name,
              hint: "My systems",
            })),
            ...builtins.map((row) => ({
              value: row.id,
              label: row.name,
              hint: "Starters",
            })),
          ]}
          onChange={(id) => props.onChange(id ? resolveDesignSystem(id, stored) : undefined)}
        />
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
