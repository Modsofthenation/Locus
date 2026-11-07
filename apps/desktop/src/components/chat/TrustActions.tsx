import {
  canReplay,
  comparePeer,
  isCanvasSession,
  isHiddenChatMessage,
  type AgentSession,
} from "@locus/shared";
import { useStore } from "@/state/store";

function completedUserTurns(session: AgentSession): number {
  return session.messages.filter((m) => m.role === "user" && !isHiddenChatMessage(m)).length;
}

export function canTrustCompare(session: AgentSession, sessions: AgentSession[]): boolean {
  if (isCanvasSession(session)) return false;
  if (session.status === "running" || session.status === "provisioning") return false;
  if (comparePeer(session, sessions)) return false;
  return completedUserTurns(session) >= 2;
}

export function canTrustReplay(session: AgentSession): boolean {
  if (isCanvasSession(session)) return false;
  if (session.status === "running" || session.status === "provisioning") return false;
  return canReplay(session.messages);
}

export function TrustActions(props: { session: AgentSession; compact?: boolean; label?: string }) {
  const { state, dispatch } = useStore();
  const compare = canTrustCompare(props.session, state.sessions);
  const replay = canTrustReplay(props.session);
  if (!compare && !replay) return null;

  function open(kind: "compare" | "replay") {
    dispatch({ type: "section", section: "agents" });
    dispatch({ type: "select", id: props.session.id });
    dispatch({ type: kind, open: true });
  }

  return (
    <div
      className={`turn-trust${props.compact ? " compact" : ""}`}
      role="group"
      aria-label={props.label ?? "I don't trust this"}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {compare ? (
        <button type="button" className="btn small ghost" onClick={() => open("compare")}>
          Compare models
        </button>
      ) : null}
      {replay ? (
        <button type="button" className="btn small ghost" onClick={() => open("replay")}>
          Replay
        </button>
      ) : null}
    </div>
  );
}
