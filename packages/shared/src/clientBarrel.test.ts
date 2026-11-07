import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = dirname(fileURLToPath(import.meta.url));

/** Example imports in strings, comments, and templates are not modules the renderer bundles. */
function skippedSpec(source: string, index: number): boolean {
  let i = 0;
  while (i < index) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const nl = source.indexOf("\n", i + 2);
      if (nl < 0 || nl >= index) return true;
      i = nl + 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end < 0 || end >= index) return true;
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i += 1;
      while (i < source.length) {
        if (i >= index) return true;
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === ch) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return false;
}

function hasNodeBuiltinImport(source: string): boolean {
  const re = /["']node:/g;
  for (const match of source.matchAll(re)) {
    if (!skippedSpec(source, match.index ?? 0)) return true;
  }
  return false;
}

function relativeSpecs(source: string, fromFile: string): string[] {
  const specs: string[] = [];
  const re = /(?:from|import)\s+["'](\.\.?\/[^"']+)["']/g;
  for (const match of source.matchAll(re)) {
    if (skippedSpec(source, match.index ?? 0)) continue;
    const spec = match[1]!.replace(/\.js$/, ".ts");
    const resolved = join(dirname(fromFile), spec);
    specs.push(resolved.endsWith(".ts") ? resolved : `${resolved}.ts`);
  }
  return specs;
}

describe("shared client barrel", () => {
  it("does not import Node builtins the Vite renderer cannot bundle", () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    const queue = [join(srcDir, "index.ts")];
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file) || file.includes(".test.")) continue;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      if (hasNodeBuiltinImport(source)) {
        offenders.push(relative(srcDir, file).replaceAll("\\", "/"));
      }
      queue.push(...relativeSpecs(source, file));
    }
    expect(offenders).toEqual([]);
  });

  it("does not follow import examples inside strings or comments", () => {
    const source = [
      'import type { DesignTune } from "./designTune.js";',
      "const readme = 'import * as THREE from \"./vendor/three.module.js\";';",
      '// import { gone } from "./missing.js";',
    ].join("\n");
    const specs = relativeSpecs(source, join(srcDir, "models", "gameCanvas.ts"));
    expect(specs.map((file) => file.split(/[/\\]/).pop())).toEqual(["designTune.ts"]);
  });

  it("does not treat generated hook templates as Node imports", () => {
    const generated = [
      "export function script() {",
      "  return `#!/usr/bin/env node",
      'import { readFile } from "node:fs/promises";',
      "`;",
      "}",
    ].join("\n");
    expect(hasNodeBuiltinImport(generated)).toBe(false);
    expect(hasNodeBuiltinImport(`${generated}\nimport { join } from "node:path";`)).toBe(true);
  });
});
