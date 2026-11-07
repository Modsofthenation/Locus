import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  memo,
  type ClipboardEvent,
  type RefObject,
  type UIEvent,
} from "react";
import {
  assetMentionItems,
  canLinkAssetSessions,
  filterHostSessionMentions,
  hostSessionMentionItems,
  insertHostSessionMention,
  canRewind,
  canClearChat,
  CLEAR_CHAT_CONFIRM,
  clusterChatThread,
  configuredGuestOsOptions,
  formatCompactNotice,
  formatUsageHint,
  guestLabel,
  workerComputeUsd,
  isCanvasSession,
  isGameSession,
  isGuestReady,
  isGuestStartNote,
  isGuestStarting,
  isHiddenChatMessage,
  isHumanDriving,
  isWaitingOnGuestStart,
  supersededGuestLifecycleIds,
  formatWaitElapsed,
  localModelWaitHint,
  localModelWaitLabel,
  chatInputError,
  fileMentionQuery,
  fileMentions,
  filterAssetMentions,
  firstOversizeAttachment,
  insertAssetMention,
  type HostSessionMentionItem,
  insertFileMention,
  lastUserMessage,
  latestCloneStartMessageId,
  latestImageBuildStartMessageId,
  CLONE_WAIT_STATUS,
  IMAGE_BUILD_WAIT_STATUS,
  isCloneWaiting,
  isImageBuildWaiting,
  composerOverflowCommands,
  matchSlashMenu,
  mergeSkills,
  operatorVisibleText,
  pendingPromptQueue,
  queueItemBadge,
  rewindTargets,
  resolveAssetMention,
  resolveUsageRates,
  sessionRuntime,
  sessionVision,
  sessionWebSearch,
  sessionLiveChrome,
  skillSlashName,
  summarizeLogBlob,
  turnToolCalls,
  subagentViewMessages,
  subagentStatusLabel,
  findLiveSubagent,
  sessionDefaultSubagent,
  formatSubagentKind,
  thinkingTraceText,
  showThoughtTraces,
  parseAssetMentions,
  parseProductMode,
  parseSessionSurface,
  sessionDisplayName,
  sessionAvatarId,
  sessionAvatarPose,
  sessionAvatarAccessory,
  isProjectSession,
  validateSkill,
  workspaceRelFromToolPath,
  BUILTIN_SLASH_NAMES,
  type AgentSkill,
  type AgentSession,
  type AssetMentionItem,
  type ChatCluster,
  type ChatMessage,
  type CloneProgress,
  type ImageBuildProgress,
  type SlashCommand,
  type SlashMenuItem,
  type SubagentLive,
  type TeamEventKind,
  type TeamSpeaker,
} from "@locus/shared";
import { api, retryEvents } from "@/lib/api";
import { showNotice } from "@/lib/notice";
import { configForSave } from "@/lib/configPersist";
import {
  filesToAttachments,
  filesFromDataTransfer,
  composerFilesFromClipboard,
} from "@/lib/attachments";
import {
  applyComposerChipKey,
  applyComposerPaste,
  leftoverAttachChips,
  splitComposerFiles,
} from "@/lib/composerPaste";
import {
  chatPostBody,
  DROPPED_CHAT_ERROR,
  echoUserMessage,
  outboundPromptLanded,
  recoverDroppedChat,
  resolveComposerIntent,
} from "@/lib/chatTurn";
import { CHAT_RECOVERY_TIMEOUT_MS } from "@/lib/net";
import { turnDiffByAssistantId } from "@/lib/artifacts";
import { saveLastAgent } from "@/lib/lastAgent";
import { formatMarkdown } from "@/lib/markdown";
import { chatFindHits, stepChatFindIndex } from "@/lib/chatFind";
import { isStuckToBottom, pinThreadToLatest, schedulePinThreadToLatest } from "@/lib/threadScroll";
import {
  listPreserveScrollTop,
  listSizePrefix,
  listWindowFromSizes,
  sameListWindow,
  shouldUpdateListWindow,
  type ListWindow,
} from "@/lib/listWindow";
import { visitMarkerId } from "@/lib/chatNewMarker";
import { openSettings, useStore } from "@/state/store";
import { TurnDiffChip } from "./ArtifactDrawer";
import { ExpandableLog } from "./ExpandableLog";
import { CompareBanner } from "./CompareBanner";
import { FeatureNudge } from "@/components/layout/FeatureNudge";
import { ConfirmModal } from "@/components/layout/ConfirmModal";
import {
  readLiveComposerDraft as readDraft,
  resetComposerDrafts,
  writeLiveComposerDraft as writeDraft,
} from "@/lib/composerDrafts";
import { screenshotSrc } from "./GuestTimeline";
import { ShotCard, ToolActivity } from "./ChatToolActivity";
import { SubagentFold } from "./SubagentCard";
import {
  IconClose,
  IconCopy,
  IconPlay,
  IconReturn,
  IconSend,
  IconStop,
  IconMore,
} from "@/components/layout/Icons";
import { SearchField } from "@/components/layout/SearchField";
import {
  ComposerAddButton,
  ComposerFileThumbs,
  ComposerTextarea,
  mergeComposerFiles,
} from "./ComposerFiles";
import { ModelPicker } from "@/components/settings/ModelPicker";
import { SubagentPicker } from "./SubagentPicker";
import { ContextMeter } from "./ContextMeter";
import { PlanCard } from "./PlanCard";
import { MenuItem, MenuSep, OverflowMenu } from "@/components/layout/OverflowMenu";
import { SlashMenu } from "./SlashMenu";
import { FileMentionMenu } from "./FileMentionMenu";
import { AssetMentionMenu } from "./AssetMentionMenu";
import { TeammateMentionMenu } from "./TeammateMentionMenu";
import {
  filterTeammateMentions,
  insertTeammateMention,
  teammateMentionItems,
  type TeammateMentionItem,
} from "@/lib/teammateMention";
import { TaskListCard } from "./TaskListCard";
import { SubscriptionCard } from "./SubscriptionCard";
import { Mascot } from "@/components/layout/Mascot";
import { PersonaAvatar } from "@/components/layout/PersonaAvatar";
import { TrustActions } from "./TrustActions";
import { CloneProgressCard, ImageBuildCard } from "./CloneProgressCard";
import { ThinkingTrace } from "./ThinkingTrace";
import { ChatScrollIndicator } from "./ChatScrollIndicator";
import { NewMessagesDivider } from "./NewMessagesDivider";

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

function forgetDraft(id: string | undefined) {
  writeDraft(id, { text: "", files: [] }, "clear");
}

export { resetComposerDrafts };

