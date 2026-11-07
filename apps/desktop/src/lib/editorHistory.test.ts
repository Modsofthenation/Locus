import { describe, expect, it } from "vitest";
import { EditHistory, remapEditSnapshots, remapWorkspacePath } from "./editorHistory";

describe("remapWorkspacePath", () => {
  it("rewrites a file and nested children", () => {
    expect(remapWorkspacePath("src/a.ts", "src/a.ts", "lib/a.ts")).toBe("lib/a.ts");
    expect(remapWorkspacePath("src/a/b.ts", "src/a", "lib/a")).toBe("lib/a/b.ts");
    expect(remapWorkspacePath("src/z.ts", "src/a", "lib/a")).toBe("src/z.ts");
  });
});

describe("EditHistory", () => {
  it("pushes undo, clears redo, and remaps both stacks", () => {
    const hist = new EditHistory();
    hist.push({ path: "a.ts", text: "one", start: 0, end: 0 });
    const snap = hist.popUndo();
    expect(snap?.text).toBe("one");
    hist.pushRedo({ path: "a.ts", text: "two", start: 1, end: 1 });
    hist.remapPaths("a.ts", "b.ts");
    expect(hist.undo.map((s) => s.path)).toEqual([]);
    expect(hist.redo.map((s) => s.path)).toEqual(["b.ts"]);
    expect(
      remapEditSnapshots([{ path: "a/x", text: "", start: 0, end: 0 }], "a", "b")[0]?.path,
    ).toBe("b/x");
  });

  it("coalesces typing inside the window and splits after it", () => {
    const hist = new EditHistory();
    const snap = { path: "a.ts", text: "a", start: 1, end: 1 };
    expect(hist.recordTyping(snap, "a.ts", 1000)).toBe(true);
    expect(hist.recordTyping(snap, "a.ts", 1400)).toBe(false);
    expect(hist.recordTyping(snap, "a.ts", 1901)).toBe(true);
    expect(hist.undo).toHaveLength(2);
  });
});
