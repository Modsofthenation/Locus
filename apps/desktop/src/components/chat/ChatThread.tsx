import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type UIEvent,
} from "react";
import {
  formatCompactNotice,
  formatWaitElapsed,
  guestLabel,
  isGuestStartNote,
  isHiddenChatMessage,
  isProjectSession,
  operatorVisibleText,
  sessionAvatarAccessory,
  sessionAvatarId,
  sessionAvatarPose,
  sessionDisplayName,
  summarizeLogBlob,
  thinkingTraceText,
  turnToolCalls,
  type AgentSession,
  type ChatCluster,
  type ChatMessage,
  type CloneProgress,
  type ImageBuildProgress,
  type SubagentLive,
  type TeamEventKind,
  type TeamSpeaker,
} from "@locus/shared";
import { leftoverAttachChips } from "@/lib/composerPaste";
import { formatMarkdown } from "@/lib/markdown";
import { isStuckToBottom, pinThreadToLatest } from "@/lib/threadScroll";
import {
  listPreserveScrollTop,
  listSizePrefix,
  listWindowFromSizes,
  sameListWindow,
  shouldUpdateListWindow,
  type ListWindow,
} from "@/lib/listWindow";
import { TurnDiffChip } from "./ArtifactDrawer";
import { ExpandableLog } from "./ExpandableLog";
import { ShotCard, ToolActivity } from "./ChatToolActivity";
import { SubagentFold } from "./SubagentCard";
import { screenshotSrc } from "./GuestTimeline";
import { IconCopy } from "@/components/layout/Icons";
import { Mascot } from "@/components/layout/Mascot";
import { PersonaAvatar } from "@/components/layout/PersonaAvatar";
import { CloneProgressCard, ImageBuildCard } from "./CloneProgressCard";
import { ThinkingTrace } from "./ThinkingTrace";
import { ChatScrollIndicator } from "./ChatScrollIndicator";
import { NewMessagesDivider } from "./NewMessagesDivider";
import { TaskListCard } from "./TaskListCard";
import { SubscriptionCard } from "./SubscriptionCard";

const TEAM_EVENT_LABELS: Record<TeamEventKind, string> = {
  spawn: "Spawned",
  join: "Joined",
  handoff: "Handoff",
  blocked: "Blocked",
  done: "Done",
  needs_you: "Needs you",
  address: "Addressed",
};

type ChatWho = {
  name: string;
  speaker?: Pick<
    TeamSpeaker,
    "avatarId" | "avatarPose" | "avatarAccessory" | "avatarAccent" | "sessionId"
  >;
};

/** Prefer a running teammate, then the live team name, then the session identity. */
function swarmChatWho(input: {
  session: AgentSession;
  teamName?: string;
  members: AgentSession[];
  speaker?: TeamSpeaker;
  preferRunning?: boolean;
}): ChatWho {
  if (input.speaker) {
    const live =
      input.members.find((row) => row.id === input.speaker!.sessionId) ??
      (input.session.id === input.speaker.sessionId ? input.session : undefined);
    if (live) {
      const name =
        isProjectSession(live) && input.teamName?.trim()
          ? input.teamName.trim()
          : sessionDisplayName(live);
      return {
        name,
        speaker: {
          sessionId: live.id,
          avatarId: sessionAvatarId(live),
          avatarPose: sessionAvatarPose(live),
          avatarAccessory: sessionAvatarAccessory(live),
          avatarAccent: live.persona?.avatarAccent,
        },
      };
    }
    return { name: input.speaker.displayName, speaker: input.speaker };
  }
  if (input.preferRunning) {
    const running = input.members.filter(
      (row) => row.status === "running" || row.status === "provisioning",
    );
    if (running.length === 1) {
      const live = running[0]!;
      return {
        name: sessionDisplayName(live),
        speaker: {
          sessionId: live.id,
          avatarId: sessionAvatarId(live),
          avatarPose: sessionAvatarPose(live),
          avatarAccessory: sessionAvatarAccessory(live),
          avatarAccent: live.persona?.avatarAccent,
        },
      };
    }
    if (running.length > 1) {
      return { name: running.map((row) => sessionDisplayName(row)).join(" · ") };
    }
  }
  if (isProjectSession(input.session) && input.teamName?.trim()) {
    return { name: input.teamName.trim() };
  }
  return { name: sessionDisplayName(input.session) };
}

