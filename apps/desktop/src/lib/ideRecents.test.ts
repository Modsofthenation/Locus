import { describe, expect, it } from "vitest";
import { loadIdeRecents, rememberIdeRecent } from "./ideRecents";
import { loadEditorDrafts, saveEditorDrafts } from "./editorDrafts";

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

describe("ideRecents", () => {
  it("remembers folders newest first", () => {
    const storage = memoryStore();
    rememberIdeRecent("/tmp/a", "a", storage);
    rememberIdeRecent("/tmp/b", "b", storage);
    rememberIdeRecent("/tmp/a", "a", storage);
    expect(loadIdeRecents(storage).map((row) => row.path)).toEqual(["/tmp/a", "/tmp/b"]);
  });
});

describe("editorDrafts", () => {
  it("persists unsaved buffers per session", () => {
    const storage = memoryStore();
    saveEditorDrafts("s1", { "src/app.ts": "const x = 1;" }, storage);
    expect(loadEditorDrafts("s1", storage)).toEqual({ "src/app.ts": "const x = 1;" });
    saveEditorDrafts("s1", {}, storage);
    expect(loadEditorDrafts("s1", storage)).toEqual({});
  });

  it("ignores localStorage quota errors", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => saveEditorDrafts("s1", { "a.ts": "x" }, storage)).not.toThrow();
    expect(() => rememberIdeRecent("/tmp/a", "a", storage)).not.toThrow();
  });
});
