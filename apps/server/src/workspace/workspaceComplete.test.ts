import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  completeWorkspaceFile,
  fixWorkspaceFile,
  formatWorkspaceFile,
  inspectWorkspaceFile,
  listWorkspaceTsconfigs,
  navigateWorkspaceSymbols,
  offsetAtPosition,
  problemsWorkspaceFiles,
  referencesWorkspaceFile,
  resetWorkspaceComplete,
} from "./workspaceComplete.js";

let cleanup: string[] = [];
afterEach(async () => {
  resetWorkspaceComplete();
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanup.map((dir) => rm(dir, { recursive: true, force: true })));
  cleanup = [];
});

describe("offsetAtPosition", () => {
  it("maps LSP line/character onto a JS string offset", () => {
    expect(offsetAtPosition("ab\ncd", 1, 1)).toBe(4);
    expect(offsetAtPosition("ab", 0, 2)).toBe(2);
  });
});

describe("completeWorkspaceFile", () => {
  it("completes a TypeScript symbol from another file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-complete-ts-"));
    cleanup.push(dir);
    await writeFile(
      join(dir, "util.ts"),
      "export function greet(name: string) {\n  return name;\n}\n",
    );
    const content = 'import { greet } from "./util.js";\nconst n = gre';
    await writeFile(join(dir, "app.ts"), `${content}\n`);
    const result = await completeWorkspaceFile({
      root: dir,
      rel: "app.ts",
      content,
      line: 1,
      character: content.split("\n")[1]!.length,
    });
    expect(result.source).toBe("typescript");
    expect(result.items.some((item) => item.label === "greet")).toBe(true);
  });

  it("completes string members from the TypeScript language service", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-complete-member-"));
    cleanup.push(dir);
    const content = 'const msg = "hi";\nmsg.';
    await writeFile(join(dir, "app.ts"), `${content}\n`);
    const result = await completeWorkspaceFile({
      root: dir,
      rel: "app.ts",
      content,
      line: 1,
      character: 4,
    });
    expect(result.source).toBe("typescript");
    expect(result.items.map((item) => item.label)).toEqual(
      expect.arrayContaining(["toUpperCase", "slice"]),
    );
  });

  it("completes HTML tags", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-complete-html-"));
    cleanup.push(dir);
    await mkdir(join(dir, "templates"));
    const content = "<sec";
    const result = await completeWorkspaceFile({
      root: dir,
      rel: "templates/home.html",
      content,
      line: 0,
      character: content.length,
    });
    expect(result.source).toBe("html");
    expect(result.items.some((item) => item.label.toLowerCase().includes("section"))).toBe(true);
  });

  it("completes CSS properties", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-complete-css-"));
    cleanup.push(dir);
    const content = "body { col";
    const result = await completeWorkspaceFile({
      root: dir,
      rel: "app.css",
      content,
      line: 0,
      character: content.length,
    });
    expect(result.source).toBe("css");
    expect(result.items.some((item) => item.label === "color")).toBe(true);
  });

  it("completes Less and CSS inside an HTML style tag", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-complete-css-extra-"));
    cleanup.push(dir);
    const less = await completeWorkspaceFile({
      root: dir,
      rel: "theme.less",
      content: ".card { col",
      line: 0,
      character: 11,
    });
    expect(less.source).toBe("css");
    expect(less.items.some((item) => item.label === "color")).toBe(true);
    const html = "<style>.card { col";
    const nested = await completeWorkspaceFile({
      root: dir,
      rel: "index.html",
      content: html,
      line: 0,
      character: html.length,
    });
    expect(nested.source).toBe("css");
    expect(nested.items.some((item) => item.label === "color")).toBe(true);
  });

  it("does not run the SCSS language service on indented .sass files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-complete-sass-"));
    cleanup.push(dir);
    const content = ".card\n  col";
    const result = await completeWorkspaceFile({
      root: dir,
      rel: "theme.sass",
      content,
      line: 1,
      character: 5,
    });
    expect(result.source).toBe("none");
  });

  it("completes CSS in a style attribute, not el.style in a script", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-complete-style-attr-"));
    cleanup.push(dir);
    const attr = '<div style="col';
    const fromAttr = await completeWorkspaceFile({
      root: dir,
      rel: "index.html",
      content: attr,
      line: 0,
      character: attr.length,
    });
    expect(fromAttr.source).toBe("css");
    expect(fromAttr.items.some((item) => item.label === "color")).toBe(true);
    const script = '<script>el.style = "col';
    const fromScript = await completeWorkspaceFile({
      root: dir,
      rel: "index.html",
      content: script,
      line: 0,
      character: script.length,
    });
    expect(fromScript.source).toBe("html");
  });

  it("does not treat data-style as an inline CSS region", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-complete-data-style-"));
    cleanup.push(dir);
    const attr = '<div data-style="col';
    const fromAttr = await completeWorkspaceFile({
      root: dir,
      rel: "index.html",
      content: attr,
      line: 0,
      character: attr.length,
    });
    expect(fromAttr.source).toBe("html");
  });

  it("refuses path escape", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-complete-escape-"));
    cleanup.push(dir);
    const escaped = await completeWorkspaceFile({
      root: dir,
      rel: "../secret.ts",
      content: "const x = 1",
      line: 0,
      character: 6,
    });
    expect(escaped.source).toBe("none");
  });

  it("completes python via pylsp when available", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-complete-py-"));
    cleanup.push(dir);
    await writeFile(join(dir, "app.py"), "print(\n");
    const py = await completeWorkspaceFile({
      root: dir,
      rel: "app.py",
      content: "print(",
      line: 0,
      character: 6,
    });
    expect(["python", "none"]).toContain(py.source);
  }, 20_000);
});

