import { useEffect, useState } from "react";
import {
  canReplay,
  canClearChat,
  CLEAR_CHAT_CONFIRM,
  comparePeer,
  conversationLabel,
  dockerContainerLive,
  formatNetworkJail,
  formatNextFire,
  forgeLabel,
  guestLabel,
  isAssetSession,
  isCanvasSession,
  isGameSession,
  isHumanDriving,
  isSetupSession,
  isWaitingOnGuestStart,
  lastUserPrompt,
  parseProductMode,
  sessionRuntime,
  sessionDisplayName,
  sessionAvatarId,
  sessionAvatarPose,
  sessionAvatarAccessory,
  projectTeamName,
} from "@locus/shared";
import { api } from "@/lib/api";
import { showErrorNotice } from "@/lib/notice";
import { askConfirm } from "@/lib/dialog";
import { archiveOne, deleteSessionWithUndo } from "@/lib/sessionUndo";
import { Tooltip } from "./Tooltip";
import { liveDockerContainers, confirmDockerContainerAction } from "@/lib/docker";
import { canExportChat, exportSessionChat } from "@/lib/chatExport";
import { exportBoardJson, exportBoardPdf, exportBoardPng } from "@/components/board/boardExport";
import {
  defaultEnvironmentName,
  defaultGoldenName,
  promptEnvironmentName,
  promptGoldenName,
} from "@/lib/goldenName";
import { openSettings, useStore } from "@/state/store";
import { formatWhen } from "@/components/automations/Automations";
import { reportJobError, setJobNotice, startJobRun } from "@/components/automations/jobRun";
import { IconMore, IconPause, IconPlay, IconPanelRight, IconStop } from "./Icons";
import { MenuItem, MenuLabel, MenuSep, OverflowMenu } from "./OverflowMenu";
import { ReplayModal } from "@/components/chat/ReplayModal";
import { CompareModal } from "@/components/chat/CompareModal";
import { WorkersModal } from "@/components/settings/WorkersModal";
import { TraceModal } from "@/components/chat/TraceModal";
import { ExpandableLog } from "@/components/chat/ExpandableLog";
import { PersonaAvatar } from "@/components/layout/PersonaAvatar";
import { composerModelLabel } from "@/components/settings/ModelPicker";

