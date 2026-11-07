# Slack in Locus (technical design)

Goal: a first-class **Slack section** in the desktop app so the operator can read and send in channels they already have, **as themselves**, and so Locus can do work from that context and reply **as the same person** — without publishing port 7420.

**Identity rule:** Locus assumes the signed-in Slack user for the client (channel list, history, default send). Teammates see the operator’s name and avatar unless the operator chooses **as Locus**. The Slack app is OAuth + Socket Mode plumbing. Bot posting is opt-in (`chat.postMessage` with the bot token).

Locus stays the local control plane. Slack.com stays the host. Tokens stay in `~/.locus/secrets.enc`. This is not a Slack clone and not a hosted bot SaaS.

Related: [webhook-automations.md](webhook-automations.md) (today’s inbound POST path), [codebase.md](codebase.md) (the UI pattern this copies), [SECURITY.md](../SECURITY.md) (loopback, untrusted fences, approval gates), `IntegrationsClient` in `apps/server/src/integrations/integrations.ts`, `slackSignatureValid` in `apps/server/src/slack/slack.ts`.

## Why this exists

Today Slack is a **tool plus a webhook**. Settings → Integrations holds a Bearer token (usually a **bot** token); agents may call `slack_channels` / `slack_post` (writes wait for Approve / Deny). Automations → On webhook can ingest Slack Events / slash commands if something can POST to loopback or to a Tailscale Funnel on **only** `/api/hooks`.

That is enough to fire an unattended job. It is not enough to **live in Slack as you**:

| Need | Today | Gap |
| --- | --- | --- |
| See channels I can already open | `slack_channels` lists what the **bot token** can see | No UI, no DMs / private channels the *user* is in, no history |
| Send / reply as me | `slack_post` posts as whatever identity that token is | Bot-shaped posts, no composer, no threads |
| Ask Locus to do something | Webhook automation: one prompt, Funnel required | No thread-bound local agent that writes back as you |
| Stay local-first | Funnel is the only public path, scoped to `/api/hooks` | A client needs **outbound** Slack (Socket Mode), not inbound HTTP |

## Product shape

Copy Codebase, not the Slack desktop app.

```
Icon rail: Agents | Design | Codebase | Slack | Docker | Automations
                │
                ▼
┌─────────────┬──────────────────────────────────────────┬─────────────┐
│ workspace   │  #eng                          ⋯  Ask Locus │ thread     │
│ Starred     │  ─────────────────────────────────────────  │ (optional) │
│ Channels    │  10:02  alice   can you look at checkout?   │ replies    │
│   #eng      │  10:04  you     on it                       │ + composer │
│   #ops      │  10:11  you     patch is up, PR linked      │            │
│ DMs         │         (that second line was the agent,    │ Agent chip │
│   @bob      │          posted as you after Approve)       │ in Locus   │
│             │  ┌───────────────────────────────────────┐  │            │
│             │  │ message composer (you, immediately)   │  │            │
│             │  └───────────────────────────────────────┘  │            │
└─────────────┴──────────────────────────────────────────┴─────────────┘
```

In **Slack.app** those two “you” lines are indistinguishable. In **Locus**, agent-authored messages get a small chip so the operator can tell what they typed vs what the model sent.

Empty state (same voice as Codebase): **Sign in with Slack** in Settings → Integrations; Locus is the local client, using *your* user token; Slack.com is still Slack.

### What the operator can do

