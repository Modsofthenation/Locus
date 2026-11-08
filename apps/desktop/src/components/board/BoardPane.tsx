import { useEffect, useRef, useState } from "react";
import type { BoardCite, BoardDocument, BoardRunTarget } from "@locus/shared";
import { Modal } from "@/components/layout/Modal";
import { api } from "@/lib/api";
import { showNotice } from "@/lib/notice";
import { useStore } from "@/state/store";
import { ChatPane } from "@/components/chat/ChatPane";
import { IconChat, IconPanelRight } from "@/components/layout/Icons";
import { WorkspaceBody } from "@/components/workspace/WorkspaceBody";
import { useDeferredCollapse } from "@/lib/useDeferredCollapse";
import { ErrorBanner, InlineError, Skeleton } from "@/components/layout/Skeleton";
import { BoardCanvas } from "./BoardCanvas";
import { BoardEmpty } from "./BoardEmpty";

export function BoardPane() {
  const { state, dispatch } = useStore();
  const id = state.selectedBoardId;
  const cached = id ? state.boardDocuments[id] : undefined;
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<BrainBriefDraftState | null>(null);
  const patchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<BoardDocument | null>(null);

  useEffect(() => {
    if (!id) return;
    if (cached && cached.id === id) return;
    let cancelled = false;
    void api.board(id).then(
      (board) => {
        if (!cancelled) dispatch({ type: "board", board });
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load board");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, cached, dispatch]);

  useEffect(() => {
    return () => {
      if (patchTimer.current) clearTimeout(patchTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!id || !cached || cached.id !== id) return;
    const pulls = cached.objects
      .filter(
        (row) =>
          row.type === "card" && row.cite?.kind === "pull" && row.cite.repoId && row.cite.number,
      )
      .slice(0, 6);
    if (!pulls.length) return;
    let cancelled = false;
    void (async () => {
      const labels = new Map<string, string>();
      for (const row of pulls) {
        try {
          const pr = await api.repoPull(row.cite!.repoId!, row.cite!.number!);
          const label = `${pr.title} #${pr.number}`;
          if (label !== (row.cite?.label ?? row.text)) labels.set(row.id, label);
        } catch {
          /* live labels are best-effort */
        }
      }
      if (cancelled || !labels.size) return;
      const current = pending.current ?? cached;
      dispatch({
        type: "board",
        board: {
          ...current,
          objects: current.objects.map((row) =>
            labels.has(row.id) && row.cite
              ? {
                  ...row,
                  text: labels.get(row.id),
                  cite: { ...row.cite, label: labels.get(row.id) },
                }
              : row,
          ),
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [id, cached?.id, dispatch]);

  if (!id) return <BoardEmpty />;
  if (error) {
    return (
      <div className="empty">
        <ErrorBanner message={error} />
      </div>
    );
  }
  if (!cached) {
    return (
      <div className="empty">
        <Skeleton lines={4} label="Loading board" />
      </div>
    );
  }
  const board = cached;

  function queuePatch(next: BoardDocument) {
    dispatch({ type: "board", board: next });
    pending.current = next;
    if (patchTimer.current) clearTimeout(patchTimer.current);
    patchTimer.current = setTimeout(() => {
      const body = pending.current;
      pending.current = null;
      if (!body) return;
      void api.patchBoard(body.id, { objects: body.objects, comments: body.comments }).then(
        (board) => dispatch({ type: "board", board }),
        (err: unknown) => {
          showNotice(err instanceof Error ? err.message : "Could not save board");
        },
      );
    }, 400);
  }

  async function runFrame(frameId: string, target: BoardRunTarget) {
    try {
      const result = await api.runBoardFrame(board.id, frameId, target);
      dispatch({ type: "board", board: result.board });
      const session = await api.session(result.sessionId);
      dispatch({ type: "session", session });
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "Could not run this frame");
    }
  }

  async function pinPlan(frameId: string, sessionId: string) {
    try {
      const next = await api.pinBoardPlan(board.id, frameId, sessionId);
      dispatch({ type: "board", board: next });
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "Could not pin plan");
    }
  }

  async function askLocus(prompt?: string) {
    try {
      const result = await api.boardChat(board.id, prompt);
      dispatch({ type: "board", board: result.board });
      const session = await api.session(result.sessionId);
      dispatch({ type: "session", session });
      dispatch({ type: "select", id: session.id });
      if (state.vmCollapsed) dispatch({ type: "toggleVmPane" });
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "Could not open board chat");
    }
  }

  function openCite(cite: BoardCite) {
    if ((cite.kind === "agent" || cite.kind === "design") && cite.sessionId) {
      dispatch({ type: "select", id: cite.sessionId });
      if (cite.kind === "agent" && cite.path) {
        dispatch({
          type: "openWorkspace",
          open: { sessionId: cite.sessionId, path: cite.path, at: Date.now() },
        });
      }
      return;
    }
    if (cite.kind === "file") {
      const sessionId = cite.sessionId ?? state.selectedId ?? state.sessions[0]?.id;
      if (sessionId && cite.path) {
        dispatch({ type: "select", id: sessionId });
        dispatch({
          type: "openWorkspace",
          open: { sessionId, path: cite.path, at: Date.now() },
        });
        return;
      }
      showNotice("Open a workspace to view this file.");
      dispatch({ type: "section", section: "ide" });
      return;
    }
    if (cite.kind === "automation" && cite.automationId) {
      dispatch({ type: "selectAutomation", id: cite.automationId });
      return;
    }
    if (cite.kind === "slack" && cite.channelId) {
      dispatch({ type: "selectSlackChannel", id: cite.channelId });
      return;
    }
    if (cite.kind === "pull" && cite.repoId) {
      dispatch({ type: "selectRepo", id: cite.repoId });
      if (cite.number) dispatch({ type: "selectPull", number: cite.number });
      return;
    }
    if (cite.kind === "jira" || cite.kind === "linear") {
      if (cite.url && /^https?:\/\//i.test(cite.url)) window.open(cite.url, "_blank", "noopener");
      else if (cite.key) showNotice(cite.key);
      return;
    }
    if (cite.kind === "brain") {
      dispatch({ type: "section", section: "brain" });
      return;
    }
  }

  async function openBrainBrief(cite: BoardCite) {
    if (cite.kind !== "jira" && cite.kind !== "linear") return;
    const issue = cite.key || cite.url || cite.label || "";
    setBrief({ issue, target: cite.kind, title: cite.label, body: "", busy: true });
    try {
      const draft = await api.brainBrief({
        issue,
        target: cite.kind,
        title: cite.label,
      });
      setBrief({
        issue: draft.issue,
        target: draft.target,
        title: draft.title ?? cite.label,
        body: draft.body,
        busy: false,
      });
    } catch (err) {
      setBrief({
        issue,
        target: cite.kind,
        title: cite.label,
        body: "",
        busy: false,
        error: err instanceof Error ? err.message : "Could not draft a briefing",
      });
    }
  }

  async function postBrainBrief() {
    if (!brief || brief.busy || !brief.body.trim()) return;
    setBrief({ ...brief, busy: true, error: undefined });
    try {
      await api.brainBrief({
        issue: brief.issue,
        target: brief.target,
        title: brief.title,
        body: brief.body,
        post: true,
      });
      setBrief(null);
      showNotice(`Posted brain briefing on ${brief.issue}`);
    } catch (err) {
      setBrief({
        ...brief,
        busy: false,
        error: err instanceof Error ? err.message : "Could not post the briefing",
      });
    }
  }

  return (
    <>
      <WorkspaceBody
        variant="board"
        collapsed={state.vmCollapsed}
        chat={<BoardChat board={board} onOpen={() => void askLocus()} />}
        preview={
          <BoardCanvas
            board={board}
            onChange={queuePatch}
            onOpenCite={openCite}
            onRunFrame={(frameId, target) => void runFrame(frameId, target)}
            onPinPlan={(frameId, sessionId) => void pinPlan(frameId, sessionId)}
            onAskLocus={(prompt) => void askLocus(prompt)}
            onBriefCite={(cite) => void openBrainBrief(cite)}
          />
        }
      />
      {brief ? (
        <BrainBriefDialog
          draft={brief}
          onChange={(body) => setBrief((current) => (current ? { ...current, body } : current))}
          onClose={() => setBrief(null)}
          onApprove={() => void postBrainBrief()}
        />
      ) : null}
    </>
  );
}

type BrainBriefDraftState = {
  issue: string;
  target: "jira" | "linear";
  title?: string;
  body: string;
  busy: boolean;
  error?: string;
};

function BoardChat(props: { board: BoardDocument; onOpen: () => void }) {
  const { dispatch, state } = useStore();
  const chatReady = Boolean(
    props.board.chatSessionId && state.selectedId === props.board.chatSessionId,
  );
  const showRail = useDeferredCollapse(state.vmCollapsed) || !chatReady;

  if (showRail) {
    return (
      <aside className="vm-pane rail ide-chat-rail">
        <button type="button" className="vm-rail-toggle" title="Board chat" onClick={props.onOpen}>
          <IconChat />
          <span className="vm-rail-label">Chat</span>
        </button>
      </aside>
    );
  }

  return (
    <div className="ide-chat">
      <div className="ide-chat-bar">
        <span>Chat</span>
        <button
          type="button"
          className="btn icon ghost"
          title="Collapse chat"
          aria-label="Collapse chat"
          onClick={() => dispatch({ type: "toggleVmPane" })}
        >
          <IconPanelRight />
        </button>
      </div>
      <ChatPane />
    </div>
  );
}

function BrainBriefDialog(props: {
  draft: BrainBriefDraftState;
  onChange: (body: string) => void;
  onClose: () => void;
  onApprove: () => void;
}) {
  return (
    <Modal label="Brain briefing" dialogTestId="brain-brief-dialog" onClose={props.onClose}>
      <h2>Brain briefing for {props.draft.issue}</h2>
      <p className="modal-lead">Edit, then Approve. Locus will not post until you do.</p>
      {props.draft.busy && !props.draft.body ? (
        <p className="hint">Drafting from the brain…</p>
      ) : null}
      <textarea
        value={props.draft.body}
        rows={12}
        aria-label="Brain briefing"
        data-testid="brain-brief-text"
        disabled={props.draft.busy && !props.draft.body}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {props.draft.error ? <InlineError message={props.draft.error} /> : null}
      <div className="row-actions">
        <button type="button" className="btn" disabled={props.draft.busy} onClick={props.onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          data-testid="brain-brief-approve"
          disabled={props.draft.busy || !props.draft.body.trim()}
          onClick={props.onApprove}
        >
          Approve
        </button>
      </div>
    </Modal>
  );
}
