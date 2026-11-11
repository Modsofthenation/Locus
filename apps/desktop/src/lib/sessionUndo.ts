import type { AgentSession } from "@locus/shared";
import { api } from "./api";
import { showNotice, showUndoNotice } from "./notice";

type SessionDispatch = (
  action:
    | { type: "session"; session: AgentSession }
    | { type: "deleted"; id: string }
    | { type: "deselect"; id: string }
    | { type: "select"; id: string },
) => void;

type ArchiveOptions = {
  /** Close the chat if it is open (Delete), and reopen it on Undo when `wasOpen`. */
  close?: boolean;
  wasOpen?: boolean;
};

export async function archiveSessions(
  targets: AgentSession[],
  dispatch: SessionDispatch,
  doneLabel: string,
  opts: ArchiveOptions = {},
): Promise<void> {
  if (!targets.length) return;
  const previous = targets.map((session) => ({ ...session }));
  const errors: string[] = [];
  for (const session of targets) {
    try {
      await api.patchSession(session.id, { archived: true });
      dispatch({ type: "session", session: { ...session, archived: true } });
      if (opts.close) dispatch({ type: "deselect", id: session.id });
    } catch (err) {
      errors.push(`${session.title}: ${err instanceof Error ? err.message : "Could not archive"}`);
    }
  }
  if (errors.length) {
    showNotice(errors.join("\n"));
    return;
  }
  showUndoNotice(doneLabel, () => {
    void (async () => {
      for (const session of previous) {
        try {
          await api.patchSession(session.id, { archived: false });
          dispatch({ type: "session", session: { ...session, archived: false } });
          if (opts.close && opts.wasOpen) dispatch({ type: "select", id: session.id });
        } catch (err) {
          showNotice(err instanceof Error ? err.message : "Could not undo archive");
        }
      }
    })();
  });
}

export function archiveOne(session: AgentSession, dispatch: SessionDispatch, label?: string): void {
  void archiveSessions([session], dispatch, label ?? `Archived ${session.title}`);
}

export async function deleteSessionWithUndo(
  session: AgentSession,
  dispatch: SessionDispatch,
  ask: (opts: {
    title: string;
    body: string;
    confirmLabel: string;
    danger: boolean;
  }) => Promise<boolean>,
  opts: { open?: boolean } = {},
): Promise<void> {
  if (session.archived) {
    if (
      !(await ask({
        title: `Delete ${session.title}?`,
        body: "This cannot be undone.",
        confirmLabel: "Delete",
        danger: true,
      }))
    ) {
      return;
    }
    try {
      await api.deleteSession(session.id);
      dispatch({ type: "deleted", id: session.id });
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "Could not delete this agent");
    }
    return;
  }
  // Delete of a live chat is a soft delete (archive + Undo). Close it so the
  // pane goes back to the new-agent screen instead of showing a removed chat.
  void archiveSessions([session], dispatch, `Deleted ${session.title}`, {
    close: true,
    wasOpen: opts.open,
  });
}
