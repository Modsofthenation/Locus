type FilterOption<T extends string> = { value: T; label: string; count?: number };

/** "Needs you 2" — the count rides on the label so the chip still reads as one word group. */
export function chipLabel(option: { label: string; count?: number }): string {
  return option.count ? `${option.label} ${option.count}` : option.label;
}

export function FilterChips<T extends string>(props: {
  label: string;
  value: T;
  options: readonly FilterOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={props.className ?? "side-filter-row"} role="group" aria-label={props.label}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`btn small${props.value === option.value ? " primary" : " ghost"}`}
          aria-pressed={props.value === option.value}
          onClick={() => props.onChange(option.value)}
        >
          {chipLabel(option)}
        </button>
      ))}
    </div>
  );
}
