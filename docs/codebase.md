# Codebase

Codebase is a local catalog of git remotes. Locus does not host repositories. GitHub, GitLab, Bitbucket, Gitea, Forgejo, or Azure DevOps stays the remote; agents still run on this machine.

Put forge tokens in Settings → Git, or **Sign in with GitHub / GitLab / Bitbucket** so SSO-protected orgs work. You can keep several GitHub, GitLab, and Bitbucket accounts at once. Tokens stay in `~/.locus/secrets.enc`, not in chat. A signed-in session or a pasted token is enough to clone a repo, fetch a branch or pull request, and push over HTTPS — you do not need an SSH key path. GitHub uses device flow; GitLab and Bitbucket open a browser and return to `http://127.0.0.1:<port>/api/oauth/callback`. Each Sign in row needs an OAuth client ID (GitLab and Bitbucket also need the application secret), or set `LOCUS_GITHUB_OAUTH_CLIENT_ID` / `LOCUS_GITLAB_OAUTH_CLIENT_ID` / `LOCUS_BITBUCKET_OAUTH_CLIENT_ID`.

## Link a repository

Open **Codebase** on the left icon rail.

- **Link repo** — paste a GitHub, GitLab, Bitbucket, Gitea, Forgejo, or Azure DevOps URL. If more than one token of that forge is configured, pick the account.
- **Import from Git** — lists remotes those tokens can see. Search or filter, check the ones you want, then **Link selected**. Already-linked remotes stay marked and skipped.

The empty state says this explicitly: tokens stay in Settings → Git; Locus stays the local catalog.

Unlink from the repo header, the sidebar ⋯ menu, or Settings. Existing agents keep their checkout.

A `Locus.md` at the repository root is guiding context for Locus agents. After clone, it is loaded into the system prompt ahead of `AGENTS.md`, `CLAUDE.md`, and `.locus/rules` (same character budget). Put conventions, domain terms, and how-to-work notes there.

## Repo home

Select a linked repo. The header shows the forge, default ref, and open PR count, plus **Continue** (when a live coding agent exists), **Open product**, **New agent** / **Start agent**, **Setup environment**, **New automation**, and **Unlink**. The sidebar groups repos by forge and shows open PR counts.

| Tab | What you get |
| --- | --- |
| Overview | URL, default branch, last fetch, a shortcut into the PR inbox, open issue count |
| Architecture | Repo, Feature, and Code sections. **Analyse** a Host or Docker checkout, **Suggest improvements**, or **Improve with agent** |
| Pull requests | Open, draft, or all PRs. Rows show author, branches, activity, reviewers, and builds. **Review with agent** on a selected PR |
| Issues | Open, closed, or all issues (not pull requests). Rows show author, labels, and `#number`. Comment posts to the forge |
| Agents | Sessions attached to this repo, including review sessions |
| Automations | Jobs whose repo is this catalog row |
| Settings | Display name, default ref, account, Docker image, **Auto-review new pull requests**, Unlink |

**Continue** reopens the live coding agent bound to that repo (most recently updated). **Open product** is the same reuse (start the guest if it is stopped) even when no agent exists yet — it starts a coding chat from the repo's named environment when **Save as environment…** has bound one after setup. **New agent** / **Start agent** always starts a **new** coding chat and Docker container from that row (URL, ref, image, playbook). **Setup environment** starts a Docker agent that installs dependencies, starts the app, verifies a real product action, and writes `.locus/environment.json` so later agents run `install` then `start` after clone. When that setup session looks good, **Save as environment…** (agent menu, or `locus agent save-environment`) captures a golden workspace, stores a named environment without the setup recipe, and binds it to the repo so **Open product** / later **Start agent** boot from that image. **New automation** pre-fills a job from the same row. `Ctrl/Cmd+N` on Codebase opens Link repo or the New agent form. The command palette has a Codebase group (jump to a repo, open `#123`). CLI: `locus repo agent <id> --reuse` vs `--new`; `locus repo setup <id>` for environment setup.

## Architecture

The Architecture tab is three sections on the linked repo: **Repo** (the whole checkout), **Feature** (a directory such as `packages/shared` or `src`), and **Code** (one source file).

**Analyse** reads a Host or Docker checkout already on this machine — an IDE folder, a host agent, or a Docker workspace. It does not call a model. The pass looks for shallow modules, pass-throughs, load/validate/save splits, two exports of the same operation, copied string lists, and imports of `internal` / `private` paths. Each code section names who imports the file. A test that imports it is the check to run; the importer list is not proof a change is safe.

**Suggest improvements** reorders that pass around behaviour-preserving moves: delete a pass-through, keep one way, derive a list, seal an internal, group a temporal split. **Improve with agent** starts a session on that checkout (or a fresh Docker clone when the checkout is not a host folder) with those findings in the prompt. The agent verifies each finding before editing. The tab is on the desktop repo home.

