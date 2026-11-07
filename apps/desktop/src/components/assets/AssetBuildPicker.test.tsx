import { ASSET_BUILD_DEFAULTS, type AssetBuild } from "@locus/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AssetBuildPicker } from "./AssetBuildPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AssetBuildPicker", () => {
  let host: HTMLElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("toggles Meshy-like generation knobs", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    let current: AssetBuild = { ...ASSET_BUILD_DEFAULTS };
    function render(value: AssetBuild) {
      act(() => {
        root.render(
          <AssetBuildPicker
            value={value}
            onChange={(next) => {
              current = next;
              render(next);
            }}
          />,
        );
      });
    }
    render(current);
    expect(host.querySelector("[aria-label='Build settings']")).toBeTruthy();
    const high = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "High detail",
    );
    act(() => {
      high!.click();
    });
    expect(current.topology).toBe("high-detail");
    const flagship = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Flagship",
    );
    act(() => {
      flagship!.click();
    });
    expect(current.quality).toBe("flagship");
    const ultra = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Ultra 4x",
    );
    act(() => {
      ultra!.click();
    });
    expect(current.resolution).toBe("4x");
    const tpose = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "T-Pose");
    act(() => {
      tpose!.click();
    });
    expect(current.restPose).toBe("t-pose");
    const faces = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "20k faces",
    );
    act(() => {
      faces!.click();
    });
    expect(current.polyBudget).toBe("20k");
    const print = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Printability",
    );
    act(() => {
      print!.click();
    });
    expect(current.printable).toBe(true);
    const texture = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Texture",
    );
    act(() => {
      texture!.click();
    });
    expect(current.texture).toBe(false);
  });

  it("hides rest pose, poly budget, and printability on sprite studios", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <AssetBuildPicker value={ASSET_BUILD_DEFAULTS} onChange={() => undefined} mesh={false} />,
      );
    });
    const labels = [...host.querySelectorAll("button, .asset-build-label")].map(
      (node) => node.textContent,
    );
    expect(labels).toContain("Smart topology");
    expect(labels).toContain("Texture");
    expect(labels).not.toContain("A-Pose");
    expect(labels).not.toContain("Rest pose");
    expect(labels).not.toContain("Poly budget");
    expect(labels).not.toContain("20k faces");
    expect(labels).not.toContain("Printability");
  });
});