1. **Browse** public channels, private channels, DMs, and MPIMs they can already see (`users.conversations` with the **user** token).
2. **Read** history and threads (`conversations.history` / `conversations.replies`, user token).
3. **Send as themselves** from the composer (`chat.postMessage`, user token), including **GIFs**, or **send as the Locus bot** when a bot token is stored (composer **as Locus**). Operator-typed sends are an operator action, like a guest-pane click — they do **not** go through chat Approve / Deny. GIF search uses Giphy when `LOCUS_GIPHY_API_KEY` is set; otherwise a tagged local catalog (common reactions still match). Live hits prefer downsized GIF URLs so Slack image blocks can load them. Typing `@` suggests people from DMs and the open timeline and posts a real Slack mention. Thread replies can **Also send to channel**. Drag the thread drawer’s left edge to resize it. Hover **Edit** / **Delete** on your own messages (`chat.update` / `chat.delete`); Up-arrow in an empty composer edits your last message. Opening a conversation marks it read (`conversations.mark`). **Open in Slack** jumps to Slack.app.
4. **See GIFs, images, HTML, CSV, video, and PDF files** teammates posted (Giphy unfurls, image blocks, Slack file GIFs, a sandboxed inline preview of `text/html` uploads, an inline table for CSV/TSV, an inline player for video, and an inline PDF viewer). Slack-hosted files are proxied through Locus with the user token; public Giphy URLs render directly. HTML, CSV, and PDF media still download as an attachment unless the Slack pane requests `preview=1`. Video is served inline so the player can load it.
5. **Ask Locus** from a message, a thread, the composer, `/locus`, or the “Run with Locus” message shortcut. That creates or continues a normal agent session on this machine and binds it to the Slack thread. From Ask Locus, **Review this PR**, **Design this screen**, and **Ops loop** start that named recipe with the thread already attached (a new session — they do not reuse a generic Ask Locus chat). `/locus stop` / `/locus stop now` abort that bound run instead of starting another. The Slack pane has **Search messages**, **Catch me up**, and a **Stop** button while the bound session is running.
6. **Let the agent reply** into that thread via `slack_post` (user token by default, or `as="bot"` for the Locus app). Interactive sessions wait for Approve / Deny. When a `slack_post` is pending, the **thread drawer** shows a **Draft reply** you can edit, then one **Send** (or Deny). Status (running / waiting / error) stays in the Locus UI — do not post “Locus is thinking” into the channel. Slack Copilot dumps into the channel; Locus stays operator-gated.
7. **Catch me up, locally.** A per-channel digest of messages since the last catch-up (capped excerpt). The run stays on this machine; it does not `slack_post` unless you ask. History never leaves for Slack’s cloud.
8. **Subscribe from the Slack pane.** Pin a channel or thread onto an agent from the conversation row (or the thread header). The row shows **Listening**. Same `subscribe` path as a coding chat — Locus does not post a “now listening” notice.
9. **Cite and jump.** When a Slack message mentions a `/workspace/…` file, a GitHub/GitLab/Bitbucket PR URL, or a Locus session id, those become chips that open Files, Codebase, or the bound chat.
10. Jump from the Locus agent chip to the Agents section. Approvals stay in Locus chat. Do not approve `git_push` from Slack in v1.

There is no @Locus bot to invite, mention, or DM. Teammates ask *you*; you run Locus. `/locus` is something **you** type.

### What it must not become (v1)

- A bot that joins channels, gets @mentioned, or is the only way to talk to Locus. Optional composer / `slack_post` as-bot is fine.
- Huddles, Slack Connect admin, canvases, lists, workflows, custom emoji packs, DND.
- A multi-tenant bot that runs agents for teammates’ laptops. One `~/.locus`, one operator.
- Replacing webhook automations. Unattended “POST → run this prompt” stays.
- Approving gated tools from Slack.
- Publishing 7420, widening Funnel past `/api/hooks`, or taking Events API HTTP as the primary live path.
- Indexing or uploading Slack history off this machine. Cache under `~/.locus/slack/` only.
- Posting agent internals (tool chips, “waiting for approval”) into Slack as the operator.

## Two identities

Slack apps still have a bot user because Slack apps do. The Slack **section** signs in as the operator. Posting as the Locus bot is optional.

| Token | Role |
| --- | --- |
| **User (`xoxp-`)** | The product default. Channel list, history, composer send/upload, agent `slack_post` / `slack_upload`, unread. Required for the Slack section. |
| **App (`xapp-`)** | Socket Mode (`apps.connections.open`) so `/locus` and shortcuts arrive without Funnel. Never sent to the model. Never used to post. |
| **Bot (`xoxb-`)** | Optional posting identity. OAuth stores the bot token when bot `chat:write` is granted. Composer toggle **as Locus** and `slack_post` `as="bot"` use it. A pasted bot token in Settings still powers webhook-era `slack_post` until Sign in with Slack succeeds. Reads always prefer the user token. |

