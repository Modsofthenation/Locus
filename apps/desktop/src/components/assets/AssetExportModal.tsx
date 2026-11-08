import {
  ASSET_EXPORT_DONE_MS,
  assetExportPhaseCopy,
  formatAssetExportTitle,
  type AssetExportJob,
} from "@locus/shared";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@/components/layout/Modal";
import { HostFolderPicker } from "@/components/workspace/HostFolderField";

export const ASSET_EXPORT_DIR_KEY = "locus.assetExportDir";

export function loadAssetExportDir(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): string {
  if (!storage) return "";
  try {
    return storage.getItem(ASSET_EXPORT_DIR_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function rememberAssetExportDir(
  dir: string,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage,
): void {
  const clean = dir.trim();
  if (!clean || !storage) return;
  try {
    storage.setItem(ASSET_EXPORT_DIR_KEY, clean);
  } catch {
    /* quota / private mode */
  }
}

export function AssetExportModal(props: {
  progress: AssetExportJob;
  onClose: () => void;
  onExport?: (next: { filename: string; folder: string }) => void;
}) {
  const { progress, onClose, onExport } = props;
  const saveAs = progress.phase === "save";
  const busy = !saveAs && progress.phase !== "done" && progress.phase !== "error";
  const determinate = progress.phase !== "start";
  const status = assetExportPhaseCopy(progress);
  const [filename, setFilename] = useState(progress.filename ?? "");
  const [folder, setFolder] = useState(progress.folder ?? "");
  const [browseOpen, setBrowseOpen] = useState(false);

  useEffect(() => {
    if (progress.phase !== "done") return;
    const id = window.setTimeout(onClose, ASSET_EXPORT_DONE_MS);
    return () => window.clearTimeout(id);
  }, [progress.phase, onClose]);

  function confirmExport() {
    const name = filename.trim();
    const dir = folder.trim();
    if (!name || !dir || !onExport) return;
    onExport({ filename: name, folder: dir });
  }

  const dialog = (
    <>
      <Modal
        titleId="asset-export-title"
        className="close-confirm asset-export"
        testId="asset-export-modal"
        busy={busy}
        onClose={onClose}
      >
        <h2 id="asset-export-title">{formatAssetExportTitle(progress.format)}</h2>
        <p className="modal-lead" aria-live="polite">
          {status}
        </p>
        {saveAs ? (
          <div className="asset-export-fields">
            <div className="field">
              <label htmlFor="asset-export-filename">Name</label>
              <input
                id="asset-export-filename"
                data-testid="asset-export-filename"
                value={filename}
                onChange={(event) => setFilename(event.target.value)}
                spellCheck={false}
                autoComplete="off"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    confirmExport();
                  }
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="asset-export-folder">Folder</label>
              <div className="host-folder-row">
                <input
                  id="asset-export-folder"
                  data-testid="asset-export-folder"
                  value={folder}
                  onChange={(event) => setFolder(event.target.value)}
                  spellCheck={false}
                  placeholder="/path/to/folder"
                  aria-label="Export folder"
                />
                <button type="button" className="btn ghost" onClick={() => setBrowseOpen(true)}>
                  Browse
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div
            className={
              determinate ? "asset-export-progress" : "asset-export-progress is-indeterminate"
            }
            role="progressbar"
            aria-label={`${formatAssetExportTitle(progress.format)} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={determinate ? Math.round(progress.percent) : undefined}
          >
            <span style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }} />
          </div>
        )}
        {progress.phase === "error" &&
        progress.error?.trim() &&
        progress.error.trim() !== status ? (
          <p className="asset-export-error">{progress.error}</p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            {progress.phase === "error" ? "Dismiss" : progress.phase === "done" ? "Done" : "Cancel"}
          </button>
          {saveAs ? (
            <button
              type="button"
              className="btn primary"
              data-testid="asset-export-confirm"
              disabled={!filename.trim() || !folder.trim()}
              onClick={confirmExport}
            >
              Export
            </button>
          ) : null}
        </div>
      </Modal>
      <HostFolderPicker
        open={browseOpen}
        initialPath={folder}
        title="Export folder"
        confirmLabel="Select folder"
        lead="Choose where to save this asset."
        onClose={() => setBrowseOpen(false)}
        onPick={setFolder}
      />
    </>
  );

  return createPortal(dialog, document.body);
}
