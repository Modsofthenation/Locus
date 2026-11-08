import type { RefObject } from "react";
import { IconClose } from "@/components/layout/Icons";
import { Tooltip } from "@/components/layout/Tooltip";
import { languageFromPath } from "@/lib/highlight";
import { matchModKey } from "@/lib/shortcuts";

export type EditorTabDoc = {
  path: string;
  content: string;
  original: string;
  kind?: "text" | "image" | "pdf";
  cold?: boolean;
};

export function WorkspaceEditorTabs(props: {
  paths: string[];
  selected: string;
  docs: EditorTabDoc[];
  group?: 0 | 1;
  listRef?: RefObject<HTMLDivElement | null>;
  stubDoc: (path: string) => EditorTabDoc;
  onOpen: (path: string, cold: boolean) => void;
  onClose: (path: string) => void;
}) {
  const items = props.paths
    .map((path) => props.docs.find((doc) => doc.path === path) ?? props.stubDoc(path))
    .filter((doc) => props.paths.includes(doc.path));
  return (
    <div
      className="workspace-tabs"
      ref={props.listRef}
      role="tablist"
      aria-label={props.group == null ? "Open files" : `Editor group ${props.group + 1}`}
    >
      {items.map((doc) => {
        const name = doc.path.split("/").pop() ?? doc.path;
        const tabDirty = doc.kind !== "image" && doc.kind !== "pdf" && doc.content !== doc.original;
        const glyph =
          languageFromPath(doc.path) === "json"
            ? "{}"
            : languageFromPath(doc.path) === "tsx" || languageFromPath(doc.path) === "jsx"
              ? "<>"
              : "";
        const on = doc.path === props.selected;
        return (
          <div
            key={doc.path}
            role="tab"
            tabIndex={0}
            title={doc.path}
            data-tab={doc.path}
            aria-selected={on}
            className={`workspace-tab ${on ? "on" : ""}`}
            onClick={() => props.onOpen(doc.path, Boolean(doc.cold))}
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              event.preventDefault();
              props.onClose(doc.path);
            }}
            onKeyDown={(event) => {
              if (matchModKey(event, "w")) {
                event.preventDefault();
                props.onClose(doc.path);
                return;
              }
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                props.onOpen(doc.path, Boolean(doc.cold));
              }
            }}
          >
            {tabDirty ? <span className="workspace-tab-dot" title="Unsaved" /> : null}
            {glyph ? <span className="workspace-tab-kind">{glyph}</span> : null}
            {name}
            <Tooltip label="Close">
              <button
                type="button"
                className="workspace-tab-close"
                aria-label={`Close ${name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onClose(doc.path);
                }}
              >
                <IconClose />
              </button>
            </Tooltip>
          </div>
        );
      })}
    </div>
  );
}
