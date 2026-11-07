import { describe, expect, it } from "vitest";
import {
  parseIntegrationAccount,
  parseSlackPostAs,
  slackAccountLinked,
  slackWriteToken,
  parseSlackChannelAllowlist,
  slackChannelAllowed,
} from "./integration.js";
import {
  SLACK_BOT_SCOPES,
  SLACK_MOCK_USER_TOKEN,
  SLACK_USER_SCOPES,
  conversationLabel,
  formatSlackRunPrompt,
  isSlackOauthState,
  parseSessionSlack,
  parseSlackConversation,
  parseSlackMessage,
  slackMpimDisplayName,
  resolveSlackRunProvider,
  extractSlackUserIds,
  resolveSlackMentionText,
  slackAuthorizeUrl,
  slackFileKindLabel,
  slackFileLooksLikeCsv,
  slackFileLooksLikeHtml,
  slackFileLooksLikeImage,
  slackFileLooksLikePdf,
  slackFileLooksLikeVideo,
  slackHtmlPreviewSrc,
  slackMediaAspectRatio,
  slackMediaCaption,
  slackMediaResponseHeaders,
  parseSlackCsvPreview,
  slackMrkdwnToMarkdown,
  slackThreadTs,
  isSlackChannelMessage,
  isSlackThreadBroadcast,
  isSlackStopText,
  slackLocusStatus,
  formatSlackLocusStatus,
  toggleSlackReaction,
  slackActivityFeed,
  slackActivityHeadline,
  slackActivityPreview,
  slackActivityMentionNames,
  isSlackMentionQuery,
  parseSlackActivityItem,
  newSlackActivityItems,
  shouldNotifySlackActivity,
  shouldFireSlackAlert,
  slackActivityDedupIds,
  slackAlertBody,
  slackTextAlertsViewer,
  slackMessageActivityItem,
  slackClientUrl,
  mergeSlackMessageRows,
  mergeSlackThreadReplies,
  withSlackPostedThread,
  slackComposerMentionQuery,
  insertSlackComposerMention,
  encodeSlackComposerMentions,
  slackMentionCandidates,
  isSlackDeletedMessage,
  slackPostDraftText,
  applySlackPostApprovalText,
  pendingSlackPost,
  messagesSinceTs,
  formatSlackExcerpt,
  parseSlackCites,
  subscriptionMatchesSlack,
  sessionsListeningOnSlack,
  SLACK_WORK_RECIPES,
  SLACK_CATCH_UP_TEXT,
} from "./slack.js";

