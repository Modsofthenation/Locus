import { wrapUntrusted } from "../untrusted.js";
import { forgeOauthCallbackUrl } from "./git.js";
import type { IntegrationAccount } from "./integration.js";
import type { AiProvider } from "./provider.js";
import { parseForgePullUrl, type SessionSubscription } from "./subscribe.js";
import type { AgentRuntime } from "./vm.js";

export const SLACK_USER_SCOPES = [
  "channels:history",
  "channels:read",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "mpim:history",
  "mpim:read",
  "chat:write",
  "users:read",
  "files:read",
  "files:write",
  "emoji:read",
  "reactions:write",
  "search:read",
] as const;

export type SlackSearchHit = {
  channelId: string;
  channelName?: string;
  ts: string;
  threadTs?: string;
  text: string;
  userName?: string;
};

export type SlackActivityKind = "mention" | "thread" | "dm" | "unread";

export interface SlackActivityItem {
  id: string;
  kind: SlackActivityKind;
  channelId: string;
  channelName?: string;
  ts: string;
  threadTs?: string;
  text: string;
  userName?: string;
}

/** Slack search query for mentions of the signed-in user. */
export const SLACK_ACTIVITY_QUERY = "@me";

export function isSlackMentionQuery(query: string, userId?: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (q === "@me") return true;
  if (userId && q === `<@${userId.toLowerCase()}>`) return true;
  return false;
}

export function parseSlackActivityItem(raw: unknown): SlackActivityItem | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const channelId = str(value.channelId) || str(value.channel);
  const ts = str(value.ts);
  if (!channelId || !ts) return undefined;
  const kind = parseSlackActivityKind(value.kind);
  const threadTs = str(value.threadTs) || str(value.thread_ts);
  return {
    id: str(value.id) || `${channelId}:${ts}`,
    kind,
    channelId,
    channelName: str(value.channelName),
    ts,
    threadTs,
    text: str(value.text) ?? "",
    userName: str(value.userName) || str(value.username),
  };
}

function parseSlackActivityKind(raw: unknown): SlackActivityKind {
  if (raw === "thread" || raw === "dm" || raw === "unread" || raw === "mention") return raw;
  return "mention";
}

export function slackActivityHeadline(item: SlackActivityItem): string {
  const who = item.userName?.trim() || "Someone";
  const channel = item.channelName?.replace(/^[@#]/, "").trim();
  if (item.kind === "dm") {
    if (item.userName?.trim() && channel) return `${item.userName.trim()} in @${channel}`;
    if (item.userName?.trim()) return item.userName.trim();
    return channel ? `@${channel}` : "Direct message";
  }
  if (item.kind === "unread") return channel ? `Unread in #${channel}` : "Unread messages";
  if (item.kind === "thread") {
    return channel ? `${who} replied in #${channel}` : `${who} replied in a thread`;
  }
  return channel ? `${who} mentioned you in #${channel}` : `${who} mentioned you`;
}

/** Desktop / in-app toast body: message preview, or a short fallback. */
export function slackAlertBody(
  item: SlackActivityItem,
  names?: ReadonlyMap<string, string>,
): string {
  const preview = slackActivityPreview(item.text, names);
  return preview || slackActivityHeadline(item);
}

/** @you, @channel, @here, or @everyone in Slack mrkdwn. */
export function slackTextAlertsViewer(text: string, viewerId?: string): boolean {
  const source = text.replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
  const viewer = viewerId?.trim();
  if (viewer && extractSlackUserIds(source).includes(viewer)) return true;
  return /<!(?:channel|here|everyone)(?:\|[^>]+)?>/i.test(source);
}

export function slackActivityMentionNames(
  status?: {
    userId?: string;
    userName?: string;
  } | null,
): ReadonlyMap<string, string> {
  const id = status?.userId?.trim();
  const name = status?.userName?.trim();
  return id && name ? new Map([[id, name]]) : new Map();
}

export function slackActivityPreview(text: string, names?: ReadonlyMap<string, string>): string {
  const resolved = names?.size ? resolveSlackMentionText(text, names) : text;
  return slackMrkdwnToMarkdown(resolved).replace(/\s+/g, " ").trim();
}

export function slackActivityFeed(
  mentions: SlackSearchHit[],
  conversations: SlackConversation[],
): SlackActivityItem[] {
  const items: SlackActivityItem[] = [];
  const mentioned = new Set<string>();
  for (const hit of mentions) {
    const id = `${hit.channelId}:${hit.ts}`;
    mentioned.add(hit.channelId);
    const threaded = Boolean(hit.threadTs && hit.threadTs !== hit.ts);
    items.push({
      id,
      kind: threaded ? "thread" : "mention",
      channelId: hit.channelId,
      channelName: hit.channelName,
      ts: hit.ts,
      threadTs: hit.threadTs,
      text: hit.text,
      userName: hit.userName,
    });
  }
  for (const row of conversations) {
    if (!row.unread) continue;
    if (mentioned.has(row.id)) continue;
    items.push({
      id: `unread:${row.id}`,
      kind: isDirectConversation(row.kind) ? "dm" : "unread",
      channelId: row.id,
      channelName: row.name,
      ts: row.lastTs || "0",
      text: isDirectConversation(row.kind) ? "Unread direct message" : "Unread messages",
    });
  }
  return items.sort((a, b) => b.ts.localeCompare(a.ts));
}

export function newSlackActivityItems(
  bootstrapped: boolean,
  prevIds: Set<string>,
  items: SlackActivityItem[],
): SlackActivityItem[] {
  if (!bootstrapped) return [];
  return items.filter((item) => !prevIds.has(item.id));
}

/** Ids to remember so a message ping and a later unread:channel row do not both alert. */
export function slackActivityDedupIds(item: Pick<SlackActivityItem, "id" | "channelId">): string[] {
  const channel = item.channelId.trim();
  if (!channel) return [item.id];
  const unreadId = `unread:${channel}`;
  return item.id === unreadId ? [item.id] : [item.id, unreadId];
}

/** Desktop / toast alerts: mentions, thread replies, and DMs — not bare channel unreads. */
export function shouldFireSlackAlert(item: Pick<SlackActivityItem, "kind">): boolean {
  return item.kind === "mention" || item.kind === "thread" || item.kind === "dm";
}

export function shouldNotifySlackActivity(input: {
  hidden: boolean;
  section: string;
  activityOpen: boolean;
  selectedChannelId: string | null;
  itemChannelId: string;
}): boolean {
  if (input.hidden) return true;
  if (input.section !== "slack") return true;
  if (input.activityOpen) return false;
  if (input.selectedChannelId === input.itemChannelId) return false;
  return true;
}

/** Mention, @channel/@here, DM, or thread-reply ping — or undefined when it is not an alert. */
export function slackMessageActivityItem(
  message: SlackMessage,
  viewerId: string | undefined,
  channelName?: string,
  channelKind?: SlackConversationKind,
): SlackActivityItem | undefined {
  if (isSlackDeletedMessage(message)) return undefined;
  const viewer = viewerId?.trim();
  if (viewer && message.userId === viewer) return undefined;
  const mentioned = slackTextAlertsViewer(message.text, viewer);
  const dm = Boolean(channelKind && isDirectConversation(channelKind));
  if (!mentioned && !dm) return undefined;
  if (!viewer && !dm) return undefined;
  const threaded = Boolean(message.threadTs && message.threadTs !== message.ts);
  return {
    id: `${message.channelId}:${message.ts}`,
    kind: dm && !mentioned ? "dm" : threaded ? "thread" : "mention",
    channelId: message.channelId,
    channelName,
    ts: message.ts,
    threadTs: message.threadTs,
    text: message.text,
    userName: message.userName,
  };
}

/** `/locus stop` and `stop now` abort the bound thread instead of starting a new run. */
export function isSlackStopText(text: string): boolean {
  return /^stop(?:\s+now)?$/i.test(text.trim());
}

/** Bound Ask Locus status shown in the Slack pane only — never posted to the channel. */
export type SlackLocusStatus = "running" | "waiting";

export function slackLocusStatus(session: {
  status?: string;
  needsHuman?: string | null;
  messages?: Array<{ toolCalls?: Array<{ approval?: string; finishedAt?: string }> }>;
}): SlackLocusStatus | undefined {
  if (session.status === "running" || session.status === "provisioning") return "running";
  if (session.needsHuman?.trim()) return "waiting";
  for (const message of session.messages ?? []) {
    for (const call of message.toolCalls ?? []) {
      if (call.approval === "needed" && !call.finishedAt) return "waiting";
    }
  }
  return undefined;
}

export function formatSlackLocusStatus(status: SlackLocusStatus): string {
  return status === "waiting" ? "Waiting" : "Running";
}

export const SLACK_BOT_SCOPES = [
  "commands",
  "chat:write",
  "chat:write.public",
  "files:write",
] as const;
export const SLACK_MOCK_BOT_TOKEN = "xoxb-mock";

export const SLACK_OAUTH_AUTHORIZE = "https://slack.com/oauth/v2/authorize";
export const SLACK_OAUTH_ACCESS = "https://slack.com/api/oauth.v2.access";
export const SLACK_API_BASE = "https://slack.com/api";
export const SLACK_STATE_PREFIX = "slack.";
export const SLACK_MOCK_USER_TOKEN = "xoxp-mock";
export const SLACK_MESSAGE_CAP = 200;
export const SLACK_CONVERSATIONS_TTL_MS = 60_000;
export const SLACK_MESSAGES_TTL_MS = 120_000;
export const SLACK_EMOJI_TTL_MS = 60 * 60 * 1000;
export const SLACK_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

export function slackOauthCallbackUrl(bindPort = 7420): string {
  return forgeOauthCallbackUrl(bindPort);
}

export function slackOauthClientIdEnv(): string {
  return "LOCUS_SLACK_OAUTH_CLIENT_ID";
}

export function slackOauthClientSecretEnv(): string {
  return "LOCUS_SLACK_OAUTH_CLIENT_SECRET";
}

export function isSlackOauthState(state: string | undefined): boolean {
  return Boolean(state?.startsWith(SLACK_STATE_PREFIX));
}

export function slackAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  userScopes?: readonly string[];
  botScopes?: readonly string[];
}): string {
  const url = new URL(SLACK_OAUTH_AUTHORIZE);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", (input.botScopes ?? SLACK_BOT_SCOPES).join(","));
  url.searchParams.set("user_scope", (input.userScopes ?? SLACK_USER_SCOPES).join(","));
  return url.toString();
}

