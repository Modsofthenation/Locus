import {
  BOARD_AI_ACTIONS,
  BOARD_ALIGN_OPS,
  BOARD_DISTRIBUTE_OPS,
  BOARD_GRID,
  BOARD_IMAGE_MIMES,
  BOARD_PORTS,
  BOARD_RESIZE_HANDLES,
  alignBoardObjects,
  bindBoardCite,
  boardAiPrompt,
  boardCitePresentation,
  boardConnectorAnchors,
  boardConnectorElbow,
  boardObjectPort,
  cameraToFit,
  clusterBoardStickies,
  connectBoardObjects,
  distributeBoardObjects,
  dropBoardObjects,
  duplicateBoardObjects,
  emptyBoardTable,
  emptyBoardTimeline,
  boardObjectFromInkStroke,
  frameBoardSelection,
  hitBoardObject,
  layerBoardObjects,
  objectsInRect,
  parseBoardClipboard,
  parseBoardPaste,
  pickBoardHit,
  rehomeBoardObjects,
  remapBoardObjects,
  scaleBoardSelection,
  selectionBounds,
  selectionMoveIds,
  selectionStickyStackIds,
  serializeBoardClipboard,
  snapBoardCoord,
  spawnConnectedBoardObject,
  stackBoardStickies,
  maybeStackDroppedStickies,
  stepBoardFontSize,
  translateBoardObjects,
  unstackBoardStickies,
  stickyStackMembers,
  objectsForClipboard,
  boardFramesInPresentationOrder,
  nextPresentFrameIndex,
  objectsInFrame,
  type BoardAiActionId,
  type BoardAlignOp,
  type BoardCite,
  type BoardCiteKind,
  type BoardCiteLiveContext,
  type BoardComment,
  type BoardDistributeOp,
  type BoardDocument,
  type BoardLayerOp,
  type BoardObject,
  type BoardPort,
  type BoardResizeHandle,
  type BoardRunTarget,
  type BoardShapeKind,
} from "@locus/shared";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { mermaidSvg } from "@/lib/mermaidDiagram";
import { useStore } from "@/state/store";
import {
  IconChat,
  IconClone,
  IconClose,
  IconCluster,
  IconFrame,
  IconLayerBack,
  IconLayerFront,
  IconStack,
  IconTaskBurst,
  IconTaskList,
} from "@/components/layout/Icons";
import {
  fixedContainingOrigin,
  MenuItem,
  MenuLabel,
  MenuSep,
  placePointerMenu,
} from "@/components/layout/OverflowMenu";
import { Select } from "@/components/layout/Select";
import { Tooltip } from "@/components/layout/Tooltip";
import { shortcutHint } from "@/lib/shortcuts";
import { showNotice } from "@/lib/notice";
import { BoardShapeFace, BoardShapePicker } from "./BoardShapePicker";
import { BoardTableObject } from "./BoardTableObject";
import { BoardTimelineObject } from "./BoardTimelineObject";

type Tool =
  | "select"
  | "pan"
  | "sticky"
  | "text"
  | "shape"
  | "connector"
  | "frame"
  | "card"
  | "comment"
  | "table"
  | "timeline"
  | "mermaid"
  | "draw";

const STICKY_COLORS = ["amber", "mint", "sky", "rose", "violet", "paper"] as const;
const OBJECT_Z = 1000;

function newId(): string {
  return crypto.randomUUID();
}

function typingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

function isBoardImageFile(file: File): boolean {
  if ((BOARD_IMAGE_MIMES as readonly string[]).includes(file.type)) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(file.name);
}

function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  const seen = new Set<File>();
  const push = (file: File | null) => {
    if (!file || seen.has(file) || !isBoardImageFile(file)) return;
    seen.add(file);
    out.push(file);
  };
  if (data.files) for (const file of Array.from(data.files)) push(file);
  if (data.items) {
    for (const item of Array.from(data.items)) {
      if (item.kind === "file") push(item.getAsFile());
    }
  }
  return out;
}

function boardImageSize(file: File): Promise<{ w: number; h: number }> {
  const fallback = { w: 240, h: 180 };
  return new Promise((resolve) => {
    if (typeof Image === "undefined") {
      resolve(fallback);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    let settled = false;
    const done = (w: number, h: number) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve({ w, h });
    };
    const fromNatural = () => {
      const nw = img.naturalWidth || img.width;
      const nh = img.naturalHeight || img.height;
      if (!nw || !nh) {
        done(fallback.w, fallback.h);
        return;
      }
      const scale = Math.min(1, 480 / Math.max(nw, nh));
      done(
        Math.max(BOARD_GRID * 4, snapBoardCoord(nw * scale)),
        Math.max(BOARD_GRID * 3, snapBoardCoord(nh * scale)),
      );
    };
    img.onload = fromNatural;
    img.onerror = () => done(fallback.w, fallback.h);
    img.src = url;
    // jsdom marks blob URLs complete with no decode; keep that fast path.
    if (img.complete) {
      if (img.naturalWidth > 0) fromNatural();
      else done(fallback.w, fallback.h);
    }
  });
}

function citeLiveContext(state: {
  sessions: BoardCiteLiveContext["sessions"];
  repos: BoardCiteLiveContext["repos"];
  slackConversations: BoardCiteLiveContext["slack"];
  automations: BoardCiteLiveContext["automations"];
}): BoardCiteLiveContext {
  return {
    sessions: state.sessions,
    repos: state.repos,
    slack: state.slackConversations,
    automations: state.automations,
  };
}

function connectorPoints(from: BoardObject, to: BoardObject): string {
  const ends = boardConnectorAnchors(from, to);
  return boardConnectorElbow(ends.from, ends.to)
    .map((pt) => `${pt.x},${pt.y}`)
    .join(" ");
}

