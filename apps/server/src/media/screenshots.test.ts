import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { screenshotDest, writeScreenshot } from "./screenshots.js";

describe("screenshotDest", () => {
  it("keeps screenshots inside the session directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-shot-"));
    const dest = screenshotDest(dir, "sess-1", "abc.png");
    expect(dest).toBe(join(dir, "screenshots", "sess-1", "abc.png"));
    await writeScreenshot(dir, "sess-1", "abc.png", "AA==");
    expect((await readFile(dest)).length).toBeGreaterThan(0);
    expect(() => screenshotDest(dir, "sess-1", "../passwd")).toThrow(/Invalid screenshot filename/);
    expect(() => screenshotDest(dir, "../escape", "abc.png")).toThrow(/Invalid session/);
    expect(() => screenshotDest(dir, "sess-1", "abc.txt")).toThrow(/Invalid screenshot filename/);
  });
});
