import {
  DEFAULT_PHONE_DEVICE_ID,
  designPhoneDevice,
  isMobileDesignSession,
  resolveDesignPalette,
  type AgentSession,
  type DesignSystem,
} from "@locus/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  canvasSeqFromDocument,
  isCanvasPaintReady,
  prepareCanvasHtml,
  stampCanvasSeq,
  withThumbOverflowClip,
} from "@/lib/canvasHtml";
import { paintCanvasHtml } from "@/lib/canvasPaint";
import { IconFrame } from "@/components/layout/Icons";

const DESKTOP_THUMB = { width: 1280, height: 800 };

/** Sidebar preview box. Keep in sync with `.design-thumb` in index.css. */
export const DESIGN_THUMB_WIDTH = 88;
export const DESIGN_THUMB_HEIGHT = 55;

type SlotId = "a" | "b";
type ThumbPage = { raw: string; html: string; key: number; seq: number };

function otherSlot(id: SlotId): SlotId {
  return id === "a" ? "b" : "a";
}

function makeThumbPage(raw: string, key: number, seq: number): ThumbPage {
  return { raw, html: stampCanvasSeq(raw, seq), key, seq };
}

/** Shrink the full canvas viewport to fit the thumb (contain, not a top-left crop). */
export function designThumbFit(viewport: { width: number; height: number }): {
  scale: number;
  x: number;
  y: number;
} {
  const scale = Math.min(
    DESIGN_THUMB_WIDTH / viewport.width,
    DESIGN_THUMB_HEIGHT / viewport.height,
  );
  return {
    scale: snapThumb(scale),
    x: snapThumb((DESIGN_THUMB_WIDTH - viewport.width * scale) / 2),
    y: snapThumb((DESIGN_THUMB_HEIGHT - viewport.height * scale) / 2),
  };
}

function snapThumb(n: number): number {
  if (Math.abs(n) < 1e-9) return 0;
  return Math.round(n * 1e6) / 1e6;
}

export function designThumbSrcDoc(
  html: string,
  session: AgentSession,
  systems: DesignSystem[],
): string {
  return withThumbOverflowClip(
    prepareCanvasHtml(
      paintCanvasHtml({ html, session, systems }),
      false,
      `/api/sessions/${encodeURIComponent(session.id)}/canvas-files/`,
    ),
  );
}

export function designThumbViewport(session: AgentSession): { width: number; height: number } {
  if (!isMobileDesignSession(session)) return DESKTOP_THUMB;
  const phone = designPhoneDevice(DEFAULT_PHONE_DEVICE_ID);
  return { width: phone.width, height: phone.height };
}

