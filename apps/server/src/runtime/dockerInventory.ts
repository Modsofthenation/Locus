import type {
  DockerBulkStopResult,
  DockerContainer,
  DockerContainerAction,
  DockerContainerStats,
  DockerHostContainer,
  DockerSwarmService,
  DockerSwarmServiceDetail,
  DockerSwarmSnapshot,
} from "@locus/shared";
import {
  dockerIdMatch,
  dockerSwarmActive,
  dockerSwarmManager,
  inactiveDockerSwarmSnapshot,
  matchDockerContainer,
  matchDockerSwarmService,
  mergeDockerInventory,
  parseDockerContainerRef,
  parseDockerLogTail,
  parseDockerSwarmRef,
  parseDockerSwarmReplicas,
  parseDockerSwarmToolAction,
} from "@locus/shared";
import type { DockerEngine } from "@locus/hypervisor";

export type DockerInventorySession = { id: string; title: string; vmId?: string };

export type DockerInventoryPorts = {
  docker: DockerEngine;
  listSessions: () => Promise<DockerInventorySession[]>;
  startAgentMachine: (sessionId: string) => Promise<void>;
  stopAgentMachine: (sessionId: string) => Promise<void>;
};

/** Operator Docker pane: host daemon rows plus Agent Machine containers. */
export class DockerInventory {
  constructor(private readonly ports: DockerInventoryPorts) {}

  kind(): DockerEngine["kind"] {
    return this.ports.docker.kind;
  }

  async list(): Promise<DockerContainer[]> {
    const host = await this.hostContainers();
    const sessions = await this.ports.listSessions();
    return mergeDockerInventory({
      vms: this.ports.docker.list(),
      host,
      sessions: sessions.map((row) => ({ id: row.id, title: row.title, vmId: row.vmId })),
    });
  }

  async action(ref: string, action: DockerContainerAction): Promise<DockerContainer> {
    const parsed = parseDockerContainerRef(ref);
    if (!parsed) throw new Error("Invalid container");
    const target = await this.resolveTarget(parsed);
    if (!target) throw new Error("Container not found");
    if (target.vmId) {
      if (target.sessionId) {
        if (action === "stop" || action === "restart")
          await this.ports.stopAgentMachine(target.sessionId);
        if (action === "start" || action === "restart")
          await this.ports.startAgentMachine(target.sessionId);
      } else if (action === "restart") {
        await this.ports.docker.restart(target.vmId);
      } else if (action === "stop") {
        await this.ports.docker.stop(target.vmId);
      } else {
        await this.ports.docker.start(target.vmId);
      }
    } else if (this.ports.docker.hostControl) {
      await this.ports.docker.hostControl(target.hostRef, action);
    } else {
      throw new Error("Container not found");
    }
    const rows = await this.list();
    const next = rows.find(
      (row) =>
        matchDockerContainer(row, parsed) ||
        (target.vmId != null && row.vmId === target.vmId) ||
        matchDockerContainer(row, target.hostRef),
    );
    if (!next) throw new Error("Container not found");
    return next;
  }

  async stopMany(ids: string[]): Promise<DockerBulkStopResult> {
    const stopped: DockerBulkStopResult["stopped"] = [];
    const errors: DockerBulkStopResult["errors"] = [];
    for (const id of ids) {
      try {
        stopped.push(await this.action(id, "stop"));
      } catch (err) {
        errors.push({ id, error: err instanceof Error ? err.message : "Failed" });
      }
    }
    return { stopped, errors };
  }

  async logs(ref: string, tail?: number): Promise<string> {
    const parsed = parseDockerContainerRef(ref);
    if (!parsed) throw new Error("Invalid container");
    const target = await this.resolveTarget(parsed);
    if (!target) throw new Error("Container not found");
    const chunks: string[] = [];
    if (target.vmId) {
      const locus = this.ports.docker.logs(target.vmId).trim();
      if (locus) chunks.push(locus);
    }
    if (this.ports.docker.hostLogs && target.hostRef) {
      try {
        const host = (
          await this.ports.docker.hostLogs(target.hostRef, parseDockerLogTail(tail))
        ).trim();
        if (host) chunks.push(host);
      } catch {
        /* missing docker logs is fine for mock / never-started guests */
      }
    }
    return chunks.join("\n\n") || "No logs yet.";
  }

  async swarm(): Promise<DockerSwarmSnapshot> {
    try {
      const info = await this.ports.docker.swarmInfo();
      if (!dockerSwarmActive(info) || !dockerSwarmManager(info)) {
        return { info, nodes: [], services: [], stacks: [] };
      }
      const [nodes, services, stacks] = await Promise.all([
        this.ports.docker.listSwarmNodes(),
        this.ports.docker.listSwarmServices(),
        this.ports.docker.listSwarmStacks(),
      ]);
      return { info, nodes, services, stacks };
    } catch {
      return inactiveDockerSwarmSnapshot();
    }
  }

