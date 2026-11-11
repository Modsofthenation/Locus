/**
 * Copy for the Agents new-agent screen. The Appearance theme preview renders from the
 * same strings so it never drifts from the real screen.
 */
export const NEW_AGENT_COPY = {
  heading: "What should the agent do?",
  lead: "Choose how it runs, then the folder it can touch.",
  placeholder: "Describe the task…",
  /** VM runtime with several guest OSes on offer. */
  placeholderPickOs: "Describe the task, then pick an OS…",
  send: "Send",
  moreOptions: "More options",
} as const;

/** Accessible name for the in-composer Send on the new-agent screen. */
export function newAgentSendLabel(opts: { hubMode?: boolean; hostChat?: boolean }): string {
  if (opts.hubMode) return "Create teammate";
  return opts.hostChat ? "Start chat" : "Create agent";
}
