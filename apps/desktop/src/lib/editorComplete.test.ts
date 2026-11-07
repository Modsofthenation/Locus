import { describe, expect, it } from "vitest";
import {
  applyCompletion,
  completeAt,
  fromRemoteCompletion,
  mergeCompletions,
  shouldAutoComplete,
  tokenAt,
} from "./editorComplete";

describe("tokenAt", () => {
  it("finds identifiers, tags, and django tags", () => {
    expect(tokenAt("const x", 7)).toEqual({ prefix: "x", start: 6, trigger: "ident" });
    expect(tokenAt("<di", 3)).toEqual({ prefix: "di", start: 1, trigger: "tag" });
    expect(tokenAt("{% blo", 6)).toEqual({ prefix: "blo", start: 3, trigger: "django" });
  });
});

describe("shouldAutoComplete", () => {
  it("opens after two identifier chars, a dot, or a tag", () => {
    expect(shouldAutoComplete("co", 2)).toBe(true);
    expect(shouldAutoComplete("c", 1)).toBe(false);
    expect(shouldAutoComplete("msg.", 4)).toBe(true);
    expect(shouldAutoComplete("<s", 2)).toBe(true);
    expect(shouldAutoComplete("c", 1, true)).toBe(true);
  });
});

describe("completeAt", () => {
  it("suggests in-file words and JS snippets", () => {
    const items = completeAt({
      text: "function greet() {}\nconst x = gre",
      offset: 33,
      lang: "ts",
    });
    expect(items.some((item) => item.label === "greet")).toBe(true);
    const forced = completeAt({ text: "const x = 1;\n", offset: 0, lang: "ts", forced: true });
    expect(forced.some((item) => item.label === "log")).toBe(true);
  });

  it("suggests django tags after {% ", () => {
    const items = completeAt({ text: "{% blo", offset: 6, lang: "django" });
    expect(items.some((item) => item.label === "block")).toBe(true);
  });

  it("suggests extra Python snippets", () => {
    const items = completeAt({ text: "pyt", offset: 3, lang: "python" });
    expect(items.some((item) => item.label === "pytest")).toBe(true);
  });

  it("treats hyphenated CSS properties as one token and suggests properties", () => {
    expect(tokenAt("background-co", 13, "css")).toEqual({
      prefix: "background-co",
      start: 0,
      trigger: "ident",
    });
    expect(shouldAutoComplete("color:", 6, false, "css")).toBe(true);
    const items = completeAt({ text: "body { col", offset: 10, lang: "css" });
    expect(items.some((item) => item.label === "color")).toBe(true);
    const applied = applyCompletion(
      "body { background-co",
      20,
      { label: "background-color", insert: "background-color", kind: "keyword" },
      "  ",
      "",
      "css",
    );
    expect(applied.text).toBe("body { background-color");
  });
});

describe("mergeCompletions", () => {
  it("keeps language-server items first and drops duplicate labels", () => {
    const merged = mergeCompletions(
      [fromRemoteCompletion({ label: "greet", insert: "greet()", kind: "function", detail: "fn" })],
      [
        { label: "greet", insert: "greet", kind: "word", detail: "in file" },
        { label: "log", insert: "console.log($0)", kind: "snippet" },
      ],
    );
    expect(merged.map((item) => item.label)).toEqual(["greet", "log"]);
    expect(merged[0]?.kind).toBe("symbol");
    expect(merged[0]?.insert).toBe("greet()");
  });
});

describe("applyCompletion", () => {
  it("replaces the prefix and expands snippet placeholders", () => {
    const next = applyCompletion("co", 2, {
      label: "const",
      insert: "const",
      kind: "keyword",
    });
    expect(next).toEqual({ text: "const", start: 5, end: 5 });
    const snip = applyCompletion("lo", 2, {
      label: "log",
      insert: "console.log($0)",
      kind: "snippet",
    });
    expect(snip.text).toBe("console.log()");
    expect(snip.start).toBe("console.log(".length);
  });

  it("applies additional import edits above the caret", () => {
    const next = applyCompletion(
      "greetName()",
      9,
      {
        label: "greetName",
        insert: "greetName",
        kind: "symbol",
        additionalEdits: [
          {
            startLine: 0,
            startCharacter: 0,
            endLine: 0,
            endCharacter: 0,
            newText: 'import { greetName } from "./util.js";\n',
          },
        ],
      },
      "  ",
      "app.ts",
    );
    expect(next.text).toBe('import { greetName } from "./util.js";\ngreetName()');
  });
});
