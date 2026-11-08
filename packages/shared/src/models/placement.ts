import type { AgentRuntime } from "./vm.js";

/** Where a guest is scheduled. Independent of Docker / VM / Host. */
export type AgentPlacement = "local" | "worker";

export const AGENT_PLACEMENTS: AgentPlacement[] = ["local", "worker"];

export function isAgentPlacement(value: unknown): value is AgentPlacement {
  return value === "local" || value === "worker";
}

export function parseAgentPlacement(
  value: unknown,
  fallback: AgentPlacement = "local",
): AgentPlacement {
  return isAgentPlacement(value) ? value : fallback;
}

export function sessionPlacement(session: { placement?: AgentPlacement }): AgentPlacement {
  return parseAgentPlacement(session.placement);
}

export function placementAllowsRuntime(placement: AgentPlacement, runtime: AgentRuntime): boolean {
  if (placement === "local") return true;
  return runtime === "docker" || runtime === "host" || runtime === "vm";
}

export const DEFAULT_WORKER_PORT = 7421;
export const WORKER_PROTOCOL = 1;
