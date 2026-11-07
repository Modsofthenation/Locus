import { COMPUTER_USE_TOOLS, TOOL_SCHEMAS, type ComputerUseToolName } from "@locus/shared";

const CLI_GIT_TOOLS = new Set<string>([
  "git_status",
  "git_diff",
  "git_log",
  "git_branch",
  "git_commit",
  "git_fetch",
  "git_push",
  "git_pr",
]);

export function isCliGitTool(name: string): name is ComputerUseToolName {
  return CLI_GIT_TOOLS.has(name);
}

export function cliGitMcpTools() {
  return COMPUTER_USE_TOOLS.filter((tool) => isCliGitTool(tool.name)).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: TOOL_SCHEMAS[tool.name],
  }));
}

export const CLI_GIT_INSTRUCTIONS = `Locus Git integration:
The locus_git MCP server is already connected for this turn. Use its git_branch, git_commit, git_fetch, git_push and git_pr tools for Git operations in this session's workspace. If asked whether the tools are accessible, call git_status to verify them; do not infer availability from plugin search or a guessed JavaScript API. Locus supplies saved forge credentials on the server and runs its test gate before push/PR. Paths in these tools are relative to /workspace; omit path for the primary checkout.
Some Codex CLI/model combinations fail to register a dynamically configured MCP function even though the server is connected. If a native locus_git call is unavailable, unregistered, or "not a function", do not stop or search for a plugin. Use the shell only as a transport to POST the same MCP tools/call JSON-RPC request to LOCUS_GIT_MCP_URL, then use the returned result. For PowerShell, use: $body = @{ jsonrpc="2.0"; id=1; method="tools/call"; params=@{ name="git_status"; arguments=@{} } } | ConvertTo-Json -Depth 20 -Compress; Invoke-RestMethod -Method Post -Uri $env:LOCUS_GIT_MCP_URL -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 20. For a POSIX shell, use: curl -fsS -X POST "$LOCUS_GIT_MCP_URL" -H "content-type: application/json" --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"git_status","arguments":{}}}'. Replace only the tool name and arguments for other listed Locus Git operations. This is an MCP transport fallback, not permission to run shell Git.
The native shell is sandboxed and does not inherit Locus forge credentials. Do not retry failed shell pushes, remove sandbox proxies, inspect credential stores, or create replacement Locus sessions to publish changes. If a Locus Git tool fails, report its specific error and address that cause. Do not claim a push or PR succeeded without its tool result.
If shell tests fail with spawn EPERM, report that validation limit; the Locus push/PR test gate runs on the host and must pass before publishing.`;

export const CLI_CANVAS_MCP_INSTRUCTIONS = `Locus canvas MCP:
The locus_git MCP server for this turn includes playwright against the live operator canvas. After a write, call playwright (click, then screenshot). Do not npm i Playwright or write spec files. If a native MCP call is unavailable, unregistered, or "not a function", POST tools/call JSON-RPC to LOCUS_GIT_MCP_URL with name "playwright". Git tools on the same server still go through Locus gates.`;

export const CLI_REVIEW_MCP_INSTRUCTIONS = `Locus review MCP:
The locus_git MCP server for this turn includes git_pr_get, git_pr_list, git_pr_loadpath, git_pr_comment, git_pr_review, and git_pr_checks. Inspect the PR with git_pr_get before a verdict. Do not guess PASS. If a native MCP call is unavailable, POST tools/call JSON-RPC to LOCUS_GIT_MCP_URL. This turn is inspect/comment only — do not git_push.`;

export function codexMcpPrompt(kind: "git" | "canvas" | "review"): string {
  if (kind === "canvas") return `${CLI_CANVAS_MCP_INSTRUCTIONS}\n\n${CLI_GIT_INSTRUCTIONS}`;
  if (kind === "review") return CLI_REVIEW_MCP_INSTRUCTIONS;
  return CLI_GIT_INSTRUCTIONS;
}
