import { useEffect, useState } from "react";
import type { VisualBaseline, VisualViewport } from "@locus/shared";
import { api } from "@/lib/api";
import { showErrorNotice, showNotice } from "@/lib/notice";
import { useStore } from "@/state/store";

export function VisualReview({ sessionId }: { sessionId: string }) {
  const [rows, setRows] = useState<VisualBaseline[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const baseline = rows.find((row) => row.id === selected) ?? rows[0];

  useEffect(() => {
    let live = true;
    void api.visualBaselines(sessionId).then(
      (result) => {
        if (live) setRows(result);
      },
      (err: unknown) => {
        if (live) setError(String(err));
      },
    );
    return () => {
      live = false;
    };
  }, [sessionId]);

  async function capture(input: { baselineId: string } | { name: string; path?: string }) {
    setBusy(true);
    setError("");
    try {
      const result = await api.captureVisualReview(sessionId, input);
      setRows(result);
      setSelected("baselineId" in input ? input.baselineId : (result[0]?.id ?? ""));
      if ("name" in input) setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function image(viewport: VisualViewport, phase: "before" | "after" | "diff", label: string) {
    if (!baseline) return null;
    const version = phase === "before" ? baseline.id : baseline.comparison?.id;
    const url = `/api/sessions/${encodeURIComponent(sessionId)}/visual-review/${baseline.id}/${viewport}-${phase}.png?v=${version}`;
    return (
      <figure key={phase} className="visual-review-shot">
        <figcaption>{label}</figcaption>
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={`${viewport} ${label.toLowerCase()}`} loading="lazy" />
        </a>
      </figure>
    );
  }

  return (
    <details className="visual-review">
      <summary>Visual review</summary>
      <p className="hint">Capture the running web preview at desktop and mobile sizes.</p>
      <div className="visual-review-controls">
        <label>
          Baseline name
          <input maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Page path
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="Current preview path"
          />
        </label>
        <button
          type="button"
          className="btn small"
          disabled={busy || !name.trim()}
          onClick={() => void capture({ name, path: path.trim() || undefined })}
        >
          Save baseline
        </button>
      </div>
      {baseline ? (
        <>
          <div className="visual-review-controls">
            <label>
              Baseline
              <select value={baseline.id} onChange={(event) => setSelected(event.target.value)}>
                {rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} · {row.path}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn small"
              disabled={busy}
              onClick={() => void capture({ baselineId: baseline.id })}
            >
              Compare current preview
            </button>
          </div>
          {(["desktop", "mobile"] as const).map((viewport) => (
            <section key={viewport}>
              <h4>
                {viewport === "desktop" ? "Desktop" : "Mobile"}
                {baseline.comparison
                  ? ` · ${baseline.comparison.percentages[viewport].toLocaleString(undefined, { maximumFractionDigits: 2 })}% changed`
                  : ""}
              </h4>
              <div className="visual-review-images">
                {image(viewport, "before", "Baseline")}
                {baseline.comparison
                  ? [
                      image(viewport, "after", "Current"),
                      image(viewport, "diff", "Highlighted changes"),
                    ]
                  : null}
              </div>
            </section>
          ))}
        </>
      ) : null}
      {busy ? <p role="status">Capturing preview…</p> : null}
      {error ? (
        <p role="alert" className="hint is-danger">
          {error}
        </p>
      ) : null}
    </details>
  );
}

export function PrepareVisualReviewButton({
  sessionId,
  target,
}: {
  sessionId: string;
  target: { port: number; path: string };
}) {
  const { dispatch } = useStore();
  const [busy, setBusy] = useState(false);
  async function prepare() {
    setBusy(true);
    try {
      const session = await api.patchSession(sessionId, {
        preview: { port: target.port, path: target.path },
      });
      dispatch({ type: "session", session });
      showNotice("Visual review is available in Artifacts.");
    } catch (error) {
      showErrorNotice(error, "Could not select the visual review preview");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      className="btn small ghost"
      disabled={busy}
      onClick={() => void prepare()}
    >
      Enable visual review
    </button>
  );
}