Request bot `commands`, `chat:write`, `chat:write.public`, and `files:write` so the app can post and upload to public channels without joining. **Do not** request `channels:join`. **Do not** call `conversations.join` as the bot. **Do not** `chat.postMessage` with the bot token unless the operator chose bot identity (`as="bot"` / composer toggle).

### Live updates without a bot in the room

Socket Mode delivers **app** events (slash commands, shortcuts, interactivity). It does not give a firehose of every channel the user can open — that would require a bot member, which we are not.

So:

- Opening a conversation loads history with the user token and starts a **server** poll (~15s) of new messages only; the hub pushes those into the Slack UI. The UI does not poll history itself.
- Leaving Slack or hiding the window **unwatches**, so Slack.com is not polled in the background.
- Conversation list refreshes when the Slack section is visible (on open, every 60s, and when returning to the tab after 30s). Do not poll every channel’s messages.
- Activity (`search.messages` `@me` plus unread conversations) refreshes every 60s from the app shell so mentions and unread DMs can badge Slack and fire a desktop notification. That is one search, not a poll of every channel. Mentions on a watched channel also land in Activity from the hub `slack.message` event.
- `/locus` and “Run with Locus” still arrive on Socket Mode (interactivity), then Locus posts any reply as the user.

That is honest. Do not pretend Socket Mode is a user-token Slack client protocol.

## Architecture

```
Slack.com
   ▲  HTTPS Web API  (user token for read / default write; bot token when as=bot)
   │  WSS Socket Mode (app token; slash + shortcuts only)
   │
Laptop Locus (127.0.0.1:7420)
   SlackGateway          Hub WS              UI
   - user OAuth          slack.message       Slack section
   - Web API as you      slack.channel       composer (you or Locus)
   - Socket Mode         slack.status        Ask Locus
   - poll open channel        │
                              ▼
                         SessionService.create / chat.send
                         slack_post → user token by default, bot token if as="bot", Approve / Deny
```

Socket Mode is outbound. Slack.com still cannot reach loopback. Funnel stays the public path for **webhook automations** and forge hooks; the Slack client must not depend on it.

Fallback when Socket Mode is off: polling still reads/sends as you. `/locus` will not work until the app token is back; Ask Locus in the UI still will.

Existing `POST /api/hooks/automations/:id` is unchanged. Slash commands aimed at a **webhook automation** keep hitting Funnel. `/locus` on the Locus app arrives on Socket Mode and goes to `SlackGateway`, not `AutomationService.handleWebhook`.

### Control plane (loopback)

All of this binds to 7420 as today. The UI talks to:

| Method | Path | Role |
| --- | --- | --- |
| POST | `/api/slack/oauth/start` | Open Slack OAuth (browser). Same loopback callback family as Bitbucket (`/api/oauth/callback`) with a `state` that names Slack, not a forge. Request **user** scopes. |
| GET | `/api/slack/oauth/status` | Pending / complete / error |
| POST | `/api/slack/oauth/disconnect` | Drop user + app tokens; stop Socket Mode |
| GET | `/api/slack/status` | `{ connected, teamId, teamName, userId, socket, canPostAsBot }` |
| GET | `/api/slack/conversations` | Sidebar list (cached, user token) |
| GET | `/api/slack/conversations/:id/history` | `?oldest=&latest=&limit=` |
| GET | `/api/slack/conversations/:id/replies` | `?ts=` |
| GET | `/api/slack/search` | `?q=` message search (`search:read`; allowlist filtered) |
| POST | `/api/slack/conversations/:id/messages` | Operator send (`as`: `user` default or `bot`; `replyBroadcast` for also-send-to-channel) |
| PATCH | `/api/slack/conversations/:id/messages` | Edit your message (`ts`, `text`) |
| DELETE | `/api/slack/conversations/:id/messages?ts=` | Delete your message |
| POST | `/api/slack/conversations/:id/read` | Mark the conversation read (`conversations.mark`) |
| POST | `/api/slack/run` | Start or continue an agent from a Slack payload (`channel`, `thread_ts`, `text`, `message_ts`) |

