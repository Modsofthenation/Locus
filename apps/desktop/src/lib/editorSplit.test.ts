import { describe, expect, it } from "vitest";
import {
  activateInGroup,
  allSplitPaths,
  clampEditorSplit,
  closeInGroup,
  closeOthersInFocused,
  closeSavedInFocused,
  EDITOR_SPLIT_DEFAULT,
  EDITOR_SPLIT_MAX,
  EDITOR_SPLIT_MIN,
  editorSplitColumns,
  focusedPath,
  joinEditor,
  openInFocused,
  otherPath,
  parseEditorSplit,
  remapSplitPath,
  splitEditor,
} from "./editorSplit";

describe("splitEditor", () => {
  it("copies the active file into a focused right group", () => {
    const split = splitEditor(["src/app.ts", "package.json"], "src/app.ts");
    expect(split).toEqual({
      groups: [
        { paths: ["src/app.ts", "package.json"], active: "src/app.ts" },
        { paths: ["src/app.ts"], active: "src/app.ts" },
      ],
      focused: 1,
      frac: EDITOR_SPLIT_DEFAULT,
    });
    expect(focusedPath(split!)).toBe("src/app.ts");
    expect(otherPath(split!)).toBe("src/app.ts");
  });

  it("returns null when nothing is open", () => {
    expect(splitEditor([], "")).toBeNull();
    expect(splitEditor(["  "], "  ")).toBeNull();
  });
});

describe("open and close groups", () => {
  it("opens a different file in the focused group without touching the other", () => {
    const split = splitEditor(["src/app.ts", "package.json"], "src/app.ts")!;
    const next = openInFocused(split, "package.json");
    expect(next.groups[1]).toEqual({
      paths: ["src/app.ts", "package.json"],
      active: "package.json",
    });
    expect(next.groups[0]).toEqual(split.groups[0]);
    expect(focusedPath(next)).toBe("package.json");
    expect(otherPath(next)).toBe("src/app.ts");
  });

  it("returns the same split when the focused path is already open", () => {
    const split = splitEditor(["src/app.ts"], "src/app.ts")!;
    expect(openInFocused(split, "src/app.ts")).toBe(split);
    expect(activateInGroup(split, 1, "src/app.ts")).toBe(split);
  });

  it("activates a tab in the other group and moves focus", () => {
    const split = openInFocused(
      splitEditor(["src/app.ts", "package.json"], "src/app.ts")!,
      "README.md",
    );
    const next = activateInGroup(split, 0, "package.json");
    expect(next.focused).toBe(0);
    expect(focusedPath(next)).toBe("package.json");
    expect(next.groups[1].active).toBe("README.md");
  });

  it("drops a buffer only when the last group tab closes", () => {
    const split = openInFocused(splitEditor(["src/app.ts"], "src/app.ts")!, "package.json");
    const stillShared = closeInGroup(split, 1, "src/app.ts");
    expect(stillShared.dropBuffer).toBe(false);
    expect(stillShared.split?.groups[1].paths).toEqual(["package.json"]);
    const last = closeInGroup(stillShared.split!, 1, "package.json");
    expect(last.split).toBeNull();
    expect(last.dropBuffer).toBe(true);
    expect(last.active).toBe("src/app.ts");
  });

  it("joins when the last tab in a group closes and keeps the other file", () => {
    const split = splitEditor(["src/app.ts"], "src/app.ts")!;
    const next = closeInGroup(split, 1, "src/app.ts");
    expect(next.split).toBeNull();
    expect(next.dropBuffer).toBe(false);
    expect(next.active).toBe("src/app.ts");
  });

  it("close others keeps only the focused tab in that group", () => {
    const split = openInFocused(splitEditor(["a.ts", "b.ts"], "a.ts")!, "b.ts");
    expect(closeOthersInFocused(split).groups[1]).toEqual({ paths: ["b.ts"], active: "b.ts" });
    expect(closeOthersInFocused(split).groups[0].paths).toEqual(["a.ts", "b.ts"]);
  });

  it("close saved drops clean tabs that are not open in the other group", () => {
    const split = openInFocused(splitEditor(["a.ts"], "a.ts")!, "side.ts");
    const next = closeSavedInFocused(split, new Set());
    expect(next.split?.groups[1]).toEqual({ paths: ["side.ts"], active: "side.ts" });
    expect(next.drop).toEqual([]);
    const after = closeSavedInFocused(openInFocused(split, "only.ts"), new Set());
    expect(after.split?.groups[1].paths).toEqual(["only.ts"]);
    expect(after.drop).toEqual(["side.ts"]);
  });
});

describe("join and persist", () => {
  it("joins unique tabs and keeps the focused file", () => {
    const split = openInFocused(splitEditor(["src/app.ts"], "src/app.ts")!, "package.json");
    expect(joinEditor(split)).toEqual({
      paths: ["src/app.ts", "package.json"],
      active: "package.json",
    });
    expect(allSplitPaths(split)).toEqual(["src/app.ts", "package.json"]);
  });

  it("clamps the gutter fraction and emits grid columns", () => {
    expect(clampEditorSplit(Number.NaN)).toBe(EDITOR_SPLIT_DEFAULT);
    expect(clampEditorSplit(0.01)).toBe(EDITOR_SPLIT_MIN);
    expect(clampEditorSplit(0.99)).toBe(EDITOR_SPLIT_MAX);
    expect(editorSplitColumns(0.4)).toBe("minmax(160px, 0.4fr) 6px minmax(160px, 0.6fr)");
  });

  it("parses persisted groups and remaps moved paths", () => {
    const parsed = parseEditorSplit({
      groups: [
        { paths: ["src/app.ts"], active: "src/app.ts" },
        { paths: ["package.json"], active: "package.json" },
      ],
      focused: 1,
      frac: 0.41,
    });
    expect(parsed?.focused).toBe(1);
    expect(parsed?.frac).toBe(0.41);
    expect(remapSplitPath(parsed!, "src/app.ts", "src/main.ts").groups[0].active).toBe(
      "src/main.ts",
    );
  });

  it("ignores invalid persisted split payloads", () => {
    expect(parseEditorSplit(null)).toBeNull();
    expect(parseEditorSplit({ groups: [] })).toBeNull();
    expect(parseEditorSplit({ groups: [{ paths: [] }, { paths: [] }] })).toBeNull();
  });
});
