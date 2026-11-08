import { useEffect, useState, type ReactNode } from "react";
import {
  formatNextFire,
  formatSchedule,
  isHumanDriving,
  parseProductMode,
  routinesForTeammate,
  sessionDisplayName,
  sessionRuntime,
} from "@locus/shared";
import { api } from "@/lib/api";
import { swarmComputerStatus } from "@/lib/swarmPresence";
import { useDeferredCollapse } from "@/lib/useDeferredCollapse";
import { useStore } from "@/state/store";
import { IconClock, IconClose, IconGear, IconPanelRight } from "@/components/layout/Icons";
import { InlineError } from "@/components/layout/Skeleton";

type ComputerMode = "status" | "preview" | "takeover";

function formatRoutineWhen(isoOrLabel: string): string {
  if (isoOrLabel === "On webhook" || isoOrLabel === "Paused") return isoOrLabel;
  const d = new Date(isoOrLabel);
  if (Number.isNaN(d.getTime())) return isoOrLabel;
  return d.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Messenger-style right column for Locus Swarm: status → preview → takeover. */
export function SwarmComputerPanel(props: { screen: ReactNode }) {
  const { state, dispatch } = useStore();
  const showRail = useDeferredCollapse(state.vmCollapsed);
  const session = state.sessions.find((s) => s.id === state.selectedId);
  const swarm = parseProductMode(state.config?.productMode) === "swarm";
  const vm =
    state.vms.find((v) => v.id === session?.vmId) ??
    state.vms.find((v) => v.sessionId === session?.id);
  const [mode, setMode] = useState<ComputerMode>("status");
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setMode("status");
    setActionError(null);
  }, [session?.id]);

  useEffect(() => {
    if (session && isHumanDriving(session) && mode !== "takeover") {
      setMode("takeover");
    }
  }, [session, mode]);

  if (!swarm || !session) return <>{props.screen}</>;

  const name = sessionDisplayName(session);
  const sessionId = session.id;
  const teamProject = session.projectId
    ? state.projects.find((row) => row.id === session.projectId)
    : undefined;
  const driving = isHumanDriving(session);
  const host = sessionRuntime(session) === "host";
  const vmLive =
    Boolean(vm) && (vm?.status === "running" || vm?.status === "ready" || vm?.status === "paused");
  const status = swarmComputerStatus(session, vm?.status);
  const routines = routinesForTeammate(state.automations, session.id, 8);
  const effectiveMode: ComputerMode = driving ? "takeover" : mode;
  const showScreen = effectiveMode === "preview" || effectiveMode === "takeover";

  if (showRail) {
    return (
      <aside className="vm-pane rail hub-computer-rail">
        <button
          type="button"
          className="vm-rail-toggle"
          title={`${name}'s computer`}
          onClick={() => dispatch({ type: "toggleVmPane" })}
        >
          <IconPanelRight />
          <span className="vm-rail-label">Computer</span>
        </button>
      </aside>
    );
  }

  async function takeover() {
    setActionError(null);
    try {
      await api.takeover(sessionId);
      setMode("takeover");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not take control");
    }
  }

  async function handback() {
    setActionError(null);
    try {
      await api.handback(sessionId);
      setMode("preview");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not hand back");
    }
  }

  return (
    <aside
      className="vm-pane hub-computer-panel"
      data-testid="hub-computer-panel"
      data-computer-mode={effectiveMode}
    >
      <header className="hub-computer-head">
        <div className="hub-computer-title">
          <h2>{name}&apos;s computer</h2>
          <p className="hub-computer-mode-meta" aria-live="polite">
            {effectiveMode === "takeover"
              ? "Takeover"
              : effectiveMode === "preview"
                ? "Preview"
                : "Status"}
          </p>
        </div>
        <div className="hub-computer-head-actions">
          <button
            type="button"
            className="btn icon ghost"
            title="Teammate settings"
            aria-label="Teammate settings"
            onClick={() => dispatch({ type: "sessionSettings", open: true })}
          >
            <IconGear />
          </button>
          <button
            type="button"
            className="btn icon ghost"
            title="Close computer panel"
            aria-label="Close computer panel"
            onClick={() => dispatch({ type: "toggleVmPane" })}
          >
            <IconClose />
          </button>
        </div>
      </header>

      <div className="hub-computer-status" data-testid="hub-computer-status">
        <p className="hub-computer-status-host">
          {host ? "This machine" : vm?.status ? `Guest · ${vm.status}` : "Guest"}
        </p>
        <p className="hub-computer-status-title">{status.title}</p>
        {status.detail ? <p className="hub-computer-status-detail">{status.detail}</p> : null}
        {teamProject ? (
          <p className="hub-computer-status-detail" data-testid="hub-team-briefing">
            Team briefing for {teamProject.teamName ?? teamProject.title}.
            <button
              type="button"
              className="btn small ghost"
              data-testid="open-team-briefing"
              onClick={() => dispatch({ type: "selectProject", id: teamProject.id })}
            >
              Open team briefing
            </button>
          </p>
        ) : null}
      </div>

      <div className="hub-computer-screen-block">
        <div className="hub-computer-screen-row">
          <p className="hub-computer-screen-label">
            {host ? `${name}'s workspace` : `${name}'s screen`}
          </p>
          {host ? (
            <button
              type="button"
              className="btn small"
              data-testid="hub-open-screen"
              onClick={() => setMode((m) => (m === "status" ? "preview" : "status"))}
            >
              {showScreen ? "Hide workspace" : "Open workspace"}
            </button>
          ) : driving ? (
            <button type="button" className="btn small primary" onClick={() => void handback()}>
              Hand back
            </button>
          ) : vmLive ? (
            <button
              type="button"
              className="btn small"
              data-testid="hub-take-control"
              onClick={() => void takeover()}
            >
              Take control
            </button>
          ) : (
            <button
              type="button"
              className="btn small"
              data-testid="hub-open-screen"
              onClick={() => setMode((m) => (m === "status" ? "preview" : "status"))}
            >
              {showScreen ? "Hide screen" : "Open screen"}
            </button>
          )}
        </div>
        {actionError ? <InlineError message={actionError} /> : null}
        {showScreen ? <div className="hub-computer-screen-body">{props.screen}</div> : null}
      </div>

      <section className="hub-routines" aria-label="Routines">
        <h3>Routines</h3>
        {routines.length === 0 ? (
          <p className="hub-routines-empty">No routines yet</p>
        ) : (
          <ul className="hub-routines-list">
            {routines.map((item) => {
              const next = formatNextFire(item);
              const when = !item.enabled
                ? "Paused"
                : next === "On webhook"
                  ? "On webhook"
                  : next
                    ? formatRoutineWhen(next)
                    : formatSchedule(item.schedule);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className="hub-routine-row"
                    onClick={() => dispatch({ type: "newAutomation", open: true, editId: item.id })}
                  >
                    <span className="hub-routine-icon" aria-hidden="true">
                      <IconClock />
                    </span>
                    <span className="hub-routine-name">{item.name}</span>
                    <span className="hub-routine-when">{when}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button
          type="button"
          className="hub-routine-new"
          onClick={() => dispatch({ type: "newAutomation", open: true })}
        >
          + New routine
        </button>
      </section>
    </aside>
  );
}