No `/join` route. Hub events (extend `ClientEvent` in `packages/shared/src/protocol/events.ts`):

```
slack.status     { connected, socket, teamId, userId }
slack.channel    conversation summary (unread, last ts)
slack.message    one message (channel, ts, thread_ts, user, text, subtype)
slack.run        { sessionId, channel, thread_ts, status }  // Locus UI only
```

Do not put token material or raw Socket Mode envelopes on the hub. Size-cap message text the same way webhook events are capped.

### Data on disk

`~/.locus/slack/<teamId>/` — not in git, not in the prompt. Files are AES-GCM encrypted with the vault master key (same `locus1.` envelope as `secrets.enc`).

```
conversations.json summaries (id, name, isIm, isPrivate, unread, lastTs)
messages/<id>.json last N messages per conversation (cap, e.g. 200)
stars.json         Locus-local starred channel ids
emoji.json         workspace custom emoji map
```

Opening Slack after a reboot serves this snapshot immediately (stale-while-revalidate). Conversations / history / emoji still refresh in the background when older than the TTL (conversations 60s, messages 2 minutes, emoji 1 hour). Reset all data wipes this tree with the rest of `~/.locus`.

Sessions that were started from Slack store a **binding**, not a copy of the channel:

```
session.slack?: {
  teamId: string
  channelId: string
  threadTs: string      // parent ts; top-level messages use their own ts
  lastPostTs?: string   // last message Locus posted as the user (operator or agent)
}
```

Continue-in-thread uses that binding. Do not dump Slack JSON into `session.json` beyond ids and the already-wrapped user message.

### Agent dispatch

One function, used by Socket Mode (`/locus`, shortcut) and by `POST /api/slack/run` (Ask Locus in the UI):

```
dispatchSlackRun({ channelId, threadTs, userId, text, source })
  reject unless userId is the signed-in user
    (slash/shortcut are always the invoking user; Ask Locus is the operator)
  find session with matching slack.channelId+threadTs that is still idle/running
    → chat.send(follow-up), wrap Slack text as untrusted
    (recipeId always creates a new named job instead of reusing)
  else SessionService.create({ ...defaults, optional recipe kind/tools/playbook, slack binding })
    → first user message = operator instruction + untrusted Slack thread excerpt
  do not post a status line to Slack
  on approved slack_post (or Autonomous), post the work product as the user
```

First-turn prompt shape:

```
The operator asked Locus to work from Slack. You are acting as the operator
in that workspace. slack_post sends as them; wait for Approve unless Autonomous.
Instruction:
<the slash text / Ask Locus text>

<untrusted-data kind="slack-message" source="C0123/1234.5678" nonce>
…thread excerpt, size-capped, secrets stripped…
</untrusted-data>
```

Only the operator’s Ask Locus text and `/locus` / shortcut text (they typed it) are trusted instructions. Everyone else’s Slack text in the excerpt is data.

Defaults for a new session: the Slack account `defaultProviderId` / `defaultModel` if set, otherwise the first enabled provider. **Ask Locus** includes a provider and model picker; that pick is sent with the run and remembered in this browser like New agent. Follow-ups in a bound thread apply a changed pick to that session. Runtime and repo still come from `defaultRuntime` / `defaultRepoId`.

Thread follow-ups from the **signed-in user** in a bound thread: treat as `chat.send` (including Steer if a turn is in flight) only when they used `/locus` again or Ask Locus — not every message they type in that thread (those are just them talking to the channel). `/locus stop` maps to `chat.abort`. Do not map Slack reactions to approvals.

