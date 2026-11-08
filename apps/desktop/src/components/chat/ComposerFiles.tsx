import {
  firstOversizeAttachment,
  movePasteChipCaret,
  pasteChipNames,
  snapPasteChipSelection,
} from "@locus/shared";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEventHandler,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { clipboardChipLabel, isImageFile, isPastedTextFile } from "@/lib/attachments";
import {
  fileForPasteChip,
  highlightPasteChips,
  pastePreviewText,
  pointInRects,
} from "@/lib/composerPaste";
import { IconClose, IconPlus } from "@/components/layout/Icons";
import { Tooltip } from "@/components/layout/Tooltip";
import { placeMenuPop } from "@/components/layout/OverflowMenu";

export const COMPOSER_FILE_CAP = 4;
export const COMPOSER_FILE_ACCEPT =
  ".png,.jpg,.jpeg,.gif,.webp,.txt,.md,.json,.pdf,.html,.csv,image/png,image/jpeg,image/gif,image/webp,text/plain,text/markdown,application/json,application/pdf,text/html,text/csv";

const PREVIEW_HIDE_MS = 120;
const EMPTY_FILES: File[] = [];

export function mergeComposerFiles(current: File[], incoming: File[]): File[] {
  return [...current, ...incoming].slice(0, COMPOSER_FILE_CAP);
}

export function ComposerAddButton(props: {
  title: string;
  onPick: (files: File[]) => void;
  onError: (message: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept={COMPOSER_FILE_ACCEPT}
        onChange={(event) => {
          const picked = [...(event.target.files ?? [])];
          event.target.value = "";
          if (!picked.length) return;
          const oversize = firstOversizeAttachment(picked);
          if (oversize) {
            props.onError(oversize);
            return;
          }
          props.onError(null);
          props.onPick(picked);
        }}
      />
      <Tooltip label={props.title}>
        <button
          type="button"
          className="btn small ghost composer-add"
          onClick={() => input.current?.click()}
        >
          <IconPlus />
        </button>
      </Tooltip>
    </>
  );
}

function ClipboardDocIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function canPreviewPaste(file: File): boolean {
  return isImageFile(file) || isPastedTextFile(file);
}

type PastePreviewTarget = { file: File; rect: DOMRect };

function pasteChipHit(
  mirror: HTMLElement,
  files: File[],
  x: number,
  y: number,
): PastePreviewTarget | null {
  const chips = mirror.querySelectorAll(".composer-paste-chip");
  const seen = new Map<string, number>();
  for (const chip of chips) {
    const name = chip.getAttribute("data-paste-name") ?? "";
    const occurrence = seen.get(name) ?? 0;
    seen.set(name, occurrence + 1);
    const rects = chip.getClientRects();
    const list = rects.length ? rects : [chip.getBoundingClientRect()];
    if (!pointInRects(list, x, y)) continue;
    const file = fileForPasteChip(files, name, occurrence);
    if (!file || !canPreviewPaste(file)) return null;
    return { file, rect: chip.getBoundingClientRect() };
  }
  return null;
}

function PastePreviewPop(props: {
  file: File;
  trigger: DOMRect;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const pop = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const [url, setUrl] = useState<string | undefined>();
  const [text, setText] = useState<string | undefined>();
  const image = isImageFile(props.file);
  const pasted = isPastedTextFile(props.file);

  useEffect(() => {
    if (!image || typeof URL.createObjectURL !== "function") return;
    const next = URL.createObjectURL(props.file);
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
    };
  }, [image, props.file]);

  useEffect(() => {
    if (!pasted) return;
    let cancelled = false;
    void props.file.text().then((value) => {
      if (!cancelled) setText(pastePreviewText(value));
    });
    return () => {
      cancelled = true;
    };
  }, [pasted, props.file]);

  useLayoutEffect(() => {
    const el = pop.current;
    if (!el) return;
    const next = placeMenuPop({
      trigger: {
        top: props.trigger.top,
        left: props.trigger.left,
        right: props.trigger.right,
        bottom: props.trigger.bottom,
      },
      pop: { width: el.offsetWidth, height: el.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      align: "left",
      prefer: "up",
      gap: 8,
    });
    setPlace({ top: next.top, left: next.left });
  }, [props.file, props.trigger, text, url]);

  const style: CSSProperties = {
    top: place?.top ?? 0,
    left: place?.left ?? 0,
    visibility: place ? "visible" : "hidden",
  };

  return createPortal(
    <div
      ref={pop}
      className={`composer-paste-preview${image ? " is-image" : " is-text"}`}
      data-testid="composer-paste-preview"
      role="tooltip"
      style={style}
      onMouseEnter={props.onEnter}
      onMouseLeave={props.onLeave}
    >
      <div className="composer-paste-preview-name">{props.file.name}</div>
      {image && url ? <img src={url} alt={props.file.name} /> : null}
      {pasted ? <pre>{text ?? "…"}</pre> : null}
    </div>,
    document.body,
  );
}

function usePastePreview() {
  const [target, setTarget] = useState<PastePreviewTarget | null>(null);
  const hideTimer = useRef<number | null>(null);

  const clearHide = useCallback(() => {
    if (hideTimer.current == null) return;
    window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }, []);

  const show = useCallback(
    (next: PastePreviewTarget) => {
      clearHide();
      setTarget((prev) => (prev?.file === next.file ? prev : next));
    },
    [clearHide],
  );

  const hideSoon = useCallback(() => {
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      setTarget(null);
    }, PREVIEW_HIDE_MS);
  }, []);

  const hideNow = useCallback(() => {
    clearHide();
    setTarget(null);
  }, [clearHide]);

  useEffect(() => () => clearHide(), [clearHide]);

  return { target, show, hideSoon, hideNow, keep: clearHide };
}

