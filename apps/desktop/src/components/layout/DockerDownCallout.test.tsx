import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, LinkedRepo, LocusConfig } from "@locus/shared";
import { api } from "@/lib/api";
import { Store, initialState, type Action } from "@/state/store";
import { DockerDownSessionNotice } from "./DockerDownCallout";

vi.mock("@/lib/api", () => ({
  api: {
    createSession: vi.fn(),
    startVm: vi.fn(),
    health: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const repo = {
  id: "r1",
  name: "acme/app",
  checkout: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
} as LinkedRepo;

const session = {
  id: "s1",
  title: "app",
  os: "ubuntu",
  templateId: "ubuntu",
  runtime: "docker",
  providerId: "p1",
  model: "m1",
  repoId: "r1",
  status: "error",
  error:
    "ERROR: failed to connect to the docker API at unix:///var/run/docker.sock; dial unix /var/run/docker.sock: connect: no such file or directory",
  messages: [{ id: "u1", role: "user", content: "Fix the flaky test", createdAt: "" }],
  createdAt: "",
  updatedAt: "",
} as unknown as AgentSession;

const config = {
  providers: [],
  templates: [{ id: "ubuntu", os: "ubuntu" }],
} as unknown as LocusConfig;

describe("DockerDownSessionNotice", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(target: AgentSession, dispatch: (action: Action) => void = () => undefined) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider value={{ state: { ...initialState, config, repos: [repo] }, dispatch }}>
          <DockerDownSessionNotice session={target} />
        </Store.Provider>,
      );
    });
  }

  it("offers a Host copy with the same repo, prompt and model", async () => {
    const copy = { ...session, id: "s2", runtime: "host" } as AgentSession;
    vi.mocked(api.createSession).mockResolvedValue(copy);
    const actions: Action[] = [];
    render(session, (action) => actions.push(action));
    expect(host.textContent).toContain("runtime can't change");
    const button = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Start a Host copy",
    ) as HTMLButtonElement;
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "host",
        repoId: "r1",
        prompt: "Fix the flaky test",
        providerId: "p1",
        model: "m1",
      }),
    );
    expect(actions).toContainEqual({ type: "select", id: "s2" });
  });

  it("stays out of the way for other errors and non-Docker agents", () => {
    render({ ...session, error: "HTTP 500" } as AgentSession);
    expect(host.querySelector("[data-testid='docker-down-session']")).toBeNull();
  });
});
