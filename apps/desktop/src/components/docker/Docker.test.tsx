import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DockerContainer } from "@locus/shared";
import { DockerPane } from "./Docker";
import { api } from "@/lib/api";
import { Store, initialState, type UiState } from "@/state/store";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

vi.mock("@/lib/api", () => ({
  api: {
    dockerContainerLogs: vi.fn(async () => ({
      text: "2020-01-01T00:00:00.000Z INFO hello\n2020-01-01T00:00:01.000Z ERROR boom",
    })),
    dockerContainerStats: vi.fn(async () => ({
      id: "vm-1",
      name: "locus-vm-1",
      cpuPercent: 2.1,
      memoryPercent: 9,
      memoryUsage: "184MB",
      memoryLimit: "2GB",
      networkRx: "1kB",
      networkTx: "2kB",
      blockRead: "0B",
      blockWrite: "0B",
      pids: 3,
      running: true,
      sampledAt: "2020-01-01T00:00:00.000Z",
    })),
    dockerContainerAction: vi.fn(async () => ({
      id: "vm-1",
      name: "locus-vm-1",
      image: "node:22-bookworm",
      state: "stopped",
      status: "stopped",
      createdAt: "2020-01-01T00:00:00.000Z",
      containerId: "abc123def456",
      sessionId: "s1",
      sessionTitle: "Fix login",
      vmId: "vm-1",
      locus: true,
    })),
    dockerContainers: vi.fn(async () => ({
      kind: "mock",
      containers: [
        {
          id: "vm-1",
          name: "locus-vm-1",
          image: "node:22-bookworm",
          state: "running",
          status: "running",
          createdAt: "2020-01-01T00:00:00.000Z",
          containerId: "abc123def456",
          sessionId: "s1",
          sessionTitle: "Fix login",
          vmId: "vm-1",
          locus: true,
        },
      ],
    })),
    dockerSwarmLogs: vi.fn(async () => ({
      text: "2020-01-01T00:00:00.000Z INFO web ready\n2020-01-01T00:00:01.000Z ERROR crash",
    })),
    dockerSwarmService: vi.fn(async () => ({
      service: {
        id: "svc1",
        name: "web",
        image: "nginx:alpine",
        mode: "replicated",
        replicas: "1/1",
        ports: "*:80->80/tcp",
      },
      tasks: [
        {
          id: "task1",
          name: "web.1",
          image: "nginx:alpine",
          node: "manager-1",
          desiredState: "running",
          currentState: "Running",
        },
      ],
    })),
    dockerSwarmScale: vi.fn(async () => ({
      id: "svc1",
      name: "web",
      image: "nginx:alpine",
      mode: "replicated",
      replicas: "3/3",
    })),
    dockerSwarm: vi.fn(async () => ({
      kind: "docker",
      info: { state: "active", controlAvailable: true, nodeId: "node1" },
      nodes: [],
      services: [
        {
          id: "svc1",
          name: "web",
          image: "nginx:alpine",
          mode: "replicated",
          replicas: "3/3",
        },
      ],
      stacks: [],
    })),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const container: DockerContainer = {
  id: "vm-1",
  name: "locus-vm-1",
  image: "node:22-bookworm",
  state: "running",
  status: "running",
  createdAt: "2020-01-01T00:00:00.000Z",
  containerId: "abc123def456",
  sessionId: "s1",
  sessionTitle: "Fix login",
  vmId: "vm-1",
  locus: true,
};

describe("DockerPane", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  function render(state: UiState) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider value={{ state, dispatch: () => undefined }}>
        <DockerPane />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
  }

  it("shows stop, restart, colored logs, and tabs for a running container", async () => {
    render({
      ...initialState,
      section: "docker",
      selectedContainerId: "vm-1",
      containers: [container],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("h2")).toBeNull();
    expect(host.querySelector(".docker-pill")?.textContent).toMatch(/running/i);
    const labels = [...host.querySelectorAll("button")].map((el) => el.textContent?.trim());
    expect(labels).toEqual(
      expect.arrayContaining(["Pull logs", "Open agent", "Logs", "Inspect", "Stats", "Files"]),
    );
    expect(labels).not.toEqual(expect.arrayContaining(["Stop", "Restart"]));
    expect(host.querySelector(".docker-grep-wrap .search-icon svg")).toBeTruthy();
    expect(host.querySelector(".docker-log-line.info .time")?.textContent).toBe("00:00:00");
    expect(host.querySelector(".docker-log-line.info")?.textContent).toMatch(/hello/);
    expect(host.querySelector(".docker-log-line.error")?.textContent).toMatch(/boom/);
    expect(api.dockerContainerLogs).toHaveBeenCalledWith("vm-1");
    expect(api.dockerContainerStats).toHaveBeenCalledWith("vm-1");
  });

  it("packs container facts and log columns instead of stretching them", () => {
    expect(css).toMatch(/\.meta-grid\.docker-meta-pane \{[\s\S]*?display:\s*flex/);
    expect(css).toMatch(
      /\.meta-grid\.docker-meta-pane \{[\s\S]*?gap:\s*var\(--space-2\) var\(--space-7\)/,
    );
    expect(css).toMatch(/\.meta-grid\.docker-meta-pane > div \{[\s\S]*?flex:\s*0 1 auto/);
    expect(css).toMatch(/\.docker-log-line \{[\s\S]*?gap:\s*var\(--space-2\)/);
    expect(css).toMatch(/\.docker-log-line \{[\s\S]*?padding:\s*1px 18px/);
    expect(css).toMatch(/\.docker-log-line \.time \{[\s\S]*?min-width:\s*8ch/);
    expect(css).toMatch(/\.docker-logs \{[\s\S]*?background:\s*var\(--term\)/);
    expect(css).toMatch(/\.docker-logs \{[\s\S]*?color:\s*var\(--term-fg\)/);
    expect(css).toMatch(/\.docker-log-line \.msg \{[\s\S]*?color:\s*var\(--term-fg\)/);
    expect(css).toMatch(
      /\.docker-log-line \.time \{[\s\S]*?color:\s*color-mix\(in srgb, var\(--term-fg\)/,
    );
    expect(css).toMatch(
      /\.docker-log-line\.warn \.msg \{[\s\S]*?color:\s*color-mix\(in srgb, var\(--warn\) 50%, var\(--term-fg\)/,
    );
    expect(css).toMatch(
      /\.docker-log-line\.error \.msg \{[\s\S]*?color:\s*color-mix\(in srgb, var\(--danger\) 50%, var\(--term-fg\)/,
    );
    expect(css).toMatch(/\.docker-grep-wrap \{[\s\S]*?flex:\s*0 1 220px/);
    expect(css).toMatch(/\.docker-actions \{[\s\S]*?gap:\s*var\(--space-2-5\)/);
  });

  it("keeps plain log lines flush left without a time or level gutter", async () => {
    vi.mocked(api.dockerContainerLogs).mockResolvedValueOnce({
      text: "celery beat v5.3.0 is starting\nScheduler: Sending due task ping",
    });
    render({
      ...initialState,
      section: "docker",
      selectedContainerId: "vm-1",
      containers: [container],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".docker-log-line .time")).toBeNull();
    expect(host.querySelector(".docker-log-line .level")).toBeNull();
    expect(host.querySelector(".docker-log-line .msg")?.textContent).toMatch(/celery beat/);
  });

  it("opens the inspect tab", async () => {
    render({
      ...initialState,
      section: "docker",
      selectedContainerId: "vm-1",
      containers: [container],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      [...host.querySelectorAll("button")].find((el) => el.textContent === "Inspect")!.click();
    });
    expect(host.querySelector(".docker-inspect")?.textContent).toMatch(/locus-vm-1/);
    expect(host.querySelector(".docker-inspect")?.textContent).toMatch(/node:22-bookworm/);
  });

  it("shows a bulk action bar for picked containers", () => {
    render({
      ...initialState,
      section: "docker",
      selectedContainerId: "vm-1",
      pickedContainerIds: ["vm-1"],
      containers: [container],
    });
    expect(host.querySelector(".docker-select-bar")?.textContent).toMatch(/1 container selected/);
    expect(host.querySelector(".docker-select-bar")?.textContent).toMatch(/Stop/);
  });

  it("explains inactive Docker Swarm", () => {
    render({
      ...initialState,
      section: "docker",
      dockerView: "swarm",
      dockerKind: "docker",
      dockerSwarm: {
        info: { state: "inactive", controlAvailable: false },
        nodes: [],
        services: [],
        stacks: [],
      },
    });
    expect(host.textContent).toMatch(/Swarm mode is off/);
    expect(host.textContent).toMatch(/not Locus Swarm teams/);
    expect(host.textContent).toMatch(/Portainer/);
  });

  it("shows service logs, tasks, and scale for an active swarm manager", async () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("3");
    render({
      ...initialState,
      section: "docker",
      dockerView: "swarm",
      dockerKind: "docker",
      selectedSwarmServiceId: "svc1",
      dockerSwarm: {
        info: { state: "active", controlAvailable: true, nodeId: "node1" },
        nodes: [
          {
            id: "node1",
            hostname: "manager-1",
            status: "Ready",
            availability: "Active",
            managerStatus: "Leader",
          },
        ],
        services: [
          {
            id: "svc1",
            name: "web",
            image: "nginx:alpine",
            mode: "replicated",
            replicas: "1/1",
            ports: "*:80->80/tcp",
          },
        ],
        stacks: [{ name: "app", services: 1, orchestrator: "Swarm" }],
      },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".docker-pill")?.textContent).toMatch(/1\/1/);
    expect(host.textContent).toMatch(/nginx:alpine/);
    expect(api.dockerSwarmLogs).toHaveBeenCalledWith("svc1");
    expect(host.querySelector(".docker-log-line.info")?.textContent).toMatch(/web ready/);
    act(() => {
      [...host.querySelectorAll("button")].find((el) => el.textContent === "Tasks")!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector(".docker-inspect")?.textContent).toMatch(/web\.1/);
    act(() => {
      [...host.querySelectorAll("button")].find((el) => el.textContent === "Scale")!.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(prompt).toHaveBeenCalled();
    expect(api.dockerSwarmScale).toHaveBeenCalledWith("svc1", 3);
    prompt.mockRestore();
  });

  it("explains the empty mock engine", () => {
    render({ ...initialState, section: "docker", dockerKind: "mock", containers: [] });
    expect(host.textContent).toMatch(/mock Docker engine/);
    expect(host.querySelector("[data-testid='locus-mascot']")?.getAttribute("data-pose")).toBe(
      "rest",
    );
    expect(host.querySelector(".empty-actions .btn.primary")?.textContent).toMatch(/New agent/);
    expect(
      [...host.querySelectorAll(".empty-actions button")].map((btn) => btn.textContent),
    ).toEqual(["New agent", "Refresh"]);
  });

  it("filters logs to errors and opens stats and files", async () => {
    render({
      ...initialState,
      section: "docker",
      selectedContainerId: "vm-1",
      containers: [{ ...container, sessionId: undefined, sessionTitle: undefined, locus: false }],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      [...host.querySelectorAll("button")].find((el) => el.textContent === "Error")!.click();
    });
    expect(host.querySelector(".docker-log-line.info")).toBeNull();
    expect(host.querySelector(".docker-log-line.error")?.textContent).toMatch(/boom/);
    act(() => {
      [...host.querySelectorAll("button")].find((el) => el.textContent === "Stats")!.click();
    });
    expect(host.querySelector(".docker-stats")?.textContent).toMatch(/CPU/);
    expect(host.querySelector(".docker-stats")?.textContent).toMatch(/184MB/);
    act(() => {
      [...host.querySelectorAll("button")].find((el) => el.textContent === "Files")!.click();
    });
    expect(host.querySelector(".docker-files-empty")?.textContent).toMatch(/No workspace/);
  });
});
