import { resolveAssetStyle, type AssetStyle } from "@locus/shared";
import { useStore } from "@/state/store";
import { Select } from "@/components/layout/Select";

export function AssetStylePicker(props: {
  selectedId?: string;
  onChange: (style: AssetStyle | undefined) => void;
  compact?: boolean;
  manage?: boolean;
}) {
  const { state, dispatch } = useStore();
  const stored = state.assetStyles;
  const selected = resolveAssetStyle(props.selectedId, stored);
  const value = selected?.id ?? "";

  return (
    <div className={`design-system-picker${props.compact ? " compact" : ""}`}>
      {!props.compact ? <div className="field-label">Asset style</div> : null}
      <div className="design-system-picker-row">
        <Select
          ariaLabel="Asset style"
          value={value}
          options={[
            { value: "", label: "No style" },
            ...stored.map((row) => ({ value: row.id, label: row.name })),
          ]}
          onChange={(id) => props.onChange(id ? resolveAssetStyle(id, stored) : undefined)}
        />
        {props.manage !== false ? (
          <button
            type="button"
            className="btn small ghost"
            title="Create or save asset styles"
            onClick={() => dispatch({ type: "assetStyles", open: true })}
          >
            Manage
          </button>
        ) : null}
      </div>
    </div>
  );
}
