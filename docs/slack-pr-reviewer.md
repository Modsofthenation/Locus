# Slack PR reviewer

Point a reviewer at a Slack channel. When someone posts a pull request link there, Locus reviews it and reports in that message's thread (it can also find new PRs on its own, see [Reviews without a Slack post](#reviews-without-a-slack-post)):

```
alice   can someone look at https://github.com/acme/api/pull/482
  └ Locus  👀 Looking at acme/api#482 now. Model: `claude-opus-5-5` (Anthropic).
           Reviewing 6 files (2 generated/lockfile skipped) at ~9,840 tokens of diff.
  └ Locus  📝 Left 3 comments on acme/api#482. Token refresh can race with logout.
           1. major `src/auth/refresh.ts:42` Refresh runs after logout clears the session…
           2. minor `src/http/retry.ts:18` Retries 401s with no backoff.
           3. nit `src/http/retry.ts:31` Name the retry limit.
           claude-opus-5-5 · 10.2k in (3.1k cached) / 640 out · ~$0.05 · 21s
bob     won't fix #3
  └ Locus  👌 Dismissed #3 (`src/http/retry.ts:31`) on acme/api#482. Later reviews won't raise it again.
```

The review also lands on the PR as a forge review with inline comments, numbered the same way (`#1 · major`). Small fixes come as one-click suggestions.

