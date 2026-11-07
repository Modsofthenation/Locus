import {
  DEFAULT_DOCKER_IMAGE,
  formatSlackExcerpt,
  formatSlackRunPrompt,
  isSlackChannelMessage,
  isSlackPrivateFileUrl,
  isSlackStopText,
  messagesSinceTs,
  recipeById,
  resolveSlackRunProvider,
  rewriteSlackMessageMedia,
  slackBotReady,
  slackChannelAllowed,
  slackClientReady,
  slackThreadTs,
  type IntegrationAccount,
  type SlackPostAs,
  type SlackConversation,
  type SlackEmojiMap,
  type SlackGifSearch,
  type SlackMessage,
  type SlackSearchHit,
  type SlackActivityItem,
  type SlackRunInput,
  type SlackStatus,
  type BrainCorpusRow,
} from "@locus/shared";
import type { Hub } from "../core/hub.js";
import type { SessionService } from "../session/sessions.js";
import type { BrainService } from "../brain/brain.js";
import { SlackApi } from "./slackApi.js";
import { SlackCache } from "./slackCache.js";
import { SlackSocket, type SlackSocketConnect, type SlackSocketEnvelope } from "./slackSocket.js";
import type { JsonStore } from "../core/store.js";

export class SlackGateway {
  private readonly api: SlackApi;
  private readonly cache: SlackCache;
  private socket: SlackSocket | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private watching: { channelId: string; oldest?: string } | undefined;
  private lastStatus: SlackStatus = { connected: false, socket: "down", canPostAsBot: false };
  private conversationRefresh: Promise<void> | undefined;
  private emojiRefresh: Promise<void> | undefined;
  private readonly historyRefresh = new Map<string, Promise<void>>();

  constructor(
    private readonly store: JsonStore,
    private readonly sessions: SessionService,
    private readonly hub?: Hub,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly connectFn?: SlackSocketConnect,
    private readonly brain?: BrainService,
  ) {
    this.api = new SlackApi(fetchFn);
    this.cache = new SlackCache(store.dataDir);
  }

  status(): SlackStatus {
    return this.lastStatus;
  }

  async corpusRows(): Promise<BrainCorpusRow[]> {
    const account = await this.account();
    if (!account) return [];
    const teamId = account.teamId || "default";
    const convos = await this.cache.loadConversations(teamId);
    const at = new Date().toISOString();
    const out: BrainCorpusRow[] = [];
    for (const convo of convos.rows.slice(0, 40)) {
      const messages = await this.cache.loadMessages(teamId, convo.id);
      for (const msg of messages.rows.slice(-20)) {
        const text = msg.text?.trim();
        if (!text) continue;
        out.push({
          id: `slack:${teamId}:${convo.id}:${msg.ts}`,
          text: `${convo.name ?? convo.id}: ${text}`.slice(0, 800),
          source: `slack:${convo.id}`,
          createdAt: at,
        });
      }
    }
    return out.slice(0, 200);
  }

  async start(): Promise<void> {
    const account = await this.account();
    if (!account || !slackClientReady(account)) {
      this.socket?.stop();
      this.socket = undefined;
      this.lastStatus = { connected: false, socket: "down", canPostAsBot: false };
      this.broadcastStatus();
      return;
    }
    if (this.socket && this.lastStatus.connected && this.lastStatus.socket === "up") return;
    this.lastStatus = {
      connected: true,
      teamId: account.teamId,
      teamName: account.teamName,
      userId: account.userId,
      userName: account.userName,
      socket: "down",
      canPostAsBot: slackBotReady(account),
    };
    try {
      const avatarUrl = await this.api.viewerAvatar(account);
      if (avatarUrl) this.lastStatus = { ...this.lastStatus, avatarUrl };
    } catch {
      /* profile photo is optional */
    }
    this.broadcastStatus();
    const appToken = account.appToken?.trim();
    if (!appToken) return;
    this.socket?.stop();
    this.socket = new SlackSocket(this.fetchFn, this.connectFn);
    try {
      await this.socket.start(appToken, (envelope) => {
        void this.onEnvelope(envelope);
      });
      this.lastStatus = { ...this.lastStatus, socket: "up" };
      this.broadcastStatus();
    } catch {
      this.socket?.stop();
      this.socket = undefined;
      this.lastStatus = { ...this.lastStatus, socket: "down" };
      this.broadcastStatus();
    }
  }

