# Public listing

This repository is the public GitHub listing for Locus. In-repo files (license, README, contributing, security, CoC, issue templates, changelog, unsigned macOS packaging) live on `main`. Remaining work is GitHub account and signing settings the workflow cannot change.

Check for updates, the OpenRouter app URL, and clone instructions read `LOCUS_GITHUB_OWNER` / `LOCUS_GITHUB_REPO` in `packages/shared/src/models/appRelease.ts` (`Modsofthenation/Locus`).

## GitHub repository settings

1. **Visibility.** Public.
2. **Private vulnerability reporting.** [SECURITY.md](../SECURITY.md) points reporters at GitHub advisories. Keep **Private vulnerability reporting** enabled.
3. **Topics.** Keep `ai-agents`, `qemu`, `docker`, `computer-use`, `electron`, `local-first`. Description should match the README tagline: **Local coding agents on your machine.**
4. **Wiki.** Off unless you plan to maintain it; README + `docs/` (see [docs/README.md](README.md)) is the source of truth.
5. **macOS / Windows identity.** Releases attach a dmg and `SHA256SUMS-macos`. Unsigned macOS builds need a right-click → Open the first time. Unsigned Windows NSIS shows SmartScreen. Optional: repo secrets `CSC_LINK` + `CSC_KEY_PASSWORD` (and Apple notarization later), plus a Windows Authenticode cert. Do not paste those into the tree.
6. **Screenshots.** Recapture `docs/screenshots/*.png` from current `main` (1440×900 desktop and 390×844 phone shell, Signal theme) when the chrome changes. Phone shots should show the **Agents** tab (not Chats). Include IDE start/workspace, Board empty/Kanban, Phone More → Boards, and Settings → Environments / Notifications. `settings_about.png` should show Settings → About (0.16.1, developer, MIT license) without a missing-release hint. Prefer a live Docker/QEMU status bar over **mock · mock Docker** for listing shots. Photographer notes (viewport, mock engines, Signal vs Ember) stay in this file, not in the README.
7. **README.** Lead with install from GitHub Releases. Keep runtime facts current (Host Chrome, worker Host, Docker = Linux containers not “Windows host unsupported”). Point operator depth at `docs/` and [SECURITY.md](../SECURITY.md) instead of duplicating those pages.

## Releases

- Confirm https://github.com/Modsofthenation/Locus/releases shows Linux, Windows, and macOS artifacts with checksums. Only the last three published releases are kept.
- Package installers from current `main` with **Actions → Package from main → Run workflow**. That uploads artifacts only. A GitHub Release is created when a `v*` tag is pushed.
- Do not `npm publish`; the packages stay `"private": true`. GitHub Releases are the distribution channel.