Do not post running/waiting/error copy into Slack as the user. The Locus UI shows that. After a successful turn, the model may `slack_post` a human reply (capped like `SLACK_NOTIFY_MAX`, 3_500). That call still hits Approve / Deny in interactive sessions.

### Agent tools (host, vaulted)

Keep `slack_post` / `slack_upload` / `slack_channels`. Reads use the **user** token once Sign in has one. Writes default to the user token; `as="bot"` uses the bot token.

| Tool | When | Approval | Identity |
| --- | --- | --- | --- |
| `slack_channels` | already exists | no | user token (`users.conversations`) |
| `slack_post` | already exists | yes (mutating) | user token by default; bot token when `as="bot"` |
| `slack_upload` | files | yes (mutating) | user token by default; bot token when `as="bot"` |
| `slack_history` | PR 3 | no (hostile output, wrap) | user token |
| `slack_replies` | PR 3 | no (hostile output, wrap) | user token |

`slack_post` description: post as the signed-in operator by default; pass `as="bot"` for the Locus app. Interactive sessions wait for Approve / Deny. Automations keep today’s allowlist opt-in. Offer Slack tools when a Slack account has a **user** token (`integrationReady`); a bot-only leftover token does not unlock the client. After OAuth, user-identity `slack_post` must still prefer the user token.

Mark `slack_history` / `slack_replies` hostile in `packages/shared/src/untrusted.ts` next to `slack_channels`. Add `UntrustedKind` `"slack-message"` (same fence family as `pr-text`).

## Slack app the operator creates

Locus cannot ship a single Slack client id that works for every operator’s workspace without Locus Inc. hosting OAuth. Match GitHub / Bitbucket: the operator pastes an app’s **client id / secret** (or env `LOCUS_SLACK_OAUTH_CLIENT_ID` / `LOCUS_SLACK_OAUTH_CLIENT_SECRET`), enables Socket Mode, and stores the app-level token (Socket Mode still needs it). OAuth is for **user** scopes.

Redirect URL: `http://127.0.0.1:7420/api/oauth/callback` (reuse `forgeOauthCallbackUrl`; document that the Slack app’s redirect must match the bind port).

User scopes (the product): `channels:history`, `channels:read`, `groups:history`, `groups:read`, `im:history`, `im:read`, `mpim:history`, `mpim:read`, `chat:write`, `users:read`, `files:read`, `files:write` (composer and `slack_upload`), `emoji:read` (workspace custom emoji), `reactions:write` (emoji reacts on messages), `search:read` (Slack pane search). `users.conversations` needs `im:read` when listing DMs; without it Slack returns `missing_scope` for the whole list. Reinstall the Slack app after adding `search:read`.

Bot scopes: **`commands`**, **`chat:write`**, **`chat:write.public`**, **`files:write`**. No `app_mentions:read`. No `channels:join`.

Socket Mode: on. Subscribe to slash command / shortcut interactivity, not `message.channels` bot events (those need a bot in the room).

Slash command: `/locus` → `{text}` is the instruction. Exact `stop` or `stop now` (`/locus stop`, `/locus stop now`) aborts the bound thread. The slash line already appears in Slack as the operator. Message shortcut: **Run with Locus**. Replies go through `slack_post` after approval (user token by default, or `as="bot"`).

Ship a `docs/slack-app-manifest.yaml` in PR 1 so the operator can create the app in one paste. Do not commit client secrets. The manifest includes bot `chat:write` and `chat:write.public` for optional app-identity posts.

## Security

Assuming the operator’s identity is the sensitive part. Treat agent Slack posts like `git_push`.

