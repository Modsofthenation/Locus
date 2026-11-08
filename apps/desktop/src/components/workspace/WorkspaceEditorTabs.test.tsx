import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceEditorTabs } from "./WorkspaceEditorTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("WorkspaceEditorTabs", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("opens, closes, and labels dirty tabs", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onOpen = vi.fn();
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <WorkspaceEditorTabs
          paths={["/src/app.ts"]}
          selected="/src/app.ts"
          docs={[
            {
              path: "/src/app.ts",
              content: "export {}",
              original: "",
              kind: "text",
            },
          ]}
          stubDoc={(path) => ({ path, content: "", original: "", kind: "text", cold: true })}
          onOpen={onOpen}
          onClose={onClose}
        />,
      );
    });
    expect(host.querySelector("[role='tablist']")?.getAttribute("aria-label")).toBe("Open files");
    expect(host.querySelector(".workspace-tab-dot")).toBeTruthy();
    await act(async () => {
      (host.querySelector(".workspace-tab") as HTMLElement).click();
    });
    expect(onOpen).toHaveBeenCalledWith("/src/app.ts", false);
    await act(async () => {
      (host.querySelector(".workspace-tab-close") as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalledWith("/src/app.ts");
  });
});
