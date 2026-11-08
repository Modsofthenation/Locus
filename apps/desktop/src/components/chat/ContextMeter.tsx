import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  contextFillLevel,
  contextPartMeta,
  contextSnapshot,
  formatCompactNotice,
  formatContextPercent,
  formatContextUsage,
  formatTokenCount,
  visibleContextParts,
  type AgentSession,
} from "@locus/shared";
import { IconClose } from "@/components/layout/Icons";
import { useDialogFocus } from "@/lib/useDialogFocus";
import {
  fixedContainingOrigin,
  placeMenuPop,
  type PopBox,
  type PopOrigin,
} from "@/components/layout/OverflowMenu";

/** Stable card width so placement does not use a clipped getBoundingClientRect. */
export const CONTEXT_POP_WIDTH = 260;
const CONTEXT_POP_INSET = 16;

export function contextPopWidth(viewportWidth: number, card = CONTEXT_POP_WIDTH): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return card;
  return Math.max(0, Math.min(card, viewportWidth - CONTEXT_POP_INSET));
}

export function placeContextPop(opts: {
  trigger: PopBox;
  popHeight: number;
  viewport: { width: number; height: number };
  pane?: PopBox & { width: number };
  origin?: PopOrigin;
}): { up: boolean; top: number; left: number; width: number } {
  const width = contextPopWidth(
    Math.min(opts.viewport.width, opts.pane?.width ?? opts.viewport.width),
  );
  return {
    ...placeMenuPop({
      trigger: opts.trigger,
      pop: { width, height: opts.popHeight },
      viewport: opts.viewport,
      bounds: opts.pane,
      origin: opts.origin,
      align: "left",
      prefer: "up",
    }),
    width,
  };
}

export function ContextMeter(props: {
  session: Pick<AgentSession, "model" | "context" | "charsPerToken" | "lastCompact" | "usage">;
  kind?: string;
  baseUrl?: string;
  canClear?: boolean;
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{
    up: boolean;
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useDialogFocus(open, () => setOpen(false), pop);
  const chip = useRef<HTMLButtonElement>(null);
  const breakdown = contextSnapshot({
    model: props.session.model,
    kind: props.kind,
    baseUrl: props.baseUrl,
    context: props.session.context,
    charsPerToken: props.session.charsPerToken,
  });
  const level = contextFillLevel(breakdown.used, breakdown.window);
  const parts = visibleContextParts(breakdown.parts);
  const percent = formatContextPercent(breakdown.used, breakdown.window);
  const usage = formatContextUsage(breakdown.used, breakdown.window, {
    measured: breakdown.measured,
  });
  const cachedTokens = breakdown.cachedInputTokens ?? props.session.usage?.cachedInputTokens;

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    function relayout() {
      const menu = pop.current;
      const trigger = chip.current;
      if (!menu || !trigger) {
        setPlace(null);
        return;
      }
      const paneEl = trigger.closest(".chat");
      const paneRect = paneEl?.getBoundingClientRect();
      setPlace(
        placeContextPop({
          trigger: trigger.getBoundingClientRect(),
          popHeight: menu.offsetHeight,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          pane: paneRect
            ? {
                top: paneRect.top,
                left: paneRect.left,
                right: paneRect.right,
                bottom: paneRect.bottom,
                width: paneRect.width,
              }
            : undefined,
          origin: fixedContainingOrigin(menu),
        }),
      );
    }
    relayout();
    window.addEventListener("resize", relayout);
    window.addEventListener("scroll", relayout, true);
    const pane = chip.current?.closest(".chat");
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            relayout();
          })
        : null;
    if (observer) {
      if (chip.current) observer.observe(chip.current);
      if (pane) observer.observe(pane);
    }
    return () => {
      window.removeEventListener("resize", relayout);
      window.removeEventListener("scroll", relayout, true);
      observer?.disconnect();
    };
  }, [open, parts.length, percent, usage, cachedTokens, props.session.lastCompact]);

  const width =
    place?.width ??
    contextPopWidth(typeof window === "undefined" ? CONTEXT_POP_WIDTH : window.innerWidth);
  if (percent === "0%") return null;

  const popStyle: CSSProperties = {
    position: "fixed",
    width,
    minWidth: width,
    maxWidth: `calc(100vw - ${CONTEXT_POP_INSET}px)`,
    right: "auto",
    bottom: "auto",
    height: "auto",
    ...(place
      ? { top: place.top, left: place.left, visibility: "visible" }
      : { top: 0, left: 0, visibility: "hidden" }),
  };

  return (
    <div className={`context-meter ${level}${place?.up ? " up" : ""}`} ref={root}>
      <button
        ref={chip}
        type="button"
        className="context-meter-chip"
        aria-label="Context usage"
        aria-expanded={open}
        title="Context window"
        onClick={() => setOpen((value) => !value)}
      >
        <ContextBar parts={parts} window={breakdown.window} />
        <span className="context-meter-label">{percent} context</span>
      </button>
      {open ? (
        <div
          ref={pop}
          className={`context-meter-pop${place ? " placed" : ""}`}
          role="dialog"
          aria-label="Context breakdown"
          style={popStyle}
        >
          <div className="context-meter-pop-head">
            <strong>Context</strong>
            <button
              type="button"
              className="context-meter-close"
              aria-label="Close context breakdown"
              onClick={() => setOpen(false)}
            >
              <IconClose />
            </button>
          </div>
          <div className="context-meter-summary">
            <span>{percent} Full</span>
            <span>{usage}</span>
          </div>
          {cachedTokens ? (
            <p className="context-meter-cache" data-testid="context-cache">
              Cache {formatTokenCount(cachedTokens)}
            </p>
          ) : null}
          {props.session.lastCompact ? (
            <p className="context-meter-cache" data-testid="context-compact">
              {formatCompactNotice(props.session.lastCompact)}
            </p>
          ) : null}
          <ContextBar parts={parts} window={breakdown.window} large />
          {parts.length ? (
            <ul>
              {parts.map((part) => {
                const meta = contextPartMeta(part.id);
                return (
                  <li key={part.id}>
                    <span className="context-meter-swatch" style={{ background: meta.color }} />
                    <span className="context-meter-part-label">{meta.label}</span>
                    <span className="context-meter-part-tokens">
                      {formatTokenCount(part.tokens)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="context-meter-empty">No prompt tokens yet</p>
          )}
          {props.canClear && props.onClear ? (
            <button
              type="button"
              className="btn small ghost context-meter-clear"
              onClick={() => {
                setOpen(false);
                props.onClear?.();
              }}
            >
              Clear chat
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ContextBar(props: {
  parts: { id: string; tokens: number }[];
  window: number;
  large?: boolean;
}) {
  const window = Math.max(1, props.window);
  return (
    <span className={`context-meter-bar${props.large ? " large" : ""}`} aria-hidden="true">
      {props.parts.map((part) => (
        <span
          key={part.id}
          className="context-meter-seg"
          style={{
            width: `${(part.tokens / window) * 100}%`,
            background: contextPartMeta(part.id).color,
          }}
        />
      ))}
    </span>
  );
}
