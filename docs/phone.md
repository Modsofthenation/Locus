# Phone remote

Opt-in remote control of the Locus **desktop control plane** from an Android phone (or any browser) on the same LAN or Tailscale network.

This is not a hosted Locus. Agents, keys, and approvals still run on the computer. The phone is another window onto `7420`.

## What it does

1. Settings → Phone → **Enable phone remote** mints a pairing token (vaulted, not written to `config.json`).
2. Restart Locus. While enabled, the control plane binds `0.0.0.0` instead of loopback.
3. Non-loopback clients must present the token (`Authorization: Bearer`, cookie `locus_phone`, or `?token=` on the first UI load) for `/api` and `/ws`. Public internet peers are rejected even with a token. The desktop UI shell (HTML/JS/CSS) is served to LAN clients so Android Chrome can load the app even when it drops the pairing cookie on HTTP IP origins. Pairing, rotate, and token reveal stay on the loopback operator.
4. Open the Locus Android app (`apps/android`), scan the **QR code** on Settings → Phone, or open `https://<lan-ip>:7420/?token=…&fp=…` on the phone. The QR prefers HTTPS and pins the self-signed cert fingerprint. The page keeps the token (the address bar is cleaned after load) and sends it on API and WebSocket requests. The app only loads RFC1918 / Tailscale addresses (including MagicDNS). Pairing opens a **phone shell**: **Agents** (status dots, All / Needs you / Running / Unseen), Slack (read and send as you or as Locus), a large composer, a **Needs you** inbox for Approve / Deny (including Approve all / Deny all across chats) plus Design comments and PR review, **Design** canvases (comment and Promote into a Docker agent), a **Code** PR inbox (reply / approve / request changes / merge, plus a compact Change Stack from GET), a **Files** tab on Docker chats, and **Open browser** on Docker chats (Take over / Hand back for logins). **More** lists Games, Assets, Boards, Projects, Grafana explorer, Automations (pause / enable), **Settings**, **New automation**, **Command palette**, IDE workspaces (Open on desktop), and **Notifications** (Needs you / agent turns / Slack / automations and quiet hours); pairing status is read-only (token mint/rotate stays on the desktop). VM threads offer **view-only VNC** and **Find in chat**. Interactive VNC control stays on the desktop. Use **More → Use desktop layout** (or `?shell=desktop`) for the full chrome. `?shell=mobile` forces the phone shell when testing. Loopback clients (desktop, CLI, Vite) still talk **HTTP** on the same port.
5. Disable phone remote, then restart Locus, to bind loopback only again. The listen address is chosen at startup.

## 503 on the pairing URL

`https://<lan-ip>:7420/?token=…` reaching the phone at all means the control plane is up and listening on the LAN with the TLS mux. Loopback `http://127.0.0.1:7420` is unchanged. A **503** is the UI handler: 7420 has no desktop bundle and could not proxy Vite.

| What you ran | What the phone gets |
| --- | --- |
| Packaged Locus app, or `npm run app` after a desktop build | Static `apps/desktop/dist` (or the packaged `ui` extra resource) |
| `npm run dev` / `npm run dev:app` | Proxy to Vite on **5173**. Keep that process running |
| `locus serve` / `npm run dev:server` alone | 503 — no UI on this port |

If the HTML loads but the console shows `Failed to load resource: 503` for `/src/index.css` or `/src/main.tsx`, Vite was too slow on the first transform. Retry after Vite finishes optimizing; a current Locus build waits up to 30s for that proxy.

`locus serve` is CLI-only. For the phone, start the desktop (`npm run dev`, `npm run app`, or the installer) so 7420 can serve the same UI Electron uses.

## What it does not do

- Publish 7420 through Tailscale Funnel. Funnel stays `/api/hooks` only.
- Run Docker / QEMU / the vault on the phone.
- Replace the loopback bind in Settings → Advanced. That field is still loopback-only.

## Threat model

Anyone who can reach the LAN address **and** has the token can chat, approve tools, drive guest Chromium, and read sessions. Phone pairing uses HTTPS with a self-signed cert stored under `~/.locus/tls/`; the QR includes a SHA-256 fingerprint pin. They cannot mint, rotate, or read the pairing token — that stays on the desktop. Treat the token like a session cookie. Rotate it if a phone is lost. Disable phone remote and restart to return to loopback-only.
