import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  diffStats,
  fileDiffStats,
  hunkHeader,
  parseDiffLayout,
  parseFilePatch,
  patchFilesFromTool,
  patchPathLabel,
  patchTextFromTool,
  type DiffLayout,
  type PatchFile,
  type PatchHunk,
  type PullFile,
} from "@locus/shared";
import { IconChevron, IconCopy } from "@/components/layout/Icons";
import { api } from "@/lib/api";
import { languageFromPath } from "@/lib/highlight";
import {
  fileRowCount,
  limitPatchHunks,
  lineRefFromTarget,
  PATCH_VISIBLE_ROW_BUDGET,
  renderPatchHunkHtml,
  symbolFromTarget,
  type DiffLineRef,
} from "@/lib/patchDiffHtml";
import { PatchStackCard } from "./PatchStackCard";

export type { DiffLineRef };

function pullKind(status: PullFile["status"]): PatchFile["kind"] {
  if (status === "added") return "add";
  if (status === "removed") return "delete";
  return "update";
}

export function patchFilesFromPull(files: PullFile[]): PatchFile[] {
  return files.map((file) => parseFilePatch(file.path, file.patch, pullKind(file.status)));
}

async function copyPath(path: string) {
  try {
    await navigator.clipboard.writeText(path);
  } catch {
    /* clipboard may be unavailable in tests */
  }
}

function fileKey(file: PatchFile): string {
  return `${file.kind}:${file.path}`;
}

function folderAppName(): string {
  if (typeof navigator === "undefined") return "file manager";
  const platform = navigator.platform || "";
  const ua = navigator.userAgent || "";
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return "File Explorer";
  if (/Mac/i.test(platform) || /Mac OS/i.test(ua)) return "Finder";
  return "file manager";
}

function PatchPath({
  path,
  line,
  onOpenPath,
  onRevealFolder,
}: {
  path: string;
  line?: number;
  onOpenPath?: (path: string, line?: number) => void;
  onRevealFolder?: (path: string) => void;
}) {
  const label = patchPathLabel(path);
  const clickable = Boolean(onRevealFolder || onOpenPath);
  const title = onRevealFolder
    ? `Show ${label.name || path} in ${folderAppName()}`
    : onOpenPath
      ? `Open ${path} in Files`
      : path;
  const inner = (
    <>
      <span className="patch-path-name">{label.name || path}</span>
      {label.dir ? <span className="patch-path-dir">{label.dir}</span> : null}
    </>
  );
  if (!clickable) {
    return (
      <span className="patch-path patch-path-label" title={path}>
        {inner}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="patch-path patch-path-open patch-path-label"
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        if (onRevealFolder) onRevealFolder(path);
        else onOpenPath?.(path, line);
      }}
    >
      {inner}
    </button>
  );
}

function collapsedReviewFiles(files: PatchFile[], focusPath?: string | null): Set<string> {
  const keep =
    (focusPath && files.some((file) => file.path === focusPath) ? focusPath : files[0]?.path) ?? "";
  return new Set(files.filter((file) => file.path !== keep).map(fileKey));
}

function collapsedChatFiles(files: PatchFile[]): Set<string> {
  return new Set(files.map(fileKey));
}

function Stats({ additions, deletions }: { additions: number; deletions: number }) {
  if (!additions && !deletions) return null;
  return (
    <span className="patch-stats">
      {additions ? <span className="add">+{additions}</span> : null}
      {deletions ? <span className="del">−{deletions}</span> : null}
    </span>
  );
}