- **Loopback.** No new bind. Socket Mode is outbound WSS to Slack. Funnel remains `/api/hooks` only.
- **Vault.** User and app tokens in `secrets.enc` (`SecretBundle`: keep `integrationTokens` for any leftover bot paste; add `slackUserTokens` / `slackAppTokens` keyed by integration id). Redact in `GET /api/config`. Never log raw Slack payloads or Socket Mode envelopes.
- **Untrusted Slack text.** Thread excerpts and tool history are nonce-fenced. Prompt-injection from `#eng` must not become `git_push` or `slack_post`.
- **Who can start an agent.** The signed-in user only (`/locus`, shortcut, Ask Locus). No teammate mention path.
- **Writes.** Operator composer = operator, immediate. Model `slack_post` = Approve / Deny (posts as the operator). No control-plane status posts into the channel.
- **Approvals.** Stay in Locus. A leaked Slack session must not Approve a push. Approving `slack_post` *is* allowing Locus to speak as you.
- **Egress.** Slack API calls run on the **host** like forge PR tools. Guest jail unchanged.
- **Cache.** `~/.locus/slack/` is workspace message data. Do not send it to providers except the capped excerpt on a dispatch.

Land the operator-facing rules in SECURITY.md in the PR that first dispatches agents (PR 3), including: Slack messages Locus sends are **you**.

## Settings and config

Extend `IntegrationAccount` for `kind: "slack"` only (Jira/Grafana stay token + base URL):

```
authMethod?: "token" | "oauth"
oauthClientId?: string
oauthClientSecret?: string
teamId?: string
teamName?: string
userId?: string
userToken?: string          // vaulted; required for the client
appToken?: string           // vaulted; Socket Mode
allowedSlackChannelIds?: string[]  // optional; empty = any conversation the user can open
defaultRuntime?: AgentRuntime
defaultRepoId?: string
defaultProviderId?: string
defaultModel?: string
```

`token` (bot) remains for leftover pasted tokens and webhook-era tools. `integrationHasToken` for offering the **client** and user-identity `slack_post` is the user token. Settings copy: Sign in with Slack so Locus can act as you.

Settings → Integrations Slack row: **Sign in with Slack**, app token field, client id/secret (like Git), optional channel allowlist (comma-separated IDs), disconnect. Settings → Advanced **Slack signing secret** stays for webhook automations; Socket Mode does not replace it.

Drop `botUserId` / `allowedSlackUserIds` from this design (no bot, no teammate triggers).

## UI map (Codebase as the template)

| Piece | Path | Change |
| --- | --- | --- |
| Rail section | `apps/desktop/src/state/store.ts` `UiSection` | add `"slack"` |
| Rail icon | `apps/desktop/src/components/layout/Sidebar.tsx`, `Icons.tsx` | Slack hash/chat icon; channel list when section is slack |
| Main pane | new `apps/desktop/src/components/slack/Slack.tsx` | empty state, timeline, composer, thread drawer |
| Topbar title | `apps/desktop/src/components/layout/Topbar.tsx` | conversation name, else `"Slack"` |
| App shell | `apps/desktop/src/App.tsx` | render `SlackPane` like `CodebasePane` |
| Palette | `apps/desktop/src/lib/palette.ts` | group `"Slack"`: jump to channel, Ask Locus |
| API client | `apps/desktop/src/lib/api.ts` | slack.* methods |
| Settings | `apps/desktop/src/components/settings/Settings.tsx` | Sign in with Slack on the Slack integration row |
| Tests | `Sidebar.test.tsx`, `Settings.test.tsx`, new `Slack.test.tsx` | rail order, empty state, send as you, Ask Locus |

Sidebar channels: Starred (Locus-local, persisted under `~/.locus/slack/`), Channels, Direct messages. Each group is collapsible; expand/collapse is remembered in this browser. Search filters the list (existing `SearchField`) and temporarily expands groups so matches stay visible. Unread dot matches agent unread styling.

Composer: Enter sends, Shift+Enter newline, no slash-menu of guest commands (those belong in Agents). Secondary button **Ask Locus** on the channel header and on message hover. Hover **React** (or an existing chip / **+**) adds or removes an emoji reaction as you (`reactions.add` / `reactions.remove`). Do not map Slack reactions to Locus approvals.

Own messages: `user === status.userId` render as “You”. If `session.slack.lastPostTs` matches an agent-approved post, show an agent chip **in Locus only**.