describe("slack helpers", () => {
  it("builds an authorize URL with user scopes and bot chat:write", () => {
    const url = slackAuthorizeUrl({
      clientId: "cid",
      redirectUri: "http://127.0.0.1:7420/api/oauth/callback",
      state: "slack.abc",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("user_scope")).toContain("chat:write");
    expect(parsed.searchParams.get("user_scope")).toContain("im:read");
    expect(parsed.searchParams.get("user_scope")).toContain("emoji:read");
    expect(parsed.searchParams.get("user_scope")).toContain("reactions:write");
    expect(parsed.searchParams.get("scope")).toBe(
      "commands,chat:write,chat:write.public,files:write",
    );
    expect(SLACK_USER_SCOPES).toContain("chat:write");
    expect(SLACK_USER_SCOPES).toContain("files:read");
    expect(SLACK_USER_SCOPES).toContain("files:write");
    expect(SLACK_USER_SCOPES).toContain("im:read");
    expect(SLACK_USER_SCOPES).toContain("emoji:read");
    expect(SLACK_USER_SCOPES).toContain("reactions:write");
    expect(SLACK_USER_SCOPES).toContain("search:read");
    expect(isSlackStopText("stop")).toBe(true);
    expect(isSlackStopText("  STOP now")).toBe(true);
    expect(isSlackStopText("fix checkout")).toBe(false);
    expect(isSlackStopText("stop looking at grafana")).toBe(false);
    expect(isSlackStopText("stop the flapping alert and check Jira")).toBe(false);
    expect(slackLocusStatus({ status: "running" })).toBe("running");
    expect(slackLocusStatus({ status: "idle", needsHuman: "Approve git_push" })).toBe("waiting");
    expect(
      slackLocusStatus({
        status: "idle",
        messages: [{ toolCalls: [{ approval: "needed" }] }],
      }),
    ).toBe("waiting");
    expect(slackLocusStatus({ status: "idle" })).toBeUndefined();
    expect(formatSlackLocusStatus("waiting")).toBe("Waiting");
    expect(SLACK_BOT_SCOPES).toEqual([
      "commands",
      "chat:write",
      "chat:write.public",
      "files:write",
    ]);
    expect(isSlackOauthState("slack.abc")).toBe(true);
    expect(isSlackOauthState("bb-state")).toBe(false);
  });

  it("selects the bot token only when posting as the app", () => {
    const account = {
      token: "xoxb-bot",
      userToken: "xoxp-user",
    };
    expect(slackWriteToken(account)).toBe("xoxp-user");
    expect(slackWriteToken(account, "user")).toBe("xoxp-user");
    expect(slackWriteToken(account, "bot")).toBe("xoxb-bot");
    expect(slackWriteToken({ token: "xoxb-bot" }, "user")).toBe("xoxb-bot");
    expect(slackWriteToken({ userToken: "xoxp-user" }, "bot")).toBeUndefined();
    expect(parseSlackPostAs("bot")).toBe("bot");
    expect(parseSlackPostAs("user")).toBe("user");
    expect(parseSlackPostAs("nope")).toBe("user");
  });

  it("treats a Slack row as linked from a user token or stored identity", () => {
    expect(slackAccountLinked({ kind: "slack", enabled: true, userToken: "••••••••" })).toBe(true);
    expect(
      slackAccountLinked({ kind: "slack", enabled: true, userName: "you", teamName: "Locus Dev" }),
    ).toBe(true);
    expect(slackAccountLinked({ kind: "slack", enabled: true, userId: "U_YOU" })).toBe(true);
    expect(slackAccountLinked({ kind: "slack", enabled: false, userToken: "xoxp-user" })).toBe(
      false,
    );
    expect(slackAccountLinked({ kind: "slack", enabled: true })).toBe(false);
    expect(slackAccountLinked({ kind: "jira", enabled: true, userToken: "xoxp-user" })).toBe(false);
  });

  it("parses a Slack channel allowlist from commas or whitespace", () => {
    expect(parseSlackChannelAllowlist("C_ENG, C_OPS  C_PRIV")).toEqual([
      "C_ENG",
      "C_OPS",
      "C_PRIV",
    ]);
    expect(parseSlackChannelAllowlist(["C_ENG", " C_OPS ", ""])).toEqual(["C_ENG", "C_OPS"]);
    expect(parseSlackChannelAllowlist("")).toBeUndefined();
    expect(slackChannelAllowed({}, "C_ENG")).toBe(true);
    expect(slackChannelAllowed({ allowedSlackChannelIds: ["C_ENG"] }, "C_ENG")).toBe(true);
    expect(slackChannelAllowed({ allowedSlackChannelIds: ["C_ENG"] }, "C_OPS")).toBe(false);
    expect(
      parseIntegrationAccount({
        id: "slack-1",
        kind: "slack",
        name: "Slack",
        enabled: true,
        baseUrl: "https://slack.com/api",
        allowedSlackChannelIds: "C_ENG, C_OPS",
      })?.allowedSlackChannelIds,
    ).toEqual(["C_ENG", "C_OPS"]);
  });

  it("parses a session binding and formats a run prompt as untrusted Slack data", () => {
    expect(parseSessionSlack({ teamId: "T1", channelId: "C1", threadTs: "1.2" })).toEqual({
      teamId: "T1",
      channelId: "C1",
      threadTs: "1.2",
    });
    const prompt = formatSlackRunPrompt({
      instruction: "fix checkout",
      channelId: "C1",
      threadTs: "1.2",
      excerpt: "alice: the cart is 500",
    });
    expect(prompt).toContain("fix checkout");
    expect(prompt).toContain('kind="slack-message"');
    expect(prompt).toContain('as="bot"');
    expect(prompt).toContain("alice: the cart is 500");
    expect(slackThreadTs("9.9", "1.2")).toBe("1.2");
    expect(slackThreadTs("9.9", undefined)).toBe("9.9");
    const withBrain = formatSlackRunPrompt({
      instruction: "fix checkout",
      channelId: "C1",
      threadTs: "1.2",
      excerpt: "alice: the cart is 500",
      orient: "# Brain\n- billing-gateway owns charge",
    });
    expect(withBrain).toContain("Brain (ambient");
    expect(withBrain).toContain("billing-gateway owns charge");
  });

  it("keeps also-sent-to-channel thread replies in the channel timeline", () => {
    const parent = parseSlackMessage({
      ts: "1.0",
      channel: "C1",
      text: "can you look at checkout?",
      reply_count: 1,
    });
    const reply = parseSlackMessage({
      ts: "1.2",
      channel: "C1",
      thread_ts: "1.0",
      text: "on it",
    });
    const broadcast = parseSlackMessage({
      ts: "1.3",
      channel: "C1",
      thread_ts: "1.0",
      subtype: "thread_broadcast",
      text: "also in the channel",
    });
    const flagged = parseSlackMessage({
      ts: "1.4",
      channel: "C1",
      thread_ts: "1.0",
      reply_broadcast: true,
      text: "flagged broadcast",
    });
    expect(parent && isSlackChannelMessage(parent)).toBe(true);
    expect(reply && isSlackChannelMessage(reply)).toBe(false);
    expect(isSlackThreadBroadcast(reply!)).toBe(false);
    expect(broadcast).toMatchObject({
      subtype: "thread_broadcast",
      replyBroadcast: true,
      threadTs: "1.0",
    });
    expect(isSlackThreadBroadcast(broadcast!)).toBe(true);
    expect(isSlackChannelMessage(broadcast!)).toBe(true);
    expect(flagged?.replyBroadcast).toBe(true);
    expect(isSlackThreadBroadcast(flagged!)).toBe(true);
    expect(isSlackChannelMessage(flagged!)).toBe(true);
  });

  it("keeps thread_ts on a posted reply when Slack omits it from the response", () => {
    const posted = withSlackPostedThread(
      { ts: "1.2", channelId: "C1", text: "on it" },
      { threadTs: "1.0" },
    );
    expect(posted.threadTs).toBe("1.0");
    expect(isSlackChannelMessage(posted)).toBe(false);
    const broadcast = withSlackPostedThread(
      { ts: "1.3", channelId: "C1", text: "also" },
      { threadTs: "1.0", replyBroadcast: true },
    );
    expect(isSlackThreadBroadcast(broadcast)).toBe(true);
    expect(isSlackChannelMessage(broadcast)).toBe(true);
    const already = withSlackPostedThread(
      { ts: "1.4", channelId: "C1", threadTs: "1.0", text: "kept" },
      { threadTs: "9.9" },
    );
    expect(already.threadTs).toBe("1.0");
  });

  it("keeps a local thread reply when conversations.replies is stale", () => {
    const parent = { ts: "1.0", channelId: "C1", text: "can you look?" };
    const local = {
      ts: "1.2",
      channelId: "C1",
      threadTs: "1.0",
      text: "on it",
    };
    const stale = mergeSlackThreadReplies("1.0", [parent], [parent, local]);
    expect(stale.map((row) => row.text)).toEqual(["can you look?", "on it"]);
    const switched = mergeSlackThreadReplies(
      "2.0",
      [{ ts: "2.0", channelId: "C1", text: "other" }],
      [parent, local],
    );
    expect(switched.map((row) => row.text)).toEqual(["other"]);
  });

  it("marks deleted Slack messages and merges them out of the timeline", () => {
    expect(isSlackDeletedMessage({ subtype: "message_deleted" })).toBe(true);
    expect(isSlackChannelMessage({ ts: "1.0", subtype: "message_deleted" })).toBe(false);
    const rows = mergeSlackMessageRows(
      [
        { ts: "1.0", channelId: "C1", text: "keep" },
        { ts: "1.1", channelId: "C1", text: "gone" },
      ],
      [{ ts: "1.1", channelId: "C1", text: "", subtype: "message_deleted" }],
    );
    expect(rows.map((row) => row.ts)).toEqual(["1.0"]);
    expect(slackClientUrl("T1", "C_ENG")).toBe("https://app.slack.com/client/T1/C_ENG");
    expect(slackClientUrl("T1", "C_ENG", "1710000001.0")).toBe(
      "https://app.slack.com/archives/C_ENG/p17100000010",
    );
  });

  it("turns composer @mentions into Slack user tokens", () => {
    expect(slackComposerMentionQuery("hey @al", 7)).toEqual({ start: 4, query: "al" });
    expect(slackComposerMentionQuery("hey <@U_ALICE>", 15)).toBeUndefined();
    const inserted = insertSlackComposerMention("hey @al", 4, 7, { id: "U_ALICE", name: "alice" });
    expect(inserted).toEqual({ text: "hey @alice ", cursor: 11 });
    expect(encodeSlackComposerMentions("hey @alice look", [{ id: "U_ALICE", name: "alice" }])).toBe(
      "hey <@U_ALICE|alice> look",
    );
    const people = slackMentionCandidates({
      query: "bo",
      selfId: "U_YOU",
      conversations: [{ id: "D_BOB", name: "bob", kind: "im", userId: "U_BOB" }],
      messages: [{ ts: "1", channelId: "C1", userId: "U_YOU", userName: "you", text: "hi" }],
    });
    expect(people.map((row) => row.id)).toEqual(["U_BOB"]);
  });

  it("resolves Slack run provider from the request, then the Slack account, then enabled defaults", () => {
    const openai = {
      id: "openai",
      name: "OpenAI",
      kind: "openai" as const,
      baseUrl: "https://api.openai.com/v1",
      models: ["gpt-4.1", "gpt-4.1-mini"],
      defaultModel: "gpt-4.1",
      enabled: true,
      extraHeaders: {},
    };
    const anthropic = {
      id: "anthropic",
      name: "Anthropic",
      kind: "anthropic" as const,
      baseUrl: "https://api.anthropic.com",
      models: ["claude-sonnet-4-5", "claude-opus-4-5"],
      defaultModel: "claude-sonnet-4-5",
      enabled: true,
      extraHeaders: {},
    };
    const account = parseIntegrationAccount({
      id: "slack-1",
      kind: "slack",
      name: "Slack",
      enabled: true,
      baseUrl: "https://slack.com/api",
      defaultProviderId: "anthropic",
      defaultModel: "claude-opus-4-5",
    });
    expect(account?.defaultProviderId).toBe("anthropic");
    expect(account?.defaultModel).toBe("claude-opus-4-5");
    expect(resolveSlackRunProvider([openai, anthropic], {}, account)).toEqual({
      provider: anthropic,
      model: "claude-opus-4-5",
    });
    expect(
      resolveSlackRunProvider(
        [openai, anthropic],
        { providerId: "openai", model: "gpt-4.1-mini" },
        account,
      ),
    ).toEqual({ provider: openai, model: "gpt-4.1-mini" });
    expect(resolveSlackRunProvider([openai, anthropic]).provider).toBe(openai);
    expect(resolveSlackRunProvider([openai, anthropic]).model).toBe("gpt-4.1");
    expect(() => resolveSlackRunProvider([openai], { providerId: "missing" })).toThrow(
      "Unknown provider",
    );
  });

  it("parses Slack IM and MPIM payloads into named conversations", () => {
    const im = parseSlackConversation({
      id: "D0123",
      is_im: true,
      user: "U_BOB",
    });
    expect(im).toMatchObject({ id: "D0123", kind: "im", name: "U_BOB", userId: "U_BOB" });
    const named = parseSlackConversation({
      id: "D0123",
      kind: "im",
      name: "bob",
      userId: "U_BOB",
      avatarUrl: "https://ca.slack-edge.com/bob.png",
    });
    expect(named).toMatchObject({
      kind: "im",
      name: "bob",
      userId: "U_BOB",
      avatarUrl: "https://ca.slack-edge.com/bob.png",
    });
    const mpim = parseSlackConversation({
      id: "G0123",
      name: "mpdm-alice--bob-1",
      is_mpim: true,
      is_group: true,
    });
    expect(mpim).toMatchObject({ id: "G0123", kind: "mpim", name: "alice, bob" });
    expect(slackMpimDisplayName("mpdm-mary-jane--bob-1")).toBe("mary-jane, bob");
    expect(slackMpimDisplayName("alice, bob")).toBe("alice, bob");
    expect(conversationLabel({ name: "direct", kind: "im" })).toBe("@direct");
  });

  it("builds an Activity feed from mentions and unread DMs", () => {
    expect(isSlackMentionQuery("@me")).toBe(true);
    expect(isSlackMentionQuery("<@U_YOU>", "U_YOU")).toBe(true);
    expect(isSlackMentionQuery("checkout")).toBe(false);
    const unread = parseSlackConversation({
      id: "D_BOB",
      kind: "im",
      name: "bob",
      unread_count_display: 2,
    });
    expect(unread?.unread).toBe(true);
    const feed = slackActivityFeed(
      [
        {
          channelId: "C_ENG",
          channelName: "eng",
          ts: "2.0",
          text: "hey <@U_YOU> look",
          userName: "alice",
        },
        {
          channelId: "C_ENG",
          channelName: "eng",
          ts: "2.1",
          threadTs: "2.0",
          text: "thread ping <@U_YOU>",
          userName: "bob",
        },
      ],
      [
        { id: "C_ENG", name: "eng", kind: "channel" },
        { id: "D_BOB", name: "bob", kind: "im", unread: true, lastTs: "1.0" },
      ],
    );
    expect(feed.map((row) => row.kind)).toEqual(["thread", "mention", "dm"]);
    expect(slackActivityHeadline(feed[1]!)).toBe("alice mentioned you in #eng");
    expect(slackActivityPreview("hey <@U_YOU> look")).toBe("hey @U_YOU look");
    expect(
      slackActivityPreview(
        "hey <@U_YOU> look",
        slackActivityMentionNames({ userId: "U_YOU", userName: "you" }),
      ),
    ).toBe("hey @you look");
    expect(parseSlackActivityItem({ channelId: "C1", ts: "1.0", text: "hi" })?.kind).toBe(
      "mention",
    );
    expect(newSlackActivityItems(false, new Set(), feed)).toEqual([]);
    expect(newSlackActivityItems(true, new Set(["C_ENG:2.0"]), feed).map((row) => row.id)).toEqual([
      "C_ENG:2.1",
      "unread:D_BOB",
    ]);
    expect(slackActivityDedupIds({ id: "D_BOB:5.0", channelId: "D_BOB" })).toEqual([
      "D_BOB:5.0",
      "unread:D_BOB",
    ]);
    expect(slackActivityDedupIds({ id: "unread:D_BOB", channelId: "D_BOB" })).toEqual([
      "unread:D_BOB",
    ]);
    expect(
      newSlackActivityItems(
        true,
        new Set(slackActivityDedupIds({ id: "D_BOB:5.0", channelId: "D_BOB" })),
        feed,
      ).map((row) => row.id),
    ).toEqual(["C_ENG:2.1", "C_ENG:2.0"]);
    expect(shouldFireSlackAlert({ kind: "dm" })).toBe(true);
    expect(shouldFireSlackAlert({ kind: "mention" })).toBe(true);
    expect(shouldFireSlackAlert({ kind: "unread" })).toBe(false);
    expect(
      shouldNotifySlackActivity({
        hidden: false,
        section: "slack",
        activityOpen: true,
        selectedChannelId: "C_OPS",
        itemChannelId: "C_ENG",
      }),
    ).toBe(false);
    expect(
      shouldNotifySlackActivity({
        hidden: false,
        section: "agents",
        activityOpen: false,
        selectedChannelId: null,
        itemChannelId: "C_ENG",
      }),
    ).toBe(true);
    expect(
      shouldNotifySlackActivity({
        hidden: false,
        section: "slack",
        activityOpen: false,
        selectedChannelId: "C_ENG",
        itemChannelId: "C_ENG",
      }),
    ).toBe(false);
    expect(
      slackMessageActivityItem(
        {
          ts: "3.0",
          channelId: "C_ENG",
          text: "hey <@U_YOU>",
          userId: "U_ALICE",
          userName: "alice",
        },
        "U_YOU",
        "eng",
      ),
    ).toMatchObject({ kind: "mention", id: "C_ENG:3.0", channelName: "eng" });
    expect(
      slackMessageActivityItem(
        { ts: "3.0", channelId: "C_ENG", text: "hey <@U_YOU>", userId: "U_YOU" },
        "U_YOU",
        "eng",
      ),
    ).toBeUndefined();
    expect(
      slackMessageActivityItem(
        {
          ts: "4.0",
          channelId: "C_ENG",
          text: "standup <!channel>",
          userId: "U_ALICE",
          userName: "alice",
        },
        "U_YOU",
        "eng",
        "channel",
      ),
    ).toMatchObject({ kind: "mention", id: "C_ENG:4.0" });
    expect(
      slackMessageActivityItem(
        { ts: "5.0", channelId: "D_BOB", text: "got a minute?", userId: "U_BOB", userName: "bob" },
        "U_YOU",
        "bob",
        "im",
      ),
    ).toMatchObject({ kind: "dm", id: "D_BOB:5.0", text: "got a minute?" });
    expect(
      slackAlertBody({
        id: "D_BOB:5.0",
        kind: "dm",
        channelId: "D_BOB",
        ts: "5.0",
        text: "got a minute?",
      }),
    ).toBe("got a minute?");
    expect(slackTextAlertsViewer("hey <!here>", "U_YOU")).toBe(true);
    expect(slackTextAlertsViewer("plain update", "U_YOU")).toBe(false);
  });

  it("renders Slack-like labels and mrkdwn", () => {
    expect(conversationLabel({ name: "eng", kind: "channel" })).toBe("#eng");
    expect(conversationLabel({ name: "bob", kind: "im" })).toBe("@bob");
    expect(conversationLabel({ name: "shipyard", kind: "private" })).toBe("\u{1F512}shipyard");
    expect(slackMrkdwnToMarkdown("see <@U1|alice> in <#C1|eng> and *bold*")).toBe(
      "see @alice in #eng and **bold**",
    );
    expect(slackMrkdwnToMarkdown("<!channel> and <!here|here>")).toBe("@channel and @here");
    expect(slackMrkdwnToMarkdown("drop ~this~ now")).toBe("drop ~~this~~ now");
    expect(slackMrkdwnToMarkdown("&gt; I asked Opus 5\n&gt; to do a review")).toBe(
      "> I asked Opus 5\n> to do a review",
    );
    expect(slackMrkdwnToMarkdown("&gt; *bold* quote")).toBe("> **bold** quote");
    expect(slackMrkdwnToMarkdown("AT&amp;T uses &amp;gt;")).toBe("AT&T uses &gt;");
    expect(slackMrkdwnToMarkdown("<@U123> ping")).toBe("@U123 ping");
    expect(extractSlackUserIds("<@U_ALICE> <@U_ALICE> <@U_BOB|bob>")).toEqual(["U_ALICE", "U_BOB"]);
    expect(
      resolveSlackMentionText("<@U_ALICE> <@U_BOB> Testing", new Map([["U_ALICE", "alice"]])),
    ).toBe("<@U_ALICE|alice> <@U_BOB|U_BOB> Testing");
    expect(resolveSlackMentionText("<@U_BOB>", new Map([["U_BOB", "bob"]]))).toBe("<@U_BOB|bob>");
    expect(SLACK_MOCK_USER_TOKEN.startsWith("xoxp-")).toBe(true);
  });

  it("parses Giphy attachments, image blocks, and Slack file GIFs", () => {
    const giphy = parseSlackMessage({
      ts: "1.1",
      channel: "C1",
      text: "",
      attachments: [
        {
          title: "ship it",
          image_url: "https://media.giphy.com/media/abc/giphy.gif",
        },
      ],
    });
    expect(giphy?.files).toEqual([
      {
        url: "https://media.giphy.com/media/abc/giphy.gif",
        title: "ship it",
        alt: undefined,
        mime: "image/gif",
      },
    ]);
    const block = parseSlackMessage({
      ts: "1.2",
      channel: "C1",
      text: "GIF",
      blocks: [
        {
          type: "image",
          image_url: "https://media.giphy.com/media/xyz/giphy.gif",
          alt_text: "party",
          title: { type: "plain_text", text: "party" },
        },
      ],
    });
    expect(block?.files?.[0]?.url).toBe("https://media.giphy.com/media/xyz/giphy.gif");
    expect(block?.files?.[0]?.title).toBe("party");
    const file = parseSlackMessage({
      ts: "1.3",
      channel: "C1",
      files: [
        {
          title: "loop.gif",
          mimetype: "image/gif",
          url_private: "https://files.slack.com/files-pri/T1/F1/loop.gif",
          thumb_360_gif: "https://files.slack.com/files-tmb/T1/F1/loop.gif",
        },
      ],
    });
    expect(file?.files?.[0]?.url).toBe("https://files.slack.com/files-tmb/T1/F1/loop.gif");
    expect(file?.files?.[0]?.mime).toBe("image/gif");
    const sized = parseSlackMessage({
      ts: "1.3size",
      channel: "C1",
      files: [
        {
          title: "shot.png",
          mimetype: "image/png",
          url_private: "https://files.slack.com/files-pri/T1/F1/shot.png",
          original_w: 1920,
          original_h: 1080,
        },
      ],
    });
    expect(sized?.files?.[0]).toMatchObject({ width: 1920, height: 1080 });
    expect(slackMediaAspectRatio(sized!.files![0]!)).toBe("1920 / 1080");
    expect(
      slackMediaAspectRatio({
        url: "https://media.giphy.com/media/x/giphy.gif",
        mime: "image/gif",
      }),
    ).toBe("16 / 9");
    expect(slackMediaAspectRatio({ url: "/clip.mp4", mime: "video/mp4" })).toBe("16 / 9");
    const html = parseSlackMessage({
      ts: "1.3b",
      channel: "C1",
      text: "please review",
      files: [
        {
          title: "cloud-connect-printer-faq.html",
          name: "cloud-connect-printer-faq.html",
          mimetype: "text/html",
          url_private: "https://files.slack.com/files-pri/T1/F1/cloud-connect-printer-faq.html",
          thumb_360: "https://files.slack.com/files-tmb/T1/F1/thumb.png",
          permalink: "https://team.slack.com/files/U1/F1/cloud-connect-printer-faq.html",
        },
      ],
    });
    expect(html?.files).toEqual([
      {
        url: "https://files.slack.com/files-pri/T1/F1/cloud-connect-printer-faq.html",
        title: "cloud-connect-printer-faq.html",
        alt: "cloud-connect-printer-faq.html",
        mime: "text/html",
        permalink: "https://team.slack.com/files/U1/F1/cloud-connect-printer-faq.html",
      },
    ]);
    expect(slackFileLooksLikeImage(html!.files![0]!)).toBe(false);
    expect(slackFileLooksLikeHtml(html!.files![0]!)).toBe(true);
    expect(slackFileKindLabel(html!.files![0]!)).toBe("HTML");
    const video = parseSlackMessage({
      ts: "1.3c",
      channel: "C1",
      text: "clip",
      files: [
        {
          title: "walkthrough.mp4",
          name: "walkthrough.mp4",
          mimetype: "video/mp4",
          url_private: "https://files.slack.com/files-pri/T1/F1/walkthrough.mp4",
          permalink: "https://team.slack.com/files/U1/F1/walkthrough.mp4",
        },
      ],
    });
    expect(video?.files?.[0]?.url).toBe("https://files.slack.com/files-pri/T1/F1/walkthrough.mp4");
    expect(slackFileLooksLikeVideo(video!.files![0]!)).toBe(true);
    expect(slackFileLooksLikeImage(video!.files![0]!)).toBe(false);
    const sheet = parseSlackMessage({
      ts: "1.3d",
      channel: "C1",
      text: "inventory",
      files: [
        {
          title: "inventory.csv",
          name: "inventory.csv",
          mimetype: "text/csv",
          url_private: "https://files.slack.com/files-pri/T1/F1/inventory.csv",
          permalink: "https://team.slack.com/files/U1/F1/inventory.csv",
        },
      ],
    });
    expect(sheet?.files?.[0]?.mime).toBe("text/csv");
    expect(slackFileLooksLikeCsv(sheet!.files![0]!)).toBe(true);
    expect(slackFileLooksLikeHtml({ url: "/docs/faq.htm", title: "faq.htm" })).toBe(true);
    expect(
      slackFileLooksLikeHtml({ url: "https://files.slack.com/a.png", mime: "image/png" }),
    ).toBe(false);
    expect(
      slackFileLooksLikeImage({ url: "https://files.slack.com/a.png", mime: "image/png" }),
    ).toBe(true);
    expect(
      slackFileLooksLikeVideo({
        url: "https://files.slack.com/files-pri/T1/F1/clip.mp4",
        mime: "video/mp4",
        title: "clip.mp4",
      }),
    ).toBe(true);
    expect(
      slackFileLooksLikeVideo({ url: "https://files.slack.com/a.png", mime: "image/png" }),
    ).toBe(false);
    expect(slackFileKindLabel({ url: "/clip.mp4", mime: "video/mp4", title: "clip.mp4" })).toBe(
      "Video",
    );
    expect(
      slackFileLooksLikeCsv({
        url: "https://files.slack.com/files-pri/T1/F1/inventory.csv",
        mime: "text/csv",
        title: "inventory.csv",
      }),
    ).toBe(true);
    expect(slackFileLooksLikeCsv({ url: "/notes.tsv", title: "notes.tsv" })).toBe(true);
    expect(
      slackFileKindLabel({ url: "/inventory.csv", mime: "text/csv", title: "inventory.csv" }),
    ).toBe("CSV");
    expect(slackFileKindLabel({ url: "/notes.tsv", title: "notes.tsv" })).toBe("TSV");
    expect(
      slackFileLooksLikePdf({
        url: "https://files.slack.com/files-pri/T1/F1/q3-plan.pdf",
        mime: "application/pdf",
        title: "q3-plan.pdf",
      }),
    ).toBe(true);
    expect(slackFileLooksLikePdf({ url: "/notes.pdf", title: "notes.pdf" })).toBe(true);
    expect(slackFileLooksLikePdf({ url: "https://files.slack.com/a.png", mime: "image/png" })).toBe(
      false,
    );
    expect(
      slackFileKindLabel({ url: "/notes.pdf", mime: "application/pdf", title: "notes.pdf" }),
    ).toBe("PDF");
    expect(slackFileKindLabel({ url: "/brief.pdf", title: "brief.pdf" })).toBe("PDF");
    const csv = parseSlackCsvPreview('sku,qty\n"A,1",2\nB,3');
    expect(csv.headers).toEqual(["sku", "qty"]);
    expect(csv.rows).toEqual([
      ["A,1", "2"],
      ["B", "3"],
    ]);
    expect(csv.truncated).toBe(false);
    expect(slackMediaResponseHeaders("text/html")["content-disposition"]).toBe("attachment");
    expect(slackMediaResponseHeaders("text/html")["content-security-policy"]).toBeUndefined();
    expect(slackMediaResponseHeaders("text/html", { preview: true })["content-disposition"]).toBe(
      "inline",
    );
    expect(
      slackMediaResponseHeaders("text/html", { preview: true })["content-security-policy"],
    ).toMatch(/default-src 'none'/);
    expect(
      slackMediaResponseHeaders("application/pdf", { preview: true })["content-disposition"],
    ).toBe("inline");
    expect(slackMediaResponseHeaders("application/pdf")["content-disposition"]).toBe("attachment");
    expect(slackMediaResponseHeaders("image/png")["content-disposition"]).toBeUndefined();
    expect(slackMediaResponseHeaders("video/mp4")["content-disposition"]).toBe("inline");
    expect(slackMediaResponseHeaders("text/csv")["content-disposition"]).toBe("attachment");
    expect(slackMediaResponseHeaders("text/csv", { preview: true })["content-disposition"]).toBe(
      "inline",
    );
    expect(slackMediaResponseHeaders("text/csv", { preview: true })["content-type"]).toMatch(
      /charset=utf-8/,
    );
    expect(
      slackHtmlPreviewSrc(
        "/api/slack/media?url=https%3A%2F%2Ffiles.slack.com%2Ffiles-pri%2FT1%2FF1%2Ffaq.html",
      ),
    ).toBe(
      "/api/slack/media?url=https%3A%2F%2Ffiles.slack.com%2Ffiles-pri%2FT1%2FF1%2Ffaq.html&preview=1",
    );
    expect(
      slackHtmlPreviewSrc(
        "/api/slack/media?url=https%3A%2F%2Ffiles.slack.com%2Ffaq.html&preview=1",
      ),
    ).toBe("/api/slack/media?url=https%3A%2F%2Ffiles.slack.com%2Ffaq.html&preview=1");
    expect(slackHtmlPreviewSrc("https://files.slack.com/faq.html")).toBeUndefined();
    const reacted = parseSlackMessage({
      ts: "1.4",
      channel: "C1",
      text: "shipped",
      user: "U_ALICE",
      reactions: [{ name: "tada", count: 3, users: ["U_YOU", "U_BOB"] }],
    });
    expect(reacted?.reactions).toEqual([{ name: "tada", count: 3, users: ["U_YOU", "U_BOB"] }]);
    const mine = parseSlackMessage({
      ts: "1.5",
      channel: "C1",
      text: "cached",
      reactions: [{ name: "eyes", count: 1, mine: true }],
    });
    expect(mine?.reactions).toEqual([{ name: "eyes", count: 1, mine: true }]);
    const added = toggleSlackReaction(
      { ts: "1.4", channelId: "C1", text: "shipped", reactions: [{ name: "tada", count: 3 }] },
      "+1",
      "U_YOU",
    );
    expect(added.reactions).toEqual([
      { name: "tada", count: 3 },
      { name: "+1", count: 1, users: ["U_YOU"], mine: true },
    ]);
    const removed = toggleSlackReaction(added, "+1", "U_YOU");
    expect(removed.reactions).toEqual([{ name: "tada", count: 3 }]);
    const skin = parseSlackMessage({
      ts: "1.6",
      channel: "C1",
      text: "tone",
      reactions: [
        { name: "+1::skin-tone-3", count: 1, users: ["U_YOU"] },
        { name: "<img>", count: 1 },
      ],
    });
    expect(skin?.reactions).toEqual([{ name: "+1::skin-tone-3", count: 1, users: ["U_YOU"] }]);
    expect(toggleSlackReaction(skin!, "+1::skin-tone-3", "U_YOU").reactions).toBeUndefined();
  });

  it("hides generic Slack upload filenames as captions", () => {
    expect(slackMediaCaption("image.png")).toBeUndefined();
    expect(slackMediaCaption("image (1).png")).toBeUndefined();
    expect(slackMediaCaption("loop.gif")).toBeUndefined();
    expect(slackMediaCaption("GIF", "GIF")).toBeUndefined();
    expect(slackMediaCaption("walkthrough.mp4")).toBeUndefined();
    expect(slackMediaCaption("Screencast from 2026-08-17 12-11-59.mp4")).toBeUndefined();
    expect(slackMediaCaption("Screen Recording 2026-08-17 at 12.11.59.mov")).toBeUndefined();
    expect(slackMediaCaption("Screen Recording 2026-08-17 at 12.11.59 AM.mov")).toBeUndefined();
    expect(slackMediaCaption("Recording 2026-08-17 120159.mp4")).toBeUndefined();
    expect(slackMediaCaption("Recording")).toBe("Recording");
    expect(slackMediaCaption("Screencast")).toBe("Screencast");
    expect(slackMediaCaption("ship it")).toBe("ship it");
    expect(slackMediaCaption("Q3 demo walkthrough")).toBe("Q3 demo walkthrough");
    expect(slackMediaCaption("Screencast of the new onboarding")).toBe(
      "Screencast of the new onboarding",
    );
    expect(slackMediaCaption("thumbs up", "thumbs up")).toBeUndefined();
  });

  it("finds a pending slack_post draft and applies an edited Send", () => {
    expect(slackPostDraftText({ text: "ship it" })).toBe("ship it");
    expect(slackPostDraftText({ body: "from body" })).toBe("from body");
    expect(
      applySlackPostApprovalText("slack_post", { channel: "C1", body: "old" }, "  edited  "),
    ).toEqual({ channel: "C1", text: "edited" });
    expect(applySlackPostApprovalText("exec", { command: "ls" }, "nope")).toEqual({
      command: "ls",
    });
    expect(
      pendingSlackPost({
        messages: [
          {
            toolCalls: [
              {
                id: "t1",
                name: "slack_post",
                arguments: { text: "draft reply" },
                approval: "needed",
              },
            ],
          },
        ],
      }),
    ).toEqual({ toolCallId: "t1", text: "draft reply" });
    expect(
      pendingSlackPost({
        messages: [
          {
            toolCalls: [{ id: "t1", name: "slack_post", approval: "needed", finishedAt: "now" }],
          },
        ],
      }),
    ).toBeNull();
  });

  it("caps a catch-up excerpt and lists Slack work recipes", () => {
    expect(SLACK_CATCH_UP_TEXT).toMatch(/Do not slack_post/);
    expect(SLACK_WORK_RECIPES.map((row) => row.recipeId)).toEqual([
      "pr-reviewer",
      "app-dashboard",
      "ops-loop",
    ]);
    const rows = [
      { ts: "1.0", userName: "alice", text: "old" },
      { ts: "2.0", userName: "bob", text: "new" },
    ];
    expect(messagesSinceTs(rows, "1.0").map((row) => row.ts)).toEqual(["2.0"]);
    expect(formatSlackExcerpt(rows, { limit: 1, totalChars: 80 })).toBe("bob: new");
  });

  it("parses file, PR, and session cites from Slack text", () => {
    const sessionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const cites = parseSlackCites(
      `see /workspace/apps/desktop/src/components/Slack.tsx and https://github.com/acme/app/pull/12 then ${sessionId}`,
      [sessionId],
    );
    expect(cites).toEqual([
      {
        kind: "file",
        path: "/workspace/apps/desktop/src/components/Slack.tsx",
        label: "apps/desktop/src/components/Slack.tsx",
      },
      {
        kind: "pr",
        url: "https://github.com/acme/app/pull/12",
        repoUrl: "https://github.com/acme/app.git",
        label: "acme/app#12",
        number: 12,
      },
      { kind: "session", sessionId, label: "Open agent" },
    ]);
    expect(parseSlackCites("no cites here", [sessionId])).toEqual([]);
  });

  it("matches Slack pane listen subscriptions by channel or thread", () => {
    expect(subscriptionMatchesSlack({ kind: "slack_channel", channelId: "C_ENG" }, "C_ENG")).toBe(
      true,
    );
    expect(
      subscriptionMatchesSlack(
        { kind: "slack_thread", channelId: "C_ENG", threadTs: "1.0" },
        "C_ENG",
      ),
    ).toBe(false);
    expect(
      subscriptionMatchesSlack(
        { kind: "slack_thread", channelId: "C_ENG", threadTs: "1.0" },
        "C_ENG",
        "1.0",
      ),
    ).toBe(true);
    const listening = sessionsListeningOnSlack(
      [
        { id: "s1", subscriptions: [{ kind: "slack_channel", channelId: "C_ENG" }] },
        {
          id: "s2",
          archived: true,
          subscriptions: [{ kind: "slack_channel", channelId: "C_ENG" }],
        },
      ],
      "C_ENG",
    );
    expect(listening.map((row) => row.id)).toEqual(["s1"]);
  });
});
