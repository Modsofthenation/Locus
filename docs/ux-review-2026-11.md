# UI/UX pass — November 2026

How this was checked: the real app (`apps/server` with the mock hypervisor plus Vite) was driven
with Playwright at 2000, 1440, 1280, 1100, 1024, 900, 800, 700, 600, 430 and 390 px wide, and on an
emulated Pixel 7. A fake OpenAI-compatible endpoint streamed slowly so chats stayed mid-turn. Every
rail section, every Settings tab and the Swarm shell (with five teammates and the computer panel)
were screenshotted. A script also flagged interactive elements that overlap, elements that sit
off-screen, clipped text and horizontal page scroll. The script also reports content that has
scrolled under a sticky header or footer; those are not real overlaps.

Severity: **P1** broken or misleading, **P2** clearly wrong but has a workaround, **P3** polish or
consistency. Every item below is **fixed** unless it says otherwise.

## Swarm

- **P1 · The sidebar overlapped the chat.** `styles/swarm.css` fixed the first grid column at
  `300px`, but the sidebar (72px rail plus the resizable list) is 340px or more. The chat started
  40px or more underneath it, and the gap grew as the sidebar was widened. The column now sizes
  from the sidebar (`auto minmax(0, 1fr)`). The thread, computer panel and sidebar sit side by side
  at 2000, 1440, 1100 and 900px.
- **P1 · At ≤760px the list sat half off-screen and covered the rail.** Swarm's "keep the list open
  even when collapsed" overrides now apply only on wide screens. Narrow windows use the same rail
  plus slide-over drawer as Developer.
- **P2 · Teammate names were cut to "Chief of …"** because the timestamp and ⋯ took up the row.
  ⋯ now floats over the end of the preview and shows on hover or focus (always on touch). The
  preview gets its intended two lines.
- **P3 · The rail label read "Teamma…".** Fitted with tighter tracking.
- **P3 · Settings appeared twice** (rail and sidebar footer). The footer copy is hidden in Swarm.
- **P3 · Teams showed three "New team" buttons.** The Team / Group chat choice is now a segmented
  control, and the team name sits inside the composer as its title line.

## Chat / Agents

- **P1 · The composer's model picker overlapped Stop, Queue and Send** while a turn was running
  (1024, 700, 430 and 390px). The picker, its tooltip wrapper and its menu now shrink and show an
  ellipsis; the action buttons keep their size.
- **P1 · Docker was the default even when the daemon was down.** `/api/health` now returns
  `dockerReady` (the result of `docker info`, cached for 10s). The Agents, Design, Games and Assets
  launchers switch to Host. Picking Docker shows "Docker isn't running" with "Use Host instead", and
  launching is blocked.
- **P2 · The Docker error appeared twice in the thread, and "Waiting for the guest…" kept spinning
  after the failure.** Back-to-back system notes that map to the same plain error collapse to the
  latest one. A "did not become ready" note ends the wait.
- **P2 · "Loading local model…" showed while tokens were already streaming.** It now clears on the
  first token, on desktop and phone.
- **P2 · The scroll tick rail sat on top of message text** below 1100px. The rail is narrower, and
  the thread keeps 14px of left padding.
- **P3 · The Compare nudge wrapped to three rows on phones.** It is now one row with an ellipsis and
  a × dismiss.
- **P3 · Copy button over the top bar.** Not a bug: it was a message that had scrolled out of the
  thread's clipped area.

## Phone / narrow widths

- **P1 · The rail peek flyout opened on tap and showed titles as "Ref…".** `.side-rail button`
  (36px square) was also sizing the peek rows; they are now full-width rows. Peek opens only on
  devices that can hover. The truncation affected the desktop collapsed rail too.
- **P2 · The chat top bar cut the title to "Refactor a…".** Below 600px, Compare moves to the ⋯
  menu only, and the panel toggle shows just its icon. The label stays in the tooltip and for
  screen readers.
- **P3 · Touch targets under 32px.** On coarse pointers, composer and top-bar controls are at least
  36px.

## Empty states

- **P3 · Starter chips were styled two ways.** The hidden Alt-shortcut `<kbd>` reserved space; it
  now floats as a badge, so every section centres its chips.
- **P3 · Eyebrows repeated the page title.** The "JOBS" and "CODEBASE" eyebrows are removed.
- **P2 · The Board and Projects textareas had no padding.** They now use the composer text inset.
- **P3 · Duplicate primary actions.** Grafana's hero "Add Grafana" is now secondary.
  Board/Projects/Codebase keep a primary submit in the composer or form, the same pattern as Agents
  (sidebar "New agent" plus "Send").
- **P3 · A lone ⋯ under the title on Brain and Slack.** It now sits beside the title. Docker's
  icon-only refresh button is now labelled "Refresh".
- **P3 · Redundant subtitles and counts.** "Slack / Slack" now reads "Not signed in" (or the
  workspace name). Grafana has no subtitle. Codebase, Board and Projects footers show counts only
  while a search filters the list.
- **P3 · Jobs used a clock icon** on "New job". It now uses `+` like every other section.
- **P3 · Games placeholder.** Now reads "…Type @ to reference an asset…".
- **P3 · Brain had two folder controls.** The decorative icon box is gone; the icon is on Browse.

## Docker

