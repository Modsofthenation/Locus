# Locus for Android

A thin WebView client that remote-controls the Locus desktop app on your computer. After pairing it loads the **phone shell** (chats, Slack, approvals, Design preview + comments, Codebase PR review, and Docker Browser takeover) from port 7420 — this app does not run agents on the phone.

## Pair

1. On the desktop: Settings → Phone → **Enable phone remote**.
2. Restart Locus so it listens on the LAN (`0.0.0.0:7420`).
3. On the phone, scan the QR code from Settings → Phone, or enter the computer’s LAN or Tailscale address (or `*.ts.net` MagicDNS name), port **7420**, and the pairing token. Public internet hosts are rejected.
4. **Connect**. The app loads `https://<host>:7420/?token=…` and pins the cert fingerprint from the QR (`fp=`). The page stores the token (and a session cookie when the WebView keeps it) and sends it on later API and WebSocket requests. The WebView stays on that host.

Anyone on the LAN with that token can steer Locus. Rotate the token if the phone is lost. Do not Funnel or port-forward 7420 to the public internet.

## Build

Needs Android Studio (SDK 35, min 26) and JDK 17.

```bash
cd apps/android
./gradlew assembleDebug
```

The APK lands at `app/build/outputs/apk/debug/app-debug.apk`. CI on `main` and pull requests runs the same `assembleDebug` job (JDK 17, SDK 35, no emulator).

Cleartext HTTP remains allowed so a browser bookmark to `http://<lan-ip>:7420` still works. The Android app pairs over HTTPS and pins the control-plane certificate fingerprint from the QR code.