Markdown: Slack mrkdwn (`*bold*`, `<@U123>`, `<#C123>`) converted before `formatMarkdown`. Unknown tokens stay as text. Images/files: filename + Slack permalink in v1; no `files.upload` yet.

## PR sequence

Stop after the slice that proves the seam. Do not build a Slack-complete client in the first PR.

### PR 1 — User OAuth, Web API as you, Socket Mode plumbing (no rail section)

Prove: Sign in with Slack stores a **user** token and the bot token when Slack returns `xoxb-`; `SlackClient` lists private channels + IMs as that user against fixtures; `chat.postMessage` in the client helper sends the user token by default and the bot token when `as="bot"`; Socket Mode connects with a fake WSS and acks slash-command envelopes; `GET /api/slack/status` has `userId` and `canPostAsBot` when a bot token exists; OAuth scopes in the start URL include bot `chat:write`.

| Piece | Path |
| --- | --- |
| Types | `packages/shared/src/models/integration.ts`, `config` parse |
| Vault | `apps/server/src/core/vault.ts` user + app tokens |
| OAuth | new `apps/server/src/slack/slackOauth.ts` (mirror `forgeOauth.ts` redirect flow, not device flow) |
| Web API | expand `apps/server/src/integrations/integrations.ts` or new `apps/server/src/slack/slackApi.ts` — user token first |
| Socket Mode | new `apps/server/src/slack/slackSocket.ts` |
| Gateway | new `apps/server/src/slack/slackGateway.ts` (start/stop with the server, reconnect backoff) |
| HTTP | `apps/server/src/app.ts` oauth + status |
| Settings | Sign in / disconnect / app token |
| Manifest | `docs/slack-app-manifest.yaml` (user scopes + `commands` only) |
| Tests | oauth state, vault redaction, no bot post when user token exists, socket ack, list conversations fixture |

Do not add `UiSection` yet. Do not dispatch agents. Do not change Funnel.

### PR 2 — Slack section: read and send as you

Prove: with a mock gateway (no real Slack), the rail opens Slack, lists conversations, shows history, posts a message as the signed-in `userId`, and polling appends new messages. No join/invite control.

| Piece | Path |
| --- | --- |
| Types | `packages/shared/src/models/slack.ts` (conversation, message) |
| Cache | `apps/server/src/slack/slackCache.ts` under `dataDir/slack/` |
| Routes | history, replies, post, conversations |
| Hub | `slack.message` / `slack.channel` / `slack.status` |
| UI | section, sidebar, `Slack.tsx`, palette, topbar |
| Tests | cache TTL, post uses user token, poll path, Sidebar rail includes Slack, empty state copy |

Manual (when a workspace is available): Sign in, open a private channel, send a message, confirm it appears in Slack.app as **you** (your avatar), not an app bot.

### PR 3 — Ask Locus / `/locus` (still you)

Prove: `POST /api/slack/run` creates a Docker (or last-runtime) session with `session.slack` set, wraps the thread as untrusted, does **not** post a bot/status line, and an approved `slack_post` uses the user token. `/locus` from a different Slack user is ignored (should not happen if only you installed the app; still assert). `slack_history` / `slack_replies` are hostile-wrapped.

| Piece | Path |
| --- | --- |
| Session | `AgentSession.slack` on `packages/shared/src/models/session.ts` |
| Dispatch | `slackGateway.dispatchRun` → `SessionService` |
| Tools | `slack_history`, `slack_replies`; `slack_post` defaults to user token, `as="bot"` uses bot token |
| Untrusted | `untrusted.ts` kind `slack-message`; HOSTILE_TOOLS |
| UI | Ask Locus, message hover, agent chip on *your* agent-sent messages, jump to session |
| SECURITY.md / README | operator rules + screenshots after the UI exists |
| Tests | untrusted fence, reuse thread session, no Slack approval of git_push, no bot token on post, automation webhook path unchanged |

### PR 4 — Polish (only if PR 3 is in daily use)

Throttled UI status, optional channel allowlist UI, custom emoji as `:name:`, file permalinks, notify-webhook automations posting **as you** instead of `hooks.slack.com`. `/locus stop` and message search are in. Not a blocker for v1.

