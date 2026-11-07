# `@locus/providers`

LLM provider adapters (OpenAI-compatible, Anthropic, Cursor, Claude Code, Codex CLI, Kiro CLI) and the native `runAgentLoop`.

```bash
npm test --workspace=@locus/providers
```

The control plane owns approvals and guest tools. This package streams model tokens and decides the next tool call.

For local Codex CLI coding turns, the server supplies an invocation-only
`locus_git` MCP connection to the current session. Git branch, commit, fetch,
push, and PR operations use Locus's existing tool execution path and saved
forge credentials. Credentials are not copied into Codex configuration or
its shell environment. Push and PR operations retain the test gate, tool
allowlist, protected-branch rules, and operator approval policy.

The connection is available while a coding, Design/Games/Assets, or review turn is
active. Coding turns expose Git tools. Design/Games/Assets also enable `playwright`.
Review turns expose `git_pr_*` inspect tools in a read-only sandbox and do
not receive `git_push`. Plan turns do not receive the connection. Worker
Codex turns rewrite the URL onto the worker-loopback MCP proxy instead of
the laptop `127.0.0.1:7420` address.
Direct Codex shell commands remain sandboxed. A shell
`spawn EPERM` does not mean tests failed: report that validation limitation
and let the Locus push/PR test gate run the tests on the host. A failed gate
must be fixed before publishing. On Windows the gate resolves `npm.cmd`
through the shared Windows CLI launcher.

MCP URL, tool filtering, and timeouts follow the [official Codex MCP configuration](https://developers.openai.com/codex/mcp/).
