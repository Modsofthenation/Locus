import {
  AGENT_RUNTIMES,
  DEFAULT_DOCKER_IMAGES,
  parseDockerImage,
  workerKind,
  workerWhereLabel,
  type AgentRuntime,
  type WorkerBackend,
} from "@locus/shared";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const RUNTIME_LABEL: Record<AgentRuntime, string> = {
  docker: "Docker",
  vm: "VM",
  host: "Host",
};

export function RuntimeToggle({
  value,
  onChange,
  runtimes = AGENT_RUNTIMES,
  disabledRuntimes = [],
}: {
  value: AgentRuntime;
  onChange: (runtime: AgentRuntime) => void;
  runtimes?: AgentRuntime[];
  disabledRuntimes?: AgentRuntime[];
}) {
  const options = runtimes.length ? runtimes : AGENT_RUNTIMES;
  return (
    <div className="runtime-toggle" role="tablist" aria-label="Agent runtime">
      {options.map((runtime) => (
        <button
          key={runtime}
          type="button"
          role="tab"
          aria-selected={value === runtime}
          className={value === runtime ? "active" : ""}
          disabled={disabledRuntimes.includes(runtime)}
          onClick={() => {
            if (disabledRuntimes.includes(runtime)) return;
            onChange(runtime);
          }}
        >
          {RUNTIME_LABEL[runtime]}
        </button>
      ))}
    </div>
  );
}

type WhereLive = "checking" | "live" | "unreachable";

export function PlacementToggle({
  workers,
  value,
  onChange,
}: {
  workers: WorkerBackend[];
  value: string;
  onChange: (backendId: string) => void;
}) {
  const [live, setLive] = useState<Record<string, WhereLive>>({});
  const probeKey = workers
    .filter((row) => workerKind(row) !== "fargate" && row.url)
    .map((row) => row.id)
    .join(",");

  useEffect(() => {
    const ids = probeKey ? probeKey.split(",") : [];
    if (!ids.length) {
      setLive({});
      return;
    }
    let cancelled = false;
    setLive(Object.fromEntries(ids.map((id) => [id, "checking" as const])));
    const probe = api.workersStatus;
    if (typeof probe !== "function") return;
    void probe()
      .then((rows) => {
        if (cancelled) return;
        const next: Record<string, WhereLive> = {};
        for (const row of rows) {
          if (row.skipped) continue;
          next[row.id] = row.live ? "live" : "unreachable";
        }
        setLive(next);
      })
      .catch(() => {
        if (!cancelled) setLive({});
      });
    return () => {
      cancelled = true;
    };
  }, [probeKey]);

  if (!workers.length) return null;
  return (
    <div className="where-picker">
      <p className="where-label">Where</p>
      <div className="runtime-toggle" role="tablist" aria-label="Where">
        <button
          type="button"
          role="tab"
          aria-selected={!value}
          className={!value ? "active" : ""}
          onClick={() => onChange("")}
        >
          This machine
        </button>
        {workers.map((worker) => {
          const status = live[worker.id];
          return (
            <button
              key={worker.id}
              type="button"
              role="tab"
              data-worker-id={worker.id}
              aria-selected={value === worker.id}
              className={value === worker.id ? "active" : ""}
              title={
                status === "live"
                  ? "Reachable"
                  : status === "unreachable"
                    ? "Unreachable"
                    : status === "checking"
                      ? "Checking…"
                      : undefined
              }
              onClick={() => onChange(worker.id)}
            >
              {workerWhereLabel(worker)}
              {status === "live" ? (
                <span className="where-live"> live</span>
              ) : status === "unreachable" ? (
                <span className="where-unreachable"> unreachable</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DockerImageField({
  value,
  onChange,
}: {
  value: string;
  onChange: (image: string) => void;
}) {
  const parsed = parseDockerImage(value);
  return (
    <div className="docker-image-field">
      <div className="image-chips">
        {DEFAULT_DOCKER_IMAGES.map((item) => (
          <button
            key={item.image}
            type="button"
            className={`btn chip ${parseDockerImage(value) === parseDockerImage(item.image) ? "on" : ""}`}
            title={item.summary}
            onClick={() => onChange(item.image)}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div className="field">
        <label>Docker image</label>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="locus/agent or ghcr.io/org/image:tag"
          spellCheck={false}
        />
        {!parsed && value.trim() ? (
          <p className="hint">Use a plain image name — no spaces or shell characters.</p>
        ) : null}
      </div>
    </div>
  );
}