## Tests (write first, per PR)

PR 1

1. Vault strips `userToken` / `appToken` from `config.json`; `GET /api/config` redacts them.
2. OAuth callback with a Slack `state` does not go through Bitbucket token exchange.
3. `SlackClient.conversations.list` as user returns private + IM fixtures.
4. Helper `postMessage` with both tokens present calls Slack with the user token; bot token is unused.
5. OAuth authorize URL includes `chat:write` as a **user** scope and does not include bot `chat:write`.
6. Socket Mode test double: slash-command envelope is acked; invalid app token does not throw out of `start()`.
7. Existing `slackSignatureValid` and webhook automation tests still pass.

PR 2

1. `GET /api/slack/conversations` empty without a user token; 200 with fixture cache.
2. Post message calls `chat.postMessage` with the **user** token.
3. Hub `slack.message` updates the open conversation in the desktop test (same style as `Codebase.test.tsx`).
4. Sidebar labels are `Agents, Design, Codebase, Slack, Docker, Automations`.
5. Cache cap: 201st message drops the oldest.
6. No `conversations.join` client or route.

PR 3

1. Dispatch from signed-in user creates a session with `slack.channelId` / `threadTs`.
2. Second `/locus` same thread calls `chat.send`, does not create a second session.
3. Dispatch does not call `chat.postMessage` until `slack_post` is approved.
4. Approved `slack_post` uses the user token; fixture asserts `Authorization: Bearer xoxp-…`.
5. Thread excerpt is inside `<untrusted-data kind="slack-message"`.
6. `toolNeedsApproval("slack_post")` still true.
7. `POST /api/hooks/automations/:id` Slack challenge / mention still queues an **automation**, not a Slack-section run.

Verify:

```bash
npm test --workspace=@locus/shared --workspace=@locus/server --workspace=@locus/desktop
npm run typecheck
```

## Current files this builds on

Do not rewrite these; extend them.

- `packages/shared/src/models/integration.ts` — Slack as an integration kind; `slack_post` / `slack_channels`
- `packages/shared/src/models/webhook.ts` — Event parse, skip bot loops, notify body
- `packages/shared/src/models/config.ts` — `advanced.slackSigningSecret`
- `apps/server/src/integrations/integrations.ts` — Web API helper (today GET `conversations.list`, POST `chat.postMessage` with whatever token is stored)
- `apps/server/src/slack/slack.ts` — Signing-secret HMAC only
- `apps/server/src/automations/automations.ts` `handleWebhook` — Funnel/Events path
- `apps/server/src/git/forgeOauth.ts` — Loopback OAuth callback to reuse for Slack’s redirect
- `apps/server/src/core/vault.ts` / `apps/server/src/core/redact.ts` — Secret strip/mask
- `apps/desktop/src/components/codebase/Codebase.tsx` — Split list + detail UI to copy
- `docs/webhook-automations.md` — Operator notes that stay true

## Explicitly do not do

- Post, join, or @mention as a Locus bot. No “Invite Locus to this channel.”
- Inbound Events API as the way the **client** receives messages (Funnel is for automations).
- Slack RTM, or a second process/daemon the operator must start.
- Hosting a Locus Slack app that all workspaces install (no Locus-operated OAuth).
- Embedding Slack’s JS SDK in the renderer; all Slack HTTP stays on the server.
- Feeding full channel history into the model (capped excerpt only).
- Slack-based Approve / Deny, or mapping emoji to autonomy.
- Status / tool-chip messages into the channel as the operator.
- Replacing first-party `jira_*` / `grafana_*` with a generic “chat integrations” framework in this work.

## Suggested first commit (inside PR 1)

Failing tests: vault redacts a Slack user token; `GET /api/slack/status` is `{ connected: false }` with no account; `postMessage` prefers `xoxp-`. Then `slackOauth` + `slackApi` fixtures + Settings Sign in button. That is a reviewable PR without a new rail icon.
