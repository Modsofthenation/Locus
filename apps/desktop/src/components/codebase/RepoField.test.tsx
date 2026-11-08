import { forgeLabel, type LinkedRepo } from "@locus/shared";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerBranchPicker, ComposerRepoPicker } from "./RepoField";
import { selectOptionLabels } from "@/lib/selectControl";

vi.mock("@/lib/api", () => ({
  api: {
    repoBranches: vi.fn(async () => ({ branches: ["main", "feat"], defaultBranch: "main" })),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const repos: LinkedRepo[] = [
  {
    id: "r1",
    name: "Modsofthenation/landing-page",
    checkout: { forge: "github", url: "https://github.com/Modsofthenation/landing-page.git" },
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  },
  {
    id: "r2",
    name: "Modsofthenation/workflow-builder",
    checkout: { forge: "github", url: "https://github.com/Modsofthenation/workflow-builder.git" },
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  },
  {
    id: "r3",
    name: "Modsofthenation/Locus",
    checkout: { forge: "github", url: "https://github.com/Modsofthenation/Locus.git" },
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  },
];

describe("ComposerRepoPicker", () => {
  let host: HTMLDivElement;
  let root: Root;
  let selected: string[];
  let refs: Record<string, string>;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(ids: string[] = [], extra?: { multiple?: boolean; repos?: LinkedRepo[] }) {
    selected = [...ids];
    refs = {};
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    function paint() {
      const node: ReactNode = (
        <ComposerRepoPicker
          repos={extra?.repos ?? repos}
          repoIds={selected}
          repoRefs={refs}
          multiple={extra?.multiple ?? true}
          onChange={(next, nextRefs) => {
            selected = next;
            refs = nextRefs ?? refs;
            paint();
          }}
        />
      );
      act(() => {
        root.render(node);
      });
    }
    paint();
  }

  function openList() {
    const toggle = host.querySelector("[aria-label='Repository']") as HTMLButtonElement;
    act(() => {
      toggle.click();
    });
  }

  function option(name: string) {
    return [...host.querySelectorAll("[role='option']")].find((row) =>
      row.textContent?.includes(name),
    ) as HTMLButtonElement;
  }

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function pickRepoBranch(name: string, branchName: string) {
    if (!host.querySelector("[role='listbox']")) openList();
    if (host.querySelector("[role='listbox']")?.getAttribute("aria-label") === "Branches") {
      act(() => {
        (host.querySelector("[aria-label='Back to repositories']") as HTMLButtonElement).click();
      });
    }
    act(() => {
      option(name)!.click();
    });
    await flush();
    const branchBtn = [...host.querySelectorAll("[role='option']")].find((row) =>
      row.textContent?.includes(branchName),
    ) as HTMLButtonElement;
    act(() => {
      branchBtn.click();
    });
  }

  it("keeps a single-select picker for design context", () => {
    render([], { multiple: false, repos: repos.slice(0, 1) });
    const picker = host.querySelector("[aria-label='Repository']");
    expect(picker).toBeTruthy();
    expect(picker instanceof HTMLSelectElement).toBe(false);
    const labels = selectOptionLabels(host, "Repository");
    expect(labels[0]).toBe("No repo");
    expect(labels.some((label) => label.includes(forgeLabel("github")))).toBe(true);
  });

  it("opens a checkbox list instead of a separate Add repo select", () => {
    render();
    expect(host.querySelector(".composer-repo-placeholder")?.textContent).toBe("No repo");
    expect(host.querySelector("select")).toBeNull();
    openList();
    expect(host.querySelector("[role='listbox']")).not.toBeNull();
    expect(option("Modsofthenation/landing-page")).toBeTruthy();
    expect(option("Modsofthenation/Locus")).toBeTruthy();
  });

  it("adds and removes repos from chips with a visible close control", async () => {
    render();
    await pickRepoBranch("landing-page", "feat");
    await pickRepoBranch("Locus", "feat");
    expect(selected).toEqual(["r1", "r3"]);
    expect(refs).toEqual({ r1: "feat", r3: "feat" });
    expect(host.querySelector(".composer-repo-chip-name")?.textContent).toBe("landing-page");
    expect(host.querySelector(".composer-repo-chip-ref")?.textContent).toBe("feat");
    expect(host.querySelector("[aria-label='Remove Modsofthenation/landing-page']")).not.toBeNull();
    expect(option("landing-page")?.getAttribute("aria-selected")).toBe("true");
    expect(option("landing-page")?.textContent).toContain("Primary");
    expect(option("Locus")?.textContent).not.toContain("Primary");

    act(() => {
      (
        host.querySelector(
          "[aria-label='Remove Modsofthenation/landing-page']",
        ) as HTMLButtonElement
      ).click();
    });
    expect(selected).toEqual(["r3"]);
    expect(refs).toEqual({ r3: "feat" });
    expect(host.querySelector("[aria-label='Remove Modsofthenation/landing-page']")).toBeNull();
    expect(host.querySelector(".composer-repo-chip-name")?.textContent).toBe("Locus");
  });

  it("keeps a clicked repo unselected until a branch is chosen", async () => {
    render();
    openList();
    act(() => {
      option("landing-page")!.click();
    });
    await flush();
    expect(selected).toEqual([]);
    expect(host.querySelector("[role='listbox']")?.getAttribute("aria-label")).toBe("Branches");
    expect(host.querySelector("[aria-label='Back to repositories']")).not.toBeNull();
    act(() => {
      (host.querySelector("[aria-label='Back to repositories']") as HTMLButtonElement).click();
    });
    expect(selected).toEqual([]);
    expect(host.querySelector("[role='listbox']")?.getAttribute("aria-label")).toBe("Repositories");
  });

  it("lets each selected repo keep its own branch", async () => {
    render();
    await pickRepoBranch("landing-page", "feat");
    await pickRepoBranch("Locus", "main");
    expect(selected).toEqual(["r1", "r3"]);
    expect(refs).toEqual({ r1: "feat", r3: "main" });
    const chips = [...host.querySelectorAll(".composer-repo-chip-ref")].map(
      (row) => row.textContent,
    );
    expect(chips).toEqual(["feat", "main"]);
  });

  it("filters a long catalog without closing the list", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...repos[0]!,
      id: `r${i}`,
      name: i === 4 ? "acme/needle" : `acme/other-${i}`,
    }));
    render([], { repos: many });
    openList();
    const filter = host.querySelector("[aria-label='Filter repositories']") as HTMLInputElement;
    expect(filter).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(filter, "needle");
      filter.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(option("acme/needle")).toBeTruthy();
    expect(option("acme/other-0")).toBeUndefined();
    expect(host.querySelector("[role='listbox']")).not.toBeNull();
  });

  it("moves the active option with arrow keys and selects with Enter", async () => {
    render();
    const toggle = host.querySelector("[aria-label='Repository']") as HTMLButtonElement;
    act(() => {
      toggle.click();
    });
    expect(toggle.getAttribute("role")).toBe("combobox");
    expect(toggle.getAttribute("aria-activedescendant")).toBe("composer-repo-opt-r1");
    expect(option("landing-page")?.classList.contains("active")).toBe(true);
    act(() => {
      toggle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
    });
    expect(toggle.getAttribute("aria-activedescendant")).toBe("composer-repo-opt-r2");
    expect(option("workflow-builder")?.classList.contains("active")).toBe(true);
    act(() => {
      toggle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(selected).toEqual([]);
    await flush();
    expect(host.querySelector("[role='listbox']")?.getAttribute("aria-label")).toBe("Branches");
    act(() => {
      toggle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(selected).toEqual(["r2"]);
    expect(refs.r2).toBe("main");
  });

  it("leaves Home and End to the filter caret", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...repos[0]!,
      id: `r${i}`,
      name: `acme/repo-${i}`,
    }));
    render([], { repos: many });
    openList();
    const filter = host.querySelector("[aria-label='Filter repositories']") as HTMLInputElement;
    act(() => {
      filter.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
    });
    const toggle = host.querySelector("[aria-label='Repository']") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-activedescendant")).toBe("composer-repo-opt-r1");
    expect(filter.getAttribute("aria-activedescendant")).toBe("composer-repo-opt-r1");
    expect(
      host.querySelector("[role='listbox']")?.getAttribute("aria-activedescendant"),
    ).toBeNull();
    act(() => {
      filter.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }),
      );
    });
    expect(toggle.getAttribute("aria-activedescendant")).toBe("composer-repo-opt-r1");
  });
});

