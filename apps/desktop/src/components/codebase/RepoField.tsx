import { forgeLabel, type LinkedRepo } from "@locus/shared";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { IconClose } from "@/components/layout/Icons";
import { Select } from "@/components/layout/Select";
import { api } from "@/lib/api";

function repoShortName(name: string): string {
  const trimmed = name.replace(/\.git$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function repoRefFor(row: LinkedRepo, refs?: Record<string, string>): string {
  return (refs?.[row.id] ?? row.checkout.ref ?? "").trim();
}

function useRepoBranches(repoId: string | undefined, fallback?: string) {
  const [branches, setBranches] = useState<string[]>([]);
  const [defaultBranch, setDefaultBranch] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!repoId) {
      setBranches([]);
      setDefaultBranch(undefined);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setBranches(fallback?.trim() ? [fallback.trim()] : []);
    setDefaultBranch(undefined);
    void api
      .repoBranches(repoId)
      .then((listed) => {
        if (cancelled) return;
        setBranches(listed.branches);
        setDefaultBranch(listed.defaultBranch);
      })
      .catch(() => {
        if (cancelled) return;
        setBranches(fallback?.trim() ? [fallback.trim()] : []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, fallback]);

  return { branches, defaultBranch, loading };
}

function branchChoices(branches: string[], query: string) {
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? branches.filter((name) => name.toLowerCase().includes(needle))
    : branches;
  const custom = query.trim();
  const showCustom = Boolean(custom && !branches.some((name) => name === custom));
  const options = showCustom ? [custom, ...visible] : visible;
  return { visible, custom, showCustom, options };
}

function RepoBranchOptions(props: {
  options: string[];
  visible: string[];
  showCustom: boolean;
  selected: string;
  defaultBranch?: string;
  active: number;
  idPrefix: string;
  onPick: (name: string) => void;
  onActive: (index: number) => void;
}) {
  return (
    <>
      {props.options.map((name, index) => {
        const isCustom = props.showCustom && index === 0 && !props.visible.includes(name);
        const isDefault = name === props.defaultBranch;
        return (
          <button
            key={name}
            id={`${props.idPrefix}${encodeURIComponent(name)}`}
            type="button"
            role="option"
            aria-selected={name === props.selected}
            className={`composer-repo-option${name === props.selected ? " on" : ""}${
              index === props.active ? " active" : ""
            }`}
            onClick={() => props.onPick(name)}
            onMouseEnter={() => props.onActive(index)}
          >
            <span className="composer-repo-check" aria-hidden />
            <span className="composer-repo-option-copy">
              <span>{isCustom ? `Use “${name}”` : name}</span>
              <span className="composer-repo-option-meta">
                {isDefault ? "Default" : isCustom ? "Typed" : ""}
              </span>
            </span>
          </button>
        );
      })}
    </>
  );
}

export function ComposerRepoPicker(props: {
  repos: LinkedRepo[];
  repoIds: string[];
  repoRefs?: Record<string, string>;
  onChange: (repoIds: string[], repoRefs?: Record<string, string>) => void;
  /** Design sessions use the repo as read-only context, not a git workspace. */
  contextOnly?: boolean;
  /** Coding agents can clone several repos into /workspace/<name>. */
  multiple?: boolean;
}) {
  const selected = props.repoIds.filter(Boolean);
  const repoTitle = props.contextOnly
    ? props.multiple
      ? "Repositories for design context (read-only). First is primary. Click a repo to pick its branch. Locked after create."
      : "Repository for design context (read-only). Locked after create."
    : props.multiple
      ? "Repositories for this session. First is primary. Click a repo to pick its branch. Locked after create."
      : "Repository for this session. Locked after create.";
  const emptyLabel = props.contextOnly ? "No repo context" : "No repo";

  function setIds(ids: string[]) {
    props.onChange([...new Set(ids.filter(Boolean))]);
  }

  if (!props.multiple) {
    return (
      <div className="composer-repo-picker">
        <Select
          ariaLabel="Repository"
          value={selected[0] ?? ""}
          options={[
            { value: "", label: emptyLabel },
            ...props.repos.map((row) => ({
              value: row.id,
              label: `${row.name} · ${forgeLabel(row.checkout.forge)}`,
            })),
          ]}
          onChange={(id) => setIds(id ? [id] : [])}
        />
      </div>
    );
  }

  return (
    <ComposerRepoCombobox
      repos={props.repos}
      selected={selected}
      refs={props.repoRefs ?? {}}
      emptyLabel={emptyLabel}
      title={repoTitle}
      onChange={props.onChange}
    />
  );
}

function ComposerRepoCombobox(props: {
  repos: LinkedRepo[];
  selected: string[];
  refs: Record<string, string>;
  emptyLabel: string;
  title: string;
  onChange: (ids: string[], refs?: Record<string, string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<"repos" | "branch">("repos");
  const [stageRepoId, setStageRepoId] = useState<string | undefined>();
  const [repoQuery, setRepoQuery] = useState("");
  const [branchQuery, setBranchQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const showFilter = props.repos.length > 5;
  const needle = repoQuery.trim().toLowerCase();
  const visibleRepos = needle
    ? props.repos.filter(
        (row) =>
          row.name.toLowerCase().includes(needle) ||
          row.checkout.url.toLowerCase().includes(needle),
      )
    : props.repos;
  const stageRow = props.repos.find((row) => row.id === stageRepoId);
  const { branches, defaultBranch, loading } = useRepoBranches(
    stage === "branch" ? stageRepoId : undefined,
    stageRow?.checkout.ref,
  );
  const branch = branchChoices(branches, branchQuery);
  const picking = stage === "branch";
  const activeRepoId = visibleRepos[active]?.id;
  const activeBranchName = branch.options[active];
  const activeOptionId = picking
    ? activeBranchName
      ? `composer-branch-opt-${encodeURIComponent(activeBranchName)}`
      : undefined
    : activeRepoId
      ? `composer-repo-opt-${activeRepoId}`
      : undefined;

  function emit(ids: string[], refs: Record<string, string>) {
    const nextIds = [...new Set(ids.filter(Boolean))];
    const nextRefs: Record<string, string> = {};
    for (const id of nextIds) {
      const value = refs[id]?.trim();
      if (value) nextRefs[id] = value;
    }
    props.onChange(nextIds, nextRefs);
  }

  function close() {
    setOpen(false);
    setStage("repos");
    setStageRepoId(undefined);
    setRepoQuery("");
    setBranchQuery("");
    setActive(0);
  }

  function backToRepos() {
    setStage("repos");
    setStageRepoId(undefined);
    setBranchQuery("");
    setActive(0);
  }

  function openBranchStage(id: string) {
    setOpen(true);
    setStage("branch");
    setStageRepoId(id);
    setBranchQuery("");
    setActive(0);
  }

  function removeId(id: string) {
    const nextRefs = { ...props.refs };
    delete nextRefs[id];
    emit(
      props.selected.filter((item) => item !== id),
      nextRefs,
    );
    if (stageRepoId === id) backToRepos();
  }

  function pickBranch(name: string) {
    if (!stageRepoId) return;
    const ref = name.trim();
    if (!ref) return;
    const ids = props.selected.includes(stageRepoId)
      ? props.selected
      : [...props.selected, stageRepoId];
    emit(ids, { ...props.refs, [stageRepoId]: ref });
    backToRepos();
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
      if (stage === "branch") {
        event.preventDefault();
        backToRepos();
        return;
      }
      close();
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, stage]);

  useEffect(() => {
    if (!open) {
      setRepoQuery("");
      setBranchQuery("");
      setActive(0);
      setStage("repos");
      setStageRepoId(undefined);
      return;
    }
    search.current?.focus();
  }, [open, stage]);

  useEffect(() => {
    setActive(0);
  }, [repoQuery, branchQuery]);

  useEffect(() => {
    if (stage !== "branch" || !stageRow) return;
    const current = repoRefFor(stageRow, props.refs);
    const target = current || defaultBranch || branch.options[0];
    const idx = branch.options.findIndex((name) => name === target);
    setActive(idx >= 0 ? idx : 0);
  }, [stage, stageRepoId, branches, defaultBranch, branchQuery]);

  function moveActive(delta: number, length: number) {
    if (!length) return;
    setActive((value) => (value + delta + length) % length);
  }

  function onListKey(event: ReactKeyboardEvent) {
    const inFilter = event.target instanceof HTMLInputElement;
    const length = picking ? branch.options.length : visibleRepos.length;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      moveActive(1, length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      moveActive(-1, length);
      return;
    }
    if (event.key === "Home" && open && length && !inFilter) {
      event.preventDefault();
      setActive(0);
      return;
    }
    if (event.key === "End" && open && length && !inFilter) {
      event.preventDefault();
      setActive(length - 1);
      return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      if (picking) {
        if (activeBranchName) pickBranch(activeBranchName);
        else if (branch.custom) pickBranch(branch.custom);
        return;
      }
      if (activeRepoId) openBranchStage(activeRepoId);
      return;
    }
    if (event.key === " " && open && !inFilter) {
      event.preventDefault();
      if (picking) {
        if (activeBranchName) pickBranch(activeBranchName);
        return;
      }
      if (activeRepoId) openBranchStage(activeRepoId);
    }
  }

  return (
    <div className="composer-repo-picker composer-repo-combobox" ref={root}>
      <div
        className={`composer-repo-field${open ? " open" : ""}`}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest(".composer-repo-chip-x")) return;
          setOpen(true);
        }}
      >
        {props.selected.length === 0 ? (
          <span className="composer-repo-placeholder">{props.emptyLabel}</span>
        ) : (
          props.selected.map((id, index) => {
            const row = props.repos.find((item) => item.id === id);
            if (!row) return null;
            const primary = index === 0;
            const ref = repoRefFor(row, props.refs);
            return (
              <span
                key={id}
                className={`composer-repo-chip${primary ? " primary" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  openBranchStage(id);
                }}
              >
                <span
                  className="composer-repo-chip-name"
                  title={primary ? `${row.name} (primary)` : row.name}
                >
                  {repoShortName(row.name)}
                </span>
                {ref ? (
                  <span className="composer-repo-chip-ref" title={ref}>
                    {ref}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="composer-repo-chip-x"
                  aria-label={`Remove ${row.name}`}
                  title={`Remove ${row.name}`}
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
          aria-label="Repository"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls="composer-repo-listbox"
          aria-activedescendant={open ? activeOptionId : undefined}
          title={props.title}
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
          id="composer-repo-listbox"
          className="composer-repo-pop"
          role="listbox"
          aria-multiselectable={picking ? undefined : "true"}
          aria-label={picking ? "Branches" : "Repositories"}
          onKeyDown={onListKey}
        >
          {picking && stageRow ? (
            <>
              <div className="composer-repo-stage-head">
                <button
                  type="button"
                  className="composer-repo-back"
                  aria-label="Back to repositories"
                  onClick={backToRepos}
                >
                  Back
                </button>
                <span className="composer-repo-stage-title" title={stageRow.name}>
                  {stageRow.name}
                </span>
                {props.selected.includes(stageRow.id) ? (
                  <button
                    type="button"
                    className="composer-repo-stage-remove"
                    onClick={() => removeId(stageRow.id)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <input
                ref={search}
                className="composer-repo-search"
                value={branchQuery}
                placeholder="Filter or type a branch"
                aria-label="Filter branches"
                aria-controls="composer-repo-listbox"
                aria-activedescendant={activeOptionId}
                onChange={(event) => setBranchQuery(event.target.value)}
                onKeyDown={(event) => {
                  onListKey(event);
                  event.stopPropagation();
                }}
              />
              {branch.options.length === 0 ? (
                <p className="composer-repo-empty">
                  {branch.custom
                    ? `Use “${branch.custom}”`
                    : loading
                      ? "Loading branches…"
                      : "Type a branch name"}
                </p>
              ) : (
                <RepoBranchOptions
                  options={branch.options}
                  visible={branch.visible}
                  showCustom={branch.showCustom}
                  selected={repoRefFor(stageRow, props.refs)}
                  defaultBranch={defaultBranch}
                  active={active}
                  idPrefix="composer-branch-opt-"
                  onPick={pickBranch}
                  onActive={setActive}
                />
              )}
            </>
          ) : (
            <>
              {showFilter ? (
                <input
                  ref={search}
                  className="composer-repo-search"
                  value={repoQuery}
                  placeholder="Filter repositories"
                  aria-label="Filter repositories"
                  aria-controls="composer-repo-listbox"
                  aria-activedescendant={activeOptionId}
                  onChange={(event) => setRepoQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Backspace" && !repoQuery && props.selected.length) {
                      removeId(props.selected[props.selected.length - 1]!);
                      event.stopPropagation();
                      return;
                    }
                    onListKey(event);
                    event.stopPropagation();
                  }}
                />
              ) : null}
              {props.selected.length ? (
                <p className="composer-repo-hint">
                  First selected is the primary checkout. Click a repo to pick its branch.
                </p>
              ) : (
                <p className="composer-repo-hint">Click a repo, then choose the branch to clone.</p>
              )}
              {visibleRepos.length === 0 ? (
                <p className="composer-repo-empty">No matching repositories</p>
              ) : (
                visibleRepos.map((row, index) => {
                  const checked = props.selected.includes(row.id);
                  const primary = props.selected[0] === row.id;
                  const ref = repoRefFor(row, props.refs);
                  return (
                    <button
                      key={row.id}
                      id={`composer-repo-opt-${row.id}`}
                      type="button"
                      role="option"
                      aria-selected={checked}
                      className={`composer-repo-option${checked ? " on" : ""}${index === active ? " active" : ""}`}
                      onClick={() => openBranchStage(row.id)}
                      onMouseEnter={() => setActive(index)}
                    >
                      <span className="composer-repo-check" aria-hidden />
                      <span className="composer-repo-option-copy">
                        <span>{row.name}</span>
                        <span className="composer-repo-option-meta">
                          {forgeLabel(row.checkout.forge)}
                          {ref ? ` · ${ref}` : ""}
                          {primary ? " · Primary" : ""}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ComposerBranchPicker(props: {
  repoId: string;
  value: string;
  fallback?: string;
  onChange: (ref: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const selected = props.value.trim() || props.fallback?.trim() || "";
  const { branches, defaultBranch } = useRepoBranches(props.repoId, props.fallback);
  const { visible, custom, showCustom, options } = branchChoices(branches, query);
  const activeName = options[active];
  const activeOptionId = activeName
    ? `composer-branch-opt-${encodeURIComponent(activeName)}`
    : undefined;

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      const node = event.target;
      if (!(node instanceof Node) || root.current?.contains(node)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
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

  function pick(name: string) {
    props.onChange(name.trim());
    setOpen(false);
  }

  function moveActive(delta: number) {
    if (!options.length) return;
    setActive((value) => (value + delta + options.length) % options.length);
  }

  function onListKey(event: ReactKeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      moveActive(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      moveActive(-1);
      return;
    }
    if (
      event.key === "Home" &&
      open &&
      options.length &&
      !(event.target instanceof HTMLInputElement)
    ) {
      event.preventDefault();
      setActive(0);
      return;
    }
    if (
      event.key === "End" &&
      open &&
      options.length &&
      !(event.target instanceof HTMLInputElement)
    ) {
      event.preventDefault();
      setActive(options.length - 1);
      return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      if (activeName) pick(activeName);
      else if (custom) pick(custom);
    }
  }

  return (
    <div
      className="composer-repo-picker composer-repo-combobox composer-branch-combobox"
      ref={root}
    >
      <div className={`composer-repo-field${open ? " open" : ""}`} onClick={() => setOpen(true)}>
        {selected ? (
          <span className="composer-repo-chip-name" title={selected}>
            {selected}
          </span>
        ) : (
          <span className="composer-repo-placeholder">Branch</span>
        )}
        <button
          type="button"
          className="composer-repo-toggle"
          role="combobox"
          aria-autocomplete="list"
          aria-label="Branch"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls="composer-branch-listbox"
          aria-activedescendant={open ? activeOptionId : undefined}
          title="Branch to check out. Locked after create."
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
          onKeyDown={onListKey}
        >
          <span className="composer-repo-caret" aria-hidden />
        </button>
      </div>
      {open ? (
        <div
          id="composer-branch-listbox"
          className="composer-repo-pop"
          role="listbox"
          aria-label="Branches"
          onKeyDown={onListKey}
        >
          <input
            ref={search}
            className="composer-repo-search"
            value={query}
            placeholder="Filter or type a branch"
            aria-label="Filter branches"
            aria-controls="composer-branch-listbox"
            aria-activedescendant={activeOptionId}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              onListKey(event);
              event.stopPropagation();
            }}
          />
          {options.length === 0 ? (
            <p className="composer-repo-empty">
              {custom ? `Use “${custom}”` : "Type a branch name"}
            </p>
          ) : (
            <RepoBranchOptions
              options={options}
              visible={visible}
              showCustom={showCustom}
              selected={selected}
              defaultBranch={defaultBranch}
              active={active}
              idPrefix="composer-branch-opt-"
              onPick={pick}
              onActive={setActive}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

export function RepoField(props: {
  repos: LinkedRepo[];
  repoId: string;
  extraRepoIds?: string[];
  url: string;
  onRepoId: (id: string) => void;
  onExtraRepoIds?: (ids: string[]) => void;
  onUrl: (url: string) => void;
  onRef?: (ref: string) => void;
}) {
  const extra = (props.extraRepoIds ?? []).filter((id) => id && id !== props.repoId);
  return (
    <>
      {props.repos.length > 0 ? (
        <div className="field">
          <label>Linked repo</label>
          <Select
            ariaLabel="Linked repo"
            value={props.repoId}
            options={[
              { value: "", label: "Paste a URL" },
              ...props.repos.map((row) => ({
                value: row.id,
                label: `${row.name} · ${forgeLabel(row.checkout.forge)}`,
              })),
            ]}
            onChange={(id) => {
              props.onRepoId(id);
              const linked = props.repos.find((row) => row.id === id);
              if (linked) {
                props.onUrl(linked.checkout.url);
                if (linked.checkout.ref) props.onRef?.(linked.checkout.ref);
              }
              if (id) props.onExtraRepoIds?.(extra.filter((row) => row !== id));
              else props.onExtraRepoIds?.([]);
            }}
          />
        </div>
      ) : null}
      <div className="field">
        <label>Repository</label>
        <input
          value={props.url}
          onChange={(e) => {
            props.onUrl(e.target.value);
            props.onRepoId("");
            props.onExtraRepoIds?.([]);
          }}
          placeholder="https://github.com/acme/app, https://gitlab.com/acme/app, or https://bitbucket.org/org/repo"
        />
      </div>
      {props.repos.length > 1 && props.onExtraRepoIds && props.repoId ? (
        <div className="field">
          <label>Also clone</label>
          <div className="repo-extra-list">
            {props.repos
              .filter((row) => row.id !== props.repoId)
              .map((row) => {
                const checked = extra.includes(row.id);
                return (
                  <label key={row.id} className="repo-extra-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        props.onExtraRepoIds?.(
                          checked ? extra.filter((id) => id !== row.id) : [...extra, row.id],
                        );
                      }}
                    />
                    {row.name} · {forgeLabel(row.checkout.forge)}
                  </label>
                );
              })}
          </div>
          <p className="hint">
            Extra repos clone into <code>/workspace/&lt;name&gt;</code> next to the primary
            checkout.
          </p>
        </div>
      ) : null}
    </>
  );
}
