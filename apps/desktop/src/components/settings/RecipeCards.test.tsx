import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_RECIPES, FIRST_TASKS, visibleRecipes } from "@locus/shared";
import { FirstTaskPills, RecipeCards } from "./RecipeCards";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("RecipeCards", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(node);
    });
  }

  it("renders visible recipes and marks the selected one", () => {
    const recipes = visibleRecipes(["windows-11"]);
    expect(recipes).toHaveLength(6);
    render(<RecipeCards recipes={recipes} selectedId="pr-reviewer" onSelect={() => undefined} />);
    expect(host.textContent).toContain("PR reviewer");
    expect(host.textContent).toContain("Installer QA");
    expect(host.textContent).toContain("Repo fixer");
    expect(host.textContent).toContain("Setup environment");
    expect(host.textContent).toContain("Web QA");
    expect(host.textContent).toContain("Ops loop");
    const pressed = host.querySelector("[aria-pressed='true']");
    expect(pressed?.textContent).toContain("PR reviewer");
  });

  it("calls onSelect with the recipe", () => {
    let picked = "";
    render(
      <RecipeCards
        recipes={AGENT_RECIPES}
        selectedId={null}
        onSelect={(recipe) => {
          picked = recipe.id;
        }}
      />,
    );
    const fixer = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("Repo fixer"),
    );
    act(() => {
      fixer!.click();
    });
    expect(picked).toBe("repo-fixer");
  });

  it("marks compact recipe grids without changing selection", () => {
    const recipes = visibleRecipes(["ubuntu"]);
    render(
      <RecipeCards compact recipes={recipes} selectedId="pr-reviewer" onSelect={() => undefined} />,
    );
    expect(host.querySelector(".recipe-grid.compact")).toBeTruthy();
    expect(host.querySelector(".recipe-tile")).toBeTruthy();
    expect(host.querySelector("[aria-pressed='true']")?.textContent).toContain("PR reviewer");
  });

  it("renders pill shortcuts without compact tiles", () => {
    const recipes = visibleRecipes(["ubuntu"]);
    render(
      <RecipeCards
        pills
        shortcuts
        recipes={recipes}
        selectedId="pr-reviewer"
        onSelect={() => undefined}
      />,
    );
    expect(host.querySelector(".recipe-grid.pills")).toBeTruthy();
    expect(host.querySelector(".recipe-tile")).toBeNull();
    expect(host.querySelector("kbd")?.textContent).toBe("P");
    expect(host.querySelector("[aria-pressed='true']")?.textContent).toContain("PR reviewer");
  });

  it("omits letter hints where the screen has no shortcuts", () => {
    render(
      <RecipeCards
        pills
        recipes={visibleRecipes(["ubuntu"])}
        selectedId={null}
        onSelect={() => undefined}
      />,
    );
    expect(host.querySelector("kbd")).toBeNull();
    expect(host.querySelector("[aria-keyshortcuts]")).toBeNull();
  });

  it("shows letter hints while Alt is held", () => {
    render(
      <RecipeCards
        pills
        shortcuts
        recipes={visibleRecipes(["ubuntu"])}
        selectedId={null}
        onSelect={() => undefined}
      />,
    );
    const grid = host.querySelector(".recipe-grid.pills")!;
    expect(grid.classList.contains("show-keys")).toBe(false);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" }));
    });
    expect(grid.classList.contains("show-keys")).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }));
    });
    expect(grid.classList.contains("show-keys")).toBe(false);
  });

  it("caps pills at the limit and reveals the rest with More…", () => {
    const recipes = AGENT_RECIPES.slice(0, 5);
    render(
      <RecipeCards
        pills
        limit={2}
        recipes={recipes}
        selectedId={recipes[4]!.id}
        onSelect={() => undefined}
        more={<p data-testid="more-extra">extra</p>}
      />,
    );
    // Two plus the selected one stay visible.
    expect(host.querySelectorAll("button[aria-pressed]")).toHaveLength(3);
    expect(host.querySelector("[data-testid='more-extra']")).toBeNull();
    const more = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "More…")!;
    expect(more.getAttribute("aria-expanded")).toBe("false");
    act(() => {
      more.click();
    });
    expect(host.querySelectorAll("button[aria-pressed]")).toHaveLength(5);
    expect(host.querySelector("[data-testid='more-extra']")).toBeTruthy();
  });
});

describe("FirstTaskPills", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders every first task and calls onSelect", () => {
    let picked = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <FirstTaskPills
          tasks={FIRST_TASKS}
          selectedId={null}
          onSelect={(task) => {
            picked = task.id;
          }}
        />,
      );
    });
    expect(host.querySelector(".first-task")).toBeTruthy();
    expect(host.querySelector(".recipe-grid.pills")).toBeTruthy();
    expect(host.textContent).toContain("Try a first task");
    expect(host.textContent).toContain("hello.txt");
    expect(host.querySelectorAll(".recipe-grid.pills button")).toHaveLength(FIRST_TASKS.length);
    act(() => {
      (host.querySelector(".recipe-grid.pills button") as HTMLButtonElement).click();
    });
    expect(picked).toBe("workspace-hello");
  });
});
