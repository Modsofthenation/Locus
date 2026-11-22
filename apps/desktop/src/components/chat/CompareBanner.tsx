import { withRiskConfirm } from "@/lib/riskGate";
import { compareGroup, comparePeer, isWorkerCompare, type AgentSession } from "@locus/shared";
import { useStore } from "@/state/store";
import { pickCompareWinner } from "@/lib/compare";
import { sessionNeedsYou } from "@/lib/mobileShell";
import { api } from "@/lib/api";
import { askAlert } from "@/lib/dialog";
import { showUndoNotice } from "@/lib/notice";
import { useState } from "react";
import { WorkersBoard, type WorkersBoardView } from "@/components/workers/WorkersBoard";

export function CompareBanner({ session }: { session: AgentSession }) {
  const { state, dispatch } = useStore();
  const members = compareGroup(session, state.sessions);
  const peer = comparePeer(session, state.sessions);
  const [boardView, setBoardView] = useState<WorkersBoardView | null>(null);
  const board = boardView ? (
    <WorkersBoard session={session} initialView={boardView} onClose={() => setBoardView(null)} />
  ) : null;
  const boardButton = (
    <>
      <button type="button" className="btn small" onClick={() => setBoardView("board")}>
        Board
      </button>
      <button type="button" className="btn small" onClick={() => setBoardView("compare")}>
        Compare
      </button>
    </>
  );

  async function keep(winner: AgentSession, losers: AgentSession[]) {
    try {
      const kept = await pickCompareWinner(winner, ...losers);
      const archived = losers.filter((row) => row.id !== winner.id);
      for (const loser of archived) {
        dispatch({ type: "session", session: { ...loser, archived: true, compare: undefined } });
      }
      dispatch({ type: "session", session: kept });
      dispatch({ type: "select", id: kept.id });
      if (archived.length) {
        showUndoNotice(
          archived.length === 1
            ? `Archived ${archived[0]!.title}`
            : `Archived ${archived.length} chats`,
          () => {
            void (async () => {
              for (const loser of archived) {
                try {
                  const restored = await api.patchSession(loser.id, {
                    archived: false,
                    compare: loser.compare ?? null,
                  });
                  dispatch({ type: "session", session: restored });
                } catch {
                  dispatch({ type: "session", session: { ...loser, archived: false } });
                }
              }
            })();
          },
        );
      }
    } catch {
      /* stay in compare */
    }
  }

  if (isWorkerCompare(session.compare) && members.length >= 2) {
    if (session.compare?.role === "parent") {
      return (
        <div className="compare-banner" role="group" aria-label="Parallel workers">
          <span className="compare-label">Workers</span>
          {members.map((member) => (
            <button
              key={member.id}
              type="button"
              className={`btn small ${member.id === session.id ? "primary" : ""}`}
              aria-pressed={member.id === session.id}
              onClick={() => dispatch({ type: "select", id: member.id })}
            >
              {member.compare?.role ?? "?"}
              <span className="compare-worker-status">
                {sessionNeedsYou(member)
                  ? "needs you"
                  : member.status === "running"
                    ? "running"
                    : member.status}
              </span>
            </button>
          ))}
          <span className="compare-spacer" />
          {boardButton}
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              void api.workerDiffs(session.id).then((rows) => {
                const text = rows
                  .map((row) => `## ${row.role} ${row.branch ?? ""}\n${row.diff || "(empty)"}`)
                  .join("\n\n");
                void askAlert({
                  title: "Worker diffs",
                  body: text.slice(0, 4000) || "No diffs yet",
                });
              });
            }}
          >
            Diffs
          </button>
          {board}
        </div>
      );
    }
    return (
      <div className="compare-banner" role="group" aria-label="Parallel workers">
        <span className="compare-label">Workers</span>
        {members.map((member) => (
          <button
            key={member.id}
            type="button"
            className={`btn small ${member.id === session.id ? "primary" : ""}`}
            aria-pressed={member.id === session.id}
            onClick={() => dispatch({ type: "select", id: member.id })}
          >
            {member.compare?.role ?? "?"}
          </button>
        ))}
        <span className="compare-spacer" />
        {session.compare?.parentId ? boardButton : null}
        <button
          type="button"
          className="btn small"
          onClick={() =>
            void keep(
              session,
              members.filter((row) => row.id !== session.id),
            )
          }
        >
          Keep {session.compare?.role ?? "this"}
        </button>
        {session.compare?.parentId ? (
          <button
            type="button"
            className="btn small ghost"
            onClick={() => dispatch({ type: "select", id: session.compare!.parentId! })}
          >
            Parent
          </button>
        ) : null}
        {session.compare?.parentId ? (
          <button
            type="button"
            className="btn small"
            onClick={() => {
              void withRiskConfirm((approveRisk) =>
                api.mergeWorker(session.compare!.parentId!, session.id, { approveRisk }),
              )
                .then((parent) => {
                  dispatch({ type: "session", session: parent });
                  dispatch({ type: "select", id: parent.id });
                })
                .catch((err: unknown) =>
                  askAlert({
                    title: "Merge",
                    body: err instanceof Error ? err.message : "Merge failed",
                  }),
                );
            }}
          >
            Merge into parent
          </button>
        ) : null}
        <button
          type="button"
          className="btn small ghost"
          onClick={() => {
            void api.workerDiffs(session.id).then((rows) => {
              const text = rows
                .map((row) => `## ${row.role} ${row.branch ?? ""}\n${row.diff || "(empty)"}`)
                .join("\n\n");
              void askAlert({
                title: "Worker diffs",
                body: text.slice(0, 4000) || "No diffs yet",
              });
            });
          }}
        >
          Diffs
        </button>
        {board}
      </div>
    );
  }

  if (!peer) return null;

  const selfRole = session.compare?.role ?? "A";
  const peerRole = peer.compare?.role ?? "B";

  return (
    <div className="compare-banner" role="group" aria-label="A/B compare">
      <span className="compare-label">A/B</span>
      <button
        type="button"
        className={`btn small ${selfRole === "A" ? "primary" : ""}`}
        aria-pressed={selfRole === "A"}
        onClick={() => dispatch({ type: "select", id: selfRole === "A" ? session.id : peer.id })}
      >
        A · {selfRole === "A" ? session.model : peer.model}
      </button>
      <button
        type="button"
        className={`btn small ${selfRole === "B" ? "primary" : ""}`}
        aria-pressed={selfRole === "B"}
        onClick={() => dispatch({ type: "select", id: selfRole === "B" ? session.id : peer.id })}
      >
        B · {selfRole === "B" ? session.model : peer.model}
      </button>
      <span className="compare-spacer" />
      <button type="button" className="btn small" onClick={() => void keep(session, [peer])}>
        Keep {selfRole}
      </button>
      <button type="button" className="btn small" onClick={() => void keep(peer, [session])}>
        Keep {peerRole}
      </button>
      <button
        type="button"
        className="btn small ghost"
        onClick={() => {
          void api.workerDiffs(session.id).then((rows) => {
            const text = rows
              .map((row) => `## ${row.role} ${row.branch ?? row.id}\n${row.diff || "(empty)"}`)
              .join("\n\n");
            void askAlert({
              title: "Worker diffs",
              body: text.slice(0, 4000) || "No diffs yet",
            });
          });
        }}
      >
        Diffs
      </button>
    </div>
  );
}
