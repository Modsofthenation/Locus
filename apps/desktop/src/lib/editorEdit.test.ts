import { describe, expect, it } from "vitest";
import {
  applyEnter,
  applyTab,
  detectIndent,
  findMatches,
  offsetAtLine,
  offsetAtLineCol,
  offsetToLineCol,
  replaceAllMatches,
  replaceMatch,
  suggestedChildPath,
  toggleComment,
} from "./editorEdit";

describe("applyTab", () => {
  it("inserts indent at the cursor", () => {
    const next = applyTab("ab", 1, 1, "  ", false);
    expect(next).toEqual({ text: "a  b", start: 3, end: 3 });
  });

  it("indents and unindents a selected block", () => {
    const indented = applyTab("a\nb\n", 0, 3, "  ", false);
    expect(indented.text).toBe("  a\n  b\n");
    const out = applyTab(indented.text, 0, indented.text.length, "  ", true);
    expect(out.text).toBe("a\nb\n");
  });
});

describe("applyEnter", () => {
  it("keeps leading indent and adds a unit after an opener", () => {
    expect(applyEnter("  if x:\n", 7, "    ")).toEqual({
      text: "  if x:\n      \n",
      start: 14,
      end: 14,
    });
    expect(applyEnter("function f() {\n", 14, "  ").text).toBe("function f() {\n  \n");
  });
});

describe("toggleComment", () => {
  it("comments and uncomments TypeScript lines", () => {
    const on = toggleComment("const x = 1;\nconst y = 2;\n", 0, 13, "ts");
    expect(on.text).toMatch(/^\/\/ /);
    const off = toggleComment(on.text, on.start, on.end, "ts");
    expect(off.text).toBe("const x = 1;\nconst y = 2;\n");
  });

  it("wraps Django templates in template comments", () => {
    const on = toggleComment("<h1>{{ t }}</h1>", 0, 16, "django");
    expect(on.text).toBe("{# <h1>{{ t }}</h1> #}");
  });

  it("uses hash comments for env files and dashes for Lua", () => {
    const env = toggleComment("API=1\n", 0, 5, "ini");
    expect(env.text).toMatch(/^# /);
    const lua = toggleComment("return 1\n", 0, 8, "lua");
    expect(lua.text).toMatch(/^-- /);
    const xml = toggleComment("<root />", 0, 8, "xml");
    expect(xml.text).toBe("<!-- <root /> -->");
    const css = toggleComment("body { color: red; }", 0, 20, "css");
    expect(css.text).toBe("/* body { color: red; } */");
    const scss = toggleComment(".card { color: $fg; }\n", 0, 21, "scss");
    expect(scss.text).toMatch(/^\/\/ /);
    const md = toggleComment("# Title\nHello\n", 0, 7, "markdown");
    expect(md.text).toMatch(/^<!-- /);
    expect(md.text).toContain("# Title");
    expect(toggleComment("Hello", 0, 5, "markdown").text).toBe("<!-- Hello -->");
  });
});

describe("find and replace", () => {
  it("finds case-insensitive matches and replaces one then all", () => {
    const text = "Foo foo FOO";
    expect(findMatches(text, "foo")).toEqual([0, 4, 8]);
    const one = replaceMatch(text, 4, "foo", "bar");
    expect(one.text).toBe("Foo bar FOO");
    expect(replaceAllMatches(text, "Foo", "x").text).toBe("x x x");
  });
});

describe("line helpers", () => {
  it("maps offsets and line numbers", () => {
    expect(offsetToLineCol("a\nbc", 3)).toEqual({ line: 2, col: 2 });
    expect(offsetAtLine("a\nbc\nd", 2)).toBe(2);
    expect(offsetAtLine("a\nbc\nd", 3)).toBe(5);
    expect(offsetAtLineCol("a\nbc", 1, 1)).toBe(3);
    expect(offsetToLineCol("a\nbc", 3)).toEqual({ line: 2, col: 2 });
  });

  it("detects indent from the file", () => {
    expect(detectIndent("def f():\n    return 1\n", "python")).toBe("    ");
    expect(detectIndent("function f() {\n  return 1;\n}\n", "ts")).toBe("  ");
    const padded = `${"  const x = 1;\n"}${"x".repeat(20_000)}\n`;
    expect(detectIndent(padded, "ts")).toBe("  ");
  });

  it("joins a new file under the current folder", () => {
    expect(suggestedChildPath("src", "app.ts")).toBe("src/app.ts");
    expect(suggestedChildPath("", "README.md")).toBe("README.md");
    expect(suggestedChildPath("src", "../etc/passwd")).toBe("src/etc/passwd");
  });
});
