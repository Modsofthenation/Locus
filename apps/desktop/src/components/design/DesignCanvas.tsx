import {
  DEFAULT_PHONE_DEVICE_ID,
  DESIGN_PHONE_DEVICES,
  designPhoneDevice,
  formatPhoneDeviceCaption,
  isGuestReady,
  isGuestStarting,
  isImageBuildWaiting,
  imageBuildStartNote,
  isMobileDesignSession,
  isSessionWorking,
  isWaitingOnGuestStart,
  pickSelector,
  resolveDesignPalette,
  resolveDesignSystem,
  parseCanvasTuneAttrs,
  parseCanvasFeelAttrs,
  parseGameControls,
  feelFromTune,
  withGameChromeHook,
  defaultGamePlaytestSteps,
  GAME_FEEL_PRESETS,
  GAME_ITERATE_CHIPS,
  GAME_GENERATE_CHIPS,
  GAME_KITS,
  defaultGameScaffold,
  GAME_RECORD_MS,
  GAME_BALANCE_RUNS,
  GAME_GDD_PATH,
  GAME_LANDSCAPE,
  GAME_BRIEF_PATH,
  GAME_LAST_RUN_PATH,
  applyGameBriefPrompt,
  emptyGameStudio,
  feelKeysForRecipe,
  fixFromPlaytestPrompt,
  formatGameLastRun,
  formatGameStudio,
  formatMomentFix,
  GAME_STUDIO_PATH,
  gameReleaseChecklist,
  iterateGamePrompt,
  keepFeelPrompt,
  livingGameBrief,
  parseGameStudio,
  type GameStudioState,
  parseGameLastRun,
  parsePlaytestStats,
  playtestLooksPlayable,
  tapeEventCode,
  tuneFromFeel,
  isGameSession,
  isAssetSession,
  ASSET_KITS,
  ASSET_CLIPS,
  ASSET_POSE_PRESETS,
  formatAssetClipLabel,
  ASSET_ITERATE_CHIPS,
  ASSET_BRIEF_PATH,
  formatAssetBuildLabel,
  parseAssetStudioStats,
  resolveAppliedAssetBuild,
  assetBuildEquals,
  assetFaceCount,
  assetFacesOverBudget,
  type AssetStudioStats,
  ASSET_CAMERA_VIEWS,
  ASSET_MATERIALS,
  ASSET_LIGHTS,
  ASSET_UNITS,
  ASSET_BACKGROUNDS,
  ASSET_CLIP_SPEEDS,
  ASSET_ISOLATE_PARTS,
  ASSET_LIVE_VARIANT_ID,
  ASSET_UNDO_VARIANT_ID,
  ASSET_VIEW_SLOTS,
  ASSET_VIEW_FILES,
  assetPolyBudgetFaces,
  formatAssetCameraLabel,
  formatAssetCameraHint,
  formatAssetMaterialLabel,
  formatAssetMaterialHint,
  formatAssetLightsLabel,
  formatAssetLightsHint,
  formatAssetUnitsLabel,
  formatAssetBackgroundLabel,
  formatAssetBackgroundHint,
  formatAssetClipSpeedLabel,
  formatAssetClipSpeedHint,
  formatAssetIsolateLabel,
  formatAssetIsolateHint,
  formatAssetMeshHealth,
  assetCanvasFileUrl,
  assetShowsPose,
  assetShowsStage3d,
  assetVisibleClips,
  assetVisibleIterateChips,
  assetVisiblePosePresets,
  assetWorkingChip,
  dropAssetPhotoPrompt,
  generateAssetPrompt,
  resolveAssetStyle,
  inferAssetPipeline,
  inferAssetSubject,
  type AssetBackground,
  type AssetCameraView,
  type AssetClipSpeed,
  type AssetIsolatePart,
  type AssetLights,
  type AssetMaterial,
  type AssetUnits,
  type AssetViewSlot,
  poseFromTune,
  tuneFromPose,
  parseCanvasPoseAttrs,
  ASSET_ZOOM_DEFAULT,
  ASSET_EXPORT_TIMEOUT_MS,
  clampAssetZoom,
  stepAssetZoom,
  formatAssetZoom,
  parseAssetExportProgress,
  parseAssetExportFile,
  parseAssetExportBytes,
  assetExportFileName,
  withAssetExportExtension,
  ASSET_EXPORT_MISSING_FILE,
  type AssetExportFormat,
  type AssetExportJob,
  iterateAssetPrompt,
  applyAssetBriefPrompt,
  keepPosePrompt,
  livingAssetBrief,
  DESIGN_REPO_CONTEXT_PATH,
  CANVAS_FRAME_SRCDOC_ATTR,
  canvasShouldServeHttp,
  canvasFilesPreviewUrl,
  canvasHttpFrameSrc,
  canvasIframeSandbox,
  firstOversizeAttachment,
  type DesignPalette,
  type DesignViewport,
  type DesignTune,
} from "@locus/shared";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { api } from "@/lib/api";
import {
  canvasSeqFromDocument,
  isCanvasPaintReady,
  pickCanvasHtml,
  stampCanvasSeq,
} from "@/lib/canvasHtml";
import { finishCanvasSrcDoc, paintCanvasHtml } from "@/lib/canvasPaint";
import { canvasFrameSrc, isCanvasFrameReady, postCanvasFrameHtml } from "@/lib/canvasFrame";
import { useStore } from "@/state/store";
import { matchModKey } from "@/lib/shortcuts";
import { useDeferredCollapse } from "@/lib/useDeferredCollapse";
import { DesignPalettePicker } from "./DesignPalettePicker";
import { DesignSystemPicker } from "./DesignSystemPicker";
import { DesignInspector, type CanvasInspectPick } from "./DesignInspector";
import { DesignVariantsStrip } from "./DesignVariantsStrip";
import { GameStudioPanel } from "../game/GameStudioPanel";
import { AssetStylePicker } from "@/components/assets/AssetStylePicker";
import { GameStylePicker } from "@/components/game/GameStylePicker";
import { AssetBuildPicker } from "@/components/assets/AssetBuildPicker";
import { useAssetBuild } from "@/components/assets/useAssetBuild";
import { AssetRecents } from "@/components/assets/AssetRecents";
import {
  AssetExportModal,
  loadAssetExportDir,
  rememberAssetExportDir,
} from "@/components/assets/AssetExportModal";
import {
  AssetDropWell,
  assignImageSlots,
  type AssetViewFiles,
} from "@/components/assets/AssetDropWell";
import { filesFromDataTransfer, filesToAttachments, isImageFile } from "@/lib/attachments";
import { IconMore, IconPanelRight } from "@/components/layout/Icons";
import { ImageBuildCard } from "@/components/chat/CloneProgressCard";
import { MenuItem, MenuSep, OverflowMenu } from "@/components/layout/OverflowMenu";
import { Select } from "@/components/layout/Select";
import { GamePlayLinkPanel } from "@/components/game/GamePlayLink";

type Viewport = DesignViewport | "landscape";
type CanvasScaffold =
  "vite-react" | "static" | "next" | "astro" | "canvas-vite" | "three-vite" | "phaser";

const VIEWPORTS: Array<{ id: Viewport; label: string; width: number }> = [
  { id: "desktop", label: "Desktop", width: 1280 },
  { id: "tablet", label: "Tablet", width: 768 },
  { id: "phone", label: "Phone", width: 390 },
];

const GAME_VIEWPORTS: Array<{ id: Viewport; label: string; width: number; height?: number }> = [
  ...VIEWPORTS,
  {
    id: GAME_LANDSCAPE.id,
    label: GAME_LANDSCAPE.label,
    width: GAME_LANDSCAPE.width,
    height: GAME_LANDSCAPE.height,
  },
];

interface CanvasPick {
  type: "locus-design-pick";
  tag: string;
  text: string;
  id: string;
  className: string;
}

function isCanvasPick(data: unknown): data is CanvasPick {
  if (!data || typeof data !== "object") return false;
  const row = data as Record<string, unknown>;
  return row.type === "locus-design-pick" && typeof row.tag === "string";
}

function AssetToolbarCluster(props: {
  label: string;
  hint: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`asset-cluster${props.wide ? " is-wide" : ""}`} title={props.hint}>
      <span className="asset-cluster-label">{props.label}</span>
      <div className="asset-cluster-body">{props.children}</div>
    </div>
  );
}

interface CanvasEdit {
  type: "locus-design-edit";
  tag: string;
  text: string;
  id: string;
  className: string;
}

function isCanvasEdit(data: unknown): data is CanvasEdit {
  if (!data || typeof data !== "object") return false;
  const row = data as Record<string, unknown>;
  return (
    row.type === "locus-design-edit" && typeof row.tag === "string" && typeof row.text === "string"
  );
}

function actionError(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.trim() ? err.message : fallback;
}

