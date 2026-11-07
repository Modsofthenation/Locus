import { useMemo } from "react";
import { highlightSource, languageFromPath } from "@/lib/highlight";
import { api } from "@/lib/api";
import { isWorkspaceImagePath, isWorkspacePdfPath } from "@locus/shared";

export function WorkspaceCompanion({
  sessionId,
  path,
  content,
  kind,
  onFocus,
}: {
  sessionId: string;
  path: string;
  content: string;
  kind?: "text" | "image" | "pdf";
  onFocus: () => void;
}) {
  const lang = languageFromPath(path);
  const html = useMemo(() => highlightSource(content, lang), [content, lang]);
  const isImage = kind === "image" || isWorkspaceImagePath(path);
  const isPdf = kind === "pdf" || isWorkspacePdfPath(path);
  const name = path.split("/").pop() ?? path;

  return (
    <div
      className="workspace-companion"
      data-testid="editor-companion"
      role="button"
      tabIndex={0}
      aria-label={`View ${name} beside`}
      onClick={onFocus}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onFocus();
        }
      }}
    >
      {isImage && path ? (
        <div className="workspace-image">
          <img alt={name} src={api.workspaceRawUrl(sessionId, path)} />
        </div>
      ) : isPdf && path ? (
        <iframe className="workspace-pdf" title={name} src={api.workspaceRawUrl(sessionId, path)} />
      ) : (
        <pre
          className="workspace-highlight"
          aria-hidden
          dangerouslySetInnerHTML={{ __html: html || " " }}
        />
      )}
    </div>
  );
}
