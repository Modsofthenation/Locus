import { withRiskConfirm } from "@/lib/riskGate";
import type { AgentSession, WorkerBoardRow } from "@locus/shared";
import { compareGroup } from "@locus/shared";
import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/layout/Modal";
import { api } from "@/lib/api";
import { askConfirm } from "@/lib/dialog";
import { sessionNeedsYou } from "@/lib/mobileShell";
import { discardOthersTitle, otherAttempts } from "@/lib/workerCompare";
import { useStore } from "@/state/store";
import { DiffBlock } from "./WorkerDiff";
import { WorkersCompare } from "./WorkersCompare";

const REFRESH_MS = 4000;

export const OPEN_PR_PROMPT =
  "Commit any remaining changes on your branch, push the branch, and open a pull request against the base branch. Reply with the PR link.";

export type WorkersBoardView = "board" | "compare";

function statusLabel(row: WorkerBoardRow, session?: AgentSession): string {
  if (session && sessionNeedsYou(session)) return "Needs you";
  if (row.status === "running") return "Running";
  if (row.status === "error") return "Error";
  return row.status === "idle" ? "Done" : row.status;
}

/**
 * Side-by-side review of parallel agents: status, branch, diffstat, and
 * Open / Diff / Merge / Open PR / Discard per agent. Compare lines the
 * attempts up as columns and turns the group into one pick.
 */
