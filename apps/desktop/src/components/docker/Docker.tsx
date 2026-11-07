import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_DOCKER_LOG_TAIL, dockerContainerLive } from "@locus/shared";
import { api } from "@/lib/api";
import {
  compactDockerAge,
  confirmRestartContainers,
  countDockerLogLevels,
  dockerInspectPayload,
  dockerStatusLabel,
  formatLogTime,
  liveDockerContainers,
  parseDockerLogs,
  runStopContainers,
  shortContainerId,
  type DockerLogLevel,
} from "@/lib/docker";
import { useStore } from "@/state/store";
import { DockerStatsPanel, useDockerStats } from "./DockerStatsPanel";
import { IconArrowUpRight, IconClose, IconCopy, IconStop } from "@/components/layout/Icons";
import { Mascot } from "@/components/layout/Mascot";
import { SearchField } from "@/components/layout/SearchField";
import { WorkspaceEditor } from "@/components/workspace/WorkspaceEditor";
import { DockerSwarmPane } from "./DockerSwarm";

type DockerTab = "logs" | "inspect" | "stats" | "files";
type LogFilter = "all" | "warn" | "error";

function bothLabel(count: number): string {
  return count === 2 ? "both" : String(count);
}

function levelLabel(level: DockerLogLevel): string {
  if (level === "error") return "ERROR";
  if (level === "warn") return "WARN";
  if (level === "info") return "INFO";
  if (level === "debug") return "DEBUG";
  return "LOG";
}

export function DockerPane() {
  const { state } = useStore();
  if (state.dockerView === "swarm") return <DockerSwarmPane />;
  return <DockerContainersPane />;
}

