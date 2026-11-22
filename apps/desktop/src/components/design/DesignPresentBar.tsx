import type { DesignVariant } from "@locus/shared";

/** Floating controls over a presented design: variant stepper and exit. */
export function PresentBar(props: {
  variants: DesignVariant[];
  activeId?: string | null;
  onStep: (dir: 1 | -1) => void;
  onExit: () => void;
}) {
  const { variants } = props;
  const at = variants.findIndex((row) => row.id === props.activeId);
  const current = at >= 0 ? variants[at] : undefined;
  return (
    <div className="design-present-bar" role="toolbar" aria-label="Presentation">
      {variants.length > 1 ? (
        <>
          <button
            type="button"
            className="btn small ghost"
            aria-label="Previous variant"
            title="Previous variant (←)"
            onClick={() => props.onStep(-1)}
          >
            ‹
          </button>
          <span className="design-present-count" aria-live="polite">
            {current ? `${current.name} · ` : ""}
            {at >= 0 ? at + 1 : "–"} / {variants.length}
          </span>
          <button
            type="button"
            className="btn small ghost"
            aria-label="Next variant"
            title="Next variant (→)"
            onClick={() => props.onStep(1)}
          >
            ›
          </button>
        </>
      ) : null}
      <button type="button" className="btn small ghost" onClick={props.onExit}>
        Exit · Esc
      </button>
    </div>
  );
}
