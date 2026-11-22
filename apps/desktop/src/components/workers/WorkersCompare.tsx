import type { WorkerBoardRow, WorkerRanking, WorkerVerification } from "@locus/shared";
import { useState } from "react";
import { api } from "@/lib/api";
import { compareCostLabel, compareTestsLabel, orderByRank, rankById } from "@/lib/workerCompare";
import { DiffBlock } from "./WorkerDiff";
import { verdictLabel, verdictTone } from "@/lib/riskGate";

const FILES_SHOWN = 12;

/**
 * One column per parallel attempt: agent, status, diffstat, last test run, cost and
 * changed files. Pick this one merges it and offers to discard the rest.
 */
export function WorkersCompare(props: {
  parentId: string;
  rows: WorkerBoardRow[];
  providerName: (id: string) => string;
  statusOf: (row: WorkerBoardRow) => string;
  busy: string | null;
  openDiff: string | null;
  diffs: Record<string, string>;
  onToggleDiff: (id: string) => void;
  onPick: (row: WorkerBoardRow) => void;
}) {
  const [ranking, setRanking] = useState<WorkerRanking | null>(null);
  const [rankBusy, setRankingBusy] = useState(false);
  const [rankError, setRankError] = useState<string | null>(null);
  const [verification, setVerification] = useState<WorkerVerification[]>([]);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const ranks = rankById(ranking);
  const rows = orderByRank(props.rows, ranking);
  const anyRunning = props.rows.some((row) => row.status === "running");

  async function verify() {
    setVerifying(true);
    setVerifyError("");
    setVerification([]);
    try {
      setVerification(await api.verifyWorkers(props.parentId));
    } catch (error) {
      setVerifyError(error instanceof Error ? error.message : String(error));
    } finally {
      setVerifying(false);
    }
  }

  async function rank() {
    setRankingBusy(true);
    setRankError(null);
    try {
      setRanking(await api.rankWorkers(props.parentId));
    } catch (err) {
      setRankError(err instanceof Error ? err.message : "Rank failed");
    } finally {
      setRankingBusy(false);
    }
  }

  return (
    <div className="workers-compare">
      <div className="workers-compare-bar">
        <button
          type="button"
          className="btn small"
          disabled={rankBusy || props.rows.length < 2}
          title={anyRunning ? "Some agents are still running" : undefined}
          onClick={() => void rank()}
        >
          {rankBusy ? "Ranking…" : ranking ? "Rank again" : "Rank"}
        </button>
        {props.rows.some((row) => row.worktreePath) ? (
          <button
            type="button"
            className="btn small"
            disabled={verifying || anyRunning || Boolean(props.busy)}
            onClick={() => void verify()}
          >
            {verifying ? "Verifying attempts…" : "Verify all attempts"}
          </button>
        ) : null}
        {verifyError ? (
          <span role="alert" className="hint is-danger">
            {verifyError}
          </span>
        ) : null}
        {ranking ? (
          <span className="hint">
            {ranking.source === "model"
              ? "Ranked by evidence (tests, lint/typecheck, scope); a model broke ties and wrote the reasons."
              : "Suggested from evidence: tests pass, green lint/typecheck, in scope, then smaller diff and lower cost."}
          </span>
        ) : null}
        {rankError ? <span className="hint is-danger">{rankError}</span> : null}
      </div>
      <div className="workers-compare-cols" role="list">
        {rows.map((row) => {
          const status = props.statusOf(row);
          const tests = compareTestsLabel(row);
          const entry = ranks.get(row.id);
          const verified = verification.find((result) => result.id === row.id);
          const files = row.files ?? [];
          const running = row.status === "running";
          return (
            <section
              key={row.id}
              role="listitem"
              className={`workers-board-card workers-compare-col${entry?.rank === 1 ? " is-smallest" : ""}`}
              aria-label={`Attempt ${row.role}`}
            >
              <header>
                <span className="workers-board-role">{row.role}</span>
                <span className="workers-board-agent">
                  {props.providerName(row.providerId)}
                  <span className="hint"> · {row.model}</span>
                </span>
                {entry ? (
                  <span
                    className="pill workers-compare-rank"
                    title={ranking?.source === "heuristic" ? "Suggested" : undefined}
                  >
                    #{entry.rank}
                  </span>
                ) : null}
              </header>
              {entry?.reason ? <p className="workers-compare-reason">{entry.reason}</p> : null}
              {entry?.evidence?.length && ranking?.source === "model" ? (
                <ul className="workers-compare-evidence" aria-label="Evidence">
                  {entry.evidence.map((item) => (
                    <li key={item} className="hint">
                      {item}
                    </li>
                  ))}
                </ul>
              ) : null}
              <dl className="workers-compare-facts">
                <dt>Status</dt>
                <dd
                  className={`workers-board-status is-${status.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  {status}
                </dd>
                <dt>Diff</dt>
                <dd className="workers-board-stat">
                  <span>{row.stat.files} files</span>
                  <span className="is-add">+{row.stat.insertions}</span>
                  <span className="is-del">−{row.stat.deletions}</span>
                </dd>
                <dt>Tests</dt>
                <dd className={`workers-compare-tests is-${tests.tone}`} title={row.testCommand}>
                  {tests.text}
                </dd>
                <dt>Cost</dt>
                <dd>{compareCostLabel(row)}</dd>
                {row.verdict ? (
                  <>
                    <dt>Review</dt>
                    <dd
                      className={`workers-compare-tests is-${verdictTone(row.verdict) === "ok" ? "ok" : "danger"}`}
                      title={row.verdict.reasons.join("\n") || undefined}
                    >
                      {verdictLabel(row.verdict)}
                    </dd>
                  </>
                ) : null}
              </dl>
              {verified?.reason ? <p className="hint">{verified.reason}</p> : null}
              {verified?.checks.map((check) => (
                <details key={check.step}>
                  <summary>
                    {check.step} · {check.status}
                  </summary>
                  {check.command ? <code>{check.command}</code> : null}
                  {check.failedTests?.length ? (
                    <ul>
                      {check.failedTests.map((test) => (
                        <li key={test}>{test}</li>
                      ))}
                    </ul>
                  ) : null}
                  {check.output ? <pre className="artifact-diff">{check.output}</pre> : null}
                </details>
              ))}
              {row.error ? <p className="hint is-danger">{row.error}</p> : null}
              {files.length ? (
                <ul className="workers-compare-files" aria-label="Changed files">
                  {files.slice(0, FILES_SHOWN).map((path) => (
                    <li key={path}>
                      <code title={path}>{path}</code>
                    </li>
                  ))}
                  {files.length > FILES_SHOWN ? (
                    <li className="hint">+{files.length - FILES_SHOWN} more</li>
                  ) : null}
                </ul>
              ) : (
                <p className="hint">No changed files.</p>
              )}
              <div className="workers-board-actions">
                <button
                  type="button"
                  className="btn small primary"
                  disabled={running || verifying || Boolean(props.busy) || row.stat.files === 0}
                  title={running ? "Wait for the agent to finish or stop it" : undefined}
                  onClick={() => props.onPick(row)}
                >
                  {props.busy === `${row.id}:Merge` ? "Merging…" : "Pick this one"}
                </button>
                <button
                  type="button"
                  className="btn small ghost"
                  aria-expanded={props.openDiff === row.id}
                  onClick={() => props.onToggleDiff(row.id)}
                >
                  {props.openDiff === row.id ? "Hide diff" : "Diff"}
                </button>
              </div>
              {props.openDiff === row.id ? <DiffBlock diff={props.diffs[row.id] ?? ""} /> : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
