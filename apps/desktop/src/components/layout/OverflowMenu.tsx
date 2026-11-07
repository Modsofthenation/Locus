import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { IconMore } from "./Icons";

const MENU_GAP = 6;
const MENU_PAD = 8;

const MenuCloser = createContext<(() => void) | null>(null);

export type PopBox = { top: number; left: number; right: number; bottom: number };
export type PopOrigin = { top: number; left: number };

const FIXED_CB_WILL_CHANGE = new Set(["transform", "filter", "perspective", "backdrop-filter"]);

function styleCreatesFixedContainingBlock(style: CSSStyleDeclaration): boolean {
  if (style.transform !== "none" && style.transform !== "") return true;
  if (style.filter !== "none" && style.filter !== "") return true;
  if (style.perspective !== "none" && style.perspective !== "") return true;
  const backdrop = style.backdropFilter || style.getPropertyValue("backdrop-filter");
  if (backdrop && backdrop !== "none") return true;
  if (/\b(paint|layout|strict|content)\b/.test(style.contain)) return true;
  return style.willChange.split(",").some((value) => FIXED_CB_WILL_CHANGE.has(value.trim()));
}

/** Viewport-space origin of the containing block for `position: fixed` (window if none). */
export function fixedContainingOrigin(
  el: Element | null,
): PopOrigin & { width: number; height: number } {
  let node = el?.parentElement ?? null;
  while (node && node !== document.body && node !== document.documentElement) {
    if (styleCreatesFixedContainingBlock(getComputedStyle(node))) {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    }
    node = node.parentElement;
  }
  return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
}

export function placeMenuPop(opts: {
  trigger: PopBox;
  pop: { width: number; height: number };
  viewport: { width: number; height: number };
  align: "left" | "right" | "after";
  gap?: number;
  prefer?: "up" | "down";
  /** Viewport-space rect to stay inside. Defaults to the viewport. */
  bounds?: PopBox;
  /** Subtract when `position: fixed` is relative to a transformed ancestor. */
  origin?: PopOrigin;
}): { up: boolean; top: number; left: number } {
  const gap = opts.gap ?? MENU_GAP;
  const originLeft = opts.origin?.left ?? 0;
  const originTop = opts.origin?.top ?? 0;
  const bounds = opts.bounds ?? {
    top: 0,
    left: 0,
    right: opts.viewport.width,
    bottom: opts.viewport.height,
  };
  const spaceBelow = bounds.bottom - opts.trigger.bottom - gap;
  const spaceAbove = opts.trigger.top - bounds.top - gap;
  const up = opts.prefer === "up" ? true : opts.pop.height > spaceBelow && spaceAbove > spaceBelow;
  // Side (after) menus sit next to the trigger — top-aligned, not below it.
  let top =
    opts.align === "after"
      ? opts.trigger.top
      : up
        ? opts.trigger.top - gap - opts.pop.height
        : opts.trigger.bottom + gap;
  let left =
    opts.align === "right"
      ? opts.trigger.right - opts.pop.width
      : opts.align === "after"
        ? opts.trigger.right + gap
        : opts.trigger.left;
  const minLeft = bounds.left + MENU_PAD;
  const maxLeft = Math.max(minLeft, bounds.right - opts.pop.width - MENU_PAD);
  left = Math.min(Math.max(minLeft, left), maxLeft);
  const minTop = bounds.top + MENU_PAD;
  const maxTop = Math.max(minTop, bounds.bottom - opts.pop.height - MENU_PAD);
  top = Math.min(Math.max(minTop, top), maxTop);
  return { up, top: top - originTop, left: left - originLeft };
}

/** Place a right-click menu at a pointer. `origin` subtracts a transformed ancestor. */
export function placePointerMenu(opts: {
  x: number;
  y: number;
  pop: { width: number; height: number };
  viewport: { width: number; height: number };
  origin?: PopOrigin;
}): { top: number; left: number } {
  const placed = placeMenuPop({
    trigger: { top: opts.y, bottom: opts.y, left: opts.x, right: opts.x },
    pop: opts.pop,
    viewport: opts.viewport,
    origin: opts.origin,
    align: "left",
    gap: 0,
  });
  return { top: placed.top, left: placed.left };
}

