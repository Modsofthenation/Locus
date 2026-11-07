import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  applySlackEmoji,
  conversationBareName,
  conversationLabel,
  conversationPrefix,
  formatSlackTs,
  isDirectConversation,
  isSlackChannelMessage,
  isSlackStopText,
  isSlackThreadBroadcast,
  listSlackReactionNames,
  normalizeSlackReactionName,
  providerKnowsModel,
  slackAccountLinked,
  slackClientReady,
  slackFileKindLabel,
  slackFileLooksLikeCsv,
  slackFileLooksLikeGif,
  slackFileLooksLikeHtml,
  slackFileLooksLikeImage,
  slackFileLooksLikePdf,
  slackFileLooksLikeVideo,
  slackHtmlPreviewSrc,
  slackMediaCaption,
  slackMediaAspectRatio,
  parseSlackCsvPreview,
  type SlackCsvPreview,
  slackMrkdwnToMarkdown,
  slackThreadTs,
  mergeSlackMessageRows,
  mergeSlackThreadReplies,
  parseSlackPostAs,
  withSlackPostedThread,
  slackLocusStatus,
  formatSlackLocusStatus,
  slackActivityHeadline,
  slackActivityPreview,
  slackActivityMentionNames,
  slackAlertBody,
  slackClientUrl,
  slackComposerMentionQuery,
  insertSlackComposerMention,
  encodeSlackComposerMentions,
  slackMentionCandidates,
  applySubscribe,
  applyUnsubscribe,
  normalizeRepoUrl,
  pendingSlackPost,
  parseSlackCites,
  sessionsListeningOnSlack,
  subscriptionMatchesSlack,
  messagesSinceTs,
  SLACK_CATCH_UP_CURSOR_KEY,
  SLACK_CATCH_UP_TEXT,
  SLACK_WORK_RECIPES,
  type SlackActivityItem,
  type SlackCite,
  type SlackMentionUser,
  type AgentSession,
  type AiProvider,
  type IntegrationAccount,
  type SlackConversation,
  type SlackEmojiMap,
  type SlackFile,
  type SlackGifHit,
  type SlackMessage,
  type SlackPostAs,
  type SlackSearchHit,
  type SlackStatus,
} from "@locus/shared";
import { loadLastAgent, pickProvider, saveLastAgent } from "@/lib/lastAgent";
import { api } from "@/lib/api";
import { createPortal } from "react-dom";
import { formatMarkdown } from "@/lib/markdown";
import { isStuckToBottom } from "@/lib/threadScroll";
import {
  listWindowFromSizes,
  shouldUpdateListWindow,
  sameListWindow,
  type ListWindow,
} from "@/lib/listWindow";
import { openSettings, useStore, type Action } from "@/state/store";
import {
  IconClose,
  IconHash,
  IconLock,
  IconPaperclip,
  IconPin,
  IconStar,
} from "@/components/layout/Icons";
import { Mascot } from "@/components/layout/Mascot";
import { ModelPicker } from "@/components/settings/ModelPicker";
import { SearchField } from "@/components/layout/SearchField";

const GROUP_MS = 5 * 60 * 1000;
export const LAST_SLACK_CHANNEL_KEY = "locus.slack.lastChannel";
export const LAST_SLACK_POST_AS_KEY = "locus.slack.postAs";
export const LAST_SLACK_SIDEBAR_GROUPS_KEY = "locus.slack.sidebarGroups";
export const SLACK_THREAD_WIDTH_KEY = "locus.slack.threadWidth";
const SLACK_THREAD_WIDTH_MIN = 280;
const SLACK_THREAD_WIDTH_MAX = 560;
const SLACK_THREAD_WIDTH_DEFAULT = 360;
export type SlackSidebarGroupId = "unreads" | "starred" | "channels" | "dms";
export type SlackSidebarGroups = Record<SlackSidebarGroupId, boolean>;
export const DEFAULT_SLACK_SIDEBAR_GROUPS: SlackSidebarGroups = {
  unreads: true,
  starred: true,
  channels: true,
  dms: true,
};

function loadLastSlackChannel(): string | null {
  try {
    return localStorage.getItem(LAST_SLACK_CHANNEL_KEY);
  } catch {
    return null;
  }
}

function saveLastSlackChannel(id: string) {
  try {
    localStorage.setItem(LAST_SLACK_CHANNEL_KEY, id);
  } catch {
    /* ignore */
  }
}

function loadLastSlackPostAs(): SlackPostAs {
  try {
    return parseSlackPostAs(localStorage.getItem(LAST_SLACK_POST_AS_KEY));
  } catch {
    return "user";
  }
}

function saveLastSlackPostAs(as: SlackPostAs) {
  try {
    localStorage.setItem(LAST_SLACK_POST_AS_KEY, as);
  } catch {
    /* ignore */
  }
}

export function loadSlackSidebarGroups(): SlackSidebarGroups {
  try {
    const raw = localStorage.getItem(LAST_SLACK_SIDEBAR_GROUPS_KEY);
    if (!raw) return { ...DEFAULT_SLACK_SIDEBAR_GROUPS };
    const parsed = JSON.parse(raw) as Partial<SlackSidebarGroups>;
    return {
      unreads: parsed.unreads !== false,
      starred: parsed.starred !== false,
      channels: parsed.channels !== false,
      dms: parsed.dms !== false,
    };
  } catch {
    return { ...DEFAULT_SLACK_SIDEBAR_GROUPS };
  }
}