export interface SlackStatus {
  connected: boolean;
  teamId?: string;
  teamName?: string;
  userId?: string;
  userName?: string;
  avatarUrl?: string;
  socket: "up" | "down";
  /** True when a bot token is stored so composer / slack_post can send as the Locus app. */
  canPostAsBot?: boolean;
}

export type SlackConversationKind = "channel" | "private" | "im" | "mpim";

export interface SlackConversation {
  id: string;
  name: string;
  kind: SlackConversationKind;
  topic?: string;
  unread?: boolean;
  lastTs?: string;
  memberCount?: number;
  starred?: boolean;
  avatarUrl?: string;
  /** Other user in a 1:1 IM (`conversations.list` / `users.conversations` `user`). */
  userId?: string;
}

export interface SlackReaction {
  name: string;
  count: number;
  users?: string[];
  mine?: boolean;
}

export interface SlackMessage {
  ts: string;
  channelId: string;
  threadTs?: string;
  userId?: string;
  userName?: string;
  avatarUrl?: string;
  text: string;
  replyCount?: number;
  subtype?: string;
  /** Thread reply that Slack also posted to the channel ("Also sent to the channel"). */
  replyBroadcast?: boolean;
  agent?: boolean;
  files?: SlackFile[];
  reactions?: SlackReaction[];
}

export interface SlackFile {
  url: string;
  title?: string;
  alt?: string;
  mime?: string;
  permalink?: string;
  /** Pixel size from Slack (`original_w` / `thumb_360_w`) so the pane can reserve layout. */
  width?: number;
  height?: number;
}

export interface SlackGifHit {
  id: string;
  title: string;
  url: string;
  preview: string;
}

export interface SlackGifSearch {
  hits: SlackGifHit[];
  source: "giphy" | "catalog";
  notice?: string;
}

export interface SessionSlack {
  teamId: string;
  channelId: string;
  threadTs: string;
  lastPostTs?: string;
}

export interface SlackRunInput {
  channelId: string;
  threadTs?: string;
  messageTs?: string;
  text: string;
  userId?: string;
  providerId?: string;
  model?: string;
  /** Named job when creating a new Slack-bound session. Follow-ups ignore this. */
  recipeId?: string;
  /** Catch-me-up cursor: excerpt only messages newer than this Slack ts. */
  sinceTs?: string;
}

export const SLACK_WORK_RECIPES = [
  {
    recipeId: "pr-reviewer",
    label: "Review this PR",
    text: "Review this PR from this Slack thread.",
  },
  {
    recipeId: "app-dashboard",
    label: "Design this screen",
    text: "Design this screen from this Slack thread.",
  },
  {
    recipeId: "ops-loop",
    label: "Ops loop",
    text: "Run the ops loop from this Slack thread (Grafana/Jira).",
  },
] as const;

