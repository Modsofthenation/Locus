# `@locus/desktop`

Vite + React UI and the Electron shell. The renderer talks to `@locus/server` on `127.0.0.1:7420`.

```bash
npm run dev --workspace=@locus/desktop   # http://127.0.0.1:5173
npm run dist --workspace=@locus/desktop # installers via electron-builder
```

From the repo root, `npm run dev` runs server + Vite together. `npm run dev:app` also opens Electron.

| Path | Role |
|------|------|
| `src/` | Renderer (feature folders under `components/`) |
| `electron/` | Main process |
| `scripts/bundle-server.mjs` | Bundles the control plane into the packaged app |
| `test/` | Packaging tests |

Renderer imports use `@/` → `src/`.
