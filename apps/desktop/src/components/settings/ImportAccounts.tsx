import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatRemoteError,
  forgeLabel,
  isForgeAuthError,
  normalizeRepoUrl,
  type ForgeImportAccount,
  type ForgeRepoHint,
} from "@locus/shared";
import { IconLock } from "@/components/layout/Icons";
import { SearchField } from "@/components/layout/SearchField";

type Visibility = "all" | "private" | "public";

function importRepoKey(hint: ForgeRepoHint): string {
  return `${hint.accountId}:${hint.url}`;
}

function matchesQuery(hint: ForgeRepoHint, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${hint.owner}/${hint.name}`.toLowerCase().includes(q);
}

function isLinkedUrl(hint: ForgeRepoHint, linked: Set<string>): boolean {
  return linked.has(normalizeRepoUrl(hint.url));
}

function groupByOwner(repos: ForgeRepoHint[]): Array<{ owner: string; repos: ForgeRepoHint[] }> {
  const order: string[] = [];
  const buckets = new Map<string, ForgeRepoHint[]>();
  for (const repo of repos) {
    const list = buckets.get(repo.owner);
    if (list) list.push(repo);
    else {
      order.push(repo.owner);
      buckets.set(repo.owner, [repo]);
    }
  }
  return order.map((owner) => ({ owner, repos: buckets.get(owner)! }));
}

function filterRepos(
  repos: ForgeRepoHint[],
  query: string,
  visibility: Visibility,
): ForgeRepoHint[] {
  return repos.filter((hint) => {
    if (visibility === "private" && !hint.private) return false;
    if (visibility === "public" && hint.private) return false;
    return matchesQuery(hint, query);
  });
}

function AccountImportError(props: { error: string; onOpenGitSettings?: () => void }) {
  const message = formatRemoteError(props.error);
  return (
    <div className="error-row" role="alert">
      <span className="error-dot" aria-hidden="true" />
      <p>{message}</p>
      {props.onOpenGitSettings && isForgeAuthError(message) ? (
        <button type="button" className="btn small" onClick={props.onOpenGitSettings}>
          Open Git settings
        </button>
      ) : null}
    </div>
  );
}

export function ImportAccounts(props: {
  accounts: ForgeImportAccount[];
  loading?: boolean;
  busy?: boolean;
  linkedUrls?: string[];
  onLink: (hints: ForgeRepoHint[]) => void;
  onDismiss?: () => void;
  onOpenGitSettings?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("all");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const linked = useMemo(
    () => new Set((props.linkedUrls ?? []).map(normalizeRepoUrl)),
    [props.linkedUrls],
  );

  useEffect(() => {
    if (props.loading) return;
    searchRef.current?.focus();
  }, [props.loading, props.accounts]);

  const total = useMemo(
    () => props.accounts.reduce((sum, account) => sum + account.repos.length, 0),
    [props.accounts],
  );

  const visible = useMemo(
    () => props.accounts.flatMap((account) => filterRepos(account.repos, query, visibility)),
    [props.accounts, query, visibility],
  );
  const selectable = visible.filter((hint) => !isLinkedUrl(hint, linked));
  const selectableKeys = selectable.map(importRepoKey);
  const allVisiblePicked =
    selectableKeys.length > 0 && selectableKeys.every((key) => picked.has(key));

  function toggle(key: string, on: boolean) {
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function toggleKeys(keys: string[], on: boolean) {
    setPicked((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  function linkPicked() {
    const chosen: ForgeRepoHint[] = [];
    const seen = new Set<string>();
    for (const account of props.accounts) {
      for (const hint of account.repos) {
        const key = importRepoKey(hint);
        if (!picked.has(key) || seen.has(key) || isLinkedUrl(hint, linked)) continue;
        seen.add(key);
        chosen.push(hint);
      }
    }
    if (chosen.length) props.onLink(chosen);
  }

  if (props.loading) {
    return (
      <div className="import-accounts" data-testid="import-accounts" aria-busy="true">
        <div className="import-skeleton" data-testid="import-skeleton">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="import-skeleton-row" key={i}>
              <span className="skeleton chip" />
              <span className="skeleton line" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="import-accounts" data-testid="import-accounts">
      <div className="import-toolbar">
        <SearchField
          ref={searchRef}
          className="import-search"
          wrapClassName="import-search-wrap"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search repositories"
          aria-label="Search repositories"
        />
        <div className="import-filters" role="group" aria-label="Visibility">
          {(
            [
              ["all", "All"],
              ["private", "Private"],
              ["public", "Public"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={visibility === id ? "active" : undefined}
              aria-pressed={visibility === id}
              onClick={() => setVisibility(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="import-meta">
        <p className="hint">
          {visible.length === total
            ? `${total} ${total === 1 ? "repository" : "repositories"}`
            : `${visible.length} of ${total}`}
        </p>
        <div className="import-meta-actions">
          <button
            type="button"
            className="btn small ghost"
            disabled={selectableKeys.length === 0}
            onClick={() => toggleKeys(selectableKeys, !allVisiblePicked)}
          >
            {allVisiblePicked ? "Clear visible" : "Select all"}
          </button>
          {picked.size > 0 ? (
            <button type="button" className="btn small ghost" onClick={() => setPicked(new Set())}>
              Clear
            </button>
          ) : null}
        </div>
      </div>
      <div className="import-list">
        {props.accounts.map((account) => {
          const rows = filterRepos(account.repos, query, visibility);
          return (
            <section key={account.accountId} className="import-account">
              <header className="import-account-head">
                <h3>
                  {account.accountName}
                  <span className={`forge-badge ${account.kind}`}>{forgeLabel(account.kind)}</span>
                </h3>
                <span className="hint">
                  {rows.length}
                  {rows.length !== account.repos.length ? ` / ${account.repos.length}` : ""}
                </span>
              </header>
              {account.error ? (
                <AccountImportError
                  error={account.error}
                  onOpenGitSettings={props.onOpenGitSettings}
                />
              ) : null}
              {rows.length === 0 && !account.error ? (
                <p className="hint import-empty">
                  {account.repos.length === 0
                    ? "No repositories on this account."
                    : "No matching repositories."}
                </p>
              ) : null}
              {groupByOwner(rows).map((group) => {
                const groupKeys = group.repos
                  .filter((hint) => !isLinkedUrl(hint, linked))
                  .map(importRepoKey);
                const groupAllOn =
                  groupKeys.length > 0 && groupKeys.every((key) => picked.has(key));
                return (
                  <div key={group.owner} className="import-owner">
                    <div className="import-owner-head">
                      <span className="import-owner-name">{group.owner}</span>
                      <span className="hint">{group.repos.length}</span>
                      {groupKeys.length ? (
                        <button
                          type="button"
                          className="btn small ghost"
                          onClick={() => toggleKeys(groupKeys, !groupAllOn)}
                        >
                          {groupAllOn ? "Clear" : "Select"}
                        </button>
                      ) : null}
                    </div>
                    {group.repos.map((hint) => {
                      const key = importRepoKey(hint);
                      const linkedRow = isLinkedUrl(hint, linked);
                      return (
                        <label
                          key={key}
                          className={`import-row${picked.has(key) ? " picked" : ""}${
                            linkedRow ? " linked" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={linkedRow || picked.has(key)}
                            disabled={linkedRow}
                            aria-label={`${hint.owner}/${hint.name}`}
                            onChange={(e) => toggle(key, e.target.checked)}
                          />
                          <span className="import-row-main">
                            <span className="import-row-name">{hint.name}</span>
                            {hint.private ? (
                              <span className="import-private">
                                <IconLock />
                                private
                              </span>
                            ) : null}
                            {linkedRow ? <span className="import-linked">Linked</span> : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      <div className="import-foot">
        <button
          type="button"
          className="btn primary"
          disabled={props.busy || picked.size === 0}
          onClick={linkPicked}
        >
          Link selected ({picked.size})
        </button>
        {props.onDismiss ? (
          <button
            type="button"
            className="btn ghost"
            disabled={props.busy}
            onClick={props.onDismiss}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}
