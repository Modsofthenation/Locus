import { useEffect, useState } from "react";
import { api, type GodotEditorJob } from "@/lib/api";

type Action = GodotEditorJob["action"];

export function GodotProjectPanel({ sessionId }: { sessionId: string }) {
  const [job, setJob] = useState<GodotEditorJob | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [scene, setScene] = useState("res://Scenes/Main.tscn");
  const [target, setTarget] = useState<"web" | "linux" | "windows" | "macos">("web");
  const [error, setError] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [scenes, setScenes] = useState<string[]>([]);

  useEffect(() => {
    setJob(null);
    setPreviewId(null);
    setScenes([]);
    setError("");
    let active = true;
    const refresh = () => {
      void api
        .latestGodotJob(sessionId)
        .then(({ job: current, preview }) => {
          if (!active) return;
          setPreviewId(preview?.id ?? null);
          if (current)
            setJob((previous) =>
              !previous || previous.id === current.id || previous.startedAt <= current.startedAt
                ? current
                : previous,
            );
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [sessionId]);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const timer = window.setInterval(() => {
      void api
        .getGodotJob(sessionId, job.id)
        .then(setJob)
        .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [sessionId, job?.id, job?.status]);

  useEffect(() => {
    if (job?.action !== "inspect" || job.status !== "succeeded" || !job.data) return;
    const rows = (job.data as { scenes?: Array<{ path?: string }> }).scenes;
    if (!Array.isArray(rows)) return;
    const paths = rows
      .map((item) => item.path)
      .filter((path): path is string => typeof path === "string");
    setScenes(paths);
    if (paths.length) setScene((current) => (paths.includes(current) ? current : paths[0]!));
  }, [job?.id, job?.status, job?.data]);

  async function run(action: Action) {
    if (job?.status === "running") return;
    setError("");
    setShowLog(false);
    try {
      const result = await api.startGodotJob(sessionId, {
        action,
        ...(action === "create-scene" ? { scene } : {}),
        ...(action === "export" ? { target } : {}),
      });
      setJob(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const running = job?.status === "running";
  return (
    <section className="godot-project-panel" aria-label="Godot Engine development tools">
      <div>
        <strong>Godot Engine</strong>{" "}
        <span className="hint">
          Godot 4 Host project. Only open trusted projects: Editor plugins and scripts can execute
          on your computer.
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        <button
          className="btn small"
          type="button"
          disabled={running}
          onClick={() => void run("inspect")}
        >
          Inspect scenes
        </button>
        <button
          className="btn small"
          type="button"
          disabled={running}
          onClick={() => void run("import")}
        >
          Import / Parse
        </button>
        <button
          className="btn small"
          type="button"
          disabled={running}
          onClick={() => void run("smoke")}
        >
          Smoke test
        </button>
        <button
          className="btn small"
          type="button"
          disabled={running}
          onClick={() => void run("create-scene")}
        >
          Create scene
        </button>
        <button
          className="btn small"
          type="button"
          disabled={running}
          onClick={() => void run("export")}
        >
          Export / Preview
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        <label className="hint">
          Scene{" "}
          <input
            aria-label="Godot scene path"
            value={scene}
            onChange={(event) => setScene(event.target.value)}
          />
        </label>
        <label className="hint">
          Target{" "}
          <select
            aria-label="Godot export target"
            value={target}
            onChange={(event) => setTarget(event.target.value as typeof target)}
          >
            <option value="web">Web (playable preview)</option>
            <option value="linux">Linux</option>
            <option value="windows">Windows</option>
            <option value="macos">macOS</option>
          </select>
        </label>
      </div>
      {scenes.length ? (
        <label className="hint">
          Inspected scenes{" "}
          <select
            aria-label="Select inspected Godot scene"
            value={scenes.includes(scene) ? scene : ""}
            onChange={(event) => setScene(event.target.value)}
          >
            <option value="" disabled>
              Select scene
            </option>
            {scenes.map((path) => (
              <option value={path} key={path}>
                {path}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {error ? (
        <p className="hint" role="alert">
          {error}
        </p>
      ) : null}
      {previewId ? (
        <div>
          <p className="hint">
            Latest playable Godot Web export. Rebuild after source changes. Some Godot Web exports
            require cross-origin isolation to run with multiple threads.
          </p>
          <iframe
            key={previewId}
            title="Godot playable Web preview"
            sandbox="allow-scripts allow-pointer-lock allow-downloads"
            src={`/api/sessions/${encodeURIComponent(sessionId)}/godot/jobs/${encodeURIComponent(previewId)}/web/index.html`}
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
            <pre style={{ maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap" }}>
              {JSON.stringify(job.data, null, 2)}
            </pre>
          ) : null}
          {job.log ? (
            <>
              <button
                className="btn small ghost"
                type="button"
                onClick={() => setShowLog((value) => !value)}
              >
                {showLog ? "Hide Godot log" : "Show Godot log"}
              </button>
              {showLog ? (
                <pre style={{ maxHeight: 300, overflow: "auto", whiteSpace: "pre-wrap" }}>
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
