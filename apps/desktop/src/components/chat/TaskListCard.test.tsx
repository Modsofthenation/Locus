import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskItem } from "@locus/shared";
import { TaskListCard } from "./TaskListCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const short: TaskItem[] = [
  { id: "t1", text: "Inspect the workspace", status: "done" },
  { id: "t2", text: "Patch the scanner", status: "in_progress" },
  { id: "t3", text: "Run tests", status: "pending" },
  { id: "t4", text: "Skip the extra lint pass", status: "cancelled" },
];

const long: TaskItem[] = [
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `d${i}`,
    text: `Finished step ${i + 1}`,
    status: "done" as const,
  })),
  { id: "p", text: "Refactor firebird_component_types.hpp", status: "in_progress" },
  ...Array.from({ length: 26 }, (_, i) => ({
    id: `n${i}`,
    text: `Pending step ${i + 1}`,
    status: "pending" as const,
  })),
];

describe("TaskListCard", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(tasks: TaskItem[]) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = <TaskListCard tasks={tasks} />;
    act(() => {
      root.render(node);
    });
  }

  it("shows progress, strikethrough for finished items, and a burst for open work", () => {
    render(short);
    const card = host.querySelector("[data-testid='task-list']");
    expect(card?.getAttribute("role")).toBe("region");
    expect(card?.getAttribute("aria-label")).toBe("Task list, 1 of 4 Done");
    expect(host.querySelector("[data-testid='task-item-t1']")?.getAttribute("data-status")).toBe(
      "done",
    );
    expect(host.querySelector("[data-testid='task-item-t2']")?.getAttribute("data-status")).toBe(
      "in_progress",
    );
    expect(host.querySelector("[data-testid='task-item-t2']")?.getAttribute("aria-current")).toBe(
      "true",
    );
    expect(host.querySelector("[data-testid='task-item-t4']")?.getAttribute("data-status")).toBe(
      "cancelled",
    );
    expect(host.querySelector("[data-testid='task-list-view-all']")).toBeNull();
    expect(host.textContent).toContain("Patch the scanner");
  });

  it("previews a window around current work and expands on View All", () => {
    render(long);
    expect(host.querySelector("[data-testid='task-list']")?.textContent).toMatch(/12 of 39 Done/);
    expect(host.querySelector("[data-testid='task-item-p']")?.textContent).toContain(
      "Refactor firebird_component_types.hpp",
    );
    expect(host.querySelector("[data-testid='task-item-d0']")).toBeNull();
    expect(host.querySelectorAll("[data-testid^='task-item-']").length).toBe(6);
    const viewAll = host.querySelector("[data-testid='task-list-view-all']") as HTMLButtonElement;
    expect(viewAll.textContent).toBe("View All");
    expect(viewAll.getAttribute("aria-expanded")).toBe("false");
    act(() => {
      viewAll.click();
    });
    expect(host.querySelectorAll("[data-testid^='task-item-']").length).toBe(39);
    expect(host.querySelector("[data-testid='task-item-d0']")).toBeTruthy();
    expect(viewAll.textContent).toBe("Show less");
    expect(viewAll.getAttribute("aria-expanded")).toBe("true");
  });

  it("collapses the list body from the header toggle", () => {
    render(short);
    const toggle = host.querySelector("[data-testid='task-list-toggle']") as HTMLButtonElement;
    expect(host.querySelector("ul")).toBeTruthy();
    act(() => {
      toggle.click();
    });
    expect(host.querySelector("ul")).toBeNull();
    expect(host.querySelector("[data-testid='task-list']")?.textContent).toMatch(/1 of 4 Done/);
    act(() => {
      toggle.click();
    });
    expect(host.querySelector("ul")).toBeTruthy();
  });
});