function isFromCanvasFrame(event: MessageEvent, frameEl: HTMLIFrameElement | null): boolean {
  if (!frameEl?.contentWindow) return true;
  if (event.source === frameEl.contentWindow) return true;
  return event.origin === "null" || event.origin === window.location.origin;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

type CanvasSnapshot = { html: string; palette: DesignPalette; tune?: DesignTune };

type CanvasPage = {
  raw: string;
  html: string;
  key: number;
  seq: number;
  httpSrc?: string;
  httpIsolated?: boolean;
};
type SlotId = "a" | "b";

/** Promote a pending iframe if locus-canvas-ready never arrives (HTTP unique-origin, truncated HTML). */
export const CANVAS_READY_FALLBACK_MS = 1600;

function makeCanvasPage(
  raw: string,
  key: number,
  seq: number,
  httpBase?: string,
  httpIsolated?: boolean,
): CanvasPage {
  return {
    raw,
    html: httpBase ? raw : stampCanvasSeq(raw, seq),
    key,
    seq,
    httpSrc: httpBase,
    httpIsolated,
  };
}

function otherSlot(id: SlotId): SlotId {
  return id === "a" ? "b" : "a";
}

function isCanvasReady(data: unknown): data is { type: "locus-canvas-ready"; seq: number } {
  if (!data || typeof data !== "object") return false;
  const row = data as Record<string, unknown>;
  return row.type === "locus-canvas-ready" && typeof row.seq === "number";
}

/** Chromium skips srcdoc loads created while an ancestor is opacity:0 or unlaid-out. */
export function isCanvasHostHidden(node: Element | null): boolean {
  let el: HTMLElement | null = node instanceof HTMLElement ? node : null;
  while (el) {
    const inline = el.style;
    if (inline.display === "none" || inline.visibility === "hidden" || inline.opacity === "0") {
      return true;
    }
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

function canvasHostHasBox(node: HTMLElement): boolean {
  const { width, height } = node.getBoundingClientRect();
  return width >= 2 && height >= 2;
}

function CanvasPreview(props: {
  srcDoc: string;
  httpSrc?: string;
  httpIsolated?: boolean;
  paintReady: boolean;
  pageKey: string;
  viewport: Viewport;
  width: number;
  height?: number;
  phoneId?: string;
  pageBg?: string;
  frameRef: RefObject<HTMLIFrameElement | null>;
  onReady?: (pageKey: string) => void;
  readyNonce?: number;
}) {
  const seqRef = useRef(1);
  const keyRef = useRef(1);
  const latestRaw = useRef(props.srcDoc);
  latestRaw.current = props.srcDoc;
  const latestHttp = useRef(props.httpSrc);
  latestHttp.current = props.httpSrc;
  const latestIsolated = useRef(props.httpIsolated);
  latestIsolated.current = props.httpIsolated;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const needsReload = useRef(false);
  const [pages, setPages] = useState<{ a: CanvasPage | null; b: CanvasPage | null }>(() => ({
    a: props.paintReady
      ? makeCanvasPage(props.srcDoc, 1, 1, props.httpSrc, props.httpIsolated)
      : null,
    b: null,
  }));
  const [frontSlot, setFrontSlot] = useState<SlotId | null>(null);
  const [pendingSlot, setPendingSlot] = useState<SlotId | null>(props.paintReady ? "a" : null);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState(props.pageKey);
  const [canMount, setCanMount] = useState(false);
  const [boot, setBoot] = useState({ a: 0, b: 0 });
  const pagesRef = useRef(pages);
  const pendingSlotRef = useRef(pendingSlot);
  pagesRef.current = pages;
  pendingSlotRef.current = pendingSlot;

  const front = frontSlot ? pages[frontSlot] : null;
  const pending = pendingSlot ? pages[pendingSlot] : null;

  if (page !== props.pageKey) {
    setPage(props.pageKey);
    setReady(false);
    if (props.paintReady && props.srcDoc !== front?.raw) {
      seqRef.current += 1;
      keyRef.current += 1;
      const target = frontSlot ? otherSlot(frontSlot) : (pendingSlot ?? "a");
      setPages((current) => ({
        ...current,
        [target]: makeCanvasPage(
          props.srcDoc,
          keyRef.current,
          seqRef.current,
          props.httpSrc,
          props.httpIsolated,
        ),
      }));
      setPendingSlot(target);
    }
  }

  function markPendingReady() {
    if (!pendingSlotRef.current) return;
    setReady(true);
  }

  function markReady(seq: number) {
    const loading = pendingSlotRef.current ? pagesRef.current[pendingSlotRef.current] : null;
    if (!loading) return;
    // seq 0 is what the preview guard posts when currentScript is missing.
    if (seq !== 0 && loading.seq !== seq) return;
    setReady(true);
  }

  function injectFrame(frame: HTMLIFrameElement) {
    if (frame.getAttribute("data-canvas-http") === "1") return;
    postCanvasFrameHtml(frame.contentWindow, frame.getAttribute(CANVAS_FRAME_SRCDOC_ATTR) ?? "");
  }

  function framePosted(frame: HTMLIFrameElement, source: MessageEventSource | null): boolean {
    if (!source) return false;
    try {
      return Boolean(frame.contentWindow && source === frame.contentWindow);
    } catch {
      return false;
    }
  }

  useLayoutEffect(() => {
    function onMessage(event: MessageEvent) {
      const root = boxRef.current;
      if (!root || !event.source) return;
      if (isCanvasReady(event.data)) {
        let matched = false;
        for (const frame of root.querySelectorAll("iframe")) {
          if (!framePosted(frame, event.source)) continue;
          matched = true;
          if (frame.classList.contains("is-pending")) {
            markPendingReady();
            return;
          }
          markReady(event.data.seq);
          return;
        }
        // Unique-origin sandboxes sometimes wrap contentWindow so strict
        // equality fails. A pending page still needs the ready ping.
        if (!matched && pendingSlotRef.current) {
          markPendingReady();
          markReady(event.data.seq);
        }
        return;
      }
      for (const frame of root.querySelectorAll("iframe")) {
        if (!framePosted(frame, event.source)) continue;
        if (isCanvasFrameReady(event.data)) {
          injectFrame(frame);
          return;
        }
      }
    }
    window.addEventListener("message", onMessage);

    const node = boxRef.current;
    let cancelled = false;
    let raf = 0;
    function arm() {
      if (cancelled) return;
      if (node && isCanvasHostHidden(node)) {
        raf = requestAnimationFrame(arm);
        return;
      }
      setCanMount(true);
    }
    arm();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  useLayoutEffect(() => {
    if (!canMount) return;
    const node = boxRef.current;
    if (!node) return;
    const ro =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            if (!canvasHostHasBox(node)) {
              needsReload.current = true;
              return;
            }
            if (!needsReload.current) return;
            needsReload.current = false;
            setReady(false);
            const slot = pendingSlotRef.current;
            if (slot) setBoot((current) => ({ ...current, [slot]: current[slot] + 1 }));
          })
        : null;
    ro?.observe(node);
    if (!canvasHostHasBox(node)) needsReload.current = true;
    return () => ro?.disconnect();
  }, [canMount]);

  useEffect(() => {
    if (props.srcDoc === front?.raw && (props.httpSrc ?? "") === (front?.httpSrc ?? "")) {
      setReady(false);
      setPendingSlot(null);
      return;
    }
    if (!props.paintReady) return;
    if (props.srcDoc === pending?.raw && (props.httpSrc ?? "") === (pending?.httpSrc ?? "")) return;
    if (ready) return;
    // Do not rewrite srcDoc on an in-flight iframe once a page is already on
    // screen. Chromium often ignores later srcdoc assignments until a click.
    // latestRaw is applied when this pending page promotes.
    if (pending && front) return;
    seqRef.current += 1;
    const seq = seqRef.current;
    const target = frontSlot ? otherSlot(frontSlot) : (pendingSlot ?? "a");
    setPages((current) => ({
      ...current,
      [target]: makeCanvasPage(
        props.srcDoc,
        frontSlot ? ++keyRef.current : (current[target]?.key ?? ++keyRef.current),
        seq,
        props.httpSrc,
        props.httpIsolated,
      ),
    }));
    setPendingSlot(target);
  }, [
    props.srcDoc,
    props.httpSrc,
    props.paintReady,
    front,
    pending,
    frontSlot,
    pendingSlot,
    ready,
  ]);

  useEffect(() => {
    if (!ready || !pendingSlot || !pending) return;
    const id = requestAnimationFrame(() => {
      const queued = latestRaw.current !== pending.raw ? latestRaw.current : null;
      if (queued) {
        seqRef.current += 1;
        keyRef.current += 1;
        const nextPage = makeCanvasPage(
          queued,
          keyRef.current,
          seqRef.current,
          latestHttp.current,
          latestIsolated.current,
        );
        if (frontSlot) {
          // Remount the pending slot behind the current front instead of
          // flashing the stale snapshot.
          setPages((current) => ({ ...current, [pendingSlot]: nextPage }));
          setBoot((current) => ({ ...current, [pendingSlot]: current[pendingSlot] + 1 }));
          setReady(false);
          return;
        }
        // No front yet: promote the loaded page in place, then load queued
        // onto the other slot. setBoot here would remount the only visible iframe.
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

  useEffect(() => {
    const root = boxRef.current;
    if (!root) return;
    for (const frame of root.querySelectorAll("iframe")) injectFrame(frame);
  }, [pages, boot, canMount]);

  useEffect(() => {
    if (!pendingSlot || ready) return;
    const id = window.setTimeout(() => markPendingReady(), CANVAS_READY_FALLBACK_MS);
    return () => window.clearTimeout(id);
  }, [pendingSlot, ready, pending?.key]);

  useEffect(() => {
    if (!props.paintReady) {
      props.onReady?.(props.pageKey);
      return;
    }
    if (pending) return;
    if (front?.raw !== props.srcDoc) return;
    props.onReady?.(props.pageKey);
  }, [
    props.paintReady,
    props.pageKey,
    props.srcDoc,
    props.onReady,
    props.readyNonce,
    pending,
    front,
  ]);

  function onPendingLoad(event: { currentTarget: HTMLIFrameElement }) {
    const frame = event.currentTarget;
    injectFrame(frame);
    // HTTP canvases skip the canvas-frame runner. Unique-origin sandbox hides
    // contentDocument, so load itself means the page (and preview guard) ran.
    if (frame.getAttribute("data-canvas-http") === "1") {
      markPendingReady();
      return;
    }
    const doc = frame.contentDocument;
    const seq = canvasSeqFromDocument(doc);
    if (seq != null) {
      markReady(seq);
      return;
    }
    // about:blank has an accessible empty document and must not promote.
    // A unique-origin sandbox hides contentDocument. The runner has loaded;
    // wait for the nested canvas to post locus-canvas-ready.
    if (!doc) return;
    if (!doc.querySelector("[data-locus-preview-guard]")) return;
    markPendingReady();
  }

  const showFrames = canMount && (pages.a || pages.b);

  return (
    <div
      ref={boxRef}
      className="design-frame"
      data-viewport={props.viewport}
      data-phone={props.phoneId}
      style={{
        width: Math.min(props.width, 1600),
        ...(props.height ? { height: props.height } : {}),
        ...(props.pageBg ? { ["--canvas-page-bg" as string]: props.pageBg } : {}),
      }}
    >
      <div className="design-frame-pages">
        {showFrames
          ? (["a", "b"] as const).map((id) => {
              const slotPage = pages[id];
              if (!slotPage) return null;
              const isFront = frontSlot === id;
              const isPending = pendingSlot === id;
              return (
                <iframe
                  key={`canvas-${id}-${slotPage.key}-${boot[id]}`}
                  ref={(node) => {
                    if (isFront || (!frontSlot && isPending)) props.frameRef.current = node;
                  }}
                  className={
                    isFront
                      ? "is-front"
                      : isPending
                        ? `is-pending${ready ? " is-ready" : ""}${frontSlot ? "" : " is-solo"}`
                        : "is-idle"
                  }
                  title="Design canvas"
                  sandbox={canvasIframeSandbox(Boolean(slotPage.httpSrc && slotPage.httpIsolated))}
                  src={
                    slotPage.httpSrc
                      ? `${slotPage.httpSrc}${slotPage.httpSrc.includes("?") ? "&" : "?"}c=${slotPage.seq}`
                      : canvasFrameSrc()
                  }
                  data-srcdoc={slotPage.httpSrc ? undefined : slotPage.html}
                  data-canvas-http={slotPage.httpSrc ? "1" : undefined}
                  onLoad={isPending ? onPendingLoad : undefined}
                />
              );
            })
          : null}
      </div>
    </div>
  );
}

export function DesignCanvas() {
  const { state, dispatch } = useStore();
  const showRail = useDeferredCollapse(state.vmCollapsed);
  const session = state.sessions.find((s) => s.id === state.selectedId);
  const vm =
    state.vms.find((v) => v.id === session?.vmId) ??
    state.vms.find((v) => v.sessionId === session?.id);
  const [html, setHtml] = useState<string | null>(null);
  const [htmlOwnerId, setHtmlOwnerId] = useState<string | undefined>(session?.id);
  const [swapLoading, setSwapLoading] = useState(false);
  const [responsiveViewport, setResponsiveViewport] = useState<Viewport>("desktop");
  const [phoneId, setPhoneId] = useState(DEFAULT_PHONE_DEVICE_ID);
  const [commenting, setCommenting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [matching, setMatching] = useState(false);
  const [exploring, setExploring] = useState(false);
  const [tuneOpen, setTuneOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [studioStats, setStudioStats] = useState<AssetStudioStats | undefined>();
  const [scaffold, setScaffold] = useState<CanvasScaffold>("vite-react");
  const [variantName, setVariantName] = useState("");
  const [playtesting, setPlaytesting] = useState(false);
  const [recordingPlay, setRecordingPlay] = useState(false);
  const [playLinkCopied, setPlayLinkCopied] = useState(false);
  const [playLink, setPlayLink] = useState<{ url: string; lanUrls: string[] } | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const [studio, setStudio] = useState<GameStudioState | null>(null);
  const [releaseLines, setReleaseLines] = useState<string[] | null>(null);
  const [generatingKind, setGeneratingKind] = useState<string | null>(null);
  const [gamepadOn, setGamepadOn] = useState(false);
  const [playtestReport, setPlaytestReport] = useState<string | null>(null);
  const [debugOn, setDebugOn] = useState(false);
  const [paused, setPaused] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [touchStick, setTouchStick] = useState(false);
  const [playMode, setPlayMode] = useState(false);
  const [muted, setMuted] = useState(false);
  const [aspectLock, setAspectLock] = useState(true);
  const [lastKeys, setLastKeys] = useState<string[]>([]);
  const [lastTape, setLastTape] = useState<string[]>([]);
  const [lastShot, setLastShot] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<ReturnType<typeof parseGameLastRun>>();
  const [liveStats, setLiveStats] = useState<{
    score?: number;
    deaths?: number;
    time?: number;
    fps?: number;
  }>();
  const [chromeReady, setChromeReady] = useState(0);
  const [iterating, setIterating] = useState<string | null>(null);
  const [exportingZip, setExportingZip] = useState(false);
  const [assetExport, setAssetExport] = useState<AssetExportJob | null>(null);
  const assetExportRef = useRef<AssetExportJob | null>(null);
  const assetExportGotFile = useRef(false);
  assetExportRef.current = assetExport;
  const [orbitOn, setOrbitOn] = useState(true);
  const [wireframeOn, setWireframeOn] = useState(false);
  const [assetZoom, setAssetZoom] = useState(ASSET_ZOOM_DEFAULT);
  const [clip, setClip] = useState<(typeof ASSET_CLIPS)[number]>("idle");
  const [cameraView, setCameraView] = useState<AssetCameraView>("reset");
  const [gridOn, setGridOn] = useState(false);
  const [material, setMaterial] = useState<AssetMaterial>("studio");
  const [assetLights, setAssetLights] = useState<AssetLights>("default");
  const [assetUnits, setAssetUnits] = useState<AssetUnits>("m");
  const [onionOn, setOnionOn] = useState(false);
  const [onionOpacity, setOnionOpacity] = useState(0.35);
  const [assetPaused, setAssetPaused] = useState(false);
  const [clipSpeed, setClipSpeed] = useState<AssetClipSpeed>(1);
  const [clipT, setClipT] = useState(0);
  const [assetBackground, setAssetBackground] = useState<AssetBackground>("grey");
  const [isolatePart, setIsolatePart] = useState<AssetIsolatePart>("all");
  const [compareOn, setCompareOn] = useState(false);
  const [compareHtml, setCompareHtml] = useState<string | null>(null);
  const { build: assetBuild, change: patchBuild, markApplied } = useAssetBuild(session, dispatch);
  const [viewSlots, setViewSlots] = useState<AssetViewFiles>({});
  const [sourcePreviews, setSourcePreviews] = useState<Partial<Record<AssetViewSlot, string>>>({});
  const [dropHint, setDropHint] = useState(false);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectPick, setInspectPick] = useState<CanvasInspectPick | null>(null);
  const [historyAt, setHistoryAt] = useState(-1);
  const historyAtRef = useRef(-1);
  historyAtRef.current = historyAt;
  const [exportingPng, setExportingPng] = useState(false);
  const pendingIterate = useRef<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const selectedIdRef = useRef(session?.id);
  const recordWait = useRef<number | null>(null);
  const history = useRef<CanvasSnapshot[]>([]);
  const sessionId = session?.id;
  selectedIdRef.current = sessionId;
  const liveHtml = sessionId ? state.canvasHtml[sessionId] : undefined;
  const turning = session?.status === "running";
  const guestReady = isGuestReady(vm?.status);
  const starting = isGuestStarting(vm?.status);
  const waitingStart = Boolean(session && isWaitingOnGuestStart(session.messages));
  const imageProgress = sessionId ? state.imageProgress[sessionId] : undefined;
  const building = isImageBuildWaiting(imageProgress);
  const working = building || starting || waitingStart || isSessionWorking(session?.status);
  const [palette, setPalette] = useState<DesignPalette>(() =>
    resolveDesignPalette(session?.palette),
  );
  const pendingPalette = useRef(0);
  const paletteEpoch = useRef(0);
  const paletteQueue = useRef(Promise.resolve());
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const htmlRef = useRef(html);
  htmlRef.current = html;
  const tuneRef = useRef(session?.designTune);
  tuneRef.current = session?.designTune;

  function pushHistory() {
    const current = htmlRef.current;
    if (!current?.trim()) return;
    const snap: CanvasSnapshot = {
      html: current,
      palette: paletteRef.current,
      tune: tuneRef.current,
    };
    const stack = history.current.slice(0, Math.max(0, historyAtRef.current) + 1);
    const last = stack[stack.length - 1];
    if (
      last &&
      last.html === snap.html &&
      JSON.stringify(last.palette) === JSON.stringify(snap.palette) &&
      JSON.stringify(last.tune) === JSON.stringify(snap.tune)
    ) {
      return;
    }
    stack.push(snap);
    if (stack.length > 40) stack.shift();
    history.current = stack;
    setHistoryAt(stack.length - 1);
  }
  const liveHtmlRef = useRef(liveHtml);
  const htmlSessionId = useRef<string | undefined>(sessionId);
  const prevSessionId = useRef(sessionId);
  const variantSwapAwaitingHtml = useRef(false);
  const [paintEpoch, setPaintEpoch] = useState(0);
  liveHtmlRef.current = liveHtml;

  const onCanvasReady = useCallback(
    (pageKey: string) => {
      if (variantSwapAwaitingHtml.current) return;
      if (pageKey === sessionId) {
        setSwapLoading(false);
        setChromeReady((n) => n + 1);
      }
    },
    [sessionId],
  );

  useEffect(() => {
    setCommenting(false);
    setEditing(false);
    setInspecting(false);
    setInspectPick(null);
    setCanvasError(null);
    setPromoting(false);
    setMatching(false);
    setExploring(false);
    setPlaytesting(false);
    setRecordingPlay(false);
    setPlayLinkCopied(false);
    setStudioOpen(false);
    setStudio(null);
    setReleaseLines(null);
    setGeneratingKind(null);
    setGamepadOn(false);
    setExportingZip(false);
    setExportingPng(false);
    setAssetExport(null);
    history.current = [];
    setHistoryAt(-1);
    if (recordWait.current != null) {
      window.clearTimeout(recordWait.current);
      recordWait.current = null;
    }
    setTuneOpen(false);
    setBuildOpen(false);
    setStudioStats(undefined);
    setPlaytestReport(null);
    setDebugOn(false);
    setPaused(false);
    setTouchStick(false);
    setPlayMode(false);
    setMuted(false);
    setAspectLock(true);
    setLastKeys([]);
    setLastTape([]);
    setLastShot(null);
    setLastRun(undefined);
    setLiveStats(undefined);
    setChromeReady(0);
    setIterating(null);
    setOrbitOn(true);
    setWireframeOn(false);
    setAssetZoom(ASSET_ZOOM_DEFAULT);
    setClip("idle");
    setCameraView("reset");
    setGridOn(false);
    setMaterial("studio");
    setAssetLights("default");
    setAssetUnits("m");
    setOnionOn(false);
    setAssetPaused(false);
    setClipSpeed(1);
    setClipT(0);
    setAssetBackground("grey");
    setIsolatePart("all");
    setCompareOn(false);
    setCompareHtml(null);
    setViewSlots({});
    setSourcePreviews({});
    pendingIterate.current = null;
    setPlayLink(null);
    setScaffold(
      isAssetSession(session ?? {})
        ? "three-vite"
        : isGameSession(session ?? {})
          ? defaultGameScaffold(session ?? {})
          : "vite-react",
    );
    setResponsiveViewport("desktop");
    setPhoneId(DEFAULT_PHONE_DEVICE_ID);
    paletteEpoch.current += 1;
    pendingPalette.current = 0;
    paletteQueue.current = Promise.resolve();
    setPalette(resolveDesignPalette(session?.palette));
    if (sessionId && isGameSession(session ?? {})) {
      void Promise.resolve()
        .then(() => api.workspaceFile(sessionId, GAME_LAST_RUN_PATH))
        .then((file) => {
          if (!file?.content?.trim()) return;
          try {
            const run = parseGameLastRun(JSON.parse(file.content));
            if (run) {
              setLastRun(run);
              setLastTape(run.tape);
              setLastKeys(run.keys);
              if (run.score != null || run.deaths != null || run.time != null) {
                setLiveStats({
                  score: run.score,
                  deaths: run.deaths,
                  time: run.time,
                  fps: run.fps,
                });
              }
            }
          } catch {
            /* last-run is optional */
          }
        })
        .catch(() => undefined);
      void Promise.resolve()
        .then(() => api.workspaceFile(sessionId, GAME_STUDIO_PATH))
        .then((file) => {
          if (selectedIdRef.current !== sessionId) return;
          try {
            setStudio(parseGameStudio(file?.content ? JSON.parse(file.content) : undefined));
          } catch {
            setStudio(emptyGameStudio());
          }
        })
        .catch(() => {
          if (selectedIdRef.current === sessionId) setStudio(emptyGameStudio());
        });
    }
    const from = prevSessionId.current;
    prevSessionId.current = sessionId;
    if (from && from !== sessionId) {
      variantSwapAwaitingHtml.current = false;
      setSwapLoading(true);
    }
    if (liveHtml) {
      htmlSessionId.current = sessionId;
      setHtmlOwnerId(sessionId);
      setHtml(liveHtml);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    if (!swapLoading && htmlOwnerId === sessionId) return;
    const id = window.setTimeout(() => {
      if (htmlSessionId.current !== sessionId) {
        htmlSessionId.current = sessionId;
        setHtmlOwnerId(sessionId);
        setHtml(liveHtmlRef.current ?? null);
      }
      setSwapLoading(false);
    }, CANVAS_READY_FALLBACK_MS);
    return () => window.clearTimeout(id);
  }, [sessionId, swapLoading, htmlOwnerId]);

  useEffect(() => {
    if (!liveHtml || !sessionId) return;
    htmlSessionId.current = sessionId;
    setHtmlOwnerId(sessionId);
    setHtml(liveHtml);
  }, [liveHtml, sessionId]);

  useEffect(() => {
    if (!html?.trim() || history.current.length) return;
    history.current = [{ html, palette: paletteRef.current, tune: tuneRef.current }];
    setHistoryAt(0);
    historyAtRef.current = 0;
  }, [html, sessionId]);

  useEffect(() => {
    if (pendingPalette.current) return;
    setPalette(resolveDesignPalette(session?.palette));
  }, [
    session?.palette?.bg,
    session?.palette?.surface,
    session?.palette?.text,
    session?.palette?.muted,
    session?.palette?.primary,
    session?.palette?.accent,
  ]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    async function tick() {
      if (!sessionId) return;
      try {
        const canvas = await api.canvas(sessionId);
        if (cancelled) return;
        if (!canvas.html) {
          if (htmlSessionId.current === sessionId) return;
          const next = liveHtmlRef.current ?? null;
          htmlSessionId.current = sessionId;
          setHtmlOwnerId(sessionId);
          setHtml(next);
          if (!next?.trim()) setSwapLoading(false);
          return;
        }
        setHtml((prev) => {
          const sameOwner = htmlSessionId.current === sessionId;
          htmlSessionId.current = sessionId;
          if (sameOwner && turning && prev && prev.length > canvas.html!.length) return prev;
          return canvas.html;
        });
        setHtmlOwnerId(sessionId);
        const live = liveHtmlRef.current;
        if (
          canvas.html &&
          canvas.html !== live &&
          !(turning && live && live.length > canvas.html.length)
        ) {
          dispatch({ type: "canvas", sessionId, html: canvas.html });
        }
      } catch {
        /* Keep the last good canvas; a poll blip should not blank a live preview. */
      }
    }
    void tick();
    const id = setInterval(() => void tick(), turning || starting ? 500 : 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sessionId, turning, starting, session?.messages.length, dispatch]);

  const mobile = session ? isMobileDesignSession(session) : false;
  const viewport: Viewport = mobile ? "phone" : responsiveViewport;
  const phone = designPhoneDevice(phoneId);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!sessionId) return;
      if (!isFromCanvasFrame(event, frame.current)) return;
      if ((commenting || inspecting) && isCanvasPick(event.data)) {
        const pick = event.data;
        setInspectPick({
          tag: pick.tag,
          id: pick.id,
          className: pick.className,
          text: pick.text,
        });
        if (inspecting && !commenting) return;
        const id = sessionId;
        void api
          .designComment(id, {
            selector: pickSelector(pick),
            text: pick.text || undefined,
            viewport: viewport === "landscape" ? "tablet" : viewport,
          })
          .then((updated) => {
            if (selectedIdRef.current !== id) return;
            dispatch({ type: "session", session: updated });
            dispatch({ type: "compose", text: `On ${pickSelector(pick)}: ` });
            setCommenting(false);
            setCanvasError(null);
          })
          .catch((err) => {
            if (selectedIdRef.current !== id) return;
            setCanvasError(actionError(err, "Could not pin that comment"));
          });
        return;
      }
      if (editing && isCanvasEdit(event.data)) {
        const pick = event.data;
        const id = sessionId;
        pushHistory();
        void api
          .editCanvasText(id, {
            selector: pickSelector(pick),
            text: pick.text,
          })
          .then((updated) => {
            if (selectedIdRef.current !== id) return;
            dispatch({ type: "session", session: updated });
            setEditing(false);
            setCanvasError(null);
          })
          .catch((err) => {
            if (selectedIdRef.current !== id) return;
            setCanvasError(actionError(err, "Could not edit that text"));
          });
        return;
      }
      if (event.data?.type === "locus-asset-stats") {
        setStudioStats(parseAssetStudioStats(event.data.stats));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [commenting, editing, inspecting, dispatch, sessionId, viewport]);

  const previewHtml = htmlOwnerId === sessionId ? pickCanvasHtml(liveHtml, html, turning) : html;
  const canvasId = htmlOwnerId ?? sessionId;
  const swapping = Boolean(sessionId && (swapLoading || htmlOwnerId !== sessionId));
  const game = session ? isGameSession(session) : false;
  const assets = session ? isAssetSession(session) : false;
  const feel = feelFromTune(session?.designTune);
  const pose = poseFromTune(session?.designTune);
  const appliedBuild = resolveAppliedAssetBuild(session);
  const buildDirty = assets && !assetBuildEquals(assetBuild, appliedBuild);
  const assetSubject = inferAssetSubject({
    html: previewHtml,
    title: session?.title,
    recipeId: session?.designSystemId,
  });
  const showAssetPose = assets && assetShowsPose(assetSubject, previewHtml);
  const showStage3d = assets && assetShowsStage3d(assetSubject);
  const faceCount = assetFaceCount(studioStats);
  const facesOverBudget = assetFacesOverBudget(studioStats, assetBuild.polyBudget);
  const visibleIterate = assets ? assetVisibleIterateChips(assetSubject) : [];
  const canUndo = Boolean(
    assets && (session?.designVariants ?? []).some((row) => row.id === ASSET_UNDO_VARIANT_ID),
  );
  const visibleClips = assets
    ? assetVisibleClips({ html: previewHtml, title: session?.title })
    : ASSET_CLIPS;
  const visiblePosePresets = assets
    ? assetVisiblePosePresets({ html: previewHtml, title: session?.title })
    : [];
  const controlsLegend = parseGameControls(previewHtml ?? "");
  const paintedHtml = useMemo(() => {
    if (!previewHtml?.trim()) return null;
    return paintCanvasHtml({
      html: previewHtml,
      session: {
        id: session?.id ?? canvasId ?? "",
        kind: session?.kind,
        palette: session?.palette,
        designSystemId: session?.designSystemId,
        designTune: session?.designTune,
      },
      systems: state.designSystems,
      palette,
    });
  }, [
    previewHtml,
    palette,
    game,
    assets,
    canvasId,
    session?.id,
    session?.kind,
    session?.palette,
    session?.designSystemId,
    session?.designTune,
    session?.designTune?.radiusPx,
    session?.designTune?.spacePx,
    session?.designTune?.fontPx,
    session?.designTune?.gravity,
    session?.designTune?.jump,
    session?.designTune?.fireRate,
    session?.designTune?.shake,
    session?.designTune?.hitStop,
    session?.designTune?.volume,
    session?.designTune?.seed,
    session?.designTune?.head,
    session?.designTune?.arms,
    session?.designTune?.legs,
    session?.designTune?.twist,
    state.designSystems,
  ]);
  const serveHttp = canvasShouldServeHttp(paintedHtml);
  const srcDoc = useMemo(() => {
    if (!paintedHtml) return null;
    if (serveHttp) return paintedHtml;
    return finishCanvasSrcDoc(paintedHtml, {
      session: {
        id: session?.id ?? canvasId ?? "",
        kind: session?.kind,
      },
      interaction:
        editing && htmlOwnerId === sessionId
          ? "edit"
          : commenting && htmlOwnerId === sessionId
            ? "comment"
            : inspecting && htmlOwnerId === sessionId
              ? "inspect"
              : false,
      filesBase: canvasId
        ? `/api/sessions/${encodeURIComponent(canvasId)}/canvas-files/`
        : undefined,
      pins: session?.designPins,
    });
  }, [
    paintedHtml,
    serveHttp,
    commenting,
    editing,
    inspecting,
    canvasId,
    htmlOwnerId,
    sessionId,
    game,
    assets,
    session?.id,
    session?.kind,
    session?.designPins,
  ]);
  const httpFrame =
    serveHttp && canvasId
      ? canvasHttpFrameSrc(
          canvasFilesPreviewUrl(canvasId, {
            pick: (commenting || inspecting) && htmlOwnerId === sessionId,
            edit: editing && htmlOwnerId === sessionId,
          }),
          window.location.origin,
        )
      : undefined;
  const httpSrc = httpFrame?.src;
  const httpIsolated = httpFrame?.isolated;

  function exportHtml() {
    if (!paintedHtml?.trim()) return;
    const blob = new Blob([paintedHtml], { type: "text/html;charset=utf-8" });
    downloadBlob(blob, `${(session?.title ?? "design").replace(/[^\w.-]+/g, "-")}.html`);
  }

  async function restoreHistory(at: number) {
    const snap = history.current[at];
    const id = sessionId;
    if (!snap || !id) return;
    setHistoryAt(at);
    historyAtRef.current = at;
    setPalette(snap.palette);
    try {
      await api.saveWorkspaceFile(id, "index.html", snap.html);
      if (selectedIdRef.current !== id) return;
      dispatch({ type: "canvas", sessionId: id, html: snap.html });
      setHtml(snap.html);
      const updated = await api.patchSession(id, {
        palette: snap.palette,
        designTune: snap.tune ?? null,
      });
      if (selectedIdRef.current !== id) return;
      dispatch({ type: "session", session: updated });
      setCanvasError(null);
    } catch (err) {
      if (selectedIdRef.current !== id) return;
      setCanvasError(actionError(err, "Could not restore that step"));
    }
  }

  async function promote() {
    if (!sessionId || promoting) return;
    const id = sessionId;
    setPromoting(true);
    setCanvasError(null);
    try {
      const { agent, design } = await api.promote(id, { scaffold });
      if (selectedIdRef.current !== id) return;
      dispatch({ type: "session", session: design });
      dispatch({ type: "session", session: agent });
    } catch (err) {
      if (selectedIdRef.current !== id) return;
      setCanvasError(actionError(err, "Could not promote"));
    } finally {
      if (selectedIdRef.current === id) setPromoting(false);
    }
  }

  async function explore() {
    if (!sessionId || exploring || turning) return;
    const id = sessionId;
    setExploring(true);
    setCanvasError(null);
    try {
      const updated = await api.exploreDesignDirections(id);
      if (selectedIdRef.current !== id) return;
      dispatch({ type: "session", session: updated });
    } catch (err) {
      if (selectedIdRef.current !== id) return;
      setCanvasError(actionError(err, "Could not explore directions"));
    } finally {
      if (selectedIdRef.current === id) setExploring(false);
    }
  }

  async function snapshotVariant(name: string, id: string, keepActive = true) {
    if (!sessionId || !html?.trim()) return;
    try {
      const updated = await api.createDesignVariant(sessionId, name, { id, keepActive });
      dispatch({ type: "session", session: updated });
    } catch {
      /* snapshot is best-effort */
    }
  }

  async function snapshotUndo() {
    await snapshotVariant("Before generate", ASSET_UNDO_VARIANT_ID, true);
  }

  async function snapshotLive() {
    const active = session?.activeVariantId;
    if (active && active !== ASSET_LIVE_VARIANT_ID) return;
    await snapshotVariant("Live", ASSET_LIVE_VARIANT_ID, true);
  }

  async function restoreLive() {
    if (!sessionId) return;
    const live = (session?.designVariants ?? []).find((row) => row.id === ASSET_LIVE_VARIANT_ID);
    if (!live || session?.activeVariantId === ASSET_LIVE_VARIANT_ID || !session?.activeVariantId) {
      setCompareOn(false);
      return;
    }
    await activateVariant(ASSET_LIVE_VARIANT_ID);
  }

  async function undoLastPass() {
    if (!sessionId) return;
    const undo = (session?.designVariants ?? []).find((row) => row.id === ASSET_UNDO_VARIANT_ID);
    if (!undo) return;
    await activateVariant(ASSET_UNDO_VARIANT_ID);
    setCompareOn(false);
  }

  async function toggleCompare() {
    if (!sessionId) return;
    if (compareOn) {
      setCompareOn(false);
      return;
    }
    const file = await api
      .workspaceFile(sessionId, `.locus-variants/${ASSET_UNDO_VARIANT_ID}.html`)
      .catch(() => undefined);
    if (!file?.content?.trim()) return;
    setCompareHtml(file.content);
    setCompareOn(true);
  }

  async function activateVariant(id: string) {
    if (!sessionId || swapLoading || id === session?.activeVariantId) return;
    const sid = sessionId;
    if (id !== ASSET_LIVE_VARIANT_ID && id !== ASSET_UNDO_VARIANT_ID) {
      await snapshotLive();
    }
    if (selectedIdRef.current !== sid) return;
    variantSwapAwaitingHtml.current = true;
    setSwapLoading(true);
    const previous = liveHtmlRef.current ?? html;
    try {
      const updated = await api.activateDesignVariant(sid, id);
      if (selectedIdRef.current !== sid) {
        variantSwapAwaitingHtml.current = false;
        return;
      }
      dispatch({ type: "session", session: updated });
      const canvas = await api.canvas(sid);
      if (selectedIdRef.current !== sid) {
        variantSwapAwaitingHtml.current = false;
        return;
      }
      if (!canvas.html?.trim()) {
        variantSwapAwaitingHtml.current = false;
        setSwapLoading(false);
        return;
      }
      dispatch({ type: "canvas", sessionId: sid, html: canvas.html });
      htmlSessionId.current = sid;
      setHtmlOwnerId(sid);
      setHtml(canvas.html);
      const same = canvas.html === previous;
      variantSwapAwaitingHtml.current = false;
      if (same) setSwapLoading(false);
      else setPaintEpoch((n) => n + 1);
    } catch (err) {
      if (selectedIdRef.current !== sid) return;
      variantSwapAwaitingHtml.current = false;
      setSwapLoading(false);
      setCanvasError(actionError(err, "Could not switch variant"));
    }
  }

  function patchTune(next: DesignTune) {
    if (!sessionId) return;
    pushHistory();
    const id = sessionId;
    void api
      .patchSession(id, { designTune: next })
      .then((updated) => {
        if (selectedIdRef.current !== id) return;
        dispatch({ type: "session", session: updated });
      })
      .catch((err) => {
        if (selectedIdRef.current !== id) return;
        setCanvasError(actionError(err, "Could not update canvas knobs"));
      });
    if (game) {
      postGame({
        type: "locus-game-feel",
        feel: feelFromTune({ ...session?.designTune, ...next }),
      });
    }
    if (assets) {
      postGame({
        type: "locus-asset-pose",
        pose: poseFromTune({ ...session?.designTune, ...next }),
      });
    }
  }

  function postGame(payload: Record<string, unknown>) {
    try {
      frame.current?.contentWindow?.postMessage(payload, "*");
    } catch {
      /* unique-origin frames still accept postMessage */
    }
  }

  const closeAssetExport = useCallback(() => setAssetExport(null), []);

  function startAssetExport(format: AssetExportFormat) {
    if (!html?.trim()) return;
    assetExportGotFile.current = false;
    setAssetExport({
      format,
      phase: "save",
      percent: 0,
      filename: assetExportFileName(session?.title ?? "asset", format),
      folder: loadAssetExportDir(),
    });
  }

  function confirmAssetExport(next: { filename: string; folder: string }) {
    const current = assetExportRef.current;
    if (!current) return;
    const filename = withAssetExportExtension(next.filename, current.format);
    const folder = next.folder.trim();
    if (!filename || !folder) return;
    rememberAssetExportDir(folder);
    assetExportGotFile.current = false;
    setAssetExport({
      ...current,
      filename,
      folder,
      phase: "start",
      percent: 8,
      error: undefined,
    });
    postGame({ type: "locus-asset-export", format: current.format, filename });
  }

  async function persistAssetExport(file: {
    format: AssetExportFormat;
    filename: string;
    mime?: string;
    base64: string;
  }) {
    const current = assetExportRef.current;
    if (!current || current.format !== file.format) return;
    const filename = current.filename || file.filename;
    const folder = current.folder?.trim() ?? "";
    assetExportGotFile.current = true;
    try {
      if (folder) {
        await api.saveHostFile({ dir: folder, filename, contentBase64: file.base64 });
      } else {
        const bytes = Uint8Array.from(atob(file.base64), (ch) => ch.charCodeAt(0));
        downloadBlob(
          new Blob([bytes], { type: file.mime || "application/octet-stream" }),
          filename,
        );
      }
      if (assetExportRef.current?.format !== file.format) return;
      setAssetExport((job) =>
        job && job.format === file.format ? { ...job, phase: "done", percent: 100 } : job,
      );
    } catch (err) {
      if (assetExportRef.current?.format !== file.format) return;
      setAssetExport((job) =>
        job && job.format === file.format
          ? {
              ...job,
              phase: "error",
              error: actionError(err, "Could not save the exported file"),
            }
          : job,
      );
    }
  }

  const assetExportBusy = Boolean(
    assetExport && assetExport.phase !== "done" && assetExport.phase !== "error",
  );

  function applyAssetZoom(next: number) {
    const scale = clampAssetZoom(next);
    setAssetZoom(scale);
    postGame({ type: "locus-asset-zoom", scale });
  }

  async function runPlaytest() {
    if (!sessionId || playtesting) return;
    const id = sessionId;
    setPlaytesting(true);
    setPlaytestReport(null);
    try {
      await api.execTool(id, "preview", {}).catch(() => undefined);
      if (selectedIdRef.current !== id) return;
      const result = await api.execTool(id, "playwright", {
        steps: defaultGamePlaytestSteps(previewHtml ?? ""),
        screenshot: true,
        viewport:
          viewport === "landscape" ? "landscape" : viewport === "phone" ? "phone" : "desktop",
      });
      const report = result.output ?? "Playtest finished";
      if (selectedIdRef.current !== id) return;
      setPlaytestReport(report);
      if (result.screenshotBase64) {
        setLastShot(result.screenshotBase64);
        dispatch({ type: "gameShot", sessionId: id, image: result.screenshotBase64 });
      }
      const stats = parsePlaytestStats(report);
      const run = {
        at: new Date().toISOString(),
        seed: session?.designTune?.seed ?? 0,
        ...stats,
        keys: lastKeys.map(tapeEventCode),
        tape: lastTape.length ? lastTape : lastKeys,
        playtest: report,
        playable: playtestLooksPlayable(report),
      };
      setLastRun(run);
      if (stats.score != null || stats.deaths != null || stats.time != null) setLiveStats(stats);
      await api
        .saveWorkspaceFile(id, GAME_LAST_RUN_PATH, formatGameLastRun(run))
        .catch(() => undefined);
    } catch (err) {
      if (selectedIdRef.current !== id) return;
      setPlaytestReport(err instanceof Error ? err.message : "Playtest failed");
    } finally {
      if (selectedIdRef.current === id) setPlaytesting(false);
    }
  }

  async function recordPlay() {
    if (!sessionId || recordingPlay) return;
    const id = sessionId;
    setRecordingPlay(true);
    try {
      await api.execTool(id, "preview", {}).catch(() => undefined);
      if (selectedIdRef.current !== id) return;
      await api.execTool(id, "record_screen", { mode: "START_RECORDING" }).catch(() => undefined);
      if (selectedIdRef.current !== id) return;
      const started = Date.now();
      await api.execTool(id, "playwright", {
        steps: [...defaultGamePlaytestSteps(previewHtml ?? ""), "wait body"],
        screenshot: true,
        viewport: viewport === "landscape" ? "landscape" : "desktop",
      });
      if (selectedIdRef.current !== id) return;
      const remaining = Math.max(0, GAME_RECORD_MS - (Date.now() - started));
      await new Promise<void>((resolve) => {
        recordWait.current = window.setTimeout(() => {
          recordWait.current = null;
          resolve();
        }, remaining);
      });
      if (selectedIdRef.current !== id) return;
      await api
        .execTool(id, "record_screen", {
          mode: "SAVE_RECORDING",
          save_as_filename: "playtest",
        })
        .catch(() => undefined);
    } catch (err) {
      if (selectedIdRef.current !== id) return;
      setCanvasError(actionError(err, "Could not record play"));
    } finally {
      if (selectedIdRef.current === id) setRecordingPlay(false);
    }
  }

  function enterPlay(on = true) {
    setPlayMode(on);
    if (on) {
      setCommenting(false);
      setEditing(false);
      setControlsOpen(true);
      postGame({ type: "locus-game-unlock" });
      postGame({ type: "locus-game-play", on: true });
      setGamepadOn(true);
      postGame({ type: "locus-game-gamepad", on: true });
      queueMicrotask(() => frame.current?.contentWindow?.focus());
    }
  }

  function popOutPlay() {
    const url = httpSrc || "";
    if (url) {
      window.open(url, "locus-game-play", "popup,width=900,height=520");
      return;
    }
    const w = window.open("about:blank", "locus-game-play", "popup,width=900,height=520");
    const page = srcDoc || (paintedHtml ? withGameChromeHook(paintedHtml) : "");
    if (!w || !page) return;
    w.document.open();
    w.document.write(page);
    w.document.close();
  }

  async function exportZip() {
    if (!sessionId || exportingZip) return;
    const id = sessionId;
    setExportingZip(true);
    try {
      let gdd = "";
      try {
        gdd = (await api.workspaceFile(id, GAME_GDD_PATH))?.content ?? "";
      } catch {
        /* GDD is optional */
      }
      if (selectedIdRef.current === id) {
        setReleaseLines(
          gameReleaseChecklist({ html: previewHtml ?? "", gdd }).map(
            (row) => `${row.ok ? "ok" : "miss"} ${row.label}`,
          ),
        );
      }
      const pack = await api.exportGameZip(id);
      if (selectedIdRef.current !== id) return;
      const bytes = Uint8Array.from(atob(pack.zipBase64), (ch) => ch.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/zip" });
      downloadBlob(blob, pack.filename || "game.zip");
    } catch (err) {
      if (selectedIdRef.current !== id) return;
      setCanvasError(actionError(err, "Could not export zip"));
      exportHtml();
    } finally {
      if (selectedIdRef.current === id) setExportingZip(false);
    }
  }

  async function exportPng() {
    if (!sessionId || exportingPng || !html?.trim()) return;
    const id = sessionId;
    setExportingPng(true);
    setCanvasError(null);
    try {
      const result = await api.execTool(id, "playwright", {
        steps: ["wait body"],
        screenshot: true,
        viewport:
          viewport === "landscape" ? "landscape" : viewport === "phone" ? "phone" : "desktop",
      });
      if (selectedIdRef.current !== id) return;
      const shot = result.screenshotBase64;
      if (!shot) throw new Error("PNG export did not return a screenshot");
      const bytes = Uint8Array.from(atob(shot), (ch) => ch.charCodeAt(0));
      downloadBlob(
        new Blob([bytes], { type: "image/png" }),
        `${(session?.title ?? "design").replace(/[^\w.-]+/g, "-")}.png`,
      );
    } catch (err) {
      if (selectedIdRef.current !== id) return;
      setCanvasError(actionError(err, "Could not export PNG"));
    } finally {
      if (selectedIdRef.current === id) setExportingPng(false);
    }
  }

  function iterateCtx(balanceRuns?: NonNullable<ReturnType<typeof parseGameLastRun>>[]) {
    return {
      feel,
      seed: session?.designTune?.seed ?? 0,
      lastRun,
      balanceRuns,
    };
  }

  async function sendIterate(id: string) {
    if (!sessionId) return;
    if (iterating) {
      pendingIterate.current = id;
      return;
    }
    setIterating(id);
    try {
      if (assets) {
        await snapshotUndo();
        await api.chat(
          sessionId,
          iterateAssetPrompt(id as (typeof ASSET_ITERATE_CHIPS)[number]["id"], {
            pose,
            title: session?.title,
            style: resolveAssetStyle(session?.assetStyleId, state.assetStyles),
          }),
        );
      } else {
        const balanceRuns =
          id === "balance" && html?.trim() && !isSessionWorking(session?.status)
            ? await collectBalanceRuns()
            : undefined;
        await api.chat(
          sessionId,
          iterateGamePrompt(
            id as (typeof GAME_ITERATE_CHIPS)[number]["id"],
            iterateCtx(balanceRuns),
          ),
        );
      }
    } catch {
      /* stay on the canvas */
    } finally {
      setIterating(null);
    }
  }

  async function fixFromPlaytest() {
    if (!sessionId || iterating) return;
    setIterating("fix");
    try {
      const pin = studio?.moments[studio.moments.length - 1];
      await api.chat(
        sessionId,
        `${fixFromPlaytestPrompt({
          report: playtestReport ?? "",
          feel,
          seed: session?.designTune?.seed ?? 0,
          tape: lastTape.length ? lastTape : lastKeys,
          lastRun,
        })}${pin ? `\n\n${formatMomentFix(pin)}` : ""}`,
        lastShot
          ? {
              attachments: [{ name: "playtest.png", mime: "image/png", contentBase64: lastShot }],
            }
          : undefined,
      );
    } catch {
      /* stay on the canvas */
    } finally {
      setIterating(null);
    }
  }

  async function applyBuild() {
    if (!sessionId || iterating) return;
    setIterating("build");
    try {
      if (html?.trim()) await snapshotUndo();
      const snapshot = assetBuild;
      await api.chat(
        sessionId,
        generateAssetPrompt(
          snapshot,
          Boolean(html?.trim()),
          resolveAssetStyle(session?.assetStyleId, state.assetStyles),
        ),
      );
      await markApplied(snapshot);
    } catch {
      /* stay on the canvas */
    } finally {
      setIterating(null);
    }
  }

  async function saveStyleFromStudio() {
    if (!sessionId) return;
    try {
      await api.saveAssetStyleFromSession(sessionId);
      const catalog = await api.assetStyles();
      dispatch({ type: "assetStyleList", styles: catalog.styles });
      const updated = await api.session(sessionId);
      dispatch({ type: "session", session: updated });
    } catch {
      /* still open the editor so the operator can capture the look */
    }
    dispatch({ type: "assetStyles", open: true });
  }

  async function saveStyleFromGame() {
    if (!sessionId) return;
    try {
      await api.saveGameStyleFromSession(sessionId);
      const catalog = await api.gameStyles();
      dispatch({ type: "gameStyleList", styles: catalog.styles });
      const updated = await api.session(sessionId);
      dispatch({ type: "session", session: updated });
    } catch {
      /* still open the editor so the operator can capture the look */
    }
    dispatch({ type: "gameStyles", open: true });
  }

  function persistStudio(next: GameStudioState) {
    setStudio(next);
    if (!sessionId) return;
    void api
      .saveWorkspaceFile(sessionId, GAME_STUDIO_PATH, formatGameStudio(next))
      .catch(() => undefined);
  }

  async function pinBuild(name: string) {
    if (!sessionId || !html?.trim()) return;
    const id = `b${Date.now().toString(36)}`;
    try {
      const updated = await api.createDesignVariant(sessionId, name, { id, keepActive: true });
      if (selectedIdRef.current !== sessionId) return;
      dispatch({ type: "session", session: updated });
      return id;
    } catch (err) {
      if (selectedIdRef.current === sessionId) {
        setCanvasError(actionError(err, "Could not pin build"));
      }
    }
  }

  async function splitLive() {
    if (!sessionId) return;
    try {
      const updated = await api.splitLiveGame(sessionId);
      if (selectedIdRef.current !== sessionId) return;
      dispatch({ type: "session", session: updated });
    } catch (err) {
      if (selectedIdRef.current === sessionId) {
        setCanvasError(actionError(err, "Could not split the live game"));
      }
    }
  }

  async function copyPlayLink() {
    if (!sessionId) return;
    try {
      const link = await api.playLink(sessionId);
      const text = [link.url, ...link.lanUrls].filter(Boolean).join("\n");
      await navigator.clipboard.writeText(text);
      setPlayLink({ url: link.url, lanUrls: link.lanUrls });
      setPlayLinkCopied(true);
      window.setTimeout(() => setPlayLinkCopied(false), 2000);
    } catch (err) {
      setCanvasError(actionError(err, "Could not mint a play link"));
    }
  }

  async function generateFromGame(kind: string) {
    if (!sessionId || generatingKind) return;
    const id = sessionId;
    setGeneratingKind(kind);
    setCanvasError(null);
    try {
      const result = await api.generateGameAsset(id, kind);
      if (selectedIdRef.current !== id) return;
      dispatch({ type: "session", session: result.game });
      if (result.asset) dispatch({ type: "session", session: result.asset });
    } catch (err) {
      if (selectedIdRef.current !== id) return;
      setCanvasError(actionError(err, "Could not generate that asset"));
    } finally {
      if (selectedIdRef.current === id) setGeneratingKind(null);
    }
  }

  async function collectBalanceRuns() {
    if (!sessionId) return [];
    const id = sessionId;
    const base = session?.designTune?.seed ?? 0;
    const runs: NonNullable<ReturnType<typeof parseGameLastRun>>[] = [];
    for (let i = 0; i < GAME_BALANCE_RUNS; i++) {
      const seed = base + i;
      postGame({ type: "locus-game-seed", seed });
      const result = await api
        .execTool(id, "playwright", {
          steps: [`seed ${seed}`, ...defaultGamePlaytestSteps(previewHtml ?? "")],
          screenshot: i === 0,
          viewport:
            viewport === "landscape" ? "landscape" : viewport === "phone" ? "phone" : "desktop",
        })
        .catch(() => undefined);
      if (selectedIdRef.current !== id) return runs;
      const report = result?.output ?? "";
      const stats = parsePlaytestStats(report);
      if (result?.screenshotBase64) {
        setLastShot(result.screenshotBase64);
        dispatch({ type: "gameShot", sessionId: id, image: result.screenshotBase64 });
      }
      runs.push({
        at: new Date().toISOString(),
        seed,
        ...stats,
        keys: lastKeys.map(tapeEventCode),
        tape: lastTape.length ? lastTape : lastKeys,
        playtest: report,
        playable: playtestLooksPlayable(report),
      });
    }
    const last = runs[runs.length - 1];
    if (last) {
      setLastRun(last);
      await api
        .saveWorkspaceFile(id, GAME_LAST_RUN_PATH, formatGameLastRun(last))
        .catch(() => undefined);
    }
    return runs;
  }

  async function dropAssetPhotos(incoming: File[], slot?: AssetViewSlot) {
    if (!sessionId || !incoming.length) return;
    const oversize = firstOversizeAttachment(incoming);
    if (oversize) {
      setCanvasError(oversize);
      return;
    }
    const images = incoming.filter(isImageFile);
    if (!images.length) return;
    setViewSlots((current) =>
      slot && images[0]
        ? { ...assignImageSlots(images.slice(1), current), [slot]: images[0] }
        : assignImageSlots(images, current),
    );
    const target = slot ?? "front";
    try {
      const attachments = await filesToAttachments(images.slice(0, 3));
      await api.chat(sessionId, dropAssetPhotoPrompt(target, Boolean(html?.trim())), {
        attachments,
      });
    } catch {
      /* stay on the canvas */
    }
  }

  async function applyBrief() {
    if (!sessionId || iterating) return;
    setIterating("brief");
    try {
      if (assets) {
        const file = await api.workspaceFile(sessionId, ASSET_BRIEF_PATH).catch(() => undefined);
        await api.chat(
          sessionId,
          applyAssetBriefPrompt(
            file?.content?.trim() ||
              livingAssetBrief({
                title: session?.title,
                build: assetBuild,
                style: resolveAssetStyle(session?.assetStyleId, state.assetStyles),
              }),
          ),
        );
      } else {
        const [file, gdd] = await Promise.all([
          api.workspaceFile(sessionId, GAME_BRIEF_PATH).catch(() => undefined),
          api.workspaceFile(sessionId, GAME_GDD_PATH).catch(() => undefined),
        ]);
        await api.chat(
          sessionId,
          applyGameBriefPrompt(
            file?.content?.trim() ||
              livingGameBrief({
                title: session?.title,
                controls: controlsLegend,
                feel,
                seed: session?.designTune?.seed,
              }),
            gdd?.content,
          ),
        );
      }
    } catch {
      /* stay on the canvas */
    } finally {
      setIterating(null);
    }
  }

  async function keepFeel() {
    if (!sessionId || iterating) return;
    setIterating(assets ? "pose" : "feel");
    try {
      if (assets) {
        const brief = livingAssetBrief({
          title: session?.title,
          notes: [`pose head=${pose.head} arms=${pose.arms} legs=${pose.legs} twist=${pose.twist}`],
          build: assetBuild,
          style: resolveAssetStyle(session?.assetStyleId, state.assetStyles),
        });
        await api.saveWorkspaceFile(sessionId, ASSET_BRIEF_PATH, brief).catch(() => undefined);
        await api.chat(sessionId, keepPosePrompt(pose));
      } else {
        const brief = livingGameBrief({
          title: session?.title,
          controls: controlsLegend,
          feel,
          seed: session?.designTune?.seed,
        });
        await api.saveWorkspaceFile(sessionId, GAME_BRIEF_PATH, brief).catch(() => undefined);
        await api.chat(sessionId, keepFeelPrompt(feel, session?.designTune?.seed ?? 0));
      }
    } catch {
      /* stay on the canvas */
    } finally {
      setIterating(null);
    }
  }

  useEffect(() => {
    if (!game || !srcDoc) return;
    postGame({
      type: "locus-game-feel",
      feel: { ...feelFromTune(session?.designTune), seed: session?.designTune?.seed ?? 0 },
    });
    postGame({ type: "locus-game-debug", on: debugOn });
    postGame({ type: "locus-game-touch", on: touchStick });
    postGame({ type: paused ? "locus-game-pause" : "locus-game-resume" });
    postGame({ type: "locus-game-mute", on: muted });
    postGame({ type: "locus-game-play", on: playMode });
    postGame({ type: "locus-game-seed", seed: session?.designTune?.seed ?? 0 });
    postGame({ type: "locus-game-stats-request" });
    if (studio) {
      postGame({ type: "locus-game-remap", map: studio.inputMap });
      postGame({ type: "locus-game-hud", large: studio.hudLarge });
      postGame({ type: "locus-game-recipe-feel", feel: studio.extraFeel });
    }
  }, [
    game,
    srcDoc,
    chromeReady,
    debugOn,
    paused,
    touchStick,
    muted,
    playMode,
    session?.designTune?.gravity,
    session?.designTune?.jump,
    session?.designTune?.fireRate,
    session?.designTune?.shake,
    session?.designTune?.hitStop,
    session?.designTune?.volume,
    session?.designTune?.seed,
    studio,
  ]);

  useEffect(() => {
    if (!assets || !srcDoc) return;
    postGame({ type: "locus-asset-stats-request" });
  }, [assets, srcDoc]);

  useEffect(() => {
    if (!assets || !srcDoc) return;
    postGame({ type: "locus-asset-orbit", on: orbitOn });
  }, [assets, srcDoc, orbitOn]);

  useEffect(() => {
    if (!assets || !srcDoc) return;
    postGame({ type: "locus-asset-wireframe", on: wireframeOn });
  }, [assets, srcDoc, wireframeOn]);

  useEffect(() => {
    if (!assets || !srcDoc) return;
    postGame({ type: "locus-asset-zoom", scale: assetZoom });
  }, [assets, srcDoc, assetZoom]);

  useEffect(() => {
    if (!assets || !srcDoc) return;
    postGame({ type: "locus-asset-camera", view: cameraView });
  }, [assets, srcDoc, cameraView]);

  useEffect(() => {
    if (!assets || !srcDoc) return;
    postGame({ type: "locus-asset-grid", on: gridOn });
  }, [assets, srcDoc, gridOn]);

  useEffect(() => {
    if (!assets || !srcDoc) return;
    postGame({ type: "locus-asset-material", id: material });
  }, [assets, srcDoc, material]);

  useEffect(() => {
    if (!assets || !srcDoc) return;
    postGame({ type: "locus-asset-lights", id: assetLights });
  }, [assets, srcDoc, assetLights]);

  useEffect(() => {
    if (!assets || !srcDoc) return;
    postGame({ type: "locus-asset-units", units: assetUnits });
  }, [assets, srcDoc, assetUnits]);

  useEffect(() => {
    if (!assets || !srcDoc) return;
    postGame({ type: "locus-asset-background", id: assetBackground });
  }, [assets, srcDoc, assetBackground]);

  useEffect(() => {
    if (!assets || !srcDoc) return;
    postGame({ type: "locus-asset-isolate", part: isolatePart });
  }, [assets, srcDoc, isolatePart]);

  useEffect(() => {
    if (!assets || !srcDoc) return;
    postGame({ type: "locus-asset-speed", rate: clipSpeed });
  }, [assets, srcDoc, clipSpeed]);

  useEffect(() => {
    if (!assets || !srcDoc) return;
    postGame({ type: "locus-asset-pose", pose });
  }, [
    assets,
    srcDoc,
    session?.designTune?.head,
    session?.designTune?.arms,
    session?.designTune?.legs,
    session?.designTune?.twist,
  ]);

  useEffect(() => {
    if (!assets) return;
    function onMessage(event: MessageEvent) {
      if (frame.current?.contentWindow && event.source !== frame.current.contentWindow) return;
      const data = event.data;
      if (!data) return;
      if (data.type === "locus-asset-zoom-changed") {
        const scale = clampAssetZoom(Number(data.scale));
        setAssetZoom((current) => (current === scale ? current : scale));
        return;
      }
      const file = parseAssetExportFile(data);
      if (file) {
        void persistAssetExport(file);
        return;
      }
      const bytes = parseAssetExportBytes(data);
      if (bytes && sessionId) {
        void api
          .ingestAssetPack(sessionId, {
            format: bytes.format,
            mime: bytes.mime,
            filename: bytes.filename,
            contentBase64: bytes.contentBase64,
          })
          .then((pack) => {
            if (pack && typeof pack === "object" && "slug" in pack) {
              void api.session(sessionId).then((updated) => {
                dispatch({ type: "session", session: updated });
              });
            }
          })
          .catch(() => undefined);
        return;
      }
      const progress = parseAssetExportProgress(data);
      if (!progress) return;
      setAssetExport((current) => {
        if (!current || current.format !== progress.format || current.phase === "save") {
          return current;
        }
        if (progress.phase === "done") {
          if (!assetExportGotFile.current) {
            return {
              ...current,
              phase: "error",
              percent: progress.percent,
              error: ASSET_EXPORT_MISSING_FILE,
            };
          }
          return current;
        }
        return {
          ...progress,
          filename: current.filename,
          folder: current.folder,
        };
      });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [assets, sessionId, dispatch]);

  useEffect(() => {
    if (!assets || !srcDoc) return;
    const id = window.setTimeout(() => {
      postGame({ type: "locus-asset-pack-capture" });
    }, 1200);
    return () => window.clearTimeout(id);
  }, [assets, srcDoc]);

  useEffect(() => {
    if (
      !assetExport ||
      assetExport.phase === "done" ||
      assetExport.phase === "error" ||
      assetExport.phase === "save"
    ) {
      return;
    }
    const id = window.setTimeout(() => {
      setAssetExport((current) => {
        if (!current || current.phase === "done" || current.phase === "error") return current;
        return {
          ...current,
          phase: "error",
          error: "Export is taking too long. The download may still finish.",
        };
      });
    }, ASSET_EXPORT_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [assetExport?.format, assetExport?.phase, assetExport?.percent]);

  useEffect(() => {
    if (iterating || !pendingIterate.current) return;
    const id = pendingIterate.current;
    pendingIterate.current = null;
    void sendIterate(id);
  }, [iterating]);

  useEffect(() => {
    if (!assets || !sessionId) {
      setSourcePreviews({});
      return;
    }
    let cancelled = false;
    const next: Partial<Record<AssetViewSlot, string>> = {};
    void Promise.all(
      ASSET_VIEW_SLOTS.map(
        (slot) =>
          new Promise<void>((resolve) => {
            const url = assetCanvasFileUrl(sessionId, ASSET_VIEW_FILES[slot]);
            const img = new Image();
            img.onload = () => {
              next[slot] = url;
              resolve();
            };
            img.onerror = () => resolve();
            img.src = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
          }),
      ),
    ).then(() => {
      if (!cancelled) setSourcePreviews(next);
    });
    return () => {
      cancelled = true;
    };
  }, [assets, sessionId, html, turning]);

  useEffect(() => {
    if (!game) return;
    function onMessage(event: MessageEvent) {
      if (!isFromCanvasFrame(event, frame.current)) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "locus-game-keys" && Array.isArray(data.keys)) {
        setLastKeys(data.keys.map((row: unknown) => String(row)));
      }
      if (data.type === "locus-game-tape") {
        if (Array.isArray(data.keys)) setLastKeys(data.keys.map((row: unknown) => String(row)));
        if (Array.isArray(data.tape)) {
          setLastTape(
            data.tape.map((row: unknown) =>
              typeof row === "string"
                ? row
                : row && typeof row === "object" && "code" in row
                  ? String((row as { code: unknown }).code)
                  : String(row),
            ),
          );
        }
      }
      if (data.type === "locus-game-gamepad") {
        setGamepadOn(!!data.on);
      }
      if (data.type === "locus-game-stats" && data.stats && typeof data.stats === "object") {
        const stats = data.stats as Record<string, unknown>;
        const num = (value: unknown) =>
          value == null || value === "" || !Number.isFinite(Number(value))
            ? undefined
            : Number(value);
        setLiveStats({
          score: num(stats.score),
          deaths: num(stats.deaths),
          time: num(stats.time),
          fps: num(stats.fps),
        });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [game]);

  useEffect(() => {
    if (!game) return;
    function typing(target: EventTarget | null) {
      return (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      );
    }
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (playMode) {
        if (event.key === "Escape") {
          event.preventDefault();
          setPlayMode(false);
          return;
        }
        if (typing(event.target)) return;
        if (
          paused &&
          event.type === "keydown" &&
          (event.code === "Comma" || event.code === "Period")
        ) {
          event.preventDefault();
          postGame({ type: "locus-game-step", dir: event.code === "Period" ? 1 : -1 });
          return;
        }
        event.preventDefault();
        postGame({
          type: "locus-game-input",
          code: event.code,
          key: event.key,
          down: event.type === "keydown",
        });
        return;
      }
      if (typing(event.target)) return;
      const key = event.key.toLowerCase();
      if (event.type !== "keydown") return;
      if (key === "r") {
        event.preventDefault();
        postGame({ type: "locus-game-reset" });
      } else if (key === "p") {
        event.preventDefault();
        setPaused((v) => {
          const next = !v;
          postGame({ type: next ? "locus-game-pause" : "locus-game-resume" });
          return next;
        });
      } else if (key === "d") {
        event.preventDefault();
        setDebugOn((v) => {
          const next = !v;
          postGame({ type: "locus-game-debug", on: next });
          return next;
        });
      } else if (key === "m") {
        event.preventDefault();
        setMuted((v) => {
          const next = !v;
          postGame({ type: "locus-game-mute", on: next });
          return next;
        });
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [game, playMode, paused]);

  useEffect(() => {
    if (game || assets) return;
    function typing(target: EventTarget | null) {
      return (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      );
    }
    function onKey(event: KeyboardEvent) {
      if (typing(event.target)) return;
      if (!matchModKey(event, "z") && !matchModKey(event, "z", true)) return;
      event.preventDefault();
      if (matchModKey(event, "z", true)) {
        if (historyAtRef.current < history.current.length - 1) {
          void restoreHistory(historyAtRef.current + 1);
        }
        return;
      }
      if (historyAtRef.current >= 1) void restoreHistory(historyAtRef.current - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [game, assets]);

  if (!session) return null;

  if (showRail) {
    return (
      <aside className="vm-pane rail">
        <button
          type="button"
          className="vm-rail-toggle"
          title="Expand canvas"
          aria-label={`Expand canvas — ${working ? "agent working" : guestReady ? "idle" : (vm?.status ?? "stopped")}`}
          onClick={() => dispatch({ type: "toggleVmPane" })}
        >
          <IconPanelRight />
          <span
            className={`dot ${working ? "running" : guestReady ? "idle" : (vm?.status ?? "stopped")}`}
          />
          <span className="vm-rail-label">Canvas</span>
        </button>
      </aside>
    );
  }

  const viewports = game ? GAME_VIEWPORTS : VIEWPORTS;
  const activeViewport = viewports.find((item) => item.id === viewport);
  const width = mobile ? phone.width : (activeViewport?.width ?? 1280);
  const frameHeight = mobile
    ? phone.height
    : viewport === "landscape"
      ? GAME_LANDSCAPE.height
      : undefined;
  const agent = session.promotedAgentId
    ? state.sessions.find((row) => row.id === session.promotedAgentId)
    : undefined;
  const repo = session.repoId ? state.repos.find((row) => row.id === session.repoId) : undefined;
  const pull = session.pull ?? agent?.pull;
  const system = resolveDesignSystem(session.designSystemId, state.designSystems);
  const ranges = parseCanvasTuneAttrs(previewHtml ?? "");
  const spaceRange = ranges.find((row) => row.key === "space")!;
  const radiusRange = ranges.find((row) => row.key === "radius")!;
  const typeRange = ranges.find((row) => row.key === "type")!;
  const spacePx = session.designTune?.spacePx ?? system?.spacePx ?? 8;
  const radiusPx = session.designTune?.radiusPx ?? system?.radiusPx ?? 12;
  const fontPx = session.designTune?.fontPx ?? system?.typography.basePx ?? 16;
  const feelRanges = parseCanvasFeelAttrs(previewHtml ?? "");
  const poseRanges = parseCanvasPoseAttrs(previewHtml ?? "");
  const guestComingUp =
    starting || waitingStart || (session.status === "provisioning" && !guestReady);
  const canvasMeta = swapping
    ? "loading…"
    : building
      ? "building image"
      : guestComingUp
        ? "starting container"
        : working
          ? previewHtml?.trim()
            ? "agent updating canvas"
            : "agent working"
          : previewHtml?.trim()
            ? "index.html"
            : "waiting for a draft";

  return (
    <aside
      className={`vm-pane design-pane${working ? " is-working" : ""}${playMode ? " is-play-mode" : ""}${assets ? " is-asset" : ""}`}
    >
      <div className="vm-toolbar">
        <span className="vm-status">
          <span
            className={`dot ${working ? "running" : guestReady ? "idle" : (vm?.status ?? "stopped")}`}
          />
          <span className="vm-status-copy">
            <strong>Canvas</strong>
            <span className="meta">{canvasMeta}</span>
          </span>
        </span>
        <div className="vm-toolbar-actions">
          <div className="design-toolbar-group" role="group" aria-label="Appearance">
            {game || assets ? (
              <Select
                className="game-kit-select"
                compact
                ariaLabel={assets ? "Asset kit" : "Game kit"}
                value={session.designSystemId ?? ""}
                options={[
                  { value: "", label: "No kit" },
                  ...(assets ? ASSET_KITS : GAME_KITS).map((kit) => ({
                    value: kit.id,
                    label: kit.title,
                  })),
                ]}
                onChange={(id) => {
                  void api
                    .patchSession(session.id, { designSystemId: id || null })
                    .then((updated) => dispatch({ type: "session", session: updated }))
                    .catch(() => undefined);
                }}
              />
            ) : (
              <DesignSystemPicker
                compact
                manage={false}
                selectedId={session.designSystemId}
                onChange={(system) => {
                  void api
                    .patchSession(session.id, {
                      designSystemId: system?.id ?? null,
                      palette: system?.palette,
                    })
                    .then((updated) => dispatch({ type: "session", session: updated }))
                    .catch(() => undefined);
                }}
              />
            )}
            {game ? (
              <>
                <GameStylePicker
                  compact
                  manage={false}
                  selectedId={session.gameStyleId}
                  onChange={(style) => {
                    void api
                      .patchSession(session.id, { gameStyleId: style?.id ?? null })
                      .then((updated) => dispatch({ type: "session", session: updated }))
                      .catch(() => undefined);
                  }}
                />
                <Select
                  className="game-kit-select"
                  compact
                  ariaLabel="Viewport"
                  value={viewport}
                  options={viewports.map((item) => ({
                    value: item.id,
                    label: item.label,
                  }))}
                  onChange={(value) => setResponsiveViewport(value as Viewport)}
                />
              </>
            ) : null}
            {assets ? (
              <AssetStylePicker
                compact
                manage={false}
                selectedId={session.assetStyleId}
                onChange={(style) => {
                  void api
                    .patchSession(session.id, { assetStyleId: style?.id ?? null })
                    .then((updated) => dispatch({ type: "session", session: updated }))
                    .catch(() => undefined);
                }}
              />
            ) : null}
            {game || assets ? null : (
              <DesignPalettePicker
                compact
                palette={palette}
                onChange={(next) => {
                  pushHistory();
                  pendingPalette.current += 1;
                  setPalette(next);
                  const id = session.id;
                  const epoch = paletteEpoch.current;
                  paletteQueue.current = paletteQueue.current
                    .catch(() => undefined)
                    .then(async () => {
                      try {
                        const updated = await api.patchSession(id, { palette: next });
                        if (paletteEpoch.current !== epoch) return;
                        dispatch({ type: "session", session: updated });
                      } catch {
                        /* next queued change still runs */
                      } finally {
                        if (paletteEpoch.current === epoch) pendingPalette.current -= 1;
                      }
                    });
                }}
              />
            )}
          </div>
          {assets ? null : game ? null : <span className="design-toolbar-sep" aria-hidden="true" />}
          {assets ? null : game ? null : mobile ? (
            <Select
              className="design-phone-select"
              compact
              ariaLabel="Phone model"
              value={phone.id}
              options={DESIGN_PHONE_DEVICES.map((item) => ({
                value: item.id,
                label: item.label,
              }))}
              onChange={setPhoneId}
            />
          ) : (
            <div className="control-cluster" role="group" aria-label="Viewport">
              {viewports.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`btn small ${viewport === item.id ? "on" : ""}`}
                  aria-pressed={viewport === item.id}
                  onClick={() => setResponsiveViewport(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
          {game && mobile ? (
            <Select
              className="design-phone-select"
              compact
              ariaLabel="Phone model"
              value={phone.id}
              options={DESIGN_PHONE_DEVICES.map((item) => ({
                value: item.id,
                label: item.label,
              }))}
              onChange={setPhoneId}
            />
          ) : null}
          {game || assets ? (
            <>
              <span className="design-toolbar-sep" aria-hidden="true" />
              <div className="game-chrome">
                {assets ? (
                  <>
                    {showStage3d ? (
                      <AssetToolbarCluster
                        label="View"
                        hint="Camera presets — orbit and zoom stay as you left them"
                      >
                        <div className="control-cluster" role="group" aria-label="Camera">
                          {ASSET_CAMERA_VIEWS.map((id) => (
                            <button
                              key={id}
                              type="button"
                              className={`btn small ${cameraView === id ? "on" : ""}`}
                              aria-pressed={cameraView === id}
                              disabled={!html?.trim()}
                              title={formatAssetCameraHint(id)}
                              onClick={() => {
                                setCameraView(id);
                                postGame({ type: "locus-asset-camera", view: id });
                              }}
                            >
                              {formatAssetCameraLabel(id)}
                            </button>
                          ))}
                        </div>
                      </AssetToolbarCluster>
                    ) : null}
                    <AssetToolbarCluster
                      label="Inspect"
                      hint="Orbit, wireframe, grid, and zoom — preview only, does not change the mesh"
                    >
                      <div className="control-cluster" role="group" aria-label="Studio">
                        {showStage3d ? (
                          <>
                            <button
                              type="button"
                              className={`btn small ${orbitOn ? "on" : ""}`}
                              disabled={!html?.trim()}
                              title="Drag the canvas to orbit the mesh"
                              onClick={() => {
                                const next = !orbitOn;
                                setOrbitOn(next);
                                postGame({ type: "locus-asset-orbit", on: next });
                              }}
                            >
                              Orbit
                            </button>
                            <button
                              type="button"
                              className={`btn small ${wireframeOn ? "on" : ""}`}
                              disabled={!html?.trim()}
                              title="Show mesh edges"
                              onClick={() => {
                                const next = !wireframeOn;
                                setWireframeOn(next);
                                postGame({ type: "locus-asset-wireframe", on: next });
                              }}
                            >
                              Wireframe
                            </button>
                            <button
                              type="button"
                              className={`btn small ${gridOn ? "on" : ""}`}
                              disabled={!html?.trim()}
                              title="Show the ground grid"
                              onClick={() => {
                                const next = !gridOn;
                                setGridOn(next);
                                postGame({ type: "locus-asset-grid", on: next });
                              }}
                            >
                              Grid
                            </button>
                          </>
                        ) : null}
                        <div className="asset-zoom" role="group" aria-label="Studio zoom">
                          <button
                            type="button"
                            className="btn small"
                            disabled={!html?.trim()}
                            title="Zoom out"
                            aria-label="Zoom out"
                            onClick={() => applyAssetZoom(stepAssetZoom(assetZoom, "out"))}
                          >
                            −
                          </button>
                          <button
                            type="button"
                            className="btn small ghost"
                            disabled={!html?.trim()}
                            title="Reset zoom"
                            aria-label="Reset zoom"
                            onClick={() => applyAssetZoom(ASSET_ZOOM_DEFAULT)}
                          >
                            {formatAssetZoom(assetZoom)}
                          </button>
                          <button
                            type="button"
                            className="btn small"
                            disabled={!html?.trim()}
                            title="Zoom in"
                            aria-label="Zoom in"
                            onClick={() => applyAssetZoom(stepAssetZoom(assetZoom, "in"))}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </AssetToolbarCluster>
                    <AssetToolbarCluster
                      label="Generate"
                      hint="Build settings and a new mesh from the current subject"
                    >
                      <OverflowMenu
                        title="Studio extras: apply brief, keep pose, onion-skin"
                        label="Studio"
                        toggleClassName="btn small ghost"
                      >
                        <MenuItem
                          disabled={!html?.trim() || iterating !== null}
                          onClick={() => void applyBrief()}
                        >
                          {iterating === "brief" ? "Applying…" : "Apply brief"}
                        </MenuItem>
                        <MenuItem disabled={iterating !== null} onClick={() => void applyBuild()}>
                          {iterating === "build" ? "Generating…" : "Generate"}
                        </MenuItem>
                        {showAssetPose ? (
                          <MenuItem
                            disabled={!html?.trim() || iterating !== null}
                            onClick={() => void keepFeel()}
                          >
                            {iterating === "pose" ? "Saving…" : "Keep pose"}
                          </MenuItem>
                        ) : null}
                        <MenuSep />
                        <MenuItem
                          pressed={onionOn}
                          disabled={!html?.trim() && !sourcePreviews.front}
                          onClick={() => setOnionOn((v) => !v)}
                        >
                          Onion-skin
                        </MenuItem>
                      </OverflowMenu>
                      <button
                        type="button"
                        className={`btn small ghost ${buildOpen ? "on" : ""}${buildDirty ? " is-dirty" : ""}`}
                        aria-pressed={buildOpen}
                        title={formatAssetBuildLabel(assetBuild)}
                        onClick={() => {
                          setTuneOpen(false);
                          setBuildOpen((v) => !v);
                        }}
                      >
                        Build{buildDirty ? " ·" : ""}
                      </button>
                      <button
                        type="button"
                        className={`btn small${buildDirty ? " primary" : ""}`}
                        disabled={iterating !== null}
                        title="Generate from build settings"
                        onClick={() => void applyBuild()}
                      >
                        {iterating === "build" ? "Generating…" : "Generate"}
                      </button>
                      {showAssetPose ? (
                        <button
                          type="button"
                          className={`btn small ghost ${tuneOpen ? "on" : ""}`}
                          aria-pressed={tuneOpen}
                          disabled={!html?.trim()}
                          title="Pose sliders for the current rig"
                          onClick={() => {
                            setBuildOpen(false);
                            setTuneOpen((v) => !v);
                          }}
                        >
                          Pose
                        </button>
                      ) : null}
                    </AssetToolbarCluster>
                  </>
                ) : (
                  <>
                    {session?.assetRefs?.length ? (
                      <div className="linked-assets" data-testid="linked-assets-canvas">
                        {session.assetRefs.map((row) => (
                          <span key={row.sessionId} className="linked-asset-chip" title={row.title}>
                            @{row.slug}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="control-cluster" role="group" aria-label="Play">
                      <button
                        type="button"
                        className={`btn small ${playMode ? "on" : ""}`}
                        disabled={!html?.trim()}
                        title="Focus the canvas and send keys to the game (Esc exits)"
                        onClick={() => enterPlay(!playMode)}
                      >
                        {playMode ? "Exit play" : "Play"}
                      </button>
                      <button
                        type="button"
                        className="btn small"
                        disabled={!html?.trim() || playtesting}
                        title="Run keyboard playtest"
                        onClick={() => void runPlaytest()}
                      >
                        {playtesting ? "Playtesting…" : "Playtest"}
                      </button>
                    </div>
                    <OverflowMenu title="Iterate" label="Iterate" toggleClassName="btn small ghost">
                      {GAME_ITERATE_CHIPS.map((chip) => (
                        <MenuItem
                          key={chip.id}
                          disabled={!html?.trim() || iterating !== null}
                          onClick={() => void sendIterate(chip.id)}
                        >
                          {iterating === chip.id ? `${chip.title}…` : chip.title}
                        </MenuItem>
                      ))}
                      <MenuSep />
                      <MenuItem
                        disabled={!html?.trim() || iterating !== null || !playtestReport}
                        onClick={() => void fixFromPlaytest()}
                      >
                        {iterating === "fix" ? "Fixing…" : "Fix from playtest"}
                      </MenuItem>
                      <MenuItem
                        disabled={!html?.trim() || iterating !== null}
                        onClick={() => void applyBrief()}
                      >
                        {iterating === "brief" ? "Applying…" : "Apply brief"}
                      </MenuItem>
                      <MenuItem
                        disabled={!html?.trim() || iterating !== null}
                        onClick={() => void keepFeel()}
                      >
                        {iterating === "feel" ? "Saving…" : "Keep feel"}
                      </MenuItem>
                    </OverflowMenu>
                    <button
                      type="button"
                      className={`btn small ghost ${tuneOpen ? "on" : ""}`}
                      aria-pressed={tuneOpen}
                      disabled={!html?.trim()}
                      title="Feel sliders"
                      onClick={() => setTuneOpen((v) => !v)}
                    >
                      Feel
                    </button>
                    <button
                      type="button"
                      className={`btn small ghost ${controlsOpen ? "on" : ""}`}
                      aria-pressed={controlsOpen}
                      title="Show control legend"
                      onClick={() => setControlsOpen((v) => !v)}
                    >
                      Controls
                    </button>
                    <button
                      type="button"
                      className={`btn small ghost ${studioOpen ? "on" : ""}`}
                      aria-pressed={studioOpen}
                      title="Pins, builds, content, remap, and the release check"
                      onClick={() => setStudioOpen((v) => !v)}
                    >
                      Studio
                    </button>
                    <OverflowMenu title="Game" label="Game" toggleClassName="btn small ghost">
                      <MenuItem
                        disabled={!html?.trim()}
                        onClick={() => postGame({ type: "locus-game-reset" })}
                      >
                        Reset
                      </MenuItem>
                      <MenuItem
                        pressed={paused}
                        disabled={!html?.trim()}
                        onClick={() => {
                          const next = !paused;
                          setPaused(next);
                          postGame({ type: next ? "locus-game-pause" : "locus-game-resume" });
                        }}
                      >
                        {paused ? "Resume" : "Pause"}
                      </MenuItem>
                      <MenuItem
                        disabled={!html?.trim() || !(lastTape.length || lastKeys.length)}
                        onClick={() =>
                          postGame({
                            type: "locus-game-replay",
                            tape: lastTape.length ? lastTape : lastKeys,
                          })
                        }
                      >
                        Replay
                      </MenuItem>
                      <MenuSep />
                      <MenuItem
                        checked={debugOn}
                        disabled={!html?.trim()}
                        onClick={() => {
                          const next = !debugOn;
                          setDebugOn(next);
                          postGame({ type: "locus-game-debug", on: next });
                        }}
                      >
                        Debug
                      </MenuItem>
                      <MenuItem
                        checked={touchStick}
                        disabled={!html?.trim()}
                        onClick={() => {
                          const next = !touchStick;
                          setTouchStick(next);
                          postGame({ type: "locus-game-touch", on: next });
                        }}
                      >
                        Touch
                      </MenuItem>
                      <MenuItem
                        checked={gamepadOn}
                        disabled={!html?.trim()}
                        onClick={() => {
                          const next = !gamepadOn;
                          setGamepadOn(next);
                          postGame({ type: "locus-game-gamepad", on: next });
                        }}
                      >
                        Gamepad
                      </MenuItem>
                      <MenuItem
                        disabled={!html?.trim() || recordingPlay}
                        onClick={() => void recordPlay()}
                      >
                        {recordingPlay ? "Recording…" : "Record 15s"}
                      </MenuItem>
                      <MenuItem
                        checked={muted}
                        disabled={!html?.trim()}
                        onClick={() => {
                          const next = !muted;
                          setMuted(next);
                          postGame({ type: "locus-game-mute", on: next });
                        }}
                      >
                        {muted ? "Unmute" : "Mute"}
                      </MenuItem>
                    </OverflowMenu>
                  </>
                )}
              </div>
            </>
          ) : null}
          {assets ? null : (
            <>
              <span className="design-toolbar-sep" aria-hidden="true" />
              <button
                type="button"
                className={`btn small ghost design-toolbar-mode ${commenting ? "on" : ""}`}
                aria-pressed={commenting}
                disabled={!html?.trim()}
                title="Click an element, then describe the change in chat"
                onClick={() => {
                  setEditing(false);
                  setInspecting(false);
                  setCommenting((v) => !v);
                }}
              >
                Comment
              </button>
              <button
                type="button"
                className={`btn small ghost design-toolbar-mode ${editing ? "on" : ""}`}
                aria-pressed={editing}
                disabled={!html?.trim() || turning}
                title="Click text on the canvas to edit it"
                onClick={() => {
                  setCommenting(false);
                  setInspecting(false);
                  setEditing((v) => !v);
                }}
              >
                Edit text
              </button>
              <button
                type="button"
                className={`btn small ghost design-toolbar-mode ${inspecting ? "on" : ""}`}
                aria-pressed={inspecting}
                disabled={!html?.trim()}
                title="Inspect an element's tag, id, and class"
                onClick={() => {
                  setCommenting(false);
                  setEditing(false);
                  setInspecting((v) => !v);
                }}
              >
                Inspect
              </button>
              {game ? null : (
                <>
                  <button
                    type="button"
                    className="btn small ghost design-toolbar-mode"
                    disabled={historyAt < 1}
                    title="Undo (Ctrl/Cmd+Z)"
                    onClick={() => void restoreHistory(historyAt - 1)}
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    className="btn small ghost design-toolbar-mode"
                    disabled={historyAt < 0 || historyAt >= history.current.length - 1}
                    title="Redo (Shift+Ctrl/Cmd+Z)"
                    onClick={() => void restoreHistory(historyAt + 1)}
                  >
                    Redo
                  </button>
                </>
              )}
            </>
          )}
          <OverflowMenu
            label={<IconMore />}
            title="Canvas actions"
            toggleClassName="btn icon ghost"
            wide
          >
            <div className="design-toolbar-overflow-modes">
              {assets ? null : (
                <>
                  <MenuItem
                    pressed={commenting}
                    disabled={!html?.trim()}
                    onClick={() => {
                      setEditing(false);
                      setInspecting(false);
                      setCommenting((v) => !v);
                    }}
                  >
                    Comment
                  </MenuItem>
                  <MenuItem
                    pressed={editing}
                    disabled={!html?.trim() || turning}
                    onClick={() => {
                      setCommenting(false);
                      setInspecting(false);
                      setEditing((v) => !v);
                    }}
                  >
                    Edit text
                  </MenuItem>
                  <MenuItem
                    pressed={inspecting}
                    disabled={!html?.trim()}
                    onClick={() => {
                      setCommenting(false);
                      setEditing(false);
                      setInspecting((v) => !v);
                    }}
                  >
                    Inspect
                  </MenuItem>
                  {game ? null : (
                    <>
                      <MenuItem
                        disabled={historyAt < 1}
                        onClick={() => void restoreHistory(historyAt - 1)}
                      >
                        Undo
                      </MenuItem>
                      <MenuItem
                        disabled={historyAt < 0 || historyAt >= history.current.length - 1}
                        onClick={() => void restoreHistory(historyAt + 1)}
                      >
                        Redo
                      </MenuItem>
                    </>
                  )}
                </>
              )}
              {assets ? (
                <MenuItem
                  pressed={buildOpen}
                  onClick={() => {
                    setTuneOpen(false);
                    setBuildOpen((v) => !v);
                  }}
                >
                  Build
                </MenuItem>
              ) : null}
              {assets && !showAssetPose ? null : (
                <MenuItem
                  pressed={tuneOpen}
                  disabled={!html?.trim()}
                  onClick={() => {
                    setBuildOpen(false);
                    setTuneOpen((v) => !v);
                  }}
                >
                  {assets ? "Pose" : game ? "Feel" : "Tune"}
                </MenuItem>
              )}
              <MenuSep />
            </div>
            <div className="canvas-menu-field">
              <label htmlFor="canvas-variant">Variant</label>
              <Select
                id="canvas-variant"
                className="variant-select"
                compact
                ariaLabel="Design variant"
                disabled={swapping}
                value={session.activeVariantId ?? ""}
                options={[
                  {
                    value: "",
                    label: (session.designVariants ?? []).length ? "Variants" : "No variants",
                    disabled: true,
                  },
                  ...(session.designVariants ?? []).map((item) => ({
                    value: item.id,
                    label: item.name,
                  })),
                ]}
                onChange={(id) => {
                  if (!id) return;
                  void activateVariant(id);
                }}
              />
              <input
                className="variant-name"
                value={variantName}
                placeholder="Name"
                aria-label="New variant name"
                onChange={(event) => setVariantName(event.target.value)}
              />
            </div>
            <MenuItem
              disabled={!html?.trim() || !sessionId}
              onClick={() => {
                if (!sessionId) return;
                const name = variantName.trim() || undefined;
                setVariantName("");
                void (
                  assets
                    ? api.createDesignVariant(sessionId, name, { keepActive: true })
                    : api.createDesignVariant(sessionId, name)
                )
                  .then((updated) => dispatch({ type: "session", session: updated }))
                  .catch(() => undefined);
              }}
            >
              Save variant
            </MenuItem>
            <MenuItem disabled={!sessionId || exploring || turning} onClick={() => void explore()}>
              {exploring ? "Exploring…" : game ? "Explore 3 loops" : "Explore 3 directions"}
            </MenuItem>
            <MenuSep />
            <MenuItem disabled={!html?.trim()} onClick={exportHtml}>
              Export HTML
            </MenuItem>
            {game || assets ? null : (
              <MenuItem disabled={!html?.trim() || exportingPng} onClick={() => void exportPng()}>
                {exportingPng ? "Exporting PNG…" : "Export PNG"}
              </MenuItem>
            )}
            {game || assets ? (
              <>
                <MenuItem disabled={!html?.trim() || exportingZip} onClick={() => void exportZip()}>
                  {exportingZip ? "Exporting…" : assets ? "Export pack" : "Export zip"}
                </MenuItem>
                <MenuItem disabled={!html?.trim()} onClick={() => popOutPlay()}>
                  {assets ? "Pop-out studio" : "Pop-out play"}
                </MenuItem>
                {game ? (
                  <MenuItem disabled={!html?.trim()} onClick={() => void copyPlayLink()}>
                    {playLinkCopied ? "Play link copied" : "Copy play link"}
                  </MenuItem>
                ) : null}
                {game ? (
                  <>
                    <MenuItem pressed={aspectLock} onClick={() => setAspectLock((v) => !v)}>
                      Aspect lock
                    </MenuItem>
                    <MenuItem
                      disabled={!html?.trim()}
                      onClick={() => postGame({ type: "locus-game-unlock" })}
                    >
                      Unlock audio
                    </MenuItem>
                    <MenuItem
                      disabled={!html?.trim()}
                      onClick={() => postGame({ type: "locus-game-clear" })}
                    >
                      Clear save
                    </MenuItem>
                  </>
                ) : (
                  <>
                    <MenuItem
                      disabled={!html?.trim() || assetExportBusy}
                      onClick={() => startAssetExport("png")}
                    >
                      Export PNG
                    </MenuItem>
                    <MenuItem
                      disabled={!html?.trim() || assetExportBusy}
                      onClick={() => startAssetExport("glb")}
                    >
                      Export GLB
                    </MenuItem>
                    <MenuItem
                      disabled={!html?.trim() || assetExportBusy}
                      onClick={() => startAssetExport("stl")}
                    >
                      Export STL
                    </MenuItem>
                    <MenuItem
                      disabled={!html?.trim() || assetExportBusy}
                      onClick={() => startAssetExport("textures")}
                    >
                      Export textures
                    </MenuItem>
                  </>
                )}
              </>
            ) : null}
            {game || assets ? null : (
              <MenuItem onClick={() => dispatch({ type: "designSystems", open: true })}>
                Manage design systems
              </MenuItem>
            )}
            {game ? (
              <>
                <MenuSep />
                {GAME_GENERATE_CHIPS.map((chip) => (
                  <MenuItem
                    key={chip.id}
                    disabled={!html?.trim() || Boolean(generatingKind)}
                    onClick={() => void generateFromGame(chip.id)}
                  >
                    {generatingKind === chip.id
                      ? `Generating ${chip.title}…`
                      : `Generate ${chip.title}`}
                  </MenuItem>
                ))}
                <MenuSep />
                <MenuItem onClick={() => dispatch({ type: "gameStyles", open: true })}>
                  Manage game styles
                </MenuItem>
                <MenuItem
                  disabled={!html?.trim() && !session.title}
                  onClick={() => void saveStyleFromGame()}
                >
                  Save style from this game
                </MenuItem>
              </>
            ) : null}
            {assets ? (
              <>
                <MenuItem onClick={() => dispatch({ type: "assetStyles", open: true })}>
                  Manage asset styles
                </MenuItem>
                <MenuItem
                  disabled={!html?.trim() && !session.title}
                  onClick={() => void saveStyleFromStudio()}
                >
                  Save style from this studio
                </MenuItem>
              </>
            ) : null}
            <MenuSep />
            <div className="canvas-menu-field">
              <label htmlFor="canvas-scaffold">{game ? "Grow as" : "Promote as"}</label>
              <Select
                id="canvas-scaffold"
                className="promote-scaffold"
                compact
                ariaLabel="Promote scaffold"
                value={scaffold}
                options={
                  game
                    ? [
                        { value: "canvas-vite", label: "Canvas + Vite" },
                        { value: "three-vite", label: "Three.js + Vite" },
                        { value: "phaser", label: "Phaser + Vite" },
                        { value: "static", label: "Static HTML" },
                      ]
                    : assets
                      ? [
                          { value: "three-vite", label: "Three.js + Vite" },
                          { value: "canvas-vite", label: "Canvas + Vite" },
                          { value: "static", label: "Static HTML" },
                        ]
                      : [
                          { value: "vite-react", label: "Vite + React" },
                          { value: "next", label: "Next.js" },
                          { value: "astro", label: "Astro" },
                          { value: "static", label: "Static HTML" },
                        ]
                }
                onChange={(value) => setScaffold(value as CanvasScaffold)}
              />
            </div>
            <MenuItem disabled={promoting} onClick={() => void promote()}>
              {promoting
                ? game
                  ? "Growing…"
                  : "Promoting…"
                : game
                  ? "Grow this into a project"
                  : "Promote"}
            </MenuItem>
          </OverflowMenu>
          <button
            type="button"
            className="btn icon ghost"
            title="Collapse canvas"
            aria-label="Collapse canvas"
            onClick={() => dispatch({ type: "toggleVmPane" })}
          >
            <IconPanelRight />
          </button>
        </div>
      </div>
      {assets ? (
        <div className="asset-toolbar-row">
          {showStage3d ? (
            <>
              <AssetToolbarCluster label="Look" hint="Preview materials — does not change the mesh">
                <div className="control-cluster" role="group" aria-label="Look">
                  {ASSET_MATERIALS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={`btn small ${material === id ? "on" : ""}`}
                      aria-pressed={material === id}
                      disabled={!html?.trim()}
                      title={formatAssetMaterialHint(id)}
                      onClick={() => {
                        setMaterial(id);
                        postGame({ type: "locus-asset-material", id });
                      }}
                    >
                      {formatAssetMaterialLabel(id)}
                    </button>
                  ))}
                </div>
              </AssetToolbarCluster>
              <AssetToolbarCluster label="Lights" hint="Stage lighting for judging form">
                <div className="control-cluster" role="group" aria-label="Lights">
                  {ASSET_LIGHTS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={`btn small ${assetLights === id ? "on" : ""}`}
                      aria-pressed={assetLights === id}
                      disabled={!html?.trim()}
                      title={formatAssetLightsHint(id)}
                      onClick={() => {
                        setAssetLights(id);
                        postGame({ type: "locus-asset-lights", id });
                      }}
                    >
                      {formatAssetLightsLabel(id)}
                    </button>
                  ))}
                </div>
              </AssetToolbarCluster>
              <AssetToolbarCluster label="Backdrop" hint="Studio background behind the mesh">
                <div className="control-cluster" role="group" aria-label="Backdrop">
                  {ASSET_BACKGROUNDS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={`btn small ${assetBackground === id ? "on" : ""}`}
                      aria-pressed={assetBackground === id}
                      disabled={!html?.trim()}
                      title={formatAssetBackgroundHint(id)}
                      onClick={() => {
                        setAssetBackground(id);
                        postGame({ type: "locus-asset-background", id });
                      }}
                    >
                      {formatAssetBackgroundLabel(id)}
                    </button>
                  ))}
                </div>
              </AssetToolbarCluster>
              {assetBuild.split ? (
                <AssetToolbarCluster
                  label="Isolate"
                  hint="Hide parts so you can inspect one mesh at a time"
                >
                  <div className="control-cluster" role="group" aria-label="Isolate">
                    {ASSET_ISOLATE_PARTS.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className={`btn small ${isolatePart === id ? "on" : ""}`}
                        aria-pressed={isolatePart === id}
                        disabled={!html?.trim()}
                        title={formatAssetIsolateHint(id)}
                        onClick={() => {
                          setIsolatePart(id);
                          postGame({ type: "locus-asset-isolate", part: id });
                        }}
                      >
                        {formatAssetIsolateLabel(id)}
                      </button>
                    ))}
                  </div>
                </AssetToolbarCluster>
              ) : null}
            </>
          ) : null}
          <AssetToolbarCluster label="Iterate" hint="Ask the agent to refine the live mesh">
            <div className="control-cluster" role="group" aria-label="Iterate">
              {ASSET_ITERATE_CHIPS.filter((chip) => visibleIterate.includes(chip.id)).map(
                (chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    className={`btn small ghost ${iterating === chip.id || pendingIterate.current === chip.id ? "on" : ""}`}
                    disabled={!html?.trim()}
                    title={chip.blurb}
                    onClick={() => void sendIterate(chip.id)}
                  >
                    {iterating === chip.id ? `${chip.title}…` : chip.title}
                  </button>
                ),
              )}
            </div>
          </AssetToolbarCluster>
          {visibleClips.length ? (
            <AssetToolbarCluster
              label="Timeline"
              hint="Play and scrub animation clips on the rig"
              wide
            >
              <div className="asset-clip-bar" role="group" aria-label="Timeline">
                <Select
                  className="game-kit-select"
                  compact
                  ariaLabel="Clip"
                  disabled={!html?.trim()}
                  value={visibleClips.includes(clip) ? clip : (visibleClips[0] ?? "idle")}
                  options={visibleClips.map((id) => ({
                    value: id,
                    label: formatAssetClipLabel(id),
                  }))}
                  onChange={(next) => {
                    setClip(next as (typeof ASSET_CLIPS)[number]);
                    setAssetPaused(false);
                    postGame({ type: "locus-asset-play", clip: next });
                  }}
                />
                <button
                  type="button"
                  className="btn small"
                  disabled={!html?.trim()}
                  title="Play the selected clip"
                  onClick={() => {
                    setAssetPaused(false);
                    postGame({ type: "locus-asset-play", clip });
                  }}
                >
                  Play
                </button>
                <button
                  type="button"
                  className={`btn small ${assetPaused ? "on" : ""}`}
                  disabled={!html?.trim()}
                  title="Pause the clip"
                  onClick={() => {
                    const next = !assetPaused;
                    setAssetPaused(next);
                    postGame({
                      type: next ? "locus-asset-pause" : "locus-asset-play",
                      clip,
                    });
                  }}
                >
                  Pause
                </button>
                <div className="control-cluster" role="group" aria-label="Clip speed">
                  {ASSET_CLIP_SPEEDS.map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      className={`btn small ${clipSpeed === rate ? "on" : ""}`}
                      aria-pressed={clipSpeed === rate}
                      disabled={!html?.trim()}
                      title={formatAssetClipSpeedHint(rate)}
                      onClick={() => {
                        setClipSpeed(rate);
                        postGame({ type: "locus-asset-speed", rate });
                      }}
                    >
                      {formatAssetClipSpeedLabel(rate)}
                    </button>
                  ))}
                </div>
                <label className="asset-clip-scrub">
                  Scrub
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(clipT * 100)}
                    disabled={!html?.trim()}
                    aria-label="Clip scrub"
                    title="Scrub the clip"
                    onChange={(event) => {
                      const next = Number(event.target.value) / 100;
                      setClipT(next);
                      setAssetPaused(true);
                      postGame({ type: "locus-asset-scrub", t: next });
                    }}
                  />
                </label>
              </div>
            </AssetToolbarCluster>
          ) : null}
        </div>
      ) : null}
      {agent || repo || pull ? (
        <div className="bound-work">
          <span>Bound</span>
          {agent ? (
            <button type="button" onClick={() => dispatch({ type: "select", id: agent.id })}>
              Agent · {agent.title}
            </button>
          ) : null}
          {repo ? (
            <button type="button" onClick={() => dispatch({ type: "selectRepo", id: repo.id })}>
              Repo · {repo.name}
            </button>
          ) : null}
          {pull && repo ? (
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "selectRepo", id: repo.id });
                dispatch({ type: "selectPull", number: pull.number });
              }}
            >
              PR · #{pull.number} {pull.title}
            </button>
          ) : null}
          {agent?.preview?.port ? (
            <button
              type="button"
              disabled={matching || turning}
              onClick={() => {
                const port = agent.preview!.port;
                const path = agent.preview?.path ?? "/";
                const url = api.previewHttpUrl(agent.id, port, path);
                const id = session.id;
                setMatching(true);
                setCanvasError(null);
                void (async () => {
                  let attachments:
                    Array<{ name: string; mime?: string; contentBase64: string }> | undefined;
                  try {
                    const shot = await api.execTool(agent.id, "screenshot");
                    if (shot.screenshotBase64) {
                      attachments = [
                        {
                          name: "preview.png",
                          mime: "image/png",
                          contentBase64: shot.screenshotBase64,
                        },
                      ];
                    }
                  } catch {
                    /* URL is enough */
                  }
                  if (selectedIdRef.current !== id) return;
                  const prompt = [
                    "Match the running product.",
                    `Live preview (proxied): ${url}`,
                    "Restyle /workspace/index.html to look like that product.",
                    "Keep existing kit tokens (:root vars).",
                    `If ${DESIGN_REPO_CONTEXT_PATH} notes exist, read them.`,
                    "Do not invent a new product — copy layout, type, and color from the preview or screenshot.",
                  ].join(" ");
                  await api.chat(id, prompt, attachments ? { attachments } : undefined);
                })()
                  .catch((err) => {
                    if (selectedIdRef.current !== id) return;
                    setCanvasError(actionError(err, "Could not match preview"));
                  })
                  .finally(() => {
                    if (selectedIdRef.current === id) setMatching(false);
                  });
              }}
            >
              {matching ? "Matching…" : "Match preview"}
            </button>
          ) : null}
        </div>
      ) : null}
      {assets && buildOpen ? (
        <div className="design-tune asset-build-tune" role="group" aria-label="Build settings">
          <AssetBuildPicker
            value={assetBuild}
            onChange={patchBuild}
            mesh={assetShowsStage3d(assetSubject)}
          />
          <button
            type="button"
            className={`btn small${buildDirty ? " primary" : ""}`}
            disabled={iterating !== null}
            onClick={() => void applyBuild()}
          >
            {iterating === "build" ? "Generating…" : "Generate"}
          </button>
        </div>
      ) : null}
      {tuneOpen ? (
        <div
          className="design-tune"
          role="group"
          aria-label={assets ? "Pose knobs" : game ? "Feel knobs" : "Canvas knobs"}
        >
          {game || assets ? null : (
            <label>
              Primary
              <input
                type="color"
                aria-label="Primary color"
                value={palette.primary}
                onChange={(event) => {
                  const next = { ...palette, primary: event.target.value };
                  const id = session.id;
                  const epoch = paletteEpoch.current;
                  pushHistory();
                  pendingPalette.current += 1;
                  setPalette(next);
                  void api
                    .patchSession(id, { palette: next })
                    .then((updated) => {
                      if (paletteEpoch.current !== epoch) return;
                      dispatch({ type: "session", session: updated });
                    })
                    .catch((err) => {
                      if (paletteEpoch.current !== epoch) return;
                      setCanvasError(actionError(err, "Could not update palette"));
                    })
                    .finally(() => {
                      if (paletteEpoch.current === epoch) {
                        pendingPalette.current = Math.max(0, pendingPalette.current - 1);
                      }
                    });
                }}
              />
            </label>
          )}
          {assets ? (
            <div className="control-cluster" role="group" aria-label="Pose presets">
              {visiblePosePresets.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="btn small ghost"
                  onClick={() =>
                    patchTune(
                      tuneFromPose(ASSET_POSE_PRESETS[id], {
                        ...session.designTune,
                        radiusPx,
                        spacePx,
                        fontPx,
                      }),
                    )
                  }
                >
                  {formatAssetClipLabel(id)}
                </button>
              ))}
            </div>
          ) : game ? (
            <div className="control-cluster" role="group" aria-label="Feel presets">
              {(Object.keys(GAME_FEEL_PRESETS) as Array<keyof typeof GAME_FEEL_PRESETS>).map(
                (id) => (
                  <button
                    key={id}
                    type="button"
                    className="btn small ghost"
                    onClick={() =>
                      patchTune(
                        tuneFromFeel(GAME_FEEL_PRESETS[id], {
                          ...session.designTune,
                          radiusPx,
                          spacePx,
                          fontPx,
                          seed: session.designTune?.seed,
                        }),
                      )
                    }
                  >
                    {id}
                  </button>
                ),
              )}
            </div>
          ) : null}
          {assets ? (
            poseRanges.map((row) => {
              const value = pose[row.key];
              return (
                <label key={row.key}>
                  {row.key} {value}
                  <input
                    type="range"
                    min={row.min}
                    max={row.max}
                    value={value}
                    aria-label={row.key}
                    onChange={(event) => {
                      const n = Number(event.target.value);
                      patchTune(
                        tuneFromPose(
                          { ...pose, [row.key]: n },
                          {
                            ...session.designTune,
                            radiusPx,
                            spacePx,
                            fontPx,
                          },
                        ),
                      );
                    }}
                  />
                </label>
              );
            })
          ) : game ? (
            feelRanges
              .filter((row) => feelKeysForRecipe(studio?.recipeId).includes(row.key))
              .map((row) => {
                const value = feel[row.key];
                const label =
                  row.key === "hit-stop" ? "Hit-stop" : row.key === "fire" ? "Fire" : row.key;
                return (
                  <label key={row.key}>
                    {label} {value}
                    <input
                      type="range"
                      min={row.min}
                      max={row.max}
                      value={value}
                      aria-label={label}
                      onChange={(event) => {
                        const n = Number(event.target.value);
                        const nextFeel = { ...feel, [row.key]: n };
                        patchTune({
                          ...session.designTune,
                          radiusPx,
                          spacePx,
                          fontPx,
                          gravity: nextFeel.gravity,
                          jump: nextFeel.jump,
                          fireRate: nextFeel.fire,
                          shake: nextFeel.shake,
                          hitStop: nextFeel["hit-stop"],
                          volume: nextFeel.volume,
                        });
                      }}
                    />
                  </label>
                );
              })
              .concat(
                <label key="seed">
                  Seed {session.designTune?.seed ?? 0}
                  <input
                    type="range"
                    min={0}
                    max={9999}
                    value={session.designTune?.seed ?? 0}
                    aria-label="Seed"
                    onChange={(event) =>
                      patchTune({
                        ...session.designTune,
                        radiusPx,
                        spacePx,
                        fontPx,
                        seed: Number(event.target.value),
                      })
                    }
                  />
                </label>,
              )
          ) : (
            <>
              <label>
                Space {spacePx}px
                <input
                  type="range"
                  min={spaceRange.min}
                  max={spaceRange.max}
                  value={spacePx}
                  aria-label="Space"
                  onChange={(event) =>
                    patchTune({
                      ...session.designTune,
                      radiusPx,
                      spacePx: Number(event.target.value),
                      fontPx,
                    })
                  }
                />
              </label>
              <label>
                Radius {radiusPx}px
                <input
                  type="range"
                  min={radiusRange.min}
                  max={radiusRange.max}
                  value={radiusPx}
                  aria-label="Radius"
                  onChange={(event) =>
                    patchTune({
                      ...session.designTune,
                      radiusPx: Number(event.target.value),
                      spacePx,
                      fontPx,
                    })
                  }
                />
              </label>
              <label>
                Type {fontPx}px
                <input
                  type="range"
                  min={typeRange.min}
                  max={typeRange.max}
                  value={fontPx}
                  aria-label="Type size"
                  onChange={(event) =>
                    patchTune({
                      ...session.designTune,
                      radiusPx,
                      spacePx,
                      fontPx: Number(event.target.value),
                    })
                  }
                />
              </label>
            </>
          )}
        </div>
      ) : null}
      {game && controlsOpen && html?.trim() ? (
        <div className="game-controls" role="note">
          {controlsLegend}
          {lastKeys.length ? ` · keys ${lastKeys.map(tapeEventCode).join(" ")}` : ""}
          {lastTape.length ? ` · tape ${lastTape.slice(-6).map(tapeEventCode).join(" ")}` : ""}
          {liveStats?.score != null || lastRun?.score != null
            ? ` · sc ${liveStats?.score ?? lastRun?.score}`
            : ""}
          {liveStats?.deaths != null || lastRun?.deaths != null
            ? ` · d ${liveStats?.deaths ?? lastRun?.deaths}`
            : ""}
          {playMode
            ? paused
              ? " · Play mode · comma and period step one frame"
              : " · Play mode (Esc exits)"
            : " · R reset · P pause · D debug · M mute"}
        </div>
      ) : null}
      {game && playLink ? (
        <GamePlayLinkPanel
          url={playLink.url}
          lanUrls={playLink.lanUrls}
          copied={playLinkCopied}
          onClose={() => setPlayLink(null)}
        />
      ) : null}
      {game && studioOpen && studio ? (
        <GameStudioPanel
          session={session}
          html={previewHtml}
          seed={session.designTune?.seed ?? 0}
          tape={lastTape.length ? lastTape : lastKeys}
          stats={liveStats}
          studio={studio}
          onStudio={persistStudio}
          postGame={postGame}
          onPinBuild={pinBuild}
          onPlayBuild={activateVariant}
          onPlaySeed={(seed) => {
            patchTune({ ...session.designTune, seed });
            postGame({ type: "locus-game-seed", seed });
          }}
          onSplit={splitLive}
        />
      ) : null}
      {game && playtestReport ? (
        <div className="game-playtest" role="status">
          {playtestReport}
        </div>
      ) : null}
      {game && releaseLines?.length ? (
        <ul className="game-release" aria-label="Release check">
          {releaseLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {canvasError ? (
        <div className="design-canvas-error" role="alert">
          <span>{canvasError}</span>
          <button type="button" className="btn ghost small" onClick={() => setCanvasError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {inspecting && !game && !assets ? (
        <DesignInspector
          pick={inspectPick}
          pins={session.designPins ?? []}
          onSelectPin={(pin) =>
            dispatch({
              type: "compose",
              text: `On ${pin.selector}${pin.text ? ` (${pin.text})` : ""}: `,
            })
          }
        />
      ) : null}
      <div
        className={`design-stage ${commenting ? "commenting" : ""} ${editing ? "editing" : ""} ${inspecting ? "inspecting" : ""} ${mobile ? "is-phone" : ""}${viewport === "landscape" ? " is-landscape" : ""}${game && aspectLock ? " is-aspect-lock" : ""}${playMode ? " is-play" : ""}${working ? " is-working" : ""}${assets ? " is-asset" : ""}${dropHint ? " is-asset-drop" : ""}${!game && !assets && (viewport === "phone" || viewport === "tablet") ? " has-device-frame" : ""}`}
        aria-busy={swapping || working}
        onWheel={
          assets && html?.trim()
            ? (event) => {
                event.preventDefault();
                applyAssetZoom(stepAssetZoom(assetZoom, event.deltaY < 0 ? "in" : "out"));
              }
            : undefined
        }
        onDragOver={
          assets
            ? (event) => {
                if (event.dataTransfer?.types?.includes("Files")) {
                  event.preventDefault();
                  setDropHint(true);
                }
              }
            : undefined
        }
        onDragLeave={assets ? () => setDropHint(false) : undefined}
        onDrop={
          assets
            ? (event) => {
                const incoming = filesFromDataTransfer(event.dataTransfer);
                setDropHint(false);
                if (!incoming.length) return;
                event.preventDefault();
                void dropAssetPhotos(incoming);
              }
            : undefined
        }
      >
        {swapping ? (
          <div
            className="design-swap-overlay"
            data-testid="design-swap-overlay"
            role="status"
            aria-live="polite"
          >
            <div className="design-swap-spinner" aria-hidden />
            <p>Loading canvas…</p>
          </div>
        ) : null}
        {!swapping && working && (srcDoc || building) ? (
          <div
            className="design-working-chip"
            data-testid="design-working"
            role="status"
            aria-live="polite"
          >
            <span className="working-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>
              {assets
                ? assetWorkingChip({
                    html: previewHtml,
                    stats: studioStats,
                    working: true,
                    guestComingUp,
                    building,
                  }) || "Generating…"
                : building
                  ? "Building image…"
                  : guestComingUp
                    ? "Starting container…"
                    : previewHtml?.trim()
                      ? "Updating canvas…"
                      : "Agent is working…"}
            </span>
          </div>
        ) : null}
        {srcDoc ? (
          <>
            {playMode ? (
              <button type="button" className="game-play-exit" onClick={() => enterPlay(false)}>
                Exit play · Esc
              </button>
            ) : null}
            {assets ? (
              <>
                <div className="asset-stats-card" role="status" aria-label="Mesh stats">
                  <div>
                    Topology{" "}
                    <strong>
                      {studioStats?.topology === "quad"
                        ? "Quad"
                        : studioStats?.topology === "triangle"
                          ? "Triangle"
                          : assetBuild.topology === "high-detail"
                            ? "High detail"
                            : "Smart"}
                    </strong>
                  </div>
                  <div>
                    Faces{" "}
                    <strong className={facesOverBudget ? "is-bad" : ""}>
                      {faceCount != null ? faceCount.toLocaleString() : "—"}
                    </strong>
                    <span className={`asset-stats-budget${facesOverBudget ? " is-over" : ""}`}>
                      {" "}
                      / {assetPolyBudgetFaces(assetBuild.polyBudget).toLocaleString()}
                    </span>
                  </div>
                  <div>
                    Health <strong>{formatAssetMeshHealth(studioStats)}</strong>
                  </div>
                  <div>
                    Vertices{" "}
                    <strong>
                      {studioStats?.verts != null ? studioStats.verts.toLocaleString() : "—"}
                    </strong>
                  </div>
                  <div>
                    Printability{" "}
                    <strong
                      className={
                        studioStats?.printable === true
                          ? "is-ok"
                          : studioStats?.printable === false
                            ? "is-bad"
                            : assetBuild.printable
                              ? "is-target"
                              : ""
                      }
                    >
                      {studioStats?.printable === true
                        ? "Ready"
                        : studioStats?.printable === false
                          ? "Open"
                          : assetBuild.printable
                            ? "Target"
                            : "Off"}
                    </strong>
                  </div>
                  <div className="asset-stats-units" role="group" aria-label="Units">
                    Scale{" "}
                    <strong>
                      {studioStats?.scale != null
                        ? `${studioStats.scale}${formatAssetUnitsLabel(assetUnits)}`
                        : formatAssetUnitsLabel(assetUnits)}
                    </strong>
                    {ASSET_UNITS.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className={`btn small ${assetUnits === id ? "on" : ""}`}
                        aria-pressed={assetUnits === id}
                        title={`Display scale in ${formatAssetUnitsLabel(id)}`}
                        onClick={() => {
                          setAssetUnits(id);
                          postGame({ type: "locus-asset-units", units: id });
                        }}
                      >
                        {formatAssetUnitsLabel(id)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="asset-stage-rail">
                  <span className="asset-cluster-label">Source</span>
                  <AssetDropWell
                    compact
                    files={viewSlots}
                    previews={sourcePreviews}
                    onChange={setViewSlots}
                    onDropFiles={(incoming, slot) => void dropAssetPhotos(incoming, slot)}
                  />
                  <button
                    type="button"
                    className={`btn small ghost ${onionOn ? "on" : ""}`}
                    aria-pressed={onionOn}
                    disabled={!sourcePreviews.front && !viewSlots.front}
                    title="Overlay the source photo on the mesh"
                    onClick={() => setOnionOn((v) => !v)}
                  >
                    Onion
                  </button>
                  {onionOn ? (
                    <label className="asset-onion-opacity">
                      Overlay
                      <input
                        type="range"
                        min={10}
                        max={80}
                        value={Math.round(onionOpacity * 100)}
                        aria-label="Onion-skin opacity"
                        title="Onion-skin opacity"
                        onChange={(event) => setOnionOpacity(Number(event.target.value) / 100)}
                      />
                    </label>
                  ) : null}
                </div>
                {onionOn && sourcePreviews.front ? (
                  <img
                    className="asset-onion"
                    alt=""
                    src={sourcePreviews.front}
                    style={{ opacity: onionOpacity }}
                  />
                ) : null}
                {dropHint ? (
                  <div className="asset-drop-hint" role="status">
                    Drop a photo to retarget albedo or add a side view
                  </div>
                ) : null}
              </>
            ) : null}
            {assets && compareOn && compareHtml ? (
              <div className="asset-stage-split is-compare">
                <iframe
                  className="asset-compare-frame"
                  title="Previous generate"
                  sandbox="allow-same-origin"
                  srcDoc={compareHtml}
                />
                <CanvasPreview
                  srcDoc={srcDoc}
                  httpSrc={httpSrc}
                  httpIsolated={httpIsolated}
                  paintReady={isCanvasPaintReady(previewHtml ?? "")}
                  pageKey={canvasId ?? ""}
                  viewport={viewport}
                  width={width}
                  height={frameHeight}
                  phoneId={mobile ? phone.id : undefined}
                  pageBg={palette.bg}
                  frameRef={frame}
                  onReady={onCanvasReady}
                  readyNonce={paintEpoch}
                />
              </div>
            ) : (
              <CanvasPreview
                srcDoc={srcDoc}
                httpSrc={httpSrc}
                httpIsolated={httpIsolated}
                paintReady={isCanvasPaintReady(previewHtml ?? "")}
                pageKey={canvasId ?? ""}
                viewport={viewport}
                width={width}
                height={frameHeight}
                phoneId={mobile ? phone.id : undefined}
                pageBg={palette.bg}
                frameRef={frame}
                onReady={onCanvasReady}
                readyNonce={paintEpoch}
              />
            )}
            {mobile ? (
              <div className="design-frame-caption">{formatPhoneDeviceCaption(phone)}</div>
            ) : (
              <div className="canvas-foot">
                <span>
                  {previewHtml?.trim() ? "index.html" : "waiting"} • {width} × {frameHeight ?? 900}
                </span>
                <span>{session.dockerImage ?? "locus/agent:0.1"} /workspace</span>
              </div>
            )}
          </>
        ) : (
          <div
            className={`design-empty${building ? " has-progress" : ""}${working && !building ? " is-working" : ""}`}
          >
            {building && imageProgress ? (
              <>
                <ImageBuildCard progress={imageProgress} title={imageBuildStartNote()} />
                <p>
                  First start builds the agent image. This can take several minutes — the card
                  tracks docker build steps.
                </p>
              </>
            ) : working ? (
              <div
                className="design-empty-wait"
                data-testid="design-working"
                role="status"
                aria-live="polite"
              >
                <div className="design-swap-spinner" aria-hidden />
                <span className="working-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <strong>
                  {assets
                    ? assetWorkingChip({
                        html: previewHtml,
                        stats: studioStats,
                        working: true,
                        guestComingUp,
                        building,
                      }) || (guestComingUp ? "Starting the container" : "Tracing silhouette…")
                    : guestComingUp
                      ? "Starting the container"
                      : "Agent is working"}
                </strong>
                {assets ? (
                  <ol className="asset-pipeline" aria-label="Generate pipeline">
                    {(["silhouette", "hull", "texture", "rig"] as const).map((stage) => (
                      <li
                        key={stage}
                        className={
                          inferAssetPipeline(previewHtml, studioStats) === stage ? "is-current" : ""
                        }
                      >
                        {stage === "silhouette"
                          ? "Silhouette"
                          : stage === "hull"
                            ? "Hull"
                            : stage === "texture"
                              ? "Texture"
                              : "Rig"}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>
                    {guestComingUp
                      ? "The canvas fills when the agent writes /workspace/index.html."
                      : "The agent is working. The canvas fills when it writes /workspace/index.html."}
                  </p>
                )}
              </div>
            ) : (
              <p>
                {assets
                  ? "Drop a photo on the stage or describe a subject in chat. The canvas renders /workspace/index.html."
                  : game
                    ? "Describe a playable loop in chat. The canvas renders /workspace/index.html."
                    : "Describe a prototype in chat. The canvas renders /workspace/index.html."}
              </p>
            )}
          </div>
        )}
      </div>
      {game || assets ? null : (
        <DesignVariantsStrip
          session={session}
          html={previewHtml}
          systems={state.designSystems}
          swapping={swapping}
          onActivate={(id) => void activateVariant(id)}
        />
      )}
      {assets ? (
        <AssetRecents
          session={session}
          html={previewHtml}
          systems={state.designSystems}
          swapping={swapping}
          exploring={exploring}
          turning={turning}
          canUndo={canUndo}
          compareOn={compareOn}
          onLive={() => void restoreLive()}
          onActivate={(id) => void activateVariant(id)}
          onSave={() => {
            if (!sessionId) return;
            void api
              .createDesignVariant(sessionId, variantName.trim() || undefined, {
                keepActive: true,
              })
              .then((updated) => dispatch({ type: "session", session: updated }))
              .catch(() => undefined);
          }}
          onExplore={() => void explore()}
          onUndo={() => void undoLastPass()}
          onCompare={() => void toggleCompare()}
        />
      ) : null}
      {assetExport ? (
        <AssetExportModal
          progress={assetExport}
          onClose={closeAssetExport}
          onExport={confirmAssetExport}
        />
      ) : null}
    </aside>
  );
}
