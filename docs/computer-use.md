# Computer use

Host and Docker agents drive their shared Chromium. VM guests drive native applications through accessibility APIs and desktop input. The operator sees the same browser or VM desktop and can take over.

## Observe, act, verify

1. Call `computer_capabilities` before native desktop work. Live VM boots also record a best-effort report. Installed commands are not proof of permission to access the display, accessibility bus or input devices.
2. Use `browser_snapshot` for Chromium, `a11y_tree` for Linux applications, or `uia_tree` for Windows applications.
3. For web forms, use `browser_action` with `action=fill|select|check|invoke`, a fresh `ref`, and `value` or `checked`. Fill replaces the value; `browser_type` remains low-level typing. For native controls, use `desktop_action` with the ref and its exact observed `name`.
4. Verify the application outcome. Fill, selection and checkbox operations check control state. An invocation or dispatched click alone does not prove submission, saving or deployment. Use `browser_wait {text, timeout_ms}`, another snapshot, or independent file/application state.

Browser refs have a snapshot generation. Navigation, target changes and handback invalidate them. The driver checks document identity, element connectivity and click obstruction. Snapshots include role, name, relevant states and parent/frame metadata; large snapshots are bounded. Cross-origin embedded applications and custom canvases may still need screenshot/pixel interaction.

Chromium has an explicit active target. Listing targets does not silently select a popup. Select it with `browser_tabs`; tools and streaming move together. Navigation reports CDP errors and waits for document readiness. Use `browser_wait` for application-specific readiness; a loaded document is not necessarily a completed SPA workflow.

## Human control and recovery

Browser takeover supports Host and Docker agents, including workers, and leaves file/shell work available. Guest takeover aborts the turn and gives the operator the VM desktop.

Computer actions and observations share a session queue. A handoff drains the current action and invalidates older queued work. Browser input is released on handoff, focus loss and disconnect. Worker input and observation invalidation require acknowledgements; missing acknowledgements fail closed. Upgrade control plane and workers together.

After handback, the agent must take a fresh screenshot or accessibility snapshot before another computer action. After two consecutive failures it gets a recovery instruction; after three, actions pause until human takeover/handback. Observation remains available. Recovery counts failed tool outcomes; it cannot infer every visually ineffective click.

## Native backends

| Guest | Observation and actions | Input and clipboard |
| --- | --- | --- |
| Linux X11 | AT-SPI (`python3-pyatspi`) with identity, state, bounds and semantic actions | `xdotool`, `wmctrl`, `xclip`; `scrot` screenshots |
| Linux Wayland | The same AT-SPI interface for accessible applications | `wtype` keyboard/text, `ydotool` pointer, `wl-copy`/`wl-paste`; `grim` screenshots. Window list/focus uses `hyprctl` on Hyprland. |
| Windows | UI Automation RuntimeId refs, Value/SelectionItem/Toggle/Invoke patterns | Existing Windows input adapters, with normalized shortcut strings |

On Debian/Ubuntu, install `python3-pyatspi`, `python3-gi`, `at-spi2-core` and the display backend's commands. AT-SPI needs the interactive user's D-Bus session and applications that expose accessibility. `wtype` requires compositor support for virtual keyboard input; `ydotool` requires its daemon and input-device permission. Unsupported backends fail instead of silently injecting only into XWayland. Coordinates must match the guest desktop; monitor scaling and compositor policy need platform validation.

Windows SSH/WinRM normally runs outside the logged-in desktop. GUI commands use a bounded temporary Scheduled Task with the **same user's existing interactive token**, at Limited run level. No password, elevated token or unlocked secure desktop is created. The user must already be logged into the guest, and policy must permit the task. Tasks and temporary files are removed afterward. Secure desktop/UAC and locked sessions remain human takeover cases.

Host agents target Chrome rather than the operator's entire native desktop. Use a VM for native applications. The opt-in real-Chrome extension supports semantic actions and document-scoped refs, but its content-script input is synthetic. Shortcuts requiring trusted input need isolated Chrome or operator takeover; no Chrome debugger permission is added.

## External effects and approval

Mutation tools accept `effect=local|submit|upload|destructive`. Declare external effects before execution. Submissions, uploads and destructive effects require approval by default; a broad tool grant does not bypass that gate. An explicit grant such as `browser_action(effect:submit)` permits that effect.

**Use my Chrome** also asks before mutating browser tools by default, including clicks and keys. Sticky authorization and deny rules apply. For conservative approval on native or isolated-browser workflows, add these tools to `advanced.approvalPolicy.alwaysAsk`:

```json
["browser_action", "browser_click", "browser_type", "mouse_click", "mouse_drag", "key", "type_text", "desktop_action"]
```

Alternatively, set `advanced.approvalPolicy.confirmComputerActions=true` to require computer-action approval while retaining grants scoped to individual effects. An Always allow decision on an external effect saves that effect's scope, rather than a blanket tool grant.

Approval previews identify the tool, effect and target instead of an unrelated git diff. Takeover input is already an explicit human action.

Effect declarations are intent metadata, not a semantic firewall for arbitrary pixels. Use conservative tool gates when every interaction needs approval. Existing shell/MCP authority and guest isolation boundaries still apply. Page/application observations are wrapped as untrusted data.

## Regression tasks

Run unit/transport tests with `npm test`. Real browser tasks are opt-in:

```bash
LOCUS_COMPUTER_USE=1 CHROMIUM_BIN=chromium \
  LOCUS_COMPUTER_REPORT=/tmp/computer-use-report.json npm run test:computer
```

An isolated Chromium profile and local fixture server test delayed form validation, fill/select/check, Unicode and Ctrl+A, stale/obstructed refs, popup/tab/stream alignment, navigation failures and bounded waits. Reports record success, elapsed time and tool calls. These are deterministic tool regressions, not autonomous model benchmarks or model pass rates.

The native task fills a GTK/WinForms control, opens the native save dialog, activates Save, then independently verifies file contents. Run it in an isolated interactive desktop:

```bash
# Linux: python3-pyatspi, GTK 3, D-Bus and Xvfb must be installed.
dbus-run-session -- xvfb-run -a env LOCUS_NATIVE_DESKTOP=1 NO_AT_BRIDGE=0 npm run test:computer
```

On Windows, set `LOCUS_NATIVE_DESKTOP=1` and run `npm run test:computer` in a logged-in test VM. On Wayland, run the native task inside a test compositor session to validate AT-SPI there, then verify input with `wtype`/`ydotool` under that compositor's permissions. Windows and compositor-specific input require their actual platform; Linux CI does not establish that coverage.

The **Computer use** CI workflow runs Chromium and GTK tasks in a fresh D-Bus/Xvfb session and uploads the browser report. Fixtures stay local and do not access production accounts.
