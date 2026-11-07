# `@locus/server`

Loopback control plane. Hono HTTP API, WebSocket hub, agent sessions, automations, forge catalog, and Slack gateway.

```bash
npm run dev --workspace=@locus/server   # tsx watch, http://127.0.0.1:7420
npm test --workspace=@locus/server
```

Entry: `src/index.ts`. HTTP composition: `src/app.ts`. Layout is documented in [docs/architecture.md](../../docs/architecture.md).

Do not bind off loopback. Tests cover non-local `Origin` rejection.
