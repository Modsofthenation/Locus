import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  applySlackEmoji,
  conversationLabel,
  formatSlackTs,
  isSlackChannelMessage,
  isSlackThreadBroadcast,
  listSlackReactionNames,
  normalizeSlackReactionName,
  parseSlackPostAs,
  slackActivityHeadline,
  slackActivityPreview,
  slackActivityMentionNames,
  slackClientReady,
  slackThreadTs,
  mergeSlackMessageRows,
  mergeSlackThreadReplies,
  withSlackPostedThread,
  type SlackConversation,
  type SlackEmojiMap,
  type SlackMessage,
  type SlackPostAs,
} from "@locus/shared";
import { api } from "@/lib/api";
import { useStore } from "@/state/store";
import { clipOnWords, matchesMobileQuery } from "@/lib/mobileShell";
import { LAST_SLACK_POST_AS_KEY, SlackBody, slackWorkspaceBooting } from "./Slack";
import { IconLock, IconMore, IconSend } from "@/components/layout/Icons";
import { Mascot } from "@/components/layout/Mascot";
import { MobileFitPane } from "@/components/layout/MobileFitPane";
import { useDialogFocus } from "@/lib/useDialogFocus";
import { observePinThreadToLatest } from "@/lib/threadScroll";

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

function initials(name: string | undefined): string {
  const trimmed = (name ?? "?").trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
  return trimmed.slice(0, 2).toUpperCase() || "?";
}

export function slackUnreadCount(rows: SlackConversation[]): number {
  return rows.filter((row) => row.unread).length;
}

function mobileSlackGroups(rows: SlackConversation[]): Array<{
  id: string;
  label: string;
  items: SlackConversation[];
}> {
  const unreads = rows.filter((row) => row.unread);
  const starred = rows.filter((row) => row.starred);
  const channels = rows.filter((row) => row.kind === "channel" || row.kind === "private");
  const dms = rows.filter((row) => row.kind === "im" || row.kind === "mpim");
  return [
    { id: "unreads", label: "Unreads", items: unreads },
    { id: "starred", label: "Starred", items: starred },
    { id: "channels", label: "Channels", items: channels },
    { id: "dms", label: "Direct messages", items: dms },
  ].filter((group) => group.items.length > 0);
}