  stop(): void {
    this.socket?.stop();
    this.socket = undefined;
    this.unwatch();
  }

  async restart(): Promise<void> {
    this.stop();
    await this.start();
  }

  async listConversations(force = false): Promise<SlackConversation[]> {
    const account = await this.requireClient();
    const teamId = account.teamId || "default";
    const cached = await this.cache.loadConversations(teamId);
    const allow = account.allowedSlackChannelIds;
    const visible = (rows: SlackConversation[]) =>
      allow?.length ? rows.filter((row) => allow.includes(row.id)) : rows;
    if (!force && cached.rows.length) {
      if (cached.stale) this.scheduleConversationRefresh(account);
      return visible(cached.rows);
    }
    return visible(await this.refreshConversations(account));
  }

  async setStarred(channelId: string, starred: boolean): Promise<SlackConversation[]> {
    const account = await this.requireClient();
    const teamId = account.teamId || "default";
    const ids = new Set(await this.cache.loadStars(teamId));
    if (starred) ids.add(channelId);
    else ids.delete(channelId);
    await this.cache.saveStars(teamId, [...ids]);
    const cached = await this.cache.loadConversations(teamId);
    const rows = this.cache.applyStars(cached.rows, [...ids]);
    await this.cache.saveConversations(teamId, rows);
    return rows;
  }

  async listEmoji(force = false): Promise<SlackEmojiMap> {
    const account = await this.requireClient();
    const teamId = account.teamId || "default";
    const cached = await this.cache.loadEmoji(teamId);
    if (!force && Object.keys(cached.map).length) {
      if (cached.stale) this.scheduleEmojiRefresh(account);
      return cached.map;
    }
    if (!force && !cached.stale) return cached.map;
    const map = await this.api.listEmoji(account);
    await this.cache.saveEmoji(teamId, map);
    return map;
  }

  async history(
    channelId: string,
    opts: { oldest?: string; latest?: string } = {},
  ): Promise<SlackMessage[]> {
    const account = await this.requireClient();
    this.assertChannelAllowed(account, channelId);
    const teamId = account.teamId || "default";
    const cached = await this.cache.loadMessages(teamId, channelId);
    if (!opts.oldest && !opts.latest && cached.rows.length) {
      this.watch(channelId, cached.rows.at(-1)?.ts);
      if (cached.stale) this.scheduleHistoryRefresh(account, channelId);
      return cached.rows.map(rewriteSlackMessageMedia);
    }
    const rows = await this.api.history(account, channelId, opts);
    const merged = this.cache.mergeMessages(cached.rows, rows);
    await this.cache.saveMessages(teamId, channelId, merged);
    this.watch(channelId, merged.at(-1)?.ts);
    return merged.map(rewriteSlackMessageMedia);
  }

  /** History without taking over the UI-open channel watch. */
  async peekHistory(
    channelId: string,
    opts: { oldest?: string; latest?: string } = {},
  ): Promise<SlackMessage[]> {
    const account = await this.requireClient();
    this.assertChannelAllowed(account, channelId);
    const rows = await this.api.history(account, channelId, opts);
    return rows.map(rewriteSlackMessageMedia);
  }

  async replies(channelId: string, ts: string): Promise<SlackMessage[]> {
    const account = await this.requireClient();
    this.assertChannelAllowed(account, channelId);
    return (await this.api.replies(account, channelId, ts)).map(rewriteSlackMessageMedia);
  }

  async search(query: string): Promise<SlackSearchHit[]> {
    const account = await this.requireClient();
    const hits = await this.api.searchMessages(account, query);
    const allow = account.allowedSlackChannelIds;
    return allow?.length ? hits.filter((row) => allow.includes(row.channelId)) : hits;
  }

  async activity(): Promise<SlackActivityItem[]> {
    const account = await this.requireClient();
    const rows = await this.api.listActivity(account);
    const allow = account.allowedSlackChannelIds;
    return allow?.length ? rows.filter((row) => allow.includes(row.channelId)) : rows;
  }

