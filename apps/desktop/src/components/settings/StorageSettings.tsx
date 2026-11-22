import { useState } from "react";
import type { StorageEntry, StorageInventory } from "@locus/shared";
import { api } from "@/lib/api";
import { formatBytes } from "./DebugLogView";

const CATEGORIES = {
  worktrees: "Worktrees",
  disks: "VM disks",
  images: "Golden images",
  recordings: "Recordings",
  "visual-reviews": "Visual reviews",
} satisfies Record<StorageEntry["category"], string>;

export function StorageSettings() {
  const [inventory, setInventory] = useState<StorageInventory>();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const reclaimable = (inventory?.entries ?? []).filter((row) => row.reclaimableBytes > 0);
  const cleanup = reclaimable.filter((row) => selected.includes(row.id));
  const reclaim = (rows: StorageEntry[]) =>
    rows.reduce((bytes, row) => bytes + row.reclaimableBytes, 0);

  async function refresh(mutation?: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setConfirming(false);
    try {
      await mutation?.();
      setInventory(await api.storageInventory());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section">
      <h3>Storage and cleanup</h3>
      <p className="hint">
        See disk usage and reclaim recordings left by deleted sessions. Pins protect items from this
        cleanup.
      </p>
      <button type="button" className="btn small" disabled={busy} onClick={() => void refresh()}>
        {busy ? "Working…" : inventory ? "Rescan storage" : "Scan storage"}
      </button>
      {error ? (
        <p role="alert" className="hint is-danger">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {inventory ? (
        <>
          {!inventory.complete ? (
            <p className="hint">The scan reached its time limit. Sizes are partial.</p>
          ) : null}
          {(Object.entries(CATEGORIES) as [StorageEntry["category"], string][]).map(
            ([category, label]) => {
              const rows = inventory.entries.filter((row) => row.category === category);
              const bytes = rows.reduce((sum, row) => sum + row.bytes, 0);
              return (
                <details key={category}>
                  <summary>
                    {label} · {formatBytes(bytes)} · {rows.length} items
                  </summary>
                  <ul>
                    {rows.map((row) => (
                      <li key={row.id}>
                        {row.reclaimableBytes > 0 ? (
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.name} for cleanup`}
                            disabled={busy || confirming}
                            checked={selected.includes(row.id)}
                            onChange={(event) =>
                              setSelected(
                                event.target.checked
                                  ? [...selected, row.id]
                                  : selected.filter((id) => id !== row.id),
                              )
                            }
                          />
                        ) : null}
                        <span>
                          {row.name} · {formatBytes(row.bytes)}
                        </span>{" "}
                        <button
                          type="button"
                          className="btn small ghost"
                          disabled={busy || confirming}
                          onClick={() => void refresh(() => api.pinStorage(row.id, !row.pinned))}
                        >
                          {row.pinned ? "Unpin" : "Pin"}
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            },
          )}
          <p>{formatBytes(reclaim(reclaimable))} eligible for cleanup.</p>
          {confirming ? (
            <div>
              <p>
                Delete old recordings from {cleanup.length} selected folders and reclaim up to{" "}
                {formatBytes(reclaim(cleanup))}?
              </p>
              <button type="button" className="btn small" onClick={() => setConfirming(false)}>
                Cancel
              </button>{" "}
              <button
                type="button"
                className="btn small"
                onClick={() =>
                  void refresh(async () => {
                    const result = await api.cleanupStorage(cleanup.map((row) => row.id));
                    setSelected([]);
                    setNotice(
                      `Removed ${result.removed} recordings and reclaimed ${formatBytes(result.bytes)}.`,
                    );
                  })
                }
              >
                Delete selected recordings
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn small"
              disabled={busy || !cleanup.length || cleanup.length > 200}
              onClick={() => setConfirming(true)}
            >
              Preview cleanup
            </button>
          )}
        </>
      ) : null}
    </section>
  );
}