describe("ComposerBranchPicker", () => {
  let host: HTMLDivElement;
  let root: Root;
  let selected: string;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(value = "main") {
    selected = value;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    function paint() {
      const node: ReactNode = (
        <ComposerBranchPicker
          repoId="r1"
          value={selected}
          fallback="main"
          onChange={(next) => {
            selected = next;
            paint();
          }}
        />
      );
      act(() => {
        root.render(node);
      });
    }
    paint();
  }

  it("lists remote branches and selects one", async () => {
    render("main");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const toggle = host.querySelector("[aria-label='Branch']") as HTMLButtonElement;
    expect(host.textContent).toContain("main");
    act(() => {
      toggle.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const feat = [...host.querySelectorAll("[role='option']")].find((row) =>
      row.textContent?.includes("feat"),
    ) as HTMLButtonElement;
    expect(feat).toBeTruthy();
    act(() => {
      feat.click();
    });
    expect(selected).toBe("feat");
  });

  it("can type a branch that is not in the list", async () => {
    render("main");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      (host.querySelector("[aria-label='Branch']") as HTMLButtonElement).click();
    });
    const filter = host.querySelector("[aria-label='Filter branches']") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(filter, "hotfix");
      filter.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const custom = [...host.querySelectorAll("[role='option']")].find((row) =>
      row.textContent?.includes("hotfix"),
    ) as HTMLButtonElement;
    expect(custom).toBeTruthy();
    act(() => {
      custom.click();
    });
    expect(selected).toBe("hotfix");
  });
});
