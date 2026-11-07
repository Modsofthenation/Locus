import { resolveAssetStyle, type AssetStyle } from "@locus/shared";
import { useStore } from "@/state/store";

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
        <select
          aria-label="Asset style"
          title="Asset style"
          value={value}
          onChange={(event) => {
            const id = event.target.value;
            props.onChange(id ? resolveAssetStyle(id, stored) : undefined);
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
