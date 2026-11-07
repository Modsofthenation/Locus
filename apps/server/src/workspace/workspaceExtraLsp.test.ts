import { describe, expect, it } from "vitest";
import { extraLspLanguage, isExtraLspPath } from "./workspaceExtraLsp.js";

describe("extra language servers", () => {
  it("maps Go, Rust, and Java paths", () => {
    expect(extraLspLanguage("pkg/main.go")).toBe("go");
    expect(extraLspLanguage("src/lib.rs")).toBe("rust");
    expect(extraLspLanguage("src/App.java")).toBe("java");
    expect(extraLspLanguage("src/app.ts")).toBeUndefined();
    expect(isExtraLspPath("cmd/locus/main.go")).toBe(true);
    expect(isExtraLspPath("readme.md")).toBe(false);
  });
});