## Pull requests

The Pull requests tab is a split inbox: the list stays on the left (Draft badge, title, author, `#number`, updated time, head → base) and the selected PR opens on the right. The Overview **Review inbox** is the same table with Created, Activity, Reviewers, and Builds columns. Lists and opened PR details are cached for two minutes (on disk under `~/.locus/repos/` and in the UI) so switching sections or reloading does not hit the forge again. Comment, review, and merge refresh the open PR.

- **Overview** — files / diff / checks / load-path cards, a **Change stack** list of independent cohorts, an agent summary from the latest review session (not the PR description), architecture-aware traces (tests, APIs, UI, jobs, permissions), operator notes that supplement the next AI review, and the changed-file list. Click a path to jump into Files.
- **Stack** — a layer-by-layer walkthrough of the diff. Cohorts group unrelated work; layers follow load-path reading order (contracts before consumers, then tests) and show only the hunk ranges that belong to that layer. Opening Stack fills range summaries from a host completion when a provider is configured; GET stays heuristic so the tab never waits on a model. Layers that are a new call flow, lifecycle, or data model can show a Mermaid diagram. `J` / `K` move layers, `Z` focuses the diff. The snapshot dropdown keeps prior head SHAs (read-only). Comment posts to the forge on the current head. Files stays the full explorer. **Update** rebuilds when the head moves. Agent chat turn diffs reuse the same walkthrough.
- **Conversation** — markdown description, comment timeline, a comment box, and **Submit review** (Comment / Approve / Request changes). Path + line still work from this composer.
- **Files** — filterable explorer tree of changed files (same nested folders as Docker Files) plus numbered unified diffs with per-file +/- counts. The selected file is expanded; other files stay collapsed so large PRs stay fast. Click a hunk line to comment on that path.
- **Review with agent** — always starts a **new** Docker review session (own chat + container) at the PR head. It does not reuse the repo coding agent or a live preview session. The guest fetches that branch (or the forge PR/MR ref) from the remote into `/workspace`; you do not need a local checkout. The prompt includes the load path brief, the change stack walkthrough, existing PR comments, and any operator notes, and tells the agent not to clone again. The agent can read the tree and call host-side PR tools (`git_pr_get` includes clipped unified diffs plus optional `include`/`paths`, plus `git_pr_loadpath`, `git_pr_comment`, `git_pr_review`, `git_pr_checks`). Coding and review sessions also get `git_issue_list` / `git_issue_get` / `git_issue_comment` for GitHub, GitLab, and Bitbucket issues (not PRs). On Cursor CLI those same tools are on the session-scoped locus MCP server, not a third-party forge MCP. Review sessions keep `git_pr_*`; coding session MCP exposes the issue tools. Push stays off unless you start a normal agent on the branch. Clicking **Review with agent** again starts another isolated reviewer; open an existing review from the repo Agents tab to continue that thread.
- **Fix with agent** — resumes the coding agent bound to that PR, or starts one on the head branch, with the reviewer JSON verdict and load path. Stay on the PR branch. CLI: `locus repo fix-session <id> <number>`.
- **Merge** — asks for confirm, then merges on the forge. Disabled for drafts and already-merged PRs. Protected default branches (`main` / `master`) stay gated.

GitHub is the full thread model. GitLab notes and Bitbucket comments use the same page with fewer thread features.

PR links in the artifact drawer open this page when the repo is linked; otherwise they open the forge.

A coding chat can `subscribe` to a GitHub, GitLab, or Bitbucket pull request, or to that PR's **CI checks**. Locus polls `git_pr_get` and wakes that same thread; `kind: checks` also starts **Fix with agent** when a new check fails. This is not an automation run.

## Issues

The Issues tab is the same split inbox as Pull requests: list on the left (title, author, `#number`, labels) and the selected issue on the right (markdown body, comment timeline, comment box). GitHub hides pull requests from this list (those stay on Pull requests). GitLab issues and Bitbucket issue-tracker rows use the same page. Lists and opened issue details share the two-minute cache under `~/.locus/repos/`. Comment refreshes the open issue.

Agents call `git_issue_list`, `git_issue_get`, and `git_issue_comment` on the host (Approve / Deny for comment). This is a Forge extension, not a Settings → Integrations product.

## Security

- Keep the control plane on loopback. Forge HTTP runs on the host with vaulted tokens. Do not paste `GIT_TOKEN` into chat.
- Agent-posted reviews and comments wait for Approve / Deny in chat. PR and issue bodies and comments are wrapped as untrusted data for the model.
- Restricted guest jail already allowlists forge hosts. Codebase polling uses the host, so jail policy is unchanged.

See [SECURITY.md](../SECURITY.md).