  async swarmService(ref: string): Promise<DockerSwarmServiceDetail> {
    const parsed = parseDockerSwarmRef(ref);
    if (!parsed) throw new Error("Invalid service");
    const snapshot = await this.swarm();
    const service = snapshot.services.find((row) => matchDockerSwarmService(row, parsed));
    if (!service) throw new Error("Service not found");
    let tasks: DockerSwarmServiceDetail["tasks"] = [];
    try {
      tasks = await this.ports.docker.listSwarmTasks(service.id);
    } catch {
      tasks = [];
    }
    return { service, tasks };
  }

  async swarmLogs(ref: string, tail?: number): Promise<string> {
    const service = await this.requireSwarmService(ref);
    return this.ports.docker.swarmServiceLogs(service.id, parseDockerLogTail(tail));
  }

  async scaleSwarm(ref: string, replicas: number): Promise<DockerSwarmService> {
    const count = parseDockerSwarmReplicas(replicas);
    if (count === undefined) throw new Error("Invalid replica count");
    const info = await this.ports.docker.swarmInfo();
    if (!dockerSwarmActive(info)) throw new Error("Docker Swarm is inactive");
    if (!dockerSwarmManager(info)) throw new Error("This node is not a Swarm manager");
    const service = await this.requireSwarmService(ref);
    return this.ports.docker.scaleSwarmService(service.name, count);
  }

  async executeSwarmTool(args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
    const action = parseDockerSwarmToolAction(args.action);
    const service =
      typeof args.service === "string" ? args.service : typeof args.id === "string" ? args.id : "";
    try {
      if (action === "nodes") {
        const snapshot = await this.swarm();
        return { ok: true, output: JSON.stringify({ info: snapshot.info, nodes: snapshot.nodes }) };
      }
      if (action === "stacks") {
        const snapshot = await this.swarm();
        return {
          ok: true,
          output: JSON.stringify({ info: snapshot.info, stacks: snapshot.stacks }),
        };
      }
      if (action === "logs") {
        if (!service) return { ok: false, output: "service is required" };
        const text = await this.swarmLogs(service, parseDockerLogTail(args.tail));
        return { ok: true, output: text };
      }
      if (action === "scale") {
        if (!service) return { ok: false, output: "service is required" };
        const replicas = parseDockerSwarmReplicas(args.replicas);
        if (replicas === undefined) return { ok: false, output: "replicas is required (0–256)" };
        const row = await this.scaleSwarm(service, replicas);
        return { ok: true, output: JSON.stringify(row) };
      }
      if (action === "services" && service) {
        const detail = await this.swarmService(service);
        return { ok: true, output: JSON.stringify(detail) };
      }
      if (action === "services") {
        const snapshot = await this.swarm();
        return {
          ok: true,
          output: JSON.stringify({ info: snapshot.info, services: snapshot.services }),
        };
      }
      const snapshot = await this.swarm();
      return { ok: true, output: JSON.stringify(snapshot) };
    } catch (err) {
      return { ok: false, output: err instanceof Error ? err.message : "Docker Swarm failed" };
    }
  }

  private async requireSwarmService(ref: string): Promise<DockerSwarmService> {
    const parsed = parseDockerSwarmRef(ref);
    if (!parsed) throw new Error("Invalid service");
    const snapshot = await this.swarm();
    const service = snapshot.services.find((row) => matchDockerSwarmService(row, parsed));
    if (!service) throw new Error("Service not found");
    return service;
  }

  async stats(ref: string): Promise<DockerContainerStats> {
    const parsed = parseDockerContainerRef(ref);
    if (!parsed) throw new Error("Invalid container");
    const target = await this.resolveTarget(parsed);
    if (!target) throw new Error("Container not found");
    return this.ports.docker.hostStats(target.hostRef);
  }

  private async hostContainers(): Promise<DockerHostContainer[]> {
    if (!this.ports.docker.listHostContainers) return [];
    try {
      return await this.ports.docker.listHostContainers();
    } catch {
      return [];
    }
  }

  private async resolveTarget(
    ref: string,
  ): Promise<{ vmId?: string; sessionId?: string; hostRef: string } | undefined> {
    const sessions = await this.ports.listSessions();
    const vm = this.ports.docker.list().find((row) => {
      if (row.id === ref || row.sessionId === ref || row.name === ref) return true;
      if (`locus-${row.id}` === ref) return true;
      if (row.containerId && dockerIdMatch(row.containerId, ref)) return true;
      return sessions.some((session) => session.id === ref && session.vmId === row.id);
    });
    if (vm) {
      const session =
        sessions.find((row) => row.vmId === vm.id) ??
        sessions.find((row) => row.id === vm.sessionId);
      return {
        vmId: vm.id,
        sessionId: session?.id,
        hostRef: vm.containerId || ref,
      };
    }
    const host = (await this.hostContainers()).find(
      (row) => dockerIdMatch(row.id, ref) || row.name === ref,
    );
    if (!host) return undefined;
    return { hostRef: host.id };
  }
}