  async post(
    channelId: string,
    text: string,
    threadTs?: string,
    gif?: { url: string; title?: string },
    as?: SlackPostAs,
    replyBroadcast?: boolean,
  ): Promise<SlackMessage> {
    const account = await this.requireClient();
    this.assertChannelAllowed(account, channelId);
    const message = await this.api.postMessage(account, {
      channel: channelId,
      text,
      threadTs,
      gif,
      as,
      replyBroadcast: Boolean(threadTs && replyBroadcast),
    });
    const teamId = account.teamId || "default";
    const cached = await this.cache.loadMessages(teamId, channelId);
    const merged = this.cache.mergeMessages(cached.rows, [message]);
    await this.cache.saveMessages(teamId, channelId, merged);
    const visible = rewriteSlackMessageMedia(message);
    this.hub?.broadcast({ type: "slack.message", message: visible });
    return visible;
  }

  async upload(
    channelId: string,
    input: {
      filename: string;
      bytes: Uint8Array;
      mime?: string;
      comment?: string;
      threadTs?: string;
      as?: SlackPostAs;
    },
  ): Promise<SlackMessage> {
    const account = await this.requireClient();
    this.assertChannelAllowed(account, channelId);
    const message = await this.api.uploadFile(account, {
      channel: channelId,
      filename: input.filename,
      bytes: input.bytes,
      mime: input.mime,
      comment: input.comment,
      threadTs: input.threadTs,
      as: input.as,
    });
    const teamId = account.teamId || "default";
    const cached = await this.cache.loadMessages(teamId, channelId);
    const merged = this.cache.mergeMessages(cached.rows, [message]);
    await this.cache.saveMessages(teamId, channelId, merged);
    const visible = rewriteSlackMessageMedia(message);
    this.hub?.broadcast({ type: "slack.message", message: visible });
    return visible;
  }

  async react(
    channelId: string,
    ts: string,
    name: string,
    opts: { remove?: boolean; threadTs?: string } = {},
  ): Promise<SlackMessage> {
    const account = await this.requireClient();
    this.assertChannelAllowed(account, channelId);
    const message = await this.api.react(account, {
      channel: channelId,
      ts,
      name,
      remove: opts.remove,
      threadTs: opts.threadTs,
    });
    const teamId = account.teamId || "default";
    const cached = await this.cache.loadMessages(teamId, channelId);
    const merged = this.cache.mergeMessages(cached.rows, [message]);
    await this.cache.saveMessages(teamId, channelId, merged);
    const visible = rewriteSlackMessageMedia(message);
    this.hub?.broadcast({ type: "slack.message", message: visible });
    return visible;
  }

  async markRead(channelId: string, ts?: string): Promise<SlackConversation[]> {
    const account = await this.requireClient();
    this.assertChannelAllowed(account, channelId);
    await this.api.markRead(account, channelId, ts);
    const teamId = account.teamId || "default";
    const cached = await this.cache.loadConversations(teamId);
    const stars = await this.cache.loadStars(teamId);
    const base = cached.rows.length ? cached.rows : await this.api.listConversations(account);
    const rows = this.cache.applyStars(
      base.map((row) => (row.id === channelId ? { ...row, unread: false } : row)),
      stars,
    );
    await this.cache.saveConversations(teamId, rows);
    const updated = rows.find((row) => row.id === channelId);
    if (updated) this.hub?.broadcast({ type: "slack.channel", conversation: updated });
    return rows;
  }

  async update(
    channelId: string,
    ts: string,
    text: string,
    as?: SlackPostAs,
  ): Promise<SlackMessage> {
    const account = await this.requireClient();
    this.assertChannelAllowed(account, channelId);
    const message = await this.api.updateMessage(account, { channel: channelId, ts, text, as });
    const teamId = account.teamId || "default";
    const cached = await this.cache.loadMessages(teamId, channelId);
    const merged = this.cache.mergeMessages(cached.rows, [message]);
    await this.cache.saveMessages(teamId, channelId, merged);
    const visible = rewriteSlackMessageMedia(message);
    this.hub?.broadcast({ type: "slack.message", message: visible });
    return visible;
  }

  async deleteMessage(channelId: string, ts: string, as?: SlackPostAs): Promise<SlackMessage> {
    const account = await this.requireClient();
    this.assertChannelAllowed(account, channelId);
    const message = await this.api.deleteMessage(account, { channel: channelId, ts, as });
    const teamId = account.teamId || "default";
    const cached = await this.cache.loadMessages(teamId, channelId);
    const merged = this.cache.mergeMessages(cached.rows, [message]);
    await this.cache.saveMessages(teamId, channelId, merged);
    this.hub?.broadcast({ type: "slack.message", message });
    return message;
  }

