import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(src, "index.css"), "utf8");

function definedTokens(): Set<string> {
  const names = new Set<string>();
  const sources = [
    css,
    ...globSync("**/*.{ts,tsx}", { cwd: src }).map((file) => readFileSync(join(src, file), "utf8")),
  ];
  for (const text of sources) {
    for (const match of text.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) names.add(match[1]!);
    for (const match of text.matchAll(/["'`](--[a-zA-Z0-9-]+)["'`]/g)) names.add(match[1]!);
  }
  return names;
}

describe("css tokens", () => {
  it("only reads custom properties that are defined somewhere or carry a fallback", () => {
    const defined = definedTokens();
    const missing = new Set<string>();
    for (const match of css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*(,)?/g)) {
      if (!match[2] && !defined.has(match[1]!)) missing.add(match[1]!);
    }
    expect([...missing]).toEqual([]);
  });

  it("does not strip the global focus ring from composer selects", () => {
    for (const selector of [".model-picker.compact > select", ".composer-head .subagent-select"]) {
      const start = css.indexOf(`${selector} {`);
      expect(start, selector).toBeGreaterThan(-1);
      const body = css.slice(start, css.indexOf("}", start));
      expect(body, selector).not.toMatch(/outline:\s*none/);
    }
  });

  it("draws font weights from the scale so they match the loaded Outfit weights", () => {
    expect([...css.matchAll(/font-weight:\s*(\d+)/g)].map((m) => m[0])).toEqual([]);
  });

  it("keeps font sizes of 10px and up on the type scale", () => {
    const off = [...css.matchAll(/font-size:\s*([\d.]+)px/g)]
      .filter((m) => Number(m[1]) >= 10)
      .map((m) => m[0]);
    expect(off).toEqual([]);
  });

  it("routes focus outlines through the shared focus ring", () => {
    expect(css).toMatch(/--focus-ring:\s*2px solid/);
    expect(css).toMatch(/:focus-visible \{[^}]*outline:\s*var\(--focus-ring\)/);
  });

  it("rings the prompt box while its textarea has keyboard focus", () => {
    expect(css).toMatch(
      /\.composer:has\(textarea:focus-visible\),\s*\.empty-composer:has\(textarea:focus-visible\) \{\s*border-color:/,
    );
  });
});
