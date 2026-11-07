export const AGENT_ROLES = ["planner", "implementer", "reviewer"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export function isAgentRole(value: unknown): value is AgentRole {
  return value === "planner" || value === "implementer" || value === "reviewer";
}

export function nextAgentRole(role: AgentRole | undefined): AgentRole {
  if (role === "planner") return "implementer";
  if (role === "implementer") return "reviewer";
  return "planner";
}

export function rolePlaybook(role: AgentRole): string {
  if (role === "planner") {
    return "Role: planner. Do not edit files. Outline a short numbered plan, then stop.";
  }
  if (role === "reviewer") {
    return "Role: reviewer. Read the diff, flag bugs and missing tests, and do not push unless asked.";
  }
  return "Role: implementer. Execute the plan with tools. Prefer apply_patch and tests over rewriting files.";
}
