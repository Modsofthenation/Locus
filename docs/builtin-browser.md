# Built-in agent browser

Goal: a **shared Chromium** in the agent workspace — the agent drives it, you watch it live, and you can take the wheel without leaving Locus. Think Claude Cowork's in-app browser, not a hidden guest display the model screenshots in the dark.

Related: [SECURITY.md](../SECURITY.md) (loopback, network jail, untrusted web), [agent-backends.md](agent-backends.md) (where the guest and its Chromium run), `CdpChromiumDriver` in `packages/guest-agent/src/chromium.ts`, `DockerWorkspace` in `apps/desktop/src/components/docker/DockerWorkspace.tsx`, takeover / handback in `apps/server/src/session/sessions.ts`.

This is an implementation plan. Do not ship the pane until PR 1 lands.

## Why

Today the guest already has a headed Chromium. The operator does not.

| Surface | What it is | Who uses it |
| --- | --- | --- |
| **Preview** | Iframe of a listening guest HTTP port (the app you are building) | Operator. Comment + viewport. Not a real browser. |
| **Guest Chromium** | CDP on `:9222` inside Docker (`/workspace/.locus-chrome`, Xvfb 1280×800) | Agent + operator (Browser tab). `screenshot`, click/type, snapshot/ref, tabs, console, network, PDF, trace, download. |
| **VM desktop** | noVNC of the full guest | Operator + agent. Whole OS, not a product browser. |
| **websearch** | Host DuckDuckGo / Wikipedia snippets | Agent. Off until the composer toggle. Bypasses the guest jail. |
| **Host runtime** | Files + shell on this disk | Isolated Chrome under `~/.locus/host-chrome/<session>` (Browser tab) by default. **Use my Chrome** (Settings → Chrome + per-agent toggle) drives the operator's real tabs via `apps/chrome-extension`. |

The Cowork gap is the missing **Browser** tab: one live page, one URL bar, one tab strip, one pointer — agent and operator sharing the same isolated profile.

```
You chat  →  Locus  →  Guest Chromium (isolated profile)
                 │
                 ├── agent tools (CDP Input, tabs, snapshot)
                 └── live pane  (screencast + optional operator input)
```

You describe a research / login / QA task. The right pane shows the page loading. The agent's cursor moves. You type the 2FA code yourself. You hand it back. The agent keeps going.

## Product shape

Chat stays on the left. The right pane gains **Browser** next to **Files** and **Preview**.

```
┌──────────── chat ────────────┬──────────── workspace ────────────┐
│  "Log into staging and       │  [Files] [Preview] [Browser]      │
│   dump the billing table"    │  ┌ https://staging.example/login ┐│
│                              │  │  tab 1  ·  tab 2              ││
│  ● browser_navigate          │  │                               ││
│  ● type_text  (agent)        │  │     live page + agent cursor  ││
│                              │  │                               ││
│  [Take over]  [Hand back]    │  │  Agent  ·  You can take over  ││
└──────────────────────────────┴───────────────────────────────────┘
```

### What you see

- URL bar, lock/scheme, tab strip, reload, back. Locus chrome — not Chromium's own toolbar.
- Live JPEG/PNG frames of the active tab (CDP screencast). Not an iframe of the target site (that would put untrusted HTML in the Locus origin).
- Agent pointer overlay from the same `tool.overlay` events VM desktops already use, scaled to the Chromium viewport (1280×800 today, not `GUEST_SCREEN` 1920×1080).
- Status chip: **Agent** or **You**. While the agent is clicking, the chip says what it is doing (`click`, `type`, `navigate`).
- Opening a URL (agent `exec https://…`, `browser_tabs` new, or the URL bar) selects the Browser tab. Preview stays the local app iframe.

### What you can do

- Watch without interrupting (default).
- **Take over the browser** — click, scroll, type, paste, switch tabs, edit the URL. The agent may keep editing `/workspace`; it cannot Input the page until you hand back.
- **Hand back** — agent continues the same turn / next turn with the page you left.
- Complete logins, CAPTCHAs, and 2FA yourself. Keystrokes in takeover do not appear in the transcript.
- Steer in chat ("that's the wrong account, use the other tab") the same way you already steer mid-turn.

This is **not** today's VM **Takeover**, which aborts the whole chat and parks the guest. Browser takeover is a lock on the CDP Input domain only.

