import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { artifactDest, writeArtifactBytes } from "./artifacts.js";

describe("artifactDest", () => {
  it("keeps artifacts inside the session directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-art-"));
    const dest = artifactDest(dir, "sess-1", "page.pdf", "pdf");
    expect(dest).toBe(join(dir, "artifacts", "sess-1", "page.pdf"));
    await writeArtifactBytes(dir, "sess-1", "page.pdf", "pdf", Buffer.from("%PDF-1.4\n"));
    expect(await readFile(dest, "utf8")).toContain("%PDF");
    expect(() => artifactDest(dir, "sess-1", "../passwd", "pdf")).toThrow(
      /Invalid artifact filename/,
    );
    expect(() => artifactDest(dir, "../escape", "page.pdf", "pdf")).toThrow(/Invalid session/);
    expect(() => artifactDest(dir, "sess-1", "page.txt", "pdf")).toThrow(
      /Invalid artifact filename/,
    );
  });
});
