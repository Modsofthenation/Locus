import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("shared barrel", () => {
  it("initializes under tsx native ESM", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "-e", "import('@locus/shared')"],
      {
        encoding: "utf8",
      },
    );
    expect(result.stderr).not.toMatch(/before initialization/);
    expect(result.status).toBe(0);
  });
});
