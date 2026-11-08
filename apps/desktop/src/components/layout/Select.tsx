import type { ReactNode } from "react";
import { MenuItem, OverflowMenu } from "./OverflowMenu";

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
};

export function Select<T extends string>(props: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
  prefer?: "up" | "down";
  align?: "left" | "right" | "after";
  id?: string;
  testId?: string;
}) {
  const selected = props.options.find((row) => row.value === props.value);
  const label = selected?.label ?? props.value;
  return (
    <OverflowMenu
      className={`ui-select${props.compact ? " compact" : ""}${props.className ? ` ${props.className}` : ""}`}
      title={props.ariaLabel}
      align={props.align ?? "left"}
      prefer={props.prefer}
      disabled={props.disabled}
      dataValue={props.value}
      id={props.id}
      testId={props.testId}
      label={<span className="ui-select-value">{label}</span>}
      toggleClassName="ui-select-toggle"
    >
      {props.options.map((row) => (
        <MenuItem
          key={row.value}
          value={row.value}
          active={row.value === props.value}
          disabled={props.disabled || row.disabled}
          onClick={() => props.onChange(row.value)}
        >
          <span className="ui-select-option">
            <span className="ui-select-option-label">{row.label}</span>
            {row.hint ? <span className="ui-select-option-hint">{row.hint}</span> : null}
          </span>
        </MenuItem>
      ))}
    </OverflowMenu>
  );
}

export function selectOptionsFromList(
  values: readonly string[],
  label: (value: string) => string = (value) => value,
  hint?: (value: string) => string | undefined,
): SelectOption[] {
  return values.map((value) => ({
    value,
    label: label(value),
    hint: hint?.(value),
  }));
}

export function SelectField(props: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      {typeof props.label === "string" ? <label>{props.label}</label> : props.label}
      {props.children}
    </div>
  );
}

export function FormTabs<T extends string>(props: {
  ariaLabel: string;
  value: T;
  tabs: ReadonlyArray<{ id: T; label: string }>;
  onChange: (id: T) => void;
}) {
  return (
    <div className="session-settings-tabs" role="tablist" aria-label={props.ariaLabel}>
      {props.tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={props.value === tab.id}
          className={props.value === tab.id ? "on" : ""}
          onClick={() => props.onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
