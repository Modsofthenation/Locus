import { useEffect, useState } from "react";
import { api, type UnityEditorJob } from "@/lib/api";

type Action = UnityEditorJob["action"];

/** Unity's real Editor operations, not the browser Games canvas. */
export function UnityProjectPanel({ sessionId }: { sessionId: string }) {
  const [job, setJob] = useState<UnityEditorJob | null>(null);
  const [scene, setScene] = useState("Assets/Scenes/SampleScene.unity");
  const [target, setTarget] = useState<"linux" | "windows" | "macos" | "webgl">("webgl");
  const [error, setError] = useState("");
  const [details, setDetails] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [sceneOptions, setSceneOptions] = useState<string[]>([]);

  useEffect(() => {
    setJob(null);
    setPreviewId(null);
    setSceneOptions([]);
    setError("");
    let alive = true;
    const refresh = () => {
      void api
        .latestUnityJob(sessionId)
        .then(({ job: remote, preview }) => {
          if (!alive) return;
          setPreviewId(preview?.id ?? null);
          if (remote)
            setJob((current) =>
              !current || remote.id === current.id || remote.startedAt >= current.startedAt
                ? remote
                : current,
            );
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [sessionId]);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const timer = window.setInterval(() => {
      void api
        .getUnityJob(sessionId, job.id)
        .then(setJob)
        .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [sessionId, job?.id, job?.status]);

  useEffect(() => {
    if (job?.action !== "inspect" || job.status !== "succeeded" || !job.data) return;
    const rows = (job.data as { scenes?: Array<{ path?: string }> }).scenes;
    if (!Array.isArray(rows)) return;
    const paths = rows
      .map((row) => row.path)
      .filter((path): path is string => typeof path === "string");
    setSceneOptions(paths);
    if (paths.length > 0) setScene((current) => (paths.includes(current) ? current : paths[0]!));
  }, [job?.id, job?.status, job?.data]);

  async function run(action: Action) {
    if (job?.status === "running") return;
    setError("");
    setDetails(false);
    try {
      const created = await api.startUnityJob(sessionId, {
        action,
        ...(action === "capture" || action === "create-scene" ? { scene } : {}),
        ...(action === "build" ? { target } : {}),
      });
      setJob(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const running = job?.status === "running";
  return (
    <section className="unity-project-panel" aria-label="Unity Editor automation">
      <div className="row">
        <strong>Unity Editor</strong>
        <span className="hint">
          Runs Unity Editor and project scripts on this computer. Use trusted projects only, and
          close any other Editor instance first.
        </span>
      </div>
      <div
        className="row"
        style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}
      >
        <button
          type="button"
          className="btn small"
          disabled={running}
          onClick={() => void run("inspect")}
        >
          Inspect scenes
        </button>
        <button
          type="button"
          className="btn small"
          disabled={running}
          onClick={() => void run("compile")}
        >
          Compile/import
        </button>
        <button
          type="button"
          className="btn small"
          disabled={running}
          onClick={() => void run("playtest")}
        >
          PlayMode tests
        </button>
        <button
          type="button"
          className="btn small"
          disabled={running}
          onClick={() => void run("create-scene")}
        >
          Create scene
        </button>
        <button
          type="button"
          className="btn small"
          disabled={running}
          onClick={() => void run("capture")}
        >
          Capture scene
        </button>
        <button
          type="button"
          className="btn small"
          disabled={running}
          onClick={() => void run("build")}
        >
          Build / Preview
        </button>
      </div>
      <div
        className="row"
        style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}
      >
        <label className="hint">
          Scene asset path{" "}
          <input
            aria-label="Unity scene path"
            value={scene}
            onChange={(event) => setScene(event.target.value)}
            placeholder="Assets/Scenes/Main.unity"
          />
        </label>
        <label className="hint">
          Build target{" "}
          <select
            aria-label="Unity build target"
            value={target}
            onChange={(event) => setTarget(event.target.value as typeof target)}
          >
            <option value="webgl">WebGL (interactive preview)</option>
            <option value="linux">Linux</option>
            <option value="windows">Windows</option>
            <option value="macos">macOS</option>
          </select>
        </label>
      </div>
      {error ? (
        <p role="alert" className="hint">
          {error}
        </p>
      ) : null}
      {sceneOptions.length ? (
        <label className="hint">
          Scene from inspection{" "}
          <select
            aria-label="Select inspected scene"
            value={sceneOptions.includes(scene) ? scene : ""}
            onChange={(event) => setScene(event.target.value)}
          >
            <option value="" disabled>
              Choose scene
            </option>
            {sceneOptions.map((path) => (
              <option value={path} key={path}>
                {path}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {previewId ? (
        <div className="unity-webgl-preview">
          <p className="hint">
            Latest playable Unity WebGL build (rebuild to reflect code changes). Click inside for
            keyboard/gamepad controls.
          </p>
          <iframe
            key={previewId}
            title="Interactive Unity game preview"
            sandbox="allow-scripts allow-pointer-lock allow-downloads"
            src={`/api/sessions/${encodeURIComponent(sessionId)}/unity/jobs/${encodeURIComponent(previewId)}/webgl/index.html`}
            style={{
              display: "block",
              width: "100%",
              aspectRatio: "16 / 9",
              border: "1px solid var(--border)",
            }}
          />
        </div>
      ) : null}

      {job ? (
        <div role="status" className="hint">
          <strong>
            {job.action}: {job.status}
          </strong>{" "}
          {job.message}
          {job.data ? (
            <pre style={{ whiteSpace: "pre-wrap", maxHeight: 210, overflow: "auto" }}>
              {JSON.stringify(job.data, null, 2)}
            </pre>
          ) : null}
          {job.screenshot ? (
            <img
              src={`/api/sessions/${encodeURIComponent(sessionId)}/unity/jobs/${encodeURIComponent(job.id)}/screenshot`}
              alt="Unity scene camera render"
              style={{ maxWidth: "100%", maxHeight: 360 }}
            />
          ) : null}
          {job.log ? (
            <>
              <button
                type="button"
                className="btn small ghost"
                onClick={() => setDetails((current) => !current)}
              >
                {details ? "Hide Editor log" : "Show Editor log"}
              </button>
              {details ? (
                <pre style={{ whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>
                  {job.log}
                </pre>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
