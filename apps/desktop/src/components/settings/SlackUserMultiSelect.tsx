import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { SlackMember } from "@locus/shared";

const MAX_OPTIONS = 50;

/**
 * Pick several Slack members: chips for the chosen ones, a search box that filters the workspace's
 * members (loaded from `users.list`) in a listbox. Ids that aren't in `users` (a deleted member, a
 * list that hasn't loaded) stay as chips showing the raw id so they can still be removed.
 */
export function SlackUserMultiSelect(props: {
  label: string;
  value: string[];
  users: SlackMember[];
  /** Still loading `users`. */
  loading?: boolean;
  /** Why `users` is empty (no scope, offline). */
  error?: string | null;
  hint?: ReactNode;
  placeholder?: string;
  testId?: string;
  onChange: (ids: string[]) => void;
}) {
  const { value, users, onChange } = props;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const inputId = useId();

  const byId = useMemo(() => new Map(users.map((row) => [row.id, row])), [users]);
  const chosen = useMemo(() => new Set(value), [value]);
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? users.filter((row) =>
          [row.name, row.realName ?? "", row.id].some((text) => text.toLowerCase().includes(q)),
        )
      : users;
    return rows.slice(0, MAX_OPTIONS);
  }, [query, users]);

  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = (id: string) => {
    onChange(chosen.has(id) ? value.filter((row) => row !== id) : [...value, id]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setCursor((at) => Math.min(at + 1, Math.max(options.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((at) => Math.max(at - 1, 0));
    } else if (event.key === "Enter") {
      const row = options[cursor];
      if (open && row) {
        event.preventDefault();
        toggle(row.id);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    } else if (event.key === "Backspace" && !query && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  const activeId = open && options[cursor] ? `${listId}-${options[cursor]!.id}` : undefined;

  return (
    <div className="field slack-user-select" ref={rootRef} data-testid={props.testId}>
      <label htmlFor={inputId}>{props.label}</label>
      <div className="slack-user-select-box" onClick={() => inputRef.current?.focus()}>
        {value.map((id) => {
          const user = byId.get(id);
          const name = user?.name ?? id;
          return (
            <span key={id} className="slack-user-chip" data-testid={`${props.testId}-chip-${id}`}>
              {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : null}
              <span title={user?.realName ? `${user.realName} (${id})` : id}>{name}</span>
              <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  toggle(id);
                }}
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder={value.length ? "" : (props.placeholder ?? "Search people…")}
          data-testid={props.testId ? `${props.testId}-input` : undefined}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-label={props.label}
          className="slack-user-select-list"
        >
          {props.loading ? (
            <li className="slack-user-select-empty">Loading Slack members…</li>
          ) : props.error && !users.length ? (
            <li className="slack-user-select-empty">{props.error}</li>
          ) : !options.length ? (
            <li className="slack-user-select-empty">No matching members</li>
          ) : (
            options.map((row, index) => (
              <li
                key={row.id}
                id={`${listId}-${row.id}`}
                role="option"
                aria-selected={chosen.has(row.id)}
                className={index === cursor ? "active" : undefined}
                data-testid={props.testId ? `${props.testId}-option-${row.id}` : undefined}
                onMouseEnter={() => setCursor(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggle(row.id)}
              >
                <input type="checkbox" tabIndex={-1} readOnly checked={chosen.has(row.id)} />
                {row.avatarUrl ? <img src={row.avatarUrl} alt="" /> : null}
                <span className="slack-user-select-name">{row.name}</span>
                {row.realName ? (
                  <span className="slack-user-select-sub">{row.realName}</span>
                ) : null}
                {row.isBot ? <span className="slack-user-select-sub">bot</span> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
      {props.hint ? <span className="hint">{props.hint}</span> : null}
    </div>
  );
}