function DockerContainersPane() {
  const { state, dispatch } = useStore();
  const item = state.containers.find((row) => row.id === state.selectedContainerId);
  const picked = state.containers.filter((row) => state.pickedContainerIds.includes(row.id));
  const livePicked = liveDockerContainers(picked);
  const [tab, setTab] = useState<DockerTab>("logs");
  const [logs, setLogs] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grep, setGrep] = useState("");
  const [level, setLevel] = useState<LogFilter>("all");
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const logPane = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTab("logs");
    setGrep("");
    setLevel("all");
    setFollow(true);
  }, [item?.id]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!item) {
        setLogs("");
        return;
      }
      setError(null);
      try {
        const next = await api.dockerContainerLogs(item.id);
        if (!cancelled) setLogs(next.text);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load logs");
      }
    }
    void load();
    if (!item || !follow || tab !== "logs") {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(() => void load(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [item?.id, follow, tab]);

  const live = item ? dockerContainerLive(item.state) : false;
  const { stats, error: statsError } = useDockerStats(
    item?.id,
    Boolean(item) && (live || tab === "stats"),
  );

  const parsed = useMemo(() => parseDockerLogs(logs), [logs]);
  const counts = useMemo(() => countDockerLogLevels(parsed), [parsed]);
  const visibleLines = useMemo(() => {
    const needle = grep.trim().toLowerCase();
    return parsed.filter((line) => {
      if (level === "error" && line.level !== "error") return false;
      if (level === "warn" && line.level !== "warn" && line.level !== "error") return false;
      if (needle && !line.raw.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [parsed, grep, level]);
  const visibleLogText = visibleLines.map((line) => line.raw).join("\n");

  useEffect(() => {
    if (!follow) return;
    logPane.current?.scrollTo?.({ top: logPane.current.scrollHeight });
  }, [logs, follow, grep, level]);

  async function refreshList() {
    const snapshot = await api.dockerContainers();
    dispatch({ type: "containers", containers: snapshot.containers });
  }

  async function stopPicked() {
    if (!livePicked.length || busy) return;
    setBusy("stop-picked");
    setError(null);
    try {
      const result = await runStopContainers(livePicked, {
        stop: api.dockerContainersStop,
        list: api.dockerContainers,
      });
      if (!result) return;
      dispatch({ type: "containers", containers: result.containers });
      dispatch({
        type: "pickContainers",
        ids: state.pickedContainerIds.filter((id) => !result.stoppedIds.has(id)),
      });
      if (result.errors.length) {
        setError(result.errors.map((row) => `${row.id}: ${row.error}`).join(" · "));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not stop containers");
    } finally {
      setBusy(null);
    }
  }

  async function restartPicked() {
    if (!picked.length || busy) return;
    if (!confirmRestartContainers(picked)) return;
    setBusy("restart-picked");
    setError(null);
    try {
      for (const row of picked) {
        await api.dockerContainerAction(row.id, "restart");
      }
      await refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restart containers");
    } finally {
      setBusy(null);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setError("Could not copy");
    }
  }

  function saveLogs() {
    const blob = new Blob([visibleLogText || logs || ""], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${item?.name ?? "container"}.log`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function jumpToError() {
    logPane.current?.querySelector(".docker-log-line.error")?.scrollIntoView({ block: "center" });
  }

  useEffect(() => {
    if (tab !== "logs") return;
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveLogs();
      } else if (e.altKey && (e.key === "ArrowUp" || e.key === "Up")) {
        e.preventDefault();
        jumpToError();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, visibleLogText, logs, item?.name]);

  if (!item) {
    return (
      <div className="empty">
        <div className="empty-card">
          <div className="empty-hero">
            <Mascot pose="rest" size={76} />
            <div>
              <p className="eyebrow">Docker</p>
              <h2>No containers</h2>
            </div>
          </div>
          <p>
            {state.dockerKind === "docker"
              ? "No containers on this Docker engine. Start an agent, or run something with the Docker CLI — it will show up here."
              : "Using a mock Docker engine until the Docker CLI is installed. New Docker agents still appear here so you can stop, restart, and read logs."}
          </p>
          <div className="empty-actions">
            <button
              className="btn primary"
              onClick={() => {
                dispatch({ type: "section", section: "agents" });
                dispatch({ type: "select", id: null });
              }}
            >
              New agent
            </button>
            <button
              className="btn"
              onClick={() => {
                void refreshList().catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : "Refresh failed"),
                );
              }}
            >
              Refresh
            </button>
          </div>
        </div>
      </div>
    );
  }

  const fullId = item.containerId || item.id;

  return (
    <div className="docker-pane">
      {picked.length > 0 ? (
        <div className="docker-select-bar" role="region" aria-label="Selected containers">
          <strong>
            {picked.length} container{picked.length === 1 ? "" : "s"} selected
          </strong>
          <button
            className="btn small"
            disabled={livePicked.length === 0 || Boolean(busy)}
            onClick={() => void stopPicked()}
          >
            <IconStop /> Stop {bothLabel(livePicked.length || picked.length)}
          </button>
          <button
            className="btn small"
            disabled={Boolean(busy)}
            onClick={() => void restartPicked()}
          >
            Restart
          </button>
          <button
            className="btn small ghost"
            onClick={() => dispatch({ type: "pickContainers", ids: [] })}
          >
            <IconClose /> Clear
          </button>
        </div>
      ) : null}
      <div className="docker-head">
        <span className={`docker-pill ${live ? "live" : "off"}`}>{dockerStatusLabel(item)}</span>
        <div className="docker-actions">
          <button type="button" className="btn small ghost" onClick={() => void copyText(fullId)}>
            <IconCopy /> {copied ? "Copied" : "Copy id"}
          </button>
          <button
            className="btn small"
            onClick={() => {
              setTab("logs");
              void api.dockerContainerLogs(item.id).then(
                (next) => setLogs(next.text),
                (err: unknown) =>
                  setError(err instanceof Error ? err.message : "Could not load logs"),
              );
            }}
          >
            Pull logs
          </button>
          {item.sessionId ? (
            <button
              className="btn small primary"
              onClick={() => dispatch({ type: "select", id: item.sessionId! })}
            >
              Open agent <IconArrowUpRight />
            </button>
          ) : null}
        </div>
      </div>
      <dl className="meta-grid docker-meta-pane">
        <div>
          <dt>Image</dt>
          <dd title={item.image}>{item.image || "—"}</dd>
        </div>
        <div>
          <dt>Container ID</dt>
          <dd title={fullId}>{shortContainerId(fullId)}</dd>
        </div>
        <div>
          <dt>Session</dt>
          <dd>{item.sessionTitle || "—"}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{dockerStatusLabel(item)}</dd>
        </div>
      </dl>
      {error ? <p className="docker-error">{error}</p> : null}
      <div className="docker-tabs" role="tablist" aria-label="Container views">
        {(["logs", "inspect", "stats", "files"] as const).map((id) => (
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
            <div className="docker-log-filters" role="group" aria-label="Log level">
              {(["all", "warn", "error"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  className={level === id ? "on" : ""}
                  aria-pressed={level === id}
                  onClick={() => setLevel(id)}
                >
                  {id === "all" ? "All" : id === "warn" ? "Warn" : "Error"}
                </button>
              ))}
            </div>
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
          <div
            className={`docker-logs ${wrap ? "wrap" : ""}`}
            ref={logPane}
            role="log"
            aria-label="Container logs"
          >
            {visibleLines.length === 0 ? (
              <div className="docker-log-empty">{logs ? "No matching lines." : "No logs yet."}</div>
            ) : (
              visibleLines.map((line, index) => (
                <div
                  key={`${index}-${line.raw.slice(0, 24)}`}
                  className={`docker-log-line ${line.level}`}
                >
                  {line.time ? <span className="time">{formatLogTime(line.time)}</span> : null}
                  {line.level !== "other" ? (
                    <span className="level">{levelLabel(line.level)}</span>
                  ) : null}
                  <span className="msg">{line.message}</span>
                </div>
              ))
            )}
          </div>
          <div className="docker-log-foot">
            <span>tail {DEFAULT_DOCKER_LOG_TAIL}</span>
            <button type="button" className="linkish" onClick={jumpToError}>
              {counts.errors} error{counts.errors === 1 ? "" : "s"}
            </button>
            <span>
              {counts.warnings} warning{counts.warnings === 1 ? "" : "s"}
            </span>
            <button type="button" className="linkish" onClick={() => setWrap((value) => !value)}>
              wrap {wrap ? "on" : "off"}
            </button>
            {compactDockerAge(item.status, item.createdAt) ? (
              <span>up {compactDockerAge(item.status, item.createdAt)}</span>
            ) : null}
            <span className="docker-log-keys">
              <kbd>⌘C</kbd> copy <kbd>⌘S</kbd> save <kbd>⌥↑</kbd> jump to error
            </span>
            <button type="button" className="linkish" onClick={() => void copyText(visibleLogText)}>
              Copy
            </button>
            <button type="button" className="linkish" onClick={saveLogs}>
              Save
            </button>
          </div>
        </div>
      ) : null}
      {tab === "inspect" ? (
        <pre className="docker-inspect">
          {JSON.stringify(dockerInspectPayload(item, stats), null, 2)}
        </pre>
      ) : null}
      {tab === "stats" ? <DockerStatsPanel stats={stats} error={statsError} pane /> : null}
      {tab === "files" ? (
        item.sessionId ? (
          <div className="docker-files">
            <WorkspaceEditor sessionId={item.sessionId} />
          </div>
        ) : (
          <p className="docker-files-empty">No workspace is bound to this container.</p>
        )
      ) : null}
    </div>
  );
}
