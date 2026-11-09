# Changelog

## Unreleased

## 0.18.0 — 2026-11-09

Worker VMs with proxied displays and golden disks, Azure and GCP placement, Slack Approve, Windows guest CLIs, and Linux installers. Settings → About is **0.18.0**.

**Workers.** QEMU guests on a LAN or cloud worker stream the display to the laptop over a pinned WebSocket instead of treating worker loopback as local. Phone threads get a view-only pane; control stays on the desktop. Golden VM disks upload once to the worker and reuse. Azure Container Instances and Google Compute Engine sit next to Fargate for placement. Worker planes namespace guests under one token.

**Slack.** Posting and uploading from an agent can be approved with Slack action buttons. Forge writes still confirm in Locus.

**Guests.** Cursor, Claude, Codex, and Kiro spawn over SSH into Windows VMs via PowerShell. Linux guests stay POSIX.

**Desktop.** The composer Explore / Review chip matches neighboring controls. Opening the model menu no longer flashes above the trigger. A usage hint shows combined LLM and VM spend. Setup offers a first Host task from the empty Agents state. On the phone, More opens Settings, New automation, and the command palette; threads gain Find in chat.

**Coding CLIs.** Kiro CLI stream-json envelopes map into the chat thread instead of finishing with no reply, and duplicate tool chips are gone. A turn that already ran the project's tests is not flagged Needs you for a scratch write or a trailing delete-only cleanup. Codex keeps file-change details in the thread.

**Packaging.** Linux ships AppImage, deb, and rpm. The agent image is tagged with both a stable alias and this version. About → Download and verify checks SHA256SUMS before opening the installer.

## 0.17.0 — 2026-11-08

Quieter desktop shell, more guest runtimes, extra forges, and more reliable installer builds. Settings → About is **0.17.0**.

**Runtimes.** Dev Container files can define install, start, ports, and image when a Locus environment file is absent. Docker, Podman, and nerdctl are all valid container engines. Linux guests on Apple silicon use arm64 QEMU; Windows guests stay x86_64. Host coding CLIs can run over SSH inside a Linux VM. LAN workers can run QEMU guests (live display stays on the worker).

**Forges and subscriptions.** Gitea, Forgejo, and Azure DevOps can be added as forges. Subscribe also understands Linear, Jira, Sentry, Grafana alerts, incident.io, and pull URLs from those extra forges.

**Desktop.** Shared themed dialogs, empty states, shortcuts, undo toasts, and command-palette search. Failed actions surface in the notice stack with Retry. Confirm and prompt no longer use the browser’s native dialogs. The computer column stays collapsed until the agent opens a canvas.

**Packaging.** Linux, macOS, and Windows installer jobs prefetch Electron and packaging tools through the GitHub Releases API and retry failed fetches.

## 0.16.1 — 2026-11-08

First public release.