export const SLACK_CATCH_UP_TEXT =
  "Catch me up. Summarize what I missed in this channel since the last catch-up. Do not slack_post unless I explicitly ask you to reply in Slack.";

export const SLACK_CATCH_UP_CURSOR_KEY = "locus.slack.catchupCursor";

export function resolveSlackRunProvider(
  providers: AiProvider[],
  input: Pick<SlackRunInput, "providerId" | "model"> = {},
  account?: Pick<IntegrationAccount, "defaultProviderId" | "defaultModel">,
): { provider: AiProvider; model: string } {
  const requestedId = input.providerId?.trim();
  if (requestedId && !providers.some((row) => row.id === requestedId)) {
    throw new Error("Unknown provider");
  }
  const preferredId = requestedId || account?.defaultProviderId?.trim();
  const provider =
    providers.find((row) => row.id === preferredId) ??
    providers.find((row) => row.enabled) ??
    providers[0];
  if (!provider) throw new Error("Add a model provider in Settings");
  const requestedModel = input.model?.trim();
  const rememberedModel =
    !requestedModel && provider.id === account?.defaultProviderId
      ? account.defaultModel?.trim()
      : undefined;
  const model =
    requestedModel || rememberedModel || provider.defaultModel || provider.models[0] || "mock";
  return { provider, model };
}

export function parseSessionSlack(raw: unknown): SessionSlack | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const teamId = str(value.teamId);
  const channelId = str(value.channelId);
  const threadTs = str(value.threadTs);
  if (!teamId || !channelId || !threadTs) return undefined;
  return {
    teamId,
    channelId,
    threadTs,
    lastPostTs: str(value.lastPostTs),
  };
}

export function parseSlackConversation(raw: unknown): SlackConversation | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const id = str(value.id);
  if (!id) return undefined;
  const kind = parseSlackConversationKind(value.kind) ?? inferConversationKind(value);
  const userId = kind === "im" ? str(value.userId) || str(value.user) : str(value.userId);
  let name =
    str(value.name) ||
    str(value.userName) ||
    (kind === "im" ? userId : undefined) ||
    (kind === "im" || kind === "mpim" ? "direct" : id);
  if (kind === "mpim") name = slackMpimDisplayName(name);
  return {
    id,
    name,
    kind,
    topic:
      str(value.topic) ||
      str(value.purpose) ||
      nestedValue(value.topic) ||
      nestedValue(value.purpose),
    unread:
      value.unread === true ||
      value.is_unread === true ||
      (typeof value.unread_count === "number" && value.unread_count > 0) ||
      (typeof value.unread_count_display === "number" && value.unread_count_display > 0),
    lastTs: str(value.lastTs) || str(value.latest),
    memberCount:
      typeof value.memberCount === "number"
        ? value.memberCount
        : typeof value.num_members === "number"
          ? value.num_members
          : undefined,
    starred: value.starred === true || value.is_starred === true || undefined,
    avatarUrl: str(value.avatarUrl) || slackProfileImage(value),
    userId,
  };
}

/** Slack group-DM titles look like `mpdm-alice--bob-1`. */
export function slackMpimDisplayName(name: string): string {
  const trimmed = name.trim();
  const match = /^mpdm-(.+?)(?:-\d+)?$/i.exec(trimmed);
  if (!match?.[1]) return trimmed;
  const people = match[1]
    .split("--")
    .map((part) => part.trim())
    .filter(Boolean);
  return people.length ? people.join(", ") : trimmed;
}

export function parseSlackMessage(raw: unknown, channelId?: string): SlackMessage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const ts = str(value.ts);
  if (!ts) return undefined;
  const channel = str(value.channelId) || str(value.channel) || channelId;
  if (!channel) return undefined;
  const files = parseSlackFiles(value);
  const replyBroadcast =
    value.replyBroadcast === true ||
    value.reply_broadcast === true ||
    str(value.subtype) === "thread_broadcast";
  return {
    ts,
    channelId: channel,
    threadTs: str(value.threadTs) || str(value.thread_ts),
    userId: str(value.userId) || str(value.user),
    userName: str(value.userName) || str(value.username),
    avatarUrl: str(value.avatarUrl) || slackProfileImage(value) || slackProfileImage(value.user),
    text: typeof value.text === "string" ? value.text : "",
    replyCount:
      typeof value.replyCount === "number"
        ? value.replyCount
        : typeof value.reply_count === "number"
          ? value.reply_count
          : undefined,
    subtype: str(value.subtype),
    ...(replyBroadcast ? { replyBroadcast: true } : {}),
    agent: value.agent === true,
    files,
    reactions: parseSlackReactions(value.reactions),
  };
}

export function normalizeSlackReactionName(raw: string): string | undefined {
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/^:+|:+$/g, "");
  if (!/^[a-z0-9_+-]{1,100}(?:::skin-tone-[2-6])?$/.test(name)) return undefined;
  return name;
}

export function withSlackReactionMine(
  reactions: SlackReaction[] | undefined,
  userId?: string,
): SlackReaction[] | undefined {
  if (!reactions?.length) return reactions;
  if (!userId) return reactions;
  return reactions.map((row) => ({
    ...row,
    mine: Boolean(row.mine || row.users?.includes(userId)),
  }));
}

export function toggleSlackReaction(
  message: SlackMessage,
  rawName: string,
  userId: string,
  remove?: boolean,
): SlackMessage {
  const name = normalizeSlackReactionName(rawName);
  if (!name || !userId) return message;
  const reactions: SlackReaction[] = (message.reactions ?? []).map((row) => ({
    ...row,
    users: row.users ? [...row.users] : undefined,
  }));
  const idx = reactions.findIndex((row) => row.name === name);
  const existing = idx >= 0 ? reactions[idx] : undefined;
  const users = new Set(existing?.users ?? []);
  const mine = Boolean(existing?.mine || users.has(userId));
  const shouldRemove = remove ?? mine;
  if (shouldRemove) {
    if (!existing || !mine) return message;
    users.delete(userId);
    const count = Math.max(0, existing.count - 1);
    if (count <= 0) reactions.splice(idx, 1);
    else {
      reactions[idx] = {
        name,
        count,
        users: users.size ? [...users] : undefined,
        mine: false,
      };
    }
  } else {
    if (mine) return message;
    users.add(userId);
    const next: SlackReaction = {
      name,
      count: (existing?.count ?? 0) + 1,
      users: [...users],
      mine: true,
    };
    if (idx >= 0) reactions[idx] = next;
    else reactions.push(next);
  }
  return { ...message, reactions: reactions.length ? reactions : undefined };
}