describe("inspectWorkspaceFile", () => {
  it.skipIf(process.platform === "win32")("reports TypeScript diagnostics and hover", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-inspect-ts-"));
    cleanup.push(dir);
    const content = "const n: number = 'nope';\nconst x = n;\n";
    await writeFile(join(dir, "app.ts"), content);
    const result = await inspectWorkspaceFile({
      root: dir,
      rel: "app.ts",
      content,
      line: 1,
      character: 10,
    });
    expect(result.diagnostics.some((row) => row.severity === "error")).toBe(true);
    expect(result.hover?.text).toMatch(/number/);
  });

  it("reports CSS hover, diagnostics, and custom-property highlights", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-inspect-css-"));
    cleanup.push(dir);
    const content = [
      ":root { --accent: #111; }",
      "body { color: var(--accent); }",
      "div { colr: red; }",
      "",
    ].join("\n");
    await writeFile(join(dir, "app.css"), content);
    const hover = await inspectWorkspaceFile({
      root: dir,
      rel: "app.css",
      content,
      line: 1,
      character: 9,
    });
    expect(hover.hover?.text.toLowerCase()).toMatch(/color/);
    expect(hover.diagnostics.some((row) => /colr|unknown/i.test(row.message))).toBe(true);
    const onVar = await inspectWorkspaceFile({
      root: dir,
      rel: "app.css",
      content,
      line: 1,
      character: 20,
    });
    expect(onVar.highlights.length).toBeGreaterThan(0);
    expect(onVar.definition?.path).toBe("app.css");
  });

  it.skipIf(process.platform === "win32")(
    "returns type definition, implementation, and document highlights",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-inspect-nav-"));
      cleanup.push(dir);
      const content = [
        "interface Animal { speak(): string }",
        "class Dog implements Animal { speak() { return 'woof'; } }",
        "const pet: Animal = new Dog();",
        "pet.speak();",
        "",
      ].join("\n");
      await writeFile(join(dir, "app.ts"), content);
      const onPet = await inspectWorkspaceFile({
        root: dir,
        rel: "app.ts",
        content,
        line: 2,
        character: 6,
      });
      expect(onPet.typeDefinition?.path).toBe("app.ts");
      expect(onPet.highlights.some((row) => row.startLine === 2)).toBe(true);
      const onSpeak = await inspectWorkspaceFile({
        root: dir,
        rel: "app.ts",
        content,
        line: 3,
        character: 4,
      });
      expect(onSpeak.implementation?.path).toBe("app.ts");
      expect(onSpeak.implementation?.line).toBe(1);
    },
  );
});

describe("formatWorkspaceFile", () => {
  it("formats TypeScript via the language service", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-format-ts-"));
    cleanup.push(dir);
    await writeFile(join(dir, "app.ts"), "const x=1\n");
    const result = await formatWorkspaceFile({
      root: dir,
      rel: "app.ts",
      content: "const x=1",
    });
    expect(result.source).toBe("typescript");
    expect(result.content).toMatch(/const x = 1/);
  });

  it("does not return a truncated buffer for oversized files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-format-huge-"));
    cleanup.push(dir);
    const content = `${"const x = 1;\n".repeat(70_000)}const tail = 1;\n`;
    await writeFile(join(dir, "app.ts"), content);
    const result = await formatWorkspaceFile({
      root: dir,
      rel: "app.ts",
      content,
    });
    expect(result.source).toBe("none");
    expect(result.content.length).toBe(content.length);
    expect(result.content.endsWith("const tail = 1;\n")).toBe(true);
  });
});

