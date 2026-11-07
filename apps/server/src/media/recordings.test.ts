import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordingDest, writeMockRecording } from "./recordings.js";

describe("recordingDest", () => {
  it("keeps recordings inside the session directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-rec-"));
    const dest = recordingDest(dir, "sess-1", "demo.mp4");
    expect(dest).toBe(join(dir, "recordings", "sess-1", "demo.mp4"));
    await writeMockRecording(dir, "sess-1", "demo.mp4");
    expect(() => recordingDest(dir, "sess-1", "../passwd")).toThrow(/Invalid recording filename/);
    expect(() => recordingDest(dir, "../escape", "demo.mp4")).toThrow(/Invalid session/);
    expect(() => recordingDest(dir, "sess-1", "demo.txt")).toThrow(/Invalid recording filename/);
  });
});
