import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { useDialogFocus } from "@/lib/useDialogFocus";
import { folderName, loadIdeRecents, rememberIdeRecent } from "@/lib/ideRecents";
import { IconFolder } from "@/components/layout/Icons";
import { SearchField } from "@/components/layout/SearchField";

type HostListing = {
  path: string;
  parent: string | null;
  entries: { name: string; path: string }[];
  blocked?: string;
};

export function HostFolderPicker({
  open,
  initialPath,
  title = "Choose folder",
  confirmLabel = "Select folder",
  lead = "Choose a folder on this machine.",
  onClose,
  onPick,
}: {
  open: boolean;
  initialPath?: string;
  title?: string;
  confirmLabel?: string;
  lead?: string;
  onClose: () => void;
  onPick: (dir: string) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [listing, setListing] = useState<HostListing | null>(null);
  const [pathDraft, setPathDraft] = useState("");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useDialogFocus(open, onClose, dialogRef);

  async function load(path?: string) {
    setBusy(true);
    setError(null);
    try {
      const next = await api.browseHost(path);
      setListing(next);
      setPathDraft(next.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not list folders");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!open) {
      setListing(null);
      setError(null);
      setFilter("");
      setPathDraft("");
      return;
    }
    void load(initialPath?.trim() || undefined);
  }, [open, initialPath]);

  const recents = useMemo(() => (open ? loadIdeRecents() : []), [open]);
  const needle = filter.trim().toLowerCase();
  const entries = (listing?.entries ?? []).filter((entry) =>
    needle ? entry.name.toLowerCase().includes(needle) : true,
  );
  const recentRows = recents.filter((row) => row.path !== listing?.path);

  function choose(dir: string) {
    rememberIdeRecent(dir);
    onPick(dir);
    onClose();
  }

  function go(path?: string) {
    setFilter("");
    void load(path);
  }

  if (!open) return null;

  const dialog = (
    <div className="modal-backdrop host-folder-backdrop" onClick={onClose}>
      <div
        className="modal host-folder-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="host-folder-title"
        data-testid="host-folder-picker"
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="host-folder-title">{title}</h2>
        <p className="modal-lead">{lead}</p>
        <form
          className="field host-folder-modal-path"
          onSubmit={(event) => {
            event.preventDefault();
            go(pathDraft.trim() || undefined);
          }}
        >
          <div className="host-folder-row">
            <input
              value={pathDraft}
              onChange={(e) => setPathDraft(e.target.value)}
              spellCheck={false}
              aria-label="Folder path"
              placeholder="/path/to/folder"
            />
            <button type="submit" className="btn ghost" disabled={busy}>
              Go
            </button>
          </div>
        </form>
        <SearchField
          wrapClassName="host-folder-modal-filter"
          className="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter folders"
          aria-label="Filter folders"
        />
        {recentRows.length ? (
          <div className="host-folder-modal-recents">
            <p className="host-folder-modal-label">Recent</p>
            <div className="host-folder-modal-recent-list">
              {recentRows.map((row) => (
                <button
                  key={row.path}
                  type="button"
                  className="host-folder-modal-recent"
                  title={row.path}
                  onClick={() => go(row.path)}
                >
                  <IconFolder />
                  <span>
                    <span className="title-text">{row.title}</span>
                    <span className="meta">{row.path}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <p className="host-folder-modal-label">Folders</p>
        <div className="host-folder-modal-list" aria-label="Folders" aria-busy={busy}>
          {listing?.parent ? (
            <button
              type="button"
              className="host-folder-modal-item parent"
              onClick={() => go(listing.parent ?? undefined)}
            >
              <span className="host-folder-modal-item-icon" aria-hidden>
                ..
              </span>
              <span>
                <span className="title-text">Parent folder</span>
                <span className="meta">{listing.parent}</span>
              </span>
            </button>
          ) : null}
          {entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className="host-folder-modal-item"
              onClick={() => go(entry.path)}
            >
              <span className="host-folder-modal-item-icon" aria-hidden>
                <IconFolder />
              </span>
              <span className="title-text">{entry.name}</span>
            </button>
          ))}
          {busy && !listing ? <p className="hint">Listing…</p> : null}
          {listing && !entries.length ? (
            <p className="hint">
              {needle ? "No matching folders" : "No folders in this directory"}
            </p>
          ) : null}
        </div>
        {error ? <p className="hint">{error}</p> : null}
        {listing?.blocked ? <p className="hint">{listing.blocked}</p> : null}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!listing || Boolean(listing.blocked)}
            onClick={() => {
              if (!listing || listing.blocked) return;
              choose(listing.path);
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}

export function HostFolderField({
  value,
  onChange,
  remote = false,
}: {
  value: string;
  onChange: (dir: string) => void;
  remote?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = value.trim();

  return (
    <div className="host-folder-field">
      <div className="field">
        <label>Workspace folder</label>
        <div className="host-folder-row">
          <span className="host-folder-icon" aria-hidden>
            <IconFolder />
          </span>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={
              remote
                ? "Leave empty for a per-session folder on the worker"
                : "Leave empty for a per-session folder"
            }
            spellCheck={false}
            aria-label="Workspace folder"
          />
          {remote ? null : (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setOpen(true);
              }}
            >
              Browse
            </button>
          )}
        </div>
        <p className="hint">
          {remote
            ? "Path on the worker host, mapped to /workspace. Empty uses a private folder on that machine. Browse lists this laptop, so type the worker path."
            : selected
              ? `${folderName(selected)} maps to /workspace for file tools.`
              : "Maps to /workspace for file tools. Empty uses a private folder for this chat. Home, root, and credential directories are refused."}
        </p>
      </div>
      {remote ? null : (
        <HostFolderPicker
          open={open}
          initialPath={value}
          title="Workspace folder"
          confirmLabel="Select folder"
          lead="This folder maps to /workspace for the agent."
          onClose={() => setOpen(false)}
          onPick={onChange}
        />
      )}
    </div>
  );
}
