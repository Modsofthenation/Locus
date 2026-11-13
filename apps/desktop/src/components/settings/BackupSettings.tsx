import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { APP_VERSION } from "@/lib/appInfo";
import { desktopBridge } from "@/lib/closeGuard";
import { askConfirm } from "@/lib/dialog";

function bytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** Settings → Advanced → Back up and restore. */
export function BackupSettings() {
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [out, setOut] = useState("");
  const [disks, setDisks] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [restorePass, setRestorePass] = useState("");
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<{ stagedAt: string; from: string } | null>(null);
  const [busy, setBusy] = useState<"backup" | "inspect" | "restore" | null>(null);

  useEffect(() => {
    // Older control planes (and partial API mocks) have no restore route.
    void Promise.resolve()
      .then(() => api.restoreStatus())
      .then((r) => setPending(r.pending))
      .catch(() => undefined);
  }, []);

  const mismatch = pass2.length > 0 && pass !== pass2;
  const bridge = desktopBridge();

  async function backup() {
    setBusy("backup");
    setBackupMsg(null);
    try {
      const result = await api.backup({
        passphrase: pass,
        out: out.trim() || undefined,
        includeDisks: disks,
        appVersion: APP_VERSION,
      });
      const skipped = result.manifest.skipped.length
        ? ` ${result.manifest.skipped.length} unreadable files were skipped.`
        : "";
      setBackupMsg(
        `Saved ${result.manifest.files} files (${bytes(result.sizeBytes)}) to ${result.path}.${skipped} Keep the passphrase; it cannot be recovered.`,
      );
      setPass("");
      setPass2("");
    } catch (err) {
      setBackupMsg(err instanceof Error ? err.message : "Backup failed");
    } finally {
      setBusy(null);
    }
  }

  async function inspect() {
    setBusy("inspect");
    setRestoreMsg(null);
    try {
      const m = await api.inspectBackup(path.trim(), restorePass);
      setRestoreMsg(
        `Backup from ${new Date(m.createdAt).toLocaleString()} (Locus ${m.appVersion ?? "?"}, ${m.platform}): ${m.files} files, ${bytes(m.bytes)}${m.includeDisks ? ", with VM disks" : ""}.`,
      );
    } catch (err) {
      setRestoreMsg(err instanceof Error ? err.message : "Could not read the backup");
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    setBusy("restore");
    setRestoreMsg(null);
    try {
      const result = await api.stageRestore(path.trim(), restorePass);
      setRestoreMsg(
        `Staged ${result.files} files. Restart Locus to finish; your current data moves to ~/.locus/.before-restore-*.`,
      );
      setRestorePass("");
      const status = await api.restoreStatus();
      setPending(status.pending);
    } catch (err) {
      setRestoreMsg(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className="advanced" open id="settings-advanced-backup" data-testid="backup-settings">
      <summary>Back up and restore</summary>
      <p className="scrim-note">
        One encrypted file with your sessions, settings, stored keys and tokens, boards, projects,
        Jobs, Brain and agent workspaces. Keys are re-encrypted for the new machine on restore.
        Logs, caches and dependency folders are left out.
      </p>
      <div className="backup-grid">
        <label>
          Passphrase (8+ characters)
          <input
            type="password"
            autoComplete="new-password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </label>
        <label>
          Repeat passphrase
          <input
            type="password"
            autoComplete="new-password"
            value={pass2}
            aria-invalid={mismatch}
            onChange={(e) => setPass2(e.target.value)}
          />
        </label>
        <label>
          Save to (optional)
          <input
            type="text"
            placeholder="~/locus-backup-<date>.locusbak"
            value={out}
            onChange={(e) => setOut(e.target.value)}
          />
        </label>
        <label className="backup-check">
          <input type="checkbox" checked={disks} onChange={(e) => setDisks(e.target.checked)} />
          Include VM disks and images (can be many GB)
        </label>
      </div>
      <div className="about-updates-actions">
        <button
          type="button"
          className="btn small"
          data-testid="backup-start"
          disabled={busy !== null || pass.length < 8 || pass !== pass2}
          onClick={() => void backup()}
        >
          {busy === "backup" ? "Backing up…" : "Back up now"}
        </button>
      </div>
      {mismatch ? <p className="hint">The passphrases do not match.</p> : null}
      {backupMsg ? (
        <p className="hint" role="status">
          {backupMsg}
        </p>
      ) : null}

      <h4 className="backup-restore-title">Restore</h4>
      {pending ? (
        <div className="about-updates-actions" data-testid="restore-pending">
          <p className="hint">
            A restore of {pending.from} is staged. It applies the next time Locus starts.
          </p>
          {bridge?.restartApp ? (
            <button
              type="button"
              className="btn small primary"
              onClick={() => void bridge.restartApp?.()}
            >
              Restart Locus now
            </button>
          ) : null}
          <button
            type="button"
            className="btn small"
            onClick={() =>
              void api.cancelRestore().then(() => {
                setPending(null);
                setRestoreMsg("Cancelled the staged restore.");
              })
            }
          >
            Cancel restore
          </button>
        </div>
      ) : null}
      <div className="backup-grid">
        <label>
          Backup file
          <input
            type="text"
            placeholder="/path/to/locus-backup.locusbak"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </label>
        <label>
          Passphrase
          <input
            type="password"
            autoComplete="current-password"
            value={restorePass}
            onChange={(e) => setRestorePass(e.target.value)}
          />
        </label>
      </div>
      <div className="about-updates-actions">
        <button
          type="button"
          className="btn small"
          disabled={busy !== null || !path.trim() || restorePass.length < 8}
          onClick={() => void inspect()}
        >
          {busy === "inspect" ? "Checking…" : "Check backup"}
        </button>
        <button
          type="button"
          className="btn small danger"
          data-testid="restore-start"
          disabled={busy !== null || !path.trim() || restorePass.length < 8}
          onClick={() =>
            void askConfirm({
              title: "Restore from backup?",
              body: "This replaces this machine's Locus data when Locus next starts. Your current files are kept under ~/.locus/.before-restore-*.",
              confirmLabel: "Restore",
              danger: true,
            }).then((ok) => {
              if (ok) void restore();
            })
          }
        >
          {busy === "restore" ? "Restoring…" : "Restore from backup"}
        </button>
      </div>
      {restoreMsg ? (
        <p className="hint" role="status">
          {restoreMsg}
        </p>
      ) : null}
    </details>
  );
}
