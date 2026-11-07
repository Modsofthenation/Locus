import {
  assetPreviewUrl,
  isAssetSession,
  sessionDisplayName,
  type AgentSession,
} from "@locus/shared";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { IconClose } from "@/components/layout/Icons";
import { AssetThumb } from "@/components/assets/AssetThumb";

export function liveAssetSessions(sessions: AgentSession[]): AgentSession[] {
  return sessions
    .filter((row) => isAssetSession(row) && !row.archived)
    .sort((a, b) => sessionDisplayName(a).localeCompare(sessionDisplayName(b)));
}

export function ComposerAssetPicker(props: {
  sessions: AgentSession[];
  assetIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const assets = liveAssetSessions(props.sessions);
  const selected = props.assetIds.filter((id) => assets.some((row) => row.id === id));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? assets.filter((row) => sessionDisplayName(row).toLowerCase().includes(needle))
    : assets;
  const activeId = visible[active]?.id;
  const activeOptionId = activeId ? `composer-asset-opt-${activeId}` : undefined;

  function emit(ids: string[]) {
    props.onChange([...new Set(ids.filter(Boolean))]);
  }

  function close() {
    setOpen(false);
    setQuery("");
    setActive(0);
  }

  function toggleId(id: string) {
    emit(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  }

  function removeId(id: string) {
    emit(selected.filter((item) => item !== id));
  }

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      const node = event.target;
      if (!(node instanceof Node) || root.current?.contains(node)) return;
      close();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      close();
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
      return;
    }
    search.current?.focus();
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  function onListKey(event: ReactKeyboardEvent) {
    const inFilter = event.target instanceof HTMLInputElement;
    const length = visible.length;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (!length) return;
      setActive((value) => (value + 1) % length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (!length) return;
      setActive((value) => (value - 1 + length) % length);
      return;
    }
    if (event.key === "Enter" && open && activeId) {
      event.preventDefault();
      toggleId(activeId);
      return;
    }
    if (event.key === " " && open && !inFilter && activeId) {
      event.preventDefault();
      toggleId(activeId);
    }
  }

  return (
    <div className="composer-repo-picker composer-repo-combobox composer-asset-picker" ref={root}>
      <div
        className={`composer-repo-field${open ? " open" : ""}`}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest(".composer-repo-chip-x")) return;
          setOpen(true);
        }}
      >
        {selected.length === 0 ? (
          <span className="composer-repo-placeholder">No asset</span>
        ) : (
          selected.map((id) => {
            const row = assets.find((item) => item.id === id);
            if (!row) return null;
            const name = sessionDisplayName(row);
            return (
              <span key={id} className="composer-repo-chip">
                <AssetThumb compact src={assetPreviewUrl(row.id, row.assetPack)} />
                <span className="composer-repo-chip-name" title={name}>
                  {name}
                </span>
                <button
                  type="button"
                  className="composer-repo-chip-x"
                  aria-label={`Remove ${name}`}
                  title={`Remove ${name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    removeId(id);
                  }}
                >
                  <IconClose />
                </button>
              </span>
            );
          })
        )}
        <button
          type="button"
          className="composer-repo-toggle"
          role="combobox"
          aria-autocomplete="list"
          aria-label="Assets"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls="composer-asset-listbox"
          aria-activedescendant={open ? activeOptionId : undefined}
          title="Assets studios to link into vendor/assets."
          onClick={(event) => {
            event.stopPropagation();
            if (open) close();
            else setOpen(true);
          }}
          onKeyDown={onListKey}
        >
          <span className="composer-repo-caret" aria-hidden />
        </button>
      </div>
      {open ? (
        <div
          id="composer-asset-listbox"
          className="composer-repo-pop"
          role="listbox"
          aria-multiselectable="true"
          aria-label="Assets"
          onKeyDown={onListKey}
        >
          {assets.length > 5 ? (
            <input
              ref={search}
              className="composer-repo-search"
              placeholder="Search assets"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-controls="composer-asset-listbox"
            />
          ) : null}
          {visible.length === 0 ? (
            <p className="composer-repo-empty">
              {assets.length ? "No matching assets" : "No assets yet"}
            </p>
          ) : (
            visible.map((row, index) => {
              const checked = selected.includes(row.id);
              return (
                <button
                  key={row.id}
                  id={`composer-asset-opt-${row.id}`}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  className={`composer-repo-option${checked ? " on" : ""}${index === active ? " active" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => toggleId(row.id)}
                >
                  <span className="composer-repo-check" aria-hidden />
                  <AssetThumb src={assetPreviewUrl(row.id, row.assetPack)} />
                  <span className="composer-repo-option-copy">{sessionDisplayName(row)}</span>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