const PatchHunkBody = memo(function PatchHunkBody({
  hunk,
  path,
  lang,
  clickable,
  layout,
  selected,
  onLineSelect,
  onOpenSymbol,
}: {
  hunk: PatchHunk;
  path: string;
  lang: string;
  clickable: boolean;
  layout: DiffLayout;
  selected?: DiffLineRef | null;
  onLineSelect?: (ref: DiffLineRef) => void;
  onOpenSymbol?: (path: string, line: number) => void;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const html = useMemo(
    () => renderPatchHunkHtml(hunk, lang, clickable, layout),
    [hunk, lang, clickable, layout],
  );

  useLayoutEffect(() => {
    const root = preRef.current;
    if (!root) return;
    root.querySelector(".patch-line.selected")?.classList.remove("selected");
    if (!selected || selected.path !== path) return;
    const next = root.querySelector(`[data-line="${selected.line}"][data-side="${selected.side}"]`);
    next?.classList.add("selected");
  }, [html, path, selected]);

  return (
    <pre
      ref={preRef}
      className={`patch-hunk${layout === "split" ? " split" : ""}`}
      onClick={
        clickable || onOpenSymbol
          ? (event) => {
              const ref = lineRefFromTarget(path, event.target);
              if (onOpenSymbol && symbolFromTarget(event.target) && ref) {
                event.preventDefault();
                onOpenSymbol(path, ref.line);
                return;
              }
              if (clickable && ref) onLineSelect?.(ref);
            }
          : undefined
      }
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

const PatchFileBlock = memo(function PatchFileBlock({
  file,
  hidden,
  selected,
  layout,
  viewed,
  onToggle,
  onLineSelect,
  onOpenPath,
  onOpenSymbol,
  onRevealFolder,
  onToggleViewed,
}: {
  file: PatchFile;
  hidden: boolean;
  selected?: DiffLineRef | null;
  layout: DiffLayout;
  viewed?: boolean;
  onToggle: () => void;
  onLineSelect?: (ref: DiffLineRef) => void;
  onOpenPath?: (path: string, line?: number) => void;
  onOpenSymbol?: (path: string, line: number) => void;
  onRevealFolder?: (path: string) => void;
  onToggleViewed?: (path: string, viewed: boolean) => void;
}) {
  const [full, setFull] = useState(false);
  const stats = useMemo(() => fileDiffStats(file), [file]);
  const lang = languageFromPath(file.path);
  const totalRows = fileRowCount(file);
  const limited = useMemo(
    () => limitPatchHunks(file.hunks, full ? Number.POSITIVE_INFINITY : PATCH_VISIBLE_ROW_BUDGET),
    [file.hunks, full],
  );
  const clickable = Boolean(onLineSelect);

  useEffect(() => {
    setFull(false);
  }, [file]);

  return (
    <div className={`patch-file ${hidden ? "collapsed" : ""}`} data-patch-path={file.path}>
      <div className="patch-file-head">
        <button
          type="button"
          className="patch-file-toggle"
          aria-expanded={!hidden}
          onClick={onToggle}
        >
          <IconChevron expanded={!hidden} />
          <span className={`patch-kind ${file.kind}`}>{file.kind}</span>
          <PatchPath
            path={file.path}
            line={file.hunks[0]?.newStart}
            onOpenPath={onOpenPath}
            onRevealFolder={onRevealFolder}
          />
          <Stats additions={stats.additions} deletions={stats.deletions} />
        </button>
        <button
          type="button"
          className="btn icon ghost small"
          title="Copy path"
          aria-label={`Copy ${file.path}`}
          onClick={() => void copyPath(file.path)}
        >
          <IconCopy />
        </button>
        {onToggleViewed ? (
          <label className="patch-viewed" title="Mark viewed on GitHub">
            <input
              type="checkbox"
              checked={viewed === true}
              onChange={(event) => onToggleViewed(file.path, event.target.checked)}
            />
            Viewed
          </label>
        ) : null}
      </div>
      {hidden ? null : file.hunks.length === 0 && file.kind === "delete" ? (
        <div className="patch-empty">File deleted</div>
      ) : file.hunks.length === 0 ? (
        <div className="patch-empty">No textual diff</div>
      ) : (
        <>
          {limited.hunks.map((hunk, index) => (
            <div
              className="patch-hunk-wrap"
              key={`${file.path}:${hunk.oldStart}:${index}`}
              data-hunk-start={hunk.newStart}
              data-hunk-old-start={hunk.oldStart}
              data-hunk-path={file.path}
            >
              <div className="patch-hunk-head">{hunkHeader(hunk)}</div>
              <PatchHunkBody
                hunk={hunk}
                path={file.path}
                lang={lang}
                clickable={clickable}
                layout={layout}
                selected={selected}
                onLineSelect={onLineSelect}
                onOpenSymbol={onOpenSymbol}
              />
            </div>
          ))}
          {limited.hidden > 0 ? (
            <button type="button" className="patch-more" onClick={() => setFull(true)}>
              Show {limited.hidden} more {limited.hidden === 1 ? "line" : "lines"}
              {totalRows ? ` (${totalRows} total)` : ""}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
});

export const PatchCard = memo(function PatchCard({
  files,
  density = "chat",
  focusPath,
  selected,
  layout = "unified",
  viewedPaths,
  onLineSelect,
  onOpenPath,
  onOpenSymbol,
  onRevealFolder,
  onToggleViewed,
  onLayoutChange,
}: {
  files: PatchFile[];
  density?: "chat" | "review";
  focusPath?: string | null;
  selected?: DiffLineRef | null;
  layout?: DiffLayout;
  viewedPaths?: ReadonlySet<string>;
  onLineSelect?: (ref: DiffLineRef) => void;
  onOpenPath?: (path: string, line?: number) => void;
  onOpenSymbol?: (path: string, line: number) => void;
  onRevealFolder?: (path: string) => void;
  onToggleViewed?: (path: string, viewed: boolean) => void;
  onLayoutChange?: (layout: DiffLayout) => void;
}) {
  const [collapsed, setCollapsed] = useState(() =>
    density === "review" ? collapsedReviewFiles(files, focusPath) : collapsedChatFiles(files),
  );
  const totals = useMemo(() => diffStats(files), [files]);
  const resolvedLayout = parseDiffLayout(layout);

  useEffect(() => {
    if (density !== "review") return;
    setCollapsed(collapsedReviewFiles(files, focusPath));
  }, [density, files, focusPath]);

  if (!files.length) return null;

  function toggle(file: PatchFile) {
    const key = fileKey(file);
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className={`patch-card ${density}`} data-testid="patch-card" data-layout={resolvedLayout}>
      {files.length > 1 || onLayoutChange ? (
        <div className="patch-card-summary">
          {files.length > 1 ? (
            <>
              <span>{files.length} files</span>
              <Stats additions={totals.additions} deletions={totals.deletions} />
            </>
          ) : (
            <span />
          )}
          {onLayoutChange ? (
            <div className="patch-layout" role="group" aria-label="Diff layout">
              <button
                type="button"
                className={resolvedLayout === "unified" ? "on" : undefined}
                aria-pressed={resolvedLayout === "unified"}
                onClick={() => onLayoutChange("unified")}
              >
                Unified
              </button>
              <button
                type="button"
                className={resolvedLayout === "split" ? "on" : undefined}
                aria-pressed={resolvedLayout === "split"}
                data-testid="patch-layout-split"
                onClick={() => onLayoutChange("split")}
              >
                Split
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {files.map((file) => {
        const key = fileKey(file);
        return (
          <PatchFileBlock
            key={key}
            file={file}
            hidden={collapsed.has(key)}
            selected={selected?.path === file.path ? selected : null}
            layout={resolvedLayout}
            viewed={viewedPaths?.has(file.path)}
            onToggle={() => toggle(file)}
            onLineSelect={onLineSelect}
            onOpenPath={onOpenPath}
            onOpenSymbol={onOpenSymbol}
            onRevealFolder={onRevealFolder}
            onToggleViewed={onToggleViewed}
          />
        );
      })}
    </div>
  );
});

export function ToolPatch(props: {
  name: string;
  args?: Record<string, unknown>;
  result?: string;
  sessionId?: string;
  callId?: string;
  onOpenPath?: (path: string, line?: number) => void;
}) {
  const files = useMemo(
    () => patchFilesFromTool(props.name, props.args, props.result),
    [props.name, props.args, props.result],
  );
  if (!files.length) return null;
  const patchText = patchTextFromTool(props.name, props.args, props.result);
  const onRevealFolder = props.sessionId
    ? (path: string) => {
        void api.revealWorkspace(props.sessionId!, path).catch(() => undefined);
      }
    : undefined;
  if (files.length >= 2 && props.sessionId) {
    return (
      <PatchStackCard
        files={files}
        patchText={patchText}
        meta={{
          repoId: props.sessionId,
          number: 0,
          headSha: props.callId ?? "tool",
        }}
        onOpenPath={props.onOpenPath}
        onRevealFolder={onRevealFolder}
      />
    );
  }
  return <PatchCard files={files} onOpenPath={props.onOpenPath} onRevealFolder={onRevealFolder} />;
}