- **P2 · The footer said "daemon ok" while the daemon was down.** It now reads "daemon down".
- **P3 · Status appeared three times.** The STATUS column is removed; the chip and header remain.
- **P3 · Mac glyphs on Linux.** Shortcut hints now use `shortcutDisplay` and `altKeyDisplay`
  ("Ctrl+C", "Alt+↑" off Mac).
- **P3 · Log lines without a timestamp were out of line.** They now get an empty time column
  whenever any visible line has one.

## Settings

- **P2 · Integrations listed each forge twice** ("GitHub · GitHub · …"). It now lists only
  connected accounts, once each, with their status.
- **P3 · The Providers filter was indented 10px.** It reused the sidebar `.search` margin; that is
  reset.
- **P3 · Workers showed "Add worker" twice.** The empty card no longer has its own button.
- **P3 · The Phone pairing header was out of line with its body.** It now uses the same 16px inset.
- **P3 · The "High contrast" pill wrapped onto two lines.** Pills no longer wrap; the row scrolls.
- **P3 · Advanced: the distiller placeholder was clipped.** Shortened.
- **P3 · Machines status used the mono font.** Only image file names stay monospace.

## Setup wizard

- **P3 · Developer/Swarm looked like two competing primary buttons.** Now a segmented control.

## Follow-ups (also fixed)

- **P3 · The Docker header and status chip both showed the container state.** The header now
  summarises the whole list ("0 running · 1 stopped"). The chip is the only place that shows the
  selected container's state.
- **P3 · Swarm's user bubble was a fixed iOS blue (`#0a84ff`)** that clashed with warm themes. It
  now uses the theme's `--accent` with its paired `--accent-ink`, the same pair primary buttons use.
  Text, links and message actions in the bubble all follow it. All 106 theme definitions keep at
  least 4.5:1 contrast (WCAG AA). The lowest is Paper at 4.56:1.

## Second pass — 13 November

Same method, on main at 0.21.0: the server with the mock hypervisor and an isolated `LOCUS_HOME`, plus
Vite. A fake OpenAI-compatible endpoint streamed a markdown answer (headings, a table, code, a list),
and a slow variant kept a turn running. Every rail section, every Settings tab and the setup wizard were
captured at 1440, 1280, 1024, 800 and 390px. The same overlap, off-screen, clipped-text and page-scroll
script ran on each one. Every item below is **fixed**.

### Chat / Agents

- **P2 · The Chat / Terminal toggle cut "Terminal" to "Term…"**, even at 1440px. `swarm.css` gives
  `.product-mode-toggle` buttons `flex: 1` and an ellipsis, and that rule beat the toggle's own
  `flex: 0 0 auto`. The toggle now keeps its size and full labels.
- **P2 · On phones, keeping the toggle readable squeezed the title to "SLOW Ex…".** Below 600px the
  toggle is hidden, like Compare, and the ⋯ menu has **Open terminal** / **Back to chat**.
- **P3 · The filter chips wrapped onto a second row** once "Running 1" appeared. They stay on one row
  with tighter padding and scroll sideways in a narrow sidebar.
- **P3 · The running-turn placeholder repeated the hint under it** ("Send steers this turn…"). It now
  reads "Add guidance for the running turn…". The phone composer has no hint under it, so it keeps the
  old wording.

### Sidebar headers

- **P3 · Grafana's header had no second line**, so **Add Grafana** sat 16px higher than every other
  section's primary button. It now reads "Not connected" or "Connected".
- **P3 · Docker read "Docker · local"** under the title "Docker". It now reads "Local engine" (or
  "Mock engine"). The footer already shows the daemon's state.

### Empty states

- **P3 · Board and Projects put Create bottom-left**, while every other composer puts Send
  bottom-right. Board's placeholder also said "start from a pill"; it now points at the templates.
- **P3 · Assets: the + in the Back slot sat higher than Front and Side** because "optional" added a
  line. "optional" now hangs under the label.
- **P3 · Codebase: "Add a GitHub token" was a centred link under a large gap.** It is now a button at
  the start of the card, like **Import from Git** once a token exists.
- **P3 · Hero subtitles ended on one word** ("…no / guest.", "…the canvas / can write."). They use
  `text-wrap: pretty`.

### Settings

- **P3 · Git account rows said the forge's name three times** ("GitHub / GitHub · GitHub /
  github.com") before sign-in. The handle is shown once, the subtitle only when it differs, and the
  service column shows just the host.
- **P3 · Providers on a phone broke "Add provider" across two lines.** The header wraps its actions
  under the count instead.

### Brain (phone)

- **P3 · The tabs wrapped "Activity" onto a second row, and the repo path field was squeezed** beside
  Browse and Build. The tabs stay on one row and the path gets its own line.

### Model chip

- **P2 · Before setup, the composer chip read "OpenCode (off) · big-pickle"** and Send would fail.
  When the chosen provider is off or missing, the chip label is tinted with the theme's warning
  colour, and its menu opens with **Turn on a provider…** (Settings → Providers). The topbar subtitle
  keeps the same label.

### Checked, not changed

- Eyebrows such as "OR START FROM" use IBM Plex Mono on purpose; it loads from Google Fonts like
  Outfit does.
- Visual snapshots: this container can't download the Chromium build that `@playwright/test` pins,
  and the preinstalled build differs from the baselines even on unchanged main. Baselines that this
  pass changed are refreshed from CI's own "actual" images instead.
