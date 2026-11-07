import { useEffect, useRef, useState } from "react";
import {
  brainClaimsForRepo,
  estimateUsd,
  formatUsd,
  liveMemberCount,
  parseProductMode,
  projectMemberColumn,
  projectMembersByColumn,
  pendingSwarmNeeds,
  projectTeamName,
  resolveUsageRates,
  sessionAvatarId,
  sessionAvatarPose,
  sessionAvatarAccessory,
  sessionDisplayName,
  workerComputeUsd,
  type AgentSession,
  type LocusConfig,
  type ProjectContextEntry,
  type ProjectDocument,
} from "@locus/shared";
import { api } from "@/lib/api";
import { useStore } from "@/state/store";
import { ChatPane } from "@/components/chat/ChatPane";
import { IconBrain, IconPause, IconPlay } from "@/components/layout/Icons";
import { PersonaAvatar } from "@/components/layout/PersonaAvatar";
import { WorkspaceBody } from "@/components/workspace/WorkspaceBody";
import { formatWhen } from "@/components/automations/Automations";
import { ProjectEmpty } from "./ProjectEmpty";
import { TeamEditor } from "./TeamEditor";

export function ProjectPane() {
  const { state, dispatch } = useStore();
  const id = state.selectedProjectId;
  const cached = id ? state.projectDocuments[id] : undefined;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.projectChat(id);
        if (cancelled) return;
        dispatch({ type: "project", project: result.project });
        const session = await api.session(result.sessionId);
        dispatch({ type: "session", session });
        dispatch({ type: "select", id: session.id });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load project");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, dispatch]);

  if (!id) return <ProjectEmpty />;
  if (error) {
    return (
      <div className="empty">
        <p className="error-text">{error}</p>
      </div>
    );
  }
  if (!cached) {
    return (
      <div className="empty">
        <p>Loading project…</p>
      </div>
    );
  }

  const selected = state.selectedId;
  const chatReady = Boolean(
    selected && (selected === cached.coordinatorSessionId || cached.memberIds.includes(selected)),
  );

  return (
    <WorkspaceBody
      variant="agent"
      collapsed={state.vmCollapsed}
      chat={chatReady ? <ChatPane /> : <p className="empty">Opening coordinator…</p>}
      preview={<ProjectFleet project={cached} />}
    />
  );
}