  async searchGiphy(query: string, opts?: { live?: boolean }): Promise<SlackGifSearch> {
    await this.requireClient();
    return this.api.searchGiphy(query, opts?.live === false ? false : undefined);
  }

  async fetchMedia(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
    const account = await this.requireClient();
    if (!isSlackPrivateFileUrl(url)) throw new Error("Only Slack file URLs can be proxied");
    return this.api.fetchPrivateFile(account, url);
  }

  watch(channelId: string, oldest?: string): void {
    this.watching = { channelId, oldest };
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.pollOpen();
    }, 15_000);
  }

  unwatch(): void {
    this.watching = undefined;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  async run(input: SlackRunInput): Promise<{ sessionId: string; created: boolean }> {
    const account = await this.requireClient();
    const userId = input.userId?.trim() || account.userId;
    if (account.userId && userId && userId !== account.userId) {
      throw new Error("Only the signed-in Slack user can start Locus from Slack");
    }
    if (!slackChannelAllowed(account, input.channelId)) {
      throw new Error("This channel is not on the Slack allowlist");
    }
    const threadTs = slackThreadTs(input.messageTs, input.threadTs) || input.messageTs || "";
    if (!threadTs) throw new Error("thread_ts or message_ts is required");
    const instruction = input.text.trim();
    const recipeId = input.recipeId?.trim();
    const recipe = recipeId ? recipeById(recipeId) : undefined;
    if (recipeId && !recipe) throw new Error(`Unknown recipe ${recipeId}`);
    if (isSlackStopText(instruction)) {
      const existing = await this.findBound(input.channelId, threadTs);
      if (existing) await this.sessions.abortChat(existing.id);
      return { sessionId: existing?.id ?? "", created: false };
    }
    const excerpt = await this.excerpt(account, input.channelId, threadTs, input.sinceTs);
    const composed = recipe
      ? [recipe.prompt, instruction && instruction !== recipe.prompt ? instruction : ""]
          .filter(Boolean)
          .join("\n\n")
      : instruction;
    let orient = "";
    if (this.brain) {
      try {
        const repoUrl = account.defaultRepoId
          ? (await this.store.loadRepos()).find((row) => row.id === account.defaultRepoId)?.checkout
              .url
          : undefined;
        orient = await this.brain.orient(repoUrl);
      } catch {
        orient = "";
      }
    }
    const prompt = formatSlackRunPrompt({
      instruction: composed,
      channelId: input.channelId,
      threadTs,
      excerpt,
      orient: orient || undefined,
    });
    const existing = recipe ? undefined : await this.findBound(input.channelId, threadTs);
    if (
      existing &&
      (existing.status === "idle" ||
        existing.status === "running" ||
        existing.status === "provisioning")
    ) {
      if (input.providerId?.trim() || input.model?.trim()) {
        const config = await this.store.loadConfig();
        const { provider, model } = resolveSlackRunProvider(config.providers, input, account);
        if (provider.id !== existing.providerId || model !== existing.model) {
          await this.sessions.patchMeta(existing.id, { providerId: provider.id, model });
        }
      }
      await this.sessions.sendChat(existing.id, prompt);
      this.hub?.broadcast({
        type: "slack.run",
        sessionId: existing.id,
        channelId: input.channelId,
        threadTs,
        status: existing.status,
      });
      return { sessionId: existing.id, created: false };
    }
    const config = await this.store.loadConfig();
    const { provider, model } = resolveSlackRunProvider(config.providers, input, account);
    const template = config.templates.find((row) => row.os === "ubuntu") ?? config.templates[0];
    if (!template) throw new Error("No guest template configured");
    const runtime =
      recipe?.runtime ??
      (account.defaultRuntime === "vm" || account.defaultRuntime === "host"
        ? account.defaultRuntime
        : "docker");
    const os =
      recipe?.os ??
      (template.os === "windows-11" || template.os === "windows-10" ? "ubuntu" : template.os);
    const session = await this.sessions.create({
      title: recipe
        ? `${recipe.title}: ${instruction.slice(0, 48)}`.trim()
        : instruction.slice(0, 72) || "Slack",
      os,
      templateId: template.id,
      kind: recipe?.kind,
      runtime,
      dockerImage: runtime === "docker" ? recipe?.dockerImage || DEFAULT_DOCKER_IMAGE : undefined,
      vision: recipe?.vision,
      playbook: recipe?.playbook,
      allowedTools: recipe?.allowedTools,
      providerId: provider.id,
      model,
      repoId: account.defaultRepoId,
      startVm: true,
      prompt,
      slack: {
        teamId: account.teamId || "default",
        channelId: input.channelId,
        threadTs,
      },
    });
    this.hub?.broadcast({
      type: "slack.run",
      sessionId: session.id,
      channelId: input.channelId,
      threadTs,
      status: session.status,
    });
    return { sessionId: session.id, created: true };
  }

  private async onEnvelope(envelope: SlackSocketEnvelope): Promise<void> {
    const payload = envelope.payload ?? {};
    const type = typeof payload.type === "string" ? payload.type : envelope.type;
    if (type === "slash_commands" || typeof payload.command === "string") {
      const command = String(payload.command ?? "");
      if (command && command !== "/locus") return;
      const text = typeof payload.text === "string" ? payload.text : "";
      const channelId = String(payload.channel_id ?? payload.channel ?? "");
      const userId = String(payload.user_id ?? payload.user ?? "");
      if (!channelId) return;
      const bound = await this.bindMessage(channelId, {
        messageTs: payloadString(payload.message_ts),
        threadTs: payloadString(payload.thread_ts),
      });
      await this.run({
        channelId,
        threadTs: bound.threadTs,
        messageTs: bound.messageTs,
        text,
        userId,
      });
      return;
    }
    if (type === "shortcut" || type === "message_action") {
      const channelId = String(
        (payload.channel as { id?: string } | undefined)?.id ?? payload.channel_id ?? "",
      );
      const message = payload.message as
        { ts?: string; thread_ts?: string; text?: string } | undefined;
      const user = payload.user as { id?: string } | undefined;
      const userId = String(user?.id ?? payload.user_id ?? "");
      if (!channelId || !message?.ts) return;
      await this.run({
        channelId,
        threadTs: message.thread_ts,
        messageTs: message.ts,
        text: "Work from this Slack message.",
        userId,
      });
    }
  }

  private async bindMessage(
    channelId: string,
    input: { messageTs?: string; threadTs?: string },
  ): Promise<{ messageTs: string; threadTs?: string }> {
    const bound = slackThreadTs(input.messageTs, input.threadTs);
    if (bound) return { messageTs: bound, threadTs: input.threadTs || bound };
    try {
      const rows = await this.history(channelId);
      const latest = rows.filter((row) => isSlackChannelMessage(row)).at(-1);
      if (latest) {
        const ts = slackThreadTs(latest.ts, latest.threadTs) || latest.ts;
        return { messageTs: ts, threadTs: ts };
      }
    } catch {
      /* fall through */
    }
    const fallback = `${Date.now() / 1000}`;
    return { messageTs: fallback };
  }

  private async pollOpen(): Promise<void> {
    const watching = this.watching;
    if (!watching) return;
    try {
      const account = await this.requireClient();
      const incoming = await this.api.history(account, watching.channelId, {
        oldest: watching.oldest,
        limit: 80,
      });
      const fresh = watching.oldest
        ? incoming.filter((row) => row.ts > watching.oldest!)
        : incoming;
      if (!fresh.length) return;
      const teamId = account.teamId || "default";
      const cached = await this.cache.loadMessages(teamId, watching.channelId);
      const merged = this.cache.mergeMessages(cached.rows, fresh);
      await this.cache.saveMessages(teamId, watching.channelId, merged);
      const newest = fresh.at(-1)?.ts;
      if (newest) this.watching = { channelId: watching.channelId, oldest: newest };
      for (const message of fresh) {
        this.hub?.broadcast({
          type: "slack.message",
          message: rewriteSlackMessageMedia(message),
        });
      }
    } catch {
      /* keep last snapshot */
    }
  }

  private async excerpt(
    account: IntegrationAccount,
    channelId: string,
    threadTs: string,
    sinceTs?: string,
  ): Promise<string> {
    try {
      if (sinceTs) {
        const rows = await this.api.history(account, channelId, {
          oldest: sinceTs,
          limit: 40,
        });
        return formatSlackExcerpt(messagesSinceTs(rows, sinceTs));
      }
      const rows = await this.api.replies(account, channelId, threadTs);
      return formatSlackExcerpt(
        rows.length ? rows : await this.api.history(account, channelId, { limit: 20 }),
      );
    } catch {
      return "(could not load thread)";
    }
  }

  private async findBound(channelId: string, threadTs: string) {
    const sessions = await this.sessions.list();
    return sessions
      .filter(
        (row) =>
          !row.archived && row.slack?.channelId === channelId && row.slack?.threadTs === threadTs,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }

  private scheduleConversationRefresh(account: IntegrationAccount): void {
    if (this.conversationRefresh) return;
    this.conversationRefresh = this.refreshConversations(account)
      .then((rows) => {
        for (const row of rows) {
          this.hub?.broadcast({ type: "slack.channel", conversation: row });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        this.conversationRefresh = undefined;
      });
  }

  private async refreshConversations(account: IntegrationAccount): Promise<SlackConversation[]> {
    const teamId = account.teamId || "default";
    const rows = await this.api.listConversations(account);
    const allow = account.allowedSlackChannelIds;
    const filtered = allow?.length ? rows.filter((row) => allow.includes(row.id)) : rows;
    const starred = await this.cache.loadStars(teamId);
    const withStars = this.cache.applyStars(filtered, starred);
    await this.cache.saveConversations(teamId, withStars);
    return withStars;
  }

  private scheduleEmojiRefresh(account: IntegrationAccount): void {
    if (this.emojiRefresh) return;
    this.emojiRefresh = this.refreshEmoji(account)
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        this.emojiRefresh = undefined;
      });
  }

  private async refreshEmoji(account: IntegrationAccount): Promise<SlackEmojiMap> {
    const map = await this.api.listEmoji(account);
    await this.cache.saveEmoji(account.teamId || "default", map);
    return map;
  }

  private scheduleHistoryRefresh(account: IntegrationAccount, channelId: string): void {
    if (this.historyRefresh.has(channelId)) return;
    const pending = this.refreshHistory(account, channelId)
      .catch(() => undefined)
      .finally(() => {
        this.historyRefresh.delete(channelId);
      });
    this.historyRefresh.set(channelId, pending);
  }

  private async refreshHistory(account: IntegrationAccount, channelId: string): Promise<void> {
    const teamId = account.teamId || "default";
    const cached = await this.cache.loadMessages(teamId, channelId);
    const rows = await this.api.history(account, channelId);
    const merged = this.cache.mergeMessages(cached.rows, rows);
    await this.cache.saveMessages(teamId, channelId, merged);
    const newestCached = cached.rows.at(-1)?.ts;
    for (const message of merged) {
      if (newestCached && message.ts <= newestCached) continue;
      this.hub?.broadcast({
        type: "slack.message",
        message: rewriteSlackMessageMedia(message),
      });
    }
    const newest = merged.at(-1)?.ts;
    if (this.watching?.channelId === channelId && newest) {
      this.watching = { channelId, oldest: newest };
    }
  }

  private async account(): Promise<IntegrationAccount | undefined> {
    const config = await this.store.loadConfig();
    return (config.integrations ?? []).find((row) => slackClientReady(row));
  }

  private async requireClient(): Promise<IntegrationAccount> {
    const account = await this.account();
    if (!account)
      throw new Error("Sign in with Slack in Settings → Integrations so Locus can act as you");
    if (!account.teamId) {
      try {
        const ident = await this.api.authTest(account);
        const config = await this.store.loadConfig();
        const integrations = (config.integrations ?? []).map((row) =>
          row.id === account.id
            ? {
                ...row,
                teamId: ident.teamId,
                teamName: ident.teamName,
                userId: ident.userId,
                userName: ident.userName,
              }
            : row,
        );
        await this.store.saveConfig({ ...config, integrations });
        return integrations.find((row) => row.id === account.id) ?? { ...account, ...ident };
      } catch {
        return { ...account, teamId: account.teamId || "default" };
      }
    }
    return account;
  }

  private assertChannelAllowed(account: IntegrationAccount, channelId: string): void {
    if (!slackChannelAllowed(account, channelId)) {
      throw new Error("This channel is not on the Slack allowlist");
    }
  }

  private broadcastStatus(): void {
    this.hub?.broadcast({
      type: "slack.status",
      connected: this.lastStatus.connected,
      socket: this.lastStatus.socket,
      teamId: this.lastStatus.teamId,
      teamName: this.lastStatus.teamName,
      userId: this.lastStatus.userId,
      userName: this.lastStatus.userName,
      avatarUrl: this.lastStatus.avatarUrl,
      canPostAsBot: this.lastStatus.canPostAsBot,
    });
  }
}

function payloadString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