export function ChatPane() {
  const { state, dispatch } = useStore();
  const session = state.sessions.find((s) => s.id === state.selectedId);
  const swarmMode =
    parseProductMode(state.config?.productMode) === "swarm" ||
    parseSessionSurface(session?.surface) === "swarm";
  const thoughtTraces = showThoughtTraces({
    surface: session?.surface,
    productMode: state.config?.productMode,
  });
  const sessionId = session?.id;
  const [text, setText] = useState(() => readDraft(sessionId).text);
  const [busy, setBusy] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const turnAction = useRef(false);
  const stickToBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [recording, setRecording] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [mentionHits, setMentionHits] = useState<import("@/lib/api").WorkspaceIndexHit[]>([]);
  const [teammateHits, setTeammateHits] = useState<TeammateMentionItem[]>([]);
  const [assetHits, setAssetHits] = useState<Array<AssetMentionItem | HostSessionMentionItem>>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [repoSkills, setRepoSkills] = useState<AgentSkill[]>([]);
  const [files, setFiles] = useState<File[]>(() => readDraft(sessionId).files);
  const [sendError, setSendError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    null | { kind: "undo"; checkpointId?: string } | { kind: "clear" }
  >(null);
  const [outbound, setOutbound] = useState<ChatMessage | null>(null);
  const [openSubagent, setOpenSubagent] = useState<SubagentLive | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const findInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef({ text: "", files: [] as File[] });
  const prevSessionId = useRef<string | undefined>(undefined);
  const allowEmptyDraftWrite = useRef(false);
  const actionRefs = useRef({
    editLast: () => {},
    retryLast: () => {},
    copyText: (_value: string) => {},
  });
  const onEditLast = useCallback(() => {
    actionRefs.current.editLast();
  }, []);
  const onRetryLast = useCallback(() => {
    actionRefs.current.retryLast();
  }, []);
  const onCopyText = useCallback((value: string) => {
    actionRefs.current.copyText(value);
  }, []);
  const onThreadScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const stuck = isStuckToBottom(event.currentTarget);
    stickToBottom.current = stuck;
    setShowJump(!stuck);
  }, []);
  const onOpenPath = useCallback(
    (path: string, line?: number) => {
      const id = state.selectedId;
      if (!id) return;
      const current = state.sessions.find((row) => row.id === id);
      const clean = workspaceRelFromToolPath(path, current?.hostDir);
      if (!clean) return;
      dispatch({
        type: "openWorkspace",
        open: { sessionId: id, path: clean, line, follow: true, at: Date.now() },
      });
    },
    [dispatch, state.selectedId, state.sessions],
  );

  const storedMessages = session?.messages ?? [];
  const liveSubagent = openSubagent
    ? findLiveSubagent(session?.subagents, openSubagent)
    : undefined;
  const viewing = liveSubagent ?? openSubagent ?? null;
  const outboundVisible =
    viewing || !(outbound && session && !outboundPromptLanded(session, outbound)) ? null : outbound;
  const messages = viewing
    ? subagentViewMessages(viewing)
    : outboundVisible
      ? [...storedMessages, outboundVisible]
      : storedMessages;
  const cloneStartId = viewing ? undefined : latestCloneStartMessageId(messages);
  const cloneProgress = session ? state.cloneProgress[session.id] : undefined;
  const waitingClone = !viewing && isCloneWaiting(cloneProgress);
  const buildStartId = viewing ? undefined : latestImageBuildStartMessageId(messages);
  const imageProgress = session ? state.imageProgress[session.id] : undefined;
  const waitingBuild = !viewing && isImageBuildWaiting(imageProgress);
  const queue = pendingPromptQueue(session?.queue, lastUserMessage(storedMessages)?.content);
  const vm = state.vms.find((v) => v.id === session?.vmId);
  const turning = viewing ? viewing.status === "running" : busy || session?.status === "running";
  const waitingGuest =
    !viewing &&
    (isGuestStarting(vm?.status) ||
      (session?.status === "provisioning" && !isGuestReady(vm?.status)));
  const waitingStartNote = Boolean(!viewing && session && isWaitingOnGuestStart(messages));
  draftRef.current = { text, files };
  const turnDiffs = useMemo(
    () => (session && !viewing ? turnDiffByAssistantId(session) : new Map()),
    [session, viewing],
  );

  function pinToLatest() {
    stickToBottom.current = true;
    setShowJump(false);
    pinThreadToLatest(thread.current);
    schedulePinThreadToLatest(thread.current);
  }

  const findHits = useMemo(() => chatFindHits(messages, findQuery), [messages, findQuery]);
  const threadClusters = useMemo(
    () => clusterChatThread(messages.filter((row) => !isHiddenChatMessage(row))),
    [messages],
  );
  const teamMembers = useMemo(() => {
    if (!session?.projectId) return [];
    const project = state.projects.find((row) => row.id === session.projectId);
    const ids = new Set(
      [
        ...(project?.memberIds ?? []),
        ...state.sessions.filter((row) => row.projectId === session.projectId).map((row) => row.id),
      ].filter((id): id is string => typeof id === "string" && id.length > 0),
    );
    ids.delete(session.id);
    return state.sessions.filter((row) => ids.has(row.id));
  }, [session, state.projects, state.sessions]);
  const teamName = useMemo(() => {
    if (!session?.projectId) return undefined;
    const project = state.projects.find((row) => row.id === session.projectId);
    return project?.teamName?.trim() || project?.title?.trim();
  }, [session?.projectId, state.projects]);
  const onRemoveSubscription = useCallback(
    (id: string) => {
      const current = state.sessions.find((row) => row.id === state.selectedId);
      if (!current) return;
      const next = (current.subscriptions ?? []).filter((row) => row.id !== id);
      void api
        .patchSession(current.id, { subscriptions: next.length ? next : null })
        .then((updated) => dispatch({ type: "session", session: updated }));
    },
    [dispatch, state.selectedId, state.sessions],
  );
  const hideLifecycleIds = useMemo(() => supersededGuestLifecycleIds(messages), [messages]);
  const findActiveId = findHits[Math.min(findIndex, Math.max(0, findHits.length - 1))];
  const newMarkerId = visitMarkerId(state.chatNewVisit, sessionId);

  useEffect(() => {
    setFindOpen(false);
    setFindQuery("");
    setFindIndex(0);
  }, [sessionId]);

  useEffect(() => {
    if (storedMessages.length > 0) return;
    setOutbound(null);
    setOpenSubagent(null);
  }, [sessionId, storedMessages.length]);

  useEffect(() => {
    setFindIndex(0);
  }, [findQuery]);

  useEffect(() => {
    if (!findOpen || !findActiveId) return;
    stickToBottom.current = false;
    const node = thread.current?.querySelector(`[data-msg-id="${findActiveId}"]`);
    if (node && "scrollIntoView" in node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "center" });
    }
  }, [findOpen, findActiveId, findIndex]);

  useLayoutEffect(() => {
    const el = thread.current;
    if (!el || !stickToBottom.current || findOpen) return;
    pinThreadToLatest(el);
  }, [messages, sessionId, turning, findOpen]);

  useEffect(() => {
    if (outbound && session && outboundPromptLanded(session, outbound)) setOutbound(null);
  }, [outbound, session]);

  useEffect(() => {
    const textarea = box.current;
    const prev = prevSessionId.current;
    if (prev && prev !== sessionId) writeDraft(prev, draftRef.current, "clear");
    const restored = readDraft(sessionId);
    setText(restored.text);
    setFiles(restored.files);
    setRecording(false);
    setPlanning(false);
    setSendError(null);
    setOutbound(null);
    setOpenSubagent(null);
    prevSessionId.current = sessionId;
    allowEmptyDraftWrite.current = false;
    return () => {
      const live = textarea?.value;
      const current =
        typeof live === "string" ? { ...draftRef.current, text: live } : draftRef.current;
      draftRef.current = current;
      // Strict Mode remounts with empty state first; never wipe a stored draft on unmount.
      writeDraft(prevSessionId.current, current, "keep");
    };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    if (text || files.length) {
      allowEmptyDraftWrite.current = true;
      writeDraft(sessionId, { text, files }, "keep");
      return;
    }
    if (!allowEmptyDraftWrite.current) return;
    writeDraft(sessionId, { text, files }, "clear");
  }, [sessionId, text, files]);

  useLayoutEffect(() => {
    stickToBottom.current = true;
    setShowJump(false);
    return schedulePinThreadToLatest(thread.current);
  }, [sessionId]);

  const prevClearCount = useRef({ id: undefined as string | undefined, n: 0 });
  useEffect(() => {
    if (!sessionId) {
      prevClearCount.current = { id: undefined, n: 0 };
      return;
    }
    const n = session?.messages.length ?? 0;
    const prev = prevClearCount.current;
    if (prev.id !== sessionId) {
      prevClearCount.current = { id: sessionId, n };
      return;
    }
    if (prev.n > 0 && n === 0) {
      forgetDraft(sessionId);
      setText("");
      setFiles([]);
      setOutbound(null);
      setOpenSubagent(null);
    }
    prevClearCount.current = { id: sessionId, n };
  }, [sessionId, session?.messages.length]);

  useEffect(() => {
    if (!sessionId) {
      setRepoSkills([]);
      return;
    }
    void api
      .sessionSkills(sessionId)
      .then(setRepoSkills)
      .catch(() => setRepoSkills([]));
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || text.startsWith("/")) {
      setMentionHits([]);
      setTeammateHits([]);
      setAssetHits([]);
      return;
    }
    const caret = box.current?.selectionStart ?? text.length;
    const query = fileMentionQuery(text, caret);
    if (!query) {
      setMentionHits([]);
      setTeammateHits([]);
      setAssetHits([]);
      return;
    }
    const project = state.projects.find((row) => row.id === session?.projectId);
    const teammates = session
      ? filterTeammateMentions(
          teammateMentionItems({
            session,
            sessions: state.sessions,
            project,
          }),
          query.query,
        )
      : [];
    const looksLikePath = /[./]/.test(query.query);
    const assets =
      session && !looksLikePath
        ? filterAssetMentions(assetMentionItems({ session, sessions: state.sessions }), query.query)
        : [];
    const hostPeers =
      session && !looksLikePath
        ? filterHostSessionMentions(
            hostSessionMentionItems({ session, sessions: state.sessions }),
            query.query,
          )
        : [];
    const mentions = [
      ...assets,
      ...hostPeers.filter((row) => !assets.some((asset) => asset.id === row.id)),
    ];
    if (teammates.length && !looksLikePath) {
      setTeammateHits(teammates);
      setAssetHits([]);
      setMentionHits([]);
      setMentionIndex(0);
      return;
    }
    if (mentions.length) {
      setAssetHits(mentions);
      setTeammateHits([]);
      setMentionHits([]);
      setMentionIndex(0);
      return;
    }
    setAssetHits([]);
    setTeammateHits(looksLikePath ? [] : teammates);
    if (typeof api.workspaceSearch !== "function") {
      setMentionHits([]);
      return;
    }
    const token = query.query;
    const timer = window.setTimeout(
      () => {
        void api
          .workspaceSearch(sessionId, token, 12)
          .then((res) => {
            setMentionHits(res.items ?? []);
            setMentionIndex(0);
          })
          .catch(() => setMentionHits([]));
      },
      token ? 80 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [sessionId, text, session, state.projects, state.sessions]);

  useEffect(() => {
    if (state.composerDraft == null) return;
    const incoming = state.composerDraft;
    setText((current) => {
      if (!current.trim()) return incoming;
      if (current.includes(incoming.trim())) return current;
      const spacer = current.endsWith(" ") || current.endsWith("\n") ? "" : " ";
      return `${current}${spacer}${incoming}`;
    });
    dispatch({ type: "compose", text: null });
    box.current?.focus();
  }, [state.composerDraft, dispatch]);

  useEffect(() => {
    if (!state.findChatOpen) return;
    setFindOpen(true);
    dispatch({ type: "findChat", open: false });
    queueMicrotask(() => findInput.current?.focus());
  }, [state.findChatOpen, dispatch]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "f") {
        if (event.shiftKey) return;
        if (event.target instanceof Element && event.target.closest(".workspace-editor")) return;
        event.preventDefault();
        setFindOpen(true);
        queueMicrotask(() => findInput.current?.focus());
        return;
      }
      if (event.key === "Escape" && findOpen) {
        event.preventDefault();
        setFindOpen(false);
        setFindQuery("");
        return;
      }
      if (event.key !== "Escape" || !openSubagent) return;
      setOpenSubagent(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openSubagent, findOpen]);

  async function send() {
    if (!session || viewing || sending.current) return;
    const intent = resolveComposerIntent({
      text,
      fileCount: files.length,
      turning,
      planning,
      runtime: sessionRuntime(session),
      skills: mergeSkills(state.config?.skills, repoSkills),
    });
    if (intent.kind === "noop") return;
    pinToLatest();
    const pending = files;
    setText("");
    setFiles([]);
    forgetDraft(session.id);
    if (intent.kind === "plan-mode") {
      setPlanning(true);
      return;
    }
    if (intent.kind === "slash") {
      await runSlash(intent.command);
      return;
    }
    if (intent.kind === "skill") {
      setPlanning(false);
      await sendChat(intent.prompt, false, intent.skillName);
      return;
    }
    if (intent.kind === "plan-task") {
      await sendChat(intent.task, true);
      return;
    }
    setPlanning(false);
    await sendChat(intent.content, intent.plan, undefined, pending, intent.steer);
  }

  async function queueFollowup() {
    if (!session || sending.current || (!text.trim() && !files.length) || !turning) return;
    pinToLatest();
    const content = text;
    const asPlan = planning;
    const pending = files;
    setText("");
    setFiles([]);
    forgetDraft(session.id);
    setPlanning(false);
    await sendChat(content, asPlan, undefined, pending, false, false);
  }

  async function sendChat(
    content: string,
    plan?: boolean,
    skill?: string,
    pending: File[] = [],
    steer = false,
    echo = true,
  ) {
    if (!session || sending.current) return;
    const cap = chatInputError(content, pending.length);
    if (cap) {
      setSendError(cap);
      return;
    }
    sending.current = true;
    setBusy(true);
    setSendError(null);
    if (echo) setOutbound(echoUserMessage(content, { steer, files: pending }));
    try {
      const attachments = pending.length ? await filesToAttachments(pending) : undefined;
      const mentioned = fileMentions(content)[0];
      const focusPath =
        mentioned ??
        (state.workspaceFocus?.sessionId === session.id ? state.workspaceFocus.path : undefined);
      const assetRefs = parseAssetMentions(content)
        .map((slug) => resolveAssetMention(slug, state.sessions)?.id)
        .filter((id): id is string => Boolean(id));
      await api.chat(
        session.id,
        content,
        chatPostBody({
          plan,
          skill,
          steer,
          attachments,
          focusPath,
          assetRefs: assetRefs.length ? assetRefs : undefined,
        }),
      );
    } catch {
      let fresh: Awaited<ReturnType<typeof api.session>> | null = null;
      try {
        fresh = await api.session(session.id, { timeoutMs: CHAT_RECOVERY_TIMEOUT_MS });
        dispatch({ type: "session", session: fresh });
      } catch {
        /* control plane is unreachable too */
      }
      if (recoverDroppedChat(fresh, content) === "restore") {
        setOutbound(null);
        setText(content);
        setFiles(pending);
        if (plan) setPlanning(true);
        setSendError(DROPPED_CHAT_ERROR);
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function pickMention(path: string) {
    const caret = box.current?.selectionStart ?? text.length;
    const next = insertFileMention(text, caret, path);
    setText(next.text);
    setMentionHits([]);
    setTeammateHits([]);
    setAssetHits([]);
    queueMicrotask(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = next.cursor;
    });
  }

  function pickTeammateMention(token: string) {
    const caret = box.current?.selectionStart ?? text.length;
    const next = insertTeammateMention(text, caret, token);
    setText(next.text);
    setTeammateHits([]);
    setMentionHits([]);
    setAssetHits([]);
    queueMicrotask(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = next.cursor;
    });
  }

  function pickAssetMention(item: AssetMentionItem | HostSessionMentionItem) {
    const caret = box.current?.selectionStart ?? text.length;
    const query = fileMentionQuery(text, caret);
    const next = item.token.startsWith("asset:")
      ? insertAssetMention(text, caret, item.token.replace(/^asset:/, ""), query)
      : insertHostSessionMention(text, caret, item.token, query);
    setText(next.text);
    setAssetHits([]);
    setMentionHits([]);
    setTeammateHits([]);
    queueMicrotask(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = next.cursor;
    });
  }

  function pickSlash(item: SlashMenuItem) {
    pinToLatest();
    if (item.kind === "command") {
      setText("");
      forgetDraft(sessionId);
      void runSlash(item.command);
      return;
    }
    const name = skillSlashName(item.skill.name);
    if (!name) return;
    setText(`/${name} `);
    setPlanning(false);
  }

  async function runSlash(command: SlashCommand) {
    if (!session) return;
    try {
      if (command.id === "takeover") await api.takeover(session.id);
      else if (command.id === "handback") await api.handback(session.id);
      else if (command.id === "undo") setConfirmAction({ kind: "undo" });
      else if (command.id === "fork") {
        const forked = await api.fork(session.id);
        dispatch({ type: "session", session: forked });
        dispatch({ type: "select", id: forked.id });
      } else if (command.id === "clear") {
        setConfirmAction({ kind: "clear" });
      } else if (command.id === "workers") {
        const workers = await api.spawnWorkers(session.id, { count: 3 });
        for (const worker of workers) dispatch({ type: "session", session: worker });
        try {
          dispatch({ type: "session", session: await api.session(session.id) });
        } catch {
          /* hub session.updated still refreshes the parent banner */
        }
      } else if (command.id === "record") {
        if (recording) {
          await api.execTool(session.id, "record_screen", {
            mode: "SAVE_RECORDING",
            save_as_filename: `slash-${Date.now()}`,
          });
          setRecording(false);
        } else {
          await api.execTool(session.id, "record_screen", { mode: "START_RECORDING" });
          setRecording(true);
        }
      } else if (command.id === "vision") {
        const next = sessionVision(session) === "latest" ? "off" : "latest";
        const updated = await api.patchSession(session.id, { vision: next });
        dispatch({ type: "session", session: updated });
      } else if (command.id === "websearch") {
        const updated = await api.patchSession(session.id, {
          webSearch: !sessionWebSearch(session),
        });
        dispatch({ type: "session", session: updated });
      } else if (command.id === "chrome") {
        const updated = await api.patchSession(session.id, {
          liveChrome: !sessionLiveChrome(session),
        });
        dispatch({ type: "session", session: updated });
      } else if (command.id === "roles") {
        const updated = await api.cycleRole(session.id);
        dispatch({ type: "session", session: updated });
      } else if (command.id === "plan") {
        setPlanning(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Command failed";
      setSendError(message);
      showNotice(message);
    }
  }

  async function stop() {
    if (!session) return;
    await api.abortChat(session.id).catch(() => undefined);
    setBusy(false);
    sending.current = false;
  }

  async function dismissNeedsYou() {
    if (!session) return;
    try {
      const updated = await api.patchSession(session.id, { needsHuman: null });
      dispatch({ type: "session", session: updated });
    } catch {
      /* keep banner */
    }
  }

  async function undo(checkpointId?: string) {
    if (!session) return;
    sending.current = true;
    setBusy(true);
    try {
      const updated = await api.rewind(session.id, checkpointId);
      dispatch({ type: "session", session: updated });
    } finally {
      setBusy(false);
      sending.current = false;
    }
  }

  async function clearChat() {
    if (!session || !canClearChat(session)) return;
    sending.current = true;
    setBusy(true);
    try {
      const updated = await api.clearChat(session.id);
      forgetDraft(session.id);
      setText("");
      setFiles([]);
      setOutbound(null);
      setOpenSubagent(null);
      dispatch({ type: "session", session: updated });
    } finally {
      setBusy(false);
      sending.current = false;
    }
  }

  async function saveAsSkill() {
    if (!session || !state.config) return;
    const user = [...session.messages].reverse().find((row) => row.role === "user");
    const assistant = [...session.messages]
      .reverse()
      .find((row) => row.role === "assistant" && row.content.trim());
    if (!user?.content.trim()) {
      showNotice("Send a prompt first, then save it as a skill.");
      return;
    }
    const suggested =
      skillSlashName(
        sessionDisplayName(session)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-"),
      ) ?? "workflow";
    const rawName = window.prompt("Skill slash name (letters, numbers, dashes)", suggested);
    if (rawName == null) return;
    const name = skillSlashName(rawName);
    if (!name) {
      showNotice("Skill slash name must be /name (letters, numbers, dashes).");
      return;
    }
    const title = window.prompt("Skill title", name)?.trim() || name;
    const body = [
      assistant?.content.trim() ? `## How we did it\n\n${assistant.content.trim()}` : "",
      `## Task\n\n${user.content.trim()}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const skill: AgentSkill = {
      id: crypto.randomUUID(),
      name,
      title,
      hint: `Saved from ${sessionDisplayName(session)}`,
      body,
      enabled: true,
    };
    const existing = state.config.skills ?? [];
    const error = validateSkill(skill, existing, BUILTIN_SLASH_NAMES);
    if (error) {
      showNotice(error);
      return;
    }
    try {
      const saved = await api.saveConfig(
        configForSave({ ...state.config, skills: [...existing, skill] }),
      );
      dispatch({ type: "config", config: saved });
      showNotice(`Saved /${name}. Type /${name} in the composer to run it.`);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "Could not save skill");
    }
  }

  async function editLast() {
    const last = lastUserMessage(session?.messages ?? []);
    if (!last || !session || turnAction.current) return;
    turnAction.current = true;
    pinToLatest();
    try {
      if (canRewind(session)) await undo();
      setText(last.content);
      box.current?.focus();
    } finally {
      turnAction.current = false;
    }
  }

  async function retryLast() {
    const last = lastUserMessage(session?.messages ?? []);
    if (!last || !session || turnAction.current) return;
    turnAction.current = true;
    pinToLatest();
    try {
      if (canRewind(session)) await undo();
      await sendChat(last.content);
    } finally {
      turnAction.current = false;
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  actionRefs.current.editLast = () => {
    void editLast();
  };
  actionRefs.current.retryLast = () => {
    void retryLast();
  };
  actionRefs.current.copyText = (value) => {
    void copyText(value);
  };

  if (!session) return null;
  const hostChat = sessionRuntime(session) === "host";
  const docker = sessionRuntime(session) === "docker";
  const provider = state.config?.providers.find((p) => p.id === session.providerId);
  const lastUsage =
    [...session.messages].reverse().find((m) => m.role === "assistant" && m.usage)?.usage ??
    session.usage;
  const worker = (state.config?.workers ?? []).find((row) => row.id === session.backendId);
  const usageHint = formatUsageHint(
    lastUsage,
    resolveUsageRates(provider, session.model),
    workerComputeUsd(session, worker),
  );
  const lastUser = lastUserMessage(messages);
  const last = messages[messages.length - 1];
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const workingOnBlank =
    turning && lastAssistant && isBlankAssistant(lastAssistant) && last?.id === lastAssistant.id
      ? lastAssistant.id
      : undefined;
  const showTailWorking =
    ((waitingClone || waitingBuild || waitingGuest || waitingStartNote) && !workingOnBlank) ||
    (turning &&
      !workingOnBlank &&
      (isCanvasSession(session) || (!hasOpenTool(messages) && last?.role !== "assistant")));
  const liveThought = viewing
    ? viewing.status === "running"
      ? (viewing.lastLine ?? "")
      : ""
    : turning
      ? (state.thinking[session.id] ?? "")
      : "";
  const localWaitLabel =
    !viewing &&
    turning &&
    !waitingGuest &&
    !waitingStartNote &&
    !waitingClone &&
    !waitingBuild &&
    !liveThought
      ? localModelWaitLabel(provider)
      : undefined;
  const workingLabel = viewing
    ? "Working…"
    : waitingBuild
      ? IMAGE_BUILD_WAIT_STATUS
      : waitingGuest || waitingStartNote
        ? "Waiting for the guest…"
        : waitingClone
          ? CLONE_WAIT_STATUS
          : liveThought && thoughtTraces
            ? "Thinking…"
            : localWaitLabel
              ? localWaitLabel
              : isCanvasSession(session)
                ? "Working on the canvas…"
                : "Working…";
  const thinkingSnippet = thoughtTraces
    ? liveThought || (localWaitLabel ? (localModelWaitHint(provider) ?? "") : "")
    : "";
  const composerWorking =
    turning && !waitingGuest && !waitingStartNote && !waitingClone && !waitingBuild
      ? liveThought && thoughtTraces
        ? "Thinking…"
        : (localWaitLabel ?? "Agent is working")
      : null;

  return (
    <section className="chat" id="chat-pane" tabIndex={-1}>
      {state.setup && !state.setup.hasProvider ? (
        <div className="net-banner warn" role="status" data-testid="demo-mode-banner">
          Demo mode — replies are simulated until you add a provider.
          <button
            type="button"
            className="btn small ghost"
            onClick={() => openSettings(dispatch, "providers")}
          >
            Set up provider
          </button>
        </div>
      ) : null}
      {(!state.connected || sendError) && (
        <div className="net-banners">
          {!state.connected && (
            <div className="net-banner" role="status">
              Reconnecting… missed chat will catch up when the link is back.
              <button
                type="button"
                className="btn small ghost"
                data-testid="retry-events"
                onClick={() => retryEvents()}
              >
                Retry now
              </button>
            </div>
          )}
          {sendError && (
            <div className="net-banner warn" role="alert">
              {sendError}
              <button
                type="button"
                className="btn small ghost"
                data-testid="retry-send"
                onClick={() => {
                  if (text.trim() || files.length) void send();
                  else void retryLast();
                }}
              >
                Retry send
              </button>
            </div>
          )}
        </div>
      )}
      {viewing ? null : <CompareBanner session={session} />}
      {viewing ? null : <FeatureNudge session={session} />}
      {viewing ? (
        <div className="subagent-banner" data-testid="subagent-banner">
          <button type="button" className="btn small ghost" onClick={() => setOpenSubagent(null)}>
            Back
          </button>
          <span className="subagent-banner-copy">
            <strong>{formatSubagentKind(viewing.kind ?? "explore")} subagent</strong>
            <span>{viewing.task}</span>
          </span>
          <span className="subagent-banner-status" data-status={viewing.status}>
            {subagentStatusLabel(viewing.status)}
          </span>
        </div>
      ) : null}
      {session.needsHuman?.trim() && !viewing ? (
        <div className="needs-you-banner" role="status">
          <span>Needs you — {session.needsHuman.trim()}</span>
          <button type="button" className="btn small ghost" onClick={() => void dismissNeedsYou()}>
            Dismiss
          </button>
        </div>
      ) : null}
      <div className="thread-wrap">
        {findOpen ? (
          <div className="chat-find" role="search">
            <SearchField
              ref={findInput}
              className="search"
              wrapClassName="chat-find-wrap"
              value={findQuery}
              placeholder="Find in chat"
              aria-label="Find in chat"
              onChange={(event) => setFindQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (!findHits.length) return;
                setFindIndex((current) =>
                  stepChatFindIndex(findHits.length, current, event.shiftKey ? -1 : 1),
                );
              }}
            />
            {findQuery.trim() ? (
              <span className="chat-find-count">
                {findHits.length
                  ? `${Math.min(findIndex, findHits.length - 1) + 1} of ${findHits.length}`
                  : "No matches"}
              </span>
            ) : null}
            <button
              type="button"
              className="btn small ghost"
              disabled={!findHits.length}
              onClick={() =>
                setFindIndex((current) => stepChatFindIndex(findHits.length, current, -1))
              }
            >
              Prev
            </button>
            <button
              type="button"
              className="btn small ghost"
              disabled={!findHits.length}
              onClick={() =>
                setFindIndex((current) => stepChatFindIndex(findHits.length, current, 1))
              }
            >
              Next
            </button>
            <button
              type="button"
              className="btn icon ghost small"
              aria-label="Close find"
              onClick={() => {
                setFindOpen(false);
                setFindQuery("");
              }}
            >
              <IconClose />
            </button>
          </div>
        ) : null}
        <ChatThread
          threadRef={thread}
          onScroll={onThreadScroll}
          followLatest={!showJump && !findOpen}
          session={session}
          clusters={threadClusters}
          messages={messages}
          viewing={viewing}
          swarmMode={swarmMode}
          thoughtTraces={thoughtTraces}
          hideLifecycleIds={hideLifecycleIds}
          newMarkerId={newMarkerId}
          findHits={findHits}
          findActiveId={findActiveId}
          turnDiffs={turnDiffs}
          cloneStartId={cloneStartId}
          cloneProgress={cloneProgress}
          buildStartId={buildStartId}
          imageProgress={imageProgress}
          waitingGuest={waitingGuest}
          waitingStartNote={waitingStartNote}
          workingOnBlank={workingOnBlank}
          showTailWorking={showTailWorking}
          workingLabel={workingLabel}
          thinkingSnippet={thinkingSnippet}
          lastUserId={lastUser?.id}
          turning={turning}
          outboundId={outboundVisible?.id}
          teamName={teamName}
          teamMembers={teamMembers}
          hostChat={hostChat}
          docker={docker}
          onOpenPath={onOpenPath}
          onOpenSubagent={setOpenSubagent}
          onEditLast={onEditLast}
          onRetryLast={onRetryLast}
          onCopyText={onCopyText}
          onRemoveSubscription={onRemoveSubscription}
        />
        {showJump ? (
          <button
            type="button"
            className="jump-latest"
            data-testid="jump-latest"
            onClick={() => pinToLatest()}
          >
            Jump to latest
          </button>
        ) : null}
      </div>
      {viewing ? (
        <div className="composer-wrap">
          <div className="subagent-readonly" data-testid="subagent-readonly">
            <p>This subagent is read-only. You can&apos;t send messages here.</p>
            <button type="button" className="btn small" onClick={() => setOpenSubagent(null)}>
              Back to parent
            </button>
          </div>
        </div>
      ) : (
        <div className="composer-wrap">
          {session.plan ? <PlanCard session={session} /> : null}
          {planning ? (
            <p className="plan-arm" data-testid="plan-arm">
              Plan mode — describe the task. The agent will outline steps; you hit Run.
            </p>
          ) : null}
          {queue.length > 0 && (
            <div className="prompt-queue" aria-label="Queued prompts">
              {session.queuePaused ? (
                <div className="prompt-queue-head">
                  <span>Queue paused after Stop</span>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() =>
                      void api
                        .patchSession(session.id, { queuePaused: false })
                        .then((updated) => dispatch({ type: "session", session: updated }))
                        .catch(() => undefined)
                    }
                  >
                    <IconPlay /> Resume
                  </button>
                </div>
              ) : null}
              {queue.map((item) => (
                <div className="prompt-queue-item" key={item.id}>
                  {queueItemBadge(item) ? <em>{queueItemBadge(item)}</em> : null}
                  <span title={item.text}>{item.text}</span>
                  <div className="prompt-queue-actions">
                    <button
                      type="button"
                      className="btn icon ghost"
                      title={
                        turning ? "Send now — interrupt this turn and run this prompt" : "Send now"
                      }
                      aria-label="Send now"
                      onClick={() => {
                        void api
                          .sendQueueNow(session.id, item.id)
                          .then((updated) => {
                            setSendError(null);
                            dispatch({ type: "session", session: updated });
                          })
                          .catch((err: unknown) => {
                            setSendError(
                              err instanceof Error
                                ? err.message
                                : "Couldn't send the queued prompt now.",
                            );
                          });
                      }}
                    >
                      <IconSend />
                    </button>
                    <button
                      type="button"
                      className="btn icon ghost"
                      title="Remove from queue"
                      aria-label="Remove from queue"
                      onClick={() => {
                        const next = queue.filter((row) => row.id !== item.id);
                        void api
                          .patchSession(session.id, { queue: next.length ? next : null })
                          .then((updated) => dispatch({ type: "session", session: updated }))
                          .catch((err: unknown) => {
                            setSendError(
                              err instanceof Error
                                ? err.message
                                : "Couldn't remove the queued prompt.",
                            );
                          });
                      }}
                    >
                      <IconClose />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div
            className="composer"
            onDragOver={(event) => {
              if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
            }}
            onDrop={(event) => {
              const incoming = filesFromDataTransfer(event.dataTransfer);
              if (!incoming.length) return;
              event.preventDefault();
              const oversize = firstOversizeAttachment(incoming);
              if (oversize) {
                setSendError(oversize);
                return;
              }
              setSendError(null);
              setFiles((rows) => mergeComposerFiles(rows, incoming));
            }}
            onPaste={(event: ClipboardEvent<HTMLDivElement>) => {
              const incoming = composerFilesFromClipboard(
                event.clipboardData,
                files.map((file) => file.name),
              );
              if (!incoming.length) return;
              event.preventDefault();
              const oversize = firstOversizeAttachment(incoming);
              if (oversize) {
                setSendError(oversize);
                return;
              }
              setSendError(null);
              const el = box.current;
              const current = el?.value ?? text;
              const caret = el?.selectionStart ?? current.length;
              const next = applyComposerPaste(
                current,
                caret,
                files,
                incoming,
                el?.selectionEnd ?? caret,
              );
              setText(next.text);
              setFiles(next.files);
              queueMicrotask(() => {
                const el = box.current;
                if (!el) return;
                el.focus();
                el.selectionStart = el.selectionEnd = next.cursor;
              });
            }}
          >
            {session &&
            matchSlashMenu(
              text,
              sessionRuntime(session),
              mergeSkills(state.config?.skills, repoSkills),
            ).length > 0 ? (
              <SlashMenu
                query={text}
                session={session}
                skills={mergeSkills(state.config?.skills, repoSkills)}
                activeIndex={slashIndex}
                onPick={pickSlash}
              />
            ) : teammateHits.length ? (
              <TeammateMentionMenu
                items={teammateHits}
                activeIndex={mentionIndex}
                onPick={pickTeammateMention}
              />
            ) : assetHits.length ? (
              <AssetMentionMenu
                items={assetHits}
                activeIndex={mentionIndex}
                onPick={pickAssetMention}
              />
            ) : mentionHits.length ? (
              <FileMentionMenu
                items={mentionHits}
                activeIndex={mentionIndex}
                onPick={pickMention}
              />
            ) : null}
            <div className="composer-shell">
              <div className="composer-head">
                {isCanvasSession(session) || swarmMode ? null : (
                  <SubagentPicker
                    compact
                    value={sessionDefaultSubagent(session)}
                    onChange={(defaultSubagent) => {
                      void api
                        .patchSession(session.id, { defaultSubagent })
                        .then((updated) => dispatch({ type: "session", session: updated }))
                        .catch(() => undefined);
                    }}
                  />
                )}
                {swarmMode ? null : (
                  <ContextMeter
                    session={session}
                    kind={provider?.kind}
                    baseUrl={provider?.baseUrl}
                    canClear={canClearChat(session)}
                    onClear={() => void clearChat()}
                  />
                )}
                {swarmMode || !state.brain || state.brain.empty ? null : (
                  <button
                    type="button"
                    className="brain-composer-chip"
                    title="Open Brain"
                    onClick={() => dispatch({ type: "section", section: "brain" })}
                  >
                    Brain · {state.brain.nodeCount} claims
                  </button>
                )}
                <span className="composer-meta">
                  {[
                    recording ? "Recording · /record to save" : null,
                    planning ? "Plan mode" : null,
                    waitingBuild ? IMAGE_BUILD_WAIT_STATUS : null,
                    waitingGuest && !waitingBuild
                      ? `Guest starting · ${vm?.status} · you can still chat`
                      : null,
                    waitingClone ? CLONE_WAIT_STATUS : null,
                    composerWorking,
                    queue.length ? `${queue.length} queued` : null,
                    usageHint,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              {canLinkAssetSessions(session.kind) && session.assetRefs?.length ? (
                <div className="linked-assets" data-testid="linked-assets">
                  {session.assetRefs.map((row) => (
                    <button
                      key={row.sessionId}
                      type="button"
                      className="linked-asset-chip"
                      title={`Remove @asset:${row.slug}`}
                      onClick={() => {
                        void api
                          .patchSession(session.id, {
                            assetRefs: (session.assetRefs ?? []).filter(
                              (item) => item.sessionId !== row.sessionId,
                            ),
                          })
                          .then((updated) => dispatch({ type: "session", session: updated }))
                          .catch(() => undefined);
                      }}
                    >
                      @{row.slug}
                      <span aria-hidden="true">×</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <ComposerTextarea
                textareaRef={box}
                value={text}
                files={files}
                placeholder={
                  isHumanDriving(session)
                    ? "Send a message to hand the guest back to the agent…"
                    : turning
                      ? "Send steers this turn…"
                      : planning
                        ? "Describe the task to plan…"
                        : isGameSession(session)
                          ? "One change per send, or @asset to use an Assets chat…"
                          : isCanvasSession(session)
                            ? "Describe a change, or click Comment on the canvas…"
                            : swarmMode
                              ? "Message the team…  @ to mention, / for commands"
                              : sessionRuntime(session) === "host"
                                ? "Message the agent…  @game / @asset / @agent to reuse other chats, / for commands"
                                : "Message the agent…  / for commands"
                }
                onChange={(value) => {
                  setText(value);
                  setSlashIndex(0);
                  setMentionIndex(0);
                }}
                onKeyDown={(e) => {
                  const chip = applyComposerChipKey(
                    e.key,
                    text,
                    e.currentTarget.selectionStart ?? text.length,
                    files,
                  );
                  if (chip) {
                    e.preventDefault();
                    setText(chip.text);
                    setFiles(chip.files);
                    queueMicrotask(() => {
                      const el = box.current;
                      if (!el) return;
                      el.selectionStart = el.selectionEnd = chip.cursor;
                    });
                    return;
                  }
                  const items = matchSlashMenu(
                    text,
                    sessionRuntime(session),
                    mergeSkills(state.config?.skills, repoSkills),
                  );
                  if (items.length) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSlashIndex((value) => (value + 1) % items.length);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSlashIndex((value) => (value - 1 + items.length) % items.length);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      return;
                    }
                    if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                      e.preventDefault();
                      const item = items[slashIndex] ?? items[0];
                      if (item) pickSlash(item);
                      return;
                    }
                  }
                  if (teammateHits.length) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setMentionIndex((value) => (value + 1) % teammateHits.length);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setMentionIndex(
                        (value) => (value - 1 + teammateHits.length) % teammateHits.length,
                      );
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setTeammateHits([]);
                      return;
                    }
                    if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                      e.preventDefault();
                      const hit = teammateHits[mentionIndex] ?? teammateHits[0];
                      if (hit) pickTeammateMention(hit.token);
                      return;
                    }
                  }
                  if (assetHits.length) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setMentionIndex((value) => (value + 1) % assetHits.length);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setMentionIndex((value) => (value - 1 + assetHits.length) % assetHits.length);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setAssetHits([]);
                      return;
                    }
                    if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                      e.preventDefault();
                      const hit = assetHits[mentionIndex] ?? assetHits[0];
                      if (hit) pickAssetMention(hit);
                      return;
                    }
                  }
                  if (mentionHits.length) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setMentionIndex((value) => (value + 1) % mentionHits.length);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setMentionIndex(
                        (value) => (value - 1 + mentionHits.length) % mentionHits.length,
                      );
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setMentionHits([]);
                      return;
                    }
                    if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                      e.preventDefault();
                      const hit = mentionHits[mentionIndex] ?? mentionHits[0];
                      if (hit) pickMention(hit.path);
                      return;
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="composer-bar">
                <ComposerAddButton
                  title={
                    hostChat || sessionVision(session) !== "off"
                      ? "Attach a file (images, text, PDF). Copied into /workspace/.locus-attachments."
                      : "Attach a file. Images copy into /workspace/.locus-attachments but are not sent to the model while Vision is off."
                  }
                  onError={setSendError}
                  onPick={(picked) => setFiles((rows) => mergeComposerFiles(rows, picked))}
                />
                <ComposerFileThumbs
                  files={splitComposerFiles(text, files).bar}
                  onRemove={(index) => {
                    const target = splitComposerFiles(text, files).bar[index];
                    if (!target) return;
                    setFiles((rows) => rows.filter((file) => file !== target));
                  }}
                />
                <div className="composer-overflow" data-testid="composer-commands">
                  <OverflowMenu
                    label={<IconMore />}
                    title="Commands"
                    align="left"
                    toggleClassName="btn small ghost composer-commands"
                  >
                    {isCanvasSession(session) || hostChat ? null : (
                      <MenuItem
                        onClick={() => {
                          const next = sessionVision(session) === "latest" ? "off" : "latest";
                          void api
                            .patchSession(session.id, { vision: next })
                            .then((updated) => dispatch({ type: "session", session: updated }))
                            .catch(() => undefined);
                        }}
                      >
                        <span className="slash-name">Vision</span>
                        <span className="slash-hint">
                          {sessionVision(session) === "latest" ? "On" : "Off"}
                        </span>
                      </MenuItem>
                    )}
                    <MenuItem
                      onClick={() => {
                        const next = !sessionWebSearch(session);
                        void api
                          .patchSession(session.id, { webSearch: next })
                          .then((updated) => dispatch({ type: "session", session: updated }))
                          .catch(() => undefined);
                      }}
                    >
                      <span className="slash-name">Web search</span>
                      <span className="slash-hint">{sessionWebSearch(session) ? "On" : "Off"}</span>
                    </MenuItem>
                    {hostChat ? (
                      <MenuItem
                        onClick={() => {
                          const next = !sessionLiveChrome(session);
                          void api
                            .patchSession(session.id, { liveChrome: next })
                            .then((updated) => dispatch({ type: "session", session: updated }))
                            .catch(() => undefined);
                        }}
                      >
                        <span className="slash-name">Use my Chrome</span>
                        <span className="slash-hint">
                          {sessionLiveChrome(session) ? "On" : "Off"}
                        </span>
                      </MenuItem>
                    ) : null}
                    <MenuSep />
                    {composerOverflowCommands(sessionRuntime(session))
                      .filter((cmd) => cmd.id !== "vision" || !isCanvasSession(session))
                      .map((cmd) => (
                        <MenuItem
                          key={cmd.id}
                          disabled={cmd.id === "clear" && !canClearChat(session)}
                          onClick={() => void runSlash(cmd)}
                        >
                          <span className="slash-name">/{cmd.name}</span>
                          <span className="slash-hint">{cmd.title}</span>
                        </MenuItem>
                      ))}
                    {rewindTargets(session).length > 1 ? (
                      <>
                        <MenuSep />
                        {rewindTargets(session)
                          .slice()
                          .reverse()
                          .slice(1)
                          .map((item, index) => (
                            <MenuItem
                              key={item.id}
                              onClick={() =>
                                setConfirmAction({ kind: "undo", checkpointId: item.id })
                              }
                            >
                              <span className="slash-name">Turn -{index + 1}</span>
                              <span className="slash-hint">
                                {new Date(item.createdAt).toLocaleTimeString()}
                              </span>
                            </MenuItem>
                          ))}
                      </>
                    ) : null}
                    <MenuSep />
                    <MenuItem onClick={() => void saveAsSkill()}>Save as skill…</MenuItem>
                    <p className="composer-overflow-hint">Type / for more</p>
                  </OverflowMenu>
                </div>
                <div className="composer-actions">
                  <ModelPicker
                    compact
                    providers={state.config?.providers ?? []}
                    providerId={session.providerId}
                    model={session.model}
                    reasoningEffort={session.reasoningEffort}
                    onReasoningEffortChange={(reasoningEffort) => {
                      void api
                        .patchSession(session.id, { reasoningEffort: reasoningEffort ?? null })
                        .then((updated) => dispatch({ type: "session", session: updated }))
                        .catch(() => undefined);
                    }}
                    onChange={(next) => {
                      saveLastAgent({
                        os: session.os,
                        providerId: next.providerId,
                        model: next.model,
                      });
                      void api
                        .patchSession(session.id, { ...next, reasoningEffort: null })
                        .then((updated) => dispatch({ type: "session", session: updated }))
                        .catch(() => undefined);
                    }}
                  />
                  {turning ? (
                    <button className="btn small danger" onClick={() => void stop()}>
                      <IconStop /> Stop
                    </button>
                  ) : null}
                  {turning ? (
                    <button
                      type="button"
                      className="btn small ghost"
                      disabled={!text.trim() && !files.length}
                      title="Run after this turn finishes"
                      onClick={() => void queueFollowup()}
                    >
                      Queue
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn primary small composer-send"
                    disabled={!text.trim() && !files.length}
                    title={turning ? "Steer this turn" : "Send"}
                    aria-label={turning ? "Send — steer this turn" : "Send"}
                    onClick={() => void send()}
                  >
                    <span className="composer-send-label">Send</span>
                    <IconReturn />
                  </button>
                </div>
              </div>
            </div>
          </div>
          {turning ? (
            <p className="composer-steer-hint">
              Send steers this turn. Queue waits until it finishes.
            </p>
          ) : null}
          {hostChat ? (
            <p className="chat-os-hint">Host agent · /workspace on this machine</p>
          ) : docker ? (
            <p className="chat-os-hint">Using {session.dockerImage ?? "Docker"} · /workspace</p>
          ) : configuredGuestOsOptions(state.config?.templates).length <= 1 ? (
            <p className="chat-os-hint">Using {guestLabel(session.os)}</p>
          ) : null}
        </div>
      )}
      {confirmAction ? (
        <ConfirmModal
          title={confirmAction.kind === "clear" ? "Clear chat?" : "Rewind this turn?"}
          body={
            confirmAction.kind === "clear"
              ? CLEAR_CHAT_CONFIRM
              : "This restores the chat and the guest disk to that checkpoint."
          }
          confirmLabel={confirmAction.kind === "clear" ? "Clear chat" : "Rewind"}
          danger
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => {
            const next = confirmAction;
            setConfirmAction(null);
            if (next.kind === "clear") void clearChat();
            else void undo(next.checkpointId);
          }}
        />
      ) : null}
    </section>
  );
}

function isBlankAssistant(message: ChatMessage): boolean {
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

function hasOpenTool(messages: ChatMessage[]): boolean {
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
      className="bubble"
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

const ChatThread = memo(function ChatThread({
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
          <div className="msg assistant">
            <div className="who">{swarmMode ? workingWho.name : "Agent"}</div>
            <div className="bubble">
              {swarmMode
                ? "Say hi — ask what they should own on the team, or give them a first task."
                : hostChat
                  ? "This is a host agent — no VM or container. It can read and edit files in /workspace on this machine, run a shell, and use git. There is no desktop."
                  : `This chat owns a ${docker ? `${session.dockerImage ?? "Docker"} container` : `${guestLabel(session.os)} VM`}. Ask it to ${docker ? "run commands, click through Chromium, or clone a repo" : "use the desktop, run commands, or clone a repo"} — tools stay on the ${docker ? "container" : "guest"}, not your host.`}
            </div>
          </div>
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
        {!turning && !viewing ? <TrustActions session={session} /> : null}
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
