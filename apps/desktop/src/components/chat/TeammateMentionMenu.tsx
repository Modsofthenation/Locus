import type { TeammateMentionItem } from "@/lib/teammateMention";

export function TeammateMentionMenu(props: {
  items: TeammateMentionItem[];
  activeIndex: number;
  onPick: (token: string) => void;
}) {
  if (!props.items.length) return null;
  return (
    <div
      className="slash-menu teammate-mention-menu"
      role="listbox"
      aria-label="Teammate mentions"
      data-testid="teammate-mention-menu"
    >
      {props.items.slice(0, 12).map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={index === props.activeIndex}
          className={index === props.activeIndex ? "active" : ""}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.onPick(item.token)}
        >
          <span className="slash-name">{item.label}</span>
          <span className="slash-hint">{item.hint}</span>
        </button>
      ))}
    </div>
  );
}
