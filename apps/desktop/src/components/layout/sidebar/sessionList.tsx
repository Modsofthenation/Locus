import type { ReactNode } from "react";
import {
  guestLabel,
  isLocusAgentImage,
  sessionAvatarAccessory,
  sessionAvatarId,
  sessionAvatarPose,
  sessionDisplayName,
  sessionGitBranch,
  sessionListStamp,
  sessionRuntime,
  type AgentSession,
  type LinkedRepo,
} from "@locus/shared";
import { api } from "@/lib/api";
import {
  clusterSessionsByRepo,
  groupSessionsByDay,
  sessionRepoKey,
  sessionRepoLabel,
} from "@/lib/sessionGroups";
import type { SidebarGroupBy, SidebarListFilter } from "@/lib/sidebarPrefs";
import { sessionHasNeedsYou } from "@/lib/needsYou";
import { formatSwarmListWhen } from "@/lib/swarmPresence";
import {
  addSwarmRosterSection,
  hideSwarmSession,
  moveSwarmSessionToSection,
  sectionIdForSession,
  showSwarmSession,
  type SwarmRosterPrefs,
} from "@/lib/swarmRosterPrefs";
import { TrustActions } from "@/components/chat/TrustActions";
import { MenuItem, MenuLabel, MenuSep, OverflowMenu } from "../OverflowMenu";
import { PersonaAvatar } from "@/components/layout/PersonaAvatar";
import { sessionStatusLabel } from "@/lib/sessionStatus";
import { showErrorNotice, showUndoNotice } from "@/lib/notice";
import { askConfirm, askPrompt } from "@/lib/dialog";
import { archiveOne, deleteSessionWithUndo } from "@/lib/sessionUndo";
import { useStore } from "@/state/store";

export function agentRuntimeMeta(s: AgentSession): string {
  const where =
    sessionRuntime(s) === "host"
      ? "Host"
      : s.runtime === "docker"
        ? s.dockerImage?.trim() && !isLocusAgentImage(s.dockerImage.trim())
          ? s.dockerImage.trim()
          : null
        : guestLabel(s.os);
  return [where, s.model].filter(Boolean).join(" · ");
}