export function parseSlackFiles(raw: Record<string, unknown>): SlackFile[] | undefined {
  const out: SlackFile[] = [];
  const seen = new Set<string>();
  const add = (
    url: string | undefined,
    title?: string,
    alt?: string,
    mime?: string,
    permalink?: string,
    size?: { width?: number; height?: number },
  ) => {
    const href = str(url);
    if (!href || seen.has(href)) return;
    if (!isHttpUrl(href) && !href.startsWith("/api/slack/media")) return;
    seen.add(href);
    const link = str(permalink);
    const width = size?.width;
    const height = size?.height;
    out.push({
      url: href,
      title: str(title),
      alt: str(alt),
      mime: str(mime),
      ...(link ? { permalink: link } : {}),
      ...(width && height ? { width, height } : {}),
    });
  };
  if (Array.isArray(raw.files)) {
    for (const item of raw.files) {
      if (!item || typeof item !== "object") continue;
      const file = item as Record<string, unknown>;
      const mime = str(file.mime) || str(file.mimetype);
      const title = str(file.title) || str(file.name) || str(file.alt);
      const permalink = str(file.permalink);
      const fileUrl = str(file.url) || str(file.url_private) || str(file.url_private_download);
      const probe: Pick<SlackFile, "url" | "mime" | "title"> = {
        url: fileUrl || str(file.thumb_360) || str(file.permalink_public) || permalink || "",
        mime,
        title,
      };
      const size = slackFilePixelSize(file);
      if (slackFileLooksLikeGif(probe)) {
        add(
          str(file.thumb_360_gif) || fileUrl || str(file.thumb_360) || str(file.permalink_public),
          title,
          title,
          mime,
          permalink,
          size,
        );
      } else if (slackFileLooksLikeImage(probe)) {
        add(
          fileUrl || str(file.thumb_360) || str(file.permalink_public),
          title,
          title,
          mime,
          permalink,
          size,
        );
      } else if (slackFileLooksLikeVideo(probe)) {
        add(
          fileUrl || str(file.mp4) || str(file.url_private_download) || permalink,
          title,
          title,
          mime,
          permalink,
          size,
        );
      } else {
        add(
          fileUrl || permalink || str(file.permalink_public),
          title,
          title,
          mime,
          permalink,
          size,
        );
      }
    }
  }
  if (Array.isArray(raw.attachments)) {
    for (const item of raw.attachments) {
      if (!item || typeof item !== "object") continue;
      const att = item as Record<string, unknown>;
      const image = str(att.image_url) || str(att.thumb_url);
      add(
        image,
        str(att.title) || str(att.fallback),
        str(att.fallback),
        guessMime(image),
        undefined,
        slackFilePixelSize(att),
      );
    }
  }
  if (Array.isArray(raw.blocks)) {
    for (const item of raw.blocks) {
      if (!item || typeof item !== "object") continue;
      const block = item as Record<string, unknown>;
      if (block.type !== "image") continue;
      const titleObj =
        block.title && typeof block.title === "object"
          ? (block.title as Record<string, unknown>)
          : undefined;
      const title = str(titleObj?.text) || str(block.alt_text);
      add(
        str(block.image_url),
        title,
        str(block.alt_text),
        guessMime(str(block.image_url)),
        undefined,
        slackFilePixelSize(block),
      );
    }
  }
  return out.length ? out : undefined;
}

const MEDIA_EXT = "png|jpe?g|gif|webp|heic|bmp|mp4|webm|mov|m4v|ogv";
const GENERIC_MEDIA_TITLE = new RegExp(
  `^(image|img|photo|screenshot|gif|video|clip|attachment|untitled)(\\s*[-_]?\\d+|\\s*\\(\\d+\\))?(\\.(${MEDIA_EXT}))?$`,
  "i",
);
const BARE_MEDIA_FILENAME = new RegExp(`\\.(${MEDIA_EXT})$`, "i");
/** GNOME `Screencast from …`, macOS Screen Recording, Game Bar Recording YYYY-MM-DD. */
const SCREEN_RECORDING_TITLE =
  /^(screencast from \d{4}[-.]\d{2}[-.]\d{2}\b|screen[ _-]?recording \d{4}[-.]\d{2}[-.]\d{2}\b|recording \d{4}[-.]\d{2}[-.]\d{2}\b)/i;

/** Visible caption under a Slack image or video. Hides upload filenames like `image.png`. */
export function slackMediaCaption(title: string | undefined, messageText = ""): string | undefined {
  const value = title?.trim();
  if (!value) return undefined;
  if (GENERIC_MEDIA_TITLE.test(value)) return undefined;
  if (SCREEN_RECORDING_TITLE.test(value)) return undefined;
  if (BARE_MEDIA_FILENAME.test(value) && !/\s/.test(value)) return undefined;
  const message = messageText.trim();
  if (message && value.toLowerCase() === message.toLowerCase()) return undefined;
  return value;
}

