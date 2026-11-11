import {
  MAX_GROUP_CHAT_PARTICIPANTS,
  MIN_GROUP_CHAT_PARTICIPANTS,
  PROJECT_STARTER_META,
  parseProductMode,
  sessionAvatarAccessory,
  sessionAvatarId,
  sessionAvatarPose,
  sessionDisplayName,
  sessionKind,
  sessionMatchesSurface,
  type ProjectStarter,
} from "@locus/shared";
import { useState } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/state/store";
import { EmptyHero } from "@/components/layout/EmptyHero";
import { IconPlus } from "@/components/layout/Icons";
import { PersonaAvatar } from "@/components/layout/PersonaAvatar";

export function ProjectEmpty() {
  const { state, dispatch } = useStore();
  const hubMode = parseProductMode(state.config?.productMode) === "swarm";
  const [teamName, setTeamName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [starter, setStarter] = useState<ProjectStarter | null>(null);
  const [groupChat, setGroupChat] = useState(false);
  const [participants, setParticipants] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const teammateOptions = state.sessions.filter(
    (row) =>
      hubMode &&
      sessionMatchesSurface(row, "swarm") &&
      sessionKind(row) === "agent" &&
      !row.archived,
  );

  async function create(nextStarter: ProjectStarter, nextPrompt?: string) {
    if (busy) return;
    if (
      groupChat &&
      (participants.length < MIN_GROUP_CHAT_PARTICIPANTS ||
        participants.length > MAX_GROUP_CHAT_PARTICIPANTS)
    ) {
      setError(
        `Choose ${MIN_GROUP_CHAT_PARTICIPANTS}-${MAX_GROUP_CHAT_PARTICIPANTS} teammates first.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const project = await api.createProject(
        groupChat
          ? {
              title: title.trim() || "Group chat",
              starter: "blank",
              prompt: nextPrompt?.trim() || undefined,
              surface: "swarm",
              groupChat: true,
              participantIds: participants,
            }
          : {
              starter: nextStarter,
              prompt: nextPrompt?.trim() || undefined,
              ...(hubMode && teamName.trim() ? { teamName: teamName.trim() } : {}),
              surface: hubMode ? "swarm" : "developer",
            },
      );
      dispatch({ type: "project", project });
      dispatch({ type: "selectProject", id: project.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project");
    } finally {
      setBusy(false);
    }
  }

  function toggleParticipant(id: string) {
    setParticipants((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : current.length >= MAX_GROUP_CHAT_PARTICIPANTS
          ? current
          : [...current, id],
    );
  }

  return (
    <div className="empty design-start board-start">
      <div className="empty-card">
        <EmptyHero
          title={hubMode ? "Teams" : "Projects"}
          lead={
            hubMode
              ? "A team with a coordinator, shared context, and teammates who can hand work to each other."
              : "A body of work with a coordinator, shared context, and members. The coordinator plans and delegates — it does not write application code."
          }
        />
        {hubMode ? (
          <div className="swarm-start-modes" role="group" aria-label="Start a Swarm conversation">
            <button
              type="button"
              className={`btn small${groupChat ? "" : " primary"}`}
              onClick={() => {
                setGroupChat(false);
                setError(null);
              }}
            >
              New team
            </button>
            <button
              type="button"
              className={`btn small${groupChat ? " primary" : ""}`}
              data-testid="new-group-chat"
              onClick={() => {
                setGroupChat(true);
                setStarter(null);
                setError(null);
              }}
            >
              New group chat
            </button>
          </div>
        ) : null}
        <div className="design-start-layout">
          <form
            className="design-start-prompt"
            onSubmit={(event) => {
              event.preventDefault();
              void create(starter ?? "blank", prompt);
            }}
          >
            <div className="empty-composer">
              {groupChat ? (
                <input
                  className="group-chat-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Group chat name"
                  aria-label="Group chat name"
                />
              ) : hubMode ? (
                <input
                  className="project-team-name-input"
                  value={teamName}
                  onChange={(event) => setTeamName(event.target.value)}
                  placeholder="Team name (for example, Platform)"
                  aria-label="Team name"
                  maxLength={80}
                />
              ) : null}
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  groupChat
                    ? "What should the group work on?"
                    : "Describe the feature, migration, or garden"
                }
                rows={3}
              />
              <div className="empty-composer-bar">
                <button
                  className="btn primary small composer-send"
                  type="submit"
                  disabled={busy}
                  title={groupChat ? "Start group chat" : hubMode ? "New team" : "New project"}
                  aria-label={
                    busy
                      ? groupChat
                        ? "Creating…"
                        : hubMode
                          ? "Creating team"
                          : "Creating…"
                      : groupChat
                        ? "Start group chat"
                        : hubMode
                          ? "New team"
                          : "New project"
                  }
                >
                  <IconPlus />
                  <span>
                    {busy
                      ? groupChat
                        ? "Creating…"
                        : hubMode
                          ? "Creating team"
                          : "Creating…"
                      : groupChat
                        ? "Start group chat"
                        : hubMode
                          ? "New team"
                          : "New project"}
                  </span>
                </button>
              </div>
            </div>
            {error ? <p className="error-text">{error}</p> : null}
          </form>
          {groupChat ? (
            <div className="design-start-from group-chat-members">
              <p className="design-start-from-label">
                Choose {MIN_GROUP_CHAT_PARTICIPANTS}-{MAX_GROUP_CHAT_PARTICIPANTS} teammates
                <span className="meta"> {participants.length} selected</span>
              </p>
              {teammateOptions.length ? (
                <div
                  className="group-chat-member-grid"
                  role="group"
                  aria-label="Group chat teammates"
                >
                  {teammateOptions.map((row) => {
                    const selected = participants.includes(row.id);
                    return (
                      <button
                        key={row.id}
                        type="button"
                        className={`group-chat-member${selected ? " selected" : ""}`}
                        aria-pressed={selected}
                        onClick={() => toggleParticipant(row.id)}
                      >
                        <PersonaAvatar
                          avatarId={sessionAvatarId(row)}
                          pose={sessionAvatarPose(row)}
                          accessory={sessionAvatarAccessory(row)}
                          accent={row.persona?.avatarAccent}
                          size={28}
                        />
                        <span>
                          <strong>{sessionDisplayName(row)}</strong>
                          <small>{row.persona?.hubRole ?? "Teammate"}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="meta">
                  Create at least two Swarm teammates before starting a group chat.
                </p>
              )}
            </div>
          ) : (
            <div className="design-start-from">
              <p className="design-start-from-label">Or start from</p>
              <div className="recipe-grid pills" role="group" aria-label="Project starters">
                {PROJECT_STARTER_META.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={`os-card ${starter === row.id ? "active" : ""}`}
                    title={row.blurb}
                    onClick={() => {
                      setStarter(row.id);
                      void create(row.id, prompt);
                    }}
                  >
                    <h3>{row.title}</h3>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
