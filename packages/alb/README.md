# `@locus/alb`

Agent Loop Builder workflow runtime, built into Locus. Graphs, gates, templates, and pack import/export. The control plane stores documents under `~/.locus/workflows` and runs them inside a coding session.

```bash
npm test --workspace=@locus/alb
```

Operators use `locus workflow templates|add|import|run|resume`. Coding chats call `list_workflows` / `run_workflow` / `resume_workflow`. Tool nodes use that session's catalog and still wait for Approve / Deny.

CLI: [docs/cli.md](../../docs/cli.md#workflows).
