import { describe, expect, it } from "vitest";
import {
  BRAIN_VIEW_PREFS_KEY,
  loadBrainViewPrefs,
  rememberBrainInbox,
  saveBrainViewPrefs,
} from "./brainViewPrefs";

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

describe("brainViewPrefs", () => {
  it("defaults to graph + All", () => {
    expect(loadBrainViewPrefs(memoryStore())).toEqual({
      segment: "graph",
      repoKey: null,
      layout: "layers",
    });
  });

  it("persists segment and repo key", () => {
    const storage = memoryStore();
    saveBrainViewPrefs(
      { segment: "memories", repoKey: "https://github.com/acme/billing", layout: "radial" },
      storage,
    );
    expect(loadBrainViewPrefs(storage)).toEqual({
      segment: "memories",
      repoKey: "https://github.com/acme/billing",
      layout: "radial",
    });
  });

  it("ignores invalid payloads", () => {
    const storage = memoryStore();
    storage.setItem(BRAIN_VIEW_PREFS_KEY, "{not json");
    expect(loadBrainViewPrefs(storage)).toEqual({
      segment: "graph",
      repoKey: null,
      layout: "layers",
    });
    storage.setItem(
      BRAIN_VIEW_PREFS_KEY,
      JSON.stringify({ segment: "nope", repoKey: 3, layout: "spiral" }),
    );
    expect(loadBrainViewPrefs(storage)).toEqual({
      segment: "graph",
      repoKey: null,
      layout: "layers",
    });
  });

  it("remembers the inbox segment", () => {
    const storage = memoryStore();
    rememberBrainInbox(storage);
    expect(loadBrainViewPrefs(storage).segment).toBe("inbox");
  });
});
