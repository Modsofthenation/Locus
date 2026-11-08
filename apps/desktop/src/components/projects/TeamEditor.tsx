import {
  HUB_ROLE_PRESETS,
  isProjectSession,
  parseSessionSurface,
  projectTeamName,
  sessionDisplayName,
  type AgentSession,
  type ProjectDocument,
  type ProjectSummary,
} from "@locus/shared";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { resolveAgentDefaults, loadLastAgent } from "@/lib/lastAgent";
import { emptyPersonaDraft, personaFromDraft } from "@/lib/personaDraft";
import { useStore } from "@/state/store";
import { Select } from "@/components/layout/Select";

function existingTeammateLabel(
  session: AgentSession,
  projectId: string,
  projects: ProjectSummary[],
): string {
  const name = sessionDisplayName(session);
  const role = session.persona?.hubRole?.trim();
  const home =
    session.projectId && session.projectId !== projectId
      ? projects.find((row) => row.id === session.projectId)
      : undefined;
  const team = home?.teamName ?? home?.title;
  if (team) return `${name} · ${team}`;
  if (role) return `${name} · ${role}`;
  return name;
}

export function TeamEditor(props: { project: ProjectDocument }) {
  const { state, dispatch } = useStore();
  const [name, setName] = useState(() => projectTeamName(props.project));
  const [goal, setGoal] = useState(props.project.goal ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memberName, setMemberName] = useState("");
  const [role, setRole] = useState("");
  const [brief, setBrief] = useState("");
  const [existingId, setExistingId] = useState("");
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  useEffect(() => {
    setName(projectTeamName(props.project));
    setGoal(props.project.goal ?? "");
    setError(null);
    setExistingId("");
  }, [
    props.project.id,
    props.project.updatedAt,
    props.project.goal,
    props.project.title,
    props.project.team?.name,
  ]);

  const savedName = projectTeamName(props.project);
  const dirty = name.trim() !== savedName || goal.trim() !== (props.project.goal ?? "").trim();
  const existing = state.sessions
    .filter((session) => {
      if (session.archived) return false;
      if (parseSessionSurface(session.surface) !== "swarm") return false;
      if (isProjectSession(session)) return false;
      if (session.id === props.project.coordinatorSessionId) return false;
      if (props.project.memberIds.includes(session.id)) return false;
      return true;
    })
    .slice()
    .sort((a, b) => sessionDisplayName(a).localeCompare(sessionDisplayName(b)));

  async function save(event: FormEvent) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName || busy || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      const project = await api.patchProject(props.project.id, {
        teamName: nextName,
        title: nextName,
        goal: goal.trim() ? goal.trim() : null,
      });
      dispatch({ type: "project", project });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save team");
    } finally {
      setBusy(false);
    }
  }

  async function addExisting(event: FormEvent) {
    event.preventDefault();
    const sessionId = existingId.trim();
    if (!sessionId || memberBusy) return;
    setMemberBusy(true);
    setMemberError(null);
    try {
      const result = await api.addProjectMember(props.project.id, sessionId);
      dispatch({ type: "session", session: result.session });
      dispatch({ type: "project", project: result.project });
      setExistingId("");
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : "Could not add teammate");
    } finally {
      setMemberBusy(false);
    }
  }

  async function addTeammate(event: FormEvent) {
    event.preventDefault();
    const nextName = memberName.trim();
    if (!nextName || memberBusy) return;
    const defaults = resolveAgentDefaults(state.config, "ubuntu", loadLastAgent());
    if (!defaults.providerId || !defaults.model) {
      setMemberError("Add a model provider before creating a teammate.");
      return;
    }
    setMemberBusy(true);
    setMemberError(null);
    try {
      const templateId =
        defaults.templateId ||
        state.config?.templates.find((row) => row.os === "ubuntu")?.id ||
        "host";
      const session = await api.createSession({
        os: "ubuntu",
        templateId,
        runtime: "host",
        providerId: defaults.providerId,
        model: defaults.model,
        startVm: false,
        autonomy: "guided",
        surface: "swarm",
        projectId: props.project.id,
        persona: personaFromDraft({
          ...emptyPersonaDraft(),
          displayName: nextName,
          hubRole: role,
        }),
        instructions: brief.trim() || undefined,
        prompt: brief.trim() || undefined,
      });
      dispatch({ type: "session", session });
      const project = await api.project(props.project.id);
      dispatch({ type: "project", project });
      setMemberName("");
      setRole("");
      setBrief("");
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : "Could not add teammate");
    } finally {
      setMemberBusy(false);
    }
  }

  return (
    <section className="team-editor" aria-label="Edit team">
      <form onSubmit={(event) => void save(event)}>
        <h3>Team</h3>
        <label>
          Name
          <input
            className="project-team-name-input"
            value={name}
            maxLength={80}
            aria-label="Team name"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Goal
          <textarea
            className="project-team-name-input"
            value={goal}
            rows={3}
            aria-label="Team goal"
            placeholder="What this team owns"
            onChange={(event) => setGoal(event.target.value)}
          />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <button
          className="btn small primary"
          type="submit"
          disabled={busy || !name.trim() || !dirty}
        >
          {busy ? "Saving…" : "Save team"}
        </button>
      </form>
      <form onSubmit={(event) => void addExisting(event)} aria-label="Add existing teammate">
        <h3>Existing teammate</h3>
        <label>
          Teammate
          <Select
            ariaLabel="Existing teammate"
            value={existingId}
            options={[
              {
                value: "",
                label: existing.length ? "Choose a teammate" : "No teammates to add",
              },
              ...existing.map((session) => ({
                value: session.id,
                label: existingTeammateLabel(session, props.project.id, state.projects),
              })),
            ]}
            onChange={setExistingId}
          />
        </label>
        <button className="btn small" type="submit" disabled={memberBusy || !existingId}>
          {memberBusy ? "Adding…" : "Add to team"}
        </button>
      </form>
      <form onSubmit={(event) => void addTeammate(event)} aria-label="Add teammate">
        <h3>Add teammate</h3>
        <label>
          Name
          <input
            className="project-team-name-input"
            value={memberName}
            aria-label="Teammate name"
            placeholder="Nova"
            onChange={(event) => setMemberName(event.target.value)}
          />
        </label>
        <label>
          Role
          <Select
            ariaLabel="Teammate role"
            value={role}
            options={[
              { value: "", label: "Ask when we start" },
              ...HUB_ROLE_PRESETS.map((preset) => ({ value: preset, label: preset })),
            ]}
            onChange={setRole}
          />
        </label>
        <label>
          Brief
          <textarea
            className="project-team-name-input"
            value={brief}
            rows={2}
            aria-label="Teammate brief"
            placeholder="What they should focus on first"
            onChange={(event) => setBrief(event.target.value)}
          />
        </label>
        <button className="btn small" type="submit" disabled={memberBusy || !memberName.trim()}>
          {memberBusy ? "Adding…" : "Add teammate"}
        </button>
      </form>
      {memberError ? <p className="error-text">{memberError}</p> : null}
    </section>
  );
}
