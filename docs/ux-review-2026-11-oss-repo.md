# UI/UX pass: a fresh setup with an open-source repo linked (November 2026)

How this was checked: a clean `LOCUS_HOME`, `main` at `b94bb7f`, the server on the mock
hypervisor, and Vite. Docker was installed but the daemon was not running. A fake
OpenAI-compatible server listened on Ollama's port (`127.0.0.1:11434`). The app was driven with
Playwright the way a new contributor would use it: the setup wizard (Ollama, Developer), then
Codebase → Paste a URL → `https://github.com/Modsofthenation/Locus` with no token. Then
every rail and More section, every Codebase tab, a merged PR (#923) and every Settings tab were
checked at 1440px and at 390px. The same overlap, clipping and off-screen script as the earlier
pass ran on each screen. It came back almost clean, so the items below come from reading the
screenshots and following the flows.

This pass is different from `ux-review-2026-11.md` in one way: a repo is linked. Most of the
findings are places where the app knows about that repo and doesn't use it.

Severity: **P1** broken or misleading, **P2** clearly wrong but has a workaround, **P3** polish.

**Status:** every item below is addressed in the follow-up change, with these notes:

- 24: the repo picker now opens upward when there is no room below. Over the chips with room
  below it still opens downward; that is normal popover behaviour.
- 25: the Codebase and PR tab strips are now `role="tab"` with `aria-selected`. The
  `.git-account-remove` "no name" flag was a false positive: the button has text, but it sits
  inside a collapsed `<details>`.
- 18: the About card (description, license, language, stars, topics, README excerpt, good first
  issues) is for GitHub; Gitea and Forgejo get the metadata without README or issue count.

## P1

1. **Codebase → Start agent ignores `dockerReady`.** With the daemon down, it starts a Docker
   agent straight away. The raw CLI error (`failed to connect to the docker API at
   unix:///var/run/docker.sock…`) then shows twice, once in the repo header and once in the
   PR pane. The button changes to **Continue**, which points at a dead agent. The Agents and
   Design launchers already check `state.dockerReady` (`EmptyState.tsx`, `DesignEmpty.tsx`), but
   `components/codebase/` never does. Fix: offer Host, or show the same "Docker isn't running"
   callout before creating anything.
2. **A failed Docker agent says "switch to Host or start Docker", but you can't switch.** The
   runtime is fixed per agent. The header's primary action is **Start**, which fails the same
   way. Fix: offer **Duplicate as Host agent** (same repo, same prompt) and **Open Docker
   setup**, and make Start secondary until Docker is ready.
3. **The server crashes on first run without `ssh-keygen`.** The message is `Locus control plane
   crashed: ssh-keygen is required…`, and the UI only shows a dead connection. A minimal Linux or
   container setup (the usual first try for an open-source contributor) hits this before
   seeing anything. Fix: create the key lazily when the first VM or SSH guest needs it, or warn
   and continue. Add `openssh-client` to the CONTRIBUTING prerequisites.

## P2: the linked repo isn't used

4. **The New agent and Design composers default to "No repo" / "No repo context"** even when
   exactly one repo is linked. The Agents empty state's first-task chips then say "Explain
   Modsofthenation/Locus" next to a picker that says No repo. Fix: preselect the repo
   when only one is linked, or when the chip names it.
5. **The "Connect GitHub · Add a GitHub token" banner stays at the top of Agents** after a
   public repo is linked and working. It's the first thing above the task box. Fix: hide it
   once a repo is linked, or move it inline in the repo picker ("Private repos need a token").
6. **Git account state contradicts itself.** Linking with no token creates a GitHub row in
   Settings → Git ("Not signed in · Used by 1 linked repo"). Settings → Integrations says "No
   Git accounts connected yet", and Repo settings → Account shows a bare "GitHub" pill. Fix: call
   it what it is, **Anonymous (public, 60 requests/hour)**, in all three places, with "Add token
   to raise the limit".
7. **The no-token rate limit is a dead end on first link.** The first link got "GitHub rate
   limit reached for reads without a token" (the shared IP had used up the quota). Open PRs and
   Open issues show "Rate limited" with no reset time. Fix: show the reset time from
   `x-ratelimit-reset`, keep the repo usable, and retry when the limit resets.
8. **Brain, IDE and Jobs don't offer the linked repo.** Brain's empty state asks for a
   `/path/to/repo` with Browse. IDE has a generic Clone repo card. Jobs' "Review on git push"
   template doesn't prefill the repo. Fix: show linked repos as one-click options ("Index
   Locus", "Open Locus", "Review pushes to Locus").
9. **Empty PR and Issues tabs are a list column plus "Select a pull request."** With 0 open PRs
   but many merged ones, the tab shows "No pull requests." and an empty detail pane. The
   history is behind a small "Open" filter. Fix: an empty state that says "No open PRs · View
   merged (N)" or switches to Recent. The same applies to Issues.
10. **Merged PRs still lead with Review with agent (primary) and Fix with agent.** Neither
    makes sense after merge. Fix: hide or demote them on merged and closed PRs. Lead with "Open
    on GitHub" or "View change stack".

## P2: other

11. **The wizard picks a model that might not exist.** Ollama saves as `llama3.2` without
    asking the server. The fake server only had `fake-coder`, so every composer showed
    "Ollama · llama3.2". Fix: fetch `/v1/models` (or `/api/tags`) when saving and pick a model
    that is installed. If none are installed, say "No models pulled — run `ollama pull …`".
12. **The wizard calls everything a key.** For Ollama and CLI providers the button still says
    **Save key**, and the subtitle still says "Add a provider key" after setup is done. After
    saving it says "An enabled provider can answer chat" without naming the provider or
    testing it. Fix: say "Use Ollama" for keyless providers. After saving, show "Ollama ·
    fake-coder · responded in 120 ms" from a real test call.
13. **The wizard's provider list is flat (18 items)** with no grouping or "needs a key"
    marker. Fix: group into Free/Local, Cloud (key) and CLI. The modal also jumps upward when
    the provider card collapses.
14. **Docker's empty state says "No containers on this Docker engine. Start an agent…"** with a
    primary **New agent** while the daemon is down. Only the footer says "daemon down". Fix: if
    `dockerReady` is false, the empty state should say Docker isn't running and offer Host or
    the setup steps.
15. **The Architecture tab before analysis is three columns of the same empty template**
    (Not analysed yet / How it is shaped / Findings / Improvements, each "Nothing on this
    pass"). The real action, **Analyse**, is a small ghost button. Fix: one empty state with a
    primary **Analyse** that names the checkout it will read, or "Needs a local checkout →
    Open in IDE".

## P3

16. **Codebase sidebar row:** "Modsofthenation/Local-a…" is cut off under the name that
    already says Locus, and a bare **0** badge has no label. Show only the owner, and
    hide the badge at 0 or label it "0 PRs".
17. **Repo header subtitle "GitHub · 0 open"** is ambiguous (PRs? issues?), and the GitHub ↗
    chip repeats it. Use "GitHub · 0 open PRs · main".
18. **The Overview for an open-source repo is mostly empty boxes.** The Review inbox card
    takes half the page to say "No open pull requests". The Brain card is empty. Show the
    README excerpt, description, license, language, stars and "good first issue" count, and
    collapse empty cards.
19. **PR list rows cut the branch chips** to `cla… → m…`, which tells you nothing. Drop
    `head → base` from the row (it's in the detail view) or show it only on hover.
20. **The "Pull requests 0" tab count stays 0** while the list shows 10 merged PRs under All.
    Label it as open-only ("0 open") or update it with the filter.
21. **Repo Settings puts Unlink right next to Save.** Move Unlink to a separate danger zone,
    as other settings pages do.
22. **Grafana still has two "Add Grafana" buttons** (sidebar primary plus hero secondary).
    Board and Projects put a "New board" / "New project" button inside the composer as well as
    in the sidebar.
23. **Slack's sidebar footer says "0 conversations"** while you're signed out.
24. **The repo picker popover covers the first-task chips.** It opens downward over "Try a
    first task". Open it upward, or close the chips' row.
25. **The Codebase tab strip uses plain buttons** (no `role="tab"` / `aria-selected`), so
    screen readers can't tell which tab is selected. Settings → Git also has an icon-only remove
    button with no accessible name (`.git-account-remove`).
26. **At 390px, a failed agent's header** cuts the status to "Docker isn't running — swi…"
    and the Codebase tabs wrap to two rows. Put the error in the thread only, and make the tab
    strip scroll sideways.

## Suggested order

- First PR: items 1, 2, 3 and 14 (Docker down, first run). They are the ones that break.
- Second PR: items 4–10 ("use the linked repo"). This is the biggest change for an
  open-source contributor's first hour.
- Third PR: items 11–13 (wizard). Then the P3s.
