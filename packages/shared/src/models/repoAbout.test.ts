import { describe, expect, it } from "vitest";
import { anonymousForgeLabel, readmeExcerpt } from "./git.js";

describe("readmeExcerpt", () => {
  it("drops badge rows and HTML wrappers and keeps the prose", () => {
    const md = [
      '<p align="center">',
      '<img src="logo.svg">',
      "</p>",
      "[![CI](https://x/badge.svg)](https://x) [![npm](https://y.svg)](https://y)",
      "",
      "# Locus",
      "",
      "Local coding agents on your machine.",
    ].join("\n");
    expect(readmeExcerpt(md)).toBe("# Locus\n\nLocal coding agents on your machine.");
  });

  it("clips long READMEs at a paragraph break", () => {
    const para = "word ".repeat(100).trim();
    const out = readmeExcerpt([para, para, para, para].join("\n\n"), 1200);
    expect(out.length).toBeLessThan(1210);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("anonymousForgeLabel", () => {
  it("names the GitHub anonymous quota", () => {
    expect(anonymousForgeLabel("github")).toMatch(/60 requests\/hour/);
    expect(anonymousForgeLabel("gitlab")).toBe("No token · public repos only");
  });
});
