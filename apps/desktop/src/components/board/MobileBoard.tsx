import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  BOARD_RUN_TARGETS,
  cameraToFit,
  isBoardRunTarget,
  objectsInFrame,
  snapBoardCoord,
  type BoardDocument,
  type BoardObject,
  type BoardRunTarget,
  type BoardSummary,
} from "@locus/shared";
import { api } from "@/lib/api";
import {
  clipOnWords,
  compactRelativeTime,
  groupMobileRows,
  matchesMobileQuery,
} from "@/lib/mobileShell";
import { useStore } from "@/state/store";
import { IconChevron } from "@/components/layout/Icons";
import { Mascot } from "@/components/layout/Mascot";

export function MobileBoardList(props: {
  onOpen: (id: string) => void;
  onBack: () => void;
  query?: string;
}) {
  const { state, dispatch } = useStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.boards().then(
      (boards) => {
        if (!cancelled) dispatch({ type: "boards", boards });
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load boards");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  const rows = (state.boards ?? []).filter(
    (row) => !row.archived && matchesMobileQuery(row.title, props.query ?? ""),
  );
  const groups = groupMobileRows(rows, "today-earlier");

  return (
    <div className="mobile-board" data-testid="mobile-board-list">
      <div className="mobile-board-head">
        <button type="button" className="mobile-text-btn" onClick={props.onBack}>
          Back
        </button>
        <h2>Boards</h2>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {!rows.length && !error ? (
        <div className="mobile-empty">
          <Mascot pose="idle" size={64} />
          <h2>No boards yet</h2>
          <p>
            Create a board on the desktop, then open it here to add stickies, comment, or run a
            frame.
          </p>
        </div>
      ) : null}
      {groups.map((group) => (
        <section key={group.label} className="mobile-day">
          <h2>{group.label}</h2>
          <ul className="mobile-list">
            {group.items.map((row: BoardSummary) => (
              <li key={row.id}>
                <button type="button" className="mobile-row" onClick={() => props.onOpen(row.id)}>
                  <span className="mobile-row-main">
                    <span className="mobile-row-title">{clipOnWords(row.title, 48)}</span>
                    <span className="mobile-row-mono">
                      {row.objectCount} objects · {compactRelativeTime(row.updatedAt)}
                    </span>
                  </span>
                  <span className="mobile-row-chevron" aria-hidden="true">
                    <IconChevron />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function MobileBoardView(props: {
  boardId: string;
  onBack: () => void;
  onOpenAgent?: (sessionId: string) => void;
}) {
  const { state, dispatch } = useStore();
  const cached = state.boardDocuments[props.boardId];
  const [board, setBoard] = useState<BoardDocument | undefined>(cached);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [commentFor, setCommentFor] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [editFor, setEditFor] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [runFor, setRunFor] = useState<string | null>(null);
  const [cam, setCam] = useState({ x: 0, y: 0, z: 0.55 });
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; camX: number; camY: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.board(props.boardId).then(
      (next) => {
        if (cancelled) return;
        setBoard(next);
        dispatch({ type: "board", board: next });
        setCam(cameraToFit(next.objects, { w: 360, h: 480 }));
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load board");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [props.boardId, dispatch]);

  useEffect(() => {
    if (cached && cached.id === props.boardId) setBoard(cached);
  }, [cached, props.boardId]);

  const frames = useMemo(
    () => (board?.objects ?? []).filter((row) => row.type === "frame"),
    [board],
  );

  function applyBoard(next: BoardDocument) {
    setBoard(next);
    dispatch({ type: "board", board: next });
  }

  async function addSticky() {
    if (!board) return;
    setBusy(true);
    setError(null);
    try {
      const obj: BoardObject = {
        id: crypto.randomUUID(),
        type: "sticky",
        x: snapBoardCoord(cam.x + 40),
        y: snapBoardCoord(cam.y + 40),
        w: 160,
        h: 140,
        text: "",
        color: "amber",
      };
      const next = await api.upsertBoardObjects(board.id, [obj]);
      applyBoard(next);
      setEditFor(obj.id);
      setEditBody("");
      setCommentFor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add sticky");
    } finally {
      setBusy(false);
    }
  }

  async function submitComment() {
    if (!board || !commentFor || !commentBody.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.addBoardComment(board.id, commentFor, commentBody.trim());
      applyBoard(next);
      setCommentFor(null);
      setCommentBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not comment");
    } finally {
      setBusy(false);
    }
  }

  async function saveSticky() {
    if (!board || !editFor) return;
    const obj = board.objects.find((row) => row.id === editFor);
    if (!obj) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.upsertBoardObjects(board.id, [{ ...obj, text: editBody }]);
      applyBoard(next);
      setEditFor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save sticky");
    } finally {
      setBusy(false);
    }
  }

  function zoomBy(factor: number) {
    setCam((prev) => ({ ...prev, z: Math.min(2.4, Math.max(0.2, prev.z * factor)) }));
  }

  async function runFrame(frameId: string, target: BoardRunTarget) {
    if (!board) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.runBoardFrame(board.id, frameId, target);
      applyBoard(result.board);
      setRunFor(null);
      props.onOpenAgent?.(result.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run frame");
    } finally {
      setBusy(false);
    }
  }

  function onPointerDown(event: ReactPointerEvent) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".mobile-board-obj")) return;
    drag.current = { x: event.clientX, y: event.clientY, camX: cam.x, camY: cam.y };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent) {
    if (!drag.current) return;
    const dx = (event.clientX - drag.current.x) / cam.z;
    const dy = (event.clientY - drag.current.y) / cam.z;
    setCam({ ...cam, x: drag.current.camX - dx, y: drag.current.camY - dy });
  }

  function onPointerUp() {
    drag.current = null;
  }

  if (error && !board) {
    return (
      <div className="mobile-board" data-testid="mobile-board-view">
        <button type="button" className="mobile-text-btn" onClick={props.onBack}>
          Back
        </button>
        <p className="error-text">{error}</p>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="mobile-board" data-testid="mobile-board-view">
        <p className="hint">Loading board…</p>
      </div>
    );
  }

  return (
    <div className="mobile-board" data-testid="mobile-board-view">
      <div className="mobile-board-head">
        <button type="button" className="mobile-text-btn" onClick={props.onBack}>
          Back
        </button>
        <h2>{clipOnWords(board.title, 36)}</h2>
        <div className="mobile-board-zoom" data-testid="mobile-board-zoom">
          <button
            type="button"
            className="mobile-text-btn"
            aria-label="Zoom out"
            onClick={() => zoomBy(0.92)}
          >
            −
          </button>
          <button
            type="button"
            className="mobile-text-btn"
            aria-label="Zoom in"
            onClick={() => zoomBy(1.08)}
          >
            +
          </button>
        </div>
        <button
          type="button"
          className="mobile-text-btn"
          disabled={busy}
          onClick={() => void addSticky()}
        >
          Sticky
        </button>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      <div
        ref={stage}
        className="mobile-board-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(event) => {
          event.preventDefault();
          zoomBy(event.deltaY < 0 ? 1.08 : 0.92);
        }}
      >
        <div
          className="mobile-board-world"
          style={{
            transform: `translate(${-cam.x * cam.z}px, ${-cam.y * cam.z}px) scale(${cam.z})`,
          }}
        >
          {board.objects
            .filter((row) => row.type !== "connector" && row.type !== "ink")
            .map((row) => (
              <button
                key={row.id}
                type="button"
                className={`mobile-board-obj ${row.type}`}
                style={{ left: row.x, top: row.y, width: row.w, height: row.h }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (row.type === "frame") {
                    setRunFor(row.id);
                    setCam(cameraToFit(objectsInFrame(board, row.id), { w: 360, h: 420 }));
                    return;
                  }
                  if (row.type === "sticky") {
                    setEditFor(row.id);
                    setEditBody(row.text ?? "");
                    setCommentFor(null);
                    return;
                  }
                  setCommentFor(row.id);
                  setCommentBody("");
                }}
              >
                <span className="mobile-board-obj-label">
                  {row.type === "frame"
                    ? row.text || "Frame"
                    : row.type === "card"
                      ? row.cite?.label || row.text || "Card"
                      : row.text || row.type}
                </span>
              </button>
            ))}
        </div>
      </div>

      {frames.length ? (
        <div className="mobile-board-frames" data-testid="mobile-board-frames">
          <p className="mobile-row-mono">Frames · tap to run</p>
          <div className="mobile-board-frame-row">
            {frames.map((frame) => (
              <button
                key={frame.id}
                type="button"
                className="mobile-board-frame-chip"
                onClick={() => setRunFor(frame.id)}
              >
                {frame.text || "Frame"}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {editFor ? (
        <div className="mobile-board-sheet" data-testid="mobile-board-sticky">
          <p className="mobile-row-mono">Sticky text</p>
          <textarea
            value={editBody}
            rows={3}
            placeholder="Write a note…"
            onChange={(event) => setEditBody(event.target.value)}
          />
          <div className="mobile-board-sheet-actions">
            <button type="button" className="btn small" onClick={() => setEditFor(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn small"
              disabled={busy}
              onClick={() => {
                setCommentFor(editFor);
                setCommentBody("");
                setEditFor(null);
              }}
            >
              Comment
            </button>
            <button
              type="button"
              className="btn small primary"
              disabled={busy}
              onClick={() => void saveSticky()}
            >
              Save
            </button>
          </div>
        </div>
      ) : null}

      {commentFor ? (
        <div className="mobile-board-sheet" data-testid="mobile-board-comment">
          <p className="mobile-row-mono">Comment on object</p>
          <textarea
            value={commentBody}
            rows={3}
            placeholder="Add a comment…"
            onChange={(event) => setCommentBody(event.target.value)}
          />
          <div className="mobile-board-sheet-actions">
            <button type="button" className="btn small" onClick={() => setCommentFor(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn small primary"
              disabled={busy || !commentBody.trim()}
              onClick={() => void submitComment()}
            >
              Comment
            </button>
          </div>
        </div>
      ) : null}

      {runFor ? (
        <div className="mobile-board-sheet" data-testid="mobile-board-run">
          <p className="mobile-row-mono">Run this frame</p>
          <div className="mobile-board-sheet-actions">
            {BOARD_RUN_TARGETS.map((target) => (
              <button
                key={target}
                type="button"
                className="btn small primary"
                disabled={busy}
                onClick={() => {
                  if (!isBoardRunTarget(target)) return;
                  void runFrame(runFor, target);
                }}
              >
                {target}
              </button>
            ))}
            <button type="button" className="btn small" onClick={() => setRunFor(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
