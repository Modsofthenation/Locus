import {
  INTEGRATION_TOOL_NAMES,
  READ_SKILL_NAME,
  WEBSEARCH_TOOL_NAME,
  isWorkflowToolName,
  sessionRuntime,
  toolsForRuntime,
  type AgentSession,
} from "@locus/shared";

/** Tools a workflow may call for this session. Workflow control tools are omitted. */
export function sessionWorkflowCatalog(session: AgentSession, extra: string[] = []): string[] {
  const names = new Set<string>([
    ...toolsForRuntime(session.os, sessionRuntime(session)).map((tool) => tool.name),
    ...INTEGRATION_TOOL_NAMES,
    WEBSEARCH_TOOL_NAME,
    READ_SKILL_NAME,
    "preview",
    "playwright",
    ...extra,
  ]);
  for (const name of [...names]) {
    if (isWorkflowToolName(name)) names.delete(name);
  }
  if (!session.allowedTools?.length) return [...names];
  const allow = new Set(session.allowedTools);
  return [...names].filter((name) => allow.has(name));
}
