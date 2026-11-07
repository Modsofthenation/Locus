# Locus Chrome extension

Unpacked Manifest V3 extension so **Host** agents can drive the Chrome tabs you already have open — the same idea as Claude in Chrome.

This is a security exception. The extension talks only to the Locus control plane on loopback (`ws://127.0.0.1:7420/ws/chrome-extension`) with a vaulted pairing token. It never talks to a public Locus server.

## Install

1. Start Locus.
2. Settings → Chrome → **Enable Chrome extension**. Copy the pairing token.
3. Chrome → `chrome://extensions` → Developer mode → **Load unpacked**.
4. Pick this folder (`apps/chrome-extension` in a clone, or `~/.locus/chrome-extension` after Locus copies it).
5. Open the extension popup, paste the token, Connect.

Microsoft Edge works the same from `edge://extensions`.

## What host agents can do

With **Use my Chrome** on for a Host agent (New agent, agent settings, or `/chrome`):

- List / open / close / select tabs
- Navigate http(s) URLs
- Accessibility-style snapshot, click-by-ref, type-by-ref
- Screenshot the visible tab
- Mouse, key, and type on the page

`chrome://`, `edge://`, and extension pages are refused. Isolated `host-chrome` stays the default when Use my Chrome is off.

The Browser pane in Locus shows the same live tabs. A yellow **Locus is using this tab** bar appears on the page while the agent is attached. Take over / Hand back still parks agent input.
