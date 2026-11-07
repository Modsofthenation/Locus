import { useEffect, useMemo, useRef, useState } from "react";
import {
  canvasFilesPreviewUrl,
  canvasHttpFrameSrc,
  canvasIframeSandbox,
  canvasShouldServeHttp,
  chatInputError,
  pickSelector,
  isGameSession,
  isAssetSession,
  generateAssetPrompt,
  resolveAssetStyle,
  assetBuildEquals,
  resolveAppliedAssetBuild,
  ASSET_CAMERA_VIEWS,
  ASSET_UNDO_VARIANT_ID,
  formatAssetCameraLabel,
  inferAssetSubject,
  assetShowsStage3d,
  assetVisibleIterateChips,
  ASSET_ZOOM_DEFAULT,
  ASSET_ITERATE_CHIPS,
  ASSET_CORE_CLIPS,
  formatAssetClipLabel,
  iterateAssetPrompt,
  poseFromTune,
  clampAssetZoom,
  stepAssetZoom,
  formatAssetZoom,
  defaultGamePlaytestSteps,
  sessionRuntime,
  type AgentSession,
  type DesignSystem,
} from "@locus/shared";
import { api } from "@/lib/api";
import { isCanvasPaintReady } from "@/lib/canvasHtml";
import { paintCanvasSrcDoc } from "@/lib/canvasPaint";
import { canvasFrameSrc, useCanvasFrameHtml } from "@/lib/canvasFrame";
import { useCanvasPrefetch } from "@/lib/useCanvasPrefetch";
import {
  clipOnWords,
  compactRelativeTime,
  designMetaLine,
  groupMobileRows,
  matchesMobileQuery,
} from "@/lib/mobileShell";
import { withPhoneToken } from "@/lib/phoneAuth";
import { useStore } from "@/state/store";
import { DesignThumb } from "./DesignThumb";
import { IconChevron, IconSend } from "@/components/layout/Icons";
import { Mascot } from "@/components/layout/Mascot";
import { AssetBuildPicker } from "@/components/assets/AssetBuildPicker";
import { useAssetBuild } from "@/components/assets/useAssetBuild";