export function saveSlackSidebarGroups(next: SlackSidebarGroups) {
  try {
    localStorage.setItem(LAST_SLACK_SIDEBAR_GROUPS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function clampSlackThreadWidth(n: number): number {
  return Math.min(SLACK_THREAD_WIDTH_MAX, Math.max(SLACK_THREAD_WIDTH_MIN, Math.round(n)));
}

function loadSlackThreadWidth(): number {
  try {
    const raw = localStorage.getItem(SLACK_THREAD_WIDTH_KEY);
    if (raw == null || raw.trim() === "") return SLACK_THREAD_WIDTH_DEFAULT;
    const n = Number(raw);
    if (Number.isFinite(n)) return clampSlackThreadWidth(n);
  } catch {
    /* ignore */
  }
  return SLACK_THREAD_WIDTH_DEFAULT;
}

function saveSlackThreadWidth(width: number) {
  try {
    localStorage.setItem(SLACK_THREAD_WIDTH_KEY, String(width));
  } catch {
    /* ignore */
  }
}

function readCatchUpCursor(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SLACK_CATCH_UP_CURSOR_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim()) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeCatchUpCursor(map: Record<string, string>) {
  try {
    localStorage.setItem(SLACK_CATCH_UP_CURSOR_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function seedCatchUpCursor(channelId: string, latestTs?: string) {
  if (!latestTs) return;
  const map = readCatchUpCursor();
  if (map[channelId]) return;
  writeCatchUpCursor({ ...map, [channelId]: latestTs });
}

function usePinnedScroller(resetKey: string | null | undefined, contentKey: string | number) {
  const ref = useRef<HTMLDivElement>(null);
  const [inner, setInner] = useState<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const pinning = useRef(false);
  const [showJump, setShowJump] = useState(false);

  function pinNow() {
    const node = ref.current;
    if (!node) return;
    pinning.current = true;
    node.scrollTop = node.scrollHeight;
    pinning.current = false;
  }

  function pinToLatest() {
    stick.current = true;
    setShowJump(false);
    pinNow();
  }

  function onScroll() {
    if (pinning.current) return;
    const node = ref.current;
    if (!node) return;
    const stuck = isStuckToBottom(node);
    stick.current = stuck;
    setShowJump((prev) => {
      const next = !stuck;
      return prev === next ? prev : next;
    });
  }

  useLayoutEffect(() => {
    stick.current = true;
    setShowJump(false);
  }, [resetKey]);

  useLayoutEffect(() => {
    if (!stick.current || !ref.current) return;
    pinNow();
  }, [inner, resetKey, contentKey]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !inner || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!stick.current) return;
      pinNow();
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [inner, resetKey]);

  return { ref, innerRef: setInner, showJump, pinToLatest, onScroll, stick };
}

const SLACK_ROW_PX = 72;

function liveSlackSession(
  sessions: AgentSession[],
  channelId?: string,
  threadTs?: string,
): AgentSession | undefined {
  if (!channelId) return undefined;
  return sessions.find(
    (row) =>
      !row.archived &&
      row.slack?.channelId === channelId &&
      (!threadTs || row.slack.threadTs === threadTs) &&
      (row.status === "running" || row.status === "idle" || row.status === "provisioning"),
  );
}

function slackSessionCanStop(session?: AgentSession): boolean {
  return session?.status === "running" || session?.status === "provisioning";
}

function SlackLocusChip({ session }: { session?: AgentSession }) {
  if (!session) return null;
  const status = slackLocusStatus(session);
  if (!status) return null;
  return (
    <span className={`slack-locus-status ${status}`} data-testid="slack-locus-status">
      {formatSlackLocusStatus(status)}
    </span>
  );
}

function SlackDraftSend({
  session,
  pending,
  busy,
}: {
  session: AgentSession;
  pending: { toolCallId: string; text: string };
  busy: boolean;
}) {
  const { dispatch } = useStore();
  const [text, setText] = useState(pending.text);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    setText(pending.text);
  }, [pending.toolCallId, pending.text]);

  async function resolve(decision: "approved" | "denied") {
    if (working || busy) return;
    setWorking(true);
    try {
      const updated = await api.resolveApproval(
        session.id,
        pending.toolCallId,
        decision,
        decision === "approved" ? text : undefined,
      );
      dispatch({ type: "session", session: updated });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not resolve draft");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="slack-draft" data-testid="slack-draft">
      <div className="slack-draft-head">Draft reply</div>
      <p className="hint">Edit, then Send. Locus will not post until you do.</p>
      <textarea
        value={text}
        rows={4}
        data-testid="slack-draft-text"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row-actions">
        <button
          className="btn small"
          type="button"
          disabled={working || busy}
          onClick={() => void resolve("denied")}
        >
          Deny
        </button>
        <button
          className="btn small primary"
          type="button"
          disabled={working || busy || !text.trim()}
          data-testid="slack-draft-send"
          onClick={() => void resolve("approved")}
        >
          Send
        </button>
      </div>
    </div>
  );
}

function SlackCites({ text, channelId }: { text: string; channelId?: string }) {
  const { state, dispatch } = useStore();
  const sessionIds = useMemo(() => state.sessions.map((row) => row.id), [state.sessions]);
  const cites = useMemo(() => parseSlackCites(text, sessionIds), [text, sessionIds]);
  if (!cites.length) return null;
  const fileSession =
    liveSlackSession(state.sessions, channelId) ??
    state.sessions.find((row) => row.id === state.selectedId && !row.archived) ??
    state.sessions.find((row) => !row.archived);

  function open(cite: SlackCite) {
    if (cite.kind === "file") {
      if (!fileSession) return;
      dispatch({ type: "select", id: fileSession.id });
      dispatch({
        type: "openWorkspace",
        open: { sessionId: fileSession.id, path: cite.path, follow: true, at: Date.now() },
      });
      return;
    }
    if (cite.kind === "pr") {
      const repo = state.repos.find(
        (row) => normalizeRepoUrl(row.checkout.url) === normalizeRepoUrl(cite.repoUrl),
      );
      dispatch({ type: "selectRepo", id: repo?.id ?? null });
      dispatch({ type: "selectPull", number: cite.number });
      return;
    }
    dispatch({ type: "select", id: cite.sessionId });
  }

  return (
    <div className="slack-cites" data-testid="slack-cites">
      {cites.map((cite) => (
        <button
          key={
            cite.kind === "file"
              ? `file:${cite.path}`
              : cite.kind === "pr"
                ? `pr:${cite.url}`
                : `session:${cite.sessionId}`
          }
          type="button"
          className="slack-cite"
          data-testid="slack-cite"
          data-kind={cite.kind}
          onClick={() => open(cite)}
        >
          {cite.label}
        </button>
      ))}
    </div>
  );
}

export function SlackListenButton(props: {
  channelId: string;
  channelName?: string;
  threadTs?: string;
}) {
  const { state, dispatch } = useStore();
  const [picker, setPicker] = useState(false);
  const [working, setWorking] = useState(false);
  const listening = sessionsListeningOnSlack(state.sessions, props.channelId, props.threadTs);
  const bound = liveSlackSession(state.sessions, props.channelId, props.threadTs);
  const candidates = state.sessions.filter((row) => !row.archived);
  const preferred = bound ?? (candidates.length === 1 ? candidates[0] : undefined);
  const on = listening.length > 0;
  const where = props.threadTs ? "this thread" : (props.channelName ?? "this channel");
  const label = on ? `Stop listening to ${where}` : `Listen to ${where}`;

  async function pin(session: AgentSession) {
    setWorking(true);
    try {
      const result = applySubscribe(session.subscriptions, {
        action: "add",
        kind: props.threadTs ? "slack_thread" : "slack_channel",
        channelId: props.channelId,
        threadTs: props.threadTs,
        channelName: props.channelName,
        title: props.threadTs ? `Thread in ${where}` : where,
      });
      const updated = await api.patchSession(session.id, { subscriptions: result.subscriptions });
      dispatch({ type: "session", session: updated });
      setPicker(false);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not subscribe");
    } finally {
      setWorking(false);
    }
  }

  async function unpin() {
    const session = listening[0];
    const sub = session?.subscriptions?.find((row) =>
      subscriptionMatchesSlack(row, props.channelId, props.threadTs),
    );
    if (!session || !sub) return;
    setWorking(true);
    try {
      const result = applyUnsubscribe(session.subscriptions, { id: sub.id });
      const updated = await api.patchSession(session.id, { subscriptions: result.subscriptions });
      dispatch({ type: "session", session: updated });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not unsubscribe");
    } finally {
      setWorking(false);
    }
  }

  function onClick() {
    if (working) return;
    if (on) {
      void unpin();
      return;
    }
    if (!candidates.length) {
      window.alert("Start an agent first, then pin this conversation onto it.");
      return;
    }
    if (preferred) {
      void pin(preferred);
      return;
    }
    setPicker((open) => !open);
  }

  return (
    <div className="slack-listen-wrap">
      <button
        type="button"
        className={`slack-listen-btn${on ? " on" : ""}`}
        title={label}
        aria-label={label}
        aria-pressed={on}
        disabled={working}
        data-testid="slack-listen"
        onClick={onClick}
      >
        <IconPin filled={on} />
      </button>
      {picker ? (
        <ul className="slack-listen-picker" role="listbox" data-testid="slack-listen-picker">
          {candidates.map((row) => (
            <li key={row.id}>
              <button type="button" onClick={() => void pin(row)}>
                {row.title}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function slackAskModel(
  providers: AiProvider[],
  live?: AgentSession,
  account?: { defaultProviderId?: string; defaultModel?: string },
): { providerId: string; model: string } {
  if (live) return { providerId: live.providerId, model: live.model };
  const prefs = loadLastAgent();
  const provider = pickProvider(providers, {
    ...prefs,
    providerId: prefs.providerId ?? account?.defaultProviderId,
    model: prefs.model ?? account?.defaultModel,
  });
  const preferred = prefs.model ?? account?.defaultModel;
  const model =
    preferred && provider && providerKnowsModel(provider, preferred)
      ? preferred
      : provider?.defaultModel || provider?.models[0] || "";
  return { providerId: provider?.id ?? "", model };
}

export function SlackKindMark({ kind }: { kind: SlackConversation["kind"] }) {
  const prefix = conversationPrefix(kind);
  if (prefix === "lock") return <IconLock />;
  return <>{prefix === "at" ? "@" : "#"}</>;
}

export async function starSlackChannel(
  id: string,
  starred: boolean,
  dispatch: Dispatch<Action>,
): Promise<void> {
  const conversations = await api.slackStar(id, starred);
  dispatch({ type: "slackConversations", conversations });
}

function initials(name: string | undefined): string {
  const trimmed = (name ?? "?").trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
  return trimmed.slice(0, 2).toUpperCase() || "?";
}

function hue(name: string): number {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 360;
}

function dayLabel(ts: string): string {
  const ms = Number.parseFloat(ts) * 1000;
  if (!Number.isFinite(ms)) return "";
  const date = new Date(ms);
  const today = new Date();
  if (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  ) {
    return "Today";
  }
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return "Yesterday";
  }
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function sameDay(a: string, b: string): boolean {
  const left = new Date(Number.parseFloat(a) * 1000);
  const right = new Date(Number.parseFloat(b) * 1000);
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/** Hold the Slack empty states until live status and the channel catalog finish loading. */
export function slackWorkspaceBooting(input: {
  slackStatus: SlackStatus | null;
  slackConversations: SlackConversation[];
  slackCatalogLoaded?: boolean;
  integrations?: IntegrationAccount[] | null;
}): boolean {
  if (input.slackCatalogLoaded || input.slackConversations.length > 0) return false;
  if (input.slackStatus === null) return true;
  if (input.slackStatus.connected) return true;
  return (input.integrations ?? []).some(slackAccountLinked);
}

function slackPresenceHint(
  status: SlackStatus | null | undefined,
  channel?: SlackConversation,
): string {
  if (!status?.connected) return "not signed in";
  const who = status.userName?.trim();
  const signed = who ? `signed in as ${who}` : "signed in";
  const extra = [
    status.teamName,
    channel?.topic,
    channel && !isDirectConversation(channel.kind) && channel.memberCount
      ? `${channel.memberCount} members`
      : null,
  ].filter(Boolean);
  return extra.length ? [signed, ...extra].join(" · ") : signed;
}

function grouped(prev: SlackMessage | undefined, next: SlackMessage): boolean {
  if (!prev) return false;
  if ((prev.userId || prev.userName) !== (next.userId || next.userName)) return false;
  const a = Number.parseFloat(prev.ts) * 1000;
  const b = Number.parseFloat(next.ts) * 1000;
  return Number.isFinite(a) && Number.isFinite(b) && b - a < GROUP_MS;
}

function SlackFileChip({ file }: { file: SlackFile }) {
  const href = file.permalink || file.url;
  const local = href.startsWith("/api/slack/media");
  return (
    <a
      className="slack-file"
      href={href}
      {...(local ? { download: file.title || "file" } : { target: "_blank", rel: "noreferrer" })}
    >
      <span className="slack-file-icon" aria-hidden>
        <IconPaperclip />
      </span>
      <span className="slack-file-copy">
        <span className="slack-file-name">{file.title || "File"}</span>
        <span className="slack-file-kind">{slackFileKindLabel(file)}</span>
      </span>
    </a>
  );
}

function SlackHtmlPreview({ file }: { file: SlackFile }) {
  const preview = slackHtmlPreviewSrc(file.url);
  return (
    <div className="slack-html" data-testid="slack-html">
      <SlackFileChip file={file} />
      {preview ? (
        <iframe
          className="slack-html-frame"
          src={preview}
          sandbox=""
          title={file.title || "HTML preview"}
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      ) : null}
    </div>
  );
}

function SlackPdfPreview({ file }: { file: SlackFile }) {
  const preview = slackHtmlPreviewSrc(file.url);
  return (
    <div className="slack-pdf" data-testid="slack-pdf">
      <SlackFileChip file={file} />
      {preview ? (
        <iframe
          className="slack-pdf-frame"
          src={preview}
          title={file.title || "PDF preview"}
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      ) : null}
    </div>
  );
}

function SlackVideoPreview({ file, text }: { file: SlackFile; text?: string }) {
  const caption = slackMediaCaption(file.title, text);
  const label = caption || "Slack video";
  return (
    <div className="slack-video" data-testid="slack-video">
      <video
        className="slack-video-player"
        controls
        playsInline
        preload="none"
        src={file.url}
        title={label}
        style={{ aspectRatio: slackMediaAspectRatio(file) }}
        width={file.width}
        height={file.height}
      >
        <a href={file.permalink || file.url}>{label}</a>
      </video>
      {caption ? <span className="slack-media-caption">{caption}</span> : null}
    </div>
  );
}

function SlackCsvPreview({ file }: { file: SlackFile }) {
  const [table, setTable] = useState<SlackCsvPreview | null>(null);
  const preview = slackHtmlPreviewSrc(file.url);
  useEffect(() => {
    if (!preview) return;
    let cancelled = false;
    void fetch(preview)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error("preview failed"))))
      .then((text) => {
        if (!cancelled) setTable(parseSlackCsvPreview(text));
      })
      .catch(() => {
        if (!cancelled) setTable(null);
      });
    return () => {
      cancelled = true;
    };
  }, [preview]);
  return (
    <div className="slack-csv" data-testid="slack-csv">
      <SlackFileChip file={file} />
      <div className="slack-csv-scroll">
        {table ? (
          <>
            <table>
              <thead>
                <tr>
                  {table.headers.map((cell, i) => (
                    <th key={`${i}:${cell}`}>{cell}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {table.truncated ? <p className="hint">Showing the first rows</p> : null}
          </>
        ) : (
          <p className="hint">Loading preview…</p>
        )}
      </div>
    </div>
  );
}

function SlackAttachChip({ file, onClear }: { file: File; onClear: () => void }) {
  return (
    <div className="slack-attach" data-testid="slack-attach">
      <span className="slack-file-icon" aria-hidden>
        <IconPaperclip />
      </span>
      <span className="slack-attach-name">{file.name}</span>
      <button
        type="button"
        className="btn icon ghost small"
        aria-label="Remove attachment"
        onClick={onClear}
      >
        ×
      </button>
    </div>
  );
}

function SlackImageViewer({
  files,
  index,
  onClose,
  onIndex,
}: {
  files: SlackFile[];
  index: number;
  onClose: () => void;
  onIndex: (index: number) => void;
}) {
  const file = files[index];
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rootRef.current?.focus();
    return () => prev?.focus();
  }, []);
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
        return;
      }
      if (e.key === "ArrowLeft" && index > 0) {
        e.preventDefault();
        onIndex(index - 1);
      }
      if (e.key === "ArrowRight" && index < files.length - 1) {
        e.preventDefault();
        onIndex(index + 1);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [files.length, index, onClose, onIndex]);
  if (!file) return null;
  return createPortal(
    <div
      ref={rootRef}
      className="slack-image-viewer"
      data-testid="slack-image-viewer"
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      aria-label={file.alt || file.title || "Slack image"}
      onClick={onClose}
    >
      <button
        type="button"
        className="slack-image-viewer-close"
        aria-label="Close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <IconClose />
      </button>
      {files.length > 1 ? (
        <>
          <button
            type="button"
            className="slack-image-viewer-nav prev"
            aria-label="Previous image"
            disabled={index === 0}
            onClick={(e) => {
              e.stopPropagation();
              onIndex(index - 1);
            }}
          >
            ‹
          </button>
          <button
            type="button"
            className="slack-image-viewer-nav next"
            aria-label="Next image"
            disabled={index === files.length - 1}
            onClick={(e) => {
              e.stopPropagation();
              onIndex(index + 1);
            }}
          >
            ›
          </button>
        </>
      ) : null}
      <img
        className="slack-image-viewer-img"
        src={file.url}
        alt={file.alt || file.title || "Slack image"}
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
}

export function SlackBody({
  text,
  files,
  emoji,
  channelId,
}: {
  text: string;
  files?: SlackFile[];
  emoji: SlackEmojiMap;
  channelId?: string;
}) {
  const [viewer, setViewer] = useState<number | null>(null);
  const images = files?.filter(slackFileLooksLikeImage) ?? [];
  const videos =
    files?.filter((file) => !slackFileLooksLikeImage(file) && slackFileLooksLikeVideo(file)) ?? [];
  const htmls =
    files?.filter(
      (file) =>
        !slackFileLooksLikeImage(file) &&
        !slackFileLooksLikeVideo(file) &&
        slackFileLooksLikeHtml(file),
    ) ?? [];
  const pdfs =
    files?.filter(
      (file) =>
        !slackFileLooksLikeImage(file) &&
        !slackFileLooksLikeVideo(file) &&
        !slackFileLooksLikeHtml(file) &&
        slackFileLooksLikePdf(file),
    ) ?? [];
  const csvs =
    files?.filter(
      (file) =>
        !slackFileLooksLikeImage(file) &&
        !slackFileLooksLikeVideo(file) &&
        !slackFileLooksLikeHtml(file) &&
        !slackFileLooksLikePdf(file) &&
        slackFileLooksLikeCsv(file),
    ) ?? [];
  const docs =
    files?.filter(
      (file) =>
        !slackFileLooksLikeImage(file) &&
        !slackFileLooksLikeVideo(file) &&
        !slackFileLooksLikeHtml(file) &&
        !slackFileLooksLikePdf(file) &&
        !slackFileLooksLikeCsv(file),
    ) ?? [];
  return (
    <div>
      {text.trim() ? (
        <div
          className="slack-md pr-md"
          dangerouslySetInnerHTML={{
            __html: applySlackEmoji(formatMarkdown(slackMrkdwnToMarkdown(text)), emoji),
          }}
        />
      ) : null}
      <SlackCites text={text} channelId={channelId} />
      {images.length ? (
        <div
          className={`slack-media${images.length > 1 ? " slack-media--gallery" : ""}`}
          data-count={images.length}
        >
          {images.map((file, i) => {
            const caption = slackMediaCaption(file.title, text);
            return (
              <a
                key={file.url}
                className="slack-media-link"
                href={file.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  setViewer(i);
                }}
                style={images.length > 1 ? undefined : { aspectRatio: slackMediaAspectRatio(file) }}
              >
                <img
                  className={slackFileLooksLikeGif(file) ? "slack-gif" : "slack-img"}
                  src={file.url}
                  alt={file.alt || file.title || "Slack image"}
                  loading="lazy"
                  decoding="async"
                  width={file.width}
                  height={file.height}
                />
                {caption ? <span className="slack-media-caption">{caption}</span> : null}
              </a>
            );
          })}
        </div>
      ) : null}
      {viewer != null && images[viewer] ? (
        <SlackImageViewer
          files={images}
          index={viewer}
          onClose={() => setViewer(null)}
          onIndex={setViewer}
        />
      ) : null}
      {videos.length ? (
        <div className="slack-videos">
          {videos.map((file) => (
            <SlackVideoPreview key={file.url} file={file} text={text} />
          ))}
        </div>
      ) : null}
      {htmls.length ? (
        <div className="slack-htmls">
          {htmls.map((file) => (
            <SlackHtmlPreview key={file.url} file={file} />
          ))}
        </div>
      ) : null}
      {pdfs.length ? (
        <div className="slack-pdfs">
          {pdfs.map((file) => (
            <SlackPdfPreview key={file.url} file={file} />
          ))}
        </div>
      ) : null}
      {csvs.length ? (
        <div className="slack-csvs">
          {csvs.map((file) => (
            <SlackCsvPreview key={file.url} file={file} />
          ))}
        </div>
      ) : null}
      {docs.length ? (
        <div className="slack-files">
          {docs.map((file) => (
            <SlackFileChip key={file.url} file={file} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SlackPostAsToggle({
  value,
  onChange,
}: {
  value: SlackPostAs;
  onChange: (next: SlackPostAs) => void;
}) {
  const asBot = value === "bot";
  return (
    <button
      type="button"
      className={`btn small ghost slack-post-as${asBot ? " on" : ""}`}
      data-testid="slack-post-as"
      aria-pressed={asBot}
      title={
        asBot
          ? "Posting as the Locus bot. Click to send as you."
          : "Posting as you. Click to send as the Locus bot."
      }
      onClick={() => onChange(asBot ? "user" : "bot")}
    >
      {asBot ? "as Locus" : "as you"}
    </button>
  );
}

export function SlackPane() {
  const { state, dispatch } = useStore();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [threadDraft, setThreadDraft] = useState("");
  const [replies, setReplies] = useState<SlackMessage[]>([]);
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState("");
  const [askThread, setAskThread] = useState<string | undefined>();
  const [askProviderId, setAskProviderId] = useState("");
  const [askModel, setAskModel] = useState("");
  const [hoverTs, setHoverTs] = useState<string | null>(null);
  const [gifFor, setGifFor] = useState<"channel" | "thread" | null>(null);
  const [channelFile, setChannelFile] = useState<File | null>(null);
  const [threadFile, setThreadFile] = useState<File | null>(null);
  const [postAs, setPostAs] = useState<SlackPostAs>(loadLastSlackPostAs);
  const [emoji, setEmoji] = useState<SlackEmojiMap>({});
  const [historyChannelId, setHistoryChannelId] = useState<string | null>(null);
  const [repliesReady, setRepliesReady] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SlackSearchHit[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editingTs, setEditingTs] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [alsoSend, setAlsoSend] = useState(false);
  const [threadWidth, setThreadWidth] = useState(loadSlackThreadWidth);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [channelCursor, setChannelCursor] = useState(0);
  const [threadCursor, setThreadCursor] = useState(0);
  const composer = useRef<HTMLTextAreaElement>(null);
  const threadComposer = useRef<HTMLTextAreaElement>(null);
  const channelFileInput = useRef<HTMLInputElement>(null);
  const threadFileInput = useRef<HTMLInputElement>(null);
  const drafts = useRef(new Map<string, string>());
  const draftRef = useRef(draft);
  const threadDraftRef = useRef(threadDraft);
  const prevChannelRef = useRef<string | null>(null);
  const prevThreadRef = useRef<string | null>(null);
  draftRef.current = draft;
  threadDraftRef.current = threadDraft;
  const slackAccount = (state.config?.integrations ?? []).find((row) => slackClientReady(row));
  const connected = Boolean(state.slackStatus?.connected || slackAccount);
  const booting = slackWorkspaceBooting({
    slackStatus: state.slackStatus,
    slackConversations: state.slackConversations,
    slackCatalogLoaded: state.slackCatalogLoaded,
    integrations: state.config?.integrations,
  });
  const canPostAsBot = Boolean(state.slackStatus?.canPostAsBot);
  const sendAs: SlackPostAs = canPostAsBot ? postAs : "user";
  const channel = state.slackConversations.find((row) => row.id === state.selectedSlackChannelId);
  const label = channel ? conversationLabel(channel) : "Slack";
  const youId = state.slackStatus?.userId || slackAccount?.userId;
  const youAvatar =
    state.slackStatus?.avatarUrl ||
    state.slackMessages.find((row) => row.userId === youId && row.avatarUrl)?.avatarUrl;
  const bound = liveSlackSession(state.sessions, channel?.id);
  const channelDraft = pendingSlackPost(bound);
  const threadBound = liveSlackSession(
    state.sessions,
    channel?.id,
    state.slackThreadTs ?? undefined,
  );
  const threadDraftPending = pendingSlackPost(threadBound);
  const providers = state.config?.providers ?? [];
  const lastPostTs = bound?.slack?.lastPostTs;
  const mentionPeople = useMemo(
    () =>
      slackMentionCandidates({
        selfId: youId,
        conversations: state.slackConversations,
        messages: [...state.slackMessages, ...replies],
      }),
    [youId, state.slackConversations, state.slackMessages, replies],
  );
  const channelMention = slackComposerMentionQuery(draft, channelCursor);
  const threadMention = slackComposerMentionQuery(threadDraft, threadCursor);
  const channelMentionHits = channelMention
    ? slackMentionCandidates({
        query: channelMention.query,
        selfId: youId,
        conversations: state.slackConversations,
        messages: [...state.slackMessages, ...replies],
      })
    : [];
  const threadMentionHits = threadMention
    ? slackMentionCandidates({
        query: threadMention.query,
        selfId: youId,
        conversations: state.slackConversations,
        messages: [...state.slackMessages, ...replies],
      })
    : [];
  const historyLoading = Boolean(
    connected &&
    state.selectedSlackChannelId &&
    historyChannelId !== state.selectedSlackChannelId &&
    state.slackMessages.length === 0,
  );
  const topLevel = useMemo(
    () => state.slackMessages.filter((row) => isSlackChannelMessage(row)),
    [state.slackMessages],
  );
  const channelScroll = usePinnedScroller(
    state.selectedSlackChannelId,
    `${topLevel.length}:${historyLoading}`,
  );
  const slackHeightsRef = useRef(new Map<string, number>());
  const [slackSizeTick, setSlackSizeTick] = useState(0);
  const slackSizes = useMemo(
    () => topLevel.map((row) => slackHeightsRef.current.get(row.ts) ?? SLACK_ROW_PX),
    // slackSizeTick re-reads measured heights after paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topLevel, slackSizeTick],
  );
  const [slackWin, setSlackWin] = useState<ListWindow>(() =>
    listWindowFromSizes({
      scrollTop: 0,
      clientHeight: 0,
      sizes: [],
      stickToEnd: true,
    }),
  );

  function measureSlackRows(el: HTMLDivElement | null): boolean {
    if (!el) return false;
    const heights = slackHeightsRef.current;
    let changed = false;
    for (const node of el.querySelectorAll<HTMLElement>("[data-slack-row]")) {
      const id = node.getAttribute("data-slack-row");
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

  function syncSlackWindow(el: HTMLDivElement | null, stickToEnd?: boolean) {
    if (!el) return;
    const next = listWindowFromSizes({
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
      sizes: slackSizes,
      stickToEnd: stickToEnd ?? (channelScroll.stick.current || el.clientHeight <= 0),
    });
    setSlackWin((current) => {
      if (sameListWindow(current, next)) return current;
      if (current.start === next.start && current.end === next.end) return next;
      return shouldUpdateListWindow(current, next) ? next : current;
    });
  }
  const threadScroll = usePinnedScroller(state.slackThreadTs, `${replies.length}:${repliesReady}`);

  useLayoutEffect(() => {
    slackHeightsRef.current.clear();
    setSlackSizeTick((n) => n + 1);
    setSlackWin(
      listWindowFromSizes({
        scrollTop: 0,
        clientHeight: 0,
        sizes: topLevel.map(() => SLACK_ROW_PX),
        stickToEnd: true,
      }),
    );
    // Reset measurements when switching channels, not on every new message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedSlackChannelId]);

  useLayoutEffect(() => {
    const el = channelScroll.ref.current;
    syncSlackWindow(el);
    if (measureSlackRows(el)) setSlackSizeTick((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topLevel, slackSizes, state.selectedSlackChannelId]);

  useEffect(() => {
    saveSlackThreadWidth(threadWidth);
  }, [threadWidth]);

  function onThreadGutterDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const origin = event.clientX;
    const start = threadWidth;
    const node = event.currentTarget;
    if (typeof node.setPointerCapture === "function") node.setPointerCapture(event.pointerId);
    function move(ev: PointerEvent) {
      setThreadWidth(clampSlackThreadWidth(start - (ev.clientX - origin)));
    }
    function up() {
      if (typeof node.releasePointerCapture === "function")
        node.releasePointerCapture(event.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api
        .slackSearch(q)
        .then((hits) => {
          if (!cancelled) setSearchHits(hits);
        })
        .catch(() => {
          if (!cancelled) setSearchHits([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  function openSearchHit(hit: SlackSearchHit) {
    dispatch({ type: "selectSlackChannel", id: hit.channelId });
    const thread = hit.threadTs || hit.ts;
    dispatch({ type: "slackThread", ts: thread });
    setSearchOpen(false);
    setSearchQuery("");
  }

  useEffect(() => {
    if (state.slackActivityOpen) return;
    if (state.selectedSlackChannelId) {
      saveLastSlackChannel(state.selectedSlackChannelId);
      return;
    }
    if (!connected || !state.slackConversations.length) return;
    const id = pickDefaultSlackChannel(state.slackConversations, loadLastSlackChannel());
    if (id) dispatch({ type: "selectSlackChannel", id });
  }, [
    connected,
    dispatch,
    state.selectedSlackChannelId,
    state.slackActivityOpen,
    state.slackConversations,
  ]);

  useEffect(() => {
    const next = state.selectedSlackChannelId;
    const prev = prevChannelRef.current;
    if (prev && prev !== next) {
      drafts.current.set(prev, draftRef.current);
      setGifFor(null);
      setAskOpen(false);
      setAskThread(undefined);
      setChannelFile(null);
    }
    prevChannelRef.current = next;
    setDraft(next ? (drafts.current.get(next) ?? "") : "");
  }, [state.selectedSlackChannelId]);

  useEffect(() => {
    const next = state.slackThreadTs;
    const prev = prevThreadRef.current;
    if (prev && prev !== next) {
      drafts.current.set(`thread:${prev}`, threadDraftRef.current);
      setThreadFile(null);
    }
    prevThreadRef.current = next;
    setThreadDraft(next ? (drafts.current.get(`thread:${next}`) ?? "") : "");
    setAlsoSend(false);
    setEditingTs(null);
  }, [state.slackThreadTs]);

  useEffect(() => {
    if (!state.selectedSlackChannelId) return;
    composer.current?.focus();
  }, [state.selectedSlackChannelId]);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (document.querySelector(".slack-react-picker")) return;
      if (document.querySelector(".slack-image-viewer")) return;
      if (editingTs) {
        setEditingTs(null);
        e.preventDefault();
        return;
      }
      if (searchOpen) {
        setSearchOpen(false);
        e.preventDefault();
        return;
      }
      if (gifFor) {
        setGifFor(null);
        e.preventDefault();
        return;
      }
      if (askOpen) {
        setAskOpen(false);
        setAskThread(undefined);
        e.preventDefault();
        return;
      }
      if (state.slackThreadTs) {
        dispatch({ type: "slackThread", ts: null });
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [askOpen, dispatch, editingTs, gifFor, searchOpen, state.slackThreadTs]);

  useEffect(() => {
    let cancelled = false;
    let lastLoad = 0;
    async function load() {
      if (typeof document !== "undefined" && document.hidden) return;
      lastLoad = Date.now();
      try {
        const status = await api.slackStatus();
        if (cancelled) return;
        if (!status.connected) {
          dispatch({ type: "slackStatus", status });
          dispatch({ type: "slackConversations", conversations: [] });
          setError(null);
          return;
        }
        try {
          const conversations = await api.slackConversations();
          if (cancelled) return;
          dispatch({ type: "slackStatus", status });
          dispatch({ type: "slackConversations", conversations });
          setError(null);
        } catch (err) {
          if (cancelled) return;
          dispatch({ type: "slackStatus", status });
          setError(err instanceof Error ? err.message : "Could not load Slack");
          dispatch({ type: "slackCatalogLoaded" });
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load Slack");
        dispatch({
          type: "slackStatus",
          status: { connected: false, socket: "down" },
        });
        dispatch({ type: "slackCatalogLoaded" });
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const onVis = () => {
      if (document.hidden) return;
      if (Date.now() - lastLoad < 30_000) return;
      void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [dispatch]);

  useEffect(() => {
    if (!connected) {
      setEmoji({});
      return;
    }
    let cancelled = false;
    void api.slackEmoji().then(
      (map) => {
        if (!cancelled) setEmoji(map);
      },
      () => {
        if (!cancelled) setEmoji({});
      },
    );
    return () => {
      cancelled = true;
    };
  }, [connected]);

  useEffect(() => {
    const id = state.selectedSlackChannelId;
    if (!id || !connected) {
      if (!connected) void api.slackUnwatch();
      return;
    }
    const channelId = id;
    let cancelled = false;
    async function loadHistory() {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const messages = await api.slackHistory(channelId);
        if (!cancelled) {
          dispatch({ type: "slackMessages", messages });
          setHistoryChannelId(channelId);
          setError(null);
          const ts = messages.at(-1)?.ts;
          seedCatchUpCursor(channelId, ts);
          void api.slackMarkRead(channelId, ts).then(
            (conversations) => {
              if (!cancelled && conversations.length) {
                dispatch({ type: "slackConversations", conversations });
              }
            },
            () => undefined,
          );
        }
      } catch (err) {
        if (!cancelled) {
          setHistoryChannelId(channelId);
          setError(err instanceof Error ? err.message : "Could not load messages");
        }
      }
    }
    void loadHistory();
    const onVis = () => {
      if (document.hidden) {
        void api.slackUnwatch();
        return;
      }
      void loadHistory();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      void api.slackUnwatch();
    };
  }, [connected, dispatch, state.selectedSlackChannelId]);

  useEffect(() => {
    const ts = state.slackThreadTs;
    const id = state.selectedSlackChannelId;
    if (!ts || !id) {
      setReplies([]);
      setRepliesReady(true);
      return;
    }
    let cancelled = false;
    setRepliesReady(false);
    setReplies([]);
    void api.slackReplies(id, ts).then(
      (rows) => {
        if (!cancelled) {
          setReplies((current) => mergeSlackThreadReplies(ts, rows, current));
          setRepliesReady(true);
        }
      },
      () => {
        if (!cancelled) {
          setReplies((current) => mergeSlackThreadReplies(ts, [], current));
          setRepliesReady(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [state.selectedSlackChannelId, state.slackThreadTs]);

  useEffect(() => {
    const ts = state.slackThreadTs;
    if (!ts) return;
    const extra = state.slackMessages.filter((row) => row.ts === ts || row.threadTs === ts);
    if (!extra.length) return;
    setReplies((rows) => mergeSlackThreadReplies(ts, rows, extra));
  }, [state.selectedSlackChannelId, state.slackThreadTs, state.slackMessages]);

  async function send(
    text: string,
    threadTs?: string,
    gif?: { url: string; title?: string },
    file?: File | null,
    replyBroadcast?: boolean,
  ) {
    const id = state.selectedSlackChannelId;
    const trimmed = encodeSlackComposerMentions(text.trim(), mentionPeople);
    if (!id || busy) return;
    if (!trimmed && !gif && !file) return;
    setBusy(true);
    setError(null);
    try {
      const posted = file
        ? await api.slackUpload(id, file, {
            comment: trimmed || undefined,
            threadTs,
            as: sendAs,
          })
        : await api.slackPost(
            id,
            trimmed,
            threadTs,
            gif,
            sendAs,
            Boolean(threadTs && replyBroadcast),
          );
      const message = withSlackPostedThread(posted, {
        threadTs,
        replyBroadcast: Boolean(threadTs && replyBroadcast),
      });
      dispatch({ type: "slackMessage", message });
      if (threadTs) {
        setReplies((rows) => mergeSlackMessageRows(rows, [message]));
        setRepliesReady(true);
        threadScroll.pinToLatest();
      } else {
        channelScroll.pinToLatest();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    const id = state.selectedSlackChannelId;
    const ts = editingTs;
    const text = encodeSlackComposerMentions(editDraft.trim(), mentionPeople);
    if (!id || !ts || !text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const message = await api.slackUpdate(id, ts, text, sendAs);
      dispatch({ type: "slackMessage", message });
      setReplies((rows) => rows.map((row) => (row.ts === message.ts ? message : row)));
      setEditingTs(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not edit");
    } finally {
      setBusy(false);
    }
  }

  async function deleteOn(message: SlackMessage) {
    const id = state.selectedSlackChannelId;
    if (!id || busy) return;
    setBusy(true);
    setError(null);
    try {
      const deleted = await api.slackDelete(id, message.ts, sendAs);
      dispatch({ type: "slackMessage", message: deleted });
      setReplies((rows) => rows.filter((row) => row.ts !== message.ts));
      if (editingTs === message.ts) setEditingTs(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setBusy(false);
    }
  }

  function copyLink(message: SlackMessage) {
    const url = slackClientUrl(state.slackStatus?.teamId, message.channelId, message.ts);
    if (!url) return;
    void navigator.clipboard?.writeText(url).catch(() => undefined);
  }

  function applyMention(user: SlackMentionUser, thread?: string) {
    if (thread) {
      const query = slackComposerMentionQuery(threadDraft, threadCursor);
      if (!query) return;
      const next = insertSlackComposerMention(threadDraft, query.start, threadCursor, user);
      setThreadDraft(next.text);
      setThreadCursor(next.cursor);
      setMentionIndex(0);
      requestAnimationFrame(() => {
        const node = threadComposer.current;
        if (!node) return;
        node.focus();
        node.setSelectionRange(next.cursor, next.cursor);
      });
      return;
    }
    const query = slackComposerMentionQuery(draft, channelCursor);
    if (!query) return;
    const next = insertSlackComposerMention(draft, query.start, channelCursor, user);
    setDraft(next.text);
    setChannelCursor(next.cursor);
    setMentionIndex(0);
    requestAnimationFrame(() => {
      const node = composer.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(next.cursor, next.cursor);
    });
  }

  async function reactOn(message: SlackMessage, name: string) {
    const id = state.selectedSlackChannelId;
    if (!id || busy) return;
    const mine = Boolean(message.reactions?.find((row) => row.name === name)?.mine);
    setBusy(true);
    setError(null);
    try {
      const updated = await api.slackReact(id, message.ts, name, {
        remove: mine,
        threadTs:
          message.threadTs && message.threadTs !== message.ts ? message.threadTs : undefined,
      });
      dispatch({ type: "slackMessage", message: updated });
      setReplies((rows) => rows.map((row) => (row.ts === updated.ts ? updated : row)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not react");
    } finally {
      setBusy(false);
    }
  }

  async function runAsk(
    instruction: string,
    thread?: string,
    opts?: { recipeId?: string; sinceTs?: string; stayInSlack?: boolean },
  ) {
    const id = state.selectedSlackChannelId;
    const trimmed = instruction.trim();
    if (!id || !trimmed || busy) return false;
    const messageTs = thread || topLevel.at(-1)?.ts || `${Date.now() / 1000}`;
    setBusy(true);
    setError(null);
    try {
      const result = await api.slackRun({
        channelId: id,
        threadTs: thread,
        messageTs,
        text: trimmed,
        providerId: askProviderId || undefined,
        model: askModel || undefined,
        recipeId: opts?.recipeId,
        sinceTs: opts?.sinceTs,
      });
      const prev = loadLastAgent();
      saveLastAgent({
        ...prev,
        providerId: askProviderId || prev.providerId,
        model: askModel || prev.model,
      });
      setAskOpen(false);
      setAskText("");
      if (isSlackStopText(trimmed)) return true;
      if (result.sessionId && !opts?.stayInSlack)
        dispatch({ type: "select", id: result.sessionId });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Locus");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function catchUp() {
    const id = state.selectedSlackChannelId;
    if (!id || busy) return;
    const cursor = readCatchUpCursor()[id];
    const missed = messagesSinceTs(topLevel, cursor);
    const ok = await runAsk(SLACK_CATCH_UP_TEXT, undefined, {
      sinceTs: missed.length ? cursor : undefined,
      stayInSlack: true,
    });
    if (!ok) return;
    const latest = topLevel.at(-1)?.ts;
    if (latest) writeCatchUpCursor({ ...readCatchUpCursor(), [id]: latest });
  }

  function openAsk(thread?: string) {
    const live = liveSlackSession(state.sessions, channel?.id, thread) ?? bound;
    const next = slackAskModel(providers, live, slackAccount);
    setAskProviderId(next.providerId);
    setAskModel(next.model);
    setAskThread(thread);
    setAskOpen(true);
  }

  function clearChannelDraft() {
    const id = state.selectedSlackChannelId;
    if (id) drafts.current.set(id, "");
    setDraft("");
  }

  function clearThreadDraft() {
    const ts = state.slackThreadTs;
    if (ts) drafts.current.set(`thread:${ts}`, "");
    setThreadDraft("");
  }

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>, thread?: string) {
    const hits = thread ? threadMentionHits : channelMentionHits;
    const mention = thread ? threadMention : channelMention;
    if (mention && hits.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % hits.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + hits.length) % hits.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const pick = hits[Math.min(mentionIndex, hits.length - 1)];
        if (pick) applyMention(pick, thread);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (thread) setThreadCursor(threadDraft.length);
        else setChannelCursor(draft.length);
        return;
      }
    }
    if (e.key === "ArrowUp" && !e.shiftKey) {
      const value = thread ? threadDraft : draft;
      const cursor = thread ? threadCursor : channelCursor;
      if (!value.trim() && cursor === 0) {
        const rows = thread ? replies : topLevel;
        const last = [...rows].reverse().find((row) => youId && row.userId === youId);
        if (last) {
          e.preventDefault();
          setEditingTs(last.ts);
          setEditDraft(last.text);
        }
      }
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    if (thread) {
      const text = threadDraft;
      const file = threadFile;
      const broadcast = alsoSend;
      clearThreadDraft();
      setThreadFile(null);
      setAlsoSend(false);
      threadScroll.pinToLatest();
      void send(text, thread, undefined, file, broadcast);
      return;
    }
    const text = draft;
    const file = channelFile;
    clearChannelDraft();
    setChannelFile(null);
    channelScroll.pinToLatest();
    void send(text, undefined, undefined, file);
  }

  if (booting) {
    return (
      <div className="slack-pane" data-testid="slack-booting">
        {error ? (
          <p className="error">{error}</p>
        ) : (
          <p className="hint slack-loading">Loading workspace…</p>
        )}
        <div className="slack-split">
          <div className="slack-main">
            <div className="slack-timeline-wrap">
              <div className="slack-timeline">
                <div className="slack-timeline-inner">
                  <SlackHistorySkeleton />
                </div>
              </div>
            </div>
            <div className="slack-composer slack-composer--pending" aria-hidden>
              <span className="skeleton line wide" />
              <span className="skeleton line" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="slack-pane">
        {error ? <p className="error">{error}</p> : null}
        <div className="empty">
          <div className="empty-card codebase-empty slack-empty">
            <div className="empty-hero">
              <Mascot pose="rest" size={76} />
              <h2>Sign in as yourself</h2>
            </div>
            <p>
              Tokens live in Settings → Integrations. Locus is the local client. Sign in as yourself
              to read Slack; send as you by default, or as the Locus bot. Slack.com is still Slack.
            </p>
            <div className="row-actions">
              <button
                className="btn primary"
                onClick={() => openSettings(dispatch, "integrations")}
              >
                Sign in with Slack
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (state.slackActivityOpen) {
    const mentionNames = slackActivityMentionNames(state.slackStatus);
    return (
      <div className="slack-pane">
        {error ? <p className="error">{error}</p> : null}
        {state.slackActivity.length === 0 ? (
          <div className="empty">
            <div className="empty-card codebase-empty slack-empty">
              <div className="empty-hero">
                <Mascot pose="rest" size={76} />
                <h2>All caught up</h2>
              </div>
              <p>
                Mentions, thread replies, and unread DMs land here. Desktop notifications fire when
                new ones arrive.
              </p>
            </div>
          </div>
        ) : (
          <div className="slack-activity" data-testid="slack-activity">
            {state.slackActivity.map((item) => (
              <button
                key={item.id}
                type="button"
                className="slack-activity-item"
                onClick={() => {
                  dispatch({ type: "selectSlackChannel", id: item.channelId });
                  if (item.kind === "mention" || item.kind === "thread") {
                    dispatch({ type: "slackThread", ts: item.threadTs || item.ts });
                  }
                }}
              >
                <span className="slack-activity-kind">{slackActivityHeadline(item)}</span>
                <span className="slack-activity-text">
                  {slackActivityPreview(item.text, mentionNames)}
                </span>
                <span className="slack-activity-ts">{formatSlackTs(item.ts)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="slack-pane">
        {error ? <p className="error">{error}</p> : null}
        {state.slackConversations.length === 0 ? (
          <div className="empty">
            <div className="empty-card codebase-empty slack-empty">
              <div className="empty-hero">
                <Mascot pose="rest" size={76} />
                <h2>Pick a channel</h2>
              </div>
              <p>
                Unreads, starred, channels, and DMs land in the sidebar. Locus reads as you. Sends
                default to you; switch the composer to post as the Locus bot.
              </p>
            </div>
          </div>
        ) : (
          <SlackHistorySkeleton />
        )}
      </div>
    );
  }

  return (
    <div className="slack-pane">
      <div className="slack-head">
        <div className="slack-title">
          <button
            className={`btn icon ghost small slack-star-btn${channel.starred ? " on" : ""}`}
            type="button"
            title={channel.starred ? "Unstar" : "Star"}
            aria-label={channel.starred ? `Unstar ${label}` : `Star ${label}`}
            onClick={() => void starSlackChannel(channel.id, !channel.starred, dispatch)}
          >
            <IconStar filled={Boolean(channel.starred)} />
          </button>
          <SlackListenButton channelId={channel.id} channelName={conversationBareName(channel)} />
          <SlackLocusChip session={bound} />
          <p className="hint">{slackPresenceHint(state.slackStatus, channel)}</p>
        </div>
        <div className="row-actions">
          <div className="slack-search">
            <SearchField
              className="search"
              wrapClassName="slack-search-wrap"
              value={searchQuery}
              placeholder="Search messages"
              aria-label="Search Slack messages"
              onFocus={() => setSearchOpen(true)}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
            />
            {searchOpen && searchQuery.trim().length >= 2 ? (
              <ul className="slack-search-hits" role="listbox" aria-label="Search results">
                {searchHits.length === 0 ? (
                  <li className="hint">No matches</li>
                ) : (
                  searchHits.map((hit) => (
                    <li key={`${hit.channelId}:${hit.ts}`}>
                      <button
                        type="button"
                        className="slack-search-hit"
                        onClick={() => openSearchHit(hit)}
                      >
                        <span className="slack-search-ch">
                          {hit.channelName ? `#${hit.channelName}` : hit.channelId}
                        </span>
                        <span className="slack-search-tx">
                          {hit.userName ? `${hit.userName}: ` : ""}
                          {hit.text}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
          {bound ? (
            <button
              className="btn small"
              onClick={() => dispatch({ type: "select", id: bound.id })}
            >
              Open agent
            </button>
          ) : null}
          {bound && slackSessionCanStop(bound) ? (
            <button
              className="btn small"
              disabled={busy}
              onClick={() => void runAsk("stop", state.slackThreadTs ?? bound?.slack?.threadTs)}
            >
              Stop
            </button>
          ) : null}
          <button
            className="btn small"
            disabled={busy}
            data-testid="slack-catch-up"
            onClick={() => void catchUp()}
          >
            Catch me up
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => openAsk(state.slackThreadTs ?? undefined)}
          >
            Ask Locus
          </button>
          {slackClientUrl(state.slackStatus?.teamId, channel.id) ? (
            <a
              className="btn small"
              href={slackClientUrl(state.slackStatus?.teamId, channel.id)}
              target="_blank"
              rel="noreferrer"
              data-testid="slack-open-slack"
            >
              Open in Slack
            </a>
          ) : null}
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {askOpen && !askThread ? (
        <AskLocusForm
          placement="channel"
          context={label}
          value={askText}
          busy={busy}
          providers={providers}
          providerId={askProviderId}
          model={askModel}
          onChange={setAskText}
          onModelChange={(next) => {
            setAskProviderId(next.providerId);
            setAskModel(next.model);
          }}
          onSubmit={() => void runAsk(askText)}
          onRecipe={(recipeId, text) => void runAsk(text, undefined, { recipeId })}
          onStop={() => void runAsk("stop", bound?.slack?.threadTs)}
          canStop={slackSessionCanStop(bound)}
          onCancel={() => setAskOpen(false)}
        />
      ) : null}
      <div
        className={`slack-split${state.slackThreadTs ? " has-thread" : ""}`}
        style={
          state.slackThreadTs
            ? { gridTemplateColumns: `minmax(0, 1fr) 6px ${threadWidth}px` }
            : undefined
        }
      >
        <div className="slack-main">
          <div className="slack-timeline-wrap">
            <div
              className="slack-timeline"
              ref={channelScroll.ref}
              aria-label={label}
              onScroll={(event) => {
                const node = event.currentTarget;
                syncSlackWindow(node, isStuckToBottom(node) || node.clientHeight <= 0);
                channelScroll.onScroll();
              }}
            >
              <div className="slack-timeline-inner" ref={channelScroll.innerRef}>
                {historyLoading ? (
                  <SlackHistorySkeleton />
                ) : topLevel.length === 0 ? (
                  <div className="slack-empty-thread">
                    <p>No messages yet. Say something as you.</p>
                  </div>
                ) : (
                  <>
                    <div className="list-window-spacer" style={{ height: slackWin.padTop }} />
                    {topLevel.slice(slackWin.start, slackWin.end).map((row, paintedIndex) => {
                      const index = slackWin.start + paintedIndex;
                      const prev = topLevel[index - 1];
                      const showDay = !prev || !sameDay(prev.ts, row.ts);
                      const broadcast = isSlackThreadBroadcast(row);
                      const compact =
                        !showDay &&
                        !broadcast &&
                        !isSlackThreadBroadcast(prev) &&
                        grouped(prev, row);
                      const threadTs = slackThreadTs(row.ts, row.threadTs) || row.ts;
                      return (
                        <div key={row.ts} data-slack-row={row.ts}>
                          {showDay ? (
                            <div className="slack-day">
                              <span>{dayLabel(row.ts)}</span>
                            </div>
                          ) : null}
                          <SlackMessageRow
                            message={row}
                            compact={compact}
                            you={Boolean(youId && row.userId === youId)}
                            youAvatar={youAvatar}
                            agent={Boolean(lastPostTs && row.ts === lastPostTs)}
                            activeThread={state.slackThreadTs === row.ts}
                            hover={hoverTs === row.ts}
                            emoji={emoji}
                            busy={busy}
                            inChannel
                            editing={editingTs === row.ts}
                            editDraft={editingTs === row.ts ? editDraft : undefined}
                            onEditDraft={setEditDraft}
                            onHover={setHoverTs}
                            onReply={() => dispatch({ type: "slackThread", ts: threadTs })}
                            onReact={(name) => void reactOn(row, name)}
                            onAsk={() => {
                              openAsk(threadTs);
                              dispatch({ type: "slackThread", ts: threadTs });
                            }}
                            onStartEdit={() => {
                              setEditingTs(row.ts);
                              setEditDraft(row.text);
                            }}
                            onSaveEdit={() => void saveEdit()}
                            onCancelEdit={() => setEditingTs(null)}
                            onDelete={() => void deleteOn(row)}
                            onCopyLink={() => copyLink(row)}
                          />
                        </div>
                      );
                    })}
                    <div className="list-window-spacer" style={{ height: slackWin.padBottom }} />
                  </>
                )}
              </div>
            </div>
            {channelScroll.showJump ? (
              <button
                type="button"
                className="jump-latest"
                data-testid="slack-jump-latest"
                onClick={() => channelScroll.pinToLatest()}
              >
                Jump to latest
              </button>
            ) : null}
          </div>
          <div className="slack-composer">
            {channelDraft &&
            (!state.slackThreadTs || threadDraftPending?.toolCallId !== channelDraft.toolCallId) &&
            bound ? (
              <SlackDraftSend session={bound} pending={channelDraft} busy={busy} />
            ) : null}
            {gifFor === "channel" ? (
              <SlackGifPicker
                onPick={(gif) => {
                  const text = draft;
                  clearChannelDraft();
                  setGifFor(null);
                  channelScroll.pinToLatest();
                  void send(text, undefined, gif);
                }}
                onClose={() => setGifFor(null)}
              />
            ) : null}
            {channelFile ? (
              <SlackAttachChip file={channelFile} onClear={() => setChannelFile(null)} />
            ) : null}
            <textarea
              ref={composer}
              value={draft}
              rows={2}
              placeholder={`Message ${label}`}
              onChange={(e) => {
                setDraft(e.target.value);
                setChannelCursor(e.target.selectionStart);
                setMentionIndex(0);
              }}
              onSelect={(e) => setChannelCursor(e.currentTarget.selectionStart)}
              onClick={(e) => setChannelCursor(e.currentTarget.selectionStart)}
              onKeyUp={(e) => setChannelCursor(e.currentTarget.selectionStart)}
              onKeyDown={(e) => onComposerKey(e)}
            />
            {channelMentionHits.length ? (
              <SlackMentionPicker
                users={channelMentionHits}
                active={mentionIndex}
                onPick={(user) => applyMention(user)}
              />
            ) : null}
            <div className="slack-composer-bar">
              <span className="hint">
                Enter to send · Attach · GIF · Shift+Enter for a new line
                {canPostAsBot ? "" : " · as you"}
              </span>
              <div className="row-actions">
                {canPostAsBot ? (
                  <SlackPostAsToggle
                    value={sendAs}
                    onChange={(next) => {
                      setPostAs(next);
                      saveLastSlackPostAs(next);
                    }}
                  />
                ) : null}
                <input
                  ref={channelFileInput}
                  type="file"
                  hidden
                  onChange={(e) => {
                    setChannelFile(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
                <button
                  className="btn small"
                  type="button"
                  disabled={busy}
                  onClick={() => channelFileInput.current?.click()}
                >
                  Attach
                </button>
                <button
                  className="btn small"
                  type="button"
                  disabled={busy}
                  onClick={() => setGifFor("channel")}
                >
                  GIF
                </button>
                <button
                  className="btn small primary"
                  disabled={busy || (!draft.trim() && !channelFile)}
                  onClick={() => {
                    const text = draft;
                    const file = channelFile;
                    clearChannelDraft();
                    setChannelFile(null);
                    channelScroll.pinToLatest();
                    void send(text, undefined, undefined, file);
                  }}
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
        {state.slackThreadTs ? (
          <div
            className="slack-thread-gutter"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize thread"
            aria-valuenow={threadWidth}
            aria-valuemin={SLACK_THREAD_WIDTH_MIN}
            aria-valuemax={SLACK_THREAD_WIDTH_MAX}
            onPointerDown={onThreadGutterDown}
          />
        ) : null}
        {state.slackThreadTs ? (
          <aside className="slack-drawer" aria-label="Thread">
            <div className="slack-drawer-head">
              <h3>Thread</h3>
              <SlackLocusChip session={threadBound} />
              {channel ? (
                <SlackListenButton
                  channelId={channel.id}
                  channelName={conversationBareName(channel)}
                  threadTs={state.slackThreadTs ?? undefined}
                />
              ) : null}
              <button
                className="btn icon ghost small"
                aria-label="Close thread"
                onClick={() => {
                  dispatch({ type: "slackThread", ts: null });
                  if (askThread) {
                    setAskOpen(false);
                    setAskThread(undefined);
                  }
                }}
              >
                ×
              </button>
            </div>
            <div className="slack-timeline-wrap">
              <div
                className="slack-timeline slack-thread-list"
                ref={threadScroll.ref}
                onScroll={threadScroll.onScroll}
              >
                <div className="slack-timeline-inner" ref={threadScroll.innerRef}>
                  {!repliesReady ? (
                    <SlackHistorySkeleton />
                  ) : (
                    (replies.length
                      ? replies
                      : topLevel.filter((row) => row.ts === state.slackThreadTs)
                    ).map((row, index, rows) => (
                      <SlackMessageRow
                        key={row.ts}
                        message={row}
                        compact={grouped(rows[index - 1], row)}
                        you={Boolean(youId && row.userId === youId)}
                        youAvatar={youAvatar}
                        agent={Boolean(lastPostTs && row.ts === lastPostTs)}
                        hover={hoverTs === row.ts}
                        emoji={emoji}
                        busy={busy}
                        editing={editingTs === row.ts}
                        editDraft={editingTs === row.ts ? editDraft : undefined}
                        onEditDraft={setEditDraft}
                        onHover={setHoverTs}
                        onReact={(name) => void reactOn(row, name)}
                        onAsk={() => openAsk(state.slackThreadTs ?? row.ts)}
                        onStartEdit={() => {
                          setEditingTs(row.ts);
                          setEditDraft(row.text);
                        }}
                        onSaveEdit={() => void saveEdit()}
                        onCancelEdit={() => setEditingTs(null)}
                        onDelete={() => void deleteOn(row)}
                        onCopyLink={() => copyLink(row)}
                      />
                    ))
                  )}
                </div>
              </div>
              {threadScroll.showJump ? (
                <button
                  type="button"
                  className="jump-latest"
                  data-testid="slack-thread-jump-latest"
                  onClick={() => threadScroll.pinToLatest()}
                >
                  Jump to latest
                </button>
              ) : null}
            </div>
            {askOpen && askThread ? (
              <AskLocusForm
                placement="thread"
                context={`Thread · ${label}`}
                value={askText}
                busy={busy}
                providers={providers}
                providerId={askProviderId}
                model={askModel}
                onChange={setAskText}
                onModelChange={(next) => {
                  setAskProviderId(next.providerId);
                  setAskModel(next.model);
                }}
                onSubmit={() => void runAsk(askText, askThread)}
                onRecipe={(recipeId, text) => void runAsk(text, askThread, { recipeId })}
                onStop={() => void runAsk("stop", askThread)}
                canStop={slackSessionCanStop(
                  liveSlackSession(state.sessions, channel?.id, askThread),
                )}
                onCancel={() => {
                  setAskOpen(false);
                  setAskThread(undefined);
                }}
              />
            ) : null}
            <div className="slack-composer">
              {threadDraftPending && threadBound ? (
                <SlackDraftSend session={threadBound} pending={threadDraftPending} busy={busy} />
              ) : null}
              {gifFor === "thread" ? (
                <SlackGifPicker
                  onPick={(gif) => {
                    const text = threadDraft;
                    clearThreadDraft();
                    setGifFor(null);
                    threadScroll.pinToLatest();
                    void send(text, state.slackThreadTs ?? undefined, gif);
                  }}
                  onClose={() => setGifFor(null)}
                />
              ) : null}
              {threadFile ? (
                <SlackAttachChip file={threadFile} onClear={() => setThreadFile(null)} />
              ) : null}
              <textarea
                ref={threadComposer}
                value={threadDraft}
                rows={2}
                placeholder={`Reply in ${label}`}
                onChange={(e) => {
                  setThreadDraft(e.target.value);
                  setThreadCursor(e.target.selectionStart);
                  setMentionIndex(0);
                }}
                onSelect={(e) => setThreadCursor(e.currentTarget.selectionStart)}
                onClick={(e) => setThreadCursor(e.currentTarget.selectionStart)}
                onKeyUp={(e) => setThreadCursor(e.currentTarget.selectionStart)}
                onKeyDown={(e) => onComposerKey(e, state.slackThreadTs ?? undefined)}
              />
              {threadMentionHits.length ? (
                <SlackMentionPicker
                  users={threadMentionHits}
                  active={mentionIndex}
                  onPick={(user) => applyMention(user, state.slackThreadTs ?? undefined)}
                />
              ) : null}
              <div className="slack-composer-bar">
                <label className="slack-also-send">
                  <input
                    type="checkbox"
                    checked={alsoSend}
                    onChange={(e) => setAlsoSend(e.target.checked)}
                    data-testid="slack-also-channel"
                  />
                  Also send to channel
                </label>
                <div className="row-actions">
                  {canPostAsBot ? (
                    <SlackPostAsToggle
                      value={sendAs}
                      onChange={(next) => {
                        setPostAs(next);
                        saveLastSlackPostAs(next);
                      }}
                    />
                  ) : null}
                  <button
                    className="btn small"
                    disabled={busy}
                    onClick={() => openAsk(state.slackThreadTs ?? undefined)}
                  >
                    Ask Locus
                  </button>
                  <input
                    ref={threadFileInput}
                    type="file"
                    hidden
                    onChange={(e) => {
                      setThreadFile(e.target.files?.[0] ?? null);
                      e.target.value = "";
                    }}
                  />
                  <button
                    className="btn small"
                    type="button"
                    disabled={busy}
                    onClick={() => threadFileInput.current?.click()}
                  >
                    Attach
                  </button>
                  <button
                    className="btn small"
                    type="button"
                    disabled={busy}
                    onClick={() => setGifFor("thread")}
                  >
                    GIF
                  </button>
                </div>
                <button
                  className="btn small primary"
                  disabled={busy || (!threadDraft.trim() && !threadFile)}
                  onClick={() => {
                    const text = threadDraft;
                    const file = threadFile;
                    clearThreadDraft();
                    setThreadFile(null);
                    setAlsoSend(false);
                    threadScroll.pinToLatest();
                    void send(text, state.slackThreadTs ?? undefined, undefined, file, alsoSend);
                  }}
                >
                  Reply
                </button>
              </div>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function AskLocusForm(props: {
  placement: "channel" | "thread";
  context?: string;
  value: string;
  busy: boolean;
  providers: AiProvider[];
  providerId: string;
  model: string;
  canStop?: boolean;
  onChange: (value: string) => void;
  onModelChange: (next: { providerId: string; model: string }) => void;
  onSubmit: () => void;
  onRecipe?: (recipeId: string, text: string) => void;
  onStop?: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className={`slack-ask slack-ask--${props.placement}`}
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit();
      }}
    >
      <div className="slack-ask-head">
        <span className="slack-ask-title">Ask Locus</span>
        {props.context ? <span className="slack-ask-context">{props.context}</span> : null}
      </div>
      {props.onRecipe ? (
        <div className="slack-ask-recipes" data-testid="slack-ask-recipes">
          {SLACK_WORK_RECIPES.map((row) => (
            <button
              key={row.recipeId}
              className="btn small"
              type="button"
              disabled={props.busy}
              data-testid="slack-ask-recipe"
              data-recipe={row.recipeId}
              onClick={() => props.onRecipe?.(row.recipeId, row.text)}
            >
              {row.label}
            </button>
          ))}
        </div>
      ) : null}
      <input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={
          props.placement === "thread"
            ? "What should Locus do from this thread?"
            : "What should Locus do in this channel?"
        }
        autoFocus
      />
      <div className="slack-ask-bar">
        {props.providers.length ? (
          <ModelPicker
            compact
            providers={props.providers}
            providerId={props.providerId}
            model={props.model}
            disabled={props.busy}
            onChange={props.onModelChange}
          />
        ) : null}
        <div className="slack-ask-actions">
          <button className="btn small" type="button" onClick={props.onCancel}>
            Cancel
          </button>
          {props.canStop && props.onStop ? (
            <button
              className="btn small"
              type="button"
              disabled={props.busy}
              onClick={props.onStop}
            >
              Stop
            </button>
          ) : null}
          <button
            className="btn small primary"
            disabled={props.busy || !props.value.trim()}
            type="submit"
          >
            Run
          </button>
        </div>
      </div>
    </form>
  );
}

function SlackGifPicker(props: { onPick: (gif: SlackGifHit) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SlackGifHit[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        setBusy(true);
        void api.slackGiphy(query).then(
          (result) => {
            if (cancelled) return;
            setHits(result.hits);
            setNotice(result.notice ?? null);
            setError(null);
            setBusy(false);
          },
          (err: unknown) => {
            if (cancelled) return;
            setError(err instanceof Error ? err.message : "Could not load GIFs");
            setBusy(false);
          },
        );
      },
      query.trim() ? 280 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="slack-gif-picker" role="dialog" aria-label="GIF search">
      <div className="slack-gif-head">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search GIFs"
          autoFocus
        />
        <button className="btn small" type="button" onClick={props.onClose}>
          Close
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {!error && notice ? <p className="hint slack-gif-notice">{notice}</p> : null}
      <div className="slack-gif-grid" aria-busy={busy}>
        {hits.map((gif) => (
          <button
            key={gif.id}
            type="button"
            className="slack-gif-hit"
            title={gif.title}
            onClick={() => props.onPick(gif)}
          >
            <img src={gif.preview} alt={gif.title} />
          </button>
        ))}
        {busy && hits.length === 0 ? <p className="hint">Loading GIFs…</p> : null}
        {!busy && hits.length === 0 ? <p className="hint">No GIFs for that search.</p> : null}
      </div>
    </div>
  );
}

export function SlackMentionPicker(props: {
  users: SlackMentionUser[];
  active: number;
  onPick: (user: SlackMentionUser) => void;
}) {
  return (
    <ul
      className="slack-mention-picker"
      role="listbox"
      aria-label="Mention someone"
      data-testid="slack-mention-picker"
    >
      {props.users.map((user, index) => (
        <li key={user.id}>
          <button
            type="button"
            role="option"
            aria-selected={index === props.active}
            className={`slack-mention-hit${index === props.active ? " active" : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              props.onPick(user);
            }}
          >
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" />
            ) : (
              <span>{user.name.slice(0, 1)}</span>
            )}
            <strong>@{user.name}</strong>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function SlackAlertToasts({
  items,
  mentionNames,
  onOpen,
  onDismiss,
}: {
  items: SlackActivityItem[];
  mentionNames?: ReadonlyMap<string, string>;
  onOpen: (item: SlackActivityItem) => void;
  onDismiss: (id: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="slack-toasts" data-testid="slack-toasts" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className="slack-toast" data-testid="slack-toast">
          <button type="button" className="slack-toast-open" onClick={() => onOpen(item)}>
            <strong>{slackActivityHeadline(item)}</strong>
            <span>{slackAlertBody(item, mentionNames)}</span>
          </button>
          <button
            type="button"
            className="slack-toast-dismiss"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(item.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function SlackHistorySkeleton() {
  return (
    <div className="slack-history-skeleton" data-testid="slack-history-skeleton" aria-busy="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div className="slack-skel-row" key={i}>
          <span className="skeleton slack-skel-avatar" />
          <div className="slack-skel-body">
            <span className="skeleton line" />
            <span className="skeleton line wide" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SlackChannelListSkeleton() {
  return (
    <div className="slack-list-skeleton" data-testid="slack-channel-list-skeleton" aria-busy="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div className="slack-list-skel-row" key={i}>
          <span className="skeleton slack-list-skel-mark" />
          <div className="slack-list-skel-body">
            <span className="skeleton line" />
            <span className="skeleton line wide" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SlackMessageRow(props: {
  message: SlackMessage;
  compact: boolean;
  you: boolean;
  youAvatar?: string;
  agent: boolean;
  activeThread?: boolean;
  hover: boolean;
  emoji: SlackEmojiMap;
  busy?: boolean;
  inChannel?: boolean;
  editing?: boolean;
  editDraft?: string;
  onEditDraft?: (text: string) => void;
  onHover: (ts: string | null) => void;
  onReply?: () => void;
  onReact: (name: string) => void;
  onAsk: () => void;
  onStartEdit?: () => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
  onDelete?: () => void;
  onCopyLink?: () => void;
}) {
  const [reactOpen, setReactOpen] = useState(false);
  const articleRef = useRef<HTMLElement>(null);
  const name = props.you ? "You" : props.message.userName || props.message.userId || "someone";
  const color = hue(props.message.userName || props.message.userId || name);
  const showActions = props.hover || reactOpen;
  const photo = props.message.avatarUrl || (props.you ? props.youAvatar : undefined);
  const broadcast = Boolean(props.inChannel && isSlackThreadBroadcast(props.message));

  useEffect(() => {
    if (!reactOpen) return;
    function onPointer(e: PointerEvent) {
      if (articleRef.current?.contains(e.target as Node)) return;
      setReactOpen(false);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setReactOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [reactOpen]);

  return (
    <article
      ref={articleRef}
      className={`slack-msg${props.compact ? " compact" : ""}${props.you ? " you" : ""}${props.activeThread ? " thread-open" : ""}${broadcast ? " broadcast" : ""}`}
      onMouseEnter={() => props.onHover(props.message.ts)}
      onMouseLeave={() => {
        if (!reactOpen) props.onHover(null);
      }}
    >
      <span
        className="slack-avatar"
        style={props.compact ? undefined : { background: `hsl(${color} 28% 28%)` }}
        aria-hidden
      >
        {props.compact ? null : photo ? <img src={photo} alt="" /> : initials(name)}
      </span>
      <div className="slack-msg-body">
        {broadcast ? (
          <button
            type="button"
            className="slack-broadcast"
            data-testid="slack-also-sent"
            onClick={props.onReply}
          >
            <span className="slack-broadcast-icon" aria-hidden>
              <IconHash />
            </span>
            Also sent to the channel
          </button>
        ) : null}
        {props.compact ? null : (
          <div className="slack-msg-meta">
            <strong className="slack-msg-name">{name}</strong>
            <time>{formatSlackTs(props.message.ts)}</time>
            {props.agent ? <span className="slack-agent-chip">agent</span> : null}
          </div>
        )}
        {props.compact && props.agent ? <span className="slack-agent-chip">agent</span> : null}
        {props.editing ? (
          <div className="slack-edit">
            <textarea
              value={props.editDraft ?? ""}
              rows={3}
              autoFocus
              data-testid="slack-edit-field"
              onChange={(e) => props.onEditDraft?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  props.onSaveEdit?.();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  props.onCancelEdit?.();
                }
              }}
            />
            <div className="row-actions">
              <button className="btn small" type="button" onClick={props.onCancelEdit}>
                Cancel
              </button>
              <button
                className="btn small primary"
                type="button"
                disabled={props.busy || !props.editDraft?.trim()}
                onClick={props.onSaveEdit}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <SlackBody
            text={props.message.text}
            files={props.message.files}
            emoji={props.emoji}
            channelId={props.message.channelId}
          />
        )}
        {props.message.reactions?.length || reactOpen ? (
          <div className="slack-reactions">
            {props.message.reactions?.map((row) => (
              <button
                key={row.name}
                type="button"
                className={`slack-reaction${row.mine ? " mine" : ""}`}
                disabled={props.busy}
                title={row.mine ? `Remove :${row.name}:` : `React with :${row.name}:`}
                aria-pressed={Boolean(row.mine)}
                onClick={() => props.onReact(row.name)}
              >
                <SlackReactionGlyph name={row.name} emoji={props.emoji} />
                {row.count}
              </button>
            ))}
            <button
              type="button"
              className="slack-reaction slack-reaction-add"
              disabled={props.busy}
              aria-label="Add reaction"
              title="Add reaction"
              onClick={(e) => {
                e.stopPropagation();
                setReactOpen((open) => !open);
              }}
            >
              +
            </button>
          </div>
        ) : null}
        {props.message.replyCount && !broadcast ? (
          <button className="slack-thread-count" type="button" onClick={props.onReply}>
            {props.message.replyCount} {props.message.replyCount === 1 ? "reply" : "replies"}
          </button>
        ) : null}
      </div>
      {showActions ? (
        <div className="slack-msg-actions">
          {props.onReply ? (
            <button className="btn small" type="button" onClick={props.onReply}>
              Reply
            </button>
          ) : null}
          <button
            className="btn small"
            type="button"
            disabled={props.busy}
            onClick={(e) => {
              e.stopPropagation();
              setReactOpen((open) => !open);
            }}
          >
            React
          </button>
          <button className="btn small" type="button" onClick={props.onAsk}>
            Ask Locus
          </button>
          {props.onCopyLink ? (
            <button
              className="btn small"
              type="button"
              data-testid="slack-copy-link"
              onClick={props.onCopyLink}
            >
              Copy link
            </button>
          ) : null}
          {props.you && props.onStartEdit ? (
            <button
              className="btn small"
              type="button"
              data-testid="slack-edit"
              disabled={props.busy}
              onClick={props.onStartEdit}
            >
              Edit
            </button>
          ) : null}
          {props.you && props.onDelete ? (
            <button
              className="btn small"
              type="button"
              data-testid="slack-delete"
              disabled={props.busy}
              onClick={props.onDelete}
            >
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
      {reactOpen ? (
        <SlackReactionPicker
          emoji={props.emoji}
          mine={new Set(props.message.reactions?.filter((row) => row.mine).map((row) => row.name))}
          disabled={props.busy}
          onPick={(name) => {
            props.onReact(name);
            setReactOpen(false);
          }}
          onClose={() => setReactOpen(false)}
        />
      ) : null}
    </article>
  );
}

function SlackReactionGlyph({ name, emoji }: { name: string; emoji: SlackEmojiMap }) {
  const key = normalizeSlackReactionName(name);
  if (!key) return <span className="slack-reaction-emoji">:{name}:</span>;
  return (
    <span
      className="slack-reaction-emoji"
      dangerouslySetInnerHTML={{
        __html: applySlackEmoji(`:${key}:`, emoji) || `:${key}:`,
      }}
    />
  );
}

function SlackReactionPicker(props: {
  emoji: SlackEmojiMap;
  mine: Set<string>;
  disabled?: boolean;
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const names = useMemo(() => listSlackReactionNames(props.emoji, query), [props.emoji, query]);
  return (
    <div className="slack-react-picker" role="dialog" aria-label="Choose a reaction">
      <div className="slack-react-head">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search emoji"
          autoFocus
        />
        <button className="btn small" type="button" onClick={props.onClose}>
          Close
        </button>
      </div>
      <div className="slack-react-grid">
        {names.map((name) => (
          <button
            key={name}
            type="button"
            className={`slack-react-hit${props.mine.has(name) ? " mine" : ""}`}
            title={`:${name}:`}
            disabled={props.disabled}
            onClick={() => props.onPick(name)}
          >
            <SlackReactionGlyph name={name} emoji={props.emoji} />
          </button>
        ))}
        {names.length === 0 ? <p className="hint">No emoji for that search.</p> : null}
      </div>
    </div>
  );
}

export function pickDefaultSlackChannel(
  rows: SlackConversation[],
  remembered?: string | null,
): string | undefined {
  if (remembered && rows.some((row) => row.id === remembered)) return remembered;
  return (
    rows.find((row) => row.unread)?.id ??
    rows.find((row) => row.starred)?.id ??
    rows.find((row) => !isDirectConversation(row.kind))?.id ??
    rows[0]?.id
  );
}

export function slackChannelGroups(rows: SlackConversation[]): Array<{
  id: SlackSidebarGroupId;
  label: string;
  items: SlackConversation[];
}> {
  const unreads = rows.filter((row) => row.unread);
  const starred = rows.filter((row) => row.starred);
  const channels = rows.filter((row) => !isDirectConversation(row.kind));
  const dms = rows.filter((row) => isDirectConversation(row.kind));
  const groups: Array<{
    id: SlackSidebarGroupId;
    label: string;
    items: SlackConversation[];
  }> = [
    { id: "unreads", label: "Unreads", items: unreads },
    { id: "starred", label: "Starred", items: starred },
    { id: "channels", label: "Channels", items: channels },
    { id: "dms", label: "Direct messages", items: dms },
  ];
  return groups.filter((group) => group.items.length > 0);
}