function ThumbPreview(props: {
  srcDoc: string;
  viewport: { width: number; height: number };
  fit: { scale: number; x: number; y: number };
}) {
  const seqRef = useRef(1);
  const keyRef = useRef(1);
  const latestRaw = useRef(props.srcDoc);
  latestRaw.current = props.srcDoc;
  const pagesRef = useRef<{ a: ThumbPage | null; b: ThumbPage | null }>({
    a: makeThumbPage(props.srcDoc, 1, 1),
    b: null,
  });
  const pendingSlotRef = useRef<SlotId | null>("a");
  const [pages, setPages] = useState(pagesRef.current);
  const [frontSlot, setFrontSlot] = useState<SlotId | null>(null);
  const [pendingSlot, setPendingSlot] = useState<SlotId | null>("a");
  const [ready, setReady] = useState(false);
  const [boot, setBoot] = useState({ a: 0, b: 0 });
  pagesRef.current = pages;
  pendingSlotRef.current = pendingSlot;

  const front = frontSlot ? pages[frontSlot] : null;
  const pending = pendingSlot ? pages[pendingSlot] : null;

  function markReady(seq: number) {
    const loading = pendingSlotRef.current ? pagesRef.current[pendingSlotRef.current] : null;
    if (loading?.seq !== seq) return;
    setReady(true);
  }

  useEffect(() => {
    if (props.srcDoc === front?.raw) {
      setReady(false);
      setPendingSlot(null);
      return;
    }
    if (props.srcDoc === pending?.raw) return;
    if (ready) return;
    if (pending && front) return;
    seqRef.current += 1;
    const seq = seqRef.current;
    if (pending && pendingSlot && !front) {
      // Thumbs disable scripts, so the live-canvas ready ping may never fire.
      // Keep the already-painted solo iframe on screen and load behind it.
      const target = otherSlot(pendingSlot);
      setFrontSlot(pendingSlot);
      setPages((current) => ({
        ...current,
        [target]: makeThumbPage(props.srcDoc, ++keyRef.current, seq),
      }));
      setPendingSlot(target);
      return;
    }
    const target = frontSlot ? otherSlot(frontSlot) : (pendingSlot ?? "a");
    setPages((current) => ({
      ...current,
      [target]: makeThumbPage(
        props.srcDoc,
        frontSlot ? ++keyRef.current : (current[target]?.key ?? ++keyRef.current),
        seq,
      ),
    }));
    setPendingSlot(target);
  }, [props.srcDoc, front, pending, frontSlot, pendingSlot, ready]);

  useEffect(() => {
    if (!ready || !pendingSlot || !pending) return;
    const id = requestAnimationFrame(() => {
      const queued = latestRaw.current !== pending.raw ? latestRaw.current : null;
      if (queued) {
        seqRef.current += 1;
        keyRef.current += 1;
        const nextPage = makeThumbPage(queued, keyRef.current, seqRef.current);
        if (frontSlot) {
          setPages((current) => ({ ...current, [pendingSlot]: nextPage }));
          setBoot((current) => ({ ...current, [pendingSlot]: current[pendingSlot] + 1 }));
          setReady(false);
          return;
        }
        const next = otherSlot(pendingSlot);
        setFrontSlot(pendingSlot);
        setPages((current) => ({ ...current, [next]: nextPage }));
        setPendingSlot(next);
        setReady(false);
        return;
      }
      setFrontSlot(pendingSlot);
      setPendingSlot(null);
      setReady(false);
    });
    return () => cancelAnimationFrame(id);
  }, [ready, pending, pendingSlot, frontSlot]);

  function onPendingLoad(event: { currentTarget: HTMLIFrameElement }) {
    const doc = event.currentTarget.contentDocument;
    const seq = canvasSeqFromDocument(doc);
    if (seq != null) {
      markReady(seq);
      return;
    }
    // Scripts stay off (no allow-scripts), so the ready ping never runs.
    // A parsed srcdoc still has the preview-guard tag for onload.
    if (!doc?.querySelector("[data-locus-preview-guard]")) return;
    const loading = pendingSlotRef.current ? pagesRef.current[pendingSlotRef.current] : null;
    if (loading) markReady(loading.seq);
  }

  const frameStyle = {
    width: props.viewport.width,
    height: props.viewport.height,
    zoom: props.fit.scale,
    left: props.fit.x,
    top: props.fit.y,
  };

  return (
    <>
      {(["a", "b"] as const).map((id) => {
        const slotPage = pages[id];
        if (!slotPage) return null;
        const isFront = frontSlot === id;
        const isPending = pendingSlot === id;
        return (
          <iframe
            key={`thumb-${id}-${slotPage.key}-${boot[id]}`}
            className={
              isFront
                ? "is-front"
                : isPending
                  ? `is-pending${frontSlot ? "" : " is-solo"}`
                  : "is-idle"
            }
            srcDoc={slotPage.html}
            sandbox="allow-same-origin"
            scrolling="no"
            tabIndex={-1}
            title=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            style={frameStyle}
            onLoad={isPending ? onPendingLoad : undefined}
          />
        );
      })}
    </>
  );
}

export function DesignThumb(props: {
  session: AgentSession;
  html?: string;
  systems: DesignSystem[];
  shot?: string;
}) {
  const ready = Boolean(props.html && isCanvasPaintReady(props.html));
  const viewport = designThumbViewport(props.session);
  const fit = designThumbFit(viewport);
  const palette = resolveDesignPalette(props.session.palette);
  const srcDoc = useMemo(() => {
    if (!ready || !props.html) return "";
    return designThumbSrcDoc(props.html, props.session, props.systems);
  }, [ready, props.html, props.session, props.systems]);

  if (!ready && !props.shot) {
    return (
      <div className="design-thumb is-empty" aria-hidden="true">
        <IconFrame />
      </div>
    );
  }

  return (
    <div
      className="design-thumb"
      aria-hidden="true"
      data-viewport={isMobileDesignSession(props.session) ? "phone" : "desktop"}
      style={{ ["--canvas-page-bg" as string]: palette.bg }}
    >
      {props.shot ? (
        <img className="design-thumb-shot" alt="" src={`data:image/png;base64,${props.shot}`} />
      ) : (
        <ThumbPreview srcDoc={srcDoc} viewport={viewport} fit={fit} />
      )}
    </div>
  );
}
