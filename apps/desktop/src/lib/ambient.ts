import type { AgentSession, BoardSummary, BrainSummary } from "@locus/shared";
import type { Dispatch } from "react";
import type { Action } from "@/state/store";
import {
  activeAgents,
  desktopBridge,
  type AmbientAction,
  type LocusDesktopBridge,
} from "./closeGuard";
import { approvalPreview } from "./inboxDecision";
import { needsYouCount } from "./needsYou";
import { notifyTurnDone } from "./notify";

export type AmbientCounts = { running: number; needsYou: number };

/** Counts for the tray menu and the dock / taskbar badge. */
export function ambientCounts(
  sessions: AgentSession[],
  boards?: BoardSummary[],
  brain?: Pick<BrainSummary, "inboxCount"> | null,
): AmbientCounts {
  const live = sessions.filter((row) => !row.archived);
  return {
    running: activeAgents(live).length,
    needsYou: needsYouCount(live, boards, brain),
  };
}

export type NeedsYouNotice = {
  title: string;
  body: string;
  sessionId: string;
  callId?: string;
  approvable: boolean;
};

/**
 * What a "needs you" notification should say for the gates that just appeared:
 * the tool and its command for an approval, else the agent's question.
 */
export function needsYouNotice(session: AgentSession, freshKeys: string[]): NeedsYouNotice {
  const approvalKey = freshKeys.find((key) => key.startsWith("a:"));
  const callId = approvalKey?.slice(2);
  const preview = callId ? approvalPreview(session, callId) : undefined;
  if (preview) {
    const target = preview.files[0] ?? preview.branch;
    const body = preview.command
      ? `Wants to run: ${preview.command}`
      : target
        ? `${preview.label} (${target})`
        : preview.label;
    return {
      title: `${session.title} needs approval`,
      body: body.length > 200 ? `${body.slice(0, 199)}…` : body,
      sessionId: session.id,
      callId,
      approvable: preview.batchable,
    };
  }
  const reason = session.needsHuman?.trim();
  return {
    title: session.title,
    body: reason ? reason.slice(0, 200) : "Needs you",
    sessionId: session.id,
    approvable: false,
  };
}

/** Desktop shell: native notification (Approve / Deny on macOS). Browser: web Notification. */
export function showNeedsYouNotice(
  notice: NeedsYouNotice,
  enabled: boolean,
  onOpen: () => void,
  bridge: LocusDesktopBridge | undefined = desktopBridge(),
): void {
  if (!enabled) return;
  if (bridge?.notify) {
    bridge.notify(notice);
    return;
  }
  notifyTurnDone(notice.title, notice.body, true, onOpen);
}

/** Act on a tray or notification click from the desktop shell. */
export async function runAmbientAction(
  payload: AmbientAction,
  deps: {
    dispatch: Dispatch<Action>;
    resolveApproval: (
      sessionId: string,
      callId: string,
      decision: "approved" | "denied",
    ) => Promise<AgentSession>;
    onError?: (err: unknown, decision: "approved" | "denied") => void;
  },
): Promise<void> {
  const { dispatch } = deps;
  if (payload.action === "inbox") {
    dispatch({ type: "inbox", open: true });
    return;
  }
  if (!payload.sessionId) return;
  if ((payload.action === "approve" || payload.action === "deny") && payload.callId) {
    const decision = payload.action === "approve" ? "approved" : "denied";
    try {
      const session = await deps.resolveApproval(payload.sessionId, payload.callId, decision);
      dispatch({ type: "session", session });
    } catch (err) {
      deps.onError?.(err, decision);
      // Could not decide in the background: take the operator to the chat instead.
      dispatch({ type: "select", id: payload.sessionId });
    }
    return;
  }
  dispatch({ type: "select", id: payload.sessionId });
  dispatch({ type: "inbox", open: false });
}
