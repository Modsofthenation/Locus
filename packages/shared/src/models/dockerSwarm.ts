import { dockerIdMatch, parseDockerContainerRef } from "./docker.js";
import type { ExtraToolDef } from "./mcp.js";

export const DOCKER_SWARM_STATES = ["inactive", "pending", "active", "error", "locked"] as const;
export type DockerSwarmState = (typeof DOCKER_SWARM_STATES)[number];

export const DOCKER_SWARM_TOOL_ACTIONS = [
  "status",
  "nodes",
  "services",
  "stacks",
  "logs",
  "scale",
] as const;
export type DockerSwarmToolAction = (typeof DOCKER_SWARM_TOOL_ACTIONS)[number];

export const DOCKER_SWARM_TOOL_NAME = "docker_swarm";
export const MAX_DOCKER_SWARM_REPLICAS = 256;

export interface DockerSwarmInfo {
  state: DockerSwarmState;
  controlAvailable: boolean;
  nodeId?: string;
  nodeAddr?: string;
  error?: string;
}

export interface DockerSwarmNode {
  id: string;
  hostname: string;
  status: string;
  availability: string;
  managerStatus?: string;
  engineVersion?: string;
}

export interface DockerSwarmService {
  id: string;
  name: string;
  image: string;
  mode: string;
  replicas: string;
  ports?: string;
}

export interface DockerSwarmStack {
  name: string;
  services: number;
  orchestrator?: string;
}

export interface DockerSwarmTask {
  id: string;
  name: string;
  image: string;
  node: string;
  desiredState: string;
  currentState: string;
  error?: string;
}

export interface DockerSwarmSnapshot {
  info: DockerSwarmInfo;
  nodes: DockerSwarmNode[];
  services: DockerSwarmService[];
  stacks: DockerSwarmStack[];
}

export interface DockerSwarmServiceDetail {
  service: DockerSwarmService;
  tasks: DockerSwarmTask[];
}

export const INACTIVE_DOCKER_SWARM: DockerSwarmSnapshot = {
  info: { state: "inactive", controlAvailable: false },
  nodes: [],
  services: [],
  stacks: [],
};

export function inactiveDockerSwarmSnapshot(): DockerSwarmSnapshot {
  return {
    info: { ...INACTIVE_DOCKER_SWARM.info },
    nodes: [],
    services: [],
    stacks: [],
  };
}

export function isDockerSwarmState(value: unknown): value is DockerSwarmState {
  return (DOCKER_SWARM_STATES as readonly string[]).includes(value as string);
}

export function isDockerSwarmToolAction(value: unknown): value is DockerSwarmToolAction {
  return (DOCKER_SWARM_TOOL_ACTIONS as readonly string[]).includes(value as string);
}

export function isDockerSwarmToolName(name: string): boolean {
  return name === DOCKER_SWARM_TOOL_NAME;
}

export function dockerSwarmActive(info: Pick<DockerSwarmInfo, "state">): boolean {
  return info.state === "active";
}

export function dockerSwarmManager(info: Pick<DockerSwarmInfo, "controlAvailable">): boolean {
  return info.controlAvailable === true;
}

export function parseDockerSwarmRef(raw: string): string | undefined {
  return parseDockerContainerRef(raw);
}

export function parseDockerSwarmReplicas(raw: unknown): number | undefined {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 0 || n > MAX_DOCKER_SWARM_REPLICAS) return undefined;
  return Math.floor(n);
}

export function parseDockerSwarmScaleBody(raw: unknown): number | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return parseDockerSwarmReplicas((raw as { replicas?: unknown }).replicas);
}

export function matchDockerSwarmService(row: DockerSwarmService, ref: string): boolean {
  if (row.name === ref || row.id === ref) return true;
  return dockerIdMatch(row.id, ref);
}

export function matchDockerSwarmNode(row: DockerSwarmNode, ref: string): boolean {
  if (row.hostname === ref || row.id === ref) return true;
  return dockerIdMatch(row.id, ref);
}

function jsonField(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
  }
  return "";
}

function jsonLines(stdout: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const row = JSON.parse(trimmed) as unknown;
      if (row && typeof row === "object" && !Array.isArray(row)) {
        rows.push(row as Record<string, unknown>);
      }
    } catch {
      /* skip malformed docker json lines */
    }
  }
  return rows;
}

export function parseDockerSwarmInfo(stdout: string): DockerSwarmInfo {
  const trimmed = stdout.trim();
  if (!trimmed) return { ...INACTIVE_DOCKER_SWARM.info };
  try {
    const row = JSON.parse(trimmed) as Record<string, unknown>;
    const stateRaw = jsonField(row, "LocalNodeState", "localNodeState", "State").toLowerCase();
    const state = isDockerSwarmState(stateRaw) ? stateRaw : "inactive";
    const error = jsonField(row, "Error", "error");
    const nodeId = parseDockerSwarmRef(jsonField(row, "NodeID", "NodeId", "ID")) ?? undefined;
    const nodeAddr = jsonField(row, "NodeAddr", "Addr");
    const control =
      row.ControlAvailable === true || String(row.ControlAvailable ?? "").toLowerCase() === "true";
    return {
      state,
      controlAvailable: control && state === "active",
      ...(nodeId ? { nodeId } : {}),
      ...(nodeAddr ? { nodeAddr } : {}),
      ...(error ? { error } : {}),
    };
  } catch {
    return { ...INACTIVE_DOCKER_SWARM.info };
  }
}

