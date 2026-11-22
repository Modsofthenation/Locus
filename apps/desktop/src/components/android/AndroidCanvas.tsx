import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { androidApi } from "./androidApi";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function AndroidCanvas({
  sessionId,
  serial,
  noAvds = false,
  refreshing = false,
  onRefresh,
  toolsSlot,
}: {
  sessionId: string;
  serial: string;
  /** The SDK reported no installed virtual devices. */
  noAvds?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Where to render the view tools (the workbench tab row); inline when absent. */
  toolsSlot?: HTMLElement | null;
}) {
  const [frame, setFrame] = useState("");
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [natural, setNatural] = useState({ width: 1080, height: 2400 });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const [landscape, setLandscape] = useState(false);
  const [text, setText] = useState("");
  const [inputBusy, setInputBusy] = useState(false);
  const screen = useRef<HTMLImageElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === canvas.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  useEffect(() => {
    if (!serial || paused) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let url = "";
    async function capture() {
      try {
        const blob = await androidApi.screen(sessionId, serial, controller.signal);
        if (controller.signal.aborted) return;
        const previous = url;
        url = URL.createObjectURL(blob);
        setFrame(url);
        setError("");
        if (previous) URL.revokeObjectURL(previous);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setFrame("");
          setError(message(cause));
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void capture(), 1200);
      }
    }
    void capture();
    return () => {
      controller.abort();
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [sessionId, serial, paused]);
  useEffect(() => {
    const element = stage.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Fit keeps the whole device screen visible; fixed zoom levels keep the old 300px baseline.
  const frameBorder = 12;
  const fitWidth =
    stageSize.width && stageSize.height
      ? Math.max(
          120,
          Math.min(
            stageSize.width - frameBorder,
            ((stageSize.height - frameBorder) * natural.width) / natural.height,
          ),
        ) + frameBorder
      : 300;
  const frameWidth = zoom === "fit" ? fitWidth : (landscape ? 580 : 300) * zoom;
  const controlsDisabled = !serial || paused || inputBusy;
  async function input(value: object) {
    if (inputBusy) return false;
    setInputBusy(true);
    try {
      await androidApi.input(sessionId, serial, value);
      setError("");
      return true;
    } catch (cause) {
      setError(message(cause));
      return false;
    } finally {
      setInputBusy(false);
    }
  }
  const tools = (
    <div className="android-canvas-tools">
      {serial ? (
        <span className={`android-live ${paused ? "paused" : "on"}`}>
          {paused ? "Paused" : "Live"}
        </span>
      ) : null}
      <button
        className="btn small ghost"
        disabled={controlsDisabled}
        onClick={() => {
          const next = !landscape;
          setLandscape(next);
          void input({ type: "rotate", landscape: next });
        }}
      >
        Rotate
      </button>
      <button
        className="btn small ghost"
        disabled={!serial}
        onClick={() => setPaused((value) => !value)}
        aria-pressed={paused}
      >
        {paused ? "Resume" : "Pause"}
      </button>
      <label>
        <span className="android-sr">Zoom</span>
        <select
          aria-label="Canvas zoom"
          value={zoom}
          onChange={(event) =>
            setZoom(event.target.value === "fit" ? "fit" : Number(event.target.value))
          }
        >
          <option value="fit">Fit</option>
          {[0.5, 0.75, 1, 1.5, 2].map((value) => (
            <option key={value} value={value}>
              {value * 100}%
            </option>
          ))}
        </select>
      </label>
      <button
        className="btn small ghost"
        aria-pressed={fullscreen}
        onClick={() => {
          void (
            document.fullscreenElement
              ? document.exitFullscreen()
              : canvas.current?.requestFullscreen()
          )?.catch((cause) => setError(message(cause)));
        }}
      >
        {fullscreen ? "Exit fullscreen" : "Fullscreen"}
      </button>
    </div>
  );
  function point(event: PointerEvent<HTMLImageElement>) {
    const image = screen.current!;
    const bounds = image.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          image.naturalWidth - 1,
          Math.round(((event.clientX - bounds.left) / bounds.width) * image.naturalWidth),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          image.naturalHeight - 1,
          Math.round(((event.clientY - bounds.top) / bounds.height) * image.naturalHeight),
        ),
      ),
    };
  }
  return (
    <div ref={canvas} className="android-canvas">
      {toolsSlot && !fullscreen ? createPortal(tools, toolsSlot) : tools}
      {error ? (
        <p role="alert" className="android-notice error">
          {error}
        </p>
      ) : null}
      <div
        ref={stage}
        className={`android-device-stage${zoom === "fit" ? " fit" : ""}${paused ? " paused" : ""}`}
      >
        {frame ? (
          <div className="android-device-frame" style={{ width: `${frameWidth}px` }}>
            <img
              ref={screen}
              src={frame}
              alt="Live Android emulator screen. Tap or drag to interact."
              draggable={false}
              onLoad={(event) => {
                const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
                if (width && height && (width !== natural.width || height !== natural.height))
                  setNatural({ width, height });
              }}
              onPointerDown={(event) => {
                if (paused || inputBusy) return;
                start.current = point(event);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerCancel={() => {
                start.current = null;
              }}
              onPointerUp={(event) => {
                const from = start.current;
                start.current = null;
                if (!from) return;
                const to = point(event);
                void input(
                  Math.hypot(to.x - from.x, to.y - from.y) < 12
                    ? { type: "tap", ...to }
                    : { type: "swipe", ...from, endX: to.x, endY: to.y },
                );
              }}
            />
          </div>
        ) : (
          <div className="android-device-empty">
            <div
              className={`android-phone-outline${serial ? " connecting" : ""}`}
              aria-hidden="true"
            />
            <h3>
              {serial
                ? "Connecting to Android…"
                : noAvds
                  ? "No virtual devices found"
                  : "Your app, on a real device."}
            </h3>
            <p>
              {serial
                ? "Waiting for the first screen capture. A cold boot can take a few minutes."
                : noAvds
                  ? "Create a phone, tablet or foldable in Android Studio’s Device Manager (Tools › Device Manager), then refresh to use it here."
                  : "Pick a virtual device above and press Start device. Phone, tablet and foldable profiles are managed in Android Studio’s Device Manager."}
            </p>
            {!serial && noAvds && onRefresh ? (
              <button
                type="button"
                className="btn small android-device-empty-action"
                disabled={refreshing}
                onClick={onRefresh}
              >
                Refresh devices
              </button>
            ) : null}
          </div>
        )}
      </div>
      <div className="android-device-controls">
        <div className="android-nav-keys" role="group" aria-label="Android navigation">
          <button
            className="btn small ghost"
            disabled={controlsDisabled}
            onClick={() => void input({ type: "key", key: "back" })}
          >
            <span aria-hidden="true">◁ </span>Back
          </button>
          <button
            className="btn small ghost"
            disabled={controlsDisabled}
            onClick={() => void input({ type: "key", key: "home" })}
          >
            <span aria-hidden="true">○ </span>Home
          </button>
          <button
            className="btn small ghost"
            disabled={controlsDisabled}
            onClick={() => void input({ type: "key", key: "recent" })}
          >
            <span aria-hidden="true">□ </span>Recent apps
          </button>
        </div>
        <form
          className="android-text-input"
          onSubmit={(event) => {
            event.preventDefault();
            if (!text || controlsDisabled) return;
            void input({ type: "text", text }).then((sent) => sent && setText(""));
          }}
        >
          <input
            aria-label="Type into Android device"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Type into the focused field…"
            maxLength={200}
            disabled={!serial}
          />
          <button className="btn small" disabled={controlsDisabled || !text}>
            Send text
          </button>
        </form>
      </div>
      {serial ? (
        <p className="android-canvas-caption">
          Tap or drag the screen to interact · refreshes about once per second
        </p>
      ) : null}
    </div>
  );
}
