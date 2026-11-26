import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  CHAT_SCROLL_MIN_THUMB,
  chatActiveTurn,
  chatNearestTick,
  chatScrollFromPointer,
  chatScrollGrabOffset,
  chatScrollOverflow,
  chatScrollThumb,
  chatTickMagnify,
  chatTickPositions,
  type ChatTurnMark,
} from "@/lib/chatScrollIndicator";

type IndicatorView = {
  show: boolean;
  y: number;
  height: number;
  now: number;
  active: number;
  trackHeight: number;
};

const HIDDEN: IndicatorView = {
  show: false,
  y: 0,
  height: CHAT_SCROLL_MIN_THUMB,
  now: 0,
  active: -1,
  trackHeight: 0,
};

/** Tick widths (px): resting and fully magnified under the pointer. The current turn is brighter, not wider. */
const TICK_BASE = 6;
const TICK_PEAK = 15;
function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

/** Gap (px) left above a prompt after jumping to it. */
const TICK_JUMP_INSET = 12;

export function ChatScrollIndicator(props: {
  threadRef: RefObject<HTMLDivElement | null>;
  revision: string;
  /** One mark per prompt; with 2+ the rail renders as turn ticks instead of a thumb. */
  marks?: ChatTurnMark[];
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const grab = useRef(0);
  const settle = useRef(0);
  const [view, setView] = useState<IndicatorView>(HIDDEN);
  const [hoverY, setHoverY] = useState<number | null>(null);
  const marks = props.marks ?? [];
  const ticked = marks.length >= 2;
  const marksRef = useRef(marks);
  marksRef.current = marks;

  useLayoutEffect(() => {
    const host = props.threadRef.current;
    if (!host) return;

    function paint() {
      const track = trackRef.current;
      if (!host || !track) return;
      const show = chatScrollOverflow(host.scrollHeight, host.clientHeight);
      const maxScroll = Math.max(0, host.scrollHeight - host.clientHeight);
      const now = maxScroll <= 0 ? 0 : Math.round((host.scrollTop / maxScroll) * 100);
      const active = chatActiveTurn(
        marksRef.current.map((mark) => mark.top),
        host,
      );
      const trackHeight = track.clientHeight;
      if (!show || trackHeight <= 0) {
        setView((prev) =>
          prev.show === show &&
          prev.now === now &&
          prev.y === 0 &&
          prev.active === active &&
          prev.trackHeight === trackHeight
            ? prev
            : { ...HIDDEN, show, now, active, trackHeight },
        );
        return;
      }
      const next = chatScrollThumb({
        scrollTop: host.scrollTop,
        clientHeight: host.clientHeight,
        scrollHeight: host.scrollHeight,
        trackHeight: track.clientHeight,
      });
      setView((prev) => {
        if (
          prev.show === show &&
          prev.y === next.y &&
          prev.height === next.height &&
          prev.now === now &&
          prev.active === active &&
          prev.trackHeight === trackHeight
        ) {
          return prev;
        }
        return { show, y: next.y, height: next.height, now, active, trackHeight };
      });
    }

    paint();
    const raf = requestAnimationFrame(paint);
    host.addEventListener("scroll", paint, { passive: true });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(paint) : null;
    ro?.observe(host);
    ro?.observe(trackRef.current ?? host);
    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener("scroll", paint);
      ro?.disconnect();
    };
  }, [props.threadRef, props.revision]);

  useLayoutEffect(() => () => cancelAnimationFrame(settle.current), []);

  const positions = ticked ? chatTickPositions(marks.length, view.trackHeight) : [];
  const hovered = hoverY === null ? -1 : chatNearestTick(positions, hoverY);

  function pointerInTrack(event: ReactPointerEvent<HTMLDivElement>): number | null {
    const track = trackRef.current;
    if (!track) return null;
    return event.clientY - track.getBoundingClientRect().top;
  }

  function jumpToTick(pointerY: number) {
    const host = props.threadRef.current;
    const idx = chatNearestTick(positions, pointerY);
    const mark = marks[idx];
    if (!host || !mark) return;
    host.scrollTop = Math.max(0, mark.top - TICK_JUMP_INSET);
    // Off-screen rows use estimated heights; once the prompt row paints, snap to its real top.
    cancelAnimationFrame(settle.current);
    let frames = 0;
    const align = () => {
      const row = host.querySelector<HTMLElement>(`[data-thread-row="${cssEscape(mark.id)}"]`);
      if (row) {
        const delta =
          row.getBoundingClientRect().top - host.getBoundingClientRect().top - TICK_JUMP_INSET;
        if (Math.abs(delta) > 1) host.scrollTop += delta;
      }
      if (++frames < 4) settle.current = requestAnimationFrame(align);
    };
    settle.current = requestAnimationFrame(align);
  }

  function scrollTo(event: ReactPointerEvent<HTMLDivElement>) {
    const host = props.threadRef.current;
    const track = trackRef.current;
    if (!host || !track) return;
    const pointerY = event.clientY - track.getBoundingClientRect().top;
    if (ticked) {
      jumpToTick(pointerY);
      return;
    }
    host.scrollTop = chatScrollFromPointer({
      pointerY,
      trackHeight: track.clientHeight,
      scrollHeight: host.scrollHeight,
      clientHeight: host.clientHeight,
      grabOffset: grab.current,
    });
  }

  return (
    <div
      className={`thread-scroll-indicator${view.show ? " is-visible" : ""}${ticked ? " has-ticks" : ""}`}
      data-testid="chat-scroll-indicator"
      role="scrollbar"
      aria-label="Chat position"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={view.now}
      aria-hidden={view.show ? "false" : "true"}
      onPointerDown={(event) => {
        const host = props.threadRef.current;
        const track = trackRef.current;
        if (!host || !track || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = true;
        const thumb = chatScrollThumb({
          scrollTop: host.scrollTop,
          clientHeight: host.clientHeight,
          scrollHeight: host.scrollHeight,
          trackHeight: track.clientHeight,
        });
        const pointerY = event.clientY - track.getBoundingClientRect().top;
        grab.current = chatScrollGrabOffset(pointerY, thumb.y, thumb.height);
        scrollTo(event);
      }}
      onPointerMove={(event) => {
        if (ticked && event.pointerType !== "touch") setHoverY(pointerInTrack(event));
        if (!drag.current) return;
        scrollTo(event);
      }}
      onPointerLeave={() => {
        if (!drag.current) setHoverY(null);
      }}
      onPointerUp={(event) => {
        drag.current = false;
        if (event.pointerType === "touch") setHoverY(null);
      }}
      onPointerCancel={() => {
        drag.current = false;
      }}
    >
      <div className="thread-scroll-track" ref={trackRef}>
        {ticked ? (
          marks.map((mark, i) => {
            const top = positions[i] ?? 0;
            const mag = hoverY === null ? 0 : chatTickMagnify(top - hoverY);
            const width = TICK_BASE + (TICK_PEAK - TICK_BASE) * mag;
            const cls = `thread-tick${i === view.active ? " is-active" : ""}${i === hovered ? " is-hover" : ""}`;
            return (
              <span
                key={mark.id}
                className={cls}
                data-testid="chat-scroll-tick"
                style={{
                  top,
                  width,
                  opacity: i === view.active ? 0.95 : 0.3 + 0.4 * mag,
                }}
              />
            );
          })
        ) : (
          <div
            className="thread-scroll-thumb"
            data-testid="chat-scroll-thumb"
            style={{ top: view.y, height: view.height }}
          >
            <span className="thread-scroll-current" />
          </div>
        )}
        {ticked && hovered >= 0 && marks[hovered] ? (
          <div
            className="thread-tick-tip"
            data-testid="chat-scroll-tip"
            role="tooltip"
            style={{ top: positions[hovered] ?? 0 }}
          >
            <div className="thread-tick-tip-prompt">{marks[hovered]!.prompt}</div>
            {marks[hovered]!.reply ? (
              <div className="thread-tick-tip-reply">{marks[hovered]!.reply}</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
