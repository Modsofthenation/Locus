import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseProductMode, sessionMatchesSurface } from "@locus/shared";
import { api } from "@/lib/api";
import {
  approvalPreview,
  sameToolRows,
  stepInboxFocus,
  type ApprovalPreview,
} from "@/lib/inboxDecision";
import { buildInboxRows, inboxKindLabel, openInboxRow, type InboxRow } from "@/lib/inboxList";
import { showErrorNotice } from "@/lib/notice";
import { useStore } from "@/state/store";
import { EmptyHero } from "./EmptyHero";

type Decision = "approved" | "denied";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

const RISK_LABEL = { low: "Low risk", medium: "Check first", high: "High risk" } as const;

function ApprovalDetail({ preview }: { preview: ApprovalPreview }) {
  return (
    <div className="inbox-decision-body">
      <p className="inbox-decision-what">
        <span className={`inbox-risk ${preview.risk}`} title={preview.riskReason}>
          {RISK_LABEL[preview.risk]}
        </span>
        <span>{preview.label}</span>
      </p>
      {preview.why ? (
        <blockquote className="inbox-decision-why" data-testid="inbox-why">
          {preview.why}
        </blockquote>
      ) : null}
      {preview.command ? (
        <pre className="inbox-decision-command" data-testid="inbox-command">
          <code>{preview.command}</code>
        </pre>
      ) : null}
      {preview.files.length ? (
        <ul className="inbox-decision-files">
          {preview.files.slice(0, 6).map((file) => (
            <li key={file}>{file}</li>
          ))}
          {preview.files.length > 6 ? <li>+{preview.files.length - 6} more</li> : null}
        </ul>
      ) : null}
      <dl className="inbox-decision-facts">
        <dt>Tool</dt>
        <dd>
          <code>{preview.call.name}</code>
        </dd>
        <dt>Runs in</dt>
        <dd>{preview.where}</dd>
        {preview.path && !preview.files.length ? (
          <>
            <dt>Path</dt>
            <dd>
              <code>{preview.path}</code>
            </dd>
          </>
        ) : null}
        {preview.branch ? (
          <>
            <dt>Branch</dt>
            <dd>
              <code>{preview.branch}</code>
            </dd>
          </>
        ) : null}
        <dt>Why ask</dt>
        <dd>{preview.riskReason}</dd>
      </dl>
      {preview.argsText && !preview.command ? (
        <details className="inbox-decision-args">
          <summary>Arguments</summary>
          <pre>{preview.argsText}</pre>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Main pane while the rail Inbox is open: a decision card for the focused item.
 * Approvals show the command, files, and the agent's reason, and can be decided
 * here. J/K (or ↑/↓) move, A approves, D denies, Enter opens the chat.
 */
export function InboxPane() {
  const { state, dispatch } = useStore();
  const mode = parseProductMode(state.config?.productMode);
  const sessions = useMemo(
    () => state.sessions.filter((s) => sessionMatchesSurface(s, mode)),
    [state.sessions, mode],
  );
  const rows = useMemo(
    () =>
      buildInboxRows({
        sessions,
        boards: state.boards,
        brain: state.brain,
        automations: state.automations,
        runs: state.runs,
      }),
    [sessions, state.boards, state.brain, state.automations, state.runs],
  );
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const index = Math.max(
    0,
    rows.findIndex((row) => row.key === focusKey),
  );
  const current: InboxRow | undefined = rows[index];
  const session = sessions.find((row) => row.id === current?.sessionId);
  const preview = current?.callId ? approvalPreview(session, current.callId) : undefined;
  const sameTool = useMemo(
    () => (current && preview?.batchable ? sameToolRows(rows, sessions, current) : []),
    [current, preview?.batchable, rows, sessions],
  );

  // Keep focus on the same position when the decided row drops out of the list.
  useEffect(() => {
    if (!rows.length) {
      if (focusKey !== null) setFocusKey(null);
      return;
    }
    if (!focusKey || !rows.some((row) => row.key === focusKey)) {
      setFocusKey(rows[Math.min(index, rows.length - 1)]!.key);
    }
  }, [rows, focusKey, index]);

  const decide = useCallback(
    async (targets: InboxRow[], decision: Decision, always = false) => {
      if (busyRef.current || !targets.length) return;
      busyRef.current = true;
      setBusy(true);
      try {
        for (const row of targets) {
          if (!row.sessionId || !row.callId) continue;
          const updated = await api.resolveApproval(
            row.sessionId,
            row.callId,
            decision,
            undefined,
            always || undefined,
          );
          dispatch({ type: "session", session: updated });
        }
      } catch (err) {
        showErrorNotice(err, decision === "approved" ? "Could not approve" : "Could not deny");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [dispatch],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector("[role='dialog']")) return;
      const key = event.key;
      if (key === "j" || key === "ArrowDown") {
        event.preventDefault();
        setFocusKey((k) => stepInboxFocus(rows, k, 1));
      } else if (key === "k" || key === "ArrowUp") {
        event.preventDefault();
        setFocusKey((k) => stepInboxFocus(rows, k, -1));
      } else if (key === "Enter" && current) {
        event.preventDefault();
        openInboxRow(current, dispatch);
      } else if ((key === "a" || key === "d") && current && preview?.batchable) {
        event.preventDefault();
        void decide([current], key === "a" ? "approved" : "denied");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, current, preview?.batchable, decide, dispatch]);

  return (
    <div className="empty inbox-pane" data-testid="inbox-pane">
      <div className="empty-card inbox-decision-card">
        {current ? (
          <>
            <EmptyHero
              title={rows.length === 1 ? "1 item needs you" : `${rows.length} items need you`}
              lead={
                preview?.batchable
                  ? "Decide here, or open the chat for the full context."
                  : "Open it to answer or fix it."
              }
            />
            {rows.length > 1 ? (
              <div className="inbox-stepper" data-testid="inbox-stepper">
                <button
                  type="button"
                  className="btn small ghost"
                  disabled={index === 0}
                  aria-label="Previous item"
                  onClick={() => setFocusKey(stepInboxFocus(rows, current.key, -1))}
                >
                  ↑ Prev
                </button>
                <span>
                  {index + 1} of {rows.length}
                </span>
                <button
                  type="button"
                  className="btn small ghost"
                  disabled={index >= rows.length - 1}
                  aria-label="Next item"
                  onClick={() => setFocusKey(stepInboxFocus(rows, current.key, 1))}
                >
                  Next ↓
                </button>
              </div>
            ) : null}
            <div className="inbox-next" data-testid="inbox-next" aria-busy={busy}>
              <p className="inbox-next-kind">{inboxKindLabel(current.kind, mode)}</p>
              <p className="inbox-next-title">{current.title}</p>
              {preview ? (
                <ApprovalDetail preview={preview} />
              ) : (
                <p className="inbox-next-detail">{current.detail}</p>
              )}
              <div className="inbox-decision-actions">
                {preview?.batchable ? (
                  <>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busy}
                      data-testid="inbox-approve"
                      onClick={() => void decide([current], "approved")}
                    >
                      Approve <kbd>A</kbd>
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      data-testid="inbox-deny"
                      onClick={() => void decide([current], "denied")}
                    >
                      Deny <kbd>D</kbd>
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busy}
                      title="Approve, and stop asking for this tool in this chat"
                      onClick={() => void decide([current], "approved", true)}
                    >
                      Always allow
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className={`btn ${preview?.batchable ? "ghost" : "primary"}`}
                  onClick={() => openInboxRow(current, dispatch)}
                >
                  {preview?.batchable ? "Open chat" : "Open"}
                </button>
              </div>
              {sameTool.length > 1 ? (
                <button
                  type="button"
                  className="btn small ghost inbox-approve-all"
                  disabled={busy}
                  data-testid="inbox-approve-all"
                  onClick={() => void decide(sameTool, "approved")}
                >
                  Approve all {sameTool.length} waiting <code>{preview?.call.name}</code> calls
                </button>
              ) : null}
            </div>
            <p className="inbox-keys" aria-hidden="true">
              <kbd>J</kbd>/<kbd>K</kbd> move · <kbd>A</kbd> approve · <kbd>D</kbd> deny ·{" "}
              <kbd>Enter</kbd> open
            </p>
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
