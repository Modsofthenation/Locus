import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, useReducer, type Dispatch, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DockerContainer } from "@locus/shared";
import { DockerExplorer } from "./DockerExplorer";
import { api } from "@/lib/api";
import { DOCKER_EXPLORER_EXPANDED_KEY, DOCKER_EXPLORER_POLL_MS } from "@/lib/docker";
import { Store, initialState, reducer, type Action, type UiState } from "@/state/store";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

vi.mock("@/lib/api", () => ({
  api: {
    dockerContainers: vi.fn(async () => ({ kind: "mock", containers: [] })),
    dockerContainerAction: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const web: DockerContainer = {
  id: "c1",
  name: "app-dev_webpack.abc",
  image: "node:22",
  state: "running",
  status: "Up 2 hours",
  createdAt: "2020-01-01T00:00:00.000Z",
  containerId: "abc123def456",
  locus: false,
};

const db: DockerContainer = {
  id: "c2",
  name: "app-dev_nginx.xyz",
  image: "nginx:alpine",
  state: "exited",
  status: "Exited (0) 3 minutes ago",
  createdAt: "2020-01-01T00:00:00.000Z",
  containerId: "def456abc123",
  locus: false,
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("DockerExplorer", () => {
  let host: HTMLDivElement;
  let root: Root;
  const inspected: DockerContainer[] = [];

  beforeEach(() => {
    localStorage.clear();
    inspected.length = 0;
    vi.mocked(api.dockerContainers).mockResolvedValue({
      kind: "mock",
      containers: [web, db],
    });
    vi.mocked(api.dockerContainerAction).mockImplementation(async (_id, action) => ({
      ...web,
      state: action === "stop" ? "exited" : "running",
      status: action === "stop" ? "Exited" : "Up",
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
    localStorage.clear();
  });

  function render(state: UiState = { ...initialState, section: "ide", containers: [web, db] }) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    function Harness({ children }: { children: ReactNode }) {
      const [current, dispatch] = useReducer(reducer, state);
      return (
        <Store.Provider value={{ state: current, dispatch: dispatch as Dispatch<Action> }}>
          {children}
        </Store.Provider>
      );
    }
    act(() => {
      root.render(
        <Harness>
          <DockerExplorer selectedId={null} onInspect={(row) => inspected.push(row)} />
        </Harness>,
      );
    });
  }

  it("lists containers and inspects, stops, and restarts from the row", async () => {
    render();
    await flush();
    expect(host.querySelector('[data-testid="docker-explorer"]')).toBeTruthy();
    expect(host.querySelector(".docker-explorer-head")?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".docker-explorer-count")?.textContent).toBe("2");
    expect(host.querySelector(".docker-explorer-name")?.textContent).toBe("app-dev_webpack.abc");
    expect(host.querySelector(".dot.running")).toBeTruthy();
    await act(async () => {
      (host.querySelector(".docker-explorer-open") as HTMLButtonElement).click();
    });
    expect(inspected.map((row) => row.id)).toEqual(["c1"]);
    await act(async () => {
      (host.querySelector('[aria-label="Stop app-dev_webpack.abc"]') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.dockerContainerAction).toHaveBeenCalledWith("c1", "stop");
    await act(async () => {
      (
        host.querySelector('[aria-label="Restart app-dev_webpack.abc"]') as HTMLButtonElement
      ).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.dockerContainerAction).toHaveBeenCalledWith("c1", "restart");
  });

  it("starts a stopped container without a confirm", async () => {
    render();
    await flush();
    const start = host.querySelector('[aria-label="Start app-dev_nginx.xyz"]') as HTMLButtonElement;
    expect(start).toBeTruthy();
    await act(async () => {
      start.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(window.confirm).not.toHaveBeenCalled();
    expect(api.dockerContainerAction).toHaveBeenCalledWith("c2", "start");
  });

  it("offers inspect, stop, and restart from the context menu", async () => {
    render();
    await flush();
    const row = host.querySelector(".docker-explorer-open") as HTMLButtonElement;
    await act(async () => {
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 12, clientY: 24 }));
    });
    const items = [...document.querySelectorAll('.workspace-ctx [role="menuitem"]')].map(
      (el) => el.textContent,
    );
    expect(items).toEqual(["Inspect", "Stop", "Restart"]);
    await act(async () => {
      (document.querySelector('.workspace-ctx [role="menuitem"]') as HTMLButtonElement).click();
    });
    expect(inspected.map((row) => row.name)).toEqual(["app-dev_webpack.abc"]);
    expect(document.querySelector(".workspace-ctx")).toBeNull();
  });

  it("polls container status every 5 seconds only while expanded", async () => {
    vi.useFakeTimers();
    render();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.dockerContainers).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DOCKER_EXPLORER_POLL_MS);
    });
    expect(api.dockerContainers).toHaveBeenCalledTimes(2);
    await act(async () => {
      (host.querySelector(".docker-explorer-head") as HTMLButtonElement).click();
    });
    expect(host.querySelector(".docker-explorer-head")?.getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(host.querySelector(".docker-explorer-list")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DOCKER_EXPLORER_POLL_MS * 2);
    });
    expect(api.dockerContainers).toHaveBeenCalledTimes(3);
    expect(localStorage.getItem(DOCKER_EXPLORER_EXPANDED_KEY)).toBe("0");
  });

  it("does not poll when the containers section starts collapsed", async () => {
    localStorage.setItem(DOCKER_EXPLORER_EXPANDED_KEY, "0");
    vi.useFakeTimers();
    render();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.dockerContainers).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DOCKER_EXPLORER_POLL_MS);
    });
    expect(api.dockerContainers).toHaveBeenCalledTimes(1);
    await act(async () => {
      (host.querySelector(".docker-explorer-head") as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.dockerContainers).toHaveBeenCalledTimes(2);
  });

  it("packs explorer rows and hover actions", () => {
    expect(css).toMatch(/\.docker-explorer \{[\s\S]*?flex-shrink:\s*0/);
    expect(css).toMatch(/\.docker-explorer-row \{[\s\S]*?display:\s*flex/);
    expect(css).toMatch(/\.docker-explorer-actions \{[\s\S]*?opacity:\s*0/);
    expect(css).toMatch(/\.docker-explorer-row:hover \.docker-explorer-actions/);
  });
});
