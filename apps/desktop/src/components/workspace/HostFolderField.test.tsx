import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostFolderField } from "./HostFolderField";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    browseHost: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

function picker(): HTMLElement {
  return document.querySelector("[data-testid='host-folder-picker']") as HTMLElement;
}

describe("HostFolderField", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.localStorage.removeItem("locus.ideRecents");
  });

  async function renderField(
    props: { value?: string; onChange?: (dir: string) => void; remote?: boolean } = {},
  ) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    let value = props.value ?? "";
    const node: ReactNode = (
      <HostFolderField
        value={value}
        remote={props.remote}
        onChange={(next) => {
          value = next;
          props.onChange?.(next);
        }}
      />
    );
    act(() => {
      root.render(node);
    });
    return {
      get value() {
        return value;
      },
    };
  }

  async function openBrowse() {
    const browse = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Browse");
    await act(async () => {
      browse!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("opens a folder modal and picks the current directory", async () => {
    expect(css).toMatch(/\.modal\.host-folder-modal \{/);
    expect(css).toMatch(/\.host-folder-modal-filter > input\.search \{/);
    vi.mocked(api.browseHost).mockResolvedValue({
      path: "/home/me/src",
      parent: "/home/me",
      entries: [{ name: "app", path: "/home/me/src/app" }],
    });
    let value = "";
    await renderField({
      onChange: (next) => {
        value = next;
      },
    });
    await openBrowse();
    const dialog = picker();
    expect(dialog).toBeTruthy();
    expect(dialog.querySelector("#host-folder-title")?.textContent).toBe("Workspace folder");
    expect(dialog.textContent).toContain("This folder maps to /workspace");
    expect(dialog.querySelector(".host-folder-modal-path.field .host-folder-row")).toBeTruthy();
    expect(dialog.querySelector("input.search[aria-label='Filter folders']")).toBeTruthy();
    expect((dialog.querySelector("[aria-label='Folder path']") as HTMLInputElement).value).toBe(
      "/home/me/src",
    );
    expect(dialog.textContent).toContain("Parent folder");
    expect(dialog.textContent).toContain("app");
    const use = [...dialog.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Select folder",
    );
    expect(use).toBeTruthy();
    expect((use as HTMLButtonElement).disabled).toBe(false);
    act(() => {
      use!.click();
    });
    expect(value).toBe("/home/me/src");
    expect(picker()).toBeNull();
  });

  it("navigates into a listed folder from the modal", async () => {
    vi.mocked(api.browseHost)
      .mockResolvedValueOnce({
        path: "/home/me/src",
        parent: "/home/me",
        entries: [{ name: "app", path: "/home/me/src/app" }],
      })
      .mockResolvedValueOnce({
        path: "/home/me/src/app",
        parent: "/home/me/src",
        entries: [],
      });
    await renderField();
    await openBrowse();
    const dialog = picker();
    await act(async () => {
      [...dialog.querySelectorAll("button")]
        .find((btn) => btn.textContent?.includes("app"))!
        .click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.browseHost).toHaveBeenLastCalledWith("/home/me/src/app");
    expect((picker().querySelector("[aria-label='Folder path']") as HTMLInputElement).value).toBe(
      "/home/me/src/app",
    );
  });

  it("jumps to a typed path with Go", async () => {
    vi.mocked(api.browseHost)
      .mockResolvedValueOnce({
        path: "/home/me",
        parent: "/home",
        entries: [{ name: "src", path: "/home/me/src" }],
      })
      .mockResolvedValueOnce({
        path: "/tmp/project",
        parent: "/tmp",
        entries: [],
      });
    await renderField();
    await openBrowse();
    const path = picker().querySelector("[aria-label='Folder path']") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(path, "/tmp/project");
      path.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      [...picker().querySelectorAll("button")].find((btn) => btn.textContent === "Go")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.browseHost).toHaveBeenLastCalledWith("/tmp/project");
  });

  it("filters the current folder list", async () => {
    vi.mocked(api.browseHost).mockResolvedValue({
      path: "/home/me/src",
      parent: "/home/me",
      entries: [
        { name: "app", path: "/home/me/src/app" },
        { name: "docs", path: "/home/me/src/docs" },
      ],
    });
    await renderField();
    await openBrowse();
    const filter = picker().querySelector("[aria-label='Filter folders']") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(filter, "doc");
      filter.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(picker().textContent).toContain("docs");
    expect(picker().textContent).not.toContain("app");
  });

  it("lists recent folders in the modal", async () => {
    window.localStorage.setItem(
      "locus.ideRecents",
      JSON.stringify([{ path: "/tmp/recent-app", title: "recent-app", at: 1 }]),
    );
    vi.mocked(api.browseHost).mockResolvedValue({
      path: "/home/me",
      parent: "/home",
      entries: [],
    });
    await renderField();
    await openBrowse();
    expect(picker().textContent).toContain("Recent");
    expect(picker().textContent).toContain("recent-app");
  });

  it("closes from Escape and the backdrop", async () => {
    vi.mocked(api.browseHost).mockResolvedValue({
      path: "/home/me",
      parent: "/home",
      entries: [],
    });
    await renderField();
    await openBrowse();
    expect(picker()).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(picker()).toBeNull();
    await openBrowse();
    await act(async () => {
      (picker().closest(".modal-backdrop") as HTMLElement).click();
    });
    expect(picker()).toBeNull();
  });

  it("disables Select folder when the listing is blocked", async () => {
    vi.mocked(api.browseHost).mockResolvedValue({
      path: "/",
      parent: null,
      entries: [{ name: "etc", path: "/etc" }],
      blocked: "Folder cannot be the filesystem root",
    });
    await renderField();
    await openBrowse();
    expect(picker().textContent).toContain("filesystem root");
    const use = [...picker().querySelectorAll("button")].find(
      (btn) => btn.textContent === "Select folder",
    ) as HTMLButtonElement;
    expect(use.disabled).toBe(true);
  });

  it("hides Browse for a worker host path", async () => {
    await renderField({ remote: true });
    expect(
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Browse"),
    ).toBeUndefined();
    expect(host.querySelector("[data-testid='host-folder-picker']")).toBeNull();
  });
});
