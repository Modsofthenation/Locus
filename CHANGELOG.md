# Changelog

## Unreleased

## 0.17.0 — 2026-11-08

Quieter desktop shell, more guest runtimes, extra forges, and more reliable installer builds. Settings → About is **0.17.0**.

**Runtimes.** Dev Container files can define install, start, ports, and image when a Locus environment file is absent. Docker, Podman, and nerdctl are all valid container engines. Linux guests on Apple silicon use arm64 QEMU; Windows guests stay x86_64. Host coding CLIs can run over SSH inside a Linux VM. LAN workers can run QEMU guests (live display stays on the worker).

**Forges and subscriptions.** Gitea, Forgejo, and Azure DevOps can be added as forges. Subscribe also understands Linear, Jira, Sentry, Grafana alerts, incident.io, and pull URLs from those extra forges.

**Desktop.** Shared themed dialogs, empty states, shortcuts, undo toasts, and command-palette search. Failed actions surface in the notice stack with Retry. Confirm and prompt no longer use the browser’s native dialogs. The computer column stays collapsed until the agent opens a canvas.

**Packaging.** Linux, macOS, and Windows installer jobs prefetch Electron and packaging tools through the GitHub Releases API and retry failed fetches.

## 0.16.1 — 2026-11-08

First public release.