export function slackFileLooksLikeGif(file: Pick<SlackFile, "url" | "mime">): boolean {
  const mime = (file.mime ?? "").toLowerCase();
  if (mime === "image/gif") return true;
  const url = file.url.toLowerCase();
  return (
    url.includes(".gif") ||
    url.includes("giphy.com") ||
    url.includes("giphy.gif") ||
    url.includes("tenor.com") ||
    url.includes("tenor.co")
  );
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|bmp|avif)(\?|#|$)/i;
const HTML_EXT = /\.html?(?:\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)(?:\?|#|$)/i;
const CSV_EXT = /\.(csv|tsv)(?:\?|#|$)/i;
const PDF_EXT = /\.pdf(?:\?|#|$)/i;
const HTML_PREVIEW_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:; frame-ancestors 'self'";
export const SLACK_CSV_PREVIEW_ROWS = 40;
export const SLACK_CSV_PREVIEW_COLS = 12;
export const SLACK_CSV_PREVIEW_BYTES = 64 * 1024;

function slackFileMime(file: Pick<SlackFile, "mime">): string {
  return (file.mime ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/** True when the file should render as an inline image, not a document chip. */
export function slackFileLooksLikeImage(file: Pick<SlackFile, "url" | "mime" | "title">): boolean {
  if (slackFileLooksLikeGif(file)) return true;
  const mime = slackFileMime(file);
  if (mime.startsWith("image/") && mime !== "image/svg+xml") return true;
  if (mime) return false;
  return IMAGE_EXT.test(file.title ?? "") || IMAGE_EXT.test(file.url);
}

/** True when the file should render as a sandboxed HTML preview. */
export function slackFileLooksLikeHtml(file: Pick<SlackFile, "url" | "mime" | "title">): boolean {
  const mime = slackFileMime(file);
  if (mime === "text/html" || mime === "application/xhtml+xml") return true;
  if (mime) return false;
  return HTML_EXT.test(file.title ?? "") || HTML_EXT.test(file.url);
}

/** True when the file should render as an inline PDF preview. */
export function slackFileLooksLikePdf(file: Pick<SlackFile, "url" | "mime" | "title">): boolean {
  const mime = slackFileMime(file);
  if (mime === "application/pdf") return true;
  if (mime) return false;
  return PDF_EXT.test(file.title ?? "") || PDF_EXT.test(file.url);
}

/** True when the file should render in an inline video player. */
export function slackFileLooksLikeVideo(file: Pick<SlackFile, "url" | "mime" | "title">): boolean {
  const mime = slackFileMime(file);
  if (mime.startsWith("video/")) return true;
  if (mime) return false;
  return VIDEO_EXT.test(file.title ?? "") || VIDEO_EXT.test(file.url);
}

/** Slack original/thumb pixel size when both sides are present. */
export function slackFilePixelSize(
  raw: Record<string, unknown> | Pick<SlackFile, "width" | "height">,
): { width: number; height: number } | undefined {
  const row = raw as Record<string, unknown>;
  const width =
    num(row.width) ??
    num(row.original_w) ??
    num(row.thumb_360_w) ??
    num(row.image_width) ??
    num(row.image_w);
  const height =
    num(row.height) ??
    num(row.original_h) ??
    num(row.thumb_360_h) ??
    num(row.image_height) ??
    num(row.image_h);
  if (!width || !height) return undefined;
  return { width, height };
}

/** CSS `aspect-ratio` so media keeps its box before the bytes arrive. */
export function slackMediaAspectRatio(
  file: Pick<SlackFile, "url" | "mime" | "title" | "width" | "height">,
): string {
  const size = slackFilePixelSize(file);
  if (size) return `${size.width} / ${size.height}`;
  if (slackFileLooksLikeVideo(file)) return "16 / 9";
  if (file.url.toLowerCase().includes("giphy") || slackFileLooksLikeGif(file)) return "16 / 9";
  return "4 / 3";
}

/** True when the file should render as an inline CSV/TSV table. */
export function slackFileLooksLikeCsv(file: Pick<SlackFile, "url" | "mime" | "title">): boolean {
  const mime = slackFileMime(file);
  if (
    mime === "text/csv" ||
    mime === "application/csv" ||
    mime === "text/tab-separated-values" ||
    mime === "text/tsv"
  ) {
    return true;
  }
  if (mime && mime !== "text/plain") return false;
  return CSV_EXT.test(file.title ?? "") || CSV_EXT.test(file.url);
}

/** `/api/slack/media` URL with `preview=1`, or undefined when the file is not proxied. */
export function slackMediaPreviewSrc(url: string): string | undefined {
  if (!url.startsWith("/api/slack/media")) return undefined;
  if (/(?:^|[?&])preview=1(?:&|$)/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}preview=1`;
}

/** `/api/slack/media` URL with `preview=1`, or undefined when the file is not proxied. */
export function slackHtmlPreviewSrc(url: string): string | undefined {
  return slackMediaPreviewSrc(url);
}

export type SlackCsvPreview = {
  headers: string[];
  rows: string[][];
  truncated: boolean;
};

/** First-row-as-header table for an inline Slack CSV/TSV preview. */
export function parseSlackCsvPreview(text: string): SlackCsvPreview {
  const sample = text.slice(0, SLACK_CSV_PREVIEW_BYTES);
  const records = parseCsvRecords(sample, detectCsvDelim(sample));
  const truncated =
    text.length > SLACK_CSV_PREVIEW_BYTES || records.length > SLACK_CSV_PREVIEW_ROWS + 1;
  const header = records[0] ?? [];
  const body = records.slice(1, SLACK_CSV_PREVIEW_ROWS + 1);
  const cols = Math.min(
    SLACK_CSV_PREVIEW_COLS,
    Math.max(header.length, ...body.map((row) => row.length), 1),
  );
  const clip = (row: string[]): string[] => {
    const next = row.slice(0, cols);
    while (next.length < cols) next.push("");
    return next;
  };
  return {
    headers: clip(
      header.length ? header : Array.from({ length: cols }, (_, i) => `Column ${i + 1}`),
    ),
    rows: body.map(clip),
    truncated,
  };
}

/** Short type label for a non-image Slack file chip (`HTML`, `PDF`, `File`). */
export function slackFileKindLabel(file: Pick<SlackFile, "url" | "mime" | "title">): string {
  if (slackFileLooksLikeHtml(file)) return "HTML";
  if (slackFileLooksLikePdf(file)) return "PDF";
  if (slackFileLooksLikeVideo(file)) return "Video";
  if (slackFileLooksLikeCsv(file)) {
    const hint = `${file.title ?? ""} ${file.url} ${slackFileMime(file)}`;
    return /tsv|tab-separated/i.test(hint) ? "TSV" : "CSV";
  }
  const mime = slackFileMime(file);
  const hint = `${file.title ?? ""} ${file.url}`;
  const ext = hint.match(/\.([a-z0-9]{1,8})(?:\?|#|$)/i)?.[1];
  if (ext) return ext.toUpperCase();
  if (mime.startsWith("text/")) return "Text";
  return "File";
}

/** Headers for `/api/slack/media`. Non-images download so HTML is not executed on loopback. */
export function slackMediaResponseHeaders(
  mime?: string,
  opts: { preview?: boolean } = {},
): Record<string, string> {
  const type = mime?.trim() || "application/octet-stream";
  const probe: Pick<SlackFile, "url" | "mime" | "title"> = { url: "", mime: type };
  const headers: Record<string, string> = {
    "content-type": type,
    "cache-control": "private, max-age=300",
    "x-content-type-options": "nosniff",
  };
  if (slackFileLooksLikeVideo(probe)) {
    headers["content-disposition"] = "inline";
    return headers;
  }
  if (opts.preview && slackFileLooksLikeHtml(probe)) {
    headers["content-disposition"] = "inline";
    headers["content-security-policy"] = HTML_PREVIEW_CSP;
    return headers;
  }
  if (opts.preview && slackFileLooksLikeCsv(probe)) {
    headers["content-disposition"] = "inline";
    if (!/[;,\s]charset=/i.test(type)) headers["content-type"] = `${type}; charset=utf-8`;
    return headers;
  }
  if (opts.preview && slackFileLooksLikePdf(probe)) {
    headers["content-disposition"] = "inline";
    return headers;
  }
  if (!slackFileLooksLikeImage(probe)) {
    headers["content-disposition"] = "attachment";
  }
  return headers;
}

export function isSlackPrivateFileUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "files.slack.com" ||
      host === "files-origin.slack.com" ||
      host === "slack-files.com" ||
      host.endsWith(".files.slack.com") ||
      host.endsWith(".slack-edge.com")
    );
  } catch {
    return false;
  }
}

export function slackMediaSrc(url: string): string {
  if (isSlackPrivateFileUrl(url)) return `/api/slack/media?url=${encodeURIComponent(url)}`;
  return url;
}

export function rewriteSlackMessageMedia(message: SlackMessage): SlackMessage {
  if (!message.files?.length) return message;
  return {
    ...message,
    files: message.files.map((file) => ({ ...file, url: slackMediaSrc(file.url) })),
  };
}

export function isPublicGifUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const giphy = host === "giphy.com" || host === "i.giphy.com" || host.endsWith(".giphy.com");
    const tenor = host === "tenor.com" || host.endsWith(".tenor.com") || host.endsWith(".tenor.co");
    return giphy || tenor || /\.(gif|webp|png|jpe?g|mp4)$/i.test(path);
  } catch {
    return false;
  }
}

export function conversationBareName(row: Pick<SlackConversation, "name">): string {
  return row.name.replace(/^[@#]/, "");
}

export function conversationPrefix(kind: SlackConversationKind): "hash" | "lock" | "at" {
  if (kind === "im" || kind === "mpim") return "at";
  if (kind === "private") return "lock";
  return "hash";
}

export function conversationLabel(row: Pick<SlackConversation, "name" | "kind">): string {
  const name = conversationBareName(row);
  const prefix = conversationPrefix(row.kind);
  if (prefix === "at") return `@${name}`;
  if (prefix === "lock") return `\u{1F512}${name}`;
  return `#${name}`;
}

export function isDirectConversation(kind: SlackConversationKind): boolean {
  return kind === "im" || kind === "mpim";
}

export function formatSlackTs(ts: string, now = Date.now()): string {
  const ms = Number.parseFloat(ts) * 1000;
  if (!Number.isFinite(ms)) return "";
  const date = new Date(ms);
  const sameDay =
    date.getFullYear() === new Date(now).getFullYear() &&
    date.getMonth() === new Date(now).getMonth() &&
    date.getDate() === new Date(now).getDate();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

/** Slack mrkdwn → a markdown-ish string the existing renderer can handle. */
export function slackMrkdwnToMarkdown(text: string): string {
  return decodeSlackEntities(text)
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "[$2]($1)")
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")
    .replace(/<#([A-Z0-9_]+)(?:\|([^>]+))?>/g, (_m, _id, name: string | undefined) =>
      name ? `#${name}` : "#channel",
    )
    .replace(slackUserMentionRe(), (_m, id: string, name: string | undefined) =>
      name?.trim() ? `@${name.trim()}` : `@${id}`,
    )
    .replace(/<!subteam\^[^|>]+(?:\|@?([^>]+))?>/g, (_m, name: string | undefined) =>
      name ? `@${name}` : "@group",
    )
    .replace(/<!([^|>]+)(?:\|([^>]+))?>/g, (_m, id: string, label: string | undefined) => {
      const token = (label || id).replace(/^@/, "");
      return `@${token}`;
    })
    .replace(/(^|\s)\*([^*\n]+)\*/g, "$1**$2**")
    .replace(/(^|\s)_([^_\n]+)_/g, "$1*$2*")
    .replace(/(^|\s)~([^~\n]+)~/g, "$1~~$2~~");
}

const SLACK_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Slack sometimes stores quotes as `&gt;` instead of `>`. One pass: `&amp;gt;` stays `&gt;`. */
export function decodeSlackEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (full, body: string) => {
    const key = body.toLowerCase();
    if (key.startsWith("#x")) return fromSlackCodePoint(Number.parseInt(key.slice(2), 16), full);
    if (key.startsWith("#")) return fromSlackCodePoint(Number.parseInt(key.slice(1), 10), full);
    return SLACK_HTML_ENTITIES[key] ?? full;
  });
}

function fromSlackCodePoint(n: number, fallback: string): string {
  if (!Number.isFinite(n)) return fallback;
  if (n === 9 || n === 10 || n === 13) return String.fromCodePoint(n);
  if (n < 32 || n === 0x7f || n > 0x10ffff) return fallback;
  return String.fromCodePoint(n);
}

function slackUserMentionRe(): RegExp {
  return /<@([A-Z0-9_]+)(?:\|([^>]*))?>/g;
}

/** User ids from Slack `<@U123>` / `<@U123|alice>` tokens in message text. */
export function extractSlackUserIds(text: string): string[] {
  const source = text.replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of source.matchAll(slackUserMentionRe())) {
    const id = match[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Fill unlabeled `<@U123>` tokens with profile names so the renderer can show @alice. */
export function resolveSlackMentionText(text: string, names: ReadonlyMap<string, string>): string {
  return text
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(slackUserMentionRe(), (full, id: string, label: string | undefined) => {
      const name = sanitizeMentionLabel(names.get(id) || label || id);
      if (!name) return full;
      return `<@${id}|${name}>`;
    });
}

function sanitizeMentionLabel(value: string | undefined): string | undefined {
  const name = value?.trim().replace(/^@/, "").replace(/[|>]/g, "");
  return name || undefined;
}

export function slackPostDraftText(args: Record<string, unknown> | undefined): string {
  const text = args?.text;
  const body = args?.body;
  if (typeof text === "string" && text.trim()) return text;
  if (typeof body === "string" && body.trim()) return body;
  return "";
}

export function applySlackPostApprovalText(
  name: string,
  args: Record<string, unknown> | undefined,
  answer?: string,
): Record<string, unknown> | undefined {
  if (name !== "slack_post") return args;
  const text = answer?.trim();
  if (!text) return args;
  const next: Record<string, unknown> = { ...(args ?? {}), text };
  delete next.body;
  return next;
}

export function pendingSlackPost(
  session:
    | {
        messages?: Array<{
          toolCalls?: Array<{
            id: string;
            name: string;
            arguments?: Record<string, unknown>;
            finishedAt?: string;
            approval?: string;
          }>;
        }>;
      }
    | null
    | undefined,
): { toolCallId: string; text: string } | null {
  if (!session?.messages) return null;
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const calls = session.messages[i]?.toolCalls ?? [];
    for (const call of calls) {
      if (call.name === "slack_post" && call.approval === "needed" && !call.finishedAt) {
        return { toolCallId: call.id, text: slackPostDraftText(call.arguments) };
      }
    }
  }
  return null;
}

export function messagesSinceTs<T extends { ts: string }>(rows: T[], sinceTs?: string | null): T[] {
  if (!sinceTs) return rows;
  const cursor = Number(sinceTs);
  if (!Number.isFinite(cursor)) return rows;
  return rows.filter((row) => Number(row.ts) > cursor);
}

export function formatSlackExcerpt(
  rows: Array<{
    userName?: string;
    userId?: string;
    text: string;
    files?: Array<{ title?: string }>;
  }>,
  opts?: { limit?: number; lineChars?: number; totalChars?: number },
): string {
  const limit = opts?.limit ?? 20;
  const lineChars = opts?.lineChars ?? 400;
  const totalChars = opts?.totalChars ?? 6_000;
  const lines = rows.slice(-limit).map((row) => {
    const gif = row.files?.[0];
    const label = gif ? ` [gif${gif.title ? `: ${gif.title}` : ""}]` : "";
    return `${row.userName || row.userId || "user"}: ${row.text}${label}`.slice(0, lineChars);
  });
  return lines.join("\n").slice(0, totalChars) || "(empty thread)";
}

export type SlackCite =
  | { kind: "file"; path: string; label: string }
  | { kind: "pr"; url: string; repoUrl: string; label: string; number: number }
  | { kind: "session"; sessionId: string; label: string };

const WORKSPACE_PATH_RE = /(?:^|[\s`'"(])(\/workspace\/[^\s`'")]+)/g;
const HTTP_URL_RE = /https?:\/\/[^\s<>)"]+/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

export function parseSlackCites(
  text: string,
  sessionIds: ReadonlySet<string> | readonly string[] = [],
): SlackCite[] {
  const ids = sessionIds instanceof Set ? sessionIds : new Set(sessionIds);
  const lowerIds = new Set([...ids].map((id) => id.toLowerCase()));
  const out: SlackCite[] = [];
  const seen = new Set<string>();

  function push(key: string, cite: SlackCite) {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cite);
  }

  for (const match of text.matchAll(WORKSPACE_PATH_RE)) {
    const path = match[1]!.replace(/[.,;:]+$/, "");
    if (path.length < "/workspace/x".length) continue;
    push(`file:${path}`, {
      kind: "file",
      path,
      label: path.replace(/^\/workspace\//, ""),
    });
  }

  for (const match of text.matchAll(HTTP_URL_RE)) {
    const url = match[0]!.replace(/[.,;)]+$/, "");
    const parsed = parseForgePullUrl(url);
    if (!parsed) continue;
    push(`pr:${parsed.title}`, {
      kind: "pr",
      url: parsed.pullUrl,
      repoUrl: parsed.repoUrl,
      label: parsed.title,
      number: parsed.pullNumber,
    });
  }

  if (lowerIds.size) {
    for (const match of text.matchAll(UUID_RE)) {
      const id = match[0]!.toLowerCase();
      if (!lowerIds.has(id)) continue;
      const original = [...ids].find((row) => row.toLowerCase() === id) ?? id;
      push(`session:${original}`, { kind: "session", sessionId: original, label: "Open agent" });
    }
  }

  return out;
}

export function subscriptionMatchesSlack(
  sub: Pick<SessionSubscription, "kind" | "channelId" | "threadTs">,
  channelId: string,
  threadTs?: string,
): boolean {
  if (sub.channelId !== channelId) return false;
  if (threadTs) return sub.kind === "slack_thread" && sub.threadTs === threadTs;
  return sub.kind === "slack_channel";
}

export function sessionsListeningOnSlack<
  T extends {
    archived?: boolean;
    subscriptions?: Array<Pick<SessionSubscription, "kind" | "channelId" | "threadTs">>;
  },
>(sessions: T[], channelId: string, threadTs?: string): T[] {
  return sessions.filter(
    (row) =>
      !row.archived &&
      (row.subscriptions ?? []).some((sub) => subscriptionMatchesSlack(sub, channelId, threadTs)),
  );
}

export function formatSlackRunPrompt(input: {
  instruction: string;
  channelId: string;
  threadTs: string;
  excerpt: string;
  orient?: string;
}): string {
  const instruction = input.instruction.trim() || "Work from this Slack thread.";
  const source = `${input.channelId}/${input.threadTs}`;
  const orient = input.orient?.trim();
  const brainBlock = orient ? `\nBrain (ambient — grep the tree to verify):\n${orient}\n` : "";
  return `The operator asked Locus to work from Slack. You are acting as the operator in that workspace. slack_post sends as them into channel ${input.channelId} (thread ${input.threadTs}) by default; pass as="bot" to post as the Locus app. Wait for Approve unless Autonomous. Do not post status or tool chips to Slack.
${brainBlock}
Instruction:
${instruction}

${wrapUntrusted({
  kind: "slack-message",
  source,
  text: input.excerpt,
})}`;
}

export function slackThreadTs(messageTs: string | undefined, threadTs: string | undefined): string {
  return (threadTs || messageTs || "").trim();
}

/** Thread reply Slack also posted into the parent channel. */
export function isSlackThreadBroadcast(
  message: Pick<SlackMessage, "ts" | "threadTs" | "subtype" | "replyBroadcast">,
): boolean {
  if (!message.threadTs || message.threadTs === message.ts) return false;
  return message.subtype === "thread_broadcast" || message.replyBroadcast === true;
}

export function isSlackDeletedMessage(message: Pick<SlackMessage, "subtype">): boolean {
  return message.subtype === "message_deleted";
}

/** Messages the channel timeline should show: parents plus also-sent-to-channel replies. */
export function isSlackChannelMessage(
  message: Pick<SlackMessage, "ts" | "threadTs" | "subtype" | "replyBroadcast">,
): boolean {
  if (isSlackDeletedMessage(message)) return false;
  return !message.threadTs || message.threadTs === message.ts || isSlackThreadBroadcast(message);
}

export function slackClientUrl(
  teamId: string | undefined,
  channelId: string,
  ts?: string,
): string | undefined {
  const channel = channelId.trim();
  if (!channel) return undefined;
  if (ts?.trim()) return `https://app.slack.com/archives/${channel}/p${ts.replace(".", "")}`;
  const team = teamId?.trim();
  return team
    ? `https://app.slack.com/client/${team}/${channel}`
    : `https://app.slack.com/archives/${channel}`;
}

export function mergeSlackMessageRows(
  existing: SlackMessage[],
  incoming: SlackMessage[],
): SlackMessage[] {
  const byTs = new Map<string, SlackMessage>();
  for (const row of existing) {
    if (!isSlackDeletedMessage(row)) byTs.set(row.ts, row);
  }
  for (const row of incoming) {
    if (isSlackDeletedMessage(row)) byTs.delete(row.ts);
    else byTs.set(row.ts, row);
  }
  return [...byTs.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}

/**
 * Slack's chat.postMessage / files.completeUploadExternal responses often omit
 * `thread_ts` even when the post was a reply. Keep the thread we asked for so
 * the Slack pane does not treat it as a new channel message.
 */
export function withSlackPostedThread(
  message: SlackMessage,
  input: { threadTs?: string; replyBroadcast?: boolean },
): SlackMessage {
  const threadTs = input.threadTs?.trim();
  if (!threadTs) return message;
  const next: SlackMessage = {
    ...message,
    threadTs: message.threadTs || threadTs,
  };
  if (input.replyBroadcast && !isSlackThreadBroadcast(next)) {
    next.replyBroadcast = true;
    if (!next.subtype) next.subtype = "thread_broadcast";
  }
  return next;
}

/** Keep local thread posts when conversations.replies returns a stale snapshot. */
export function mergeSlackThreadReplies(
  threadTs: string,
  fetched: SlackMessage[],
  local: SlackMessage[],
): SlackMessage[] {
  const parent = threadTs.trim();
  const keep = parent ? local.filter((row) => row.ts === parent || row.threadTs === parent) : local;
  return mergeSlackMessageRows(fetched, keep);
}

export interface SlackMentionUser {
  id: string;
  name: string;
  avatarUrl?: string;
}

/** `@query` immediately before the caret, or undefined when the composer is not mentioning. */
export function slackComposerMentionQuery(
  text: string,
  cursor: number,
): { start: number; query: string } | undefined {
  const before = text.slice(0, Math.max(0, cursor));
  const match = /(?:^|[\s])@([A-Za-z0-9._-]*)$/.exec(before);
  if (!match) return undefined;
  const at = before.lastIndexOf("@");
  if (at > 0 && before[at - 1] === "<") return undefined;
  return { start: at, query: match[1] ?? "" };
}

export function insertSlackComposerMention(
  text: string,
  start: number,
  cursor: number,
  user: SlackMentionUser,
): { text: string; cursor: number } {
  const token = `@${user.name} `;
  const next = `${text.slice(0, start)}${token}${text.slice(cursor)}`;
  return { text: next, cursor: start + token.length };
}

/** Turn `@alice` tokens into Slack `<@U123|alice>` so the post notifies that person. */
export function encodeSlackComposerMentions(text: string, users: SlackMentionUser[]): string {
  if (!users.length) return text;
  const byName = new Map(users.map((row) => [row.name.toLowerCase(), row]));
  return text.replace(/(^|[\s])@([A-Za-z0-9._-]+)/g, (full, prefix: string, name: string) => {
    const user = byName.get(name.toLowerCase());
    return user ? `${prefix}<@${user.id}|${user.name}>` : full;
  });
}

export function slackMentionCandidates(input: {
  query?: string;
  selfId?: string;
  conversations?: SlackConversation[];
  messages?: SlackMessage[];
}): SlackMentionUser[] {
  const seen = new Map<string, SlackMentionUser>();
  const add = (id?: string, name?: string, avatarUrl?: string) => {
    const uid = id?.trim();
    if (!uid || uid === input.selfId?.trim()) return;
    const prev = seen.get(uid);
    const label = name?.trim() || uid;
    if (prev) {
      if (!prev.avatarUrl && avatarUrl) prev.avatarUrl = avatarUrl;
      if (prev.name === uid && label !== uid) prev.name = label;
      return;
    }
    seen.set(uid, { id: uid, name: label, avatarUrl });
  };
  for (const row of input.conversations ?? []) {
    if (row.kind === "im") add(row.userId, row.name, row.avatarUrl);
  }
  for (const row of input.messages ?? []) add(row.userId, row.userName, row.avatarUrl);
  const q = input.query?.trim().toLowerCase() ?? "";
  const rows = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (!q) return rows.slice(0, 8);
  return rows
    .filter((row) => row.name.toLowerCase().includes(q) || row.id.toLowerCase().includes(q))
    .slice(0, 8);
}

export type SlackDefaultRuntime = AgentRuntime;

function parseSlackConversationKind(value: unknown): SlackConversationKind | undefined {
  if (value === "channel" || value === "private" || value === "im" || value === "mpim")
    return value;
  return undefined;
}

function inferConversationKind(value: Record<string, unknown>): SlackConversationKind {
  if (value.is_im === true) return "im";
  if (value.is_mpim === true) return "mpim";
  if (value.is_private === true || value.is_group === true) return "private";
  return "channel";
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function nestedValue(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  return str((value as { value?: unknown }).value);
}

function slackProfileImage(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const profile =
    row.profile && typeof row.profile === "object" ? (row.profile as Record<string, unknown>) : row;
  return (
    str(profile.image_72) ||
    str(profile.image_48) ||
    str(profile.image_192) ||
    str(profile.image_32) ||
    str(row.image)
  );
}

function parseSlackReactions(raw: unknown): SlackReaction[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SlackReaction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = normalizeSlackReactionName(str(row.name) || "");
    if (!name) continue;
    const users = Array.isArray(row.users)
      ? row.users.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
      : undefined;
    const count =
      typeof row.count === "number" && row.count > 0 ? row.count : users?.length ? users.length : 0;
    if (count < 1) continue;
    out.push({
      name,
      count,
      ...(users?.length ? { users } : {}),
      ...(row.mine === true ? { mine: true } : {}),
    });
  }
  return out.length ? out : undefined;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function guessMime(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const lower = url.toLowerCase();
  if (lower.includes(".gif") || lower.includes("giphy.com")) return "image/gif";
  if (lower.includes(".webp")) return "image/webp";
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".jpg") || lower.includes(".jpeg")) return "image/jpeg";
  if (lower.includes(".mp4")) return "video/mp4";
  if (lower.includes(".webm")) return "video/webm";
  if (lower.includes(".csv")) return "text/csv";
  return undefined;
}

function detectCsvDelim(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const commas = (first.match(/,/g) ?? []).length;
  const tabs = (first.match(/\t/g) ?? []).length;
  const semis = (first.match(/;/g) ?? []).length;
  if (tabs > commas && tabs >= semis) return "\t";
  if (semis > commas) return ";";
  return ",";
}

function parseCsvRecords(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
        continue;
      }
      cell += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === delim) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((part) => part.length) || rows.length) rows.push(row);
      row = [];
      if (rows.length > SLACK_CSV_PREVIEW_ROWS + 2) break;
      continue;
    }
    cell += ch;
  }
  if (quoted || cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