export function OverflowMenu(props: {
  label?: ReactNode;
  title?: string;
  align?: "left" | "right" | "after";
  className?: string;
  toggleClassName?: string;
  wide?: boolean;
  prefer?: "up" | "down";
  onOpen?: () => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDetailsElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const popSize = useRef<{ width: number; height: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ up: boolean; top: number; left: number } | null>(null);
  const align = props.align === "left" ? "left" : props.align === "after" ? "after" : "right";
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const summary = root.current?.querySelector(":scope > summary");
    if (!summary) return;
    function suppressNativeToggle(event: Event) {
      event.preventDefault();
    }
    summary.addEventListener("click", suppressNativeToggle, true);
    return () => summary.removeEventListener("click", suppressNativeToggle, true);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      const node = event.target;
      if (!(node instanceof Node) || root.current?.contains(node)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      popSize.current = null;
      setPlace(null);
      return;
    }
    popSize.current = null;
    function relayout() {
      const el = root.current;
      const menu = pop.current;
      const summary = el?.querySelector(":scope > summary");
      if (!el?.open || !menu || !summary) {
        setPlace(null);
        return;
      }
      const origin = fixedContainingOrigin(menu);
      const rect = menu.getBoundingClientRect();
      if (!popSize.current && rect.width > 0 && rect.height > 0) {
        popSize.current = { width: rect.width, height: rect.height };
      }
      setPlace(
        placeMenuPop({
          trigger: summary.getBoundingClientRect(),
          pop: popSize.current ?? { width: rect.width, height: rect.height },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          origin,
          align,
          prefer: props.prefer,
        }),
      );
    }
    relayout();
    window.addEventListener("resize", relayout);
    window.addEventListener("scroll", relayout, true);
    return () => {
      window.removeEventListener("resize", relayout);
      window.removeEventListener("scroll", relayout, true);
    };
  }, [open, align, props.prefer, props.wide, props.children]);

  const popStyle: CSSProperties | undefined = place
    ? { top: place.top, left: place.left }
    : undefined;

  return (
    <MenuCloser.Provider value={close}>
      <details
        ref={root}
        className={`menu ${align}${place?.up ? " up" : ""}${props.className ? ` ${props.className}` : ""}`}
        open={open}
      >
        <summary
          className={props.toggleClassName ?? "btn small ghost menu-toggle"}
          title={props.title ?? "More"}
          aria-label={props.title ?? "More"}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={(event) => {
            // Native <details> in a flex toolbar (and React's open prop) can toggle
            // twice on one click, so the menu appears to open and immediately close.
            event.preventDefault();
            const next = !open;
            setOpen(next);
            if (next) props.onOpen?.();
          }}
        >
          {props.label ?? <IconMore />}
        </summary>
        <div
          ref={pop}
          className={`menu-pop ${props.wide ? "wide" : ""}${place ? " placed" : ""}`}
          role="menu"
          style={popStyle}
        >
          {props.children}
        </div>
      </details>
    </MenuCloser.Provider>
  );
}

export function MenuItem(props: {
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  active?: boolean;
  /** Toggle items — shows a check slot and uses menuitemcheckbox. */
  checked?: boolean;
  pressed?: boolean;
  testId?: string;
  title?: string;
  children: ReactNode;
}) {
  const close = useContext(MenuCloser);
  const toggle = props.checked !== undefined;
  const on = Boolean(props.checked ?? props.active);
  return (
    <button
      type="button"
      role={toggle ? "menuitemcheckbox" : "menuitem"}
      className={`menu-item${props.danger ? " danger" : ""}${on ? " active" : ""}${toggle ? " checkable" : ""}`}
      aria-current={!toggle && props.active ? "true" : undefined}
      aria-checked={toggle ? props.checked : undefined}
      aria-pressed={props.pressed}
      data-testid={props.testId}
      title={props.title}
      disabled={props.disabled}
      onClick={() => {
        close?.();
        props.onClick?.();
      }}
    >
      {toggle ? (
        <span className="menu-item-check" aria-hidden="true">
          {props.checked ? "✓" : ""}
        </span>
      ) : null}
      {props.children}
    </button>
  );
}

export function MenuSep() {
  return <div className="menu-sep" role="separator" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="menu-label" role="presentation">
      {children}
    </div>
  );
}