export function agentMeta(s: AgentSession, projectTitle?: string): string {
  return [
    s.archived ? "Archived" : null,
    s.automationId ? "Job" : null,
    s.persona?.hubRole ? s.persona.hubRole : null,
    s.projectId ? (projectTitle ?? "Project") : null,
    agentRuntimeMeta(s),
    s.pull ? `#${s.pull.number}` : null,
    s.sourceDesignId ? "design" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function sessionRowTitle(session: AgentSession): string {
  const branch = sessionGitBranch(session);
  const name = sessionDisplayName(session);
  return branch ? `${name} · ${branch}` : name;
}

export function sessionRowClass(
  session: AgentSession,
  selected: boolean,
  unread: boolean,
  extra = "",
): string {
  return [
    "session-item",
    extra,
    selected ? "active" : "",
    session.archived ? "archived" : "",
    unread ? "unread" : "",
    sessionHasNeedsYou(session) ? "needs-you" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function SessionTitle(props: { session: AgentSession; unread: boolean }) {
  return (
    <div className="title">
      {props.session.pinned ? (
        <span className="pin" aria-label="Pinned">
          ★
        </span>
      ) : null}
      <span className="title-text">{sessionDisplayName(props.session)}</span>
      {props.unread ? <span className="unread-dot" aria-label="Unread" /> : null}
    </div>
  );
}

export function sessionPassesListFilter(
  session: AgentSession,
  filter: SidebarListFilter,
  unreadIds: string[],
): boolean {
  if (filter === "needs") return sessionHasNeedsYou(session);
  if (filter === "running") {
    return session.status === "running" || session.status === "provisioning";
  }
  if (filter === "unseen") return unreadIds.includes(session.id);
  return true;
}

export function sessionStatusGroup(session: AgentSession): {
  id: string;
  label: string;
  warn?: boolean;
} {
  if (sessionHasNeedsYou(session)) return { id: "needs", label: "Needs you", warn: true };
  if (session.status === "running" || session.status === "provisioning") {
    return { id: "running", label: "Running" };
  }
  if (session.status === "error") return { id: "error", label: "Error" };
  if (session.archived) return { id: "archived", label: "Archived" };
  return { id: "idle", label: "Idle" };
}

export function SessionGroupBlocks(props: {
  sessions: AgentSession[];
  selectedId: string | null;
  unreadIds: string[];
  repos: LinkedRepo[];
  metaFor: (session: AgentSession) => string;
  previewFor?: (session: AgentSession) => ReactNode;
  onSelect: (id: string) => void;
  trust?: boolean;
  hub?: boolean;
  rosterPrefs?: SwarmRosterPrefs;
  onRosterPrefs?: (next: SwarmRosterPrefs) => void;
  groupBy?: SidebarGroupBy;
}) {
  const groupBy = props.groupBy ?? "day";

  function renderRows(rows: AgentSession[]) {
    return clusterSessionsByRepo(rows, sessionRepoKey, (session) =>
      sessionRepoLabel(session, props.repos),
    ).map((cluster) => (
      <div key={cluster.key} className={cluster.label ? "session-repo-group" : undefined}>
        {cluster.label && !props.hub && groupBy !== "repo" ? (
          <p className="session-repo-label">{cluster.label}</p>
        ) : null}
        {cluster.items.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            selected={props.selectedId === s.id}
            unread={props.unreadIds.includes(s.id)}
            meta={props.metaFor(s)}
            preview={props.previewFor?.(s)}
            trust={props.trust}
            hub={props.hub}
            rosterPrefs={props.rosterPrefs}
            onRosterPrefs={props.onRosterPrefs}
            onSelect={props.onSelect}
          />
        ))}
      </div>
    ));
  }

  if (groupBy === "repo") {
    return (
      <>
        {clusterSessionsByRepo(props.sessions, sessionRepoKey, (session) =>
          sessionRepoLabel(session, props.repos),
        ).map((cluster) => (
          <div key={cluster.key} className="session-group">
            {props.hub ? null : <p className="session-group-label">{cluster.label ?? "No repo"}</p>}
            {cluster.items.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                selected={props.selectedId === s.id}
                unread={props.unreadIds.includes(s.id)}
                meta={props.metaFor(s)}
                preview={props.previewFor?.(s)}
                trust={props.trust}
                hub={props.hub}
                rosterPrefs={props.rosterPrefs}
                onRosterPrefs={props.onRosterPrefs}
                onSelect={props.onSelect}
              />
            ))}
          </div>
        ))}
      </>
    );
  }

  if (groupBy === "status") {
    const buckets = new Map<string, { label: string; warn?: boolean; items: AgentSession[] }>();
    const order = ["needs", "running", "error", "idle", "archived"];
    for (const session of props.sessions) {
      const group = sessionStatusGroup(session);
      const bucket = buckets.get(group.id) ?? { label: group.label, warn: group.warn, items: [] };
      bucket.items.push(session);
      buckets.set(group.id, bucket);
    }
    return (
      <>
        {order.map((id) => {
          const bucket = buckets.get(id);
          if (!bucket?.items.length) return null;
          return (
            <div key={id} className="session-group">
              {props.hub ? null : (
                <p className={`session-group-label${bucket.warn ? " warn" : ""}`}>{bucket.label}</p>
              )}
              {renderRows(bucket.items)}
            </div>
          );
        })}
      </>
    );
  }

  return (
    <>
      {groupSessionsByDay(props.sessions).map((group) => (
        <div key={group.id} className="session-group">
          {props.hub ? null : <p className="session-group-label">{group.label}</p>}
          {renderRows(group.items)}
        </div>
      ))}
    </>
  );
}