export function WorkersBoard({
  session,
  onClose,
  initialView = "board",
}: {
  session: AgentSession;
  onClose: () => void;
  initialView?: WorkersBoardView;
}) {
  const { state, dispatch } = useStore();
  const parentId =
    session.compare?.role === "parent" ? session.id : (session.compare?.parentId ?? session.id);
  const [view, setView] = useState<WorkersBoardView>(initialView);
  const [rows, setRows] = useState<WorkerBoardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await api.workerBoard(parentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load agents");
    }
  }, [parentId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const sessionsById = new Map(state.sessions.map((row) => [row.id, row]));
  const members = compareGroup(sessionsById.get(parentId) ?? session, state.sessions);
  const providerName = (id: string) => state.config?.providers.find((p) => p.id === id)?.name ?? id;

  /** Run one action with busy/error bookkeeping. False when it threw. */
  async function act(id: string, label: string, work: () => Promise<void>): Promise<boolean> {
    setBusy(`${id}:${label}`);
    setError(null);
    try {
      await work();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} failed`);
      return false;
    } finally {
      await refresh();
      setBusy(null);
    }
  }

  function merge(row: WorkerBoardRow): Promise<boolean> {
    return act(row.id, "Merge", async () => {
      const parent = await withRiskConfirm((approveRisk) =>
        api.mergeWorker(parentId, row.id, { approveRisk }),
      );
      dispatch({ type: "session", session: parent });
    });
  }

  function discardNow(row: WorkerBoardRow): Promise<boolean> {
    return act(row.id, "Discard", async () => {
      await api.discardWorker(row.id);
      dispatch({ type: "deleted", id: row.id });
    });
  }

  async function discard(row: WorkerBoardRow) {
    const ok = await askConfirm({
      title: `Discard agent ${row.role}?`,
      body: row.worktreePath
        ? `Stops the agent and deletes its worktree and branch ${row.branch ?? ""}. Uncommitted and unmerged work is lost.`
        : "Stops the agent and deletes its chat and container.",
      confirmLabel: "Discard",
      danger: true,
    });
    if (ok) await discardNow(row);
  }

  /** Merge one attempt, then offer to discard the rest in one confirm. */
  async function pick(row: WorkerBoardRow, all: WorkerBoardRow[]) {
    if (!(await merge(row))) return;
    const others = otherAttempts(all, row.id);
    if (!others.length) return;
    const ok = await askConfirm({
      title: discardOthersTitle(others.length),
      body: `Merged ${row.role}. Discarding stops ${others.map((o) => o.role).join(", ")} and deletes their worktrees and branches. Unmerged work is lost.`,
      confirmLabel: "Discard",
      danger: true,
    });
    if (!ok) return;
    for (const other of others) await discardNow(other);
  }

  async function toggleDiff(id: string) {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    try {
      const all = await api.workerDiffs(parentId);
      setDiffs(Object.fromEntries(all.map((row) => [row.id, row.diff])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load diffs");
    }
  }

  const list = rows ?? [];
  const best = list.reduce<WorkerBoardRow | undefined>(
    (acc, row) =>
      row.status !== "error" &&
      row.stat.files > 0 &&
      (!acc || row.stat.insertions + row.stat.deletions < acc.stat.insertions + acc.stat.deletions)
        ? row
        : acc,
    undefined,
  );

  return (
    <Modal titleId="workers-board-title" className="workers-board-modal" onClose={onClose}>
      <div className="workers-compare-head">
        <h2 id="workers-board-title">Parallel agents</h2>
        <div className="workers-compare-views" role="group" aria-label="View">
          {(["board", "compare"] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={`btn small${view === key ? " primary" : " ghost"}`}
              aria-pressed={view === key}
              onClick={() => setView(key)}
            >
              {key === "board" ? "Board" : "Compare"}
            </button>
          ))}
        </div>
      </div>
      <p className="modal-lead">
        {view === "compare"
          ? "Pick one attempt to merge into the base checkout, then discard the rest."
          : `Each agent works on its own branch${list.some((row) => row.worktreePath) ? " in a separate git worktree" : ""}. Merge the one you want into the base checkout, open a PR from it, or discard the rest.`}
      </p>
      {error ? <p className="scrim-note is-danger">{error}</p> : null}
      {rows === null ? <p className="hint">Loading…</p> : null}
      {view === "compare" ? (
        <WorkersCompare
          parentId={parentId}
          rows={list}
          providerName={providerName}
          statusOf={(row) => statusLabel(row, sessionsById.get(row.id))}
          busy={busy}
          openDiff={open}
          diffs={diffs}
          onToggleDiff={(id) => void toggleDiff(id)}
          onPick={(row) => void pick(row, list)}
        />
      ) : (
        <div className="workers-board-grid" role="list">
          {list.map((row) => {
            const live = sessionsById.get(row.id);
            const status = statusLabel(row, live);
            const running = row.status === "running";
            const isBusy = (label: string) => busy === `${row.id}:${label}`;
            return (
              <section
                key={row.id}
                role="listitem"
                className={`workers-board-card${row.id === best?.id ? " is-smallest" : ""}`}
                aria-label={`Agent ${row.role}`}
              >
                <header>
                  <span className="workers-board-role">{row.role}</span>
                  <span className="workers-board-agent">
                    {providerName(row.providerId)}
                    <span className="hint"> · {row.model}</span>
                  </span>
                  <span
                    className={`workers-board-status is-${status.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    {status}
                  </span>
                </header>
                {row.branch ? (
                  <code className="workers-board-branch" title={row.worktreePath}>
                    {row.branch}
                  </code>
                ) : null}
                <p className="workers-board-stat">
                  <span>{row.stat.files} files</span>
                  <span className="is-add">+{row.stat.insertions}</span>
                  <span className="is-del">−{row.stat.deletions}</span>
                  {row.commits ? <span>{row.commits} commits</span> : null}
                  {row.dirty ? <span>{row.dirty} uncommitted</span> : null}
                </p>
                {row.error ? <p className="hint is-danger">{row.error}</p> : null}
                <div className="workers-board-actions">
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => {
                      dispatch({ type: "select", id: row.id });
                      onClose();
                    }}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className="btn small ghost"
                    aria-expanded={open === row.id}
                    onClick={() => void toggleDiff(row.id)}
                  >
                    {open === row.id ? "Hide diff" : "Diff"}
                  </button>
                  <button
                    type="button"
                    className="btn small primary"
                    disabled={running || Boolean(busy)}
                    title={running ? "Wait for the agent to finish or stop it" : undefined}
                    onClick={() => void merge(row)}
                  >
                    {isBusy("Merge") ? "Merging…" : "Merge"}
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    disabled={running || Boolean(busy)}
                    onClick={() =>
                      void act(row.id, "Open PR", async () => {
                        await api.chat(row.id, OPEN_PR_PROMPT);
                      })
                    }
                  >
                    {isBusy("Open PR") ? "Asking…" : "Open PR"}
                  </button>
                  <button
                    type="button"
                    className="btn small ghost danger"
                    disabled={Boolean(busy)}
                    onClick={() => void discard(row)}
                  >
                    Discard
                  </button>
                </div>
                {open === row.id ? <DiffBlock diff={diffs[row.id] ?? ""} /> : null}
              </section>
            );
          })}
        </div>
      )}
      {members.length === 0 && rows?.length === 0 ? (
        <p className="hint">No parallel agents in this group any more.</p>
      ) : null}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