export function Topbar() {
  const { state, dispatch } = useStore();
  const [workers, setWorkers] = useState(false);
  const [trace, setTrace] = useState(false);
  const [dockerBusy, setDockerBusy] = useState<string | null>(null);
  const [runStarting, setRunStarting] = useState(false);
  function duplicateSession(sessionId: string) {
    void api
      .fork(sessionId)
      .then((forked) => {
        dispatch({ type: "session", session: forked });
        dispatch({ type: "select", id: forked.id });
      })
      .catch((err: unknown) => {
        showErrorNotice(err, "Could not duplicate");
      });
  }

  async function runDocker(action: "start" | "stop" | "restart") {
    const item = state.containers.find((row) => row.id === state.selectedContainerId);
    if (!item) return;
    if (action !== "start" && !(await confirmDockerContainerAction(action, item))) return;
    setDockerBusy(action);
    try {
      const next = await api.dockerContainerAction(item.id, action);
      dispatch({ type: "container", container: next });
      const snapshot = await api.dockerContainers();
      dispatch({ type: "containers", containers: snapshot.containers });
    } catch (err) {
      showErrorNotice(err, "Command failed");
    } finally {
      setDockerBusy(null);
    }
  }

  if (state.section === "automations") {
    const item = state.automations.find((a) => a.id === state.selectedAutomationId);
    const live = state.runs.find(
      (r) =>
        r.automationId === item?.id &&
        (r.status === "running" || r.status === "queued") &&
        Boolean(r.sessionId),
    );
    const running = Boolean(live);
    const next = item ? formatNextFire(item) : "";
    const nextLine = !item
      ? ""
      : !item.enabled
        ? "Paused"
        : next === "On webhook"
          ? "On webhook"
          : next
            ? `Next ${formatWhen(next)}`
            : "";
    return (
      <header className="topbar">
        <div className="topbar-main">
          <div className="topbar-title">
            <h2>
              {item?.name ??
                (parseProductMode(state.config?.productMode) === "swarm" ? "Routines" : "Jobs")}
            </h2>
            {nextLine ? <p className="topbar-kicker">{nextLine}</p> : null}
          </div>
        </div>
        {item ? (
          <div className="topbar-actions">
            <button
              type="button"
              className="btn small"
              onClick={() => {
                setJobNotice(null);
                const nextEnabled = !item.enabled;
                dispatch({
                  type: "automation",
                  automation: {
                    ...item,
                    enabled: nextEnabled,
                    updatedAt: new Date().toISOString(),
                  },
                });
                void api
                  .patchAutomation(item.id, { enabled: nextEnabled })
                  .catch((err: unknown) => {
                    dispatch({ type: "automation", automation: item });
                    reportJobError(item.id, err, "Could not update job");
                  });
              }}
            >
              {item.enabled ? (
                <>
                  <IconPause /> Pause
                </>
              ) : (
                "Enable"
              )}
            </button>
            {running ? (
              <button
                type="button"
                className="btn small danger"
                data-testid="auto-topbar-stop"
                onClick={() => {
                  setJobNotice(null);
                  if (!live) {
                    reportJobError(item.id, null, "No live run to stop");
                    return;
                  }
                  const prior = live;
                  dispatch({
                    type: "run",
                    run: {
                      ...live,
                      status: "failed",
                      finishedAt: new Date().toISOString(),
                      error: live.error?.trim() || "Stopped",
                    },
                  });
                  void api
                    .stopAutomation(item.id)
                    .then((result) => {
                      if (result.run) dispatch({ type: "run", run: result.run });
                    })
                    .catch((err: unknown) => {
                      dispatch({ type: "run", run: prior });
                      reportJobError(item.id, err, "Could not stop the run");
                    });
                }}
              >
                <IconStop /> Stop
              </button>
            ) : (
              <button
                type="button"
                className="btn small primary"
                data-testid="auto-topbar-run-now"
                disabled={!item.enabled || runStarting}
                title={item.enabled ? "Start a new manual run" : "Paused"}
                onClick={() => {
                  setRunStarting(true);
                  void startJobRun(item, dispatch).finally(() => setRunStarting(false));
                }}
              >
                <IconPlay /> {runStarting ? "Starting…" : "Run now"}
              </button>
            )}
          </div>
        ) : null}
      </header>
    );
  }

  if (state.section === "codebase") {
    const repo = state.repos.find((row) => row.id === state.selectedRepoId);
    const kicker = repo
      ? [
          forgeLabel(repo.checkout.forge),
          typeof repo.openPullCount === "number" ? `${repo.openPullCount} open` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
    return (
      <header className="topbar">
        <div className="topbar-main">
          <div className="topbar-title">
            <h2>{repo?.name ?? "Codebase"}</h2>
            {kicker ? <p className="topbar-kicker">{kicker}</p> : null}
          </div>
        </div>
      </header>
    );
  }

  if (state.section === "brain") {
    // Node/memory counts live in the list header; the topbar names the surface.
    return (
      <header className="topbar">
        <div className="topbar-main">
          <div className="topbar-title">
            <h2>{state.brain?.title || "Brain"}</h2>
            <p className="topbar-kicker">Shared across agents</p>
          </div>
        </div>
        <div className="topbar-actions">
          <OverflowMenu label={<IconMore />} title="Brain menu" toggleClassName="btn icon ghost">
            <MenuItem onClick={() => openSettings(dispatch, "advanced")}>Brain settings…</MenuItem>
          </OverflowMenu>
        </div>
      </header>
    );
  }

  if (state.section === "grafana") {
    const grafana = (state.config?.integrations ?? []).find((row) => row.kind === "grafana");
    const kicker = grafana?.baseUrl
      ? grafana.baseUrl.replace(/^https?:\/\//, "")
      : "Logs · traces · investigate";
    return (
      <header className="topbar">
        <div className="topbar-main">
          <div className="topbar-title">
            <h2>Grafana</h2>
            {kicker ? <p className="topbar-kicker">{kicker}</p> : null}
          </div>
        </div>
      </header>
    );
  }

  if (state.section === "docker") {
    if (state.dockerView === "swarm") {
      const service = state.dockerSwarm?.services.find(
        (row) =>
          row.id === state.selectedSwarmServiceId || row.name === state.selectedSwarmServiceId,
      );
      const node = state.dockerSwarm?.nodes.find(
        (row) => row.id === state.selectedSwarmNodeId || row.hostname === state.selectedSwarmNodeId,
      );
      const kicker = service
        ? `${service.replicas} · ${service.mode}`
        : node
          ? `${node.status} · ${node.availability}`
          : state.dockerSwarm
            ? `${state.dockerSwarm.services.length} services · ${state.dockerSwarm.nodes.length} nodes`
            : "Services";
      return (
        <header className="topbar">
          <div className="topbar-main">
            <div className="topbar-title">
              <h2>{service?.name ?? node?.hostname ?? "Docker"}</h2>
              {kicker ? <p className="topbar-kicker">{kicker}</p> : null}
            </div>
          </div>
        </header>
      );
    }
    const item = state.containers.find((row) => row.id === state.selectedContainerId);
    const liveCount = liveDockerContainers(state.containers).length;
    const stopped = Math.max(0, state.containers.length - liveCount);
    const live = item ? dockerContainerLive(item.state) : false;
    // The selected container's state lives in the status chip below; the header
    // only summarises the whole list, so the state isn't printed twice.
    const kicker = state.containers.length ? `${liveCount} running · ${stopped} stopped` : "";
    return (
      <header className="topbar">
        <div className="topbar-main">
          <div className="topbar-title">
            <h2>{item?.name ?? "Docker"}</h2>
            {kicker ? <p className="topbar-kicker">{kicker}</p> : null}
          </div>
        </div>
        {item ? (
          <div className="topbar-actions">
            <div className="control-cluster">
              {live ? (
                <button
                  type="button"
                  className="btn small"
                  disabled={Boolean(dockerBusy)}
                  onClick={() => void runDocker("stop")}
                >
                  <IconStop /> Stop
                </button>
              ) : (
                <button
                  type="button"
                  className={`btn small${item.sessionId ? "" : " primary"}`}
                  disabled={Boolean(dockerBusy)}
                  onClick={() => void runDocker("start")}
                >
                  <IconPlay /> Start
                </button>
              )}
              <button
                type="button"
                className="btn small"
                disabled={Boolean(dockerBusy)}
                onClick={() => void runDocker("restart")}
              >
                Restart
              </button>
            </div>
          </div>
        ) : null}
      </header>
    );
  }

  if (state.section === "slack") {
    const channel = state.slackConversations.find((row) => row.id === state.selectedSlackChannelId);
    const activity = state.slackActivityOpen;
    const name = activity ? "Activity" : channel ? conversationLabel(channel) : "Slack";
    const unread = state.slackConversations.filter((row) => row.unread).length;
    const kicker = activity
      ? unread
        ? `${unread} unread`
        : ""
      : channel?.unread
        ? "Unread"
        : unread
          ? `${unread} unread`
          : "";
    return (
      <header className="topbar">
        <div className="topbar-main">
          <div className="topbar-title">
            <h2>{name}</h2>
            {kicker ? <p className="topbar-kicker">{kicker}</p> : null}
          </div>
        </div>
      </header>
    );
  }

  if (state.section === "board") {
    const summary = state.boards.find((row) => row.id === state.selectedBoardId);
    const doc = state.selectedBoardId ? state.boardDocuments[state.selectedBoardId] : undefined;
    const item =
      summary ??
      (doc
        ? {
            id: doc.id,
            title: doc.title,
            updatedAt: doc.updatedAt,
            createdAt: doc.createdAt,
            objectCount: doc.objects.length,
            frameCount: doc.objects.filter((row) => row.type === "frame").length,
            chatSessionId: doc.chatSessionId,
            starter: doc.starter,
            archived: doc.archived,
          }
        : undefined);
    const kicker = item
      ? [
          item.starter ? item.starter : null,
          `${item.objectCount} ${item.objectCount === 1 ? "object" : "objects"}`,
          item.frameCount ? `${item.frameCount} frames` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
    return (
      <header className="topbar">
        <div className="topbar-main">
          <div className="topbar-title">
            {item ? <BoardTitle id={item.id} title={item.title} /> : <h2>Board</h2>}
            {kicker ? <p className="topbar-kicker">{kicker}</p> : null}
          </div>
        </div>
        {item ? (
          <div className="topbar-actions">
            <OverflowMenu label={<IconMore />} title="Board menu" toggleClassName="btn icon ghost">
              <MenuLabel>Export</MenuLabel>
              <MenuItem
                onClick={() => {
                  if (doc) exportBoardJson(doc);
                  else void api.exportBoard(item.id).then(exportBoardJson);
                }}
              >
                Export JSON
              </MenuItem>
              <MenuItem
                onClick={() => {
                  if (doc) exportBoardPng(doc);
                  else void api.exportBoard(item.id).then(exportBoardPng);
                }}
              >
                Export PNG
              </MenuItem>
              <MenuItem
                onClick={() => {
                  if (doc) exportBoardPdf(doc);
                  else void api.exportBoard(item.id).then(exportBoardPdf);
                }}
              >
                Export PDF
              </MenuItem>
              <MenuSep />
              <MenuItem
                onClick={() => {
                  void api.boardChat(item.id).then(async ({ board, sessionId }) => {
                    dispatch({ type: "board", board });
                    const session = await api.session(sessionId);
                    dispatch({ type: "session", session });
                    dispatch({ type: "select", id: sessionId });
                    if (state.vmCollapsed) dispatch({ type: "toggleVmPane" });
                  });
                }}
              >
                Open chat
              </MenuItem>
              <MenuItem
                onClick={() => {
                  void api
                    .duplicateBoard(item.id)
                    .then((board) => {
                      dispatch({ type: "board", board });
                      dispatch({ type: "selectBoard", id: board.id });
                    })
                    .catch((err: unknown) => {
                      showErrorNotice(err, "Could not duplicate");
                    });
                }}
              >
                Duplicate
              </MenuItem>
              <MenuSep />
              <MenuLabel>Danger</MenuLabel>
              <MenuItem
                danger
                onClick={() => {
                  void (async () => {
                    if (
                      !(await askConfirm({
                        title: `Delete ${item.title}?`,
                        body: "This cannot be undone.",
                        confirmLabel: "Delete",
                        danger: true,
                      }))
                    )
                      return;
                    void api
                      .deleteBoard(item.id)
                      .then(() => dispatch({ type: "boardDeleted", id: item.id }));
                  })();
                }}
              >
                Delete
              </MenuItem>
            </OverflowMenu>
          </div>
        ) : null}
      </header>
    );
  }

  if (state.section === "project") {
    const summary = state.projects.find((row) => row.id === state.selectedProjectId);
    const doc = state.selectedProjectId
      ? state.projectDocuments[state.selectedProjectId]
      : undefined;
    const item =
      summary ??
      (doc
        ? {
            id: doc.id,
            title: doc.title,
            starter: doc.recipeId,
            memberCount: doc.memberIds.length,
            paused: doc.paused,
          }
        : undefined);
    const hub = parseProductMode(state.config?.productMode) === "swarm";
    const teamTitle = hub
      ? (summary?.teamName ?? (doc ? projectTeamName(doc) : item?.title))
      : item?.title;
    const kicker = item
      ? [
          item.starter ?? null,
          `${item.memberCount} ${item.memberCount === 1 ? "member" : "members"}`,
          item.paused ? "paused" : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
    return (
      <header className="topbar">
        <div className="topbar-main">
          <div className="topbar-title">
            {item && teamTitle ? (
              hub ? (
                <h2>{teamTitle}</h2>
              ) : (
                <ProjectTitle id={item.id} title={item.title} />
              )
            ) : (
              <h2>{hub ? "Teams" : "Projects"}</h2>
            )}
            {kicker ? <p className="topbar-kicker">{kicker}</p> : null}
          </div>
        </div>
        {item ? (
          <div className="topbar-actions">
            <button
              type="button"
              className="btn small"
              title={item.paused ? "Resume" : "Pause"}
              onClick={() => {
                void api.patchProject(item.id, { paused: !item.paused }).then((project) => {
                  dispatch({ type: "project", project });
                });
              }}
            >
              {item.paused ? <IconPlay /> : <IconPause />} {item.paused ? "Resume" : "Pause"}
            </button>
            <OverflowMenu
              label={<IconMore />}
              title="Project menu"
              toggleClassName="btn icon ghost"
            >
              <MenuItem
                onClick={() => {
                  void api
                    .duplicateProject(item.id)
                    .then((project) => {
                      dispatch({ type: "project", project });
                      dispatch({ type: "selectProject", id: project.id });
                    })
                    .catch((err: unknown) => {
                      showErrorNotice(err, "Could not duplicate");
                    });
                }}
              >
                Duplicate
              </MenuItem>
              <MenuSep />
              <MenuLabel>Danger</MenuLabel>
              <MenuItem
                danger
                onClick={() => {
                  void (async () => {
                    const name = hub ? (teamTitle ?? item.title) : item.title;
                    const ok = await askConfirm({
                      title: `Delete ${name}?`,
                      body: hub ? "Teammates stay in Swarm." : "Members stay on Agents.",
                      confirmLabel: "Delete",
                      danger: true,
                    });
                    if (!ok) return;
                    try {
                      await api.deleteProject(item.id);
                      dispatch({ type: "projectDeleted", id: item.id });
                    } catch (err) {
                      showErrorNotice(err, "Could not delete");
                    }
                  })();
                }}
              >
                Delete
              </MenuItem>
            </OverflowMenu>
          </div>
        ) : null}
      </header>
    );
  }

  if (state.section === "design" || state.section === "games" || state.section === "assets") {
    const session = state.sessions.find((s) => s.id === state.selectedId && isCanvasSession(s));
    if (!session) {
      return (
        <header className="topbar">
          <div className="topbar-main">
            <h2>
              {state.section === "games"
                ? "Games"
                : state.section === "assets"
                  ? "Assets"
                  : "Design"}
            </h2>
          </div>
        </header>
      );
    }
    const vm = state.vms.find((v) => v.id === session.vmId);
    const vmLabel = vm?.status ?? (session.vmId ? session.status : "no container");
    const live = sessionLiveStatus(session, vmLabel);
    const kindLabel = isGameSession(session)
      ? "Game"
      : isAssetSession(session)
        ? "Asset"
        : "Design";
    return (
      <header className="topbar">
        <div className="topbar-main">
          <span className={`dot ${live.dot}`} />
          <div className="topbar-title">
            <SessionTitle id={session.id} title={session.title} />
            <button
              type="button"
              className="topbar-meta"
              onClick={() => dispatch({ type: "sessionSettings", open: true })}
              title={`${kindLabel} settings`}
            >
              {[
                composerModelLabel(state.config?.providers ?? [], session.providerId, session.model)
                  .label,
                live.caption,
              ]
                .filter(Boolean)
                .join(" · ")}
              {session.pinned ? " · pinned" : ""}
              {session.archived ? " · archived" : ""}
            </button>
          </div>
        </div>
        <div className="topbar-actions">
          {session.error && <ExpandableLog compact danger text={session.error} />}
          <PanelToggle label="Canvas" />
          {vm && (vm.status === "running" || vm.status === "ready" || vm.status === "paused") ? (
            <div className="control-cluster">
              {vm.status === "paused" ? (
                <button
                  type="button"
                  className="btn small"
                  title="Resume"
                  onClick={() =>
                    void api
                      .resumeVm(session.id)
                      .catch((err: unknown) => showErrorNotice(err, "Could not resume"))
                  }
                >
                  <IconPlay /> Resume
                </button>
              ) : (
                <button
                  type="button"
                  className="btn small"
                  title="Pause"
                  onClick={() =>
                    void api
                      .pauseVm(session.id)
                      .catch((err: unknown) => showErrorNotice(err, "Could not pause"))
                  }
                >
                  <IconPause /> Pause
                </button>
              )}
              <button
                type="button"
                className="btn small"
                title="Stop"
                onClick={() =>
                  void api
                    .stopVm(session.id)
                    .catch((err: unknown) => showErrorNotice(err, "Could not stop"))
                }
              >
                <IconStop /> Stop
              </button>
            </div>
          ) : session.vmId && session.status === "provisioning" ? (
            <button
              type="button"
              className="btn small"
              title="Stop"
              onClick={() =>
                void api
                  .stopVm(session.id)
                  .catch((err: unknown) => showErrorNotice(err, "Could not stop"))
              }
            >
              <IconStop /> Stop
            </button>
          ) : (sessionRuntime(session) === "host" && !session.backendId) ||
            session.status === "running" ||
            session.status === "provisioning" ? null : (
            <button
              type="button"
              className="btn small"
              title="Start the preview container"
              onClick={() =>
                void api
                  .startVm(session.id)
                  .catch((err: unknown) => showErrorNotice(err, "Could not start"))
              }
            >
              <IconPlay /> Start preview
            </button>
          )}
          <OverflowMenu
            label={<IconMore />}
            title={`${kindLabel} menu`}
            toggleClassName="btn icon ghost"
          >
            <MenuLabel>Session</MenuLabel>
            <MenuItem onClick={() => dispatch({ type: "sessionSettings", open: true })}>
              {kindLabel} settings
            </MenuItem>
            <MenuItem onClick={() => duplicateSession(session.id)}>Duplicate</MenuItem>
            <MenuItem
              disabled={!canClearChat(session)}
              onClick={() => {
                void (async () => {
                  if (
                    !(await askConfirm({
                      title: "Clear chat?",
                      body: CLEAR_CHAT_CONFIRM,
                      confirmLabel: "Clear chat",
                      danger: true,
                    }))
                  )
                    return;
                  const updated = await api.clearChat(session.id).catch((err: unknown) => {
                    showErrorNotice(err, "Could not clear chat");
                    return undefined;
                  });
                  if (updated) dispatch({ type: "session", session: updated });
                })();
              }}
            >
              Clear chat
            </MenuItem>
            <MenuItem
              onClick={() => void api.patchSession(session.id, { pinned: !session.pinned })}
            >
              {session.pinned ? "Unpin" : "Pin"}
            </MenuItem>
            <MenuItem
              onClick={() => {
                if (session.archived) void api.patchSession(session.id, { archived: false });
                else archiveOne(session, dispatch);
              }}
            >
              {session.archived ? "Unarchive" : "Archive"}
            </MenuItem>
            <MenuSep />
            <MenuLabel>Share</MenuLabel>
            <MenuItem
              disabled={!canExportChat(session.messages)}
              onClick={() => exportSessionChat(session, "html")}
            >
              Export chat as HTML
            </MenuItem>
            <MenuItem
              disabled={!canExportChat(session.messages)}
              onClick={() => exportSessionChat(session, "pdf")}
            >
              Export chat as PDF
            </MenuItem>
            <MenuSep />
            <MenuLabel>Advanced</MenuLabel>
            <MenuItem onClick={() => setTrace(true)}>View trace</MenuItem>
            <MenuItem
              onClick={() => {
                void api
                  .promote(session.id, { scaffold: "vite-react" })
                  .then(({ agent, design }) => {
                    dispatch({ type: "session", session: design });
                    dispatch({ type: "session", session: agent });
                  });
              }}
            >
              Promote to agent
            </MenuItem>
            <MenuSep />
            <MenuLabel>Danger</MenuLabel>
            <MenuItem
              danger
              onClick={() => {
                void deleteSessionWithUndo(session, dispatch, askConfirm, {
                  open: state.selectedId === session.id,
                });
              }}
            >
              Delete
            </MenuItem>
          </OverflowMenu>
        </div>
        {state.replayOpen ? (
          <ReplayModal
            session={session}
            onClose={() => dispatch({ type: "replay", open: false })}
          />
        ) : null}
        {trace ? <TraceModal session={session} onClose={() => setTrace(false)} /> : null}
      </header>
    );
  }

  const session = state.sessions.find((s) => s.id === state.selectedId);
  const vm = state.vms.find((v) => v.id === session?.vmId);
  if (!session || isCanvasSession(session)) {
    return (
      <header className="topbar">
        <div className="topbar-main">
          <h2>{state.section === "ide" ? "IDE" : "Agents"}</h2>
        </div>
      </header>
    );
  }

  const automation = session.automationId
    ? state.automations.find((a) => a.id === session.automationId)
    : undefined;
  const docker = sessionRuntime(session) === "docker";
  const hostChat = sessionRuntime(session) === "host";
  const hubMode = parseProductMode(state.config?.productMode) === "swarm";
  const displayName = sessionDisplayName(session);
  const vmLabel =
    vm?.status ?? (session.vmId ? session.status : docker ? "no container" : "no machine");
  const live = sessionLiveStatus(session, hostChat ? session.status : vmLabel);
  const metaLabel = hubMode
    ? [session.persona?.hubRole, live.caption].filter(Boolean).join(" · ")
    : [
        hostChat ? "Host" : docker ? (session.dockerImage ?? "Docker") : guestLabel(session.os),
        composerModelLabel(state.config?.providers ?? [], session.providerId, session.model).label,
        live.caption,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <header className={`topbar${hubMode ? " hub-topbar" : ""}`}>
      <div className="topbar-main">
        {hubMode ? (
          <PersonaAvatar
            avatarId={sessionAvatarId(session)}
            pose={sessionAvatarPose(session)}
            accessory={sessionAvatarAccessory(session)}
            accent={session.persona?.avatarAccent}
            size={28}
            title={displayName}
          />
        ) : (
          <span className={`dot ${live.dot}`} />
        )}
        <div className="topbar-title">
          <div className="topbar-title-row">
            {automation ? (
              <button
                type="button"
                className="btn small ghost topbar-automation-back"
                data-testid="automation-back"
                title={automation.name}
                onClick={() => dispatch({ type: "selectAutomation", id: automation.id })}
              >
                <span>← {automation.name}</span>
              </button>
            ) : null}
            {hubMode ? (
              <h2 className="session-title hub-session-title">{displayName}</h2>
            ) : (
              <SessionTitle id={session.id} title={session.title} />
            )}
          </div>
          <button
            type="button"
            className="topbar-meta"
            onClick={() => dispatch({ type: "sessionSettings", open: true })}
            title={hubMode ? "Teammate settings" : "Agent settings"}
          >
            {metaLabel}
            {!hubMode && session.network && session.network !== "open" && !hostChat
              ? ` · ${formatNetworkJail(session.network)}`
              : ""}
            {session.pinned ? " · pinned" : ""}
            {session.archived ? " · archived" : ""}
          </button>
        </div>
      </div>
      <div className="topbar-actions">
        {session.error && <ExpandableLog compact danger text={session.error} />}
        {hubMode ? (
          <Tooltip label={state.vmCollapsed ? "Show computer" : "Hide computer"}>
            <button
              type="button"
              className="btn icon ghost"
              aria-label={state.vmCollapsed ? "Show computer" : "Hide computer"}
              onClick={() => dispatch({ type: "toggleVmPane" })}
            >
              <IconPanelRight />
            </button>
          </Tooltip>
        ) : state.section === "ide" ? null : (
          <PanelToggle label={hostChat ? "Files" : docker ? "Container" : "Desktop"} />
        )}
        {hubMode || hostChat ? null : vm &&
          (vm.status === "running" || vm.status === "ready" || vm.status === "paused") ? (
          <>
            {isHumanDriving(session) ? (
              <button
                type="button"
                className="btn small primary"
                onClick={() => void api.handback(session.id)}
                title="Let the agent drive again"
              >
                Hand back
              </button>
            ) : docker ? null : (
              <button
                type="button"
                className="btn small"
                onClick={() => void api.takeover(session.id)}
                title="Abort the agent and drive the guest yourself"
              >
                Take over
              </button>
            )}
            <div className="control-cluster">
              {vm.status === "paused" ? (
                <button
                  type="button"
                  className="btn small"
                  title="Resume"
                  onClick={() =>
                    void api
                      .resumeVm(session.id)
                      .catch((err: unknown) => showErrorNotice(err, "Could not resume"))
                  }
                >
                  <IconPlay /> Resume
                </button>
              ) : (
                <button
                  type="button"
                  className="btn small"
                  title="Pause"
                  onClick={() =>
                    void api
                      .pauseVm(session.id)
                      .catch((err: unknown) => showErrorNotice(err, "Could not pause"))
                  }
                >
                  <IconPause /> Pause
                </button>
              )}
              <button
                type="button"
                className="btn small"
                title="Stop"
                onClick={() =>
                  void api
                    .stopVm(session.id)
                    .catch((err: unknown) => showErrorNotice(err, "Could not stop"))
                }
              >
                <IconStop /> Stop
              </button>
            </div>
          </>
        ) : session.vmId && session.status === "provisioning" ? (
          <button
            type="button"
            className="btn small"
            title="Stop"
            onClick={() =>
              void api
                .stopVm(session.id)
                .catch((err: unknown) => showErrorNotice(err, "Could not stop"))
            }
          >
            <IconStop /> Stop
          </button>
        ) : (
          <button
            type="button"
            className="btn small primary"
            title="Start"
            onClick={() =>
              void api
                .startVm(session.id)
                .catch((err: unknown) => showErrorNotice(err, "Could not start"))
            }
          >
            <IconPlay /> Start
          </button>
        )}
        {canReplay(session.messages) ? (
          <button
            type="button"
            className="btn small"
            title="Replay run"
            data-testid="topbar-replay"
            onClick={() => dispatch({ type: "replay", open: true })}
          >
            Replay
          </button>
        ) : null}
        {lastUserPrompt(session.messages) && !comparePeer(session, state.sessions) ? (
          <button
            type="button"
            className="btn small topbar-compare"
            title="Compare models"
            data-testid="topbar-compare"
            onClick={() => dispatch({ type: "compare", open: true })}
          >
            Compare
          </button>
        ) : null}
        <OverflowMenu label={<IconMore />} title="Agent menu" toggleClassName="btn icon ghost">
          <MenuLabel>Session</MenuLabel>
          <MenuItem onClick={() => dispatch({ type: "sessionSettings", open: true })}>
            Agent settings
          </MenuItem>
          <MenuItem
            disabled={!canReplay(session.messages)}
            onClick={() => dispatch({ type: "replay", open: true })}
          >
            Replay run
          </MenuItem>
          <MenuItem
            disabled={
              Boolean(comparePeer(session, state.sessions)) || !lastUserPrompt(session.messages)
            }
            onClick={() => dispatch({ type: "compare", open: true })}
          >
            Compare models
          </MenuItem>
          <MenuItem onClick={() => duplicateSession(session.id)}>Duplicate</MenuItem>
          <MenuItem
            disabled={!canClearChat(session)}
            onClick={() => {
              void (async () => {
                if (
                  !(await askConfirm({
                    title: "Clear chat?",
                    body: CLEAR_CHAT_CONFIRM,
                    confirmLabel: "Clear chat",
                    danger: true,
                  }))
                )
                  return;
                const updated = await api.clearChat(session.id).catch((err: unknown) => {
                  showErrorNotice(err, "Could not clear chat");
                  return undefined;
                });
                if (updated) dispatch({ type: "session", session: updated });
              })();
            }}
          >
            Clear chat
          </MenuItem>
          {session.automationId && (
            <MenuItem
              onClick={() => dispatch({ type: "selectAutomation", id: session.automationId! })}
            >
              {automation ? `Job · ${automation.name}` : "Open job"}
            </MenuItem>
          )}
          <MenuItem onClick={() => void api.patchSession(session.id, { pinned: !session.pinned })}>
            {session.pinned ? "Unpin" : "Pin"}
          </MenuItem>
          <MenuItem
            onClick={() => {
              if (session.archived) void api.patchSession(session.id, { archived: false });
              else archiveOne(session, dispatch);
            }}
          >
            {session.archived ? "Unarchive" : "Archive"}
          </MenuItem>
          <MenuSep />
          <MenuLabel>Share</MenuLabel>
          <MenuItem
            disabled={!canExportChat(session.messages)}
            onClick={() => exportSessionChat(session, "html")}
          >
            Export chat as HTML
          </MenuItem>
          <MenuItem
            disabled={!canExportChat(session.messages)}
            onClick={() => exportSessionChat(session, "pdf")}
          >
            Export chat as PDF
          </MenuItem>
          <MenuSep />
          <MenuLabel>Advanced</MenuLabel>
          <MenuItem onClick={() => setTrace(true)}>View trace</MenuItem>
          {hostChat ? null : (
            <MenuItem
              disabled={
                !vm || (vm.status !== "running" && vm.status !== "ready" && vm.status !== "paused")
              }
              onClick={() => {
                void (async () => {
                  const fallback = defaultGoldenName(
                    session.title,
                    docker ? "workspace" : "golden",
                  );
                  const name = await promptGoldenName(fallback);
                  if (!name) return;
                  void api.captureImage(session.id, name);
                })();
              }}
            >
              Save golden image…
            </MenuItem>
          )}
          {isSetupSession(session) ? (
            <MenuItem
              disabled={
                !vm || (vm.status !== "running" && vm.status !== "ready" && vm.status !== "paused")
              }
              onClick={() => {
                void (async () => {
                  const fallback = defaultEnvironmentName(session.title);
                  const name = await promptEnvironmentName(fallback);
                  if (!name) return;
                  void api.saveEnvironment(session.id, name).then((result) => {
                    dispatch({ type: "config", config: result.config });
                    if (result.repo) dispatch({ type: "repo", repo: result.repo });
                  });
                })();
              }}
            >
              Save as environment…
            </MenuItem>
          ) : null}
          {hostChat ? null : (
            <MenuItem
              disabled={!docker || Boolean(session.compare) || !lastUserPrompt(session.messages)}
              title={
                docker
                  ? undefined
                  : "Parallel workers spawn extra Docker containers. QEMU guests do not run workers."
              }
              onClick={() => setWorkers(true)}
            >
              Spawn workers
            </MenuItem>
          )}
          <MenuSep />
          <MenuLabel>Danger</MenuLabel>
          <MenuItem
            danger
            onClick={() => {
              void deleteSessionWithUndo(session, dispatch, askConfirm, {
                open: state.selectedId === session.id,
              });
            }}
          >
            Delete
          </MenuItem>
        </OverflowMenu>
      </div>
      {state.replayOpen ? (
        <ReplayModal session={session} onClose={() => dispatch({ type: "replay", open: false })} />
      ) : null}
      {trace ? <TraceModal session={session} onClose={() => setTrace(false)} /> : null}
      {state.compareOpen ? (
        <CompareModal
          session={session}
          onClose={() => dispatch({ type: "compare", open: false })}
        />
      ) : null}
      {workers ? <WorkersModal session={session} onClose={() => setWorkers(false)} /> : null}
    </header>
  );
}

/** Labelled show/hide for the side panel (Files, Canvas, guest) beside the chat. */
function PanelToggle({ label }: { label: string }) {
  const { state, dispatch } = useStore();
  const open = !state.vmCollapsed;
  return (
    <Tooltip label={open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}>
      <button
        type="button"
        className={`btn small ghost topbar-panel-toggle${open ? " on" : ""}`}
        aria-pressed={open}
        aria-controls="files-pane"
        data-testid="topbar-panel-toggle"
        onClick={() => dispatch({ type: "toggleVmPane" })}
      >
        <IconPanelRight /> <span className="topbar-panel-toggle-label">{label}</span>
      </button>
    </Tooltip>
  );
}

function BoardTitle({ id, title }: { id: string; title: string }) {
  const { dispatch } = useStore();
  const [value, setValue] = useState(title);
  useEffect(() => {
    setValue(title);
  }, [id, title]);

  async function commit() {
    const next = value.trim();
    if (!next || next === title) {
      setValue(title);
      return;
    }
    try {
      const board = await api.patchBoard(id, { title: next });
      dispatch({ type: "board", board });
    } catch {
      setValue(title);
    }
  }

  return (
    <input
      className="session-title"
      value={value}
      aria-label="Board title"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setValue(title);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function ProjectTitle({ id, title }: { id: string; title: string }) {
  const { dispatch } = useStore();
  const [value, setValue] = useState(title);
  useEffect(() => {
    setValue(title);
  }, [id, title]);

  async function commit() {
    const next = value.trim();
    if (!next || next === title) {
      setValue(title);
      return;
    }
    try {
      const project = await api.patchProject(id, { title: next });
      dispatch({ type: "project", project });
    } catch {
      setValue(title);
    }
  }

  return (
    <input
      className="session-title"
      value={value}
      aria-label="Project title"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setValue(title);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function SessionTitle({ id, title }: { id: string; title: string }) {
  const [value, setValue] = useState(title);
  useEffect(() => {
    setValue(title);
  }, [id, title]);

  async function commit() {
    const next = value.trim();
    if (!next || next === title) {
      setValue(title);
      return;
    }
    try {
      await api.patchSession(id, { title: next });
    } catch {
      setValue(title);
    }
  }

  return (
    <input
      className="session-title"
      value={value}
      title={value}
      aria-label="Session title"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setValue(title);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function sessionLiveStatus(
  session: { status: string; messages: Array<{ role: string; content: string }> },
  fallback: string,
): { dot: string; caption: string } {
  if (isWaitingOnGuestStart(session.messages)) {
    return { dot: "provisioning", caption: "starting" };
  }
  if (session.status === "running") return { dot: "running", caption: "working" };
  if (session.status === "provisioning") {
    return { dot: "provisioning", caption: "starting" };
  }
  return { dot: session.status, caption: fallback };
}