export function isBlankAssistant(message: ChatMessage): boolean {
  return (
    message.role === "assistant" &&
    !message.content.trim() &&
    !message.toolCalls?.length &&
    !message.attachments?.length &&
    !message.screenshotBase64 &&
    !message.screenshotName &&
    !message.artifactName &&
    !message.recordingName
  );
}

export function hasOpenTool(messages: ChatMessage[]): boolean {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUser = i;
      break;
    }
  }
  return messages
    .slice(lastUser + 1)
    .some((message) => message.toolCalls?.some((call) => !call.finishedAt));
}

function useTurnElapsed(active: boolean, resetKey: string): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [active, resetKey]);
  return elapsed;
}

function WorkingIndicator({
  label,
  thought,
  ticking = false,
  resetKey = "",
}: {
  label: string;
  thought?: string;
  ticking?: boolean;
  resetKey?: string;
}) {
  const elapsedSec = useTurnElapsed(ticking, resetKey);
  const elapsed = elapsedSec >= 3 ? formatWaitElapsed(elapsedSec) : "";
  return (
    <div className="bubble working" data-testid="agent-working" role="status" aria-live="polite">
      <Mascot pose="think" size={28} />
      <div className="working-copy">
        <span className="working-line">
          <span className="working-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          {label}
          {elapsed ? (
            <span className="working-elapsed" data-testid="agent-wait-elapsed">
              {" "}
              · {elapsed}
            </span>
          ) : null}
        </span>
        {thought ? (
          <span className="working-thought" data-testid="agent-thinking">
            {thought}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SystemOrMarkdown(props: { role: string; content: string; liveWait?: boolean }) {
  if (props.role === "system" && summarizeLogBlob(props.content).detail) {
    return <ExpandableLog text={props.content} />;
  }
  if (props.liveWait) {
    return (
      <div className="bubble is-live-wait" data-testid="guest-start-note">
        <span className="working-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        {props.content}
      </div>
    );
  }
  return <MarkdownBubble content={props.content} />;
}

const MarkdownBubble = memo(function MarkdownBubble({ content }: { content: string }) {
  return (
    <div
      className="bubble md-bubble"
      dangerouslySetInnerHTML={{ __html: formatMarkdown(content) }}
      onClick={(event) => {
        const btn = (event.target as HTMLElement | null)?.closest(".md-copy");
        if (!btn) return;
        const pre = btn.parentElement?.querySelector("pre");
        const text = pre?.textContent ?? "";
        if (!text) return;
        void navigator.clipboard.writeText(text).catch(() => undefined);
      }}
    />
  );
});

type TurnDiff = { checkpointId: string; fileCount: number; path?: string; line?: number };

const CHAT_THREAD_ROW_PX = 140;

export const ChatThread = memo(function ChatThread({
  threadRef,
  onScroll,
  followLatest,
  session,
  clusters,
  messages,
  viewing,
  swarmMode,
  thoughtTraces,
  hideLifecycleIds,
  newMarkerId,
  findHits,
  findActiveId,
  turnDiffs,
  cloneStartId,
  cloneProgress,
  buildStartId,
  imageProgress,
  waitingGuest,
  waitingStartNote,
  workingOnBlank,
  showTailWorking,
  workingLabel,
  thinkingSnippet,
  lastUserId,
  turning,
  outboundId,
  teamName,
  teamMembers,
  hostChat,
  docker,
  onOpenPath,
  onOpenSubagent,
  onEditLast,
  onRetryLast,
  onCopyText,
  onRemoveSubscription,
}: {
  threadRef: RefObject<HTMLDivElement | null>;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  followLatest: boolean;
  session: AgentSession;
  clusters: ChatCluster[];
  messages: ChatMessage[];
  viewing: SubagentLive | null;
  swarmMode: boolean;
  thoughtTraces: boolean;
  hideLifecycleIds: ReadonlySet<string>;
  newMarkerId?: string;
  findHits: string[];
  findActiveId?: string;
  turnDiffs: ReadonlyMap<string, TurnDiff>;
  cloneStartId?: string;
  cloneProgress?: CloneProgress;
  buildStartId?: string;
  imageProgress?: ImageBuildProgress;
  waitingGuest: boolean;
  waitingStartNote: boolean;
  workingOnBlank?: string;
  showTailWorking: boolean;
  workingLabel: string;
  thinkingSnippet: string;
  lastUserId?: string;
  turning: boolean;
  outboundId?: string;
  teamName?: string;
  teamMembers: AgentSession[];
  hostChat: boolean;
  docker: boolean;
  onOpenPath: (path: string, line?: number) => void;
  onOpenSubagent: (agent: SubagentLive) => void;
  onEditLast: () => void;
  onRetryLast: () => void;
  onCopyText: (value: string) => void;
  onRemoveSubscription: (id: string) => void;
}) {
  const swarmWhoBase = { session, teamName, members: teamMembers };
  const workingWho = swarmMode
    ? swarmChatWho({ ...swarmWhoBase, preferRunning: true })
    : { name: "Agent" as string };
  const findHitSet = useMemo(() => new Set(findHits), [findHits]);
  const heightsRef = useRef(new Map<string, number>());
  const offsetsRef = useRef<number[]>([0]);
  const [sizeTick, setSizeTick] = useState(0);
  const sizes = useMemo(
    () => clusters.map((block) => heightsRef.current.get(block.message.id) ?? CHAT_THREAD_ROW_PX),
    // sizeTick re-reads measured heights after paint; clusters identity covers new rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clusters, sizeTick],
  );
  const [chatWin, setChatWin] = useState<ListWindow>(() =>
    listWindowFromSizes({
      scrollTop: 0,
      clientHeight: 0,
      sizes: clusters.map(() => CHAT_THREAD_ROW_PX),
      stickToEnd: true,
    }),
  );

  function measurePainted(el: HTMLDivElement | null): boolean {
    if (!el) return false;
    const heights = heightsRef.current;
    let changed = false;
    for (const node of el.querySelectorAll<HTMLElement>("[data-thread-row]")) {
      const id = node.getAttribute("data-thread-row");
      if (!id) continue;
      const h = Math.round(node.getBoundingClientRect().height);
      if (h <= 0) continue;
      if (heights.get(id) !== h) {
        heights.set(id, h);
        changed = true;
      }
    }
    return changed;
  }

  function syncChatWindow(el: HTMLDivElement | null, stickToEnd?: boolean) {
    if (!el) return;
    const next = listWindowFromSizes({
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
      sizes,
      stickToEnd: stickToEnd ?? (followLatest || isStuckToBottom(el) || el.clientHeight <= 0),
    });
    setChatWin((current) => {
      if (sameListWindow(current, next)) return current;
      if (current.start === next.start && current.end === next.end) return next;
      return shouldUpdateListWindow(current, next) ? next : current;
    });
  }

  useLayoutEffect(() => {
    heightsRef.current.clear();
    offsetsRef.current = [0];
    setSizeTick((n) => n + 1);
    setChatWin(
      listWindowFromSizes({
        scrollTop: 0,
        clientHeight: 0,
        sizes: clusters.map(() => CHAT_THREAD_ROW_PX),
        stickToEnd: true,
      }),
    );
    // Only reset measurements when switching chats, not on every cluster append.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  useLayoutEffect(() => {
    const el = threadRef.current;
    if (findActiveId) {
      const idx = clusters.findIndex((block) => block.message.id === findActiveId);
      if (el && idx >= 0) {
        const offsets = listSizePrefix(sizes);
        el.scrollTop = Math.max(0, (offsets[idx] ?? 0) - el.clientHeight / 3);
      }
    }
    const prevOffsets = offsetsRef.current;
    const nextOffsets = listSizePrefix(sizes);
    if (
      el &&
      el.clientHeight > 0 &&
      prevOffsets.length > 1 &&
      !followLatest &&
      !isStuckToBottom(el)
    ) {
      const preserved = listPreserveScrollTop(prevOffsets, nextOffsets, el.scrollTop);
      if (Math.abs(preserved - el.scrollTop) > 0.5) el.scrollTop = preserved;
    }
    offsetsRef.current = nextOffsets;
    syncChatWindow(el);
    if (followLatest && !findActiveId) pinThreadToLatest(el);
    if (measurePainted(el)) setSizeTick((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters, sizes, messages.length, session.id, findActiveId, followLatest]);

  useLayoutEffect(() => {
    if (!followLatest || findActiveId) return;
    pinThreadToLatest(threadRef.current);
  }, [followLatest, findActiveId, chatWin.start, chatWin.end, chatWin.height, threadRef]);

  useEffect(() => {
    const el = threadRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (measurePainted(el)) setSizeTick((n) => n + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [session.id, threadRef]);

  const painted = clusters.slice(chatWin.start, chatWin.end);

  return (
    <div className="thread-body">
      <div
        className="thread"
        ref={threadRef}
        onScroll={(event) => {
          const node = event.currentTarget;
          syncChatWindow(node, isStuckToBottom(node) || node.clientHeight <= 0);
          onScroll(event);
        }}
      >
        {messages.length === 0 && !viewing && (
          <p className="chat-empty-hint">
            {swarmMode
              ? "Say hi — ask what they should own, or give them a first task."
              : hostChat
                ? "This chat can read and edit files on this machine."
                : docker
                  ? "This chat runs in a container. Ask it to clone a repo or run commands."
                  : `This chat owns a ${guestLabel(session.os)} desktop.`}
          </p>
        )}
        <div className="list-window-spacer" style={{ height: chatWin.padTop }} />
        {painted.map((block, paintedIndex) => {
          const index = chatWin.start + paintedIndex;
          const blocks = clusters;
          const m = block.message;
          const showNew = !viewing && m.id === newMarkerId;
          if (hideLifecycleIds.has(m.id)) {
            return showNew ? (
              <div key={m.id} className="thread-row" data-thread-row={m.id}>
                <NewMessagesDivider />
              </div>
            ) : null;
          }
          const tools = block.kind === "turn" ? block.tools : [];
          if (
            m.role === "assistant" &&
            isBlankAssistant(m) &&
            !(thoughtTraces && thinkingTraceText(m)) &&
            !tools.length &&
            m.id !== workingOnBlank
          )
            return showNew ? (
              <div key={m.id} className="thread-row" data-thread-row={m.id}>
                <NewMessagesDivider />
              </div>
            ) : null;
          const calls = m.role === "assistant" || m.role === "tool" ? turnToolCalls(m, tools) : [];
          const turnDiff =
            m.role === "assistant" && m.id !== workingOnBlank && !viewing
              ? turnDiffs.get(m.id)
              : undefined;
          const visible = operatorVisibleText(m.role, m.content);
          const leftoverAttaches =
            m.role !== "tool" && m.attachments?.length
              ? leftoverAttachChips(visible || m.content, m.attachments)
              : [];
          const whoInfo =
            m.role === "user"
              ? { name: "You" }
              : m.role === "system"
                ? { name: "Locus" }
                : swarmMode
                  ? swarmChatWho({
                      ...swarmWhoBase,
                      speaker: m.speaker,
                      preferRunning: m.id === workingOnBlank,
                    })
                  : { name: "Agent" };
          const who = whoInfo.name;
          const teamEventLabel = m.teamEvent ? TEAM_EVENT_LABELS[m.teamEvent] : undefined;
          const cloneCard = m.id === cloneStartId && cloneProgress ? cloneProgress : undefined;
          const buildCard = m.id === buildStartId && imageProgress ? imageProgress : undefined;
          const prev = index > 0 ? blocks[index - 1]?.message : undefined;
          const continued =
            swarmMode &&
            prev &&
            !m.compact &&
            !prev.compact &&
            (prev.role === "tool" ? "assistant" : prev.role) ===
              (m.role === "tool" ? "assistant" : m.role) &&
            (prev.speaker?.displayName ?? "") === (m.speaker?.displayName ?? "");
          return (
            <div key={m.id} className="thread-row" data-thread-row={m.id}>
              {showNew ? <NewMessagesDivider /> : null}
              <div
                className={`msg ${m.role === "tool" ? "assistant" : m.role}${m.compact ? " compact" : ""}${m.speaker ? " has-speaker" : ""}${m.teamEvent ? " team-event" : ""}${continued ? " continued" : ""}`}
                data-msg-id={m.id}
                data-team-event={m.teamEvent}
                data-find-hit={findHitSet.has(m.id) ? "true" : undefined}
                data-find-active={findActiveId === m.id ? "true" : undefined}
                data-pending={m.id === outboundId ? "true" : undefined}
              >
                {m.compact || continued ? null : (
                  <div className={`who ${m.id === workingOnBlank ? "working-who" : ""}`}>
                    {whoInfo.speaker ? (
                      <PersonaAvatar
                        avatarId={whoInfo.speaker.avatarId}
                        pose={whoInfo.speaker.avatarPose}
                        accessory={whoInfo.speaker.avatarAccessory}
                        accent={whoInfo.speaker.avatarAccent}
                        size={18}
                      />
                    ) : m.speaker ? (
                      <PersonaAvatar
                        avatarId={m.speaker.avatarId}
                        pose={m.speaker.avatarPose}
                        accessory={m.speaker.avatarAccessory}
                        accent={m.speaker.avatarAccent}
                        size={18}
                      />
                    ) : null}
                    {who}
                    {teamEventLabel ? (
                      <span className="team-event-chip">{teamEventLabel}</span>
                    ) : null}
                    {m.steer ? <span className="steer-chip">Steer</span> : null}
                    {m.role === "user" && visible.trim() ? (
                      <span className="msg-actions">
                        {m.id === lastUserId && !turning && !viewing ? (
                          <>
                            <button type="button" className="btn small ghost" onClick={onEditLast}>
                              Edit
                            </button>
                            <button type="button" className="btn small ghost" onClick={onRetryLast}>
                              Retry
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          className="btn small ghost"
                          title="Copy"
                          onClick={() => onCopyText(visible)}
                        >
                          <IconCopy /> Copy
                        </button>
                      </span>
                    ) : null}
                    {m.role === "assistant" && visible.trim() ? (
                      <span className="msg-actions">
                        <button
                          type="button"
                          className="btn small ghost"
                          title="Copy"
                          onClick={() => onCopyText(visible)}
                        >
                          <IconCopy /> Copy
                        </button>
                      </span>
                    ) : null}
                  </div>
                )}
                {m.id === workingOnBlank ? (
                  <>
                    <WorkingIndicator
                      label={workingLabel}
                      thought={thoughtTraces && !thinkingTraceText(m) ? thinkingSnippet : undefined}
                      ticking
                      resetKey={session.id}
                    />
                    {thoughtTraces ? <ThinkingTrace text={m.thinking ?? ""} live /> : null}
                    {viewing ? null : (
                      <SubagentFold
                        agents={session.subagents?.filter((row) => row.status === "running")}
                        onOpen={onOpenSubagent}
                      />
                    )}
                  </>
                ) : m.role === "tool" ? null : buildCard ? (
                  <ImageBuildCard progress={buildCard} title={m.content} />
                ) : cloneCard ? (
                  <CloneProgressCard progress={cloneCard} title={m.content} />
                ) : m.compact ? (
                  <div className="compact-notice" data-testid="compact-notice">
                    {formatCompactNotice(m.compact)}
                  </div>
                ) : (
                  <>
                    {thoughtTraces ? <ThinkingTrace text={m.thinking ?? ""} /> : null}
                    {visible ? (
                      <SystemOrMarkdown
                        role={m.role}
                        content={visible}
                        liveWait={
                          m.role === "system" &&
                          isGuestStartNote(m.content) &&
                          (waitingGuest || waitingStartNote)
                        }
                      />
                    ) : null}
                  </>
                )}
                {calls.length ? (
                  <ToolActivity
                    sessionId={session.id}
                    calls={calls}
                    tools={tools.length ? tools : m.role === "tool" ? [m] : []}
                    subagents={viewing ? undefined : session.subagents}
                    onOpenPath={onOpenPath}
                    onOpenSubagent={viewing ? undefined : onOpenSubagent}
                  />
                ) : null}
                {m.role !== "tool" && screenshotSrc(session.id, m) ? (
                  <ShotCard sessionId={session.id} message={m} />
                ) : null}
                {leftoverAttaches.length ? (
                  <div className="attach-chips">
                    {leftoverAttaches.map((item) => (
                      <span className="attach-chip" key={item.storedName || item.name}>
                        {item.name}
                      </span>
                    ))}
                  </div>
                ) : null}
                {m.role !== "tool" && m.artifactName ? (
                  <a
                    className="bubble-artifact"
                    href={`/api/sessions/${session.id}/artifacts/${encodeURIComponent(m.artifactName)}${m.artifactKind ? `?kind=${m.artifactKind}` : ""}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {m.artifactName}
                  </a>
                ) : null}
                {m.role !== "tool" && m.recordingName ? (
                  <video
                    className="bubble-recording"
                    controls
                    playsInline
                    src={`/api/sessions/${session.id}/recordings/${encodeURIComponent(m.recordingName)}`}
                  >
                    Guest recording
                  </video>
                ) : null}
                {turnDiff ? (
                  <TurnDiffChip
                    sessionId={session.id}
                    checkpointId={turnDiff.checkpointId}
                    fileCount={turnDiff.fileCount}
                    path={turnDiff.path}
                    line={turnDiff.line}
                    onOpenPath={onOpenPath}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
        <div className="list-window-spacer" style={{ height: chatWin.padBottom }} />
        {session.lastCompact &&
        !messages.some((row) => row.compact && !isHiddenChatMessage(row)) ? (
          <div className="msg system compact">
            <div className="compact-notice" data-testid="compact-notice">
              {formatCompactNotice(session.lastCompact)}
            </div>
          </div>
        ) : null}
        {showTailWorking ? (
          <div className="msg assistant">
            <div className="who working-who">
              {workingWho.speaker ? (
                <PersonaAvatar
                  avatarId={workingWho.speaker.avatarId}
                  pose={workingWho.speaker.avatarPose}
                  accessory={workingWho.speaker.avatarAccessory}
                  accent={workingWho.speaker.avatarAccent}
                  size={18}
                />
              ) : null}
              {workingWho.name}
            </div>
            <WorkingIndicator
              label={workingLabel}
              thought={thoughtTraces ? thinkingSnippet : undefined}
              ticking
              resetKey={session.id}
            />
            {viewing ? null : (
              <SubagentFold
                agents={session.subagents?.filter((row) => row.status === "running")}
                onOpen={onOpenSubagent}
              />
            )}
          </div>
        ) : null}
        {session.taskList?.length && !viewing ? (
          <TaskListCard key={session.id} tasks={session.taskList} />
        ) : null}
        {session.subscriptions?.length && !viewing ? (
          <SubscriptionCard subscriptions={session.subscriptions} onRemove={onRemoveSubscription} />
        ) : null}
      </div>
      <ChatScrollIndicator
        threadRef={threadRef}
        revision={`${session.id}:${clusters.length}:${chatWin.height}:${sizeTick}`}
      />
    </div>
  );
});
