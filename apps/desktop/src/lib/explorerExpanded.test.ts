import { describe, expect, it } from "vitest";
import {
  explorerExpandedKey,
  loadExplorerExpanded,
  saveExplorerExpanded,
} from "./explorerExpanded";

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

describe("explorerExpanded", () => {
  it("persists expanded folders per session", () => {
    const storage = memoryStore();
    saveExplorerExpanded("s1", ["src", "src/lib"], storage);
    saveExplorerExpanded("s2", ["apps"], storage);
    expect([...loadExplorerExpanded("s1", storage)]).toEqual(["src", "src/lib"]);
    expect([...loadExplorerExpanded("s2", storage)]).toEqual(["apps"]);
    expect(storage.getItem(explorerExpandedKey("s1"))).toBe(JSON.stringify(["src", "src/lib"]));
  });

  it("clears storage when nothing is expanded", () => {
    const storage = memoryStore();
    saveExplorerExpanded("s1", ["src"], storage);
    saveExplorerExpanded("s1", [], storage);
    expect(loadExplorerExpanded("s1", storage).size).toBe(0);
    expect(storage.getItem(explorerExpandedKey("s1"))).toBeNull();
  });

  it("ignores invalid JSON and quota errors", () => {
    const storage = memoryStore();
    storage.setItem(explorerExpandedKey("s1"), "{not json");
    expect(loadExplorerExpanded("s1", storage).size).toBe(0);
    const quota = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => saveExplorerExpanded("s1", ["src"], quota)).not.toThrow();
    expect(() => saveExplorerExpanded("s1", [], quota)).not.toThrow();
  });
});
