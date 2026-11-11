import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
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
  formatUsageHint,
  workerComputeUsd,
  isCanvasSession,
  isGameSession,
  isChatWaitingForGuest,
  isHiddenChatMessage,
  isHumanDriving,
  isWaitingOnGuestStart,
  supersededGuestLifecycleIds,
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
  subagentViewMessages,
  subagentStatusLabel,
  findLiveSubagent,
  sessionDefaultSubagent,
  formatSubagentKind,
  showThoughtTraces,
  parseAssetMentions,
  parseProductMode,
  parseSessionSurface,
  sessionDisplayName,
  validateSkill,
  workspaceRelFromToolPath,
  BUILTIN_SLASH_NAMES,
  type AgentSkill,
  type AssetMentionItem,
  type ChatMessage,
  type SlashCommand,
  type SlashMenuItem,
  type SubagentLive,
} from "@locus/shared";
import { api, retryEvents } from "@/lib/api";
import { showErrorNotice, showNotice } from "@/lib/notice";
import { askPrompt } from "@/lib/dialog";
import { configForSave } from "@/lib/configPersist";
import {
  filesToAttachments,
  filesFromDataTransfer,
  composerFilesFromClipboard,
} from "@/lib/attachments";
import { applyComposerChipKey, applyComposerPaste, splitComposerFiles } from "@/lib/composerPaste";
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
import { chatFindHits, stepChatFindIndex } from "@/lib/chatFind";
import { isStuckToBottom, pinThreadToLatest, schedulePinThreadToLatest } from "@/lib/threadScroll";
import { visitMarkerId } from "@/lib/chatNewMarker";
import { openSettings, useStore } from "@/state/store";
import { CompareBanner } from "./CompareBanner";
import { FeatureNudge } from "@/components/layout/FeatureNudge";
import { ConfirmModal } from "@/components/layout/ConfirmModal";
import { Tooltip } from "@/components/layout/Tooltip";
import {
  readLiveComposerDraft as readDraft,
  resetComposerDrafts,
  writeLiveComposerDraft as writeDraft,
} from "@/lib/composerDrafts";
import {
  IconClose,
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
import { supersededPlainErrorIds } from "@/lib/automations";
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
import { ChatThread, hasOpenTool, isBlankAssistant } from "./ChatThread";

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
  const waitingGuest = isChatWaitingForGuest({
    viewing,
    vmStatus: vm?.status,
    sessionStatus: session?.status,
  });
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
  const hideLifecycleIds = useMemo(
    () => new Set([...supersededGuestLifecycleIds(messages), ...supersededPlainErrorIds(messages)]),
    [messages],
  );
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
    await api.abortChat(session.id).catch((err: unknown) => {
      showErrorNotice(err, "Could not stop");
    });
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
    const rawName = await askPrompt({
      title: "Skill slash name",
      body: "Letters, numbers, and dashes.",
      value: suggested,
    });
    if (rawName == null) return;
    const name = skillSlashName(rawName);
    if (!name) {
      showNotice("Skill slash name must be /name (letters, numbers, dashes).");
      return;
    }
    const title = (await askPrompt({ title: "Skill title", value: name }))?.trim() || name;
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
      showErrorNotice(err, "Could not save skill");
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
  // Tokens already arrived: the local server has loaded the model.
  const streamedText = last?.role === "assistant" && Boolean(last.content.trim());
  const localWaitLabel =
    !viewing &&
    turning &&
    !streamedText &&
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

  const composerMeta = [
    recording ? "Recording · /record to save" : null,
    planning ? "Plan mode" : null,
    waitingBuild ? IMAGE_BUILD_WAIT_STATUS : null,
    waitingGuest && !waitingBuild ? `Guest starting · ${vm?.status} · you can still chat` : null,
    waitingClone ? CLONE_WAIT_STATUS : null,
    composerWorking,
    queue.length ? `${queue.length} queued` : null,
    usageHint,
  ]
    .filter(Boolean)
    .join(" · ");

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
                    <Tooltip
                      label={
                        turning ? "Send now — interrupt this turn and run this prompt" : "Send now"
                      }
                    >
                      <button
                        type="button"
                        className="btn icon ghost"
                        aria-label={
                          turning
                            ? "Send now — interrupt this turn and run this prompt"
                            : "Send now"
                        }
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
                    </Tooltip>
                    <Tooltip label="Remove from queue">
                      <button
                        type="button"
                        className="btn icon ghost"
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
                    </Tooltip>
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
              {composerMeta ? (
                <div className="composer-head">
                  <span className="composer-meta">{composerMeta}</span>
                </div>
              ) : null}
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
                              ? "Message the team…"
                              : "Message the agent…"
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
                    <Tooltip
                      label="Run after this turn finishes"
                      disabledReason={
                        !text.trim() && !files.length ? "Write a message first" : undefined
                      }
                    >
                      <button
                        type="button"
                        className="btn small ghost"
                        disabled={!text.trim() && !files.length}
                        onClick={() => void queueFollowup()}
                      >
                        Queue
                      </button>
                    </Tooltip>
                  ) : null}
                  <Tooltip
                    label={turning ? "Steer this turn" : "Send"}
                    disabledReason={
                      !text.trim() && !files.length ? "Write a message first" : undefined
                    }
                  >
                    <button
                      type="button"
                      className="btn primary small composer-send"
                      disabled={!text.trim() && !files.length}
                      aria-label={turning ? "Send — steer this turn" : "Send"}
                      onClick={() => void send()}
                    >
                      <span className="composer-send-label">Send</span>
                      <IconReturn />
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>
          </div>
          {turning ? (
            <p className="composer-steer-hint">
              Send steers this turn. Queue waits until it finishes.
            </p>
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
