import { describe, expect, it } from "vitest";
import {
  DOCKER_SWARM_TOOL,
  dockerSwarmActive,
  dockerSwarmManager,
  dockerSwarmNodeReady,
  dockerSwarmServiceLive,
  dockerSwarmToolNeedsApproval,
  inactiveDockerSwarmSnapshot,
  isDockerSwarmToolName,
  looksLikeDockerSwarmPrompt,
  matchDockerSwarmNode,
  matchDockerSwarmService,
  parseDockerNodeLsJson,
  parseDockerServiceLsJson,
  parseDockerServicePsJson,
  parseDockerStackLsJson,
  parseDockerSwarmInfo,
  parseDockerSwarmReplicas,
  parseDockerSwarmScaleBody,
  parseDockerSwarmToolAction,
} from "./dockerSwarm.js";

describe("docker swarm models", () => {
  it("parses docker info Swarm JSON", () => {
    expect(parseDockerSwarmInfo("")).toEqual({ state: "inactive", controlAvailable: false });
    expect(parseDockerSwarmInfo("not json")).toEqual({
      state: "inactive",
      controlAvailable: false,
    });
    expect(
      parseDockerSwarmInfo(
        JSON.stringify({
          NodeID: "abc123def456",
          NodeAddr: "192.168.1.10",
          LocalNodeState: "active",
          ControlAvailable: true,
          Error: "",
        }),
      ),
    ).toEqual({
      state: "active",
      controlAvailable: true,
      nodeId: "abc123def456",
      nodeAddr: "192.168.1.10",
    });
    expect(
      parseDockerSwarmInfo(
        JSON.stringify({
          LocalNodeState: "active",
          ControlAvailable: false,
          Error: "This node is not a swarm manager",
        }),
      ),
    ).toEqual({
      state: "active",
      controlAvailable: false,
      error: "This node is not a swarm manager",
    });
    expect(dockerSwarmActive({ state: "active" })).toBe(true);
    expect(dockerSwarmManager({ controlAvailable: true })).toBe(true);
    expect(dockerSwarmManager({ controlAvailable: false })).toBe(false);
  });

  it("parses node, service, stack, and task json lines and skips unsafe ids", () => {
    const nodes = parseDockerNodeLsJson(
      [
        "not json",
        JSON.stringify({
          ID: "n1n1n1n1n1n1",
          Hostname: "manager",
          Status: "Ready",
          Availability: "Active",
          ManagerStatus: "Leader",
          EngineVersion: "27.0.3",
        }),
        JSON.stringify({ ID: "bad;id", Hostname: "x", Status: "Ready" }),
      ].join("\n"),
    );
    expect(nodes).toEqual([
      {
        id: "n1n1n1n1n1n1",
        hostname: "manager",
        status: "Ready",
        availability: "Active",
        managerStatus: "Leader",
        engineVersion: "27.0.3",
      },
    ]);
    expect(dockerSwarmNodeReady(nodes[0]!)).toBe(true);
    expect(matchDockerSwarmNode(nodes[0]!, "manager")).toBe(true);

    const services = parseDockerServiceLsJson(
      JSON.stringify({
        ID: "svc123456789",
        Name: "web",
        Mode: "replicated",
        Replicas: "2/2",
        Image: "nginx:latest",
        Ports: "*:80->80/tcp",
      }),
    );
    expect(services).toEqual([
      {
        id: "svc123456789",
        name: "web",
        image: "nginx:latest",
        mode: "replicated",
        replicas: "2/2",
        ports: "*:80->80/tcp",
      },
    ]);
    expect(dockerSwarmServiceLive(services[0]!)).toBe(true);
    expect(dockerSwarmServiceLive({ mode: "replicated", replicas: "0/2" })).toBe(false);
    expect(matchDockerSwarmService(services[0]!, "web")).toBe(true);
    expect(matchDockerSwarmService(services[0]!, "svc123456789")).toBe(true);

    expect(
      parseDockerStackLsJson(JSON.stringify({ Name: "app", Services: "3", Orchestrator: "Swarm" })),
    ).toEqual([{ name: "app", services: 3, orchestrator: "Swarm" }]);

    const tasks = parseDockerServicePsJson(
      JSON.stringify({
        ID: "task12345678",
        Name: "web.1",
        Image: "nginx:latest",
        Node: "manager",
        DesiredState: "Running",
        CurrentState: "Running 2 hours ago",
        Error: "",
      }),
    );
    expect(tasks).toEqual([
      {
        id: "task12345678",
        name: "web.1",
        image: "nginx:latest",
        node: "manager",
        desiredState: "Running",
        currentState: "Running 2 hours ago",
      },
    ]);
  });

  it("parses scale replicas and tool actions", () => {
    expect(parseDockerSwarmReplicas(3)).toBe(3);
    expect(parseDockerSwarmReplicas("0")).toBe(0);
    expect(parseDockerSwarmReplicas(999)).toBeUndefined();
    expect(parseDockerSwarmReplicas(-1)).toBeUndefined();
    expect(parseDockerSwarmScaleBody({ replicas: 4 })).toBe(4);
    expect(parseDockerSwarmScaleBody({ replicas: "nope" })).toBeUndefined();
    expect(parseDockerSwarmToolAction("SCALE")).toBe("scale");
    expect(parseDockerSwarmToolAction("")).toBe("status");
    expect(dockerSwarmToolNeedsApproval({ action: "logs" })).toBe(false);
    expect(dockerSwarmToolNeedsApproval({ action: "scale", replicas: 3 })).toBe(true);
    expect(isDockerSwarmToolName(DOCKER_SWARM_TOOL.name)).toBe(true);
    expect(inactiveDockerSwarmSnapshot().services).toEqual([]);
    expect(looksLikeDockerSwarmPrompt("list docker swarm services")).toBe(true);
    expect(looksLikeDockerSwarmPrompt("open the Swarm team chat")).toBe(false);
  });
});
