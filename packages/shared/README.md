# `@locus/shared`

Types and pure helpers shared by the apps and other packages. No Node I/O, no HTTP server.

```bash
npm test --workspace=@locus/shared
```

Public surface is `src/index.ts`. Domain models live in `src/models/`. Protocol events are in `src/protocol/`. Windows CLI spawn is a separate export (`@locus/shared/windowsCliSpawn`) so the Vite renderer barrel does not pull it in.
