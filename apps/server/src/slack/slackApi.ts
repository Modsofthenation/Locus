import {
  SLACK_API_BASE,
  SLACK_ACTIVITY_QUERY,
  SLACK_MOCK_BOT_TOKEN,
  SLACK_MOCK_USER_TOKEN,
  SLACK_UPLOAD_MAX_BYTES,
  extractSlackUserIds,
  isPostableGifUrl,
  isSlackChannelMessage,
  isSlackMentionQuery,
  isSlackPrivateFileUrl,
  normalizeSlackReactionName,
  parseGiphyHit,
  parseSlackConversation,
  parseSlackMessage,
  parseSlackPostAs,
  slackActivityFeed,
  withSlackPostedThread,
  slackMpimDisplayName,
  resolveSlackEmojiMap,
  resolveSlackMentionText,
  searchGifCatalog,
  slackWriteToken,
  toggleSlackReaction,
  withSlackReactionMine,
  type IntegrationAccount,
  type SlackPostAs,
  type SlackConversation,
  type SlackEmojiMap,
  type SlackFile,
  type SlackGifHit,
  type SlackGifSearch,
  type SlackMessage,
  type SlackSearchHit,
  type SlackActivityItem,
} from "@locus/shared";

export type SlackFetcher = typeof fetch;

const MOCK_USERS: Record<string, { name: string; avatarUrl: string }> = {
  U_YOU: { name: "you", avatarUrl: "https://ca.slack-edge.com/T_MOCK-U_YOU.png" },
  U_ALICE: { name: "alice", avatarUrl: "https://ca.slack-edge.com/T_MOCK-U_ALICE.png" },
  U_BOB: { name: "bob", avatarUrl: "https://ca.slack-edge.com/T_MOCK-U_BOB.png" },
  U_BOT: { name: "Locus", avatarUrl: "https://ca.slack-edge.com/T_MOCK-U_BOT.png" },
};

const MOCK_EMOJI: SlackEmojiMap = {
  shipit: "https://emoji.slack-edge.com/T_MOCK/shipit.png",
};