### What the agent can do

Keep the existing CDP tools. Add a few that match a shared pane:

| Tool | Role |
| --- | --- |
| `browser_navigate` | First-class open/goto. Stop teaching `exec https://…`. |
| `browser_tabs` | Already exists. Drive the same tab strip the operator sees. |
| `browser_snapshot` | Accessibility tree of the active tab (refs the agent can click). Prefer this over pixel-guessing. |
| `screenshot` / mouse / key / `type_text` | Fallback when the tree is empty (canvas, maps). Overlay still paints. |
| `browser_console` / `browser_network` / `browser_pdf` / `browser_trace` / `browser_download` | Unchanged. Downloads also list in the pane. |

Vision still means "send pixels to the model." The live pane is for **you**. Do not stream screencast frames into the prompt.

## Non-goals (all slices)

- Embedding the public web in an Electron `BrowserView` / `<webview>` / iframe of `https://…`. Untrusted pages must not share the control-plane origin or the operator's Electron partition.
- Driving the operator's real Chrome profile or cookies.
- Replacing Preview (local app iframe + Comment + Desktop/Tablet/Phone).
- Replacing VM noVNC (full desktop QA, installers, native apps).
- Host-runtime headed Chrome in v1 (the Host exception stays files + shell).
- Worker Preview-style tunnels in v1. Worker guests already run CDP tools; the live pane stays on local Docker until a later slice.
- Sending live frames to the model, Playwright MCP, or a second Chromium besides the guest's.
- A Locus-wide browser (sidebar icon like Slack). This is per-agent, like Files / Preview.

## Current seams

```
exec https://… / start_process URL
  DockerGuestRuntime → CdpChromiumDriver.navigate
    ensure() starts Xvfb + Chromium --remote-debugging-port=9222
    listenGuestLoopbackTunnel(container, 9222)   // docker exec stdio relay, loopback only

screenshot / mouse_* / key / type_text / browser_*
  same driver, CDP Input / Target / Page / Tracing

Preview
  SessionService polls guest ports → GET /api/sessions/:id/preview (status)
  iframe /api/sessions/:id/preview-http/:port
  operator Comment via postMessage (design-pick)

VM display
  /ws/display/:vmId → noVNC
  session.control = "human"  // takeover aborts chat

tool.overlay
  mouse/key/type → DesktopOverlay on the VNC surface only
```

Missing: a WebSocket of **page frames**, a Browser tab, a `browserControl` lock that does not abort the loop, and overlay coordinates that match 1280×800.

## Target architecture

Keep Chromium **in the guest**. The control plane already owns CDP. The desktop only renders a stream and, when you have the lock, forwards input.

```
Renderer (Browser pane)
  WS /ws/browser/:sessionId     loopback, Origin-checked, phone token if remote
        │
        ▼
SessionService.browserHub
  start/stop Page.startScreencast when a viewer is connected
  Target.getTargets → tab strip
  Input.* only if session.browserControl === "human"
        │
        ▼
CdpChromiumDriver (existing tunnel)
  guest Chromium  user-data-dir = session profile (not /tmp forever)
```

Narrow WS protocol. Do **not** expose raw CDP to the UI (a compromised renderer could then drive the guest).

```
server → client
  frame     { mime, data, metadata: { offsetTop, deviceWidth, deviceHeight, pageScaleFactor } }
  tabs      { tabs: [{ targetId, url, title, active }] }
  status    { controller: "agent" | "operator", activity?: string }

client → server   (ignored unless controller is operator, except subscribe)
  navigate  { url }
  tab       { action: "new" | "close" | "select", targetId?, url? }
  input     { kind: "mouseMoved" | "mousePressed" | "mouseReleased" | "mouseWheel" | "keyDown" | "keyUp" | "insertText", … }
  takeover  / handback
```

Pause screencast when the Browser tab is hidden. Stream 2× JPEG (quality 90) so the pane stays sharp; `screenshot` stays the still for Vision.

### Two locks

| Lock | Field | Effect |
| --- | --- | --- |
| Guest takeover | `session.control === "human"` | Today's VM/Docker takeover: abort chat, operator owns the guest. |
| Browser takeover | `session.browserControl === "human"` | Park CDP Input from the agent. File/git/exec continue. Operator owns the page. |

