import type { WorkspaceIndexHit } from "@/lib/api";

export function FileMentionMenu(props: {
  items: WorkspaceIndexHit[];
  activeIndex: number;
  onPick: (path: string) => void;
}) {
  if (!props.items.length) return null;
  return (
    <div
      className="slash-menu"
      role="listbox"
      aria-label="File mentions"
      data-testid="file-mention-menu"
    >
      {props.items.slice(0, 12).map((item, index) => (
        <button
          key={`${item.kind}:${item.path}:${item.symbol ?? ""}`}
          type="button"
          role="option"
          aria-selected={index === props.activeIndex}
          className={index === props.activeIndex ? "active" : ""}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.onPick(item.path)}
        >
          <span className="slash-name">@{item.path}</span>
          <span className="slash-hint">
            {item.kind === "symbol" ? (item.symbol ?? "symbol") : "file"}
          </span>
        </button>
      ))}
    </div>
  );
}