export function MobileSlackList(props: { query?: string }) {
  const { state, dispatch } = useStore();
  const [error, setError] = useState<string | null>(null);
  const slackAccount = (state.config?.integrations ?? []).find((row) => slackClientReady(row));
  const connected = Boolean(state.slackStatus?.connected || slackAccount);
  const booting = slackWorkspaceBooting({
    slackStatus: state.slackStatus,
    slackConversations: state.slackConversations,
    slackCatalogLoaded: state.slackCatalogLoaded,
    integrations: state.config?.integrations,
  });
  const query = props.query ?? "";
  const filtered = state.slackConversations.filter((row) =>
    matchesMobileQuery(`${conversationLabel(row)} ${row.topic ?? ""}`, query),
  );
  const groups = mobileSlackGroups(filtered);
  const who = state.slackStatus?.userName?.trim();
  const activity = state.slackActivity;
  const mentionNames = slackActivityMentionNames(state.slackStatus);

  useEffect(() => {
    dispatch({ type: "selectSlackActivity" });
  }, [dispatch]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const status = await api.slackStatus();
        if (cancelled) return;
        if (!status.connected) {
          dispatch({ type: "slackStatus", status });
          dispatch({ type: "slackConversations", conversations: [] });
          setError(null);
          return;
        }
        const conversations = await api.slackConversations();
        if (cancelled) return;
        dispatch({ type: "slackStatus", status });
        dispatch({ type: "slackConversations", conversations });
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load Slack");
        dispatch({ type: "slackStatus", status: { connected: false, socket: "down" } });
        dispatch({ type: "slackCatalogLoaded" });
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [dispatch]);

  if (booting) {
    return <p className="hint mobile-slack-hint">Loading workspace…</p>;
  }

  if (!connected) {
    return (
      <div className="mobile-empty" data-testid="mobile-slack-signed-out">
        <Mascot pose="rest" size={64} />
        <h2>Sign in as yourself</h2>
        <p>
          Slack sign-in lives on the desktop under Settings → Integrations. After that, this phone
          can read channels and send as you.
        </p>
        {error ? <p className="mobile-error">{error}</p> : null}
      </div>
    );
  }

  if (!groups.length && !activity.length) {
    return (
      <div className="mobile-empty">
        <Mascot pose="idle" size={64} />
        <h2>No conversations</h2>
        <p>
          Unreads, starred, channels, and DMs show up here once Slack has synced on this computer
          {who ? ` (${who})` : ""}.
        </p>
      </div>
    );
  }

  return (
    <div className="mobile-slack-list" data-testid="mobile-slack-list">
      {error ? <p className="mobile-error">{error}</p> : null}
      {activity.length ? (
        <section className="mobile-day">
          <h2>Activity</h2>
          <ul className="mobile-list">
            {activity.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="mobile-row"
                  onClick={() => {
                    dispatch({ type: "selectSlackChannel", id: item.channelId });
                    if (item.kind === "mention" || item.kind === "thread") {
                      dispatch({ type: "slackThread", ts: item.threadTs || item.ts });
                    }
                  }}
                >
                  <span
                    className={`mobile-status-dot${state.slackActivityUnseen ? " is-running" : " is-idle"}`}
                    aria-hidden="true"
                  />
                  <span className="mobile-row-main">
                    <span className="mobile-row-head">
                      <span className="mobile-row-title">{slackActivityHeadline(item)}</span>
                      <span className="mobile-row-time">{formatSlackTs(item.ts)}</span>
                    </span>
                    <span className="mobile-row-sub">
                      {clipOnWords(slackActivityPreview(item.text, mentionNames), 72)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {groups.map((group) => (
        <section key={group.id} className="mobile-day">
          <h2>{group.label}</h2>
          <ul className="mobile-list">
            {group.items.map((row) => {
              const locked = row.kind === "private";
              const preview = clipOnWords(row.topic || slackKindLabel(row), 72);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    className="mobile-row"
                    onClick={() => dispatch({ type: "selectSlackChannel", id: row.id })}
                  >
                    <span
                      className={`mobile-status-dot${row.unread ? " is-running" : " is-idle"}`}
                      aria-hidden="true"
                    />
                    <span className="mobile-row-main">
                      <span className="mobile-row-head">
                        <span className="mobile-row-title">
                          {locked ? (
                            <span className="mobile-lock" aria-hidden="true">
                              <IconLock />
                            </span>
                          ) : null}
                          {conversationLabel(row)}
                        </span>
                        {row.lastTs ? (
                          <span className={`mobile-row-time${row.unread ? " is-now" : ""}`}>
                            {formatSlackTs(row.lastTs)}
                          </span>
                        ) : null}
                      </span>
                      <span className="mobile-row-sub">{preview}</span>
                      {row.unread ? <span className="mobile-row-mono is-live">unread</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function slackKindLabel(row: SlackConversation): string {
  if (row.kind === "im") return "Direct message";
  if (row.kind === "mpim") return "Group DM";
  if (row.kind === "private") return "Private channel";
  return "Channel";
}

export function MobileSlackChat(props: { onBack: () => void }) {
  const { state, dispatch } = useStore();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [replies, setReplies] = useState<SlackMessage[]>([]);
  const [emoji, setEmoji] = useState<SlackEmojiMap>({});
  const [historyReady, setHistoryReady] = useState(false);
  const [repliesReady, setRepliesReady] = useState(false);
  const [postAs, setPostAs] = useState<SlackPostAs>(loadLastSlackPostAs);
  const [reactFor, setReactFor] = useState<string | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const slackAccount = (state.config?.integrations ?? []).find((row) => slackClientReady(row));
  const connected = Boolean(state.slackStatus?.connected || slackAccount);
  const canPostAsBot = Boolean(state.slackStatus?.canPostAsBot);
  const sendAs: SlackPostAs = canPostAsBot ? postAs : "user";
  const channel = state.slackConversations.find((row) => row.id === state.selectedSlackChannelId);
  const label = channel ? conversationLabel(channel) : "Slack";
  const youId = state.slackStatus?.userId || slackAccount?.userId;
  const youAvatar =
    state.slackStatus?.avatarUrl ||
    state.slackMessages.find((row) => row.userId === youId && row.avatarUrl)?.avatarUrl;
  const topLevel = useMemo(
    () => state.slackMessages.filter((row) => isSlackChannelMessage(row)),
    [state.slackMessages],
  );
  const threadTs = state.slackThreadTs;
  const inThread = Boolean(threadTs);
  const shown = inThread
    ? replies.length
      ? replies
      : topLevel.filter((row) => row.ts === threadTs)
    : topLevel;

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
    let cancelled = false;
    setHistoryReady(false);
    void api.slackHistory(id).then(
      (messages) => {
        if (cancelled) return;
        dispatch({ type: "slackMessages", messages });
        setHistoryReady(true);
        setError(null);
        const ts = messages.at(-1)?.ts;
        void api.slackMarkRead(id, ts).then(
          (conversations) => {
            if (conversations.length) dispatch({ type: "slackConversations", conversations });
          },
          () => undefined,
        );
      },
      (err) => {
        if (cancelled) return;
        setHistoryReady(true);
        setError(err instanceof Error ? err.message : "Could not load messages");
      },
    );
    return () => {
      cancelled = true;
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
          setError("Could not load thread");
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

  useLayoutEffect(() => {
    return observePinThreadToLatest(thread.current);
  }, [shown.length, threadTs, historyReady, repliesReady]);

  async function send() {
    const id = state.selectedSlackChannelId;
    const text = draft.trim();
    if (!id || !text || busy) return;
    setBusy(true);
    setError(null);
    setDraft("");
    try {
      const posted = await api.slackPost(id, text, threadTs ?? undefined, undefined, sendAs);
      const message = withSlackPostedThread(posted, { threadTs: threadTs ?? undefined });
      dispatch({ type: "slackMessage", message });
      if (threadTs) {
        setReplies((rows) => mergeSlackMessageRows(rows, [message]));
        setRepliesReady(true);
      }
    } catch (err) {
      setDraft(text);
      setError(err instanceof Error ? err.message : "Could not send");
    } finally {
      setBusy(false);
    }
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
      setReactFor(null);
    }
  }

  function back() {
    if (threadTs) {
      dispatch({ type: "slackThread", ts: null });
      setReactFor(null);
      return;
    }
    props.onBack();
  }

  const loading = inThread ? !repliesReady : !historyReady;
  const reactMessage = shown.find((row) => row.ts === reactFor);

  return (
    <div className="mobile-screen" data-testid="mobile-slack-chat">
      <header className="mobile-top is-thread">
        <button type="button" className="mobile-icon-btn mobile-back" onClick={back}>
          Back
        </button>
        <div className="mobile-top-title">
          <h1 className="mobile-slack-channel">
            {!inThread && channel?.kind === "private" ? <IconLock /> : null}
            {inThread ? "Thread" : label}
          </h1>
          <p className="mobile-top-meta">
            {inThread
              ? label
              : `slack${channel?.memberCount ? ` / ${channel.memberCount} members` : ""}`}
          </p>
        </div>
        <button type="button" className="mobile-icon-btn" aria-label="More">
          <IconMore />
        </button>
      </header>
      <div className="mobile-thread" ref={thread}>
        {error ? (
          <div className="mobile-banner" role="status">
            {error}
          </div>
        ) : null}
        {loading ? <p className="hint">Loading messages…</p> : null}
        {!loading && shown.length === 0 ? (
          <p className="hint">
            {inThread ? "No replies yet." : "No messages yet. Say something as you."}
          </p>
        ) : null}
        {shown.map((row) => {
          const name =
            youId && row.userId === youId ? "You" : row.userName || row.userId || "someone";
          const photo = row.avatarUrl || (youId && row.userId === youId ? youAvatar : undefined);
          const threadId = slackThreadTs(row.ts, row.threadTs) || row.ts;
          const broadcast = Boolean(!inThread && isSlackThreadBroadcast(row));
          return (
            <article className="mobile-slack-msg" key={row.ts}>
              <span className="mobile-slack-face" aria-hidden="true">
                {photo ? <img src={photo} alt="" /> : initials(name)}
              </span>
              <div className="mobile-slack-copy">
                {broadcast ? (
                  <button
                    type="button"
                    className="mobile-slack-broadcast"
                    onClick={() => dispatch({ type: "slackThread", ts: threadId })}
                  >
                    Also sent to the channel
                  </button>
                ) : null}
                <div className="mobile-slack-meta">
                  <strong>{name}</strong>
                  <time>{formatSlackTs(row.ts)}</time>
                  {row.agent ? <span className="mobile-pill">agent</span> : null}
                </div>
                <MobileFitPane>
                  <SlackBody text={row.text} files={row.files} emoji={emoji} />
                </MobileFitPane>
                {row.reactions?.length ? (
                  <div className="mobile-slack-reactions">
                    {row.reactions.map((reaction) => (
                      <button
                        key={reaction.name}
                        type="button"
                        className={`mobile-slack-reaction${reaction.mine ? " mine" : ""}`}
                        disabled={busy}
                        onClick={() => void reactOn(row, reaction.name)}
                      >
                        <span
                          dangerouslySetInnerHTML={{
                            __html:
                              applySlackEmoji(
                                `:${normalizeSlackReactionName(reaction.name) || reaction.name}:`,
                                emoji,
                              ) || `:${reaction.name}:`,
                          }}
                        />
                        {reaction.count}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="mobile-slack-msg-actions">
                  {!inThread && !broadcast ? (
                    <button
                      type="button"
                      className="mobile-slack-link"
                      onClick={() => dispatch({ type: "slackThread", ts: threadId })}
                    >
                      {row.replyCount
                        ? `${row.replyCount} ${row.replyCount === 1 ? "reply" : "replies"}`
                        : "Reply"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="mobile-slack-link"
                    disabled={busy}
                    onClick={() => setReactFor(reactFor === row.ts ? null : row.ts)}
                  >
                    React
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {reactMessage ? (
        <MobileSlackReactPicker
          emoji={emoji}
          busy={busy}
          onPick={(name) => void reactOn(reactMessage, name)}
          onClose={() => setReactFor(null)}
        />
      ) : null}
      <form
        className={`mobile-composer${canPostAsBot ? " is-slack" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {canPostAsBot ? (
          <div className="mobile-send-as">
            <span className="mobile-send-as-label">Send as</span>
            <button
              type="button"
              className={sendAs === "user" ? "on" : ""}
              aria-pressed={sendAs === "user"}
              onClick={() => {
                setPostAs("user");
                saveLastSlackPostAs("user");
              }}
            >
              You
            </button>
            <button
              type="button"
              className={sendAs === "bot" ? "on" : ""}
              aria-pressed={sendAs === "bot"}
              data-testid="slack-post-as"
              onClick={() => {
                setPostAs("bot");
                saveLastSlackPostAs("bot");
              }}
            >
              <Mascot size={14} />
              Locus
            </button>
          </div>
        ) : null}
        <div className="mobile-composer-bar">
          <textarea
            className="mobile-input"
            rows={1}
            placeholder={inThread ? `Reply in ${label}` : `Message ${label}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="submit"
            className="mobile-icon-btn mobile-new mobile-send"
            disabled={busy || !draft.trim()}
            aria-label={inThread ? "Reply" : "Send"}
          >
            <IconSend up />
            <span className="mobile-sr">{inThread ? "Reply" : "Send"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}

function MobileSlackReactPicker(props: {
  emoji: SlackEmojiMap;
  busy: boolean;
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const names = useMemo(() => listSlackReactionNames(props.emoji, query), [props.emoji, query]);
  useDialogFocus(true, props.onClose, dialogRef);
  return (
    <div
      className="mobile-slack-picker"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a reaction"
      ref={dialogRef}
    >
      <div className="mobile-slack-picker-head">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search emoji"
          autoFocus
        />
        <button type="button" className="mobile-icon-btn" onClick={props.onClose}>
          Close
        </button>
      </div>
      <div className="mobile-slack-picker-grid">
        {names.slice(0, 48).map((name) => (
          <button
            key={name}
            type="button"
            disabled={props.busy}
            title={`:${name}:`}
            onClick={() => props.onPick(name)}
          >
            <span
              dangerouslySetInnerHTML={{
                __html: applySlackEmoji(`:${name}:`, props.emoji) || `:${name}:`,
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
