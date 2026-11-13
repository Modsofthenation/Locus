import { describe, expect, it } from "vitest";
import { FIRST_TASKS } from "@locus/shared";
import { recentHostFolders, suggestFirstTasks } from "./firstTaskSuggest";

describe("suggestFirstTasks", () => {
  it("prefers the most recently active linked repo", () => {
    const tasks = suggestFirstTasks({
      repos: [
        { id: "r1", name: "old", lastFetchAt: "2026-01-01T00:00:00.000Z" },
        { id: "r2", name: "webapp", lastPushedAt: "2026-11-01T00:00:00.000Z" },
      ],
      hostFolders: ["/home/me/notes"],
    });
    expect(tasks.map((t) => t.title)).toEqual(["Explain webapp", "Fix a failing test in webapp"]);
    expect(tasks[0]!.target).toEqual({ kind: "repo", repoId: "r2", name: "webapp" });
    expect(tasks[0]!.prompt).toContain("read-only");
    expect(tasks[1]!.prompt).toContain("Do not commit or push");
  });

  it("falls back to a folder used on Host", () => {
    const tasks = suggestFirstTasks({ repos: [], hostFolders: ["/home/me/api/"] });
    expect(tasks[0]!.title).toBe("Explain api");
    expect(tasks[0]!.target).toEqual({ kind: "host", path: "/home/me/api/", name: "api" });
  });

  it("keeps the generic samples when there is nothing to work on", () => {
    const tasks = suggestFirstTasks({ repos: [], hostFolders: [] });
    expect(tasks.map((t) => t.id)).toEqual(FIRST_TASKS.map((t) => t.id));
    expect(tasks.every((t) => t.target.kind === "private")).toBe(true);
  });
});

describe("recentHostFolders", () => {
  it("orders Host folders newest first, last-used first, without duplicates", () => {
    const folders = recentHostFolders(
      [
        { runtime: "host", hostDir: "/a", updatedAt: "2026-01-01" },
        { runtime: "host", hostDir: "/b", updatedAt: "2026-03-01" },
        { runtime: "docker", hostDir: "/c", updatedAt: "2026-04-01" },
        { runtime: "host", hostDir: "/d", updatedAt: "2026-05-01", archived: true },
      ],
      "/a",
    );
    expect(folders).toEqual(["/a", "/b"]);
  });
});
