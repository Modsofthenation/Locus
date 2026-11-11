import { parseProductMode, sessionMatchesSurface } from "@locus/shared";
import { buildInboxRows, inboxKindLabel, openInboxRow } from "@/lib/inboxList";
import { useStore } from "@/state/store";
import { EmptyHero } from "./EmptyHero";

/** Main pane while the rail Inbox is open: the next item to handle, or all caught up. */
export function InboxPane() {
  const { state, dispatch } = useStore();
  const mode = parseProductMode(state.config?.productMode);
  const rows = buildInboxRows({
    sessions: state.sessions.filter((s) => sessionMatchesSurface(s, mode)),
    boards: state.boards,
    brain: state.brain,
    automations: state.automations,
    runs: state.runs,
  });
  const next = rows[0];

  return (
    <div className="empty inbox-pane" data-testid="inbox-pane">
      <div className="empty-card">
        {next ? (
          <>
            <EmptyHero
              title={rows.length === 1 ? "1 item needs you" : `${rows.length} items need you`}
              lead="Open one to approve, answer, or fix it. Pick any row in the list."
            />
            <div className="inbox-next" data-testid="inbox-next">
              <p className="inbox-next-kind">{inboxKindLabel(next.kind, mode)}</p>
              <p className="inbox-next-title">{next.title}</p>
              <p className="inbox-next-detail">{next.detail}</p>
              <button
                type="button"
                className="btn primary"
                onClick={() => openInboxRow(next, dispatch)}
              >
                Open
              </button>
            </div>
          </>
        ) : (
          <EmptyHero
            pose="rest"
            title="All caught up"
            lead={`Approvals, questions, and failing ${mode === "swarm" ? "routines" : "jobs"} show up here.`}
          />
        )}
      </div>
    </div>
  );
}
