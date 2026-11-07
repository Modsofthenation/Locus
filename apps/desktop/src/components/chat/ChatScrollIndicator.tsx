import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  CHAT_SCROLL_MIN_THUMB,
  chatScrollFromPointer,
  chatScrollGrabOffset,
  chatScrollOverflow,
  chatScrollThumb,
} from "@/lib/chatScrollIndicator";

type IndicatorView = {
  show: boolean;
  y: number;
  height: number;
  now: number;
};

const HIDDEN: IndicatorView = { show: false, y: 0, height: CHAT_SCROLL_MIN_THUMB, now: 0 };

export function ChatScrollIndicator(props: {
  threadRef: RefObject<HTMLDivElement | null>;
  revision: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const grab = useRef(0);
  const [view, setView] = useState<IndicatorView>(HIDDEN);

  useLayoutEffect(() => {
    const host = props.threadRef.current;
    if (!host) return;

    function paint() {
      const track = trackRef.current;
      if (!host || !track) return;
      const show = chatScrollOverflow(host.scrollHeight, host.clientHeight);
      const maxScroll = Math.max(0, host.scrollHeight - host.clientHeight);
      const now = maxScroll <= 0 ? 0 : Math.round((host.scrollTop / maxScroll) * 100);
      if (!show || track.clientHeight <= 0) {
        setView((prev) =>
          prev.show === show && prev.now === now && prev.y === 0 ? prev : { ...HIDDEN, show, now },
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
          prev.now === now
        ) {
          return prev;
        }
        return { show, y: next.y, height: next.height, now };
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

  function scrollTo(event: ReactPointerEvent<HTMLDivElement>) {
    const host = props.threadRef.current;
    const track = trackRef.current;
    if (!host || !track) return;
    const pointerY = event.clientY - track.getBoundingClientRect().top;
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
      className={view.show ? "thread-scroll-indicator is-visible" : "thread-scroll-indicator"}
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
        if (!drag.current) return;
        scrollTo(event);
      }}
      onPointerUp={() => {
        drag.current = false;
      }}
      onPointerCancel={() => {
        drag.current = false;
      }}
    >
      <div className="thread-scroll-track" ref={trackRef}>
        <div
          className="thread-scroll-thumb"
          data-testid="chat-scroll-thumb"
          style={{ top: view.y, height: view.height }}
        >
          <span className="thread-scroll-current" />
        </div>
      </div>
    </div>
  );
}
