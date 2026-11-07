import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ASSET_EXPORT_DONE_MS, type AssetExportJob } from "@locus/shared";
import {
  ASSET_EXPORT_DIR_KEY,
  AssetExportModal,
  loadAssetExportDir,
  rememberAssetExportDir,
} from "./AssetExportModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

describe("AssetExportModal", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    window.localStorage.removeItem(ASSET_EXPORT_DIR_KEY);
  });

  function render(progress: AssetExportJob, onClose = vi.fn(), onExport = vi.fn()) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<AssetExportModal progress={progress} onClose={onClose} onExport={onExport} />);
    });
    return { onClose, onExport };
  }

  it("asks for a name and folder before exporting", () => {
    expect(css).toMatch(/\.modal\.asset-export \{[\s\S]*?width:\s*min\(460px/);
    expect(css).toMatch(/\.asset-export-fields \{/);
    const { onExport } = render({
      format: "stl",
      phase: "save",
      percent: 0,
      filename: "hero-mesh.stl",
      folder: "/tmp/exports",
    });
    const modal = document.querySelector("[data-testid='asset-export-modal']");
    expect(modal).toBeTruthy();
    expect(document.querySelector("#asset-export-title")?.textContent).toBe("Export STL");
    expect(modal?.textContent).toContain("Choose a file name and folder.");
    expect(modal?.querySelector("[role='progressbar']")).toBeNull();
    const name = document.querySelector(
      "[data-testid='asset-export-filename']",
    ) as HTMLInputElement;
    const folder = document.querySelector(
      "[data-testid='asset-export-folder']",
    ) as HTMLInputElement;
    expect(name.value).toBe("hero-mesh.stl");
    expect(folder.value).toBe("/tmp/exports");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(name, "ship.stl");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirm = document.querySelector(
      "[data-testid='asset-export-confirm']",
    ) as HTMLButtonElement;
    act(() => {
      confirm.click();
    });
    expect(onExport).toHaveBeenCalledWith({ filename: "ship.stl", folder: "/tmp/exports" });
  });

  it("disables Export until both name and folder are set", () => {
    render({ format: "glb", phase: "save", percent: 0, filename: "hero.glb" });
    const confirm = document.querySelector(
      "[data-testid='asset-export-confirm']",
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it("shows determinate progress and the close-confirm chrome", () => {
    expect(css).toMatch(/\.asset-export-progress \{[\s\S]*?height:\s*6px/);
    const { onClose } = render({ format: "stl", phase: "build", percent: 62 });
    const modal = document.querySelector("[data-testid='asset-export-modal']");
    expect(modal).toBeTruthy();
    expect(document.querySelector("#asset-export-title")?.textContent).toBe("Export STL");
    expect(modal?.textContent).toContain("Building STL");
    const bar = modal?.querySelector("[role='progressbar']");
    expect(bar?.getAttribute("aria-valuenow")).toBe("62");
    expect(bar?.classList.contains("is-indeterminate")).toBe(false);
    const cancel = [...(modal?.querySelectorAll("button") ?? [])].find(
      (btn) => btn.textContent === "Cancel",
    );
    act(() => {
      cancel!.click();
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows an error and dismisses", () => {
    const { onClose } = render({
      format: "stl",
      phase: "error",
      percent: 28,
      error: "This studio has no STL exporter yet.",
    });
    const modal = document.querySelector("[data-testid='asset-export-modal']");
    expect(modal?.textContent).toContain("This studio has no STL exporter yet.");
    const dismiss = [...(modal?.querySelectorAll("button") ?? [])].find(
      (btn) => btn.textContent === "Dismiss",
    );
    act(() => {
      dismiss!.click();
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("auto-closes shortly after the export finishes", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { onClose } = render({ format: "glb", phase: "done", percent: 100 });
    expect(document.querySelector("[data-testid='asset-export-modal']")?.textContent).toContain(
      "GLB export ready",
    );
    act(() => {
      vi.advanceTimersByTime(ASSET_EXPORT_DONE_MS - 1);
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("remembers the last export folder", () => {
    expect(loadAssetExportDir()).toBe("");
    rememberAssetExportDir(" /tmp/models ");
    expect(loadAssetExportDir()).toBe("/tmp/models");
  });
});
