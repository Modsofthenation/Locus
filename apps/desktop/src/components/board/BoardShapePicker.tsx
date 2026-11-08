import { BOARD_SHAPE_GROUPS, boardShapePath, type BoardShapeKind } from "@locus/shared";
import { useRef, type ReactNode } from "react";
import { useDialogFocus } from "@/lib/useDialogFocus";

export function BoardShapeGlyph(props: { kind: BoardShapeKind; title?: string }) {
  return (
    <svg
      className="board-shape-glyph"
      viewBox="0 0 100 100"
      aria-hidden={props.title ? undefined : true}
      role={props.title ? "img" : undefined}
    >
      {props.title ? <title>{props.title}</title> : null}
      <path d={boardShapePath(props.kind)} />
    </svg>
  );
}

export function BoardShapeFace(props: { kind?: BoardShapeKind; children: ReactNode }) {
  return (
    <>
      <svg className="board-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <path d={boardShapePath(props.kind ?? "rect")} />
      </svg>
      <div className="board-shape-label">{props.children}</div>
    </>
  );
}

export function BoardShapePicker(props: {
  value?: BoardShapeKind;
  onPick: (kind: BoardShapeKind) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, props.onClose, dialogRef);
  return (
    <div
      className="board-shape-pop"
      role="dialog"
      aria-modal="true"
      aria-label="Shapes"
      ref={dialogRef}
    >
      <div className="board-shape-pop-head">
        <p>Shapes</p>
        <button type="button" className="btn ghost small" onClick={props.onClose}>
          Close
        </button>
      </div>
      {BOARD_SHAPE_GROUPS.map((group) => (
        <section key={group.label} className="board-shape-group">
          <h4>{group.label}</h4>
          <div className="board-shape-grid">
            {group.kinds.map((kind) => (
              <button
                key={kind}
                type="button"
                className={props.value === kind ? "active" : ""}
                title={kind}
                aria-label={kind}
                aria-pressed={props.value === kind}
                onClick={() => props.onPick(kind)}
              >
                <BoardShapeGlyph kind={kind} />
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
