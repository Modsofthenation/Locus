import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { IconSearch } from "./Icons";

type SearchFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  wrapClassName?: string;
  shortcut?: ReactNode;
};

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { wrapClassName, shortcut, className, ...props },
  ref,
) {
  return (
    <label className={["search-wrap", wrapClassName].filter(Boolean).join(" ")}>
      <span className="search-icon" aria-hidden="true">
        <IconSearch />
      </span>
      <input ref={ref} className={className} {...props} />
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </label>
  );
});
