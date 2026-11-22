import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/** Gap between the trigger and the bubble, and the minimum margin to the window edge. */
const GAP = 6;
const EDGE = 8;

export type TooltipPlacement = { top: number; left: number; side: "top" | "bottom" };

/**
 * Where a bubble of `size` goes for a trigger at `anchor`: above when it fits, otherwise
 * below (whichever side has more room when neither fits), centred and clamped inside the
 * viewport so it never runs off an edge.
 */
export function placeTooltip(
  anchor: { top: number; bottom: number; left: number; right: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): TooltipPlacement {
  const roomAbove = anchor.top - GAP - EDGE;
  const roomBelow = viewport.height - anchor.bottom - GAP - EDGE;
  const side =
    size.height <= roomAbove
      ? "top"
      : size.height <= roomBelow || roomBelow > roomAbove
        ? "bottom"
        : "top";
  const rawTop = side === "top" ? anchor.top - GAP - size.height : anchor.bottom + GAP;
  const top = Math.max(EDGE, Math.min(rawTop, viewport.height - EDGE - size.height));
  const center = (anchor.left + anchor.right) / 2;
  const maxLeft = Math.max(EDGE, viewport.width - EDGE - size.width);
  const left = Math.max(EDGE, Math.min(center - size.width / 2, maxLeft));
  return { top: Math.round(top), left: Math.round(left), side };
}

/** True when the trigger already shows the tooltip's words, so the bubble would only echo it. */
function repeatsVisibleText(wrap: HTMLElement | null): boolean {
  const target = wrap?.firstElementChild as HTMLElement | null | undefined;
  const bubble = wrap?.querySelector(".ui-tooltip-bubble");
  if (!target || !bubble) return false;
  const norm = (value: string | null | undefined) =>
    (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const shown = norm(target.innerText ?? target.textContent);
  return shown !== "" && shown === norm(bubble.textContent);
}

/**
 * Themed hover/focus label. Sets aria-label on the child when it has none.
 *
 * The visible bubble is portalled to <body> with fixed coordinates, so a scrolling list,
 * a clipped side panel or a glass pane cannot cut it off, and it flips below triggers that
 * sit at the top of the window. The in-place `role="tooltip"` node stays as the accessible
 * description; Escape dismisses the bubble (WCAG 1.4.13).
 */
export function Tooltip(props: { label: string; disabledReason?: string; children: ReactNode }) {
  const child = props.children;
  const childProps = isValidElement(child)
    ? (child.props as { "aria-label"?: string; "aria-describedby"?: string; disabled?: boolean })
    : null;
  const disabled = Boolean(childProps?.disabled);
  const text = disabled && props.disabledReason ? props.disabledReason : props.label;
  const id = useId();
  const describedBy =
    childProps?.["aria-label"] && text !== childProps["aria-label"] ? id : undefined;
  const labeled = isValidElement(child)
    ? cloneElement(child as ReactElement<{ "aria-label"?: string; "aria-describedby"?: string }>, {
        ...(childProps?.["aria-label"] ? {} : { "aria-label": text }),
        ...(describedBy
          ? {
              "aria-describedby": [childProps?.["aria-describedby"], describedBy]
                .filter(Boolean)
                .join(" "),
            }
          : {}),
      })
    : child;

  const wrapRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<TooltipPlacement | null>(null);
  const hovered = useRef(false);
  const focused = useRef(false);

  const sync = useCallback(() => {
    const wrap = wrapRef.current;
    // An open menu inside the trigger owns the space; the label would sit on top of it.
    const menuOpen = Boolean(wrap?.querySelector("details[open]"));
    const next = (hovered.current || focused.current) && !menuOpen && !repeatsVisibleText(wrap);
    setOpen(next);
    if (!next) setPlace(null);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current;
    const bubble = bubbleRef.current;
    if (!wrap || !bubble) return;
    const target = (wrap.firstElementChild as HTMLElement | null) ?? wrap;
    const anchor = target.getBoundingClientRect();
    const size = bubble.getBoundingClientRect();
    setPlace(placeTooltip(anchor, size, { width: window.innerWidth, height: window.innerHeight }));
  }, [open, text]);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      hovered.current = false;
      focused.current = false;
      sync();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    // `toggle` does not bubble, so a menu opening inside the trigger is caught in capture.
    const onToggle = (event: Event) => {
      if (wrapRef.current?.contains(event.target as Node)) sync();
    };
    document.addEventListener("toggle", onToggle, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("toggle", onToggle, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, sync]);

  return (
    <span
      ref={wrapRef}
      className={`ui-tooltip${disabled ? " is-disabled" : ""}`}
      onPointerEnter={(event) => {
        if (event.pointerType === "touch") return;
        hovered.current = true;
        sync();
      }}
      onPointerLeave={() => {
        hovered.current = false;
        sync();
      }}
      onPointerDown={() => {
        hovered.current = false;
        focused.current = false;
        sync();
      }}
      onFocus={(event) => {
        // `:focus-visible`, not any focus: menus hand focus back to their trigger after a
        // mouse pick, which would otherwise pin the bubble open.
        focused.current = (event.target as HTMLElement).matches?.(":focus-visible") ?? false;
        sync();
      }}
      onBlur={() => {
        focused.current = false;
        sync();
      }}
    >
      {labeled}
      <span className="ui-tooltip-bubble" role="tooltip" id={id}>
        {text}
      </span>
      {open && typeof document !== "undefined"
        ? createPortal(
            <span
              ref={bubbleRef}
              className={`ui-tooltip-float${place ? ` is-placed side-${place.side}` : ""}`}
              aria-hidden="true"
              style={place ? { top: place.top, left: place.left } : undefined}
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