const MOCK_HTML_FAQ = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Cloud Connect printer FAQ</title>
  <style>
    body { margin: 16px; font: 14px/1.45 system-ui, sans-serif; color: #111; background: #fff; }
    h1 { margin: 0 0 10px; font-size: 18px; }
    p { margin: 0 0 8px; }
  </style>
</head>
<body>
  <h1>Cloud Connect printer FAQ</h1>
  <p>Pair the printer from Cloud Connect, then confirm the code on the device.</p>
  <p>If the printer stays offline, power-cycle it and retry pairing.</p>
</body>
</html>`;

const MOCK_CSV_INVENTORY = "sku,qty,bin\nA-100,12,N1\nB-200,4,N2\n";
const MOCK_VIDEO_MP4 = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
const MOCK_PDF_PLAN = (() => {
  const stream =
    "BT /F1 18 Tf 48 140 Td (Q3 plan) Tj 0 -28 Td (Preview this PDF in Locus Slack.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = body.length;
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new TextEncoder().encode(body);
})();

type MockStore = {
  conversations: SlackConversation[];
  messages: SlackMessage[];
};

const mockStores = new Map<string, MockStore>();

function mockStore(): MockStore {
  const existing = mockStores.get("default");
  if (existing) return existing;
  const seed: MockStore = {
    conversations: [
      {
        id: "C_ENG",
        name: "eng",
        kind: "channel",
        topic: "Shipping",
        memberCount: 12,
        lastTs: "1710000004.0",
      },
      {
        id: "C_OPS",
        name: "ops",
        kind: "channel",
        topic: "Incidents",
        memberCount: 8,
        lastTs: "1710000100.0",
      },
      {
        id: "G_SHIP",
        name: "shipyard",
        kind: "private",
        topic: "Launch",
        memberCount: 4,
        lastTs: "1710000150.0",
      },
      {
        id: "D_BOB",
        name: "bob",
        kind: "im",
        userId: "U_BOB",
        lastTs: "1710000200.0",
        unread: true,
      },
      {
        id: "G_CREW",
        name: "mpdm-alice--bob-1",
        kind: "mpim",
        lastTs: "1710000250.0",
        memberCount: 3,
      },
    ],
    messages: [
      {
        ts: "1710000001.0",
        channelId: "C_ENG",
        userId: "U_ALICE",
        userName: "alice",
        avatarUrl: MOCK_USERS.U_ALICE!.avatarUrl,
        text: "can you look at checkout? :wave: cc <@U_YOU> <@U_BOB>",
        replyCount: 1,
        reactions: [{ name: "eyes", count: 2 }],
      },
      {
        ts: "1710000002.0",
        channelId: "C_ENG",
        threadTs: "1710000001.0",
        userId: "U_YOU",
        userName: "you",
        avatarUrl: MOCK_USERS.U_YOU!.avatarUrl,
        text: "on it :shipit:",
      },
      {
        ts: "1710000002.5",
        channelId: "C_ENG",
        threadTs: "1710000001.0",
        userId: "U_YOU",
        userName: "you",
        avatarUrl: MOCK_USERS.U_YOU!.avatarUrl,
        text: "I'll trace whether the TruncDate fallback only dirties activity-log JSON.",
        subtype: "thread_broadcast",
        replyBroadcast: true,
      },
      {
        ts: "1710000003.0",
        channelId: "C_ENG",
        userId: "U_BOB",
        userName: "bob",
        avatarUrl: MOCK_USERS.U_BOB!.avatarUrl,
        text: "",
        files: [
          {
            url: "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
            title: "thumbs up",
            mime: "image/gif",
          },
        ],
      },
      {
        ts: "1710000003.5",
        channelId: "C_ENG",
        userId: "U_ALICE",
        userName: "alice",
        avatarUrl: MOCK_USERS.U_ALICE!.avatarUrl,
        text: "board shots",
        files: [
          {
            url: "https://media.giphy.com/media/26u4cqi2I30qjvdjk/giphy.gif",
            title: "image.png",
            mime: "image/gif",
          },
          {
            url: "https://media.giphy.com/media/111ebonMs90YLu/giphy.gif",
            title: "image.png",
            mime: "image/gif",
          },
          {
            url: "https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif",
            title: "image.png",
            mime: "image/gif",
          },
          {
            url: "https://media.giphy.com/media/mlvseq9yvZhba/giphy.gif",
            title: "image.png",
            mime: "image/gif",
          },
          {
            url: "https://media.giphy.com/media/3oEjI6SIIHBdRiGnM6/giphy.gif",
            title: "image.png",
            mime: "image/gif",
          },
          {
            url: "https://media.giphy.com/media/xT5LMHxhOfsc4FAjlK/giphy.gif",
            title: "image.png",
            mime: "image/gif",
          },
          {
            url: "https://media.giphy.com/media/3o7aCTPPm4OHfRLSH6/giphy.gif",
            title: "image.png",
            mime: "image/gif",
          },
          {
            url: "https://media.giphy.com/media/13GIgrGdslD9oQ/giphy.gif",
            title: "image.png",
            mime: "image/gif",
          },
          {
            url: "https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif",
            title: "image.png",
            mime: "image/gif",
          },
        ],
      },
      {
        ts: "1710000004.0",
        channelId: "C_ENG",
        userId: "U_YOU",
        userName: "you",
        avatarUrl: MOCK_USERS.U_YOU!.avatarUrl,
        text: "clip from this morning",
        files: [
          {
            url: "https://files.slack.com/files-pri/T_MOCK/F_VID/walkthrough.mp4",
            title: "walkthrough.mp4",
            mime: "video/mp4",
            permalink: "https://example.slack.com/files/U_YOU/F_VID/walkthrough.mp4",
          },
        ],
        reactions: [
          { name: "fire", count: 1 },
          { name: "+1", count: 2 },
        ],
      },
      {
        ts: "1710000100.0",
        channelId: "C_OPS",
        userId: "U_BOB",
        userName: "bob",
        avatarUrl: MOCK_USERS.U_BOB!.avatarUrl,
        text: "grafana is noisy again",
      },
      {
        ts: "1710000148.0",
        channelId: "G_SHIP",
        userId: "U_ALICE",
        userName: "alice",
        avatarUrl: MOCK_USERS.U_ALICE!.avatarUrl,
        text: "Would you be able to cast your eyes on this please",
        files: [
          {
            url: "https://files.slack.com/files-pri/T_MOCK/F_HTML/cloud-connect-printer-faq.html",
            title: "cloud-connect-printer-faq.html",
            mime: "text/html",
            permalink:
              "https://example.slack.com/files/U_ALICE/F_HTML/cloud-connect-printer-faq.html",
          },
        ],
        replyCount: 2,
      },
      {
        ts: "1710000148.5",
        channelId: "G_SHIP",
        userId: "U_BOB",
        userName: "bob",
        avatarUrl: MOCK_USERS.U_BOB!.avatarUrl,
        text: "inventory export",
        files: [
          {
            url: "https://files.slack.com/files-pri/T_MOCK/F_CSV/inventory.csv",
            title: "inventory.csv",
            mime: "text/csv",
            permalink: "https://example.slack.com/files/U_BOB/F_CSV/inventory.csv",
          },
        ],
      },
      {
        ts: "1710000149.0",
        channelId: "G_SHIP",
        userId: "U_YOU",
        userName: "you",
        avatarUrl: MOCK_USERS.U_YOU!.avatarUrl,
        text: "walkthrough",
        files: [
          {
            url: "https://files.slack.com/files-pri/T_MOCK/F_VID/walkthrough.mp4",
            title: "walkthrough.mp4",
            mime: "video/mp4",
            permalink: "https://example.slack.com/files/U_YOU/F_VID/walkthrough.mp4",
          },
        ],
      },
      {
        ts: "1710000149.5",
        channelId: "G_SHIP",
        userId: "U_ALICE",
        userName: "alice",
        avatarUrl: MOCK_USERS.U_ALICE!.avatarUrl,
        text: "Q3 plan as PDF — preview in-pane; the chip still downloads.",
        files: [
          {
            url: "https://files.slack.com/files-pri/T_MOCK/F_PDF/q3-plan.pdf",
            title: "q3-plan.pdf",
            mime: "application/pdf",
            permalink: "https://example.slack.com/files/U_ALICE/F_PDF/q3-plan.pdf",
          },
        ],
      },
      {
        ts: "1710000150.0",
        channelId: "G_SHIP",
        userId: "U_ALICE",
        userName: "alice",
        avatarUrl: MOCK_USERS.U_ALICE!.avatarUrl,
        text: "private launch notes",
      },
      {
        ts: "1710000200.0",
        channelId: "D_BOB",
        userId: "U_BOB",
        userName: "bob",
        avatarUrl: MOCK_USERS.U_BOB!.avatarUrl,
        text: "got a minute?",
      },
      {
        ts: "1710000250.0",
        channelId: "G_CREW",
        userId: "U_ALICE",
        userName: "alice",
        avatarUrl: MOCK_USERS.U_ALICE!.avatarUrl,
        text: "shipping the group notes",
      },
    ],
  };
  mockStores.set("default", seed);
  return seed;
}

export function resetSlackMock(): void {
  mockStores.delete("default");
}

function joinUrl(base: string, path: string): string {
  const root = base.includes("/api") ? base.replace(/\/+$/, "") : `${base.replace(/\/+$/, "")}/api`;
  return `${root}${path.startsWith("/") ? path : `/${path}`}`;
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

export function slackApiBase(account: Pick<IntegrationAccount, "baseUrl">): string {
  const base = account.baseUrl?.trim() || SLACK_API_BASE;
  return base.includes("/api") ? base.replace(/\/+$/, "") : `${base.replace(/\/+$/, "")}/api`;
}

export function isMockSlackToken(token: string | undefined): boolean {
  return Boolean(
    token?.startsWith(SLACK_MOCK_USER_TOKEN) ||
    token === "xoxp-mock" ||
    token?.startsWith(SLACK_MOCK_BOT_TOKEN) ||
    token === "xoxb-mock",
  );
}

export function formatSlackApiError(
  body: { error?: string; needed?: string },
  fallback: string,
): Error {
  const error = (typeof body.error === "string" && body.error.trim()) || fallback;
  const needed = typeof body.needed === "string" ? body.needed.trim() : "";
  if (error === "missing_scope" && needed) {
    return new Error(
      `missing_scope (needed: ${needed}). Add that scope on the Slack app, reinstall the app, then Sign in with Slack again.`,
    );
  }
  return new Error(error);
}

export class SlackApi {
  constructor(private readonly fetchFn: SlackFetcher = fetch) {}

  private readonly profiles = new Map<string, { name: string; avatarUrl?: string }>();

  tokenFor(account: IntegrationAccount, as: SlackPostAs = "user"): string {
    const token = slackWriteToken(account, as);
    if (!token) {
      throw new Error(
        as === "bot"
          ? "No Slack bot token. Re-sign in with Slack after adding bot chat:write, or paste an xoxb- token in Settings → Integrations."
          : "Sign in with Slack in Settings → Integrations",
      );
    }
    return token;
  }

  async authTest(
    account: IntegrationAccount,
  ): Promise<{ userId: string; teamId: string; userName?: string; teamName?: string }> {
    const token = this.tokenFor(account);
    if (isMockSlackToken(token)) {
      return { userId: "U_YOU", teamId: "T_MOCK", userName: "you", teamName: "Locus Dev" };
    }
    const body = (await this.postForm(joinUrl(slackApiBase(account), "/auth.test"), token, {})) as {
      ok?: boolean;
      error?: string;
      user_id?: string;
      team_id?: string;
      user?: string;
      team?: string;
    };
    if (body.ok === false || !body.user_id || !body.team_id) {
      throw formatSlackApiError(body, "Slack auth.test failed");
    }
    return { userId: body.user_id, teamId: body.team_id, userName: body.user, teamName: body.team };
  }

  async listConversations(account: IntegrationAccount): Promise<SlackConversation[]> {
    const token = this.tokenFor(account);
    if (isMockSlackToken(token)) {
      return this.hydrateConversations(
        account,
        mockStore().conversations.map((row) => ({ ...row })),
      );
    }
    const typeSets = [
      "public_channel,private_channel,im,mpim",
      "public_channel,private_channel,mpim",
    ];
    let lastError: Error | undefined;
    for (const types of typeSets) {
      try {
        const rows = await this.listConversationsWithTypes(account, token, types);
        return await this.hydrateConversations(account, rows);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (!lastError.message.includes("missing_scope")) throw lastError;
      }
    }
    throw lastError ?? new Error("Slack conversations failed");
  }

  private async listConversationsWithTypes(
    account: IntegrationAccount,
    token: string,
    types: string,
  ): Promise<SlackConversation[]> {
    const rows: SlackConversation[] = [];
    let cursor = "";
    for (let i = 0; i < 8; i++) {
      const params = new URLSearchParams({
        types,
        exclude_archived: "true",
        limit: "200",
      });
      if (cursor) params.set("cursor", cursor);
      const body = (await this.get(
        `${joinUrl(slackApiBase(account), "/users.conversations")}?${params}`,
        token,
      )) as {
        ok?: boolean;
        error?: string;
        needed?: string;
        channels?: unknown[];
        response_metadata?: { next_cursor?: string };
      };
      if (body.ok === false) throw formatSlackApiError(body, "Slack conversations failed");
      for (const raw of body.channels ?? []) {
        const parsed = parseSlackConversation(raw);
        if (parsed) rows.push(parsed);
      }
      cursor = body.response_metadata?.next_cursor?.trim() ?? "";
      if (!cursor) break;
    }
    return rows;
  }

  async history(
    account: IntegrationAccount,
    channelId: string,
    opts: { oldest?: string; latest?: string; limit?: number } = {},
  ): Promise<SlackMessage[]> {
    const token = this.tokenFor(account);
    const limit = Math.min(200, Math.max(1, opts.limit ?? 80));
    if (isMockSlackToken(token)) {
      let rows = mockStore().messages.filter(
        (row) => row.channelId === channelId && isSlackChannelMessage(row),
      );
      if (opts.oldest) {
        const oldest = Number(opts.oldest);
        if (Number.isFinite(oldest)) rows = rows.filter((row) => Number(row.ts) > oldest);
      }
      if (opts.latest) {
        const latest = Number(opts.latest);
        if (Number.isFinite(latest)) rows = rows.filter((row) => Number(row.ts) < latest);
      }
      rows = rows.slice(-limit);
      const profiles = await this.userProfiles(account, rows);
      const viewerId = this.viewerId(account) || "U_YOU";
      return rows
        .map((row) => this.hydrate({ ...row }, profiles, viewerId))
        .filter((row): row is SlackMessage => Boolean(row));
    }
    const params = new URLSearchParams({ channel: channelId, limit: String(limit) });
    if (opts.oldest) params.set("oldest", opts.oldest);
    if (opts.latest) params.set("latest", opts.latest);
    const body = (await this.get(
      `${joinUrl(slackApiBase(account), "/conversations.history")}?${params}`,
      token,
    )) as { ok?: boolean; error?: string; messages?: unknown[] };
    if (body.ok === false) throw formatSlackApiError(body, "Slack history failed");
    const profiles = await this.userProfiles(account, body.messages ?? []);
    const viewerId = this.viewerId(account);
    return (body.messages ?? [])
      .map((raw) => this.hydrate(parseSlackMessage(raw, channelId), profiles, viewerId))
      .filter((row): row is SlackMessage => Boolean(row))
      .reverse();
  }

  async searchMessages(account: IntegrationAccount, query: string): Promise<SlackSearchHit[]> {
    const q = query.trim();
    if (!q) return [];
    const token = this.tokenFor(account);
    if (isMockSlackToken(token)) {
      const convos = mockStore().conversations;
      const asHit = (row: SlackMessage): SlackSearchHit => ({
        channelId: row.channelId,
        channelName: convos.find((c) => c.id === row.channelId)?.name,
        ts: row.ts,
        threadTs: row.threadTs,
        text: row.text,
        userName: row.userName,
      });
      if (isSlackMentionQuery(q, "U_YOU")) {
        return this.hydrateSearchHits(
          account,
          mockStore()
            .messages.filter((row) => extractSlackUserIds(row.text).includes("U_YOU"))
            .slice(0, 20)
            .map(asHit),
        );
      }
      const needle = q.toLowerCase();
      return this.hydrateSearchHits(
        account,
        mockStore()
          .messages.filter((row) => row.text.toLowerCase().includes(needle))
          .slice(0, 20)
          .map(asHit),
      );
    }
    const params = new URLSearchParams({ query: q, count: "20", sort: "timestamp" });
    const body = (await this.get(
      `${joinUrl(slackApiBase(account), "/search.messages")}?${params}`,
      token,
    )) as {
      ok?: boolean;
      error?: string;
      needed?: string;
      messages?: {
        matches?: Array<{
          channel?: { id?: string; name?: string };
          ts?: string;
          thread_ts?: string;
          text?: string;
          username?: string;
          user?: string;
        }>;
      };
    };
    if (body.ok === false) throw formatSlackApiError(body, "Slack search failed");
    const hits: SlackSearchHit[] = [];
    for (const row of body.messages?.matches ?? []) {
      const channelId = row.channel?.id?.trim();
      const ts = row.ts?.trim();
      if (!channelId || !ts) continue;
      hits.push({
        channelId,
        channelName: row.channel?.name,
        ts,
        threadTs: row.thread_ts,
        text: row.text ?? "",
        userName: row.username || row.user,
      });
    }
    return this.hydrateSearchHits(account, hits);
  }

  async listActivity(account: IntegrationAccount): Promise<SlackActivityItem[]> {
    const mentions = await this.searchMessages(account, SLACK_ACTIVITY_QUERY);
    const conversations = await this.listConversations(account);
    return slackActivityFeed(mentions, conversations);
  }

  async replies(
    account: IntegrationAccount,
    channelId: string,
    ts: string,
  ): Promise<SlackMessage[]> {
    const token = this.tokenFor(account);
    if (isMockSlackToken(token)) {
      const rows = mockStore().messages.filter(
        (row) => row.channelId === channelId && (row.ts === ts || row.threadTs === ts),
      );
      const profiles = await this.userProfiles(account, rows);
      const viewerId = this.viewerId(account) || "U_YOU";
      return rows
        .map((row) => this.hydrate({ ...row }, profiles, viewerId))
        .filter((row): row is SlackMessage => Boolean(row));
    }
    const params = new URLSearchParams({ channel: channelId, ts });
    const body = (await this.get(
      `${joinUrl(slackApiBase(account), "/conversations.replies")}?${params}`,
      token,
    )) as { ok?: boolean; error?: string; messages?: unknown[] };
    if (body.ok === false) throw formatSlackApiError(body, "Slack replies failed");
    const profiles = await this.userProfiles(account, body.messages ?? []);
    const viewerId = this.viewerId(account);
    return (body.messages ?? [])
      .map((raw) => this.hydrate(parseSlackMessage(raw, channelId), profiles, viewerId))
      .filter((row): row is SlackMessage => Boolean(row));
  }

  async postMessage(
    account: IntegrationAccount,
    input: {
      channel: string;
      text: string;
      threadTs?: string;
      gif?: { url: string; title?: string };
      as?: SlackPostAs;
      replyBroadcast?: boolean;
    },
  ): Promise<SlackMessage> {
    const as = parseSlackPostAs(input.as);
    const token = this.tokenFor(account, as);
    const gif = input.gif && isPostableGifUrl(input.gif.url) ? input.gif : undefined;
    const text = input.text.trim() || gif?.title?.trim() || (gif ? "GIF" : "");
    if (!text && !gif) throw new Error("text is required");
    const files: SlackFile[] | undefined = gif
      ? [{ url: gif.url, title: gif.title || "GIF", mime: "image/gif" }]
      : undefined;
    if (isMockSlackToken(token)) {
      const store = mockStore();
      const ts = `${(Date.now() / 1000).toFixed(0)}.${String(store.messages.length + 1).padStart(3, "0")}`;
      const asBot = as === "bot";
      const author = asBot ? MOCK_USERS.U_BOT! : MOCK_USERS.U_YOU!;
      const message: SlackMessage = {
        ts,
        channelId: input.channel,
        threadTs: input.threadTs,
        userId: asBot ? "U_BOT" : "U_YOU",
        userName: author.name,
        avatarUrl: author.avatarUrl,
        text,
        files,
        ...(input.threadTs && input.replyBroadcast
          ? { replyBroadcast: true, subtype: "thread_broadcast" }
          : {}),
      };
      store.messages.push(message);
      if (input.threadTs) {
        const parent = store.messages.find(
          (row) => row.channelId === input.channel && row.ts === input.threadTs,
        );
        if (parent) parent.replyCount = (parent.replyCount ?? 0) + 1;
      }
      const conv = store.conversations.find((row) => row.id === input.channel);
      if (conv) conv.lastTs = ts;
      return { ...message, files: files ? files.map((row) => ({ ...row })) : undefined };
    }
    const payload: Record<string, unknown> = {
      channel: input.channel,
      text,
    };
    if (input.threadTs) payload.thread_ts = input.threadTs;
    if (input.threadTs && input.replyBroadcast) payload.reply_broadcast = true;
    if (gif) {
      payload.blocks = [
        {
          type: "image",
          title: { type: "plain_text", text: (gif.title || "GIF").slice(0, 150) },
          image_url: gif.url,
          alt_text: gif.title || "GIF",
        },
      ];
    }
    const body = (await this.postJson(
      joinUrl(slackApiBase(account), "/chat.postMessage"),
      token,
      payload,
    )) as {
      ok?: boolean;
      error?: string;
      ts?: string;
      channel?: string;
      message?: Record<string, unknown>;
    };
    if (body.ok === false) throw formatSlackApiError(body, "Slack post failed");
    const parsed = parseSlackMessage(
      body.message ?? {
        ts: body.ts || `${(Date.now() / 1000).toFixed(3)}`,
        text,
        user: "U_YOU",
        files,
      },
      body.channel || input.channel,
    );
    if (!parsed) throw new Error("Slack post returned no message");
    const withFiles = parsed.files?.length || !files ? parsed : { ...parsed, files };
    const stamped = withSlackPostedThread(withFiles, {
      threadTs: input.threadTs,
      replyBroadcast: input.replyBroadcast,
    });
    const viewerId = this.viewerId(account);
    const profiles = await this.userProfiles(account, [stamped]);
    return this.hydrate(stamped, profiles, viewerId) ?? stamped;
  }

  async uploadFile(
    account: IntegrationAccount,
    input: {
      channel: string;
      filename: string;
      bytes: Uint8Array;
      mime?: string;
      comment?: string;
      threadTs?: string;
      as?: SlackPostAs;
    },
  ): Promise<SlackMessage> {
    const as = parseSlackPostAs(input.as);
    const token = this.tokenFor(account, as);
    const filename = input.filename.trim().replace(/[/\\]/g, "") || "upload";
    const comment = input.comment?.trim() || "";
    if (!input.bytes.byteLength) throw new Error("file is empty");
    if (input.bytes.byteLength > SLACK_UPLOAD_MAX_BYTES)
      throw new Error("file is larger than 20 MiB");
    const files: SlackFile[] = [
      {
        url: `slack-file://${filename}`,
        title: filename,
        mime: input.mime,
        permalink: undefined,
      },
    ];
    if (isMockSlackToken(token)) {
      const store = mockStore();
      const ts = `${(Date.now() / 1000).toFixed(0)}.${String(store.messages.length + 1).padStart(3, "0")}`;
      const asBot = as === "bot";
      const author = asBot ? MOCK_USERS.U_BOT! : MOCK_USERS.U_YOU!;
      const message: SlackMessage = {
        ts,
        channelId: input.channel,
        threadTs: input.threadTs,
        userId: asBot ? "U_BOT" : "U_YOU",
        userName: author.name,
        avatarUrl: author.avatarUrl,
        text: comment || filename,
        files,
      };
      store.messages.push(message);
      const conv = store.conversations.find((row) => row.id === input.channel);
      if (conv) conv.lastTs = ts;
      return { ...message, files: files.map((row) => ({ ...row })) };
    }
    const start = (await this.postJson(
      joinUrl(slackApiBase(account), "/files.getUploadURLExternal"),
      token,
      { filename, length: input.bytes.byteLength },
    )) as { ok?: boolean; error?: string; upload_url?: string; file_id?: string };
    if (start.ok === false || !start.upload_url || !start.file_id) {
      throw formatSlackApiError(start, "Slack file upload URL failed");
    }
    if (!isSlackPrivateFileUrl(start.upload_url)) {
      throw new Error("Slack file upload URL is not a Slack file host");
    }
    const put = await this.fetchFn(start.upload_url, {
      method: "POST",
      headers: input.mime ? { "content-type": input.mime } : undefined,
      body: input.bytes,
    });
    if (!put.ok) throw new Error(`Slack file upload failed (${put.status})`);
    const done = (await this.postJson(
      joinUrl(slackApiBase(account), "/files.completeUploadExternal"),
      token,
      {
        files: [{ id: start.file_id, title: filename }],
        channel_id: input.channel,
        thread_ts: input.threadTs || undefined,
        initial_comment: comment || undefined,
      },
    )) as {
      ok?: boolean;
      error?: string;
      files?: Array<Record<string, unknown>>;
    };
    if (done.ok === false) throw formatSlackApiError(done, "Slack file upload failed");
    const ts = `${(Date.now() / 1000).toFixed(3)}`;
    const parsed = parseSlackMessage(
      {
        ts,
        channel: input.channel,
        text: comment || filename,
        user: as === "bot" ? account.botUserId || "U_BOT" : account.userId || "U_YOU",
        username: as === "bot" ? "Locus" : account.userName,
        files: done.files,
      },
      input.channel,
    );
    const message: SlackMessage = parsed ?? {
      ts,
      channelId: input.channel,
      threadTs: input.threadTs,
      text: comment || filename,
      files,
    };
    const withFiles = message.files?.length ? message : { ...message, files };
    const stamped = withSlackPostedThread(withFiles, { threadTs: input.threadTs });
    const viewerId = this.viewerId(account);
    const profiles = await this.userProfiles(account, [stamped]);
    return this.hydrate(stamped, profiles, viewerId) ?? stamped;
  }

  async react(
    account: IntegrationAccount,
    input: { channel: string; ts: string; name: string; remove?: boolean; threadTs?: string },
  ): Promise<SlackMessage> {
    const name = normalizeSlackReactionName(input.name);
    if (!name) throw new Error("emoji name is required");
    const token = this.tokenFor(account);
    const viewerId = this.viewerId(account) || "U_YOU";
    if (isMockSlackToken(token)) {
      const store = mockStore();
      const idx = store.messages.findIndex(
        (row) => row.channelId === input.channel && row.ts === input.ts,
      );
      if (idx < 0) throw new Error("message not found");
      const next = toggleSlackReaction(store.messages[idx]!, name, viewerId, input.remove);
      store.messages[idx] = next;
      const profiles = await this.userProfiles(account, [next]);
      return this.hydrate({ ...next }, profiles, viewerId) ?? next;
    }
    const method = input.remove ? "reactions.remove" : "reactions.add";
    const body = (await this.postJson(joinUrl(slackApiBase(account), `/${method}`), token, {
      channel: input.channel,
      timestamp: input.ts,
      name,
    })) as { ok?: boolean; error?: string };
    if (body.ok === false && body.error !== "already_reacted" && body.error !== "no_reaction") {
      throw formatSlackApiError(body, "Slack reaction failed");
    }
    const message = await this.getMessage(account, input.channel, input.ts, input.threadTs);
    if (!message) throw new Error("Slack reaction updated but the message could not be reloaded");
    return message;
  }

  async markRead(account: IntegrationAccount, channelId: string, ts?: string): Promise<void> {
    const token = this.tokenFor(account);
    const store = isMockSlackToken(token) ? mockStore() : undefined;
    const stamp =
      ts?.trim() ||
      store?.conversations.find((row) => row.id === channelId)?.lastTs ||
      store?.messages.filter((row) => row.channelId === channelId).at(-1)?.ts;
    if (store) {
      const conv = store.conversations.find((row) => row.id === channelId);
      if (conv) conv.unread = false;
      return;
    }
    if (!stamp) return;
    const body = (await this.postJson(
      joinUrl(slackApiBase(account), "/conversations.mark"),
      token,
      {
        channel: channelId,
        ts: stamp,
      },
    )) as { ok?: boolean; error?: string };
    if (body.ok === false) throw formatSlackApiError(body, "Slack mark read failed");
  }

  async updateMessage(
    account: IntegrationAccount,
    input: { channel: string; ts: string; text: string; as?: SlackPostAs },
  ): Promise<SlackMessage> {
    const text = input.text.trim();
    if (!text) throw new Error("text is required");
    const as = parseSlackPostAs(input.as);
    const token = this.tokenFor(account, as);
    if (isMockSlackToken(token)) {
      const store = mockStore();
      const idx = store.messages.findIndex(
        (row) => row.channelId === input.channel && row.ts === input.ts,
      );
      if (idx < 0) throw new Error("message not found");
      const current = store.messages[idx]!;
      store.messages[idx] = { ...current, text };
      const viewerId = this.viewerId(account) || "U_YOU";
      const profiles = await this.userProfiles(account, [store.messages[idx]!]);
      return this.hydrate({ ...store.messages[idx]! }, profiles, viewerId) ?? store.messages[idx]!;
    }
    const body = (await this.postJson(joinUrl(slackApiBase(account), "/chat.update"), token, {
      channel: input.channel,
      ts: input.ts,
      text,
    })) as {
      ok?: boolean;
      error?: string;
      ts?: string;
      channel?: string;
      message?: Record<string, unknown>;
    };
    if (body.ok === false) throw formatSlackApiError(body, "Slack update failed");
    const parsed = parseSlackMessage(
      body.message ?? { ts: body.ts || input.ts, text, user: this.viewerId(account) },
      body.channel || input.channel,
    );
    if (!parsed) throw new Error("Slack update returned no message");
    const viewerId = this.viewerId(account);
    const profiles = await this.userProfiles(account, [parsed]);
    return this.hydrate(parsed, profiles, viewerId) ?? parsed;
  }

  async deleteMessage(
    account: IntegrationAccount,
    input: { channel: string; ts: string; as?: SlackPostAs },
  ): Promise<SlackMessage> {
    const as = parseSlackPostAs(input.as);
    const token = this.tokenFor(account, as);
    if (isMockSlackToken(token)) {
      const store = mockStore();
      const idx = store.messages.findIndex(
        (row) => row.channelId === input.channel && row.ts === input.ts,
      );
      if (idx < 0) throw new Error("message not found");
      const current = store.messages[idx]!;
      store.messages.splice(idx, 1);
      return { ...current, text: "", subtype: "message_deleted" };
    }
    const body = (await this.postJson(joinUrl(slackApiBase(account), "/chat.delete"), token, {
      channel: input.channel,
      ts: input.ts,
    })) as { ok?: boolean; error?: string };
    if (body.ok === false) throw formatSlackApiError(body, "Slack delete failed");
    return {
      ts: input.ts,
      channelId: input.channel,
      text: "",
      subtype: "message_deleted",
    };
  }

  private async getMessage(
    account: IntegrationAccount,
    channelId: string,
    ts: string,
    threadTs?: string,
  ): Promise<SlackMessage | undefined> {
    try {
      const rows = await this.replies(account, channelId, threadTs || ts);
      const found = rows.find((row) => row.ts === ts);
      if (found) return found;
    } catch {
      /* history still works for channel messages */
    }
    const rows = await this.history(account, channelId, { latest: ts, limit: 8 });
    return rows.find((row) => row.ts === ts);
  }

  async searchGiphy(query: string, apiKey?: string | false): Promise<SlackGifSearch> {
    const q = query.trim();
    const key = apiKey === false ? "" : (apiKey ?? process.env.LOCUS_GIPHY_API_KEY)?.trim();
    let notice: string | undefined;
    if (key) {
      try {
        const params = new URLSearchParams({
          api_key: key,
          limit: "24",
          rating: "pg",
          bundle: "messaging_non_clips",
        });
        if (q) params.set("q", q);
        const path = q ? "search" : "trending";
        const res = await this.fetchFn(`https://api.giphy.com/v1/gifs/${path}?${params}`);
        if (!res.ok) throw new Error(`Giphy HTTP ${res.status}`);
        const body = (await res.json()) as {
          data?: unknown[];
          meta?: { status?: number; msg?: string };
        };
        if (body.meta?.status && body.meta.status >= 400) {
          throw new Error(body.meta.msg || `Giphy ${body.meta.status}`);
        }
        const hits = (body.data ?? [])
          .map(parseGiphyHit)
          .filter((row): row is SlackGifHit => Boolean(row));
        if (hits.length) return { hits, source: "giphy" };
        notice = "Giphy had no matches. Showing the local catalog.";
      } catch {
        notice = "Giphy search failed. Showing the local catalog.";
      }
    } else {
      notice = "Local catalog — set LOCUS_GIPHY_API_KEY for live Giphy search.";
    }
    return { hits: searchGifCatalog(q), source: "catalog", notice };
  }

  async listEmoji(account: IntegrationAccount): Promise<SlackEmojiMap> {
    const token = this.tokenFor(account);
    if (isMockSlackToken(token)) return { ...MOCK_EMOJI };
    try {
      const body = (await this.get(joinUrl(slackApiBase(account), "/emoji.list"), token)) as {
        ok?: boolean;
        error?: string;
        emoji?: Record<string, string>;
      };
      if (body.ok === false) throw formatSlackApiError(body, "Slack emoji failed");
      return resolveSlackEmojiMap(body.emoji ?? {});
    } catch (err) {
      if (err instanceof Error && err.message.includes("missing_scope")) return {};
      throw err;
    }
  }

  async fetchPrivateFile(
    account: IntegrationAccount,
    url: string,
  ): Promise<{ bytes: Uint8Array; mime: string }> {
    const token = this.tokenFor(account);
    if (isMockSlackToken(token)) {
      if (/cloud-connect-printer-faq\.html/i.test(url)) {
        return { bytes: new TextEncoder().encode(MOCK_HTML_FAQ), mime: "text/html" };
      }
      if (/inventory\.csv/i.test(url)) {
        return { bytes: new TextEncoder().encode(MOCK_CSV_INVENTORY), mime: "text/csv" };
      }
      if (/q3-plan\.pdf/i.test(url)) {
        return { bytes: MOCK_PDF_PLAN, mime: "application/pdf" };
      }
      if (/walkthrough\.mp4/i.test(url)) {
        return { bytes: MOCK_VIDEO_MP4, mime: "video/mp4" };
      }
      throw new Error("Slack file failed (404)");
    }
    const res = await this.fetchFn(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`Slack file failed (${res.status})`);
    if (res.url && !isSlackPrivateFileUrl(res.url) && res.url !== url) {
      throw new Error("Slack file redirected off Slack");
    }
    const mime =
      res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > 12 * 1024 * 1024) throw new Error("Slack file is too large");
    return { bytes, mime };
  }

  async viewerAvatar(account: IntegrationAccount): Promise<string | undefined> {
    const id = this.viewerId(account);
    if (!id) return undefined;
    const profiles = await this.userProfiles(account, [{ userId: id }]);
    return profiles.get(id)?.avatarUrl;
  }

  private viewerId(account: IntegrationAccount): string | undefined {
    if (isMockSlackToken(this.tokenFor(account))) return "U_YOU";
    return account.userId?.trim() || undefined;
  }

  private async hydrateConversations(
    account: IntegrationAccount,
    rows: SlackConversation[],
  ): Promise<SlackConversation[]> {
    const pending = rows.flatMap((row) =>
      row.kind === "im" && row.userId ? [{ userId: row.userId }] : [],
    );
    const profiles = pending.length
      ? await this.userProfiles(account, pending)
      : new Map<string, { name: string; avatarUrl?: string }>();
    return rows.map((row) => {
      if (row.kind === "mpim") {
        const name = slackMpimDisplayName(row.name);
        return name === row.name ? row : { ...row, name };
      }
      if (row.kind !== "im" || !row.userId) return row;
      const profile = profiles.get(row.userId);
      if (!profile) return row;
      const generic =
        !row.name || row.name === "direct" || row.name === row.userId || row.name === row.id;
      const name = generic ? profile.name : row.name;
      const avatarUrl = row.avatarUrl || profile.avatarUrl;
      if (name === row.name && avatarUrl === row.avatarUrl) return row;
      return { ...row, name, avatarUrl };
    });
  }

  private async hydrateSearchHits(
    account: IntegrationAccount,
    hits: SlackSearchHit[],
  ): Promise<SlackSearchHit[]> {
    if (!hits.length) return hits;
    const profiles = await this.userProfiles(
      account,
      hits.map((hit) => ({ text: hit.text })),
    );
    const names = new Map<string, string>();
    for (const [id, row] of profiles) {
      if (row.name.trim()) names.set(id, row.name);
    }
    if (!names.size) return hits;
    return hits.map((hit) => {
      const text = resolveSlackMentionText(hit.text, names);
      return text === hit.text ? hit : { ...hit, text };
    });
  }

  private hydrate(
    message: SlackMessage | undefined,
    profiles: Map<string, { name: string; avatarUrl?: string }>,
    viewerId?: string,
  ): SlackMessage | undefined {
    if (!message) return undefined;
    const profile = message.userId ? profiles.get(message.userId) : undefined;
    const userName = message.userName || profile?.name;
    const avatarUrl = message.avatarUrl || profile?.avatarUrl;
    const names = new Map<string, string>();
    for (const [id, row] of profiles) {
      if (row.name.trim()) names.set(id, row.name);
    }
    const text = resolveSlackMentionText(message.text, names);
    const reactions = withSlackReactionMine(message.reactions, viewerId);
    if (
      text === message.text &&
      userName === message.userName &&
      avatarUrl === message.avatarUrl &&
      reactions === message.reactions
    ) {
      return message;
    }
    return { ...message, userName, avatarUrl, text, reactions };
  }

  private async userProfiles(
    account: IntegrationAccount,
    messages: unknown[],
  ): Promise<Map<string, { name: string; avatarUrl?: string }>> {
    const ids = new Set<string>();
    for (const raw of messages) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as { user?: unknown; userId?: unknown; text?: unknown };
      if (typeof row.user === "string" && row.user.trim()) ids.add(row.user.trim());
      if (typeof row.userId === "string" && row.userId.trim()) ids.add(row.userId.trim());
      if (typeof row.text === "string") {
        for (const id of extractSlackUserIds(row.text)) ids.add(id);
      }
    }
    const out = new Map<string, { name: string; avatarUrl?: string }>();
    let fetched = 0;
    for (const id of ids) {
      const cached = this.profiles.get(id);
      if (cached) {
        out.set(id, cached);
        continue;
      }
      const mock = isMockSlackToken(this.tokenFor(account)) ? MOCK_USERS[id] : undefined;
      if (mock) {
        this.profiles.set(id, mock);
        out.set(id, mock);
        continue;
      }
      if (fetched >= 40) continue;
      fetched += 1;
      try {
        const token = this.tokenFor(account);
        const body = (await this.get(
          `${joinUrl(slackApiBase(account), "/users.info")}?user=${encodeURIComponent(id)}`,
          token,
        )) as {
          ok?: boolean;
          user?: {
            real_name?: string;
            name?: string;
            profile?: {
              display_name?: string;
              real_name?: string;
              image_72?: string;
              image_48?: string;
              image_192?: string;
            };
          };
        };
        const name =
          body.user?.profile?.display_name?.trim() ||
          body.user?.profile?.real_name?.trim() ||
          body.user?.real_name ||
          body.user?.name;
        const avatarUrl =
          body.user?.profile?.image_72 ||
          body.user?.profile?.image_48 ||
          body.user?.profile?.image_192;
        if (!name && !avatarUrl) continue;
        const profile = { name: name || id, avatarUrl };
        this.profiles.set(id, profile);
        out.set(id, profile);
      } catch {
        /* leave unresolved */
      }
    }
    return out;
  }

  private async get(url: string, token: string): Promise<unknown> {
    const res = await this.fetchFn(url, { headers: bearer(token) });
    return this.read(res);
  }

  private async postJson(url: string, token: string, body: unknown): Promise<unknown> {
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return this.read(res);
  }

  private async postForm(
    url: string,
    token: string,
    fields: Record<string, string>,
  ): Promise<unknown> {
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });
    return this.read(res);
  }

  private async read(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!res.ok) throw new Error(text.slice(0, 400) || `HTTP ${res.status}`);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { text: text.slice(0, 2_000) };
    }
  }
}