export function parseDockerNodeLsJson(stdout: string): DockerSwarmNode[] {
  const rows: DockerSwarmNode[] = [];
  for (const row of jsonLines(stdout)) {
    const id = parseDockerSwarmRef(jsonField(row, "ID", "Id", "NodeID"));
    if (!id) continue;
    const hostname = jsonField(row, "Hostname", "Name") || id.slice(0, 12);
    const managerStatus = jsonField(row, "ManagerStatus");
    const engineVersion = jsonField(row, "EngineVersion");
    rows.push({
      id,
      hostname,
      status: jsonField(row, "Status") || "Unknown",
      availability: jsonField(row, "Availability") || "Active",
      ...(managerStatus ? { managerStatus } : {}),
      ...(engineVersion ? { engineVersion } : {}),
    });
  }
  return rows;
}

export function parseDockerServiceLsJson(stdout: string): DockerSwarmService[] {
  const rows: DockerSwarmService[] = [];
  for (const row of jsonLines(stdout)) {
    const id = parseDockerSwarmRef(jsonField(row, "ID", "Id"));
    const name = parseDockerSwarmRef(jsonField(row, "Name", "Names"));
    if (!id || !name) continue;
    const ports = jsonField(row, "Ports");
    rows.push({
      id,
      name,
      image: jsonField(row, "Image"),
      mode: jsonField(row, "Mode") || "replicated",
      replicas: jsonField(row, "Replicas") || "0/0",
      ...(ports ? { ports } : {}),
    });
  }
  return rows;
}

export function parseDockerStackLsJson(stdout: string): DockerSwarmStack[] {
  const rows: DockerSwarmStack[] = [];
  for (const row of jsonLines(stdout)) {
    const name = parseDockerSwarmRef(jsonField(row, "Name", "Namespace"));
    if (!name) continue;
    const rawCount = jsonField(row, "Services");
    const services = Number.parseInt(rawCount, 10);
    const orchestrator = jsonField(row, "Orchestrator");
    rows.push({
      name,
      services: Number.isFinite(services) ? services : 0,
      ...(orchestrator ? { orchestrator } : {}),
    });
  }
  return rows;
}

export function parseDockerServicePsJson(stdout: string): DockerSwarmTask[] {
  const rows: DockerSwarmTask[] = [];
  for (const row of jsonLines(stdout)) {
    const id = parseDockerSwarmRef(jsonField(row, "ID", "Id"));
    if (!id) continue;
    const error = jsonField(row, "Error");
    rows.push({
      id,
      name: jsonField(row, "Name") || id.slice(0, 12),
      image: jsonField(row, "Image"),
      node: jsonField(row, "Node"),
      desiredState: jsonField(row, "DesiredState"),
      currentState: jsonField(row, "CurrentState"),
      ...(error ? { error } : {}),
    });
  }
  return rows;
}

export function dockerSwarmServiceLive(
  row: Pick<DockerSwarmService, "mode" | "replicas">,
): boolean {
  if (row.mode.toLowerCase() === "global") return true;
  const match = row.replicas.match(/^(\d+)\s*\/\s*(\d+)/);
  if (!match) return row.replicas.trim() !== "0/0" && row.replicas.trim() !== "0";
  return Number.parseInt(match[1] ?? "0", 10) > 0;
}

export function dockerSwarmNodeReady(row: Pick<DockerSwarmNode, "status">): boolean {
  return row.status.trim().toLowerCase() === "ready";
}

export function looksLikeDockerSwarmPrompt(text: string): boolean {
  return /\bdocker swarm\b|\bswarm (?:service|node|stack|cluster|mode)\b|\bswarmctl\b/i.test(text);
}

export const DOCKER_SWARM_TOOL: ExtraToolDef = {
  name: DOCKER_SWARM_TOOL_NAME,
  description:
    "Inspect this machine's Docker Swarm (the local Docker engine in swarm mode — not Locus Swarm teams and not Portainer). status/nodes/services/stacks list the cluster. Pass service to inspect one service plus tasks, or logs for `docker service logs`. scale a replicated service (replicas) and wait for Approve. Host-side; uses the same Docker daemon as the Docker sidebar. Do not exec docker swarm from the guest.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "status (default), nodes, services, stacks, logs, or scale.",
        enum: [...DOCKER_SWARM_TOOL_ACTIONS],
      },
      service: {
        type: "string",
        description:
          "Service id or name. Required for logs and scale; optional filter for services.",
      },
      replicas: {
        type: "number",
        description: "Desired replica count for scale (0–256).",
      },
      tail: {
        type: "number",
        description: "Log lines for logs (default 400, max 2000).",
      },
    },
  },
};

export function dockerSwarmMcpTools(): Array<{
  name: string;
  description: string;
  inputSchema: ExtraToolDef["parameters"];
}> {
  return [
    {
      name: DOCKER_SWARM_TOOL.name,
      description: DOCKER_SWARM_TOOL.description,
      inputSchema: DOCKER_SWARM_TOOL.parameters,
    },
  ];
}

export function parseDockerSwarmToolAction(raw: unknown): DockerSwarmToolAction {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return isDockerSwarmToolAction(value) ? value : "status";
}

export function dockerSwarmToolNeedsApproval(args?: Record<string, unknown>): boolean {
  return parseDockerSwarmToolAction(args?.action) === "scale";
}
