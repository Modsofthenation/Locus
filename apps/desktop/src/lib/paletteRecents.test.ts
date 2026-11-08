import { describe, expect, it } from "vitest";
import { loadPaletteRecents, rememberPaletteRecent } from "./paletteRecents";

function memory(): Pick<Storage, "getItem" | "setItem"> {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe("palette recents", () => {
  it("stores unique ids newest first", () => {
    const storage = memory();
    rememberPaletteRecent("new-agent", storage);
    rememberPaletteRecent("settings:git", storage);
    rememberPaletteRecent("new-agent", storage);
    expect(loadPaletteRecents(storage)).toEqual(["new-agent", "settings:git"]);
  });
});