describe("listWorkspaceTsconfigs", () => {
  it("finds nested package tsconfig.json files and skips tsconfig.build.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-tsconfigs-"));
    cleanup.push(dir);
    await mkdir(join(dir, "packages", "a"), { recursive: true });
    await mkdir(join(dir, "packages", "b"), { recursive: true });
    await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(dir, "tsconfig.json"), "{}\n");
    await writeFile(join(dir, "tsconfig.build.json"), "{}\n");
    await writeFile(join(dir, "packages", "a", "tsconfig.json"), "{}\n");
    await writeFile(join(dir, "packages", "b", "jsconfig.json"), "{}\n");
    await writeFile(join(dir, "node_modules", "pkg", "tsconfig.json"), "{}\n");
    const found = listWorkspaceTsconfigs(dir).map((path) => path.slice(dir.length + 1));
    expect(found).toEqual([
      "tsconfig.json",
      "packages/a/tsconfig.json",
      "packages/b/jsconfig.json",
    ]);
  });
});

describe("multi-project TypeScript complete", () => {
  it("completes a symbol from the owning package tsconfig, not a sibling", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-complete-mono-"));
    cleanup.push(dir);
    await mkdir(join(dir, "packages", "a"), { recursive: true });
    await mkdir(join(dir, "packages", "b"), { recursive: true });
    await writeFile(
      join(dir, "packages", "a", "tsconfig.json"),
      JSON.stringify({ include: ["./**/*.ts"] }),
    );
    await writeFile(
      join(dir, "packages", "b", "tsconfig.json"),
      JSON.stringify({ include: ["./**/*.ts"] }),
    );
    await writeFile(join(dir, "packages", "a", "hidden.ts"), "export const alphaOnly = 1;\n");
    await writeFile(join(dir, "packages", "b", "util.ts"), "export function betaGreet() {}\n");
    const content = 'import { betaGreet } from "./util.js";\nconst n = betaG';
    await writeFile(join(dir, "packages", "b", "app.ts"), `${content}\n`);
    const result = await completeWorkspaceFile({
      root: dir,
      rel: "packages/b/app.ts",
      content,
      line: 1,
      character: content.split("\n")[1]!.length,
    });
    expect(result.source).toBe("typescript");
    expect(result.items.some((item) => item.label === "betaGreet")).toBe(true);
    expect(result.items.some((item) => item.label === "alphaOnly")).toBe(false);
  });
});

describe("inspectWorkspaceFile signature help", () => {
  it.skipIf(process.platform === "win32")("returns signature help inside a call", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-sig-"));
    cleanup.push(dir);
    const content = "function greet(name: string, times: number) { return name; }\ngreet(";
    await writeFile(join(dir, "app.ts"), `${content}\n`);
    const result = await inspectWorkspaceFile({
      root: dir,
      rel: "app.ts",
      content,
      line: 1,
      character: 6,
    });
    expect(result.signature?.label).toMatch(/greet/);
    expect(result.signature?.parameters.map((row) => row.label).join(" ")).toMatch(/name/);
  });
});

describe("referencesWorkspaceFile", () => {
  it("finds references across files in the same project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-refs-"));
    cleanup.push(dir);
    await writeFile(join(dir, "util.ts"), "export function greet() { return 1; }\n");
    const content = 'import { greet } from "./util.js";\ngreet();\n';
    await writeFile(join(dir, "app.ts"), content);
    const result = await referencesWorkspaceFile({
      root: dir,
      rel: "app.ts",
      content,
      line: 1,
      character: 1,
    });
    expect(result.items.some((item) => item.path === "util.ts")).toBe(true);
    expect(result.items.some((item) => item.path === "app.ts")).toBe(true);
  });
});

