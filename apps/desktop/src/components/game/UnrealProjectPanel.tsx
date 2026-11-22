import { useEffect, useState } from "react";
import { api, type UnrealEditorJob } from "@/lib/api";

type Action = UnrealEditorJob["action"];
type Target = "windows" | "linux" | "macos";

function hostTarget(): Target {
  const platform = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Windows/i.test(platform)) return "windows";
  if (/Mac OS X|Macintosh/i.test(platform)) return "macos";
  return "linux";
}

/** Real Unreal Engine operations (UBT, commandlets, UAT), not the browser Games canvas. */
export function UnrealProjectPanel({ sessionId }: { sessionId: string }) {
  const [job, setJob] = useState<UnrealEditorJob | null>(null);
  const [target, setTarget] = useState<Target>(hostTarget);
  const [filter, setFilter] = useState("");
  const [script, setScript] = useState("Content/Python/");
  const [error, setError] = useState("");
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    setJob(null);
    setError("");
    let active = true;
    const refresh = () => {
      void api
        .latestUnrealJob(sessionId)
        .then(({ job: current }) => {
          if (!active || !current) return;
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
        .getUnrealJob(sessionId, job.id)
        .then(setJob)
        .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [sessionId, job?.id, job?.status]);

  async function run(action: Action) {
    if (job?.status === "running") return;
    setError("");
    setShowLog(false);
    try {
      const result = await api.startUnrealJob(sessionId, {
        action,
        ...(action === "package" ? { target } : {}),
        ...(action === "test" && filter.trim() ? { filter: filter.trim() } : {}),
        ...(action === "python" ? { script: script.trim() } : {}),
      });
      setJob(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const running = job?.status === "running";
  const buttons: Array<[Action, string]> = [
    ["inspect", "Inspect project"],
    ["compile", "Compile"],
    ["test", "Run tests"],
    ["python", "Run Python script"],
    ["package", "Package"],
  ];
  return (
    <section className="unreal-project-panel" aria-label="Unreal Engine development tools">
      <div>
        <strong>Unreal Engine</strong>{" "}
        <span className="hint">
          Runs UnrealBuildTool, editor commandlets and packaging on this computer. Use trusted
          projects only, and close the Unreal Editor while a job runs.
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        {buttons.map(([action, label]) => (
          <button
            key={action}
            className="btn small"
            type="button"
            disabled={running}
            onClick={() => void run(action)}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        <label className="hint">
          Test filter{" "}
          <input
            aria-label="Unreal automation test filter"
            value={filter}
            placeholder="Project name"
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
        <label className="hint">
          Python script{" "}
          <input
            aria-label="Unreal Python script path"
            value={script}
            placeholder="Content/Python/build_level.py"
            onChange={(event) => setScript(event.target.value)}
          />
        </label>
        <label className="hint">
          Package for{" "}
          <select
            aria-label="Unreal package target"
            value={target}
            onChange={(event) => setTarget(event.target.value as Target)}
          >
            <option value="windows">Windows</option>
            <option value="linux">Linux</option>
            <option value="macos">macOS</option>
          </select>
        </label>
      </div>
      {error ? (
        <p className="hint" role="alert">
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
                {showLog ? "Hide Unreal log" : "Show Unreal log"}
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
