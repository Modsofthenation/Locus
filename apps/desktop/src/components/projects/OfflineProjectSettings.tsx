import { useEffect, useState } from "react";
import {
  DEFAULT_DOCKER_IMAGE,
  imageRuntime,
  isLocalOpenAiBase,
  isOllamaProvider,
  type GoldenImage,
  type ProjectDocument,
  type ProjectOfflinePreflight,
} from "@locus/shared";
import { api } from "@/lib/api";
import { useStore } from "@/state/store";

export function OfflineProjectSettings({ project }: { project: ProjectDocument }) {
  const { state, dispatch } = useStore();
  const providers = (state.config?.providers ?? []).filter(
    (row) =>
      row.kind === "openai-compatible" && isOllamaProvider(row) && isLocalOpenAiBase(row.baseUrl),
  );
  const selectProvider = project.offlineProfile?.providerId ?? providers[0]?.id ?? "";
  const [providerId, setProviderId] = useState(selectProvider);
  const [model, setModel] = useState(
    project.offlineProfile?.model ??
      providers.find((row) => row.id === selectProvider)?.defaultModel ??
      "",
  );
  const [dockerImage, setDockerImage] = useState(
    project.offlineProfile?.dockerImage ?? DEFAULT_DOCKER_IMAGE,
  );
  const [imageId, setImageId] = useState(project.offlineProfile?.imageId ?? "");
  const [images, setImages] = useState<GoldenImage[]>([]);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ProjectOfflinePreflight>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const profile = {
    providerId,
    model: model.trim(),
    dockerImage: dockerImage.trim(),
    imageId: imageId || undefined,
  };

  useEffect(() => {
    if (!open) return;
    let live = true;
    void api.images().then(
      (rows) => {
        if (live) setImages(rows);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [open]);

  async function run(action: "check" | "save" | "disable") {
    setBusy(true);
    setError("");
    try {
      if (action === "check") {
        setResult(await api.projectOfflinePreflight(project.id, profile));
      } else {
        const updated = await api.patchProject(project.id, {
          offlineProfile: action === "save" ? profile : null,
        });
        dispatch({ type: "project", project: updated });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="offline-project" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Offline profile{project.offlineProfile ? " · Enabled" : ""}</summary>
      <p className="hint">
        Use Ollama for the next coordinator and run new agents in network-isolated Docker
        containers. A cached golden workspace can supply code and dependencies. Existing sessions
        keep their settings.
      </p>
      {providers.length ? (
        <div className="offline-profile-controls">
          <label>
            Local provider
            <select
              value={providerId}
              onChange={(event) => {
                const id = event.target.value;
                setProviderId(id);
                setModel(providers.find((row) => row.id === id)?.defaultModel ?? "");
                setResult(undefined);
              }}
            >
              <option value="">Choose a provider</option>
              {providers.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ollama model
            <input
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                setResult(undefined);
              }}
            />
          </label>
          <label>
            Cached Docker image
            <input
              value={dockerImage}
              onChange={(event) => {
                setDockerImage(event.target.value);
                setResult(undefined);
              }}
            />
          </label>
          <label>
            Golden workspace
            <select
              value={imageId}
              onChange={(event) => {
                setImageId(event.target.value);
                setResult(undefined);
              }}
            >
              <option value="">Empty workspace</option>
              {images
                .filter((image) => imageRuntime(image) === "docker")
                .map((image) => (
                  <option key={image.id} value={image.id}>
                    {image.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      ) : (
        <p>Enable a loopback Ollama provider in Settings → Providers.</p>
      )}
      <div className="offline-profile-controls">
        <button
          type="button"
          className="btn small"
          disabled={busy || !profile.providerId || !profile.model || !profile.dockerImage}
          onClick={() => void run("check")}
        >
          Check offline readiness
        </button>
        <button
          type="button"
          className="btn small"
          disabled={busy || !profile.providerId || !profile.model || !profile.dockerImage}
          onClick={() => void run("save")}
        >
          Save offline profile
        </button>
        {project.offlineProfile ? (
          <button
            type="button"
            className="btn small ghost"
            disabled={busy}
            onClick={() => void run("disable")}
          >
            Disable offline profile
          </button>
        ) : null}
      </div>
      {result ? (
        <div aria-live="polite">
          <ul>
            {result.checks.map((check) => (
              <li key={check.label}>
                {check.label} · {check.ready ? "Ready" : "Missing"} · {check.detail}
              </li>
            ))}
          </ul>
          <p>Unavailable offline · {result.unavailable.join(", ")}</p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="hint is-danger">
          {error}
        </p>
      ) : null}
    </details>
  );
}
