import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { dockerContainerLive, dockerDotClass, type DockerContainer } from "@locus/shared";
import { api } from "@/lib/api";
import {
  confirmDockerContainerAction,
  DOCKER_EXPLORER_POLL_MS,
  dockerStatusLabel,
  loadDockerExplorerExpanded,
  saveDockerExplorerExpanded,
} from "@/lib/docker";
import { useStore } from "@/state/store";
import { IconChevron, IconPlay, IconRefresh, IconStop } from "@/components/layout/Icons";

export function DockerExplorer({
  selectedId,
  sessionId,
  onInspect,
}: {
  selectedId?: string | null;
  /** Only list containers this session started; the section hides when there are none. */
  sessionId?: string;
  onInspect: (container: DockerContainer) => void;
}) {
  const { state, dispatch } = useStore();
  const [expanded, setExpanded] = useState(() => loadDockerExplorerExpanded());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; row: DockerContainer } | null>(null);

  useEffect(() => {
    saveDockerExplorerExpanded(expanded);
  }, [expanded]);

  useEffect(() => {
    if (typeof api.dockerContainers !== "function") return;
    let cancelled = false;
    async function refresh() {
      try {
        const snapshot = await api.dockerContainers();
        if (!cancelled) {
          dispatch({ type: "containers", containers: snapshot.containers });
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not list containers");
      }
    }
    void refresh();
    if (!expanded) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(() => void refresh(), DOCKER_EXPLORER_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [expanded, dispatch]);

  useEffect(() => {
    if (!menu) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenu(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  async function runAction(row: DockerContainer, action: "start" | "stop" | "restart") {
    if (busyId) return;
    if (action !== "start" && !(await confirmDockerContainerAction(action, row))) return;
    setBusyId(row.id);
    setError(null);
    try {
      const next = await api.dockerContainerAction(row.id, action);
      dispatch({ type: "container", container: next });
      if (typeof api.dockerContainers === "function") {
        const snapshot = await api.dockerContainers();
        dispatch({ type: "containers", containers: snapshot.containers });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} ${row.name}`);
    } finally {
      setBusyId(null);
    }
  }

  function openMenu(event: ReactMouseEvent, row: DockerContainer) {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, row });
  }

  const rows = sessionId
    ? state.containers.filter((row) => row.sessionId === sessionId)
    : state.containers;

  if (sessionId && rows.length === 0) return null;

  return (
    <section className="docker-explorer" data-testid="docker-explorer" aria-label="Docker">
      <button
        type="button"
        className="docker-explorer-head"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <span className="workspace-tree-chevron">
          <IconChevron expanded={expanded} />
        </span>
        <strong>Containers</strong>
        <span className="docker-explorer-count">{rows.length}</span>
      </button>
      {expanded ? (
        <div className="docker-explorer-list" role="list">
          {error ? <p className="docker-explorer-error">{error}</p> : null}
          {rows.length === 0 ? (
            <p className="hint docker-explorer-empty">
              {state.dockerKind === "docker"
                ? "No containers on this engine."
                : "No containers. Mock Docker until the CLI is installed."}
            </p>
          ) : (
            rows.map((row) => {
              const live = dockerContainerLive(row.state);
              const busy = busyId === row.id;
              return (
                <div
                  key={row.id}
                  role="listitem"
                  className={`docker-explorer-row${selectedId === row.id ? " on" : ""}`}
                >
                  <button
                    type="button"
                    className="docker-explorer-open"
                    title={`${row.name} · ${dockerStatusLabel(row)}`}
                    onClick={() => onInspect(row)}
                    onContextMenu={(event) => openMenu(event, row)}
                  >
                    <span className={`dot ${dockerDotClass(row.state)}`} />
                    <span className="docker-explorer-name">{row.name}</span>
                  </button>
                  <div className="docker-explorer-actions">
                    {live ? (
                      <button
                        type="button"
                        className="btn icon ghost"
                        title={`Stop ${row.name}`}
                        aria-label={`Stop ${row.name}`}
                        disabled={busy}
                        onClick={() => void runAction(row, "stop")}
                      >
                        <IconStop />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn icon ghost"
                        title={`Start ${row.name}`}
                        aria-label={`Start ${row.name}`}
                        disabled={busy}
                        onClick={() => void runAction(row, "start")}
                      >
                        <IconPlay />
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn icon ghost"
                      title={`Restart ${row.name}`}
                      aria-label={`Restart ${row.name}`}
                      disabled={busy}
                      onClick={() => void runAction(row, "restart")}
                    >
                      <IconRefresh />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : null}
      {menu
        ? createPortal(
            <>
              <button
                type="button"
                className="workspace-ctx-backdrop"
                aria-label="Close container menu"
                onClick={() => setMenu(null)}
              />
              <div
                className="workspace-ctx"
                style={{ left: menu.x, top: menu.y }}
                role="menu"
                aria-label="Container"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onInspect(menu.row);
                    setMenu(null);
                  }}
                >
                  Inspect
                </button>
                {dockerContainerLive(menu.row.state) ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      const row = menu.row;
                      setMenu(null);
                      void runAction(row, "stop");
                    }}
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      const row = menu.row;
                      setMenu(null);
                      void runAction(row, "start");
                    }}
                  >
                    Start
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const row = menu.row;
                    setMenu(null);
                    void runAction(row, "restart");
                  }}
                >
                  Restart
                </button>
              </div>
            </>,
            document.body,
          )
        : null}
    </section>
  );
}
