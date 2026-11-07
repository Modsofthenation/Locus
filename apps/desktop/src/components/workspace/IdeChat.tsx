import { useStore } from "@/state/store";
import { useDeferredCollapse } from "@/lib/useDeferredCollapse";
import { ChatPane } from "@/components/chat/ChatPane";
import { IconChat, IconPanelRight } from "@/components/layout/Icons";

export function IdeChat() {
  const { dispatch, state } = useStore();
  const showRail = useDeferredCollapse(state.vmCollapsed);
  if (showRail) {
    return (
      <aside className="vm-pane rail ide-chat-rail">
        <button
          type="button"
          className="vm-rail-toggle"
          title="Chat"
          onClick={() => dispatch({ type: "toggleVmPane" })}
        >
          <IconChat />
          <span className="vm-rail-label">Chat</span>
        </button>
      </aside>
    );
  }
  return (
    <div className="ide-chat">
      <div className="ide-chat-bar">
        <span>Chat</span>
        <button
          type="button"
          className="btn icon ghost"
          title="Collapse chat"
          onClick={() => dispatch({ type: "toggleVmPane" })}
        >
          <IconPanelRight />
        </button>
      </div>
      <ChatPane />
    </div>
  );
}