If both are human, the operator owns everything. Handback of the browser alone resumes agent Input.

While `browserControl` is human, agent `mouse_*` / `key` / `type_text` / `browser_navigate` / `browser_tabs` (mutating) return a short error: `Operator has the browser. Wait for handback.` Snapshot, console, network, screenshot stay allowed so the model can still *see*.

### Profile and network

| Concern | Today | Plan |
| --- | --- | --- |
| Profile | `/workspace/.locus-chrome` on the bind-mount | Persist under the session disk. Wipe on session delete. Do not share across agents. |
| Downloads | `/tmp/locus-downloads` + artifacts | Unchanged path; Browser pane lists `browser_download` the way Host share lists files. |
| Egress | Guest network jail (open / restricted / none) | Unchanged. Chromium still goes through the guest proxy. Restricted jail: navigating off the allowlist fails in-page; log `egress` as today. Do not punch a hole for the pane. |
| websearch toggle | Host search, jail bypass | Unrelated. Browser is guest traffic. A later optional gate: "this agent may open the public web" defaulting to on for Docker, off when jail is `none`. |
| Untrusted pages | `browser_console` / `browser_network` already hostile-wrapped | Same wrapping for snapshot text and page titles in tool output. |

### Why not the obvious alternatives

| Approach | Why not (v1) |
| --- | --- |
| Electron BrowserView as the agent browser | Shares the app process/partition; skips the guest jail; cookies land on the host. Electron is already sandboxed for the Locus UI, not for Cowork browsing. |
| `<iframe src="https://…">` | Cross-origin, no CDP, no real tabs, click-jacking against the chrome, and the page would be mixed into the UI origin policy. |
| noVNC of Docker Xvfb | Works, but you would see Chromium chrome inside Locus chrome, fight 1280×800 vs 1920×1080 overlays, and pay for a second display stack. Keep VNC for VMs. |
| Playwright MCP | Second catalog next to tools we already have. Snapshot/click-by-ref can be CDP `Accessibility.getFullAXTree` on this driver. |
| Stream frames to the model | Burns tokens, duplicates Vision, and is not how Cowork feels. The human watches; the model calls `browser_snapshot` / `screenshot`. |

## PR sequence

Ship as sequential PRs. Stop when the pane is usable. Do not start with Host or workers.

### PR 1 — Live view (watch the agent)

Smallest Cowork slice: you can **see** the same Chromium the agent already uses.

**Behavior**

- New Docker workspace tab **Browser**, always present once the guest is ready (blank `about:blank` until something navigates).
- `GET/WS /ws/browser/:sessionId` streams screencast frames + tab list + current URL.
- Auto-select Browser when the agent navigates or uses a browser tool. Do not steal focus from Files if the operator just switched away in this turn (sticky: first navigation this turn only, or a `browser.opened` once).
- Draw `tool.overlay` on the Browser canvas. Scale with Chromium viewport (read `deviceWidth`/`deviceHeight` from screencast metadata, default 1280×800). Stop using `GUEST_SCREEN` 1920×1080 for Docker.
- No operator input yet. URL bar is read-only. Chip: **Agent**.
- Hidden tab stops screencast.

**Files**

| File | Change |
| --- | --- |
| `packages/guest-agent/src/chromium.ts` | `startScreencast` / `stopScreencast`, `listTabs()` structured, viewport size helper |
| `packages/guest-agent/src/chromium.test.ts` | Fake CDP: screencast start sends a frame; list tabs parses `/json/list` |
| `packages/shared/src/models/session.ts` | Optional `browser?: { url, tabs, viewport }` snapshot for UI reload |
| `packages/shared/src/protocol/events.ts` | `browser.tabs` / `browser.status` if not only-WS |
| `apps/server/src/app.ts` + sockets | `/ws/browser/:sessionId`, same auth as `/ws/display` |
| `apps/server/src/session/sessions.ts` | Subscribe/unsubscribe screencast with viewer count |
| `apps/desktop/src/components/guest/BrowserPane.tsx` | New. Canvas + URL + tabs |
| `apps/desktop/src/components/docker/DockerWorkspace.tsx` | Files / Preview / **Browser** |
| `apps/desktop/src/lib/api.ts` | `browserWsUrl(sessionId)` |
| `packages/shared/src/models/tools.ts` | Overlay scaling note or `GUEST_SCREEN` per runtime |
| `apps/desktop/src/components/layout/DesktopOverlay.tsx` | Accept viewport size |