function tokenCanvasFiles(html: string, sessionId: string): string {
  const files = `/api/sessions/${encodeURIComponent(sessionId)}/canvas-files/`;
  const withAbs = html.replace(
    /(\s(?:src|href)=)(["'])(\/api\/sessions\/[^"']+)\2/gi,
    (_m, attr: string, q: string, url: string) => `${attr}${q}${withPhoneToken(url)}${q}`,
  );
  return withAbs.replace(
    /(\s(?:src|href)=)(["'])(?!https?:|data:|blob:|#|\/\/|\/api\/)([^"']+)\2/gi,
    (_m, attr: string, q: string, url: string) => {
      const resolved = url.startsWith("/") ? url : `${files}${url.replace(/^\.\//, "")}`;
      return `${attr}${q}${withPhoneToken(resolved)}${q}`;
    },
  );
}

export function phoneCanvasSrcDoc(
  html: string,
  session: AgentSession,
  systems: DesignSystem[],
  commenting = false,
): string {
  const files = `/api/sessions/${encodeURIComponent(session.id)}/canvas-files/`;
  return tokenCanvasFiles(
    paintCanvasSrcDoc({
      html,
      session,
      systems,
      interaction: commenting,
      filesBase: withPhoneToken(files),
    }),
    session.id,
  );
}

export function MobileDesignList(props: {
  sessions: AgentSession[];
  onOpen: (id: string) => void;
  query?: string;
}) {
  const { state, dispatch } = useStore();
  useCanvasPrefetch(true, props.sessions, state.canvasHtml, dispatch);
  if (!props.sessions.length) {
    return (
      <div className="mobile-empty">
        <Mascot pose="idle" size={64} />
        <h2>No canvases yet</h2>
        <p>
          Design chats live here as previews. Comment from the canvas, then Promote into a Docker
          agent. VNC stays on the desktop.
        </p>
      </div>
    );
  }
  const visible = props.sessions.filter((row) => matchesMobileQuery(row.title, props.query ?? ""));
  const groups = groupMobileRows(visible, "today-earlier");
  if (!groups.length) {
    return <p className="hint mobile-filter-empty">Nothing matches this search.</p>;
  }
  return (
    <div data-testid="mobile-design">
      {groups.map((group) => (
        <section key={group.label} className="mobile-day">
          <h2>{group.label}</h2>
          <ul className="mobile-list">
            {group.items.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="mobile-row is-design"
                  onClick={() => props.onOpen(row.id)}
                >
                  <DesignThumb
                    session={row}
                    html={state.canvasHtml[row.id]}
                    systems={state.designSystems}
                  />
                  <span className="mobile-row-main">
                    <span className="mobile-row-title">{row.title}</span>
                    <span className="mobile-row-mono">{designMetaLine(row)}</span>
                  </span>
                  <span className="mobile-row-chevron" aria-hidden="true">
                    <IconChevron />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function isCanvasPick(data: unknown): data is {
  type: string;
  tag: string;
  text?: string;
  id?: string;
  className?: string;
} {
  if (!data || typeof data !== "object") return false;
  const row = data as Record<string, unknown>;
  return row.type === "locus-design-pick" && typeof row.tag === "string";
}

type PromoteScaffold =
  "vite-react" | "static" | "next" | "astro" | "canvas-vite" | "three-vite" | "phaser";

export function MobileDesignCanvas(props: {
  session: AgentSession;
  onBack: () => void;
  startCommenting?: boolean;
  onOpenAgent?: (id: string) => void;
}) {
  const { state, dispatch } = useStore();
  const session = state.sessions.find((row) => row.id === props.session.id) ?? props.session;
  const html = state.canvasHtml[session.id];
  const frame = useRef<HTMLIFrameElement>(null);
  const [commenting, setCommenting] = useState(Boolean(props.startCommenting));
  const [note, setNote] = useState("");
  const [pinned, setPinned] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [scaffold, setScaffold] = useState<PromoteScaffold>(() =>
    isAssetSession(props.session)
      ? "three-vite"
      : isGameSession(props.session)
        ? "canvas-vite"
        : "vite-react",
  );
  const [error, setError] = useState<string | null>(null);
  const [playtesting, setPlaytesting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [orbitOn, setOrbitOn] = useState(true);
  const [wireframeOn, setWireframeOn] = useState(false);
  const [assetZoom, setAssetZoom] = useState(ASSET_ZOOM_DEFAULT);
  const [buildOpen, setBuildOpen] = useState(false);
  const [applyingBuild, setApplyingBuild] = useState(false);
  const { build: assetBuild, change: patchBuild, markApplied } = useAssetBuild(session, dispatch);
  const [assetPaused, setAssetPaused] = useState(false);
  const [iterating, setIterating] = useState<string | null>(null);
  const [clip, setClip] = useState<(typeof ASSET_CORE_CLIPS)[number]>("idle");
  const game = isGameSession(session);
  const assets = isAssetSession(session);
  const assetSubject = inferAssetSubject({ html, title: session.title });
  const showStage3d = assets && assetShowsStage3d(assetSubject);
  const buildDirty = assets && !assetBuildEquals(assetBuild, resolveAppliedAssetBuild(session));
  const visibleIterate = assets ? assetVisibleIterateChips(assetSubject) : [];
  const agent = session.promotedAgentId
    ? state.sessions.find((row) => row.id === session.promotedAgentId)
    : undefined;

  useEffect(() => {
    if (html) return;
    let cancelled = false;
    void api.canvas(session.id).then(
      (canvas) => {
        if (cancelled || !canvas.html) return;
        dispatch({ type: "canvas", sessionId: session.id, html: canvas.html });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [dispatch, html, session.id]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!commenting) return;
      if (frame.current?.contentWindow && event.source !== frame.current.contentWindow) return;
      if (!isCanvasPick(event.data)) return;
      const pick = event.data;
      setBusy(true);
      setError(null);
      void api
        .designComment(session.id, {
          selector: pickSelector({ tag: pick.tag, id: pick.id, className: pick.className }),
          text: pick.text || undefined,
          viewport: "phone",
        })
        .then((updated) => {
          dispatch({ type: "session", session: updated });
          setPinned(pickSelector({ tag: pick.tag, id: pick.id, className: pick.className }));
          setCommenting(false);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Could not pin");
        })
        .finally(() => setBusy(false));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [commenting, dispatch, session.id]);

  useEffect(() => {
    if (!assets) return;
    function onMessage(event: MessageEvent) {
      if (frame.current?.contentWindow && event.source !== frame.current.contentWindow) return;
      const data = event.data;
      if (!data || data.type !== "locus-asset-zoom-changed") return;
      const scale = clampAssetZoom(Number(data.scale));
      setAssetZoom((current) => (current === scale ? current : scale));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [assets]);

  const serveHttp = canvasShouldServeHttp(html);
  const srcDoc = useMemo(() => {
    if (!html || !isCanvasPaintReady(html) || serveHttp) return "";
    return phoneCanvasSrcDoc(html, session, state.designSystems, commenting);
  }, [html, serveHttp, session, state.designSystems, commenting]);
  const httpFrame =
    serveHttp && html && isCanvasPaintReady(html)
      ? canvasHttpFrameSrc(
          canvasFilesPreviewUrl(session.id, { pick: commenting }),
          window.location.origin,
        )
      : undefined;
  const httpSrc = httpFrame ? withPhoneToken(httpFrame.src) : "";
  const httpIsolated = Boolean(httpFrame?.isolated);
  useCanvasFrameHtml(srcDoc, frame);

  async function promote() {
    if (promoting) return;
    setPromoting(true);
    setError(null);
    try {
      const { agent: nextAgent, design } = await api.promote(session.id, { scaffold });
      dispatch({ type: "session", session: design });
      dispatch({ type: "session", session: nextAgent });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not promote");
    } finally {
      setPromoting(false);
    }
  }

  function generateBuild() {
    if (applyingBuild) return;
    const snapshot = assetBuild;
    setApplyingBuild(true);
    void (
      html?.trim()
        ? api.createDesignVariant(session.id, "Before generate", {
            id: ASSET_UNDO_VARIANT_ID,
            keepActive: true,
          })
        : Promise.resolve()
    )
      .catch(() => undefined)
      .then(() =>
        api.chat(
          session.id,
          generateAssetPrompt(
            snapshot,
            Boolean(html?.trim()),
            resolveAssetStyle(session.assetStyleId, state.assetStyles),
          ),
          session.status === "running" ? { steer: true } : undefined,
        ),
      )
      .then(() => markApplied(snapshot))
      .catch(() => undefined)
      .finally(() => setApplyingBuild(false));
  }

  async function sendNote() {
    const text = note.trim();
    if (!text || busy) return;
    const cap = chatInputError(text);
    if (cap) {
      setError(cap);
      return;
    }
    const turning = session.status === "running";
    setBusy(true);
    setError(null);
    try {
      await api.chat(session.id, text, turning ? { steer: true } : undefined);
      setNote("");
      setPinned(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send");
    } finally {
      setBusy(false);
    }
  }

  const working = session.status === "running" || session.status === "provisioning";
  const startedAt = Date.parse(session.computeStartedAt || session.updatedAt);
  const elapsedS = Number.isFinite(startedAt)
    ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
    : 0;
  const statusLine = working
    ? `agent working / ${elapsedS}s`
    : `canvas / ${sessionRuntime(session)} / edited ${compactRelativeTime(session.updatedAt)}`;
  const activity = session.messages.filter(
    (row) =>
      (row.role === "user" || row.role === "assistant") &&
      (row.content.replace(/\s+/g, " ").trim() || row.thinking?.trim()),
  );
  const lastUser = [...activity].reverse().find((row) => row.role === "user");
  const lastAssistant = [...activity].reverse().find((row) => row.role === "assistant");
  const liveThought = state.thinking[session.id] || lastAssistant?.thinking?.trim() || "";

  return (
    <div className="mobile-screen is-canvas" data-testid="mobile-canvas">
      <header className="mobile-top is-thread">
        <button type="button" className="mobile-icon-btn mobile-back" onClick={props.onBack}>
          Back
        </button>
        <div className="mobile-top-title is-start">
          <h1>{session.title}</h1>
          <p className={`mobile-top-meta${working ? " is-live" : ""}`}>{statusLine}</p>
        </div>
        {assets ? null : (
          <button
            type="button"
            className={`mobile-icon-btn${commenting ? " on" : ""}`}
            aria-pressed={commenting}
            onClick={() => setCommenting((v) => !v)}
          >
            Comment
          </button>
        )}
      </header>
      <div className="mobile-canvas-toolbar" data-testid="mobile-promote">
        <select
          className="mobile-promote-scaffold"
          aria-label="Promote scaffold"
          value={scaffold}
          disabled={promoting}
          onChange={(event) => setScaffold(event.target.value as PromoteScaffold)}
        >
          {game ? (
            <>
              <option value="canvas-vite">Canvas + Vite</option>
              <option value="three-vite">Three.js + Vite</option>
              <option value="phaser">Phaser + Vite</option>
              <option value="static">Static HTML</option>
            </>
          ) : assets ? (
            <>
              <option value="three-vite">Three.js + Vite</option>
              <option value="canvas-vite">Canvas + Vite</option>
              <option value="static">Static HTML</option>
            </>
          ) : (
            <>
              <option value="vite-react">Vite + React</option>
              <option value="next">Next.js</option>
              <option value="astro">Astro</option>
              <option value="static">Static HTML</option>
            </>
          )}
        </select>
        <button
          type="button"
          className="btn small primary"
          disabled={promoting}
          title="Copy this canvas into a Docker agent. The canvas stays live."
          onClick={() => void promote()}
        >
          {promoting ? "Promoting…" : "Promote"}
        </button>
        {agent && props.onOpenAgent ? (
          <button
            type="button"
            className="btn small ghost"
            onClick={() => props.onOpenAgent?.(agent.id)}
          >
            Open agent
          </button>
        ) : null}
        {game ? (
          <>
            <button
              type="button"
              className="btn small ghost"
              disabled={!html?.trim() || playtesting}
              onClick={() => {
                if (playtesting) return;
                setPlaytesting(true);
                void api
                  .execTool(session.id, "playwright", {
                    steps: defaultGamePlaytestSteps(html ?? ""),
                    screenshot: true,
                    viewport: "phone",
                  })
                  .then((result) => {
                    if (result.screenshotBase64) {
                      dispatch({
                        type: "gameShot",
                        sessionId: session.id,
                        image: result.screenshotBase64,
                      });
                    }
                  })
                  .catch(() => undefined)
                  .finally(() => setPlaytesting(false));
              }}
            >
              {playtesting ? "Playtesting…" : "Playtest"}
            </button>
            <button
              type="button"
              className="btn small ghost"
              disabled={!html?.trim()}
              onClick={() =>
                frame.current?.contentWindow?.postMessage({ type: "locus-game-reset" }, "*")
              }
            >
              Reset
            </button>
            <button
              type="button"
              className={`btn small ghost ${muted ? "on" : ""}`}
              disabled={!html?.trim()}
              onClick={() => {
                const next = !muted;
                setMuted(next);
                frame.current?.contentWindow?.postMessage(
                  { type: "locus-game-mute", on: next },
                  "*",
                );
              }}
            >
              {muted ? "Unmute" : "Mute"}
            </button>
          </>
        ) : assets ? (
          <>
            {showStage3d ? (
              <>
                <button
                  type="button"
                  className={`btn small ghost ${orbitOn ? "on" : ""}`}
                  disabled={!html?.trim()}
                  onClick={() => {
                    const next = !orbitOn;
                    setOrbitOn(next);
                    frame.current?.contentWindow?.postMessage(
                      { type: "locus-asset-orbit", on: next },
                      "*",
                    );
                  }}
                >
                  Orbit
                </button>
                {ASSET_CAMERA_VIEWS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="btn small ghost"
                    disabled={!html?.trim()}
                    onClick={() =>
                      frame.current?.contentWindow?.postMessage(
                        { type: "locus-asset-camera", view: id },
                        "*",
                      )
                    }
                  >
                    {formatAssetCameraLabel(id)}
                  </button>
                ))}
                <button
                  type="button"
                  className={`btn small ghost ${wireframeOn ? "on" : ""}`}
                  disabled={!html?.trim()}
                  onClick={() => {
                    const next = !wireframeOn;
                    setWireframeOn(next);
                    frame.current?.contentWindow?.postMessage(
                      { type: "locus-asset-wireframe", on: next },
                      "*",
                    );
                  }}
                >
                  Wireframe
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="btn small ghost"
              disabled={!html?.trim()}
              title="Zoom out"
              aria-label="Zoom out"
              onClick={() => {
                const next = stepAssetZoom(assetZoom, "out");
                setAssetZoom(next);
                frame.current?.contentWindow?.postMessage(
                  { type: "locus-asset-zoom", scale: next },
                  "*",
                );
              }}
            >
              −
            </button>
            <button
              type="button"
              className="btn small ghost"
              disabled={!html?.trim()}
              title="Reset zoom"
              aria-label="Reset zoom"
              onClick={() => {
                setAssetZoom(ASSET_ZOOM_DEFAULT);
                frame.current?.contentWindow?.postMessage(
                  { type: "locus-asset-zoom", scale: ASSET_ZOOM_DEFAULT },
                  "*",
                );
              }}
            >
              {formatAssetZoom(assetZoom)}
            </button>
            <button
              type="button"
              className="btn small ghost"
              disabled={!html?.trim()}
              title="Zoom in"
              aria-label="Zoom in"
              onClick={() => {
                const next = stepAssetZoom(assetZoom, "in");
                setAssetZoom(next);
                frame.current?.contentWindow?.postMessage(
                  { type: "locus-asset-zoom", scale: next },
                  "*",
                );
              }}
            >
              +
            </button>
            <select
              className="game-kit-select"
              aria-label="Clip"
              disabled={!html?.trim()}
              value={clip}
              onChange={(event) => {
                const next = event.target.value as (typeof ASSET_CORE_CLIPS)[number];
                setClip(next);
                setAssetPaused(false);
                frame.current?.contentWindow?.postMessage(
                  { type: "locus-asset-play", clip: next },
                  "*",
                );
              }}
            >
              {ASSET_CORE_CLIPS.map((id) => (
                <option key={id} value={id}>
                  {formatAssetClipLabel(id)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn small ghost"
              disabled={!html?.trim()}
              onClick={() => {
                setAssetPaused(false);
                frame.current?.contentWindow?.postMessage({ type: "locus-asset-play", clip }, "*");
              }}
            >
              Play
            </button>
            <button
              type="button"
              className={`btn small ghost ${assetPaused ? "on" : ""}`}
              disabled={!html?.trim()}
              onClick={() => {
                const next = !assetPaused;
                setAssetPaused(next);
                frame.current?.contentWindow?.postMessage(
                  { type: next ? "locus-asset-pause" : "locus-asset-play", clip },
                  "*",
                );
              }}
            >
              Pause
            </button>
            {ASSET_ITERATE_CHIPS.filter((chip) => visibleIterate.includes(chip.id)).map((chip) => (
              <button
                key={chip.id}
                type="button"
                className="btn small ghost"
                disabled={!html?.trim() || iterating !== null}
                onClick={() => {
                  if (iterating) return;
                  setIterating(chip.id);
                  void api
                    .chat(
                      session.id,
                      iterateAssetPrompt(chip.id, {
                        pose: poseFromTune(session.designTune),
                        title: session.title,
                        style: resolveAssetStyle(session.assetStyleId, state.assetStyles),
                      }),
                      session.status === "running" ? { steer: true } : undefined,
                    )
                    .catch(() => undefined)
                    .finally(() => setIterating(null));
                }}
              >
                {iterating === chip.id ? `${chip.title}…` : chip.title}
              </button>
            ))}
            <button
              type="button"
              className={`btn small ghost ${buildOpen ? "on" : ""}${buildDirty ? " is-dirty" : ""}`}
              aria-pressed={buildOpen}
              onClick={() => setBuildOpen((open) => !open)}
            >
              Build
            </button>
            <button
              type="button"
              className={`btn small${buildDirty ? " primary" : ""}`}
              disabled={applyingBuild}
              onClick={generateBuild}
            >
              {applyingBuild ? "Generating…" : "Generate"}
            </button>
          </>
        ) : null}
      </div>
      {assets && buildOpen ? (
        <div
          className="asset-build-tune mobile-asset-build"
          role="group"
          aria-label="Build settings"
        >
          <AssetBuildPicker
            compact
            value={assetBuild}
            onChange={patchBuild}
            mesh={assetShowsStage3d(assetSubject)}
          />
          <button
            type="button"
            className={`btn small${buildDirty ? " primary" : ""}`}
            disabled={applyingBuild}
            onClick={generateBuild}
          >
            {applyingBuild ? "Generating…" : "Generate"}
          </button>
        </div>
      ) : null}
      {httpSrc ? (
        <iframe
          ref={frame}
          key={httpSrc}
          className="mobile-canvas-frame"
          title="Canvas preview"
          sandbox={canvasIframeSandbox(httpIsolated)}
          src={httpSrc}
          data-canvas-http="1"
        />
      ) : srcDoc ? (
        <iframe
          ref={frame}
          key={srcDoc}
          className="mobile-canvas-frame"
          title="Canvas preview"
          sandbox={canvasIframeSandbox(false)}
          src={canvasFrameSrc()}
          data-srcdoc={srcDoc}
        />
      ) : (
        <div className="mobile-empty">
          <Mascot pose="rest" size={64} />
          <h2>Empty canvas</h2>
          <p>
            {game
              ? "This game has not painted `/workspace/index.html` yet."
              : assets
                ? "Drop a photo in chat or wait for the first hull. The studio paints `/workspace/index.html`."
                : "This design has not painted `/workspace/index.html` yet."}
          </p>
        </div>
      )}
      {working && (lastAssistant || liveThought) ? (
        <p className="mobile-canvas-live">
          <span className="mobile-status-dot is-running" />
          {clipOnWords(lastAssistant?.content?.trim() || liveThought || "Thinking…")}
        </p>
      ) : null}
      {working && (lastUser || lastAssistant) ? (
        <ul className="mobile-canvas-log">
          {lastUser ? (
            <li>
              <span className="mobile-slack-face" aria-hidden="true">
                Y
              </span>
              <span>{clipOnWords(lastUser.content)}</span>
            </li>
          ) : null}
          {lastAssistant ? (
            <li className="is-agent">
              <span className="mobile-slack-face" aria-hidden="true">
                L
              </span>
              <span>
                {clipOnWords(lastAssistant.content.trim() || lastAssistant.thinking || "")}
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}
      <form
        className="mobile-canvas-comment"
        onSubmit={(event) => {
          event.preventDefault();
          void sendNote();
        }}
      >
        {pinned ? <p className="mobile-pr-meta">Pinned {pinned}</p> : null}
        {commenting ? <p className="hint">Tap an element, then describe the change.</p> : null}
        {error ? <p className="mobile-error">{error}</p> : null}
        <div className="mobile-canvas-compose">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={1}
            placeholder={
              pinned ? "What should change?" : working ? "Reply…" : "Ask the design agent…"
            }
            aria-label="Canvas instruction"
          />
          <button
            type="submit"
            className="mobile-icon-btn mobile-new"
            disabled={busy || !note.trim()}
            aria-label={busy ? "Sending" : "Send"}
          >
            <IconSend />
            <span className="mobile-sr">Send</span>
          </button>
        </div>
      </form>
    </div>
  );
}