export function BoardCanvas(props: {
  board: BoardDocument;
  onChange: (board: BoardDocument) => void;
  onOpenCite: (cite: BoardCite) => void;
  onRunFrame: (frameId: string, target: BoardRunTarget) => void;
  onAskLocus?: (prompt: string) => void;
  onBriefCite?: (cite: BoardCite) => void;
  onPinPlan?: (frameId: string, sessionId: string) => void;
}) {
  const { state, dispatch } = useStore();
  const root = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [cam, setCam] = useState({ x: -40, y: -40, z: 1 });
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [space, setSpace] = useState(false);
  const [draft, setDraft] = useState<string>(props.board.objects[0]?.text ?? "");
  const [connectorFrom, setConnectorFrom] = useState<string | null>(null);
  const [portDrag, setPortDrag] = useState<{
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [shapeOpen, setShapeOpen] = useState(false);
  const [overlayShapeOpen, setOverlayShapeOpen] = useState(false);
  const [pendingShape, setPendingShape] = useState<BoardShapeKind>("rounded");
  const [inkDraft, setInkDraft] = useState<{ x: number; y: number }[] | null>(null);
  const [inkColor, setInkColor] = useState<(typeof STICKY_COLORS)[number]>("paper");
  const [runOpen, setRunOpen] = useState<string | null>(null);
  const [pinPlanOpen, setPinPlanOpen] = useState<string | null>(null);
  const [presentIndex, setPresentIndex] = useState<number | null>(null);
  const [commentFor, setCommentFor] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const history = useRef<BoardDocument[]>([props.board]);
  const histAt = useRef(0);
  const boardRef = useRef(props.board);
  const gesture = useRef(false);
  if (!gesture.current) boardRef.current = props.board;

  useEffect(() => {
    history.current = [boardRef.current];
    histAt.current = 0;
    setCanUndo(false);
    setCanRedo(false);
  }, [props.board.id]);

  const objects = props.board.objects;
  const frames = objects.filter((row) => row.type === "frame");
  const citeCtx = citeLiveContext(state);

  useEffect(() => {
    const focusId = state.boardFocusObjectId;
    if (!focusId || state.selectedBoardId !== props.board.id) return;
    const obj = boardRef.current.objects.find((row) => row.id === focusId);
    if (obj && obj.type !== "connector") {
      setSelected([obj.id]);
      setCam(cameraToFit([obj], viewport()));
    }
    dispatch({ type: "selectBoard", id: props.board.id });
  }, [state.boardFocusObjectId, state.selectedBoardId, props.board.id, dispatch]);

  function syncHist() {
    setCanUndo(histAt.current > 0);
    setCanRedo(histAt.current < history.current.length - 1);
  }

  function viewport() {
    const rect = root.current?.getBoundingClientRect();
    return { w: rect?.width ?? 800, h: rect?.height ?? 560 };
  }

  function zoomTo(nextZ: number, origin?: { x: number; y: number }) {
    const z = Math.min(2.4, Math.max(0.25, nextZ));
    const world = origin ?? {
      x: viewport().w / 2 / cam.z + cam.x,
      y: viewport().h / 2 / cam.z + cam.y,
    };
    setCam({
      z,
      x: world.x - (world.x - cam.x) * (cam.z / z),
      y: world.y - (world.y - cam.y) * (cam.z / z),
    });
  }

  function fitTo(next: BoardObject[] = objects) {
    setCam(cameraToFit(next, viewport()));
  }

  function presentFrame(delta: number) {
    const ordered = boardFramesInPresentationOrder(boardRef.current.objects);
    if (!ordered.length) return;
    const selectedFrameIndex = ordered.findIndex((row) => selected.includes(row.id));
    const next = nextPresentFrameIndex(ordered.length, presentIndex, selectedFrameIndex, delta);
    const frame = ordered[next]!;
    setPresentIndex(next);
    setSelected([frame.id]);
    fitTo(objectsInFrame(boardRef.current, frame.id));
  }

  function spawnMindMapChild() {
    const id = selected.length === 1 ? selected[0] : undefined;
    if (!id) return;
    const spawned = spawnConnectedBoardObject(boardRef.current.objects, id, "e");
    if (!spawned.id) return;
    commit({ ...boardRef.current, objects: spawned.objects });
    setSelected([spawned.id]);
    setEditing(spawned.id);
    setDraft("");
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.code === "Space") {
        if (!typingTarget(event.target)) {
          event.preventDefault();
          setSpace(event.type === "keydown");
        }
        return;
      }
      if (event.type !== "keydown") return;
      const meta = event.metaKey || event.ctrlKey;
      if (typingTarget(event.target)) {
        if (event.key === "Escape") (event.target as HTMLElement).blur();
        return;
      }
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        stepHistory(event.shiftKey ? 1 : -1);
        return;
      }
      if (meta && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (meta && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copySelected();
        return;
      }
      if (meta && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelected(objects.filter((row) => row.type !== "connector").map((row) => row.id));
        return;
      }
      if (meta && event.key === "0") {
        event.preventDefault();
        fitTo();
        return;
      }
      if (meta && (event.key === "=" || event.key === "+")) {
        event.preventDefault();
        zoomTo(cam.z * 1.08);
        return;
      }
      if (meta && event.key === "-") {
        event.preventDefault();
        zoomTo(cam.z * 0.92);
        return;
      }
      if (meta && event.key === "]") {
        event.preventDefault();
        layerSelected(event.shiftKey ? "front" : "forward");
        return;
      }
      if (meta && event.key === "[") {
        event.preventDefault();
        layerSelected(event.shiftKey ? "back" : "backward");
        return;
      }
      if (meta) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelected();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setPresentIndex(null);
        if (
          commentFor ||
          cardOpen ||
          runOpen ||
          pinPlanOpen ||
          connectorFrom ||
          ctxMenu ||
          shapeOpen
        ) {
          setCommentFor(null);
          setCardOpen(false);
          setShapeOpen(false);
          setOverlayShapeOpen(false);
          setRunOpen(null);
          setPinPlanOpen(null);
          setConnectorFrom(null);
          setCtxMenu(null);
          return;
        }
        if (tool !== "select") {
          setTool("select");
          return;
        }
        setSelected([]);
        setEditing(null);
        return;
      }
      if (event.key === "v" || event.key === "V") {
        setTool("select");
        setShapeOpen(false);
        setOverlayShapeOpen(false);
      }
      if (event.key === "h" || event.key === "H") {
        setTool("pan");
        setShapeOpen(false);
      }
      if (event.key === "n" || event.key === "N") {
        setTool("sticky");
        setShapeOpen(false);
      }
      if (event.key === "t" || event.key === "T") {
        setTool("text");
        setShapeOpen(false);
      }
      if (event.key === "r" || event.key === "R") {
        setTool("shape");
        setShapeOpen(true);
      }
      if (event.key === "p" || event.key === "P") {
        setTool("draw");
        setSelected([]);
        setShapeOpen(false);
      }
      if (event.key === "l" || event.key === "L") {
        setTool("connector");
        setShapeOpen(false);
      }
      if (event.key === "f" || event.key === "F") {
        setTool("frame");
        setShapeOpen(false);
      }
      if (event.key === "c" || event.key === "C") {
        setTool("comment");
        setShapeOpen(false);
      }
      const overlayOpen = Boolean(
        commentFor || cardOpen || runOpen || pinPlanOpen || connectorFrom || ctxMenu || shapeOpen,
      );
      if (event.key === "m" || event.key === "M") {
        if (overlayOpen) return;
        setTool("mermaid");
        setShapeOpen(false);
      }
      if (event.key === "Tab") {
        if (overlayOpen || selected.length !== 1) return;
        const tag = (event.target as HTMLElement | null)?.tagName;
        if (tag === "BUTTON" || tag === "A" || tag === "SELECT") return;
        event.preventDefault();
        spawnMindMapChild();
        return;
      }
      if (event.key === "j" || event.key === "J") {
        if (overlayOpen) return;
        event.preventDefault();
        presentFrame(1);
        return;
      }
      if (event.key === "k" || event.key === "K") {
        if (overlayOpen) return;
        event.preventDefault();
        presentFrame(-1);
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  });

  function commit(next: BoardDocument, record = true) {
    boardRef.current = next;
    if (record) {
      history.current = history.current.slice(0, histAt.current + 1);
      history.current.push(next);
      histAt.current = history.current.length - 1;
      syncHist();
    }
    props.onChange(next);
  }

  function stepHistory(dir: number) {
    const at = histAt.current + dir;
    if (at < 0 || at >= history.current.length) return;
    histAt.current = at;
    syncHist();
    const snap = history.current[at];
    if (snap) {
      boardRef.current = snap;
      props.onChange(snap);
    }
  }

  function worldFromEvent(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = root.current?.getBoundingClientRect();
    const sx = event.clientX - (rect?.left ?? 0);
    const sy = event.clientY - (rect?.top ?? 0);
    return { x: sx / cam.z + cam.x, y: sy / cam.z + cam.y };
  }

  function upsert(obj: BoardObject, record = true) {
    const current = boardRef.current;
    const objectsNext = current.objects.some((row) => row.id === obj.id)
      ? current.objects.map((row) => (row.id === obj.id ? obj : row))
      : [...current.objects, obj];
    commit({ ...current, objects: rehomeBoardObjects(objectsNext, new Set([obj.id])) }, record);
  }

  function removeSelected() {
    if (!selected.length) return;
    commit(dropBoardObjects(boardRef.current, selected));
    setSelected([]);
  }

  function duplicateSelected() {
    const next = duplicateBoardObjects(boardRef.current.objects, selected);
    if (!next.ids.length) return;
    commit({ ...boardRef.current, objects: next.objects });
    setSelected(next.ids);
  }

  function copySelected() {
    const slice = objectsForClipboard(boardRef.current.objects, selected);
    if (!slice.length) return;
    const text = serializeBoardClipboard(slice);
    void navigator.clipboard?.writeText?.(text);
  }

  function pasteObjects(raw: string, at?: { x: number; y: number }) {
    const objectsClip = parseBoardClipboard(raw);
    if (objectsClip) {
      const copies = remapBoardObjects(objectsClip, { dx: BOARD_GRID, dy: BOARD_GRID });
      commit({
        ...boardRef.current,
        objects: rehomeBoardObjects([...boardRef.current.objects, ...copies]),
      });
      setSelected(copies.map((row) => row.id));
      setTool("select");
      return true;
    }
    const cite = parseBoardPaste(raw);
    if (!cite) return false;
    const bound = bindBoardCite(cite, citeCtx);
    const pos = at ?? { x: cam.x + 120, y: cam.y + 120 };
    const obj: BoardObject = {
      id: newId(),
      type: "card",
      x: snapBoardCoord(pos.x),
      y: snapBoardCoord(pos.y),
      w: 220,
      h: 72,
      cite: bound,
      text: bound.label,
    };
    upsert(obj);
    setSelected([obj.id]);
    return true;
  }

  async function addImageFiles(files: File[], at?: { x: number; y: number }) {
    const images = files.filter(isBoardImageFile);
    if (!images.length) return false;
    let x = at?.x ?? cam.x + 120;
    let y = at?.y ?? cam.y + 120;
    const next = [...boardRef.current.objects];
    const ids: string[] = [];
    for (const file of images) {
      try {
        const { assetId } = await api.uploadBoardAsset(props.board.id, file);
        const size = await boardImageSize(file);
        const obj: BoardObject = {
          id: newId(),
          type: "image",
          x: snapBoardCoord(x),
          y: snapBoardCoord(y),
          w: size.w,
          h: size.h,
          assetId,
          text: file.name,
        };
        next.push(obj);
        ids.push(obj.id);
        x += BOARD_GRID;
        y += BOARD_GRID;
      } catch (err) {
        showNotice(err instanceof Error ? err.message : "Could not add image");
      }
    }
    if (!ids.length) return false;
    commit({ ...boardRef.current, objects: rehomeBoardObjects(next) });
    setSelected(ids);
    setTool("select");
    return true;
  }

  function placeObject(x: number, y: number) {
    const sx = snapBoardCoord(x);
    const sy = snapBoardCoord(y);
    if (tool === "sticky") {
      const obj: BoardObject = {
        id: newId(),
        type: "sticky",
        x: sx,
        y: sy,
        w: 160,
        h: 140,
        text: "",
        color: "amber",
      };
      upsert(obj);
      setSelected([obj.id]);
      setEditing(obj.id);
      setDraft("");
      setTool("select");
      return;
    }
    if (tool === "text") {
      const obj: BoardObject = {
        id: newId(),
        type: "text",
        x: sx,
        y: sy,
        w: 280,
        h: 40,
        text: "Text",
      };
      upsert(obj);
      setSelected([obj.id]);
      setEditing(obj.id);
      setDraft("Text");
      setTool("select");
      return;
    }
    if (tool === "shape") {
      const obj: BoardObject = {
        id: newId(),
        type: "shape",
        x: sx,
        y: sy,
        w: 180,
        h: 80,
        text: "Box",
        shape: pendingShape,
      };
      upsert(obj);
      setSelected([obj.id]);
      setTool("select");
      setShapeOpen(false);
      return;
    }
    if (tool === "table") {
      const obj: BoardObject = {
        id: newId(),
        type: "table",
        x: sx,
        y: sy,
        w: 760,
        h: 300,
        text: "Table view",
        table: emptyBoardTable(),
      };
      upsert(obj);
      setSelected([obj.id]);
      setTool("select");
      return;
    }
    if (tool === "timeline") {
      const obj: BoardObject = {
        id: newId(),
        type: "timeline",
        x: sx,
        y: sy,
        w: 860,
        h: 280,
        text: "Timeline view",
        timeline: emptyBoardTimeline(),
      };
      upsert(obj);
      setSelected([obj.id]);
      setTool("select");
      return;
    }
    if (tool === "mermaid") {
      const obj: BoardObject = {
        id: newId(),
        type: "mermaid",
        x: sx,
        y: sy,
        w: 420,
        h: 280,
        text: "sequenceDiagram\n  Actor->>System: request\n  System-->>Actor: response",
      };
      upsert(obj);
      setSelected([obj.id]);
      setEditing(obj.id);
      setDraft(obj.text ?? "");
      setTool("select");
      return;
    }
    if (tool === "draw") return;
    if (tool === "frame") {
      const obj: BoardObject = {
        id: newId(),
        type: "frame",
        x: sx,
        y: sy,
        w: 480,
        h: 320,
        text: "Frame",
      };
      upsert(obj);
      setSelected([obj.id]);
      setTool("select");
      return;
    }
    if (tool === "card") {
      setCardOpen(true);
      return;
    }
  }

  function onWheel(event: React.WheelEvent) {
    event.preventDefault();
    const world = worldFromEvent(event);
    const factor = event.deltaY < 0 ? 1.08 : 0.92;
    zoomTo(cam.z * factor, world);
  }

  function startPan(event: ReactPointerEvent<HTMLDivElement>) {
    const ox = event.clientX;
    const oy = event.clientY;
    const start = { ...cam };
    const move = (ev: PointerEvent) => {
      setCam({
        ...start,
        x: start.x - (ev.clientX - ox) / start.z,
        y: start.y - (ev.clientY - oy) / start.z,
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startMove(hit: BoardObject, world: { x: number; y: number }, add: boolean) {
    const nextSelected = add
      ? selected.includes(hit.id)
        ? selected.filter((id) => id !== hit.id)
        : [...selected, hit.id]
      : selected.includes(hit.id)
        ? selected
        : selectionStickyStackIds(boardRef.current.objects, hit.id);
    setSelected(nextSelected);
    setEditing(null);
    if (add) return;
    const orig = boardRef.current.objects;
    const ids = selectionMoveIds(orig, nextSelected);
    const start = world;
    let dragged = false;
    gesture.current = true;
    const move = (ev: PointerEvent) => {
      const now = worldFromEvent(ev);
      const dx = snapBoardCoord(now.x - start.x);
      const dy = snapBoardCoord(now.y - start.y);
      if (!dx && !dy) return;
      dragged = true;
      commit({ ...boardRef.current, objects: translateBoardObjects(orig, ids, dx, dy) }, false);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      gesture.current = false;
      if (!dragged) return;
      const rehomed = rehomeBoardObjects(boardRef.current.objects, ids);
      const stacked = maybeStackDroppedStickies(rehomed, ids);
      commit({ ...boardRef.current, objects: stacked }, true);
      if (stacked !== rehomed) {
        const sid = stacked.find((row) => ids.has(row.id) && row.stackId)?.stackId;
        if (sid) setSelected(stickyStackMembers(stacked, sid).map((row) => row.id));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startMarquee(world: { x: number; y: number }, add: boolean) {
    const start = world;
    let rect = { x: start.x, y: start.y, w: 0, h: 0 };
    const move = (ev: PointerEvent) => {
      const now = worldFromEvent(ev);
      rect = { x: start.x, y: start.y, w: now.x - start.x, h: now.y - start.y };
      setMarquee(rect);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarquee(null);
      const ids = objectsInRect(boardRef.current.objects, rect);
      if (!rect.w && !rect.h && ids.length === 0) {
        if (!add) setSelected([]);
        setEditing(null);
        return;
      }
      setSelected(add ? Array.from(new Set([...selected, ...ids])) : ids);
      setEditing(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function layerSelected(op: BoardLayerOp) {
    if (!selected.length) return;
    commit({
      ...boardRef.current,
      objects: layerBoardObjects(boardRef.current.objects, selected, op),
    });
    setCtxMenu(null);
  }

  function alignSelected(op: BoardAlignOp) {
    if (selected.length < 2) return;
    commit({
      ...boardRef.current,
      objects: rehomeBoardObjects(alignBoardObjects(boardRef.current.objects, selected, op)),
    });
    setCtxMenu(null);
  }

  function distributeSelected(axis: BoardDistributeOp) {
    if (selected.length < 3) return;
    commit({
      ...boardRef.current,
      objects: rehomeBoardObjects(distributeBoardObjects(boardRef.current.objects, selected, axis)),
    });
    setCtxMenu(null);
  }

  function frameSelected() {
    const next = frameBoardSelection(boardRef.current.objects, selected);
    if (!next.frameId) return;
    commit({ ...boardRef.current, objects: next.objects });
    setSelected([next.frameId]);
    setCtxMenu(null);
  }

  function clusterSelected() {
    const next = clusterBoardStickies(boardRef.current.objects, selected);
    if (!next.frameIds.length) return;
    commit({ ...boardRef.current, objects: next.objects });
    setSelected(next.frameIds);
    setCtxMenu(null);
  }

  function stackSelected() {
    const next = stackBoardStickies(boardRef.current.objects, selected);
    commit({ ...boardRef.current, objects: next });
    const sid = next.find((row) => selected.includes(row.id) && row.stackId)?.stackId;
    if (sid) setSelected(stickyStackMembers(next, sid).map((row) => row.id));
    setCtxMenu(null);
  }

  function unstackSelected() {
    commit({
      ...boardRef.current,
      objects: unstackBoardStickies(boardRef.current.objects, selected),
    });
    setCtxMenu(null);
  }

  function startPortDrag(event: ReactPointerEvent, port: BoardPort) {
    event.preventDefault();
    event.stopPropagation();
    const fromObj = objects.find((row) => row.id === selected[0]);
    if (!fromObj || fromObj.type === "connector") return;
    const start = boardObjectPort(fromObj, port);
    setPortDrag({ from: start, to: start });
    gesture.current = true;
    const move = (ev: PointerEvent) => {
      setPortDrag({ from: start, to: worldFromEvent(ev) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      gesture.current = false;
      setPortDrag(null);
      const world = worldFromEvent(ev);
      if (Math.hypot(world.x - start.x, world.y - start.y) < 8) return;
      const hit = hitBoardObject(boardRef.current.objects, world.x, world.y);
      if (hit && hit.id !== fromObj.id && hit.type !== "connector" && hit.type !== "frame") {
        commit({
          ...boardRef.current,
          objects: connectBoardObjects(boardRef.current.objects, fromObj.id, hit.id),
        });
        return;
      }
      const spawned = spawnConnectedBoardObject(boardRef.current.objects, fromObj.id, port);
      if (!spawned.id) return;
      commit({ ...boardRef.current, objects: spawned.objects });
      setSelected([spawned.id]);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  }

  function askLocus(action: BoardAiActionId = "ask") {
    if (action === "cluster") {
      clusterSelected();
      return;
    }
    props.onAskLocus?.(boardAiPrompt(boardRef.current, selected, action));
    setCtxMenu(null);
  }

  function startResize(event: ReactPointerEvent, handle: BoardResizeHandle) {
    event.stopPropagation();
    const start = worldFromEvent(event);
    const orig = boardRef.current.objects;
    const ids = new Set(
      selected.filter((id) => orig.some((row) => row.id === id && row.type !== "connector")),
    );
    if (!ids.size) return;
    gesture.current = true;
    const proportional = handle.length === 2;
    let resized = false;
    const move = (ev: PointerEvent) => {
      const now = worldFromEvent(ev);
      resized = true;
      commit(
        {
          ...boardRef.current,
          objects: scaleBoardSelection(
            orig,
            ids,
            handle,
            now.x - start.x,
            now.y - start.y,
            proportional || ev.shiftKey,
          ),
        },
        false,
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      gesture.current = false;
      if (!resized) return;
      commit({ ...boardRef.current, objects: rehomeBoardObjects(boardRef.current.objects) }, true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startInk(event: ReactPointerEvent<HTMLDivElement>, world: { x: number; y: number }) {
    const points = [world];
    const color = inkColor;
    setSelected([]);
    setInkDraft(points);
    gesture.current = true;
    const pointerId = event.pointerId;
    const stage = event.currentTarget;
    try {
      stage.setPointerCapture(pointerId);
    } catch {
      /* jsdom */
    }
    const sample = (ev: PointerEvent | MouseEvent) => {
      const now = worldFromEvent(ev);
      const last = points[points.length - 1]!;
      if (Math.hypot(now.x - last.x, now.y - last.y) < 0.75) return;
      points.push(now);
      setInkDraft([...points]);
    };
    let done = false;
    const up = () => {
      if (done) return;
      done = true;
      stage.removeEventListener("pointermove", sample);
      window.removeEventListener("pointermove", sample, true);
      window.removeEventListener("mousemove", sample, true);
      stage.removeEventListener("pointerup", up);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("pointercancel", up);
      gesture.current = false;
      setInkDraft(null);
      const obj = boardObjectFromInkStroke(newId(), points, color);
      if (!obj) return;
      upsert(obj);
    };
    stage.addEventListener("pointermove", sample);
    window.addEventListener("pointermove", sample, true);
    window.addEventListener("mousemove", sample, true);
    stage.addEventListener("pointerup", up);
    window.addEventListener("pointerup", up);
    window.addEventListener("mouseup", up);
    window.addEventListener("pointercancel", up);
  }

  function onContextMenu(event: React.MouseEvent) {
    event.preventDefault();
    const world = worldFromEvent(event);
    const hit = pickBoardHit(objects, world.x, world.y, 14 / cam.z);
    if (hit && !selected.includes(hit.id)) {
      setSelected(selectionStickyStackIds(objects, hit.id));
    }
    setCtxMenu({ x: event.clientX, y: event.clientY });
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button === 1 || space || tool === "pan") {
      startPan(event);
      return;
    }
    if (
      (event.target as HTMLElement | null)?.closest(
        ".board-resize, .board-port, .board-overlay-bar, .board-ctx, .board-frames, .board-widget-ui, .board-shape-pop",
      )
    ) {
      return;
    }
    setCtxMenu(null);
    const world = worldFromEvent(event);
    if (tool === "draw") {
      startInk(event, world);
      return;
    }
    const hit = hitBoardObject(objects, world.x, world.y);
    if (tool === "connector") {
      if (hit) {
        if (connectorFrom && connectorFrom !== hit.id) {
          upsert({
            id: newId(),
            type: "connector",
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            fromId: connectorFrom,
            toId: hit.id,
          });
          setConnectorFrom(null);
          setTool("select");
        } else setConnectorFrom(hit.id);
      }
      return;
    }
    if (tool === "comment") {
      if (hit) {
        setCommentFor(hit.id);
        setCommentBody("");
      }
      return;
    }
    if (tool !== "select") {
      placeObject(world.x, world.y);
      return;
    }
    const picked = pickBoardHit(objects, world.x, world.y, 14 / cam.z);
    if (picked?.type === "connector") {
      setSelected(event.shiftKey ? Array.from(new Set([...selected, picked.id])) : [picked.id]);
      setEditing(null);
      return;
    }
    if (picked) {
      startMove(picked, world, event.shiftKey);
      return;
    }
    startMarquee(world, event.shiftKey);
  }

  function onPaste(event: React.ClipboardEvent) {
    if (typingTarget(event.target)) return;
    const images = filesFromClipboard(event.clipboardData);
    if (images.length) {
      event.preventDefault();
      void addImageFiles(images, { x: cam.x + 120, y: cam.y + 120 });
      return;
    }
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!text) return;
    if (pasteObjects(text, { x: cam.x + 120, y: cam.y + 120 })) event.preventDefault();
  }

  function onDragOver(event: React.DragEvent) {
    if (event.dataTransfer?.types && Array.from(event.dataTransfer.types).includes("Files")) {
      event.preventDefault();
    }
  }

  function onDrop(event: React.DragEvent) {
    const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
    const images = files.filter(isBoardImageFile);
    if (!images.length) return;
    event.preventDefault();
    void addImageFiles(images, worldFromEvent(event));
  }

  function onCopy(event: React.ClipboardEvent) {
    if (typingTarget(event.target)) return;
    const slice = objectsForClipboard(boardRef.current.objects, selected);
    if (!slice.length) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", serializeBoardClipboard(slice));
  }

  async function submitComment() {
    if (!commentFor || !commentBody.trim()) return;
    const next = await api.addBoardComment(props.board.id, commentFor, commentBody.trim());
    props.onChange(next);
    setCommentFor(null);
    setCommentBody("");
    setTool("select");
  }

  async function resolveComment(commentId: string) {
    const next = await api.resolveBoardComment(props.board.id, commentId);
    props.onChange(next);
  }

  function addCard(cite: BoardCite) {
    const bound = bindBoardCite(cite, citeCtx);
    const obj: BoardObject = {
      id: newId(),
      type: "card",
      x: snapBoardCoord(cam.x + 120),
      y: snapBoardCoord(cam.y + 120),
      w: 220,
      h: 72,
      cite: bound,
      text: bound.label,
    };
    upsert(obj);
    setCardOpen(false);
    setTool("select");
  }

  const selectedObj = objects.find((row) => row.id === selected[0]);
  const selectedStickies = objects.filter(
    (row) => selected.includes(row.id) && row.type === "sticky",
  );
  const canStackStickies =
    selectedStickies.length >= 2 &&
    !selectedStickies.every((row) => row.stackId && row.stackId === selectedStickies[0]?.stackId);
  const canUnstackStickies = selectedStickies.some((row) => row.stackId);
  const stackCount = (() => {
    const sid = selectedStickies[0]?.stackId;
    if (!sid || selectedStickies.some((row) => row.stackId !== sid)) return 0;
    if (selected.length !== selectedStickies.length) return 0;
    const members = stickyStackMembers(objects, sid);
    return members.length >= 2 && members.length === selectedStickies.length ? members.length : 0;
  })();
  const selBox = selectionBounds(objects, selected);
  const overlay = selBox
    ? {
        left: (selBox.x - cam.x) * cam.z,
        top: (selBox.y - cam.y) * cam.z,
        width: selBox.w * cam.z,
        height: selBox.h * cam.z,
      }
    : null;
  const box = marquee
    ? {
        x: Math.min(marquee.x, marquee.x + marquee.w),
        y: Math.min(marquee.y, marquee.y + marquee.h),
        w: Math.abs(marquee.w),
        h: Math.abs(marquee.h),
      }
    : null;

  return (
    <div className="board-workspace">
      <div className="board-toolbar" role="toolbar" aria-label="Board tools">
        {(
          [
            ["select", "Select", "V"],
            ["pan", "Pan", "H"],
            ["sticky", "Sticky", "N"],
            ["text", "Text", "T"],
            ["shape", "Shape", "R"],
            ["draw", "Draw", "P"],
            ["connector", "Connector", "L"],
            ["frame", "Frame", "F"],
            ["comment", "Comment", "C"],
          ] as const
        ).map(([id, label, hint]) => (
          <button
            key={id}
            type="button"
            className={tool === id || (id === "shape" && shapeOpen) ? "active" : ""}
            aria-pressed={tool === id || (id === "shape" && shapeOpen)}
            title={hint ? `${label} (${hint})` : label}
            onClick={() => {
              if (id === "shape") {
                setTool("shape");
                setShapeOpen((open) => !open);
                setOverlayShapeOpen(false);
                return;
              }
              setTool(id);
              setShapeOpen(false);
              setOverlayShapeOpen(false);
              if (id === "draw") setSelected([]);
            }}
          >
            {label}
          </button>
        ))}
        <span className="board-insert" role="group" aria-label="Insert">
          {(
            [
              ["table", "Table", ""],
              ["timeline", "Timeline", ""],
              ["mermaid", "Mermaid", "M"],
              ["card", "Card", ""],
            ] as const
          ).map(([id, label, hint]) => (
            <button
              key={id}
              type="button"
              className={tool === id ? "active" : ""}
              aria-pressed={tool === id}
              title={hint ? `${label} (${hint})` : label}
              onClick={() => {
                setTool(id);
                setShapeOpen(false);
                setOverlayShapeOpen(false);
                if (id === "card") setCardOpen(true);
              }}
            >
              {label}
            </button>
          ))}
        </span>
        {tool === "draw" ? (
          <span className="board-ink-colors" role="group" aria-label="Ink color">
            {STICKY_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`board-swatch color-${color}${inkColor === color ? " active" : ""}`}
                aria-label={color}
                aria-pressed={inkColor === color}
                title={color}
                onClick={() => setInkColor(color)}
              />
            ))}
          </span>
        ) : null}
        {shapeOpen ? (
          <BoardShapePicker
            value={pendingShape}
            onPick={(kind) => {
              setPendingShape(kind);
              setTool("shape");
              setShapeOpen(false);
              if (selectedObj?.type === "shape" && selected.length === 1) {
                upsert({ ...selectedObj, shape: kind });
              }
            }}
            onClose={() => setShapeOpen(false)}
          />
        ) : null}
        {props.onAskLocus ? (
          <button
            type="button"
            className="board-ask"
            title="Ask Locus about this selection or the whole board"
            onClick={() => askLocus()}
          >
            Ask Locus
          </button>
        ) : null}
        <span className="board-toolbar-gap" />
        <Tooltip label={shortcutHint("undo")}>
          <button type="button" disabled={!canUndo} onClick={() => stepHistory(-1)}>
            Undo
          </button>
        </Tooltip>
        <Tooltip label={shortcutHint("redo")}>
          <button type="button" disabled={!canRedo} onClick={() => stepHistory(1)}>
            Redo
          </button>
        </Tooltip>
        <div className="board-zoom">
          <Tooltip label="Zoom out">
            <button type="button" aria-label="Zoom out" onClick={() => zoomTo(cam.z * 0.92)}>
              −
            </button>
          </Tooltip>
          <span>{Math.round(cam.z * 100)}%</span>
          <Tooltip label="Zoom in">
            <button type="button" aria-label="Zoom in" onClick={() => zoomTo(cam.z * 1.08)}>
              +
            </button>
          </Tooltip>
          <Tooltip label={`Zoom to fit (${shortcutHint("board-fit")})`}>
            <button type="button" aria-label="Zoom to fit" onClick={() => fitTo()}>
              Fit
            </button>
          </Tooltip>
        </div>
      </div>
      <div
        ref={root}
        className={`board-stage tool-${tool}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
        onPaste={onPaste}
        onCopy={onCopy}
        onDragOver={onDragOver}
        onDrop={onDrop}
        tabIndex={0}
      >
        {frames.length ? (
          <nav className="board-frames" aria-label="Frames">
            {frames.map((row) => (
              <button
                key={row.id}
                type="button"
                className={selected.includes(row.id) ? "active" : ""}
                onClick={() => {
                  setSelected([row.id]);
                  fitTo([row]);
                }}
              >
                {row.text || "Untitled"}
              </button>
            ))}
          </nav>
        ) : null}
        <div
          className="board-world"
          style={{
            transform: `translate(${-cam.x * cam.z}px, ${-cam.y * cam.z}px) scale(${cam.z})`,
          }}
        >
          {objects
            .filter((row) => row.type === "frame")
            .map((obj) => (
              <div
                key={obj.id}
                className={`board-obj frame ${selected.includes(obj.id) ? "selected" : ""}`}
                style={{
                  left: obj.x,
                  top: obj.y,
                  width: obj.w,
                  height: obj.h,
                  zIndex: obj.z ?? 0,
                }}
                onDoubleClick={() => {
                  setEditing(obj.id);
                  setDraft(obj.text ?? "");
                }}
              >
                <span className="board-frame-title">{obj.text || "Frame"}</span>
                <button
                  type="button"
                  className="board-run"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    setRunOpen(obj.id);
                  }}
                >
                  Run
                </button>
                {editing === obj.id ? (
                  <textarea
                    value={draft}
                    autoFocus
                    onChange={(event) => setDraft(event.target.value)}
                    onPointerDown={(event) => event.stopPropagation()}
                    onBlur={() => {
                      upsert({ ...obj, text: draft });
                      setEditing(null);
                    }}
                  />
                ) : null}
              </div>
            ))}
          <svg className="board-wires" aria-hidden>
            {objects
              .filter((row) => row.type === "connector")
              .map((obj) => {
                const from = objects.find((row) => row.id === obj.fromId);
                const to = objects.find((row) => row.id === obj.toId);
                if (!from || !to) return null;
                const ends = boardConnectorAnchors(from, to);
                return (
                  <g key={obj.id}>
                    <polyline
                      className={selected.includes(obj.id) ? "selected" : ""}
                      points={connectorPoints(from, to)}
                    />
                    {obj.label ? (
                      <text x={(ends.from.x + ends.to.x) / 2} y={(ends.from.y + ends.to.y) / 2 - 6}>
                        {obj.label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            {portDrag ? (
              <polyline
                className="preview"
                points={boardConnectorElbow(portDrag.from, portDrag.to)
                  .map((pt) => `${pt.x},${pt.y}`)
                  .join(" ")}
              />
            ) : null}
            {inkDraft && inkDraft.length > 1 ? (
              <polyline
                className={`ink color-${inkColor}`}
                points={inkDraft.map((pt) => `${pt.x},${pt.y}`).join(" ")}
              />
            ) : null}
          </svg>
          {objects
            .filter((row) => row.type !== "frame" && row.type !== "connector")
            .map((obj) => (
              <div
                key={obj.id}
                className={`board-obj ${obj.type} color-${obj.color ?? "paper"} ${selected.includes(obj.id) ? "selected" : ""} shape-${obj.shape ?? "rect"}${obj.stackId ? " stacked" : ""}${obj.type === "card" && obj.cite && boardCitePresentation(obj.cite, citeCtx).stale ? " stale" : ""}`}
                style={{
                  left: obj.x,
                  top: obj.y,
                  width: obj.w,
                  height: obj.h,
                  zIndex: OBJECT_Z + (obj.z ?? 0),
                  fontSize:
                    obj.fontSize &&
                    (obj.type === "sticky" || obj.type === "text" || obj.type === "shape")
                      ? obj.fontSize
                      : undefined,
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (obj.type === "card" && obj.cite) {
                    props.onOpenCite(obj.cite);
                    return;
                  }
                  if (
                    obj.type === "image" ||
                    obj.type === "table" ||
                    obj.type === "timeline" ||
                    obj.type === "ink"
                  ) {
                    return;
                  }
                  setEditing(obj.id);
                  setDraft(obj.text ?? "");
                }}
              >
                {obj.type === "image" && obj.assetId ? (
                  <img
                    className="board-obj-image"
                    src={`/api/boards/${props.board.id}/assets/${encodeURIComponent(obj.assetId)}`}
                    alt={obj.text || "Image"}
                    draggable={false}
                  />
                ) : obj.type === "card" ? (
                  <CardFace obj={obj} ctx={citeCtx} />
                ) : obj.type === "table" ? (
                  <BoardTableObject
                    obj={obj}
                    onSelect={() => setSelected([obj.id])}
                    onChange={(next) => upsert(next)}
                  />
                ) : obj.type === "timeline" ? (
                  <BoardTimelineObject
                    obj={obj}
                    onSelect={() => setSelected([obj.id])}
                    onChange={(next) => upsert(next)}
                  />
                ) : obj.type === "mermaid" ? (
                  editing === obj.id ? (
                    <textarea
                      value={draft}
                      autoFocus
                      onChange={(event) => setDraft(event.target.value)}
                      onPointerDown={(event) => event.stopPropagation()}
                      onBlur={() => {
                        upsert({ ...obj, text: draft });
                        setEditing(null);
                      }}
                    />
                  ) : (
                    <BoardMermaidFace source={obj.text ?? ""} />
                  )
                ) : obj.type === "shape" ? (
                  <BoardShapeFace kind={obj.shape}>
                    {editing === obj.id ? (
                      <textarea
                        value={draft}
                        autoFocus
                        onChange={(event) => setDraft(event.target.value)}
                        onPointerDown={(event) => event.stopPropagation()}
                        onBlur={() => {
                          upsert({ ...obj, text: draft });
                          setEditing(null);
                        }}
                      />
                    ) : (
                      <span className="board-obj-text">{obj.text || ""}</span>
                    )}
                  </BoardShapeFace>
                ) : obj.type === "ink" && obj.ink ? (
                  <svg
                    className="board-ink"
                    viewBox={`0 0 ${Math.max(1, obj.w)} ${Math.max(1, obj.h)}`}
                    preserveAspectRatio="none"
                  >
                    <polyline
                      points={obj.ink.points.map((pt) => `${pt.x},${pt.y}`).join(" ")}
                      strokeWidth={obj.ink.width ?? 2.5}
                    />
                  </svg>
                ) : editing === obj.id ? (
                  <textarea
                    value={draft}
                    autoFocus
                    onChange={(event) => setDraft(event.target.value)}
                    onPointerDown={(event) => event.stopPropagation()}
                    onBlur={() => {
                      upsert({ ...obj, text: draft });
                      setEditing(null);
                    }}
                  />
                ) : (
                  <span className="board-obj-text">{obj.text || obj.cite?.label || ""}</span>
                )}
                {props.board.comments.some((row) => row.objectId === obj.id && !row.resolved) ? (
                  <span className="board-comment-dot" />
                ) : null}
              </div>
            ))}
          {box && (box.w > 2 || box.h > 2) ? (
            <div
              className="board-marquee"
              style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            />
          ) : null}
        </div>
        {overlay && tool === "select" && !editing ? (
          <SelectionOverlay
            box={overlay}
            size={selBox!}
            selected={selectedObj}
            multi={selected.length > 1}
            onResizeStart={startResize}
            onPortStart={startPortDrag}
            onDuplicate={duplicateSelected}
            onDelete={removeSelected}
            onComment={() => {
              if (selected[0]) {
                setCommentFor(selected[0]);
                setCommentBody("");
              }
            }}
            onLayer={layerSelected}
            onFrame={selected.length > 1 ? frameSelected : undefined}
            onStack={canStackStickies ? stackSelected : undefined}
            onUnstack={canUnstackStickies ? unstackSelected : undefined}
            stackCount={stackCount || undefined}
            onColor={(color) => {
              const ids = new Set(selected);
              commit({
                ...boardRef.current,
                objects: boardRef.current.objects.map((row) =>
                  ids.has(row.id) && (row.type === "sticky" || row.type === "ink")
                    ? { ...row, color }
                    : row,
                ),
              });
              if (selectedObj?.type === "ink") setInkColor(color);
            }}
            onFontSize={(dir) => {
              const ids = new Set(selected);
              commit({
                ...boardRef.current,
                objects: boardRef.current.objects.map((row) =>
                  ids.has(row.id) &&
                  (row.type === "sticky" || row.type === "text" || row.type === "shape")
                    ? { ...row, fontSize: stepBoardFontSize(row.fontSize, dir) }
                    : row,
                ),
              });
            }}
            onShape={() => {
              setOverlayShapeOpen((open) => !open);
              setShapeOpen(false);
            }}
            onAsk={props.onAskLocus ? askLocus : undefined}
            onBrief={
              props.onBriefCite &&
              selected.length === 1 &&
              selectedObj?.type === "card" &&
              (selectedObj.cite?.kind === "jira" || selectedObj.cite?.kind === "linear") &&
              selectedObj.cite
                ? () => {
                    if (selectedObj.cite) props.onBriefCite?.(selectedObj.cite);
                  }
                : undefined
            }
          />
        ) : null}
        {overlay && overlayShapeOpen && selectedObj?.type === "shape" ? (
          <div
            className="board-shape-overlay"
            style={{
              left: overlay!.left,
              top: overlay!.top + overlay!.height + 12,
            }}
          >
            <BoardShapePicker
              value={selectedObj.shape}
              onPick={(kind) => {
                upsert({ ...selectedObj, shape: kind });
                setPendingShape(kind);
                setOverlayShapeOpen(false);
              }}
              onClose={() => setOverlayShapeOpen(false)}
            />
          </div>
        ) : null}
      </div>
      {ctxMenu ? (
        <BoardContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          hasSelection={selected.length > 0}
          multi={selected.length > 1}
          canDistribute={selected.length > 2}
          isFrame={selectedObj?.type === "frame"}
          canStack={canStackStickies}
          canUnstack={canUnstackStickies}
          onClose={() => setCtxMenu(null)}
          onDuplicate={() => {
            duplicateSelected();
            setCtxMenu(null);
          }}
          onCopy={() => {
            copySelected();
            setCtxMenu(null);
          }}
          onDelete={() => {
            removeSelected();
            setCtxMenu(null);
          }}
          onLayer={layerSelected}
          onAlign={alignSelected}
          onDistribute={distributeSelected}
          onFrame={frameSelected}
          onStack={stackSelected}
          onUnstack={unstackSelected}
          onComment={() => {
            if (selected[0]) {
              setCommentFor(selected[0]);
              setCommentBody("");
            }
            setCtxMenu(null);
          }}
          onEdit={() => {
            if (!selectedObj || selectedObj.type === "connector") return;
            setEditing(selectedObj.id);
            setDraft(selectedObj.text ?? "");
            setCtxMenu(null);
          }}
          onFit={() => {
            const ids = objects.filter((row) => selected.includes(row.id));
            if (ids.length) fitTo(ids);
            setCtxMenu(null);
          }}
          onRun={() => {
            if (selectedObj?.type === "frame") setRunOpen(selectedObj.id);
            setCtxMenu(null);
          }}
          onPinPlan={
            props.onPinPlan
              ? () => {
                  if (selectedObj?.type === "frame") setPinPlanOpen(selectedObj.id);
                  setCtxMenu(null);
                }
              : undefined
          }
          onAsk={props.onAskLocus ? askLocus : undefined}
        />
      ) : null}
      {commentFor ? (
        <form
          className="board-pop"
          onSubmit={(event) => {
            event.preventDefault();
            void submitComment();
          }}
        >
          <p>Comment</p>
          <textarea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} />
          <div className="board-pop-actions">
            <button type="button" className="btn ghost" onClick={() => setCommentFor(null)}>
              Cancel
            </button>
            <button type="submit" className="btn primary">
              Pin
            </button>
          </div>
        </form>
      ) : null}
      {cardOpen ? <CardPicker onClose={() => setCardOpen(false)} onPick={addCard} /> : null}
      {runOpen ? (
        <div className="board-pop">
          <p>Run this frame</p>
          <div className="board-pop-actions">
            {(["agent", "design", "plan"] as BoardRunTarget[]).map((target) => (
              <button
                key={target}
                type="button"
                className="btn"
                onClick={() => {
                  props.onRunFrame(runOpen, target);
                  setRunOpen(null);
                }}
              >
                {target}
              </button>
            ))}
            <button type="button" className="btn ghost" onClick={() => setRunOpen(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {pinPlanOpen ? (
        <div className="board-pop" data-testid="board-pin-plan">
          <p>Pin /plan onto this frame</p>
          <div className="board-pop-actions board-pin-plan-list">
            {state.sessions
              .filter((row) => row.plan?.items?.length)
              .slice(0, 12)
              .map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="btn"
                  onClick={() => {
                    props.onPinPlan?.(pinPlanOpen, row.id);
                    setPinPlanOpen(null);
                  }}
                >
                  {row.title}
                </button>
              ))}
            {!state.sessions.some((row) => row.plan?.items?.length) ? (
              <p className="hint">
                No sessions with a plan yet. Run a frame as plan, or Accept a /plan first.
              </p>
            ) : null}
            <button type="button" className="btn ghost" onClick={() => setPinPlanOpen(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {presentIndex != null ? (
        <p className="board-present-hint hint" data-testid="board-present-hint">
          Presenting frame {presentIndex + 1} · J / K next/prev
        </p>
      ) : null}
      <CommentList comments={props.board.comments} onResolve={(id) => void resolveComment(id)} />
    </div>
  );
}

function BoardMermaidFace({ source }: { source: string }) {
  const svg = mermaidSvg(source);
  if (svg) {
    return (
      <div
        className="board-mermaid-face"
        data-testid="board-mermaid"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  return <pre className="board-mermaid-source">{source || "Mermaid"}</pre>;
}

function CardFace(props: { obj: BoardObject; ctx: BoardCiteLiveContext }) {
  const live = props.obj.cite ? boardCitePresentation(props.obj.cite, props.ctx) : null;
  return (
    <>
      <span className="board-card-kind">
        {props.obj.cite?.kind ?? "card"}
        {live?.stale ? " · stale" : ""}
      </span>
      <span className="board-obj-text">{live?.label || props.obj.text || ""}</span>
      {live?.detail ? <span className="board-card-detail">{live.detail}</span> : null}
    </>
  );
}

function OverlayBtn(props: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`board-overlay-btn${props.danger ? " danger" : ""}${props.accent ? " ask" : ""}`}
      title={props.title}
      aria-label={props.title}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function SelectionOverlay(props: {
  box: { left: number; top: number; width: number; height: number };
  size: { w: number; h: number };
  selected?: BoardObject;
  multi?: boolean;
  onResizeStart: (event: ReactPointerEvent, handle: BoardResizeHandle) => void;
  onPortStart: (event: ReactPointerEvent, port: BoardPort) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onComment: () => void;
  onLayer: (op: BoardLayerOp) => void;
  onFrame?: () => void;
  onStack?: () => void;
  onUnstack?: () => void;
  stackCount?: number;
  onColor: (color: (typeof STICKY_COLORS)[number]) => void;
  onFontSize?: (dir: 1 | -1) => void;
  onShape?: () => void;
  onAsk?: (action: BoardAiActionId) => void;
  onBrief?: () => void;
}) {
  const sticky = props.selected?.type === "sticky";
  const ink = props.selected?.type === "ink";
  const connector = props.selected?.type === "connector" && !props.multi;
  const canFont =
    props.selected &&
    (props.selected.type === "sticky" ||
      props.selected.type === "text" ||
      props.selected.type === "shape");
  const shape = props.selected?.type === "shape";
  const barBelow = props.box.top < 56;
  const ports =
    !props.multi &&
    props.selected &&
    props.selected.type !== "frame" &&
    props.selected.type !== "connector" &&
    props.selected.type !== "ink";
  return (
    <div
      className="board-overlay"
      style={{
        left: props.box.left,
        top: props.box.top,
        width: props.box.width,
        height: props.box.height,
      }}
    >
      {!connector
        ? BOARD_RESIZE_HANDLES.filter((handle) => !ports || handle.length === 2).map((handle) => (
            <button
              key={handle}
              type="button"
              className={`board-resize ${handle}`}
              aria-label={`Resize ${handle}`}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                props.onResizeStart(event, handle);
              }}
            />
          ))
        : null}
      {ports
        ? BOARD_PORTS.map((port) => (
            <button
              key={port}
              type="button"
              className={`board-port ${port}`}
              aria-label={`Connect ${port}`}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                props.onPortStart(event, port);
              }}
            />
          ))
        : null}
      <div
        className={`board-overlay-bar${barBelow ? " below" : ""}`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="board-overlay-size">
          {connector
            ? "Connector"
            : props.stackCount
              ? `Stack · ${props.stackCount}`
              : `${Math.round(props.size.w)} × ${Math.round(props.size.h)}`}
        </span>
        {canFont ? (
          <>
            <OverlayBtn title="Smaller text" onClick={() => props.onFontSize?.(-1)}>
              A−
            </OverlayBtn>
            <OverlayBtn title="Larger text" onClick={() => props.onFontSize?.(1)}>
              A+
            </OverlayBtn>
          </>
        ) : null}
        {shape && props.onShape ? (
          <OverlayBtn title="Change shape" onClick={props.onShape}>
            ◇
          </OverlayBtn>
        ) : null}
        {props.onFrame ? (
          <OverlayBtn title="Frame selection" onClick={props.onFrame}>
            <IconFrame />
          </OverlayBtn>
        ) : null}
        {props.onStack ? (
          <OverlayBtn title="Stack stickies" onClick={props.onStack}>
            <IconStack />
          </OverlayBtn>
        ) : null}
        {props.onUnstack ? (
          <OverlayBtn title="Unstack" onClick={props.onUnstack}>
            <IconStack />
          </OverlayBtn>
        ) : null}
        {props.onAsk ? (
          <>
            <OverlayBtn title="Ask Locus" accent onClick={() => props.onAsk?.("ask")}>
              <IconTaskBurst />
            </OverlayBtn>
            {sticky ? (
              <OverlayBtn title="Cluster stickies" onClick={() => props.onAsk?.("cluster")}>
                <IconCluster />
              </OverlayBtn>
            ) : null}
            {props.onBrief ? (
              <OverlayBtn title="Brief from brain" onClick={props.onBrief}>
                Brief
              </OverlayBtn>
            ) : null}
            <OverlayBtn title="Summarize into a sticky" onClick={() => props.onAsk?.("summarize")}>
              <IconTaskList />
            </OverlayBtn>
            <span className="board-overlay-sep" />
          </>
        ) : null}
        {sticky || ink
          ? STICKY_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`board-swatch color-${color}`}
                aria-label={color}
                title={color}
                onClick={() => props.onColor(color)}
              />
            ))
          : null}
        {sticky || ink ? <span className="board-overlay-sep" /> : null}
        <OverlayBtn title="Duplicate" onClick={props.onDuplicate}>
          <IconClone />
        </OverlayBtn>
        <OverlayBtn title="Comment" onClick={props.onComment}>
          <IconChat />
        </OverlayBtn>
        <OverlayBtn title="Bring to front" onClick={() => props.onLayer("front")}>
          <IconLayerFront />
        </OverlayBtn>
        <OverlayBtn title="Send to back" onClick={() => props.onLayer("back")}>
          <IconLayerBack />
        </OverlayBtn>
        <OverlayBtn title="Delete" danger onClick={props.onDelete}>
          <IconClose />
        </OverlayBtn>
      </div>
    </div>
  );
}

function BoardContextMenu(props: {
  x: number;
  y: number;
  hasSelection: boolean;
  multi: boolean;
  canDistribute: boolean;
  isFrame: boolean;
  canStack: boolean;
  canUnstack: boolean;
  onClose: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onLayer: (op: BoardLayerOp) => void;
  onAlign: (op: BoardAlignOp) => void;
  onDistribute: (axis: BoardDistributeOp) => void;
  onFrame: () => void;
  onStack: () => void;
  onUnstack: () => void;
  onComment: () => void;
  onEdit: () => void;
  onFit: () => void;
  onRun: () => void;
  onPinPlan?: () => void;
  onAsk?: (action: BoardAiActionId) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const menu = root.current;
    if (!menu) return;
    const origin = fixedContainingOrigin(menu);
    const rect = menu.getBoundingClientRect();
    const next = placePointerMenu({
      x: props.x,
      y: props.y,
      pop: {
        width: rect.width > 0 ? rect.width : 220,
        height: rect.height > 0 ? rect.height : 1,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      origin,
    });
    setPlace((cur) => (cur && cur.left === next.left && cur.top === next.top ? cur : next));
  }, [props.x, props.y]);

  const menu = (
    <>
      <button
        type="button"
        className="board-ctx-backdrop"
        aria-label="Close menu"
        onPointerDown={props.onClose}
      />
      <div
        ref={root}
        className="menu-pop board-ctx"
        role="menu"
        aria-label="Board"
        style={{ left: place?.left ?? props.x, top: place?.top ?? props.y }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {props.onAsk
          ? BOARD_AI_ACTIONS.map((row) => (
              <MenuItem key={row.id} onClick={() => props.onAsk?.(row.id)}>
                {row.label}
              </MenuItem>
            ))
          : null}
        {props.onAsk ? <MenuSep /> : null}
        <MenuItem disabled={!props.hasSelection} onClick={props.onDuplicate}>
          Duplicate
        </MenuItem>
        <MenuItem disabled={!props.hasSelection} onClick={props.onCopy}>
          Copy
        </MenuItem>
        <MenuItem danger disabled={!props.hasSelection} onClick={props.onDelete}>
          Delete
        </MenuItem>
        <MenuSep />
        <MenuLabel>Layer</MenuLabel>
        <MenuItem disabled={!props.hasSelection} onClick={() => props.onLayer("front")}>
          Bring to front
        </MenuItem>
        <MenuItem disabled={!props.hasSelection} onClick={() => props.onLayer("forward")}>
          Bring forward
        </MenuItem>
        <MenuItem disabled={!props.hasSelection} onClick={() => props.onLayer("backward")}>
          Send backward
        </MenuItem>
        <MenuItem disabled={!props.hasSelection} onClick={() => props.onLayer("back")}>
          Send to back
        </MenuItem>
        <MenuSep />
        <MenuLabel>Align</MenuLabel>
        {BOARD_ALIGN_OPS.map((op) => (
          <MenuItem key={op} disabled={!props.multi} onClick={() => props.onAlign(op)}>
            Align {op}
          </MenuItem>
        ))}
        {BOARD_DISTRIBUTE_OPS.map((axis) => (
          <MenuItem
            key={axis}
            disabled={!props.canDistribute}
            onClick={() => props.onDistribute(axis)}
          >
            Distribute {axis}
          </MenuItem>
        ))}
        <MenuItem disabled={!props.multi} onClick={props.onFrame}>
          Frame selection
        </MenuItem>
        <MenuItem disabled={!props.canStack} onClick={props.onStack}>
          Stack stickies
        </MenuItem>
        <MenuItem disabled={!props.canUnstack} onClick={props.onUnstack}>
          Unstack
        </MenuItem>
        <MenuSep />
        <MenuItem disabled={!props.hasSelection} onClick={props.onEdit}>
          Edit
        </MenuItem>
        <MenuItem disabled={!props.hasSelection} onClick={props.onComment}>
          Comment
        </MenuItem>
        <MenuItem disabled={!props.hasSelection} onClick={props.onFit}>
          Zoom to selection
        </MenuItem>
        {props.isFrame ? <MenuItem onClick={props.onRun}>Run this frame</MenuItem> : null}
        {props.isFrame && props.onPinPlan ? (
          <MenuItem onClick={props.onPinPlan}>Pin /plan onto frame</MenuItem>
        ) : null}
      </div>
    </>
  );

  return createPortal(menu, document.body);
}

function CommentList(props: { comments: BoardComment[]; onResolve: (id: string) => void }) {
  const open = props.comments.filter((row) => !row.resolved);
  if (!open.length) return null;
  return (
    <ul className="board-comments">
      {open.slice(-4).map((row) => (
        <li key={row.id}>
          <strong>{row.author}</strong> {row.body}
          <button type="button" className="btn ghost small" onClick={() => props.onResolve(row.id)}>
            Resolve
          </button>
        </li>
      ))}
    </ul>
  );
}

function CardPicker(props: { onClose: () => void; onPick: (cite: BoardCite) => void }) {
  const { state } = useStore();
  const kinds: { kind: BoardCiteKind; label: string }[] = [
    { kind: "agent", label: "Agent" },
    { kind: "design", label: "Design" },
    { kind: "pull", label: "Pull request" },
    { kind: "slack", label: "Slack" },
    { kind: "file", label: "File" },
    { kind: "automation", label: "Automation" },
    { kind: "jira", label: "Jira" },
    { kind: "linear", label: "Linear" },
    { kind: "brain", label: "Brain" },
  ];
  const [kind, setKind] = useState<BoardCiteKind>("agent");
  const [custom, setCustom] = useState("");
  const [repoId, setRepoId] = useState(state.repos[0]?.id ?? "");
  const [pulls, setPulls] = useState<{ number: number; title: string; repoId: string }[]>([]);
  const [brainNodes, setBrainNodes] = useState<{ id: string; name: string; type?: string }[]>([]);

  useEffect(() => {
    if (kind !== "brain") {
      setBrainNodes([]);
      return;
    }
    let cancelled = false;
    void api.brain().then(
      (doc) => {
        if (!cancelled) {
          setBrainNodes(
            doc.nodes.slice(0, 24).map((row) => ({
              id: row.id,
              name: row.name,
              type: row.type,
            })),
          );
        }
      },
      () => {
        if (!cancelled) setBrainNodes([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [kind]);

  useEffect(() => {
    if (kind !== "pull" || !repoId) {
      setPulls([]);
      return;
    }
    let cancelled = false;
    void api.repoPulls(repoId, "open").then(
      (rows) => {
        if (!cancelled) {
          setPulls(
            rows.slice(0, 12).map((row) => ({
              repoId,
              number: row.number,
              title: `${row.title} #${row.number}`,
            })),
          );
        }
      },
      () => {
        if (!cancelled) setPulls([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [kind, repoId]);

  const options = useMemo(() => {
    if (kind === "agent")
      return state.sessions
        .filter(
          (row) =>
            !row.archived && row.kind !== "design" && row.kind !== "board" && row.kind !== "ide",
        )
        .slice(0, 12)
        .map((row) => ({
          id: row.id,
          label: row.title,
          cite: { kind, sessionId: row.id, label: row.title } satisfies BoardCite,
        }));
    if (kind === "design")
      return state.sessions
        .filter((row) => row.kind === "design" && !row.archived)
        .slice(0, 12)
        .map((row) => ({
          id: row.id,
          label: row.title,
          cite: { kind, sessionId: row.id, label: row.title } satisfies BoardCite,
        }));
    if (kind === "automation")
      return state.automations.slice(0, 12).map((row) => ({
        id: row.id,
        label: row.name,
        cite: { kind, automationId: row.id, label: row.name } satisfies BoardCite,
      }));
    if (kind === "slack")
      return state.slackConversations.slice(0, 12).map((row) => ({
        id: row.id,
        label: row.name,
        cite: { kind, channelId: row.id, label: row.name } satisfies BoardCite,
      }));
    if (kind === "pull")
      return pulls.map((row) => ({
        id: `${row.repoId}:${row.number}`,
        label: row.title,
        cite: {
          kind,
          repoId: row.repoId,
          number: row.number,
          label: row.title,
        } satisfies BoardCite,
      }));
    if (kind === "brain")
      return brainNodes.map((row) => ({
        id: row.id,
        label: row.type ? `${row.name} · ${row.type}` : row.name,
        cite: { kind, nodeId: row.id, label: row.name } satisfies BoardCite,
      }));
    if (kind === "file") return [];
    if (kind === "jira" || kind === "linear") return [];
    return [];
  }, [kind, state.sessions, state.automations, state.slackConversations, pulls, brainNodes]);

  return (
    <div className="board-pop board-card-picker">
      <p>Pin a card</p>
      <div className="board-pop-actions">
        {kinds.map((row) => (
          <button
            key={row.kind}
            type="button"
            className={`btn ${kind === row.kind ? "primary" : "ghost"}`}
            onClick={() => setKind(row.kind)}
          >
            {row.label}
          </button>
        ))}
      </div>
      {kind === "pull" && state.repos.length ? (
        <Select
          compact
          ariaLabel="Repository"
          value={repoId}
          options={state.repos.map((row) => ({ value: row.id, label: row.name }))}
          onChange={setRepoId}
        />
      ) : null}
      <ul className="board-card-list">
        {options.map((row) => (
          <li key={row.id}>
            <button type="button" onClick={() => props.onPick(row.cite)}>
              {row.label}
            </button>
          </li>
        ))}
      </ul>
      {kind === "file" ||
      kind === "jira" ||
      kind === "linear" ||
      kind === "pull" ||
      kind === "brain" ? (
        <form
          className="board-pop-actions"
          onSubmit={(event) => {
            event.preventDefault();
            const value = custom.trim();
            if (!value) return;
            if (kind === "file") {
              props.onPick({ kind, path: value, label: value });
            } else if (kind === "jira" || kind === "linear") {
              props.onPick({ kind, key: value, label: value });
            } else if (kind === "brain") {
              props.onPick({ kind, nodeId: value, label: value });
            } else {
              const match = value.match(/(.+?)[#\s]+(\d+)$/);
              const repo = state.repos.find((row) => row.id === repoId) ?? state.repos[0];
              props.onPick({
                kind,
                repoId: repo?.id,
                number: match ? Number(match[2]) : Number(value) || 1,
                label: value,
              });
            }
            setCustom("");
          }}
        >
          <input
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            placeholder={
              kind === "file"
                ? "src/app.ts"
                : kind === "jira"
                  ? "OPS-12"
                  : kind === "linear"
                    ? "ENG-12"
                    : kind === "brain"
                      ? "service:billing-gateway"
                      : "repo #12"
            }
          />
          <button type="submit" className="btn primary">
            Pin
          </button>
        </form>
      ) : null}
      <button type="button" className="btn ghost" onClick={props.onClose}>
        Cancel
      </button>
    </div>
  );
}
