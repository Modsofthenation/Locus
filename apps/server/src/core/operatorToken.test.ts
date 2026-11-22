import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadOrCreateOperatorToken,
  operatorAuthDisabled,
  operatorTokenPath,
} from "./operatorToken.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "locus-op-"));
  dirs.push(dir);
  return dir;
}

describe("operator token", () => {
  it("creates a 0600 token file once and reuses it", async () => {
    const home = await tempHome();
    const first = await loadOrCreateOperatorToken(home, {});
    expect(first).toMatch(/^op_[0-9a-f]{64}$/);
    expect((await readFile(operatorTokenPath(home), "utf8")).trim()).toBe(first);
    if (process.platform !== "win32") {
      expect((await stat(operatorTokenPath(home))).mode & 0o777).toBe(0o600);
    }
    expect(await loadOrCreateOperatorToken(home, {})).toBe(first);
  });

  it("replaces a malformed file", async () => {
    const home = await tempHome();
    await writeFile(operatorTokenPath(home), "short\n");
    const token = await loadOrCreateOperatorToken(home, {});
    expect(token).toMatch(/^op_[0-9a-f]{64}$/);
  });

  it("prefers LOCUS_OPERATOR_TOKEN and writes it for the CLI", async () => {
    const home = await tempHome();
    const fromEnv = `op_${"d".repeat(48)}`;
    expect(await loadOrCreateOperatorToken(home, { LOCUS_OPERATOR_TOKEN: fromEnv })).toBe(fromEnv);
    expect((await readFile(operatorTokenPath(home), "utf8")).trim()).toBe(fromEnv);
  });

  it("is off with LOCUS_OPERATOR_AUTH=off", async () => {
    const home = await tempHome();
    expect(operatorAuthDisabled({ LOCUS_OPERATOR_AUTH: "off" })).toBe(true);
    expect(operatorAuthDisabled({})).toBe(false);
    expect(await loadOrCreateOperatorToken(home, { LOCUS_OPERATOR_AUTH: "off" })).toBeUndefined();
  });
});
