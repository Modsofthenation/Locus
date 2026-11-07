import type { AssetMentionItem, HostSessionMentionItem } from "@locus/shared";
import { AssetThumb } from "@/components/assets/AssetThumb";

export function AssetMentionMenu(props: {
  items: Array<AssetMentionItem | HostSessionMentionItem>;
  activeIndex: number;
  onPick: (item: AssetMentionItem | HostSessionMentionItem) => void;
}) {
  if (!props.items.length) return null;
  return (
    <div
      className="slash-menu asset-mention-menu"
      role="listbox"
      aria-label="Session mentions"
      data-testid="asset-mention-menu"
    >
      {props.items.slice(0, 12).map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={index === props.activeIndex}
          className={index === props.activeIndex ? "active" : ""}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.onPick(item)}
        >
          <AssetThumb src={item.previewUrl} />
          <span className="slash-name">{item.label}</span>
          <span className="slash-hint">{item.hint}</span>
        </button>
      ))}
    </div>
  );
}
