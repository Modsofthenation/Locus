import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_DOCKER_LOG_TAIL,
  dockerSwarmActive,
  dockerSwarmManager,
  type DockerSwarmNode,
  type DockerSwarmService,
  type DockerSwarmTask,
} from "@locus/shared";
import { api } from "@/lib/api";
import { askPrompt } from "@/lib/dialog";
import { countDockerLogLevels, formatLogTime, parseDockerLogs } from "@/lib/docker";
import { useStore } from "@/state/store";
import { EmptyHero } from "@/components/layout/EmptyHero";
import { ErrorBanner } from "@/components/layout/Skeleton";
import { SearchField } from "@/components/layout/SearchField";

type SwarmTab = "logs" | "tasks";

export function DockerSwarmPane() {
  const { state, dispatch } = useStore();
  const snapshot = state.dockerSwarm;
  const service = snapshot?.services.find(
    (row) => row.id === state.selectedSwarmServiceId || row.name === state.selectedSwarmServiceId,
  );
  const node = snapshot?.nodes.find(
    (row) => row.id === state.selectedSwarmNodeId || row.hostname === state.selectedSwarmNodeId,
  );
  const [tab, setTab] = useState<SwarmTab>("logs");
  const [logs, setLogs] = useState("");
  const [tasks, setTasks] = useState<DockerSwarmTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grep, setGrep] = useState("");
  const [follow, setFollow] = useState(true);
  const logPane = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTab("logs");
    setGrep("");
    setFollow(true);
    setTasks([]);
  }, [service?.id, node?.id]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!service) {
        setLogs("");
        return;
      }
      try {
        const next = await api.dockerSwarmLogs(service.id);
        if (!cancelled) {
          setLogs(next.text);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load logs");
      }
    }
    void load();
    if (!service || !follow || tab !== "logs") {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(() => void load(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [service?.id, follow, tab]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!service) return;
      try {
        const detail = await api.dockerSwarmService(service.id);
        if (!cancelled) setTasks(detail.tasks);
      } catch {
        if (!cancelled) setTasks([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [service?.id]);

  const parsed = useMemo(() => parseDockerLogs(logs), [logs]);
  const counts = useMemo(() => countDockerLogLevels(parsed), [parsed]);
  const visibleLines = useMemo(() => {
    const needle = grep.trim().toLowerCase();
    return parsed.filter((line) => !needle || line.raw.toLowerCase().includes(needle));
  }, [parsed, grep]);

  useEffect(() => {
    if (!follow) return;
    logPane.current?.scrollTo?.({ top: logPane.current.scrollHeight });
  }, [logs, follow, grep]);

  async function refresh() {
    if (typeof api.dockerSwarm !== "function") return;
    const next = await api.dockerSwarm();
    dispatch({
      type: "dockerSwarm",
      swarm: {
        info: next.info,
        nodes: next.nodes,
        services: next.services,
        stacks: next.stacks,
      },
    });
  }

  async function scaleService(row: DockerSwarmService) {
    if (busy || row.mode.toLowerCase() === "global") return;
    const current = Number.parseInt(row.replicas.split("/")[1] ?? row.replicas, 10);
    const raw = await askPrompt({
      title: `Replicas for ${row.name}`,
      value: String(Number.isFinite(current) ? current : 1),
    });
    if (raw == null) return;
    const replicas = Number.parseInt(raw, 10);
    if (!Number.isFinite(replicas) || replicas < 0) {
      setError("Enter a replica count from 0 to 256");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.dockerSwarmScale(row.id, replicas);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not scale service");
    } finally {
      setBusy(false);
    }
  }

  if (!snapshot || !dockerSwarmActive(snapshot.info)) {
    return (
      <div className="empty">
        <div className="empty-card">
          <EmptyHero
            pose="rest"
            size={76}
            eyebrow="Docker Swarm"
            title="Swarm inactive"
            lead="This Docker engine is not in Swarm mode. Initialize a swarm with the Docker CLI, or point DOCKER_HOST at a manager. This is the local engine — not Locus Swarm teams, and not the Portainer integration."
          />
          <div className="empty-actions">
            <button className="btn" onClick={() => void refresh().catch(() => undefined)}>
              Refresh
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (node && !service) {
    return <SwarmNodeDetail node={node} error={error} />;
  }

  if (!service) {
    const manager = dockerSwarmManager(snapshot.info);
    return (
      <div className="empty">
        <div className="empty-card">
          <EmptyHero
            pose="rest"
            size={76}
            eyebrow="Docker Swarm"
            title={manager ? "Pick a service" : "Worker node"}
            lead={
              manager
                ? "Select a service or node in the sidebar. Scale waits for a confirm. Agents can call docker_swarm on this engine."
                : "This engine is a Swarm worker. Connect Locus to a manager to list services."
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="docker-pane">
      <div className="docker-head">
        <span className={`docker-pill ${service.replicas.startsWith("0/") ? "off" : "live"}`}>
          {service.replicas} · {service.mode}
        </span>
        <div className="docker-actions">
          {service.mode.toLowerCase() !== "global" ? (
            <button
              className="btn small"
              disabled={busy}
              onClick={() => void scaleService(service)}
            >
              Scale
            </button>
          ) : null}
          <button
            className="btn small"
            onClick={() => {
              setTab("logs");
              void api.dockerSwarmLogs(service.id).then(
                (next) => setLogs(next.text),
                (err: unknown) =>
                  setError(err instanceof Error ? err.message : "Could not load logs"),
              );
            }}
          >
            Pull logs
          </button>
        </div>
      </div>
      <dl className="meta-grid docker-meta-pane">
        <div>
          <dt>Image</dt>
          <dd title={service.image}>{service.image || "—"}</dd>
        </div>
        <div>
          <dt>Service ID</dt>
          <dd title={service.id}>{service.id.slice(0, 12)}</dd>
        </div>
        <div>
          <dt>Ports</dt>
          <dd>{service.ports || "—"}</dd>
        </div>
        <div>
          <dt>Replicas</dt>
          <dd>{service.replicas}</dd>
        </div>
      </dl>
      {error ? <ErrorBanner message={error} /> : null}
      <div className="docker-tabs" role="tablist" aria-label="Service views">
        {(["logs", "tasks"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {id[0]!.toUpperCase() + id.slice(1)}
          </button>
        ))}
      </div>
      {tab === "logs" ? (
        <div className="docker-logs-panel">
          <div className="docker-log-toolbar">
            <SearchField
              className="docker-grep"
              wrapClassName="docker-grep-wrap"
              placeholder="grep"
              value={grep}
              aria-label="Filter logs"
              onChange={(e) => setGrep(e.target.value)}
            />
            <button
              type="button"
              className={`docker-follow ${follow ? "on" : ""}`}
              aria-pressed={follow}
              onClick={() => setFollow((value) => !value)}
            >
              <span className="docker-follow-dot" />
              follow
            </button>
          </div>
          <div className="docker-logs" ref={logPane} role="log" aria-label="Service logs">
            {visibleLines.length === 0 ? (
              <div className="docker-log-empty">{logs ? "No matching lines." : "No logs yet."}</div>
            ) : (
              visibleLines.map((line, index) => (
                <div
                  key={`${index}-${line.raw.slice(0, 24)}`}
                  className={`docker-log-line ${line.level}`}
                >
                  {line.time ? <span className="time">{formatLogTime(line.time)}</span> : null}
                  <span className="msg">{line.message}</span>
                </div>
              ))
            )}
          </div>
          <div className="docker-log-foot">
            <span>tail {DEFAULT_DOCKER_LOG_TAIL}</span>
            <span>
              {counts.errors} error{counts.errors === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      ) : (
        <pre className="docker-inspect">{JSON.stringify(tasks, null, 2)}</pre>
      )}
    </div>
  );
}

function SwarmNodeDetail({ node, error }: { node: DockerSwarmNode; error: string | null }) {
  return (
    <div className="docker-pane">
      <div className="docker-head">
        <span className={`docker-pill ${node.status.toLowerCase() === "ready" ? "live" : "off"}`}>
          {node.status}
        </span>
      </div>
      <dl className="meta-grid docker-meta-pane">
        <div>
          <dt>Hostname</dt>
          <dd>{node.hostname}</dd>
        </div>
        <div>
          <dt>Node ID</dt>
          <dd title={node.id}>{node.id.slice(0, 12)}</dd>
        </div>
        <div>
          <dt>Availability</dt>
          <dd>{node.availability}</dd>
        </div>
        <div>
          <dt>Manager</dt>
          <dd>{node.managerStatus || "—"}</dd>
        </div>
      </dl>
      {error ? <ErrorBanner message={error} /> : null}
      {node.engineVersion ? (
        <p className="hint" style={{ padding: "0 18px" }}>
          Engine {node.engineVersion}
        </p>
      ) : null}
    </div>
  );
}
