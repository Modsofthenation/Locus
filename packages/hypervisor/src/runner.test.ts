import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "runner.ts"), "utf8");

describe("nodeRunner", () => {
  it("hides Windows consoles for exec and spawn", () => {
    expect(src).toContain('stdio: ["ignore", "pipe", "pipe"]');
    expect(src.match(/windowsHide:\s*true/g)?.length).toBe(2);
  });
});
