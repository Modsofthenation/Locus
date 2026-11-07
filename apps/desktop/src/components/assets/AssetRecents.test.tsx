import { type AgentSession, type DesignSystem } from "@locus/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AssetRecents } from "./AssetRecents";

vi.mock("@/lib/api", () => ({
  api: {
    workspaceFile: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session: AgentSession = {
  id: "as1",
  title: "Hero mesh",
  kind: "assets",
  os: "ubuntu",
  templateId: "t1",
  runtime: "docker",
  providerId: "p1",
  model: "mock",
  status: "idle",
  messages: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  designVariants: [
    { id: "hero", name: "Hero" },
    { id: "direction-1", name: "Direction 1" },
    { id: "direction-2", name: "Direction 2" },
    { id: "direction-3", name: "Direction 3" },
    { id: "undo", name: "Before generate" },
  ],
};

const systems: DesignSystem[] = [];

describe("AssetRecents", () => {
  let host: HTMLElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.mocked(api.workspaceFile).mockReset();
  });

  it("loads thumbs for named recents and Explore 3 directions", async () => {
    vi.mocked(api.workspaceFile).mockImplementation(async (_id, path) => ({
      content: `<html><body>${path}</body></html>`,
      path,
      mtime: "2026-01-01T00:00:00.000Z",
    }));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <AssetRecents
          session={session}
          html="<html><body>live</body></html>"
          systems={systems}
          canUndo
          compareOn={false}
          onLive={() => undefined}
          onActivate={() => undefined}
          onSave={() => undefined}
          onExplore={() => undefined}
          onUndo={() => undefined}
          onCompare={() => undefined}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const paths = vi.mocked(api.workspaceFile).mock.calls.map((call) => call[1]);
    expect(paths).toContain(".locus-variants/hero.html");
    expect(paths).toContain(".locus-variants/direction-1.html");
    expect(paths).toContain(".locus-variants/direction-2.html");
    expect(paths).toContain(".locus-variants/direction-3.html");
    expect(paths).toContain(".locus-variants/undo.html");
    const recents = host.querySelector("[aria-label='Recents']");
    expect(recents).toBeTruthy();
    expect(host.querySelector("[aria-label='Explore 3']")).toBeTruthy();
    const namedCaptions = [
      ...host.querySelectorAll(".asset-recents-row > .asset-recent-thumb"),
    ].map((el) => el.querySelector(".asset-recent-caption")?.textContent);
    expect(namedCaptions).toContain("Live");
    expect(namedCaptions).toContain("Hero");
    expect(namedCaptions).not.toContain("Direction 1");
  });
});