**Tests (write first)**

1. `CdpChromiumDriver` startScreencast issues `Page.startScreencast` and stop disables it.
2. Socket: missing session → 404; loopback Origin accepted (copy display WS tests in `apps/server/src/core/sockets.test.ts`).
3. DockerWorkspace shows a Browser tab when the guest is ready, even with no preview port.
4. Overlay at (640, 400) on 1280×800 is 50%/50%, not 640/1920.
5. Existing chromium screenshot/click tests still pass.

**Verify**

```bash
npm test --workspace=@locus/guest-agent --workspace=@locus/server --workspace=@locus/desktop --workspace=@locus/shared
npm run typecheck
```

Manual: Docker agent, `/webqa` or `exec https://example.com`, open Browser, see the page and a click ring.

**Done when**

- Operator can watch guest Chromium without VNC.
- Preview and Files are unchanged.
- No raw CDP in the renderer.
- Screencast does not run with zero viewers.

### PR 2 — Operator input (Cowork takeover)

You can use the same page.

**Behavior**

- **Take over** / **Hand back** on the Browser toolbar (and `/` slash if it stays cheap). Does **not** call `abortChat`.
- `session.browserControl`: `"human"` | unset. Broadcast `browser.status`.
- Operator mouse/keyboard on the canvas → CDP Input, coordinates mapped through screencast metadata (device pixels vs CSS).
- URL bar and tab strip become editable in takeover.
- Agent mutating browser tools fail with the operator-has-the-browser message; snapshot/screenshot/console still work.
- Slash `/takeover` remains the heavy guest takeover. Name the new control **Take over browser** so they do not collide.

**Files**

| File | Change |
| --- | --- |
| `packages/shared/src/models/session.ts` | `browserControl?: "human"` |
| `apps/server/src/session/sessions.ts` | `takeoverBrowser` / `handbackBrowser`; gate Input in `executeTool` |
| `apps/server/src/app.ts` | `POST /api/sessions/:id/browser/takeover` and `…/handback` |
| `packages/guest-agent/src/chromium.ts` | `dispatchInput` from WS events |
| `apps/desktop/src/components/guest/BrowserPane.tsx` | Pointer capture, caret, takeover buttons |
| `apps/desktop/src/components/layout/Topbar.tsx` | Do not reuse the VM takeover button |
| `apps/cli/src/commands.ts` | `locus agent browser-takeover` / `browser-handback` |
| `packages/providers/src/prompt.ts` | One line: operator may be driving the same Chromium |

**Tests**

1. Takeover sets `browserControl`, does not change `session.control`, does not abort a running file tool.
2. `mouse_click` during takeover returns the parked message; `browser_console` still runs.
3. Handback clears the lock; next `mouse_click` succeeds.
4. WS `input` while controller is agent is ignored.
5. Coordinate mapping: click at canvas 50%,50% with deviceWidth 1280 → Input (640, 400).

**Done when**

- You can finish a login the agent opened.
- The agent does not type over you.
- Guest `/takeover` still aborts chat for VM/desktop.

### PR 3 — Tools that match the pane

Stop making the model `exec` URLs and guess pixels when a tree exists.

**Behavior**

- Add `browser_navigate { url }` (and maybe `wait: "load"|"idle"`). Keep URL-shaped `exec` as an alias to navigate so old prompts do not break.
- Add `browser_snapshot` → CDP accessibility tree, truncated (~8k), refs like `@e12`. Add `browser_click { ref }` / `browser_type { ref, text }` that resolve refs from the last snapshot.
- Prompt: prefer snapshot+ref; screenshot+xy for canvases; the operator sees the same tab.
- `web-qa` recipe: mention the shared pane and takeover, not only "exec a URL".
- Wrap snapshot strings as hostile untrusted data.

**Files**

| File | Change |
| --- | --- |
| `packages/shared/src/models/tools.ts` | New names, schemas, `DOCKER_TOOLS` |
| `packages/shared/src/untrusted.ts` | `browser_snapshot` hostile |
| `packages/guest-agent/src/chromium.ts` | AX tree + ref hit test |
| `packages/guest-agent/src/index.test.ts` | Ubuntu supports the new tools; Windows does not |
| `packages/providers/src/prompt.ts` | Docker paragraph |
| `packages/shared/src/models/recipes.ts` | `web-qa` copy |
| `packages/guest-agent/src/mock.ts` | Snapshot fixture for mock Docker |

