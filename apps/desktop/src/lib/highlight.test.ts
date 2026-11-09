import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  highlightDocument,
  highlightSource,
  highlightVisible,
  languageFromPath,
  resolveLanguage,
  wrapHighlightLines,
} from "./highlight";

describe("highlightSource", () => {
  it("maps common paths and aliases", () => {
    expect(languageFromPath("src/app.ts")).toBe("ts");
    expect(languageFromPath("pkg/main.go")).toBe("go");
    expect(languageFromPath("Dockerfile")).toBe("docker");
    expect(languageFromPath("a.yml")).toBe("yaml");
    expect(languageFromPath("app/mcp/tests/test_tool_forensics.py")).toBe("python");
    expect(resolveLanguage("tsx")).toBe("tsx");
    expect(languageFromPath("src/App.tsx")).toBe("tsx");
    expect(languageFromPath("src/App.jsx")).toBe("jsx");
    expect(languageFromPath("templates/home.j2")).toBe("django");
    expect(resolveLanguage("py")).toBe("python");
    expect(languageFromPath("README")).toBe("");
    expect(languageFromPath("AndroidManifest.xml")).toBe("xml");
    expect(languageFromPath("assets/logo.svg")).toBe("xml");
    expect(languageFromPath(".env")).toBe("ini");
    expect(languageFromPath(".env.local")).toBe("ini");
    expect(languageFromPath(".gitignore")).toBe("gitignore");
    expect(languageFromPath(".dockerignore")).toBe("gitignore");
    expect(languageFromPath("schema.graphql")).toBe("graphql");
    expect(languageFromPath("api.proto")).toBe("proto");
    expect(languageFromPath("main.tf")).toBe("hcl");
    expect(languageFromPath("init.lua")).toBe("lua");
    expect(languageFromPath("lib/main.dart")).toBe("dart");
    expect(languageFromPath("setup.ps1")).toBe("powershell");
    expect(languageFromPath("build.gradle")).toBe("groovy");
    expect(languageFromPath("Jenkinsfile")).toBe("jenkins");
    expect(languageFromPath("Jenkinsfile.prod")).toBe("jenkins");
    expect(languageFromPath("deploy.jenkinsfile")).toBe("jenkins");
    expect(languageFromPath("scripts/build.sh")).toBe("bash");
    expect(languageFromPath(".bashrc")).toBe("bash");
    expect(languageFromPath(".zshrc")).toBe("bash");
    expect(languageFromPath(".github/workflows/ci.yml")).toBe("yaml");
    expect(languageFromPath("src/main.c")).toBe("c");
    expect(languageFromPath("src/lib.rs")).toBe("rust");
    expect(languageFromPath("schema.prisma")).toBe("prisma");
    expect(languageFromPath("CMakeLists.txt")).toBe("cmake");
    expect(languageFromPath("go.mod")).toBe("gomod");
    expect(languageFromPath("Gemfile")).toBe("ruby");
    expect(languageFromPath("src/app.mts")).toBe("ts");
    expect(languageFromPath("bundle.js.map")).toBe("json");
    expect(languageFromPath("README.md")).toBe("markdown");
    expect(languageFromPath("src/app.css")).toBe("css");
    expect(languageFromPath("src/app.module.css")).toBe("css");
    expect(languageFromPath("src/app.scss")).toBe("scss");
    expect(languageFromPath("src/app.sass")).toBe("scss");
    expect(languageFromPath("src/app.less")).toBe("less");
    expect(languageFromPath("src/app.pcss")).toBe("css");
    expect(resolveLanguage("scss")).toBe("scss");
    expect(resolveLanguage("less")).toBe("less");
    expect(resolveLanguage("sass")).toBe("scss");
  });

  it("highlights keywords, strings, comments, and numbers", () => {
    const html = highlightSource('const x = "hi"; // note\n1 + 2', "ts");
    expect(html).toContain('<span class="tok-kw">const</span>');
    expect(html).toContain('<span class="tok-str">"hi"</span>');
    expect(html).toContain('<span class="tok-cm">// note</span>');
    expect(html).toContain('<span class="tok-num">1</span>');
  });

  it("escapes HTML in code", () => {
    const html = highlightSource("<script>alert(1)</script>", "js");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("highlights python and sql without treating strings as keywords", () => {
    expect(highlightSource("def foo():\n    return 1", "python")).toContain(
      '<span class="tok-kw">def</span>',
    );
    expect(highlightSource("SELECT * FROM t", "sql")).toContain(
      '<span class="tok-kw">SELECT</span>',
    );
    expect(highlightSource('"return"', "python")).toContain(
      '<span class="tok-str">"return"</span>',
    );
    expect(highlightSource('"return"', "python")).not.toContain("tok-kw");
  });

  it("colors python types, decorators, calls, builtins, and f-strings", () => {
    const html = highlightSource(
      [
        "from django.test import TestCase",
        "from unittest.mock import patch",
        "",
        "class McpForensicsToolTests(TestCase):",
        "    @classmethod",
        "    def setUpTestData(cls):",
        '        cls.user = get_user_model().objects.create(username="a")',
        '        name = f"user {cls.user.id}"',
      ].join("\n"),
      "python",
    );
    expect(html).toContain('<span class="tok-kw">from</span>');
    expect(html).toContain('<span class="tok-kw">import</span>');
    expect(html).toContain('<span class="tok-type" data-symbol="TestCase">TestCase</span>');
    expect(html).toContain(
      '<span class="tok-type" data-symbol="McpForensicsToolTests">McpForensicsToolTests</span>',
    );
    expect(html).toContain('<span class="tok-dec">@classmethod</span>');
    expect(html).toContain('<span class="tok-kw">def</span>');
    expect(html).toContain('<span class="tok-fn" data-symbol="setUpTestData">setUpTestData</span>');
    expect(html).toContain('<span class="tok-bi">cls</span>');
    expect(html).toContain(
      '<span class="tok-fn" data-symbol="get_user_model">get_user_model</span>',
    );
    expect(html).toContain('<span class="tok-attr">objects</span>');
    expect(html).toContain('<span class="tok-fn" data-symbol="create">create</span>');
    expect(html).toContain('<span class="tok-str">f"user </span>');
    expect(html).toContain('<span class="tok-attr">user</span>');
    expect(html).toContain('<span class="tok-attr">id</span>');
    expect(highlightSource('r = "plain"', "python")).toContain(
      '<span class="tok-str">"plain"</span>',
    );
    expect(highlightSource('r = "plain"', "python")).not.toContain('tok-str">r');
  });

  it("colors function and class names in TypeScript", () => {
    const html = highlightSource("class Foo { bar() { return 1 } }", "ts");
    expect(html).toContain('<span class="tok-kw">class</span>');
    expect(html).toContain('<span class="tok-type" data-symbol="Foo">Foo</span>');
    expect(html).toContain('<span class="tok-fn" data-symbol="bar">bar</span>');
  });

  it("highlights xml, env, graphql, and other newly mapped languages", () => {
    const xml = highlightSource('<manifest package="app"><activity /></manifest>', "xml");
    expect(xml).toContain('<span class="tok-kw">manifest</span>');
    expect(xml).toContain('<span class="tok-str">"app"</span>');
    const env = highlightSource('API_URL="https://x"\n# secret\nDEBUG=true\n', "ini");
    expect(env).toContain('<span class="tok-cm"># secret</span>');
    expect(env).toContain('<span class="tok-kw">true</span>');
    expect(env).toContain('<span class="tok-str">"https://x"</span>');
    const gql = highlightSource("type User { name: String }", "graphql");
    expect(gql).toContain('<span class="tok-kw">type</span>');
    expect(gql).toContain('<span class="tok-type" data-symbol="User">User</span>');
    const proto = highlightSource("message Ping { rpc Send(); }", "proto");
    expect(proto).toContain('<span class="tok-kw">message</span>');
    expect(proto).toContain('<span class="tok-type" data-symbol="Ping">Ping</span>');
    const hcl = highlightSource('resource "aws_s3_bucket" "b" { count = 1 }', "hcl");
    expect(hcl).toContain('<span class="tok-kw">resource</span>');
    const lua = highlightSource("local function foo() return 1 end", "lua");
    expect(lua).toContain('<span class="tok-kw">local</span>');
    expect(lua).toContain('<span class="tok-kw">function</span>');
    expect(lua).toContain('<span class="tok-fn" data-symbol="foo">foo</span>');
    const dart = highlightSource("class App { void main() {} }", "dart");
    expect(dart).toContain('<span class="tok-kw">class</span>');
    expect(dart).toContain('<span class="tok-type" data-symbol="App">App</span>');
    expect(dart).toContain('<span class="tok-fn" data-symbol="main">main</span>');
    const ps = highlightSource("If ($true) { Write-Host 'ok' }", "powershell");
    expect(ps).toContain('<span class="tok-kw">If</span>');
    expect(ps).toContain('<span class="tok-kw">$true</span>');
    const prisma = highlightSource("model User {\n  id String @id\n}", "prisma");
    expect(prisma).toContain('<span class="tok-kw">model</span>');
    expect(prisma).toContain('<span class="tok-type" data-symbol="User">User</span>');
    expect(prisma).toContain('<span class="tok-dec">@id</span>');
    const ignore = highlightSource("node_modules/\n# keep\n*.log\n", "gitignore");
    expect(ignore).toContain('<span class="tok-cm"># keep</span>');
    expect(ignore).toContain("node_modules/");
    const md = highlightSource("# Title\nHello\n", "markdown");
    expect(md).toContain('<span class="tok-cm"># Title</span>');
  });

  it("highlights bash, yaml, Jenkinsfile, C, and Rust", () => {
    const sh = highlightSource('if true; then\n  echo "ok"\nfi\nfunction greet() { :; }\n', "bash");
    expect(sh).toContain('<span class="tok-kw">if</span>');
    expect(sh).toContain('<span class="tok-kw">then</span>');
    expect(sh).toContain('<span class="tok-bi">echo</span>');
    expect(sh).toContain('<span class="tok-fn" data-symbol="greet">greet</span>');
    const yml = highlightSource(
      "name: ci\nurl: http://example.com\nruns-on: ubuntu-latest\ntrue: yes\n",
      "yaml",
    );
    expect(yml).toContain('<span class="tok-attr">name</span>');
    expect(yml).toContain('<span class="tok-attr">url</span>');
    expect(yml).toContain('<span class="tok-attr">runs-on</span>');
    expect(yml).toContain("http://example.com");
    expect(yml).not.toContain('<span class="tok-attr">http</span>');
    expect(yml).toContain('<span class="tok-kw">true</span>');
    const jenkins = highlightSource(
      "pipeline {\n  agent any\n  stages { stage('Build') { steps { sh 'make' } } }\n}\n",
      "jenkins",
    );
    expect(jenkins).toContain('<span class="tok-kw">pipeline</span>');
    expect(jenkins).toContain('<span class="tok-kw">agent</span>');
    expect(jenkins).toContain('<span class="tok-kw">stages</span>');
    expect(jenkins).toContain('<span class="tok-kw">sh</span>');
    const c = highlightSource('#include "stdio.h"\nint main(void) { return 0; }\n', "c");
    expect(c).toContain('<span class="tok-dec">#include</span>');
    expect(c).toContain('<span class="tok-kw">int</span>');
    expect(c).toContain('<span class="tok-fn" data-symbol="main">main</span>');
    const rs = highlightSource(
      "#[derive(Debug)]\npub fn run() -> Result<(), dyn Error> {}\n",
      "rust",
    );
    expect(rs).toContain('<span class="tok-dec">#[derive(Debug)]</span>');
    expect(rs).toContain('<span class="tok-kw">fn</span>');
    expect(rs).toContain('<span class="tok-fn" data-symbol="run">run</span>');
    expect(rs).toContain('<span class="tok-kw">dyn</span>');
  });

  it("highlights CSS selectors, properties, at-rules, and colors", () => {
    const css = highlightSource(
      [
        "/* theme */",
        ":root { --accent: #1f6b4a; }",
        "@media (min-width: 40rem) {",
        "  .card:hover, #hero {",
        "    color: rgb(0, 0, 0);",
        "    background: url(/hero.png);",
        "    display: flex;",
        "    padding: 8px !important;",
        "  }",
        "}",
      ].join("\n"),
      "css",
    );
    expect(css).toContain('<span class="tok-cm">/* theme */</span>');
    expect(css).toContain('<span class="tok-kw">:root</span>');
    expect(css).toContain('<span class="tok-dec">--accent</span>');
    expect(css).toContain('<span class="tok-num">#1f6b4a</span>');
    expect(css).toContain('<span class="tok-dec">@media</span>');
    expect(css).toContain('<span class="tok-attr">min-width</span>');
    expect(css).toContain('<span class="tok-type" data-symbol=".card">.card</span>');
    expect(css).toContain('<span class="tok-kw">:hover</span>');
    expect(css).toContain('<span class="tok-type" data-symbol="#hero">#hero</span>');
    expect(css).toContain('<span class="tok-attr">color</span>');
    expect(css).toContain('<span class="tok-fn" data-symbol="rgb">rgb</span>');
    expect(css).toContain('<span class="tok-fn" data-symbol="url">url</span>');
    expect(css).toContain('<span class="tok-kw">flex</span>');
    expect(css).toContain('<span class="tok-num">8px</span>');
    expect(css).toContain('<span class="tok-kw">!important</span>');
  });

  it("highlights SCSS, Less, and CSS inside HTML", () => {
    const scss = highlightSource(
      "$size: 1rem;\n.card {\n  // note\n  color: $size;\n  &:hover { color: #{ $size }; }\n}\n",
      "scss",
    );
    expect(scss).toContain('<span class="tok-dec">$size</span>');
    expect(scss).toContain('<span class="tok-cm">// note</span>');
    expect(scss).toContain('<span class="tok-kw">&amp;</span>');
    expect(scss).toContain('<span class="tok-dec">#{</span>');
    const less = highlightSource("@color: #111;\n.a { color: @{color}; }\n", "less");
    expect(less).toContain('<span class="tok-dec">@color</span>');
    expect(less).toContain('<span class="tok-dec">@{color}</span>');
    const html = highlightSource(
      '<div style="color: red"><style>.x { display: grid; }</style></div>',
      "html",
    );
    expect(html).toContain('<span class="tok-attr">color</span>');
    expect(html).toContain('<span class="tok-kw">style</span>');
    expect(html).toContain('<span class="tok-type" data-symbol=".x">.x</span>');
    expect(html).toContain('<span class="tok-attr">display</span>');
    expect(html).toContain('<span class="tok-kw">grid</span>');
  });

  it("colors JSX tags and Django template tags", () => {
    const jsx = highlightSource(
      "export function App() { return <main className='x'>{title}</main>; }",
      "tsx",
    );
    expect(jsx).toContain('<span class="tok-kw">function</span>');
    expect(jsx).toContain('<span class="tok-fn" data-symbol="App">App</span>');
    expect(jsx).toContain('<span class="tok-kw">main</span>');
    const django = highlightSource(
      "{% extends 'base.html' %}\n<h1>{{ title }}</h1>\n{# note #}",
      "django",
    );
    expect(django).toContain('<span class="tok-kw">extends</span>');
    expect(django).toContain('<span class="tok-kw">h1</span>');
    expect(django).toContain('<span class="tok-cm">{# note #}</span>');
    expect(django).toContain('<span class="tok-dec">{{</span>');
  });

  it("reuses the same html for repeated short snippets", () => {
    const first = highlightSource("const x = 1;", "ts");
    const second = highlightSource("const x = 1;", "ts");
    expect(second).toBe(first);
    expect(highlightSource("const x = 1;", "sql")).not.toBe(first);
  });

  it("does not let highlight spans cross newlines", () => {
    const html = highlightSource("/*\ncomment\n*/", "js");
    for (const line of html.split("\n")) {
      expect(line.match(/<span/g)?.length ?? 0).toBe(line.match(/<\/span>/g)?.length ?? 0);
    }
  });
});

describe("wrapHighlightLines", () => {
  it("marks added lines after a whole-file highlight", () => {
    const html = wrapHighlightLines(
      highlightSource("const a = 1;\nconst b = 2;", "ts"),
      new Set([2]),
    );
    expect(html).toContain('class="workspace-line add"');
    expect(html).toContain("workspace-line add");
    expect(html).toMatch(/tok-kw">const<\/span> b/);
    expect(html.split("\n")).toHaveLength(2);
    expect(html).not.toMatch(/<\/span>\n<span/);
  });
});

function ossTsModule(lines: number): string {
  const out: string[] = [
    'import { useMemo, useState } from "react";',
    "export type Item = { id: string; n: number };",
  ];
  for (let i = 0; i < lines - 4; i += 1) {
    const kind = i % 8;
    if (kind === 0) out.push(`/** Widget ${i} handles the ${i} path. */`);
    else if (kind === 1) out.push(`export function widget${i}(item: Item): number {`);
    else if (kind === 2) out.push(`  const n = item.n + ${i};`);
    else if (kind === 3) out.push("  if (n > 10) return n * 2;");
    else if (kind === 4) out.push("  return Math.max(n, item.id.length);");
    else if (kind === 5) out.push("}");
    else if (kind === 6) out.push("");
    else out.push(`const k${i} = "value-${i}";`);
  }
  out.push("export const all = true;");
  return `${out.join("\n")}\n`;
}

describe("highlightDocument", () => {
  it("reuses unchanged line html when a single identifier is edited", () => {
    const code = "export function foo() {\n  return 1;\n}\n";
    const first = highlightDocument(code, "ts");
    const next = highlightDocument(code.replace("return 1", "return 12"), "ts", first);
    expect(next.html[0]).toBe(first.html[0]);
    expect(next.html[1]).toContain("12");
    expect(next.html[1]).not.toBe(first.html[1]);
  });

  it("keeps surrounding line html when a line is inserted or removed", () => {
    const code = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
    const first = highlightDocument(code, "ts");
    const inserted = highlightDocument(
      "const a = 1;\nconst x = 0;\nconst b = 2;\nconst c = 3;\n",
      "ts",
      first,
    );
    expect(inserted.html).toHaveLength(5);
    expect(inserted.html[0]).toBe(first.html[0]);
    expect(inserted.html[2]).toBe(first.html[1]);
    expect(inserted.html[3]).toBe(first.html[2]);
    const removed = highlightDocument("const a = 1;\nconst c = 3;\n", "ts", first);
    expect(removed.html).toHaveLength(3);
    expect(removed.html[0]).toBe(first.html[0]);
    expect(removed.html[1]).toBe(first.html[2]);
  });

  it("keeps typing on large TypeScript files cheaper than a full re-highlight", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoFile = readFileSync(join(here, "highlight.ts"), "utf8");
    const generated = ossTsModule(2_400);
    for (const [label, code] of [
      ["highlight.ts", repoFile],
      ["generated widget module", generated],
    ] as const) {
      const fullStart = performance.now();
      const first = highlightDocument(code, "ts");
      const fullMs = performance.now() - fullStart;
      expect(first.html.length).toBeGreaterThan(400);

      let doc = first;
      let current = code;
      const lines = code.split("\n");
      const mid = Math.floor(lines.length / 2);
      const editStart = performance.now();
      for (let i = 0; i < 20; i += 1) {
        const nextLines = current.split("\n");
        nextLines[mid] = `${nextLines[mid] ?? ""}x`;
        current = nextLines.join("\n");
        doc = highlightDocument(current, "ts", doc);
      }
      const editMs = performance.now() - editStart;
      expect(doc.lines[mid]).toContain("x");
      // GitHub runners jitter past a 50ms floor (~50.8ms observed). Keep a
      // hard typing budget so a full re-highlight per keystroke still fails.
      expect(editMs, `${label} incremental edits`).toBeLessThan(Math.max(fullMs * 0.35, 80));
      expect(editMs, `${label} typing budget`).toBeLessThan(80);
    }
  });
});

describe("highlightVisible", () => {
  it("only emits the visible window so the overlay stays small", () => {
    const code = ossTsModule(1_800);
    const painted = highlightVisible(code, "ts", 40, 90);
    expect(painted.padLines).toBe(39);
    expect(painted.tailLines).toBeGreaterThan(1_000);
    expect(painted.html.split("\n").length).toBeLessThanOrEqual(51);
    expect(painted.html).toContain("tok-kw");
  });

  it("reuses provided line arrays so scrolling skips a full split", () => {
    const code = ossTsModule(1_800);
    const first = highlightVisible(code, "ts", 40, 90);
    const again = highlightVisible(code, "ts", 80, 130, first.doc, first.doc.lines);
    expect(again.doc.lines).toBe(first.doc.lines);
    expect(again.padLines).toBe(79);
    expect(again.html.split("\n").length).toBeLessThanOrEqual(51);
  });
});
