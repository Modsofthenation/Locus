import {
  ASSET_VIEW_FILES,
  ASSET_VIEW_SLOTS,
  formatAssetViewSlotLabel,
  namedAssetViewFile,
  viewSlotForAssetName,
  type AssetViewSlot,
} from "@locus/shared";
import { useEffect, useState } from "react";
import { filesFromDataTransfer, isImageFile } from "@/lib/attachments";

export type AssetViewFiles = Partial<Record<AssetViewSlot, File>>;

export function assignImageSlots(files: File[], current: AssetViewFiles = {}): AssetViewFiles {
  const next: AssetViewFiles = { ...current };
  const images = files.filter(isImageFile);
  for (let i = 0; i < images.length; i++) {
    const file = images[i]!;
    const preferred = viewSlotForAssetName(file.name, i, images.length);
    const slot = next[preferred] ? ASSET_VIEW_SLOTS.find((id) => !next[id]) : preferred;
    if (!slot) break;
    next[slot] = namedAssetViewFile(file, slot);
  }
  return next;
}

export function slotFilesList(slots: AssetViewFiles): File[] {
  return ASSET_VIEW_SLOTS.flatMap((slot) => {
    const file = slots[slot];
    return file ? [namedAssetViewFile(file, slot)] : [];
  });
}

export function AssetDropWell(props: {
  files?: AssetViewFiles;
  previews?: Partial<Record<AssetViewSlot, string>>;
  compact?: boolean;
  disabled?: boolean;
  onChange: (next: AssetViewFiles) => void;
  onDropFiles?: (files: File[], slot?: AssetViewSlot) => void;
}) {
  const files = props.files ?? {};

  function assign(slot: AssetViewSlot, file: File | null) {
    const next = { ...files };
    if (file) next[slot] = namedAssetViewFile(file, slot);
    else delete next[slot];
    props.onChange(next);
  }

  function takeFiles(incoming: File[], slot?: AssetViewSlot) {
    const images = incoming.filter(isImageFile);
    if (!images.length) return;
    if (props.onDropFiles) {
      props.onDropFiles(images, slot);
      return;
    }
    if (slot && images[0]) {
      assign(slot, images[0]);
      if (images.length > 1)
        props.onChange(assignImageSlots(images.slice(1), { ...files, [slot]: images[0] }));
      return;
    }
    props.onChange(assignImageSlots(images, files));
  }

  return (
    <div
      className={`asset-drop-well${props.compact ? " compact" : ""}`}
      aria-label="Source photos"
      onDragOver={(event) => {
        if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        const incoming = filesFromDataTransfer(event.dataTransfer);
        if (!incoming.length) return;
        event.preventDefault();
        takeFiles(incoming);
      }}
    >
      {props.compact ? null : (
        <p className="asset-drop-lead">Drop a photo to reconstruct — front, side, and back.</p>
      )}
      <div className="asset-drop-slots" role="group" aria-label="View slots">
        {ASSET_VIEW_SLOTS.map((slot) => {
          const file = files[slot];
          const preview = Boolean(file || props.previews?.[slot]);
          return (
            <label
              key={slot}
              className={`asset-drop-slot${preview ? " has-preview" : ""}`}
              aria-label={formatAssetViewSlotLabel(slot)}
              onDragOver={(event) => {
                if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
              }}
              onDrop={(event) => {
                const incoming = filesFromDataTransfer(event.dataTransfer);
                if (!incoming.length) return;
                event.preventDefault();
                event.stopPropagation();
                takeFiles(incoming, slot);
              }}
            >
              {preview ? (
                <SlotPreview file={file} src={file ? undefined : props.previews?.[slot]} />
              ) : (
                <span className="asset-drop-plus" aria-hidden>
                  +
                </span>
              )}
              <span className="asset-drop-slot-label">
                {formatAssetViewSlotLabel(slot)}
                <small>{ASSET_VIEW_FILES[slot]}</small>
              </span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                disabled={props.disabled}
                hidden
                onChange={(event) => {
                  const picked = event.target.files?.[0];
                  event.target.value = "";
                  if (picked) takeFiles([picked], slot);
                }}
              />
              {preview && !props.disabled ? (
                <button
                  type="button"
                  className="asset-drop-clear"
                  aria-label={`Remove ${formatAssetViewSlotLabel(slot)}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    assign(slot, null);
                  }}
                >
                  ×
                </button>
              ) : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function SlotPreview(props: { file?: File; src?: string }) {
  const [url, setUrl] = useState(props.src ?? "");
  useEffect(() => {
    if (!props.file) {
      setUrl(props.src ?? "");
      return;
    }
    const next = URL.createObjectURL(props.file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [props.file, props.src]);
  if (!url)
    return (
      <span className="asset-drop-plus" aria-hidden>
        +
      </span>
    );
  return <img src={url} alt="" />;
}
