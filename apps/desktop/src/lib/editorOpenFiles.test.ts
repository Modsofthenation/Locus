import { describe, expect, it } from "vitest";
import { editorOpenFilesKey, loadEditorOpenFiles, saveEditorOpenFiles } from "./editorOpenFiles";

function memoryStore() {
  const storage = new Map<string, string>();
  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  };
}

describe("editorOpenFiles", () => {
  it("persists open files and the active tab per session", () => {
    const storage = memoryStore();
    saveEditorOpenFiles("s1", ["src/app.ts", "package.json"], "package.json", storage);
    saveEditorOpenFiles("s2", ["README.md"], "README.md", storage);
    expect(loadEditorOpenFiles("s1", storage)).toEqual({
      paths: ["src/app.ts", "package.json"],
      active: "package.json",
    });
    expect(loadEditorOpenFiles("s2", storage)).toEqual({
      paths: ["README.md"],
      active: "README.md",
    });
    expect(storage.getItem(editorOpenFilesKey("s1"))).toBe(
      JSON.stringify({ paths: ["src/app.ts", "package.json"], active: "package.json" }),
    );
  });

  it("clears storage when nothing is open", () => {
    const storage = memoryStore();
    saveEditorOpenFiles("s1", ["src/app.ts"], "src/app.ts", storage);
    saveEditorOpenFiles("s1", [], "", storage);
    expect(loadEditorOpenFiles("s1", storage)).toEqual({ paths: [], active: "" });
    expect(storage.getItem(editorOpenFilesKey("s1"))).toBeNull();
  });

  it("drops duplicate paths and falls back when the active tab is missing", () => {
    const storage = memoryStore();
    saveEditorOpenFiles("s1", [" src/app.ts ", "src/app.ts", "package.json"], "gone.ts", storage);
    expect(loadEditorOpenFiles("s1", storage)).toEqual({
      paths: ["src/app.ts", "package.json"],
      active: "package.json",
    });
  });

  it("ignores invalid JSON and quota errors", () => {
    const storage = memoryStore();
    storage.setItem(editorOpenFilesKey("s1"), "{not json");
    expect(loadEditorOpenFiles("s1", storage)).toEqual({ paths: [], active: "" });
    const quota = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => saveEditorOpenFiles("s1", ["src/app.ts"], "src/app.ts", quota)).not.toThrow();
    expect(() => saveEditorOpenFiles("s1", [], "", quota)).not.toThrow();
  });

  it("persists a split editor beside the tab list", () => {
    const storage = memoryStore();
    const split = {
      groups: [
        { paths: ["src/app.ts", "package.json"], active: "src/app.ts" },
        { paths: ["README.md"], active: "README.md" },
      ] as [{ paths: string[]; active: string }, { paths: string[]; active: string }],
      focused: 1 as const,
      frac: 0.4,
    };
    saveEditorOpenFiles("s1", ["src/app.ts", "package.json"], "README.md", storage, split);
    expect(loadEditorOpenFiles("s1", storage)).toEqual({
      paths: ["src/app.ts", "package.json", "README.md"],
      active: "README.md",
      split,
    });
  });
});
