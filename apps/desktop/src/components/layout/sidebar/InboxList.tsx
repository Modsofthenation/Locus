import { useState } from "react";
import type { AgentSession, ProductMode } from "@locus/shared";
import { api } from "@/lib/api";
import { inboxKindLabel, type InboxRow } from "@/lib/inboxList";
import { isBatchableApproval } from "@/lib/needsYou";
import { showErrorNotice } from "@/lib/notice";
import { EmptyListNote } from "../EmptyHero";
import { useStore } from "@/state/store";

function pendingCall(session: AgentSession | undefined, callId?: string) {
  if (!session || !callId) return undefined;
  for (const message of session.messages) {
    for (const call of message.toolCalls ?? []) {
      if (call.id === callId && call.approval === "needed" && !call.finishedAt) return call;
    }
  }
  return undefined;
}

export function InboxList(props: {
  rows: InboxRow[];
  sessions: AgentSession[];
  query: string;
  mode: ProductMode;
  onOpen: (row: InboxRow) => void;
}) {
  const { dispatch } = useStore();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function decide(row: InboxRow, decision: "approved" | "denied") {
    if (!row.sessionId || !row.callId || busyKey) return;
    setBusyKey(row.key);
    try {
      const session = await api.resolveApproval(row.sessionId, row.callId, decision);
      dispatch({ type: "session", session });
    } catch (err) {
      showErrorNotice(err, decision === "approved" ? "Could not approve" : "Could not deny");
    } finally {
      setBusyKey(null);
    }
  }

  if (!props.rows.length) {
    // The subtitle already says "Caught up" and the main pane shows it; only a miss needs words.
    return props.query ? <EmptyListNote>No matching inbox items</EmptyListNote> : null;
  }

  return (
    <div className="session-group">
      {props.rows.map((row) => {
        const session = props.sessions.find((item) => item.id === row.sessionId);
        const call = pendingCall(session, row.callId);
        const canDecide = Boolean(call && isBatchableApproval(call.name));
        const kind = inboxKindLabel(row.kind, props.mode);
        return (
          <div key={row.key} className="session-item needs-you has-menu inbox-row">
            <button
              type="button"
              className="session-item-open"
              title={`${kind} · ${row.title} · ${row.detail}`}
              onClick={() => props.onOpen(row)}
            >
              <span className="dot needs-you" aria-hidden="true" />
              <span>
                <div className="title">
                  <span className="title-text">{row.title}</span>
                  <span className="inbox-kind">{kind}</span>
                </div>
                <div className="meta">{row.detail}</div>
              </span>
            </button>
            {canDecide ? (
              <span className="inbox-row-actions">
                <button
                  type="button"
                  className="btn small primary"
                  disabled={busyKey === row.key}
                  onClick={() => void decide(row, "approved")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn small"
                  disabled={busyKey === row.key}
                  onClick={() => void decide(row, "denied")}
                >
                  Deny
                </button>
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
