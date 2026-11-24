import type { ToolResult } from "@locus/guest-agent";
import { classifyGitFailure, shellGitAuthHint } from "@locus/shared";

const GIT_NETWORK_TOOLS = new Set(["git_clone", "git_fetch", "git_push", "git_branch"]);

/**
 * Give failed git tools a category and one remediation line, and point shell git that failed
 * for lack of forge credentials at the Locus git tools (shell git never has the token).
 */
export function annotateGitToolResult(name: string, result: ToolResult): ToolResult {
  if (GIT_NETWORK_TOOLS.has(name)) {
    if (result.ok || result.category) return result;
    const failure = classifyGitFailure(result.output);
    if (!failure) return result;
    return {
      ...result,
      category: failure.category,
      retryable: failure.retryable,
      output: `${result.output.trimEnd()}\n\nLocus: ${failure.hint}`,
    };
  }
  if (name === "exec" || name === "powershell") {
    const hint = shellGitAuthHint(result.output);
    if (!hint || result.output.includes(hint)) return result;
    return { ...result, output: `${result.output.trimEnd()}\n\n${hint}` };
  }
  return result;
}