export function SessionRow(props: {
  session: AgentSession;
  selected: boolean;
  unread: boolean;
  meta: string;
  preview?: ReactNode;
  onSelect: (id: string) => void;
  trust?: boolean;
  hub?: boolean;
  rosterPrefs?: SwarmRosterPrefs;
  onRosterPrefs?: (next: SwarmRosterPrefs) => void;
}) {
  const s = props.session;
  const { state, dispatch } = useStore();
  const branch = sessionGitBranch(s);
  const rowTitle = sessionRowTitle(s);
  const stamp = props.hub ? formatSwarmListWhen(sessionListStamp(s)) : "";
  const rosterPrefs = props.rosterPrefs;
  const hidden = Boolean(rosterPrefs?.hiddenSessionIds.includes(s.id));
  const currentSectionId = rosterPrefs ? sectionIdForSession(rosterPrefs, s.id) : null;

  function patch(next: { pinned?: boolean; archived?: boolean; title?: string }) {
    void api.patchSession(s.id, next).catch((err: unknown) => {
      showErrorNotice(err, "Could not update this agent");
    });
  }

  function rename() {
    void (async () => {
      const next = (await askPrompt({ title: "Rename", value: s.title }))?.trim();
      if (!next || next === s.title) return;
      patch({ title: next });
    })();
  }

  function remove() {
    void deleteSessionWithUndo(s, dispatch, askConfirm, { open: state.selectedId === s.id });
  }

  function duplicateSession() {
    void api
      .fork(s.id)
      .then((forked) => {
        dispatch({ type: "session", session: forked });
        dispatch({ type: "select", id: forked.id });
      })
      .catch((err: unknown) => {
        showErrorNotice(err, "Could not duplicate");
      });
  }

  function updateRoster(next: SwarmRosterPrefs) {
    props.onRosterPrefs?.(next);
  }

  function hideTeammate() {
    if (!rosterPrefs) return;
    const previous = rosterPrefs;
    updateRoster(hideSwarmSession(rosterPrefs, s.id));
    showUndoNotice(`Hidden ${s.title}`, () => updateRoster(previous));
  }

  function restoreTeammate() {
    if (!rosterPrefs) return;
    updateRoster(showSwarmSession(rosterPrefs, s.id));
  }

  function newSection() {
    if (!rosterPrefs) return;
    void (async () => {
      const name = (await askPrompt({ title: "Section name" }))?.trim();
      if (!name) return;
      updateRoster(addSwarmRosterSection(rosterPrefs, name, s.id));
    })();
  }

  function moveToSection(sectionId: string | null) {
    if (!rosterPrefs) return;
    updateRoster(moveSwarmSessionToSection(rosterPrefs, s.id, sectionId));
  }

  const menu = (
    <OverflowMenu title={`More for ${s.title}`} toggleClassName="btn icon ghost small">
      <MenuItem onClick={() => patch({ pinned: !s.pinned })}>{s.pinned ? "Unpin" : "Pin"}</MenuItem>
      <MenuItem onClick={duplicateSession}>
        {props.hub ? "Duplicate teammate" : "Duplicate"}
      </MenuItem>
      {props.hub && rosterPrefs ? (
        hidden ? (
          <MenuItem onClick={restoreTeammate}>Show</MenuItem>
        ) : (
          <MenuItem onClick={hideTeammate}>Hide</MenuItem>
        )
      ) : null}
      {props.hub && rosterPrefs ? (
        <>
          <MenuSep />
          <MenuLabel>Section</MenuLabel>
          {rosterPrefs.sections.map((section) => (
            <MenuItem
              key={section.id}
              disabled={section.id === currentSectionId}
              onClick={() => moveToSection(section.id)}
            >
              Move to {section.name}
            </MenuItem>
          ))}
          <MenuItem onClick={newSection}>New section…</MenuItem>
          {currentSectionId ? (
            <MenuItem onClick={() => moveToSection(null)}>Remove from section</MenuItem>
          ) : null}
        </>
      ) : null}
      <MenuItem onClick={rename}>Rename</MenuItem>
      <MenuItem
        onClick={() => {
          if (s.archived) patch({ archived: false });
          else archiveOne(s, dispatch);
        }}
      >
        {s.archived ? "Unarchive" : "Archive"}
      </MenuItem>
      <MenuSep />
      <MenuItem danger onClick={remove}>
        Delete
      </MenuItem>
    </OverflowMenu>
  );
  const copy = (
    <>
      <div className="session-row-main">
        <SessionTitle session={s} unread={props.unread} />
        {stamp ? <span className="session-stamp">{stamp}</span> : null}
      </div>
      <div className="meta">
        {props.hub ? null : branch ? (
          <span className="session-branch" title={branch}>
            {branch}
          </span>
        ) : null}
        {!props.hub && branch && props.meta ? <span className="session-meta-sep">·</span> : null}
        {props.meta ? <span className="session-meta-rest">{props.meta}</span> : null}
      </div>
    </>
  );
  if (props.preview) {
    return (
      <div
        className={sessionRowClass(s, props.selected, props.unread, "design-item has-menu")}
        title={rowTitle}
      >
        <div className="design-thumb-hit" onClick={() => props.onSelect(s.id)}>
          {props.preview}
          <span className={`dot ${s.status}`} title={sessionStatusLabel(s.status)} />
        </div>
        <button
          type="button"
          className="design-item-open"
          title={rowTitle}
          onClick={() => props.onSelect(s.id)}
        >
          {copy}
        </button>
        {menu}
      </div>
    );
  }
  const trust = props.trust ? <TrustActions compact session={s} /> : null;
  if (trust) {
    return (
      <div
        className={sessionRowClass(s, props.selected, props.unread, "needs-you-item has-menu")}
        title={rowTitle}
      >
        <button
          type="button"
          className="session-item-open"
          title={rowTitle}
          onClick={() => props.onSelect(s.id)}
        >
          <span className={`dot ${s.status}`} title={sessionStatusLabel(s.status)} />
          <span>{copy}</span>
        </button>
        {trust}
        {menu}
      </div>
    );
  }
  return (
    <div
      className={sessionRowClass(
        s,
        props.selected,
        props.unread,
        props.hub ? "has-menu hub-session-item" : "has-menu",
      )}
      title={rowTitle}
    >
      <button
        type="button"
        className="session-item-open"
        title={rowTitle}
        onClick={() => props.onSelect(s.id)}
      >
        {props.hub ? (
          <PersonaAvatar
            avatarId={sessionAvatarId(s)}
            pose={sessionAvatarPose(s)}
            accessory={sessionAvatarAccessory(s)}
            accent={s.persona?.avatarAccent}
            size={36}
            title={sessionDisplayName(s)}
          />
        ) : null}
        <span className={`dot ${s.status}`} title={sessionStatusLabel(s.status)} />
        <span className={props.hub ? "session-item-copy" : undefined}>{copy}</span>
      </button>
      {menu}
    </div>
  );
}
