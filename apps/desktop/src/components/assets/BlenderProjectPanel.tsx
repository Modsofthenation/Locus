import { useEffect, useState } from "react";
import { api, type BlenderEditorJob } from "@/lib/api";

export function BlenderProjectPanel({ sessionId }: { sessionId: string }) {
  const [job, setJob] = useState<BlenderEditorJob | null>(null);
  const [file, setFile] = useState("assets/model.blend");
  const [script, setScript] = useState("scripts/edit.py");
  const [format, setFormat] = useState<"glb" | "fbx" | "obj" | "stl">("glb");
  const [error, setError] = useState("");
  const [details, setDetails] = useState(false);
  useEffect(() => {
    setJob(null);
    setError("");
    let active = true;
    const refresh = () =>
      void api
        .latestBlenderJob(sessionId)
        .then(({ job: current }) => {
          if (active && current)
            setJob((previous) =>
              !previous || previous.id === current.id || previous.startedAt <= current.startedAt
                ? current
                : previous,
            );
        })
        .catch(() => undefined);
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
        .getBlenderJob(sessionId, job.id)
        .then(setJob)
        .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [sessionId, job?.id, job?.status]);
  async function run(action: BlenderEditorJob["action"]) {
    if (job?.status === "running") return;
    if (
      action === "script" &&
      !window.confirm(
        `Run ${script} against ${file}? This Python code executes on your computer with your user permissions and can modify files. Proceed only if you have reviewed and trust it.`,
      )
    )
      return;
    setError("");
    setDetails(false);
    try {
      const result = await api.startBlenderJob(sessionId, {
        action,
        file,
        ...(action === "script" ? { script } : {}),
        ...(action === "export" ? { format } : {}),
      });
      setJob(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  const running = job?.status === "running";
  return (
    <section className="unity-project-panel" aria-label="Blender project tools">
      <div className="row">
        <strong>Blender</strong>{" "}
        <span className="hint">
          Runs installed Blender on real .blend files in your selected local Host workspace. Open
          trusted projects only.
        </span>
      </div>
      <div
        className="row"
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
      >
        <label className="hint">
          .blend file{" "}
          <input
            aria-label="Blender file"
            value={file}
            onChange={(event) => setFile(event.target.value)}
          />
        </label>
        <label className="hint">
          Export format{" "}
          <select
            aria-label="Blender export format"
            value={format}
            onChange={(event) => setFormat(event.target.value as typeof format)}
          >
            <option value="glb">GLB</option>
            <option value="fbx">FBX</option>
            <option value="obj">OBJ</option>
            <option value="stl">STL</option>
          </select>
        </label>
      </div>
      <div className="row" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["create", "inspect", "validate", "render", "export"] as const).map((action) => (
          <button
            key={action}
            className="btn small"
            type="button"
            disabled={running}
            onClick={() => void run(action)}
          >
            {action === "create"
              ? "Create scene"
              : action === "inspect"
                ? "Inspect scene"
                : action === "validate"
                  ? "Validate assets"
                  : action === "render"
                    ? "Render preview"
                    : "Export asset"}
          </button>
        ))}
      </div>
      <div className="row">
        <label className="hint">
          Trusted Python script{" "}
          <input
            aria-label="Blender script"
            value={script}
            onChange={(event) => setScript(event.target.value)}
          />
        </label>{" "}
        <button
          className="btn small"
          type="button"
          disabled={running}
          onClick={() => void run("script")}
        >
          Run script
        </button>
      </div>
      {error ? (
        <p role="alert" className="hint">
          {error}
        </p>
      ) : null}
      {job ? (
        <div role="status" className="hint">
          <strong>
            {job.action}: {job.status}
          </strong>{" "}
          {job.message}
          {job.data ? (
            <pre style={{ whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>
              {JSON.stringify(job.data, null, 2)}
            </pre>
          ) : null}
          {job.action === "export" &&
          job.status === "succeeded" &&
          typeof (job.data as { export?: unknown } | undefined)?.export === "string" ? (
            <a
              className="btn small"
              download
              href={
                "/api/sessions/" +
                encodeURIComponent(sessionId) +
                "/blender/jobs/" +
                encodeURIComponent(job.id) +
                "/export"
              }
            >
              Download exported model
            </a>
          ) : null}
          {job.image && job.status === "succeeded" ? (
            <img
              alt="Blender scene render"
              style={{ maxWidth: "100%", maxHeight: 420 }}
              src={
                "/api/sessions/" +
                encodeURIComponent(sessionId) +
                "/blender/jobs/" +
                encodeURIComponent(job.id) +
                "/image"
              }
            />
          ) : null}
          {job.log ? (
            <>
              <button
                className="btn small ghost"
                type="button"
                onClick={() => setDetails((value) => !value)}
              >
                {details ? "Hide Blender log" : "Show Blender log"}
              </button>
              {details ? (
                <pre style={{ whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto" }}>
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
