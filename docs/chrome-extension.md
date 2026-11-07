# Chrome extension (Use my Chrome)

Opt-in Host-agent control of the Chrome (or Edge) tabs already open on this machine — the same idea as Claude in Chrome.

Isolated `~/.locus/host-chrome/<session>` stays the default. Live Chrome is a **dual opt-in**: pair the extension once, then turn on **Use my Chrome** for that Host agent.

This is a security exception. The extension talks only to the Locus control plane on loopback (`ws://127.0.0.1:7420/ws/chrome-extension`) with a vaulted pairing token. It never talks to a public Locus server.

## Pair

1. Settings → Chrome → **Enable Chrome extension** (or `locus config chrome enable`).
2. Chrome → `chrome://extensions` → Developer mode → **Load unpacked**.
3. Pick `~/.locus/chrome-extension` (Locus copies the unpacked files there on boot). A clone can also load `apps/chrome-extension`.
4. Open the extension popup, paste the pairing token, Connect.

Microsoft Edge works the same from `edge://extensions`. Rotate the token from Settings or `locus config chrome rotate`.

## Per-agent opt-in

On a **Host** agent on this machine (not a worker):

- New agent → **Use my Chrome**
- Agent settings → **Use my Chrome**
- Composer **Use my Chrome** / `/chrome`
- `locus agent new "…" --runtime host --live-chrome`

Workers and Docker/VM agents ignore `liveChrome` and keep isolated Chromium.

## What host agents can do

With the extension connected and Use my Chrome on:

- List / open / close / select tabs
- Navigate http(s) URLs
- Accessibility-style snapshot, click-by-ref, type-by-ref
- Screenshot the visible tab
- Mouse, key, and type on the page

`chrome://`, `edge://`, `about:`, and extension pages are refused. PDF, trace, and download tools stay on isolated host-chrome.

The Browser pane shows a **Your Chrome** chip and the same live tabs. A yellow **Locus is using this tab** bar appears on the page while the agent is attached. Take over / Hand back still parks mutating browser tools.

## Threat model

Anyone who can load the unpacked extension **and** has the pairing token can drive the operator's real Chrome tabs (cookies and logins included) from a Host agent that opted in. Treat the token like a session cookie. The websocket is loopback-only. Minting, rotating, and revealing the token stays on the desktop operator. Rotate it if a machine is shared or the extension is uninstalled.
