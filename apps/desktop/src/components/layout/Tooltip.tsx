import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

/** Themed hover/focus label. Sets aria-label on the child when it has none. */
export function Tooltip(props: { label: string; disabledReason?: string; children: ReactNode }) {
  const child = props.children;
  const childProps = isValidElement(child)
    ? (child.props as { "aria-label"?: string; disabled?: boolean })
    : null;
  const disabled = Boolean(childProps?.disabled);
  const text = disabled && props.disabledReason ? props.disabledReason : props.label;
  const labeled =
    isValidElement(child) && !childProps?.["aria-label"]
      ? cloneElement(child as ReactElement<{ "aria-label"?: string }>, {
          "aria-label": text,
        })
      : child;
  return (
    <span className={`ui-tooltip${disabled ? " is-disabled" : ""}`}>
      {labeled}
      <span className="ui-tooltip-bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}
