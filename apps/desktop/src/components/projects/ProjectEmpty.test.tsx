import { act, type Dispatch } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectEmpty } from "./ProjectEmpty";
import { api } from "@/lib/api";
import { Store, initialState, type Action } from "@/state/store";
import type { LocusConfig, ProjectDocument } from "@locus/shared";

vi.mock("@/lib/api", () => ({
  api: {
    createProject: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config: LocusConfig = {
  theme: "ember",
  providers: [],
  templates: [],
  hardwareProfiles: [],
  forges: [],
  advanced: {
    dataDir: "/tmp",
    qemuBinary: "qemu-system-x86_64",
    swtpmBinary: "swtpm",
    ovmfCodePath: "",
    ovmfVarsPath: "",
    maxConcurrentVms: 4,
    defaultAcceleratorAuto: true,
    logLevel: "info",
    bindHost: "127.0.0.1",
    bindPort: 7420,
    openBrowserOnStart: true,
    hostSharePath: "",
  },
};

const created: ProjectDocument = {
  id: "p1",
  title: "Auth",
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
  recipeId: "feature",
  memberIds: [],
  maxConcurrentMembers: 4,
};

describe("ProjectEmpty", () => {
  let host: HTMLDivElement;
  let root: Root;
  let dispatched: Action[] = [];

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render() {
    dispatched = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const dispatch = ((action: Action) => {
      dispatched.push(action);
    }) as Dispatch<Action>;
    act(() => {
      root.render(
        <Store.Provider value={{ state: { ...initialState, config }, dispatch }}>
          <ProjectEmpty />
        </Store.Provider>,
      );
    });
  }

  it("creates a project from a starter pill", async () => {
    vi.mocked(api.createProject).mockResolvedValue(created);
    render();
    const pill = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Feature"),
    );
    expect(pill).toBeTruthy();
    await act(async () => {
      pill!.click();
    });
    expect(api.createProject).toHaveBeenCalledWith({
      starter: "feature",
      prompt: undefined,
      surface: "developer",
    });
    expect(dispatched).toEqual([
      { type: "project", project: created },
      { type: "selectProject", id: "p1" },
    ]);
  });

  it("lists Feature, Migration, Gardening, and Blank", () => {
    render();
    const labels = [...host.querySelectorAll(".recipe-grid.pills h3")].map((el) => el.textContent);
    expect(labels).toEqual(["Feature", "Migration", "Gardening", "Blank"]);
  });

  it("submits with the same Send-style chrome as Board", () => {
    render();
    const send = host.querySelector(".composer-send") as HTMLButtonElement;
    expect(send.className).toContain("btn");
    expect(send.className).toContain("primary");
    expect(send.getAttribute("aria-label")).toBe("Create project");
    expect(send.textContent).toMatch(/Create/);
  });
});