export function ProjectFleet(props: { project: ProjectDocument }) {
  const { state, dispatch } = useStore();
  const hubMode = parseProductMode(state.config?.productMode) === "swarm";
  const [files, setFiles] = useState<ProjectContextEntry[]>([]);
  const [mission, setMission] = useState<Awaited<
    ReturnType<typeof api.projectMissionControl>
  > | null>(null);
  const [needBusy, setNeedBusy] = useState<string | null>(null);
  const [handoffTarget, setHandoffTarget] = useState("");
  const [handoffTask, setHandoffTask] = useState("");
  const [handoffBusy, setHandoffBusy] = useState<string | null>(null);
  const [openBriefPath, setOpenBriefPath] = useState<string | null>(null);
  const [briefContent, setBriefContent] = useState<string | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [briefDraft, setBriefDraft] = useState("");
  const [briefSaving, setBriefSaving] = useState(false);
  const briefRequest = useRef(0);
  const members = state.sessions.filter((row) => props.project.memberIds.includes(row.id));
  const columns = projectMembersByColumn(members, projectMemberColumn);
  const coordinator = props.project.coordinatorSessionId
    ? state.sessions.find((row) => row.id === props.project.coordinatorSessionId)
    : undefined;
  const live = liveMemberCount(state.sessions, props.project.memberIds);
  const spent = projectSpendUsd(props.project, state.sessions, state.config);
  const selectedId = state.selectedId;
  const selectedMember =
    selectedId && props.project.memberIds.includes(selectedId)
      ? members.find((row) => row.id === selectedId)
      : undefined;

  useEffect(() => {
    let cancelled = false;
    void api.projectContext(props.project.id).then(
      (rows) => {
        if (!cancelled) setFiles(rows);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [props.project.id, props.project.updatedAt]);

  useEffect(() => {
    briefRequest.current += 1;
    setHandoffTarget("");
    setHandoffTask("");
    setOpenBriefPath(null);
    setBriefContent(null);
    setBriefError(null);
    setBriefBusy(false);
  }, [props.project.id]);

  useEffect(() => {
    let cancelled = false;
    void api.projectMissionControl(props.project.id).then(
      (next) => {
        if (!cancelled) {
          setMission(next);
          setFiles(next.context);
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [props.project.id, props.project.updatedAt]);

  async function togglePause() {
    try {
      const project = await api.patchProject(props.project.id, { paused: !props.project.paused });
      dispatch({ type: "project", project });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not pause project");
    }
  }

  async function toggleKeepAlive() {
    try {
      const project = await api.patchProject(props.project.id, {
        keepAlive: !props.project.keepAlive,
      });
      dispatch({ type: "project", project });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not update keep-alive");
    }
  }

  async function actOnNeed(
    needId: string,
    action: "approve" | "answer" | "retry" | "cancel" | "takeover",
  ) {
    const response =
      action === "answer" ? (window.prompt("Answer for the teammate") ?? "") : undefined;
    if (action === "answer" && !(response ?? "").trim()) return;
    setNeedBusy(needId);
    try {
      const project = await api.projectNeedAction(props.project.id, needId, action, response);
      dispatch({ type: "project", project });
      setMission(await api.projectMissionControl(props.project.id));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not update Needs you");
    } finally {
      setNeedBusy(null);
    }
  }

  async function sendTeamHandoff() {
    const task = handoffTask.trim();
    if (!handoffTarget || !task || handoffBusy) return;
    setHandoffBusy("new");
    try {
      await api.createProjectHandoff(props.project.id, {
        targetTeamId: handoffTarget,
        task,
      });
      setHandoffTask("");
      setMission(await api.projectMissionControl(props.project.id));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not send team handoff");
    } finally {
      setHandoffBusy(null);
    }
  }

  async function actOnTeamHandoff(handoffId: string, action: "accept" | "decline" | "complete") {
    if (handoffBusy) return;
    setHandoffBusy(handoffId);
    try {
      await api.projectHandoffAction(props.project.id, handoffId, action);
      setMission(await api.projectMissionControl(props.project.id));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not update team handoff");
    } finally {
      setHandoffBusy(null);
    }
  }

  async function openBriefing(path: string) {
    if (briefBusy) return;
    if (openBriefPath === path) {
      briefRequest.current += 1;
      setOpenBriefPath(null);
      setBriefContent(null);
      setBriefDraft("");
      setBriefError(null);
      return;
    }
    const requestId = ++briefRequest.current;
    const projectId = props.project.id;
    setBriefBusy(true);
    setBriefError(null);
    setBriefContent(null);
    setOpenBriefPath(path);
    try {
      const result = await api.projectContextRead(projectId, path);
      if (briefRequest.current !== requestId) return;
      setBriefContent(result.content);
      setBriefDraft(result.content);
    } catch (err) {
      if (briefRequest.current !== requestId) return;
      setBriefContent(null);
      setBriefError(err instanceof Error ? err.message : "Could not read briefing file");
    } finally {
      if (briefRequest.current === requestId) setBriefBusy(false);
    }
  }

  async function refreshContext() {
    setFiles(await api.projectContext(props.project.id));
  }

  async function createBriefing() {
    if (briefSaving) return;
    setBriefSaving(true);
    setBriefError(null);
    try {
      await api.projectContextWrite(
        props.project.id,
        "TEAM.md",
        "# Team briefing\n\nWhat this team is doing, who owns what, and what done looks like.\n",
      );
      await refreshContext();
      await openBriefing("TEAM.md");
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : "Could not create briefing");
    } finally {
      setBriefSaving(false);
    }
  }

  async function saveBriefing() {
    if (!openBriefPath || briefSaving) return;
    setBriefSaving(true);
    setBriefError(null);
    try {
      await api.projectContextWrite(props.project.id, openBriefPath, briefDraft);
      setBriefContent(briefDraft);
      await refreshContext();
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : "Could not save briefing");
    } finally {
      setBriefSaving(false);
    }
  }

  const needs = mission?.needsYou ?? pendingSwarmNeeds(props.project.needsYou);
  const swarmTeams = state.projects.filter(
    (row) => row.surface === "swarm" && row.id !== props.project.id,
  );
  const handoffs = mission?.handoffs ?? [];
  const repo = props.project.repoId
    ? state.repos.find((row) => row.id === props.project.repoId)
    : undefined;
  const repoBrain = repo ? brainClaimsForRepo(state.brain, repo.checkout.url) : undefined;
  const teamName = projectTeamName(props.project);

  const needsSection =
    needs.length > 0 ? (
      <section className="project-needs" aria-label="Needs you">
        <h3>
          Needs you <span className="meta">{needs.length}</span>
        </h3>
        {needs.map((need) => (
          <div key={need.id} className="project-need-card">
            <strong>{need.teammateName}</strong>
            <p>{need.reason}</p>
            <div className="project-need-actions">
              {(["approve", "answer", "retry", "takeover", "cancel"] as const).map((action) => (
                <button
                  key={action}
                  className={`btn small${action === "approve" ? " primary" : " ghost"}`}
                  type="button"
                  disabled={needBusy === need.id}
                  onClick={() => void actOnNeed(need.id, action)}
                >
                  {action === "takeover" ? "Take over" : action[0]!.toUpperCase() + action.slice(1)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
    ) : null;

  const subscriptionsBlock = (
    <section>
      <h3>Subscriptions</h3>
      {(coordinator?.subscriptions ?? []).length === 0 ? (
        <p className="meta">None. The coordinator can subscribe to Slack, PRs, or a timer.</p>
      ) : (
        <ul className="project-fleet-files">
          {(coordinator?.subscriptions ?? []).map((row) => (
            <li key={row.id}>
              {row.title}
              {row.nextFireAt ? ` · ${formatWhen(row.nextFireAt)}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const handoffsBlock = hubMode ? (
    <section className="project-handoffs" aria-label="Cross-team collaboration">
      <h3>Team handoffs</h3>
      {swarmTeams.length > 0 ? (
        <div className="project-handoff-compose">
          <select
            value={handoffTarget}
            onChange={(event) => setHandoffTarget(event.target.value)}
            aria-label="Receiving team"
          >
            <option value="">Choose a receiving team</option>
            {swarmTeams.map((row) => (
              <option key={row.id} value={row.id}>
                {row.teamName ?? row.title}
              </option>
            ))}
          </select>
          <textarea
            value={handoffTask}
            onChange={(event) => setHandoffTask(event.target.value)}
            placeholder="Describe a bounded task for another team"
            rows={3}
            aria-label="Handoff task"
          />
          <button
            type="button"
            className="btn small primary"
            disabled={!handoffTarget || !handoffTask.trim() || Boolean(handoffBusy)}
            onClick={() => void sendTeamHandoff()}
          >
            Send handoff
          </button>
        </div>
      ) : (
        <p className="meta">Create another team to send work across teams.</p>
      )}
      {handoffs.length > 0 ? (
        <ul className="project-handoff-list">
          {handoffs.slice(0, 8).map((handoff) => {
            const incoming = handoff.targetTeamId === props.project.id;
            return (
              <li key={handoff.id} className="project-handoff-card">
                <strong>
                  {incoming ? handoff.sourceTeamName : `To ${handoff.targetTeamName}`}
                </strong>
                <p>{handoff.task}</p>
                <span className="meta">{handoff.status}</span>
                {incoming && handoff.status === "queued" ? (
                  <div className="project-handoff-actions">
                    <button
                      type="button"
                      className="btn small primary"
                      disabled={Boolean(handoffBusy)}
                      onClick={() => void actOnTeamHandoff(handoff.id, "accept")}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn small ghost"
                      disabled={Boolean(handoffBusy)}
                      onClick={() => void actOnTeamHandoff(handoff.id, "decline")}
                    >
                      Decline
                    </button>
                  </div>
                ) : null}
                {incoming && handoff.status === "accepted" ? (
                  <button
                    type="button"
                    className="btn small"
                    disabled={Boolean(handoffBusy)}
                    onClick={() => void actOnTeamHandoff(handoff.id, "complete")}
                  >
                    Mark complete
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  ) : null;

  const pinnedBoard = props.project.boardId
    ? state.boards.find((row) => row.id === props.project.boardId)
    : undefined;
  const [boardPick, setBoardPick] = useState(props.project.boardId ?? "");
  useEffect(() => {
    setBoardPick(props.project.boardId ?? "");
  }, [props.project.boardId]);

  const boardBlock = (
    <section aria-label="Pinned board">
      <h3>Board</h3>
      {pinnedBoard ? (
        <p className="meta">{pinnedBoard.title}</p>
      ) : (
        <p className="meta">Pin a planning canvas to this project.</p>
      )}
      <div className="board-pop-actions">
        <select
          aria-label="Board"
          value={boardPick}
          onChange={(event) => setBoardPick(event.target.value)}
        >
          <option value="">No board</option>
          {state.boards
            .filter((row) => !row.archived)
            .map((row) => (
              <option key={row.id} value={row.id}>
                {row.title}
              </option>
            ))}
        </select>
        <button
          type="button"
          className="btn small"
          onClick={() =>
            void (async () => {
              const project = await api.patchProject(props.project.id, {
                boardId: boardPick || null,
              });
              dispatch({ type: "project", project });
            })()
          }
        >
          {boardPick ? "Pin" : "Unpin"}
        </button>
        {pinnedBoard ? (
          <button
            type="button"
            className="btn small"
            onClick={() => {
              dispatch({ type: "selectBoard", id: pinnedBoard.id });
            }}
          >
            Open
          </button>
        ) : null}
      </div>
    </section>
  );

  const brainBlock =
    hubMode || !repoBrain || (repoBrain.nodeCount === 0 && repoBrain.memoryCount === 0) ? null : (
      <section aria-label="Shared brain">
        <h3>Shared Brain</h3>
        <p className="meta">
          {repoBrain.nodeCount} claims · {repoBrain.memoryCount} memories for this repo
        </p>
        <button
          className="btn small"
          type="button"
          onClick={() => dispatch({ type: "section", section: "brain" })}
        >
          <IconBrain /> Open Brain
        </button>
      </section>
    );

  const activityBlock =
    (mission?.audit?.length ?? 0) > 0 ? (
      <section aria-label="Team activity">
        <h3>Activity</h3>
        <ul className="project-fleet-files">
          {mission!
            .audit!.slice(-5)
            .reverse()
            .map((event) => (
              <li key={event.id}>{event.message}</li>
            ))}
        </ul>
      </section>
    ) : null;

  const spendBlock = (
    <section>
      <h3>Spend</h3>
      <p className="meta">
        {formatUsd(spent)}
        {props.project.maxUsd != null ? ` / ${formatUsd(props.project.maxUsd)} cap` : " spent"}
      </p>
    </section>
  );

  const pauseButton = (
    <button
      type="button"
      className="btn small"
      onClick={() => void togglePause()}
      title={
        props.project.paused ? "Resume spawns and subscriptions" : "Pause spawns and subscriptions"
      }
    >
      {props.project.paused ? <IconPlay /> : <IconPause />}
      <span>{props.project.paused ? "Resume" : "Pause"}</span>
    </button>
  );

  const keepButton = (
    <button
      type="button"
      className="btn small"
      aria-pressed={props.project.keepAlive === true}
      onClick={() => void toggleKeepAlive()}
      title="Keep this project's control plane running after you quit Locus. The vault stays on loopback."
    >
      <span>{props.project.keepAlive ? "Kept alive" : "Keep running"}</span>
    </button>
  );

  if (hubMode) {
    return (
      <aside className="project-fleet" aria-label="Team" data-testid="project-fleet">
        <section className="project-team-switcher" aria-label="Team switcher">
          <label>
            <span className="meta">Active team</span>
            <select
              value={props.project.id}
              onChange={(event) => dispatch({ type: "selectProject", id: event.target.value })}
            >
              {state.projects
                .filter((row) => row.surface === "swarm")
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.teamName ?? row.title}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            className="btn small"
            onClick={() => dispatch({ type: "selectProject", id: null })}
          >
            New team
          </button>
        </section>

        <div className="project-fleet-head">
          <div>
            <h2 className="project-fleet-title">
              {props.project.groupChat ? "Group chat" : teamName}
            </h2>
            <p className="meta">
              {live} live · {props.project.memberIds.length} members
              {props.project.paused ? " · paused" : ""}
              {mission?.health ? ` · ${mission.health}` : ""}
            </p>
          </div>
          <div className="project-fleet-actions">
            {pauseButton}
            {keepButton}
          </div>
        </div>

        <section className="project-roster" aria-label="Teammates" data-testid="project-roster">
          <h3>Teammates</h3>
          {props.project.groupChat ? (
            <button
              type="button"
              className="team-peer-chip group-everyone-chip"
              title="Address the whole group"
              onClick={() => {
                const coordinatorId = props.project.coordinatorSessionId;
                if (coordinatorId && state.selectedId !== coordinatorId) {
                  dispatch({ type: "select", id: coordinatorId });
                }
                dispatch({ type: "compose", text: "@everyone " });
              }}
            >
              @everyone
            </button>
          ) : null}
          {coordinator ? (
            <RosterRow
              session={coordinator}
              label="Team chat"
              meta={`${teamName}${coordinator.status ? ` · ${coordinator.status}` : ""}`}
              selected={selectedId === coordinator.id}
              onSelect={() => dispatch({ type: "select", id: coordinator.id })}
            />
          ) : null}
          {members.map((row) => {
            const teamMember = props.project.team?.members.find(
              (member) => member.sessionId === row.id,
            );
            const capabilities = teamMember?.capabilities.slice(0, 2).join(", ");
            const metaParts = [
              row.persona?.hubRole,
              capabilities,
              row.status,
              row.needsHuman ? "Needs you" : null,
            ].filter(Boolean);
            return (
              <RosterRow
                key={row.id}
                session={row}
                label={sessionDisplayName(row)}
                meta={metaParts.join(" · ")}
                selected={selectedId === row.id}
                onSelect={() => dispatch({ type: "select", id: row.id })}
              />
            );
          })}
          {members.length === 0 && !coordinator ? (
            <p className="meta project-fleet-empty">No teammates yet</p>
          ) : null}
        </section>

        {selectedMember ? (
          <section className="project-teammate-strip" aria-label="Selected teammate">
            <h3>Viewing</h3>
            <p className="title">{sessionDisplayName(selectedMember)}</p>
            <p className="meta">
              {[selectedMember.persona?.hubRole, selectedMember.status, selectedMember.model]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {selectedMember.instructions?.trim() ? (
              <p className="project-teammate-brief" data-testid="teammate-brief">
                {selectedMember.instructions.trim()}
              </p>
            ) : (
              <p className="meta">No brief set for this teammate.</p>
            )}
          </section>
        ) : null}

        {needsSection}

        <section aria-label="Team briefing">
          <h3>Team briefing</h3>
          <p className="meta">
            Shared notes for this team. Open a file to read what teammates hand off.
          </p>
          {files.length === 0 ? (
            <p className="meta">
              Empty context tree.{" "}
              <button
                type="button"
                className="btn small"
                disabled={briefSaving}
                onClick={() => void createBriefing()}
              >
                {briefSaving ? "Creating…" : "Add a briefing file"}
              </button>
            </p>
          ) : (
            <ul className="project-fleet-files project-briefing-list">
              {files.map((row) => (
                <li key={row.path}>
                  <button
                    type="button"
                    className={`project-briefing-file${openBriefPath === row.path ? " on" : ""}`}
                    data-testid={`briefing-file-${row.path}`}
                    onClick={() => void openBriefing(row.path)}
                  >
                    {row.path}
                    <span className="meta">{row.bytes} B</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {openBriefPath ? (
            <div className="project-briefing-viewer" data-testid="briefing-viewer">
              <div className="project-briefing-viewer-head">
                <strong>{openBriefPath}</strong>
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => {
                    setOpenBriefPath(null);
                    setBriefContent(null);
                    setBriefError(null);
                  }}
                >
                  Close
                </button>
              </div>
              {briefBusy ? <p className="meta">Loading…</p> : null}
              {briefError ? <p className="error-text">{briefError}</p> : null}
              {briefContent != null && !briefBusy ? (
                <>
                  <textarea
                    className="project-briefing-editor"
                    aria-label="Team briefing"
                    value={briefDraft}
                    onChange={(event) => setBriefDraft(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn small primary"
                    disabled={briefSaving || briefDraft === briefContent}
                    onClick={() => void saveBriefing()}
                  >
                    {briefSaving ? "Saving…" : "Save"}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </section>

        <details className="project-fleet-more">
          <summary>More</summary>
          <div className="project-fleet-more-body">
            <TeamEditor project={props.project} />
            {subscriptionsBlock}
            {handoffsBlock}
            {boardBlock}
            {brainBlock}
            {activityBlock}
            {spendBlock}
          </div>
        </details>
      </aside>
    );
  }

  return (
    <aside className="project-fleet" aria-label="Project fleet">
      {members.length > 0 ? (
        <div className="team-peers" data-testid="team-peers" aria-label="Team members">
          {props.project.groupChat ? (
            <button
              type="button"
              className="team-peer-chip group-everyone-chip"
              title="Address the whole group"
              onClick={() => {
                const coordinatorId = props.project.coordinatorSessionId;
                if (coordinatorId && state.selectedId !== coordinatorId) {
                  dispatch({ type: "select", id: coordinatorId });
                }
                dispatch({ type: "compose", text: "@everyone " });
              }}
            >
              @everyone
            </button>
          ) : null}
          {members.map((row) => (
            <button
              key={row.id}
              type="button"
              className="team-peer-chip"
              title={sessionDisplayName(row)}
              data-peer-session={row.id}
              onClick={() => dispatch({ type: "select", id: row.id })}
            >
              <PersonaAvatar
                avatarId={sessionAvatarId(row)}
                pose={sessionAvatarPose(row)}
                accessory={sessionAvatarAccessory(row)}
                accent={row.persona?.avatarAccent}
                size={24}
              />
              <span>
                {sessionDisplayName(row)}
                {row.persona?.hubRole ? ` · ${row.persona.hubRole}` : ""}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="project-fleet-head">
        <div>
          <h3>{props.project.groupChat ? "Group chat" : "Fleet"}</h3>
          <p className="meta">
            {live} live · {props.project.memberIds.length} members
            {props.project.paused ? " · paused" : ""}
            {mission?.health ? ` · ${mission.health}` : ""}
          </p>
        </div>
        <div className="project-fleet-actions">
          {pauseButton}
          {keepButton}
        </div>
      </div>
      {columns.map((group) => (
        <section key={group.column} className="project-fleet-column" aria-label={group.label}>
          <h3>
            {group.label} <span className="meta">{group.members.length}</span>
          </h3>
          {group.members.length === 0 ? (
            <p className="meta project-fleet-empty">None</p>
          ) : (
            group.members.map((row) => {
              const teamMember = props.project.team?.members.find(
                (member) => member.sessionId === row.id,
              );
              const capabilities = teamMember?.capabilities.slice(0, 3).join(", ");
              return (
                <button
                  key={row.id}
                  type="button"
                  className={`project-fleet-row${selectedId === row.id ? " on" : ""}`}
                  aria-current={selectedId === row.id ? "true" : undefined}
                  onClick={() => dispatch({ type: "select", id: row.id })}
                >
                  <span className={`dot ${memberDot(row)}`} />
                  <span>
                    <div className="title">
                      <PersonaAvatar
                        avatarId={sessionAvatarId(row)}
                        pose={sessionAvatarPose(row)}
                        accessory={sessionAvatarAccessory(row)}
                        accent={row.persona?.avatarAccent}
                        size={18}
                      />{" "}
                      {sessionDisplayName(row)}
                    </div>
                    <div className="meta">
                      {row.persona?.hubRole ? `${row.persona.hubRole} · ` : ""}
                      {capabilities || ""}
                      {capabilities ? " · " : ""}
                      {row.status}
                      {row.model ? ` · ${row.model}` : ""}
                      {row.placement === "worker" ? " · worker" : " · local"}
                      {row.pull ? ` · #${row.pull.number}` : ""}
                      {row.pull?.checkState ? ` · ${row.pull.checkState}` : ""}
                      {row.needsHuman ? " · Needs you" : ""}
                    </div>
                  </span>
                </button>
              );
            })
          )}
        </section>
      ))}
      <section aria-label="Team briefing">
        <h3>Context</h3>
        <p className="meta">Shared notes for this project. Open a file to edit the briefing.</p>
        {files.length === 0 ? (
          <p className="meta">
            Empty context tree.{" "}
            <button
              type="button"
              className="btn small"
              disabled={briefSaving}
              onClick={() => void createBriefing()}
            >
              {briefSaving ? "Creating…" : "Add a briefing file"}
            </button>
          </p>
        ) : (
          <ul className="project-fleet-files project-briefing-list">
            {files.map((row) => (
              <li key={row.path}>
                <button
                  type="button"
                  className={`project-briefing-file${openBriefPath === row.path ? " on" : ""}`}
                  data-testid={`briefing-file-${row.path}`}
                  onClick={() => void openBriefing(row.path)}
                >
                  {row.path}
                  <span className="meta">{row.bytes} B</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {openBriefPath ? (
          <div className="project-briefing-viewer" data-testid="briefing-viewer">
            <div className="project-briefing-viewer-head">
              <strong>{openBriefPath}</strong>
              <button
                type="button"
                className="btn small ghost"
                onClick={() => {
                  setOpenBriefPath(null);
                  setBriefContent(null);
                  setBriefDraft("");
                  setBriefError(null);
                }}
              >
                Close
              </button>
            </div>
            {briefBusy ? <p className="meta">Loading…</p> : null}
            {briefError ? <p className="error-text">{briefError}</p> : null}
            {briefContent != null && !briefBusy ? (
              <>
                <textarea
                  className="project-briefing-editor"
                  aria-label="Team briefing"
                  value={briefDraft}
                  onChange={(event) => setBriefDraft(event.target.value)}
                />
                <button
                  type="button"
                  className="btn small primary"
                  disabled={briefSaving || briefDraft === briefContent}
                  onClick={() => void saveBriefing()}
                >
                  {briefSaving ? "Saving…" : "Save"}
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </section>
      {subscriptionsBlock}
      {needsSection}
      {boardBlock}
      {brainBlock}
      {activityBlock}
      {spendBlock}
    </aside>
  );
}

function RosterRow(props: {
  session: AgentSession;
  label: string;
  meta: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`project-fleet-row${props.selected ? " on" : ""}`}
      aria-current={props.selected ? "true" : undefined}
      data-peer-session={props.session.id}
      data-testid={`roster-${props.session.id}`}
      onClick={props.onSelect}
    >
      <span className={`dot ${memberDot(props.session)}`} />
      <span>
        <div className="title">
          <PersonaAvatar
            avatarId={sessionAvatarId(props.session)}
            pose={sessionAvatarPose(props.session)}
            accessory={sessionAvatarAccessory(props.session)}
            accent={props.session.persona?.avatarAccent}
            size={18}
          />{" "}
          {props.label}
        </div>
        {props.meta ? <div className="meta">{props.meta}</div> : null}
      </span>
    </button>
  );
}

function projectSpendUsd(
  project: ProjectDocument,
  sessions: AgentSession[],
  config: LocusConfig | null,
): number {
  if (!config) return 0;
  const ids = new Set(
    [project.coordinatorSessionId, ...project.memberIds].filter((id): id is string => Boolean(id)),
  );
  let usd = 0;
  for (const row of sessions) {
    if (!ids.has(row.id)) continue;
    const provider = config.providers.find((item) => item.id === row.providerId);
    usd += row.usage ? (estimateUsd(row.usage, resolveUsageRates(provider, row.model)) ?? 0) : 0;
    usd += workerComputeUsd(
      row,
      (config.workers ?? []).find((item) => item.id === row.backendId),
    );
  }
  return usd;
}

function memberDot(row: AgentSession): string {
  if (row.needsHuman) return "warn";
  if (row.status === "running" || row.status === "provisioning") return "live";
  if (row.status === "error") return "danger";
  return "idle";
}