**Tests**

1. Snapshot of a fixture DOM includes a button name and a ref; `browser_click` that ref dispatches a click (CDP fake).
2. `exec https://example.com` still calls `navigate`.
3. `parseToolAllowlist` / host runtime still omit browser tools.
4. Hostile wrap: snapshot output contains `<untrusted-data`.

**Done when**

- Web QA can click by name in tests without a screenshot round-trip.
- Pixel tools still exist.

### PR 4 — Profile, downloads, jail copy (implemented)

Chromium `--user-data-dir` is `/workspace/.locus-chrome` on the bind-mount. Workspace listing, `repo_map`, ripgrep, and `git_status` skip that directory (same as `node_modules`). The Browser toolbar lists `/tmp/locus-downloads` and opens a file as a session artifact. Restricted jail paints a **Blocked host** chip when the active URL is off the CONNECT allowlist. Session delete removes `.locus-chrome`. Jail `none` still shows the pane (localhost only).

**Tests**

1. Ensure-browser script contains the workspace profile path, not `/tmp/locus-chrome`.
2. `repo_map` / workspace walk skips `.locus-chrome`.
3. Session delete removes the profile directory.

### PR 5 — Later placements (optional)

Only after local Docker is good.

| Placement | What to do |
| --- | --- |
| **LAN / cloud worker** | **Done.** Worker already executes browser tools. Screencast, tabs, and operator input proxy over the pinned worker HTTPS WebSocket (`GET /v1/guests/:id/browser`). Desktop still talks to laptop `/ws/browser/:sessionId`; the laptop fans out. Downloads use tools HTTP so artifacts land on this machine. |
| **VM** | Do not CDP-stream the whole desktop. Optional: if guest Chromium is running with 9222, offer a Browser tab *or* keep telling people to use VNC. Prefer VNC for installer QA. |
| **Host** | Isolated Playwright/Chromium under `~/.locus/host-chrome/<session>` with no default profile. Same WS. **Use my Chrome** is a second opt-in: unpacked MV3 extension + vaulted `cx_` token + per-agent `liveChrome`. Treat like host MCP: documented security exception. Not default. |
| **Phone** | **Done.** Same `/ws/browser` + pairing token as display. The phone shell **Open browser** control streams frames and can Take over / Hand back for logins. |

## Security

Same walls as the rest of Locus. New ones:

1. **Guest isolation.** The page runs in guest Chromium, not in Electron. The pane is pixels + chrome.
2. **Narrow WS.** Renderer cannot `Runtime.evaluate` or read cookies. Cookies stay in the guest profile.
3. **Loopback / Origin / phone token.** Copy `/ws/display`.
4. **Jail.** No extra egress for the pane. Restricted CONNECT logs already exist.
5. **Prompt injection.** Snapshot, titles, console, network stay `<untrusted-data>`. Operator-typed passwords never enter chat.
6. **Takeover is loud.** Chip + event. Direct pane clicks are operator actions (same rule as guest-pane tools: no chat approval).
7. **Profile hygiene.** Per-session directory, deleted with the session. Do not reuse across agents (no "Locus Google login" shared jar).
8. **Vision.** Live frames stay on loopback. Only `screenshot` / Vision-on stills go to the provider.

Update [SECURITY.md](../SECURITY.md) when PR 1 ships, not in this plan.

## Explicitly do not do

- Ship an iframe of the public web as "the browser."
- Put CDP on `0.0.0.0` in the container (today's tunnel is loopback + docker exec for a reason).
- Abort the agent turn when the operator types in the Browser pane.
- Stream screencast into the model.
- Share one Chrome profile across sessions or with the host user.
- Build a global Browser icon on the rail (Slack/Codebase-style) in this project.
- Block PR 1 on snapshot-by-ref, workers, or host Chrome.

## Suggested first commit (inside PR 1)

Failing tests: Browser tab renders for a ready Docker session; overlay math uses 1280×800; WS route exists. Then `Page.startScreencast` on the existing driver + `BrowserPane` canvas. That is a reviewable Cowork slice: you can see the agent. Input is PR 2.