function ComposerFileThumb(props: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | undefined>();
  const [clipLabel, setClipLabel] = useState("@Clipboard");
  const preview = usePastePreview();
  const image = isImageFile(props.file);
  const pasted = isPastedTextFile(props.file);
  const previewable = canPreviewPaste(props.file);
  useEffect(() => {
    if (!image || typeof URL.createObjectURL !== "function") return;
    const next = URL.createObjectURL(props.file);
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
    };
  }, [image, props.file]);
  useEffect(() => {
    if (!pasted) return;
    let cancelled = false;
    void props.file.text().then((text) => {
      if (!cancelled) setClipLabel(clipboardChipLabel(text));
    });
    return () => {
      cancelled = true;
    };
  }, [pasted, props.file]);
  const label = pasted ? clipLabel : props.file.name;
  return (
    <>
      <button
        type="button"
        className={`composer-thumb${image ? "" : pasted ? " is-clipboard" : " is-file"}`}
        title={previewable ? undefined : `Remove ${label}`}
        aria-label={`Remove ${label}`}
        onClick={props.onRemove}
        onMouseEnter={(event) => {
          if (!previewable) return;
          preview.show({ file: props.file, rect: event.currentTarget.getBoundingClientRect() });
        }}
        onMouseLeave={() => {
          if (previewable) preview.hideSoon();
        }}
      >
        {image && url ? (
          <>
            <img src={url} alt={props.file.name} />
            <span className="composer-thumb-name">{props.file.name}</span>
          </>
        ) : pasted ? (
          <>
            <span className="composer-thumb-icon">
              <ClipboardDocIcon />
            </span>
            <span className="composer-thumb-label">{clipLabel}</span>
          </>
        ) : (
          <span>{props.file.name}</span>
        )}
        <span className="composer-thumb-x" aria-hidden>
          <IconClose />
        </span>
      </button>
      {preview.target ? (
        <PastePreviewPop
          file={preview.target.file}
          trigger={preview.target.rect}
          onEnter={preview.keep}
          onLeave={preview.hideSoon}
        />
      ) : null}
    </>
  );
}

export function ComposerFileThumbs(props: { files: File[]; onRemove: (index: number) => void }) {
  if (!props.files.length) return null;
  return (
    <div className="composer-thumbs composer-attach">
      {props.files.map((file, index) => (
        <ComposerFileThumb
          key={`${file.name}-${file.lastModified}-${index}`}
          file={file}
          onRemove={() => props.onRemove(index)}
        />
      ))}
    </div>
  );
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") ref(value);
  else (ref as { current: T | null }).current = value;
}

function applyPasteChipSelection(el: HTMLTextAreaElement, text: string) {
  const next = snapPasteChipSelection(text, el.selectionStart, el.selectionEnd);
  if (next.start === el.selectionStart && next.end === el.selectionEnd) return;
  el.selectionStart = next.start;
  el.selectionEnd = next.end;
}

export function ComposerTextarea(props: {
  textareaRef?: Ref<HTMLTextAreaElement>;
  value: string;
  files?: File[];
  placeholder?: string;
  onChange: (value: string) => void;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
}) {
  const mirror = useRef<HTMLDivElement>(null);
  const preview = usePastePreview();
  const { hideNow } = preview;
  const chipped = pasteChipNames(props.value).length > 0;
  const files = props.files ?? EMPTY_FILES;
  const previewFile = preview.target?.file;

  useEffect(() => {
    if (previewFile && !files.includes(previewFile)) hideNow();
  }, [files, previewFile, hideNow]);

  function syncScroll(event: { currentTarget: HTMLTextAreaElement }) {
    if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop;
    hideNow();
  }

  function snapCaret(event: { currentTarget: HTMLTextAreaElement }) {
    if (!chipped) return;
    applyPasteChipSelection(event.currentTarget, props.value);
  }

  function hoverChips(event: { clientX: number; clientY: number }) {
    if (!chipped || !files.length || !mirror.current) {
      if (preview.target) preview.hideSoon();
      return;
    }
    const hit = pasteChipHit(mirror.current, files, event.clientX, event.clientY);
    if (hit) preview.show(hit);
    else preview.hideSoon();
  }

  return (
    <div className={`composer-field${chipped ? " has-chips" : ""}`}>
      {chipped ? (
        <div
          className="composer-mirror"
          ref={mirror}
          aria-hidden
          dangerouslySetInnerHTML={{ __html: highlightPasteChips(props.value) }}
        />
      ) : null}
      <textarea
        ref={(node) => assignRef(props.textareaRef, node)}
        className={chipped ? "is-chipped" : undefined}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
        onSelect={snapCaret}
        onClick={snapCaret}
        onKeyUp={snapCaret}
        onMouseMove={hoverChips}
        onMouseLeave={() => {
          if (preview.target) preview.hideSoon();
        }}
        onKeyDown={(event) => {
          if (
            chipped &&
            (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
            !event.altKey &&
            !event.metaKey &&
            !event.ctrlKey
          ) {
            const dir = event.key === "ArrowLeft" ? "backward" : "forward";
            const el = event.currentTarget;
            if (el.selectionStart === el.selectionEnd && !event.shiftKey) {
              const jumped = movePasteChipCaret(props.value, el.selectionStart, dir);
              if (jumped != null) {
                event.preventDefault();
                el.selectionStart = el.selectionEnd = jumped;
                return;
              }
            }
          }
          props.onKeyDown?.(event);
        }}
        onScroll={syncScroll}
      />
      {preview.target ? (
        <PastePreviewPop
          file={preview.target.file}
          trigger={preview.target.rect}
          onEnter={preview.keep}
          onLeave={preview.hideSoon}
        />
      ) : null}
    </div>
  );
}
