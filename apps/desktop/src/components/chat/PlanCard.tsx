import { useState } from "react";
import {
  acceptPlan,
  firstRunnableIndex,
  formatPlanRunPrompt,
  formatPlanStepPrompt,
  planPhase,
  startPlanRun,
  startPlanStepOnly,
  type AgentSession,
  type PlanItem,
  type SessionPlan,
} from "@locus/shared";
import { api } from "@/lib/api";
import { useStore } from "@/state/store";

function stepStatus(item: PlanItem): PlanItem["status"] {
  return item.status ?? "pending";
}

export function PlanCard({ session }: { session: AgentSession }) {
  const { state, dispatch } = useStore();
  const plan = session.plan;
  const turning = session.status === "running";
  const proposed = planPhase(plan) === "proposed";
  const [pinFrames, setPinFrames] = useState<{
    boardId: string;
    frames: { id: string; text?: string }[];
  } | null>(null);
  if (!plan || (!plan.items.length && !plan.files?.length && !plan.risks?.length)) return null;

  async function save(next: SessionPlan | null) {
    const updated = await api.patchSession(session.id, { plan: next });
    dispatch({ type: "session", session: updated });
  }

  async function accept() {
    const accepted = acceptPlan(plan!);
    await save(accepted);
  }

  async function pinToBoard() {
    const boardId = state.selectedBoardId ?? state.boards.find((row) => !row.archived)?.id;
    if (!boardId) {
      window.alert("Open or create a Board first, then pin the plan onto a frame.");
      return;
    }
    try {
      let board = state.boardDocuments[boardId] ?? (await api.board(boardId));
      const frames = board.objects.filter((row) => row.type === "frame");
      if (frames.length > 1) {
        setPinFrames({
          boardId,
          frames: frames.map((row) => ({ id: row.id, text: row.text })),
        });
        return;
      }
      let frameId: string | undefined = frames[0]?.id;
      if (!frameId) {
        board = await api.upsertBoardObjects(boardId, [
          {
            id: crypto.randomUUID(),
            type: "frame",
            x: 20,
            y: 20,
            w: 480,
            h: 360,
            text: "Plan",
          },
        ]);
        frameId = board.objects.find((row) => row.type === "frame")?.id;
      }
      if (!frameId) {
        window.alert("Could not find a frame on the board");
        return;
      }
      await commitPin(boardId, frameId);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not pin plan");
    }
  }

  async function commitPin(boardId: string, frameId: string) {
    try {
      const next = await api.pinBoardPlan(boardId, frameId, session.id);
      dispatch({ type: "board", board: next });
      dispatch({ type: "selectBoard", id: boardId });
      setPinFrames(null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not pin plan");
    }
  }

  async function runStep(index: number) {
    const prepared = acceptPlan(startPlanStepOnly(plan!, index));
    const updated = await api.patchSession(session.id, { plan: prepared });
    dispatch({ type: "session", session: updated });
    await api.chat(session.id, formatPlanStepPrompt(prepared, index));
  }

  async function runFrom(fromIndex = 0) {
    const prepared: SessionPlan = {
      ...plan!,
      items: plan!.items.map((item, index) =>
        index === fromIndex && item.status === "skipped" ? { ...item, status: "pending" } : item,
      ),
    };
    if (firstRunnableIndex(prepared, fromIndex) < 0) return;
    const accepted = acceptPlan(prepared);
    const next = startPlanRun(accepted, fromIndex);
    const updated = await api.patchSession(session.id, { plan: next });
    dispatch({ type: "session", session: updated });
    await api.chat(session.id, formatPlanRunPrompt(next, fromIndex));
  }

  function toggleSkip(item: PlanItem) {
    const skipped = item.status === "skipped";
    const next: SessionPlan = {
      ...plan!,
      items: plan!.items.map((row) =>
        row.id === item.id ? { ...row, status: skipped ? "pending" : "skipped" } : row,
      ),
    };
    dispatch({ type: "session", session: { ...session, plan: next } });
    void save(next);
  }

  return (
    <div className="plan-card" data-testid="plan-card">
      <div className="plan-card-head">
        <strong>{proposed ? "Proposed plan" : "Plan"}</strong>
        <span className="row">
          {proposed ? (
            <button
              type="button"
              className="btn small ghost"
              disabled={turning}
              onClick={() => void accept()}
            >
              Accept
            </button>
          ) : null}
          <button
            type="button"
            className="btn small primary"
            disabled={turning}
            onClick={() => void runFrom(0)}
          >
            Run
          </button>
          <button
            type="button"
            className="btn small ghost"
            disabled={turning}
            title="Pin checklist stickies onto a Board frame"
            onClick={() => void pinToBoard()}
          >
            Pin to Board
          </button>
          <button type="button" className="btn small ghost" onClick={() => void save(null)}>
            Dismiss
          </button>
        </span>
      </div>
      {pinFrames ? (
        <div className="plan-pin-frames" data-testid="plan-pin-frames">
          <p className="hint">Pin onto which frame?</p>
          <span className="row">
            {pinFrames.frames.map((frame) => (
              <button
                key={frame.id}
                type="button"
                className="btn small"
                onClick={() => void commitPin(pinFrames.boardId, frame.id)}
              >
                {frame.text || "Frame"}
              </button>
            ))}
            <button type="button" className="btn small ghost" onClick={() => setPinFrames(null)}>
              Cancel
            </button>
          </span>
        </div>
      ) : null}
      <ol>
        {plan.items.map((item, index) => (
          <li key={item.id} data-status={stepStatus(item)}>
            <input
              type="checkbox"
              checked={item.status !== "skipped"}
              disabled={turning}
              aria-label={`Include step ${index + 1}`}
              onChange={() => toggleSkip(item)}
            />
            <input
              type="text"
              value={item.text}
              aria-label={`Step ${index + 1}`}
              onChange={(event) => {
                const items = plan.items.map((row) =>
                  row.id === item.id ? { ...row, text: event.target.value } : row,
                );
                dispatch({
                  type: "session",
                  session: { ...session, plan: { ...plan, items } },
                });
              }}
              onBlur={() => void save(plan)}
            />
            <span className="plan-step-status">{stepStatus(item)}</span>
            <button
              type="button"
              className="btn small ghost"
              disabled={turning}
              data-testid={`plan-step-${index + 1}`}
              onClick={() => void runStep(index)}
            >
              This step
            </button>
            <button
              type="button"
              className="btn small ghost"
              disabled={turning}
              data-testid={`plan-from-${index + 1}`}
              onClick={() => void runFrom(index)}
            >
              From here
            </button>
          </li>
        ))}
      </ol>
      {plan.files?.length ? (
        <div className="plan-meta" data-testid="plan-files">
          <h3>Files</h3>
          <ul>
            {plan.files.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {plan.risks?.length ? (
        <div className="plan-meta" data-testid="plan-risks">
          <h3>Risks</h3>
          <ul>
            {plan.risks.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
