<!--
Target `main`. Domain names: CONTEXT.md (Agent, Guest, Forge, Turn, …).
Do not include provider keys, forge tokens, guest passwords, or `~/.locus/secrets.enc`.
Guest escapes, token leaks, and unauthenticated control-plane access belong in a
private advisory: https://github.com/Modsofthenation/Locus/security/advisories/new
-->
## Summary
<!-- What changed and why. Link the issue. Call out any new host-side exception (MCP, Host agents, Use my Chrome, phone remote, workers) or managed-policy change. -->

## Test plan

Local (CI also runs these, then builds `@locus/desktop`, `locus/agent:0.1`, and the Android debug APK):

- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run format:check`
<!-- Name the path you actually exercised (control-plane test, UI, Docker / QEMU / Host, phone, worker). Prefer a failing test in `apps/server` or `packages/shared` when you change control-plane behavior. -->

## Checklist

- [ ] `CHANGELOG.md` Unreleased updated, or N/A (docs-only / internal)
- [ ] `SECURITY.md` or operator `docs/` updated if a trust boundary moved, or N/A
- [ ] No `~/.locus`, ISOs, qcow2 disks, API keys, or forge tokens