describe("auto-import completions and quick fix", () => {
  it("attaches additional edits when completing an exported symbol", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-auto-import-"));
    cleanup.push(dir);
    await writeFile(
      join(dir, "util.ts"),
      "export function greetName(name: string) { return name; }\n",
    );
    const content = "const n = greetNa";
    await writeFile(join(dir, "app.ts"), `${content}\n`);
    const result = await completeWorkspaceFile({
      root: dir,
      rel: "app.ts",
      content,
      line: 0,
      character: content.length,
    });
    const hit = result.items.find((item) => item.label === "greetName");
    expect(hit).toBeTruthy();
    expect(hit?.additionalEdits?.some((edit) => /import/.test(edit.newText))).toBe(true);
  });

  it.skipIf(process.platform === "win32")("offers a missing-import quick fix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-fix-"));
    cleanup.push(dir);
    await writeFile(join(dir, "util.ts"), "export function greetName() { return 1; }\n");
    const content = "greetName();\n";
    await writeFile(join(dir, "app.ts"), content);
    const actions = fixWorkspaceFile({
      root: dir,
      rel: "app.ts",
      content,
      line: 0,
      character: 1,
    });
    expect(actions.some((action) => /import/i.test(action.title))).toBe(true);
    expect(
      actions[0]?.files.some((file) => file.path === "app.ts" && /import/.test(file.content)),
    ).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "offers a fix-all action for unused identifiers",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-fix-all-"));
      cleanup.push(dir);
      await writeFile(
        join(dir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { noUnusedLocals: true, strict: true } }),
      );
      const content = "const unusedA = 1;\nconst unusedB = 2;\nexport const keep = 3;\n";
      await writeFile(join(dir, "app.ts"), content);
      const actions = fixWorkspaceFile({
        root: dir,
        rel: "app.ts",
        content,
        line: 0,
        character: 6,
      });
      const all = actions.find((action) => action.fixAll);
      expect(all?.title).toMatch(/all/i);
      expect(all?.files.some((file) => !file.content.includes("unusedA"))).toBe(true);
      expect(all?.files.some((file) => !file.content.includes("unusedB"))).toBe(true);
      expect(all?.files.some((file) => file.content.includes("keep"))).toBe(true);
    },
  );

  it.skipIf(process.platform === "win32")("collects diagnostics across open files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-problems-"));
    cleanup.push(dir);
    const a = "const n: number = 'nope';\n";
    const b = "const ok = 1;\n";
    await writeFile(join(dir, "a.ts"), a);
    await writeFile(join(dir, "b.ts"), b);
    const result = await problemsWorkspaceFiles({
      root: dir,
      files: [
        { rel: "a.ts", content: a },
        { rel: "b.ts", content: b },
      ],
    });
    expect(result.diagnostics.some((row) => row.path === "a.ts" && row.severity === "error")).toBe(
      true,
    );
    expect(result.diagnostics.some((row) => row.path === "b.ts")).toBe(false);
  });

  it("collects CSS diagnostics from stylesheets and HTML style tags", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-problems-css-"));
    cleanup.push(dir);
    const css = "body { colr: red; }\n";
    const html = "<style>body { colr: red; }</style>\n";
    await writeFile(join(dir, "app.css"), css);
    await writeFile(join(dir, "index.html"), html);
    const result = await problemsWorkspaceFiles({
      root: dir,
      files: [
        { rel: "app.css", content: css },
        { rel: "index.html", content: html },
      ],
    });
    expect(result.diagnostics.some((row) => row.path === "app.css")).toBe(true);
    expect(result.diagnostics.some((row) => row.path === "index.html")).toBe(true);
  });
});

describe("web format", () => {
  it("formats html css and json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-format-web-"));
    cleanup.push(dir);
    const html = await formatWorkspaceFile({
      root: dir,
      rel: "index.html",
      content: "<div><span>Hi</span></div>",
    });
    expect(html.source).toBe("html");
    expect(html.content).toMatch(/<div>/);
    const css = await formatWorkspaceFile({
      root: dir,
      rel: "app.css",
      content: "body{color:red}",
    });
    expect(css.source).toBe("css");
    expect(css.content).toMatch(/color:\s*red/);
    const less = await formatWorkspaceFile({
      root: dir,
      rel: "theme.less",
      content: ".card{color:red}",
    });
    expect(less.source).toBe("css");
    expect(less.content).toMatch(/color:\s*red/);
    const json = await formatWorkspaceFile({
      root: dir,
      rel: "pkg.json",
      content: '{"a":1}',
    });
    expect(json.source).toBe("json");
    expect(json.content).toMatch(/"a": 1/);
  });
});

describe("navigateWorkspaceSymbols", () => {
  it("finds a TypeScript symbol by name", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-nav-sym-"));
    cleanup.push(dir);
    await writeFile(join(dir, "app.ts"), "export function foldOldTurns() { return 1; }\n");
    const result = navigateWorkspaceSymbols({ root: dir, query: "foldOld" });
    expect(result.items.some((item) => item.symbol.includes("foldOldTurns"))).toBe(true);
    expect(result.items[0]?.line).toBe(1);
    expect(result.items[0]?.path).toBe("app.ts");
  });

  it("searches symbols across package tsconfigs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-nav-mono-"));
    cleanup.push(dir);
    await mkdir(join(dir, "packages", "a"), { recursive: true });
    await mkdir(join(dir, "packages", "b"), { recursive: true });
    await writeFile(join(dir, "packages", "a", "tsconfig.json"), "{}\n");
    await writeFile(join(dir, "packages", "b", "tsconfig.json"), "{}\n");
    await writeFile(
      join(dir, "packages", "a", "one.ts"),
      "export function foldOldTurns() { return 1; }\n",
    );
    await writeFile(
      join(dir, "packages", "b", "two.ts"),
      "export function otherSymbol() { return 2; }\n",
    );
    const result = navigateWorkspaceSymbols({ root: dir, query: "otherSymbol" });
    expect(result.items.some((item) => item.path.includes("packages/b/two.ts"))).toBe(true);
  });
});
