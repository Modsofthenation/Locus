import {
  automationHealth,
  automationLatestAgentRun,
  type AgentSession,
  type Automation,
  type AutomationRun,
  type BoardSummary,
  type BrainSummary,
  type ProductMode,
} from "@locus/shared";
import type { Dispatch } from "react";
import type { Action } from "@/state/store";
import { rememberBrainInbox } from "./brainViewPrefs";
import { needsYouItems } from "./needsYou";

export type InboxKind = "session" | "board" | "brain" | "automation";

export type InboxRow = {
  key: string;
  kind: InboxKind;
  title: string;
  detail: string;
  sessionId?: string;
  callId?: string;
  boardId?: string;
  objectId?: string;
  automationId?: string;
};

export function inboxKindLabel(kind: InboxKind, mode: ProductMode = "developer"): string {
  if (kind === "session") return mode === "swarm" ? "Teammate" : "Agent";
  if (kind === "board") return "Board";
  if (kind === "brain") return "Brain";
  return mode === "swarm" ? "Routine" : "Job";
}

/** Agents, boards, Brain, and failing / Needs-you automations waiting on the operator. */
export function buildInboxRows(opts: {
  sessions: AgentSession[];
  boards?: BoardSummary[];
  brain?: Pick<BrainSummary, "inboxCount"> | null;
  automations?: Automation[];
  runs?: AutomationRun[];
}): InboxRow[] {
  const rows: InboxRow[] = needsYouItems(opts.sessions, opts.boards, opts.brain).map((row) => {
    if (row.section === "brain") {
      return { key: row.key, kind: "brain", title: row.title, detail: row.detail };
    }
    if (row.boardId) {
      return {
        key: row.key,
        kind: "board",
        title: row.title,
        detail: row.detail,
        boardId: row.boardId,
        objectId: row.objectId,
      };
    }
    return {
      key: row.key,
      kind: "session",
      title: row.title,
      detail: row.detail,
      sessionId: row.sessionId,
      callId: row.key.startsWith("a:") ? row.key.slice(2) : undefined,
    };
  });
  const seen = new Set(rows.map((row) => row.automationId).filter(Boolean));
  const runs = opts.runs ?? [];
  for (const item of opts.automations ?? []) {
    const health = automationHealth(item, automationLatestAgentRun(runs, item.id));
    if (health !== "failing" && health !== "needs_you") continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    rows.push({
      key: `auto:${item.id}`,
      kind: "automation",
      title: item.name,
      detail: health === "needs_you" ? "Needs you" : "Failing",
      automationId: item.id,
    });
  }
  return rows;
}

export function inboxRowMatchesQuery(
  row: Pick<InboxRow, "title" | "detail">,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return row.title.toLowerCase().includes(q) || row.detail.toLowerCase().includes(q);
}

/** Jump from an Inbox row to the chat, board object, Brain review, or job it is about. */
export function openInboxRow(row: InboxRow, dispatch: Dispatch<Action>): void {
  if (row.sessionId) {
    dispatch({ type: "select", id: row.sessionId });
  } else if (row.boardId) {
    dispatch({ type: "selectBoard", id: row.boardId, objectId: row.objectId });
  } else if (row.kind === "brain") {
    rememberBrainInbox();
    dispatch({ type: "section", section: "brain" });
  } else if (row.automationId) {
    dispatch({ type: "selectAutomation", id: row.automationId });
  }
  dispatch({ type: "inbox", open: false });
}