Source: `packages/shared/src/models/slackReviewer.ts` (pure: config, link detection, diff compaction, prompt, result parsing), `apps/server/src/slack/slackReviewer.ts` (`SlackReviewerService`: polling, queue, the review itself, Slack posts), beside it in `apps/server/src/slack/`: `reviewerState.ts` (state file shapes and limits), `reviewModel.ts` (model call, tool loop, cost cap, verification), `reviewerThreads.ts` (thread watching, dismissals, votes), `reviewerAutoReview.ts` (`autoReview` and "@locus review" PR comments), `reviewerMentions.ts` (tagged in a thread it isn't watching), `reviewerAnswer.ts` (thread questions), `reviewerHelpers.ts` (provider picks, message filters, forge reads), `reviewerDeps.ts` (service deps and context), and `reviewCheckout.ts` (the clone and its read-only tools).

## Checking beyond the diff

By default (`cloneRepo: true`) a reviewer doesn't judge the change from the diff alone. After the skip checks it makes a shallow clone of the PR's head commit, and the model checks the change against the rest of the code before it answers. It opens the full files the diff touches, finds the callers of every changed or removed function, type, export, route or config key, reads the helpers and types the change relies on, and looks for tests of the changed behaviour.

- **API models** get four read-only tools over the clone: `read_file` (paged, with line numbers), `list_dir`, `find_files` (glob) and `grep` (`git grep -E`). The model can take up to `maxToolRounds` rounds of lookups (default 12, Settings → **Lookup rounds**). After that it is told to answer, and gets one grace round to do so. Each tool result is capped at 16,000 characters.
- **CLI agents** run inside the clone instead of an empty scratch folder, still in plan / read-only mode, and explore it with their own tools.
- **Findings outside the diff** are allowed. They go in the review body with their real `path:line`, because a forge only anchors inline comments on lines the diff shows.
- **Nothing from the PR runs.** No install, build, tests or hooks. Symlinks are checked out as plain files, hooks point at nothing, LFS and submodules are skipped, and every tool path is checked to stay inside the clone and out of `.git`.
- **The token never touches argv or disk.** It goes to git as an `http.extraHeader` through `GIT_CONFIG_*` environment variables. The operator's global and system git config are ignored.
- **If the clone fails** (no Contents permission, an unusual forge URL, a timeout after 3 minutes), the review falls back to the diff and the usage line says `diff only, clone failed: …`. A failed clone never fails the review.
- **Cost.** Every lookup round sends the conversation so far again, so a checkout review costs several times a diff-only one. The usage line counts lookups (`· 14 lookups in the repo`), the started line ends `, with the repo checked out to check callers and tests` (the `{checkout}` placeholder), and the forge review footer says so too. A review with the checkout gets 10 minutes.

Turn it off with `cloneRepo: false` (Settings → Reviewers → **Clone the repo and check around the diff**). The reviewer then makes the single tool-less completion described under [Token budget](#token-budget).

### Clean-up

Clones go in `<dataDir>/slack-reviewers/checkouts/review-*`, not the OS temp folder, so nothing else is ever deleted. Each review deletes its clone when it finishes, whether it succeeded, failed or ran out of rounds. A clone left behind by a crash, a kill or a power cut is removed in one of two ways:

- When the server starts, every `review-*` folder is deleted, because no review can be running yet.
- Before each new clone, any `review-*` folder older than 30 minutes is deleted. The longest review (3-minute clone plus 10-minute model budget) ends well inside that.

So the folder holds at most `maxConcurrentReviews` clones per reviewer (one by default). The 30-minute sweep can't catch a running review's clone, however many run at once, because none runs that long.

## How it differs from Ask Locus and subscriptions

[slack.md](slack.md) keeps agents quiet in Slack: no status lines, every `slack_post` behind Approve / Deny. A reviewer is an explicit, operator-configured exception. It posts progress lines without approval, in the thread of the post that asked for review, with the identity you choose (`postAs`, bot by default). It never posts anywhere else and never touches a guest. With an API provider it runs no tools at all. A CLI agent you pick keeps its own tools (see [CLI agents](#cli-agents)).

A `slack_channel` subscription wakes a full agent turn on every new message. That works for conversations, but it costs a lot when you only want to react to PR links. A reviewer detects links with a regex and runs no model until it finds one.

## Token budget

With `cloneRepo` off, one review is one completion: a single API call with no tools, or one run of a CLI agent. With it on (the default), an API model takes a few lookup rounds over a clone first. In order of savings:

1. **No model for triage.** PR links are found with a regex, and only top-level human posts count. Thread replies, bot posts and Locus's own posts are ignored, except a re-review request in a review thread (see [Re-review after feedback](#re-review-after-feedback)).
2. **No backlog.** On first start, or after a channel change, the reviewer primes its cursor to the newest message. It never reviews old posts.
3. **Once per head SHA.** Posting the same PR again replies "already reviewed at `abc1234`" without a model call. After new commits it reviews again (turn this off with `rereviewOnNewCommits: false`).
4. **Skip before spending.** Closed PRs, drafts (`skipDrafts`), PRs the author opted out (`skipLabels`, `[skip review]`), repos outside `repos`, PRs into branches outside `baseBranches`, posts from people outside `allowedRequesters`, and PRs that only touch ignored files never reach the model. See [Opting out and scoping](#opting-out-and-scoping).
5. **Diff compaction.** These files are dropped:
   - lockfiles, build output, vendored code, snapshots, source maps, minified files, media and fonts (`DEFAULT_REVIEW_IGNORE_GLOBS`)
   - your extra `ignorePaths`

   Deleted files show as one line. Unchanged lines are trimmed to `contextLines` around each change. Each file is capped at `maxFileChars`, and the whole diff at `maxDiffChars`. Files over budget are listed by name with `+/-` counts, and the model is told the review is partial.
6. **No container or agent catalog.** The diff comes from the forge API (`ForgeClient.getPull`). With `cloneRepo` on (the default) the model also gets four read-only tools over a shallow clone, for at most `maxToolRounds` rounds. This is the biggest cost after the diff itself; see [Checking beyond the diff](#checking-beyond-the-diff). With it off there are no tools at all.
7. **Cache-friendly prompt.** The system prompt is the fixed output contract followed by your `prompt`, so it is byte-stable for a given reviewer. Providers that cache prefixes reuse it. The usage line shows cached tokens.
8. **Small output.** The model returns JSON (verdict, two-sentence summary, at most `maxComments` findings), capped at `maxOutputTokens`.
9. **One review at a time per reviewer, unless you ask for more.** A burst of links in a channel queues up instead of fanning out, and each queued link gets a "Queued … behind 2 reviews" reply so it doesn't look stuck. `maxConcurrentReviews` (1–4, default 1, Settings → **Reviews at once**) lets a reviewer run that many reviews in parallel. Two reviews of the same PR never run at once, and a link waiting for its PR doesn't hold up others. Answers to thread questions share the same slots. Different reviewers have their own queues, so a busy channel doesn't hold up another one. Spend is recorded in the daily budget ledger (`slack-reviewer:<id>`) as each review finishes, so the global caps in Settings → Budgets apply; reviews running in parallel each add their own spend.
10. **Only the new commits on a follow-up.** See [Re-review after feedback](#re-review-after-feedback).
11. **A cost cap per review.** With `maxCostUsd` set, a review whose estimated spend reaches it stops reading the checkout and answers with what it has. The usage line says `stopped reading at the $0.50 cost cap`. It needs a known price for the model (Settings → Providers), and it can't stop a single API call that is already running, so one review can go a little over. A CLI agent runs as one long call, so instead the run is stopped when the usage it reports while running reaches the cap, and the review fails with "reached the $0.50 cost cap before it answered". That only works for CLIs that report usage as they go; others are bounded by their time limit alone.

12. **Large PRs in parts, if you want them** (`splitLargePrs`, off by default). A PR whose diff doesn't fit the budget is normally reviewed in part, with the rest listed by name. With this on it is reviewed in up to 4 parts, each a full model call (with its own lookup rounds) over the files the previous part left out, told which files the other parts cover. The findings are merged and ranked together, the strictest verdict wins, and an earlier finding counts as resolved only if no part says it's still open. It can cost up to 4× a normal review, and the cost cap covers all parts together.

Turning on **No token limits** (`unlimitedTokens`) removes the diff caps in step 5 and the output cap in step 8, for teams that would rather pay for complete reviews of big PRs.

The started message shows an estimated token count before the call. The final message shows real usage, cache hits, estimated cost and elapsed time, then the provider's current usage:

- **Agent CLIs that report plan usage** (Claude Code, Codex, Cursor CLI, Kiro): the same windows as the usage meters in Settings → Providers, busiest three, with when the busiest resets. `… · 38s · Kiro: Monthly credits 212/1,000 credits (21%) (resets in 9d)` or `… · Claude Code: 5-hour 23%, Weekly 61% (resets in 3h)`.
- **API providers** have no plan quota to read, and Locus doesn't split spend by provider, so they show Locus's spend today against the daily cap in Settings → Budgets: `· Locus today: $4.10 / $20.00` (no cap: `· Locus today: $4.10`).

It is read once the model call finishes, cached for a minute, and dropped if it takes more than 4 seconds or fails, so it never slows or fails a review. A failure reply (rate limit, quota, bad key) shows it on a line under the reason, since that is when it matters most. Custom templates get it inside `{usage}`, or alone as `{providerUsage}`.

## Reviews without a Slack post

With `autoReview` on (off by default, Settings → Reviewers → **Review new PRs nobody posted**), a reviewer doesn't wait for someone to post a link. Every 5 minutes it lists the open PRs of the repos in `repos` (`ForgeClient.listPulls`, one call per repo) and reviews each PR that was opened, or marked ready for review, since it started watching:

```
Locus   🔎 New PR acme/api#12 by alice: Add token refresh
  └ Locus  👀 Looking at acme/api#12 now. …
  └ Locus  📝 Left 2 comments on acme/api#12. …
```

- **It needs `repos`.** Only explicit entries are polled. An exact `owner/repo` is polled as written. A `*` in the repo name (`acme/api-*`) is matched against the repos the Git account can list (listed at most once an hour); on a forge that can't list them, only exact entries are polled. A `*` in the owner (`*/api`) is never polled. At most 20 repos per reviewer. With an empty `repos`, nothing is polled.
- **The account.** Repos are listed with the first signed-in Git account (Settings → Integrations), the same one a PR link resolves to when only one forge is set up.
- **No backlog.** The first poll of a repo only remembers which PRs are open, like the Slack cursor. Turning it on, adding a repo or changing the channel never reviews what was already there.
- **New or ready.** A PR qualifies when it first shows up open, or when it was a draft and is now ready. With `skipDrafts` off, a new draft qualifies too.
- **A normal review.** The reviewer posts the PR to its channel as its `postAs` identity, then reviews it in that post's thread, so re-review, dismissals, questions, votes and reactions work the same as for a posted link. The channel scan knows its own posts and never takes them for a request.
- **Once per head SHA.** A PR someone also posted by hand isn't reviewed twice: if it is already queued, or was already reviewed at that head, the poll leaves it alone. A manual post after an auto review gets the usual "already reviewed" reply.

## Review on request from the PR

With `reviewOnPrComment` on (off by default, Settings → Reviewers → **Review when asked on the PR**), a PR comment that starts with `@locus review`, `locus review`, `@locus re-review` or `@locus rereview` (any case) asks for a review. Only these forms count, so other bots' `/review` commands don't trigger it.

- **A PR with a watched thread** gets "💬 bob asked for a review on the PR." in that thread and a follow-up review, as if someone had replied **re-review** there: earlier findings, only the new commits, and "no new commits since `abc1234`" with no model call if nothing was pushed. Its comments are read when the thread's PR state is checked (every 10 minutes), and on every auto-review poll.
- **A PR without one** is only noticed while `autoReview` polls its repo: a PR whose `updatedAt` moved since the last poll has its comments read (at most 10 PRs per poll). The reviewer posts "🔎 bob asked for a review of acme/api#12 on the PR" to its channel and reviews in that thread. Without `autoReview`, only PRs with a watched thread are checked.
- Only comments posted after the last check count (and, the first time, after the last review or since the poller first saw the PR). Comments by the reviewer's own Git account and by bots (`…[bot]`, `…-bot`) never count.
- The comment isn't acknowledged on the PR; the reply shows up in Slack.

## Review when tagged in a thread

With `reviewOnMention` on (the default, Settings → Reviewers → **Review when tagged in a thread**), tagging the identity the reviewer posts as in a thread of its channel that it isn't watching reviews a PR there. It is for links that were never posted top-level: a PR shared as a thread reply, a thread from before the reviewer existed, or one whose watch ran out.

```
alice   release checklist for 2.4
  └ bob    the API side is https://github.com/acme/api/pull/482
  └ carol  @Locus review this please
  └ Locus  👀 Looking at acme/api#482 now. …
```

- **What counts.** A reply that @-mentions the reviewer and either asks for a review (the same phrases as [Re-review after feedback](#re-review-after-feedback): "@Locus review this", "@Locus can you take a look") or carries a PR link ("@Locus https://github.com/acme/api/pull/482"). A mention that only asks a question is ignored here.
- **Which PR.** The links in the tagging reply; if it has none, the links in the thread's first post; if that has none, the newest earlier reply with a link. With no link anywhere the reviewer replies ":mag: I couldn't find a pull request link in this thread" and stops. Several links in the chosen message are each reviewed, up to the per-message limit.
- **Afterwards** the thread is watched like any review thread: re-review, retry, dismissals, questions and votes work, and the tagging reply itself isn't read again as a re-review. A watched thread's mentions are handled there as before.
- Repo, base-branch, draft, opt-out and `allowedRequesters` filters apply as for a posted link. Only the reviewer's own channel counts.
- **Needs Socket Mode message events** (`message.channels` / `message.groups`, or `app_mention`). Slack's channel history doesn't list thread replies, so without events a tagged reply in an unwatched thread isn't seen. Each event's text is checked for the mention first, so only tagged replies cost a `conversations.replies` call.

## Review context

Besides the diff (and the clone), each review gets context that is cheap to fetch and saves the model guessing. Each piece can be turned off under Settings → Reviewers → **Review context**.

- **Repo guidelines** (`repoGuidelines`). Up to three of `AGENTS.md`, `CLAUDE.md`, `REVIEW.md`, `.github/copilot-instructions.md`, `CONTRIBUTING.md` and `.github/CONTRIBUTING.md`, read from the **base** branch through the forge API (6,000 characters each, 12,000 in total). A PR that edits these files can't change the rules it is held to. When the forge can't read files (Azure DevOps), they come from the clone instead, skipping any file the PR changes. They are fenced as data: they can shape the findings, not the output format or the verdict.
- **CI status** (`ciContext`). One line: how many checks ran at the head commit, which are failing and which are still running. The model is told not to repeat a failure CI already shows, but to point at the change that likely causes it. In verdict mode, `holdApprovalOnFailingCi` (on by default) stops a clean review from approving while a check is failing: it posts a COMMENT review instead and the reply starts "Not approving while CI is failing (unit)."
- **Failing CI logs** (`ciLogs`, with `ciContext`). When a check is failing, the condensed log of up to two failing jobs (about 5,000 characters in all, error lines with context, failing test names) goes with the review, fenced as untrusted data. The model is asked to point at the change that most likely breaks it. Needs a forge that serves job logs (GitHub Actions, GitLab CI); others send the one-line status only.
- **Comments already on the PR** (`prDiscussion`). The newest 20 comments from people and other bots (about 6,000 characters at most), with their file and line, fenced as untrusted data. This reviewer's own comments are left out. The model is told not to repeat a point one of them already makes.
- **Linked issues** (`linkedIssues`). "Fixes #12", "closes acme/api#12", "resolves https://github.com/acme/api/issues/12" and similar in the PR description: up to two issues in the same repo, title and description (1,500 characters), so the model can check the change does what the issue asked.
- **Suggested fixes** (`suggestions`). An inline finding may carry a replacement for its line. GitHub shows it as a ```` ```suggestion ```` block the author can apply in one click, GitLab as ```` ```suggestion:-0+0 ````, other forges as a plain code block. Findings outside the diff never carry one.

## Double-checking serious findings

One review pass makes false positives, and in verdict mode a false `major` becomes REQUEST_CHANGES. So before posting, a reviewer double-checks its blocker and major findings (`verifyFindings`, on by default; Settings → Reviewers → Behaviour → **Double-check blocker and major findings before posting**):

1. After the findings are parsed and filtered (`minSeverity`, `maxComments`, dismissals), the blocker and major ones (at most 10) go to one more completion: no tools, a small output cap (300 tokens plus 150 per finding, at most 2,000).
2. Each finding comes with its claim, its `path:line`, and the code around it: ±40 lines of the file at the PR head, read from the clone before it is deleted, or the diff hunk when there is no clone (or the file is over 512 KB). Claims and code are fenced as untrusted data, and the model is told to only judge them.
3. The model answers per finding `confirmed`, `downgrade` (with a lower severity) or `reject`, with a short quote of the line(s) that prove it. When the code shown can't settle it, it is told to confirm: rejecting needs evidence.
4. Rejected findings are dropped and downgrades applied (one that falls below `minSeverity` is dropped too). Then the findings are renumbered and the verdict is derived again from what is left, as it always is, so a review whose only major was rejected approves (verdict mode) or comments instead of requesting changes.

The usage line says what happened: `· verified 3, dropped 1` (or `downgraded 1`). If the check fails or its reply can't be read, the findings are posted as they were and the usage line says `couldn't verify findings, posted unchecked`. Verification never fails a review. Its tokens and cost are added to the review's usage and cost and to the budget ledger, and the trace shows the check's prompt, reply and decisions. When the review has already reached its `maxCostUsd` cap, the check is skipped (`not verified: at the cost cap`).

**A second opinion.** By default the check runs on the review's own provider and model. Set `verifyProviderId` / `verifyModel` (Settings → **Use a different model for the check**) to have another model judge the findings; the usage line then names it (`verified 2 (o4)`). With a CLI agent as the reviewer, the check runs the same CLI once more, read-only in an empty scratch folder (the code it needs is in the prompt), unless `verifyProviderId` names an API provider, which is cheaper and faster.

**Why on by default.** It costs one small call, and only on reviews that have a blocker or major finding, while a false one costs a REQUEST_CHANGES in verdict mode and a misleading "major" in comment mode. Turn it off with `verifyFindings: false`. Reviews with no blocker or major finding never make the extra call.
## Opting out and scoping

Settings → Reviewers → Behaviour. All of these are checked before the model, so a skipped PR costs nothing.

- **Opt-out labels** (`skipLabels`, default `no-review` and `skip-review`). A PR carrying one of these labels (any case) gets the `skipped` reply ("Skipped acme/api#7: it has the `no-review` label") and no review. `[skip review]`, `[no review]`, `[skip-review]` or `[no-review]` anywhere in the PR title does the same, even with the list empty. Nothing is recorded for the commit, so once the label or marker is gone, posting the link again (or "re-review" in the thread) reviews it. Labels come from the forge's PR API: GitHub, Gitea, Forgejo, GitLab and Azure DevOps (active labels). Bitbucket Cloud PRs have no labels, so only the title marker works there. Settings → Try it (dry run) ignores opt-outs, like drafts.
- **Base branches** (`baseBranches`, globs, empty = any). A PR into any other branch is ignored silently, like a repo outside `repos`: no reply in Slack, only a skipped row in Recent reviews. `*` stays within one `/` segment (`release/*` matches `release/1.2`, not `release/1.2/hotfix`); `**` crosses segments. Matching ignores case.
- **Who can ask** (`allowedRequesters`, Slack member IDs like `U0123ABCD`, empty = anyone in the channel). A top-level post from anyone else is ignored silently, and so are their **re-review**, **retry** and @-mention questions in a review thread, since each of those spends tokens. Dismissals ("won't fix #2") stay open to anyone in the thread: they cost nothing, and PR-side dismissals can't be tied to a Slack member anyway. A re-review started by an `addressed` reaction (see [Reaction legend](#reaction-legend)) isn't filtered, and `POST /api/slack/reviewers/:id/review` is an operator action, so it isn't either. This is a cost control, not an access boundary: anyone in the channel still sees the replies.

## Instructions per path

`pathPrompts` (Settings → Reviewers → Behaviour → **Instructions per path**) holds up to 20 `{ glob, prompt }` rows, each prompt up to 2,000 characters. When a PR changes a file that matches a glob, that row's text goes with the review as:

```
Extra instructions for files matching `migrations/**`: Check every migration can run on a live table without a long lock.
```

- Globs use the same matcher as `ignorePaths` (`**` crosses folders, a pattern without `/` matches the file name). Files the ignore list drops don't count, so a lockfile-only change never pulls in a row.
- The text goes in the user message, after the other context and before the diff, never in the system prompt, so the cached system prefix stays byte-stable whatever the PR touches.
- It is your text, so it is not fenced as untrusted data.
- `/name` skills in a row are expanded after the rows, the same way as in the review prompt, except skills the review prompt already sends in the system prompt.
- On a follow-up that sends only the new commits, rows still match against the whole PR's files.
- Settings shows roughly how many tokens the rows add when every row matches. The Slack preview's token count is a sample and doesn't change with them.

## Re-review after feedback

Once the author has pushed fixes, they reply in the reviewer's thread with **re-review**, **rereview**, **review again**, **take another look** or **PTAL**, or @-mention the identity the reviewer posts as with a request: "@Locus can you review again", "@Locus review this please", "@Locus could you take another look". The phrase is matched with a regex, not a model; an @-mention that only asks a question ("@Locus why is #1 a major?") stays a question. The reviewer then:

- reviews the PR again and replies in that same thread, so the whole conversation stays in one place
- puts its earlier findings in the prompt and asks the model to mark each one `resolved` or `open`. The final message (and the review on the PR) starts with "Resolved 2 of 3 earlier findings." or "All 3 earlier findings are resolved." Findings the model does not mention count as open. Resolved findings are not raised again.
- replies "no new commits since `abc1234`. Push the fixes, then ask again, or say "retry" to review this commit again" without a model call if nothing has been pushed. Asking once more after that reply reviews the commit anyway.

**Only the new commits** (`incrementalRereview`, on by default). On a follow-up, the reviewer asks the forge what changed between the last commit it reviewed and the new head, and sends only that diff with the earlier findings, instead of the whole PR again. Inline comments can still go on any line the PR's diff shows. After a force-push or rebase (the old commit is no longer an ancestor), and on forges that can't compare commits (Gitea, Forgejo, Azure DevOps), it sends the whole PR as before. GitHub, GitLab and Bitbucket can. If only generated or lockfile files changed since the last review, it skips with a reply saying so.

**Fixed findings are resolved on the PR** (`resolveFixedThreads`, on by default). When a follow-up marks an earlier finding `resolved`, the reviewer resolves that finding's inline comment thread on the PR, so what's still open is easy to see. Only its own threads are touched. GitHub and GitLab; Bitbucket has no resolvable threads.

**Asking again after a skip.** A skip reply in a thread ("Skipped acme/api#7: it is a draft", "it has the `no-review` label", "already reviewed at `abc1234`") keeps that thread watched. Asking again there ("@Locus can you review again", "re-review", "retry") reviews anyway: it overrides the draft check, the opt-out label or title marker, and the already-reviewed commit. Some skips still apply, each with its reply: a closed or merged PR (whose thread isn't watched), a PR with nothing reviewable (only lockfiles or generated files), and, silently, a repo outside `repos`, a base branch outside `baseBranches` and anyone not in `allowedRequesters`. When a link that was already reviewed is posted again, its skip gets a thread of its own, so the original review thread (findings, dismissals, votes) stays watched until a review runs under the new post. A skipped draft or opt-out never counts as reviewed, so once the PR is ready (or the label is gone), posting the link again reviews the same commit.

An explicit request works even with `rereviewOnNewCommits` off. In verdict mode a clean follow-up approves the PR, which replaces the earlier "changes requested".

**Retry** (with `rereviewOnThreadReply`). A review whose model call fails on an error that usually passes (rate limit, overload, a 5xx, a timeout, a dropped connection) is retried once, 30 seconds later, and the thread says so. Errors that won't pass (bad key, unknown model, a prompt too large) aren't retried. After that, reply **retry**, **try again** or **run it again** in the thread: it reviews again even when the commit was already reviewed.

Threads are checked about once a minute, one `conversations.replies` call per watched thread. A reviewer watches its 25 most recent threads (`maxWatchedThreads`, 5–200, Settings → **Threads to watch**). Threads are watched when any of re-review requests, dismissals or questions is on. It stops watching a thread once the PR is merged or closed (checked every 10 minutes, and on any re-review request), or 7 days after its last review. Post the link again to start a new one. Only human replies posted after the last check count. Bot posts and the reviewer's own status lines never trigger a review. When Slack answers `ratelimited`, the reviewer stops reading Slack for a minute, doubling up to 10 minutes while it repeats.

**Socket Mode events (optional).** If the Slack app subscribes to the `message.channels` (and `message.groups` for private channels) bot events and the bot is in the channel, Locus hears about new posts and replies as they happen. The reviewer then reads that channel or thread straight away, and polling drops to a fallback sweep: channels every 5 minutes, threads every 10. Without those events nothing changes. See [slack.md](slack.md).

Turn this off with `rereviewOnThreadReply: false` (Settings → Reviewers → **Re-review when asked in the thread**).

## Polling intervals

Settings → Reviewers → **Polling** (below the reviewer cards, config `slackReviewerPolling`) sets how often every reviewer reads Slack and the forge. It applies while Socket Mode isn't delivering message events; with events arriving, reads follow the events and the 5- and 10-minute fallback sweeps above stay as they are. `autoReview` always polls, so it follows these settings either way.

| Field | Default | Range | What |
| --- | --- | --- | --- |
| `mode` | `fixed` | `fixed`, `adaptive`, `smart` | See below. |
| `channelSec` | 20 | 5–600 | Channel history read, one call per reviewer. |
| `threadSec` | 60 | 15–1,800 | Watched-thread read, one call per thread. |
| `autoReviewSec` | 300 | 60–3,600 | `autoReview` open-PR listing, one call per repo (shown in minutes). |
| `maxBackoff` | 8 | 1–30 | Adaptive and smart: slowest interval, as a multiple of the base. |
| `activeHours` | 08:00–19:00, weekdays | hours 0–24 | Smart: when people are around, in this computer's local time. An end before the start wraps past midnight. |

- **Fixed**: every read runs at its interval.
- **Adaptive**: each reviewer keeps its own cadence per read. A poll that finds nothing new waits 1.5× longer next time, up to `maxBackoff` × the interval; one that finds something (a new post, a thread reply or reaction change, a new, ready or updated PR) goes back to the interval.
- **Smart**: adaptive, plus a reviewer with a review or answer queued, running, or finished in the last 10 minutes stays at the base interval so replies to its results are picked up quickly, and outside `activeHours` a quiet poll goes straight to the slowest interval. Any activity brings it back, and the base returns when active hours start.

Lowering a setting applies at once rather than after the current wait. The section lists what each enabled reviewer is polling at right now and why (Socket Mode, review in progress, outside active hours); `GET /api/slack/reviewers/runs` returns it as `polling`. The policy is `packages/shared/src/models/slackReviewerPolling.ts`.

Posting the link again as a new top-level message after new commits still works, and it also gets the earlier findings. Replies then go to the new post's thread, and that thread becomes the one being watched.

The earlier findings go in the user message, not the system prompt, so the cached prefix is unchanged. They are fenced as untrusted data because they quote PR code. At most 20 findings are kept per PR.

## In the thread

The final reply lists the findings by number, and the review on the PR uses the same numbers. People can answer in the thread:

- **Dismiss a finding** (`dismissInThread`, on by default). "won't fix #2", "#1 and #3 are false positives", "#2 is by design", "dismiss all". Matched with a regex, no model call. The reviewer replies with the `dismissed` template, and later reviews of that PR never raise those findings again: they are left out of the follow-up's earlier findings, the model is told about them, and a new finding on the same line with the same severity, or with the same opening words, is dropped. At most 50 per PR. A number the last review didn't have gets a short reply saying how many findings there were.
- **Dismiss on the PR** (`dismissOnPr`, on by default). "won't fix #2" in a PR comment, or a reply with a dismiss word ("won't fix", "false positive", "by design") to one of the reviewer's inline comments, dismisses that finding the same way, and the Slack thread gets the `dismissed` reply with "(from the PR)". PR comments are read when a review starts and every 10 minutes while the thread is watched. Only comments posted after the last check count, and the reviewer's own never do.
- **Dismissals follow the code.** A dismissed finding remembers the code on its line. A later finding in the same file is dropped when it sits on the same code (even after edits above moved the line), on the same line with the same severity, starts with the same words, or says much the same thing within a few lines.
- **Learn from dismissals** (`learnFromDismissals`, on by default). Each dismissal is also kept for the whole repo with its reason (false positive, by design or won't fix; at most 40 per repo). The 15 most recent, those on files the PR touches first, go with every later review of a PR in that repo, fenced, as the team's conventions. Settings → Reviewers → **Remembered dismissals** lists them per repo with **Forget** and **Forget all**, and **Propose as REVIEW.md** (see [Promote dismissals into REVIEW.md](#promote-dismissals-into-reviewmd)).
- **Ask a question** (`answerQuestions`, off by default). @-mention the identity the reviewer posts as (the Locus bot, or you with `postAs: "user"`) in the thread: "@Locus why is #1 a major?". It answers in the thread with one small completion (600 output tokens, no tools) over its last findings and the PR diff (at most 24,000 characters). The question is fenced as untrusted Slack text, and the model is told it can only explain: changing the verdict is done with "re-review" or "won't fix #n". At most 10 answers per thread. Answers count toward the daily budget and show in Recent reviews as **Answered a question**.
- **Votes.** 👍 and 👎 on the final reply are counted each time the thread is checked. Recent reviews shows them per run, and each reviewer's card shows its totals, so you can tell whether a prompt or severity floor change helped. Votes are kept for the last 500 final replies per reviewer.

### Promote dismissals into REVIEW.md

Remembered dismissals live only in Locus. **Propose as REVIEW.md** on a repo in Settings → Reviewers → Remembered dismissals (`POST /api/slack/reviewers/:id/notes/propose`) writes them into the repo, where people and other tools see them too. With the forge account it:

1. reads `REVIEW.md` on the default branch, if there is one
2. appends a `## Conventions learned from review dismissals` section with one bullet per note, built from the note's path, reason and the first sentence of the finding, with no model call: ``- `src/http/retry.ts`: don't raise "Name the retry limit" again. The team accepted it (acme/api#482).`` If the file already has that section, new bullets are added to it, sorted and once each, so proposing again with the same notes changes nothing (and is refused as "already has these conventions").
3. creates the branch `locus/review-conventions-<date>` (`-2`, `-3`… when taken), commits the file, and opens a PR titled "Add review conventions learned from dismissals"

Settings links the PR. The notes are not forgotten automatically. The reviewer reads `REVIEW.md` from the base branch as [repo guidelines](#review-context), so once the PR merges use **Forget all** for that repo, or the same notes go with each review twice. `REVIEW.md` comes third, after `AGENTS.md` and `CLAUDE.md`, so it is sent unless those two already use the 12,000-character guidelines budget. GitHub and GitLab only: on Bitbucket, Azure DevOps, Gitea and Forgejo the button is disabled and the endpoint answers "not supported on this forge". The forge token needs write access to the repo's contents and pull requests.

The final reply starts with an @-mention of the PR author (`mentionAuthor`, on by default) when `authorSlackIds` maps their Git login to a Slack member ID. Settings → Reviewers → **PR authors in Slack** takes one `login = U0123ABCD` per line.

## Accuracy

Each reviewer keeps a compact ledger in the state file: one bucket per UTC day for the last 90 days, holding counts only. Reviews, failures and answers; findings posted by severity; dismissals by reason (false positive, by design, won't fix) and severity; earlier findings a follow-up found resolved; findings the double-check rejected or downgraded; 👍 / 👎 changes on final replies; tokens and estimated cost. Dry runs aren't counted. Dismissals, resolutions and votes count on the day they happen.

Settings → Reviewers shows an **Accuracy** section on each reviewer card for the last 30 days:

- findings posted, and how many were double-checked and dropped or downgraded
- **precision per severity**: 1 − false-positive dismissals ÷ findings posted. It's an upper bound: a wrong finding nobody dismissed still counts as right. "By design" and "won't fix" don't count against it.
- dismissals by reason
- **resolve rate**: earlier findings a follow-up found fixed ÷ findings posted
- **spend per week**: estimated cost over the days the reviewer has data in the window. Less than a week of data shows the actual spend so far rather than stretching it to a week. Runs on a model with no known price add tokens but no cost.

The derivation is `summarizeSlackReviewStats` in `packages/shared/src/models/slackReviewStats.ts`. `GET /api/slack/reviewers/:id/stats?days=30` returns it for 1–90 days, and `GET /api/slack/reviewers/runs` includes the 30-day summary per reviewer as `stats`.

## Live logs

Settings → Reviewers → **Live logs** (under Recent reviews) lists every Slack and forge API call the reviewers make, newest first, while it is open: the channel poll (`conversations.history`), the thread poll (`conversations.replies`), the `autoReview` poll (open PRs per repo), and the calls a running review or answer makes (PR and diff, CI, files, posts, reactions, the PR review). Each row shows the time, OK or error, which loop made it, the client method and the API it stands for, a one-line result ("12 items", the PR's state and title, or the error), the reviewer and how long it took. Open a row for the request arguments and the response as JSON. Filter by loop or errors only, pause, or clear the view.

The server keeps the last 300 calls in memory only; nothing is saved and a restart starts empty. Keys that look like credentials (`token`, `secret`, `password`, `authorization`, …) are shown as `[redacted]`, strings over 500 characters are trimmed, and each request or response is cut at 4,000 characters. The recorder is `ReviewerApiLog` in `apps/server/src/slack/reviewerApiLog.ts`.

## Configure

**Settings → Reviewers** (Workspace group) is the usual way. Sections: Model, Review prompt, Behaviour, **Review context**, **In the thread**, Token budget (including the cost cap), Slack preview, Status messages, **Accuracy** and Try it. **Add reviewer** creates a draft. Pick a channel and it starts watching. Each card has the channel picker, model (Slack default, or pin one), review prompt, how to post and what to do on the PR, repo filter, toggles, a **Token budget** section, a **Slack preview**: a mock thread showing the request, the "started" reply and the final reply exactly as this reviewer will post them (identity, templates, reactions, Slack formatting), with a chip per outcome it can produce; **Status messages** with a rendered preview under each and per-message Reset, and **Try it**: paste a PR URL and **Review now** runs the reviewer once on its saved settings. With **Dry run** on (the default) nothing is posted or recorded, even an already-reviewed commit is reviewed, and the findings (with any suggested fixes) are listed under the button. With it off, the review is posted to the PR, not to Slack. At the bottom, **In progress** lists reviews and answers queued or running now (refreshing every few seconds while any are), **Open review chats** lists the threads the reviewer still watches for re-review, dismissals and questions (a week after the last review, or until the PR merges or closes), and **Recent reviews** lists the last 50 runs with outcome, tokens and cost. Every row with a Slack thread has **Open chat**, which opens that thread in the Slack pane. Every run that reached the model has **Trace**: the prompt, the model's reasoning (when the provider streams it; Anthropic API models don't), each tool call with its arguments and output, refused calls, retries, and the reply. A running review's trace refreshes every 2 seconds. Traces are stored one JSON file per run in `<dataDir>/slack-reviewers/traces` (newest 200 kept; 400 steps, 40,000 characters per text step and 6,000 per tool output at most) and served by `GET /api/slack/reviewers/traces/:id`. Changes autosave like the rest of Settings.

You can also add `slackReviewers` to `~/.locus/config.json` or send it with `PUT /api/config`. Slack must be signed in (Settings → Integrations). The channel must be in the Slack allowlist when one is set. A forge account must be able to read the repo.

```json
{
  "slackReviewers": [
    {
      "id": "api-reviews",
      "name": "API reviews",
      "channelId": "C0123456789",
      "prompt": "This is a Go HTTP service. Focus on auth checks, SQL built from strings, missing context timeouts, and goroutine leaks. Ignore formatting.",
      "providerId": "anthropic",
      "model": "claude-opus-5-5",
      "postAs": "bot",
      "forgeMode": "comment",
      "minSeverity": "minor",
      "repos": ["acme/api", "acme/api-*"],
      "ignorePaths": ["**/testdata/**", "docs/**"],
      "skipLabels": ["no-review", "skip-review"],
      "baseBranches": [],
      "allowedRequesters": [],
      "pathPrompts": [
        {
          "glob": "migrations/**",
          "prompt": "Check every migration can run on a live table without a long lock, and has a down step."
        }
      ],
      "maxDiffChars": 48000,
      "maxFileChars": 8000,
      "contextLines": 2,
      "maxComments": 8,
      "maxOutputTokens": 2048,
      "unlimitedTokens": false,
      "skipDrafts": true,
      "rereviewOnNewCommits": true,
      "rereviewOnThreadReply": true,
      "reactions": false,
      "cloneRepo": true,
      "maxToolRounds": 12,
      "repoGuidelines": true,
      "incrementalRereview": true,
      "ciContext": true,
      "holdApprovalOnFailingCi": true,
      "linkedIssues": true,
      "suggestions": true,
      "dismissInThread": true,
      "answerQuestions": false,
      "mentionAuthor": true,
      "authorSlackIds": { "alice": "U0123ABCD" },
      "maxCostUsd": 0,
      "maxWatchedThreads": 25,
      "prDiscussion": true,
      "ciLogs": true,
      "resolveFixedThreads": true,
      "dismissOnPr": true,
      "learnFromDismissals": true,
      "splitLargePrs": false,
      "autoReview": false,
      "reviewOnPrComment": false,
      "reviewOnMention": true,
      "maxConcurrentReviews": 1,
      "verifyFindings": true,
      "verifyProviderId": "",
      "verifyModel": "",
      "status": {
        "started": ":eyes: On it: {pr} by {author}. `{model}`, {files}, ~{tokens} tokens."
      }
    }
  ]
}
```

A reviewer with an empty `channelId` is kept as a draft and never polled. Everything else has the defaults shown, apart from `providerId` / `model`, `prompt` and `pathPrompts` (empty by default).

| Field | Meaning |
| --- | --- |
| `prompt` | Your review instructions, appended to the fixed contract. Use it for house rules, stack-specific risks, and what to ignore. Name a skill as `/name` to send it with every review (see [Skills](#skills)). |
| `providerId`, `model` | Empty means the Slack account's default provider/model, then the first enabled API provider with a key. A CLI agent runs only when it is the reviewer's provider or the Slack default, never as that last fallback. A CLI agent with no model runs on its own default. Cursor Cloud can't run reviews. |
| `postAs` | `bot` (Locus app, needs bot `chat:write`) or `user` (posts as you). |
| `forgeMode` | `comment`: always a COMMENT review. `verdict`: APPROVE when there is no blocker or major finding, REQUEST_CHANGES when there is. `none`: Slack only. |
| `minSeverity` | `blocker`, `major`, `minor` or `nit`. Findings below this level are dropped before posting. |
| `repos` | `owner/repo` patterns with `*`. Links to other repos are ignored silently. |
| `skipLabels` | PR labels (any case) that opt a PR out with a skipped reply. `[skip review]` / `[no review]` in the title always does. Default `["no-review", "skip-review"]`; `[]` turns labels off. See [Opting out and scoping](#opting-out-and-scoping). |
| `baseBranches` | Base-branch globs (`main`, `release/*`). PRs into other branches are ignored silently. Empty = any. |
| `allowedRequesters` | Slack member IDs who may post a link, ask for a re-review or retry, or ask a question. Others are ignored silently; dismissals stay open. Empty = anyone. |
| `pathPrompts` | `[{ "glob", "prompt" }]`, at most 20, 2,000 characters each. Sent in the user message when the PR changes a matching file. See [Instructions per path](#instructions-per-path). |
| `unlimitedTokens` | No token limits. The whole diff is sent with no per-file or total cap, the reply cap goes to the 32,000 maximum, and the call streams with a 10-minute timeout. Context trimming and the ignore list still apply. A PR larger than the model's context window fails instead of being reviewed in part, and daily budget caps still apply. Settings → Reviewers → Token budget → **No token limits**. |
| `rereviewOnThreadReply` | Watch review threads for a "re-review" / "review again" / "PTAL" reply and review again in that thread with the earlier findings. See [Re-review after feedback](#re-review-after-feedback). |
| `cloneRepo` | Shallow-clone the PR head and check the change against the code around it before answering. See [Checking beyond the diff](#checking-beyond-the-diff). |
| `maxToolRounds` | Lookup rounds (1–40) an API model may take in the clone before it must answer. CLI agents explore on their own and ignore it. |
| `repoGuidelines`, `ciContext`, `ciLogs`, `prDiscussion`, `holdApprovalOnFailingCi`, `linkedIssues`, `suggestions` | See [Review context](#review-context). |
| `resolveFixedThreads` | Resolve the PR threads of findings a follow-up finds fixed. See [Re-review after feedback](#re-review-after-feedback). |
| `dismissOnPr`, `learnFromDismissals` | See [In the thread](#in-the-thread). |
| `splitLargePrs` | Review a PR over budget in up to 4 parts. See [Token budget](#token-budget). |
| `autoReview` | Every 5 minutes, review PRs opened or marked ready in the repos in `repos`, posting each to the channel first. Needs a non-empty `repos`. See [Reviews without a Slack post](#reviews-without-a-slack-post). |
| `reviewOnPrComment` | An `@locus review` comment on the PR asks for a review. See [Review on request from the PR](#review-on-request-from-the-pr). |
| `reviewOnMention` | Tagging the reviewer with a review request or a PR link in a thread of its channel that it isn't watching reviews the PR there. Needs Socket Mode message events. See [Review when tagged in a thread](#review-when-tagged-in-a-thread). |
| `maxConcurrentReviews` | Reviews this reviewer runs at once, 1–4. Never two of the same PR. See [Token budget](#token-budget). |
| `verifyFindings` | Double-check blocker and major findings against the code around them before posting, and drop or downgrade the ones it doesn't back up. See [Double-checking serious findings](#double-checking-serious-findings). |
| `verifyProviderId`, `verifyModel` | Model for that check (a second opinion). Empty uses the review's own provider and model. |
| `incrementalRereview` | Follow-up reviews send only the commits since the last review. See [Re-review after feedback](#re-review-after-feedback). |
| `dismissInThread`, `answerQuestions`, `mentionAuthor`, `authorSlackIds` | See [In the thread](#in-the-thread). `authorSlackIds` maps a Git login (any case) to a Slack member ID (`U…` or `W…`). |
| `maxCostUsd` | Estimated USD at which a review stops reading the checkout and answers. `0` is no cap. Up to 100. |
| `maxWatchedThreads` | Review threads watched per reviewer, newest first. 5–200. |
| `reactions` | React on the original post as the review moves on. Uses the Slack user token (`reactions:write`). Which emoji is set by `reactionMap`; see [Reaction legend](#reaction-legend). |
| `reactionMap` | `working`, `pickup`, `commented[]`, `changesRequested[]`, `approved`, `clean`, `failed`, `addressed[]`, `stop[]`, `rereviewOnAddressed`. Defaults to the classic set. |
| `status.*` | Message templates for `started`, `commented`, `approved`, `changesRequested`, `clean`, `failed`, `skipped`, `queued` and `dismissed`. Placeholders: `{pr}` (a Slack link), `{url}`, `{title}`, `{author}`, `{sha}`, `{model}`, `{provider}`, `{files}`, `{tokens}`, `{checkout}` (on the started line: ", with the repo checked out to check callers and tests" or empty), `{comments}`, `{summary}`, `{progress}` (on a follow-up review, "Resolved 2 of 3 earlier findings. ", otherwise empty), `{findings}` (the numbered list, with a leading line break, or empty), `{usage}` (ends with the provider's current usage, see [Token budget](#token-budget)), `{providerUsage}` (that usage alone, or empty), `{reason}`, `{ahead}` (on `queued`: "2 reviews") and `{dismissed}` (on `dismissed`: "#2 (`src/a.ts:12`)"). |

The verdict is derived from the findings that survive `minSeverity` and `maxComments`, not taken from the model. So "request changes" over nits never happens. A finding on a line the diff does not show goes in the review body instead of inline. If the forge rejects an inline anchor, every finding is folded into the body and the post is retried.

## Reaction legend

Many channels read a PR post's reaction stack as its review status. With `reactions` on, the reviewer keeps that stack in step, and **Reaction legend** in Settings → Reviewers says which emoji mean what. Pick a preset, then edit any name (without colons; custom workspace emoji work if the workspace has them, and a name Slack doesn't know is skipped silently).

| Step | `classic` (default) | `legend` |
| --- | --- | --- |
| Picked up (`pickup`, kept) | — | :robot_face: |
| While reviewing (`working`, removed after) | :eyes: | — |
| Left comments (`commented`, per round) | :memo: | :speech_balloon:, then :speech_balloon_plus1: on the first re-review that still has comments, :speech_balloon_plus2: on the next (the last name repeats) |
| Requested changes (`changesRequested`, verdict mode) | :x: | same as comments: :x: means *declined* in the legend, which is a human call |
| Approved / no issues | :white_check_mark: | nothing: the tick comes from a human, and a PR that needs two ticks still needs two humans |
| Comments addressed (`addressed`, read) | — | :lower_left_ballpoint_pen:, :lower_left_fountain_pen:, :ballpoint_pen_plus1:, :ballpoint_pen_plus2: |
| Merged or declined (`stop`, read) | — | :mergedparrot:, :x: |

A round is one review of the PR that ran to the end, so the second review of a PR with comments gets the `_plus1` balloon whichever way it was asked for (a pen, "re-review" in the thread, or the link posted again).

**Re-review when comments are marked addressed** (`rereviewOnAddressed`, on in `legend`): once the reviewer has replied in a post's thread, a new `addressed` reaction on that post reviews the new commits in the thread, like replying "re-review". A pen already there when the thread is first checked doesn't count, and removing and re-adding one counts as new. With no new commits it says so without a model call. Reactions don't arrive as Socket Mode message events, so the pen is noticed when the thread is next polled: every minute without Socket Mode, every 10 minutes with it.

A `stop` reaction on a post means it is left alone: a new post that already carries one isn't reviewed, and a watched thread whose post gets one stops being watched. Reactions that are only thanks or agreement (:thankyou:, :salute:, :fire:, :+1:) and the human :eyes: claim are ignored.

## HTTP

| Method | Path | Role |
| --- | --- | --- |
| GET | `/api/slack/reviewers/runs` | `{ runs, feedback, active, threads, stats }`. The last 50 runs (kept across restarts): outcome, model, tokens, estimated cost, 👍 / 👎 on the final reply, what the double-check did (`verification`) and how many earlier findings it found resolved (`resolved`); per-reviewer vote totals; and each reviewer's 30-day accuracy summary. |
| GET | `/api/slack/reviewers/logs?after=<seq>` | `{ entries, lastSeq }`: the reviewers' Slack and forge calls with `seq` above `after` (default 0), oldest first, at most the last 300. Each has `at`, `durationMs`, `service`, `method`, `endpoint`, `phase` (`channel`, `threads`, `autoReview` or `review`), `reviewerId`, `ok`, `summary`, and redacted `request` / `response` JSON. See [Live logs](#live-logs). |
| GET | `/api/slack/reviewers/:id/stats?days=30` | Accuracy over the last `days` (1–90, default 30): reviews, findings posted by severity, dismissals by reason, precision per severity, resolve rate, double-check results, votes, tokens, cost and spend per week. See [Accuracy](#accuracy). |
| GET | `/api/slack/reviewers/:id/notes` | Remembered dismissals by repo (`host/owner/repo` → notes). |
| POST | `/api/slack/reviewers/:id/notes/forget` | `{ "repo"?, "index"? }`: forget one note, a repo's, or (empty body) all. Returns `{ removed }`. |
| POST | `/api/slack/reviewers/:id/notes/propose` | `{ "repo": "host/owner/repo" }`: open a PR adding that repo's notes to its `REVIEW.md`. Returns `{ url, number, branch, notes }`. GitHub and GitLab only; 400 with the reason otherwise. See [Promote dismissals into REVIEW.md](#promote-dismissals-into-reviewmd). |
| POST | `/api/slack/reviewers/:id/review` | `{ "url": "<PR url>", "threadTs"?: "<Slack ts>", "dryRun"?: true }`. Reviews now under the same rules as a channel post, including the head-SHA skip. Progress goes to `threadTs` when given, otherwise nothing is posted to Slack. `dryRun` posts nothing, records nothing, ignores the head-SHA skip, drafts and opt-out labels, and returns `findings` and `summary`. |

## Skills

Skills from Settings → Skills work in the review prompt. Write `/name` (for example `Follow /house-rules.`), or click a skill's chip under the prompt in Settings → Reviewers, which adds or removes the reference.

Chat agents load skills on demand with a `read_skill` tool. Reviews have no tools, so the full text of each skill the prompt names is added to the system prompt, after your instructions. Skills the prompt doesn't name are never sent. The reviewer tells the model to turn any "call this tool" or "post a comment" steps in a skill into findings in its JSON.

Skills named in [Instructions per path](#instructions-per-path) are sent in the user message with those instructions, only when their path matches.

Settings shows how many skills each review sends and roughly how many tokens they add. It also flags any `/name` that matches no enabled skill; that text is sent as written. Paths such as `src/api` are never treated as skills. Skill text is stable, so it caches with the rest of the system prompt.

## CLI agents

A reviewer can use Claude Code, Codex, Cursor CLI, Kiro or a custom CLI agent instead of an API provider, for example to review on a subscription you already have. Each review runs the CLI once through `completeOneShot`. It runs in plan / read-only mode, in a new empty scratch folder that is deleted afterwards (or in the clone, see [Checking beyond the diff](#checking-beyond-the-diff)), inside a sandbox (below).

- **Prompt size.** Most CLIs take the prompt as a command-line argument, so the diff is capped to keep the whole prompt under about 120,000 characters (30,000 on Windows). That cap holds even with No token limits; files over it are listed by name. A prompt that still doesn't fit fails before the CLI starts.
- **Timeouts.** 5 minutes, or 10 with No token limits.
- **Usage.** Token counts and cost come from the CLI when it reports them. When it reports none (Kiro meters in credits, not tokens), they are estimated at about 4 characters per token from the prompt and reply and shown as `~12k in / ~400 out (estimated)`. The estimate misses files the CLI read on its own, so it runs low. Max output tokens doesn't apply.
- **Environment.** The CLI gets a copy of the server's environment with credentials removed: names containing TOKEN, SECRET, PASSWORD, API_KEY, ACCESS_KEY, CREDENTIAL, PRIVATE_KEY, AUTH, COOKIE, SESSION, DSN and the like, the `AWS_`, `AZURE_`, `GOOGLE_`, `GH_`/`GITHUB_`, `GITLAB_`, `NPM_`, `DOCKER_`, `KUBE`, `VAULT_`, `SLACK_` … prefixes, and `SSH_AUTH_SOCK`, `KUBECONFIG`, `GIT_ASKPASS`. `PATH`, `HOME`, locale and proxy settings stay, so the CLI still finds its own login (`~/.claude`, `~/.codex`), and the key configured on the provider in Locus is still passed. A key that only exists in the server's environment is not.
- **Sandbox.** The CLI runs in the same sandbox as Docker-session CLIs (bubblewrap inside pasta on Linux, `sandbox-exec` on macOS), made stricter for untrusted PRs. Your home directory is replaced by an empty one (Linux) or denied (macOS), and only what the selected CLI needs to sign in and run is bound back: `~/.claude` + `~/.claude.json` for Claude Code, `~/.codex`, `~/.cursor` + `~/.config/cursor`, `~/.kiro` + `~/.local/share/kiro-cli`, `~/.gemini` and `~/.<name>` / `~/.config/<name>` for a custom CLI, plus the CLI's install folder (read-only) when it lives under `HOME` (`~/.local/bin`, an npm-global package, an nvm Node). `~/.ssh`, `~/.aws`, `~/.config/gcloud`, `~/.kube`, `~/.docker`, `~/.gnupg`, `~/.netrc`, `~/.git-credentials` and other credential stores are never bound back. `<LOCUS_HOME>` is hidden, and on Linux so are `/tmp` and `$XDG_RUNTIME_DIR` (agent sockets). The clone (or the scratch folder) is the only other writable path. The CLI keeps outbound internet for its provider but reaches no port on this machine's loopback: it has no Locus MCP. A loopback proxy has to be allowed with `LOCUS_CLI_SANDBOX_ALLOW_PORTS`. If no sandbox works (bwrap or pasta missing, user namespaces off, Windows), the review fails with a message naming what to install (`apt install bubblewrap passt`) instead of running the CLI unsandboxed. `LOCUS_CLI_SANDBOX=off` runs it unsandboxed anyway; `LOCUS_CLI_SANDBOX_NET=host` keeps the filesystem sandbox only. Thread answers run the same way. See [docs/cli-agent-sandbox.md](cli-agent-sandbox.md#slack-pr-reviewer).
- **Risk.** CLI agents keep their own tools: plan mode and Codex's read-only sandbox still allow reading files, and Cursor and Kiro auto-approve their tools. A review feeds the CLI untrusted PR text. The sandbox keeps secrets under `HOME` and Locus config out of reach, but the CLI can still read the clone, its own login folder, and files outside `HOME` (`/etc`, other users' world-readable files), and it has internet access, so a malicious PR could still tell it to send what it can read elsewhere or put it in a review posted to the PR and Slack. Settings shows this warning on any reviewer that resolves to a CLI agent. Prefer CLI agents for repos where you trust everyone who can open a pull request.

## State

`<dataDir>/slack-reviewers/state.json` stores the Slack cursor per reviewer; the head SHA, outcome, last reviewed SHA, findings and dismissed findings for each reviewed PR (the last 500); the watched threads; the votes on final replies; the remembered dismissals per repo; the daily accuracy ledger (last 90 days); the last 50 runs; the reviews queued or running; and, for `autoReview` and `reviewOnPrComment`, the repos already primed, the open PRs seen (the last 1,000) and the newest PR comment checked per PR. When Locus starts, reviews that were queued or running when it stopped (less than a day ago) are queued again, so a restart doesn't lose a link whose post the cursor had already passed. Delete the file to re-prime.

## Security

- PR titles, descriptions and diffs are written by the PR author. Description and diff are wrapped in `<untrusted-data kind="pr-text">` fences, and the contract tells the model they are data.
- With an API provider the model's only tools read the clone of the PR head (or there are none, with `cloneRepo` off). Its only effects are the forge review and the thread replies, and both are built from parsed JSON, not free text. File contents it reads come from the PR author and are described to it as data. The clone is confined: paths can't leave it or enter `.git`, and symlinks are plain files.
- A CLI agent keeps its own tools. It runs sandboxed: no home directory beyond its own login, no `<LOCUS_HOME>`, no host loopback, and the review fails rather than run it unsandboxed (unless `LOCUS_CLI_SANDBOX=off`). It can still read the clone and files outside `HOME`, and it has internet access, so a malicious PR could still use it to leak what it can read. A CLI is used only when you choose it, never as the silent fallback (see [CLI agents](#cli-agents)).
- Repo guidelines come from the base branch, so a PR can't rewrite the rules it is reviewed against. From a clone (forges that can't read files), files the PR changes are skipped.
- CI check names and logs, linked issues, existing PR comments, remembered dismissals and thread questions are fenced as untrusted data. Linked issues are only read from the PR's own repo.
- A suggested fix can't contain a code fence, so it can't break out of its suggestion block. Finding text in the Slack list has `<`, `>` and `&` escaped, so model output can't form Slack links or mentions.
- An answer to a thread question is posted as plain text and can't change the verdict, post to the PR, or dismiss findings.
- `pathPrompts` are operator text and go unfenced in the user message. Only people who can edit Locus settings can change them.
- **Propose as REVIEW.md** writes to the repo with the forge token: one new branch, one file, one PR, never the default branch. The file text comes from remembered notes, which quote model findings on PR code; review the PR before merging.
- `forgeMode: "verdict"` lets the reviewer approve PRs. Combine it with branch protection that still needs a human, or keep `comment`.
- Posting as `user` puts unattended messages under your name. Prefer `bot`.
