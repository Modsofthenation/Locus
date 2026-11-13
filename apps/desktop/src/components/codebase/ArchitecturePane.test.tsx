import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeArchitecture, type AgentSession } from "@locus/shared";
import { ArchitecturePane } from "./ArchitecturePane";
import { api } from "@/lib/api";
import { Store, initialState, type Action } from "@/state/store";

vi.mock("@/lib/api", () => ({
  api: {
    repoArchitecture: vi.fn(),
    suggestArchitecture: vi.fn(),
  },
}));

const report = {
  ...analyzeArchitecture({
    repoName: "billing",
    files: [
      {
        path: "src/invoice.ts",
        text: "export function loadInvoice(id: string) {\n  return billing.loadInvoice(id);\n}\n",
      },
    ],
  }),
  repoId: "r1",
  checkout: { sessionId: "s1", runtime: "host" as const, label: "IDE billing" },
};

describe("ArchitecturePane", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(dispatch: (action: Action) => void = () => undefined) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider value={{ state: { ...initialState, section: "codebase" }, dispatch }}>
        <ArchitecturePane repoId="r1" repoName="billing" />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
  }

  it("analyses a checkout into repo, feature, and code sections and suggests improvements", async () => {
    vi.mocked(api.repoArchitecture).mockResolvedValueOnce(report);
    render();
    // One empty state until the first pass, not three empty section cards.
    expect(host.querySelector("[data-testid='architecture-empty']")).toBeTruthy();
    expect(host.querySelector("[data-testid='architecture-repo']")).toBeNull();
    expect(host.textContent).toContain("Not analysed yet");

    await act(async () => {
      host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='architecture-repo']")).toBeTruthy();
    expect(host.querySelector("[data-testid='architecture-feature']")).toBeTruthy();
    expect(host.querySelector("[data-testid='architecture-code']")).toBeTruthy();

    expect(api.repoArchitecture).toHaveBeenCalledWith("r1");
    expect(host.textContent).toContain("Pass-through loadInvoice");
    expect(host.textContent).toContain("Delete loadInvoice");
    expect(host.textContent).toContain("IDE billing");
    expect(host.querySelector(".architecture-emphasis")).toBeNull();

    act(() => {
      const suggest = [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "Suggest improvements",
      );
      (suggest as HTMLButtonElement).click();
    });
    expect(host.querySelector(".architecture-emphasis")).toBeTruthy();
    expect(host.textContent).toContain("The body forwards its arguments and adds no policy.");
  });

  it("starts an agent for the repo section", async () => {
    const actions: Action[] = [];
    const session = {
      id: "sess-arch",
      title: "Architecture · billing",
      messages: [],
    } as unknown as AgentSession;
    vi.mocked(api.suggestArchitecture).mockResolvedValueOnce(session);
    render((action) => actions.push(action));

    await act(async () => {
      const improve = host.querySelector(
        "[data-testid='architecture-improve-repo']",
      ) as HTMLButtonElement;
      improve.click();
      await Promise.resolve();
    });

    expect(api.suggestArchitecture).toHaveBeenCalledWith("r1", {
      scope: "repo",
      target: undefined,
    });
    expect(actions).toEqual([
      { type: "session", session },
      { type: "select", id: "sess-arch" },
    ]);
  });
});
