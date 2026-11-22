# Code intelligence for agents

Agents get the same language servers the desktop editor uses (the TypeScript language service, pylsp, gopls, rust-analyzer, jdtls), exposed as five tools. They complement `grep` and `repo_map`: use them to follow a symbol through imports, list its real call sites (not same-named strings), and rename it everywhere in one call.

| Tool | Arguments | Returns |
| --- | --- | --- |
| `code_definition` | `path, line, column` or `symbol` (+ optional `path`) | Definition location(s), type/signature, a 6-line snippet |
| `code_references` | same, plus `limit?` (default 50, max 200) | References grouped by file with `line:column` and the line text |
| `code_symbols` | `query?`, `path?` | With `path`: the file outline. With `query`: matching workspace symbols |
| `code_diagnostics` | `paths?` (max 24) | Errors and warnings, errors first; without `paths`, the git dirty set |
| `code_rename` | `path, line, column` or `symbol`, `newName` | Edits files on disk; per-file summary plus a unified diff |

## Positions and symbols

- `line` and `column` are **1-based** in the tool API and converted to the servers' 0-based positions. Numeric strings are accepted.
- `symbol` can replace the position. With `path` it is looked up in that file's outline (falling back to the first whole-word match); with `path` + `line` it is found on that line; alone it is resolved through workspace symbols (TS language service plus the repo symbol index for other languages). `Class.method` narrows by container.
- An ambiguous symbol fails with the candidate list (`- Store.load util.ts:6`) so the model can retry with a path.

## Backends

Dispatch is by extension: `.ts/.tsx/.js/.jsx/.mjs/.cjs/.mts/.cts` (TypeScript, bundled), `.py/.pyi` (pylsp), `.go` (gopls), `.rs` (rust-analyzer), `.java` (jdtls). When a server is not installed the tool returns an actionable message such as `gopls not found (go install golang.org/x/tools/gopls@latest, or set LOCUS_GOPLS) … use grep / file_read instead`; it never throws. Each call is time-boxed (20 s); a slow first index returns a retry hint. `code_rename` supports TS/JS and Python; for Go/Rust/Java it points at `code_references` + `apply_patch`.

## Where the tools run

The tools run on the control plane against `workspaceRoot(session)`: the host folder, the Docker bind mount, or the VM / worker mirror. Reads work everywhere a root exists. `code_rename` writes the host copy, so it is only offered and allowed on Host and Docker sessions that are not on a worker; VM and worker sessions get a refusal that suggests `code_references` + `apply_patch`, because writes there must go through the guest.

## Harness wiring

- **Read tools** (`definition`, `references`, `symbols`, `diagnostics`) are runtime tools: plan mode, explore/review sub-agents, and `REVIEW_TOOLS` include them; they are parallel-safe and count as workspace-search rounds for the coding / ops / review wander nudges, never as edits.
- **`code_rename`** is a mutate like `apply_patch`: refused in plan mode and review sessions, on the Supervised always-ask list, unavailable when the session allowlist has no `apply_patch`, counted by the coding verify loop (tests must run after it), recorded in the file-undo log, and then settled as an `apply_patch` of its diff, so the repo index, `npm run lint` feedback, `PostToolUse` hooks (matcher `apply_patch`) and post-edit diagnostics all run. Turn checkpoints already cover the disk change. The workspace-changes panel and editor follow read the diff from the tool result.
- Arguments are validated against the advertised schema at execute time (harness rule 5).

## Post-edit diagnostics

After a successful `file_write`, `apply_patch` or `code_rename` on a supported file, new **errors** (not warnings) in the touched files are appended to the tool result, capped at 10 lines, with a 3 s budget (skipped on timeout). An error already reported for that file is not repeated; instead the note says how many earlier errors are still present. Only servers that are already known to work are used (TypeScript always; pylsp after a successful probe; gopls/rust-analyzer/jdtls when on `PATH`), so an edit never pays for spawning a missing server. Push-based servers (pylsp, gopls, …) are re-read once after a short wait and can lag by one edit.

Turn it off with Settings → Advanced → **Post-edit diagnostics**, or `advanced.postEditDiagnostics: false` in config. It runs only on Host and Docker sessions (not worker or VM mirrors, which may lag the guest) and not on canvas sessions.

## Code

- `packages/shared/src/models/codeIntel.ts`: tool definitions, argument parsing (1-based → 0-based), symbol picking, formatting, rename diff, rename refusal.
- `apps/server/src/workspace/agentCodeIntel.ts`: backends, availability checks, timeouts, rename writes, post-edit diagnostics.
- `apps/server/src/workspace/workspaceComplete.ts`: `outlineWorkspaceFile` (TS navigation tree) next to the existing editor helpers.
- `apps/server/src/session/sessions.ts`: `executeCodeIntelTool` (runtime-tool dispatch) and the post-edit call in `settleExecutedTool`.
